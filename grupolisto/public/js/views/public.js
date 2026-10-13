import { h, mount, get, post, eur, fdate, fdt, badge, label, table, card, form, modal, toast, fail, act, copy } from '../lib.js';

const brandHead = (b, title, sub) => h('div', { class: 'pubhead' }, b?.logo_url ? h('img', { src: b.logo_url, alt: b.name }) : null, h('div', null, h('h1', { style: { color: b?.color } }, b?.name || title), sub && h('div', { class: 'muted' }, sub)));

export async function publicQuote(token) {
  const root = h('div');
  const draw = async () => {
    const q = await get(`/api/public/quote/${token}`);
    const open = ['sent', 'changes_requested'].includes(q.status);
    let chosen = q.accepted_option_id || q.options[0]?.id;
    const optNodes = q.options.map((o) => {
      const box = h('div', { class: `option ${o.id === chosen ? 'sel' : ''}` });
      const lines = o.lines.filter((l) => l.kind !== 'pack_item' || true);
      mount(box, h('div', { class: 'row between' }, h('label', { class: 'row' }, open && q.options.length > 1 && h('input', { type: 'radio', name: 'opt', checked: o.id === chosen, onChange: () => { chosen = o.id; draw(); } }), h('h2', { style: { margin: 0 } }, o.name)), h('span', { class: 'muted' }, `${o.event_date ? fdate(o.event_date) : 'fecha por confirmar'}${o.start_time ? ` · ${o.start_time}` : ''} · ${o.pax} personas`)),
        o.notes && h('p', null, o.notes),
        h('div', { class: 'tablewrap' }, h('table', null, h('tbody', null, lines.map((l) => h('tr', { class: l.kind === 'pack_item' ? 'sub' : '' }, h('td', null, open && l.optional && l.kind !== 'pack' || (open && l.optional) ? h('input', { type: 'checkbox', checked: !!l.selected, 'aria-label': `Incluir ${l.description}`, onChange: async (e) => { const sel = o.lines.filter((x) => x.optional && (x.id === l.id ? e.target.checked : x.selected)).map((x) => x.id); try { await post(`/api/public/quote/${token}/select`, { option_id: o.id, line_ids: sel }); } catch (x) { fail(x); } draw(); } }) : null),
          h('td', null, l.kind === 'pack_item' ? '↳ ' : '', l.description, l.optional ? h('em', { class: 'muted' }, ' (opcional)') : null, l.conditions?.location && h('div', { class: 'small muted' }, `📍 ${l.conditions.location}${l.conditions.duration_min ? ` · ${l.conditions.duration_min} min` : ''}`)),
          h('td', { class: 'right nowrap' }, l.kind === 'pack_item' && !l.optional ? 'incluido' : l.selected || !l.optional ? (l.kind === 'pack_item' ? `incluido ${eur(l.total_price_cents)}` : eur(l.total_price_cents)) : h('span', { class: 'muted' }, `+ ${eur(l.total_price_cents)}`)))))) ),
        h('div', { class: 'right' }, o.discount_cents ? h('div', null, `Descuento −${eur(o.discount_cents)}`) : null, h('div', { class: 'total' }, eur(o.total_cents)), h('div', { class: 'muted small' }, `IVA incluido · base ${eur(o.net_cents)} + IVA ${eur(o.tax_cents)}`), h('div', null, `Señal (${q.deposit_pct} %): `, h('b', null, eur(o.deposit_cents)), ` · Saldo pendiente: ${eur(o.balance_cents)}`)));
      return box;
    });
    const t = q.terms || {};
    const accept = () => {
      const f = form([{ name: 'name', label: 'Tu nombre completo', required: true, span: true }, { name: 'accept_terms', label: `Acepto las condiciones de pago y cancelación y entiendo que los servicios quedan PENDIENTES DE CONFIRMACIÓN por parte de cada proveedor.`, type: 'checkbox', required: true, span: true }],
        { submitLabel: 'Aceptar propuesta', onCancel: () => m.close(), onSubmit: async (v) => { const r = await post(`/api/public/quote/${token}/accept`, { option_id: chosen, ...v }); m.close(); toast('Propuesta aceptada', 'ok'); draw(); if (r.pay_link) setTimeout(() => { location.hash = `#/pay/${r.pay_link.split('/').pop()}`; }, 600); } });
      const m = modal('Aceptar propuesta', h('div', null, h('p', null, `Aceptas la versión ${q.version} de ${q.number}${q.options.length > 1 ? `, opción «${q.options.find((o) => o.id === chosen)?.name}»` : ''}. Quedará registrada tu aceptación con fecha y hora.`), f));
    };
    const changes = () => {
      const f = form([{ name: 'name', label: 'Tu nombre' }, { name: 'text', label: '¿Qué quieres cambiar? (fecha, asistentes, servicios…)', type: 'textarea', required: true, span: true }], { submitLabel: 'Enviar solicitud', onCancel: () => m.close(), onSubmit: async (v) => { await post(`/api/public/quote/${token}/changes`, v); m.close(); toast('Hemos recibido tu solicitud. Te responderemos con una nueva propuesta.', 'ok'); draw(); } });
      const m = modal('Solicitar cambios', f);
    };
    mount(root, brandHead(q.brand, 'Propuesta', `${q.number} · versión ${q.version}`), h('h2', null, q.title), h('p', null, badge('quote', q.status), ' ', open ? `Válida hasta el ${fdate(q.valid_until)}` : ''),
      q.status === 'expired' && h('div', { class: 'alert bad' }, 'Esta propuesta ha caducado. Contacta con nosotros para renovarla.'), q.status === 'rejected' && h('div', { class: 'alert' }, 'Has rechazado esta propuesta.'),
      q.status === 'changes_requested' && h('div', { class: 'alert warn' }, 'Hemos recibido tu solicitud de cambios. Pronto te enviaremos una nueva versión.'),
      q.notes_client && h('div', { class: 'alert' }, q.notes_client), optNodes,
      open && h('div', { class: 'row mt' }, h('button', { class: 'btn primary', onClick: accept }, 'Aceptar propuesta'), h('button', { class: 'btn', onClick: changes }, 'Solicitar cambios'), h('button', { class: 'btn', onClick: act(async () => { if (confirm('¿Seguro que quieres rechazar la propuesta?')) { await post(`/api/public/quote/${token}/reject`, {}); draw(); } }) }, 'Rechazar')),
      q.event && card('Estado de tu reserva', h('p', null, h('b', null, `${q.event.code} · `), badge('booking', q.event.booking_status), ` — ${q.event.booking_status === 'confirmed' ? 'Todos los servicios están confirmados.' : 'La reserva está pendiente de confirmación: confirmaremos cada servicio con los proveedores y te avisaremos.'}`),
        table([{ label: 'Servicio', key: 'name' }, { label: 'Fecha', render: (s) => `${fdate(s.date)} ${s.start_time || ''}` }, { label: 'Estado', render: (s) => (s.status === 'confirmed' || s.status === 'done' ? badge('es', s.status) : h('span', { class: 'badge warn' }, 'Pendiente de confirmación')) }], q.event.services),
        h('p', null, `Total ${eur(q.event.total_cents)} · pagado ${eur(q.event.paid_cents)} · pendiente `, h('b', null, eur(q.event.balance_cents))), q.event.payments.map((p) => h('div', { class: 'row' }, `${p.kind === 'deposit' ? 'Señal' : 'Pago'} ${eur(p.amount_cents)} (${p.status === 'processing' ? 'en proceso de verificación' : `vence ${fdate(p.due_date)}`})`, p.link && p.status === 'pending' && h('a', { class: 'btn sm primary', href: p.link }, 'Pagar')))),
      h('div', { class: 'cond card flat mt' }, h('h3', null, 'Condiciones'), [t.payment, t.cancel, t.general, t.availability].filter(Boolean).map((x) => h('p', { class: 'small' }, x))),
      h('p', { class: 'muted small' }, 'Los precios incluyen IVA. ', q.brand?.email ? `Contacto: ${q.brand.email} ${q.brand.phone || ''}` : ''));
  };
  await draw(); return root;
}

export async function publicPay(token) {
  const p = await get(`/api/public/pay/${token}`);
  const root = h('div');
  const draw = (pp) => {
    const done = pp.status !== 'pending';
    const f = form([{ name: 'payer_name', label: 'Tu nombre', value: pp.payer_name, required: true }, { name: 'note', label: 'Referencia de la transferencia', placeholder: 'Fecha, ordenante, nº operación' }, { name: 'doc', label: 'Justificante (PDF/imagen, opcional)', type: 'file', accept: '.pdf,image/*', span: true }],
      { submitLabel: 'Ya he pagado: enviar justificante', onSubmit: async (v) => { const r = await post(`/api/public/pay/${token}/proof`, { ...v, doc: v.doc || undefined }); toast('Recibido: queda en proceso hasta que verifiquemos el ingreso', 'ok'); draw({ ...pp, status: r.status }); } });
    mount(root, brandHead(pp.brand, 'Pago'), h('h2', null, `${pp.kind === 'deposit' ? 'Señal' : pp.kind === 'participant' ? 'Tu parte del evento' : 'Saldo'} · ${pp.event.name}`), h('p', null, badge('pay', pp.status)), h('div', { class: 'total' }, eur(pp.amount_cents)), pp.due_date && h('p', { class: 'muted' }, `Vence el ${fdate(pp.due_date)}`),
      pp.status === 'verified' && h('div', { class: 'alert ok' }, 'Pago verificado. ¡Gracias!'), pp.status === 'processing' && h('div', { class: 'alert' }, 'Hemos recibido tu aviso de pago. Está en proceso: lo verificaremos en cuanto veamos el ingreso.'), ['failed', 'cancelled'].includes(pp.status) && h('div', { class: 'alert bad' }, 'Este cobro ya no está disponible.'),
      !done && h('div', null, pp.online_available && h('div', { class: 'card' }, h('h3', null, 'Pagar con tarjeta'), h('button', { class: 'btn primary', onClick: act(async () => { const r = await post(`/api/public/pay/${token}/online`); location.href = r.url; }) }, 'Pagar online de forma segura'), h('p', { class: 'muted small' }, 'Pago procesado por la pasarela; no almacenamos datos de tarjeta.')),
        h('div', { class: 'card' }, h('h3', null, 'Pagar por transferencia'), pp.brand?.iban ? h('p', null, 'IBAN: ', h('b', null, pp.brand.iban)) : h('p', { class: 'muted' }, 'Pide los datos bancarios a la agencia.'), h('p', null, 'Concepto: ', h('b', null, pp.transfer_reference)), f)),
      h('p', { class: 'muted small' }, pp.note));
  };
  draw(p); return root;
}

export async function publicProvider(token) {
  const r = await get(`/api/public/provider-request/${token}`); const p = r.payload;
  const root = h('div');
  const draw = (rr) => {
    const open = rr.status === 'sent';
    const f = form([{ name: 'response', label: 'Tu respuesta', type: 'select', options: [['confirm', 'Confirmo disponibilidad'], ['reject', 'No puedo / rechazo'], ['alternative', 'Propongo otra fecha u horario']], required: true }, { name: 'cost_eur', label: `Coste total confirmado (€) · previsto ${eur(p.proposed_cost_cents)}`, type: 'number', step: '0.01', help: 'Déjalo vacío si estás de acuerdo con el previsto.' },
      { name: 'alt_date', label: 'Alternativa: fecha', type: 'date' }, { name: 'alt_time', label: 'Alternativa: hora', type: 'time' }, { name: 'requirements', label: 'Requisitos (alergias, accesos, material…)', span: true }, { name: 'notes', label: 'Observaciones', type: 'textarea', span: true }, { name: 'doc', label: 'Documentación adjunta (PDF/imagen)', type: 'file', accept: '.pdf,image/*', span: true }],
    { submitLabel: 'Enviar respuesta', onSubmit: async (v) => { await post(`/api/public/provider-request/${token}`, { ...v, doc: v.doc || undefined }); toast('Respuesta enviada. ¡Gracias!', 'ok'); draw({ ...rr, status: 'responded', response: v.response }); } });
    mount(root, h('div', { class: 'pubhead' }, h('div', null, h('h1', null, r.brand || 'Solicitud de disponibilidad'), h('div', { class: 'muted' }, `Para ${r.provider}`))), h('p', null, badge('req', rr.status)),
      card('Datos de la solicitud', h('div', { class: 'grid g2' }, h('div', null, h('div', { class: 'muted small' }, 'Servicio'), h('b', null, p.service)), h('div', null, h('div', { class: 'muted small' }, 'Fecha y hora'), h('b', null, `${fdate(p.date)} ${p.start_time || ''}`)), h('div', null, h('div', { class: 'muted small' }, 'Asistentes'), h('b', null, p.pax)), h('div', null, h('div', { class: 'muted small' }, 'Referencia'), p.event_code), h('div', null, h('div', { class: 'muted small' }, 'Coste previsto'), eur(p.proposed_cost_cents)), h('div', null, h('div', { class: 'muted small' }, 'Responder antes del'), fdt(rr.deadline_at))),
        p.reconfirm && h('div', { class: 'alert warn' }, 'Cambio sobre una reserva anterior: necesitamos que la reconfirmes.'), p.conditions?.cancel && h('p', { class: 'small' }, `Cancelación: ${p.conditions.cancel}`), p.conditions?.payment && h('p', { class: 'small' }, `Pago: ${p.conditions.payment}`), p.conditions?.restrictions && h('p', { class: 'small' }, `Restricciones: ${p.conditions.restrictions}`)),
      open ? card('Tu respuesta', f, h('p', { class: 'muted small' }, 'Sin tu respuesta no podemos dar el servicio por reservado. Solo ves esta solicitud.')) : h('div', { class: 'alert ok' }, rr.status === 'responded' ? `Ya respondiste${rr.response ? `: ${{ confirm: 'confirmado', reject: 'rechazado', alternative: 'alternativa propuesta' }[rr.response]}` : ''}.` : 'Esta solicitud ya no está abierta.'));
  };
  draw(r); return root;
}

export async function publicChange(token) {
  const c = await get(`/api/public/change/${token}`);
  const root = h('div');
  const draw = (cc) => {
    const open = cc.status === 'pending_acceptance';
    const f = form([{ name: 'name', label: 'Tu nombre completo', required: true, span: true }], { submitLabel: 'Aceptar el cambio', onSubmit: async (v) => { await post(`/api/public/change/${token}/accept`, v); toast('Cambio aceptado. Reconfirmaremos los servicios afectados.', 'ok'); draw({ ...cc, status: 'accepted' }); } });
    mount(root, h('h1', null, `Cambio propuesto en ${cc.event.name}`), h('p', null, `${cc.before.pax} → ${cc.after.pax} personas · ${fdate(cc.before.date)} → ${fdate(cc.after.date)}`),
      table([{ label: 'Servicio', key: 'name' }, { label: 'Antes', render: (l) => (l.old ? `${l.old.pax} pax · ${eur(l.old.price)}` : 'nuevo') }, { label: 'Después', render: (l) => `${l.new.pax} pax · ${eur(l.new.price)}` }], cc.lines), h('div', { class: 'total mt' }, `Diferencia: ${eur(cc.price_delta_cents)}`), h('p', { class: 'muted' }, cc.note),
      open ? f : h('div', { class: `alert ${cc.status === 'accepted' ? 'ok' : ''}` }, cc.status === 'accepted' ? 'Cambio aceptado.' : 'Este cambio ya no está pendiente.'));
  };
  draw(c); return root;
}
export const thanks = () => h('div', { class: 'card' }, h('h1', null, '¡Gracias!'), h('p', null, 'Hemos recibido tu operación. Si el pago se ha completado, lo verás reflejado en cuanto la pasarela lo confirme.'));
