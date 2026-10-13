// Automatizaciones programadas (plazos configurables por empresa). Cada envío usa dedupe_key → nunca se duplica,
// y las condiciones se reevalúan en cada pasada, de modo que los flujos obsoletos se detienen solos.
import { sysctx, byId, settings, addTask, tokenOf, mint } from './core.js';
import { nowIso, now, today, addDays, diffDays, parseJson, eur } from './util.js';
import { notifyClient, notifyProvider, fmtDate } from './notify.js';
import { createPaymentIn, chargeable, payLink } from './payments.js';
import { paymentTotals } from './bookings.js';
import { BASE_URL } from './config.js';
import { quoteLink } from './quotes.js';
import { queue } from './comms.js';
import { expireHolds } from './bookings.js';
import { processQueue } from './comms.js';

export const AUTOMATIONS = {
  lead_ack: { label: 'Acuse de recibo de consulta', audience: 'Cliente', params: {}, note: 'Al registrar una consulta' },
  quote_followup: { label: 'Seguimiento si no hay respuesta', audience: 'Cliente', params: { after_days: 3, max: 2 }, note: 'Se detiene al recibir respuesta, aceptación, cancelación o intervención manual' },
  quote_expiry: { label: 'Aviso de caducidad de propuesta', audience: 'Cliente', params: { days_before: 2 } },
  deposit_reminder: { label: 'Recordatorio de señal', audience: 'Cliente', params: { days_before_due: 1 } },
  balance_reminder: { label: 'Recordatorio del saldo', audience: 'Cliente', params: { days_before_event: 7 } },
  final_pax_request: { label: 'Solicitud del número definitivo de asistentes', audience: 'Cliente', params: { days_before_event: 10 } },
  pre_event_info: { label: 'Información práctica antes del evento', audience: 'Cliente', params: { days_before_event: 1 } },
  review_request: { label: 'Solicitud de valoración', audience: 'Cliente', params: { days_after_event: 1 } },
  request_reminder: { label: 'Recordatorio de respuesta pendiente', audience: 'Proveedor', params: { after_hours: 24 } },
  pre_event_summary: { label: 'Resumen previo al evento', audience: 'Proveedor', params: { days_before_event: 2 } },
  invoice_request: { label: 'Solicitud de factura/documentación', audience: 'Proveedor', params: { days_after_event: 1 } },
};
export function automationConfig(ctx, key) {
  const row = ctx.db.get('SELECT * FROM automations WHERE company_id=? AND key=?', ctx.cid, key);
  return { enabled: row ? !!row.enabled : true, params: { ...AUTOMATIONS[key].params, ...parseJson(row?.params, {}) } };
}
export const automationList = (ctx) => Object.entries(AUTOMATIONS).map(([key, a]) => ({ key, ...a, ...automationConfig(ctx, key) }));

export function onLeadCreated(ctx, lead) {
  if (!automationConfig(ctx, 'lead_ack').enabled) return null;
  const client = byId(ctx, 'clients', lead.client_id);
  const brand = lead.brand_id ? byId(ctx, 'brands', lead.brand_id) : null;
  return queue(ctx, { channel: 'email', client_id: client.id, lead_id: lead.id, brand_id: lead.brand_id, template_key: 'lead_ack', dedupe_key: `lead_ack:${lead.id}`, automatic: true,
    vars: { nombre: client.name.split(' ')[0], evento: lead.title, marca: brand?.name || 'GrupoListo' } });
}

const hoursAgo = (iso) => (now() - new Date(iso)) / 36e5;

export function runCompany(db, cid) {
  const ctx = sysctx(db, cid), t = today(), set = settings(ctx);
  const on = (k) => automationConfig(ctx, k);
  db.run(`UPDATE quotes SET status='expired' WHERE company_id=? AND status IN ('sent','changes_requested') AND valid_until<?`, cid, t);

  // --- seguimiento de propuestas
  const fu = on('quote_followup');
  if (fu.enabled) {
    for (const q of db.all(`SELECT q.*, l.stage lead_stage, l.last_inbound_at FROM quotes q LEFT JOIN leads l ON l.id=q.lead_id WHERE q.company_id=? AND q.status='sent' AND q.followup_stopped=0`, cid)) {
      if (q.lead_stage && q.lead_stage !== 'proposal_sent') continue;                       // intervención manual → se detiene
      if (q.last_inbound_at && q.last_inbound_at >= q.sent_at) continue;                    // el cliente respondió
      for (let n = 1; n <= fu.params.max; n++) {
        const key = `quote_followup:${q.id}:${q.version}:${n}`;
        if (db.get('SELECT id FROM messages WHERE company_id=? AND dedupe_key=?', cid, key)) continue;
        if (now() >= new Date(new Date(q.sent_at).getTime() + n * fu.params.after_days * 864e5)) {
          const client = byId(ctx, 'clients', q.client_id);
          queue(ctx, { channel: 'auto', client_id: client.id, lead_id: q.lead_id, brand_id: q.brand_id, template_key: 'quote_followup', dedupe_key: key, automatic: true,
            vars: { nombre: client.name.split(' ')[0], evento: q.title, enlace: quoteLink(q) || '', codigo: `${q.number} v${q.version}`, marca: '' } });
        }
        break;
      }
    }
  }
  const ex = on('quote_expiry');
  if (ex.enabled) for (const q of db.all(`SELECT * FROM quotes WHERE company_id=? AND status='sent' AND followup_stopped=0 AND valid_until>=? AND valid_until<=?`, cid, t, addDays(t, ex.params.days_before))) {
    const client = byId(ctx, 'clients', q.client_id);
    queue(ctx, { channel: 'auto', client_id: client.id, lead_id: q.lead_id, brand_id: q.brand_id, template_key: 'quote_expiry', dedupe_key: `quote_expiry:${q.id}:${q.version}`, automatic: true,
      vars: { nombre: client.name.split(' ')[0], evento: q.title, enlace: quoteLink(q) || '', vence: fmtDate(q.valid_until), codigo: `${q.number} v${q.version}`, marca: '' } });
  }

  // --- cobros
  const dr = on('deposit_reminder');
  if (dr.enabled) for (const p of db.all(`SELECT * FROM payments_in WHERE company_id=? AND kind='deposit' AND status='pending' AND due_date<=?`, cid, addDays(t, dr.params.days_before_due))) {
    const ev = byId(ctx, 'events', p.event_id);
    if (ev.status !== 'active') continue;
    notifyClient(ctx, ev, 'deposit_reminder', { importe: eur(p.amount_cents), vence: fmtDate(p.due_date), enlace: payLink(p) || '' }, { dedupe_key: `deposit_reminder:${p.id}`, automatic: true });
  }
  const br = on('balance_reminder');
  if (br.enabled) for (const ev of db.all(`SELECT * FROM events WHERE company_id=? AND status='active' AND date>=? AND date<=?`, cid, t, addDays(t, br.params.days_before_event))) {
    const { available } = chargeable(ctx, ev.id);
    if (available <= 0) continue;
    let pay = db.get(`SELECT * FROM payments_in WHERE company_id=? AND event_id=? AND kind='balance' AND status IN ('pending','processing') ORDER BY id DESC LIMIT 1`, cid, ev.id);
    if (!pay) pay = createPaymentIn(ctx, ev.id, { kind: 'balance', amount_cents: available, with_token: true, due_date: ev.date, payer_name: null }).payment;
    notifyClient(ctx, ev, 'balance_reminder', { saldo: eur(available), vence: fmtDate(pay.due_date || ev.date), enlace: payLink(pay) || '' }, { dedupe_key: `balance_reminder:${ev.id}:${pay.id}`, automatic: true });
  }

  // --- eventos
  const fp = on('final_pax_request');
  if (fp.enabled) for (const ev of db.all(`SELECT * FROM events WHERE company_id=? AND status='active' AND final_pax_confirmed=0 AND date>=? AND date<=?`, cid, t, addDays(t, fp.params.days_before_event)))
    notifyClient(ctx, ev, 'final_pax_request', {}, { dedupe_key: `final_pax:${ev.id}`, automatic: true });
  const pe = on('pre_event_info');
  if (pe.enabled) for (const ev of db.all(`SELECT e.*, q.token_nonce, q.token_revoked_at, q.id qid FROM events e LEFT JOIN quotes q ON q.id=e.quote_id WHERE e.company_id=? AND e.status='active' AND e.booking_status='confirmed' AND e.date>=? AND e.date<=?`, cid, t, addDays(t, pe.params.days_before_event)))
    notifyClient(ctx, ev, 'pre_event_info', { enlace: quoteLink({ id: ev.qid, token_nonce: ev.token_nonce, token_revoked_at: ev.token_revoked_at }) || '' }, { dedupe_key: `pre_event:${ev.id}`, automatic: true });
  const rv = on('review_request');
  if (rv.enabled) for (const ev of db.all(`SELECT * FROM events WHERE company_id=? AND status='completed' AND completed_at<=?`, cid, new Date(now().getTime() - rv.params.days_after_event * 864e5).toISOString()))
    notifyClient(ctx, ev, 'review_request', {}, { dedupe_key: `review:${ev.id}`, automatic: true });

  // --- proveedores
  const rr = on('request_reminder');
  for (const r of db.all(`SELECT * FROM provider_requests WHERE company_id=? AND status='sent'`, cid)) {
    const es = byId(ctx, 'event_services', r.event_service_id);
    if (rr.enabled && hoursAgo(r.sent_at) >= rr.params.after_hours) {
      notifyProvider(ctx, es, 'request_reminder', { enlace: tokenOf('provider_requests', r) ? `${BASE_URL}/#/prov/${tokenOf('provider_requests', r)}` : '' }, { dedupe_key: `req_reminder:${r.id}`, automatic: true });
      db.update('provider_requests', r.id, cid, { last_reminder_at: nowIso() });
    }
    if (r.deadline_at && r.deadline_at < nowIso())      // sin respuesta ≠ disponible: se alerta y se propone buscar alternativa
      addTask(ctx, { title: `Sin respuesta del proveedor a tiempo (${es.name}): reclamar o buscar alternativa`, event_id: es.event_id, kind: 'incident', auto_key: `noresp:${r.id}` });
  }
  const ps = on('pre_event_summary');
  if (ps.enabled) for (const es of db.all(`SELECT * FROM event_services WHERE company_id=? AND status='confirmed' AND provider_id IS NOT NULL AND date>=? AND date<=?`, cid, t, addDays(t, ps.params.days_before_event)))
    notifyProvider(ctx, es, 'pre_event_summary', {}, { dedupe_key: `pre_summary:${es.id}:${es.date}:${es.pax}`, automatic: true });
  const ir = on('invoice_request');
  if (ir.enabled) for (const es of db.all(`SELECT es.* FROM event_services es WHERE es.company_id=? AND es.status='done' AND es.provider_id IS NOT NULL AND es.done_at<=?
      AND EXISTS (SELECT 1 FROM payments_out po WHERE po.event_service_id=es.id AND po.status IN ('pending','ordered') AND po.invoice_ref IS NULL AND po.invoice_doc_id IS NULL)`, cid,
  new Date(now().getTime() - ir.params.days_after_event * 864e5).toISOString()))
    notifyProvider(ctx, es, 'invoice_request', {}, { dedupe_key: `invoice_req:${es.id}`, automatic: true });

  // --- alertas internas: consultas sin atender
  for (const l of db.all(`SELECT * FROM leads WHERE company_id=? AND stage='new' AND last_contact_at IS NULL`, cid)) {
    if (hoursAgo(l.created_at) >= set.unattended_hours)
      addTask(ctx, { title: `Consulta sin atender: ${l.title}`, lead_id: l.id, assigned_to: l.owner_user_id, kind: 'incident', auto_key: `unattended:${l.id}`, due_in_days: 0 });
  }
}

// Pasada completa del planificador (cada minuto desde el servidor; invocable en tests)
export async function tick(db) {
  expireHolds(db);
  for (const c of db.all('SELECT id FROM companies')) runCompany(db, c.id);
  return processQueue(db);
}
