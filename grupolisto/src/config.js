import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.GL_DATA_DIR || path.join(ROOT, 'data');
export const PORT = Number(process.env.PORT || 3100);
export const BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

// Clave maestra para cifrar credenciales de integraciones. Por entorno (APP_SECRET) o fichero local 0600.
function loadSecret() {
  if (process.env.APP_SECRET) return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8')).digest();
}
let key;
export function encrypt(obj) {
  key ||= loadSecret();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(s) {
  if (!s) return {};
  key ||= loadSecret();
  const [iv, tag, enc] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
}

export const DEFAULT_SETTINGS = {
  hold_minutes: 2880,              // caducidad de bloqueos provisionales (48 h)
  response_deadline_hours: 48,     // plazo de respuesta de proveedores
  quote_valid_days: 15,
  deposit_pct: 30,
  deposit_due_days: 3,
  balance_due_days_before: 7,
  unattended_hours: 24,
  send_window: { from: 9, to: 21 },  // horario de envío automático (Europe/Madrid)
  max_send_attempts: 3,
  doc_retention_years: 6,
  auto_request_on_accept: false,
  tz: 'Europe/Madrid',
};

// Tokens de enlaces privados: HMAC(clave maestra, tabla:id:nonce). Solo se guarda su hash (token_hash) y el nonce, de modo que
// la app puede volver a mostrar el enlace sin que la base de datos sola permita falsificarlo. Revocar = cambiar el nonce.
export function deriveToken(kind, id, nonce) {
  key ||= loadSecret();
  return crypto.createHmac('sha256', key).update(`${kind}:${id}:${nonce}`).digest('base64url');
}
