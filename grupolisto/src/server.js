import http from 'node:http';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { PORT, BASE_URL } from './config.js';
import { tick } from './automations.js';

const db = openDb();
const { handler } = createApp(db);
const server = http.createServer(handler);
server.listen(PORT, () => {
  const n = db.get('SELECT COUNT(*) n FROM companies').n;
  console.log(`GrupoListo escuchando en ${BASE_URL}`);
  if (!n) console.log('No hay ninguna empresa. Crea una con:  node src/create-company.js "Mi agencia" mi-agencia admin@correo.com "UnaClaveLarga123"\n  o carga datos de demostración con:  npm run seed');
});
// Planificador: caduca bloqueos, lanza automatizaciones y procesa la cola de mensajes
let running = false;
setInterval(async () => { if (running) return; running = true; try { await tick(db); } catch (e) { console.error('[tick]', e); } finally { running = false; } }, 60000).unref();
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { server.close(() => { db.close(); process.exit(0); }); });
