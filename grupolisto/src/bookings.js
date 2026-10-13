// Reservas y eventos: estados por servicio, estado global derivado, solicitudes a proveedores, cambios y caducidad de bloqueos.
import { byId, audit, settings, addTask, nextNumber, mint, parseRow } from './core.js';
import { conflict, badRequest, nowIso, today, addDays, diffDays, parseJson, newToken, sha256, plusMinutes, netOf, now } from './util.js';
import { calcSpec, discountedPrices, lineFromService } from './pricing.js';
import * as av from './availability.js';
import { notifyClient, notifyProvider } from './notify.js';
import { BASE_URL } from './config.js';

export const ES_STATUS = { requested: 'Solicitado', pending_availability: 'Pendiente de disponibilidad', available: 'Disponible',
  held: 'Bloqueado provisionalmente', confirmed: 'Confirmado', rejected: 'Rechazado', cancelled: 'Cancelado', done: 'Realizado' };
const LIVE = (s) => s.status !== 'cancelled';
const OK = (s) => s.status === 'confirmed' || s.status === 'done';

// ---------------------------------------------------------------- finanzas del evento
export function paymentTotals(ctx, eventId) {
  const r = ctx.db.get(`SELECT
    COALESCE(SUM(CASE WHEN kind<>'refund' AND status IN ('verified','refunded') THEN amount_cents END),0) paid,
    COALESCE(SUM(CASE WHEN kind='refund' AND status='verified' THEN amount_cents END),0) refunded,
    COALESCE(SUM(CASE WHEN kind<>'refund' AND status IN ('pending','processing') THEN amount_cents END),0) open_amount,
    COALESCE(SUM(CASE WHEN kind='deposit' AND status IN ('verified','refunded') THEN amount_cents END),0) deposit_paid
    FROM payments_in WHERE company_id=? AND event_id=?`, ctx.cid, eventId);
  return { paid: r.paid, refunded: r.refunded, net_paid: r.paid - r.refunded, open_amount: r.open_amount, deposit_paid: r.deposit_paid };
}

// ---------------------------------------------------------------- obligaciones con proveedores (nunca se pagan solas)
function syncObligations(ctx, es) {
  if (!es.provider_id) return;
  const { db, cid } = ctx;
  const rows = db.all('SELECT * FROM payments_out WHERE company_id=? AND event_service_id=?', cid, es.id);
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
  const prov = db.get('SELECT * FROM providers WHERE id=? AND company_id=?', es.provider_id, cid);
  let total = 0;
  if (es.status === 'confirmed' || es.status === 'done') total = es.cost_cents;
  else if (es.status === 'cancelled') total = es.cancel_cost_penalty_cents || 0;
  const dep = Math.round((total * (prov?.cost_deposit_pct || 0)) / 100);
  let want = { deposit: dep, balance: total - dep };
  const paidDep = byKind.deposit?.status === 'paid' ? byKind.deposit.amount_cents : null;
  if (paidDep !== null) want = { deposit: paidDep, balance: Math.max(total - paidDep, 0) };
  const dueDep = today(), dueBal = es.date ? addDays(es.date, -(prov?.cost_due_days_before ?? 7)) : today();
  for (const kind of ['deposit', 'balance']) {
    const row = byKind[kind], amount = want[kind];
    if (row?.status === 'paid') continue;                       // lo pagado no se toca
    if (!row) { if (amount > 0) db.insert('payments_out', { company_id: cid, event_service_id: es.id, event_id: es.event_id, provider_id: es.provider_id, kind,
      amount_cents: amount, due_date: kind === 'deposit' ? dueDep : dueBal, status: 'pending', created_at: nowIso() }); continue; }
    if (amount === 0) { db.update('payments_out', row.id, cid, { status: 'cancelled', amount_cents: 0 }); continue; }
    if (row.amount_cents !== amount || row.status === 'cancelled') {
      db.update('payments_out', row.id, cid, { amount_cents: amount, status: 'pending', due_date: kind === 'deposit' ? row.due_date : dueBal, idem_key: null });
      if (row.status === 'ordered') audit(ctx, 'payment_out', row.id, 'orden_anulada_por_cambio_importe', { de: row.amount_cents, a: amount });
    }
  }
}

// ---------------------------------------------------------------- recálculo del evento
export function recomputeEvent(ctx, eventId) {
  const { db, cid } = ctx;
  const ev = byId(ctx, 'events', eventId);
  const svcs = db.all('SELECT * FROM event_services WHERE company_id=? AND event_id=?', cid, eventId);
  for (const s of svcs) {
    if (['confirmed', 'done', 'cancelled'].includes(s.status)) syncObligations(ctx, s);
    else if (s.status === 'rejected') db.run(`UPDATE payments_out SET status='cancelled' WHERE company_id=? AND event_service_id=? AND status IN ('pending','ordered')`, cid, s.id);
  }
  const active = svcs.filter(LIVE);
  const total = active.reduce((a, s) => a + s.price_cents, 0) + svcs.filter((s) => !LIVE(s)).reduce((a, s) => a + (s.cancel_penalty_cents || 0), 0);
  const pt = paymentTotals(ctx, eventId);
  const deposit = Math.round((total * ev.deposit_pct) / 100);
  const mand = active.filter((s) => s.mandatory);
  const depositOk = deposit === 0 || pt.net_paid >= deposit;
  let booking = 'pending';
  if (active.length && mand.every(OK) && depositOk) booking = 'confirmed';
  else if (active.some(OK)) booking = 'partial';
  const pay = pt.net_paid <= 0 ? 'pending' : pt.net_paid < total ? 'partial' : pt.net_paid === total ? 'paid' : 'overpaid';
  const upd = { total_due_cents: total, deposit_required_cents: deposit, payment_status: pay,
    balance_due_date: ev.date ? addDays(ev.date, -settings(ctx).balance_due_days_before) : null };
  if (ev.status === 'active') {
    upd.booking_status = booking;
    if (booking === 'confirmed' && ev.booking_status !== 'confirmed') {
      upd.confirm_count = ev.confirm_count + 1;
      notifyClient(ctx, { ...ev, ...upd }, 'booking_confirmed', { saldo: fmtEur(total - pt.net_paid) },
        { dedupe_key: `booking_confirmed:${ev.id}:${upd.confirm_count}`, automatic: true });
      if (ev.lead_id) db.run(`UPDATE leads SET stage='booked', updated_at=? WHERE id=? AND company_id=?`, nowIso(), ev.lead_id, cid);
      audit(ctx, 'event', ev.id, 'reserva_confirmada_completa');
    }
    if (!active.length) { upd.status = 'cancelled'; upd.cancelled_at = nowIso(); upd.booking_status = 'pending';
      if (ev.lead_id) db.run(`UPDATE leads SET stage='cancelled', updated_at=? WHERE id=? AND company_id=?`, nowIso(), ev.lead_id, cid); }
    else if (active.every((s) => s.status === 'done')) { upd.status = 'completed'; upd.completed_at = nowIso();
      if (ev.lead_id) db.run(`UPDATE leads SET stage='finished', updated_at=? WHERE id=? AND company_id=?`, nowIso(), ev.lead_id, cid); }
  }
  db.update('events', ev.id, cid, upd);
  // señal pendiente: se ajusta al nuevo importe requerido (si aún no se ha pagado/cobrado nada de ella)
  const pend = db.get(`SELECT * FROM payments_in WHERE company_id=? AND event_id=? AND kind='deposit' AND status='pending' AND token_hash IS NOT NULL ORDER BY id DESC LIMIT 1`, cid, eventId);
  if (pend && ev.status === 'active') {
    const need = Math.max(deposit - pt.net_paid, 0);
    if (need === 0) db.update('payments_in', pend.id, cid, { status: 'cancelled' });
    else if (need !== pend.amount_cents) db.update('payments_in', pend.id, cid, { amount_cents: need });
  }
  return byId(ctx, 'events', eventId);
}
const fmtEur = (c) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100);

// ---------------------------------------------------------------- crear evento al aceptar una propuesta
export function createEventFromQuote(ctx, quote, option, lines) {
  const { db, cid } = ctx;
  const lead = quote.lead_id ? byId(ctx, 'leads', quote.lead_id, { optional: true }) : null;
  const prices = discountedPrices(lines, option.discount_cents);
  const ratio = prices[0]?.ratioBp ?? 0;
  const evId = db.insert('events', { company_id: cid, code: nextNumber(ctx, 'events', 'code', 'EV'), client_id: quote.client_id, lead_id: quote.lead_id,
    quote_id: quote.id, quote_version: quote.version, brand_id: quote.brand_id, name: quote.title, date: option.event_date, start_time: option.start_time,
    pax: option.pax, owner_user_id: lead?.owner_user_id ?? quote.created_by, discount_bp: ratio, deposit_pct: quote.deposit_pct,
    terms: { quote: `${quote.number} v${quote.version}`, ...parseJson(quote.terms, {}) }, created_at: nowIso() });
  for (const { line, price, list } of prices) {
    const snap = parseJson(line.snapshot, {});
    db.insert('event_services', { company_id: cid, event_id: evId, service_id: line.service_id, provider_id: line.provider_id, pack_id: line.pack_id,
      name: line.description, date: option.event_date, start_time: line.start_time || option.start_time, pax: line.pax ?? option.pax, qty: line.qty,
      list_price_cents: list, price_cents: price, cost_cents: line.total_cost_cents, tax_bp: line.tax_bp, cost_tax_bp: line.cost_tax_bp,
      mandatory: line.mandatory, status: 'requested', terms: snap, created_at: nowIso() });
  }
  audit(ctx, 'event', evId, 'creado_desde_propuesta', { quote: `${quote.number} v${quote.version}`, option: option.name });
  return recomputeEvent(ctx, evId);
}

// ---------------------------------------------------------------- servicios del evento
const getES = (ctx, id) => byId(ctx, 'event_services', id);
const eventOf = (ctx, es) => byId(ctx, 'events', es.event_id);
function setStatus(ctx, es, status, extra = {}) {
  ctx.db.update('event_services', es.id, ctx.cid, { status, ...extra });
  audit(ctx, 'event_service', es.id, `estado:${es.status}→${status}`, extra.rejected_reason ? { motivo: extra.rejected_reason } : undefined);
  return getES(ctx, es.id);
}
const done = (ctx, es) => { recomputeEvent(ctx, es.event_id); return getES(ctx, es.id); };

export function openRequest(ctx, esId) {
  return ctx.db.get(`SELECT * FROM provider_requests WHERE company_id=? AND event_service_id=? AND status IN ('sent') ORDER BY id DESC LIMIT 1`, ctx.cid, esId);
}
const revokeOpenRequests = (ctx, esId) => ctx.db.run(
  `UPDATE provider_requests SET status='cancelled', token_revoked_at=? WHERE company_id=? AND event_service_id=? AND status='sent'`, nowIso(), ctx.cid, esId);

/** Envía solicitud estructurada al proveedor. Devuelve el enlace privado (solo se muestra al crearla). */
export function sendRequest(ctx, esId, { resend = false } = {}) {
  const es = getES(ctx, esId);
  if (!es.provider_id) throw badRequest('El servicio no tiene proveedor asignado');
  const prov = byId(ctx, 'providers', es.provider_id);
  const existing = openRequest(ctx, esId);
  if (existing && !resend) throw conflict('Ya hay una solicitud abierta a este proveedor', 'request_open');
  const set = settings(ctx), ev = eventOf(ctx, es);
  const lead = ev.lead_id ? byId(ctx, 'leads', ev.lead_id, { optional: true }) : null;
  return ctx.db.tx(() => {
    revokeOpenRequests(ctx, esId);
    const deadline = plusMinutes(set.response_deadline_hours * 60);
    // Minimización de datos: el proveedor NO recibe datos personales del cliente
    const payload = { service: es.name, date: es.date, start_time: es.start_time, pax: es.pax, proposed_cost_cents: es.cost_cents,
      event_code: ev.code, group: lead?.event_type || 'Grupo', conditions: { payment: es.terms.payment_terms, cancel: es.terms.cancel_terms,
        cancel_free_days: es.terms.cancel_free_days, cancel_penalty_pct: es.terms.cancel_penalty_pct, restrictions: es.terms.restrictions },
      notes: es.notes || null, reconfirm: !!es.reconfirm };
    const id = ctx.db.insert('provider_requests', { company_id: ctx.cid, event_service_id: esId, provider_id: es.provider_id, token_hash: sha256(newToken()),
      status: 'sent', payload, deadline_at: deadline, sent_at: nowIso() });
    const tok = mint(ctx, 'provider_requests', id);
    const link = `${BASE_URL}/#/prov/${tok}`;
    notifyProvider(ctx, es, es.reconfirm ? 'service_changed' : 'availability_request', { enlace: link, vence: deadline.slice(0, 10).split('-').reverse().join('/') },
      { ignore_window: true });
    if (es.status !== 'pending_availability') setStatus(ctx, es, 'pending_availability');
    audit(ctx, 'event_service', esId, 'solicitud_proveedor', { provider: prov.name, request: id });
    return { request_id: id, link, deadline_at: deadline };
  });
}

export function startService(ctx, esId, { override = false } = {}) {
  const es = getES(ctx, esId);
  if (!['requested', 'rejected'].includes(es.status)) throw conflict('El servicio no está en un estado que permita solicitar disponibilidad', 'bad_state');
  if (!es.provider_id) throw conflict('Servicio sin proveedor: confírmalo internamente o asigna un proveedor', 'no_provider');
  if (!es.date) throw badRequest('El evento no tiene fecha');
  const t = es.terms || {};
  if (!override) {
    if (t.min_notice_days && diffDays(today(), es.date) < t.min_notice_days) throw conflict(`Antelación mínima: ${t.min_notice_days} días`, 'min_notice');
    if (t.max_pax && es.pax > t.max_pax) throw conflict(`El servicio admite como máximo ${t.max_pax} personas`, 'max_pax');
    if (t.min_pax && es.pax < t.min_pax) throw conflict(`El servicio exige mínimo ${t.min_pax} personas`, 'min_pax');
  }
  const prov = byId(ctx, 'providers', es.provider_id);
  return ctx.db.tx(() => {
    let link = null;
    if (prov.availability_mode === 'managed') {
      const h = av.hold(ctx, es);                       // puede lanzar 409 (sin cupo / cerrado)
      if (h.info.needs_provider_confirmation) { setStatus(ctx, es, 'pending_availability'); link = sendRequest(ctx, esId).link; }
      else setStatus(ctx, es, 'held');
      audit(ctx, 'event_service', esId, 'bloqueo_provisional', { expira: h.expires_at });
    } else link = sendRequest(ctx, esId).link;
    return { ...done(ctx, getES(ctx, esId)), request_link: link };
  });
}

/** Respuesta del proveedor (desde su portal o enlace privado). Sin respuesta ≠ disponible. */
export function respondRequest(ctx, req, input) {
  if (req.status !== 'sent') throw conflict('Esta solicitud ya fue respondida o cancelada', 'request_closed');
  const es = getES(ctx, req.event_service_id);
  const resp = input.response;
  if (!['confirm', 'reject', 'alternative'].includes(resp)) throw badRequest('Respuesta no válida');
  const late = req.deadline_at && req.deadline_at < nowIso() ? 1 : 0;
  const base = { status: 'responded', response: resp, response_notes: input.notes || null, requirements: input.requirements || null,
    responded_at: nowIso(), late };
  return ctx.db.tx(() => {
    if (resp === 'confirm') {
      const cost = input.cost_cents == null || input.cost_cents === '' ? null : Math.round(Number(input.cost_cents));
      if (cost != null && !(cost >= 0)) throw badRequest('Coste no válido');
      const diff = cost != null && cost !== es.cost_cents;
      ctx.db.update('provider_requests', req.id, ctx.cid, { ...base, response_cost_cents: cost, review_status: diff ? 'pending_internal' : null });
      setStatus(ctx, es, 'available', { provider_confirmed: 1, needs_review: diff ? 1 : 0, reconfirm: 0 });
      if (diff) addTask(ctx, { title: `Revisar coste propuesto por el proveedor (${es.name}): ${fmtEur(cost)} vs ${fmtEur(es.cost_cents)}`, event_id: es.event_id, kind: 'incident', auto_key: `cost:${req.id}` });
    } else if (resp === 'reject') {
      ctx.db.update('provider_requests', req.id, ctx.cid, base);
      av.releaseAllocations(ctx, es.id, 'rechazado_por_proveedor');
      setStatus(ctx, es, 'rejected', { rejected_reason: input.notes || 'Rechazado por el proveedor', provider_confirmed: 0 });
      addTask(ctx, { title: `Proveedor rechaza ${es.name}: buscar alternativa`, event_id: es.event_id, kind: 'incident', auto_key: `reject:${req.id}` });
    } else {
      if (!input.alt_date && !input.alt_time && !input.notes) throw badRequest('Indica la alternativa propuesta');
      ctx.db.update('provider_requests', req.id, ctx.cid, { ...base, alt_date: input.alt_date || null, alt_time: input.alt_time || null, alt_status: 'pending_internal' });
      addTask(ctx, { title: `Alternativa del proveedor para ${es.name}: aceptar o rechazar`, event_id: es.event_id, kind: 'incident', auto_key: `alt:${req.id}` });
    }
    audit(ctx, 'provider_request', req.id, `respuesta:${resp}`, { late: !!late });
    return done(ctx, getES(ctx, es.id));
  });
}

/** Revisión interna de una alternativa o de un coste distinto propuesto por el proveedor. Nada cambia sin esta aceptación. */
export function reviewResponse(ctx, reqId, accept) {
  const req = byId(ctx, 'provider_requests', reqId);
  const es = getES(ctx, req.event_service_id);
  return ctx.db.tx(() => {
    if (req.response === 'alternative' && req.alt_status === 'pending_internal') {
      if (accept) {
        const date = req.alt_date || es.date, time = req.alt_time || es.start_time;
        const chk = av.capacityCheck(ctx, es, { date, start_time: time });
        if (!chk.ok) throw conflict(`La alternativa no tiene cupo: ${chk.note}`, 'no_capacity');
        ctx.db.update('event_services', es.id, ctx.cid, { date, start_time: time });
        ctx.db.update('provider_requests', req.id, ctx.cid, { alt_status: 'accepted' });
        setStatus(ctx, getES(ctx, es.id), 'available', { provider_confirmed: 1 });
        addTask(ctx, { title: `Informar al cliente: ${es.name} pasa a ${date} ${time || ''}`, event_id: es.event_id, auto_key: `inform:${req.id}` });
      } else {
        ctx.db.update('provider_requests', req.id, ctx.cid, { alt_status: 'declined' });
        setStatus(ctx, es, 'requested');
      }
    } else if (req.review_status === 'pending_internal') {
      ctx.db.update('provider_requests', req.id, ctx.cid, { review_status: accept ? 'accepted' : 'declined' });
      if (accept) {
        const spec = { ...es.terms.pricing }; const unitDiv = spec.price_model === 'per_person' ? es.pax * es.qty : es.qty;
        spec.cost_cents = Math.round(req.response_cost_cents / (unitDiv || 1));
        if (spec.price_model === 'tiers') spec.tiers = spec.tiers.map((t) => ({ ...t, cost_cents: spec.cost_cents }));
        ctx.db.update('event_services', es.id, ctx.cid, { cost_cents: req.response_cost_cents, needs_review: 0, terms: { ...es.terms, pricing: spec } });
        audit(ctx, 'event_service', es.id, 'coste_aceptado', { de: es.cost_cents, a: req.response_cost_cents });
      } else {
        ctx.db.update('event_services', es.id, ctx.cid, { needs_review: 0 });
        setStatus(ctx, getES(ctx, es.id), 'requested', { provider_confirmed: 0 });
        addTask(ctx, { title: `Renegociar coste con proveedor (${es.name})`, event_id: es.event_id, auto_key: `renegociar:${req.id}` });
      }
    } else throw conflict('Nada pendiente de revisar en esta respuesta', 'nothing_to_review');
    return done(ctx, es);
  });
}

/** «Confirmar servicio»: decisión interna tras disponibilidad (proveedor o cupo propio). Pagos/aceptaciones NO confirman solos. */
export function confirmService(ctx, esId) {
  const es = getES(ctx, esId);
  if (es.needs_review) throw conflict('Hay un coste o una alternativa del proveedor pendiente de revisión', 'needs_review');
  const prov = es.provider_id ? byId(ctx, 'providers', es.provider_id) : null;
  const ok = es.status === 'available' || (es.status === 'held' && prov?.availability_mode === 'managed')
    || (es.status === 'requested' && !es.provider_id);
  if (!ok) throw conflict(`Un servicio «${ES_STATUS[es.status]}» no se puede confirmar: falta disponibilidad confirmada`, 'bad_state');
  return ctx.db.tx(() => {
    if (prov?.availability_mode === 'managed') {
      const info = av.slotInfo(ctx, es, es.id);
      if (info.ok && info.needs_provider_confirmation && !es.provider_confirmed) throw conflict('Disponibilidad compartida: requiere confirmación del proveedor', 'needs_provider');
      av.hold(ctx, es, { kind: 'confirmed' });                  // convierte el bloqueo en cupo firme (revalida capacidad)
    }
    const s = setStatus(ctx, es, 'confirmed', { reconfirm: 0 });
    if (es.provider_id) notifyProvider(ctx, s, 'service_confirmed', {}, { dedupe_key: `svc_confirmed:${es.id}:${s.pax}:${s.date}:${s.cost_cents}`, ignore_window: true });
    return done(ctx, s);
  });
}

export function cancelService(ctx, esId, { by = 'agency', reason, waive_penalty = false } = {}) {
  const es = getES(ctx, esId);
  if (['cancelled', 'done'].includes(es.status)) throw conflict('El servicio ya está cancelado o realizado', 'bad_state');
  return ctx.db.tx(() => {
    const t = es.terms || {};
    const days = es.date ? diffDays(today(), es.date) : 999;
    const late = days < (t.cancel_free_days ?? 0);
    const pct = t.cancel_penalty_pct ?? 0;
    const chargeable = by === 'client' && late && !waive_penalty;      // si cancela la agencia o el proveedor, no hay penalización al cliente
    const penalty = chargeable ? Math.round((es.price_cents * pct) / 100) : 0;
    const costPenalty = chargeable && es.provider_confirmed ? Math.round((es.cost_cents * pct) / 100) : 0;
    av.releaseAllocations(ctx, es.id, 'cancelado');
    revokeOpenRequests(ctx, es.id);
    const wasLive = ['pending_availability', 'available', 'held', 'confirmed'].includes(es.status);
    const s = setStatus(ctx, es, 'cancelled', { cancelled_at: nowIso(), cancelled_by: by, cancel_penalty_cents: penalty, cancel_cost_penalty_cents: costPenalty,
      notes: reason ? `${es.notes ? `${es.notes} · ` : ''}Cancelación: ${reason}` : es.notes });
    if (wasLive && es.provider_id) notifyProvider(ctx, s, 'service_cancelled', {}, { dedupe_key: `svc_cancel:${es.id}`, ignore_window: true });
    done(ctx, s);
    const ev = eventOf(ctx, s), pt = paymentTotals(ctx, ev.id);
    return { service: getES(ctx, es.id), penalty_cents: penalty, cost_penalty_cents: costPenalty,
      refund_suggested_cents: Math.max(pt.net_paid - ev.total_due_cents, 0), event: ev };
  });
}

export function markDone(ctx, esId, { override = false } = {}) {
  const es = getES(ctx, esId);
  if (es.status !== 'confirmed') throw conflict('Solo se pueden marcar como realizados los servicios confirmados', 'bad_state');
  if (!override && es.date > today()) throw conflict('El servicio aún no ha tenido lugar', 'future');
  setStatus(ctx, es, 'done', { done_at: nowIso() });     // marcar «realizado» NO genera ningún pago
  return done(ctx, es);
}

export function reassignProvider(ctx, esId, providerId) {
  const es = getES(ctx, esId);
  if (!['rejected', 'requested'].includes(es.status)) throw conflict('Solo se puede cambiar de proveedor un servicio rechazado o sin solicitar', 'bad_state');
  const sp = ctx.db.get('SELECT * FROM service_providers WHERE service_id=? AND provider_id=? AND company_id=?', es.service_id, providerId, ctx.cid);
  if (es.service_id && !sp) throw badRequest('Ese proveedor no presta este servicio');
  byId(ctx, 'providers', providerId);
  ctx.db.update('event_services', es.id, ctx.cid, { provider_id: providerId, provider_confirmed: 0, ...(sp?.cost_cents != null ? { cost_cents: sp.cost_cents * (es.terms.pricing?.price_model === 'per_person' ? es.pax * es.qty : es.qty) } : {}) });
  audit(ctx, 'event_service', es.id, 'proveedor_reasignado', { provider_id: providerId });
  return setStatus(ctx, getES(ctx, es.id), 'requested');
}

// ---------------------------------------------------------------- cambios de fecha / asistentes / servicios
function repriceService(es, ev, pax) {
  const pr = es.terms.pricing;
  const c = calcSpec(pr, pax, es.qty, pr.discount_pct || 0);
  return { list: c.price, price: Math.round((c.price * (10000 - ev.discount_bp)) / 10000), cost: c.cost };
}

export function proposeChange(ctx, eventId, { pax, date, start_time, add = [], note } = {}) {
  const ev = byId(ctx, 'events', eventId);
  if (ev.status !== 'active') throw conflict('El evento no está activo', 'bad_state');
  pax = pax == null || pax === '' ? ev.pax : Math.round(Number(pax));
  if (!(pax > 0)) throw badRequest('Número de asistentes no válido');
  date = date || ev.date;
  const svcs = ctx.db.all(`SELECT * FROM event_services WHERE company_id=? AND event_id=? AND status NOT IN ('cancelled','done')`, ctx.cid, eventId).map(parseRow);
  const report = [], lines = [];
  let delta = 0;
  for (const es of svcs) {
    const followsPax = es.pax === ev.pax, followsDate = es.date === ev.date;
    const nPax = followsPax ? pax : es.pax, nDate = followsDate ? date : es.date, nTime = start_time && followsDate ? start_time : es.start_time;
    let np = { price: es.price_cents, cost: es.cost_cents, list: es.list_price_cents };
    try { if (nPax !== es.pax) np = repriceService(es, ev, nPax); } catch (e) { report.push({ es_id: es.id, name: es.name, ok: false, note: e.message }); continue; }
    const changed = nPax !== es.pax || nDate !== es.date || nTime !== es.start_time;
    const cap = changed ? av.capacityCheck(ctx, es, { pax: nPax, date: nDate, start_time: nTime }) : { checked: false, ok: true, note: 'Sin cambios' };
    const t = es.terms || {};
    const limits = [];
    if (t.max_pax && nPax > t.max_pax) limits.push(`Máximo ${t.max_pax} personas`);
    if (t.min_pax && nPax < t.min_pax) limits.push(`Mínimo ${t.min_pax} personas`);
    report.push({ es_id: es.id, name: es.name, changed, ok: cap.ok && !limits.length, capacity: cap, limits,
      old: { pax: es.pax, date: es.date, price: es.price_cents, cost: es.cost_cents }, new: { pax: nPax, date: nDate, start_time: nTime, price: np.price, cost: np.cost, list: np.list } });
    delta += np.price - es.price_cents;
  }
  for (const a of add) {
    const svc = byId(ctx, 'services', a.service_id);
    const sp = ctx.db.get('SELECT * FROM service_providers WHERE service_id=? AND company_id=? ORDER BY provider_id LIMIT 1', svc.id, ctx.cid);
    const l = lineFromService(svc, { pax, qty: a.qty || 1, costOverride: sp?.cost_cents, providerId: sp?.provider_id });
    const price = Math.round((l.total_price_cents * (10000 - ev.discount_bp)) / 10000);
    lines.push({ line: l, price });
    delta += price;
    report.push({ es_id: null, name: svc.name, changed: true, ok: true, capacity: { checked: false, ok: true, note: 'Servicio nuevo: requiere solicitud al proveedor' }, limits: [],
      old: null, new: { pax, date, price, cost: l.total_cost_cents } });
  }
  ctx.db.run(`UPDATE event_changes SET status='superseded', token_revoked_at=? WHERE company_id=? AND event_id=? AND status='pending_acceptance'`, nowIso(), ctx.cid, eventId);
  const id = ctx.db.insert('event_changes', { company_id: ctx.cid, event_id: eventId, kind: 'cambio', before_json: { pax: ev.pax, date: ev.date, start_time: ev.start_time, total: ev.total_due_cents },
    after_json: { pax, date, start_time: start_time || ev.start_time, add: lines.map((l) => ({ line: l.line, price: l.price })), lines: report },
    price_delta_cents: delta, capacity_report: report.map((r) => ({ name: r.name, ok: r.ok, note: r.capacity?.note, limits: r.limits })), proposed_by: ctx.user?.id ?? null,
    proposed_at: nowIso(), note: note || null });
  const tok = mint(ctx, 'event_changes', id);
  audit(ctx, 'event', eventId, 'cambio_propuesto', { pax, date, delta });
  return { change: byId(ctx, 'event_changes', id), link: `${BASE_URL}/#/chg/${tok}`, can_apply: report.every((r) => r.ok), report, price_delta_cents: delta };
}

export function acceptChange(ctx, changeId, { via = 'staff', by_name, note } = {}) {
  const ch = byId(ctx, 'event_changes', changeId);
  if (ch.status !== 'pending_acceptance') throw conflict('El cambio ya no está pendiente', 'bad_state');
  const after = parseJson(ch.after_json, {}), ev = byId(ctx, 'events', ch.event_id);
  const blocked = (after.lines || []).filter((l) => l.ok === false);
  if (blocked.length) throw conflict(`El cambio no es viable: ${blocked.map((l) => `${l.name} (${(l.limits || [])[0] || l.capacity?.note || 'sin cupo'})`).join('; ')}`, 'change_not_viable');
  return ctx.db.tx(() => {
    const touched = [];
    for (const r of after.lines.filter((x) => x.es_id)) {
      if (!r.changed) continue;
      const es = getES(ctx, r.es_id);
      if (!['requested', 'pending_availability', 'available', 'held', 'confirmed', 'rejected'].includes(es.status)) continue;
      const prov = es.provider_id ? byId(ctx, 'providers', es.provider_id) : null;
      const next = { ...es, pax: r.new.pax, date: r.new.date, start_time: r.new.start_time };
      let upd = { pax: r.new.pax, date: r.new.date, start_time: r.new.start_time, price_cents: r.new.price, cost_cents: r.new.cost, list_price_cents: r.new.list ?? r.new.price };
      const hasAlloc = !!av.activeAllocation(ctx, es.id);
      if (prov?.availability_mode === 'managed' && (hasAlloc || es.status === 'confirmed' || es.status === 'held')) {
        const kind = es.status === 'confirmed' ? 'confirmed' : 'hold';
        av.hold(ctx, next, { kind });                           // revalida capacidad de forma atómica: si falla, se revierte TODO el cambio
      }
      // Proveedor bajo solicitud / disponibilidad compartida: hay que volver a pedir confirmación
      const needsReconfirm = es.provider_id && (prov.availability_mode === 'on_request' || av.slotInfo(ctx, next, es.id).needs_provider_confirmation)
        && ['confirmed', 'available', 'pending_availability'].includes(es.status);
      ctx.db.update('event_services', es.id, ctx.cid, upd);
      if (needsReconfirm) {
        ctx.db.update('event_services', es.id, ctx.cid, { status: 'requested', reconfirm: 1, provider_confirmed: 0 });
        touched.push(es.id);
      }
      audit(ctx, 'event_service', es.id, 'modificado_por_cambio', { de: r.old, a: r.new });
    }
    for (const a of after.add || []) {
      const l = a.line;
      ctx.db.insert('event_services', { company_id: ctx.cid, event_id: ev.id, service_id: l.service_id, provider_id: l.provider_id, name: l.description, date: after.date,
        start_time: l.start_time || after.start_time, pax: l.pax, qty: l.qty, list_price_cents: l.total_price_cents, price_cents: a.price, cost_cents: l.total_cost_cents,
        tax_bp: l.tax_bp, cost_tax_bp: l.cost_tax_bp, mandatory: 1, status: 'requested', terms: l.snapshot, created_at: nowIso() });
    }
    ctx.db.update('events', ev.id, ctx.cid, { pax: after.pax, date: after.date, start_time: after.start_time ?? ev.start_time });
    ctx.db.update('event_changes', ch.id, ctx.cid, { status: 'accepted', accepted_by: by_name || ctx.actor, accepted_at: nowIso(), accepted_via: via, note: note ?? ch.note, token_revoked_at: nowIso() });
    audit(ctx, 'event', ev.id, 'cambio_aceptado', { via, por: by_name || ctx.actor, pax: after.pax, date: after.date, delta: ch.price_delta_cents });
    recomputeEvent(ctx, ev.id);
    for (const id of touched) { try { sendRequest(ctx, id, { resend: true }); } catch (e) { audit(ctx, 'event_service', id, 'reconfirmacion_no_enviada', { error: e.message }); } }
    return { event: byId(ctx, 'events', ev.id), reconfirm_services: touched };
  });
}

export function rejectChange(ctx, changeId, note) {
  const ch = byId(ctx, 'event_changes', changeId);
  if (ch.status !== 'pending_acceptance') throw conflict('El cambio ya no está pendiente', 'bad_state');
  ctx.db.update('event_changes', ch.id, ctx.cid, { status: 'rejected', note, accepted_at: nowIso(), accepted_by: ctx.actor, token_revoked_at: nowIso() });
  audit(ctx, 'event', ch.event_id, 'cambio_rechazado', { note });
}

// ---------------------------------------------------------------- caducidad de bloqueos (tarea periódica; también invocable en tests)
export function expireHolds(db) {
  const rows = db.all(`SELECT * FROM allocations WHERE kind='hold' AND released_at IS NULL AND expires_at<=?`, nowIso());
  for (const a of rows) {
    const ctx = { db, cid: a.company_id, user: null, actor: 'sistema' };
    db.tx(() => {
      db.update('allocations', a.id, a.company_id, { released_at: nowIso(), release_reason: 'expirado' });
      const es = db.get('SELECT * FROM event_services WHERE id=? AND company_id=?', a.event_service_id, a.company_id);
      if (!es) return;
      if (es.status === 'held') setStatus(ctx, es, 'requested');
      addTask(ctx, { title: `Bloqueo caducado: ${es.name} (${es.date}). Volver a bloquear o solicitar`, event_id: es.event_id, kind: 'incident', auto_key: `hold_expired:${a.id}` });
      audit(ctx, 'allocation', a.id, 'bloqueo_caducado', { servicio: es.id });
      recomputeEvent(ctx, es.event_id);
    });
  }
  return rows.length;
}
