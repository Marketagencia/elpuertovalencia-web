import admin from './admin.js';
import crm from './crm.js';
import catalog from './catalog.js';
import sales from './sales.js';
import ops from './ops.js';
import money from './money.js';
import comms from './comms.js';
import portal from './portal.js';
import reports from './reports.js';

export function registerAll(r, db) {
  for (const m of [admin, crm, catalog, sales, ops, money, comms, portal, reports]) m(r, db);
}
