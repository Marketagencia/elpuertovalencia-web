import { audit, byId, parseRow, sysctx } from '../core.js';
import { badRequest, conflict, HttpError, nowIso, today, sha256, eur } from '../util.js';
import { str, need, eurosToCents } from './util.js';
import * as pay from '../payments.js';
import { saveDocument } from '../files.js';
import { paymentTotals } from '../bookings.js';
import { isConnected } from '../integrations.js';

const cents = (b, k = 'amount') => (b[`${k}_cents`] != null ? Math.round(Number(b[`${k}_cents`])) : eurosToCents(b[`${k}_eur`]));

export default function (r, db) {
  // ------------------------------------------------------------------ cobros a clientes
  r.get('/api/payments-in', 'payments_in:r', (c) => {
    const a = [c.ctx.cid]; let w = '';
    if (c.query.status) { w += ' AND p.status=?'; a.push(c.query.status); }
    if (c.query.overdue === '1') { w += ` AND p.kind<>'refund' AND p.status IN ('pending','processing') AND p.due_date<?`; a.push(today()); }
    return db.all(`SELECT p.id,p.event_id,p.kind,p.amount_cents,p.refunded_cents,p.method,p.status,p.due_date,p.payer_name,p.proof_note,p.verified_at,p.refund_of,p.gateway,p.created_at,p.token_nonce,p.token_revoked_at,
      e.code event_code, e.name event_name, cl.name client_name FROM payments_in p JOIN events e ON e.id=p.event_id JOIN clients cl ON cl.id=e.client_id WHERE p.company_id=? ${w} ORDER BY p.id DESC LIMIT 300`, ...a)
      .map((p) => ({ ...p, link: pay.payLink(p), token_nonce: undefined, token_revoked_at: undefined, overdue: ['pending', 'processing'].includes(p.status) && p.kind !== 'refund' && p.due_date && p.due_date < today() }));
  });
  r.post('/api/events/:id/payments', 'payments_in:w', (c) => {
    const b = c.body; byId(c.ctx, 'events', c.params.id);
    return pay.createPaymentIn(c.ctx, Number(c.params.id), { kind: b.kind || 'balance', amount_cents: cents(b), method: b.method === 'stripe' ? 'stripe' : 'transfer', payer_name: str(b.payer_name, 120), payer_email: str(b.payer_email, 160),
      due_date: b.due_date, with_token: b.with_link !== false });
  });
  r.post('/api/events/:id/payments/manual', 'payments_in:w', (c) => {
    const b = c.body; byId(c.ctx, 'events', c.params.id);
    if (!['transfer', 'cash', 'card_manual'].includes(b.method || 'transfer')) throw badRequest('Método no válido');
    let docId = null;
    if (b.doc?.data_base64) docId = saveDocument(c.ctx, { entity: 'payment_in', entity_id: 0, name: b.doc.name, mime: b.doc.mime, base64: b.doc.data_base64, kind: 'justificante_cobro', uploaded_by: c.user.name }).id;
    const p = pay.registerManual(c.ctx, Number(c.params.id), { payment_id: b.payment_id, kind: b.kind || 'balance', amount_cents: cents(b), method: b.method || 'transfer', reference: str(b.reference, 200),
      payer_name: str(b.payer_name, 120), verified: !!b.verified, proof_doc_id: docId });
    if (docId) db.run('UPDATE documents SET entity_id=? WHERE id=? AND company_id=?', p.id, docId, c.ctx.cid);
    return p;
  });
  r.post('/api/payments-in/:id/verify', 'payments_in:w', (c) => pay.verifyPayment(c.ctx, c.params.id));
  r.post('/api/payments-in/:id/fail', 'payments_in:w', (c) => pay.failPayment(c.ctx, c.params.id, c.body.reason));
  r.post('/api/payments-in/:id/cancel', 'payments_in:w', (c) => { pay.cancelPaymentIn(c.ctx, c.params.id); });
  r.post('/api/payments-in/:id/revoke-link', 'payments_in:w', (c) => { const p = byId(c.ctx, 'payments_in', c.params.id); db.update('payments_in', p.id, c.ctx.cid, { token_revoked_at: nowIso() }); audit(c.ctx, 'payment_in', p.id, 'enlace_revocado'); });
  r.post('/api/payments-in/:id/refund', 'payments_in:w', (c) => pay.refund(c.ctx, c.params.id, { amount_cents: cents(c.body), reason: str(c.body.reason, 300), executed: !!c.body.executed }));
  r.post('/api/payments-in/:id/complete-refund', 'payments_in:w', (c) => pay.completeRefund(c.ctx, c.params.id));
  r.post('/api/payments-in/:id/online-link', 'payments_in:w', async (c) => {
    const p = byId(c.ctx, 'payments_in', c.params.id), ev = byId(c.ctx, 'events', p.event_id);
    const s = await pay.startOnlinePayment(c.ctx, p, `${ev.name} (${ev.code})`); return { url: s.url };
  });
  r.get('/api/events/:id/refund-suggestion', 'payments_in:r', (c) => { const ev = byId(c.ctx, 'events', c.params.id), pt = paymentTotals(c.ctx, ev.id); return { net_paid_cents: pt.net_paid, total_due_cents: ev.total_due_cents, suggested_cents: Math.max(pt.net_paid - ev.total_due_cents, 0) }; });

  // ------------------------------------------------------------------ pagos a proveedores
  r.get('/api/payments-out', 'payments_out:r', (c) => {
    const a = [c.ctx.cid]; let w = '';
    if (c.query.status) { w += ' AND po.status=?'; a.push(c.query.status); }
    if (c.query.provider_id) { w += ' AND po.provider_id=?'; a.push(Number(c.query.provider_id)); }
    if (c.query.overdue === '1') { w += ` AND po.status IN ('pending','ordered') AND po.due_date<?`; a.push(today()); }
    return db.all(`SELECT po.*, p.name provider_name, es.name service_name, es.date service_date, es.status service_status, e.code event_code FROM payments_out po
      JOIN providers p ON p.id=po.provider_id JOIN event_services es ON es.id=po.event_service_id JOIN events e ON e.id=po.event_id WHERE po.company_id=? ${w} ORDER BY po.due_date, po.id LIMIT 400`, ...a)
      .map((x) => ({ ...x, overdue: ['pending', 'ordered'].includes(x.status) && x.due_date < today() }));
  });
  r.post('/api/payments-out/:id/order', 'payments_out:w', (c) => pay.prepareOrder(c.ctx, c.params.id));
  r.post('/api/payments-out/:id/pay', 'payments_out:w', (c) => {
    const b = c.body; let docId = null;
    if (b.doc?.data_base64) docId = saveDocument(c.ctx, { entity: 'payment_out', entity_id: Number(c.params.id), name: b.doc.name, mime: b.doc.mime, base64: b.doc.data_base64, kind: 'justificante_pago', uploaded_by: c.user.name }).id;
    return pay.payOut(c.ctx, c.params.id, { method: b.method || 'transfer', reference: str(b.reference, 200), invoice_ref: str(b.invoice_ref, 100), proof_doc_id: docId, idem_key: str(b.idem_key, 100) });
  });
  r.post('/api/payments-out/:id/cancel', 'payments_out:w', (c) => { pay.cancelOut(c.ctx, c.params.id); });
  r.put('/api/payments-out/:id', 'payments_out:w', (c) => { const po = byId(c.ctx, 'payments_out', c.params.id); db.update('payments_out', po.id, c.ctx.cid, { invoice_ref: str(c.body.invoice_ref, 100), ...(c.body.due_date ? { due_date: c.body.due_date } : {}) }); return byId(c.ctx, 'payments_out', po.id); });
  r.get('/api/settlements', 'payments_out:r', (c) => pay.settlements(c.ctx, { from: c.query.from, to: c.query.to, provider_id: c.query.provider_id }));
  r.get('/api/cash-forecast', 'payments_out:r', (c) => pay.cashForecast(c.ctx, Number(c.query.weeks) || 8));

  // ------------------------------------------------------------------ enlace privado de pago (organizador o participante)
  const findPay = (c) => {
    if (!c.limit(`pay:${c.ip}`, 60, 60000)) throw new HttpError(429, 'Demasiadas peticiones');
    const row = db.get('SELECT * FROM payments_in WHERE token_hash=?', sha256(c.params.token));
    if (!row || row.token_revoked_at) throw new HttpError(404, 'Este enlace de pago no es válido o ha sido revocado', 'bad_link');
    const ctx = sysctx(db, row.company_id); ctx.actor = 'cliente (enlace de pago)';
    return { ctx, p: row };
  };
  r.get('/api/public/pay/:token', null, (c) => {
    const { ctx, p } = findPay(c); const ev = byId(ctx, 'events', p.event_id);
    const brand = ev.brand_id ? byId(ctx, 'brands', ev.brand_id) : null;
    return { status: p.status, kind: p.kind, amount_cents: p.amount_cents, due_date: p.due_date, payer_name: p.payer_name, event: { code: ev.code, name: ev.name, date: ev.date },
      brand: brand && { name: brand.name, iban: brand.iban, email: brand.email }, online_available: isConnected(ctx, 'stripe'),
      transfer_reference: ev.code, note: 'Un justificante que aportes quedará «en proceso» hasta que la agencia verifique el ingreso.' };
  });
  r.post('/api/public/pay/:token/proof', null, (c) => {
    const { ctx, p } = findPay(c); let docId = null;
    if (c.body.doc?.data_base64) docId = saveDocument(ctx, { entity: 'payment_in', entity_id: p.id, name: c.body.doc.name, mime: c.body.doc.mime, base64: c.body.doc.data_base64, kind: 'justificante_cobro', visibility: 'internal', uploaded_by: 'cliente' }).id;
    if (!docId && !String(c.body.note || '').trim()) throw badRequest('Adjunta el justificante o indica la referencia de la transferencia');
    const out = pay.submitProof(ctx, p, { note: str(c.body.note, 300), payer_name: str(c.body.payer_name, 120), doc_id: docId });
    return { status: out.status };
  });
  r.post('/api/public/pay/:token/online', null, async (c) => {
    const { ctx, p } = findPay(c); const ev = byId(ctx, 'events', p.event_id);
    const { chargeable } = pay;
    const s = await pay.startOnlinePayment(ctx, p, `${ev.name} (${ev.code})`); return { url: s.url };
  });
  // Los pagos individuales de participantes salen del MISMO saldo del evento: createPaymentIn impide superar lo pendiente.
  r.post('/api/events/:id/participant-links', 'payments_in:w', (c) => {
    const b = c.body; byId(c.ctx, 'events', c.params.id);
    const list = Array.isArray(b.participants) ? b.participants : [];
    if (!list.length) throw badRequest('Indica al menos un participante');
    return db.tx(() => list.map((x) => { const o = pay.createPaymentIn(c.ctx, Number(c.params.id), { kind: 'participant', amount_cents: cents(x), payer_name: str(x.name, 120), with_token: true, due_date: b.due_date }); return { name: x.name, amount_cents: o.payment.amount_cents, link: o.link }; }));
  });

  // ------------------------------------------------------------------ webhook Stripe (cuerpo en bruto: la firma se verifica sobre los bytes exactos)
  r.post('/api/webhooks/stripe/:slug', null, (c) => { const o = pay.handleStripeWebhook(db, c.params.slug, c.raw, c.req.headers['stripe-signature']); return { __status: o.status, body: o.body }; }, { raw: true });
}
