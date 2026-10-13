import crypto from 'node:crypto';
import { sha256, newToken, HttpError } from './util.js';
const realNow = () => new Date().toISOString();

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 64).toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [, s, h] = String(stored).split('$');
  if (!s) return false;
  const calc = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64), exp = Buffer.from(h, 'base64');
  return calc.length === exp.length && crypto.timingSafeEqual(calc, exp);
}
export function login(db, email, password) {
  const u = db.get('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1', String(email || '').trim());
  // misma respuesta si el usuario no existe o la clave falla (evita enumeración de usuarios)
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Email o contraseña incorrectos', 'bad_credentials');
  const t = newToken();
  db.run('INSERT INTO sessions(token_hash,user_id,company_id,expires_at,created_at) VALUES(?,?,?,?,?)',
    sha256(t), u.id, u.company_id, new Date(Date.now() + 7 * 864e5).toISOString(), realNow());
  db.run('UPDATE users SET last_login_at=? WHERE id=?', realNow(), u.id);
  return { token: t, user: publicUser(u) };
}
export const logout = (db, t) => db.run('DELETE FROM sessions WHERE token_hash=?', sha256(t));
export function userFromToken(db, t) {
  if (!t) return null;
  const u = db.get(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`, sha256(t), realNow());
  return u || null;
}
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, company_id: u.company_id,
  provider_id: u.provider_id, client_id: u.client_id });
