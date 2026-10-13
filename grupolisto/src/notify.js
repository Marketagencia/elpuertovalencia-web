// Construcción de variables y envío de avisos a clientes y proveedores (siempre vía cola de comunicaciones).
import { queue } from './comms.js';
import { eur } from './util.js';

export const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
const first = (s) => String(s || '').trim().split(/\s+/)[0];

export function eventVars(ctx, ev, extra = {}) {
  const client = ctx.db.get('SELECT * FROM clients WHERE id=? AND company_id=?', ev.client_id, ctx.cid);
  const brand = ev.brand_id && ctx.db.get('SELECT * FROM brands WHERE id=? AND company_id=?', ev.brand_id, ctx.cid);
  return { nombre: first(client?.name), evento: ev.name, fecha: fmtDate(ev.date), hora: ev.start_time || '', asistentes: ev.pax,
    importe: '', saldo: '', enlace: '', marca: brand?.name || 'GrupoListo', vence: '', codigo: ev.code, ...extra };
}
export function notifyClient(ctx, ev, key, extra = {}, { dedupe_key, automatic = false, channel = 'auto', ignore_window } = {}) {
  return queue(ctx, { channel, client_id: ev.client_id, event_id: ev.id, brand_id: ev.brand_id, template_key: key,
    vars: eventVars(ctx, ev, extra), dedupe_key, automatic, ignore_window });
}
export function providerVars(ctx, es, extra = {}) {
  const ev = ctx.db.get('SELECT * FROM events WHERE id=? AND company_id=?', es.event_id, ctx.cid);
  const prov = ctx.db.get('SELECT * FROM providers WHERE id=? AND company_id=?', es.provider_id, ctx.cid);
  const brand = ev?.brand_id && ctx.db.get('SELECT * FROM brands WHERE id=? AND company_id=?', ev.brand_id, ctx.cid);
  return { nombre: prov?.contact_name || prov?.name || '', evento: ev?.name || '', servicio: es.name, fecha: fmtDate(es.date), hora: es.start_time || '',
    asistentes: es.pax, importe: eur(es.cost_cents), saldo: '', enlace: '', marca: brand?.name || 'GrupoListo', vence: '', codigo: ev?.code || '', ...extra };
}
export function notifyProvider(ctx, es, key, extra = {}, { dedupe_key, automatic = false, channel = 'email', ignore_window } = {}) {
  const ev = ctx.db.get('SELECT brand_id FROM events WHERE id=? AND company_id=?', es.event_id, ctx.cid);
  return queue(ctx, { channel, provider_id: es.provider_id, event_id: es.event_id, event_service_id: es.id, brand_id: ev?.brand_id,
    template_key: key, vars: providerVars(ctx, es, extra), dedupe_key, automatic, ignore_window });
}
