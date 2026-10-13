import { h, mount, get, post, put, del, can, eur, fdate, fdt, badge, table, card, pageHead, a, form, modal, fail, toast, tabs, S, opts, go, label, act, qs, confirmBox, reload } from '../lib.js';
import { messageForm } from './comms.js';

const AUTO = new Set(['booked', 'finished']);

let client_opts = [];

function newLeadForm(done, preClient) {
  const brandOpts = opts(S.brands, { empty: '— Marca por defecto —' });
  const fields = [
    { name: 'client_id', label: 'Cliente existente (opcional)', type: 'select', options: [['', '— Nuevo cliente —'], ...client_opts], value: preClient || '', span: true },
    { name: 'name', label: 'Nombre del organizador', help: 'Solo si es un cliente nuevo' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Teléfono / WhatsApp', type: 'tel' }, { name: 'company_name', label: 'Empresa (si procede)' },
    { name: 'event_type', label: 'Tipo de evento', type: 'select', options: ['Despedida', 'Cumpleaños', 'Comida de empresa', 'Cena de empresa', 'Team building', 'Celebración', 'Otro'] },
    { name: 'pax_estimated', label: 'Asistentes previstos', type: 'number', min: 1 }, { name: 'dates_alt', label: 'Fecha(s) (AAAA-MM-DD, separadas por coma)', placeholder: '2026-11-21, 2026-11-28' },
    { name: 'budget_eur', label: 'Presupuesto orientativo (€)', type: 'number', step: '0.01' }, { name: 'source', label: 'Origen', type: 'select', options: ['web', 'email', 'whatsapp', 'teléfono', 'recomendación', 'redes', 'otro'] },
    { name: 'brand_id', label: 'Marca', type: 'select', options: brandOpts }, { name: 'services_requested', label: 'Servicios solicitados', span: true },
    { name: 'notes', label: 'Notas, preferencias y necesidades del grupo', type: 'textarea', span: true },
    { name: 'consent_email', label: 'El cliente acepta recibir comunicaciones por email', type: 'checkbox', value: true, span: true }, { name: 'consent_whatsapp', label: 'El cliente acepta recibir comunicaciones por WhatsApp', type: 'checkbox', span: true },
  ];
  const f = form(fields, { submitLabel: 'Crear consulta', onCancel: () => m.close(), onSubmit: async (v) => {
    const body = { event_type: v.event_type, pax_estimated: v.pax_estimated, dates_alt: v.dates_alt, budget_eur: v.budget_eur, source: v.source, brand_id: v.brand_id || null, services_requested: v.services_requested, notes: v.notes };
    if (v.client_id) body.client_id = Number(v.client_id); else body.client = { name: v.name, email: v.email, phone: v.phone, company_name: v.company_name, consent_email: v.consent_email, consent_whatsapp: v.consent_whatsapp, contact_pref: v.consent_whatsapp && !v.consent_email ? 'whatsapp' : 'email' };
    const l = await post('/api/leads', body); m.close(); toast('Consulta creada', 'ok'); go(`/clientes/lead/${l.id}`); if (done) done(l);
  } });
  const m = modal('Nueva consulta', f, { wide: true });
}

export async function crmFunnel() {
  const [stages, leads, clients] = await Promise.all([get('/api/stages'), get('/api/leads'), get('/api/clients')]);
  client_opts = clients.map((c) => [c.id, `${c.name}${c.email ? ` · ${c.email}` : ''}`]);
  const move = async (lead, stage) => {
    const body = { stage }; const st = stages.find((s) => s.key === stage);
    if (st.kind === 'lost') { body.lost_reason = prompt('Motivo de la pérdida:') || ''; if (!body.lost_reason) return reload(); }
    try { await put(`/api/leads/${lead.id}`, body); toast('Etapa actualizada', 'ok'); } catch (e) { fail(e); } reload();
  };
  const board = h('div', { class: 'kanban' }, stages.map((s) => {
    const items = leads.filter((l) => l.stage === s.key);
    return h('div', { class: 'col' }, h('h3', null, h('span', null, s.label), h('span', null, items.length)), items.map((l) => h('div', { class: 'lead', onClick: (e) => { if (e.target.tagName !== 'SELECT') go(`/clientes/lead/${l.id}`); } },
      h('b', null, l.title), h('span', { class: 'muted small' }, `${l.client_name}${l.pax_estimated ? ` · ${l.pax_estimated} pax` : ''}`), l.dates_alt?.[0] && h('div', { class: 'small' }, `📅 ${fdate(l.dates_alt[0])}`),
      !AUTO.has(l.stage) && can('leads:w') && h('select', { 'aria-label': 'Mover de etapa', onChange: (e) => move(l, e.target.value), onClick: (e) => e.stopPropagation() }, stages.filter((x) => !AUTO.has(x.key)).map((x) => h('option', { value: x.key, selected: x.key === l.stage }, x.label))))));
  }));
  return h('div', null, pageHead('Clientes y seguimiento comercial', 'El estado comercial es independiente del estado de la reserva y del pago', can('leads:w') && h('button', { class: 'btn primary', onClick: () => newLeadForm() }, '＋ Nueva consulta')),
    tabs([{ key: 'funnel', label: 'Embudo', render: () => board },
      { key: 'clients', label: 'Clientes', render: async () => { const search = h('input', { placeholder: 'Buscar por nombre, email o empresa…', type: 'search' }); const out = h('div'); const draw = async () => mount(out, table([{ label: 'Cliente', render: (c) => a(`/clientes/c/${c.id}`, c.name) }, { label: 'Email', key: 'email' }, { label: 'Teléfono', key: 'phone' }, { label: 'Empresa', key: 'company_name' }, { label: 'Consultas', key: 'leads' }, { label: 'Eventos', key: 'events' }], await get(`/api/clients${qs({ q: search.value })}`), { empty: 'Sin clientes' })); search.addEventListener('input', draw); await draw(); return h('div', null, h('div', { class: 'mb' }, search), out); } },
      { key: 'list', label: 'Lista de consultas', render: () => table([{ label: 'Consulta', render: (l) => a(`/clientes/lead/${l.id}`, l.title) }, { label: 'Cliente', key: 'client_name' }, { label: 'Pax', key: 'pax_estimated' }, { label: 'Etapa', render: (l) => badge('x', stages.find((s) => s.key === l.stage)?.label || l.stage) }, { label: 'Origen', key: 'source' }, { label: 'Responsable', key: 'owner_name' }, { label: 'Actualizada', render: (l) => fdt(l.updated_at) }], leads) }]));
}

export async function leadView(id) {
  const d = await get(`/api/leads/${id}`);
  const { lead, client } = d; const stages = S.stages;
  const header = card(null, h('div', { class: 'pagehead' }, h('div', null, h('h1', null, lead.title), h('div', { class: 'muted' }, `Cliente: `, a(`/clientes/c/${client.id}`, client.name), ` · ${client.email || ''} ${client.phone || ''}`)),
    h('div', { class: 'row' }, can('quotes:w') && h('a', { class: 'btn primary', href: `#/presupuestos/nuevo?lead=${lead.id}&client=${client.id}` }, 'Crear presupuesto'), can('leads:w') && h('button', { class: 'btn', onClick: () => contactModal(lead) }, 'Registrar contacto'), can('comms:w') && h('button', { class: 'btn', onClick: () => messageForm({ client_id: client.id, lead_id: lead.id }) }, 'Enviar mensaje'))),
    h('div', { class: 'grid g3' }, h('div', null, h('div', { class: 'muted small' }, 'Etapa comercial'), can('leads:w') && !AUTO.has(lead.stage) ? h('select', { onChange: async (e) => { const st = stages.find((s) => s.key === e.target.value); const body = { stage: e.target.value }; if (st.kind === 'lost') body.lost_reason = prompt('Motivo de la pérdida:') || ''; try { await put(`/api/leads/${id}`, body); toast('Etapa actualizada', 'ok'); } catch (x) { fail(x); } reload(); } }, stages.map((s) => h('option', { value: s.key, selected: s.key === lead.stage }, s.label))) : badge('x', stages.find((s) => s.key === lead.stage)?.label || lead.stage)),
      h('div', null, h('div', { class: 'muted small' }, 'Tipo / origen'), `${lead.event_type || '—'} · ${lead.source || '—'}`), h('div', null, h('div', { class: 'muted small' }, 'Asistentes'), `${lead.pax_estimated ?? '—'}${lead.pax_final ? ` (definitivo ${lead.pax_final})` : ''}`),
      h('div', null, h('div', { class: 'muted small' }, 'Fechas'), (lead.dates_alt || []).map(fdate).join(', ') || '—'), h('div', null, h('div', { class: 'muted small' }, 'Presupuesto orientativo'), eur(lead.budget_cents)),
      h('div', null, h('div', { class: 'muted small' }, 'Consentimientos'), `Email: ${client.consent_email ? 'sí' : 'no'} · WhatsApp: ${client.consent_whatsapp ? 'sí' : 'no'}`)),
    lead.services_requested && h('p', null, h('b', null, 'Servicios solicitados: '), lead.services_requested), lead.notes && h('p', null, h('b', null, 'Notas: '), lead.notes), lead.lost_reason && h('div', { class: 'alert bad' }, `Motivo de pérdida: ${lead.lost_reason}`),
    can('leads:w') && h('button', { class: 'btn sm', onClick: () => editLead(lead) }, 'Editar datos'));
  const assist = can('ai:use') ? card('Asistente', h('p', { class: 'muted small' }, 'Usa solo el catálogo y los datos de tu empresa. No inventa precios ni disponibilidad. Todo borrador requiere revisión humana.'), (() => { const box = h('div'); const btn = h('button', { class: 'btn', onClick: async () => { const r = await get(`/api/leads/${id}/assist`).catch(fail); if (!r) return; mount(box, h('div', null, h('h3', null, 'Datos que faltan'), r.missing.length ? h('ul', null, r.missing.map((m) => h('li', null, m))) : h('p', null, 'Nada: la consulta está completa.'), r.risks.length ? [h('h3', null, 'Riesgos'), h('ul', null, r.risks.map((m) => h('li', null, m)))] : null,
      h('h3', null, 'Sugerencias del catálogo'), h('p', null, [...r.suggestions.packs.map((p) => `Pack: ${p.name}`), ...r.suggestions.services.map((s) => s.name)].join(' · ') || 'Sin coincidencias'), h('h3', null, 'Borrador de respuesta'), h('textarea', { rows: 8, readonly: true }, r.draft_reply), h('div', { class: 'row mt' }, h('button', { class: 'btn primary', onClick: act(async () => { const x = await post(`/api/leads/${id}/ai-proposal`); toast(x.notice, 'ok'); go(`/presupuestos/${x.quote_id}`); }) }, 'Crear borrador de propuesta con packs sugeridos')), h('small', { class: 'muted' }, `Motor: ${r.engine}`))); } }, 'Analizar consulta'); return h('div', null, btn, box); })()) : null;
  const taskBox = card('Tareas y recordatorios', d.tasks.length ? h('ul', { class: 'list' }, d.tasks.map((t) => h('li', null, h('span', { style: { textDecoration: t.done_at ? 'line-through' : '' } }, t.title, ' ', h('small', { class: 'muted' }, fdate(t.due_at))), can('tasks:w') && h('button', { class: 'btn sm', onClick: async () => { await put(`/api/tasks/${t.id}`, { done: !t.done_at }); reload(); } }, t.done_at ? 'Reabrir' : '✓')))) : h('div', { class: 'empty' }, 'Sin tareas'), can('tasks:w') && h('button', { class: 'btn sm', onClick: () => { const f = form([{ name: 'title', label: 'Tarea', required: true, span: true }, { name: 'due_at', label: 'Fecha límite', type: 'date' }], { onCancel: () => m.close(), onSubmit: async (v) => { await post('/api/tasks', { ...v, lead_id: lead.id }); m.close(); reload(); } }); const m = modal('Nueva tarea', f); } }, '＋ Tarea'));
  return h('div', null, h('p', null, a('/clientes', '← Clientes')), header, h('div', { class: 'grid g2' }, assist, taskBox,
    card('Presupuestos', table([{ label: 'Nº', render: (q) => a(`/presupuestos/${q.id}`, `${q.number} v${q.version}`) }, { label: 'Título', key: 'title' }, { label: 'Estado', render: (q) => badge('quote', q.status) }, { label: 'Válida hasta', render: (q) => fdate(q.valid_until) }], d.quotes, { empty: 'Aún sin presupuestos' })),
    card('Reservas', table([{ label: 'Evento', render: (e) => a(`/eventos/${e.id}`, `${e.code} · ${e.name}`) }, { label: 'Fecha', render: (e) => fdate(e.date) }, { label: 'Reserva', render: (e) => badge('booking', e.booking_status) }, { label: 'Cobro', render: (e) => badge('evpay', e.payment_status) }], d.events, { empty: 'Aún sin reservas' }))),
    card('Historial de llamadas, notas y mensajes', h('ul', { class: 'list timeline' }, [...d.interactions.map((i) => ({ at: i.at, t: `${i.kind} · ${i.user_name || 'cliente'}`, b: i.body })), ...d.messages.map((m) => ({ at: m.created_at, t: `${m.channel} ${m.direction === 'in' ? '← recibido' : '→ enviado'} · ${label('msg', m.status)}${m.error ? ` (${m.error})` : ''}`, b: m.subject ? `${m.subject}\n${m.body || ''}` : m.body }))].sort((x, y) => (y.at > x.at ? 1 : -1)).map((x) => h('li', null, h('div', null, h('b', null, x.t), ' ', h('small', null, fdt(x.at))), h('div', { style: { whiteSpace: 'pre-wrap' } }, x.b))) )));
}
function contactModal(lead) {
  const f = form([{ name: 'kind', label: 'Tipo', type: 'select', options: [['llamada', 'Llamada'], ['nota', 'Nota'], ['reunion', 'Reunión'], ['whatsapp_manual', 'WhatsApp (manual)'], ['email_manual', 'Email (manual)']] }, { name: 'followup_in_days', label: 'Crear recordatorio en (días)', type: 'number', min: 1 }, { name: 'body', label: 'Qué se habló', type: 'textarea', required: true, span: true }],
    { onCancel: () => m.close(), onSubmit: async (v) => { await post(`/api/leads/${lead.id}/contact`, v); m.close(); reload(); } });
  const m = modal('Registrar contacto', f);
}
function editLead(lead) {
  const f = form([{ name: 'title', label: 'Título', value: lead.title, span: true }, { name: 'event_type', label: 'Tipo de evento', value: lead.event_type }, { name: 'pax_estimated', label: 'Asistentes previstos', type: 'number', value: lead.pax_estimated }, { name: 'pax_final', label: 'Asistentes definitivos', type: 'number', value: lead.pax_final },
    { name: 'dates_alt', label: 'Fechas (AAAA-MM-DD, coma)', value: (lead.dates_alt || []).join(', ') }, { name: 'budget_eur', label: 'Presupuesto (€)', type: 'number', step: '0.01', value: lead.budget_cents != null ? lead.budget_cents / 100 : '' }, { name: 'services_requested', label: 'Servicios solicitados', value: lead.services_requested, span: true },
    { name: 'preferences', label: 'Preferencias', value: lead.preferences, span: true }, { name: 'notes', label: 'Notas', type: 'textarea', value: lead.notes, span: true }],
  { onCancel: () => m.close(), onSubmit: async (v) => { await put(`/api/leads/${lead.id}`, v); m.close(); reload(); } });
  const m = modal('Editar consulta', f, { wide: true });
}

export async function clientView(id) {
  const d = await get(`/api/clients/${id}`); const c = d.client;
  const edit = () => { const f = form([{ name: 'name', label: 'Nombre', value: c.name }, { name: 'email', label: 'Email', type: 'email', value: c.email }, { name: 'phone', label: 'Teléfono', value: c.phone }, { name: 'company_name', label: 'Empresa', value: c.company_name },
    { name: 'contact_pref', label: 'Preferencia de contacto', type: 'select', options: [['email', 'Email'], ['whatsapp', 'WhatsApp'], ['phone', 'Teléfono']], value: c.contact_pref },
    { name: 'consent_email', label: 'Consentimiento email', type: 'checkbox', value: !!c.consent_email }, { name: 'consent_whatsapp', label: 'Consentimiento WhatsApp', type: 'checkbox', value: !!c.consent_whatsapp }, { name: 'notes', label: 'Notas', type: 'textarea', value: c.notes, span: true }],
  { onCancel: () => m.close(), onSubmit: async (v) => { await put(`/api/clients/${id}`, v); m.close(); reload(); } }); const m = modal('Editar cliente', f); };
  return h('div', null, h('p', null, a('/clientes', '← Clientes')), pageHead(c.name, `${c.email || ''} ${c.phone || ''} ${c.company_name ? `· ${c.company_name}` : ''}`, can('clients:w') && h('button', { class: 'btn', onClick: edit }, 'Editar'),
    can('config:w') && h('a', { class: 'btn', href: `/api/clients/${id}/export` }, 'Exportar datos'), can('config:w') && h('button', { class: 'btn danger', onClick: async () => { if (await confirmBox('Se anonimizarán los datos personales del cliente. Se conservan los registros económicos. ¿Continuar?', { danger: true, okLabel: 'Anonimizar' })) { await post(`/api/clients/${id}/erase`).catch(fail); go('/clientes'); } } }, 'Anonimizar (supresión)')),
    c.anonymized_at && h('div', { class: 'alert warn' }, 'Datos anonimizados'),
    h('div', { class: 'grid g2' }, card('Consentimientos (registro)', d.consents.length ? h('ul', { class: 'list' }, d.consents.map((x) => h('li', null, h('span', null, `${x.channel}: ${x.granted ? 'concedido' : 'retirado'} · ${x.source || ''}`), h('small', { class: 'muted' }, fdt(x.at))))) : h('div', { class: 'empty' }, 'Sin registros')),
      card('Consultas', table([{ label: 'Consulta', render: (l) => a(`/clientes/lead/${l.id}`, l.title) }, { label: 'Etapa', key: 'stage' }], d.leads)),
      card('Presupuestos', table([{ label: 'Nº', render: (q) => a(`/presupuestos/${q.id}`, `${q.number} v${q.version}`) }, { label: 'Estado', render: (q) => badge('quote', q.status) }], d.quotes)),
      card('Eventos', table([{ label: 'Evento', render: (e) => a(`/eventos/${e.id}`, `${e.code} · ${e.name}`) }, { label: 'Fecha', render: (e) => fdate(e.date) }, { label: 'Reserva', render: (e) => badge('booking', e.booking_status) }, { label: 'Total', render: (e) => eur(e.total_due_cents), right: true }], d.events))),
    card('Mensajes', table([{ label: 'Fecha', render: (m) => fdt(m.created_at) }, { label: 'Canal', key: 'channel' }, { label: 'Asunto/Texto', render: (m) => m.subject || (m.body || '').slice(0, 80) }, { label: 'Estado', render: (m) => badge('msg', m.status) }], d.messages)));
}
