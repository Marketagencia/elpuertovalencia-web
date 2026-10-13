import { h, mount, get, a, fdate, badge, table, pageHead, card, todayStr, addDays, qs, label } from '../lib.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const mondayOf = (d) => { const x = new Date(`${d}T00:00:00Z`); const w = (x.getUTCDay() + 6) % 7; return addDays(d, -w); };

export default async function calendar() {
  const providers = await get('/api/providers');
  const st = { view: 'month', date: todayStr(), provider_id: '', status: '' };
  const box = h('div');
  const range = () => {
    if (st.view === 'day') return [st.date, st.date];
    if (st.view === 'week') { const m = mondayOf(st.date); return [m, addDays(m, 6)]; }
    const first = `${st.date.slice(0, 8)}01`; const m = mondayOf(first); const next = new Date(`${first}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1); const last = addDays(next.toISOString().slice(0, 10), -1);
    return [m, addDays(mondayOf(last), 6)];
  };
  const chip = (s) => h('a', { class: `chip ${s.status}`, href: `#/eventos/${s.event_id}`, title: `${s.code} · ${s.name} · ${label('es', s.status)} · ${s.provider_name || 'interno'}` }, `${s.start_time || ''} ${s.name.replace(/ \[DEMO\]/, '')} (${s.pax})`);
  const draw = async () => {
    const [from, to] = range();
    const rows = await get(`/api/calendar${qs({ from, to, provider_id: st.provider_id, status: st.status })}`);
    const by = {}; rows.forEach((r) => (by[r.date] ||= []).push(r));
    let view;
    if (st.view === 'month') {
      const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      view = h('div', { class: 'cal' }, DOW.map((x) => h('div', { class: 'dow' }, x)), days.map((d) => h('div', { class: `day ${d.slice(0, 7) !== st.date.slice(0, 7) ? 'off' : ''} ${d === todayStr() ? 'today' : ''}` }, h('b', null, Number(d.slice(8))), (by[d] || []).map(chip))));
    } else {
      const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      view = h('div', null, days.map((d) => card(`${fdate(d)}${d === todayStr() ? ' · hoy' : ''}`, (by[d] || []).length ? table([{ label: 'Hora', render: (s) => s.start_time || '—' }, { label: 'Servicio', render: (s) => a(`/eventos/${s.event_id}`, s.name) }, { label: 'Evento', render: (s) => `${s.code} · ${s.event_name}` }, { label: 'Proveedor', render: (s) => s.provider_name || 'interno' }, { label: 'Pax', key: 'pax' }, { label: 'Estado', render: (s) => badge('es', s.status) }], by[d]) : h('div', { class: 'muted' }, 'Sin servicios'))));
    }
    const title = st.view === 'month' ? `${MONTHS[Number(st.date.slice(5, 7)) - 1]} ${st.date.slice(0, 4)}` : st.view === 'week' ? `Semana del ${fdate(from)}` : fdate(st.date);
    const step = (n) => { if (st.view === 'month') { const d = new Date(`${st.date.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); st.date = d.toISOString().slice(0, 10); } else st.date = addDays(st.date, n * (st.view === 'week' ? 7 : 1)); draw(); };
    mount(box, h('div', { class: 'row between mb' }, h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => step(-1) }, '←'), h('b', { style: { minWidth: '9rem', textAlign: 'center' } }, title), h('button', { class: 'btn', onClick: () => step(1) }, '→'), h('button', { class: 'btn', onClick: () => { st.date = todayStr(); draw(); } }, 'Hoy')),
      h('div', { class: 'row' }, ['day', 'week', 'month'].map((v) => h('button', { class: `btn ${st.view === v ? 'primary' : ''}`, onClick: () => { st.view = v; draw(); } }, { day: 'Día', week: 'Semana', month: 'Mes' }[v])))), view);
  };
  await draw();
  const sel = (key, opts) => h('select', { onChange: (e) => { st[key] = e.target.value; draw(); } }, opts.map(([v, l]) => h('option', { value: v }, l)));
  return h('div', null, pageHead('Calendario', 'Servicios de todos los eventos por fecha'), h('div', { class: 'row mb' }, sel('provider_id', [['', 'Todos los proveedores'], ...providers.map((p) => [p.id, p.name])]), sel('status', [['', 'Todos los estados'], ...['requested', 'pending_availability', 'available', 'held', 'confirmed', 'rejected', 'done'].map((s) => [s, label('es', s)])])), box);
}
