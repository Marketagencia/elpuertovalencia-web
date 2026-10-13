import { audit, byId, parseRow, tokenOf } from '../core.js';
import { badRequest, conflict, HttpError, nowIso, today } from '../util.js';
import { str, need } from './util.js';
import * as bk from '../bookings.js';
import { saveDocument } from '../files.js';
import { saveRule, saveClosure } from './catalog.js';
import { payLink } from '../payments.js';
import { quoteLink } from '../quotes.js';
import { paymentTotals } from '../bookings.js';

// Portal del proveedor: SOLO sus servicios, solicitudes, disponibilidad, reservas y liquidaciones. Nunca precios de venta ni datos de otros proveedores.
const prov = (c) => { if (!c.user.provider_id) throw new HttpError(403, 'Usuario sin proveedor asociado'); return c.user.provider_id; };
const cli = (c) => { if (!c.user.client_id) throw new HttpError(403, 'Usuario sin cliente asociado'); return c.user.client_id; };

export default function (r, db) {
  r.get('/api/portal/provider/home', 'portal:provider', (c) => {
    const pid = prov(c), cid = c.ctx.cid;
    const provider = db.get('SELECT id,name,availability_mode,contact_name,email,phone FROM providers WHERE id=? AND company_id=?', pid, cid);
    const requests = db.all(`SELECT pr.id, pr.status, pr.response, pr.payload, pr.deadline_at, pr.sent_at, pr.responded_at, pr.alt_status, es.id event_service_id, es.status service_status
      FROM provider_requests pr JOIN event_services es ON es.id=pr.event_service_id WHERE pr.company_id=? AND pr.provider_id=? ORDER BY (pr.status='sent') DESC, pr.id DESC LIMIT 100`, cid, pid).map(parseRow);
    const reservations = db.all(`SELECT es.id, es.name, es.date, es.start_time, es.pax, es.status, es.cost_cents, es.terms, e.code, e.id event_id, es.service_id FROM event_services es JOIN events e ON e.id=es.event_id
      WHERE es.company_id=? AND es.provider_id=? AND es.status IN ('available','held','confirmed','done') ORDER BY es.date DESC LIMIT 200`, cid, pid).map(parseRow).map((x) => {
      const share = x.terms?.share_contact && x.status === 'confirmed';
      const ev = share ? db.get('SELECT c.name, c.phone FROM events e JOIN clients c ON c.id=e.client_id WHERE e.id=? AND e.company_id=?', x.event_id, cid) : null;
      return { id: x.id, name: x.name, date: x.date, start_time: x.start_time, pax: x.pax, status: x.status, cost_cents: x.cost_cents, code: x.code, contact: ev ? { name: ev.name.split(' ')[0], phone: ev.phone } : null };
    });
    return { provider, requests, reservations };
  });
  r.post('/api/portal/provider/requests/:id/respond', 'portal:provider', (c) => {
    const row = byId(c.ctx, 'provider_requests', c.params.id);
    if (row.provider_id !== prov(c)) throw new HttpError(404, 'No encontrado', 'not_found');
    const b = c.body;
    const out = bk.respondRequest(c.ctx, row, { response: b.response, cost_cents: b.cost_eur !== undefined && b.cost_eur !== '' ? Math.round(Number(String(b.cost_eur).replace(',', '.')) * 100) : undefined, notes: str(b.notes, 1500),
      requirements: str(b.requirements, 1500), alt_date: b.alt_date, alt_time: b.alt_time });
    if (b.doc?.data_base64) saveDocument(c.ctx, { entity: 'event_service', entity_id: row.event_service_id, name: b.doc.name, mime: b.doc.mime, base64: b.doc.data_base64, kind: 'proveedor', visibility: 'provider', uploaded_by: c.user.name });
    return { ok: true, status: out.status };
  });
  r.get('/api/portal/provider/availability', 'portal:provider', (c) => {
    const pid = prov(c), cid = c.ctx.cid;
    return { services: db.all(`SELECT s.id, s.name, s.min_pax, s.max_pax FROM service_providers sp JOIN services s ON s.id=sp.service_id WHERE sp.provider_id=? AND sp.company_id=?`, pid, cid),
      rules: db.all(`SELECT ar.*, s.name service_name FROM availability_rules ar JOIN services s ON s.id=ar.service_id WHERE ar.company_id=? AND ar.provider_id=?`, cid, pid),
      closures: db.all('SELECT * FROM availability_closures WHERE company_id=? AND provider_id=? ORDER BY date_from DESC', cid, pid) };
  });
  r.post('/api/portal/provider/rules', 'portal:provider', (c) => saveRule(c.ctx, { ...c.body, provider_id: prov(c) }));   // provider_id forzado: no puede tocar el de otro
  r.del('/api/portal/provider/rules/:id', 'portal:provider', (c) => { const x = byId(c.ctx, 'availability_rules', c.params.id); if (x.provider_id !== prov(c)) throw new HttpError(404, 'No encontrado'); db.run('DELETE FROM availability_rules WHERE id=? AND company_id=?', x.id, c.ctx.cid); audit(c.ctx, 'availability_rule', x.id, 'eliminada_por_proveedor'); });
  r.post('/api/portal/provider/closures', 'portal:provider', (c) => saveClosure(c.ctx, { ...c.body, provider_id: prov(c) }));
  r.del('/api/portal/provider/closures/:id', 'portal:provider', (c) => { const x = byId(c.ctx, 'availability_closures', c.params.id); if (x.provider_id !== prov(c)) throw new HttpError(404, 'No encontrado'); db.run('DELETE FROM availability_closures WHERE id=? AND company_id=?', x.id, c.ctx.cid); });
  r.get('/api/portal/provider/settlements', 'portal:provider', (c) => db.all(`SELECT po.id, po.kind, po.amount_cents, po.due_date, po.status, po.paid_at, po.invoice_ref, po.reference, es.name service_name, es.date service_date, e.code event_code
    FROM payments_out po JOIN event_services es ON es.id=po.event_service_id JOIN events e ON e.id=po.event_id WHERE po.company_id=? AND po.provider_id=? AND po.status<>'cancelled' ORDER BY es.date DESC`, c.ctx.cid, prov(c)));
  r.post('/api/portal/provider/payments/:id/invoice', 'portal:provider', (c) => {
    const po = byId(c.ctx, 'payments_out', c.params.id); if (po.provider_id !== prov(c)) throw new HttpError(404, 'No encontrado');
    need(c.body.invoice_ref, 'Indica el número de factura');
    let docId = null; if (c.body.doc?.data_base64) docId = saveDocument(c.ctx, { entity: 'payment_out', entity_id: po.id, name: c.body.doc.name, mime: c.body.doc.mime, base64: c.body.doc.data_base64, kind: 'factura_proveedor', visibility: 'provider', uploaded_by: c.user.name }).id;
    db.update('payments_out', po.id, c.ctx.cid, { invoice_ref: str(c.body.invoice_ref, 100), invoice_doc_id: docId ?? po.invoice_doc_id }); audit(c.ctx, 'payment_out', po.id, 'factura_aportada'); return { ok: true };
  });

  // ---------------------------------------------------------------- portal del cliente (usuario con login): su propuesta, reserva, pagos y documentación
  r.get('/api/portal/client/home', 'portal:client', (c) => {
    const clid = cli(c), cid = c.ctx.cid;
    const quotes = db.all(`SELECT * FROM quotes WHERE company_id=? AND client_id=? AND status<>'draft' AND status<>'superseded' ORDER BY id DESC`, cid, clid).map((q) => ({ number: q.number, version: q.version, title: q.title, status: q.status, valid_until: q.valid_until, link: quoteLink(q) }));
    const events = db.all('SELECT * FROM events WHERE company_id=? AND client_id=? ORDER BY date DESC', cid, clid).map((e) => {
      const pt = paymentTotals(c.ctx, e.id);
      return { code: e.code, name: e.name, date: e.date, pax: e.pax, status: e.status, booking_status: e.booking_status, total_cents: e.total_due_cents, paid_cents: pt.net_paid, balance_cents: Math.max(e.total_due_cents - pt.net_paid, 0),
        services: db.all('SELECT name,status,date,start_time FROM event_services WHERE company_id=? AND event_id=? ORDER BY date', cid, e.id),
        payments: db.all(`SELECT * FROM payments_in WHERE company_id=? AND event_id=? AND kind<>'refund' ORDER BY id DESC`, cid, e.id).map((p) => ({ kind: p.kind, amount_cents: p.amount_cents, status: p.status, due_date: p.due_date, link: ['pending'].includes(p.status) ? payLink(p) : null })),
        documents: db.all(`SELECT id,name,kind FROM documents WHERE company_id=? AND visibility='client' AND entity='event' AND entity_id=?`, cid, e.id) };
    });
    return { client: db.get('SELECT name,email FROM clients WHERE id=? AND company_id=?', clid, cid), quotes, events };
  });
  r.get('/api/portal/client/documents/:id', 'portal:client', (c) => {
    const d = byId(c.ctx, 'documents', c.params.id);
    const ev = d.entity === 'event' ? db.get('SELECT client_id FROM events WHERE id=? AND company_id=?', d.entity_id, c.ctx.cid) : null;
    if (d.visibility !== 'client' || ev?.client_id !== cli(c)) throw new HttpError(404, 'No encontrado');
    return { __raw: readFileSafe(d), type: d.mime, headers: { 'Content-Disposition': `attachment; filename="${d.name.replace(/"/g, '')}"` } };
  });
}
import fs from 'node:fs';
const readFileSafe = (d) => fs.readFileSync(d.path);
