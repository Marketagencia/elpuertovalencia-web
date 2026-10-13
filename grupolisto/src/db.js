import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const SCHEMA = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8');
const val = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0)
  : v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

export function openDb(file = path.join(DATA_DIR, 'grupolisto.db')) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  raw.exec(SCHEMA);
  let depth = 0, sp = 0;
  const db = {
    raw,
    get: (sql, ...p) => raw.prepare(sql).get(...p.map(val)),
    all: (sql, ...p) => raw.prepare(sql).all(...p.map(val)),
    run: (sql, ...p) => raw.prepare(sql).run(...p.map(val)),
    exec: (sql) => raw.exec(sql),
    insert(table, obj) {
      const k = Object.keys(obj).filter((x) => obj[x] !== undefined);
      const r = raw.prepare(`INSERT INTO ${table}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map((x) => val(obj[x])));
      return Number(r.lastInsertRowid);
    },
    // UPDATE ... WHERE id=? AND company_id=?  (el company_id es obligatorio: aislamiento entre empresas)
    update(table, id, cid, obj) {
      const k = Object.keys(obj).filter((x) => obj[x] !== undefined);
      if (!k.length) return 0;
      return Number(raw.prepare(`UPDATE ${table} SET ${k.map((x) => `${x}=?`).join(',')} WHERE id=? AND company_id=?`)
        .run(...k.map((x) => val(obj[x])), id, cid).changes);
    },
    // Transacción con BEGIN IMMEDIATE (serializa escritores); anidada mediante SAVEPOINT.
    tx(fn) {
      if (depth === 0) {
        raw.exec('BEGIN IMMEDIATE'); depth++;
        try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } finally { depth--; }
      }
      const name = `sp${++sp}`; raw.exec(`SAVEPOINT ${name}`); depth++;
      try { const r = fn(); raw.exec(`RELEASE ${name}`); return r; }
      catch (e) { raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw e; } finally { depth--; }
    },
    close: () => raw.close(),
  };
  return db;
}
