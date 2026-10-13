import { audit, byId, sysctx } from '../core.js';
import { conflict, badRequest, HttpError, nowIso } from '../util.js';
import { loadQuote, saveQuote, newVersion, sendQuote, revokeLink, quoteLink, resolveToken, publicView, selectExtras, requestChanges, acceptQuote, rejectQuote } from '../quotes.js';
import { can } from '../perm.js';
import { payLink } from '../payments.js';
import { paymentTotals } from '../bookings.js';
import { tokenOf } from '../core.js';
import { BASE_URL } from '../config.js';
import { esc, printable } from '../printable.js';
import { processQueue } from '../comms.js';

// Quita costes y márgenes a quien no tiene permiso de márgenes
function redact(q, user) {
  if (can(user, 'margins:r')) return q;
  for (const o of q.options) { delete o.totals.cost_cents; delete o.totals.cost_net_cents; delete o.totals.margin_net_cents; delete o.totals.margin_pct; for (const l of o.lines) { delete l.unit_cost_cents; delete l.total_cost_cents; } }
  return q;
}

export default function (r, db) {
  r.get('/api/quotes', 'quotes:r', (c) => db.all(`SELECT q.id,q.number,q.version,q.title,q.status,q.valid_until,q.sent_at,q.accepted_at,q.lead_id,q.event_id,q.ai_generated,q.reviewed_by, cl.name client_name,
    (SELECT MAX(version) FROM quotes x WHERE x.company_id=q.company_id AND x.number=q.number) latest
    FROM quotes q JOIN clients cl ON cl.id=q.client_id WHERE q.company_id=? ORDER BY q.id DESC LIMIT 300`, c.ctx.cid));
  r.post('/api/quotes', 'quotes:w', (c) => redact(saveQuote(c.ctx, null, c.body), c.user));
  r.get('/api/quotes/:id', 'quotes:r', (c) => {
    const q = loadQuote(c.ctx, c.params.id);
    q.versions = db.all('SELECT id,version,status,sent_at FROM quotes WHERE company_id=? AND number=? ORDER BY version', c.ctx.cid, q.number);
    q.client = byId(c.ctx, 'clients', q.client_id);
    q.link = quoteLink(q);
    delete q.token_hash; delete q.token_nonce;
    return redact(q, c.user);
  });
  r.put('/api/quotes/:id', 'quotes:w', (c) => redact(saveQuote(c.ctx, Number(byId(c.ctx, 'quotes', c.params.id).id), c.body), c.user));
  r.post('/api/quotes/:id/version', 'quotes:w', (c) => redact(newVersion(c.ctx, c.params.id), c.user));
  r.post('/api/quotes/:id/send', 'quotes:w', async (c) => {
    const o = sendQuote(c.ctx, c.params.id);
    await processQueue(db);                                  // intenta enviar ya y devuelve el estado REAL (enviado / pendiente de conectar / fallo / bloqueado)
    const m = o.message && db.get('SELECT id,status,error,channel FROM messages WHERE id=?', o.message.id);
    return { link: o.link, status: o.quote.status, message: m };
  });
  r.post('/api/quotes/:id/revoke-link', 'quotes:w', (c) => { revokeLink(c.ctx, c.params.id); });
  r.post('/api/quotes/:id/review', 'quotes:w', (c) => {
    const q = byId(c.ctx, 'quotes', c.params.id);
    db.update('quotes', q.id, c.ctx.cid, { reviewed_by: c.user.id, reviewed_at: nowIso() }); audit(c.ctx, 'quote', q.id, 'revisada_por_humano');
    return { ok: true };
  });
  r.post('/api/quotes/:id/followup', 'quotes:w', (c) => { const q = byId(c.ctx, 'quotes', c.params.id); db.update('quotes', q.id, c.ctx.cid, { followup_stopped: c.body.stop ? 1 : 0 }); audit(c.ctx, 'quote', q.id, c.body.stop ? 'seguimiento_detenido' : 'seguimiento_reanudado'); });
  // PDF imprimible: documento HTML con estilos de impresión (Guardar como PDF desde el navegador)
  r.get('/api/quotes/:id/print', 'quotes:r', (c) => {
    const q = loadQuote(c.ctx, c.params.id), brand = q.brand_id ? byId(c.ctx, 'brands', q.brand_id) : null;
    return { __raw: printable(redact(q, { role: 'comercial' }), brand, byId(c.ctx, 'clients', q.client_id)), type: 'text/html; charset=utf-8',
      headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:" } };
  });

  // ------------------------------------------------------------------ cliente (enlace privado)
  const pub = (c) => {
    if (!c.limit(`q:${c.ip}`, 60, 60000)) throw new HttpError(429, 'Demasiadas peticiones');
    const x = resolveToken(db, c.params.token);
    if (!x) throw new HttpError(404, 'Este enlace no es válido o ha sido revocado', 'bad_link');
    return x;
  };
  r.get('/api/public/quote/:token', null, (c) => {
    const { ctx, quote } = pub(c);
    const out = publicView(ctx, quote.id);
    if (quote.event_id) {
      const ev = byId(ctx, 'events', quote.event_id), pt = paymentTotals(ctx, ev.id);
      out.event = { code: ev.code, date: ev.date, pax: ev.pax, booking_status: ev.booking_status, total_cents: ev.total_due_cents, paid_cents: pt.net_paid, balance_cents: Math.max(ev.total_due_cents - pt.net_paid, 0),
        services: db.all(`SELECT name,status,date,start_time FROM event_services WHERE company_id=? AND event_id=? ORDER BY date,id`, ctx.cid, ev.id),
        payments: db.all(`SELECT * FROM payments_in WHERE company_id=? AND event_id=? AND kind<>'refund' AND status IN ('pending','processing') AND token_hash IS NOT NULL`, ctx.cid, ev.id)
          .map((p) => ({ amount_cents: p.amount_cents, status: p.status, kind: p.kind, due_date: p.due_date, link: payLink(p) })) };
    }
    return out;
  });
  r.post('/api/public/quote/:token/select', null, (c) => { const { ctx, quote } = pub(c); selectExtras(ctx, quote, c.body.option_id, c.body.line_ids); return publicView(ctx, quote.id); });
  r.post('/api/public/quote/:token/changes', null, (c) => { const { ctx, quote } = pub(c); requestChanges(ctx, quote, c.body.text, c.body.name); return { ok: true }; });
  r.post('/api/public/quote/:token/accept', null, (c) => { const { ctx, quote } = pub(c); return acceptQuote(ctx, quote, { ...c.body, ip: c.ip }); });
  r.post('/api/public/quote/:token/reject', null, (c) => { const { ctx, quote } = pub(c); rejectQuote(ctx, quote, c.body.reason); return { ok: true }; });
}
