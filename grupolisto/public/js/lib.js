// Utilidades de interfaz: DOM sin innerHTML (evita XSS), API, formularios, modales y etiquetas en español.
export const S = { user: null, perms: [], stages: [], brands: [], company: null };
export const can = (p) => S.perms.includes('*') || S.perms.includes(p);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids); return el;
}
function add(el, kids) { for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k.nodeType ? k : document.createTextNode(String(k))); } }
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => { clear(el); add(el, kids); return el; };

// ---- API
export async function api(method, path, body) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) { const e = new Error(data?.error || `Error ${res.status}`); e.status = res.status; e.code = data?.code; e.data = data; throw e; }
  return data;
}
export const get = (p) => api('GET', p); export const post = (p, b = {}) => api('POST', p, b); export const put = (p, b = {}) => api('PUT', p, b); export const del = (p) => api('DELETE', p);
export const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); return p.toString() ? `?${p}` : ''; };

// ---- formatos (es-ES, euros, Europe/Madrid)
export const eur = (c) => (c == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100));
export const fdate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
export const fdt = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }) : '—');
export const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
export const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const pct = (v) => `${(v ?? 0).toLocaleString('es-ES')} %`;

// ---- etiquetas
const L = {
  es: { requested: ['Solicitado', 'warn'], pending_availability: ['Pendiente de disponibilidad', 'warn'], available: ['Disponible', 'info'], held: ['Bloqueado provisionalmente', 'info'],
    confirmed: ['Confirmado', 'ok'], rejected: ['Rechazado', 'bad'], cancelled: ['Cancelado', ''], done: ['Realizado', 'ok'] },
  booking: { pending: ['Reserva pendiente', 'warn'], partial: ['Parcialmente confirmada', 'info'], confirmed: ['Completamente confirmada', 'ok'] },
  event: { active: ['Activo', 'info'], cancelled: ['Cancelado', 'bad'], completed: ['Finalizado', 'ok'] },
  pay: { pending: ['Pendiente', 'warn'], processing: ['En proceso', 'info'], verified: ['Verificado', 'ok'], failed: ['Fallido', 'bad'], refunded: ['Reembolsado', ''], cancelled: ['Anulado', ''] },
  evpay: { pending: ['Sin cobrar', 'warn'], partial: ['Cobro parcial', 'info'], paid: ['Cobrado', 'ok'], overpaid: ['Cobro excedido', 'bad'] },
  out: { pending: ['Pendiente', 'warn'], ordered: ['Orden preparada', 'info'], paid: ['Pagado', 'ok'], cancelled: ['Anulado', ''] },
  quote: { draft: ['Borrador', ''], sent: ['Enviada', 'info'], changes_requested: ['Cambios solicitados', 'warn'], accepted: ['Aceptada', 'ok'], rejected: ['Rechazada', 'bad'], expired: ['Caducada', 'bad'], superseded: ['Sustituida', ''] },
  msg: { queued: ['En cola', 'warn'], sent: ['Enviado', 'ok'], delivered: ['Entregado', 'ok'], read: ['Leído', 'ok'], failed: ['Fallido', 'bad'], blocked: ['Bloqueado', 'bad'], not_configured: ['Pendiente de conectar', 'warn'], received: ['Recibido', 'info'] },
  req: { sent: ['Esperando respuesta', 'warn'], responded: ['Respondida', 'ok'], cancelled: ['Cancelada', ''] },
};
export const badge = (kind, v) => { const [t, tone] = L[kind]?.[v] || [v ?? '—', '']; return h('span', { class: `badge ${tone}` }, t); };
export const label = (kind, v) => L[kind]?.[v]?.[0] || v;
export const CATS = { actividad: 'Actividad', restaurante: 'Restaurante', menu: 'Menú', alojamiento: 'Alojamiento', transporte: 'Transporte', espectaculo: 'Espectáculo', extra: 'Extra' };
export const PAYKIND = { deposit: 'Señal', balance: 'Saldo', participant: 'Participante', refund: 'Reembolso' };
export const METHOD = { transfer: 'Transferencia', cash: 'Efectivo', card_manual: 'TPV/tarjeta (manual)', stripe: 'Pasarela online' };
export const CHANNEL = { email: 'Email', whatsapp: 'WhatsApp', internal: 'Interno', auto: 'Automático' };

// ---- avisos y modales
export function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg); document.getElementById('toasts').append(t); setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}
export const fail = (e) => toast(e?.message || String(e), 'bad');
export function modal(title, body, { wide = false } = {}) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'overlay', onClick: (e) => { if (e.target === ov) close(); } }, h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, h('h2', null, title), body));
  document.body.append(ov); document.addEventListener('keydown', esc);
  const first = ov.querySelector('input,select,textarea'); if (first) first.focus();
  return { close, el: ov };
}
export const confirmBox = (msg, { okLabel = 'Confirmar', danger = false } = {}) => new Promise((res) => {
  const m = modal('Confirmar', h('div', null, h('p', null, msg), h('div', { class: 'actions' },
    h('button', { class: 'btn', onClick: () => { m.close(); res(false); } }, 'Cancelar'), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => { m.close(); res(true); } }, okLabel))));
});
export async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Enlace copiado', 'ok'); } catch { prompt('Copia el enlace:', text); } }
export function linkModal(title, link, note) {
  const inp = h('input', { value: link, readonly: true, onClick: (e) => e.target.select() });
  const m = modal(title, h('div', null, note && h('p', { class: 'muted' }, note), inp, h('div', { class: 'actions' }, h('button', { class: 'btn', onClick: () => copy(link) }, 'Copiar enlace'), h('a', { class: 'btn', href: link, target: '_blank', rel: 'noopener' }, 'Abrir'), h('button', { class: 'btn primary', onClick: () => m.close() }, 'Cerrar'))));
}

// ---- formularios
const toBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
export async function fileDoc(input) { const f = input?.files?.[0]; if (!f) return null; if (f.size > 5 * 1024 * 1024) throw new Error('El archivo supera 5 MB'); return { name: f.name, mime: f.type, data_base64: await toBase64(f) }; }
/** form([{name,label,type,options,value,required,help,rows,step,min,max,placeholder,span}], {submitLabel, onSubmit, onCancel}) */
export function form(fields, { submitLabel = 'Guardar', onSubmit, onCancel, extra } = {}) {
  const inputs = {}; const err = h('div', { class: 'err', role: 'alert' });
  const mk = (f) => {
    let el;
    if (f.type === 'select') {
      el = h('select', { name: f.name }, (f.options || []).map((o) => { const [v, l] = Array.isArray(o) ? o : [o.value, o.label]; return h('option', { value: v }, l); })); el.value = f.value ?? (f.options?.[0] && (Array.isArray(f.options[0]) ? f.options[0][0] : f.options[0].value)) ?? '';
    } else if (f.type === 'textarea') el = h('textarea', { name: f.name, rows: f.rows || 3, placeholder: f.placeholder }, f.value ?? '');
    else if (f.type === 'checkbox') el = h('input', { type: 'checkbox', name: f.name, checked: !!f.value });
    else if (f.type === 'checks') { el = h('div', { class: 'row' }, (f.options || []).map(([v, l]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', value: v, checked: (f.value || []).map(String).includes(String(v)) }), l))); }
    else el = h('input', { type: f.type || 'text', name: f.name, value: f.value ?? '', placeholder: f.placeholder, step: f.step, min: f.min, max: f.max, autocomplete: f.autocomplete || 'off', accept: f.accept });
    if (f.required) el.required = true; if (f.disabled) el.disabled = true;
    inputs[f.name] = el;
    if (f.type === 'checkbox') return h('label', { class: 'chk', style: f.span ? { gridColumn: '1/-1' } : null }, el, h('span', null, f.label));
    return h('label', { class: 'f', style: f.span ? { gridColumn: '1/-1' } : null }, h('span', null, f.label, f.required ? ' *' : ''), el, f.help && h('small', null, f.help));
  };
  const btn = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  const el = h('form', { class: 'grid g2', novalidate: false, onSubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await onSubmit(await values()); } catch (x) { err.textContent = x.message || 'Error'; } finally { btn.disabled = false; }
  } }, fields.map(mk), extra, h('div', { style: { gridColumn: '1/-1' } }, err, h('div', { class: 'actions row', style: { justifyContent: 'flex-end' } }, onCancel && h('button', { class: 'btn', type: 'button', onClick: onCancel }, 'Cancelar'), btn)));
  async function values() {
    const o = {};
    for (const f of fields) {
      const i = inputs[f.name];
      if (f.type === 'checkbox') o[f.name] = i.checked;
      else if (f.type === 'checks') o[f.name] = [...i.querySelectorAll('input:checked')].map((x) => x.value);
      else if (f.type === 'file') o[f.name] = await fileDoc(i);
      else o[f.name] = i.value;
    }
    return o;
  }
  el.values = values; el.inputs = inputs;
  return el;
}
export const opts = (list, { empty } = {}) => [...(empty ? [['', empty]] : []), ...list.map((x) => (Array.isArray(x) ? x : [x.id ?? x.key ?? x.value, x.name ?? x.label]))];

export function table(cols, rows, { onRow, empty = 'Sin datos' } = {}) {
  if (!rows?.length) return h('div', { class: 'empty' }, empty);
  return h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.right ? 'r' : '' }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', { class: onRow ? 'click' : '', onClick: onRow ? (e) => { if (!e.target.closest('button,a,select,input')) onRow(r); } : null },
      cols.map((c) => h('td', { class: `${c.right ? 'r' : ''} ${c.nowrap ? 'nowrap' : ''}` }, c.render ? c.render(r) : r[c.key] ?? '—')))))));
}
export function tabs(items, initial) {
  const body = h('div'); const bar = h('div', { class: 'tabs', role: 'tablist' });
  const sel = async (key) => {
    [...bar.children].forEach((b) => b.classList.toggle('on', b.dataset.k === key));
    mount(body, h('p', { class: 'muted' }, 'Cargando…'));
    try { mount(body, await items.find((i) => i.key === key).render()); } catch (e) { mount(body, h('div', { class: 'alert bad' }, e.message)); }
  };
  items.forEach((i) => bar.append(h('button', { 'data-k': i.key, role: 'tab', onClick: () => sel(i.key) }, i.label)));
  const root = h('div', null, bar, body); root.select = sel; sel(initial || items[0].key); return root;
}
export const pageHead = (title, sub, ...actions) => h('div', { class: 'pagehead' }, h('div', null, h('h1', null, title), sub && h('div', { class: 'muted' }, sub)), h('div', { class: 'row' }, actions));
export const card = (title, ...kids) => h('section', { class: 'card' }, title && h('h2', null, title), kids);
export const go = (hash) => { location.hash = hash; };
export const a = (hash, text, cls) => h('a', { href: `#${hash}`, class: cls }, text);
export const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
export const act = (fn, okMsg) => async (e) => { const b = e?.currentTarget; if (b) b.disabled = true; try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; } catch (x) { fail(x); } finally { if (b) b.disabled = false; } };
