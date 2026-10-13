import { h, mount, get, eur, table, card, pageHead, a, todayStr, addDays, qs, fdate } from '../lib.js';

export default async function reports() {
  const from = h('input', { type: 'date', value: addDays(todayStr(), -90) }), to = h('input', { type: 'date', value: addDays(todayStr(), 180) }); const out = h('div');
  const cols = (first) => [first, { label: 'Venta (IVA incl.)', render: (r) => eur(r.price_gross_cents), right: true }, { label: 'Venta (base)', render: (r) => eur(r.price_net_cents), right: true }, { label: 'Coste (base)', render: (r) => eur(r.cost_net_cents), right: true }, { label: 'Margen (base)', render: (r) => h('b', null, eur(r.margin_net_cents)), right: true }, { label: 'Margen %', render: (r) => `${r.margin_pct} %`, right: true }];
  const draw = async () => {
    const [p, d] = await Promise.all([get(`/api/reports/profitability${qs({ from: from.value, to: to.value })}`), get('/api/dashboard')]);
    const dl = (by) => h('a', { class: 'btn sm', href: `/api/reports/profitability.csv${qs({ by, from: from.value, to: to.value })}` }, 'Descargar CSV');
    mount(out, h('div', null, h('p', { class: 'muted' }, p.note),
      card('Embudo comercial', h('div', { class: 'kpis' }, d.leads.by_stage.map((s) => h('div', { class: 'kpi' }, h('b', null, s.n), h('span', null, s.stage))), h('div', { class: 'kpi' }, h('b', null, `${d.quotes.conversion_pct} %`), h('span', null, 'Propuesta → aceptada (30 d)')), h('div', { class: 'kpi' }, h('b', null, `${d.quotes.lead_to_booking_pct} %`), h('span', null, 'Consulta → reserva')))),
      card('Rentabilidad por evento', dl('event'), table([...cols({ label: 'Evento', render: (r) => a(`/eventos/${r.event_id}`, `${r.code} · ${r.name}`) }), { label: 'Cobrado', render: (r) => eur(r.collected_cents), right: true }, { label: 'Pagado a prov.', render: (r) => eur(r.paid_out_cents), right: true }, { label: 'Caja', render: (r) => eur(r.cash_cents), right: true }], p.by_event, { empty: 'Sin datos en el periodo' })),
      card('Rentabilidad por servicio', dl('service'), table(cols({ label: 'Servicio', key: 'name' }), p.by_service)), card('Rentabilidad por proveedor', dl('provider'), table(cols({ label: 'Proveedor', key: 'name' }), p.by_provider))));
  };
  from.addEventListener('change', draw); to.addEventListener('change', draw); await draw();
  return h('div', null, pageHead('Informes', 'Facturación, cobros, margen y caja se muestran por separado'), h('div', { class: 'row mb' }, h('label', null, 'Eventos del ', from), h('label', null, ' al ', to)), out);
}
