import { S, h, mount, get, post, can, fail, form, toast } from './lib.js';
import home from './views/home.js';
import { crmFunnel, leadView, clientView } from './views/crm.js';
import { quotesList, quoteEditor } from './views/quotes.js';
import { eventsList, eventView } from './views/events.js';
import calendar from './views/calendar.js';
import { catalogView } from './views/catalog.js';
import { providersList, providerView } from './views/providers.js';
import comms from './views/comms.js';
import { paymentsIn, paymentsOut } from './views/money.js';
import reports from './views/reports.js';
import settings from './views/settings.js';
import { publicQuote, publicPay, publicProvider, publicChange, thanks } from './views/public.js';
import { providerPortal, clientPortal } from './views/portal.js';

const NAV = [['/', 'Inicio', 'staff', '🏠'], ['/clientes', 'Clientes', 'clients:r', '👥'], ['/presupuestos', 'Presupuestos', 'quotes:r', '📝'], ['/eventos', 'Eventos y reservas', 'events:r', '🎉'],
  ['/calendario', 'Calendario', 'calendar:r', '📅'], ['/servicios', 'Servicios y packs', 'catalog:r', '🧩'], ['/proveedores', 'Proveedores', 'providers:r', '🤝'], ['/comunicaciones', 'Comunicaciones', 'comms:r', '💬'],
  ['/cobros', 'Cobros', 'payments_in:r', '💶'], ['/pagos', 'Pagos y liquidaciones', 'payments_out:r', '🏦'], ['/informes', 'Informes', 'margins:r', '📊'], ['/config', 'Configuración', 'config:w', '⚙️']];
const ROUTES = [
  [/^\/$/, home, 'staff'], [/^\/clientes$/, crmFunnel, 'clients:r'], [/^\/clientes\/lead\/(\d+)$/, leadView, 'leads:r'], [/^\/clientes\/c\/(\d+)$/, clientView, 'clients:r'],
  [/^\/presupuestos$/, quotesList, 'quotes:r'], [/^\/presupuestos\/(\d+|nuevo)$/, quoteEditor, 'quotes:r'], [/^\/eventos$/, eventsList, 'events:r'], [/^\/eventos\/(\d+)$/, eventView, 'events:r'],
  [/^\/calendario$/, calendar, 'calendar:r'], [/^\/servicios$/, catalogView, 'catalog:r'], [/^\/proveedores$/, providersList, 'providers:r'], [/^\/proveedores\/(\d+)$/, providerView, 'providers:r'],
  [/^\/comunicaciones$/, comms, 'comms:r'], [/^\/cobros$/, paymentsIn, 'payments_in:r'], [/^\/pagos$/, paymentsOut, 'payments_out:r'], [/^\/informes$/, reports, 'margins:r'], [/^\/config$/, settings, 'config:w'],
  [/^\/portal$/, null, 'auth'],
];
const PUBLIC = [[/^\/q\/([\w-]+)$/, publicQuote], [/^\/pay\/([\w-]+)$/, publicPay], [/^\/prov\/([\w-]+)$/, publicProvider], [/^\/chg\/([\w-]+)$/, publicChange], [/^\/gracias/, thanks]];

const root = document.getElementById('app');
let navEl;

function loginView() {
  const f = form([{ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'username' }, { name: 'password', label: 'Contraseña', type: 'password', required: true, autocomplete: 'current-password' }],
    { submitLabel: 'Entrar', onSubmit: async (v) => { await post('/api/auth/login', v); await boot(); } });
  mount(root, h('div', { class: 'center' }, h('div', { class: 'card login' }, h('h1', { style: { marginBottom: '.2rem' } }, '✔ GrupoListo'), h('p', { class: 'muted' }, 'Gestión de grupos y eventos'), f)));
}

async function loadSession() {
  try { const me = await get('/api/auth/me'); S.user = me.user; S.perms = me.permissions; S.stages = me.stages; S.brands = me.brands; S.company = me.company; return true; } catch { S.user = null; return false; }
}
async function boot() { if (!(await loadSession())) return loginView(); await render(); }

function layout(content, path) {
  const items = NAV.filter(([, , perm]) => can(perm));
  navEl = h('nav', { class: 'nav', 'aria-label': 'Menú principal' }, h('div', { class: 'brand' }, '✔ GrupoListo'),
    S.user.role === 'proveedor' || S.user.role === 'cliente' ? h('a', { href: '#/portal', class: 'on' }, '🏠 Mi portal') : items.map(([p, t, , i]) => h('a', { href: `#${p}`, class: (p === '/' ? path === '/' : path.startsWith(p)) ? 'on' : '', onClick: () => navEl.classList.remove('open') }, `${i} ${t}`)),
    h('div', { class: 'who' }, h('div', null, S.user.name), h('div', null, S.company?.name), h('button', { class: 'btn sm', style: { marginTop: '.6rem' }, onClick: async () => { await post('/api/auth/logout'); S.user = null; loginView(); } }, 'Salir')));
  mount(root, h('div', { class: 'shell' }, navEl, h('div', null, h('div', { class: 'top' }, h('button', { 'aria-label': 'Abrir menú', onClick: () => navEl.classList.toggle('open') }, '☰'), h('b', null, 'GrupoListo')), h('main', { class: 'main', id: 'main' }, content))));
}

let seq = 0;
async function render() {
  const my = ++seq;
  const hash = location.hash.replace(/^#/, '') || '/';
  const [pathRaw, query] = hash.split('?'); const path = pathRaw || '/';
  const q = Object.fromEntries(new URLSearchParams(query || ''));
  // páginas públicas por enlace privado: sin sesión ni menú
  for (const [re, view] of PUBLIC) { const m = re.exec(path); if (m) { mount(root, h('div', { class: 'public' }, h('p', { class: 'muted' }, 'Cargando…'))); try { const el = await view(m[1], q); if (my === seq) mount(root, h('div', { class: 'public' }, el)); } catch (e) { if (my === seq) mount(root, h('div', { class: 'public' }, h('div', { class: 'alert bad' }, e.message))); } return; } }
  if (!S.user && !(await loadSession())) return loginView();
  if (S.user.role === 'proveedor' || S.user.role === 'cliente') { const el = await (S.user.role === 'proveedor' ? providerPortal : clientPortal)().catch((e) => h('div', { class: 'alert bad' }, e.message)); return layout(el, '/portal'); }
  let found = null;
  for (const [re, view, perm] of ROUTES) { const m = re.exec(path); if (m) { found = { view, perm, params: m.slice(1) }; break; } }
  if (!found) return layout(h('div', { class: 'card' }, 'Página no encontrada'), path);
  if (!found.view) return layout(home(), path);
  if (!can(found.perm)) return layout(h('div', { class: 'alert bad' }, 'No tienes permiso para ver esta sección.'), path);
  layout(h('p', { class: 'muted' }, 'Cargando…'), path);
  try { const el = await found.view(...found.params, q); if (my === seq) { mount(document.getElementById('main'), el); window.scrollTo(0, 0); } }
  catch (e) { if (e.status === 401) { S.user = null; return loginView(); } if (my === seq) mount(document.getElementById('main'), h('div', { class: 'alert bad' }, e.message)); }
}
window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);
boot();
