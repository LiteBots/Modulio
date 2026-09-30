// API panelu klienta — każdy odczyt filtrowany po user_id zalogowanego klienta
import fs from 'node:fs';
import path from 'node:path';
import { q, tx, nowIso, FILES_DIR } from '../db/index.js';
import { HttpError, text, oneOf, password } from '../lib/http.js';
import { hashPassword, verifyPassword, publicUser } from '../lib/auth.js';
import { company } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { round2 } from '../lib/money.js';
import {
  route, idParam, limitOr429, STAGES, TICKET_CATEGORIES, TICKET_PRIORITIES, ticketNo,
} from './router.js';
import { mapInvoice, mapProject, mapTicket, mapDocument, mapSoftware } from './mappers.js';

const U = { auth: 'user' };

// ---------- Pulpit ----------
route('GET', '/api/dashboard', ({ user }) => {
  const projects = q(`SELECT p.*,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) AS milestones_total,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id AND m.done = 1) AS milestones_done
    FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(user.id).map(mapProject);

  const openTickets = q(`SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status NOT IN ('rozwiazane','zamkniete')`).get(user.id).c;
  const awaitingClient = q(`SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status = 'oczekuje_na_klienta'`).get(user.id).c;
  const invoices = q(`SELECT * FROM invoices WHERE user_id = ? AND status = 'oczekuje' ORDER BY due_date`).all(user.id).map((i) => mapInvoice(i));

  const milestones = q(`SELECT m.id, m.title, m.due_date, p.name AS project_name, p.id AS project_id
    FROM milestones m JOIN projects p ON p.id = m.project_id
    WHERE p.user_id = ? AND m.done = 0 ORDER BY (m.due_date IS NULL), m.due_date LIMIT 5`).all(user.id)
    .map((m) => ({ id: m.id, title: m.title, dueDate: m.due_date, projectId: m.project_id, projectName: m.project_name }));

  const activity = q(`
    SELECT * FROM (
      SELECT 'update' AS type, u.title AS title, u.body AS body, u.created_at AS at, p.id AS ref_id, p.name AS ref_name, u.author AS author
        FROM project_updates u JOIN projects p ON p.id = u.project_id WHERE p.user_id = ?
      UNION ALL
      SELECT 'ticket', t.subject, tm.body, tm.created_at, t.id, 'MOD-' || (1000 + t.id), tm.author_name
        FROM ticket_messages tm JOIN tickets t ON t.id = tm.ticket_id WHERE t.user_id = ? AND tm.author_type = 'team'
    ) ORDER BY at DESC LIMIT 8`).all(user.id, user.id)
    .map((a) => ({ type: a.type, title: a.title, body: a.body.slice(0, 220), at: a.at, refId: a.ref_id, refName: a.ref_name, author: a.author }));

  const software = q(`SELECT * FROM software WHERE user_id = ? ORDER BY created_at DESC`).all(user.id).map(mapSoftware);

  return {
    stats: {
      activeProjects: projects.filter((p) => !['uruchomiony', 'rozwoj'].includes(p.stage)).length,
      totalProjects: projects.length,
      openTickets, awaitingClient,
      invoicesToPay: invoices.length,
      amountToPay: round2(invoices.reduce((s, i) => s + i.gross, 0)),
      overdue: invoices.filter((i) => i.status === 'po_terminie').length,
      activeSoftware: software.filter((s) => s.status === 'aktywne').length,
    },
    projects: projects.slice(0, 4), milestones, activity, software,
    invoices: invoices.slice(0, 3),
  };
}, U);

route('GET', '/api/announcements', () => ({
  announcements: q(`SELECT id, title, body, tone, created_at AS createdAt FROM announcements
    WHERE active = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
    ORDER BY created_at DESC LIMIT 3`).all(nowIso().slice(0, 10), nowIso().slice(0, 10)),
}), U);

// ---------- Projekty ----------
route('GET', '/api/projects', ({ user }) => ({
  stages: STAGES,
  projects: q(`SELECT p.*,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) AS milestones_total,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id AND m.done = 1) AS milestones_done,
      (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id AND t.status NOT IN ('rozwiazane','zamkniete')) AS open_tickets
    FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(user.id).map(mapProject),
}), U);

route('GET', '/api/projects/:id', ({ user, params }) => {
  const p = q('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(idParam(params.id), user.id);
  if (!p) throw new HttpError(404, 'Nie znaleziono projektu.');
  return {
    stages: STAGES,
    project: mapProject(p),
    milestones: q('SELECT id, title, due_date AS dueDate, done FROM milestones WHERE project_id = ? ORDER BY position, id').all(p.id).map((m) => ({ ...m, done: !!m.done })),
    updates: q('SELECT id, title, body, author, created_at AS createdAt FROM project_updates WHERE project_id = ? ORDER BY created_at DESC').all(p.id),
    documents: q('SELECT * FROM documents WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC').all(p.id, user.id).map(mapDocument),
    tickets: q('SELECT * FROM tickets WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC').all(p.id, user.id).map(mapTicket),
  };
}, U);

// ---------- Zgłoszenia ----------
route('GET', '/api/tickets', ({ user }) => ({
  tickets: q(`SELECT t.*, p.name AS project_name,
      (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.author_type != 'internal') AS messages_count,
      (SELECT author_type FROM ticket_messages m WHERE m.ticket_id = t.id AND m.author_type != 'internal' ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_author
    FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.user_id = ? ORDER BY t.updated_at DESC`).all(user.id).map(mapTicket),
  projects: q('SELECT id, name FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(user.id),
}), U);

route('POST', '/api/tickets', ({ req, user, body }) => {
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
    const tid = Number(q(`INSERT INTO tickets (user_id, project_id, subject, category, priority, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'nowe', ?, ?)`).run(user.id, projectId, subject, category, priority, now, now).lastInsertRowid);
    q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'client', ?, ?, ?)`).run(tid, user.name, message, now);
    q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'system', 'Modulio', ?, ?)`)
      .run(tid, `Dziękujemy! Zgłoszenie ${ticketNo(tid)} zostało przyjęte. Opiekun odpowie w tym wątku.`, new Date(Date.now() + 1000).toISOString());
    return tid;
  });
  audit(req, user, 'ticket.created', 'ticket', id, subject);
  return { id, number: ticketNo(id) };
}, U);

function ownTicket(user, id) {
  const t = q(`SELECT t.*, p.name AS project_name FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
               WHERE t.id = ? AND t.user_id = ?`).get(idParam(id), user.id);
  if (!t) throw new HttpError(404, 'Nie znaleziono zgłoszenia.');
  return t;
}

route('GET', '/api/tickets/:id', ({ user, params }) => {
  const t = ownTicket(user, params.id);
  return {
    ticket: mapTicket(t),
    messages: q(`SELECT id, author_type AS authorType, author_name AS authorName, body, created_at AS createdAt
                 FROM ticket_messages WHERE ticket_id = ? AND author_type != 'internal' ORDER BY created_at, id`).all(t.id),
  };
}, U);

route('POST', '/api/tickets/:id/messages', ({ user, params, body }) => {
  limitOr429(`ticket-msg:${user.id}`, 60, 60 * 60 * 1000);
  const t = ownTicket(user, params.id);
  const message = text(body, 'message', { label: 'Wiadomość', min: 2, max: 5000, required: true });
  let status = t.status;
  if (['rozwiazane', 'zamkniete'].includes(status)) status = 'nowe';
  else if (status === 'oczekuje_na_klienta') status = 'w_toku';
  const now = nowIso();
  tx(() => {
    q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'client', ?, ?, ?)`).run(t.id, user.name, message, now);
    q('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now, t.id);
  });
  return { ok: true, status };
}, U);

route('POST', '/api/tickets/:id/close', ({ user, params }) => {
  const t = ownTicket(user, params.id);
  q(`UPDATE tickets SET status = 'zamkniete', updated_at = ? WHERE id = ?`).run(nowIso(), t.id);
  q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'system', 'Modulio', ?, ?)`)
    .run(t.id, `Zgłoszenie zamknięte przez ${user.name}. Możesz je wznowić, odpisując w wątku.`, nowIso());
  return { ok: true };
}, U);

// ---------- Faktury, dokumenty, oprogramowanie ----------
route('GET', '/api/invoices', ({ user }) => {
  const invoices = q(`SELECT i.*, p.name AS project_name FROM invoices i LEFT JOIN projects p ON p.id = i.project_id
                      WHERE i.user_id = ? AND i.status != 'anulowana' ORDER BY i.issue_date DESC, i.id DESC`).all(user.id).map((i) => mapInvoice(i));
  const sum = (arr) => round2(arr.reduce((s, i) => s + i.gross, 0));
  return {
    invoices,
    summary: {
      paid: sum(invoices.filter((i) => i.status === 'oplacona')),
      pending: sum(invoices.filter((i) => i.status === 'oczekuje')),
      overdue: sum(invoices.filter((i) => i.status === 'po_terminie')),
    },
  };
}, U);

route('GET', '/api/invoices/:id', ({ user, params }) => {
  const inv = q(`SELECT i.*, p.name AS project_name FROM invoices i LEFT JOIN projects p ON p.id = i.project_id
                 WHERE i.id = ? AND i.user_id = ?`).get(idParam(params.id), user.id);
  if (!inv) throw new HttpError(404, 'Nie znaleziono faktury.');
  return {
    invoice: mapInvoice(inv, true),
    seller: company(),
    buyer: { name: user.company || user.name, contact: user.name, email: user.email, nip: user.nip },
  };
}, U);

route('GET', '/api/documents', ({ user }) => ({
  documents: q(`SELECT d.*, p.name AS project_name FROM documents d LEFT JOIN projects p ON p.id = d.project_id
                WHERE d.user_id = ? ORDER BY d.created_at DESC`).all(user.id).map(mapDocument),
}), U);

export function streamDocument(res, d) {
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
}

route('GET', '/api/documents/:id/download', ({ user, params, res }) => {
  const d = q('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(idParam(params.id), user.id);
  if (!d) throw new HttpError(404, 'Nie znaleziono dokumentu.');
  streamDocument(res, d);
}, U);

// ---------- Konto ----------
route('PATCH', '/api/account', ({ req, user, body }) => {
  const name = text(body, 'name', { label: 'Imię i nazwisko', min: 2, max: 120, required: true });
  const companyName = text(body, 'company', { label: 'Firma', max: 160 });
  const phone = text(body, 'phone', { label: 'Telefon', max: 40 });
  const nip = text(body, 'nip', { label: 'NIP', max: 20 });
  q('UPDATE users SET name = ?, company = ?, phone = ?, nip = ? WHERE id = ?').run(name, companyName, phone, nip, user.id);
  audit(req, user, 'account.updated', 'user', user.id);
  return { user: publicUser(q('SELECT * FROM users WHERE id = ?').get(user.id)) };
}, U);

route('POST', '/api/account/password', async ({ req, user, body, session }) => {
  limitOr429(`pw:${user.id}`, 6, 15 * 60 * 1000);
  const row = q('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!(await verifyPassword(String(body.current ?? ''), row.password_hash))) {
    throw new HttpError(422, 'Obecne hasło jest nieprawidłowe.', { current: 'Nieprawidłowe' });
  }
  const next = password(body, 'next');
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), user.id);
  q('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, session.sessionId);
  audit(req, user, 'account.password_changed', 'user', user.id);
  return { ok: true };
}, U);

route('GET', '/api/account/sessions', ({ user, session }) => ({
  sessions: q(`SELECT id, created_at AS createdAt, last_seen_at AS lastSeenAt, user_agent AS userAgent, ip
               FROM sessions WHERE user_id = ? AND expires_at > ? AND impersonator_id IS NULL ORDER BY last_seen_at DESC`).all(user.id, nowIso())
    .map((s) => ({ ...s, current: s.id === session.sessionId })),
}), U);

route('DELETE', '/api/account/sessions', ({ user, session }) => {
  const r = q('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, session.sessionId);
  return { ok: true, removed: Number(r.changes) };
}, U);
