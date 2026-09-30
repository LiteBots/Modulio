import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { q, nowIso } from './db.js';
import { config } from './config.js';
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

// ---------- Sesje ----------
export function createSession(req, res, userId, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expires = new Date(now + (remember ? REMEMBER_MS : SHORT_MS)).toISOString();
  q(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    sha256(token), userId, nowIso(), expires, nowIso(),
    String(req.headers['user-agent'] || '').slice(0, 300), clientIp(req),
  );
  const secure = config.cookieSecure || isSecureRequest(req);
  res.setHeader('Set-Cookie', cookieString(token, { maxAgeSec: remember ? REMEMBER_MS / 1000 : undefined, secure }));
}

export function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token || token.length > 100) return null;
  const row = q(`SELECT s.id AS session_id, s.last_seen_at, s.expires_at,
                        u.id, u.email, u.name, u.company, u.phone, u.role, u.created_at, u.last_login_at
                 FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ?`).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    q('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  // Aktualizuj "ostatnio widziany" co najwyżej co 5 min
  if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60 * 1000) {
    q('UPDATE sessions SET last_seen_at = ?, ip = ? WHERE id = ?').run(nowIso(), clientIp(req), row.session_id);
  }
  const { session_id, last_seen_at, expires_at, ...user } = row;
  return { sessionId: session_id, user };
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', cookieString('', { maxAgeSec: 0, secure: config.cookieSecure || isSecureRequest(req) }));
}

export function purgeExpiredSessions() {
  q('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
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
  return { id: u.id, email: u.email, name: u.name, company: u.company, phone: u.phone, role: u.role, createdAt: u.created_at, lastLoginAt: u.last_login_at };
}
