import fs from 'node:fs';
import path from 'node:path';
import { login, logout, hashPassword, publicUser } from '../auth.js';
import { ROLE_PERMS, can } from '../perm.js';
import { audit, byId, settings, parseRow } from '../core.js';
import { badRequest, conflict, nowIso, parseJson, HttpError } from '../util.js';
import { statusList, saveConfig, CATALOG } from '../integrations.js';
import { AUTOMATIONS, automationList } from '../automations.js';
import { pick, str, bool, need } from './util.js';
import { DEFAULT_SETTINGS } from '../config.js';

const SECURE = (process.env.APP_BASE_URL || '').startsWith('https');
const cookie = (t, max) => `gl_session=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${max}${SECURE ? '; Secure' : ''}`;
const EXPORT_TABLES = ['brands', 'clients', 'consents', 'leads', 'interactions', 'tasks', 'providers', 'services', 'service_providers', 'packs', 'pack_items', 'availability_rules', 'availability_closures',
  'allocations', 'quotes', 'quote_options', 'quote_lines', 'events', 'event_services', 'provider_requests', 'payments_in', 'payments_out', 'documents', 'templates', 'messages', 'event_changes', 'audit_log'];

export default function (r, db) {
  r.post('/api/auth/login', null, (c) => {
    const email = String(c.body.email || '').toLowerCase();
    if (!c.limit(`login:${c.ip}:${email}`, 10, 15 * 60000)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.', 'rate_limited');
    const { token, user } = login(db, email, c.body.password);
    c.cookies.push(cookie(token, 7 * 86400));
    return { user, permissions: ROLE_PERMS[user.role] };
  });
  r.post('/api/auth/logout', 'auth', (c) => { logout(db, c.token); c.cookies.push(cookie('', 0)); });
  r.get('/api/auth/me', 'auth', (c) => {
    const co = db.get('SELECT id,name,slug,plan FROM companies WHERE id=?', c.user.company_id);
    return { user: publicUser(c.user), company: co, permissions: ROLE_PERMS[c.user.role],
      stages: db.all('SELECT key,label,position,kind FROM pipeline_stages WHERE company_id=? ORDER BY position', c.user.company_id),
      brands: can(c.user, 'staff') ? db.all('SELECT id,name,color,logo_url,is_default FROM brands WHERE company_id=?', c.user.company_id) : [] };
  });

  // ---- empresa y ajustes
  r.get('/api/company', 'staff', (c) => ({ ...db.get('SELECT id,name,slug,plan FROM companies WHERE id=?', c.ctx.cid), settings: settings(c.ctx), defaults: DEFAULT_SETTINGS }));
  r.put('/api/company', 'config:w', (c) => {
    const s = c.body.settings || {}, cur = parseJson(db.get('SELECT settings FROM companies WHERE id=?', c.ctx.cid).settings, {});
    const num = (k, min, max) => { if (s[k] !== undefined) { const v = Number(s[k]); if (!Number.isFinite(v) || v < min || v > max) throw badRequest(`Ajuste «${k}» fuera de rango`); cur[k] = v; } };
    num('hold_minutes', 5, 20160); num('response_deadline_hours', 1, 720); num('quote_valid_days', 1, 180); num('deposit_pct', 0, 100); num('deposit_due_days', 0, 60);
    num('balance_due_days_before', 0, 120); num('unattended_hours', 1, 240); num('max_send_attempts', 1, 10); num('doc_retention_years', 1, 20);
    if (s.send_window) { const f = Number(s.send_window.from), t = Number(s.send_window.to); if (!(f >= 0 && t <= 24 && f < t)) throw badRequest('Horario de envío no válido'); cur.send_window = { from: f, to: t }; }
    if (s.auto_request_on_accept !== undefined) cur.auto_request_on_accept = !!s.auto_request_on_accept;
    db.run('UPDATE companies SET name=COALESCE(?,name), settings=? WHERE id=?', c.body.name ? str(c.body.name, 120) : null, JSON.stringify(cur), c.ctx.cid);
    audit(c.ctx, 'company', c.ctx.cid, 'ajustes_actualizados', s);
    return { settings: settings(c.ctx) };
  });

  // ---- marcas
  r.get('/api/brands', 'staff', (c) => db.all('SELECT * FROM brands WHERE company_id=? ORDER BY is_default DESC, name', c.ctx.cid));
  const brandCols = ['name', 'logo_url', 'email', 'phone', 'address', 'web', 'iban', 'color', 'terms_payment', 'terms_cancel', 'terms_general'];
  r.post('/api/brands', 'config:w', (c) => {
    need(c.body.name, 'Nombre de marca obligatorio');
    const first = !db.get('SELECT id FROM brands WHERE company_id=?', c.ctx.cid);
    const id = db.insert('brands', { company_id: c.ctx.cid, ...pick(c.body, brandCols), is_default: first ? 1 : 0, created_at: nowIso() });
    audit(c.ctx, 'brand', id, 'creada'); return byId(c.ctx, 'brands', id);
  });
  r.put('/api/brands/:id', 'config:w', (c) => {
    byId(c.ctx, 'brands', c.params.id);
    if (c.body.logo_url && !/^(https:\/\/|data:image\/)/.test(c.body.logo_url)) throw badRequest('El logo debe ser una URL https o una imagen incrustada');
    db.update('brands', Number(c.params.id), c.ctx.cid, pick(c.body, brandCols));
    if (c.body.is_default) { db.run('UPDATE brands SET is_default=0 WHERE company_id=?', c.ctx.cid); db.update('brands', Number(c.params.id), c.ctx.cid, { is_default: 1 }); }
    audit(c.ctx, 'brand', Number(c.params.id), 'actualizada'); return byId(c.ctx, 'brands', c.params.id);
  });

  // ---- usuarios
  r.get('/api/users', 'config:w', (c) => db.all('SELECT id,name,email,role,provider_id,client_id,active,last_login_at FROM users WHERE company_id=? ORDER BY role,name', c.ctx.cid));
  const checkLinks = (c, b) => {
    if (b.role === 'proveedor') { need(b.provider_id, 'Selecciona el proveedor'); byId(c.ctx, 'providers', b.provider_id); }
    if (b.role === 'cliente') { need(b.client_id, 'Selecciona el cliente'); byId(c.ctx, 'clients', b.client_id); }
  };
  r.post('/api/users', 'config:w', (c) => {
    const b = c.body; need(b.name, 'Nombre obligatorio'); need(b.email, 'Email obligatorio');
    if (!ROLE_PERMS[b.role]) throw badRequest('Perfil no válido');
    if (String(b.password || '').length < 10) throw badRequest('La contraseña debe tener al menos 10 caracteres');
    checkLinks(c, b);
    if (db.get('SELECT id FROM users WHERE lower(email)=lower(?)', b.email)) throw conflict('Ya existe un usuario con ese email', 'duplicate');
    const id = db.insert('users', { company_id: c.ctx.cid, email: String(b.email).trim().toLowerCase(), name: str(b.name, 120), password_hash: hashPassword(b.password), role: b.role,
      provider_id: b.role === 'proveedor' ? Number(b.provider_id) : null, client_id: b.role === 'cliente' ? Number(b.client_id) : null, created_at: nowIso() });
    audit(c.ctx, 'user', id, 'creado', { role: b.role }); return { id };
  });
  r.put('/api/users/:id', 'config:w', (c) => {
    const u = byId(c.ctx, 'users', c.params.id), b = c.body;
    const upd = pick(b, ['name', 'active']);
    if (b.role) { if (!ROLE_PERMS[b.role]) throw badRequest('Perfil no válido'); upd.role = b.role; }
    if (b.password) { if (String(b.password).length < 10) throw badRequest('La contraseña debe tener al menos 10 caracteres'); upd.password_hash = hashPassword(b.password); }
    if (u.id === c.user.id && (b.active === false || b.active === 0 || (b.role && b.role !== 'admin'))) throw conflict('No puedes desactivarte ni quitarte el rol de administrador', 'self');
    checkLinks(c, { ...u, ...b });
    if (b.provider_id !== undefined) upd.provider_id = b.provider_id;
    if (b.client_id !== undefined) upd.client_id = b.client_id;
    db.update('users', u.id, c.ctx.cid, upd);
    if (upd.active === false || upd.active === 0 || upd.password_hash) db.run('DELETE FROM sessions WHERE user_id=?', u.id);
    audit(c.ctx, 'user', u.id, 'actualizado', { campos: Object.keys(upd).filter((k) => k !== 'password_hash') }); return { ok: true };
  });

  // ---- embudo configurable
  r.get('/api/stages', 'staff', (c) => db.all('SELECT * FROM pipeline_stages WHERE company_id=? ORDER BY position', c.ctx.cid));
  r.put('/api/stages', 'config:w', (c) => {
    const list = c.body.stages;
    if (!Array.isArray(list) || !list.length) throw badRequest('Define al menos una etapa');
    const keys = new Set(list.map((s) => s.key));
    for (const k of ['new']) if (!keys.has(k)) throw badRequest(`La etapa «${k}» es obligatoria`);
    const used = db.all('SELECT DISTINCT stage FROM leads WHERE company_id=?', c.ctx.cid).map((x) => x.stage);
    const lost = used.filter((s) => !keys.has(s));
    if (lost.length) throw conflict(`Hay consultas en etapas que intentas eliminar: ${lost.join(', ')}`, 'stage_in_use');
    db.tx(() => {
      db.run('DELETE FROM pipeline_stages WHERE company_id=?', c.ctx.cid);
      list.forEach((s, i) => db.insert('pipeline_stages', { company_id: c.ctx.cid, key: String(s.key).replace(/[^a-z0-9_]/gi, '_').toLowerCase(), label: str(s.label, 60) || s.key, position: i,
        kind: ['open', 'won', 'lost', 'cancelled', 'done'].includes(s.kind) ? s.kind : 'open' }));
    });
    audit(c.ctx, 'company', c.ctx.cid, 'embudo_actualizado'); return db.all('SELECT * FROM pipeline_stages WHERE company_id=? ORDER BY position', c.ctx.cid);
  });

  // ---- integraciones (las credenciales nunca vuelven al navegador)
  r.get('/api/integrations', 'config:w', (c) => statusList(c.ctx));
  r.put('/api/integrations/:key', 'config:w', (c) => {
    if (!CATALOG[c.params.key]) throw badRequest('Integración desconocida');
    saveConfig(c.ctx, c.params.key, c.body.config || {}, c.body.enabled !== false);
    audit(c.ctx, 'integration', null, `configurada:${c.params.key}`); return statusList(c.ctx).find((x) => x.key === c.params.key);
  });

  // ---- automatizaciones
  r.get('/api/automations', 'comms:r', (c) => automationList(c.ctx));
  r.put('/api/automations/:key', 'config:w', (c) => {
    const a = AUTOMATIONS[c.params.key]; if (!a) throw badRequest('Automatización desconocida');
    const params = {};
    for (const k of Object.keys(a.params)) if (c.body.params?.[k] !== undefined) { const v = Number(c.body.params[k]); if (!(v >= 0 && v <= 365)) throw badRequest(`Valor de «${k}» no válido`); params[k] = v; }
    db.run(`INSERT INTO automations(company_id,key,enabled,params) VALUES(?,?,?,?) ON CONFLICT(company_id,key) DO UPDATE SET enabled=excluded.enabled, params=excluded.params`,
      c.ctx.cid, c.params.key, c.body.enabled === false ? 0 : 1, JSON.stringify(params));
    audit(c.ctx, 'automation', null, `configurada:${c.params.key}`, { enabled: c.body.enabled, params });
    return automationList(c.ctx).find((x) => x.key === c.params.key);
  });

  // ---- trazabilidad
  r.get('/api/audit', 'staff', (c) => {
    const a = [c.ctx.cid]; let w = '';
    if (c.query.entity) { w += ' AND entity=?'; a.push(c.query.entity); }
    if (c.query.id) { w += ' AND entity_id=?'; a.push(Number(c.query.id)); }
    return db.all(`SELECT * FROM audit_log WHERE company_id=? ${w} ORDER BY id DESC LIMIT 300`, ...a).map(parseRow).map((x) => ({ ...x, detail: parseJson(x.detail, null) }));
  });

  // ---- exportación completa de la empresa (portabilidad) y retención
  r.get('/api/export', 'config:w', (c) => {
    const out = { exported_at: nowIso(), company: db.get('SELECT id,name,slug,plan,settings FROM companies WHERE id=?', c.ctx.cid) };
    for (const t of EXPORT_TABLES) out[t] = db.all(`SELECT * FROM ${t} WHERE company_id=?`, c.ctx.cid);
    out.users = db.all('SELECT id,email,name,role,active FROM users WHERE company_id=?', c.ctx.cid);
    audit(c.ctx, 'company', c.ctx.cid, 'exportacion_completa');
    return { __raw: JSON.stringify(out, null, 1), type: 'application/json', headers: { 'Content-Disposition': `attachment; filename="grupolisto-export-${c.ctx.cid}.json"` } };
  });
  r.post('/api/retention/purge', 'config:w', (c) => {
    const years = settings(c.ctx).doc_retention_years;
    const cutoff = new Date(Date.now() - years * 365 * 864e5).toISOString();
    const docs = db.all('SELECT * FROM documents WHERE company_id=? AND created_at<?', c.ctx.cid, cutoff);
    for (const d of docs) { try { fs.unlinkSync(d.path); } catch { /* ya no existe */ } db.run('DELETE FROM documents WHERE id=? AND company_id=?', d.id, c.ctx.cid); }
    audit(c.ctx, 'company', c.ctx.cid, 'purga_documentos', { eliminados: docs.length, years });
    return { deleted: docs.length, retention_years: years };
  });
}
