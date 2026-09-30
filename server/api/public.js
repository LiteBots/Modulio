// Publiczne API: kontakt, newsletter, logowanie, rejestracja
import { q, nowIso } from '../db/index.js';
import { HttpError, clientIp, text, email, password } from '../lib/http.js';
import {
  hashPassword, verifyPassword, getDummyHash, createSession, destroySession, resetRateLimit, publicUser, isStaff,
} from '../lib/auth.js';
import { flag, setting } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { route, limitOr429 } from './router.js';

const TOPICS = ['Dobór systemu Modulio', 'Pakiet Start', 'Pakiet Business', 'Oprogramowanie dedykowane', 'Integracja / rozszerzenie', 'Inny temat'];

route('POST', '/api/contact', async ({ req, body }) => {
  const ip = clientIp(req);
  if (body.website) return { ok: true }; // honeypot
  limitOr429(`contact:${ip}`, 5, 10 * 60 * 1000);
  const lead = {
    name: text(body, 'name', { label: 'Imię i nazwisko / firma', min: 2, max: 120, required: true }),
    email: email(body),
    phone: text(body, 'phone', { label: 'Telefon', max: 40 }),
    topic: TOPICS.includes(body.topic) ? body.topic : 'Inny temat',
    message: text(body, 'message', { label: 'Wiadomość', min: 10, max: 5000, required: true }),
    source: ['kontakt', 'konfigurator', 'branza'].includes(body.source) ? body.source : 'kontakt',
    utm: text(body, 'utm', { max: 80 }),
  };
  if (body.consent !== true) throw new HttpError(422, 'Zaznacz zgodę na kontakt w sprawie zapytania.', { consent: 'Wymagane' });
  const r = q(`INSERT INTO leads (name, email, phone, topic, message, source, utm_source, ip, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(lead.name, lead.email, lead.phone, lead.topic, lead.message, lead.source, lead.utm, ip, nowIso(), nowIso());
  audit(req, null, 'lead.created', 'lead', Number(r.lastInsertRowid), `${lead.name} <${lead.email}>`);
  notifyLead(lead);
  return { ok: true };
});

function notifyLead(lead) {
  const url = setting('lead_webhook_url');
  if (!url) return;
  const msg = `Nowe zapytanie Modulio (${lead.topic})\n${lead.name} <${lead.email}> ${lead.phone}\n\n${lead.message.slice(0, 1500)}`;
  fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: msg, content: msg.slice(0, 1990) }), signal: AbortSignal.timeout(5000),
  }).catch((e) => console.warn('[lead-webhook]', e.message));
}

route('POST', '/api/newsletter', ({ req, body }) => {
  limitOr429(`nl:${clientIp(req)}`, 5, 10 * 60 * 1000);
  const mail = email(body);
  q(`INSERT INTO newsletter (email, source, created_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET unsubscribed_at = NULL`).run(mail, String(body.source || 'stopka').slice(0, 40), nowIso());
  return { ok: true };
});

// ---------- Autoryzacja ----------
route('GET', '/api/auth/me', ({ user, session }) => ({
  user: publicUser(user),
  impersonating: Boolean(session?.impersonatorId),
  allowRegistration: flag('allow_registration'),
}));

route('POST', '/api/auth/login', async ({ req, res, body }) => {
  const ip = clientIp(req);

  // ------------------------------------------------------------------
  // TYMCZASOWE szybkie logowanie do /admin bez e-maila i hasła.
  // Działa TYLKO, gdy w pliku .env jest ustawione: ADMIN_QUICK_LOGIN=true
  // Loguje na pierwsze aktywne konto administratora.
  // Gdy dodasz hasło — usuń tę linię z .env (albo ustaw false).
  // ------------------------------------------------------------------
  if (body.admin && process.env.ADMIN_QUICK_LOGIN === 'true' && !String(body.email ?? '').trim() && !body.password) {
    const admin = q(`SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1`).get();
    if (!admin) throw new HttpError(404, 'Brak konta administratora. Ustaw ADMIN_EMAIL i ADMIN_PASSWORD w .env i uruchom serwer ponownie.');
    admin.last_login_at = nowIso();
    q('UPDATE users SET last_login_at = ? WHERE id = ?').run(admin.last_login_at, admin.id);
    createSession(req, res, admin.id, body.remember !== false);
    audit(req, admin, 'auth.admin_login', 'user', admin.id, 'szybkie logowanie bez hasła');
    return { user: publicUser(admin) };
  }

  const mail = email(body);
  limitOr429(`login-ip:${ip}`, 20, 15 * 60 * 1000);
  limitOr429(`login-mail:${mail}`, 8, 15 * 60 * 1000);
  const user = q('SELECT * FROM users WHERE email = ?').get(mail);
  const ok = await verifyPassword(String(body.password ?? ''), user ? user.password_hash : await getDummyHash());
  if (!user || !ok) {
    audit(req, user, 'auth.login_failed', 'user', user?.id ?? null, mail);
    throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.');
  }
  if (user.status === 'blocked') throw new HttpError(403, 'Konto jest zablokowane. Skontaktuj się z Modulio.');
  if (body.admin && !isStaff(user)) throw new HttpError(403, 'To konto nie ma dostępu do panelu zarządzania.');
  resetRateLimit(`login-mail:${mail}`);
  user.last_login_at = nowIso();
  q('UPDATE users SET last_login_at = ? WHERE id = ?').run(user.last_login_at, user.id);
  createSession(req, res, user.id, body.remember !== false);
  audit(req, user, body.admin ? 'auth.admin_login' : 'auth.login', 'user', user.id);
  return { user: publicUser(user) };
});

route('POST', '/api/auth/register', async ({ req, res, body }) => {
  if (!flag('allow_registration')) throw new HttpError(403, 'Rejestracja jest wyłączona. Konto zakłada zespół Modulio.');
  limitOr429(`register:${clientIp(req)}`, 5, 60 * 60 * 1000);
  const data = {
    name: text(body, 'name', { label: 'Imię i nazwisko', min: 2, max: 120, required: true }),
    company: text(body, 'company', { label: 'Firma', max: 160 }),
    email: email(body),
    password: password(body),
  };
  if (body.consent !== true) throw new HttpError(422, 'Musisz zaakceptować politykę prywatności.', { consent: 'Wymagane' });
  if (q('SELECT 1 FROM users WHERE email = ?').get(data.email)) throw new HttpError(409, 'Konto z tym adresem e-mail już istnieje.', { email: 'Zajęty' });
  const { lastInsertRowid } = q(`INSERT INTO users (email, password_hash, name, company, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(data.email, await hashPassword(data.password), data.name, data.company, nowIso(), nowIso());
  const u = q('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  createSession(req, res, u.id, true);
  audit(req, u, 'user.registered', 'user', u.id);
  return { user: publicUser(u) };
});

route('POST', '/api/auth/logout', ({ req, res, user }) => {
  destroySession(req, res);
  if (user) audit(req, user, 'auth.logout', 'user', user.id);
  return { ok: true };
});

// Powrót z trybu „zaloguj jako klient” do konta administratora
route('POST', '/api/auth/stop-impersonation', ({ req, res, session }) => {
  if (!session?.impersonatorId) throw new HttpError(400, 'Nie jesteś w trybie podglądu klienta.');
  const admin = q('SELECT * FROM users WHERE id = ?').get(session.impersonatorId);
  destroySession(req, res);
  if (!admin || !isStaff(admin)) throw new HttpError(403, 'Konto administratora jest niedostępne.');
  createSession(req, res, admin.id, true);
  audit(req, admin, 'user.impersonation_end', 'user', session.user.id);
  return { ok: true, redirect: `/admin/uzytkownicy/${session.user.id}` };
}, { auth: 'user' });
