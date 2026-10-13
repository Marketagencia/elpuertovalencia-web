// Presupuestos: opciones, líneas, packs sin duplicados, versiones, enlace privado revocable y aceptación con evidencia.
import { byId, audit, settings, nextNumber, parseRow, sysctx, addTask, mint, tokenOf } from './core.js';
import { conflict, badRequest, nowIso, today, addDays, newToken, sha256, parseJson } from './util.js';
import { lineFromService, lineExtra, optionTotals } from './pricing.js';
import { createEventFromQuote, startService } from './bookings.js';
import { createPaymentIn } from './payments.js';
import { queue } from './comms.js';
import { eventVars, fmtDate } from './notify.js';
import { BASE_URL } from './config.js';

export function loadQuote(ctx, id) {
  const quote = byId(ctx, 'quotes', id);
  quote.options = ctx.db.all('SELECT * FROM quote_options WHERE company_id=? AND quote_id=? ORDER BY position, id', ctx.cid, quote.id).map((o) => {
    o.lines = ctx.db.all('SELECT * FROM quote_lines WHERE company_id=? AND option_id=? ORDER BY position, id', ctx.cid, o.id).map(parseRow);
    o.totals = optionTotals(o.lines, o.discount_cents);
    o.deposit_cents = Math.round((o.totals.total_cents * quote.deposit_pct) / 100);
    o.balance_cents = o.totals.total_cents - o.deposit_cents;
    return o;
  });
  return quote;
}

function defaultProvider(ctx, serviceId) {
  return ctx.db.get(`SELECT sp.provider_id, sp.cost_cents FROM service_providers sp JOIN providers p ON p.id=sp.provider_id
    WHERE sp.service_id=? AND sp.company_id=? AND p.active=1 ORDER BY sp.provider_id LIMIT 1`, serviceId, ctx.cid);
}
function providerCost(ctx, serviceId, providerId) {
  if (!providerId) { const d = defaultProvider(ctx, serviceId); return d ? { provider_id: d.provider_id, cost: d.cost_cents } : { provider_id: null, cost: null }; }
  const sp = ctx.db.get('SELECT * FROM service_providers WHERE service_id=? AND provider_id=? AND company_id=?', serviceId, providerId, ctx.cid);
  if (!sp) throw badRequest('Ese proveedor no presta el servicio seleccionado');
  return { provider_id: providerId, cost: sp.cost_cents };
}

// Construye las filas de una opción SIN duplicar conceptos: un servicio incluido en un pack no puede añadirse suelto.
function buildLines(ctx, opt) {
  const out = [];
  const inPack = new Map();
  for (const l of opt.lines || []) {
    if (l.kind !== 'pack') continue;
    const pack = byId(ctx, 'packs', l.pack_id);
    for (const it of ctx.db.all('SELECT * FROM pack_items WHERE pack_id=? AND company_id=? AND optional=0', pack.id, ctx.cid)) inPack.set(it.service_id, pack.name);
  }
  for (const l of opt.lines || []) {
    const pax = Number(l.pax) || Number(opt.pax);
    if (l.kind === 'service') {
      if (inPack.has(Number(l.service_id))) throw conflict(`«${byId(ctx, 'services', l.service_id).name}» ya está incluido en el pack «${inPack.get(Number(l.service_id))}»: no se añade dos veces`, 'duplicate_in_pack');
      const svc = byId(ctx, 'services', l.service_id);
      const pc = providerCost(ctx, svc.id, l.provider_id);
      out.push({ line: lineFromService(svc, { pax, qty: l.qty || 1, costOverride: pc.cost, providerId: pc.provider_id, optional: l.optional, selected: l.selected ?? 0,
        mandatory: l.mandatory == null ? undefined : !!l.mandatory, start_time: l.start_time }), children: [] });
    } else if (l.kind === 'pack') {
      const pack = byId(ctx, 'packs', l.pack_id);
      const items = ctx.db.all('SELECT * FROM pack_items WHERE pack_id=? AND company_id=? ORDER BY id', pack.id, ctx.cid);
      const hdrSelected = l.optional ? (l.selected ?? 0) : 1;
      const children = items.map((it) => {
        const svc = byId(ctx, 'services', it.service_id);
        const pc = providerCost(ctx, svc.id, (l.providers || {})[svc.id]);
        const wanted = !it.optional || (l.items_selected || []).includes(svc.id);
        const c = lineFromService(svc, { pax, qty: it.qty, costOverride: pc.cost, providerId: pc.provider_id, discountPct: pack.discount_pct, kind: 'pack_item',
          optional: it.optional, selected: hdrSelected && wanted ? 1 : 0, pack_id: pack.id, start_time: l.start_time });
        return c;
      });
      const sel = children.filter((c) => c.selected);
      out.push({ line: { kind: 'pack', service_id: null, pack_id: pack.id, parent_line_id: null, provider_id: null, description: pack.name, qty: 1, unit: 'pack', pax,
        unit_price_cents: 0, unit_cost_cents: 0, total_price_cents: sel.reduce((a, c) => a + c.total_price_cents, 0), total_cost_cents: sel.reduce((a, c) => a + c.total_cost_cents, 0),
        tax_bp: 1000, cost_tax_bp: 1000, optional: l.optional ? 1 : 0, selected: hdrSelected ? 1 : 0, mandatory: l.optional ? 0 : 1, start_time: null, snapshot: { name: pack.name, discount_pct: pack.discount_pct } }, children });
    } else if (l.kind === 'extra') {
      out.push({ line: lineExtra({ description: l.description, qty: l.qty, price_cents: Math.round(Number(l.price_cents) || 0), cost_cents: Math.round(Number(l.cost_cents) || 0),
        tax_bp: l.tax_bp ?? 1000, cost_tax_bp: l.cost_tax_bp ?? 1000, provider_id: l.provider_id, optional: l.optional, selected: l.selected ?? 0, mandatory: l.mandatory == null ? undefined : !!l.mandatory }), children: [] });
    } else throw badRequest('Tipo de línea no válido');
  }
  return out;
}

export function saveQuote(ctx, quoteId, input) {
  const { db, cid } = ctx;
  return db.tx(() => {
    let q;
    if (quoteId) {
      q = byId(ctx, 'quotes', quoteId);
      if (q.status !== 'draft') throw conflict('Una propuesta enviada no se edita: crea una nueva versión', 'not_draft');
    } else {
      const client = byId(ctx, 'clients', input.client_id);
      const brand = input.brand_id ? byId(ctx, 'brands', input.brand_id) : db.get('SELECT * FROM brands WHERE company_id=? ORDER BY is_default DESC, id LIMIT 1', cid);
      const set = settings(ctx);
      const id = db.insert('quotes', { company_id: cid, number: nextNumber(ctx, 'quotes', 'number', 'P'), version: 1, lead_id: input.lead_id ?? null, client_id: client.id,
        brand_id: brand?.id ?? null, title: input.title || `Propuesta para ${client.name}`, status: 'draft', valid_until: addDays(today(), set.quote_valid_days),
        deposit_pct: set.deposit_pct, created_by: ctx.user?.id ?? null, ai_generated: input.ai_generated ? 1 : 0, created_at: nowIso() });
      q = byId(ctx, 'quotes', id); audit(ctx, 'quote', id, 'creada');
    }
    const upd = {};
    for (const k of ['title', 'brand_id', 'notes_client', 'valid_until']) if (input[k] !== undefined) upd[k] = input[k] === '' ? null : input[k];
    if (input.deposit_pct !== undefined) { const d = Math.round(Number(input.deposit_pct)); if (!(d >= 0 && d <= 100)) throw badRequest('La señal debe estar entre 0 y 100 %'); upd.deposit_pct = d; }
    if (input.brand_id) byId(ctx, 'brands', input.brand_id);
    if (upd.valid_until && !/^\d{4}-\d{2}-\d{2}$/.test(upd.valid_until)) throw badRequest('Fecha de validez no válida');
    db.update('quotes', q.id, cid, upd);
    if (input.options) {
      if (!input.options.length) throw badRequest('Añade al menos una opción');
      db.run('DELETE FROM quote_lines WHERE company_id=? AND option_id IN (SELECT id FROM quote_options WHERE quote_id=? AND company_id=?)', cid, q.id, cid);
      db.run('DELETE FROM quote_options WHERE company_id=? AND quote_id=?', cid, q.id);
      input.options.forEach((o, i) => {
        const pax = Math.round(Number(o.pax));
        if (!(pax > 0)) throw badRequest('Indica el número de asistentes de cada opción');
        const oid = db.insert('quote_options', { company_id: cid, quote_id: q.id, name: o.name || `Opción ${i + 1}`, pax, event_date: o.event_date || null, start_time: o.start_time || null,
          discount_cents: Math.max(0, Math.round(Number(o.discount_cents) || 0)), notes: o.notes || null, position: i });
        let pos = 0;
        for (const { line, children } of buildLines(ctx, o)) {
          const pid = db.insert('quote_lines', { ...line, company_id: cid, option_id: oid, position: pos++ });
          for (const c of children) db.insert('quote_lines', { ...c, company_id: cid, option_id: oid, parent_line_id: pid, position: pos++ });
        }
      });
    }
    audit(ctx, 'quote', q.id, 'guardada');
    return loadQuote(ctx, q.id);
  });
}

// Nueva versión: la anterior queda sustituida y su enlace revocado. Los precios se conservan (copia congelada).
export function newVersion(ctx, id) {
  const { db, cid } = ctx;
  const old = loadQuote(ctx, id);
  if (['draft', 'superseded'].includes(old.status)) throw conflict('Solo se versionan propuestas enviadas/aceptadas/rechazadas', 'bad_state');
  if (old.status === 'accepted') throw conflict('La propuesta está aceptada: los cambios se gestionan sobre la reserva', 'accepted');
  return db.tx(() => {
    const max = db.get('SELECT MAX(version) v FROM quotes WHERE company_id=? AND number=?', cid, old.number).v;
    const nid = db.insert('quotes', { company_id: cid, number: old.number, version: max + 1, lead_id: old.lead_id, client_id: old.client_id, brand_id: old.brand_id, title: old.title,
      status: 'draft', valid_until: addDays(today(), settings(ctx).quote_valid_days), deposit_pct: old.deposit_pct, notes_client: old.notes_client, created_by: ctx.user?.id ?? null, created_at: nowIso() });
    for (const o of old.options) {
      const oid = db.insert('quote_options', { company_id: cid, quote_id: nid, name: o.name, pax: o.pax, event_date: o.event_date, start_time: o.start_time, discount_cents: o.discount_cents, notes: o.notes, position: o.position });
      const map = {};
      for (const l of o.lines) {
        const { id: lid, option_id, parent_line_id, ...rest } = l;
        map[lid] = db.insert('quote_lines', { ...rest, company_id: cid, option_id: oid, parent_line_id: parent_line_id ? map[parent_line_id] : null });
      }
    }
    db.run(`UPDATE quotes SET status='superseded', token_revoked_at=? WHERE id=? AND company_id=?`, nowIso(), old.id, cid);
    audit(ctx, 'quote', nid, 'nueva_version', { de: old.id });
    return loadQuote(ctx, nid);
  });
}

export function sendQuote(ctx, id, { skipMessage = false } = {}) {
  const q = loadQuote(ctx, id);
  if (!['draft', 'sent', 'changes_requested', 'expired'].includes(q.status)) throw conflict('Esta propuesta no se puede enviar', 'bad_state');
  if (!q.options.length || q.options.some((o) => !o.lines.length)) throw badRequest('Cada opción necesita al menos un servicio');
  if (q.valid_until < today()) throw badRequest('La fecha de validez ya ha pasado');
  if (q.ai_generated && !q.reviewed_by) throw conflict('Propuesta generada con IA: requiere revisión humana antes de enviarse', 'needs_review');
  const brand = q.brand_id ? byId(ctx, 'brands', q.brand_id) : null;
  const terms = { brand: brand?.name, payment: brand?.terms_payment, cancel: brand?.terms_cancel, general: brand?.terms_general,
    availability: 'La disponibilidad de cada servicio está sujeta a confirmación del proveedor. Aceptar la propuesta o pagar la señal no confirma por sí solo servicios pendientes.' };
  let tok;
  ctx.db.tx(() => {
    ctx.db.update('quotes', q.id, ctx.cid, { status: 'sent', sent_at: nowIso(), terms, token_expires_at: `${q.valid_until}T23:59:59Z`, followup_stopped: 0 });
    if (q.lead_id) ctx.db.run(`UPDATE leads SET stage='proposal_sent', last_contact_at=?, updated_at=? WHERE id=? AND company_id=? AND stage IN ('new','contacted')`, nowIso(), nowIso(), q.lead_id, ctx.cid);
    tok = mint(ctx, 'quotes', q.id);
    audit(ctx, 'quote', q.id, 'enviada', { version: q.version });
  });
  const link = `${BASE_URL}/#/q/${tok}`;
  let message = null;
  if (!skipMessage) {
    const client = byId(ctx, 'clients', q.client_id);
    message = queue(ctx, { channel: 'auto', client_id: client.id, lead_id: q.lead_id, brand_id: q.brand_id, template_key: 'quote_sent',
      vars: { nombre: client.name.split(' ')[0], evento: q.title, enlace: link, vence: fmtDate(q.valid_until), codigo: `${q.number} v${q.version}`, marca: brand?.name || 'GrupoListo' } });
  }
  return { quote: loadQuote(ctx, q.id), link, message };
}
export const quoteLink = (q) => (tokenOf('quotes', q) ? `${BASE_URL}/#/q/${tokenOf('quotes', q)}` : null);
export function revokeLink(ctx, id) {
  ctx.db.update('quotes', byId(ctx, 'quotes', id).id, ctx.cid, { token_revoked_at: nowIso() });
  audit(ctx, 'quote', id, 'enlace_revocado');
}

// ---- acceso público por enlace privado: el token determina empresa Y propuesta; nada más es accesible
export function resolveToken(db, token) {
  if (!token || token.length < 20) return null;
  const q = db.get('SELECT * FROM quotes WHERE token_hash=?', sha256(token));
  if (!q || q.token_revoked_at || q.status === 'superseded' || (q.token_expires_at && q.token_expires_at < nowIso() && q.status !== 'accepted')) return null;
  const ctx = sysctx(db, q.company_id); ctx.actor = 'cliente (enlace)';
  if (['sent', 'changes_requested'].includes(q.status) && q.valid_until < today()) { db.update('quotes', q.id, q.company_id, { status: 'expired' }); q.status = 'expired'; }
  return { ctx, quote: q };
}
export function publicView(ctx, id) {
  const q = loadQuote(ctx, id);
  if (!q.viewed_at) ctx.db.update('quotes', q.id, ctx.cid, { viewed_at: nowIso() });
  const brand = q.brand_id ? byId(ctx, 'brands', q.brand_id) : null;
  // Vista pública: sin costes ni márgenes
  const strip = (l) => ({ id: l.id, kind: l.kind, parent_line_id: l.parent_line_id, description: l.description, qty: l.qty, unit: l.unit, pax: l.pax, unit_price_cents: l.unit_price_cents,
    total_price_cents: l.total_price_cents, optional: l.optional, selected: l.selected, tax_bp: l.tax_bp,
    conditions: { cancel: l.snapshot?.cancel_terms, payment: l.snapshot?.payment_terms, duration_min: l.snapshot?.duration_min, location: l.snapshot?.location } });
  return { number: q.number, version: q.version, title: q.title, status: q.status, valid_until: q.valid_until, deposit_pct: q.deposit_pct, notes_client: q.notes_client, terms: q.terms,
    brand: brand && { name: brand.name, logo_url: brand.logo_url, email: brand.email, phone: brand.phone, color: brand.color, iban: brand.iban },
    accepted_at: q.accepted_at, accepted_option_id: q.accepted_option_id,
    options: q.options.map((o) => ({ id: o.id, name: o.name, pax: o.pax, event_date: o.event_date, start_time: o.start_time, notes: o.notes, lines: o.lines.map(strip),
      total_cents: o.totals.total_cents, discount_cents: o.totals.discount_cents, tax_cents: o.totals.tax_cents, net_cents: o.totals.net_cents, deposit_cents: o.deposit_cents, balance_cents: o.balance_cents })),
    includes_tax: true };
}

export function selectExtras(ctx, q, optionId, lineIds) {
  if (!['sent', 'changes_requested'].includes(q.status)) throw conflict('La propuesta ya no admite cambios de selección', 'bad_state');
  const o = byId(ctx, 'quote_options', optionId);
  if (o.quote_id !== q.id) throw badRequest('Opción no válida');
  const set = new Set((lineIds || []).map(Number));
  const lines = ctx.db.all('SELECT * FROM quote_lines WHERE company_id=? AND option_id=?', ctx.cid, o.id);
  const sel = {};
  for (const l of lines.filter((x) => x.kind !== 'pack_item')) sel[l.id] = l.optional ? (set.has(l.id) ? 1 : 0) : 1;
  for (const l of lines.filter((x) => x.kind === 'pack_item')) sel[l.id] = (sel[l.parent_line_id] ?? 1) && (l.optional ? (set.has(l.id) ? 1 : 0) : 1);
  for (const l of lines) if (sel[l.id] !== l.selected) ctx.db.update('quote_lines', l.id, ctx.cid, { selected: sel[l.id] });
  // recalcula cabeceras de pack
  for (const h of ctx.db.all(`SELECT * FROM quote_lines WHERE company_id=? AND option_id=? AND kind='pack'`, ctx.cid, o.id)) {
    const ch = ctx.db.all('SELECT * FROM quote_lines WHERE company_id=? AND parent_line_id=? AND selected=1', ctx.cid, h.id);
    ctx.db.update('quote_lines', h.id, ctx.cid, { total_price_cents: ch.reduce((a, c) => a + c.total_price_cents, 0), total_cost_cents: ch.reduce((a, c) => a + c.total_cost_cents, 0) });
  }
  audit(ctx, 'quote', q.id, 'seleccion_extras_cliente', { option: o.id, lineas: [...set] });
}

export function requestChanges(ctx, q, text, name) {
  if (!['sent', 'changes_requested'].includes(q.status)) throw conflict('La propuesta ya no admite solicitudes de cambio', 'bad_state');
  if (!String(text || '').trim()) throw badRequest('Cuéntanos qué quieres cambiar');
  ctx.db.update('quotes', q.id, ctx.cid, { status: 'changes_requested', followup_stopped: 1 });
  ctx.db.insert('interactions', { company_id: ctx.cid, lead_id: q.lead_id, client_id: q.client_id, kind: 'solicitud_cambios', body: String(text).slice(0, 2000), at: nowIso() });
  if (q.lead_id) { ctx.db.run(`UPDATE leads SET stage='negotiation', last_inbound_at=?, updated_at=? WHERE id=? AND company_id=? AND stage IN ('new','contacted','proposal_sent')`, nowIso(), nowIso(), q.lead_id, ctx.cid); }
  addTask(ctx, { title: `Cliente pide cambios en ${q.number} v${q.version}`, lead_id: q.lead_id, auto_key: `chg:${q.id}:${Date.now()}` });
  audit(ctx, 'quote', q.id, 'cambios_solicitados', { text: String(text).slice(0, 300), name });
}

export function acceptQuote(ctx, q, { option_id, accept_terms, name, ip }) {
  if (!accept_terms) throw badRequest('Debes aceptar las condiciones para continuar', 'terms_required');
  if (!['sent', 'changes_requested'].includes(q.status)) throw conflict('Esta propuesta ya no se puede aceptar', 'bad_state');
  if (q.valid_until < today()) throw conflict('La propuesta ha caducado', 'expired');
  const full = loadQuote(ctx, q.id);
  const opt = full.options.find((o) => o.id === Number(option_id));
  if (!opt) throw badRequest('Elige una de las opciones');
  if (!opt.event_date) throw badRequest('La opción no tiene fecha definida: pide a la agencia que la complete');
  if (!String(name || '').trim()) throw badRequest('Indica tu nombre para registrar la aceptación');
  return ctx.db.tx(() => {
    const hash = sha256(JSON.stringify({ terms: full.terms, option: opt.id, total: opt.totals.total_cents, lines: opt.lines.filter((l) => l.selected).map((l) => [l.description, l.total_price_cents]) }));
    ctx.db.update('quotes', q.id, ctx.cid, { status: 'accepted', accepted_at: nowIso(), accepted_option_id: opt.id, accepted_version: q.version, accepted_terms_hash: hash,
      accepted_ip: ip || null, accepted_by_name: String(name).trim(), followup_stopped: 1 });
    const lines = opt.lines.filter((l) => l.selected && l.kind !== 'pack');
    const ev = createEventFromQuote(ctx, { ...q, status: 'accepted' }, opt, opt.lines);
    ctx.db.update('quotes', q.id, ctx.cid, { event_id: ev.id });
    if (q.lead_id) ctx.db.run(`UPDATE leads SET stage='pending_deposit', pax_final=?, last_inbound_at=?, updated_at=? WHERE id=? AND company_id=?`, opt.pax, nowIso(), nowIso(), q.lead_id, ctx.cid);
    const set = settings(ctx);
    let pay = null;
    if (ev.deposit_required_cents > 0) {
      pay = createPaymentIn(ctx, ev.id, { kind: 'deposit', amount_cents: ev.deposit_required_cents, with_token: true, payer_name: String(name).trim(), due_date: addDays(today(), set.deposit_due_days) });
      queue(ctx, { channel: 'auto', client_id: q.client_id, lead_id: q.lead_id, event_id: ev.id, brand_id: q.brand_id, template_key: 'deposit_request', dedupe_key: `deposit_request:${ev.id}`,
        vars: { ...eventVars(ctx, ev), importe: new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(ev.deposit_required_cents / 100),
          enlace: pay.link, vence: fmtDate(addDays(today(), set.deposit_due_days)) } });
    }
    audit(ctx, 'quote', q.id, 'aceptada', { option: opt.name, version: q.version, terms_hash: hash, por: name, ip });
    if (set.auto_request_on_accept) for (const s of ctx.db.all('SELECT id FROM event_services WHERE company_id=? AND event_id=?', ctx.cid, ev.id)) { try { startService(ctx, s.id); } catch { /* queda pendiente de solicitar */ } }
    return { event_id: ev.id, event_code: ev.code, deposit_cents: ev.deposit_required_cents, pay_link: pay?.link || null,
      message: 'Propuesta aceptada. Tu reserva queda PENDIENTE DE CONFIRMACIÓN: confirmaremos cada servicio con los proveedores y te avisaremos.' };
  });
}
export function rejectQuote(ctx, q, reason) {
  if (!['sent', 'changes_requested'].includes(q.status)) throw conflict('La propuesta ya no admite esta acción', 'bad_state');
  ctx.db.update('quotes', q.id, ctx.cid, { status: 'rejected', followup_stopped: 1 });
  audit(ctx, 'quote', q.id, 'rechazada', { reason });
}
