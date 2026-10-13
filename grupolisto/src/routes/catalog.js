import { audit, byId, parseRow } from '../core.js';
import { badRequest, conflict, nowIso, parseJson, isDate, isTime } from '../util.js';
import { pick, str, need, num, bool } from './util.js';
import { lineFromService, optionTotals } from '../pricing.js';
import { slotInfo, validateRule } from '../availability.js';

const CATS = ['actividad', 'restaurante', 'menu', 'alojamiento', 'transporte', 'espectaculo', 'extra'];
const TAXES = [0, 400, 1000, 2100];

function cleanTiers(t) {
  if (!Array.isArray(t)) throw badRequest('Tramos no válidos');
  const out = t.map((x) => ({ min: num(x.min, 'Mínimo del tramo', { min: 1, required: true }), max: x.max === '' || x.max == null ? null : num(x.max, 'Máximo del tramo', { min: 1 }),
    price_cents: num(x.price_cents, 'Precio del tramo', { required: true }), cost_cents: num(x.cost_cents, 'Coste del tramo', { required: true }), basis: x.basis === 'group' ? 'group' : 'person' }))
    .sort((a, b) => a.min - b.min);
  out.forEach((x, i) => { if (x.max != null && x.max < x.min) throw badRequest('Tramo con máximo menor que el mínimo'); if (i && (out[i - 1].max == null || out[i - 1].max >= x.min)) throw badRequest('Los tramos no pueden solaparse'); });
  return out;
}
const serviceFields = (b, existing = {}) => {
  const o = {};
  const f = { ...existing, ...b };
  if (b.name !== undefined || !existing.id) o.name = str(need(f.name, 'Nombre obligatorio'), 140);
  if (b.category !== undefined) { if (!CATS.includes(b.category)) throw badRequest('Categoría no válida'); o.category = b.category; }
  for (const k of ['description', 'location', 'payment_terms', 'cancel_terms', 'resources', 'seasons', 'restrictions']) if (b[k] !== undefined) o[k] = str(b[k], 3000);
  if (b.images !== undefined) { const im = (Array.isArray(b.images) ? b.images : String(b.images).split(/\s+/)).filter(Boolean); if (im.some((u) => !/^https:\/\//.test(u))) throw badRequest('Las imágenes deben ser URL https'); o.images = im; }
  if (b.price_model !== undefined) { if (!['per_person', 'per_group', 'per_unit', 'tiers'].includes(b.price_model)) throw badRequest('Modelo de precio no válido'); o.price_model = b.price_model; }
  const eu = (k, ke) => { if (b[ke] !== undefined && b[ke] !== '') o[k] = Math.round(Number(String(b[ke]).replace(',', '.')) * 100); else if (b[k] !== undefined) o[k] = num(b[k], k); };
  eu('price_cents', 'price_eur'); eu('cost_cents', 'cost_eur');
  for (const k of ['price_cents', 'cost_cents']) if (o[k] !== undefined && !(o[k] >= 0)) throw badRequest('Importe no válido');
  if (b.tiers !== undefined) o.tiers = cleanTiers(b.tiers);
  for (const k of ['tax_bp', 'cost_tax_bp']) if (b[k] !== undefined) { if (!TAXES.includes(Number(b[k]))) throw badRequest('Impuesto no válido (0, 4, 10 o 21 %)'); o[k] = Number(b[k]); }
  if (b.min_pax !== undefined) o.min_pax = num(b.min_pax, 'Capacidad mínima', { min: 1, max: 5000 }) ?? 1;
  if (b.max_pax !== undefined) o.max_pax = num(b.max_pax, 'Capacidad máxima', { min: 1, max: 5000 });
  if (o.max_pax != null && (o.min_pax ?? f.min_pax ?? 1) > o.max_pax) throw badRequest('La capacidad mínima supera la máxima');
  for (const k of ['duration_min', 'min_notice_days', 'confirm_deadline_days', 'cancel_free_days']) if (b[k] !== undefined) o[k] = num(b[k], k, { max: 100000 }) ?? 0;
  if (b.cancel_penalty_pct !== undefined) o.cancel_penalty_pct = num(b.cancel_penalty_pct, 'Penalización', { max: 100 }) ?? 0;
  if (b.share_contact !== undefined) o.share_contact = bool(b.share_contact);
  if (b.active !== undefined) o.active = bool(b.active);
  const model = o.price_model ?? f.price_model;
  if (model === 'tiers' && !(o.tiers ?? parseJson(f.tiers, [])).length) throw badRequest('Define al menos un tramo de precio');
  return o;
};
function syncProviders(ctx, serviceId, list) {
  if (!Array.isArray(list)) return;
  ctx.db.run('DELETE FROM service_providers WHERE company_id=? AND service_id=?', ctx.cid, serviceId);
  for (const p of list) {
    byId(ctx, 'providers', p.provider_id);
    const cost = p.cost_eur !== undefined && p.cost_eur !== '' ? Math.round(Number(String(p.cost_eur).replace(',', '.')) * 100) : (p.cost_cents ?? null);
    ctx.db.run('INSERT OR REPLACE INTO service_providers(service_id,provider_id,company_id,cost_cents) VALUES(?,?,?,?)', serviceId, Number(p.provider_id), ctx.cid, cost);
  }
}
const svcWithProviders = (ctx, s) => ({ ...parseRow(s), providers: ctx.db.all(`SELECT sp.provider_id, sp.cost_cents, p.name, p.availability_mode FROM service_providers sp JOIN providers p ON p.id=sp.provider_id WHERE sp.service_id=? AND sp.company_id=?`, s.id, ctx.cid) });

export function packTotals(ctx, pack, pax) {
  const items = ctx.db.all('SELECT * FROM pack_items WHERE pack_id=? AND company_id=?', pack.id, ctx.cid);
  const lines = [];
  for (const it of items) {
    const svc = byId(ctx, 'services', it.service_id);
    const sp = ctx.db.get('SELECT * FROM service_providers WHERE service_id=? AND company_id=? ORDER BY provider_id LIMIT 1', svc.id, ctx.cid);
    try { lines.push({ ...lineFromService(svc, { pax, qty: it.qty, costOverride: sp?.cost_cents, discountPct: pack.discount_pct, kind: 'pack_item', optional: it.optional, selected: !it.optional }), item_optional: !!it.optional }); } catch { /* sin tramo */ }
  }
  return { items: items.length, ...optionTotals(lines, 0) };
}

export default function (r, db) {
  // ------------------------------------------------------------------ servicios
  r.get('/api/services', 'catalog:r', (c) => {
    const q = `%${String(c.query.q || '').toLowerCase()}%`;
    return db.all(`SELECT * FROM services WHERE company_id=? AND (lower(name) LIKE ? OR lower(COALESCE(description,'')) LIKE ?) ${c.query.category ? 'AND category=?' : ''} ORDER BY active DESC, name`,
      ...[c.ctx.cid, q, q, ...(c.query.category ? [c.query.category] : [])]).map((s) => svcWithProviders(c.ctx, s));
  });
  r.get('/api/services/:id', 'catalog:r', (c) => ({ service: svcWithProviders(c.ctx, byId(c.ctx, 'services', c.params.id)),
    rules: db.all(`SELECT ar.*, p.name provider_name FROM availability_rules ar JOIN providers p ON p.id=ar.provider_id WHERE ar.company_id=? AND ar.service_id=?`, c.ctx.cid, Number(c.params.id)) }));
  r.post('/api/services', 'catalog:w', (c) => {
    const o = serviceFields(c.body);
    const id = db.tx(() => { const i = db.insert('services', { company_id: c.ctx.cid, ...o, created_at: nowIso() }); syncProviders(c.ctx, i, c.body.providers); return i; });
    audit(c.ctx, 'service', id, 'creado'); return svcWithProviders(c.ctx, byId(c.ctx, 'services', id));
  });
  r.put('/api/services/:id', 'catalog:w', (c) => {
    const s = byId(c.ctx, 'services', c.params.id);
    const o = serviceFields(c.body, s);
    db.tx(() => { db.update('services', s.id, c.ctx.cid, o); syncProviders(c.ctx, s.id, c.body.providers); });
    // Los cambios del catálogo NO alteran presupuestos ni reservas existentes: llevan su propia copia de precios y condiciones
    audit(c.ctx, 'service', s.id, 'actualizado', { campos: Object.keys(o) }); return svcWithProviders(c.ctx, byId(c.ctx, 'services', s.id));
  });

  // ------------------------------------------------------------------ packs
  const packOut = (ctx, p, pax = 10) => ({ ...p, items: ctx.db.all(`SELECT pi.*, s.name service_name FROM pack_items pi JOIN services s ON s.id=pi.service_id WHERE pi.pack_id=? AND pi.company_id=?`, p.id, ctx.cid), totals: packTotals(ctx, p, pax), pax_ref: pax });
  r.get('/api/packs', 'catalog:r', (c) => db.all('SELECT * FROM packs WHERE company_id=? ORDER BY active DESC, name', c.ctx.cid).map((p) => packOut(c.ctx, p, Number(c.query.pax) || 10)));
  const savePack = (c, id) => {
    const b = c.body;
    db.tx(() => {
      const f = { name: str(need(b.name, 'Nombre obligatorio'), 140), description: str(b.description, 2000), discount_pct: num(b.discount_pct, 'Descuento', { max: 90 }) ?? 0, active: b.active === undefined ? 1 : bool(b.active) };
      if (id) db.update('packs', id, c.ctx.cid, f); else id = db.insert('packs', { company_id: c.ctx.cid, ...f, created_at: nowIso() });
      if (Array.isArray(b.items)) {
        if (!b.items.length) throw badRequest('Un pack necesita al menos un servicio');
        const seen = new Set();
        db.run('DELETE FROM pack_items WHERE company_id=? AND pack_id=?', c.ctx.cid, id);
        for (const it of b.items) {
          byId(c.ctx, 'services', it.service_id);
          if (seen.has(Number(it.service_id))) throw badRequest('Un servicio no puede estar dos veces en el mismo pack'); seen.add(Number(it.service_id));
          db.insert('pack_items', { company_id: c.ctx.cid, pack_id: id, service_id: Number(it.service_id), qty: num(it.qty, 'Cantidad', { min: 1, max: 1000 }) ?? 1, optional: bool(it.optional) });
        }
      }
    });
    audit(c.ctx, 'pack', id, 'guardado'); return packOut(c.ctx, byId(c.ctx, 'packs', id), Number(c.query.pax) || 10);
  };
  r.post('/api/packs', 'catalog:w', (c) => savePack(c, null));
  r.put('/api/packs/:id', 'catalog:w', (c) => { byId(c.ctx, 'packs', c.params.id); return savePack(c, Number(c.params.id)); });

  // ------------------------------------------------------------------ proveedores
  const provCols = ['name', 'contact_name', 'email', 'phone', 'payment_terms', 'notes'];
  r.get('/api/providers', 'providers:r', (c) => db.all(`SELECT p.*, (SELECT COUNT(*) FROM service_providers sp WHERE sp.provider_id=p.id) services,
    (SELECT COUNT(*) FROM provider_requests pr WHERE pr.provider_id=p.id AND pr.status='sent') open_requests FROM providers p WHERE p.company_id=? ORDER BY active DESC, name`, c.ctx.cid));
  r.get('/api/providers/:id', 'providers:r', (c) => {
    const p = byId(c.ctx, 'providers', c.params.id), cid = c.ctx.cid;
    return { provider: p,
      services: db.all(`SELECT s.id, s.name, sp.cost_cents FROM service_providers sp JOIN services s ON s.id=sp.service_id WHERE sp.provider_id=? AND sp.company_id=?`, p.id, cid),
      rules: db.all(`SELECT ar.*, s.name service_name FROM availability_rules ar JOIN services s ON s.id=ar.service_id WHERE ar.company_id=? AND ar.provider_id=?`, cid, p.id),
      closures: db.all('SELECT * FROM availability_closures WHERE company_id=? AND provider_id=? ORDER BY date_from DESC', cid, p.id),
      users: db.all('SELECT id,name,email,active FROM users WHERE company_id=? AND provider_id=?', cid, p.id),
      pending: db.all(`SELECT es.id, es.name, es.date, es.status, e.code, e.id event_id FROM event_services es JOIN events e ON e.id=es.event_id WHERE es.company_id=? AND es.provider_id=? AND es.status NOT IN ('done','cancelled') ORDER BY es.date`, cid, p.id) };
  });
  const provFields = (b) => {
    const o = pick(b, provCols);
    if (b.availability_mode !== undefined) { if (!['managed', 'on_request'].includes(b.availability_mode)) throw badRequest('Modalidad no válida'); o.availability_mode = b.availability_mode; }
    if (b.external_sync !== undefined) o.external_sync = 0; // sin integración de calendario no se puede declarar sincronizado (Fase 3)
    if (b.cost_deposit_pct !== undefined) o.cost_deposit_pct = num(b.cost_deposit_pct, 'Anticipo', { max: 100 }) ?? 0;
    if (b.cost_due_days_before !== undefined) o.cost_due_days_before = num(b.cost_due_days_before, 'Vencimiento', { max: 365 }) ?? 7;
    if (b.active !== undefined) o.active = bool(b.active);
    if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw badRequest('Email no válido');
    return o;
  };
  r.post('/api/providers', 'providers:w', (c) => { need(c.body.name, 'Nombre obligatorio'); const id = db.insert('providers', { company_id: c.ctx.cid, ...provFields(c.body), created_at: nowIso() }); audit(c.ctx, 'provider', id, 'creado'); return byId(c.ctx, 'providers', id); });
  r.put('/api/providers/:id', 'providers:w', (c) => { byId(c.ctx, 'providers', c.params.id); db.update('providers', Number(c.params.id), c.ctx.cid, provFields(c.body)); audit(c.ctx, 'provider', Number(c.params.id), 'actualizado'); return byId(c.ctx, 'providers', c.params.id); });

  // ------------------------------------------------------------------ reglas de disponibilidad y cierres (staff; el proveedor tiene las suyas en /api/portal)
  r.get('/api/availability/slot', 'catalog:r', (c) => {
    const q = c.query;
    byId(c.ctx, 'providers', q.provider_id); byId(c.ctx, 'services', q.service_id);
    return slotInfo(c.ctx, { service_id: Number(q.service_id), provider_id: Number(q.provider_id), date: q.date, start_time: q.time });
  });
  r.post('/api/availability/rules', 'availability:w', (c) => saveRule(c.ctx, c.body));
  r.del('/api/availability/rules/:id', 'availability:w', (c) => { byId(c.ctx, 'availability_rules', c.params.id); db.run('DELETE FROM availability_rules WHERE id=? AND company_id=?', Number(c.params.id), c.ctx.cid); audit(c.ctx, 'availability_rule', Number(c.params.id), 'eliminada'); });
  r.post('/api/availability/closures', 'availability:w', (c) => saveClosure(c.ctx, c.body));
  r.del('/api/availability/closures/:id', 'availability:w', (c) => { byId(c.ctx, 'availability_closures', c.params.id); db.run('DELETE FROM availability_closures WHERE id=? AND company_id=?', Number(c.params.id), c.ctx.cid); });
}

export function saveRule(ctx, b) {
  byId(ctx, 'providers', b.provider_id); byId(ctx, 'services', b.service_id);
  if (!ctx.db.get('SELECT 1 x FROM service_providers WHERE service_id=? AND provider_id=? AND company_id=?', Number(b.service_id), Number(b.provider_id), ctx.cid)) throw badRequest('El proveedor no presta ese servicio');
  validateRule(b);
  const wd = (Array.isArray(b.weekdays) ? b.weekdays : String(b.weekdays ?? '0,1,2,3,4,5,6').split(',')).map(Number).filter((x) => x >= 0 && x <= 6);
  if (!wd.length) throw badRequest('Elige al menos un día de la semana');
  const id = ctx.db.insert('availability_rules', { company_id: ctx.cid, provider_id: Number(b.provider_id), service_id: Number(b.service_id), weekdays: wd.join(','), start_time: b.start_time,
    capacity_pax: Math.round(Number(b.capacity_pax)), shared: bool(b.shared), agency_quota_pax: b.shared ? Math.round(Number(b.agency_quota_pax)) : null, active: 1 });
  audit(ctx, 'availability_rule', id, 'creada', b); return ctx.db.get('SELECT * FROM availability_rules WHERE id=?', id);
}
export function saveClosure(ctx, b) {
  byId(ctx, 'providers', b.provider_id);
  if (b.service_id) byId(ctx, 'services', b.service_id);
  if (!isDate(b.date_from) || !isDate(b.date_to) || b.date_to < b.date_from) throw badRequest('Rango de fechas no válido');
  const id = ctx.db.insert('availability_closures', { company_id: ctx.cid, provider_id: Number(b.provider_id), service_id: b.service_id ? Number(b.service_id) : null,
    date_from: b.date_from, date_to: b.date_to, reason: str(b.reason, 200), created_by: ctx.user?.id ?? null, created_at: nowIso() });
  audit(ctx, 'availability_closure', id, 'creado', b); return ctx.db.get('SELECT * FROM availability_closures WHERE id=?', id);
}
