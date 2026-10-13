import { audit, byId, parseRow, sysctx } from '../core.js';
import { badRequest, conflict, HttpError, nowIso, interpolate } from '../util.js';
import { str, need, pick, bool } from './util.js';
import { queue, processQueue, retry, recordInbound, renderTemplate, TEMPLATE_VARS } from '../comms.js';
import { statusList, getConfig, verifyMetaSignature } from '../integrations.js';
import { tick } from '../automations.js';

export default function (r, db) {
  r.get('/api/messages', 'comms:r', (c) => {
    const a = [c.ctx.cid]; let w = ''; const q = c.query;
    for (const [k, col] of [['channel', 'channel'], ['status', 'status'], ['client_id', 'client_id'], ['provider_id', 'provider_id'], ['event_id', 'event_id'], ['lead_id', 'lead_id']]) if (q[k]) { w += ` AND m.${col}=?`; a.push(q[k]); }
    return db.all(`SELECT m.*, cl.name client_name, p.name provider_name, e.code event_code FROM messages m LEFT JOIN clients cl ON cl.id=m.client_id LEFT JOIN providers p ON p.id=m.provider_id LEFT JOIN events e ON e.id=m.event_id
      WHERE m.company_id=? ${w} ORDER BY m.id DESC LIMIT 300`, ...a).map(({ meta, ...m }) => m);
  });
  r.get('/api/conversations', 'comms:r', (c) => db.all(`SELECT 'c' || m.client_id AS key, 'cliente' kind, m.client_id id, cl.name name, COUNT(*) total, MAX(m.id) last_id, MAX(m.created_at) last_at,
      SUM(m.status IN ('failed','not_configured','blocked')) problems, SUM(m.direction='in') inbound FROM messages m JOIN clients cl ON cl.id=m.client_id WHERE m.company_id=? AND m.client_id IS NOT NULL GROUP BY m.client_id
    UNION ALL SELECT 'p' || m.provider_id, 'proveedor', m.provider_id, p.name, COUNT(*), MAX(m.id), MAX(m.created_at), SUM(m.status IN ('failed','not_configured','blocked')), SUM(m.direction='in')
      FROM messages m JOIN providers p ON p.id=m.provider_id WHERE m.company_id=? AND m.provider_id IS NOT NULL GROUP BY m.provider_id ORDER BY last_at DESC LIMIT 200`, c.ctx.cid, c.ctx.cid));
  r.get('/api/comms/status', 'comms:r', (c) => ({ counts: db.all('SELECT status, COUNT(*) n FROM messages WHERE company_id=? GROUP BY status', c.ctx.cid),
    integrations: statusList(c.ctx).filter((x) => ['email', 'whatsapp'].includes(x.key)).map(({ key, label, connected }) => ({ key, label, connected })) }));

  // Envío manual. El mensaje pasa por la misma cola: si la integración no está conectada queda «pendiente de conectar», NO «enviado».
  r.post('/api/messages', 'comms:w', async (c) => {
    const b = c.body;
    if (!['email', 'whatsapp', 'auto'].includes(b.channel)) throw badRequest('Canal no válido');
    if (!!b.client_id === !!b.provider_id) throw badRequest('Elige un único destinatario (cliente o proveedor)');
    if (b.client_id) byId(c.ctx, 'clients', b.client_id); if (b.provider_id) byId(c.ctx, 'providers', b.provider_id);
    if (b.event_id) byId(c.ctx, 'events', b.event_id); if (b.lead_id) byId(c.ctx, 'leads', b.lead_id);
    if (!b.template_key) { need(b.body, 'Escribe el mensaje'); if ((b.channel === 'email' || b.channel === 'auto') && !String(b.subject || '').trim()) throw badRequest('Escribe el asunto'); }
    const m = queue(c.ctx, { channel: b.channel, client_id: b.client_id, provider_id: b.provider_id, event_id: b.event_id, event_service_id: b.event_service_id, lead_id: b.lead_id, template_key: b.template_key,
      vars: b.vars, subject: str(b.subject, 200), body: str(b.body, 5000), automatic: false });
    if (b.lead_id) db.run('UPDATE leads SET last_contact_at=?, updated_at=? WHERE id=? AND company_id=?', nowIso(), nowIso(), b.lead_id, c.ctx.cid);
    await processQueue(db);                                  // intenta enviar ya; el resultado real queda registrado
    audit(c.ctx, 'message', m.id, 'creado_manual');
    const out = db.get('SELECT id,channel,status,error,to_addr FROM messages WHERE id=?', m.id); return out;
  });
  r.post('/api/messages/:id/retry', 'comms:w', async (c) => { retry(c.ctx, Number(c.params.id)); await processQueue(db); return db.get('SELECT id,status,error,attempts FROM messages WHERE id=? AND company_id=?', Number(c.params.id), c.ctx.cid); });
  r.post('/api/messages/inbound', 'comms:w', (c) => { need(c.body.from, 'Origen'); need(c.body.body, 'Texto'); const id = recordInbound(c.ctx, { channel: ['email', 'whatsapp'].includes(c.body.channel) ? c.body.channel : 'email', from: c.body.from, body: str(c.body.body, 5000) }); audit(c.ctx, 'message', id, 'respuesta_registrada'); return { id }; });
  r.post('/api/comms/process', 'comms:w', async (c) => ({ sent: await tick(db) }));

  // ---- plantillas
  r.get('/api/templates', 'comms:r', (c) => ({ templates: db.all('SELECT t.*, b.name brand_name FROM templates t LEFT JOIN brands b ON b.id=t.brand_id WHERE t.company_id=? ORDER BY t.audience, t.key, t.channel', c.ctx.cid), variables: TEMPLATE_VARS }));
  r.put('/api/templates/:id', 'comms:w', (c) => { byId(c.ctx, 'templates', c.params.id); db.update('templates', Number(c.params.id), c.ctx.cid, { ...pick(c.body, ['subject', 'body', 'wa_template_name']), ...(c.body.active !== undefined ? { active: bool(c.body.active) } : {}) }); audit(c.ctx, 'template', Number(c.params.id), 'actualizada'); return byId(c.ctx, 'templates', c.params.id); });
  r.post('/api/templates', 'comms:w', (c) => {
    const b = c.body; need(b.key, 'Clave'); need(b.body, 'Cuerpo'); if (!['email', 'whatsapp'].includes(b.channel)) throw badRequest('Canal no válido');
    if (b.brand_id) byId(c.ctx, 'brands', b.brand_id);
    const id = db.insert('templates', { company_id: c.ctx.cid, brand_id: b.brand_id || null, key: String(b.key).replace(/[^\w]/g, '_'), channel: b.channel, audience: b.audience === 'provider' ? 'provider' : 'client', subject: str(b.subject, 200), body: str(b.body, 5000), wa_template_name: str(b.wa_template_name, 100) });
    return byId(c.ctx, 'templates', id);
  });
  r.post('/api/templates/preview', 'comms:r', (c) => ({ subject: interpolate(c.body.subject, c.body.vars || {}), body: interpolate(c.body.body, c.body.vars || {}) }));

  // ---- WhatsApp Cloud API: verificación del webhook, estados reales de entrega y mensajes entrantes
  r.get('/api/webhooks/whatsapp/:slug', null, (c) => {
    const co = db.get('SELECT id FROM companies WHERE slug=?', c.params.slug);
    const cfg = co && getConfig({ db, cid: co.id }, 'whatsapp').config;
    if (cfg?.verify_token && c.query['hub.mode'] === 'subscribe' && c.query['hub.verify_token'] === cfg.verify_token) return { __raw: String(c.query['hub.challenge'] || ''), type: 'text/plain' };
    throw new HttpError(403, 'Verificación no válida');
  });
  r.post('/api/webhooks/whatsapp/:slug', null, (c) => {
    const co = db.get('SELECT id FROM companies WHERE slug=?', c.params.slug); if (!co) throw new HttpError(404, 'No encontrado');
    const ctx = sysctx(db, co.id); ctx.actor = 'whatsapp';
    if (!verifyMetaSignature(c.raw, c.req.headers['x-hub-signature-256'], getConfig(ctx, 'whatsapp').config.app_secret)) throw new HttpError(401, 'Firma no válida');
    const payload = JSON.parse(c.raw || '{}'); let n = 0;
    for (const entry of payload.entry || []) for (const ch of entry.changes || []) {
      for (const s of ch.value?.statuses || []) {
        const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
        if (map[s.status]) { db.run('UPDATE messages SET status=?, error=? WHERE company_id=? AND external_id=?', map[s.status], s.status === 'failed' ? (s.errors?.[0]?.title || 'Fallo de entrega') : null, co.id, s.id); n++; }
      }
      for (const m of ch.value?.messages || []) { recordInbound(ctx, { channel: 'whatsapp', from: m.from, body: m.text?.body || `[${m.type}]`, external_id: m.id }); n++; }
    }
    return { ok: true, processed: n };
  }, { raw: true });
}
