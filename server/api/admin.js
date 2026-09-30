// =====================================================================
//  API panelu zarządzania (/admin) — wymaga roli staff lub admin
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, tx, nowIso, today, FILES_DIR } from '../db/index.js';
import { HttpError, text, email, oneOf, password } from '../lib/http.js';
import { hashPassword, createSession, destroySession, publicUser, generatePassword } from '../lib/auth.js';
import { getSettings, setSettings, company } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { invoiceTotals, round2 } from '../lib/money.js';
import {
  route, idParam, STAGES, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, LEAD_STATUSES,
  SOFTWARE_STATUSES, DOC_CATEGORIES, ticketNo,
} from './router.js';
import { mapInvoice, mapProject, mapTicket, mapDocument, mapSoftware, mapLead, invoiceStatus } from './mappers.js';
import { streamDocument } from './client.js';

const S = { auth: 'staff' };
const A = { auth: 'admin' };
const ROLES = ['client', 'staff', 'admin'];
const PAYMENT_METHODS = ['przelew', 'karta', 'gotowka', 'blik', 'inne'];

const dateOrNull = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const num = (v, d = 0) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? d : Number(v));
const listStr = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
const like = (s) => `%${String(s || '').trim().replace(/[%_]/g, '')}%`;

function must(row, what = 'rekordu') { if (!row) throw new HttpError(404, `Nie znaleziono ${what}.`); return row; }
const getUser = (id) => must(q('SELECT * FROM users WHERE id = ?').get(idParam(id)), 'użytkownika');
const getProject = (id) => must(q('SELECT * FROM projects WHERE id = ?').get(idParam(id)), 'projektu');

function monthKeys(n) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}
const byMonth = (keys, rows, field = 'v') => keys.map((k) => ({ month: k, value: round2(rows.find((r) => r.m === k)?.[field] || 0) }));

// =====================================================================
// Pulpit
// =====================================================================
route('GET', '/api/admin/overview', () => {
  const month = today().slice(0, 7);
  const prevMonth = monthKeys(2)[0];
  const revenue = (m) => q(`SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE substr(paid_at,1,7) = ?`).get(m).v;
  const keys = monthKeys(12);

  const invoicesOpen = q(`SELECT i.*, u.name AS client_name, u.company AS client_company FROM invoices i JOIN users u ON u.id = i.user_id WHERE i.status = 'oczekuje' ORDER BY i.due_date`).all()
    .map((i) => ({ ...mapInvoice(i), clientName: i.client_company || i.client_name }));
  const overdue = invoicesOpen.filter((i) => i.status === 'po_terminie');

  const mrr = q(`SELECT COALESCE(SUM(monthly_fee),0) AS v, COUNT(*) AS c FROM software WHERE status = 'aktywne'`).get();
  const leadCounts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const r of q('SELECT status, COUNT(*) AS c FROM leads GROUP BY status').all()) leadCounts[r.status] = r.c;

  const ticketsWaiting = q(`SELECT t.*, u.name AS client_name,
      (SELECT author_type FROM ticket_messages m WHERE m.ticket_id = t.id AND m.author_type IN ('client','team') ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_author
    FROM tickets t JOIN users u ON u.id = t.user_id
    WHERE t.status IN ('nowe','w_toku') ORDER BY CASE t.priority WHEN 'krytyczny' THEN 0 WHEN 'wysoki' THEN 1 ELSE 2 END, t.updated_at LIMIT 8`).all().map(mapTicket);

  const renewals = q(`SELECT s.*, u.name AS client_name FROM software s JOIN users u ON u.id = s.user_id
    WHERE s.status = 'aktywne' AND s.renewal_date IS NOT NULL AND s.renewal_date <= date('now', '+30 day') ORDER BY s.renewal_date LIMIT 6`).all().map(mapSoftware);

  return {
    kpis: {
      revenueMonth: round2(revenue(month)),
      revenuePrev: round2(revenue(prevMonth)),
      mrr: round2(mrr.v), activeSoftware: mrr.c,
      clients: q(`SELECT COUNT(*) AS c FROM users WHERE role = 'client'`).get().c,
      newClients30: q(`SELECT COUNT(*) AS c FROM users WHERE role = 'client' AND created_at >= ?`).get(new Date(Date.now() - 30 * 864e5).toISOString()).c,
      openTickets: q(`SELECT COUNT(*) AS c FROM tickets WHERE status NOT IN ('rozwiazane','zamkniete')`).get().c,
      newLeads: leadCounts.nowy,
      toCollect: round2(invoicesOpen.reduce((s, i) => s + i.gross, 0)),
      overdueAmount: round2(overdue.reduce((s, i) => s + i.gross, 0)),
      overdueCount: overdue.length,
      projectsInProgress: q(`SELECT COUNT(*) AS c FROM projects WHERE stage IN ('analiza','projekt','wdrozenie','testy')`).get().c,
      projectsQueued: q(`SELECT COUNT(*) AS c FROM projects WHERE stage = 'do_zrobienia'`).get().c,
    },
    revenue12: byMonth(keys, q(`SELECT substr(paid_at,1,7) AS m, SUM(amount) AS v FROM payments GROUP BY m`).all()),
    users12: byMonth(keys, q(`SELECT substr(created_at,1,7) AS m, COUNT(*) AS v FROM users WHERE role = 'client' GROUP BY m`).all()),
    leadPipeline: LEAD_STATUSES.map((s) => ({ status: s, count: leadCounts[s] })),
    ticketsWaiting,
    overdue: overdue.slice(0, 6),
    renewals,
    activity: q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 12').all(),
  };
}, S);

// =====================================================================
// Statystyki
// =====================================================================
route('GET', '/api/admin/stats', ({ query }) => {
  const n = [3, 6, 12, 24].includes(Number(query.get('months'))) ? Number(query.get('months')) : 12;
  const keys = monthKeys(n);
  const from = `${keys[0]}-01`;

  const invoices = q(`SELECT * FROM invoices WHERE status != 'anulowana' AND issue_date >= ?`).all(from);
  const invoiced = keys.map((k) => ({ month: k, value: round2(invoices.filter((i) => i.issue_date.startsWith(k)).reduce((s, i) => s + invoiceTotals(JSON.parse(i.items), i.discount_pct).gross, 0)) }));

  const usersBefore = q(`SELECT COUNT(*) AS c FROM users WHERE role = 'client' AND created_at < ?`).get(from).c;
  const newUsers = byMonth(keys, q(`SELECT substr(created_at,1,7) AS m, COUNT(*) AS v FROM users WHERE role = 'client' GROUP BY m`).all());
  let acc = usersBefore;
  const totalUsers = newUsers.map((x) => ({ month: x.month, value: (acc += x.value) }));

  const leadsBySource = q(`SELECT CASE WHEN utm_source != '' THEN utm_source ELSE source END AS k, COUNT(*) AS c,
      SUM(CASE WHEN status = 'wygrany' THEN 1 ELSE 0 END) AS won FROM leads WHERE created_at >= ? GROUP BY k ORDER BY c DESC`).all(from);
  const leadsTotal = leadsBySource.reduce((s, r) => s + r.c, 0);
  const leadsWon = leadsBySource.reduce((s, r) => s + r.won, 0);

  const paidItems = new Map();
  for (const i of q(`SELECT items, discount_pct FROM invoices WHERE status = 'oplacona' AND issue_date >= ?`).all(from)) {
    for (const it of JSON.parse(i.items)) {
      const key = it.name.replace(/\s+[—-]\s+(miesiąc|etap).*$/i, '').slice(0, 60);
      paidItems.set(key, round2((paidItems.get(key) || 0) + it.qty * it.unit_net * (1 - (i.discount_pct || 0) / 100)));
    }
  }

  const revenue = byMonth(keys, q(`SELECT substr(paid_at,1,7) AS m, SUM(amount) AS v FROM payments GROUP BY m`).all());
  const totalRevenue = round2(revenue.reduce((s, r) => s + r.value, 0));
  const paymentsCount = q('SELECT COUNT(*) AS c FROM payments WHERE paid_at >= ?').get(from).c;

  return {
    months: n,
    revenue, invoiced, newUsers, totalUsers,
    newLeads: byMonth(keys, q(`SELECT substr(created_at,1,7) AS m, COUNT(*) AS v FROM leads GROUP BY m`).all()),
    summary: {
      totalRevenue,
      totalInvoiced: round2(invoiced.reduce((s, r) => s + r.value, 0)),
      avgPayment: paymentsCount ? round2(totalRevenue / paymentsCount) : 0,
      newClients: newUsers.reduce((s, r) => s + r.value, 0),
      leads: leadsTotal, leadsWon,
      conversion: leadsTotal ? round2((leadsWon / leadsTotal) * 100) : 0,
      mrr: round2(q(`SELECT COALESCE(SUM(monthly_fee),0) AS v FROM software WHERE status = 'aktywne'`).get().v),
      churned: q(`SELECT COUNT(*) AS c FROM software WHERE status IN ('zawieszone','wygasle')`).get().c,
    },
    leadsBySource: leadsBySource.map((r) => ({ source: r.k, count: r.c, won: r.won })),
    topClients: q(`SELECT u.id, u.name, u.company, SUM(p.amount) AS total, COUNT(p.id) AS payments
      FROM payments p JOIN users u ON u.id = p.user_id WHERE p.paid_at >= ? GROUP BY u.id ORDER BY total DESC LIMIT 10`).all(from)
      .map((r) => ({ ...r, total: round2(r.total) })),
    revenueByProduct: [...paidItems].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10),
    softwareByPlan: q(`SELECT plan, COUNT(*) AS count, SUM(monthly_fee) AS mrr FROM software WHERE status = 'aktywne' GROUP BY plan ORDER BY mrr DESC`).all(),
  };
}, S);

// =====================================================================
// Wyszukiwarka globalna i zespół
// =====================================================================
route('GET', '/api/admin/search', ({ query }) => {
  const s = String(query.get('q') || '').trim();
  if (s.length < 2) return { results: [] };
  const L = like(s);
  const results = [
    ...q(`SELECT id, name, email, company, role FROM users WHERE name LIKE ? OR email LIKE ? OR company LIKE ? LIMIT 5`).all(L, L, L)
      .map((u) => ({ type: 'user', id: u.id, title: u.name, sub: `${u.email}${u.company ? ' · ' + u.company : ''}`, href: `/admin/uzytkownicy/${u.id}` })),
    ...q(`SELECT id, name, email, status FROM leads WHERE name LIKE ? OR email LIKE ? OR company LIKE ? LIMIT 5`).all(L, L, L)
      .map((l) => ({ type: 'lead', id: l.id, title: l.name, sub: `${l.email} · ${l.status}`, href: `/admin/leady?id=${l.id}` })),
    ...q(`SELECT id, subject FROM tickets WHERE subject LIKE ? OR ('MOD-' || (1000 + id)) LIKE ? LIMIT 5`).all(L, L)
      .map((t) => ({ type: 'ticket', id: t.id, title: t.subject, sub: ticketNo(t.id), href: `/admin/zgloszenia/${t.id}` })),
    ...q(`SELECT id, name, stage FROM projects WHERE name LIKE ? LIMIT 5`).all(L)
      .map((p) => ({ type: 'project', id: p.id, title: p.name, sub: STAGES.find((x) => x.key === p.stage)?.label, href: `/admin/projekty/${p.id}` })),
    ...q(`SELECT id, number FROM invoices WHERE number LIKE ? LIMIT 5`).all(L)
      .map((i) => ({ type: 'invoice', id: i.id, title: i.number, sub: 'Faktura', href: `/admin/platnosci?invoice=${i.id}` })),
  ];
  return { results };
}, S);

route('GET', '/api/admin/team', () => ({
  team: q(`SELECT id, name, email, role FROM users WHERE role IN ('staff','admin') AND status = 'active' ORDER BY name`).all(),
}), S);

route('GET', '/api/admin/meta', () => ({
  stages: STAGES, ticketCategories: TICKET_CATEGORIES, ticketPriorities: TICKET_PRIORITIES, ticketStatuses: TICKET_STATUSES,
  leadStatuses: LEAD_STATUSES, softwareStatuses: SOFTWARE_STATUSES, docCategories: DOC_CATEGORIES, roles: ROLES, paymentMethods: PAYMENT_METHODS,
  clients: q(`SELECT id, name, company, email FROM users WHERE role = 'client' ORDER BY COALESCE(NULLIF(company,''), name)`).all(),
  projects: q(`SELECT id, name, user_id AS userId FROM projects ORDER BY created_at DESC`).all(),
  team: q(`SELECT id, name FROM users WHERE role IN ('staff','admin') AND status = 'active' ORDER BY name`).all(),
  counters: {
    newLeads: q(`SELECT COUNT(*) AS c FROM leads WHERE status = 'nowy'`).get().c,
    ticketsNew: q(`SELECT COUNT(*) AS c FROM tickets WHERE status IN ('nowe','w_toku')`).get().c,
    overdue: q(`SELECT COUNT(*) AS c FROM invoices WHERE status = 'oczekuje' AND due_date < ?`).get(today()).c,
    queued: q(`SELECT COUNT(*) AS c FROM projects WHERE stage = 'do_zrobienia'`).get().c,
  },
}), S);

// =====================================================================
// Użytkownicy
// =====================================================================
route('GET', '/api/admin/users', ({ query }) => {
  const where = [];
  const args = [];
  const s = query.get('q');
  if (s) { where.push('(u.name LIKE ? OR u.email LIKE ? OR u.company LIKE ? OR u.phone LIKE ?)'); args.push(like(s), like(s), like(s), like(s)); }
  if (ROLES.includes(query.get('role'))) { where.push('u.role = ?'); args.push(query.get('role')); }
  if (['active', 'blocked'].includes(query.get('status'))) { where.push('u.status = ?'); args.push(query.get('status')); }
  const rows = q(`SELECT u.*,
      (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
      (SELECT COUNT(*) FROM software s WHERE s.user_id = u.id AND s.status = 'aktywne') AS software,
      (SELECT COALESCE(SUM(monthly_fee),0) FROM software s WHERE s.user_id = u.id AND s.status = 'aktywne') AS mrr,
      (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.user_id = u.id) AS paid,
      (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id AND t.status NOT IN ('rozwiazane','zamkniete')) AS open_tickets
    FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.created_at DESC LIMIT 1000`).all(...args);
  return {
    users: rows.map((u) => ({ ...publicUser(u), projects: u.projects, software: u.software, mrr: round2(u.mrr), paid: round2(u.paid), openTickets: u.open_tickets })),
    counts: Object.fromEntries(q(`SELECT role, COUNT(*) AS c FROM users GROUP BY role`).all().map((r) => [r.role, r.c])),
  };
}, S);

function userInput(body, { isNew }) {
  const out = {
    name: text(body, 'name', { label: 'Imię i nazwisko', min: 2, max: 120, required: true }),
    email: email(body),
    company: text(body, 'company', { label: 'Firma', max: 160 }),
    nip: text(body, 'nip', { label: 'NIP', max: 20 }),
    phone: text(body, 'phone', { label: 'Telefon', max: 40 }),
    notes: text(body, 'notes', { label: 'Notatki', max: 4000 }),
    role: oneOf(body, 'role', ROLES, 'client'),
    status: oneOf(body, 'status', ['active', 'blocked'], 'active'),
  };
  if (isNew && body.password) out.password = password(body, 'password');
  return out;
}

route('POST', '/api/admin/users', async ({ req, user, body }) => {
  const d = userInput(body, { isNew: true });
  if (d.role !== 'client' && user.role !== 'admin') throw new HttpError(403, 'Tylko administrator może tworzyć konta zespołu.');
  if (q('SELECT 1 FROM users WHERE email = ?').get(d.email)) throw new HttpError(409, 'Użytkownik z tym e-mailem już istnieje.', { email: 'Zajęty' });
  const plain = d.password || generatePassword();
  const id = Number(q(`INSERT INTO users (email, password_hash, name, company, nip, phone, role, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.email, await hashPassword(plain), d.name, d.company, d.nip, d.phone, d.role, d.status, d.notes, nowIso()).lastInsertRowid);
  audit(req, user, 'user.created', 'user', id, `${d.email} (${d.role})`);
  return { id, password: d.password ? null : plain };
}, S);

route('GET', '/api/admin/users/:id', ({ params }) => {
  const u = getUser(params.id);
  return {
    user: { ...publicUser(u), notes: u.notes },
    projects: q('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(u.id).map(mapProject),
    software: q('SELECT * FROM software WHERE user_id = ? ORDER BY created_at DESC').all(u.id).map(mapSoftware),
    tickets: q('SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50').all(u.id).map(mapTicket),
    invoices: q(`SELECT i.*, (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id = i.id) AS paid_amount FROM invoices i WHERE i.user_id = ? ORDER BY issue_date DESC`).all(u.id).map((i) => mapInvoice(i)),
    payments: q('SELECT p.*, i.number FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.user_id = ? ORDER BY paid_at DESC').all(u.id),
    documents: q('SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC').all(u.id).map(mapDocument),
    sessions: q(`SELECT id, created_at AS createdAt, last_seen_at AS lastSeenAt, user_agent AS userAgent, ip, impersonator_id AS impersonatorId
      FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`).all(u.id, nowIso()),
    leads: q('SELECT id, status, topic, created_at AS createdAt FROM leads WHERE email = ? OR user_id = ? ORDER BY created_at DESC').all(u.email, u.id),
    activity: q(`SELECT * FROM audit_log WHERE (entity = 'user' AND entity_id = ?) OR user_id = ? ORDER BY id DESC LIMIT 30`).all(u.id, u.id),
  };
}, S);

route('PATCH', '/api/admin/users/:id', ({ req, user, params, body }) => {
  const u = getUser(params.id);
  const d = userInput({ ...u, ...body }, { isNew: false });
  if ((d.role !== u.role || (u.role !== 'client' && d.status !== u.status)) && user.role !== 'admin') throw new HttpError(403, 'Zmiana roli lub blokada konta zespołu wymaga roli administratora.');
  if (u.id === user.id && (d.role !== u.role || d.status !== 'active')) throw new HttpError(422, 'Nie możesz odebrać sobie uprawnień ani zablokować własnego konta.');
  if (d.email !== u.email && q('SELECT 1 FROM users WHERE email = ? AND id != ?').get(d.email, u.id)) throw new HttpError(409, 'Ten e-mail jest już zajęty.', { email: 'Zajęty' });
  q('UPDATE users SET name = ?, email = ?, company = ?, nip = ?, phone = ?, notes = ?, role = ?, status = ? WHERE id = ?')
    .run(d.name, d.email, d.company, d.nip, d.phone, d.notes, d.role, d.status, u.id);
  if (d.status === 'blocked') q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  const changes = ['name', 'email', 'company', 'nip', 'phone', 'role', 'status'].filter((k) => d[k] !== u[k]);
  audit(req, user, d.status !== u.status ? (d.status === 'blocked' ? 'user.blocked' : 'user.unblocked') : 'user.updated', 'user', u.id, changes.join(', '));
  return { ok: true };
}, S);

route('POST', '/api/admin/users/:id/password', async ({ req, user, params, body }) => {
  const u = getUser(params.id);
  if (u.role !== 'client' && user.role !== 'admin') throw new HttpError(403, 'Hasła zespołu zmienia tylko administrator.');
  const plain = body.password ? password(body, 'password') : generatePassword();
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(plain), u.id);
  if (body.logout !== false) q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  audit(req, user, 'user.password_reset', 'user', u.id);
  return { ok: true, password: body.password ? null : plain };
}, S);

route('POST', '/api/admin/users/:id/logout', ({ req, user, params }) => {
  const u = getUser(params.id);
  const r = q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  audit(req, user, 'user.sessions_revoked', 'user', u.id);
  return { ok: true, removed: Number(r.changes) };
}, S);

route('POST', '/api/admin/users/:id/impersonate', ({ req, res, user, params }) => {
  const u = getUser(params.id);
  if (u.role !== 'client') throw new HttpError(422, 'Podgląd jest dostępny tylko dla kont klientów.');
  audit(req, user, 'user.impersonation_start', 'user', u.id, u.email);
  destroySession(req, res);
  createSession(req, res, u.id, false, user.id);
  return { ok: true, redirect: '/panel' };
}, A);

route('DELETE', '/api/admin/users/:id', ({ req, user, params }) => {
  const u = getUser(params.id);
  if (u.id === user.id) throw new HttpError(422, 'Nie możesz usunąć własnego konta.');
  for (const d of q('SELECT stored_as FROM documents WHERE user_id = ?').all(u.id)) fs.rmSync(path.join(FILES_DIR, path.basename(d.stored_as)), { force: true });
  q('DELETE FROM users WHERE id = ?').run(u.id);
  audit(req, user, 'user.deleted', 'user', u.id, u.email);
  return { ok: true };
}, A);

// =====================================================================
// Projekty (oprogramowanie do zrobienia / w realizacji)
// =====================================================================
route('GET', '/api/admin/projects', () => ({
  stages: STAGES,
  projects: q(`SELECT p.*, COALESCE(NULLIF(u.company,''), u.name) AS client_name,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) AS milestones_total,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id AND m.done = 1) AS milestones_done,
      (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id AND t.status NOT IN ('rozwiazane','zamkniete')) AS open_tickets
    FROM projects p JOIN users u ON u.id = p.user_id ORDER BY p.due_date IS NULL, p.due_date`).all().map(mapProject),
}), S);

function projectInput(body) {
  return {
    user_id: must(q('SELECT id FROM users WHERE id = ?').get(num(body.userId)), 'klienta').id,
    name: text(body, 'name', { label: 'Nazwa', min: 2, max: 160, required: true }),
    kind: text(body, 'kind', { label: 'Typ', max: 80 }) || 'Pakiet Business',
    stage: oneOf(body, 'stage', STAGES.map((s) => s.key), 'do_zrobienia'),
    priority: oneOf(body, 'priority', TICKET_PRIORITIES, 'normalny'),
    progress: Math.max(0, Math.min(100, Math.round(num(body.progress)))),
    budget: Math.max(0, num(body.budget)),
    description: text(body, 'description', { label: 'Opis', max: 4000 }),
    modules: JSON.stringify(listStr(body.modules)),
    manager: text(body, 'manager', { label: 'Opiekun', max: 120 }),
    start_date: dateOrNull(body.startDate),
    due_date: dateOrNull(body.dueDate),
  };
}

route('POST', '/api/admin/projects', ({ req, user, body }) => {
  const d = projectInput(body);
  const id = Number(q(`INSERT INTO projects (user_id, name, kind, stage, priority, progress, budget, description, modules, manager, start_date, due_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.user_id, d.name, d.kind, d.stage, d.priority, d.progress, d.budget, d.description, d.modules, d.manager, d.start_date, d.due_date, nowIso()).lastInsertRowid);
  audit(req, user, 'project.created', 'project', id, d.name);
  return { id };
}, S);

route('GET', '/api/admin/projects/:id', ({ params }) => {
  const p = getProject(params.id);
  const c = q('SELECT id, name, company, email FROM users WHERE id = ?').get(p.user_id);
  return {
    stages: STAGES,
    project: { ...mapProject(p), clientName: c.company || c.name, clientEmail: c.email },
    milestones: q('SELECT id, title, due_date AS dueDate, done FROM milestones WHERE project_id = ? ORDER BY position, id').all(p.id).map((m) => ({ ...m, done: !!m.done })),
    updates: q('SELECT id, title, body, author, created_at AS createdAt FROM project_updates WHERE project_id = ? ORDER BY created_at DESC').all(p.id),
    tickets: q('SELECT * FROM tickets WHERE project_id = ? ORDER BY updated_at DESC').all(p.id).map(mapTicket),
    documents: q('SELECT * FROM documents WHERE project_id = ? ORDER BY created_at DESC').all(p.id).map(mapDocument),
    invoices: q('SELECT * FROM invoices WHERE project_id = ? ORDER BY issue_date DESC').all(p.id).map((i) => mapInvoice(i)),
    software: q('SELECT * FROM software WHERE project_id = ?').all(p.id).map(mapSoftware),
  };
}, S);

route('PATCH', '/api/admin/projects/:id', ({ req, user, params, body }) => {
  const p = getProject(params.id);
  const cur = mapProject(p);
  const d = projectInput({ ...cur, userId: p.user_id, ...body });
  q(`UPDATE projects SET user_id = ?, name = ?, kind = ?, stage = ?, priority = ?, progress = ?, budget = ?, description = ?, modules = ?, manager = ?, start_date = ?, due_date = ? WHERE id = ?`)
    .run(d.user_id, d.name, d.kind, d.stage, d.priority, d.progress, d.budget, d.description, d.modules, d.manager, d.start_date, d.due_date, p.id);
  if (d.stage !== p.stage) {
    const label = STAGES.find((s) => s.key === d.stage).label;
    if (body.notify !== false) q('INSERT INTO project_updates (project_id, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, `Nowy etap: ${label}`, `Projekt przeszedł do etapu „${label}”.`, d.manager || user.name, nowIso());
    audit(req, user, 'project.stage', 'project', p.id, `${p.stage} → ${d.stage}`);
  } else audit(req, user, 'project.updated', 'project', p.id, d.name);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/projects/:id', ({ req, user, params }) => {
  const p = getProject(params.id);
  q('DELETE FROM projects WHERE id = ?').run(p.id);
  audit(req, user, 'project.deleted', 'project', p.id, p.name);
  return { ok: true };
}, A);

route('POST', '/api/admin/projects/:id/milestones', ({ params, body }) => {
  const p = getProject(params.id);
  const { m } = q('SELECT COALESCE(MAX(position), -1) + 1 AS m FROM milestones WHERE project_id = ?').get(p.id);
  const id = Number(q('INSERT INTO milestones (project_id, title, due_date, position) VALUES (?, ?, ?, ?)')
    .run(p.id, text(body, 'title', { label: 'Tytuł', min: 2, max: 160, required: true }), dateOrNull(body.dueDate), m).lastInsertRowid);
  return { id };
}, S);

route('PATCH', '/api/admin/milestones/:id', ({ params, body }) => {
  const m = must(q('SELECT * FROM milestones WHERE id = ?').get(idParam(params.id)), 'etapu');
  q('UPDATE milestones SET title = ?, due_date = ?, done = ? WHERE id = ?').run(
    body.title !== undefined ? text(body, 'title', { label: 'Tytuł', min: 2, max: 160, required: true }) : m.title,
    body.dueDate !== undefined ? dateOrNull(body.dueDate) : m.due_date,
    body.done !== undefined ? (body.done ? 1 : 0) : m.done, m.id);
  // automatyczny postęp projektu wg ukończonych etapów
  if (body.done !== undefined && body.autoProgress !== false) {
    const { t, d } = q('SELECT COUNT(*) AS t, SUM(done) AS d FROM milestones WHERE project_id = ?').get(m.project_id);
    if (t) q('UPDATE projects SET progress = ? WHERE id = ?').run(Math.round(((d || 0) / t) * 100), m.project_id);
  }
  return { ok: true };
}, S);

route('DELETE', '/api/admin/milestones/:id', ({ params }) => {
  q('DELETE FROM milestones WHERE id = ?').run(idParam(params.id));
  return { ok: true };
}, S);

route('POST', '/api/admin/projects/:id/updates', ({ req, user, params, body }) => {
  const p = getProject(params.id);
  const id = Number(q('INSERT INTO project_updates (project_id, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(p.id, text(body, 'title', { label: 'Tytuł', min: 2, max: 160, required: true }), text(body, 'body', { label: 'Treść', max: 4000 }), text(body, 'author', { max: 120 }) || user.name, nowIso()).lastInsertRowid);
  audit(req, user, 'project.update_posted', 'project', p.id);
  return { id };
}, S);

route('DELETE', '/api/admin/updates/:id', ({ params }) => {
  q('DELETE FROM project_updates WHERE id = ?').run(idParam(params.id));
  return { ok: true };
}, S);

// =====================================================================
// Aktywne oprogramowanie
// =====================================================================
route('GET', '/api/admin/software', () => ({
  software: q(`SELECT s.*, COALESCE(NULLIF(u.company,''), u.name) AS client_name FROM software s JOIN users u ON u.id = s.user_id ORDER BY s.status, s.renewal_date`).all().map(mapSoftware),
}), S);

function softwareInput(body) {
  return {
    user_id: must(q('SELECT id FROM users WHERE id = ?').get(num(body.userId)), 'klienta').id,
    project_id: body.projectId ? num(body.projectId, null) : null,
    name: text(body, 'name', { label: 'Nazwa', min: 2, max: 160, required: true }),
    plan: text(body, 'plan', { label: 'Plan', max: 60 }) || 'Business',
    modules: JSON.stringify(listStr(body.modules)),
    monthly_fee: Math.max(0, num(body.monthlyFee)),
    users_limit: Math.max(1, Math.round(num(body.usersLimit, 10))),
    url: text(body, 'url', { label: 'Adres', max: 300 }),
    version: text(body, 'version', { label: 'Wersja', max: 30 }) || '1.0',
    status: oneOf(body, 'status', SOFTWARE_STATUSES, 'aktywne'),
    started_at: dateOrNull(body.startedAt) || today(),
    renewal_date: dateOrNull(body.renewalDate),
  };
}

route('POST', '/api/admin/software', ({ req, user, body }) => {
  const d = softwareInput(body);
  const id = Number(q(`INSERT INTO software (user_id, project_id, name, plan, modules, monthly_fee, users_limit, url, version, status, started_at, renewal_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.user_id, d.project_id, d.name, d.plan, d.modules, d.monthly_fee, d.users_limit, d.url, d.version, d.status, d.started_at, d.renewal_date, nowIso()).lastInsertRowid);
  audit(req, user, 'software.created', 'software', id, d.name);
  return { id };
}, S);

route('PATCH', '/api/admin/software/:id', ({ req, user, params, body }) => {
  const s = must(q('SELECT * FROM software WHERE id = ?').get(idParam(params.id)), 'oprogramowania');
  const d = softwareInput({ ...mapSoftware(s), ...body });
  q(`UPDATE software SET user_id = ?, project_id = ?, name = ?, plan = ?, modules = ?, monthly_fee = ?, users_limit = ?, url = ?, version = ?, status = ?, started_at = ?, renewal_date = ? WHERE id = ?`)
    .run(d.user_id, d.project_id, d.name, d.plan, d.modules, d.monthly_fee, d.users_limit, d.url, d.version, d.status, d.started_at, d.renewal_date, s.id);
  audit(req, user, d.status !== s.status ? `software.${d.status}` : 'software.updated', 'software', s.id, d.name);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/software/:id', ({ req, user, params }) => {
  q('DELETE FROM software WHERE id = ?').run(idParam(params.id));
  audit(req, user, 'software.deleted', 'software', Number(params.id));
  return { ok: true };
}, A);

// =====================================================================
// Zgłoszenia
// =====================================================================
route('GET', '/api/admin/tickets', () => ({
  tickets: q(`SELECT t.*, p.name AS project_name, COALESCE(NULLIF(u.company,''), u.name) AS client_name, u.email AS client_email, a.name AS assigned_name,
      (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages_count,
      (SELECT author_type FROM ticket_messages m WHERE m.ticket_id = t.id AND m.author_type IN ('client','team') ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_author
    FROM tickets t JOIN users u ON u.id = t.user_id LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users a ON a.id = t.assigned_to
    ORDER BY t.updated_at DESC LIMIT 1000`).all().map(mapTicket),
}), S);

route('GET', '/api/admin/tickets/:id', ({ params }) => {
  const t = must(q(`SELECT t.*, p.name AS project_name, COALESCE(NULLIF(u.company,''), u.name) AS client_name, u.email AS client_email, a.name AS assigned_name
    FROM tickets t JOIN users u ON u.id = t.user_id LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users a ON a.id = t.assigned_to WHERE t.id = ?`).get(idParam(params.id)), 'zgłoszenia');
  return {
    ticket: mapTicket(t),
    messages: q('SELECT id, author_type AS authorType, author_name AS authorName, body, created_at AS createdAt FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, id').all(t.id),
    otherTickets: q('SELECT * FROM tickets WHERE user_id = ? AND id != ? ORDER BY updated_at DESC LIMIT 5').all(t.user_id, t.id).map(mapTicket),
  };
}, S);

route('POST', '/api/admin/tickets/:id/reply', ({ req, user, params, body }) => {
  const t = must(q('SELECT * FROM tickets WHERE id = ?').get(idParam(params.id)), 'zgłoszenia');
  const message = text(body, 'message', { label: 'Wiadomość', min: 2, max: 8000, required: true });
  const internal = body.internal === true;
  const status = body.status ? oneOf(body, 'status', TICKET_STATUSES) : (internal ? t.status : 'oczekuje_na_klienta');
  const now = nowIso();
  tx(() => {
    q('INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)').run(t.id, internal ? 'internal' : 'team', user.name, message, now);
    q('UPDATE tickets SET status = ?, updated_at = ?, assigned_to = COALESCE(assigned_to, ?) WHERE id = ?').run(status, now, user.id, t.id);
  });
  audit(req, user, internal ? 'ticket.note' : 'ticket.reply', 'ticket', t.id);
  return { ok: true };
}, S);

route('PATCH', '/api/admin/tickets/:id', ({ req, user, params, body }) => {
  const t = must(q('SELECT * FROM tickets WHERE id = ?').get(idParam(params.id)), 'zgłoszenia');
  const status = body.status ? oneOf(body, 'status', TICKET_STATUSES) : t.status;
  const priority = body.priority ? oneOf(body, 'priority', TICKET_PRIORITIES) : t.priority;
  const assigned = body.assignedTo !== undefined ? (body.assignedTo ? num(body.assignedTo) : null) : t.assigned_to;
  q('UPDATE tickets SET status = ?, priority = ?, assigned_to = ?, updated_at = ? WHERE id = ?').run(status, priority, assigned, nowIso(), t.id);
  if (status !== t.status) {
    q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'system', 'Modulio', ?, ?)`)
      .run(t.id, `Status zmieniony: ${statusLabel(t.status)} → ${statusLabel(status)}`, nowIso());
  }
  audit(req, user, 'ticket.updated', 'ticket', t.id, `${status}/${priority}`);
  return { ok: true };
}, S);
const statusLabel = (s) => ({ nowe: 'Nowe', w_toku: 'W toku', oczekuje_na_klienta: 'Czeka na klienta', rozwiazane: 'Rozwiązane', zamkniete: 'Zamknięte' }[s] || s);

route('DELETE', '/api/admin/tickets/:id', ({ req, user, params }) => {
  q('DELETE FROM tickets WHERE id = ?').run(idParam(params.id));
  audit(req, user, 'ticket.deleted', 'ticket', Number(params.id));
  return { ok: true };
}, A);

// =====================================================================
// Płatności: faktury i wpłaty
// =====================================================================
route('GET', '/api/admin/invoices', () => ({
  invoices: q(`SELECT i.*, COALESCE(NULLIF(u.company,''), u.name) AS client_name, p.name AS project_name,
      (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.invoice_id = i.id) AS paid_amount
    FROM invoices i JOIN users u ON u.id = i.user_id LEFT JOIN projects p ON p.id = i.project_id
    ORDER BY i.issue_date DESC, i.id DESC LIMIT 2000`).all().map((i) => mapInvoice(i)),
}), S);

route('GET', '/api/admin/invoices/:id', ({ params }) => {
  const inv = must(q(`SELECT i.*, p.name AS project_name, (SELECT COALESCE(SUM(amount),0) FROM payments pm WHERE pm.invoice_id = i.id) AS paid_amount
    FROM invoices i LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ?`).get(idParam(params.id)), 'faktury');
  const u = q('SELECT * FROM users WHERE id = ?').get(inv.user_id);
  return {
    invoice: mapInvoice(inv, true),
    seller: company(),
    buyer: { name: u.company || u.name, contact: u.name, email: u.email, nip: u.nip },
    payments: q('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(inv.id),
  };
}, S);

function nextInvoiceNumber(date) {
  const prefix = `FV/${date.slice(0, 4)}/${date.slice(5, 7)}/`;
  let n = q('SELECT COUNT(*) AS c FROM invoices WHERE number LIKE ?').get(`${prefix}%`).c + 1;
  while (q('SELECT 1 FROM invoices WHERE number = ?').get(prefix + String(n).padStart(3, '0'))) n++;
  return prefix + String(n).padStart(3, '0');
}

function parseItems(items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(422, 'Dodaj co najmniej jedną pozycję faktury.');
  return items.slice(0, 50).map((it, i) => {
    const name = String(it.name || '').trim().slice(0, 200);
    if (!name) throw new HttpError(422, `Pozycja ${i + 1}: podaj nazwę.`);
    const qty = num(it.qty, 1), unit = num(it.unit_net ?? it.unitNet), vat = num(it.vat, 23);
    if (qty <= 0 || unit < 0) throw new HttpError(422, `Pozycja ${i + 1}: niepoprawna ilość lub cena.`);
    if (![0, 5, 8, 23].includes(vat)) throw new HttpError(422, `Pozycja ${i + 1}: stawka VAT musi wynosić 0, 5, 8 lub 23%.`);
    return { name, qty, unit_net: round2(unit), vat };
  });
}

route('POST', '/api/admin/invoices', ({ req, user, body }) => {
  const client = must(q('SELECT id FROM users WHERE id = ?').get(num(body.userId)), 'klienta');
  const items = parseItems(body.items);
  const issue = dateOrNull(body.issueDate) || today();
  const due = dateOrNull(body.dueDate) || new Date(Date.parse(issue) + num(getSettings().invoice_due_days, 14) * 864e5).toISOString().slice(0, 10);
  let pct = 0, code = '';
  if (body.discountCode) {
    const dc = q('SELECT * FROM discount_codes WHERE code = ?').get(String(body.discountCode).trim());
    if (!dc || !dc.active) throw new HttpError(422, 'Kod rabatowy nie istnieje lub jest nieaktywny.', { discountCode: 'Nieprawidłowy' });
    if (dc.expires_at && dc.expires_at < today()) throw new HttpError(422, 'Kod rabatowy wygasł.', { discountCode: 'Wygasł' });
    if (dc.max_uses && dc.used >= dc.max_uses) throw new HttpError(422, 'Limit użyć kodu został wyczerpany.', { discountCode: 'Wyczerpany' });
    pct = dc.percent; code = dc.code;
  }
  const number = body.number ? text(body, 'number', { max: 40 }) : nextInvoiceNumber(issue);
  const id = tx(() => {
    const r = q(`INSERT INTO invoices (user_id, project_id, number, issue_date, due_date, items, discount_code, discount_pct, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'oczekuje', ?)`).run(client.id, body.projectId ? num(body.projectId) : null, number, issue, due, JSON.stringify(items), code, pct, nowIso());
    if (code) q('UPDATE discount_codes SET used = used + 1 WHERE code = ?').run(code);
    return Number(r.lastInsertRowid);
  });
  audit(req, user, 'invoice.created', 'invoice', id, `${number} · ${invoiceTotals(items, pct).gross} zł`);
  return { id, number };
}, S);

route('PATCH', '/api/admin/invoices/:id', ({ req, user, params, body }) => {
  const inv = must(q('SELECT * FROM invoices WHERE id = ?').get(idParam(params.id)), 'faktury');
  const status = body.status ? oneOf(body, 'status', ['oczekuje', 'oplacona', 'anulowana']) : inv.status;
  const due = body.dueDate ? dateOrNull(body.dueDate) : inv.due_date;
  q('UPDATE invoices SET status = ?, due_date = ?, paid_at = ? WHERE id = ?').run(status, due, status === 'oplacona' ? (inv.paid_at || nowIso()) : null, inv.id);
  audit(req, user, `invoice.${status}`, 'invoice', inv.id, inv.number);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/invoices/:id', ({ req, user, params }) => {
  const inv = must(q('SELECT * FROM invoices WHERE id = ?').get(idParam(params.id)), 'faktury');
  q('DELETE FROM invoices WHERE id = ?').run(inv.id);
  audit(req, user, 'invoice.deleted', 'invoice', inv.id, inv.number);
  return { ok: true };
}, A);

route('GET', '/api/admin/payments', () => ({
  payments: q(`SELECT p.*, i.number, COALESCE(NULLIF(u.company,''), u.name) AS client_name
    FROM payments p JOIN users u ON u.id = p.user_id LEFT JOIN invoices i ON i.id = p.invoice_id ORDER BY p.paid_at DESC, p.id DESC LIMIT 2000`).all(),
}), S);

function syncInvoicePaid(invoiceId) {
  const inv = q('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.status === 'anulowana') return;
  const { gross } = invoiceTotals(JSON.parse(inv.items), inv.discount_pct);
  const paid = q('SELECT COALESCE(SUM(amount),0) AS s, MAX(paid_at) AS last FROM payments WHERE invoice_id = ?').get(invoiceId);
  if (paid.s >= gross - 0.01) q(`UPDATE invoices SET status = 'oplacona', paid_at = ? WHERE id = ?`).run(paid.last, invoiceId);
  else if (inv.status === 'oplacona') q(`UPDATE invoices SET status = 'oczekuje', paid_at = NULL WHERE id = ?`).run(invoiceId);
}

route('POST', '/api/admin/payments', ({ req, user, body }) => {
  let userId = num(body.userId, 0);
  let invoiceId = body.invoiceId ? num(body.invoiceId) : null;
  let amount = num(body.amount, NaN);
  if (invoiceId) {
    const inv = must(q('SELECT * FROM invoices WHERE id = ?').get(invoiceId), 'faktury');
    userId = inv.user_id;
    if (Number.isNaN(amount)) {
      const { gross } = invoiceTotals(JSON.parse(inv.items), inv.discount_pct);
      amount = round2(gross - q('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?').get(inv.id).s);
    }
  }
  must(q('SELECT id FROM users WHERE id = ?').get(userId), 'klienta');
  if (!(amount > 0)) throw new HttpError(422, 'Podaj kwotę wpłaty większą od zera.', { amount: 'Wymagane' });
  const id = tx(() => {
    const r = q('INSERT INTO payments (invoice_id, user_id, amount, method, paid_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(invoiceId, userId, round2(amount), oneOf(body, 'method', PAYMENT_METHODS, 'przelew'), dateOrNull(body.paidAt) || today(), text(body, 'note', { max: 300 }), nowIso());
    if (invoiceId) syncInvoicePaid(invoiceId);
    return Number(r.lastInsertRowid);
  });
  audit(req, user, 'payment.recorded', 'payment', id, `${round2(amount)} zł`);
  return { id };
}, S);

route('DELETE', '/api/admin/payments/:id', ({ req, user, params }) => {
  const p = must(q('SELECT * FROM payments WHERE id = ?').get(idParam(params.id)), 'wpłaty');
  tx(() => { q('DELETE FROM payments WHERE id = ?').run(p.id); if (p.invoice_id) syncInvoicePaid(p.invoice_id); });
  audit(req, user, 'payment.deleted', 'payment', p.id, `${p.amount} zł`);
  return { ok: true };
}, A);

// =====================================================================
// Dokumenty
// =====================================================================
route('GET', '/api/admin/documents', () => ({
  documents: q(`SELECT d.*, COALESCE(NULLIF(u.company,''), u.name) AS client_name, p.name AS project_name FROM documents d
    JOIN users u ON u.id = d.user_id LEFT JOIN projects p ON p.id = d.project_id ORDER BY d.created_at DESC`).all().map(mapDocument),
}), S);

const ALLOWED_EXT = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.zip': 'application/zip', '.txt': 'text/plain', '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

route('POST', '/api/admin/documents', ({ req, user, body }) => {
  const client = must(q('SELECT id FROM users WHERE id = ?').get(num(body.userId)), 'klienta');
  const filename = path.basename(String(body.filename || '')).slice(0, 180);
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT[ext]) throw new HttpError(422, `Niedozwolony typ pliku. Dozwolone: ${Object.keys(ALLOWED_EXT).join(', ')}`);
  const buf = Buffer.from(String(body.data || ''), 'base64');
  if (!buf.length) throw new HttpError(422, 'Plik jest pusty.');
  if (buf.length > 10 * 1024 * 1024) throw new HttpError(413, 'Maksymalny rozmiar pliku to 10 MB.');
  const stored = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(FILES_DIR, stored), buf);
  const id = Number(q(`INSERT INTO documents (user_id, project_id, name, category, filename, stored_as, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(client.id, body.projectId ? num(body.projectId) : null, text(body, 'name', { max: 160 }) || filename.replace(/\.[^.]+$/, ''), oneOf(body, 'category', DOC_CATEGORIES, 'inne'), filename, stored, ALLOWED_EXT[ext], buf.length, nowIso()).lastInsertRowid);
  audit(req, user, 'document.uploaded', 'document', id, filename);
  return { id };
}, { auth: 'staff', bodyLimit: 15 * 1024 * 1024 });

route('GET', '/api/admin/documents/:id/download', ({ params, res }) => {
  streamDocument(res, must(q('SELECT * FROM documents WHERE id = ?').get(idParam(params.id)), 'dokumentu'));
}, S);

route('DELETE', '/api/admin/documents/:id', ({ req, user, params }) => {
  const d = must(q('SELECT * FROM documents WHERE id = ?').get(idParam(params.id)), 'dokumentu');
  fs.rmSync(path.join(FILES_DIR, path.basename(d.stored_as)), { force: true });
  q('DELETE FROM documents WHERE id = ?').run(d.id);
  audit(req, user, 'document.deleted', 'document', d.id, d.filename);
  return { ok: true };
}, S);

// =====================================================================
// Leady (CRM)
// =====================================================================
route('GET', '/api/admin/leads', () => ({
  statuses: LEAD_STATUSES,
  leads: q(`SELECT l.*, a.name AS assigned_name FROM leads l LEFT JOIN users a ON a.id = l.assigned_to ORDER BY l.created_at DESC LIMIT 2000`).all().map(mapLead),
}), S);

route('POST', '/api/admin/leads', ({ req, user, body }) => {
  const id = Number(q(`INSERT INTO leads (name, email, phone, company, topic, message, source, status, value, notes, assigned_to, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    text(body, 'name', { label: 'Nazwa', min: 2, max: 120, required: true }), email(body), text(body, 'phone', { max: 40 }), text(body, 'company', { max: 160 }),
    text(body, 'topic', { max: 80 }) || 'Kontakt bezpośredni', text(body, 'message', { max: 5000 }) || '—', text(body, 'source', { max: 40 }) || 'reczny',
    oneOf(body, 'status', LEAD_STATUSES, 'nowy'), Math.max(0, num(body.value)), text(body, 'notes', { max: 4000 }), body.assignedTo ? num(body.assignedTo) : user.id, nowIso(), nowIso()).lastInsertRowid);
  audit(req, user, 'lead.created', 'lead', id);
  return { id };
}, S);

route('PATCH', '/api/admin/leads/:id', ({ req, user, params, body }) => {
  const l = must(q('SELECT * FROM leads WHERE id = ?').get(idParam(params.id)), 'leada');
  const status = body.status ? oneOf(body, 'status', LEAD_STATUSES) : l.status;
  q(`UPDATE leads SET name = ?, email = ?, phone = ?, company = ?, status = ?, value = ?, notes = ?, assigned_to = ?, updated_at = ? WHERE id = ?`).run(
    body.name !== undefined ? text(body, 'name', { min: 2, max: 120, required: true }) : l.name,
    body.email !== undefined ? email(body) : l.email,
    body.phone !== undefined ? text(body, 'phone', { max: 40 }) : l.phone,
    body.company !== undefined ? text(body, 'company', { max: 160 }) : l.company,
    status, body.value !== undefined ? Math.max(0, num(body.value)) : l.value,
    body.notes !== undefined ? text(body, 'notes', { max: 4000 }) : l.notes,
    body.assignedTo !== undefined ? (body.assignedTo ? num(body.assignedTo) : null) : l.assigned_to, nowIso(), l.id);
  audit(req, user, status !== l.status ? 'lead.status' : 'lead.updated', 'lead', l.id, status !== l.status ? `${l.status} → ${status}` : '');
  return { ok: true };
}, S);

route('POST', '/api/admin/leads/:id/convert', async ({ req, user, params, body }) => {
  const l = must(q('SELECT * FROM leads WHERE id = ?').get(idParam(params.id)), 'leada');
  let client = q('SELECT * FROM users WHERE email = ?').get(l.email);
  let plain = null;
  if (!client) {
    plain = generatePassword();
    const id = Number(q(`INSERT INTO users (email, password_hash, name, company, phone, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(l.email, await hashPassword(plain), l.name, l.company, l.phone, `Utworzony z leada #${l.id}`, nowIso()).lastInsertRowid);
    client = q('SELECT * FROM users WHERE id = ?').get(id);
  }
  let projectId = null;
  if (body.projectName) {
    projectId = Number(q(`INSERT INTO projects (user_id, name, kind, stage, budget, description, manager, created_at) VALUES (?, ?, ?, 'do_zrobienia', ?, ?, ?, ?)`)
      .run(client.id, String(body.projectName).slice(0, 160), String(body.kind || l.topic || 'Pakiet Business').slice(0, 80), l.value || 0, l.message.slice(0, 4000), user.name, nowIso()).lastInsertRowid);
  }
  q(`UPDATE leads SET status = 'wygrany', user_id = ?, updated_at = ? WHERE id = ?`).run(client.id, nowIso(), l.id);
  audit(req, user, 'lead.converted', 'lead', l.id, client.email);
  return { userId: client.id, password: plain, projectId, existing: !plain };
}, S);

route('DELETE', '/api/admin/leads/:id', ({ req, user, params }) => {
  q('DELETE FROM leads WHERE id = ?').run(idParam(params.id));
  audit(req, user, 'lead.deleted', 'lead', Number(params.id));
  return { ok: true };
}, S);

// =====================================================================
// Marketing: ogłoszenia, newsletter, kody rabatowe
// =====================================================================
route('GET', '/api/admin/marketing', () => ({
  announcements: q('SELECT * FROM announcements ORDER BY created_at DESC').all(),
  newsletter: q('SELECT * FROM newsletter ORDER BY created_at DESC').all(),
  codes: q('SELECT * FROM discount_codes ORDER BY created_at DESC').all(),
  sources: q(`SELECT CASE WHEN utm_source != '' THEN utm_source ELSE source END AS source, COUNT(*) AS leads,
      SUM(CASE WHEN status = 'wygrany' THEN 1 ELSE 0 END) AS won, SUM(value) AS value FROM leads GROUP BY 1 ORDER BY leads DESC`).all(),
}), S);

route('POST', '/api/admin/announcements', ({ req, user, body }) => {
  const id = Number(q('INSERT INTO announcements (title, body, tone, active, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    text(body, 'title', { label: 'Tytuł', min: 2, max: 140, required: true }), text(body, 'body', { max: 1000 }), oneOf(body, 'tone', ['info', 'success', 'warning'], 'info'),
    body.active === false ? 0 : 1, dateOrNull(body.startsAt), dateOrNull(body.endsAt), nowIso()).lastInsertRowid);
  audit(req, user, 'announcement.created', 'announcement', id);
  return { id };
}, S);

route('PATCH', '/api/admin/announcements/:id', ({ params, body }) => {
  const a = must(q('SELECT * FROM announcements WHERE id = ?').get(idParam(params.id)), 'ogłoszenia');
  q('UPDATE announcements SET title = ?, body = ?, tone = ?, active = ?, starts_at = ?, ends_at = ? WHERE id = ?').run(
    body.title !== undefined ? text(body, 'title', { min: 2, max: 140, required: true }) : a.title,
    body.body !== undefined ? text(body, 'body', { max: 1000 }) : a.body,
    body.tone ? oneOf(body, 'tone', ['info', 'success', 'warning']) : a.tone,
    body.active !== undefined ? (body.active ? 1 : 0) : a.active,
    body.startsAt !== undefined ? dateOrNull(body.startsAt) : a.starts_at,
    body.endsAt !== undefined ? dateOrNull(body.endsAt) : a.ends_at, a.id);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/announcements/:id', ({ params }) => { q('DELETE FROM announcements WHERE id = ?').run(idParam(params.id)); return { ok: true }; }, S);

route('DELETE', '/api/admin/newsletter/:id', ({ params }) => { q('DELETE FROM newsletter WHERE id = ?').run(idParam(params.id)); return { ok: true }; }, S);

route('POST', '/api/admin/codes', ({ req, user, body }) => {
  const code = text(body, 'code', { label: 'Kod', min: 3, max: 30, required: true }).toUpperCase().replace(/\s+/g, '');
  const percent = num(body.percent, NaN);
  if (!(percent > 0 && percent <= 100)) throw new HttpError(422, 'Rabat musi wynosić od 1 do 100%.', { percent: '1–100' });
  const id = Number(q('INSERT INTO discount_codes (code, percent, description, max_uses, active, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    code, percent, text(body, 'description', { max: 200 }), Math.max(0, Math.round(num(body.maxUses))), body.active === false ? 0 : 1, dateOrNull(body.expiresAt), nowIso()).lastInsertRowid);
  audit(req, user, 'code.created', 'code', id, code);
  return { id };
}, S);

route('PATCH', '/api/admin/codes/:id', ({ params, body }) => {
  const c = must(q('SELECT * FROM discount_codes WHERE id = ?').get(idParam(params.id)), 'kodu');
  q('UPDATE discount_codes SET active = ?, description = ?, max_uses = ?, expires_at = ? WHERE id = ?').run(
    body.active !== undefined ? (body.active ? 1 : 0) : c.active, body.description !== undefined ? text(body, 'description', { max: 200 }) : c.description,
    body.maxUses !== undefined ? Math.max(0, Math.round(num(body.maxUses))) : c.max_uses, body.expiresAt !== undefined ? dateOrNull(body.expiresAt) : c.expires_at, c.id);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/codes/:id', ({ params }) => { q('DELETE FROM discount_codes WHERE id = ?').run(idParam(params.id)); return { ok: true }; }, S);

// =====================================================================
// Ustawienia, dziennik, eksport
// =====================================================================
route('GET', '/api/admin/settings', () => ({ settings: getSettings() }), A);
route('PUT', '/api/admin/settings', ({ req, user, body }) => {
  const s = setSettings(body || {});
  audit(req, user, 'settings.updated', 'settings', null, Object.keys(body || {}).join(', '));
  return { settings: s };
}, A);

route('GET', '/api/admin/audit', ({ query }) => {
  const s = query.get('q');
  const rows = s
    ? q('SELECT * FROM audit_log WHERE action LIKE ? OR user_name LIKE ? OR details LIKE ? ORDER BY id DESC LIMIT 500').all(like(s), like(s), like(s))
    : q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all();
  return { entries: rows };
}, S);

const EXPORTS = {
  uzytkownicy: () => [q('SELECT * FROM users ORDER BY id').all(), [
    { label: 'ID', key: 'id' }, { label: 'E-mail', key: 'email' }, { label: 'Imię i nazwisko', key: 'name' }, { label: 'Firma', key: 'company' },
    { label: 'NIP', key: 'nip' }, { label: 'Telefon', key: 'phone' }, { label: 'Rola', key: 'role' }, { label: 'Status', key: 'status' },
    { label: 'Utworzono', key: 'created_at' }, { label: 'Ostatnie logowanie', key: 'last_login_at' }]],
  leady: () => [q('SELECT * FROM leads ORDER BY id').all(), [
    { label: 'ID', key: 'id' }, { label: 'Data', key: 'created_at' }, { label: 'Status', key: 'status' }, { label: 'Nazwa', key: 'name' }, { label: 'E-mail', key: 'email' },
    { label: 'Telefon', key: 'phone' }, { label: 'Firma', key: 'company' }, { label: 'Temat', key: 'topic' }, { label: 'Źródło', key: 'source' }, { label: 'Wartość', key: 'value' }, { label: 'Wiadomość', key: 'message' }]],
  faktury: () => [q(`SELECT i.*, COALESCE(NULLIF(u.company,''), u.name) AS client FROM invoices i JOIN users u ON u.id = i.user_id ORDER BY i.issue_date`).all(), [
    { label: 'Numer', key: 'number' }, { label: 'Klient', key: 'client' }, { label: 'Wystawiona', key: 'issue_date' }, { label: 'Termin', key: 'due_date' },
    { label: 'Status', get: (r) => invoiceStatus(r) }, { label: 'Netto', get: (r) => invoiceTotals(JSON.parse(r.items), r.discount_pct).net.toFixed(2).replace('.', ',') },
    { label: 'VAT', get: (r) => invoiceTotals(JSON.parse(r.items), r.discount_pct).vat.toFixed(2).replace('.', ',') },
    { label: 'Brutto', get: (r) => invoiceTotals(JSON.parse(r.items), r.discount_pct).gross.toFixed(2).replace('.', ',') }, { label: 'Kod rabatowy', key: 'discount_code' }]],
  wplaty: () => [q(`SELECT p.*, i.number, COALESCE(NULLIF(u.company,''), u.name) AS client FROM payments p JOIN users u ON u.id = p.user_id LEFT JOIN invoices i ON i.id = p.invoice_id ORDER BY p.paid_at`).all(), [
    { label: 'Data', key: 'paid_at' }, { label: 'Klient', key: 'client' }, { label: 'Faktura', key: 'number' }, { label: 'Kwota', get: (r) => r.amount.toFixed(2).replace('.', ',') },
    { label: 'Metoda', key: 'method' }, { label: 'Notatka', key: 'note' }]],
  newsletter: () => [q('SELECT * FROM newsletter WHERE unsubscribed_at IS NULL ORDER BY id').all(), [
    { label: 'E-mail', key: 'email' }, { label: 'Źródło', key: 'source' }, { label: 'Zapisano', key: 'created_at' }]],
  oprogramowanie: () => [q(`SELECT s.*, COALESCE(NULLIF(u.company,''), u.name) AS client FROM software s JOIN users u ON u.id = s.user_id ORDER BY s.id`).all(), [
    { label: 'Nazwa', key: 'name' }, { label: 'Klient', key: 'client' }, { label: 'Plan', key: 'plan' }, { label: 'Status', key: 'status' },
    { label: 'Abonament', get: (r) => r.monthly_fee.toFixed(2).replace('.', ',') }, { label: 'Odnowienie', key: 'renewal_date' }, { label: 'Adres', key: 'url' }]],
};

route('GET', '/api/admin/export/:type', ({ req, res, user, params }) => {
  const fn = EXPORTS[params.type];
  if (!fn) throw new HttpError(404, 'Nieznany typ eksportu.');
  const [rows, cols] = fn();
  const csv = toCsv(rows, cols);
  audit(req, user, 'export', params.type, null, `${rows.length} wierszy`);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="modulio-${params.type}-${today()}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.end(csv);
}, S);

// Wysyłka zbiorczego komunikatu jako ogłoszenia + opcjonalnie zgłoszenia systemowego do wszystkich aktywnych klientów
route('POST', '/api/admin/broadcast', ({ req, user, body }) => {
  const title = text(body, 'title', { label: 'Tytuł', min: 2, max: 140, required: true });
  const msg = text(body, 'message', { label: 'Treść', min: 5, max: 4000, required: true });
  const clients = q(`SELECT id FROM users WHERE role = 'client' AND status = 'active'`).all();
  const now = nowIso();
  tx(() => {
    for (const c of clients) {
      const tid = Number(q(`INSERT INTO tickets (user_id, subject, category, priority, status, assigned_to, created_at, updated_at) VALUES (?, ?, 'pytanie', 'normalny', 'oczekuje_na_klienta', ?, ?, ?)`)
        .run(c.id, title, user.id, now, now).lastInsertRowid);
      q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'team', ?, ?, ?)`).run(tid, user.name, msg, now);
    }
  });
  audit(req, user, 'broadcast.sent', 'broadcast', null, `${title} → ${clients.length} klientów`);
  return { ok: true, sent: clients.length };
}, A);

