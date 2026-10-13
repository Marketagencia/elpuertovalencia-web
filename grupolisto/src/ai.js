// Asistente (Fase 2, versión local): extrae datos de solicitudes, detecta lo que falta, sugiere packs y redacta BORRADORES.
// Usa solo el catálogo y los datos de la empresa. No inventa precios, disponibilidad, confirmaciones ni pagos.
// Toda propuesta generada queda marcada ai_generated y exige revisión humana antes de enviarse.
import { eur, today } from './util.js';

const TYPES = [['despedida', /despedid/i], ['cumpleaños', /cumplea/i], ['comida de empresa', /comida.*empresa|empresa.*comida/i], ['cena de empresa', /cena.*empresa|empresa.*cena/i],
  ['team building', /team ?building/i], ['boda', /boda/i], ['celebración', /celebraci/i]];
export function extractRequest(text = '') {
  const t = String(text);
  const pax = t.match(/(\d{1,3})\s*(personas|pax|asistentes|invitados|amig|chic[oa]s)/i) || t.match(/(?:somos|para)\s+(\d{1,3})\b/i);
  const date = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  const budget = t.match(/(\d[\d.]*)\s*€|€\s*(\d[\d.]*)|presupuesto[^\d]{0,15}(\d[\d.]*)/i);
  const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/), phone = t.match(/(?:\+34\s?)?[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/);
  return { event_type: (TYPES.find(([, r]) => r.test(t)) || [])[0] || null, pax: pax ? Number(pax[1]) : null,
    date: date ? `${date[3].length === 2 ? `20${date[3]}` : date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}` : null,
    budget_cents: budget ? Math.round(Number(String(budget[1] || budget[2] || budget[3]).replace(/\./g, '')) * 100) : null,
    email: email?.[0] || null, phone: phone?.[0] || null };
}
const dates = (v) => (Array.isArray(v) ? v : JSON.parse(v || '[]'));
export function missingInfo(lead, client) {
  const m = [];
  if (!lead.pax_estimated) m.push('Número de asistentes');
  if (!lead.event_type) m.push('Tipo de evento');
  if (!dates(lead.dates_alt).length) m.push('Fecha o fechas alternativas');
  if (!lead.budget_cents) m.push('Presupuesto orientativo');
  if (!lead.services_requested) m.push('Servicios deseados');
  if (!client?.email && !client?.phone) m.push('Forma de contacto');
  if (!client?.consent_email && !client?.consent_whatsapp) m.push('Consentimiento de contacto');
  return m;
}
export function suggest(ctx, lead) {
  const words = `${lead.services_requested || ''} ${lead.title || ''} ${lead.event_type || ''} ${lead.notes || ''}`.toLowerCase().split(/[^\wáéíóúñ]+/).filter((w) => w.length > 3);
  const score = (txt) => words.filter((w) => String(txt).toLowerCase().includes(w)).length;
  const packs = ctx.db.all('SELECT * FROM packs WHERE company_id=? AND active=1', ctx.cid).map((p) => ({ ...p, s: score(`${p.name} ${p.description}`) })).filter((p) => p.s).sort((a, b) => b.s - a.s).slice(0, 3);
  const services = ctx.db.all('SELECT * FROM services WHERE company_id=? AND active=1', ctx.cid).map((s) => ({ ...s, s: score(`${s.name} ${s.description} ${s.category}`) })).filter((s) => s.s).sort((a, b) => b.s - a.s).slice(0, 5);
  return { packs: packs.map((p) => ({ id: p.id, name: p.name })), services: services.map((s) => ({ id: s.id, name: s.name, category: s.category })) };
}
export function risks(lead, events) {
  const r = [];
  const d = dates(lead.dates_alt)[0];
  if (d && d < today()) r.push('La fecha indicada ya ha pasado');
  if (lead.pax_estimated && lead.pax_estimated > 40) r.push('Grupo grande: confirmar capacidad y cupos con antelación');
  for (const e of events || []) if (e.booking_status !== 'confirmed') r.push(`Reserva ${e.code} sin confirmar del todo`);
  return r;
}
export function draftReply(lead, client, sugg) {
  const lines = [`Hola ${String(client.name).split(' ')[0]},`, '', `Gracias por tu consulta sobre ${lead.event_type || 'tu evento'}${lead.pax_estimated ? ` para ${lead.pax_estimated} personas` : ''}.`];
  if (sugg.packs.length) lines.push(`Creemos que podrían encajarte: ${sugg.packs.map((p) => p.name).join(', ')}.`);
  const miss = missingInfo(lead, client);
  if (miss.length) lines.push('', 'Para prepararte la propuesta necesitamos que nos confirmes:', ...miss.map((m) => `· ${m}`));
  lines.push('', 'Te enviaremos la propuesta con precios cerrados y condiciones. La disponibilidad se confirma con cada proveedor.', '', '[BORRADOR GENERADO POR EL ASISTENTE — revisar antes de enviar]');
  return lines.join('\n');
}
