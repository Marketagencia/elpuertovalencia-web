// Datos de partida. createCompany(): alta de una empresa (estructura mínima). seedDemo(): datos FICTICIOS identificados con [DEMO].
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { mkctx, sysctx } from './core.js';
import { seedTemplates } from './comms.js';
import { nowIso, today, addDays } from './util.js';
import { DEFAULT_SETTINGS } from './config.js';

export const DEMO_PASSWORD = 'Demo-Clave-2026';
const STAGES = [['new', 'Nueva consulta', 'open'], ['contacted', 'Contactado', 'open'], ['proposal_sent', 'Propuesta enviada', 'open'], ['negotiation', 'Negociación', 'open'],
  ['pending_deposit', 'Pendiente de señal', 'open'], ['booked', 'Reserva confirmada', 'won'], ['finished', 'Finalizado', 'done'], ['lost', 'Perdido', 'lost'], ['cancelled', 'Cancelado', 'cancelled']];

export function createCompany(db, { name, slug, adminEmail, adminName = 'Administrador', adminPassword }) {
  if (String(adminPassword || '').length < 10) throw new Error('La contraseña del administrador debe tener al menos 10 caracteres');
  return db.tx(() => {
    const cid = db.insert('companies', { name, slug, settings: {}, created_at: nowIso() });
    STAGES.forEach(([key, label, kind], i) => db.insert('pipeline_stages', { company_id: cid, key, label, position: i, kind }));
    const ctx = sysctx(db, cid);
    seedTemplates(ctx);
    db.insert('users', { company_id: cid, email: adminEmail.toLowerCase(), name: adminName, password_hash: hashPassword(adminPassword), role: 'admin', created_at: nowIso() });
    return cid;
  });
}

export function seedBase(db, { slug = 'demo', name = 'Agencia Demo Valencia [DEMO]', domain = 'demo.test' } = {}) {
  const cid = createCompany(db, { name, slug, adminEmail: `admin@${domain}`, adminPassword: DEMO_PASSWORD });
  const ctx = sysctx(db, cid), pw = hashPassword(DEMO_PASSWORD), I = (t, o) => db.insert(t, { company_id: cid, ...o });
  const brandA = I('brands', { name: 'Despedidas Valencia [DEMO]', email: `hola@${domain}`, phone: '+34 600 000 001', color: '#0b6e99', is_default: 1, iban: 'ES00 0000 0000 0000 0000 0000 (DEMO)',
    terms_payment: 'Señal del 30 % para reservar. Saldo pendiente hasta 7 días antes del evento. Pagos por transferencia o enlace de pago.',
    terms_cancel: 'Cancelación gratuita hasta 7 días antes. Después se factura el 100 % de los servicios no recuperables.', terms_general: 'Datos ficticios de demostración.', created_at: nowIso() });
  const brandB = I('brands', { name: 'Eventos Corporativos Valencia [DEMO]', email: `empresas@${domain}`, phone: '+34 600 000 002', color: '#7a3b9e', terms_payment: 'Pago de la señal del 50 %.',
    terms_cancel: 'Cancelación gratuita hasta 14 días antes.', created_at: nowIso() });

  const prov = (o) => I('providers', { availability_mode: 'on_request', cost_deposit_pct: 0, cost_due_days_before: 7, created_at: nowIso(), ...o });
  const pKart = prov({ name: 'Karting Valencia [DEMO]', contact_name: 'Marta', email: `karting@${domain}`, phone: '+34 600 100 001', availability_mode: 'managed', cost_deposit_pct: 30, cost_due_days_before: 3 });
  const pRest = prov({ name: 'Restaurante El Puerto [DEMO]', contact_name: 'Joan', email: `restaurante@${domain}`, phone: '+34 600 100 002', cost_deposit_pct: 20 });
  const pRest2 = prov({ name: 'Restaurante La Alternativa [DEMO]', contact_name: 'Pau', email: `alternativa@${domain}`, phone: '+34 600 100 003' });
  const pBoat = prov({ name: 'Catamaranes Mediterráneo [DEMO]', contact_name: 'Sara', email: `barco@${domain}`, phone: '+34 600 100 004', availability_mode: 'managed' });
  const pPaint = prov({ name: 'Paintball Turia [DEMO]', contact_name: 'Luis', email: `paintball@${domain}`, phone: '+34 600 100 005', availability_mode: 'managed' });

  const svc = (o) => I('services', { category: 'actividad', min_pax: 1, tax_bp: 1000, cost_tax_bp: 1000, cancel_free_days: 7, cancel_penalty_pct: 100, min_notice_days: 2, created_at: nowIso(), ...o });
  const sKart = svc({ name: 'Karting 2 mangas [DEMO]', description: 'Carrera por equipos con 2 mangas y cronometraje.', location: 'Circuito de Valencia', duration_min: 90, min_pax: 6, max_pax: 24, price_cents: 3500, cost_cents: 2400, tax_bp: 2100, cost_tax_bp: 2100,
    payment_terms: 'Anticipo del 30 % al confirmar.', cancel_terms: 'Gratuita hasta 7 días antes.', share_contact: 1 });
  const sMenu = svc({ name: 'Menú de grupo [DEMO]', category: 'menu', description: 'Entrantes para compartir, principal y postre con bebida.', location: 'Puerto de Valencia', duration_min: 120, min_pax: 8, max_pax: 40, price_cents: 3200, cost_cents: 2200,
    cancel_terms: 'Gratuita hasta 7 días antes.', min_notice_days: 3 });
  const sPaint = svc({ name: 'Paintball [DEMO]', description: 'Partidas por equipos.', duration_min: 120, min_pax: 8, max_pax: 30, price_model: 'tiers', price_cents: 0, cost_cents: 0, tax_bp: 2100, cost_tax_bp: 2100,
    tiers: [{ min: 8, max: 15, price_cents: 3000, cost_cents: 2000, basis: 'person' }, { min: 16, max: 30, price_cents: 2800, cost_cents: 1800, basis: 'person' }] });
  const sBoat = svc({ name: 'Paseo en catamarán [DEMO]', description: 'Salida de 2 horas con bebida de bienvenida.', duration_min: 120, min_pax: 4, max_pax: 12, price_model: 'per_group', price_cents: 45000, cost_cents: 32000, cancel_free_days: 10 });
  const sCake = svc({ name: 'Tarta personalizada [DEMO]', category: 'extra', price_model: 'per_unit', price_cents: 6000, cost_cents: 3500, min_notice_days: 1 });
  const link = (s, p, cost = null) => db.run('INSERT INTO service_providers(service_id,provider_id,company_id,cost_cents) VALUES(?,?,?,?)', s, p, cid, cost);
  link(sKart, pKart); link(sMenu, pRest); link(sMenu, pRest2, 2300); link(sPaint, pPaint); link(sBoat, pBoat); link(sCake, pRest);
  const rule = (p, s, start, cap, extra = {}) => I('availability_rules', { provider_id: p, service_id: s, weekdays: '0,1,2,3,4,5,6', start_time: start, capacity_pax: cap, ...extra });
  rule(pKart, sKart, '17:00', 24); rule(pBoat, sBoat, '18:00', 12); rule(pPaint, sPaint, '11:00', 20, { shared: 1, agency_quota_pax: 10 });

  const pack = I('packs', { name: 'Pack Despedida Karting + Comida [DEMO]', description: 'Karting y menú de grupo con descuento', discount_pct: 5, created_at: nowIso() });
  db.insert('pack_items', { company_id: cid, pack_id: pack, service_id: sKart, qty: 1, optional: 0 });
  db.insert('pack_items', { company_id: cid, pack_id: pack, service_id: sMenu, qty: 1, optional: 0 });
  db.insert('pack_items', { company_id: cid, pack_id: pack, service_id: sCake, qty: 1, optional: 1 });

  const user = (role, email, name, extra = {}) => I('users', { email: `${email}@${domain}`, name, password_hash: pw, role, created_at: nowIso(), ...extra });
  const uCom = user('comercial', 'comercial', 'Carla Comercial [DEMO]'), uOps = user('operaciones', 'operaciones', 'Omar Operaciones [DEMO]'), uFin = user('finanzas', 'finanzas', 'Fina Finanzas [DEMO]');
  user('proveedor', 'proveedor.karting', 'Marta (Karting) [DEMO]', { provider_id: pKart }); user('proveedor', 'proveedor.restaurante', 'Joan (Restaurante) [DEMO]', { provider_id: pRest });
  const adminId = db.get('SELECT id FROM users WHERE company_id=? AND role=?', cid, 'admin').id;
  return { cid, ctx, brandA, brandB, pKart, pRest, pRest2, pBoat, pPaint, sKart, sMenu, sPaint, sBoat, sCake, pack, uCom, uOps, uFin, adminId, domain };
}

// Datos de demostración para la interfaz (consultas, una propuesta enviada y una reserva en curso)
export async function seedDemo(db) {
  const { createLead } = await import('./routes/crm.js');
  const { saveQuote, sendQuote } = await import('./quotes.js');
  const base = seedBase(db);
  const ctx = mkctx(db, db.get('SELECT * FROM users WHERE id=?', base.uCom));
  const cl = (name, email, phone) => db.insert('clients', { company_id: base.cid, name: `${name} [DEMO]`, email, phone, consent_email: 1, contact_pref: 'email', created_at: nowIso() });
  const c1 = cl('Laura Martínez', 'laura@demo.test', '600111222'), c2 = cl('Empresa Sol S.L.', 'rrhh@demo.test', '600333444'), c3 = cl('Pedro Gil', 'pedro@demo.test', '600555666');
  const d = (n) => addDays(today(), n);
  const l1 = createLead(ctx, { client_id: c1, event_type: 'Despedida', pax_estimated: 12, dates_alt: [d(30)], budget_eur: 900, services_requested: 'karting y comida', brand_id: base.brandA, source: 'web' });
  createLead(ctx, { client_id: c2, event_type: 'Cena de empresa', pax_estimated: 25, dates_alt: [d(45)], budget_eur: 2500, services_requested: 'cena y actividad', brand_id: base.brandB, source: 'email' });
  const l3 = createLead(ctx, { client_id: c3, event_type: 'Cumpleaños', pax_estimated: 10, dates_alt: [d(20)], services_requested: 'barco', brand_id: base.brandA, source: 'whatsapp' });
  const q = saveQuote(ctx, null, { client_id: c1, lead_id: l1, brand_id: base.brandA, title: 'Despedida de Laura [DEMO]', options: [
    { name: 'Opción A · Pack', pax: 12, event_date: d(30), start_time: '17:00', lines: [{ kind: 'pack', pack_id: base.pack, start_time: '17:00' }, { kind: 'extra', description: 'Decoración de mesa', price_cents: 4000, cost_cents: 2500, optional: 1 }] },
    { name: 'Opción B · Barco', pax: 12, event_date: d(30), start_time: '18:00', lines: [{ kind: 'service', service_id: base.sBoat }, { kind: 'service', service_id: base.sMenu, start_time: '21:00' }] }] });
  sendQuote(ctx, q.id, { skipMessage: false });
  db.run(`UPDATE leads SET last_contact_at=? WHERE id=? AND company_id=?`, nowIso(), l3, base.cid);
  return base;
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const db = openDb();
  if (db.get('SELECT id FROM companies WHERE slug=?', 'demo')) { console.log('La empresa demo ya existe. Borra data/grupolisto.db para regenerarla.'); process.exit(0); }
  await seedDemo(db);
  console.log(`Datos de demostración creados.\n  Usuarios (contraseña ${DEMO_PASSWORD}): admin@demo.test, comercial@demo.test, operaciones@demo.test, finanzas@demo.test,\n  proveedor.karting@demo.test, proveedor.restaurante@demo.test`);
}
