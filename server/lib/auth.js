import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { insert, findOne, update, remove, removeMany, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { clientIp, isSecureRequest } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export const COOKIE_NAME = 'modulio_sid';
const DAY = 24 * 60 * 60 * 1000;
const REMEMBER_MS = 30 * DAY;
const SHORT_MS = 1 * DAY;

// ---------- Hasła ----------
export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, SCRYPT_OPTS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain, stored) {
  const [alg, saltB64, keyB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT_OPTS);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Stały hash do porównania, gdy użytkownik nie istnieje (ochrona przed timing attack)
let dummyHash = null;
export async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword(crypto.randomBytes(12).toString('hex'));
  return dummyHash;
}

// ---------- Ciasteczka ----------
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignoruj */ }
  }
  return out;
}

function cookieString(value, { maxAgeSec, secure }) {
  const parts = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Sesje (kolekcja `sessions`) ----------
export async function createSession(req, res, userId, remember, impersonatorId = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + (remember ? REMEMBER_MS : SHORT_MS)).toISOString();
  await insert('sessions', {
    token_hash: sha256(token), user_id: userId, impersonator_id: impersonatorId,
    created_at: nowIso(), expires_at: expires, last_seen_at: nowIso(),
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300), ip: clientIp(req),
  });
  const secure = config.cookieSecure || isSecureRequest(req);
  res.setHeader('Set-Cookie', cookieString(token, { maxAgeSec: remember ? REMEMBER_MS / 1000 : undefined, secure }));
}

export async function getSession(req) {
  if (req._session !== undefined) return req._session; // cache na czas jednego żądania
  req._session = null;
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token || token.length > 100) return null;
  const s = await findOne('sessions', { token_hash: sha256(token) });
  if (!s) return null;
  const u = await findOne('users', { id: s.user_id });
  if (!u || s.expires_at < nowIso() || (u.status === 'blocked' && !s.impersonator_id)) {
    await remove('sessions', { id: s.id });
    return null;
  }
  // Aktualizuj "ostatnio widziany" co najwyżej co 5 min
  if (Date.now() - Date.parse(s.last_seen_at) > 5 * 60 * 1000) {
    await update('sessions', { id: s.id }, { last_seen_at: nowIso(), ip: clientIp(req) });
  }
  const { password_hash, ...user } = u;
  req._session = { sessionId: s.id, impersonatorId: s.impersonator_id || null, user };
  return req._session;
}

export async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) await remove('sessions', { token_hash: sha256(token) });
  req._session = null;
  res.setHeader('Set-Cookie', cookieString('', { maxAgeSec: 0, secure: config.cookieSecure || isSecureRequest(req) }));
}

export async function purgeExpiredSessions() {
  try { await removeMany('sessions', { expires_at: { $lt: nowIso() } }); } catch { /* baza niedostępna */ }
}

// ---------- Rate limiting (w pamięci) ----------
const buckets = new Map();
/** Zwraca null, gdy OK, albo liczbę sekund do odblokowania */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  return b.count <= limit ? null : Math.ceil((b.reset - now) / 1000);
}
export function resetRateLimit(key) { buckets.delete(key); }

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  purgeExpiredSessions();
}, 10 * 60 * 1000).unref();

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, company: u.company, nip: u.nip ?? '', phone: u.phone, role: u.role, status: u.status ?? 'active', createdAt: u.created_at, lastLoginAt: u.last_login_at };
}

export const isStaff = (u) => u && (u.role === 'admin' || u.role === 'staff');

/** Generuje czytelne hasło tymczasowe, np. Kora-7421-Lipa */
export function generatePassword() {
  const words = ['Kora', 'Lipa', 'Mewa', 'Brzoza', 'Sowa', 'Fala', 'Klon', 'Rosa', 'Iskra', 'Wrzos', 'Topola', 'Burza'];
  const w = () => words[crypto.randomInt(words.length)];
  return `${w()}-${crypto.randomInt(1000, 9999)}-${w()}`;
}
