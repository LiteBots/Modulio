import fs from 'node:fs';
import path from 'node:path';
import { q, tx, nowIso, today, FILES_DIR } from './db.js';
import { config } from './config.js';
import {
  HttpError, json, readJson, clientIp, text, email, oneOf, password,
} from './http.js';
import {
  hashPassword, verifyPassword, getDummyHash, createSession, getSession,
  destroySession, rateLimit, resetRateLimit, publicUser,
} from './auth.js';

// ------------------------------------------------------------------
// Router
// ------------------------------------------------------------------
const routes = [];
function route(method, pattern, handler, { auth = false } = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, auth });
}

export async function handleApi(req, res, url) {
  try {
    const candidates = routes.filter((r) => r.re.test(url.pathname));
    if (!candidates.length) throw new HttpError(404, 'Nie znaleziono.');
    const r = candidates.find((c) => c.method === req.method);
    if (!r) throw new HttpError(405, 'Metoda niedozwolona.');

    // Ochrona CSRF: mutacje wymagają nagłówka niestandardowego i zgodnego Origin
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers['x-requested-with'] !== 'modulio') throw new HttpError(403, 'Brak nagłówka żądania.');
      const origin = req.headers.origin;
      if (origin) {
        let host;
        try { host = new URL(origin).host; } catch { host = ''; }
        const allowed = [req.headers.host, new URL(config.siteUrl).host];
        if (!allowed.includes(host)) throw new HttpError(403, 'Niedozwolone źródło żądania.');
      }
    }

    const m = url.pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const session = getSession(req);
    if (r.auth && !session) throw new HttpError(401, 'Sesja wygasła. Zaloguj się ponownie.');
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['content-length'] !== '0'
      ? await readJson(req).catch((e) => { if (e.status === 415 && req.method === 'DELETE') return {}; throw e; })
      : {};
    const result = await r.handler({ req, res, url, params, body, session, user: session?.user });
    if (!res.headersSent) json(res, 200, result ?? { ok: true });
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.message, fields: err.fields });
    } else {
      console.error('[api]', err);
      json(res, 500, { error: 'Wystąpił błąd serwera. Spróbuj ponownie za chwilę.' });
    }
  }
}

const idParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Nie znaleziono.');
  return n;
};

function limitOr429(key, limit, windowMs) {
  const wait = rateLimit(key, limit, windowMs);
  if (wait) throw new HttpError(429, `Zbyt wiele prób. Spróbuj ponownie za ${Math.ceil(wait / 60)} min.`);
}

// ------------------------------------------------------------------
// Formatowanie encji
// ------------------------------------------------------------------
export const STAGES = [
  { key: 'analiza', label: 'Analiza' },
  { key: 'projekt', label: 'Projekt' },
  { key: 'wdrozenie', label: 'Wdrożenie' },
  { key: 'testy', label: 'Testy' },
  { key: 'uruchomiony', label: 'Uruchomiony' },
  { key: 'rozwoj', label: 'Rozwój' },
];
const TICKET_CATEGORIES = ['pytanie', 'blad', 'zmiana', 'nowa_funkcja', 'rozliczenia'];
const TICKET_PRIORITIES = ['niski', 'normalny', 'wysoki', 'krytyczny'];

const ticketNo = (id) => `MOD-${String(1000 + id)}`;

export function invoiceTotals(items) {
  let net = 0, vat = 0;
  for (const it of items) {
    const n = Math.round(it.qty * it.unit_net * 100) / 100;
    net += n;
    vat += Math.round(n * (it.vat ?? 23)) / 100;
  }
  net = Math.round(net * 100) / 100;
  vat = Math.round(vat * 100) / 100;
  return { net, vat, gross: Math.round((net + vat) * 100) / 100 };
}

function invoiceStatus(inv) {
  if (inv.status === 'oczekuje' && inv.due_date < today()) return 'po_terminie';
  return inv.status;
}

function mapInvoice(inv, withItems = false) {
  const items = JSON.parse(inv.items || '[]');
  const out = {
    id: inv.id, number: inv.number, issueDate: inv.issue_date, dueDate: inv.due_date,
    status: invoiceStatus(inv), paidAt: inv.paid_at, projectId: inv.project_id,
    projectName: inv.project_name || null, ...invoiceTotals(items),
  };
  if (withItems) out.items = items;
  return out;
}

function mapProject(p) {
  return {
    id: p.id, name: p.name, kind: p.kind, stage: p.stage,
    stageLabel: STAGES.find((s) => s.key === p.stage)?.label || p.stage,
    progress: p.progress, description: p.description, modules: JSON.parse(p.modules || '[]'),
    manager: p.manager, startDate: p.start_date, dueDate: p.due_date,
    milestonesTotal: p.milestones_total ?? undefined, milestonesDone: p.milestones_done ?? undefined,
    openTickets: p.open_tickets ?? undefined,
  };
}

function mapTicket(t) {
  return {
    id: t.id, number: ticketNo(t.id), subject: t.subject, category: t.category, priority: t.priority,
    status: t.status, projectId: t.project_id, projectName: t.project_name || null,
    createdAt: t.created_at, updatedAt: t.updated_at, messagesCount: t.messages_count ?? undefined,
    lastAuthor: t.last_author ?? undefined,
  };
}

function mapDocument(d) {
  return {
    id: d.id, name: d.name, category: d.category, filename: d.filename, mime: d.mime, size: d.size,
    projectId: d.project_id, projectName: d.project_name || null, createdAt: d.created_at,
  };
}

// ------------------------------------------------------------------
// Kontakt (leady)
// ------------------------------------------------------------------
const TOPICS = ['Dobór systemu Modulio', 'Pakiet Start', 'Pakiet Business', 'Oprogramowanie dedykowane', 'Integracja / rozszerzenie', 'Inny temat'];

route('POST', '/api/contact', async ({ req, body }) => {
  const ip = clientIp(req);
  if (body.website) return { ok: true }; // honeypot — bot
  limitOr429(`contact:${ip}`, 5, 10 * 60 * 1000);
  const lead = {
    name: text(body, 'name', { label: 'Imię i nazwisko / firma', min: 2, max: 120, required: true }),
    email: email(body),
    phone: text(body, 'phone', { label: 'Telefon', max: 40 }),
    topic: TOPICS.includes(body.topic) ? body.topic : 'Inny temat',
    message: text(body, 'message', { label: 'Wiadomość', min: 10, max: 5000, required: true }),
    source: ['kontakt', 'konfigurator', 'branza'].includes(body.source) ? body.source : 'kontakt',
  };
  if (body.consent !== true) throw new HttpError(422, 'Zaznacz zgodę na kontakt w sprawie zapytania.', { consent: 'Wymagane' });
  q(`INSERT INTO leads (name, email, phone, topic, message, source, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(lead.name, lead.email, lead.phone, lead.topic, lead.message, lead.source, ip, nowIso());
  notifyLead(lead);
  return { ok: true };
});

function notifyLead(lead) {
  if (!config.leadWebhookUrl) return;
  const msg = `Nowe zapytanie Modulio (${lead.topic})\n${lead.name} <${lead.email}> ${lead.phone}\n\n${lead.message.slice(0, 1500)}`;
  fetch(config.leadWebhookUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: msg, content: msg.slice(0, 1990) }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.warn('[lead-webhook]', e.message));
}

// ------------------------------------------------------------------
// Autoryzacja
// ------------------------------------------------------------------
route('GET', '/api/auth/me', ({ user }) => ({ user: publicUser(user), allowRegistration: config.allowRegistration }));

route('POST', '/api/auth/login', async ({ req, res, body }) => {
  const ip = clientIp(req);
  const mail = email(body);
  limitOr429(`login-ip:${ip}`, 20, 15 * 60 * 1000);
  limitOr429(`login-mail:${mail}`, 8, 15 * 60 * 1000);
  const pw = String(body.password ?? '');
  const user = q('SELECT * FROM users WHERE email = ?').get(mail);
  const ok = await verifyPassword(pw, user ? user.password_hash : await getDummyHash());
  if (!user || !ok) throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.');
  resetRateLimit(`login-mail:${mail}`);
  user.last_login_at = nowIso();
  q('UPDATE users SET last_login_at = ? WHERE id = ?').run(user.last_login_at, user.id);
  createSession(req, res, user.id, body.remember !== false);
  return { user: publicUser(user) };
});

route('POST', '/api/auth/register', async ({ req, res, body }) => {
  if (!config.allowRegistration) throw new HttpError(403, 'Rejestracja jest wyłączona. Konto zakłada zespół Modulio.');
  limitOr429(`register:${clientIp(req)}`, 5, 60 * 60 * 1000);
  const data = {
    name: text(body, 'name', { label: 'Imię i nazwisko', min: 2, max: 120, required: true }),
    company: text(body, 'company', { label: 'Firma', max: 160 }),
    email: email(body),
    password: password(body),
  };
  if (body.consent !== true) throw new HttpError(422, 'Musisz zaakceptować politykę prywatności.', { consent: 'Wymagane' });
  if (q('SELECT 1 FROM users WHERE email = ?').get(data.email)) {
    throw new HttpError(409, 'Konto z tym adresem e-mail już istnieje.', { email: 'Zajęty' });
  }
  const hash = await hashPassword(data.password);
  const { lastInsertRowid } = q(`INSERT INTO users (email, password_hash, name, company, created_at, last_login_at)
                                 VALUES (?, ?, ?, ?, ?, ?)`).run(data.email, hash, data.name, data.company, nowIso(), nowIso());
  createSession(req, res, Number(lastInsertRowid), true);
  return { user: publicUser(q('SELECT * FROM users WHERE id = ?').get(lastInsertRowid)) };
});

route('POST', '/api/auth/logout', ({ req, res }) => { destroySession(req, res); return { ok: true }; });

// ------------------------------------------------------------------
// Pulpit
// ------------------------------------------------------------------
route('GET', '/api/dashboard', ({ user }) => {
  const projects = q(`SELECT p.*,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) AS milestones_total,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id AND m.done = 1) AS milestones_done
    FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(user.id).map(mapProject);

  const openTickets = q(`SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status NOT IN ('rozwiazane','zamkniete')`).get(user.id).c;
  const awaitingClient = q(`SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status = 'oczekuje_na_klienta'`).get(user.id).c;
  const invoices = q(`SELECT * FROM invoices WHERE user_id = ? AND status = 'oczekuje' ORDER BY due_date`).all(user.id).map((i) => mapInvoice(i));
  const toPay = invoices.reduce((s, i) => s + i.gross, 0);

  const milestones = q(`SELECT m.id, m.title, m.due_date, p.name AS project_name, p.id AS project_id
    FROM milestones m JOIN projects p ON p.id = m.project_id
    WHERE p.user_id = ? AND m.done = 0 ORDER BY (m.due_date IS NULL), m.due_date LIMIT 5`).all(user.id)
    .map((m) => ({ id: m.id, title: m.title, dueDate: m.due_date, projectId: m.project_id, projectName: m.project_name }));

  const activity = q(`
    SELECT * FROM (
      SELECT 'update' AS type, u.title AS title, u.body AS body, u.created_at AS at, p.id AS ref_id, p.name AS ref_name, u.author AS author
        FROM project_updates u JOIN projects p ON p.id = u.project_id WHERE p.user_id = ?
      UNION ALL
      SELECT 'ticket' AS type, t.subject AS title, tm.body AS body, tm.created_at AS at, t.id AS ref_id, 'MOD-' || (1000 + t.id) AS ref_name, tm.author_name AS author
        FROM ticket_messages tm JOIN tickets t ON t.id = tm.ticket_id WHERE t.user_id = ? AND tm.author_type = 'team'
    ) ORDER BY at DESC LIMIT 8`).all(user.id, user.id)
    .map((a) => ({ type: a.type, title: a.title, body: a.body.slice(0, 220), at: a.at, refId: a.ref_id, refName: a.ref_name, author: a.author }));

  return {
    stats: {
      activeProjects: projects.filter((p) => !['uruchomiony', 'rozwoj'].includes(p.stage)).length,
      totalProjects: projects.length,
      openTickets, awaitingClient,
      invoicesToPay: invoices.length,
      amountToPay: Math.round(toPay * 100) / 100,
      overdue: invoices.filter((i) => i.status === 'po_terminie').length,
    },
    projects: projects.slice(0, 4),
    milestones,
    activity,
    invoices: invoices.slice(0, 3),
  };
}, { auth: true });

// ------------------------------------------------------------------
// Projekty
// ------------------------------------------------------------------
route('GET', '/api/projects', ({ user }) => ({
  stages: STAGES,
  projects: q(`SELECT p.*,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) AS milestones_total,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id AND m.done = 1) AS milestones_done,
      (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id AND t.status NOT IN ('rozwiazane','zamkniete')) AS open_tickets
    FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(user.id).map(mapProject),
}), { auth: true });

route('GET', '/api/projects/:id', ({ user, params }) => {
  const p = q('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(idParam(params.id), user.id);
  if (!p) throw new HttpError(404, 'Nie znaleziono projektu.');
  return {
    stages: STAGES,
    project: mapProject(p),
    milestones: q('SELECT id, title, due_date AS dueDate, done FROM milestones WHERE project_id = ? ORDER BY position, id').all(p.id)
      .map((m) => ({ ...m, done: !!m.done })),
    updates: q('SELECT id, title, body, author, created_at AS createdAt FROM project_updates WHERE project_id = ? ORDER BY created_at DESC').all(p.id),
    documents: q('SELECT * FROM documents WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC').all(p.id, user.id).map(mapDocument),
    tickets: q('SELECT * FROM tickets WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC').all(p.id, user.id).map(mapTicket),
  };
}, { auth: true });

// ------------------------------------------------------------------
// Zgłoszenia
// ------------------------------------------------------------------
route('GET', '/api/tickets', ({ user }) => ({
  tickets: q(`SELECT t.*, p.name AS project_name,
      (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages_count,
      (SELECT author_type FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_author
    FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.user_id = ? ORDER BY t.updated_at DESC`).all(user.id).map(mapTicket),
  projects: q('SELECT id, name FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(user.id),
}), { auth: true });

route('POST', '/api/tickets', ({ user, body, req }) => {
  limitOr429(`ticket:${user.id}`, 20, 60 * 60 * 1000);
  const subject = text(body, 'subject', { label: 'Temat', min: 4, max: 160, required: true });
  const category = oneOf(body, 'category', TICKET_CATEGORIES, 'pytanie');
  const priority = oneOf(body, 'priority', TICKET_PRIORITIES, 'normalny');
  const message = text(body, 'message', { label: 'Opis', min: 10, max: 5000, required: true });
  let projectId = null;
  if (body.projectId) {
    const p = q('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(Number(body.projectId), user.id);
    if (!p) throw new HttpError(422, 'Wybrany projekt nie istnieje.', { projectId: 'Niepoprawny' });
    projectId = p.id;
  }
  const id = tx(() => {
    const now = nowIso();
    const { lastInsertRowid } = q(`INSERT INTO tickets (user_id, project_id, subject, category, priority, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'nowe', ?, ?)`).run(user.id, projectId, subject, category, priority, now, now);
    const tid = Number(lastInsertRowid);
    q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'client', ?, ?, ?)`)
      .run(tid, user.name, message, now);
    q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'system', 'Modulio', ?, ?)`)
      .run(tid, `Dziękujemy! Zgłoszenie ${ticketNo(tid)} zostało przyjęte. Opiekun odpowie w tym wątku — powiadomimy Cię także e-mailem.`, new Date(Date.now() + 1000).toISOString());
    return tid;
  });
  return { id, number: ticketNo(id) };
}, { auth: true });

function getOwnTicket(user, id) {
  const t = q(`SELECT t.*, p.name AS project_name FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
               WHERE t.id = ? AND t.user_id = ?`).get(idParam(id), user.id);
  if (!t) throw new HttpError(404, 'Nie znaleziono zgłoszenia.');
  return t;
}

route('GET', '/api/tickets/:id', ({ user, params }) => {
  const t = getOwnTicket(user, params.id);
  return {
    ticket: mapTicket(t),
    messages: q(`SELECT id, author_type AS authorType, author_name AS authorName, body, created_at AS createdAt
                 FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, id`).all(t.id),
  };
}, { auth: true });

route('POST', '/api/tickets/:id/messages', ({ user, params, body }) => {
  limitOr429(`ticket-msg:${user.id}`, 60, 60 * 60 * 1000);
  const t = getOwnTicket(user, params.id);
  const message = text(body, 'message', { label: 'Wiadomość', min: 2, max: 5000, required: true });
  let status = t.status;
  if (['rozwiazane', 'zamkniete'].includes(status)) status = 'nowe';
  else if (status === 'oczekuje_na_klienta') status = 'w_toku';
  const now = nowIso();
  tx(() => {
    q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'client', ?, ?, ?)`)
      .run(t.id, user.name, message, now);
    q('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now, t.id);
  });
  return { ok: true, status };
}, { auth: true });

route('POST', '/api/tickets/:id/close', ({ user, params }) => {
  const t = getOwnTicket(user, params.id);
  q(`UPDATE tickets SET status = 'zamkniete', updated_at = ? WHERE id = ?`).run(nowIso(), t.id);
  q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'system', 'Modulio', ?, ?)`)
    .run(t.id, `Zgłoszenie zamknięte przez ${user.name}. Możesz je wznowić, odpisując w wątku.`, nowIso());
  return { ok: true };
}, { auth: true });

// ------------------------------------------------------------------
// Faktury i dokumenty
// ------------------------------------------------------------------
route('GET', '/api/invoices', ({ user }) => {
  const invoices = q(`SELECT i.*, p.name AS project_name FROM invoices i LEFT JOIN projects p ON p.id = i.project_id
                      WHERE i.user_id = ? ORDER BY i.issue_date DESC, i.id DESC`).all(user.id).map((i) => mapInvoice(i));
  const sum = (arr) => Math.round(arr.reduce((s, i) => s + i.gross, 0) * 100) / 100;
  return {
    invoices,
    summary: {
      paid: sum(invoices.filter((i) => i.status === 'oplacona')),
      pending: sum(invoices.filter((i) => i.status === 'oczekuje')),
      overdue: sum(invoices.filter((i) => i.status === 'po_terminie')),
    },
  };
}, { auth: true });

route('GET', '/api/invoices/:id', ({ user, params }) => {
  const inv = q(`SELECT i.*, p.name AS project_name FROM invoices i LEFT JOIN projects p ON p.id = i.project_id
                 WHERE i.id = ? AND i.user_id = ?`).get(idParam(params.id), user.id);
  if (!inv) throw new HttpError(404, 'Nie znaleziono faktury.');
  return {
    invoice: mapInvoice(inv, true),
    seller: config.company,
    buyer: { name: user.company || user.name, contact: user.name, email: user.email },
  };
}, { auth: true });

route('GET', '/api/documents', ({ user }) => ({
  documents: q(`SELECT d.*, p.name AS project_name FROM documents d LEFT JOIN projects p ON p.id = d.project_id
                WHERE d.user_id = ? ORDER BY d.created_at DESC`).all(user.id).map(mapDocument),
}), { auth: true });

route('GET', '/api/documents/:id/download', ({ user, params, res }) => {
  const d = q('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(idParam(params.id), user.id);
  if (!d) throw new HttpError(404, 'Nie znaleziono dokumentu.');
  const file = path.join(FILES_DIR, path.basename(d.stored_as));
  if (!fs.existsSync(file)) throw new HttpError(404, 'Plik nie jest już dostępny.');
  const ascii = d.filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'dokument';
  res.writeHead(200, {
    'Content-Type': d.mime,
    'Content-Length': fs.statSync(file).size,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
    'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(file).pipe(res);
}, { auth: true });

// ------------------------------------------------------------------
// Konto
// ------------------------------------------------------------------
route('PATCH', '/api/account', ({ user, body }) => {
  const name = text(body, 'name', { label: 'Imię i nazwisko', min: 2, max: 120, required: true });
  const company = text(body, 'company', { label: 'Firma', max: 160 });
  const phone = text(body, 'phone', { label: 'Telefon', max: 40 });
  q('UPDATE users SET name = ?, company = ?, phone = ? WHERE id = ?').run(name, company, phone, user.id);
  return { user: publicUser(q('SELECT * FROM users WHERE id = ?').get(user.id)) };
}, { auth: true });

route('POST', '/api/account/password', async ({ user, body, session }) => {
  limitOr429(`pw:${user.id}`, 6, 15 * 60 * 1000);
  const row = q('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!(await verifyPassword(String(body.current ?? ''), row.password_hash))) {
    throw new HttpError(422, 'Obecne hasło jest nieprawidłowe.', { current: 'Nieprawidłowe' });
  }
  const next = password(body, 'next');
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), user.id);
  q('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, session.sessionId);
  return { ok: true };
}, { auth: true });

route('GET', '/api/account/sessions', ({ user, session }) => ({
  sessions: q(`SELECT id, created_at AS createdAt, last_seen_at AS lastSeenAt, user_agent AS userAgent, ip
               FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`).all(user.id, nowIso())
    .map((s) => ({ ...s, current: s.id === session.sessionId })),
}), { auth: true });

route('DELETE', '/api/account/sessions', ({ user, session }) => {
  const r = q('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, session.sessionId);
  return { ok: true, removed: Number(r.changes) };
}, { auth: true });
