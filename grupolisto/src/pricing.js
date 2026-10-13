// Cálculo de precios, costes y márgenes. Todo en céntimos; PVP y coste se introducen CON impuestos incluidos.
// Los márgenes se calculan sobre base imponible (neto de IVA) para que sean comparables.
import { badRequest, netOf, allocate, parseJson } from './util.js';

export function serviceSpec(s, costOverride) {
  return { price_model: s.price_model, price_cents: s.price_cents,
    cost_cents: costOverride ?? s.cost_cents, tiers: parseJson(s.tiers, []), tax_bp: s.tax_bp, cost_tax_bp: s.cost_tax_bp };
}

// → { unit, unit_price, unit_cost, price, cost }
export function calcSpec(spec, pax, qty = 1, discountPct = 0) {
  pax = Number(pax) || 0; qty = Number(qty) || 1;
  let unit, up, uc, mult;
  switch (spec.price_model) {
    case 'per_person': unit = 'persona'; up = spec.price_cents; uc = spec.cost_cents; mult = pax * qty; break;
    case 'per_group': unit = 'grupo'; up = spec.price_cents; uc = spec.cost_cents; mult = qty; break;
    case 'per_unit': unit = 'unidad'; up = spec.price_cents; uc = spec.cost_cents; mult = qty; break;
    case 'tiers': {
      const t = (spec.tiers || []).find((x) => pax >= x.min && (x.max == null || pax <= x.max));
      if (!t) throw badRequest(`No hay tramo de precio para ${pax} asistentes`, 'no_tier');
      const group = t.basis === 'group';
      unit = group ? 'grupo' : 'persona'; up = t.price_cents; uc = t.cost_cents ?? spec.cost_cents; mult = group ? qty : pax * qty; break;
    }
    default: throw badRequest('Modelo de precio no válido');
  }
  const f = (100 - (discountPct || 0)) / 100;
  const unit_price = Math.round(up * f);
  return { unit, unit_price, unit_cost: uc, price: unit_price * mult, cost: uc * mult };
}

export const paxWarnings = (svc, pax) => {
  const w = [];
  if (svc.min_pax && pax < svc.min_pax) w.push(`Mínimo ${svc.min_pax} personas`);
  if (svc.max_pax && pax > svc.max_pax) w.push(`Máximo ${svc.max_pax} personas`);
  return w;
};

// Fila de presupuesto a partir de un servicio del catálogo (con copia de condiciones: snapshot)
export function lineFromService(svc, { pax, qty = 1, costOverride, providerId, discountPct = 0, kind = 'service', optional = 0, selected = 1,
  mandatory, start_time, parent_line_id, pack_id }) {
  const spec = serviceSpec(svc, costOverride);
  const c = calcSpec(spec, pax, qty, discountPct);
  return {
    kind, service_id: svc.id, pack_id: pack_id ?? null, parent_line_id: parent_line_id ?? null, provider_id: providerId ?? null,
    description: svc.name, qty, unit: c.unit, pax, unit_price_cents: c.unit_price, unit_cost_cents: c.unit_cost,
    total_price_cents: c.price, total_cost_cents: c.cost, tax_bp: svc.tax_bp, cost_tax_bp: svc.cost_tax_bp,
    optional: optional ? 1 : 0, selected: optional ? (selected ? 1 : 0) : 1,
    mandatory: mandatory ?? (optional ? 0 : 1), start_time: start_time ?? null,
    snapshot: { pricing: { ...spec, discount_pct: discountPct }, name: svc.name, category: svc.category, location: svc.location,
      duration_min: svc.duration_min, min_pax: svc.min_pax, max_pax: svc.max_pax, min_notice_days: svc.min_notice_days,
      confirm_deadline_days: svc.confirm_deadline_days, payment_terms: svc.payment_terms, cancel_terms: svc.cancel_terms,
      cancel_free_days: svc.cancel_free_days, cancel_penalty_pct: svc.cancel_penalty_pct, restrictions: svc.restrictions,
      share_contact: svc.share_contact },
  };
}

export function lineExtra({ description, qty = 1, price_cents = 0, cost_cents = 0, tax_bp = 1000, cost_tax_bp = 1000, provider_id,
  optional = 0, selected = 1, mandatory }) {
  qty = Math.max(1, Number(qty) || 1);
  return { kind: 'extra', service_id: null, pack_id: null, parent_line_id: null, provider_id: provider_id ?? null,
    description: description || 'Extra', qty, unit: 'unidad', pax: null, unit_price_cents: price_cents, unit_cost_cents: cost_cents,
    total_price_cents: price_cents * qty, total_cost_cents: cost_cents * qty, tax_bp, cost_tax_bp,
    optional: optional ? 1 : 0, selected: optional ? (selected ? 1 : 0) : 1, mandatory: mandatory ?? (optional ? 0 : 1), start_time: null,
    snapshot: { pricing: { price_model: 'per_unit', price_cents, cost_cents, tiers: [], tax_bp, cost_tax_bp, discount_pct: 0 }, name: description } };
}

// Hojas contables de una opción: las filas 'pack' son solo cabecera (suman sus pack_item) → sin duplicar conceptos
export const leaves = (lines) => lines.filter((l) => l.kind !== 'pack' && l.selected);

export function optionTotals(lines, discountCents = 0) {
  const L = leaves(lines);
  const gross = L.reduce((a, l) => a + l.total_price_cents, 0);
  const costGross = L.reduce((a, l) => a + l.total_cost_cents, 0);
  const disc = Math.min(Math.max(discountCents || 0, 0), gross);
  const total = gross - disc;
  const shares = allocate(disc, L.map((l) => l.total_price_cents));
  let net = 0, costNet = 0;
  L.forEach((l, i) => { net += netOf(l.total_price_cents - shares[i], l.tax_bp); costNet += netOf(l.total_cost_cents, l.cost_tax_bp); });
  return { gross_cents: gross, discount_cents: disc, total_cents: total, net_cents: net, tax_cents: total - net,
    cost_cents: costGross, cost_net_cents: costNet, margin_net_cents: net - costNet,
    margin_pct: net ? Math.round(((net - costNet) / net) * 1000) / 10 : 0 };
}

// Precio tras descuento de cada hoja (para crear los servicios del evento)
export function discountedPrices(lines, discountCents) {
  const L = leaves(lines);
  const gross = L.reduce((a, l) => a + l.total_price_cents, 0);
  const disc = Math.min(Math.max(discountCents || 0, 0), gross);
  const shares = allocate(disc, L.map((l) => l.total_price_cents));
  return L.map((l, i) => ({ line: l, price: l.total_price_cents - shares[i], list: l.total_price_cents,
    ratioBp: gross ? Math.round((disc / gross) * 10000) : 0 }));
}

export const netMargin = (priceGross, taxBp, costGross, costTaxBp) => netOf(priceGross, taxBp) - netOf(costGross, costTaxBp);
