import crypto from 'node:crypto';
import { DEFAULT_SETTINGS, deriveToken } from './config.js';
import { notFound, nowIso, parseJson, today, addDays, sha256 } from './util.js';

// ctx = { db, cid, user, actor }. cid sale SIEMPRE de la sesión o del token validado, nunca del cliente.
export const mkctx = (db, user, cid = user?.company_id, actor) => ({ db, cid, user: user || null,
  actor: actor || (user ? `${user.role}:${user.name}` : 'sistema') });
export const sysctx = (db, cid) => mkctx(db, null, cid, 'sistema');

export function audit(ctx, entity, id, action, detail) {
  ctx.db.insert('audit_log', { company_id: ctx.cid, user_id: ctx.user?.id ?? null, actor: ctx.actor, entity, entity_id: id ?? null,
    action, detail: detail === undefined ? null : JSON.stringify(detail), at: nowIso() });
}

// Lectura aislada por empresa: una fila de otra empresa es indistinguible de una inexistente (404)
const TABLES = new Set(['clients', 'leads', 'quotes', 'quote_options', 'quote_lines', 'events', 'event_services', 'providers', 'services',
  'packs', 'payments_in', 'payments_out', 'provider_requests', 'messages', 'tasks', 'brands', 'users', 'documents', 'templates',
  'event_changes', 'availability_rules', 'availability_closures', 'allocations']);
export function byId(ctx, table, id, { optional = false } = {}) {
  if (!TABLES.has(table)) throw new Error(`tabla no permitida: ${table}`);
  const r = ctx.db.get(`SELECT * FROM ${table} WHERE id=? AND company_id=?`, Number(id), ctx.cid);
  if (!r && !optional) throw notFound();
  return r ? parseRow(r) : null;
}
const JSON_COLS = ['terms', 'snapshot', 'payload', 'before_json', 'after_json', 'capacity_report', 'meta', 'dates_alt', 'tiers', 'images', 'settings'];
export function parseRow(r) {
  for (const k of JSON_COLS) if (typeof r[k] === 'string') r[k] = parseJson(r[k], r[k].startsWith('[') ? [] : {});
  return r;
}

export function settings(ctx) {
  const row = ctx.db.get('SELECT settings FROM companies WHERE id=?', ctx.cid);
  return { ...DEFAULT_SETTINGS, ...parseJson(row?.settings, {}) };
}

export function nextNumber(ctx, table, field, prefix) {
  const y = today().slice(0, 4);
  const p = `${prefix}-${y}-`;
  const last = ctx.db.get(`SELECT ${field} AS v FROM ${table} WHERE company_id=? AND ${field} LIKE ? ORDER BY id DESC LIMIT 1`, ctx.cid, `${p}%`);
  const n = last ? Number(String(last.v).slice(p.length)) + 1 : 1;
  return `${p}${String(n).padStart(4, '0')}`;
}

export function addTask(ctx, { title, lead_id, event_id, assigned_to, due_in_days = 1, auto_key, kind = 'task' }) {
  if (auto_key && ctx.db.get('SELECT id FROM tasks WHERE company_id=? AND auto_key=?', ctx.cid, auto_key)) return null;
  return ctx.db.insert('tasks', { company_id: ctx.cid, lead_id: lead_id ?? null, event_id: event_id ?? null, assigned_to: assigned_to ?? null,
    title, kind, due_at: addDays(today(), due_in_days), auto_key: auto_key ?? null, created_at: nowIso() });
}

// Genera (o rota) el token privado de una fila. Devuelve el token en claro; invalida el anterior.
export function mint(ctx, table, id) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const token = deriveToken(table, id, nonce);
  ctx.db.update(table, id, ctx.cid, { token_nonce: nonce, token_hash: sha256(token), token_revoked_at: null });
  return token;
}
export const tokenOf = (table, row) => (row?.token_nonce && !row.token_revoked_at ? deriveToken(table, row.id, row.token_nonce) : null);
