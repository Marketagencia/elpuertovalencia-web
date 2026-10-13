import { dashboard, profitability } from '../reports.js';
import { can } from '../perm.js';
import { audit } from '../core.js';

const csv = (rows) => { if (!rows.length) return ''; const k = Object.keys(rows[0]); const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; return [k.join(';'), ...rows.map((r) => k.map((x) => q(typeof r[x] === 'number' && /cents/.test(x) ? (r[x] / 100).toFixed(2).replace('.', ',') : r[x])).join(';'))].join('\n'); };

export default function (r) {
  r.get('/api/dashboard', 'staff', (c) => dashboard(c.ctx, c.user));
  r.get('/api/reports/profitability', 'margins:r', (c) => {
    const out = profitability(c.ctx, { from: c.query.from, to: c.query.to });
    return out;
  });
  r.get('/api/reports/profitability.csv', 'margins:r', (c) => {
    const out = profitability(c.ctx, { from: c.query.from, to: c.query.to });
    const rows = out[c.query.by === 'provider' ? 'by_provider' : c.query.by === 'service' ? 'by_service' : 'by_event'];
    audit(c.ctx, 'report', null, 'exportado_csv', { by: c.query.by });
    return { __raw: csv(rows), type: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="rentabilidad.csv"' } };
  });
}
