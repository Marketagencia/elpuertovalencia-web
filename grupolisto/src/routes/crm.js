import { audit, byId, parseRow, settings, addTask } from '../core.js';
import { badRequest, conflict, nowIso, parseJson, addDays, today, HttpError } from '../util.js';
import { pick, str, need, num, bool, eurosToCents } from './util.js';
import { onLeadCreated } from '../automations.js';
import * as ai from '../ai.js';
import { saveQuote, loadQuote } from '../quotes.js';
import { can } from '../perm.js';

const CLIENT_COLS = ['name', 'email', 'phone', 'company_name', 'contact_pref', 'notes'];
const LEAD_COLS = ['title', 'event_type', 'services_requested', 'source', 'notes', 'preferences', 'brand_id', 'owner_user_id'];

function logConsent(ctx, clientId, channel, granted, source, evidence) {
  ctx.db.insert('consents', { company_id: ctx.cid, client_id: clientId, channel, granted: granted ? 1 : 0, source, evidence: evidence || null, at: nowIso() });
}
export function createClient(ctx, b, source = 'alta manual') {
  need(b.name, 'El nombre es obligatorio');
  if (!b.email && !b.phone) throw badRequest('Indica email o teléfono de contacto');
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw badRequest('Email no válido');
  const id = ctx.db.insert('clients', { company_id: ctx.cid, name: str(b.name, 120), email: str(b.email, 160)?.toLowerCase(), phone: str(b.phone, 30), company_name: str(b.company_name, 120),
    contact_pref: ['email', 'whatsapp', 'phone'].includes(b.contact_pref) ? b.contact_pref : 'email', consent_email: bool(b.consent_email), consent_whatsapp: bool(b.consent_whatsapp),
    notes: str(b.notes, 2000), created_at: nowIso() });
  if (b.consent_email) logConsent(ctx, id, 'email', true, source, b.consent_evidence);
  if (b.consent_whatsapp) logConsent(ctx, id, 'whatsapp', true, source, b.consent_evidence);
  return id;
}
export function createLead(ctx, b, source) {
  const clientId = b.client_id ? byId(ctx, 'clients', b.client_id).id : createClient(ctx, b.client || {}, source || 'alta manual');
  const dates = (Array.isArray(b.dates_alt) ? b.dates_alt : String(b.dates_alt || '').split(/[,;\s]+/)).filter(Boolean);
  for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw badRequest('Las fechas deben tener formato AAAA-MM-DD');
  const client = byId(ctx, 'clients', clientId);
  const id = ctx.db.insert('leads', { company_id: ctx.cid, client_id: clientId, brand_id: b.brand_id || null, title: str(b.title, 160) || `${b.event_type || 'Consulta'} · ${client.name}`,
    event_type: str(b.event_type, 60), dates_alt: dates, pax_estimated: num(b.pax_estimated, 'Asistentes', { min: 1, max: 5000 }), pax_final: num(b.pax_final, 'Asistentes definitivos', { min: 1, max: 5000 }),
    budget_cents: b.budget_cents ?? eurosToCents(b.budget_eur), services_requested: str(b.services_requested, 1000), source: str(b.source, 60) || source || 'manual',
    owner_user_id: b.owner_user_id || ctx.user?.id || null, stage: 'new', notes: str(b.notes, 2000), preferences: str(b.preferences, 1000), created_at: nowIso(), updated_at: nowIso() });
  audit(ctx, 'lead', id, 'creada', { source: b.source });
  onLeadCreated(ctx, byId(ctx, 'leads', id));
  return id;
}

export default function (r, db) {
  // ------------------------------------------------------------------ clientes
  r.get('/api/clients', 'clients:r', (c) => {
    const q = `%${String(c.query.q || '').toLowerCase()}%`;
    return db.all(`SELECT c.*, (SELECT COUNT(*) FROM leads l WHERE l.client_id=c.id) leads, (SELECT COUNT(*) FROM events e WHERE e.client_id=c.id) events
      FROM clients c WHERE c.company_id=? AND c.anonymized_at IS NULL AND (lower(c.name) LIKE ? OR lower(COALESCE(c.email,'')) LIKE ? OR lower(COALESCE(c.company_name,'')) LIKE ?) ORDER BY c.id DESC LIMIT 300`, c.ctx.cid, q, q, q);
  });
  r.post('/api/clients', 'clients:w', (c) => { const id = createClient(c.ctx, c.body); audit(c.ctx, 'client', id, 'creado'); return byId(c.ctx, 'clients', id); });
  r.get('/api/clients/:id', 'clients:r', (c) => {
    const cl = byId(c.ctx, 'clients', c.params.id), cid = c.ctx.cid;
    return { client: cl, consents: db.all('SELECT * FROM consents WHERE company_id=? AND client_id=? ORDER BY id DESC', cid, cl.id),
      leads: db.all('SELECT * FROM leads WHERE company_id=? AND client_id=? ORDER BY id DESC', cid, cl.id).map(parseRow),
      quotes: db.all('SELECT id,number,version,title,status,valid_until,sent_at,accepted_at FROM quotes WHERE company_id=? AND client_id=? ORDER BY id DESC', cid, cl.id),
      events: db.all('SELECT id,code,name,date,pax,status,booking_status,payment_status,total_due_cents FROM events WHERE company_id=? AND client_id=? ORDER BY date DESC', cid, cl.id),
      interactions: db.all('SELECT * FROM interactions WHERE company_id=? AND client_id=? ORDER BY id DESC LIMIT 100', cid, cl.id),
      messages: db.all('SELECT id,channel,direction,subject,body,status,error,created_at FROM messages WHERE company_id=? AND client_id=? ORDER BY id DESC LIMIT 100', cid, cl.id) };
  });
  r.put('/api/clients/:id', 'clients:w', (c) => {
    const cl = byId(c.ctx, 'clients', c.params.id), b = c.body;
    const upd = pick(b, CLIENT_COLS);
    if (upd.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(upd.email)) throw badRequest('Email no válido');
    for (const ch of ['email', 'whatsapp']) {
      const k = `consent_${ch}`;
      if (b[k] !== undefined && bool(b[k]) !== cl[k]) { upd[k] = bool(b[k]); logConsent(c.ctx, cl.id, ch, b[k], b.consent_source || 'actualización manual', b.consent_evidence); }
    }
    db.update('clients', cl.id, c.ctx.cid, upd); audit(c.ctx, 'client', cl.id, 'actualizado');
    return byId(c.ctx, 'clients', cl.id);
  });
  // Derecho de supresión: se anonimizan los datos personales; se conservan los registros económicos exigidos por ley
  r.post('/api/clients/:id/erase', 'config:w', (c) => {
    const cl = byId(c.ctx, 'clients', c.params.id), cid = c.ctx.cid;
    db.tx(() => {
      db.update('clients', cl.id, cid, { name: `Cliente anonimizado #${cl.id}`, email: null, phone: null, company_name: null, notes: null, consent_email: 0, consent_whatsapp: 0, anonymized_at: nowIso() });
      db.run(`UPDATE messages SET to_addr=NULL, body='[eliminado]', subject=NULL WHERE company_id=? AND client_id=?`, cid, cl.id);
      db.run(`UPDATE interactions SET body='[eliminado]' WHERE company_id=? AND client_id=?`, cid, cl.id);
      db.run(`UPDATE payments_in SET payer_name=NULL, payer_email=NULL WHERE company_id=? AND event_id IN (SELECT id FROM events WHERE client_id=?)`, cid, cl.id);
      db.run(`UPDATE quotes SET token_revoked_at=? WHERE company_id=? AND client_id=?`, nowIso(), cid, cl.id);
      db.run(`UPDATE users SET active=0 WHERE company_id=? AND client_id=?`, cid, cl.id);
      logConsent(c.ctx, cl.id, 'all', false, 'supresión', 'Solicitud de eliminación de datos');
    });
    audit(c.ctx, 'client', cl.id, 'anonimizado'); return { ok: true };
  });
  r.get('/api/clients/:id/export', 'config:w', (c) => {
    const cl = byId(c.ctx, 'clients', c.params.id), cid = c.ctx.cid;
    const out = { client: cl, consents: db.all('SELECT * FROM consents WHERE company_id=? AND client_id=?', cid, cl.id), leads: db.all('SELECT * FROM leads WHERE company_id=? AND client_id=?', cid, cl.id),
      quotes: db.all('SELECT id,number,version,title,status,created_at FROM quotes WHERE company_id=? AND client_id=?', cid, cl.id), events: db.all('SELECT * FROM events WHERE company_id=? AND client_id=?', cid, cl.id),
      messages: db.all('SELECT * FROM messages WHERE company_id=? AND client_id=?', cid, cl.id) };
    audit(c.ctx, 'client', cl.id, 'exportacion_datos_personales');
    return { __raw: JSON.stringify(out, null, 1), type: 'application/json', headers: { 'Content-Disposition': `attachment; filename="cliente-${cl.id}.json"` } };
  });

  // ------------------------------------------------------------------ consultas / embudo
  r.get('/api/leads', 'leads:r', (c) => {
    const a = [c.ctx.cid]; let w = '';
    if (c.query.stage) { w += ' AND l.stage=?'; a.push(c.query.stage); }
    if (c.query.owner) { w += ' AND l.owner_user_id=?'; a.push(Number(c.query.owner)); }
    return db.all(`SELECT l.*, c.name client_name, c.email client_email, c.phone client_phone, u.name owner_name,
      (SELECT COUNT(*) FROM quotes q WHERE q.lead_id=l.id) quotes FROM leads l JOIN clients c ON c.id=l.client_id LEFT JOIN users u ON u.id=l.owner_user_id
      WHERE l.company_id=? ${w} ORDER BY l.updated_at DESC LIMIT 500`, ...a).map(parseRow);
  });
  r.post('/api/leads', 'leads:w', (c) => { const id = createLead(c.ctx, c.body); return byId(c.ctx, 'leads', id); });
  r.get('/api/leads/:id', 'leads:r', (c) => {
    const l = byId(c.ctx, 'leads', c.params.id), cid = c.ctx.cid;
    return { lead: l, client: byId(c.ctx, 'clients', l.client_id),
      quotes: db.all('SELECT id,number,version,title,status,valid_until,sent_at,ai_generated,reviewed_by FROM quotes WHERE company_id=? AND lead_id=? ORDER BY id DESC', cid, l.id),
      events: db.all('SELECT id,code,name,date,pax,status,booking_status,payment_status FROM events WHERE company_id=? AND lead_id=?', cid, l.id),
      tasks: db.all('SELECT * FROM tasks WHERE company_id=? AND lead_id=? ORDER BY done_at IS NOT NULL, due_at', cid, l.id),
      interactions: db.all('SELECT i.*, u.name user_name FROM interactions i LEFT JOIN users u ON u.id=i.user_id WHERE i.company_id=? AND i.lead_id=? ORDER BY i.id DESC', cid, l.id),
      messages: db.all('SELECT id,channel,direction,subject,body,status,error,created_at FROM messages WHERE company_id=? AND (lead_id=? OR client_id=?) ORDER BY id DESC LIMIT 50', cid, l.id, l.client_id) };
  });
  r.put('/api/leads/:id', 'leads:w', (c) => {
    const l = byId(c.ctx, 'leads', c.params.id), b = c.body;
    const upd = pick(b, LEAD_COLS);
    if (b.pax_estimated !== undefined) upd.pax_estimated = num(b.pax_estimated, 'Asistentes', { min: 1, max: 5000 });
    if (b.pax_final !== undefined) upd.pax_final = num(b.pax_final, 'Asistentes definitivos', { min: 1, max: 5000 });
    if (b.budget_eur !== undefined) upd.budget_cents = eurosToCents(b.budget_eur);
    if (b.dates_alt !== undefined) upd.dates_alt = (Array.isArray(b.dates_alt) ? b.dates_alt : String(b.dates_alt).split(/[,;\s]+/)).filter(Boolean);
    if (b.stage && b.stage !== l.stage) {
      const st = db.get('SELECT * FROM pipeline_stages WHERE company_id=? AND key=?', c.ctx.cid, b.stage);
      if (!st) throw badRequest('Etapa no válida');
      // El estado comercial NO sustituye al estado de reserva/pago: «reserva confirmada»/«finalizado» solo los fija el sistema
      if (['won', 'done'].includes(st.kind)) throw conflict('Ese estado se establece automáticamente cuando la reserva queda confirmada o el evento finaliza', 'auto_stage');
      if (st.kind === 'lost' && !String(b.lost_reason || '').trim()) throw badRequest('Indica el motivo de la pérdida');
      upd.stage = b.stage; if (st.kind === 'lost') upd.lost_reason = str(b.lost_reason, 300);
      if (st.kind === 'lost' || st.kind === 'cancelled') db.run(`UPDATE quotes SET followup_stopped=1 WHERE company_id=? AND lead_id=?`, c.ctx.cid, l.id);
      audit(c.ctx, 'lead', l.id, `etapa:${l.stage}→${b.stage}`);
    }
    db.update('leads', l.id, c.ctx.cid, { ...upd, updated_at: nowIso() });
    return byId(c.ctx, 'leads', l.id);
  });
  r.post('/api/leads/:id/contact', 'leads:w', (c) => {
    const l = byId(c.ctx, 'leads', c.params.id);
    const kind = ['llamada', 'nota', 'reunion', 'whatsapp_manual', 'email_manual'].includes(c.body.kind) ? c.body.kind : 'nota';
    need(c.body.body, 'Escribe una nota');
    db.insert('interactions', { company_id: c.ctx.cid, lead_id: l.id, client_id: l.client_id, kind, body: str(c.body.body, 2000), user_id: c.user.id, at: nowIso() });
    db.update('leads', l.id, c.ctx.cid, { last_contact_at: nowIso(), updated_at: nowIso(), ...(l.stage === 'new' ? { stage: 'contacted' } : {}) });
    if (c.body.followup_in_days) addTask(c.ctx, { title: `Seguimiento: ${l.title}`, lead_id: l.id, assigned_to: c.user.id, due_in_days: Number(c.body.followup_in_days) });
    return { ok: true };
  });

  // ------------------------------------------------------------------ tareas
  r.get('/api/tasks', 'staff', (c) => {
    const a = [c.ctx.cid]; let w = '';
    if (c.query.open !== '0') w += ' AND t.done_at IS NULL';
    if (c.query.mine === '1') { w += ' AND (t.assigned_to=? OR t.assigned_to IS NULL)'; a.push(c.user.id); }
    if (c.query.event_id) { w += ' AND t.event_id=?'; a.push(Number(c.query.event_id)); }
    return db.all(`SELECT t.*, e.code event_code, l.title lead_title FROM tasks t LEFT JOIN events e ON e.id=t.event_id LEFT JOIN leads l ON l.id=t.lead_id WHERE t.company_id=? ${w} ORDER BY (t.kind='incident') DESC, t.due_at LIMIT 300`, ...a);
  });
  r.post('/api/tasks', 'tasks:w', (c) => {
    need(c.body.title, 'Título obligatorio');
    if (c.body.lead_id) byId(c.ctx, 'leads', c.body.lead_id); if (c.body.event_id) byId(c.ctx, 'events', c.body.event_id);
    const id = db.insert('tasks', { company_id: c.ctx.cid, lead_id: c.body.lead_id || null, event_id: c.body.event_id || null, assigned_to: c.body.assigned_to || c.user.id, title: str(c.body.title, 200),
      kind: c.body.kind === 'incident' ? 'incident' : 'task', due_at: c.body.due_at || today(), created_at: nowIso() });
    audit(c.ctx, 'task', id, 'creada'); return byId(c.ctx, 'tasks', id);
  });
  r.put('/api/tasks/:id', 'tasks:w', (c) => {
    byId(c.ctx, 'tasks', c.params.id);
    db.update('tasks', Number(c.params.id), c.ctx.cid, { ...(c.body.done !== undefined ? { done_at: c.body.done ? nowIso() : null } : {}), ...pick(c.body, ['title', 'due_at', 'assigned_to']) });
    return byId(c.ctx, 'tasks', c.params.id);
  });

  // ------------------------------------------------------------------ asistente (local, con revisión humana)
  r.post('/api/ai/extract', 'ai:use', (c) => ai.extractRequest(c.body.text));
  r.get('/api/leads/:id/assist', 'ai:use', (c) => {
    const l = byId(c.ctx, 'leads', c.params.id), cl = byId(c.ctx, 'clients', l.client_id);
    const events = db.all('SELECT * FROM events WHERE company_id=? AND lead_id=?', c.ctx.cid, l.id);
    const sugg = ai.suggest(c.ctx, l);
    return { missing: ai.missingInfo({ ...l, dates_alt: JSON.stringify(l.dates_alt) }, cl), suggestions: sugg, risks: ai.risks({ ...l, dates_alt: JSON.stringify(l.dates_alt) }, events),
      draft_reply: ai.draftReply(l, cl, sugg), engine: 'reglas locales (Claude API pendiente de conectar)', requires_human_review: true };
  });
  // Genera un BORRADOR de propuesta con packs del catálogo: no se puede enviar hasta que una persona la revise
  r.post('/api/leads/:id/ai-proposal', 'ai:use', (c) => {
    const l = byId(c.ctx, 'leads', c.params.id);
    const sugg = ai.suggest(c.ctx, l);
    if (!sugg.packs.length) throw conflict('No hay packs del catálogo que encajen con la consulta. Crea la propuesta manualmente.', 'no_match');
    if (!l.pax_estimated) throw badRequest('Falta el número de asistentes');
    const q = saveQuote(c.ctx, null, { client_id: l.client_id, lead_id: l.id, brand_id: l.brand_id, title: `Propuesta · ${l.title}`, ai_generated: true,
      options: sugg.packs.slice(0, 2).map((p, i) => ({ name: `Opción ${i + 1}: ${p.name}`, pax: l.pax_estimated, event_date: l.dates_alt[0] || null, lines: [{ kind: 'pack', pack_id: p.id }] })) });
    audit(c.ctx, 'quote', q.id, 'borrador_ia_creado', { lead: l.id });
    return { quote_id: q.id, notice: 'Borrador generado con datos del catálogo. Revisa precios y condiciones y marca la propuesta como revisada antes de enviarla.' };
  });

  // ------------------------------------------------------------------ formulario web público (consultas entrantes)
  r.post('/api/public/leads/:slug', null, (c) => {
    const co = db.get('SELECT id FROM companies WHERE slug=?', c.params.slug);
    if (!co) throw new HttpError(404, 'No encontrado');
    if (!c.limit(`lead:${c.ip}`, 5, 600000)) throw new HttpError(429, 'Demasiadas solicitudes');
    const b = c.body;
    if (b.website) return { ok: true };                     // honeypot anti-spam
    if (!b.privacy_accepted) throw badRequest('Debes aceptar la política de privacidad');
    const ctx = { db, cid: co.id, user: null, actor: 'formulario web' };
    const id = createLead(ctx, { client: { name: b.name, email: b.email, phone: b.phone, consent_email: !!b.email, consent_whatsapp: !!b.consent_whatsapp, consent_evidence: `Formulario web ${nowIso()} · IP ${c.ip}` },
      event_type: b.event_type, pax_estimated: b.pax, dates_alt: b.date ? [b.date] : [], budget_eur: b.budget, services_requested: b.services, notes: b.message, source: 'web', owner_user_id: null }, 'formulario web');
    return { ok: true, reference: id };
  });
}
