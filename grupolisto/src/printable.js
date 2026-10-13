import { eur } from './util.js';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fd = (d) => (d ? d.split('-').reverse().join('/') : '—');

// Documento imprimible de la propuesta (se guarda como PDF desde el navegador). Sin costes ni márgenes.
export function printable(q, brand, client) {
  const color = /^#[0-9a-f]{6}$/i.test(brand?.color || '') ? brand.color : '#0b6e99';
  const opts = q.options.map((o) => `<section><h2>${esc(o.name)}</h2>
    <p class="meta">${o.event_date ? `Fecha: ${fd(o.event_date)} · ` : ''}${o.start_time ? `Hora: ${esc(o.start_time)} · ` : ''}${o.pax} asistentes</p>
    <table><thead><tr><th>Concepto</th><th class="r">Cant.</th><th class="r">Precio</th></tr></thead><tbody>
    ${o.lines.filter((l) => l.selected || l.optional).map((l) => `<tr class="${l.kind === 'pack_item' ? 'sub' : ''}"><td>${l.kind === 'pack_item' ? '↳ ' : ''}${esc(l.description)}${l.optional ? ' <em>(opcional)</em>' : ''}${l.selected ? '' : ' <em>(no seleccionado)</em>'}</td>
    <td class="r">${l.kind === 'pack' ? '' : `${l.qty} ${esc(l.unit || '')}`}</td><td class="r">${l.kind === 'pack_item' ? 'incluido' : eur(l.total_price_cents)}</td></tr>`).join('')}
    </tbody></table>
    <p class="tot">${o.totals.discount_cents ? `Descuento: −${eur(o.totals.discount_cents)}<br>` : ''}<b>Total (IVA incluido): ${eur(o.totals.total_cents)}</b><br>Base imponible: ${eur(o.totals.net_cents)} · IVA: ${eur(o.totals.tax_cents)}<br>
    Señal (${q.deposit_pct} %): ${eur(o.deposit_cents)} · Saldo pendiente: ${eur(o.balance_cents)}</p></section>`).join('');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>${esc(q.number)} v${q.version}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:800px;margin:24px auto;padding:0 16px;color:#222}h1{color:${color};margin:0}h2{border-bottom:2px solid ${color};padding-bottom:4px;margin-top:28px}
table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}.sub td{color:#555;font-size:13px}.meta{color:#555}.tot{text-align:right}
.cond{font-size:12px;color:#444;margin-top:24px;border-top:1px solid #ddd;padding-top:8px;white-space:pre-wrap}@media print{button{display:none}}</style>
<button onclick="window.print()">Imprimir / Guardar como PDF</button>
<h1>${esc(brand?.name || 'Propuesta')}</h1><p>${esc(brand?.email || '')} ${esc(brand?.phone || '')}</p>
<h3>Propuesta ${esc(q.number)} · versión ${q.version}</h3><p><b>${esc(q.title)}</b><br>Para: ${esc(client?.name)}<br>Válida hasta: ${fd(q.valid_until)}</p>${opts}
<div class="cond"><b>Condiciones</b>\n${esc(q.terms?.payment || '')}\n${esc(q.terms?.cancel || '')}\n${esc(q.terms?.general || '')}\n${esc(q.terms?.availability || 'La disponibilidad de cada servicio está sujeta a confirmación del proveedor.')}</div></html>`;
}
