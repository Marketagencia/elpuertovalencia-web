import { openDb } from './db.js';
import { createCompany } from './seed.js';
const [name, slug, email, password] = process.argv.slice(2);
if (!name || !slug || !email || !password) { console.error('Uso: node src/create-company.js "Nombre" slug admin@correo.com "ClaveDeAlMenos10Caracteres"'); process.exit(1); }
const db = openDb();
const id = createCompany(db, { name, slug, adminEmail: email, adminPassword: password });
console.log(`Empresa creada (id ${id}). Entra con ${email}.`);
