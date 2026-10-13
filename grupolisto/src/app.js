import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, BASE_URL } from './config.js';
import { createRouter, authorize } from './router.js';
import { userFromToken } from './auth.js';
import { mkctx } from './core.js';
import { HttpError, parseJson } from './util.js';
import { registerAll } from './routes/index.js';
import { processQueue } from './comms.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUBLIC_DIR = path.join(ROOT, 'public');
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'" };

const hits = new Map();
function limit(key, max, windowMs) {
  const t = Date.now(), arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
  return arr.length <= max;
}
const readBody = (req, max = 9e6) => new Promise((res, rej) => {
  let n = 0; const ch = [];
  req.on('data', (c) => { n += c.length; if (n > max) { rej(new HttpError(413, 'Cuerpo demasiado grande')); req.destroy(); } else ch.push(c); });
  req.on('end', () => res(Buffer.concat(ch).toString('utf8')));
  req.on('error', rej);
});
const cookieOf = (req, name) => (req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).find(([k]) => k === name)?.[1];

export function createApp(db) {
  const router = createRouter();
  registerAll(router, db);

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, headers = {}) => {
      const isStr = typeof body === 'string' || Buffer.isBuffer(body);
      res.writeHead(status, { ...HEADERS, ...(isStr ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...headers });
      res.end(isStr ? body : JSON.stringify(body));
    };
    try {
      const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
      if (url.pathname.startsWith('/api/')) {
        const m = router.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, 'Ruta no encontrada', 'not_found');
        const { route, params } = m;
        const token = cookieOf(req, 'gl_session');
        const user = userFromToken(db, token);
        authorize(route, user);
        const mutating = req.method !== 'GET';
        // Defensa CSRF: con sesión, las mutaciones exigen JSON y un Origin coherente con el host
        if (mutating && user && !route.opts.raw) {
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origen no permitido', 'csrf');
          if (!String(req.headers['content-type'] || '').includes('application/json') && Number(req.headers['content-length'] || 0) > 0) throw new HttpError(415, 'Se requiere JSON');
        }
        if (route.perm === null && !limit(`pub:${ip}`, 120, 60000)) throw new HttpError(429, 'Demasiadas peticiones');
        const raw = mutating ? await readBody(req) : '';
        let body = {};
        if (!route.opts.raw && raw) { try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON no válido'); } }
        const c = { db, user, ctx: user ? mkctx(db, user) : null, params, query: Object.fromEntries(url.searchParams), body: body || {}, raw, req, ip, token,
          limit, cookies: [], headers: {} };
        const out = await route.handler(c);
        if (mutating && user) setImmediate(() => processQueue(db).catch(() => {}));   // los avisos generados salen enseguida (o quedan con su estado real)
        const headers = { ...c.headers };
        if (c.cookies.length) headers['Set-Cookie'] = c.cookies;
        if (out && out.__raw !== undefined) return send(out.status || 200, out.__raw, { ...headers, ...(out.type ? { 'Content-Type': out.type } : {}), ...(out.headers || {}) });
        if (out && out.__status) return send(out.__status, out.body, headers);
        return send(200, out === undefined ? { ok: true } : out, headers);
      }
      // estáticos (SPA)
      if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido');
      let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
      return send(200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message, code: e.code, ...(e.extra || {}) });
      if (/SQLITE_CONSTRAINT|constraint failed/i.test(String(e.message))) return send(409, { error: 'Operación rechazada por una restricción de datos (posible duplicado)', code: 'constraint', detail: String(e.message).slice(0, 160) });
      console.error('[error]', req.method, req.url, e);
      return send(500, { error: 'Error interno', code: 'internal' });
    }
  };
  return { handler, router };
}
