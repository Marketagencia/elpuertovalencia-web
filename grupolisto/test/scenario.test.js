// Prueba de funcionamiento (punto 16). Se ejecuta contra la API HTTP real, con permisos y aislamiento de empresa activos.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, Api, tokenFrom, seedBase } from './helpers.js';
import { setClock, addDays, today } from '../src/util.js';
import { setTransport, stripeSign } from '../src/integrations.js';
import { tick } from '../src/automations.js';
import { expireHolds } from '../src/bookings.js';

let app, S, other; // S = ids de la empresa demo
let com, ops, fin, adm, provKart, provRest, otherAdmin;
const TODAY = today();
const D = (n) => addDays(TODAY, n);
const ok = (r, code = 200) => { assert.equal(r.status, code, `esperaba ${code}, llegó ${r.status}: ${JSON.stringify(r.body)}`); return r.body; };
const euros = (c) => c / 100;

async function login(email) { const a = new Api(app.base); await a.login(email); return a; }

// Crea consulta → propuesta → enlace → aceptación del cliente → evento. Devuelve ids y tokens.
async function makeEvent({ services, pax = 12, date, title = 'Evento de prueba', packId, optionLines }) {
  const lead = ok(await com.post('/api/leads', { client: { name: `Cliente ${title}`, email: `c${Math.random().toString(36).slice(2, 8)}@demo.test`, consent_email: true }, event_type: 'Despedida', pax_estimated: pax, dates_alt: [date] }));
  const lines = optionLines || [...(packId ? [{ kind: 'pack', pack_id: packId, start_time: '17:00' }] : []), ...(services || []).map((s) => ({ kind: 'service', ...s }))];
  const q = ok(await com.post('/api/quotes', { client_id: lead.client_id, lead_id: lead.id, title, options: [{ name: 'Opción única', pax, event_date: date, start_time: '17:00', lines }] }));
  const sent = ok(await com.post(`/api/quotes/${q.id}/send`));
  const token = tokenFrom(sent.link);
  const view = ok(await app.anon.get(`/api/public/quote/${token}`));
  const acc = ok(await app.anon.post(`/api/public/quote/${token}/accept`, { option_id: view.options[0].id, accept_terms: true, name: 'Cliente Prueba' }));
  const ev = ok(await com.get(`/api/events/${acc.event_id}`));
  return { lead, quote: q, token, view, acc, ev, eventId: acc.event_id };
}
const svcOf = (ev, name) => ev.services.find((s) => s.name.startsWith(name));
const reload = async (id) => ok(await com.get(`/api/events/${id}`));

before(async () => {
  app = await boot();
  S = seedBase(app.db);
  other = seedBase(app.db, { slug: 'otra', name: 'Otra Agencia [DEMO B]', domain: 'otra.test' });
  app.anon = new Api(app.base);
  [com, ops, fin, adm, provKart, provRest, otherAdmin] = await Promise.all(['comercial@demo.test', 'operaciones@demo.test', 'finanzas@demo.test', 'admin@demo.test', 'proveedor.karting@demo.test', 'proveedor.restaurante@demo.test', 'admin@otra.test'].map(login));
});
after(async () => { setClock(); setTransport('email', null); await app.close(); });

describe('Recorrido principal: grupo de 12 → 14 personas', () => {
  const st = {};

  test('el comercial crea consulta y dos propuestas; el pack no duplica conceptos', async () => {
    const lead = ok(await com.post('/api/leads', { client: { name: 'Laura Test', email: 'laura.test@demo.test', phone: '600123123', consent_email: true }, event_type: 'Despedida', pax_estimated: 12, dates_alt: [D(40)], services_requested: 'actividad y comida' }));
    st.lead = lead;
    const base = { client_id: lead.client_id, lead_id: lead.id, title: 'Despedida de Laura' };
    // un servicio incluido en un pack no se puede añadir suelto
    const dup = await com.post('/api/quotes', { ...base, options: [{ name: 'X', pax: 12, event_date: D(40), lines: [{ kind: 'pack', pack_id: S.pack }, { kind: 'service', service_id: S.sKart }] }] });
    assert.equal(dup.status, 409); assert.equal(dup.body.code, 'duplicate_in_pack');
    const q = ok(await com.post('/api/quotes', { ...base, options: [
      { name: 'Opción A · Pack', pax: 12, event_date: D(40), start_time: '17:00', lines: [{ kind: 'pack', pack_id: S.pack, start_time: '17:00' }] },
      { name: 'Opción B · Barco + comida', pax: 12, event_date: D(40), start_time: '18:00', lines: [{ kind: 'service', service_id: S.sBoat }, { kind: 'service', service_id: S.sMenu, start_time: '21:00' }] }] }));
    st.quote = q;
    const [a, b] = q.options;
    // Pack: (3500 + 3200) × 12 con 5 % de descuento = 76 380 cts → 763,80 €
    assert.equal(a.totals.total_cents, Math.round(3500 * 0.95) * 12 + Math.round(3200 * 0.95) * 12);
    assert.equal(a.totals.cost_cents, (2400 + 2200) * 12);
    assert.ok(a.totals.margin_net_cents > 0);
    assert.equal(b.totals.total_cents, 45000 + 3200 * 12);                    // barco por grupo + menú por persona
    assert.equal(a.deposit_cents, Math.round(a.totals.total_cents * 0.3));
    // pack: la cabecera no suma dos veces
    assert.equal(a.lines.filter((l) => l.kind === 'pack').length, 1);
    assert.equal(a.lines.filter((l) => l.kind === 'pack_item' && l.selected).length, 2);
  });

  test('el enlace privado no filtra costes; el cliente cambia extras y la propuesta se envía sin simular el email', async () => {
    const sent = ok(await com.post(`/api/quotes/${st.quote.id}/send`));
    assert.match(sent.link, /#\/q\//);
    assert.equal(sent.message.status, 'not_configured', 'sin integración de email el mensaje NO debe figurar como enviado');
    st.token = tokenFrom(sent.link);
    const view = ok(await app.anon.get(`/api/public/quote/${st.token}`));
    assert.ok(!JSON.stringify(view).includes('cost'), 'la vista pública no puede incluir costes');
    assert.equal(view.options.length, 2);
    st.view = view;
    // editar una propuesta enviada exige nueva versión
    assert.equal((await com.put(`/api/quotes/${st.quote.id}`, { title: 'cambio' })).status, 409);
  });

  test('aceptar exige condiciones; la aceptación guarda versión/condiciones y NO confirma servicios', async () => {
    const optA = st.view.options[0].id;
    assert.equal((await app.anon.post(`/api/public/quote/${st.token}/accept`, { option_id: optA, name: 'Laura' })).status, 400);
    const acc = ok(await app.anon.post(`/api/public/quote/${st.token}/accept`, { option_id: optA, accept_terms: true, name: 'Laura Test' }));
    st.eventId = acc.event_id; st.depositLink = acc.pay_link;
    assert.match(acc.message, /PENDIENTE DE CONFIRMACIÓN/);
    const q = ok(await com.get(`/api/quotes/${st.quote.id}`));
    assert.equal(q.status, 'accepted'); assert.equal(q.accepted_version, 1); assert.equal(q.accepted_by_name, 'Laura Test'); assert.ok(q.accepted_terms_hash && q.accepted_at);
    const ev = await reload(st.eventId);
    assert.equal(ev.event.booking_status, 'pending');
    assert.ok(ev.services.every((s) => s.status === 'requested'));
    assert.equal(ev.event.total_due_cents, st.quote.options[0].totals.total_cents);
    // segunda aceptación imposible
    assert.equal((await app.anon.post(`/api/public/quote/${st.token}/accept`, { option_id: optA, accept_terms: true, name: 'Laura' })).status, 409);
  });

  test('señal: el justificante del cliente deja el cobro «en proceso»; solo finanzas lo verifica', async () => {
    const t = tokenFrom(st.depositLink);
    const info = ok(await app.anon.get(`/api/public/pay/${t}`));
    assert.equal(info.online_available, false);
    ok(await app.anon.post(`/api/public/pay/${t}/proof`, { note: 'Transferencia 06/10 ref 123', payer_name: 'Laura' }));
    let ev = await reload(st.eventId);
    const dep = ev.payments_in.find((p) => p.kind === 'deposit');
    assert.equal(dep.status, 'processing'); assert.notEqual(dep.status, 'verified');
    assert.equal(ev.event.booking_status, 'pending');
    assert.equal((await com.post(`/api/payments-in/${dep.id}/verify`)).status, 403, 'el comercial no puede verificar cobros');
    ok(await fin.post(`/api/payments-in/${dep.id}/verify`));
    ok(await fin.post(`/api/payments-in/${dep.id}/verify`));                    // idempotente
    ev = await reload(st.eventId);
    assert.equal(ev.finance.paid_cents, dep.amount_cents, 'verificar dos veces no duplica');
    assert.equal(ev.event.booking_status, 'pending', 'señal pagada pero servicios sin confirmar: no hay reserva completa');
    st.depositId = dep.id;
  });

  test('cada proveedor responde por separado; la reserva solo se completa con todo confirmado + señal', async () => {
    let ev = await reload(st.eventId);
    const kart = svcOf(ev, 'Karting'), menu = svcOf(ev, 'Menú');
    // karting: disponibilidad gestionada exclusiva → bloqueo provisional
    let r = ok(await ops.post(`/api/event-services/${kart.id}/start`));
    assert.equal(r.status, 'held');
    // menú: bajo solicitud → pendiente de disponibilidad (no se da por disponible)
    r = ok(await ops.post(`/api/event-services/${menu.id}/start`));
    assert.equal(r.status, 'pending_availability');
    // confirmar el menú antes de que el proveedor responda está prohibido
    assert.equal((await ops.post(`/api/event-services/${menu.id}/confirm`)).status, 409);
    ev = await reload(st.eventId); st.menuReq = ev.services.find((s) => s.id === menu.id).request;
    assert.equal(st.menuReq.status, 'sent');
    ok(await ops.post(`/api/event-services/${kart.id}/confirm`));
    ev = await reload(st.eventId);
    assert.equal(ev.event.booking_status, 'partial', 'karting confirmado, comida pendiente: parcial');
    assert.notEqual(ev.event.booking_status, 'confirmed');
    // el proveedor del karting NO puede ver ni responder la solicitud del restaurante
    const kreq = ok(await provKart.get('/api/portal/provider/home'));
    assert.ok(!JSON.stringify(kreq).includes('Menú de grupo'), 'portal del proveedor: solo sus solicitudes');
    // el restaurante responde desde su portal
    const home = ok(await provRest.get('/api/portal/provider/home'));
    const req = home.requests.find((x) => x.status === 'sent');
    assert.ok(req);
    assert.ok(!JSON.stringify(req.payload).includes('laura'), 'no se comparten datos personales del cliente con el proveedor');
    assert.equal((await provKart.post(`/api/portal/provider/requests/${req.id}/respond`, { response: 'confirm' })).status, 404);
    ok(await provRest.post(`/api/portal/provider/requests/${req.id}/respond`, { response: 'confirm', cost_eur: '', notes: 'Sin alergias especiales' }));
    ev = await reload(st.eventId);
    assert.equal(svcOf(ev, 'Menú').status, 'available');
    assert.equal(ev.event.booking_status, 'partial', 'disponible ≠ confirmado');
    ok(await ops.post(`/api/event-services/${menu.id}/confirm`));
    ev = await reload(st.eventId);
    assert.equal(ev.event.booking_status, 'confirmed');
    // Se genera el aviso de reserva confirmada (queda pendiente de la integración de email, no «enviado»)
    const msgs = ok(await com.get(`/api/messages?event_id=${st.eventId}`));
    const conf = msgs.find((m) => m.template_key === 'booking_confirmed');
    assert.ok(conf); assert.notEqual(conf.status, 'sent');
    // obligaciones con proveedores creadas pero NO pagadas
    const po = ok(await fin.get(`/api/payments-out?`));
    const mine = po.filter((x) => x.event_code === ev.event.code);
    assert.ok(mine.length >= 2 && mine.every((x) => x.status === 'pending'));
  });

  test('cambio a 14 personas: recálculo, capacidad, reconfirmación y aceptación registrada', async () => {
    let ev = await reload(st.eventId);
    const before = ev.event.total_due_cents;
    const prop = ok(await com.post(`/api/events/${st.eventId}/changes`, { pax: 14, note: 'Se apuntan dos más' }));
    assert.equal(prop.can_apply, true, JSON.stringify(prop.report));
    const expected = Math.round(3500 * 0.95) * 14 + Math.round(3200 * 0.95) * 14;
    assert.equal(before + prop.price_delta_cents, expected);
    // Mientras no se acepte, nada cambia
    ev = await reload(st.eventId);
    assert.equal(ev.event.pax, 12); assert.equal(ev.event.total_due_cents, before);
    // el cliente acepta desde su enlace privado (queda registrado quién, cuándo y cómo)
    const t = tokenFrom(prop.link);
    const view = ok(await app.anon.get(`/api/public/change/${t}`));
    assert.equal(view.after.pax, 14);
    ok(await app.anon.post(`/api/public/change/${t}/accept`, { name: 'Laura Test' }));
    assert.equal((await app.anon.post(`/api/public/change/${t}/accept`, { name: 'Laura Test' })).status, 404, 'el enlace de aceptación se invalida tras usarse');
    ev = await reload(st.eventId);
    assert.equal(ev.event.pax, 14); assert.equal(ev.event.total_due_cents, expected);
    assert.equal(ev.changes[0].status, 'accepted'); assert.equal(ev.changes[0].accepted_via, 'client_link'); assert.match(ev.changes[0].accepted_by, /Laura/);
    assert.ok(ev.history.some((h) => h.action === 'cambio_aceptado'));
    // karting (cupo propio): sigue confirmado con 14 plazas; menú (bajo solicitud): vuelve a pedir confirmación
    assert.equal(svcOf(ev, 'Karting').status, 'confirmed'); assert.equal(svcOf(ev, 'Karting').pax, 14);
    assert.equal(svcOf(ev, 'Menú').status, 'pending_availability'); assert.equal(svcOf(ev, 'Menú').reconfirm, 1);
    assert.equal(ev.event.booking_status, 'partial', 'con un servicio por reconfirmar la reserva ya no está completa');
    assert.equal(ev.event.deposit_required_cents, Math.round(expected * 0.3));
    // un cambio inviable (más del máximo del karting) no se puede aplicar
    const bad = ok(await com.post(`/api/events/${st.eventId}/changes`, { pax: 40 }));
    assert.equal(bad.can_apply, false);
    assert.equal((await com.post(`/api/changes/${bad.change_id}/accept`, {})).status, 409);
    // el restaurante reconfirma
    const home = ok(await provRest.get('/api/portal/provider/home'));
    const req = home.requests.find((x) => x.status === 'sent');
    ok(await provRest.post(`/api/portal/provider/requests/${req.id}/respond`, { response: 'confirm' }));
    ok(await ops.post(`/api/event-services/${svcOf(ev, 'Menú').id}/confirm`));
    ev = await reload(st.eventId);
    // la señal ya cobrada (30 % de 12) no cubre el 30 % de 14 → falta señal → sigue parcial
    assert.equal(ev.event.booking_status, 'partial');
    const need = ev.event.deposit_required_cents - ev.finance.paid_cents;
    assert.ok(need > 0);
    ok(await fin.post(`/api/events/${st.eventId}/payments/manual`, { kind: 'deposit', amount_eur: euros(need), method: 'transfer', reference: 'Complemento señal', verified: true }));
    ev = await reload(st.eventId);
    assert.equal(ev.event.booking_status, 'confirmed');
  });

  test('saldo: no se puede cobrar más de lo pendiente; cobro del saldo y prestación de servicios', async () => {
    let ev = await reload(st.eventId);
    const pending = ev.finance.balance_cents;
    const over = await fin.post(`/api/events/${st.eventId}/payments/manual`, { kind: 'balance', amount_cents: pending + 100, method: 'transfer', reference: 'x', verified: true });
    assert.equal(over.status, 409); assert.equal(over.body.code, 'exceeds_pending');
    ok(await fin.post(`/api/events/${st.eventId}/payments/manual`, { kind: 'balance', amount_cents: pending, method: 'transfer', reference: 'Saldo final', verified: true }));
    ev = await reload(st.eventId);
    assert.equal(ev.event.payment_status, 'paid'); assert.equal(ev.finance.balance_cents, 0);
    // «realizado» antes de la fecha no se permite
    const kart = svcOf(ev, 'Karting');
    assert.equal((await ops.post(`/api/event-services/${kart.id}/done`)).status, 409);
    setClock(() => new Date(`${D(41)}T12:00:00Z`));
    try {
      for (const s of ev.services) ok(await ops.post(`/api/event-services/${s.id}/done`));
      ev = await reload(st.eventId);
      assert.equal(ev.event.status, 'completed');
      // completar el evento NO paga a nadie
      let po = ok(await fin.get('/api/payments-out')).filter((x) => x.event_code === ev.event.code);
      assert.ok(po.length >= 2 && po.every((x) => x.status === 'pending'));
      // liquidar: orden → pago registrado con referencia → aviso al proveedor solo tras registrar el pago
      const target = po.find((x) => x.kind === 'balance') || po[0];
      assert.equal((await com.post(`/api/payments-out/${target.id}/pay`, { reference: 'x' })).status, 403);
      assert.equal((await fin.post(`/api/payments-out/${target.id}/pay`, {})).status, 400, 'sin referencia ni justificante no se registra');
      ok(await fin.post(`/api/payments-out/${target.id}/order`));
      assert.ok(!(ok(await com.get(`/api/messages?event_id=${st.eventId}`))).some((m) => m.template_key === 'payment_notice'));
      ok(await fin.post(`/api/payments-out/${target.id}/pay`, { reference: 'TRF-001', invoice_ref: 'F-2026-77' }));
      const dup = await fin.post(`/api/payments-out/${target.id}/pay`, { reference: 'TRF-001' });
      assert.equal(dup.status, 409); assert.equal(dup.body.code, 'already_paid');
      assert.ok(ok(await com.get(`/api/messages?event_id=${st.eventId}`)).some((m) => m.template_key === 'payment_notice'));
      for (const x of po.filter((y) => y.id !== target.id)) { ok(await fin.post(`/api/payments-out/${x.id}/pay`, { reference: `TRF-${x.id}` })); }
      const settle = ok(await fin.get(`/api/settlements?from=${D(0)}&to=${D(60)}`));
      assert.ok(settle.length >= 2 && settle.every((g) => g.pending_cents === 0 || g.provider_name));
      const dash = ok(await adm.get('/api/dashboard'));
      assert.ok(dash.money.margin_net_cents > 0);
    } finally { setClock(); }
  });
});

describe('Casos límite', () => {
  test('dos solicitudes simultáneas para el último cupo: solo una se bloquea', async () => {
    // Catamarán: cupo 12 por franja. Evento 1 ocupa 8; quedan 4; dos eventos de 4 compiten por ellos.
    const e1 = await makeEvent({ services: [{ service_id: S.sBoat, start_time: '18:00' }], pax: 8, date: D(50), title: 'Barco 8' });
    ok(await ops.post(`/api/event-services/${svcOf(e1.ev, 'Paseo').id}/start`));
    const e2 = await makeEvent({ services: [{ service_id: S.sBoat, start_time: '18:00' }], pax: 4, date: D(50), title: 'Barco 4a' });
    const e3 = await makeEvent({ services: [{ service_id: S.sBoat, start_time: '18:00' }], pax: 4, date: D(50), title: 'Barco 4b' });
    const res = await Promise.all([e2, e3].map((e) => ops.post(`/api/event-services/${svcOf(e.ev, 'Paseo').id}/start`)));
    const codes = res.map((r) => r.status).sort();
    assert.deepEqual(codes, [200, 409], `uno debe ganar y otro fallar: ${JSON.stringify(res.map((r) => r.body))}`);
    assert.match(res.find((r) => r.status === 409).body.error, /Sin cupo/);
    // un tercero que pidiese más de lo que queda tampoco entra
    const slot = ok(await ops.get(`/api/availability/slot?service_id=${S.sBoat}&provider_id=${S.pBoat}&date=${D(50)}&time=18:00`));
    assert.equal(slot.free, 0);
  });

  test('un bloqueo provisional caduca y libera el cupo', async () => {
    const e = await makeEvent({ services: [{ service_id: S.sBoat, start_time: '18:00' }], pax: 12, date: D(52), title: 'Barco caduca' });
    const es = svcOf(e.ev, 'Paseo');
    const r = ok(await ops.post(`/api/event-services/${es.id}/start`));
    assert.equal(r.status, 'held');
    const e2 = await makeEvent({ services: [{ service_id: S.sBoat, start_time: '18:00' }], pax: 6, date: D(52), title: 'Barco espera' });
    assert.equal((await ops.post(`/api/event-services/${svcOf(e2.ev, 'Paseo').id}/start`)).status, 409);
    setClock(() => new Date(Date.now() + 3 * 864e5));                         // +72 h > 48 h de caducidad
    try {
      await tick(app.db);
      const after = await reload(e.eventId);
      assert.equal(svcOf(after, 'Paseo').status, 'requested', 'el servicio vuelve a «solicitado»');
      assert.ok(after.tasks.some((t) => /Bloqueo caducado/.test(t.title)));
      // el cupo quedó libre para otro evento
      assert.equal((await ops.post(`/api/event-services/${svcOf(e2.ev, 'Paseo').id}/start`)).status, 200);
      // un bloqueo caducado no puede confirmarse
      assert.equal((await ops.post(`/api/event-services/${es.id}/confirm`)).status, 409);
    } finally { setClock(); }
  });

  test('pago online notificado dos veces: se procesa una sola vez; firma inválida rechazada', async () => {
    ok(await adm.put('/api/integrations/stripe', { config: { secret_key: 'sk_test_x', webhook_secret: 'whsec_test' }, enabled: true }));
    const e = await makeEvent({ services: [{ service_id: S.sKart }], pax: 10, date: D(55), title: 'Pago online' });
    const dep = e.ev.payments_in.find((p) => p.kind === 'deposit');
    const payload = (id) => JSON.stringify({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: dep.amount_cents, client_reference_id: String(dep.id), metadata: { payment_id: String(dep.id), company_id: String(S.cid) } } } });
    const send = (raw, sig) => app.anon.req('POST', '/api/webhooks/stripe/demo', raw, { 'stripe-signature': sig ?? stripeSign(raw, 'whsec_test') });
    assert.equal((await send(payload('evt_1'), 't=1,v1=deadbeef')).status, 400, 'firma falsa');
    const raw = payload('evt_1');
    const r1 = await send(raw); assert.equal(r1.status, 200); assert.equal(r1.body.result, 'verificado');
    const r2 = await send(raw); assert.equal(r2.status, 200); assert.equal(r2.body.duplicate, true);
    const ev = await reload(e.eventId);
    assert.equal(ev.finance.paid_cents, dep.amount_cents, 'cobrado una sola vez');
    assert.equal(ev.payments_in.find((p) => p.id === dep.id).status, 'verified');
    // otra notificación con importe distinto no verifica
    const e2 = await makeEvent({ services: [{ service_id: S.sKart }], pax: 10, date: D(56), title: 'Pago importe raro' });
    const d2 = e2.ev.payments_in.find((p) => p.kind === 'deposit');
    const raw2 = JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: 'cs_2', payment_status: 'paid', amount_total: 1, metadata: { payment_id: String(d2.id), company_id: String(S.cid) } } } });
    assert.equal((await send(raw2)).body.result, 'importe_no_coincide');
    assert.equal((await reload(e2.eventId)).payments_in.find((p) => p.id === d2.id).status, 'processing');
    // un webhook de otra empresa no puede tocar este pago (metadata.company_id distinto)
    const raw3 = JSON.stringify({ id: 'evt_3', type: 'checkout.session.completed', data: { object: { id: 'cs_3', payment_status: 'paid', amount_total: d2.amount_cents, metadata: { payment_id: String(d2.id), company_id: '999' } } } });
    assert.equal((await send(raw3)).body.result, 'ignorado');
  });

  test('proveedor que rechaza: alerta, alternativa y reasignación', async () => {
    const e = await makeEvent({ services: [{ service_id: S.sMenu }], pax: 12, date: D(60), title: 'Rechazo' });
    const menu = svcOf(e.ev, 'Menú');
    ok(await ops.post(`/api/event-services/${menu.id}/start`));
    const home = ok(await provRest.get('/api/portal/provider/home'));
    const req = home.requests.find((x) => x.status === 'sent' && x.event_service_id === menu.id);
    ok(await provRest.post(`/api/portal/provider/requests/${req.id}/respond`, { response: 'reject', notes: 'Cerrado por reforma' }));
    let ev = await reload(e.eventId);
    assert.equal(svcOf(ev, 'Menú').status, 'rejected');
    assert.ok(ev.tasks.some((t) => /rechaza/.test(t.title) && t.kind === 'incident'));
    assert.ok(ev.alerts.some((a) => /rechazado/.test(a)));
    assert.notEqual(ev.event.booking_status, 'confirmed');
    const alts = ok(await ops.get(`/api/event-services/${menu.id}/alternatives`));
    assert.ok(alts.some((a) => a.provider_id === S.pRest2));
    ok(await ops.post(`/api/event-services/${menu.id}/reassign`, { provider_id: S.pRest2 }));
    ok(await ops.post(`/api/event-services/${menu.id}/start`));
    ev = await reload(e.eventId);
    assert.equal(svcOf(ev, 'Menú').provider_name, 'Restaurante La Alternativa [DEMO]');
    assert.equal(svcOf(ev, 'Menú').status, 'pending_availability');
  });

  test('alternativa del proveedor y coste distinto requieren aceptación interna', async () => {
    const e = await makeEvent({ services: [{ service_id: S.sMenu }], pax: 10, date: D(61), title: 'Alternativa' });
    const menu = svcOf(e.ev, 'Menú');
    ok(await ops.post(`/api/event-services/${menu.id}/start`));
    const req = ok(await provRest.get('/api/portal/provider/home')).requests.find((x) => x.status === 'sent' && x.event_service_id === menu.id);
    ok(await provRest.post(`/api/portal/provider/requests/${req.id}/respond`, { response: 'alternative', alt_date: D(62), alt_time: '14:00', notes: 'Solo tenemos mesa ese día' }));
    let ev = await reload(e.eventId);
    assert.equal(svcOf(ev, 'Menú').date, D(61), 'la fecha no cambia hasta que se acepte');
    assert.equal(svcOf(ev, 'Menú').status, 'pending_availability');
    ok(await ops.post(`/api/event-services/${menu.id}/review`, { accept: true }));
    ev = await reload(e.eventId);
    assert.equal(svcOf(ev, 'Menú').date, D(62)); assert.equal(svcOf(ev, 'Menú').status, 'available');
    // coste distinto: se queda en revisión
    const e2 = await makeEvent({ services: [{ service_id: S.sMenu }], pax: 10, date: D(63), title: 'Coste' });
    const m2 = svcOf(e2.ev, 'Menú'); ok(await ops.post(`/api/event-services/${m2.id}/start`));
    const r2 = ok(await provRest.get('/api/portal/provider/home')).requests.find((x) => x.status === 'sent' && x.event_service_id === m2.id);
    ok(await provRest.post(`/api/portal/provider/requests/${r2.id}/respond`, { response: 'confirm', cost_eur: '250' }));
    ev = await reload(e2.eventId);
    assert.equal(svcOf(ev, 'Menú').needs_review, 1);
    assert.equal((await ops.post(`/api/event-services/${m2.id}/confirm`)).status, 409);
    ok(await ops.post(`/api/event-services/${m2.id}/review`, { accept: true }));
    ok(await ops.post(`/api/event-services/${m2.id}/confirm`));
    assert.equal(svcOf(await reload(e2.eventId), 'Menú').cost_cents, 25000);
  });

  test('cancelación parcial con penalización y reembolso parcial', async () => {
    const e = await makeEvent({ services: [{ service_id: S.sKart }, { service_id: S.sMenu }], pax: 10, date: D(3), title: 'Cancelación parcial' });
    // pago íntegro verificado
    ok(await fin.post(`/api/events/${e.eventId}/payments/manual`, { payment_id: e.ev.payments_in.find((p) => p.kind === 'deposit').id, reference: 'señal', verified: true }));
    let ev = await reload(e.eventId);
    ok(await fin.post(`/api/events/${e.eventId}/payments/manual`, { kind: 'balance', amount_cents: ev.finance.balance_cents, reference: 'saldo', verified: true }));
    ev = await reload(e.eventId);
    const total = ev.event.total_due_cents, kart = svcOf(ev, 'Karting'), menu = svcOf(ev, 'Menú');
    assert.equal(ev.finance.balance_cents, 0);
    // cancela el cliente a 3 días: dentro del plazo de 7 días de cancelación gratuita → penalización 100 %
    const c1 = ok(await ops.post(`/api/event-services/${menu.id}/cancel`, { by: 'client', reason: 'Se bajan del menú' }));
    assert.equal(c1.penalty_cents, menu.price_cents);
    assert.equal(c1.refund_suggested_cents, 0, 'con penalización total no hay devolución');
    // cancelación sin penalización por la agencia
    const c2 = ok(await ops.post(`/api/event-services/${kart.id}/cancel`, { by: 'agency', reason: 'Circuito cerrado' }));
    assert.equal(c2.penalty_cents, 0);
    ev = await reload(e.eventId);
    assert.equal(ev.event.status, 'cancelled');
    assert.equal(ev.event.total_due_cents, menu.price_cents, 'solo queda la penalización del menú');
    assert.equal(c2.refund_suggested_cents, total - menu.price_cents);
    // reembolso parcial del pago de saldo, y no se puede reembolsar más de lo cobrado
    const bal = ev.payments_in.find((p) => p.kind === 'balance');
    const over = await fin.post(`/api/payments-in/${bal.id}/refund`, { amount_cents: bal.amount_cents + 1, executed: true });
    assert.equal(over.status, 409);
    ok(await fin.post(`/api/payments-in/${bal.id}/refund`, { amount_cents: 5000, reason: 'Devolución parcial', executed: true }));
    ev = await reload(e.eventId);
    assert.equal(ev.finance.refunded_cents, 5000);
    assert.equal(ev.payments_in.find((p) => p.id === bal.id).refunded_cents, 5000);
    // las obligaciones con el proveedor cancelado por la agencia desaparecen; la del menú queda solo con su penalización de coste
    const po = ok(await fin.get('/api/payments-out')).filter((x) => x.event_code === ev.event.code && x.status !== 'cancelled');
    assert.ok(po.every((x) => x.service_name.startsWith('Menú')));
  });

  test('pagos individuales de participantes salen del mismo saldo y no se pueden pasar', async () => {
    const e = await makeEvent({ services: [{ service_id: S.sMenu }], pax: 10, date: D(70), title: 'Participantes' });
    const ev = await reload(e.eventId);
    const total = ev.event.total_due_cents;
    const per = Math.floor(total / 10);
    // la señal pendiente ya reserva parte del saldo; el resto se reparte entre participantes
    const free = total - ev.event.deposit_required_cents;
    const n = Math.floor(free / per);
    const links = ok(await fin.post(`/api/events/${e.eventId}/participant-links`, { participants: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, amount_cents: per })) }));
    assert.equal(links.length, n);
    const excess = await fin.post(`/api/events/${e.eventId}/participant-links`, { participants: [{ name: 'Extra', amount_cents: free - n * per + per }] });
    assert.equal(excess.status, 409); assert.equal(excess.body.code, 'exceeds_pending');
    // un participante paga con enlace propio: queda en proceso (no verificado)
    ok(await app.anon.post(`/api/public/pay/${tokenFrom(links[0].link)}/proof`, { note: 'bizum' }));
    assert.equal((await reload(e.eventId)).payments_in.find((p) => p.payer_name === 'P0').status, 'processing');
  });

  test('fallo de envío: reintentos controlados, estado real y reintento manual', async () => {
    let calls = 0, failing = true;
    setTransport('email', async () => { calls++; if (failing) throw new Error('SMTP caído'); return { external_id: 'ext-1' }; });
    try {
      const lead = ok(await com.post('/api/leads', { client: { name: 'Mensaje Test', email: 'msg@demo.test', consent_email: true }, event_type: 'Comida' }));
      const m = ok(await com.post('/api/messages', { channel: 'email', client_id: lead.client_id, lead_id: lead.id, subject: 'Hola', body: 'Texto' }));
      assert.equal(m.status, 'queued', 'primer intento fallido → sigue en cola con reintento programado');
      let t = new Date(Date.now());
      for (let i = 0; i < 4; i++) { t = new Date(t.getTime() + 3600e3); setClock(() => t); await tick(app.db); }
      setClock();
      const list = ok(await com.get(`/api/messages?client_id=${lead.client_id}`));
      const msg = list.find((x) => x.subject === 'Hola');
      assert.equal(msg.status, 'failed'); assert.match(msg.error, /SMTP caído/); assert.equal(msg.attempts, 3);
      assert.ok(calls >= 3);
      failing = false;
      const r = ok(await com.post(`/api/messages/${msg.id}/retry`));
      assert.equal(r.status, 'sent');
    } finally { setTransport('email', null); setClock(); }
  });

  test('consentimientos: sin consentimiento no se envía; WhatsApp exige plantilla/ventana', async () => {
    const lead = ok(await com.post('/api/leads', { client: { name: 'Sin Consent', email: 'nc@demo.test', phone: '600999888' } }));
    const m = ok(await com.post('/api/messages', { channel: 'email', client_id: lead.client_id, subject: 'x', body: 'y' }));
    assert.equal(m.status, 'blocked');
    ok(await com.put(`/api/clients/${lead.client_id}`, { consent_whatsapp: true, consent_source: 'verbal' }));
    const w = ok(await com.post('/api/messages', { channel: 'whatsapp', client_id: lead.client_id, body: 'hola' }));
    assert.equal(w.status, 'blocked', 'sin plantilla aprobada ni ventana de 24 h WhatsApp no se envía');
  });

  test('seguimiento automático: se envía una vez y se detiene al responder el cliente', async () => {
    const lead = ok(await com.post('/api/leads', { client: { name: 'Seguimiento', email: 'seg@demo.test', consent_email: true }, event_type: 'Cena', pax_estimated: 10, dates_alt: [D(80)] }));
    const q = ok(await com.post('/api/quotes', { client_id: lead.client_id, lead_id: lead.id, title: 'Cena', options: [{ name: 'A', pax: 10, event_date: D(80), lines: [{ kind: 'service', service_id: S.sMenu }] }] }));
    ok(await com.post(`/api/quotes/${q.id}/send`));
    const later = new Date(Date.now() + 4 * 864e5 + 12 * 3600e3 * 0); setClock(() => { const d = new Date(later); d.setUTCHours(10, 0, 0, 0); return d; });
    try {
      await tick(app.db); await tick(app.db);
      let fu = ok(await com.get(`/api/messages?client_id=${lead.client_id}`)).filter((m) => m.template_key === 'quote_followup');
      assert.equal(fu.length, 1, 'sin duplicados aunque la pasada se repita');
      ok(await com.post('/api/messages/inbound', { channel: 'email', from: 'seg@demo.test', body: 'Gracias, lo vemos' }));
      const much = new Date(later.getTime() + 10 * 864e5); setClock(() => { const d = new Date(much); d.setUTCHours(10, 0, 0, 0); return d; });
      await tick(app.db);
      const com2 = await login('comercial@demo.test');                  // las sesiones caducan a los 7 días: se entra de nuevo con el reloj simulado
      fu = ok(await com2.get(`/api/messages?client_id=${lead.client_id}`)).filter((m) => m.template_key === 'quote_followup');
      assert.equal(fu.length, 1, 'tras la respuesta del cliente no hay más seguimientos');
    } finally { setClock(); }
  });

  test('envío automático fuera de horario se aplaza a la ventana (Europe/Madrid)', async () => {
    setClock(() => new Date('2026-11-10T01:30:00Z'));         // 02:30 en Madrid
    try {
      const com = await login('comercial@demo.test');
      const lead = ok(await com.post('/api/leads', { client: { name: 'Noche', email: 'noche@demo.test', consent_email: true }, event_type: 'x' }));
      const m = ok(await com.get(`/api/messages?lead_id=${lead.id}`)).find((x) => x.template_key === 'lead_ack');
      assert.equal(m.status, 'queued'); assert.ok(m.next_attempt_at > '2026-11-10T07:30:00Z' && m.next_attempt_at <= '2026-11-10T09:00:00Z', m.next_attempt_at);
    } finally { setClock(); }
  });

  test('aislamiento entre empresas: ninguna lectura o escritura cruza', async () => {
    const lead = ok(await com.post('/api/leads', { client: { name: 'Cliente A', email: 'a@demo.test', consent_email: true }, event_type: 'x', pax_estimated: 10, dates_alt: [D(90)] }));
    const e = await makeEvent({ services: [{ service_id: S.sKart }], pax: 10, date: D(91), title: 'Aislamiento' });
    const dep = e.ev.payments_in[0];
    for (const [m, p, b] of [['get', `/api/clients/${lead.client_id}`], ['get', `/api/leads/${lead.id}`], ['get', `/api/events/${e.eventId}`], ['get', `/api/quotes/${e.quote.id}`], ['put', `/api/clients/${lead.client_id}`, { name: 'hack' }],
      ['post', `/api/payments-in/${dep.id}/verify`], ['post', `/api/event-services/${e.ev.services[0].id}/start`], ['get', `/api/services/${S.sKart}`], ['get', `/api/providers/${S.pKart}`], ['post', `/api/quotes/${e.quote.id}/send`]]) {
      const r = await otherAdmin[m](p, b);
      assert.equal(r.status, 404, `${m} ${p} debería ser 404 desde otra empresa, fue ${r.status}`);
    }
    // las listas de la otra empresa no contienen nada de la nuestra
    assert.equal(ok(await otherAdmin.get('/api/clients')).length, 0);
    assert.equal(ok(await otherAdmin.get('/api/events')).length, 0);
    assert.ok(!JSON.stringify(ok(await otherAdmin.get('/api/export'))).includes('Aislamiento'));
    // no se puede crear un presupuesto con un cliente ajeno
    assert.equal((await otherAdmin.post('/api/quotes', { client_id: lead.client_id, options: [] })).status, 404);
    // un pack ajeno no se puede usar
    assert.equal((await otherAdmin.post('/api/quotes', { client_id: 1, options: [{ pax: 5, lines: [{ kind: 'pack', pack_id: S.pack }] }] })).status, 404);
    // los enlaces privados no sirven con datos de otro evento: un token de pago no abre otro pago
    assert.equal((await app.anon.get('/api/public/pay/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).status, 404);
  });

  test('permisos aplicados en el servidor por perfil', async () => {
    assert.equal((await fin.post('/api/quotes', { client_id: 1, options: [] })).status, 403);
    assert.equal((await com.get('/api/payments-out')).status, 403);
    assert.equal((await ops.post('/api/payments-out/1/pay', { reference: 'x' })).status, 403);
    assert.equal((await com.put('/api/company', {})).status, 403);
    assert.equal((await provKart.get('/api/clients')).status, 403);
    assert.equal((await provKart.get('/api/events')).status, 403);
    assert.equal((await new Api(app.base).get('/api/events')).status, 401);
    assert.equal((await adm.get('/api/users')).status, 200);
    // el proveedor no puede gestionar disponibilidad de otro: provider_id se fuerza al suyo
    const rule = ok(await provKart.post('/api/portal/provider/rules', { provider_id: S.pBoat, service_id: S.sKart, start_time: '20:00', capacity_pax: 10 }));
    assert.equal(rule.provider_id, S.pKart);
    assert.equal((await provKart.post('/api/portal/provider/rules', { service_id: S.sBoat, start_time: '20:00', capacity_pax: 10 })).status, 400);
    // el comercial ve márgenes (permiso) pero el proveedor jamás ve precios de venta
    const home = JSON.stringify(ok(await provKart.get('/api/portal/provider/home')));
    assert.ok(!home.includes('price_cents'));
    // CSRF: origen distinto con sesión → 403
    assert.equal((await com.req('POST', '/api/tasks', { title: 'x' }, { origin: 'https://evil.example' })).status, 403);
  });

  test('revocación de enlaces, versiones y copia de precios congelada', async () => {
    const e = await makeEvent({ services: [{ service_id: S.sMenu }], pax: 10, date: D(95), title: 'Congelado' });
    const q = ok(await com.get(`/api/quotes/${e.quote.id}`));
    const before = q.options[0].totals.total_cents;
    ok(await ops.put(`/api/services/${S.sMenu}`, { price_eur: '99' }));                      // cambio de catálogo posterior
    assert.equal(ok(await com.get(`/api/quotes/${e.quote.id}`)).options[0].totals.total_cents, before, 'la propuesta conserva su copia de precios');
    assert.equal((await reload(e.eventId)).event.total_due_cents, before, 'la reserva también');
    ok(await ops.put(`/api/services/${S.sMenu}`, { price_eur: '32' }));
    // nueva versión de una propuesta enviada: la anterior queda sustituida y su enlace deja de funcionar
    const lead = ok(await com.post('/api/leads', { client: { name: 'Versión', email: 'v@demo.test', consent_email: true } }));
    const q1 = ok(await com.post('/api/quotes', { client_id: lead.client_id, lead_id: lead.id, title: 'V', options: [{ name: 'A', pax: 10, event_date: D(96), lines: [{ kind: 'service', service_id: S.sMenu }] }] }));
    const s1 = ok(await com.post(`/api/quotes/${q1.id}/send`));
    const v2 = ok(await com.post(`/api/quotes/${q1.id}/version`));
    assert.equal(v2.version, 2); assert.equal(v2.status, 'draft');
    assert.equal((await app.anon.get(`/api/public/quote/${tokenFrom(s1.link)}`)).status, 404);
    const s2 = ok(await com.post(`/api/quotes/${v2.id}/send`));
    ok(await app.anon.get(`/api/public/quote/${tokenFrom(s2.link)}`));
    ok(await com.post(`/api/quotes/${v2.id}/revoke-link`));
    assert.equal((await app.anon.get(`/api/public/quote/${tokenFrom(s2.link)}`)).status, 404);
  });

  test('borrador generado con IA exige revisión humana antes de enviarse', async () => {
    const lead = ok(await com.post('/api/leads', { client: { name: 'IA Test', email: 'ia@demo.test', consent_email: true }, event_type: 'Despedida', pax_estimated: 10, dates_alt: [D(100)], services_requested: 'karting comida despedida' }));
    const a = ok(await com.get(`/api/leads/${lead.id}/assist`));
    assert.ok(a.suggestions.packs.length >= 1); assert.equal(a.requires_human_review, true);
    const d = ok(await com.post(`/api/leads/${lead.id}/ai-proposal`));
    const blocked = await com.post(`/api/quotes/${d.quote_id}/send`);
    assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'needs_review');
    ok(await com.post(`/api/quotes/${d.quote_id}/review`));
    ok(await com.post(`/api/quotes/${d.quote_id}/send`));
  });

  test('formulario web público crea consulta; honeypot descarta spam; anonimización conserva lo económico', async () => {
    const r = ok(await app.anon.post('/api/public/leads/demo', { name: 'Web Lead', email: 'web@demo.test', event_type: 'Despedida', pax: 15, date: D(120), privacy_accepted: true }));
    assert.ok(r.reference);
    assert.equal((await app.anon.post('/api/public/leads/demo', { name: 'x', email: 'x@x.es' })).status, 400);
    const spam = ok(await app.anon.post('/api/public/leads/demo', { name: 'Bot', email: 'bot@x.es', website: 'http://spam', privacy_accepted: true }));
    assert.equal(spam.reference, undefined);
    const leads = ok(await com.get('/api/leads')); assert.ok(leads.some((l) => l.client_name === 'Web Lead' && l.source === 'web'));
    assert.ok(!leads.some((l) => l.client_name === 'Bot'));
    const e = await makeEvent({ services: [{ service_id: S.sMenu }], pax: 10, date: D(130), title: 'Borrar' });
    const clientId = e.ev.client.id;
    ok(await adm.post(`/api/clients/${clientId}/erase`));
    const c = ok(await adm.get(`/api/clients/${clientId}`)).client;
    assert.equal(c.email, null); assert.match(c.name, /anonimizado/);
    assert.ok((await reload(e.eventId)).event.total_due_cents > 0, 'los registros económicos se conservan');
  });
});
