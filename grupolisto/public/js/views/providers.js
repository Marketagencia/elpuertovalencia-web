import { h, mount, get, post, put, del, can, eur, fdate, badge, table, card, pageHead, a, form, modal, fail, toast, S, opts, go, act, reload } from '../lib.js';

const WD = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const provForm = (p = null) => {
  const f = form([{ name: 'name', label: 'Nombre', value: p?.name, required: true }, { name: 'contact_name', label: 'Persona de contacto', value: p?.contact_name }, { name: 'email', label: 'Email', type: 'email', value: p?.email }, { name: 'phone', label: 'Teléfono / WhatsApp', value: p?.phone },
    { name: 'availability_mode', label: 'Disponibilidad', type: 'select', options: [['on_request', 'Bajo solicitud (el proveedor responde antes de confirmar)'], ['managed', 'Gestionada en la app (cupos, horarios y bloqueos)']], value: p?.availability_mode || 'on_request' },
    { name: 'cost_deposit_pct', label: 'Anticipo que exige el proveedor (%)', type: 'number', value: p?.cost_deposit_pct ?? 0 }, { name: 'cost_due_days_before', label: 'Saldo vence (días antes del servicio)', type: 'number', value: p?.cost_due_days_before ?? 7 },
    { name: 'payment_terms', label: 'Condiciones de liquidación', value: p?.payment_terms, span: true }, { name: 'notes', label: 'Notas', type: 'textarea', value: p?.notes, span: true }, { name: 'active', label: 'Activo', type: 'checkbox', value: p ? !!p.active : true }],
  { onCancel: () => m.close(), onSubmit: async (v) => { if (p) await put(`/api/providers/${p.id}`, v); else { const r = await post('/api/providers', v); go(`/proveedores/${r.id}`); } m.close(); toast('Proveedor guardado', 'ok'); reload(); } });
  const m = modal(p ? `Editar ${p.name}` : 'Nuevo proveedor', h('div', null, h('p', { class: 'muted small' }, 'Sin integración de calendario externo fiable, la disponibilidad compartida con otros canales exige siempre confirmación del proveedor.'), f), { wide: true });
};

export async function providersList() {
  const rows = await get('/api/providers');
  return h('div', null, pageHead('Proveedores', null, can('providers:w') && h('button', { class: 'btn primary', onClick: () => provForm() }, '＋ Nuevo proveedor')),
    card(null, table([{ label: 'Proveedor', render: (p) => a(`/proveedores/${p.id}`, p.name) }, { label: 'Contacto', render: (p) => `${p.contact_name || ''} ${p.email || ''}` }, { label: 'Disponibilidad', render: (p) => (p.availability_mode === 'managed' ? 'Cupos en la app' : 'Bajo solicitud') }, { label: 'Servicios', key: 'services' }, { label: 'Solicitudes abiertas', render: (p) => (p.open_requests ? h('span', { class: 'badge warn' }, p.open_requests) : '0') }, { label: 'Estado', render: (p) => (p.active ? badge('x', 'Activo') : badge('x', 'Inactivo')) }], rows, { onRow: (p) => go(`/proveedores/${p.id}`) })));
}

export async function providerView(id) {
  const d = await get(`/api/providers/${id}`); const p = d.provider; const W = can('providers:w'), AV = can('availability:w');
  const ruleForm = () => {
    const f = form([{ name: 'service_id', label: 'Servicio', type: 'select', options: opts(d.services) }, { name: 'start_time', label: 'Hora de inicio', type: 'time', required: true, value: '17:00' }, { name: 'weekdays', label: 'Días', type: 'checks', options: WD.map(([v, l]) => [v, l]), value: [0, 1, 2, 3, 4, 5, 6] },
      { name: 'capacity_pax', label: 'Capacidad por franja (personas)', type: 'number', required: true, min: 1 }, { name: 'shared', label: 'Disponibilidad compartida con otros canales (la agencia solo dispone de un cupo)', type: 'checkbox', span: true }, { name: 'agency_quota_pax', label: 'Cupo exclusivo de la agencia (si compartida)', type: 'number', min: 0 }],
    { onCancel: () => m.close(), onSubmit: async (v) => { await post('/api/availability/rules', { ...v, provider_id: p.id }); m.close(); reload(); } });
    const m = modal('Nueva franja con cupo', h('div', null, h('p', { class: 'muted small' }, 'Compartida y sin calendario externo: las reservas exigirán confirmación del proveedor.'), f));
  };
  const closureForm = () => {
    const f = form([{ name: 'date_from', label: 'Desde', type: 'date', required: true }, { name: 'date_to', label: 'Hasta', type: 'date', required: true }, { name: 'service_id', label: 'Servicio', type: 'select', options: [['', 'Todos'], ...opts(d.services)] }, { name: 'reason', label: 'Motivo' }],
      { onCancel: () => m.close(), onSubmit: async (v) => { await post('/api/availability/closures', { ...v, provider_id: p.id, service_id: v.service_id || null }); m.close(); reload(); } });
    const m = modal('Cierre / fechas no disponibles', f);
  };
  const userForm = () => {
    const f = form([{ name: 'name', label: 'Nombre', required: true }, { name: 'email', label: 'Email de acceso', type: 'email', required: true }, { name: 'password', label: 'Contraseña inicial (mín. 10 caracteres)', type: 'password', required: true }],
      { onCancel: () => m.close(), onSubmit: async (v) => { await post('/api/users', { ...v, role: 'proveedor', provider_id: p.id }); m.close(); toast('Acceso al portal creado', 'ok'); reload(); } });
    const m = modal('Crear acceso al portal del proveedor', f);
  };
  return h('div', null, a('/proveedores', '← Proveedores'), pageHead(p.name, `${p.availability_mode === 'managed' ? 'Disponibilidad gestionada en la app' : 'Disponibilidad bajo solicitud'} · anticipo ${p.cost_deposit_pct} % · saldo ${p.cost_due_days_before} días antes`, W && h('button', { class: 'btn', onClick: () => provForm(p) }, 'Editar'), h('a', { class: 'btn', href: `#/pagos` }, 'Pagos y liquidaciones')),
    h('div', { class: 'grid g2' }, card('Datos', h('p', null, `${p.contact_name || ''} · ${p.email || ''} · ${p.phone || ''}`), p.payment_terms && h('p', null, p.payment_terms), p.notes && h('p', { class: 'muted' }, p.notes)),
      card('Servicios que presta', table([{ label: 'Servicio', key: 'name' }, { label: 'Coste propio', render: (s) => (s.cost_cents != null ? eur(s.cost_cents) : 'del catálogo') }], d.services, { empty: 'Asígnalo desde el catálogo (Servicios)' }))),
    p.availability_mode === 'managed' && card('Cupos y horarios (gestionados en la app)', table([{ label: 'Servicio', key: 'service_name' }, { label: 'Hora', key: 'start_time' }, { label: 'Días', render: (r) => r.weekdays.split(',').map((x) => WD.find((w) => w[0] === Number(x))?.[1]).join(' ') }, { label: 'Capacidad', key: 'capacity_pax' }, { label: 'Tipo', render: (r) => (r.shared ? `Compartido · cupo agencia ${r.agency_quota_pax}` : 'Exclusivo agencia') },
      { label: '', render: (r) => AV && h('button', { class: 'btn sm danger', onClick: act(async () => { await del(`/api/availability/rules/${r.id}`); reload(); }) }, 'Eliminar') }], d.rules, { empty: 'Sin franjas: no se podrán bloquear cupos' }), AV && h('button', { class: 'btn sm mt', onClick: ruleForm }, '＋ Añadir franja')),
    card('Cierres y fechas no disponibles', table([{ label: 'Desde', render: (c) => fdate(c.date_from) }, { label: 'Hasta', render: (c) => fdate(c.date_to) }, { label: 'Motivo', key: 'reason' }, { label: '', render: (c) => AV && h('button', { class: 'btn sm danger', onClick: act(async () => { await del(`/api/availability/closures/${c.id}`); reload(); }) }, 'Eliminar') }], d.closures, { empty: 'Sin cierres' }), AV && h('button', { class: 'btn sm mt', onClick: closureForm }, '＋ Añadir cierre')),
    card('Servicios pendientes y próximos', table([{ label: 'Evento', key: 'code' }, { label: 'Servicio', render: (s) => a(`/eventos/${s.event_id}`, s.name) }, { label: 'Fecha', render: (s) => fdate(s.date) }, { label: 'Estado', render: (s) => badge('es', s.status) }], d.pending, { empty: 'Nada pendiente' })),
    can('config:w') && card('Acceso al portal', d.users.length ? h('ul', { class: 'list' }, d.users.map((u) => h('li', null, `${u.name} · ${u.email}`, u.active ? badge('x', 'activo') : badge('x', 'inactivo')))) : h('div', { class: 'empty' }, 'Sin usuarios de portal'), h('button', { class: 'btn sm', onClick: userForm }, '＋ Crear acceso')));
}
