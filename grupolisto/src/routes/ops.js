import { audit, byId, parseRow, tokenOf } from '../core.js';
import { badRequest, conflict, HttpError, nowIso, parseJson, today, eur, sha256 as hash } from '../util.js';
import { pick, str, need, num } from './util.js';
import * as bk from '../bookings.js';
import * as av from '../availability.js';
import { payLink } from '../payments.js';
import { saveDocument, readDocument } from '../files.js';
import { netMargin } from '../pricing.js';
import { can } from '../perm.js';
import { sysctx } from '../core.js';
import { notifyClient } from '../notify.js';
import { BASE_URL } from '../config.js';

const esFull = (ctx, es, user) => {
  const p = es.provider_id ? ctx.db.get('SELECT name,availability_mode FROM providers WHERE id=? AND company_id=?', es.provider_id, ctx.cid) : null;
  const req = ctx.db.get(`SELECT * FROM provider_requests WHERE company_id=? AND event_service_id=? ORDER BY id DESC LIMIT 1`, ctx.cid, es.id);
  const hold = av.activeAllocation(ctx, es.id);
  const showCost = can(user, 'margins:r') || can(user, 'ops:w') || can(user, 'payments_out:r');
  const out = { ...es, status_label: bk.ES_STATUS[es.status], provider_name: p?.name || null, provider_mode: p?.availability_mode || null,
    hold: hold && { kind: hold.kind, expires_at: hold.expires_at }, request: req && { id: req.id, status: req.status, response: req.response, sent_at: req.sent_at, deadline_at: req.deadline_at,
      response_cost_cents: req.response_cost_cents, response_notes: req.response_notes, requirements: req.requirements, alt_date: req.alt_date, alt_time: req.alt_time, alt_status: req.alt_status,
      review_status: req.review_status, late: req.late } };
  if (!showCost) { delete out.cost_cents; delete out.cancel_cost_penalty_cents; if (out.request) delete out.request.response_cost_cents; }
  else out.margin_net_cents = netMargin(es.status === 'cancelled' ? es.cancel_penalty_cents : es.price_cents, es.tax_bp, es.status === 'cancelled' ? es.cancel_cost_penalty_cents : es.cost_cents, es.cost_tax_bp);
  return out;
};

export default function (r, db) {
  // ------------------------------------------------------------------ eventos
  r.get('/api/events', 'events:r', (c) => {
    const a = [c.ctx.cid]; let w = '';
    const q = c.query;
    if (q.status) { w += ' AND e.status=?'; a.push(q.status); }
    if (q.booking_status) { w += ' AND e.booking_status=?'; a.push(q.booking_status); }
    if (q.from) { w += ' AND e.date>=?'; a.push(q.from); } if (q.to) { w += ' AND e.date<=?'; a.push(q.to); }
    if (q.q) { w += ' AND (lower(e.name) LIKE ? OR lower(e.code) LIKE ? OR lower(cl.name) LIKE ?)'; const s = `%${q.q.toLowerCase()}%`; a.push(s, s, s); }
    return db.all(`SELECT e.id,e.code,e.name,e.date,e.pax,e.status,e.booking_status,e.payment_status,e.total_due_cents, cl.name client_name,
      (SELECT COUNT(*) FROM event_services s WHERE s.event_id=e.id AND s.status NOT IN ('cancelled')) services,
      (SELECT COUNT(*) FROM event_services s WHERE s.event_id=e.id AND s.status IN ('confirmed','done')) confirmed
      FROM events e JOIN clients cl ON cl.id=e.client_id WHERE e.company_id=? ${w} ORDER BY e.date DESC, e.id DESC LIMIT 300`, ...a);
  });
  r.get('/api/events/:id', 'events:r', (c) => {
    const ev = byId(c.ctx, 'events', c.params.id), cid = c.ctx.cid, ctx = c.ctx;
    const svcs = db.all('SELECT * FROM event_services WHERE company_id=? AND event_id=? ORDER BY date, id', cid, ev.id).map(parseRow).map((s) => esFull(ctx, s, c.user));
    const pt = bk.paymentTotals(ctx, ev.id);
    const finance = can(c.user, 'payments_in:r');
    const alerts = [];
    for (const s of svcs) {
      if (s.status === 'rejected') alerts.push(`«${s.name}» rechazado por el proveedor: busca alternativa`);
      if (s.needs_review) alerts.push(`«${s.name}»: respuesta del proveedor pendiente de revisión`);
      if (s.reconfirm && s.status !== 'confirmed') alerts.push(`«${s.name}»: requiere nueva confirmación por el cambio`);
      if (s.hold?.kind === 'hold') alerts.push(`«${s.name}»: bloqueo provisional activo (caduca y libera el cupo si no se confirma a tiempo)`);
    }
    const mand = svcs.filter((s) => s.mandatory && s.status !== 'cancelled' && !['confirmed', 'done'].includes(s.status));
    const reason = ev.booking_status === 'confirmed' ? 'Todos los servicios obligatorios están confirmados y la señal está cobrada'
      : mand.length ? `Faltan por confirmar ${mand.length} servicio(s) obligatorio(s)` : 'Servicios confirmados; falta cobrar la señal';
    return { event: ev, booking_reason: reason, client: byId(ctx, 'clients', ev.client_id), services: svcs, alerts,
      finance: { total_cents: ev.total_due_cents, paid_cents: pt.net_paid, refunded_cents: pt.refunded, balance_cents: ev.total_due_cents - pt.net_paid, deposit_required_cents: ev.deposit_required_cents, includes_tax: true },
      payments_in: finance ? db.all('SELECT * FROM payments_in WHERE company_id=? AND event_id=? ORDER BY id DESC', cid, ev.id).map((p) => ({ ...p, link: payLink(p), token_hash: undefined, token_nonce: undefined })) : [],
      payments_out: can(c.user, 'payments_out:r') ? db.all(`SELECT po.*, p.name provider_name, es.name service_name FROM payments_out po JOIN providers p ON p.id=po.provider_id JOIN event_services es ON es.id=po.event_service_id WHERE po.company_id=? AND po.event_id=? ORDER BY po.due_date`, cid, ev.id) : [],
      margin: can(c.user, 'margins:r') ? (() => { let price = 0, cost = 0; for (const s of svcs.filter((x) => x.status !== 'cancelled')) { price += s.price_cents; } const live = svcs; const net = live.reduce((a, s) => a + (s.status === 'cancelled' ? 0 : netMargin(s.price_cents, s.tax_bp, s.cost_cents, s.cost_tax_bp)), 0);
        return { margin_net_cents: net, price_gross_cents: price, note: 'Margen sobre base imponible (sin IVA)' }; })() : null,
      changes: db.all('SELECT id,kind,price_delta_cents,status,proposed_at,accepted_at,accepted_via,accepted_by,note,before_json,after_json FROM event_changes WHERE company_id=? AND event_id=? ORDER BY id DESC', cid, ev.id).map(parseRow),
      tasks: db.all('SELECT * FROM tasks WHERE company_id=? AND event_id=? ORDER BY done_at IS NOT NULL, due_at', cid, ev.id),
      messages: db.all('SELECT id,channel,direction,subject,status,error,to_addr,created_at,client_id,provider_id FROM messages WHERE company_id=? AND event_id=? ORDER BY id DESC LIMIT 60', cid, ev.id),
      documents: db.all('SELECT id,name,kind,mime,size,visibility,created_at,entity FROM documents WHERE company_id=? AND ((entity=\'event\' AND entity_id=?) OR (entity=\'event_service\' AND entity_id IN (SELECT id FROM event_services WHERE event_id=? AND company_id=?)))', cid, ev.id, ev.id, cid),
      history: db.all(`SELECT * FROM audit_log WHERE company_id=? AND ((entity='event' AND entity_id=?) OR (entity='event_service' AND entity_id IN (SELECT id FROM event_services WHERE event_id=?))) ORDER BY id DESC LIMIT 120`, cid, ev.id, ev.id).map((x) => ({ ...x, detail: parseJson(x.detail, null) })) };
  });
  r.put('/api/events/:id', 'events:w', (c) => {
    const ev = byId(c.ctx, 'events', c.params.id);
    const o = pick(c.body, ['name', 'notes', 'owner_user_id']);
    if (c.body.final_pax_confirmed !== undefined) o.final_pax_confirmed = c.body.final_pax_confirmed ? 1 : 0;
    db.update('events', ev.id, c.ctx.cid, o); audit(c.ctx, 'event', ev.id, 'actualizado', o); return byId(c.ctx, 'events', ev.id);
  });
  r.post('/api/events/:id/cancel', 'events:w', (c) => {
    const ev = byId(c.ctx, 'events', c.params.id);
    if (ev.status !== 'active') throw conflict('El evento no está activo', 'bad_state');
    const by = ['client', 'agency', 'provider'].includes(c.body.by) ? c.body.by : 'agency';
    const out = db.tx(() => {
      let pen = 0;
      for (const s of db.all(`SELECT id FROM event_services WHERE company_id=? AND event_id=? AND status NOT IN ('cancelled','done')`, c.ctx.cid, ev.id)) pen += bk.cancelService(c.ctx, s.id, { by, reason: c.body.reason, waive_penalty: !!c.body.waive_penalty }).penalty_cents;
      return pen;
    });
    const e2 = byId(c.ctx, 'events', ev.id), pt = bk.paymentTotals(c.ctx, ev.id);
    audit(c.ctx, 'event', ev.id, 'cancelado', { by, reason: c.body.reason });
    return { event: e2, penalty_cents: out, refund_suggested_cents: Math.max(pt.net_paid - e2.total_due_cents, 0) };
  });

  // ------------------------------------------------------------------ servicios del evento
  r.post('/api/event-services/:id/start', 'events:w', (c) => bk.startService(c.ctx, c.params.id, { override: !!c.body.override }));
  r.post('/api/event-services/:id/resend', 'events:w', (c) => { const es = byId(c.ctx, 'event_services', c.params.id); if (!['pending_availability', 'requested'].includes(es.status)) throw conflict('Solo se reenvía una solicitud pendiente', 'bad_state'); return bk.sendRequest(c.ctx, es.id, { resend: true }); });
  r.post('/api/event-services/:id/confirm', 'events:w', (c) => bk.confirmService(c.ctx, c.params.id));
  r.post('/api/event-services/:id/cancel', 'events:w', (c) => bk.cancelService(c.ctx, c.params.id, { by: ['client', 'agency', 'provider'].includes(c.body.by) ? c.body.by : 'agency', reason: c.body.reason, waive_penalty: !!c.body.waive_penalty }));
  r.post('/api/event-services/:id/done', 'ops:w', (c) => bk.markDone(c.ctx, c.params.id, { override: !!c.body.override }));
  r.post('/api/event-services/:id/reassign', 'events:w', (c) => bk.reassignProvider(c.ctx, c.params.id, c.body.provider_id));
  r.post('/api/event-services/:id/review', 'events:w', (c) => { const es = byId(c.ctx, 'event_services', c.params.id); const req = db.get(`SELECT id FROM provider_requests WHERE company_id=? AND event_service_id=? ORDER BY id DESC LIMIT 1`, c.ctx.cid, es.id); if (!req) throw badRequest('Sin respuesta que revisar'); return bk.reviewResponse(c.ctx, req.id, !!c.body.accept); });
  r.get('/api/event-services/:id/alternatives', 'events:r', (c) => av.alternatives(c.ctx, byId(c.ctx, 'event_services', c.params.id)));
  r.put('/api/event-services/:id', 'events:w', (c) => { byId(c.ctx, 'event_services', c.params.id); db.update('event_services', Number(c.params.id), c.ctx.cid, pick(c.body, ['notes'])); return { ok: true }; });

  // ------------------------------------------------------------------ cambios de fecha / asistentes / servicios
  r.post('/api/events/:id/changes', 'events:w', (c) => {
    const o = bk.proposeChange(c.ctx, c.params.id, { pax: c.body.pax, date: c.body.date, start_time: c.body.start_time, add: c.body.add || [], note: c.body.note });
    if (c.body.notify_client) {
      const ev = byId(c.ctx, 'events', c.params.id);
      notifyClient(c.ctx, { ...ev, pax: c.body.pax ?? ev.pax, date: c.body.date ?? ev.date }, 'change_proposal', { importe: eur(o.price_delta_cents), enlace: o.link }, { ignore_window: true });
    }
    return { change_id: o.change.id, link: o.link, can_apply: o.can_apply, report: o.report, price_delta_cents: o.price_delta_cents };
  });
  r.post('/api/changes/:id/accept', 'events:w', (c) => bk.acceptChange(c.ctx, c.params.id, { via: 'staff', by_name: c.body.by_name ? `${c.body.by_name} (registrado por ${c.user.name})` : undefined, note: c.body.note }));
  r.post('/api/changes/:id/reject', 'events:w', (c) => { bk.rejectChange(c.ctx, c.params.id, c.body.note); });

  // ------------------------------------------------------------------ calendario
  r.get('/api/calendar', 'calendar:r', (c) => {
    const q = c.query, a = [c.ctx.cid]; let w = '';
    const from = q.from || today(), to = q.to || from;
    w += ' AND es.date>=? AND es.date<=?'; a.push(from, to);
    if (q.provider_id) { w += ' AND es.provider_id=?'; a.push(Number(q.provider_id)); }
    if (q.status) { w += ' AND es.status=?'; a.push(q.status); }
    return db.all(`SELECT es.id, es.event_id, es.name, es.date, es.start_time, es.pax, es.status, e.code, e.name event_name, p.name provider_name, e.booking_status
      FROM event_services es JOIN events e ON e.id=es.event_id LEFT JOIN providers p ON p.id=es.provider_id
      WHERE es.company_id=? AND e.status<>'cancelled' AND es.status<>'cancelled' ${w} ORDER BY es.date, es.start_time`, ...a);
  });

  // ------------------------------------------------------------------ documentos
  const docPerm = (c) => { if (!(can(c.user, 'documents:w') || can(c.user, 'events:w'))) throw new HttpError(403, 'No tienes permiso para esta acción', 'forbidden'); };
  const ENT = { event: 'events', event_service: 'event_services', payment_in: 'payments_in', payment_out: 'payments_out', provider: 'providers' };
  r.post('/api/documents', 'staff', (c) => {
    docPerm(c);
    const b = c.body; if (!ENT[b.entity]) throw badRequest('Entidad no válida');
    byId(c.ctx, ENT[b.entity], b.entity_id);
    return saveDocument(c.ctx, { entity: b.entity, entity_id: Number(b.entity_id), name: b.name, mime: b.mime, base64: b.data_base64, kind: b.kind, visibility: ['internal', 'provider', 'client'].includes(b.visibility) ? b.visibility : 'internal', uploaded_by: `${c.user.name}` });
  });
  r.get('/api/documents', 'staff', (c) => db.all('SELECT id,entity,entity_id,name,kind,mime,size,visibility,uploaded_by,created_at FROM documents WHERE company_id=? AND entity=? AND entity_id=?', c.ctx.cid, String(c.query.entity), Number(c.query.entity_id)));
  r.get('/api/documents/:id/download', 'staff', (c) => {
    const d = byId(c.ctx, 'documents', c.params.id);
    audit(c.ctx, 'document', d.id, 'descargado');
    return { __raw: readDocument(d), type: d.mime, headers: { 'Content-Disposition': `attachment; filename="${d.name.replace(/"/g, '')}"` } };
  });

  // ------------------------------------------------------------------ solicitudes a proveedores (vista interna)
  r.get('/api/provider-requests', 'events:r', (c) => db.all(`SELECT pr.id, pr.status, pr.response, pr.sent_at, pr.deadline_at, pr.responded_at, pr.late, pr.alt_status, pr.review_status, p.name provider_name, es.name service_name, es.date, es.id event_service_id, e.code, e.id event_id
    FROM provider_requests pr JOIN providers p ON p.id=pr.provider_id JOIN event_services es ON es.id=pr.event_service_id JOIN events e ON e.id=es.event_id
    WHERE pr.company_id=? ${c.query.status ? 'AND pr.status=?' : ''} ORDER BY pr.id DESC LIMIT 200`, ...[c.ctx.cid, ...(c.query.status ? [c.query.status] : [])]));

  // ------------------------------------------------------------------ enlace privado del proveedor (solo SU solicitud)
  const findReq = (c) => {
    if (!c.limit(`pr:${c.ip}`, 60, 60000)) throw new HttpError(429, 'Demasiadas peticiones');
    const row = db.get('SELECT * FROM provider_requests WHERE token_hash=?', hash(c.params.token));
    if (!row || row.token_revoked_at) throw new HttpError(404, 'Este enlace no es válido o ha sido sustituido por uno más reciente', 'bad_link');
    const ctx = sysctx(db, row.company_id); ctx.actor = 'proveedor (enlace)';
    return { ctx, req: parseRow(row) };
  };
  r.get('/api/public/provider-request/:token', null, (c) => {
    const { ctx, req } = findReq(c);
    const brand = db.get(`SELECT b.name FROM events e JOIN event_services es ON es.event_id=e.id LEFT JOIN brands b ON b.id=e.brand_id WHERE es.id=? AND es.company_id=?`, req.event_service_id, ctx.cid);
    const prov = byId(ctx, 'providers', req.provider_id);
    return { status: req.status, response: req.response, provider: prov.name, brand: brand?.name, deadline_at: req.deadline_at, payload: req.payload, responded_at: req.responded_at, alt_status: req.alt_status };
  });
  r.post('/api/public/provider-request/:token', null, (c) => {
    const { ctx, req } = findReq(c);
    const b = c.body;
    const out = bk.respondRequest(ctx, req, { response: b.response, cost_cents: b.cost_eur !== undefined && b.cost_eur !== '' ? Math.round(Number(String(b.cost_eur).replace(',', '.')) * 100) : b.cost_cents,
      notes: str(b.notes, 1500), requirements: str(b.requirements, 1500), alt_date: b.alt_date, alt_time: b.alt_time });
    if (b.doc?.data_base64) saveDocument(ctx, { entity: 'event_service', entity_id: req.event_service_id, name: b.doc.name, mime: b.doc.mime, base64: b.doc.data_base64, kind: 'proveedor', visibility: 'provider', uploaded_by: 'proveedor' });
    return { ok: true, status: out.status };
  });

  // ------------------------------------------------------------------ enlace privado del cliente para aceptar un cambio
  const findChange = (c) => {
    if (!c.limit(`ch:${c.ip}`, 60, 60000)) throw new HttpError(429, 'Demasiadas peticiones');
    const row = db.get('SELECT * FROM event_changes WHERE token_hash=?', hash(c.params.token));
    if (!row || row.token_revoked_at) throw new HttpError(404, 'Este enlace no es válido o ya fue utilizado', 'bad_link');
    const ctx = sysctx(db, row.company_id); ctx.actor = 'cliente (enlace)';
    return { ctx, ch: parseRow(row) };
  };
  r.get('/api/public/change/:token', null, (c) => {
    const { ctx, ch } = findChange(c); const ev = byId(ctx, 'events', ch.event_id);
    return { status: ch.status, event: { name: ev.name, code: ev.code }, before: ch.before_json, after: { pax: ch.after_json.pax, date: ch.after_json.date },
      price_delta_cents: ch.price_delta_cents, lines: (ch.after_json.lines || []).filter((l) => l.changed).map((l) => ({ name: l.name, old: l.old && { pax: l.old.pax, date: l.old.date, price: l.old.price }, new: { pax: l.new.pax, date: l.new.date, price: l.new.price } })),
      note: 'Aceptar este cambio implica nueva confirmación de los servicios afectados por parte de los proveedores.' };
  });
  r.post('/api/public/change/:token/accept', null, (c) => {
    const { ctx, ch } = findChange(c); need(c.body.name, 'Indica tu nombre');
    return bk.acceptChange(ctx, ch.id, { via: 'client_link', by_name: String(c.body.name).trim(), note: `IP ${c.ip}` });
  });
  r.post('/api/public/change/:token/reject', null, (c) => { const { ctx, ch } = findChange(c); bk.rejectChange(ctx, ch.id, c.body.note || 'Rechazado por el cliente'); return { ok: true }; });
}
