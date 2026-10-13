// Dashboard e informes. Distingue facturación (comercial), cobros, margen y caja. Los márgenes se calculan sobre BASE IMPONIBLE
// (importes sin IVA) para que sean comparables entre servicios y proveedores; los totales «con IVA» se rotulan como tales.
import { today, addDays, netOf } from './util.js';
import { paymentTotals } from './bookings.js';
import { cashForecast } from './payments.js';

const svcNums = (s) => {
  const live = s.status !== 'cancelled';
  const priceG = live ? s.price_cents : s.cancel_penalty_cents, costG = live ? s.cost_cents : s.cancel_cost_penalty_cents;
  const net = netOf(priceG, s.tax_bp), cnet = netOf(costG, s.cost_tax_bp);
  return { price_gross: priceG, price_net: net, cost_gross: costG, cost_net: cnet, margin_net: net - cnet };
};

export function dashboard(ctx, user) {
  const { db, cid } = ctx, t = today(), d30 = addDays(t, -30) + 'T00:00:00Z';
  const n = (sql, ...a) => db.get(sql, cid, ...a).n;
  const leadsByStage = db.all('SELECT stage, COUNT(*) n FROM leads WHERE company_id=? GROUP BY stage', cid);
  const unattended = db.all(`SELECT l.id, l.title, l.created_at, c.name client FROM leads l JOIN clients c ON c.id=l.client_id WHERE l.company_id=? AND l.stage='new' AND l.last_contact_at IS NULL ORDER BY l.created_at LIMIT 10`, cid);
  const sent = n(`SELECT COUNT(DISTINCT number) n FROM quotes WHERE company_id=? AND sent_at>=?`, d30);
  const accepted = n(`SELECT COUNT(DISTINCT number) n FROM quotes WHERE company_id=? AND status='accepted' AND accepted_at>=?`, d30);
  const leadsTotal = n('SELECT COUNT(*) n FROM leads WHERE company_id=?');
  const booked = n(`SELECT COUNT(*) n FROM leads WHERE company_id=? AND stage IN ('booked','finished')`);
  const upcoming = db.all(`SELECT e.id, e.code, e.name, e.date, e.pax, e.booking_status, e.payment_status, e.total_due_cents FROM events e WHERE e.company_id=? AND e.status='active' AND e.date>=? ORDER BY e.date LIMIT 8`, cid, t);
  const pendingServices = db.all(`SELECT es.id, es.name, es.status, es.date, es.event_id, e.code FROM event_services es JOIN events e ON e.id=es.event_id
    WHERE es.company_id=? AND e.status='active' AND es.status IN ('requested','pending_availability','available','rejected','held') ORDER BY es.date LIMIT 15`, cid);
  const overdueIn = db.all(`SELECT p.id, p.amount_cents, p.due_date, e.code, e.name FROM payments_in p JOIN events e ON e.id=p.event_id WHERE p.company_id=? AND p.kind<>'refund' AND p.status IN ('pending','processing') AND p.due_date<? ORDER BY p.due_date LIMIT 10`, cid, t);
  const overdueOut = db.all(`SELECT po.id, po.amount_cents, po.due_date, pr.name provider, es.name service FROM payments_out po JOIN providers pr ON pr.id=po.provider_id JOIN event_services es ON es.id=po.event_service_id
    WHERE po.company_id=? AND po.status IN ('pending','ordered') AND po.due_date<? ORDER BY po.due_date LIMIT 10`, cid, t);
  const evs = db.all(`SELECT * FROM events WHERE company_id=? AND status IN ('active','completed')`, cid);
  const svcs = db.all(`SELECT es.* FROM event_services es JOIN events e ON e.id=es.event_id WHERE es.company_id=? AND e.status IN ('active','completed')`, cid);
  let rev = 0, revNet = 0, costNet = 0, marginNet = 0;
  for (const s of svcs) { const x = svcNums(s); rev += x.price_gross; revNet += x.price_net; costNet += x.cost_net; marginNet += x.margin_net; }
  let collected = 0; for (const e of evs) collected += paymentTotals(ctx, e.id).net_paid;
  const paidOut = db.get(`SELECT COALESCE(SUM(amount_cents),0) n FROM payments_out WHERE company_id=? AND status='paid'`, cid).n;
  const tasks = db.all(`SELECT t.*, e.code event_code FROM tasks t LEFT JOIN events e ON e.id=t.event_id WHERE t.company_id=? AND t.done_at IS NULL ORDER BY (t.kind='incident') DESC, t.due_at LIMIT 12`, cid);
  const expiringHolds = db.all(`SELECT a.id, a.expires_at, es.name, e.code, a.event_service_id FROM allocations a JOIN event_services es ON es.id=a.event_service_id JOIN events e ON e.id=es.event_id
    WHERE a.company_id=? AND a.kind='hold' AND a.released_at IS NULL AND a.expires_at>? ORDER BY a.expires_at LIMIT 8`, cid, new Date().toISOString());
  return { leads: { by_stage: leadsByStage, new: leadsByStage.find((x) => x.stage === 'new')?.n || 0, unattended },
    quotes: { sent_30d: sent, accepted_30d: accepted, conversion_pct: sent ? Math.round((accepted / sent) * 1000) / 10 : 0, lead_to_booking_pct: leadsTotal ? Math.round((booked / leadsTotal) * 1000) / 10 : 0 },
    upcoming, pending_services: pendingServices, overdue_in: overdueIn, overdue_out: overdueOut, tasks, expiring_holds: expiringHolds,
    incidents_open: n(`SELECT COUNT(*) n FROM tasks WHERE company_id=? AND kind='incident' AND done_at IS NULL`),
    cancellations: n(`SELECT COUNT(*) n FROM event_services WHERE company_id=? AND status='cancelled'`),
    money: user && ['admin', 'finanzas', 'comercial'].includes(user.role) ? { sales_forecast_gross_cents: rev, sales_forecast_net_cents: revNet, collected_cents: collected, paid_out_cents: paidOut,
      cash_cents: collected - paidOut, cost_net_cents: costNet, margin_net_cents: marginNet, margin_pct: revNet ? Math.round((marginNet / revNet) * 1000) / 10 : 0,
      note: 'Facturación y cobros incluyen IVA. Costes y márgenes sobre base imponible (sin IVA). Caja = cobrado − pagado a proveedores.' } : null,
    cash_forecast: user && ['admin', 'finanzas'].includes(user.role) ? cashForecast(ctx, 6) : null };
}

export function profitability(ctx, { from, to } = {}) {
  const { db, cid } = ctx;
  const args = [cid]; let w = '';
  if (from) { w += ' AND e.date>=?'; args.push(from); }
  if (to) { w += ' AND e.date<=?'; args.push(to); }
  const rows = db.all(`SELECT es.*, e.code event_code, e.name event_name, e.date event_date, e.status event_status, p.name provider_name FROM event_services es JOIN events e ON e.id=es.event_id
    LEFT JOIN providers p ON p.id=es.provider_id WHERE es.company_id=? AND e.status IN ('active','completed') ${w}`, ...args);
  const mk = () => ({ price_gross_cents: 0, price_net_cents: 0, cost_net_cents: 0, margin_net_cents: 0 });
  const add = (g, x) => { g.price_gross_cents += x.price_gross; g.price_net_cents += x.price_net; g.cost_net_cents += x.cost_net; g.margin_net_cents += x.margin_net; };
  const fin = (g) => ({ ...g, margin_pct: g.price_net_cents ? Math.round((g.margin_net_cents / g.price_net_cents) * 1000) / 10 : 0 });
  const byEvent = {}, byService = {}, byProvider = {};
  for (const s of rows) {
    const x = svcNums(s);
    add(byEvent[s.event_id] ||= { event_id: s.event_id, code: s.event_code, name: s.event_name, date: s.event_date, status: s.event_status, ...mk() }, x);
    add(byService[s.service_id ?? `x${s.name}`] ||= { name: s.name, ...mk() }, x);
    add(byProvider[s.provider_id ?? 0] ||= { name: s.provider_name || 'Sin proveedor', ...mk() }, x);
  }
  for (const e of Object.values(byEvent)) {
    const pt = paymentTotals(ctx, e.event_id);
    e.collected_cents = pt.net_paid;
    e.paid_out_cents = db.get(`SELECT COALESCE(SUM(amount_cents),0) n FROM payments_out WHERE company_id=? AND event_id=? AND status='paid'`, cid, e.event_id).n;
    e.cash_cents = e.collected_cents - e.paid_out_cents;
  }
  return { by_event: Object.values(byEvent).map(fin), by_service: Object.values(byService).map(fin), by_provider: Object.values(byProvider).map(fin),
    note: 'Importes de venta «con IVA» y «base imponible». Costes y márgenes sobre base imponible.' };
}
