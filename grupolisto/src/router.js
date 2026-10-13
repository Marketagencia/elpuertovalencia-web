import { can } from './perm.js';
import { HttpError, forbidden } from './util.js';

export function createRouter() {
  const routes = [];
  const add = (method, pattern, perm, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, perm, handler, opts });
  };
  const match = (method, path) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  };
  // perm: null = pública · 'auth' = cualquier sesión · 'recurso:acción' = permiso del perfil (se comprueba SIEMPRE en servidor)
  const api = { add, match,
    get: (p, perm, h, o) => add('GET', p, perm, h, o), post: (p, perm, h, o) => add('POST', p, perm, h, o),
    put: (p, perm, h, o) => add('PUT', p, perm, h, o), del: (p, perm, h, o) => add('DELETE', p, perm, h, o) };
  return api;
}
export function authorize(route, user) {
  if (route.perm === null) return;
  if (!user) throw new HttpError(401, 'Inicia sesión', 'unauthenticated');
  if (route.perm !== 'auth' && !can(user, route.perm)) throw forbidden();
}
