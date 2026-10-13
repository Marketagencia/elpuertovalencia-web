import crypto from 'node:crypto';

// Reloj inyectable (los tests lo congelan para probar caducidades)
let clock = () => new Date();
export const setClock = (f) => { clock = f || (() => new Date()); };
export const now = () => clock();
export const nowIso = () => now().toISOString();
export const plusMinutes = (mins, d = now()) => new Date(d.getTime() + mins * 60000).toISOString();

export class HttpError extends Error {
  constructor(status, message, code, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const badRequest = (m, code) => new HttpError(400, m, code);
export const forbidden = (m = 'No tienes permiso para esta acción') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'No encontrado') => new HttpError(404, m, 'not_found');
export const conflict = (m, code, extra) => new HttpError(409, m, code, extra);

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function madrid(d = now()) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, hour: Number(p.hour) };
}
export const today = () => madrid().date;
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export const diffDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
export const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

export const eur = (c) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((c || 0) / 100);
// Base imponible a partir de un importe con impuestos incluidos
export const netOf = (gross, taxBp) => Math.round((gross * 10000) / (10000 + (taxBp || 0)));

// Reparto proporcional exacto (método del mayor resto)
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}

export const parseJson = (s, fallback) => { if (s && typeof s === 'object') return s; try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
export const int = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : def; };

export function interpolate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));
}
export const initials = (s) => String(s || '').split(/\s+/)[0] || '';
