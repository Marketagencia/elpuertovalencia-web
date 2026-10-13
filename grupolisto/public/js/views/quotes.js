import { h, mount, get, post, put, can, eur, fdate, badge, table, card, pageHead, a, form, modal, fail, toast, tabs, S, opts, go, label, act, linkModal, copy, confirmBox, reload, addDays, todayStr, label as lbl } from '../lib.js';

export async function quotesList() {
  const rows = await get('/api/quotes');
  return h('div', null, pageHead('Presupuestos', 'Propuestas con varias alternativas, versiones y enlace privado para el cliente', can('quotes:w') && h('a', { class: 'btn primary', href: '#/presupuestos/nuevo' }, '＋ Crear presupuesto')),
    card(null, table([{ label: 'Nº', render: (q) => a(`/presupuestos/${q.id}`, `${q.number} v${q.version}${q.version < q.latest ? ' (antigua)' : ''}`), nowrap: true }, { label: 'Título', key: 'title' }, { label: 'Cliente', key: 'client_name' }, { label: 'Estado', render: (q) => [badge('quote', q.status), q.ai_generated && !q.reviewed_by ? h('span', { class: 'badge warn' }, ' IA sin revisar') : null] },
      { label: 'Válida hasta', render: (q) => fdate(q.valid_until) }, { label: 'Enviada', render: (q) => fdate(q.sent_at) }], rows, { empty: 'Aún no hay presupuestos', onRow: (q) => go(`/presupuestos/${q.id}`) })));
}

const blankOption = (n) => ({ name: `Opción ${n}`, pax: '', event_date: '', start_time: '17:00', discount_eur: '', notes: '', lines: [] });
function fromApi(q) {
  return { client_id: q.client_id, lead_id: q.lead_id, title: q.title, brand_id: q.brand_id || '', valid_until: q.valid_until, deposit_pct: q.deposit_pct, notes_client: q.notes_client || '',
    options: q.options.map((o) => ({ name: o.name, pax: o.pax, event_date: o.event_date || '', start_time: o.start_time || '', discount_eur: o.discount_cents ? o.discount_cents / 100 : '', notes: o.notes || '',
      lines: o.lines.filter((l) => l.kind !== 'pack_item').map((l) => ({ kind: l.kind, service_id: l.service_id, pack_id: l.pack_id, description: l.description, qty: l.qty, pax: l.pax && l.pax !== o.pax ? l.pax : '', optional: !!l.optional, start_time: l.start_time || '',
        provider_id: l.provider_id, price_eur: l.kind === 'extra' ? l.unit_price_cents / 100 : '', cost_eur: l.kind === 'extra' ? (l.unit_cost_cents ?? 0) / 100 : '',
        items_selected: l.kind === 'pack' ? o.lines.filter((x) => x.parent_line_id === l.id && x.optional && x.selected).map((x) => x.service_id) : [] })) })) };
}
const toApi = (st) => ({ client_id: st.client_id, lead_id: st.lead_id, title: st.title, brand_id: st.brand_id || null, valid_until: st.valid_until, deposit_pct: st.deposit_pct, notes_client: st.notes_client,
  options: st.options.map((o) => ({ name: o.name, pax: o.pax, event_date: o.event_date || null, start_time: o.start_time || null, discount_cents: Math.round(Number(o.discount_eur || 0) * 100), notes: o.notes,
    lines: o.lines.map((l) => (l.kind === 'extra' ? { kind: 'extra', description: l.description, qty: l.qty || 1, price_cents: Math.round(Number(String(l.price_eur).replace(',', '.') || 0) * 100), cost_cents: Math.round(Number(String(l.cost_eur).replace(',', '.') || 0) * 100), optional: l.optional, start_time: l.start_time }
      : l.kind === 'pack' ? { kind: 'pack', pack_id: l.pack_id, optional: l.optional, start_time: l.start_time || null, items_selected: l.items_selected }
        : { kind: 'service', service_id: l.service_id, provider_id: l.provider_id || undefined, qty: l.qty || 1, pax: l.pax || undefined, optional: l.optional, start_time: l.start_time || undefined })) })) });

export async function quoteEditor(idParam, query) {
  const isNew = idParam === 'nuevo';
  const [services, packs, clients] = await Promise.all([get('/api/services'), get('/api/packs'), isNew ? get('/api/clients') : Promise.resolve([])]);
  let q = isNew ? null : await get(`/api/quotes/${idParam}`);
  let st = isNew ? { client_id: query.client ? Number(query.client) : '', lead_id: query.lead ? Number(query.lead) : null, title: '', brand_id: '', valid_until: addDays(todayStr(), 15), deposit_pct: 30, notes_client: '', options: [blankOption(1)] } : fromApi(q);
  const editable = isNew || q.status === 'draft';
  const margins = can('margins:r');
  const root = h('div'); const body = h('div');

  const draw = () => {
    const optNodes = st.options.map((o, oi) => {
      const server = q?.options?.[oi];
      const lineRows = o.lines.map((l, li) => {
        const rm = editable && h('button', { class: 'btn sm danger', type: 'button', onClick: () => { o.lines.splice(li, 1); draw(); } }, '✕');
        const bind = (k, type = 'text', extra = {}) => h('input', { type, value: l[k] ?? '', disabled: !editable, 'aria-label': k, onInput: (e) => { l[k] = type === 'checkbox' ? e.target.checked : e.target.value; }, ...extra });
        const opt = h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: l.optional, disabled: !editable, onChange: (e) => { l.optional = e.target.checked; } }), 'Opcional');
        if (l.kind === 'service') {
          const svc = services.find((s) => s.id === l.service_id);
          return h('tr', null, h('td', null, h('b', null, l.description || svc?.name), svc && h('div', { class: 'muted small' }, `${svc.min_pax}–${svc.max_pax || '∞'} pax`)),
            h('td', null, svc?.providers?.length ? h('select', { disabled: !editable, onChange: (e) => { l.provider_id = Number(e.target.value); } }, svc.providers.map((p) => h('option', { value: p.provider_id, selected: p.provider_id === l.provider_id }, p.name))) : h('span', { class: 'muted' }, 'sin proveedor')),
            h('td', null, bind('qty', 'number', { min: 1, style: { width: '70px' } })), h('td', null, bind('pax', 'number', { min: 1, placeholder: 'igual', style: { width: '80px' } })), h('td', null, bind('start_time', 'time')), h('td', null, opt), h('td', null, rm));
        }
        if (l.kind === 'pack') {
          const pk = packs.find((p) => p.id === l.pack_id);
          return h('tr', null, h('td', null, h('b', null, `📦 ${l.description || pk?.name}`), h('div', { class: 'muted small' }, 'Incluye: ', (pk?.items || []).filter((i) => !i.optional).map((i) => i.service_name).join(' + ')), (pk?.items || []).filter((i) => i.optional).map((i) => h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: l.items_selected.includes(i.service_id), disabled: !editable, onChange: (e) => { l.items_selected = e.target.checked ? [...l.items_selected, i.service_id] : l.items_selected.filter((x) => x !== i.service_id); } }), `Extra opcional: ${i.service_name}`))),
            h('td', { class: 'muted small' }, 'según servicio'), h('td', null, '—'), h('td', null, '—'), h('td', null, bind('start_time', 'time')), h('td', null, opt), h('td', null, rm));
        }
        return h('tr', null, h('td', null, bind('description', 'text', { placeholder: 'Descripción del extra' })), h('td', null, h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Venta €'), bind('price_eur', 'number', { step: '0.01', style: { width: '90px' } }), margins && [h('span', { class: 'small muted' }, 'Coste €'), bind('cost_eur', 'number', { step: '0.01', style: { width: '90px' } })])),
          h('td', null, bind('qty', 'number', { min: 1, style: { width: '70px' } })), h('td', null, '—'), h('td', null, '—'), h('td', null, opt), h('td', null, rm));
      });
      const sSel = h('select', null, h('option', { value: '' }, '＋ Añadir servicio…'), services.filter((s) => s.active).map((s) => h('option', { value: s.id }, `${s.name}`)));
      const pSel = h('select', null, h('option', { value: '' }, '＋ Añadir pack…'), packs.filter((p) => p.active).map((p) => h('option', { value: p.id }, p.name)));
      sSel.addEventListener('change', () => { const s = services.find((x) => x.id === Number(sSel.value)); if (s) { o.lines.push({ kind: 'service', service_id: s.id, description: s.name, qty: 1, pax: '', optional: false, start_time: '', provider_id: s.providers[0]?.provider_id }); draw(); } });
      pSel.addEventListener('change', () => { const p = packs.find((x) => x.id === Number(pSel.value)); if (p) { o.lines.push({ kind: 'pack', pack_id: p.id, description: p.name, qty: 1, optional: false, start_time: '', items_selected: [] }); draw(); } });
      const t = server?.totals;
      return h('div', { class: 'card' }, h('div', { class: 'grid g3' },
        h('label', { class: 'f' }, h('span', null, 'Nombre de la opción'), h('input', { value: o.name, disabled: !editable, onInput: (e) => { o.name = e.target.value; } })),
        h('label', { class: 'f' }, h('span', null, 'Asistentes *'), h('input', { type: 'number', min: 1, value: o.pax, disabled: !editable, onInput: (e) => { o.pax = e.target.value; } })),
        h('label', { class: 'f' }, h('span', null, 'Fecha'), h('input', { type: 'date', value: o.event_date, disabled: !editable, onInput: (e) => { o.event_date = e.target.value; } })),
        h('label', { class: 'f' }, h('span', null, 'Hora de inicio'), h('input', { type: 'time', value: o.start_time, disabled: !editable, onInput: (e) => { o.start_time = e.target.value; } })),
        h('label', { class: 'f' }, h('span', null, 'Descuento (€, IVA incl.)'), h('input', { type: 'number', step: '0.01', min: 0, value: o.discount_eur, disabled: !editable, onInput: (e) => { o.discount_eur = e.target.value; } })),
        h('label', { class: 'f' }, h('span', null, 'Notas para el cliente'), h('input', { value: o.notes, disabled: !editable, onInput: (e) => { o.notes = e.target.value; } }))),
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Servicio / concepto', 'Proveedor · precios', 'Cant.', 'Pax', 'Hora', '', ''].map((x) => h('th', null, x)))), h('tbody', null, lineRows))),
      editable && h('div', { class: 'row mt' }, sSel, pSel, h('button', { class: 'btn sm', type: 'button', onClick: () => { o.lines.push({ kind: 'extra', description: '', qty: 1, price_eur: '', cost_eur: '', optional: false }); draw(); } }, '＋ Extra libre'), st.options.length > 1 && h('button', { class: 'btn sm danger', type: 'button', onClick: () => { st.options.splice(oi, 1); draw(); } }, 'Quitar opción')),
      t && h('div', { class: 'mt alert' }, h('div', { class: 'total' }, `Total ${eur(t.total_cents)} `, h('small', { class: 'muted' }, '(IVA incluido)')), `Base imponible ${eur(t.net_cents)} · IVA ${eur(t.tax_cents)}${t.discount_cents ? ` · Descuento −${eur(t.discount_cents)}` : ''} · Señal ${st.deposit_pct} %: ${eur(server.deposit_cents)} · Saldo: ${eur(server.balance_cents)}`,
        t.margin_net_cents !== undefined && h('div', { class: 'small' }, `Coste (IVA incl.) ${eur(t.cost_cents)} · Margen sobre base: ${eur(t.margin_net_cents)} (${t.margin_pct} %)`)));
    });
    mount(body, h('div', { class: 'card' }, h('div', { class: 'grid g2' },
      isNew ? h('label', { class: 'f' }, h('span', null, 'Cliente *'), h('select', { onChange: (e) => { st.client_id = Number(e.target.value); } }, h('option', { value: '' }, '— Elige un cliente —'), clients.map((c) => h('option', { value: c.id, selected: c.id === st.client_id }, `${c.name}${c.email ? ` · ${c.email}` : ''}`)))) : h('div', null, h('div', { class: 'muted small' }, 'Cliente'), a(`/clientes/c/${q.client_id}`, q.client?.name)),
      h('label', { class: 'f' }, h('span', null, 'Título'), h('input', { value: st.title, disabled: !editable, onInput: (e) => { st.title = e.target.value; } })),
      h('label', { class: 'f' }, h('span', null, 'Marca comercial'), h('select', { disabled: !editable, onChange: (e) => { st.brand_id = e.target.value; } }, h('option', { value: '' }, '— Por defecto —'), S.brands.map((b) => h('option', { value: b.id, selected: String(b.id) === String(st.brand_id) }, b.name)))),
      h('label', { class: 'f' }, h('span', null, 'Válida hasta'), h('input', { type: 'date', value: st.valid_until, disabled: !editable, onInput: (e) => { st.valid_until = e.target.value; } })),
      h('label', { class: 'f' }, h('span', null, 'Señal (%)'), h('input', { type: 'number', min: 0, max: 100, value: st.deposit_pct, disabled: !editable, onInput: (e) => { st.deposit_pct = e.target.value; } })),
      h('label', { class: 'f' }, h('span', null, 'Información para el organizador'), h('input', { value: st.notes_client, disabled: !editable, onInput: (e) => { st.notes_client = e.target.value; } })))), optNodes,
    editable && h('button', { class: 'btn', type: 'button', onClick: () => { st.options.push(blankOption(st.options.length + 1)); draw(); } }, '＋ Añadir otra opción'));
  };
  const save = async () => { const out = isNew ? await post('/api/quotes', toApi(st)) : await put(`/api/quotes/${q.id}`, toApi(st)); toast('Presupuesto guardado', 'ok'); return out; };
  const head = () => {
    const buttons = [];
    if (editable) buttons.push(h('button', { class: 'btn primary', onClick: act(async () => { const out = await save(); if (isNew) go(`/presupuestos/${out.id}`); else { q = await get(`/api/quotes/${q.id}`); st = fromApi(q); draw(); } }) }, 'Guardar'));
    if (!isNew) {
      if (q.status === 'draft' && can('quotes:w')) buttons.push(h('button', { class: 'btn primary', onClick: act(async () => { await save(); const r = await post(`/api/quotes/${q.id}/send`); const m = r.message; linkModal('Propuesta enviada · enlace privado del cliente', r.link, m ? `Mensaje al cliente: ${lbl('msg', m.status)}${m.error ? ` — ${m.error}` : ''}. ${m.status !== 'sent' && m.status !== 'delivered' ? 'El email NO se ha enviado: copia el enlace y envíalo por tu canal habitual.' : ''}` : ''); reload(); }) }, 'Enviar propuesta'));
      if (['sent', 'changes_requested', 'expired'].includes(q.status)) buttons.push(h('button', { class: 'btn', onClick: act(async () => { const r = await post(`/api/quotes/${q.id}/send`); linkModal('Propuesta reenviada · nuevo enlace', r.link, `Mensaje: ${r.message ? lbl('msg', r.message.status) : '—'}`); reload(); }) }, 'Reenviar'));
      if (['sent', 'changes_requested', 'rejected', 'expired'].includes(q.status) && can('quotes:w')) buttons.push(h('button', { class: 'btn', onClick: act(async () => { const v = await post(`/api/quotes/${q.id}/version`); toast(`Versión ${v.version} creada`, 'ok'); go(`/presupuestos/${v.id}`); }) }, 'Nueva versión'));
      buttons.push(h('a', { class: 'btn', href: `/api/quotes/${q.id}/print`, target: '_blank', rel: 'noopener' }, 'PDF / imprimir'));
      if (q.link) buttons.push(h('button', { class: 'btn', onClick: () => copy(q.link) }, 'Copiar enlace'), h('button', { class: 'btn danger', onClick: act(async () => { await post(`/api/quotes/${q.id}/revoke-link`); reload(); }, 'Enlace revocado') }, 'Revocar enlace'));
      if (['sent', 'changes_requested'].includes(q.status)) buttons.push(h('button', { class: 'btn', onClick: act(async () => { await post(`/api/quotes/${q.id}/followup`, { stop: !q.followup_stopped }); reload(); }) }, q.followup_stopped ? 'Reanudar seguimiento' : 'Detener seguimiento'));
      if (q.ai_generated && !q.reviewed_by && can('quotes:w')) buttons.push(h('button', { class: 'btn primary', onClick: act(async () => { await post(`/api/quotes/${q.id}/review`); reload(); }, 'Marcada como revisada') }, 'He revisado este borrador de IA'));
      if (q.event_id) buttons.push(h('a', { class: 'btn', href: `#/eventos/${q.event_id}` }, 'Ver reserva'));
    }
    return pageHead(isNew ? 'Nuevo presupuesto' : `${q.number} · versión ${q.version}`, isNew ? null : h('span', null, badge('quote', q.status), ' ', q.accepted_at ? `Aceptada ${fdate(q.accepted_at)} por ${q.accepted_by_name} (v${q.accepted_version})` : ''), ...buttons);
  };
  mount(root, a('/presupuestos', '← Presupuestos'), head(), !isNew && !!q.ai_generated && !q.reviewed_by && h('div', { class: 'alert warn' }, '⚠ Borrador generado con el asistente: requiere revisión humana antes de enviarse.'), !isNew && !editable && h('div', { class: 'alert' }, 'Esta versión ya no se edita. Crea una nueva versión para cambiarla; los precios y condiciones quedan congelados en cada versión.'), body,
    !isNew && q.versions.length > 1 && card('Versiones', h('div', { class: 'row' }, q.versions.map((v) => h('a', { class: 'btn sm', href: `#/presupuestos/${v.id}` }, `v${v.version} · ${lbl('quote', v.status)}`)))));
  draw(); return root;
}
