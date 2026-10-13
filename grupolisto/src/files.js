import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { badRequest, nowIso } from './util.js';
import { audit } from './core.js';

const TYPES = { 'application/pdf': ['pdf', (b) => b.subarray(0, 4).toString() === '%PDF'], 'image/png': ['png', (b) => b[0] === 0x89 && b[1] === 0x50],
  'image/jpeg': ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8], 'image/webp': ['webp', (b) => b.subarray(0, 4).toString() === 'RIFF'] };
export const MAX_BYTES = 5 * 1024 * 1024;

export function saveDocument(ctx, { entity, entity_id, name, mime, base64, kind, visibility = 'internal', uploaded_by }) {
  const t = TYPES[mime];
  if (!t) throw badRequest('Tipo de archivo no permitido (PDF, PNG, JPG o WebP)');
  const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length || buf.length > MAX_BYTES) throw badRequest('El archivo está vacío o supera 5 MB');
  if (!t[1](buf)) throw badRequest('El contenido del archivo no coincide con su tipo');
  const dir = path.join(DATA_DIR, 'uploads', String(ctx.cid));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${crypto.randomBytes(16).toString('hex')}.${t[0]}`);
  fs.writeFileSync(file, buf, { mode: 0o600 });
  const id = ctx.db.insert('documents', { company_id: ctx.cid, entity, entity_id, name: String(name || `documento.${t[0]}`).replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 120),
    kind: kind || null, mime, path: file, size: buf.length, visibility, uploaded_by: uploaded_by || ctx.actor, created_at: nowIso() });
  audit(ctx, 'document', id, 'subido', { entity, entity_id, name });
  return ctx.db.get('SELECT id,entity,entity_id,name,kind,mime,size,visibility,uploaded_by,created_at FROM documents WHERE id=?', id);
}
export const readDocument = (doc) => fs.readFileSync(doc.path);
