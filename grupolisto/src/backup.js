import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { DATA_DIR } from './config.js';
// Copia consistente de la base de datos (VACUUM INTO) + uploads. Programa este comando con cron y copia el resultado fuera del servidor.
const dir = path.join(DATA_DIR, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const db = openDb();
db.exec(`VACUUM INTO '${path.join(dir, 'grupolisto.db').replace(/'/g, "''")}'`);
const up = path.join(DATA_DIR, 'uploads');
if (fs.existsSync(up)) fs.cpSync(up, path.join(dir, 'uploads'), { recursive: true });
console.log(`Copia de seguridad creada en ${dir}`);
