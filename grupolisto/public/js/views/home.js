import { h, get, can, eur, fdate, fdt, badge, table, card, pageHead, a, label, toast, S } from '../lib.js';

const kpi = (n, t, tone = '') => h('div', { class: `kpi ${tone}` }, h('b', null, n), h('span', null, t));
export default async function home() {
  const d = await get('/api/dashboard');
  const m = d.money;
  const el = h('div', null, pageHead(`Hola, ${S.user.name.split(' ')[0]}`, 'Resumen operativo de hoy'),
    h('div', { class: 'kpis' }, kpi(d.leads.new, 'Consultas nuevas'), kpi(d.leads.unattended.length, 'Sin atender', d.leads.unattended.length ? 'warn' : ''), kpi(d.quotes.sent_30d, 'Presupuestos enviados (30 d)'),
      kpi(d.quotes.accepted_30d, 'Aceptados (30 d)'), kpi(`${d.quotes.conversion_pct} %`, 'Conversión propuesta→aceptada'), kpi(`${d.quotes.lead_to_booking_pct} %`, 'Consulta→reserva'),
      kpi(d.pending_services.length, 'Servicios pendientes de proveedor', d.pending_services.length ? 'warn' : ''), kpi(d.overdue_in.length, 'Cobros vencidos', d.overdue_in.length ? 'bad' : ''),
      kpi(d.overdue_out.length, 'Pagos vencidos', d.overdue_out.length ? 'bad' : ''), kpi(d.incidents_open, 'Incidencias abiertas', d.incidents_open ? 'warn' : ''), kpi(d.cancellations, 'Servicios cancelados')),
    m && card('Dinero', h('div', { class: 'kpis' },
      kpi(eur(m.sales_forecast_gross_cents), 'Facturación prevista (IVA incl.)'), kpi(eur(m.sales_forecast_net_cents), 'Facturación prevista (base)'), kpi(eur(m.collected_cents), 'Cobrado (IVA incl.)'),
      kpi(eur(m.paid_out_cents), 'Pagado a proveedores'), kpi(eur(m.cash_cents), 'Caja (cobrado − pagado)'), kpi(eur(m.margin_net_cents), `Margen previsto (base) · ${m.margin_pct} %`)),
      h('p', { class: 'muted small' }, m.note)),
    h('div', { class: 'grid g2' },
      card(`Próximos eventos`, table([{ label: 'Fecha', render: (e) => fdate(e.date), nowrap: true }, { label: 'Evento', render: (e) => a(`/eventos/${e.id}`, `${e.code} · ${e.name}`) }, { label: 'Pax', key: 'pax' }, { label: 'Reserva', render: (e) => badge('booking', e.booking_status) }], d.upcoming, { empty: 'No hay eventos próximos' })),
      card('Servicios pendientes de proveedor', table([{ label: 'Servicio', render: (s) => a(`/eventos/${s.event_id}`, s.name) }, { label: 'Fecha', render: (s) => fdate(s.date) }, { label: 'Estado', render: (s) => badge('es', s.status) }], d.pending_services, { empty: 'Todo al día' })),
      card('Consultas sin atender', table([{ label: 'Consulta', render: (l) => a(`/clientes/lead/${l.id}`, l.title) }, { label: 'Cliente', key: 'client' }, { label: 'Recibida', render: (l) => fdt(l.created_at) }], d.leads.unattended, { empty: 'No hay consultas sin atender 🎉' })),
      card('Tareas e incidencias', d.tasks.length ? h('ul', { class: 'list' }, d.tasks.map((t) => h('li', null, h('span', null, t.kind === 'incident' ? h('span', { class: 'badge bad' }, 'Incidencia ') : null, ' ', t.title, t.event_code && h('span', null, ' · ', a(`/eventos/${t.event_id}`, t.event_code))), h('span', { class: 'row' }, h('small', { class: 'muted' }, fdate(t.due_at)), h('button', { class: 'btn sm', onClick: async (e) => { await (await import('../lib.js')).put(`/api/tasks/${t.id}`, { done: true }); e.target.closest('li').remove(); toast('Hecho', 'ok'); } }, '✓'))))) : h('div', { class: 'empty' }, 'Sin tareas pendientes')),
      d.overdue_in.length ? card('Cobros vencidos', table([{ label: 'Evento', render: (p) => `${p.code} · ${p.name}` }, { label: 'Vence', render: (p) => fdate(p.due_date) }, { label: 'Importe', render: (p) => eur(p.amount_cents), right: true }], d.overdue_in)) : null,
      d.overdue_out.length ? card('Pagos a proveedores vencidos', table([{ label: 'Proveedor', key: 'provider' }, { label: 'Servicio', key: 'service' }, { label: 'Vence', render: (p) => fdate(p.due_date) }, { label: 'Importe', render: (p) => eur(p.amount_cents), right: true }], d.overdue_out)) : null,
      d.expiring_holds.length ? card('Bloqueos provisionales', table([{ label: 'Servicio', render: (x) => `${x.code} · ${x.name}` }, { label: 'Caduca', render: (x) => fdt(x.expires_at) }], d.expiring_holds)) : null,
      d.cash_forecast ? card('Previsión de tesorería (6 semanas, IVA incl.)', table([{ label: 'Semana', render: (w) => `${fdate(w.from)} – ${fdate(w.to)}` }, { label: 'Cobros', render: (w) => eur(w.inflow_cents), right: true }, { label: 'Pagos', render: (w) => eur(w.outflow_cents), right: true }, { label: 'Neto', render: (w) => h('b', null, eur(w.net_cents)), right: true }], d.cash_forecast)) : null));
  return el;
}
