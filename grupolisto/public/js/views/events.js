import { h, mount, get, post, put, can, eur, fdate, fdt, badge, table, card, pageHead, a, form, modal, fail, toast, S, opts, go, label, act, linkModal, copy, confirmBox, reload, qs, METHOD, PAYKIND, fileDoc, CHANNEL } from '../lib.js';
import { messageForm } from './comms.js';

export async function eventsList() {
  const f = { q: '', status: '', booking_status: '' };
  const out = h('div'); const draw = async () => mount(out, table([{ label: 'Evento', render: (e) => a(`/eventos/${e.id}`, `${e.code} · ${e.name}`) }, { label: 'Cliente', key: 'client_name' }, { label: 'Fecha', render: (e) => fdate(e.date), nowrap: true }, { label: 'Pax', key: 'pax' },
    { label: 'Servicios', render: (e) => `${e.confirmed}/${e.services} confirmados` }, { label: 'Reserva', render: (e) => badge('booking', e.booking_status) }, { label: 'Cobro', render: (e) => badge('evpay', e.payment_status) }, { label: 'Total', render: (e) => eur(e.total_due_cents), right: true }],
  await get(`/api/events${qs(f)}`), { empty: 'No hay eventos. Se crean al aceptar una propuesta.', onRow: (e) => go(`/eventos/${e.id}`) }));
  await draw();
  const inp = (name, el) => { el.addEventListener('input', () => { f[name] = el.value; draw(); }); return el; };
  return h('div', null, pageHead('Eventos y reservas'), card(null, h('div', { class: 'grid g3 mb' }, inp('q', h('input', { type: 'search', placeholder: 'Buscar evento, código o cliente' })),
    inp('status', h('select', null, [['', 'Todos los estados'], ['active', 'Activos'], ['completed', 'Finalizados'], ['cancelled', 'Cancelados']].map(([v, l]) => h('option', { value: v }, l)))),
    inp('booking_status', h('select', null, [['', 'Toda reserva'], ['pending', 'Pendientes'], ['partial', 'Parcialmente confirmadas'], ['confirmed', 'Completamente confirmadas']].map(([v, l]) => h('option', { value: v }, l))))), out));
}

const kv = (k, v) => h('div', null, h('div', { class: 'muted small' }, k), h('div', null, v));

export async function eventView(id) {
  const d = await get(`/api/events/${id}`);
  const { event: ev, client, services, finance } = d;
  const live = ev.status === 'active';
  const W = can('events:w'), FIN = can('payments_in:w'), OUT = can('payments_out:w'), showCost = services.some((s) => s.cost_cents !== undefined);

  // ---------- acciones por servicio
  const svcActions = (s) => {
    const b = [];
    const call = (path, body, okMsg) => act(async () => { const r = await post(`/api/event-services/${s.id}/${path}`, body || {}); if (r?.request_link) linkModal('Solicitud enviada al proveedor', r.request_link, 'Enlace privado para que el proveedor responda (solo ve esta solicitud). Si el email no está conectado, envíaselo tú.'); else if (r?.link) linkModal('Solicitud reenviada', r.link); reload(); return r; }, okMsg);
    if (live && W) {
      if (['requested', 'rejected'].includes(s.status) && s.provider_name) b.push(h('button', { class: 'btn sm primary', onClick: call('start', {}, null) }, s.provider_mode === 'managed' ? 'Bloquear / solicitar disponibilidad' : 'Solicitar disponibilidad'));
      if (s.status === 'requested' && !s.provider_name) b.push(h('button', { class: 'btn sm primary', onClick: call('confirm', {}, 'Servicio confirmado') }, 'Confirmar servicio'));
      if (s.status === 'rejected') b.push(h('button', { class: 'btn sm', onClick: () => altModal(s) }, 'Buscar alternativa'));
      if (s.status === 'pending_availability') b.push(h('button', { class: 'btn sm', onClick: call('resend') }, 'Reenviar solicitud'));
      if (s.needs_review) b.push(h('button', { class: 'btn sm primary', onClick: call('review', { accept: true }, 'Propuesta del proveedor aceptada') }, 'Aceptar coste del proveedor'), h('button', { class: 'btn sm', onClick: call('review', { accept: false }) }, 'Rechazar'));
      else if (s.request?.alt_status === 'pending_internal') b.push(h('button', { class: 'btn sm primary', onClick: call('review', { accept: true }, 'Alternativa aceptada') }, `Aceptar alternativa (${fdate(s.request.alt_date)} ${s.request.alt_time || ''})`), h('button', { class: 'btn sm', onClick: call('review', { accept: false }) }, 'Rechazar'));
      if (['available', 'held'].includes(s.status) && !s.needs_review) b.push(h('button', { class: 'btn sm primary', onClick: call('confirm', {}, 'Servicio confirmado') }, 'Confirmar servicio'));
      if (s.status === 'confirmed' && can('ops:w')) b.push(h('button', { class: 'btn sm', onClick: call('done', {}, 'Marcado como realizado') }, 'Marcar realizado'));
      if (!['cancelled', 'done'].includes(s.status)) b.push(h('button', { class: 'btn sm danger', onClick: () => cancelModal(s) }, 'Cancelar'));
    }
    return h('div', { class: 'row' }, b);
  };
  const altModal = async (s) => {
    const alts = await get(`/api/event-services/${s.id}/alternatives`).catch(fail); if (!alts) return;
    const m = modal(`Alternativas para ${s.name}`, h('div', null, alts.length ? h('ul', { class: 'list' }, alts.map((x) => h('li', null, h('span', null, h('b', null, x.name), ' ', x.mode === 'managed' ? (x.available ? h('span', { class: 'badge ok' }, `cupo libre ${x.free}`) : h('span', { class: 'badge bad' }, x.note || 'sin cupo')) : h('span', { class: 'badge warn' }, 'bajo solicitud')), h('button', { class: 'btn sm primary', onClick: act(async () => { await post(`/api/event-services/${s.id}/reassign`, { provider_id: x.provider_id }); m.close(); reload(); }, 'Proveedor reasignado: ahora solicita disponibilidad') }, 'Usar este proveedor')))) : h('p', null, 'No hay otros proveedores para este servicio. Añade proveedores al servicio en el catálogo.')));
  };
  const cancelModal = (s) => {
    const f = form([{ name: 'by', label: '¿Quién cancela?', type: 'select', options: [['client', 'El cliente (puede aplicar penalización)'], ['agency', 'La agencia'], ['provider', 'El proveedor']] }, { name: 'waive_penalty', label: 'Condonar penalización', type: 'checkbox' }, { name: 'reason', label: 'Motivo', type: 'textarea', span: true }],
      { submitLabel: 'Cancelar servicio', onCancel: () => m.close(), onSubmit: async (v) => { const r = await post(`/api/event-services/${s.id}/cancel`, v); m.close(); toast(r.penalty_cents ? `Cancelado con penalización ${eur(r.penalty_cents)}` : 'Servicio cancelado', 'ok'); if (r.refund_suggested_cents > 0) { modal('Posible reembolso', h('div', null, h('p', null, `El cliente ha pagado ${eur(r.refund_suggested_cents)} más de lo que ahora corresponde. Puedes gestionarlo en «Cobros» → Reembolsar.`), h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/cobros' }, 'Ir a Cobros')))); } reload(); } });
    const m = modal(`Cancelar «${s.name}»`, h('div', null, h('p', { class: 'muted small' }, `Condiciones: gratuita hasta ${s.terms?.cancel_free_days ?? 0} días antes; después ${s.terms?.cancel_penalty_pct ?? 0} % del importe. Si cancela la agencia o el proveedor no hay penalización al cliente.`), f));
  };

  // ---------- modales de dinero
  const manualPay = (preset = {}) => {
    const pending = finance.balance_cents;
    const f = form([{ name: 'kind', label: 'Concepto', type: 'select', options: [['deposit', 'Señal'], ['balance', 'Saldo'], ['participant', 'Pago de participante']], value: preset.kind || (finance.paid_cents < ev.deposit_required_cents ? 'deposit' : 'balance') },
      { name: 'amount_eur', label: `Importe (€) · pendiente ${eur(pending)}`, type: 'number', step: '0.01', required: true, value: preset.amount_cents ? preset.amount_cents / 100 : (pending / 100).toFixed(2) }, { name: 'method', label: 'Método', type: 'select', options: [['transfer', 'Transferencia'], ['cash', 'Efectivo'], ['card_manual', 'TPV / tarjeta (cobro manual)']] },
      { name: 'reference', label: 'Referencia del ingreso', placeholder: 'Ordenante, fecha, nº operación' }, { name: 'payer_name', label: 'Pagador', value: preset.payer_name }, { name: 'doc', label: 'Justificante (PDF/imagen)', type: 'file', accept: '.pdf,image/*' },
      { name: 'verified', label: 'He comprobado el ingreso en el banco → marcar como VERIFICADO (si no, queda «en proceso»)', type: 'checkbox', span: true }],
    { onCancel: () => m.close(), onSubmit: async (v) => { await post(`/api/events/${id}/payments/manual`, { ...v, payment_id: preset.payment_id, doc: v.doc || undefined }); m.close(); toast('Cobro registrado', 'ok'); reload(); } });
    const m = modal('Registrar cobro', f);
  };
  const payLink = () => {
    const f = form([{ name: 'kind', label: 'Concepto', type: 'select', options: [['balance', 'Saldo'], ['deposit', 'Señal']] }, { name: 'amount_eur', label: `Importe (€) · máximo cobrable ${eur(finance.balance_cents)}`, type: 'number', step: '0.01', required: true, value: (finance.balance_cents / 100).toFixed(2) }, { name: 'payer_name', label: 'Nombre del pagador' }, { name: 'due_date', label: 'Vencimiento', type: 'date' }],
      { submitLabel: 'Crear enlace', onCancel: () => m.close(), onSubmit: async (v) => { const r = await post(`/api/events/${id}/payments`, v); m.close(); linkModal('Enlace de pago privado', r.link, 'El cliente podrá pagar online (si la pasarela está conectada) o por transferencia aportando justificante. Un justificante deja el cobro «en proceso» hasta que lo verifiques.'); reload(); } });
    const m = modal('Crear enlace de pago', f);
  };
  const participants = () => {
    const f = form([{ name: 'list', label: 'Un participante por línea: «Nombre; importe»', type: 'textarea', rows: 8, span: true, required: true, placeholder: 'Ana; 45\nLuis; 45' }],
      { submitLabel: 'Crear enlaces', onCancel: () => m.close(), onSubmit: async (v) => { const parts = v.list.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, amt] = l.split(';'); return { name: name.trim(), amount_eur: (amt || '').replace(',', '.').trim() }; }); const r = await post(`/api/events/${id}/participant-links`, { participants: parts }); m.close(); modal('Enlaces individuales', h('div', null, h('p', { class: 'muted' }, 'Cada pago reduce el saldo del mismo evento y no puede superarlo.'), h('ul', { class: 'list' }, r.map((x) => h('li', null, h('span', null, `${x.name} · ${eur(x.amount_cents)}`), h('button', { class: 'btn sm', onClick: () => copy(x.link) }, 'Copiar enlace')))))); reload(); } });
    const m = modal('Pagos individuales de participantes', f);
  };
  const refundModal = (p) => {
    const f = form([{ name: 'amount_eur', label: `Importe a reembolsar (máx. ${eur(p.amount_cents - p.refunded_cents)})`, type: 'number', step: '0.01', required: true, value: Math.max(finance.paid_cents - ev.total_due_cents, 0) / 100 || '' }, { name: 'reason', label: 'Motivo' }, { name: 'executed', label: 'El reembolso ya se ha ejecutado (banco / pasarela)', type: 'checkbox', span: true }],
      { onCancel: () => m.close(), onSubmit: async (v) => { await post(`/api/payments-in/${p.id}/refund`, v); m.close(); reload(); } });
    const m = modal('Reembolsar cobro', f);
  };
  const payOutModal = (p) => {
    const f = form([{ name: 'method', label: 'Método', type: 'select', options: [['transfer', 'Transferencia'], ['cash', 'Efectivo'], ['other', 'Otro']] }, { name: 'reference', label: 'Referencia bancaria / nº operación' }, { name: 'invoice_ref', label: 'Nº de factura del proveedor', value: p.invoice_ref }, { name: 'doc', label: 'Justificante', type: 'file', accept: '.pdf,image/*' }],
      { submitLabel: `Registrar pago de ${eur(p.amount_cents)}`, onCancel: () => m.close(), onSubmit: async (v) => { await post(`/api/payments-out/${p.id}/pay`, { ...v, doc: v.doc || undefined, idem_key: `ui-${p.id}-${p.amount_cents}` }); m.close(); toast('Pago registrado', 'ok'); reload(); } });
    const m = modal(`Registrar pago a ${p.provider_name}`, h('div', null, h('p', { class: 'muted small' }, 'Registra un pago ya realizado. La ejecución real de transferencias requiere la integración bancaria (pendiente). El proveedor recibe aviso solo cuando el pago queda registrado y verificado.'), f));
  };
  const changeModal = () => {
    const svcOpts = []; get('/api/services').then((l) => { l.filter((s) => s.active).forEach((s) => svcOpts.push([s.id, s.name])); f.inputs.add.append(...svcOpts.map(([v, t]) => h('option', { value: v }, t))); });
    const f = form([{ name: 'pax', label: `Asistentes (ahora ${ev.pax})`, type: 'number', min: 1 }, { name: 'date', label: `Fecha (ahora ${fdate(ev.date)})`, type: 'date' }, { name: 'add', label: 'Añadir servicio del catálogo', type: 'select', options: [['', '— ninguno —']] }, { name: 'note', label: 'Nota', span: true },
      { name: 'notify_client', label: 'Enviar al cliente el enlace para aceptar el cambio', type: 'checkbox', value: true, span: true }],
    { submitLabel: 'Calcular cambio', onCancel: () => m.close(), onSubmit: async (v) => { const r = await post(`/api/events/${id}/changes`, { pax: v.pax || undefined, date: v.date || undefined, add: v.add ? [{ service_id: Number(v.add) }] : [], note: v.note, notify_client: v.notify_client }); m.close(); changeResult(r); } });
    const m = modal('Proponer cambio de fecha, asistentes o servicios', h('div', null, h('p', { class: 'muted small' }, 'Se recalculan importes y se comprueba la capacidad. Nada cambia hasta que se registre la aceptación del cliente.'), f), { wide: true });
  };
  const changeResult = (r) => {
    const m = modal('Resultado del cálculo', h('div', null, h('div', { class: `alert ${r.can_apply ? 'ok' : 'bad'}` }, r.can_apply ? 'El cambio es viable.' : 'El cambio NO es viable (capacidad o límites del servicio).'),
      h('p', null, h('b', null, 'Diferencia de importe (IVA incl.): '), eur(r.price_delta_cents)),
      table([{ label: 'Servicio', key: 'name' }, { label: 'Pax/fecha', render: (x) => x.old ? `${x.old.pax} → ${x.new.pax} · ${fdate(x.old.date)} → ${fdate(x.new.date)}` : 'nuevo' }, { label: 'Importe', render: (x) => x.old ? `${eur(x.old.price)} → ${eur(x.new.price)}` : eur(x.new.price) }, { label: 'Capacidad', render: (x) => h('span', { class: `badge ${x.ok ? 'ok' : 'bad'}` }, (x.limits?.[0]) || x.capacity?.note || '—') }], r.report),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onClick: () => copy(r.link) }, 'Copiar enlace de aceptación del cliente'), r.can_apply && W && h('button', { class: 'btn primary', onClick: () => { m.close(); acceptModal(r.change_id); } }, 'Registrar aceptación del cliente'), h('button', { class: 'btn', onClick: () => { m.close(); reload(); } }, 'Cerrar'))), { wide: true });
  };
  const acceptModal = (cid) => {
    const f = form([{ name: 'by_name', label: 'Quién acepta (cliente)', required: true, value: client.name }, { name: 'note', label: 'Cómo lo ha aceptado (email, llamada, WhatsApp…)', required: true, span: true }], { submitLabel: 'Aplicar el cambio', onCancel: () => m.close(), onSubmit: async (v) => { const r = await post(`/api/changes/${cid}/accept`, v); m.close(); toast(r.reconfirm_services.length ? 'Cambio aplicado. Se ha pedido nueva confirmación a los proveedores afectados.' : 'Cambio aplicado', 'ok'); reload(); } });
    const m = modal('Registrar aceptación del cambio', f);
  };
  const docModal = () => {
    const f = form([{ name: 'doc', label: 'Archivo (PDF, PNG, JPG; máx. 5 MB)', type: 'file', required: true, accept: '.pdf,image/*' }, { name: 'kind', label: 'Tipo', type: 'select', options: [['contrato', 'Contrato'], ['programa', 'Programa/itinerario'], ['factura', 'Factura'], ['otro', 'Otro']] }, { name: 'visibility', label: 'Visible para', type: 'select', options: [['internal', 'Solo equipo'], ['client', 'Cliente'], ['provider', 'Proveedores']] }],
      { submitLabel: 'Subir', onCancel: () => m.close(), onSubmit: async (v) => { if (!v.doc) throw new Error('Elige un archivo'); await post('/api/documents', { entity: 'event', entity_id: id, name: v.doc.name, mime: v.doc.mime, data_base64: v.doc.data_base64, kind: v.kind, visibility: v.visibility }); m.close(); reload(); } });
    const m = modal('Subir documento', f);
  };

  // ---------- vista
  const confirmable = services.filter((s) => ['available', 'held'].includes(s.status) && !s.needs_review);
  const head = pageHead(`${ev.code} · ${ev.name}`, h('span', null, badge('event', ev.status), ' ', badge('booking', ev.booking_status), ' ', badge('evpay', ev.payment_status)),
    live && W && h('button', { class: 'btn primary', onClick: changeModal }, 'Proponer cambio'), live && FIN && h('button', { class: 'btn', onClick: () => manualPay() }, 'Registrar cobro'), live && FIN && h('button', { class: 'btn', onClick: payLink }, 'Crear enlace de pago'), live && FIN && h('button', { class: 'btn', onClick: participants }, 'Pagos de participantes'),
    live && W && confirmable.length > 1 && h('button', { class: 'btn', onClick: act(async () => { for (const s of confirmable) await post(`/api/event-services/${s.id}/confirm`); reload(); }, 'Servicios disponibles confirmados') }, `Confirmar ${confirmable.length} disponibles`),
    live && W && h('button', { class: 'btn danger', onClick: () => { const f = form([{ name: 'by', label: '¿Quién cancela?', type: 'select', options: [['client', 'El cliente'], ['agency', 'La agencia'], ['provider', 'Proveedor']] }, { name: 'waive_penalty', label: 'Condonar penalizaciones', type: 'checkbox' }, { name: 'reason', label: 'Motivo', type: 'textarea', span: true }], { submitLabel: 'Cancelar evento completo', onCancel: () => m.close(), onSubmit: async (v) => { const r = await post(`/api/events/${id}/cancel`, v); m.close(); toast(`Evento cancelado. Penalización: ${eur(r.penalty_cents)} · Reembolso sugerido: ${eur(r.refund_suggested_cents)}`, 'ok'); reload(); } }); const m = modal('Cancelar evento completo', f); } }, 'Cancelar evento'));
  const eco = card('Resumen', h('div', { class: 'grid g3' }, kv('Cliente', a(`/clientes/c/${client.id}`, client.name)), kv('Fecha', `${fdate(ev.date)} ${ev.start_time || ''}`), kv('Asistentes', ev.pax), kv('Total (IVA incl.)', h('b', null, eur(finance.total_cents))), kv('Cobrado', eur(finance.paid_cents)), kv('Pendiente', h('b', null, eur(finance.balance_cents))),
    kv('Señal requerida', eur(finance.deposit_required_cents)), kv('Vencimiento del saldo', fdate(ev.balance_due_date)), d.margin && kv('Margen previsto (base)', eur(d.margin.margin_net_cents))),
    h('div', { class: `alert ${ev.booking_status === 'confirmed' ? 'ok' : 'warn'}` }, d.booking_reason), d.alerts.map((x) => h('div', { class: 'alert warn' }, `⚠ ${x}`)));
  const svcCard = card(`Servicios y estado de cada proveedor`, table([
    { label: 'Servicio', render: (s) => h('div', null, h('b', null, s.name), h('div', { class: 'muted small' }, `${fdate(s.date)} ${s.start_time || ''} · ${s.pax} pax${s.mandatory ? '' : ' · opcional'}`)) },
    { label: 'Proveedor', render: (s) => h('div', null, s.provider_name || h('span', { class: 'muted' }, 'interno'), s.provider_mode && h('div', { class: 'small muted' }, s.provider_mode === 'managed' ? 'cupo en la app' : 'bajo solicitud')) },
    { label: 'Estado', render: (s) => h('div', null, badge('es', s.status), s.reconfirm ? h('div', { class: 'small' }, '↻ reconfirmar tras cambio') : null, s.hold?.kind === 'hold' && h('div', { class: 'small muted' }, `bloqueo hasta ${fdt(s.hold.expires_at)}`), s.request && h('div', { class: 'small muted' }, s.request.status === 'sent' ? `Solicitud enviada ${fdt(s.request.sent_at)} · responder antes de ${fdt(s.request.deadline_at)}` : `Proveedor: ${{ confirm: 'confirma', reject: 'rechaza', alternative: 'propone alternativa' }[s.request.response] || ''}${s.request.late ? ' (fuera de plazo)' : ''}`), s.request?.response_notes && h('div', { class: 'small' }, `“${s.request.response_notes}”`), s.request?.requirements && h('div', { class: 'small' }, `Requisitos: ${s.request.requirements}`), s.rejected_reason && s.status === 'rejected' && h('div', { class: 'small' }, s.rejected_reason), s.status === 'cancelled' && s.cancel_penalty_cents ? h('div', { class: 'small' }, `Penalización ${eur(s.cancel_penalty_cents)}`) : null, h('div', { style: { marginTop: '.4rem' } }, svcActions(s))) },
    { label: 'Venta', render: (s) => eur(s.price_cents), right: true },
    ...(showCost ? [{ label: 'Coste · margen', render: (s) => h('div', null, eur(s.cost_cents), s.margin_net_cents !== undefined && h('div', { class: 'small muted' }, `margen ${eur(s.margin_net_cents)}`), s.request?.response_cost_cents != null && s.request.response_cost_cents !== s.cost_cents ? h('div', { class: 'small' }, `proveedor propone ${eur(s.request.response_cost_cents)}`) : null), right: true }] : []),
  ], services));
  const payInCard = d.payments_in && can('payments_in:r') ? card('Cobros del cliente', table([{ label: 'Concepto', render: (p) => PAYKIND[p.kind] }, { label: 'Importe', render: (p) => eur(p.amount_cents), right: true }, { label: 'Método', render: (p) => METHOD[p.method] || p.method }, { label: 'Estado', render: (p) => [badge('pay', p.status), p.refunded_cents ? h('div', { class: 'small' }, `reembolsado ${eur(p.refunded_cents)}`) : null] }, { label: 'Vence', render: (p) => fdate(p.due_date) },
      { label: 'Referencia', render: (p) => [p.proof_note, p.payer_name && h('div', { class: 'small muted' }, p.payer_name)] },
      { label: '', render: (p) => h('div', { class: 'row' }, FIN && ['pending', 'processing'].includes(p.status) && p.kind !== 'refund' && [h('button', { class: 'btn sm primary', onClick: act(async () => { await post(`/api/payments-in/${p.id}/verify`); reload(); }, 'Cobro verificado') }, 'Verificar'), h('button', { class: 'btn sm', onClick: () => manualPay({ payment_id: p.id, kind: p.kind, amount_cents: p.amount_cents, payer_name: p.payer_name }) }, 'Registrar ingreso'), h('button', { class: 'btn sm', onClick: act(async () => { await post(`/api/payments-in/${p.id}/fail`, { reason: 'Marcado como fallido' }); reload(); }) }, 'Fallido'), h('button', { class: 'btn sm danger', onClick: act(async () => { await post(`/api/payments-in/${p.id}/cancel`); reload(); }) }, 'Anular')],
        p.link && h('button', { class: 'btn sm', onClick: () => copy(p.link) }, 'Copiar enlace'), FIN && p.kind !== 'refund' && ['verified', 'refunded'].includes(p.status) && p.refunded_cents < p.amount_cents && h('button', { class: 'btn sm', onClick: () => refundModal(p) }, 'Reembolsar'), FIN && p.kind === 'refund' && p.status === 'pending' && h('button', { class: 'btn sm primary', onClick: act(async () => { await post(`/api/payments-in/${p.id}/complete-refund`); reload(); }) }, 'Marcar ejecutado')) }], d.payments_in, { empty: 'Sin cobros' })) : null;
  const payOutCard = can('payments_out:r') ? card('Pagos y obligaciones con proveedores', table([{ label: 'Proveedor', key: 'provider_name' }, { label: 'Servicio', key: 'service_name' }, { label: 'Concepto', render: (p) => (p.kind === 'deposit' ? 'Anticipo' : 'Saldo') }, { label: 'Importe', render: (p) => eur(p.amount_cents), right: true }, { label: 'Vence', render: (p) => fdate(p.due_date) }, { label: 'Estado', render: (p) => badge('out', p.status) }, { label: 'Factura', key: 'invoice_ref' },
      { label: '', render: (p) => OUT && ['pending', 'ordered'].includes(p.status) ? h('div', { class: 'row' }, p.status === 'pending' && h('button', { class: 'btn sm', onClick: act(async () => { await post(`/api/payments-out/${p.id}/order`); reload(); }, 'Orden de pago preparada') }, 'Preparar orden'), h('button', { class: 'btn sm primary', onClick: () => payOutModal(p) }, 'Registrar pago')) : '' }], d.payments_out, { empty: 'Sin obligaciones (se generan al confirmar los servicios)' })) : null;
  const changesCard = card('Modificaciones (fecha, asistentes, servicios)', d.changes.length ? table([{ label: 'Propuesto', render: (c) => fdt(c.proposed_at) }, { label: 'Cambio', render: (c) => `${c.before_json.pax} → ${c.after_json.pax} pax · ${fdate(c.before_json.date)} → ${fdate(c.after_json.date)}` }, { label: 'Importe', render: (c) => eur(c.price_delta_cents), right: true },
    { label: 'Estado', render: (c) => h('span', { class: `badge ${c.status === 'accepted' ? 'ok' : c.status === 'pending_acceptance' ? 'warn' : ''}` }, { pending_acceptance: 'Pendiente de aceptación', accepted: 'Aceptado', rejected: 'Rechazado', superseded: 'Sustituido' }[c.status]), },
    { label: 'Aceptación', render: (c) => c.accepted_at ? `${fdt(c.accepted_at)} · ${c.accepted_by} · ${c.accepted_via === 'client_link' ? 'enlace del cliente' : 'registrado por el equipo'}` : '' },
    { label: '', render: (c) => c.status === 'pending_acceptance' && W ? h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onClick: () => acceptModal(c.id) }, 'Registrar aceptación'), h('button', { class: 'btn sm', onClick: act(async () => { await post(`/api/changes/${c.id}/reject`, {}); reload(); }) }, 'Rechazar')) : '' }], d.changes) : h('div', { class: 'empty' }, 'Sin modificaciones'));
  const tasks = card('Tareas e incidencias', d.tasks.length ? h('ul', { class: 'list' }, d.tasks.map((t) => h('li', null, h('span', { style: { textDecoration: t.done_at ? 'line-through' : '' } }, t.kind === 'incident' ? h('span', { class: 'badge bad' }, 'Incidencia ') : null, ' ', t.title), can('tasks:w') && h('button', { class: 'btn sm', onClick: async () => { await put(`/api/tasks/${t.id}`, { done: !t.done_at }); reload(); } }, t.done_at ? 'Reabrir' : 'Resolver')))) : h('div', { class: 'empty' }, 'Sin tareas'),
    can('tasks:w') && h('button', { class: 'btn sm', onClick: () => { const f = form([{ name: 'title', label: 'Descripción', required: true, span: true }, { name: 'kind', label: 'Tipo', type: 'select', options: [['incident', 'Incidencia'], ['task', 'Tarea']] }], { onCancel: () => m.close(), onSubmit: async (v) => { await post('/api/tasks', { ...v, event_id: id }); m.close(); reload(); } }); const m = modal('Nueva tarea / incidencia', f); } }, '＋ Registrar incidencia o tarea'));
  const docs = card('Documentos', d.documents.length ? h('ul', { class: 'list' }, d.documents.map((x) => h('li', null, h('span', null, x.name, ' ', h('small', { class: 'muted' }, `${x.kind || ''} · ${x.visibility}`)), h('a', { class: 'btn sm', href: `/api/documents/${x.id}/download` }, 'Descargar')))) : h('div', { class: 'empty' }, 'Sin documentos'), (can('documents:w') || W) && h('button', { class: 'btn sm', onClick: docModal }, '＋ Subir documento'));
  const comms = card('Comunicaciones del evento', table([{ label: 'Fecha', render: (m) => fdt(m.created_at) }, { label: 'Canal', render: (m) => CHANNEL[m.channel] }, { label: 'Asunto', key: 'subject' }, { label: 'Estado', render: (m) => [badge('msg', m.status), m.error && h('div', { class: 'small muted' }, m.error)] }], d.messages, { empty: 'Sin mensajes' }), can('comms:w') && h('button', { class: 'btn sm', onClick: () => messageForm({ client_id: client.id, event_id: id }) }, 'Escribir al cliente'));
  const hist = card('Historial de cambios', h('ul', { class: 'list timeline' }, d.history.map((x) => h('li', null, h('small', null, `${fdt(x.at)} · ${x.actor || ''}`), h('div', null, x.action.replace(/_/g, ' '), x.detail ? h('small', { class: 'muted' }, ` ${JSON.stringify(x.detail).slice(0, 160)}`) : null)))));
  return h('div', null, a('/eventos', '← Eventos'), head, eco, svcCard, payInCard, payOutCard, changesCard, h('div', { class: 'grid g2' }, tasks, docs), comms, hist);
}
