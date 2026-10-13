// Disponibilidad gestionada en la app: cupos por franja, bloqueos provisionales con caducidad y confirmaciones.
// Regla de oro: la ausencia de respuesta NUNCA se interpreta como disponibilidad.
import { conflict, badRequest, nowIso, plusMinutes, weekdayOf } from './util.js';
import { settings } from './core.js';

const ACTIVE = `released_at IS NULL AND (kind='confirmed' OR (kind='hold' AND expires_at>?))`;

export function slotInfo(ctx, { service_id, provider_id, date, start_time }, excludeEsId = null) {
  const { db, cid } = ctx;
  if (!date || !start_time) return { ok: false, reason: 'Falta fecha u hora' };
  const closure = db.get(`SELECT * FROM availability_closures WHERE company_id=? AND provider_id=? AND (service_id IS NULL OR service_id=?)
    AND date_from<=? AND date_to>=?`, cid, provider_id, service_id, date, date);
  if (closure) return { ok: false, reason: `Cerrado${closure.reason ? `: ${closure.reason}` : ''}`, closed: true };
  const wd = String(weekdayOf(date));
  const rule = db.all(`SELECT * FROM availability_rules WHERE company_id=? AND provider_id=? AND service_id=? AND start_time=? AND active=1`,
    cid, provider_id, service_id, start_time).find((r) => r.weekdays.split(',').includes(wd));
  if (!rule) return { ok: false, reason: 'Sin horario/cupo definido para esa fecha y hora' };
  const capacity = rule.shared ? (rule.agency_quota_pax ?? 0) : rule.capacity_pax;
  const used = db.get(`SELECT COALESCE(SUM(pax),0) n FROM allocations WHERE company_id=? AND service_id=? AND provider_id=? AND date=? AND start_time=?
    AND ${ACTIVE} AND event_service_id<>?`, cid, service_id, provider_id, date, start_time, nowIso(), excludeEsId ?? -1).n;
  // Disponibilidad compartida con otros canales y sin calendario externo fiable → exige confirmación del proveedor
  return { ok: true, rule, capacity, used, free: capacity - used, shared: !!rule.shared, needs_provider_confirmation: !!rule.shared };
}

export function releaseAllocations(ctx, esId, reason) {
  ctx.db.run(`UPDATE allocations SET released_at=?, release_reason=? WHERE company_id=? AND event_service_id=? AND released_at IS NULL`,
    nowIso(), reason, ctx.cid, esId);
}
export const activeAllocation = (ctx, esId) => ctx.db.get(`SELECT * FROM allocations WHERE company_id=? AND event_service_id=? AND ${ACTIVE}
  ORDER BY id DESC LIMIT 1`, ctx.cid, esId, nowIso());

// Bloqueo provisional (atómico: se evalúa y se inserta dentro de una transacción BEGIN IMMEDIATE)
export function hold(ctx, es, { kind = 'hold' } = {}) {
  return ctx.db.tx(() => {
    const info = slotInfo(ctx, es, es.id);
    if (!info.ok) throw conflict(info.reason, 'no_slot');
    if (es.pax > info.free) throw conflict(`Sin cupo: quedan ${Math.max(info.free, 0)} plazas y se necesitan ${es.pax}`, 'no_capacity', { free: info.free });
    releaseAllocations(ctx, es.id, kind === 'hold' ? 'rebloqueo' : 'confirmado');
    const expires = kind === 'hold' ? plusMinutes(settings(ctx).hold_minutes) : null;
    const id = ctx.db.insert('allocations', { company_id: ctx.cid, event_service_id: es.id, service_id: es.service_id, provider_id: es.provider_id,
      date: es.date, start_time: es.start_time, pax: es.pax, kind, expires_at: expires, created_at: nowIso() });
    return { allocation_id: id, expires_at: expires, info };
  });
}

// ¿Cabría `pax` en fecha/hora nuevas? (sin tocar nada). Para cambios de asistentes/fecha.
export function capacityCheck(ctx, es, { pax, date, start_time }) {
  const provider = ctx.db.get('SELECT * FROM providers WHERE id=? AND company_id=?', es.provider_id, ctx.cid);
  if (!provider || provider.availability_mode !== 'managed') return { checked: false, ok: true, note: 'Disponibilidad bajo solicitud: requiere confirmación del proveedor' };
  const info = slotInfo(ctx, { service_id: es.service_id, provider_id: es.provider_id, date: date ?? es.date, start_time: start_time ?? es.start_time }, es.id);
  if (!info.ok) return { checked: true, ok: false, free: 0, note: info.reason };
  return { checked: true, ok: (pax ?? es.pax) <= info.free, free: info.free, capacity: info.capacity, note: (pax ?? es.pax) <= info.free ? 'Hay cupo' : `Solo quedan ${info.free} plazas` };
}

// Alternativas: otros proveedores del mismo servicio con cupo (o bajo solicitud)
export function alternatives(ctx, es) {
  const rows = ctx.db.all(`SELECT p.*, sp.cost_cents sp_cost FROM service_providers sp JOIN providers p ON p.id=sp.provider_id
    WHERE sp.service_id=? AND sp.company_id=? AND p.active=1 AND p.id<>?`, es.service_id, ctx.cid, es.provider_id);
  return rows.map((p) => {
    if (p.availability_mode === 'managed') {
      const info = slotInfo(ctx, { service_id: es.service_id, provider_id: p.id, date: es.date, start_time: es.start_time });
      return { provider_id: p.id, name: p.name, mode: 'managed', available: info.ok && info.free >= es.pax, free: info.free ?? 0, note: info.reason || null, cost_cents: p.sp_cost };
    }
    return { provider_id: p.id, name: p.name, mode: 'on_request', available: null, note: 'Requiere solicitud al proveedor', cost_cents: p.sp_cost };
  });
}

export function validateRule(r) {
  if (!/^\d{2}:\d{2}$/.test(r.start_time || '')) throw badRequest('Hora de inicio no válida');
  if (!(Number(r.capacity_pax) > 0)) throw badRequest('Capacidad no válida');
  if (r.shared && !(Number(r.agency_quota_pax) >= 0)) throw badRequest('Indica el cupo exclusivo de la agencia');
}
