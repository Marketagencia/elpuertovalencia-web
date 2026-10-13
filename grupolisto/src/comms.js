// Centro de comunicaciones: plantillas, cola, reintentos, ventanas de envío, consentimientos y estados reales.
import { nowIso, now, madrid, interpolate, parseJson, plusMinutes, notFound, badRequest } from './util.js';
import { settings, audit } from './core.js';
import { getConfig, isConnected, transports, sendEmail, sendWhatsapp } from './integrations.js';

export const DEFAULT_TEMPLATES = [
  // ---- clientes
  { key: 'lead_ack', audience: 'client', subject: 'Hemos recibido tu consulta · {{marca}}', body: 'Hola {{nombre}},\n\nGracias por contactar con {{marca}}. Hemos recibido tu consulta ({{evento}}) y te responderemos lo antes posible con una propuesta.\n\nUn saludo,\n{{marca}}' },
  { key: 'quote_sent', audience: 'client', subject: 'Tu propuesta {{codigo}} · {{marca}}', body: 'Hola {{nombre}},\n\nTe enviamos la propuesta para {{evento}}. Puedes compararla, elegir extras, pedir cambios, aceptarla y pagar la señal desde este enlace privado:\n\n{{enlace}}\n\nVálida hasta el {{vence}}. La disponibilidad de cada servicio se confirma con los proveedores tras la aceptación.\n\n{{marca}}' },
  { key: 'quote_followup', audience: 'client', subject: '¿Pudiste ver la propuesta {{codigo}}?', body: 'Hola {{nombre}},\n\n¿Has podido revisar la propuesta de {{evento}}? Si quieres cambiar algo (fecha, asistentes, servicios) dínoslo y la ajustamos.\n\n{{enlace}}\n\n{{marca}}' },
  { key: 'quote_expiry', audience: 'client', subject: 'Tu propuesta {{codigo}} caduca el {{vence}}', body: 'Hola {{nombre}},\n\nTu propuesta para {{evento}} caduca el {{vence}}. Pasada esa fecha tendremos que revisar precios y disponibilidad.\n\n{{enlace}}\n\n{{marca}}' },
  { key: 'deposit_request', audience: 'client', subject: 'Señal pendiente · {{evento}}', body: 'Hola {{nombre}},\n\nGracias por aceptar la propuesta. Para continuar con la reserva necesitamos la señal de {{importe}} (vence el {{vence}}).\n\n{{enlace}}\n\nImportante: la reserva queda pendiente de confirmación por parte de los proveedores. Te avisaremos servicio a servicio.\n\n{{marca}}' },
  { key: 'deposit_reminder', audience: 'client', subject: 'Recordatorio de señal · {{evento}}', body: 'Hola {{nombre}},\n\nRecordamos que la señal de {{importe}} vence el {{vence}}.\n\n{{enlace}}\n\n{{marca}}' },
  { key: 'booking_confirmed', audience: 'client', subject: 'Reserva confirmada · {{evento}}', body: 'Hola {{nombre}},\n\n¡Tu reserva de {{evento}} ({{fecha}}, {{asistentes}} personas) está confirmada! Todos los servicios están confirmados y la señal recibida.\n\nSaldo pendiente: {{saldo}}.\n\n{{marca}}' },
  { key: 'balance_reminder', audience: 'client', subject: 'Saldo pendiente · {{evento}}', body: 'Hola {{nombre}},\n\nEl saldo pendiente de {{evento}} es de {{saldo}} y vence el {{vence}}.\n\n{{enlace}}\n\n{{marca}}' },
  { key: 'final_pax_request', audience: 'client', subject: 'Número definitivo de asistentes · {{evento}}', body: 'Hola {{nombre}},\n\nNos acercamos a la fecha ({{fecha}}). ¿Nos confirmas el número definitivo de asistentes? Ahora figuran {{asistentes}}.\n\n{{marca}}' },
  { key: 'pre_event_info', audience: 'client', subject: 'Información práctica · {{evento}}', body: 'Hola {{nombre}},\n\nMañana es el día ({{fecha}}). Te dejamos el resumen y la información práctica en este enlace:\n\n{{enlace}}\n\n{{marca}}' },
  { key: 'review_request', audience: 'client', subject: '¿Qué tal fue {{evento}}?', body: 'Hola {{nombre}},\n\nEsperamos que lo pasarais genial. ¿Nos dejas una valoración? Nos ayuda mucho.\n\n{{marca}}' },
  { key: 'change_proposal', audience: 'client', subject: 'Cambio propuesto en {{evento}}', body: 'Hola {{nombre}},\n\nTe proponemos un cambio en tu reserva ({{asistentes}} personas, {{fecha}}). Diferencia de importe: {{importe}}. Revísalo y acéptalo aquí:\n\n{{enlace}}\n\n{{marca}}' },
  // ---- proveedores
  { key: 'availability_request', audience: 'provider', subject: 'Solicitud de disponibilidad · {{servicio}} · {{fecha}}', body: 'Hola {{nombre}},\n\nSolicitamos disponibilidad para:\n· Servicio: {{servicio}}\n· Fecha y hora: {{fecha}} {{hora}}\n· Asistentes: {{asistentes}}\n· Coste previsto: {{importe}}\n· Responder antes del: {{vence}}\n\nResponde desde este enlace (confirmar, rechazar o proponer alternativa):\n{{enlace}}\n\n{{marca}}' },
  { key: 'request_reminder', audience: 'provider', subject: 'Recordatorio: respuesta pendiente · {{servicio}} {{fecha}}', body: 'Hola {{nombre}},\n\nTenemos pendiente tu respuesta para {{servicio}} el {{fecha}} ({{asistentes}} personas). Sin tu confirmación no podemos dar el servicio por reservado.\n\n{{enlace}}\n\n{{marca}}' },
  { key: 'service_confirmed', audience: 'provider', subject: 'Reserva confirmada · {{servicio}} {{fecha}}', body: 'Hola {{nombre}},\n\nConfirmamos la reserva de {{servicio}} el {{fecha}} {{hora}} para {{asistentes}} personas. Coste acordado: {{importe}}.\n\n{{marca}}' },
  { key: 'service_changed', audience: 'provider', subject: 'Cambio en la reserva · {{servicio}} {{fecha}}', body: 'Hola {{nombre}},\n\nHa habido un cambio: {{servicio}}, {{fecha}} {{hora}}, {{asistentes}} personas. Necesitamos que lo reconfirmes:\n\n{{enlace}}\n\n{{marca}}' },
  { key: 'service_cancelled', audience: 'provider', subject: 'Cancelación · {{servicio}} {{fecha}}', body: 'Hola {{nombre}},\n\nLamentamos informarte de que se cancela {{servicio}} del {{fecha}} ({{asistentes}} personas).\n\n{{marca}}' },
  { key: 'pre_event_summary', audience: 'provider', subject: 'Resumen previo · {{servicio}} {{fecha}}', body: 'Hola {{nombre}},\n\nResumen: {{servicio}} el {{fecha}} {{hora}}, {{asistentes}} personas ({{evento}}).\n\n{{marca}}' },
  { key: 'invoice_request', audience: 'provider', subject: 'Factura pendiente · {{servicio}} {{fecha}}', body: 'Hola {{nombre}},\n\nPara liquidar {{servicio}} ({{fecha}}, {{importe}}) necesitamos tu factura. Puedes subirla desde tu portal.\n\n{{enlace}}\n\n{{marca}}' },
  { key: 'payment_notice', audience: 'provider', subject: 'Pago realizado · {{servicio}}', body: 'Hola {{nombre}},\n\nHemos registrado y verificado el pago de {{importe}} correspondiente a {{servicio}} ({{fecha}}). Referencia: {{codigo}}.\n\n{{marca}}' },
];
export const TEMPLATE_VARS = ['nombre', 'evento', 'fecha', 'hora', 'asistentes', 'servicio', 'importe', 'saldo', 'enlace', 'marca', 'vence', 'codigo'];

export function seedTemplates(ctx) {
  for (const t of DEFAULT_TEMPLATES) {
    ctx.db.run(`INSERT OR IGNORE INTO templates(company_id,brand_id,key,channel,audience,subject,body,wa_template_name) VALUES(?,?,?,?,?,?,?,?)`,
      ctx.cid, null, t.key, 'email', t.audience, t.subject, t.body, null);
    ctx.db.run(`INSERT OR IGNORE INTO templates(company_id,brand_id,key,channel,audience,subject,body,wa_template_name) VALUES(?,?,?,?,?,?,?,?)`,
      ctx.cid, null, t.key, 'whatsapp', t.audience, null, t.body.replace(/\n\n/g, '\n'), null); // wa_template_name: pendiente de aprobar en Meta
  }
}

export function renderTemplate(ctx, key, channel, vars, brandId) {
  const t = (brandId && ctx.db.get('SELECT * FROM templates WHERE company_id=? AND key=? AND channel=? AND brand_id=? AND active=1', ctx.cid, key, channel, brandId))
    || ctx.db.get('SELECT * FROM templates WHERE company_id=? AND key=? AND channel=? AND brand_id IS NULL AND active=1', ctx.cid, key, channel)
    || DEFAULT_TEMPLATES.find((x) => x.key === key);
  if (!t) throw notFound(`Plantilla ${key} no encontrada`);
  return { subject: interpolate(t.subject, vars), body: interpolate(t.body, vars), wa_template_name: t.wa_template_name || null };
}

// Siguiente instante dentro de la ventana de envío (Europe/Madrid)
export function nextWindow(ctx, from = now()) {
  const { from: a, to: b } = settings(ctx).send_window;
  for (let i = 0; i < 192; i++) {
    const t = new Date(from.getTime() + i * 15 * 60000);
    const h = madrid(t).hour;
    if (h >= a && h < b) return t;
  }
  return from;
}

const lastInbound = (ctx, { client_id, provider_id }) => ctx.db.get(
  `SELECT created_at FROM messages WHERE company_id=? AND direction='in' AND ${client_id ? 'client_id=?' : 'provider_id=?'} ORDER BY id DESC LIMIT 1`,
  ctx.cid, client_id || provider_id);

/** Encola un mensaje. Evita duplicados (dedupe_key), respeta consentimientos, plantillas de WhatsApp y horario de envío. */
export function queue(ctx, o) {
  const { db, cid } = ctx;
  if (o.dedupe_key) {
    const ex = db.get('SELECT * FROM messages WHERE company_id=? AND dedupe_key=?', cid, o.dedupe_key);
    if (ex) return { ...ex, deduped: true };
  }
  const client = o.client_id ? db.get('SELECT * FROM clients WHERE id=? AND company_id=?', o.client_id, cid) : null;
  const prov = o.provider_id ? db.get('SELECT * FROM providers WHERE id=? AND company_id=?', o.provider_id, cid) : null;
  if (!client && !prov && o.channel !== 'internal') throw badRequest('Falta destinatario');
  const channel = o.channel === 'auto' ? (client?.contact_pref === 'whatsapp' && client.phone ? 'whatsapp' : 'email') : o.channel;
  const brandId = o.brand_id ?? null;
  const vars = o.vars || {};
  let subject = o.subject, body = o.body, waName = null;
  if (o.template_key) ({ subject, body, wa_template_name: waName } = renderTemplate(ctx, o.template_key, channel === 'internal' ? 'email' : channel, vars, brandId));
  const to = channel === 'email' ? (client?.email || prov?.email) : channel === 'whatsapp' ? (client?.phone || prov?.phone) : null;
  let status = 'queued', error = null, next = null;
  if (client?.anonymized_at) { status = 'blocked'; error = 'Cliente anonimizado'; }
  else if (channel !== 'internal' && !to) { status = 'blocked'; error = `Sin ${channel === 'email' ? 'email' : 'teléfono'} de destino`; }
  else if (client && channel === 'email' && !client.consent_email) { status = 'blocked'; error = 'El cliente no admite comunicaciones por email (baja o sin consentimiento)'; }
  else if (client && channel === 'whatsapp' && !client.consent_whatsapp) { status = 'blocked'; error = 'Sin consentimiento de WhatsApp'; }
  else if (channel === 'whatsapp' && !waName && !(lastInbound(ctx, o) && now() - new Date(lastInbound(ctx, o).created_at) < 864e5)) {
    status = 'blocked'; error = 'WhatsApp exige plantilla aprobada fuera de la ventana de 24 h de respuesta';
  } else if (channel === 'internal') status = 'sent';
  else if (o.automatic && !o.ignore_window) next = nextWindow(ctx).toISOString();
  else next = nowIso();
  const meta = channel === 'whatsapp' ? { wa_template_name: waName, wa_params: o.wa_params || Object.values(vars).slice(0, 5) } : null;
  const id = db.insert('messages', { company_id: cid, channel, direction: 'out', client_id: o.client_id ?? null, provider_id: o.provider_id ?? null,
    lead_id: o.lead_id ?? null, event_id: o.event_id ?? null, event_service_id: o.event_service_id ?? null, to_addr: to, subject, body,
    template_key: o.template_key ?? null, meta, status, error, next_attempt_at: next, dedupe_key: o.dedupe_key ?? null,
    automatic: o.automatic ? 1 : 0, created_by: ctx.user?.id ?? null, created_at: nowIso() });
  return db.get('SELECT * FROM messages WHERE id=?', id);
}

let chain = Promise.resolve();
/** Procesa la cola: envía por el transporte real (o inyectado), registra fallo/entrega y programa reintentos. Las pasadas se encadenan (nunca en paralelo). */
export function processQueue(db, opts) {
  const run = chain.then(() => runQueue(db, opts));
  chain = run.catch(() => {});
  return run;
}
async function runQueue(db, { limit = 50 } = {}) {
  let n = 0;
  {
    const due = db.all(`SELECT * FROM messages WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY id LIMIT ?`, nowIso(), limit);
    for (const m of due) {
      const ctx = { db, cid: m.company_id, user: null, actor: 'sistema' };
      const set = (o) => db.update('messages', m.id, m.company_id, o);
      const transport = transports[m.channel] || (isConnected(ctx, m.channel) ? (m.channel === 'email' ? sendEmail : sendWhatsapp) : null);
      if (!transport) { set({ status: 'not_configured', error: `Integración de ${m.channel} pendiente de conectar: el mensaje NO se ha enviado` }); continue; }
      try {
        const r = await transport(m, getConfig(ctx, m.channel).config);
        set({ status: 'sent', sent_at: nowIso(), external_id: r?.external_id ?? null, error: null, attempts: m.attempts + 1 }); n++;
      } catch (e) {
        const attempts = m.attempts + 1, max = settings(ctx).max_send_attempts;
        if (attempts >= max) { set({ status: 'failed', attempts, error: String(e.message || e).slice(0, 300) }); audit(ctx, 'message', m.id, 'fallo_envio', { error: e.message }); }
        else set({ attempts, error: String(e.message || e).slice(0, 300), next_attempt_at: plusMinutes(5 * 4 ** (attempts - 1)) });
      }
    }
  }
  return n;
}

export function retry(ctx, id) {
  const m = ctx.db.get('SELECT * FROM messages WHERE id=? AND company_id=?', id, ctx.cid);
  if (!m) throw notFound();
  if (!['failed', 'not_configured'].includes(m.status)) throw badRequest('Solo se pueden reintentar mensajes fallidos o pendientes de integración');
  ctx.db.update('messages', id, ctx.cid, { status: 'queued', attempts: 0, error: null, next_attempt_at: nowIso() });
  audit(ctx, 'message', id, 'reintento_manual');
}

// Mensaje entrante (WhatsApp/email/manual): se vincula al cliente o proveedor y detiene seguimientos obsoletos
export function recordInbound(ctx, { channel, from, body, external_id }) {
  const digits = String(from || '').replace(/\D/g, '');
  const client = ctx.db.get(`SELECT * FROM clients WHERE company_id=? AND (lower(email)=lower(?) OR (phone IS NOT NULL AND replace(replace(replace(phone,' ',''),'+',''),'-','') LIKE ?))`,
    ctx.cid, from || '', digits ? `%${digits.slice(-9)}` : '__none__');
  const prov = !client && ctx.db.get(`SELECT * FROM providers WHERE company_id=? AND (lower(email)=lower(?) OR (phone IS NOT NULL AND replace(replace(replace(phone,' ',''),'+',''),'-','') LIKE ?))`,
    ctx.cid, from || '', digits ? `%${digits.slice(-9)}` : '__none__');
  const lead = client && ctx.db.get(`SELECT id FROM leads WHERE company_id=? AND client_id=? ORDER BY id DESC LIMIT 1`, ctx.cid, client.id);
  const id = ctx.db.insert('messages', { company_id: ctx.cid, channel, direction: 'in', client_id: client?.id ?? null, provider_id: prov?.id ?? null,
    lead_id: lead?.id ?? null, to_addr: from, body, status: 'received', external_id: external_id ?? null, created_at: nowIso() });
  if (client) {
    ctx.db.run('UPDATE leads SET last_inbound_at=?, last_contact_at=? WHERE company_id=? AND client_id=?', nowIso(), nowIso(), ctx.cid, client.id);
    // una respuesta del cliente detiene el seguimiento automático
    ctx.db.run(`UPDATE quotes SET followup_stopped=1 WHERE company_id=? AND client_id=? AND status IN ('sent','changes_requested')`, ctx.cid, client.id);
  }
  return id;
}
