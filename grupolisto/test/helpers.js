import './setup.js';
import http from 'node:http';
import fs from 'node:fs';
import { TEST_DIR } from './setup.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedBase } from '../src/seed.js';

export async function boot() {
  const db = openDb(':memory:');
  const { handler } = createApp(db);
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, close: async () => { await new Promise((r) => server.close(r)); db.close(); fs.rmSync(TEST_DIR, { recursive: true, force: true }); } };
}

export class Api {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const res = await fetch(this.base + path, { method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) this.cookie = sc[0].split(';')[0];
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  get = (p) => this.req('GET', p); post = (p, b = {}) => this.req('POST', p, b); put = (p, b = {}) => this.req('PUT', p, b); del = (p) => this.req('DELETE', p);
  async login(email, password = 'Demo-Clave-2026') { const r = await this.post('/api/auth/login', { email, password }); if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; }
}
export const tokenFrom = (link) => link.split('/').pop();
export { seedBase };
