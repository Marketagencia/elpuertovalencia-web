import { badRequest, notFound } from '../util.js';
import { byId } from '../core.js';

export const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
export const need = (v, msg) => { if (v === undefined || v === null || String(v).trim() === '') throw badRequest(msg); return v; };
export const str = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);
export const intOrNull = (v) => (v === '' || v == null ? null : Math.round(Number(v)));
export const bool = (v) => (v ? 1 : 0);
export const num = (v, name, { min = 0, max = 1e9, required = false } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw badRequest(`${name} es obligatorio`); return null; }
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${name} no es válido`);
  return n;
};
export const eurosToCents = (v) => (v === '' || v == null ? null : Math.round(Number(String(v).replace(',', '.')) * 100));
export { byId, notFound, badRequest };
