// Cobros a clientes y pagos a proveedores. Son flujos SEPARADOS. Nunca se ejecuta un pago por recibir un mensaje,
// confirmar una reserva o completar un evento.
import { byId, audit, parseRow, mint, tokenOf } from './core.js';
import { conflict, badRequest, nowIso, today, addDays, newToken, sha256, parseJson, now, eur } from './util.js';
import { paymentTotals, recomputeEvent } from './bookings.js';
import { notifyProvider } from './notify.js';
import { BASE_URL, DATA_DIR } from './config.js';
import { getConfig, createStripeCheckout, verifyStripeSignature, isConnected } from './integrations.js';

export const payLink = (p) => (tokenOf('payments_in', p) ? `${BASE_URL}/#/pay/${tokenOf('payments_in', p)}` : null);
export const PAY_STATUS = { pending: 'Pendiente', processing: 'En proceso', verified: 'Verificado', failed: 'Fallido', refunded: 'Reembolsado', cancelled: 'Cancelado' };

// Importe todavía cobrable: total − cobrado neto − lo ya reservado en cobros abiertos
export function chargeable(ctx, eventId, excludePaymentId = null) {
  const ev = byId(ctx, 'events', eventId);
  const pt = paymentTotals(ctx, eventId);
  const ex = excludePaymentId ? (ctx.db.get(`SELECT amount_cents a FROM payments_in WHERE id=? AND company_id=? AND kind<>'refund' AND status IN ('pending','processing')`, excludePaymentId, ctx.cid)?.a || 0) : 0;
  return { ev, pt, available: ev.total_due_cents - pt.net_paid - (pt.open_amount - ex) };
}

export function createPaymentIn(ctx, eventId, o) {
  const { ev, available } = chargeable(ctx, eventId);
  if (ev.status === 'cancelled') throw conflict('El evento está cancelado', 'bad_state');
  const amount = Math.round(Number(o.amount_cents));
  if (!(amount > 0)) throw badRequest('Importe no válido');
  if (!['deposit', 'balance', 'participant'].includes(o.kind)) throw badRequest('Tipo de cobro no válido');
  if (amount > available) throw conflict(`El importe supera lo pendiente de cobrar (${eur(Math.max(available, 0))})`, 'exceeds_pending', { available });
  const id = ctx.db.insert('payments_in', { company_id: ctx.cid, event_id: eventId, payer_name: o.payer_name || null, payer_email: o.payer_email || null,
    kind: o.kind, amount_cents: amount, method: o.method || 'transfer', status: o.status || 'pending', due_date: o.due_date || addDays(today(), 3),
    proof_note: o.reference || null, created_by: ctx.user?.id ?? null, created_at: nowIso() });
  const tok = o.with_token ? mint(ctx, 'payments_in', id) : null;
  audit(ctx, 'payment_in', id, 'creado', { amount, kind: o.kind });
  return { payment: byId(ctx, 'payments_in', id), link: tok ? `${BASE_URL}/#/pay/${tok}` : null };
}

/** Cobro manual (transferencia, efectivo, TPV externo). Solo queda «verificado» si quien lo registra lo marca tras comprobarlo. */
export function registerManual(ctx, eventId, o) {
  return ctx.db.tx(() => {
    let p;
    if (o.payment_id) {
      p = byId(ctx, 'payments_in', o.payment_id);
      if (p.event_id !== Number(eventId)) throw badRequest('El cobro no pertenece a este evento');
      if (!['pending', 'processing'].includes(p.status)) throw conflict('Este cobro ya está cerrado', 'bad_state');
      ctx.db.update('payments_in', p.id, ctx.cid, { method: o.method || p.method, proof_note: o.reference || p.proof_note, proof_doc_id: o.proof_doc_id ?? p.proof_doc_id, status: 'processing' });
    } else {
      p = createPaymentIn(ctx, eventId, { ...o, status: 'processing' }).payment;
      ctx.db.update('payments_in', p.id, ctx.cid, { proof_doc_id: o.proof_doc_id ?? null });
    }
    audit(ctx, 'payment_in', p.id, 'registrado_manual', { method: o.method, reference: o.reference });
    return o.verified ? verifyPayment(ctx, p.id) : byId(ctx, 'payments_in', p.id);
  });
}

/** Verificación idempotente: verificar dos veces no duplica el cobro. */
export function verifyPayment(ctx, id, { gateway = false } = {}) {
  const p = byId(ctx, 'payments_in', id);
  if (p.status === 'verified') return p;
  if (!['pending', 'processing'].includes(p.status)) throw conflict(`No se puede verificar un cobro «${PAY_STATUS[p.status]}»`, 'bad_state');
  return ctx.db.tx(() => {
    const { ev, pt } = chargeable(ctx, p.event_id);
    const room = ev.total_due_cents - pt.net_paid;
    if (p.amount_cents > room && !gateway) throw conflict(`Verificar este cobro superaría el importe del evento (pendiente ${eur(Math.max(room, 0))})`, 'overpay');
    ctx.db.update('payments_in', id, ctx.cid, { status: 'verified', verified_by: ctx.user?.id ?? null, verified_at: nowIso() });
    audit(ctx, 'payment_in', id, gateway ? 'verificado_por_pasarela' : 'verificado', { amount: p.amount_cents, exceso: gateway && p.amount_cents > room ? p.amount_cents - room : 0 });
    recomputeEvent(ctx, p.event_id);
    return byId(ctx, 'payments_in', id);
  });
}
export function failPayment(ctx, id, reason) {
  const p = byId(ctx, 'payments_in', id);
  if (p.status === 'verified' || p.status === 'refunded') throw conflict('El cobro ya fue verificado', 'bad_state');
  ctx.db.update('payments_in', id, ctx.cid, { status: 'failed', failed_reason: reason || null });
  audit(ctx, 'payment_in', id, 'fallido', { reason });
  recomputeEvent(ctx, p.event_id);
  return byId(ctx, 'payments_in', id);
}
export function cancelPaymentIn(ctx, id) {
  const p = byId(ctx, 'payments_in', id);
  if (!['pending', 'processing'].includes(p.status)) throw conflict('Solo se pueden anular cobros abiertos', 'bad_state');
  ctx.db.update('payments_in', id, ctx.cid, { status: 'cancelled', token_revoked_at: nowIso() });
  audit(ctx, 'payment_in', id, 'anulado');
  recomputeEvent(ctx, p.event_id);
}
// El cliente/participante aporta justificante: queda EN PROCESO, jamás verificado automáticamente
export function submitProof(ctx, p, { note, payer_name, doc_id }) {
  if (!['pending', 'processing'].includes(p.status)) throw conflict('Este cobro ya está cerrado', 'bad_state');
  ctx.db.update('payments_in', p.id, ctx.cid, { status: 'processing', proof_note: note || p.proof_note, proof_doc_id: doc_id ?? p.proof_doc_id, payer_name: payer_name || p.payer_name });
  audit(ctx, 'payment_in', p.id, 'justificante_aportado', { note });
  return byId(ctx, 'payments_in', p.id);
}

export function refund(ctx, paymentId, { amount_cents, reason, executed = false }) {
  const p = byId(ctx, 'payments_in', paymentId);
  if (p.kind === 'refund' || !['verified', 'refunded'].includes(p.status) && p.refunded_cents === 0) throw conflict('Solo se pueden reembolsar cobros verificados', 'bad_state');
  const amount = Math.round(Number(amount_cents));
  const pending = ctx.db.get(`SELECT COALESCE(SUM(amount_cents),0) n FROM payments_in WHERE company_id=? AND refund_of=? AND status IN ('pending','processing')`, ctx.cid, p.id).n;
  if (!(amount > 0) || amount > p.amount_cents - p.refunded_cents - pending) throw conflict(`Importe de reembolso no válido (máximo ${eur(p.amount_cents - p.refunded_cents - pending)})`, 'exceeds_refundable');
  return ctx.db.tx(() => {
    const rid = ctx.db.insert('payments_in', { company_id: ctx.cid, event_id: p.event_id, payer_name: p.payer_name, kind: 'refund', amount_cents: amount, method: p.method,
      status: 'pending', refund_of: p.id, proof_note: reason || null, created_by: ctx.user?.id ?? null, created_at: nowIso() });
    audit(ctx, 'payment_in', rid, 'reembolso_solicitado', { de: p.id, amount, reason });
    return executed ? completeRefund(ctx, rid) : byId(ctx, 'payments_in', rid);
  });
}
// Finanzas confirma que el reembolso se ha ejecutado (en Stripe o por transferencia)
export function completeRefund(ctx, refundId) {
  const r = byId(ctx, 'payments_in', refundId);
  if (r.kind !== 'refund') throw badRequest('No es un reembolso');
  if (r.status === 'verified') return r;
  const p = byId(ctx, 'payments_in', r.refund_of);
  return ctx.db.tx(() => {
    ctx.db.update('payments_in', r.id, ctx.cid, { status: 'verified', verified_by: ctx.user?.id ?? null, verified_at: nowIso() });
    const total = p.refunded_cents + r.amount_cents;
    ctx.db.update('payments_in', p.id, ctx.cid, { refunded_cents: total, status: total >= p.amount_cents ? 'refunded' : p.status });
    audit(ctx, 'payment_in', r.id, 'reembolso_ejecutado', { amount: r.amount_cents });
    recomputeEvent(ctx, r.event_id);
    return byId(ctx, 'payments_in', r.id);
  });
}

// ---------------------------------------------------------------- pasarela (Stripe)
export async function startOnlinePayment(ctx, payment, label) {
  if (!isConnected(ctx, 'stripe')) throw badRequest('Pasarela de pago pendiente de conectar. Usa transferencia y adjunta el justificante.', 'not_configured');
  if (payment.status !== 'pending') throw conflict('Este cobro ya no está pendiente', 'bad_state');
  const s = await createStripeCheckout(ctx, payment, label);
  ctx.db.update('payments_in', payment.id, ctx.cid, { gateway: 'stripe', gateway_ref: s.session_id, method: 'stripe' });
  return s;
}

/** Webhook de Stripe: firma verificada + procesado una sola vez (tabla webhook_events con UNIQUE). */
export function handleStripeWebhook(db, slug, raw, sigHeader) {
  const co = db.get('SELECT * FROM companies WHERE slug=?', slug);
  if (!co) return { status: 404, body: { error: 'empresa desconocida' } };
  const ctx = { db, cid: co.id, user: null, actor: 'pasarela:stripe' };
  const secret = getConfig(ctx, 'stripe').config.webhook_secret;
  if (!secret) return { status: 503, body: { error: 'Webhook no configurado' } };
  if (!verifyStripeSignature(raw, sigHeader, secret)) return { status: 400, body: { error: 'Firma no válida' } };
  const evt = parseJson(raw, null);
  if (!evt?.id) return { status: 400, body: { error: 'Evento no válido' } };
  try {
    return db.tx(() => {
      try { db.insert('webhook_events', { company_id: co.id, source: 'stripe', external_id: evt.id, payload: raw, received_at: nowIso() }); }
      catch (e) { if (/UNIQUE/i.test(String(e.message))) return { status: 200, body: { duplicate: true } }; throw e; }
      const obj = evt.data?.object || {};
      const pid = Number(obj.metadata?.payment_id || obj.client_reference_id);
      let result = 'ignorado';
      const p = pid && obj.metadata?.company_id == co.id ? db.get('SELECT * FROM payments_in WHERE id=? AND company_id=?', pid, co.id) : null;
      if (p && evt.type === 'checkout.session.completed' && obj.payment_status === 'paid') {
        if (obj.amount_total !== p.amount_cents) {
          db.update('payments_in', p.id, co.id, { status: 'processing', proof_note: `Importe de la pasarela (${obj.amount_total}) no coincide` }); result = 'importe_no_coincide';
        } else {
          if (obj.id && !p.gateway_ref) db.update('payments_in', p.id, co.id, { gateway: 'stripe', gateway_ref: obj.id });
          if (p.status !== 'verified') verifyPayment(ctx, p.id, { gateway: true });
          result = 'verificado';
        }
      } else if (p && evt.type === 'payment_intent.payment_failed' && p.status !== 'verified') {
        failPayment(ctx, p.id, obj.last_payment_error?.message || 'Pago rechazado'); result = 'fallido';
      }
      db.run('UPDATE webhook_events SET processed_at=?, result=? WHERE source=? AND external_id=?', nowIso(), result, 'stripe', evt.id);
      return { status: 200, body: { ok: true, result } };
    });
  } catch (e) { return { status: 500, body: { error: 'Error procesando el evento' } }; }
}

// ---------------------------------------------------------------- pagos a proveedores
export function prepareOrder(ctx, id) {
  const po = byId(ctx, 'payments_out', id);
  if (po.status !== 'pending') throw conflict('Solo se pueden preparar órdenes de obligaciones pendientes', 'bad_state');
  ctx.db.update('payments_out', id, ctx.cid, { status: 'ordered', ordered_by: ctx.user.id, ordered_at: nowIso(), idem_key: `order:${id}:${po.amount_cents}` });
  audit(ctx, 'payment_out', id, 'orden_preparada', { amount: po.amount_cents, ejecucion: isConnected(ctx, 'bank') ? 'banco' : 'manual (integración bancaria pendiente)' });
  return byId(ctx, 'payments_out', id);
}
/** Registra un pago realizado FUERA de la app (o por la futura integración bancaria). Requiere permiso financiero. */
export function payOut(ctx, id, { method = 'transfer', reference, invoice_ref, proof_doc_id, idem_key }) {
  const po = byId(ctx, 'payments_out', id);
  if (po.status === 'paid') throw conflict('Esta obligación ya está pagada (evita pagos duplicados)', 'already_paid');
  if (!['pending', 'ordered'].includes(po.status)) throw conflict('Obligación no pagable', 'bad_state');
  if (!(po.amount_cents > 0)) throw badRequest('Importe cero');
  if (!reference && !proof_doc_id) throw badRequest('Indica la referencia bancaria o adjunta el justificante');
  if (idem_key && ctx.db.get('SELECT id FROM payments_out WHERE company_id=? AND idem_key=? AND id<>?', ctx.cid, idem_key, id)) throw conflict('Pago duplicado (misma clave de operación)', 'duplicate');
  return ctx.db.tx(() => {
    ctx.db.update('payments_out', id, ctx.cid, { status: 'paid', method, reference: reference || null, invoice_ref: invoice_ref || po.invoice_ref, proof_doc_id: proof_doc_id ?? null,
      paid_by: ctx.user.id, paid_at: nowIso(), idem_key: idem_key || po.idem_key || `paid:${id}` });
    audit(ctx, 'payment_out', id, 'pago_registrado_y_verificado', { amount: po.amount_cents, reference });
    const es = byId(ctx, 'event_services', po.event_service_id);
    // Solo se avisa al proveedor cuando el pago está registrado y verificado
    notifyProvider(ctx, { ...es, cost_cents: po.amount_cents }, 'payment_notice', { codigo: reference || `PO-${id}` }, { dedupe_key: `pay_out:${id}`, ignore_window: true });
    return byId(ctx, 'payments_out', id);
  });
}
export function cancelOut(ctx, id) {
  const po = byId(ctx, 'payments_out', id);
  if (po.status === 'paid') throw conflict('Ya está pagada', 'already_paid');
  ctx.db.update('payments_out', id, ctx.cid, { status: 'cancelled' });
  audit(ctx, 'payment_out', id, 'anulado');
}

export function settlements(ctx, { from, to, provider_id } = {}) {
  const args = [ctx.cid]; let sql = `SELECT po.*, p.name provider_name, es.name service_name, es.date service_date, es.status service_status, e.code event_code, e.name event_name
    FROM payments_out po JOIN providers p ON p.id=po.provider_id JOIN event_services es ON es.id=po.event_service_id JOIN events e ON e.id=po.event_id
    WHERE po.company_id=? AND po.status<>'cancelled'`;
  if (from) { sql += ' AND es.date>=?'; args.push(from); }
  if (to) { sql += ' AND es.date<=?'; args.push(to); }
  if (provider_id) { sql += ' AND po.provider_id=?'; args.push(Number(provider_id)); }
  const rows = ctx.db.all(`${sql} ORDER BY p.name, es.date`, ...args);
  const t = today(), map = {};
  for (const r of rows) {
    const g = (map[r.provider_id] ||= { provider_id: r.provider_id, provider_name: r.provider_name, total_cents: 0, paid_cents: 0, pending_cents: 0, overdue_cents: 0, items: [] });
    g.total_cents += r.amount_cents;
    if (r.status === 'paid') g.paid_cents += r.amount_cents; else { g.pending_cents += r.amount_cents; if (r.due_date && r.due_date < t) g.overdue_cents += r.amount_cents; }
    g.items.push(r);
  }
  return Object.values(map);
}

export function cashForecast(ctx, weeks = 8) {
  const t = today(), out = [];
  const evs = ctx.db.all(`SELECT * FROM events WHERE company_id=? AND status='active'`, ctx.cid);
  const inflows = [];
  for (const e of evs) {
    const pt = paymentTotals(ctx, e.id);
    const dep = ctx.db.all(`SELECT due_date d, amount_cents a FROM payments_in WHERE company_id=? AND event_id=? AND kind<>'refund' AND status IN ('pending','processing')`, ctx.cid, e.id);
    inflows.push(...dep.map((x) => ({ date: x.d || t, amount: x.a })));
    const rest = e.total_due_cents - pt.net_paid - pt.open_amount;
    if (rest > 0) inflows.push({ date: e.balance_due_date || e.date || t, amount: rest });
  }
  const outflows = ctx.db.all(`SELECT due_date date, amount_cents amount FROM payments_out WHERE company_id=? AND status IN ('pending','ordered')`, ctx.cid);
  for (let w = 0; w < weeks; w++) {
    const a = addDays(t, w * 7), b = addDays(t, w * 7 + 6);
    const inW = (d) => (w === 0 ? d <= b : d >= a && d <= b);
    const i = inflows.filter((x) => inW(x.date)).reduce((s, x) => s + x.amount, 0);
    const o = outflows.filter((x) => inW(x.date || t)).reduce((s, x) => s + x.amount, 0);
    out.push({ from: a, to: b, inflow_cents: i, outflow_cents: o, net_cents: i - o });
  }
  return out;
}
