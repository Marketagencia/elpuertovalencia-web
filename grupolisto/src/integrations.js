// Integraciones externas. Las credenciales se guardan cifradas (AES-256-GCM) y NUNCA se devuelven al navegador.
// Sin credenciales, nada se envía ni se cobra: el estado queda como «pendiente de conectar».
import crypto from 'node:crypto';
import { encrypt, decrypt, BASE_URL } from './config.js';
import { nowIso, now, badRequest } from './util.js';

export const CATALOG = {
  email: { label: 'Email (Resend)', fields: ['api_key', 'from'], help: 'API key de Resend y remitente verificado, p. ej. «Marca <reservas@tudominio.com>».' },
  whatsapp: { label: 'WhatsApp Business (API oficial de Meta)', fields: ['phone_number_id', 'access_token', 'app_secret', 'verify_token'],
    help: 'Número de WhatsApp Cloud API, token permanente, app secret (firma de webhooks) y token de verificación. Requiere plantillas aprobadas por Meta.' },
  stripe: { label: 'Pasarela de pago (Stripe)', fields: ['secret_key', 'webhook_secret'], help: 'Clave secreta y secreto del webhook (checkout.session.completed, payment_intent.payment_failed, charge.refunded).' },
  bank: { label: 'Banco (órdenes de pago)', fields: [], pending: true, help: 'Pendiente: integración bancaria (PSD2/SEPA). Las órdenes de pago se preparan en la app pero la ejecución real requiere esta integración.' },
  ai: { label: 'Asistente IA (Claude API)', fields: ['api_key'], pending: true, help: 'Pendiente de conectar. Mientras tanto el asistente usa reglas locales (extracción y detección de datos que faltan).' },
  calendar: { label: 'Calendarios externos (sincronización de disponibilidad)', fields: [], pending: true, help: 'Pendiente (Fase 3).' },
};

export function saveConfig(ctx, key, config, enabled = true) {
  if (!CATALOG[key]) throw badRequest('Integración desconocida');
  const prev = getConfig(ctx, key).config;
  const merged = { ...prev };
  for (const f of CATALOG[key].fields) if (config[f]) merged[f] = String(config[f]).trim(); // vacío = conservar valor anterior
  ctx.db.run(`INSERT INTO integrations(company_id,key,enabled,config_enc,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(company_id,key) DO UPDATE SET enabled=excluded.enabled, config_enc=excluded.config_enc, updated_at=excluded.updated_at`,
  ctx.cid, key, enabled ? 1 : 0, encrypt(merged), nowIso());
}
const ENV = { email: () => process.env.RESEND_API_KEY && { api_key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM },
  stripe: () => process.env.STRIPE_SECRET_KEY && { secret_key: process.env.STRIPE_SECRET_KEY, webhook_secret: process.env.STRIPE_WEBHOOK_SECRET } };
export function getConfig(ctx, key) {
  const row = ctx.db.get('SELECT * FROM integrations WHERE company_id=? AND key=?', ctx.cid, key);
  let config = {};
  try { config = row ? decrypt(row.config_enc) : {}; } catch { config = {}; }
  if (!row?.enabled && ENV[key]?.()) return { enabled: true, config: ENV[key](), source: 'env' };
  return { enabled: !!row?.enabled, config, source: row ? 'db' : null };
}
export function isConnected(ctx, key) {
  if (transports[key]) return true;
  const { enabled, config } = getConfig(ctx, key);
  const need = { email: ['api_key', 'from'], whatsapp: ['phone_number_id', 'access_token'], stripe: ['secret_key'] }[key] || [];
  return enabled && need.length > 0 && need.every((f) => config[f]);
}
export function statusList(ctx) {
  return Object.entries(CATALOG).map(([key, c]) => {
    const { config } = getConfig(ctx, key);
    return { key, label: c.label, help: c.help, fields: c.fields, pending_by_design: !!c.pending && !c.fields.length,
      connected: isConnected(ctx, key), configured_fields: c.fields.filter((f) => config[f]) };
  });
}

// Transportes inyectables (tests): setTransport('email', async (msg, cfg) => ({external_id}))
export const transports = {};
export const setTransport = (ch, fn) => { if (fn) transports[ch] = fn; else delete transports[ch]; };

export async function sendEmail(msg, cfg) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST',
    headers: { Authorization: `Bearer ${cfg.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.from, to: [msg.to_addr], subject: msg.subject || '(sin asunto)', text: msg.body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${j.message || 'error'}`);
  return { external_id: j.id };
}
export async function sendWhatsapp(msg, cfg) {
  const meta = JSON.parse(msg.meta || '{}');
  const payload = meta.wa_template_name
    ? { messaging_product: 'whatsapp', to: msg.to_addr.replace(/\D/g, ''), type: 'template',
      template: { name: meta.wa_template_name, language: { code: 'es' },
        components: [{ type: 'body', parameters: (meta.wa_params || []).map((t) => ({ type: 'text', text: String(t) })) }] } }
    : { messaging_product: 'whatsapp', to: msg.to_addr.replace(/\D/g, ''), type: 'text', text: { body: msg.body } };
  const r = await fetch(`https://graph.facebook.com/v20.0/${cfg.phone_number_id}/messages`, { method: 'POST',
    headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${j.error?.message || 'error'}`);
  return { external_id: j.messages?.[0]?.id };
}

// Enlace de pago (Stripe Checkout). No se almacenan datos de tarjeta: el pago ocurre en la pasarela.
export async function createStripeCheckout(ctx, payment, label) {
  const { config } = getConfig(ctx, 'stripe');
  if (!config.secret_key) throw badRequest('Pasarela de pago pendiente de conectar', 'not_configured');
  const f = new URLSearchParams({ mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(payment.amount_cents), 'line_items[0][price_data][product_data][name]': label,
    client_reference_id: String(payment.id), 'metadata[payment_id]': String(payment.id), 'metadata[company_id]': String(ctx.cid),
    'payment_intent_data[metadata][payment_id]': String(payment.id), 'payment_intent_data[metadata][company_id]': String(ctx.cid),
    success_url: `${BASE_URL}/#/gracias`, cancel_url: `${BASE_URL}/#/gracias?cancelado=1` });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST',
    headers: { Authorization: `Bearer ${config.secret_key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `pay-${ctx.cid}-${payment.id}` },
    body: f });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${j.error?.message}`);
  return { url: j.url, session_id: j.id };
}

const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Firma de webhooks de Stripe: Stripe-Signature: t=...,v1=...  (HMAC-SHA256 de `${t}.${cuerpo}`), tolerancia 5 min
export function verifyStripeSignature(raw, header, secret, tolerance = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')).filter((p) => p.length === 2));
  const sigs = String(header).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(now().getTime() / 1000 - Number(parts.t)) > tolerance) return false;
  const exp = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some((s) => safeEq(s, exp));
}
export const stripeSign = (raw, secret, t = Math.floor(now().getTime() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
export function verifyMetaSignature(raw, header, appSecret) {
  if (!appSecret || !header) return false;
  const exp = `sha256=${crypto.createHmac('sha256', appSecret).update(raw).digest('hex')}`;
  return safeEq(String(header), exp);
}
