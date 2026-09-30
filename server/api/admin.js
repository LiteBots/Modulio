// =====================================================================
//  API panelu zarządzania (/admin) — wymaga roli staff lub admin
// =====================================================================
import path from 'node:path';
import crypto from 'node:crypto';
import {
  insert, findAll, findOne, update, remove, removeMany, count, mapById, saveFile, deleteFile, nowIso, today,
} from '../db/index.js';
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
import { mapInvoice, mapProject, mapTicket, mapDocument, mapSoftware, mapLead, invoiceStatus, itemsOf, totalsOf } from './mappers.js';
import { streamDocument } from './client.js';
import { newUserDoc } from './public.js';

const S = { auth: 'staff' };
const A = { auth: 'admin' };
const ROLES = ['client', 'staff', 'admin'];
const PAYMENT_METHODS = ['przelew', 'karta', 'gotowka', 'blik', 'inne'];
const OPEN = { $nin: ['rozwiazane', 'zamkniete'] };

const dateOrNull = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const num = (v, d = 0) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? d : Number(v));
const listStr = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
const escRe = (s) => String(s || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rx = (s) => new RegExp(escRe(s), 'i');
const clientName = (u) => (u ? u.company || u.name : '—');

function must(row, what = 'rekordu') { if (!row) throw new HttpError(404, `Nie znaleziono ${what}.`); return row; }
const getUser = async (id) => must(await findOne('users', { id: idParam(id) }), 'użytkownika');
const getProject = async (id) => must(await findOne('projects', { id: idParam(id) }), 'projektu');

function monthKeys(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}
/** Sumuje wartości wg miesiąca (klucz YYYY-MM z pola daty). */
const byMonth = (keys, rows, dateField, valueFn = () => 1) => keys.map((k) => ({
  month: k, value: round2(rows.filter((r) => String(r[dateField] || '').startsWith(k)).reduce((s, r) => s + valueFn(r), 0)),
}));

// =====================================================================
// Pulpit
// =====================================================================
route('GET', '/api/admin/overview', async () => {
  const keys = monthKeys(12);
  const month = keys[11], prevMonth = keys[10];
  const [payments, users, software, leads, tickets, invoicesOpen, projects, activity] = await Promise.all([
    findAll('payments'), findAll('users', { role: 'client' }), findAll('software'), findAll('leads'),
    findAll('tickets', { status: OPEN }), findAll('invoices', { status: 'oczekuje' }, { sort: { due_date: 1 } }),
    findAll('projects'), findAll('audit_log', {}, { sort: { id: -1 }, limit: 12 }),
  ]);
  const usersAll = await mapById('users');
  const revenue = (m) => payments.filter((p) => p.paid_at.startsWith(m)).reduce((s, p) => s + p.amount, 0);
  const openInv = invoicesOpen.map((i) => ({ ...mapInvoice(i), clientName: clientName(usersAll.get(i.user_id)) }));
  const overdue = openInv.filter((i) => i.status === 'po_terminie');
  const active = software.filter((s) => s.status === 'aktywne');
  const mrr = active.reduce((s, x) => s + x.monthly_fee, 0);
  const leadCounts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, leads.filter((l) => l.status === s).length]));

  const prio = (p) => ({ krytyczny: 0, wysoki: 1 }[p] ?? 2);
  const waitingRaw = tickets.filter((t) => ['nowe', 'w_toku'].includes(t.status))
    .sort((a, b) => prio(a.priority) - prio(b.priority) || a.updated_at.localeCompare(b.updated_at)).slice(0, 8);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();

  return {
    kpis: {
      revenueMonth: round2(revenue(month)), revenuePrev: round2(revenue(prevMonth)),
      mrr: round2(mrr), activeSoftware: active.length,
      clients: users.length, newClients30: users.filter((u) => u.created_at >= since30).length,
      openTickets: tickets.length, newLeads: leadCounts.nowy,
      toCollect: round2(openInv.reduce((s, i) => s + i.gross, 0)),
      overdueAmount: round2(overdue.reduce((s, i) => s + i.gross, 0)), overdueCount: overdue.length,
      projectsInProgress: projects.filter((p) => ['analiza', 'projekt', 'wdrozenie', 'testy'].includes(p.stage)).length,
      projectsQueued: projects.filter((p) => p.stage === 'do_zrobienia').length,
    },
    revenue12: byMonth(keys, payments, 'paid_at', (p) => p.amount),
    users12: byMonth(keys, users, 'created_at'),
    leadPipeline: LEAD_STATUSES.map((s) => ({ status: s, count: leadCounts[s] })),
    ticketsWaiting: waitingRaw.map((t) => mapTicket({ ...t, client_name: clientName(usersAll.get(t.user_id)) })),
    overdue: overdue.slice(0, 6),
    renewals: active.filter((s) => s.renewal_date && s.renewal_date <= in30).sort((a, b) => a.renewal_date.localeCompare(b.renewal_date)).slice(0, 6)
      .map((s) => mapSoftware({ ...s, client_name: usersAll.get(s.user_id)?.name })),
    activity,
  };
}, S);

// =====================================================================
// Statystyki
// =====================================================================
route('GET', '/api/admin/stats', async ({ query }) => {
  const n = [3, 6, 12, 24].includes(Number(query.get('months'))) ? Number(query.get('months')) : 12;
  const keys = monthKeys(n);
  const from = `${keys[0]}-01`;
  const [invoices, clients, leadsAll, payments, software, usersAll] = await Promise.all([
    findAll('invoices', { status: { $ne: 'anulowana' } }), findAll('users', { role: 'client' }), findAll('leads'),
    findAll('payments'), findAll('software'), mapById('users'),
  ]);
  const invoicesIn = invoices.filter((i) => i.issue_date >= from);
  const invoiced = byMonth(keys, invoicesIn, 'issue_date', (i) => totalsOf(i).gross);
  const newUsers = byMonth(keys, clients, 'created_at');
  let acc = clients.filter((u) => u.created_at < from).length;
  const totalUsers = newUsers.map((x) => ({ month: x.month, value: (acc += x.value) }));

  const leads = leadsAll.filter((l) => l.created_at >= from);
  const srcMap = new Map();
  for (const l of leads) {
    const k = l.utm_source || l.source;
    const r = srcMap.get(k) || { source: k, count: 0, won: 0 };
    r.count++; if (l.status === 'wygrany') r.won++;
    srcMap.set(k, r);
  }
  const leadsBySource = [...srcMap.values()].sort((a, b) => b.count - a.count);
  const leadsWon = leads.filter((l) => l.status === 'wygrany').length;

  const paidItems = new Map();
  for (const i of invoicesIn.filter((x) => x.status === 'oplacona')) {
    for (const it of itemsOf(i)) {
      const key = it.name.replace(/\s+[—-]\s+(miesiąc|etap).*$/i, '').slice(0, 60);
      paidItems.set(key, round2((paidItems.get(key) || 0) + it.qty * it.unit_net * (1 - (i.discount_pct || 0) / 100)));
    }
  }
  const paymentsIn = payments.filter((p) => p.paid_at >= from);
  const revenue = byMonth(keys, paymentsIn, 'paid_at', (p) => p.amount);
  const totalRevenue = round2(revenue.reduce((s, r) => s + r.value, 0));

  const top = new Map();
  for (const p of paymentsIn) {
    const r = top.get(p.user_id) || { id: p.user_id, total: 0, payments: 0 };
    r.total += p.amount; r.payments++;
    top.set(p.user_id, r);
  }
  const active = software.filter((s) => s.status === 'aktywne');
  const plans = new Map();
  for (const s of active) { const r = plans.get(s.plan) || { plan: s.plan, count: 0, mrr: 0 }; r.count++; r.mrr += s.monthly_fee; plans.set(s.plan, r); }

  return {
    months: n, revenue, invoiced, newUsers, totalUsers,
    newLeads: byMonth(keys, leadsAll, 'created_at'),
    summary: {
      totalRevenue,
      totalInvoiced: round2(invoiced.reduce((s, r) => s + r.value, 0)),
      avgPayment: paymentsIn.length ? round2(totalRevenue / paymentsIn.length) : 0,
      newClients: newUsers.reduce((s, r) => s + r.value, 0),
      leads: leads.length, leadsWon,
      conversion: leads.length ? round2((leadsWon / leads.length) * 100) : 0,
      mrr: round2(active.reduce((s, x) => s + x.monthly_fee, 0)),
      churned: software.filter((s) => ['zawieszone', 'wygasle'].includes(s.status)).length,
    },
    leadsBySource,
    topClients: [...top.values()].sort((a, b) => b.total - a.total).slice(0, 10)
      .map((r) => ({ ...r, total: round2(r.total), name: usersAll.get(r.id)?.name || '—', company: usersAll.get(r.id)?.company || '' })),
    revenueByProduct: [...paidItems].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10),
    softwareByPlan: [...plans.values()].sort((a, b) => b.mrr - a.mrr),
  };
}, S);

// =====================================================================
// Wyszukiwarka globalna, zespół, słowniki
// =====================================================================
route('GET', '/api/admin/search', async ({ query }) => {
  const s = String(query.get('q') || '').trim();
  if (s.length < 2) return { results: [] };
  const r = rx(s);
  const numMatch = s.match(/(\d{4,})/);
  const [users, leads, tickets, projects, invoices] = await Promise.all([
    findAll('users', { $or: [{ name: r }, { email: r }, { company: r }] }, { limit: 5 }),
    findAll('leads', { $or: [{ name: r }, { email: r }, { company: r }] }, { limit: 5 }),
    findAll('tickets', numMatch ? { $or: [{ subject: r }, { id: Number(numMatch[1]) - 1000 }] } : { subject: r }, { limit: 5 }),
    findAll('projects', { name: r }, { limit: 5 }),
    findAll('invoices', { number: r }, { limit: 5 }),
  ]);
  return {
    results: [
      ...users.map((u) => ({ type: 'user', id: u.id, title: u.name, sub: `${u.email}${u.company ? ' · ' + u.company : ''}`, href: `/admin/uzytkownicy/${u.id}` })),
      ...leads.map((l) => ({ type: 'lead', id: l.id, title: l.name, sub: `${l.email} · ${l.status}`, href: `/admin/leady?id=${l.id}` })),
      ...tickets.map((t) => ({ type: 'ticket', id: t.id, title: t.subject, sub: ticketNo(t.id), href: `/admin/zgloszenia/${t.id}` })),
      ...projects.map((p) => ({ type: 'project', id: p.id, title: p.name, sub: STAGES.find((x) => x.key === p.stage)?.label, href: `/admin/projekty/${p.id}` })),
      ...invoices.map((i) => ({ type: 'invoice', id: i.id, title: i.number, sub: 'Faktura', href: `/admin/platnosci?invoice=${i.id}` })),
    ],
  };
}, S);

const teamList = async () => (await findAll('users', { role: { $in: ['staff', 'admin'] }, status: 'active' }, { sort: { name: 1 } }))
  .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));

route('GET', '/api/admin/team', async () => ({ team: await teamList() }), S);

route('GET', '/api/admin/meta', async () => {
  const [clients, projects, team, newLeads, ticketsNew, overdue, queued] = await Promise.all([
    findAll('users', { role: 'client' }), findAll('projects', {}, { sort: { created_at: -1 } }), teamList(),
    count('leads', { status: 'nowy' }), count('tickets', { status: { $in: ['nowe', 'w_toku'] } }),
    count('invoices', { status: 'oczekuje', due_date: { $lt: today() } }), count('projects', { stage: 'do_zrobienia' }),
  ]);
  return {
    stages: STAGES, ticketCategories: TICKET_CATEGORIES, ticketPriorities: TICKET_PRIORITIES, ticketStatuses: TICKET_STATUSES,
    leadStatuses: LEAD_STATUSES, softwareStatuses: SOFTWARE_STATUSES, docCategories: DOC_CATEGORIES, roles: ROLES, paymentMethods: PAYMENT_METHODS,
    clients: clients.map((c) => ({ id: c.id, name: c.name, company: c.company, email: c.email }))
      .sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name, 'pl')),
    projects: projects.map((p) => ({ id: p.id, name: p.name, userId: p.user_id })),
    team: team.map((t) => ({ id: t.id, name: t.name })),
    counters: { newLeads, ticketsNew, overdue, queued },
  };
}, S);

// =====================================================================
// Użytkownicy
// =====================================================================
route('GET', '/api/admin/users', async ({ query }) => {
  const filter = {};
  const s = query.get('q');
  if (s) filter.$or = [{ name: rx(s) }, { email: rx(s) }, { company: rx(s) }, { phone: rx(s) }];
  if (ROLES.includes(query.get('role'))) filter.role = query.get('role');
  if (['active', 'blocked'].includes(query.get('status'))) filter.status = query.get('status');
  const [users, projects, software, payments, tickets, all] = await Promise.all([
    findAll('users', filter, { sort: { created_at: -1 }, limit: 1000 }), findAll('projects'), findAll('software', { status: 'aktywne' }),
    findAll('payments'), findAll('tickets', { status: OPEN }), findAll('users'),
  ]);
  const by = (arr, id) => arr.filter((x) => x.user_id === id);
  const counts = {};
  for (const u of all) counts[u.role] = (counts[u.role] || 0) + 1;
  return {
    users: users.map((u) => ({
      ...publicUser(u), projects: by(projects, u.id).length, software: by(software, u.id).length,
      mrr: round2(by(software, u.id).reduce((a, x) => a + x.monthly_fee, 0)), paid: round2(by(payments, u.id).reduce((a, x) => a + x.amount, 0)),
      openTickets: by(tickets, u.id).length,
    })),
    counts,
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
  if (await findOne('users', { email: d.email })) throw new HttpError(409, 'Użytkownik z tym e-mailem już istnieje.', { email: 'Zajęty' });
  const plain = d.password || generatePassword();
  const u = await insert('users', newUserDoc({ ...d, password_hash: await hashPassword(plain) }));
  audit(req, user, 'user.created', 'user', u.id, `${d.email} (${d.role})`);
  return { id: u.id, password: d.password ? null : plain };
}, S);

route('GET', '/api/admin/users/:id', async ({ params }) => {
  const u = await getUser(params.id);
  const [projects, software, tickets, invoices, payments, documents, sessions, leads, activity] = await Promise.all([
    findAll('projects', { user_id: u.id }, { sort: { created_at: -1 } }),
    findAll('software', { user_id: u.id }, { sort: { created_at: -1 } }),
    findAll('tickets', { user_id: u.id }, { sort: { updated_at: -1 }, limit: 50 }),
    findAll('invoices', { user_id: u.id }, { sort: { issue_date: -1 } }),
    findAll('payments', { user_id: u.id }, { sort: { paid_at: -1 } }),
    findAll('documents', { user_id: u.id }, { sort: { created_at: -1 } }),
    findAll('sessions', { user_id: u.id, expires_at: { $gt: nowIso() } }, { sort: { last_seen_at: -1 } }),
    findAll('leads', { $or: [{ email: u.email }, { user_id: u.id }] }, { sort: { created_at: -1 } }),
    findAll('audit_log', { $or: [{ entity: 'user', entity_id: u.id }, { user_id: u.id }] }, { sort: { id: -1 }, limit: 30 }),
  ]);
  const invNo = new Map(invoices.map((i) => [i.id, i.number]));
  return {
    user: { ...publicUser(u), notes: u.notes },
    projects: projects.map(mapProject),
    software: software.map(mapSoftware),
    tickets: tickets.map(mapTicket),
    invoices: invoices.map((i) => mapInvoice({ ...i, paid_amount: payments.filter((p) => p.invoice_id === i.id).reduce((s, p) => s + p.amount, 0) })),
    payments: payments.map((p) => ({ ...p, number: invNo.get(p.invoice_id) || null })),
    documents: documents.map(mapDocument),
    sessions: sessions.map((s) => ({ id: s.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at, userAgent: s.user_agent, ip: s.ip, impersonatorId: s.impersonator_id || null })),
    leads: leads.map((l) => ({ id: l.id, status: l.status, topic: l.topic, createdAt: l.created_at })),
    activity,
  };
}, S);

route('PATCH', '/api/admin/users/:id', async ({ req, user, params, body }) => {
  const u = await getUser(params.id);
  const d = userInput({ ...u, ...body }, { isNew: false });
  if ((d.role !== u.role || (u.role !== 'client' && d.status !== u.status)) && user.role !== 'admin') throw new HttpError(403, 'Zmiana roli lub blokada konta zespołu wymaga roli administratora.');
  if (u.id === user.id && (d.role !== u.role || d.status !== 'active')) throw new HttpError(422, 'Nie możesz odebrać sobie uprawnień ani zablokować własnego konta.');
  if (d.email !== u.email && await findOne('users', { email: d.email, id: { $ne: u.id } })) throw new HttpError(409, 'Ten e-mail jest już zajęty.', { email: 'Zajęty' });
  await update('users', { id: u.id }, { name: d.name, email: d.email, company: d.company, nip: d.nip, phone: d.phone, notes: d.notes, role: d.role, status: d.status });
  if (d.status === 'blocked') await removeMany('sessions', { user_id: u.id });
  const changes = ['name', 'email', 'company', 'nip', 'phone', 'role', 'status'].filter((k) => d[k] !== u[k]);
  audit(req, user, d.status !== u.status ? (d.status === 'blocked' ? 'user.blocked' : 'user.unblocked') : 'user.updated', 'user', u.id, changes.join(', '));
  return { ok: true };
}, S);

route('POST', '/api/admin/users/:id/password', async ({ req, user, params, body }) => {
  const u = await getUser(params.id);
  if (u.role !== 'client' && user.role !== 'admin') throw new HttpError(403, 'Hasła zespołu zmienia tylko administrator.');
  const plain = body.password ? password(body, 'password') : generatePassword();
  await update('users', { id: u.id }, { password_hash: await hashPassword(plain) });
  if (body.logout !== false) await removeMany('sessions', { user_id: u.id });
  audit(req, user, 'user.password_reset', 'user', u.id);
  return { ok: true, password: body.password ? null : plain };
}, S);

route('POST', '/api/admin/users/:id/logout', async ({ req, user, params }) => {
  const u = await getUser(params.id);
  const r = await removeMany('sessions', { user_id: u.id });
  audit(req, user, 'user.sessions_revoked', 'user', u.id);
  return { ok: true, removed: Number(r.deletedCount || 0) };
}, S);

route('POST', '/api/admin/users/:id/impersonate', async ({ req, res, user, params }) => {
  const u = await getUser(params.id);
  if (u.role !== 'client') throw new HttpError(422, 'Podgląd jest dostępny tylko dla kont klientów.');
  audit(req, user, 'user.impersonation_start', 'user', u.id, u.email);
  await destroySession(req, res);
  await createSession(req, res, u.id, false, user.id);
  return { ok: true, redirect: '/panel' };
}, A);

route('DELETE', '/api/admin/users/:id', async ({ req, user, params }) => {
  const u = await getUser(params.id);
  if (u.id === user.id) throw new HttpError(422, 'Nie możesz usunąć własnego konta.');
  const projects = await findAll('projects', { user_id: u.id });
  const tickets = await findAll('tickets', { user_id: u.id });
  const pIds = projects.map((p) => p.id), tIds = tickets.map((t) => t.id);
  for (const d of await findAll('documents', { user_id: u.id })) await deleteFile(d.stored_as).catch(() => {});
  await Promise.all([
    removeMany('documents', { user_id: u.id }), removeMany('sessions', { user_id: u.id }), removeMany('payments', { user_id: u.id }),
    removeMany('invoices', { user_id: u.id }), removeMany('software', { user_id: u.id }), removeMany('tickets', { user_id: u.id }),
    removeMany('ticket_messages', { ticket_id: { $in: tIds } }), removeMany('milestones', { project_id: { $in: pIds } }),
    removeMany('project_updates', { project_id: { $in: pIds } }), removeMany('projects', { user_id: u.id }),
  ]);
  await remove('users', { id: u.id });
  audit(req, user, 'user.deleted', 'user', u.id, u.email);
  return { ok: true };
}, A);

// =====================================================================
// Projekty (oprogramowanie do zrobienia / w realizacji)
// =====================================================================
route('GET', '/api/admin/projects', async () => {
  const [projects, users, ms, tickets] = await Promise.all([findAll('projects'), mapById('users'), findAll('milestones'), findAll('tickets', { status: OPEN })]);
  return {
    stages: STAGES,
    projects: projects.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).map((p) => mapProject({
      ...p, client_name: clientName(users.get(p.user_id)),
      milestones_total: ms.filter((m) => m.project_id === p.id).length, milestones_done: ms.filter((m) => m.project_id === p.id && m.done).length,
      open_tickets: tickets.filter((t) => t.project_id === p.id).length,
    })),
  };
}, S);

async function projectInput(body) {
  return {
    user_id: must(await findOne('users', { id: num(body.userId) }), 'klienta').id,
    name: text(body, 'name', { label: 'Nazwa', min: 2, max: 160, required: true }),
    kind: text(body, 'kind', { label: 'Typ', max: 80 }) || 'Pakiet Business',
    stage: oneOf(body, 'stage', STAGES.map((s) => s.key), 'do_zrobienia'),
    priority: oneOf(body, 'priority', TICKET_PRIORITIES, 'normalny'),
    progress: Math.max(0, Math.min(100, Math.round(num(body.progress)))),
    budget: Math.max(0, num(body.budget)),
    description: text(body, 'description', { label: 'Opis', max: 4000 }),
    modules: listStr(body.modules),
    manager: text(body, 'manager', { label: 'Opiekun', max: 120 }),
    start_date: dateOrNull(body.startDate),
    due_date: dateOrNull(body.dueDate),
  };
}

route('POST', '/api/admin/projects', async ({ req, user, body }) => {
  const d = await projectInput(body);
  const p = await insert('projects', { ...d, created_at: nowIso() });
  audit(req, user, 'project.created', 'project', p.id, d.name);
  return { id: p.id };
}, S);

route('GET', '/api/admin/projects/:id', async ({ params }) => {
  const p = await getProject(params.id);
  const c = await findOne('users', { id: p.user_id });
  const [ms, updates, tickets, documents, invoices, software] = await Promise.all([
    findAll('milestones', { project_id: p.id }, { sort: { position: 1, id: 1 } }),
    findAll('project_updates', { project_id: p.id }, { sort: { created_at: -1 } }),
    findAll('tickets', { project_id: p.id }, { sort: { updated_at: -1 } }),
    findAll('documents', { project_id: p.id }, { sort: { created_at: -1 } }),
    findAll('invoices', { project_id: p.id }, { sort: { issue_date: -1 } }),
    findAll('software', { project_id: p.id }),
  ]);
  return {
    stages: STAGES,
    project: { ...mapProject(p), clientName: clientName(c), clientEmail: c?.email },
    milestones: ms.map((m) => ({ id: m.id, title: m.title, dueDate: m.due_date, done: !!m.done })),
    updates: updates.map((u) => ({ id: u.id, title: u.title, body: u.body, author: u.author, createdAt: u.created_at })),
    tickets: tickets.map(mapTicket), documents: documents.map(mapDocument),
    invoices: invoices.map((i) => mapInvoice(i)), software: software.map(mapSoftware),
  };
}, S);

route('PATCH', '/api/admin/projects/:id', async ({ req, user, params, body }) => {
  const p = await getProject(params.id);
  const d = await projectInput({ ...mapProject(p), userId: p.user_id, ...body });
  await update('projects', { id: p.id }, d);
  if (d.stage !== p.stage) {
    const label = STAGES.find((s) => s.key === d.stage).label;
    if (body.notify !== false) await insert('project_updates', { project_id: p.id, title: `Nowy etap: ${label}`, body: `Projekt przeszedł do etapu „${label}”.`, author: d.manager || user.name, created_at: nowIso() });
    audit(req, user, 'project.stage', 'project', p.id, `${p.stage} → ${d.stage}`);
  } else audit(req, user, 'project.updated', 'project', p.id, d.name);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/projects/:id', async ({ req, user, params }) => {
  const p = await getProject(params.id);
  await removeMany('milestones', { project_id: p.id });
  await removeMany('project_updates', { project_id: p.id });
  for (const name of ['tickets', 'invoices', 'documents', 'software']) {
    for (const x of await findAll(name, { project_id: p.id })) await update(name, { id: x.id }, { project_id: null });
  }
  await remove('projects', { id: p.id });
  audit(req, user, 'project.deleted', 'project', p.id, p.name);
  return { ok: true };
}, A);

route('POST', '/api/admin/projects/:id/milestones', async ({ params, body }) => {
  const p = await getProject(params.id);
  const last = await findOne('milestones', { project_id: p.id }, { sort: { position: -1 } });
  const m = await insert('milestones', {
    project_id: p.id, title: text(body, 'title', { label: 'Tytuł', min: 2, max: 160, required: true }),
    due_date: dateOrNull(body.dueDate), done: false, position: last ? last.position + 1 : 0,
  });
  return { id: m.id };
}, S);

route('PATCH', '/api/admin/milestones/:id', async ({ params, body }) => {
  const m = must(await findOne('milestones', { id: idParam(params.id) }), 'etapu');
  await update('milestones', { id: m.id }, {
    title: body.title !== undefined ? text(body, 'title', { label: 'Tytuł', min: 2, max: 160, required: true }) : m.title,
    due_date: body.dueDate !== undefined ? dateOrNull(body.dueDate) : m.due_date,
    done: body.done !== undefined ? Boolean(body.done) : m.done,
  });
  // automatyczny postęp projektu wg ukończonych etapów
  if (body.done !== undefined && body.autoProgress !== false) {
    const all = await findAll('milestones', { project_id: m.project_id });
    if (all.length) await update('projects', { id: m.project_id }, { progress: Math.round((all.filter((x) => x.done).length / all.length) * 100) });
  }
  return { ok: true };
}, S);

route('DELETE', '/api/admin/milestones/:id', async ({ params }) => { await remove('milestones', { id: idParam(params.id) }); return { ok: true }; }, S);

route('POST', '/api/admin/projects/:id/updates', async ({ req, user, params, body }) => {
  const p = await getProject(params.id);
  const u = await insert('project_updates', {
    project_id: p.id, title: text(body, 'title', { label: 'Tytuł', min: 2, max: 160, required: true }),
    body: text(body, 'body', { label: 'Treść', max: 4000 }), author: text(body, 'author', { max: 120 }) || user.name, created_at: nowIso(),
  });
  audit(req, user, 'project.update_posted', 'project', p.id);
  return { id: u.id };
}, S);

route('DELETE', '/api/admin/updates/:id', async ({ params }) => { await remove('project_updates', { id: idParam(params.id) }); return { ok: true }; }, S);

// =====================================================================
// Aktywne oprogramowanie
// =====================================================================
route('GET', '/api/admin/software', async () => {
  const [list, users] = await Promise.all([findAll('software'), mapById('users')]);
  return {
    software: list.sort((a, b) => a.status.localeCompare(b.status) || (a.renewal_date || '9999').localeCompare(b.renewal_date || '9999'))
      .map((s) => mapSoftware({ ...s, client_name: clientName(users.get(s.user_id)) })),
  };
}, S);

async function softwareInput(body) {
  return {
    user_id: must(await findOne('users', { id: num(body.userId) }), 'klienta').id,
    project_id: body.projectId ? num(body.projectId, null) : null,
    name: text(body, 'name', { label: 'Nazwa', min: 2, max: 160, required: true }),
    plan: text(body, 'plan', { label: 'Plan', max: 60 }) || 'Business',
    modules: listStr(body.modules),
    monthly_fee: Math.max(0, num(body.monthlyFee)),
    users_limit: Math.max(1, Math.round(num(body.usersLimit, 10))),
    url: text(body, 'url', { label: 'Adres', max: 300 }),
    version: text(body, 'version', { label: 'Wersja', max: 30 }) || '1.0',
    status: oneOf(body, 'status', SOFTWARE_STATUSES, 'aktywne'),
    started_at: dateOrNull(body.startedAt) || today(),
    renewal_date: dateOrNull(body.renewalDate),
  };
}

route('POST', '/api/admin/software', async ({ req, user, body }) => {
  const d = await softwareInput(body);
  const s = await insert('software', { ...d, created_at: nowIso() });
  audit(req, user, 'software.created', 'software', s.id, d.name);
  return { id: s.id };
}, S);

route('PATCH', '/api/admin/software/:id', async ({ req, user, params, body }) => {
  const s = must(await findOne('software', { id: idParam(params.id) }), 'oprogramowania');
  const d = await softwareInput({ ...mapSoftware(s), ...body });
  await update('software', { id: s.id }, d);
  audit(req, user, d.status !== s.status ? `software.${d.status}` : 'software.updated', 'software', s.id, d.name);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/software/:id', async ({ req, user, params }) => {
  await remove('software', { id: idParam(params.id) });
  audit(req, user, 'software.deleted', 'software', Number(params.id));
  return { ok: true };
}, A);

// =====================================================================
// Zgłoszenia
// =====================================================================
async function ticketExtras(tickets) {
  const [users, projects, msgs] = await Promise.all([
    mapById('users'), mapById('projects'),
    findAll('ticket_messages', { ticket_id: { $in: tickets.map((t) => t.id) } }, { sort: { created_at: 1, id: 1 } }),
  ]);
  return tickets.map((t) => {
    const m = msgs.filter((x) => x.ticket_id === t.id);
    const pub = m.filter((x) => ['client', 'team'].includes(x.author_type));
    const u = users.get(t.user_id);
    return mapTicket({
      ...t, client_name: clientName(u), client_email: u?.email, project_name: projects.get(t.project_id)?.name,
      assigned_name: users.get(t.assigned_to)?.name, messages_count: m.length, last_author: pub[pub.length - 1]?.author_type,
    });
  });
}

route('GET', '/api/admin/tickets', async () => ({
  tickets: await ticketExtras(await findAll('tickets', {}, { sort: { updated_at: -1 }, limit: 1000 })),
}), S);

route('GET', '/api/admin/tickets/:id', async ({ params }) => {
  const t = must(await findOne('tickets', { id: idParam(params.id) }), 'zgłoszenia');
  const [ticket] = await ticketExtras([t]);
  const [msgs, other] = await Promise.all([
    findAll('ticket_messages', { ticket_id: t.id }, { sort: { created_at: 1, id: 1 } }),
    findAll('tickets', { user_id: t.user_id, id: { $ne: t.id } }, { sort: { updated_at: -1 }, limit: 5 }),
  ]);
  return {
    ticket,
    messages: msgs.map((m) => ({ id: m.id, authorType: m.author_type, authorName: m.author_name, body: m.body, createdAt: m.created_at })),
    otherTickets: other.map(mapTicket),
  };
}, S);

route('POST', '/api/admin/tickets/:id/reply', async ({ req, user, params, body }) => {
  const t = must(await findOne('tickets', { id: idParam(params.id) }), 'zgłoszenia');
  const message = text(body, 'message', { label: 'Wiadomość', min: 2, max: 8000, required: true });
  const internal = body.internal === true;
  const status = body.status ? oneOf(body, 'status', TICKET_STATUSES) : (internal ? t.status : 'oczekuje_na_klienta');
  const now = nowIso();
  await insert('ticket_messages', { ticket_id: t.id, author_type: internal ? 'internal' : 'team', author_name: user.name, body: message, created_at: now });
  await update('tickets', { id: t.id }, { status, updated_at: now, assigned_to: t.assigned_to ?? user.id });
  audit(req, user, internal ? 'ticket.note' : 'ticket.reply', 'ticket', t.id);
  return { ok: true };
}, S);

const statusLabel = (s) => ({ nowe: 'Nowe', w_toku: 'W toku', oczekuje_na_klienta: 'Czeka na klienta', rozwiazane: 'Rozwiązane', zamkniete: 'Zamknięte' }[s] || s);

route('PATCH', '/api/admin/tickets/:id', async ({ req, user, params, body }) => {
  const t = must(await findOne('tickets', { id: idParam(params.id) }), 'zgłoszenia');
  const status = body.status ? oneOf(body, 'status', TICKET_STATUSES) : t.status;
  const priority = body.priority ? oneOf(body, 'priority', TICKET_PRIORITIES) : t.priority;
  const assigned = body.assignedTo !== undefined ? (body.assignedTo ? num(body.assignedTo) : null) : t.assigned_to;
  await update('tickets', { id: t.id }, { status, priority, assigned_to: assigned, updated_at: nowIso() });
  if (status !== t.status) {
    await insert('ticket_messages', { ticket_id: t.id, author_type: 'system', author_name: 'Modulio', body: `Status zmieniony: ${statusLabel(t.status)} → ${statusLabel(status)}`, created_at: nowIso() });
  }
  audit(req, user, 'ticket.updated', 'ticket', t.id, `${status}/${priority}`);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/tickets/:id', async ({ req, user, params }) => {
  const id = idParam(params.id);
  await removeMany('ticket_messages', { ticket_id: id });
  await remove('tickets', { id });
  audit(req, user, 'ticket.deleted', 'ticket', id);
  return { ok: true };
}, A);

// =====================================================================
// Płatności: faktury i wpłaty
// =====================================================================
route('GET', '/api/admin/invoices', async () => {
  const [invoices, users, projects, payments] = await Promise.all([
    findAll('invoices', {}, { sort: { issue_date: -1, id: -1 }, limit: 2000 }), mapById('users'), mapById('projects'), findAll('payments'),
  ]);
  return {
    invoices: invoices.map((i) => mapInvoice({
      ...i, client_name: clientName(users.get(i.user_id)), project_name: projects.get(i.project_id)?.name,
      paid_amount: payments.filter((p) => p.invoice_id === i.id).reduce((s, p) => s + p.amount, 0),
    })),
  };
}, S);

route('GET', '/api/admin/invoices/:id', async ({ params }) => {
  const inv = must(await findOne('invoices', { id: idParam(params.id) }), 'faktury');
  const [u, payments, project] = await Promise.all([
    findOne('users', { id: inv.user_id }), findAll('payments', { invoice_id: inv.id }, { sort: { paid_at: 1 } }),
    inv.project_id ? findOne('projects', { id: inv.project_id }) : null,
  ]);
  return {
    invoice: mapInvoice({ ...inv, project_name: project?.name, paid_amount: payments.reduce((s, p) => s + p.amount, 0) }, true),
    seller: company(),
    buyer: { name: clientName(u), contact: u?.name, email: u?.email, nip: u?.nip },
    payments,
  };
}, S);

async function nextInvoiceNumber(date) {
  const prefix = `FV/${date.slice(0, 4)}/${date.slice(5, 7)}/`;
  let n = (await count('invoices', { number: new RegExp(`^${escRe(prefix)}`) })) + 1;
  while (await findOne('invoices', { number: prefix + String(n).padStart(3, '0') })) n++;
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

route('POST', '/api/admin/invoices', async ({ req, user, body }) => {
  const client = must(await findOne('users', { id: num(body.userId) }), 'klienta');
  const items = parseItems(body.items);
  const issue = dateOrNull(body.issueDate) || today();
  const due = dateOrNull(body.dueDate) || new Date(Date.parse(issue) + num(getSettings().invoice_due_days, 14) * 864e5).toISOString().slice(0, 10);
  let pct = 0, code = '';
  if (body.discountCode) {
    const dc = await findOne('discount_codes', { code: String(body.discountCode).trim().toUpperCase() });
    if (!dc || !dc.active) throw new HttpError(422, 'Kod rabatowy nie istnieje lub jest nieaktywny.', { discountCode: 'Nieprawidłowy' });
    if (dc.expires_at && dc.expires_at < today()) throw new HttpError(422, 'Kod rabatowy wygasł.', { discountCode: 'Wygasł' });
    if (dc.max_uses && dc.used >= dc.max_uses) throw new HttpError(422, 'Limit użyć kodu został wyczerpany.', { discountCode: 'Wyczerpany' });
    pct = dc.percent; code = dc.code;
  }
  const number = body.number ? text(body, 'number', { max: 40 }) : await nextInvoiceNumber(issue);
  const inv = await insert('invoices', {
    user_id: client.id, project_id: body.projectId ? num(body.projectId) : null, number, issue_date: issue, due_date: due,
    items, discount_code: code, discount_pct: pct, status: 'oczekuje', paid_at: null, created_at: nowIso(),
  });
  if (code) await update('discount_codes', { code }, null, { $inc: { used: 1 } });
  audit(req, user, 'invoice.created', 'invoice', inv.id, `${number} · ${invoiceTotals(items, pct).gross} zł`);
  return { id: inv.id, number };
}, S);

route('PATCH', '/api/admin/invoices/:id', async ({ req, user, params, body }) => {
  const inv = must(await findOne('invoices', { id: idParam(params.id) }), 'faktury');
  const status = body.status ? oneOf(body, 'status', ['oczekuje', 'oplacona', 'anulowana']) : inv.status;
  await update('invoices', { id: inv.id }, {
    status, due_date: body.dueDate ? dateOrNull(body.dueDate) : inv.due_date,
    paid_at: status === 'oplacona' ? (inv.paid_at || nowIso()) : null,
  });
  audit(req, user, `invoice.${status}`, 'invoice', inv.id, inv.number);
  return { ok: true };
}, S);

route('DELETE', '/api/admin/invoices/:id', async ({ req, user, params }) => {
  const inv = must(await findOne('invoices', { id: idParam(params.id) }), 'faktury');
  for (const p of await findAll('payments', { invoice_id: inv.id })) await update('payments', { id: p.id }, { invoice_id: null });
  await remove('invoices', { id: inv.id });
  audit(req, user, 'invoice.deleted', 'invoice', inv.id, inv.number);
  return { ok: true };
}, A);

route('GET', '/api/admin/payments', async () => {
  const [payments, users, invoices] = await Promise.all([findAll('payments', {}, { sort: { paid_at: -1, id: -1 }, limit: 2000 }), mapById('users'), mapById('invoices')]);
  return { payments: payments.map((p) => ({ ...p, number: invoices.get(p.invoice_id)?.number || null, client_name: clientName(users.get(p.user_id)) })) };
}, S);

async function syncInvoicePaid(invoiceId) {
  const inv = await findOne('invoices', { id: invoiceId });
  if (!inv || inv.status === 'anulowana') return;
  const { gross } = totalsOf(inv);
  const payments = await findAll('payments', { invoice_id: invoiceId });
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const last = payments.map((p) => p.paid_at).sort().pop();
  if (paid >= gross - 0.01) await update('invoices', { id: invoiceId }, { status: 'oplacona', paid_at: last });
  else if (inv.status === 'oplacona') await update('invoices', { id: invoiceId }, { status: 'oczekuje', paid_at: null });
}

route('POST', '/api/admin/payments', async ({ req, user, body }) => {
  let userId = num(body.userId, 0);
  const invoiceId = body.invoiceId ? num(body.invoiceId) : null;
  let amount = num(body.amount, NaN);
  if (invoiceId) {
    const inv = must(await findOne('invoices', { id: invoiceId }), 'faktury');
    userId = inv.user_id;
    if (Number.isNaN(amount)) {
      const paid = (await findAll('payments', { invoice_id: inv.id })).reduce((s, p) => s + p.amount, 0);
      amount = round2(totalsOf(inv).gross - paid);
    }
  }
  must(await findOne('users', { id: userId }), 'klienta');
  if (!(amount > 0)) throw new HttpError(422, 'Podaj kwotę wpłaty większą od zera.', { amount: 'Wymagane' });
  const p = await insert('payments', {
    invoice_id: invoiceId, user_id: userId, amount: round2(amount), method: oneOf(body, 'method', PAYMENT_METHODS, 'przelew'),
    paid_at: dateOrNull(body.paidAt) || today(), note: text(body, 'note', { max: 300 }), created_at: nowIso(),
  });
  if (invoiceId) await syncInvoicePaid(invoiceId);
  audit(req, user, 'payment.recorded', 'payment', p.id, `${round2(amount)} zł`);
  return { id: p.id };
}, S);

route('DELETE', '/api/admin/payments/:id', async ({ req, user, params }) => {
  const p = must(await findOne('payments', { id: idParam(params.id) }), 'wpłaty');
  await remove('payments', { id: p.id });
  if (p.invoice_id) await syncInvoicePaid(p.invoice_id);
  audit(req, user, 'payment.deleted', 'payment', p.id, `${p.amount} zł`);
  return { ok: true };
}, A);

// =====================================================================
// Dokumenty (pliki w MongoDB GridFS)
// =====================================================================
route('GET', '/api/admin/documents', async () => {
  const [docs, users, projects] = await Promise.all([findAll('documents', {}, { sort: { created_at: -1 } }), mapById('users'), mapById('projects')]);
  return { documents: docs.map((d) => mapDocument({ ...d, client_name: clientName(users.get(d.user_id)), project_name: projects.get(d.project_id)?.name })) };
}, S);

const ALLOWED_EXT = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.zip': 'application/zip', '.txt': 'text/plain', '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

route('POST', '/api/admin/documents', async ({ req, user, body }) => {
  const client = must(await findOne('users', { id: num(body.userId) }), 'klienta');
  const filename = path.basename(String(body.filename || '')).slice(0, 180);
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT[ext]) throw new HttpError(422, `Niedozwolony typ pliku. Dozwolone: ${Object.keys(ALLOWED_EXT).join(', ')}`);
  const buf = Buffer.from(String(body.data || ''), 'base64');
  if (!buf.length) throw new HttpError(422, 'Plik jest pusty.');
  if (buf.length > 10 * 1024 * 1024) throw new HttpError(413, 'Maksymalny rozmiar pliku to 10 MB.');
  const stored = `${crypto.randomUUID()}${ext}`;
  await saveFile(stored, buf, ALLOWED_EXT[ext]);
  const d = await insert('documents', {
    user_id: client.id, project_id: body.projectId ? num(body.projectId) : null,
    name: text(body, 'name', { max: 160 }) || filename.replace(/\.[^.]+$/, ''), category: oneOf(body, 'category', DOC_CATEGORIES, 'inne'),
    filename, stored_as: stored, mime: ALLOWED_EXT[ext], size: buf.length, created_at: nowIso(),
  });
  audit(req, user, 'document.uploaded', 'document', d.id, filename);
  return { id: d.id };
}, { auth: 'staff', bodyLimit: 15 * 1024 * 1024 });

route('GET', '/api/admin/documents/:id/download', async ({ params, res }) => {
  await streamDocument(res, must(await findOne('documents', { id: idParam(params.id) }), 'dokumentu'));
}, S);

route('DELETE', '/api/admin/documents/:id', async ({ req, user, params }) => {
  const d = must(await findOne('documents', { id: idParam(params.id) }), 'dokumentu');
  await deleteFile(d.stored_as).catch(() => {});
  await remove('documents', { id: d.id });
  audit(req, user, 'document.deleted', 'document', d.id, d.filename);
  return { ok: true };
}, S);

// =====================================================================
// Leady (CRM)
// =====================================================================
route('GET', '/api/admin/leads', async () => {
  const [leads, users] = await Promise.all([findAll('leads', {}, { sort: { created_at: -1 }, limit: 2000 }), mapById('users')]);
  return { statuses: LEAD_STATUSES, leads: leads.map((l) => mapLead({ ...l, assigned_name: users.get(l.assigned_to)?.name })) };
}, S);

route('POST', '/api/admin/leads', async ({ req, user, body }) => {
  const l = await insert('leads', {
    name: text(body, 'name', { label: 'Nazwa', min: 2, max: 120, required: true }), email: email(body), phone: text(body, 'phone', { max: 40 }),
    company: text(body, 'company', { max: 160 }), topic: text(body, 'topic', { max: 80 }) || 'Kontakt bezpośredni', message: text(body, 'message', { max: 5000 }) || '—',
    source: text(body, 'source', { max: 40 }) || 'reczny', utm_source: '', status: oneOf(body, 'status', LEAD_STATUSES, 'nowy'), value: Math.max(0, num(body.value)),
    notes: text(body, 'notes', { max: 4000 }), assigned_to: body.assignedTo ? num(body.assignedTo) : user.id, user_id: null, ip: '', created_at: nowIso(), updated_at: nowIso(),
  });
  audit(req, user, 'lead.created', 'lead', l.id);
  return { id: l.id };
}, S);

route('PATCH', '/api/admin/leads/:id', async ({ req, user, params, body }) => {
  const l = must(await findOne('leads', { id: idParam(params.id) }), 'leada');
  const status = body.status ? oneOf(body, 'status', LEAD_STATUSES) : l.status;
  await update('leads', { id: l.id }, {
    name: body.name !== undefined ? text(body, 'name', { min: 2, max: 120, required: true }) : l.name,
    email: body.email !== undefined ? email(body) : l.email,
    phone: body.phone !== undefined ? text(body, 'phone', { max: 40 }) : l.phone,
    company: body.company !== undefined ? text(body, 'company', { max: 160 }) : l.company,
    status, value: body.value !== undefined ? Math.max(0, num(body.value)) : l.value,
    notes: body.notes !== undefined ? text(body, 'notes', { max: 4000 }) : l.notes,
    assigned_to: body.assignedTo !== undefined ? (body.assignedTo ? num(body.assignedTo) : null) : l.assigned_to,
    updated_at: nowIso(),
  });
  audit(req, user, status !== l.status ? 'lead.status' : 'lead.updated', 'lead', l.id, status !== l.status ? `${l.status} → ${status}` : '');
  return { ok: true };
}, S);

route('POST', '/api/admin/leads/:id/convert', async ({ req, user, params, body }) => {
  const l = must(await findOne('leads', { id: idParam(params.id) }), 'leada');
  let client = await findOne('users', { email: l.email });
  let plain = null;
  if (!client) {
    plain = generatePassword();
    client = await insert('users', newUserDoc({ email: l.email, password_hash: await hashPassword(plain), name: l.name, company: l.company, phone: l.phone, notes: `Utworzony z leada #${l.id}` }));
  }
  let projectId = null;
  if (body.projectName) {
    const p = await insert('projects', {
      user_id: client.id, name: String(body.projectName).slice(0, 160), kind: String(body.kind || l.topic || 'Pakiet Business').slice(0, 80),
      stage: 'do_zrobienia', priority: 'normalny', progress: 0, budget: l.value || 0, description: String(l.message || '').slice(0, 4000), modules: [],
      manager: user.name, start_date: null, due_date: null, created_at: nowIso(),
    });
    projectId = p.id;
  }
  await update('leads', { id: l.id }, { status: 'wygrany', user_id: client.id, updated_at: nowIso() });
  audit(req, user, 'lead.converted', 'lead', l.id, client.email);
  return { userId: client.id, password: plain, projectId, existing: !plain };
}, S);

route('DELETE', '/api/admin/leads/:id', async ({ req, user, params }) => {
  await remove('leads', { id: idParam(params.id) });
  audit(req, user, 'lead.deleted', 'lead', Number(params.id));
  return { ok: true };
}, S);

// =====================================================================
// Marketing: ogłoszenia, newsletter, kody rabatowe
// =====================================================================
route('GET', '/api/admin/marketing', async () => {
  const [announcements, newsletter, codes, leads] = await Promise.all([
    findAll('announcements', {}, { sort: { created_at: -1 } }), findAll('newsletter', {}, { sort: { created_at: -1 } }),
    findAll('discount_codes', {}, { sort: { created_at: -1 } }), findAll('leads'),
  ]);
  const src = new Map();
  for (const l of leads) {
    const k = l.utm_source || l.source;
    const r = src.get(k) || { source: k, leads: 0, won: 0, value: 0 };
    r.leads++; if (l.status === 'wygrany') r.won++; r.value += l.value || 0;
    src.set(k, r);
  }
  return {
    announcements: announcements.map((a) => ({ ...a, active: a.active ? 1 : 0 })),
    newsletter,
    codes: codes.map((c) => ({ ...c, active: c.active ? 1 : 0 })),
    sources: [...src.values()].sort((a, b) => b.leads - a.leads),
  };
}, S);

route('POST', '/api/admin/announcements', async ({ req, user, body }) => {
  const a = await insert('announcements', {
    title: text(body, 'title', { label: 'Tytuł', min: 2, max: 140, required: true }), body: text(body, 'body', { max: 1000 }),
    tone: oneOf(body, 'tone', ['info', 'success', 'warning'], 'info'), active: body.active !== false,
    starts_at: dateOrNull(body.startsAt), ends_at: dateOrNull(body.endsAt), created_at: nowIso(),
  });
  audit(req, user, 'announcement.created', 'announcement', a.id);
  return { id: a.id };
}, S);

route('PATCH', '/api/admin/announcements/:id', async ({ params, body }) => {
  const a = must(await findOne('announcements', { id: idParam(params.id) }), 'ogłoszenia');
  await update('announcements', { id: a.id }, {
    title: body.title !== undefined ? text(body, 'title', { min: 2, max: 140, required: true }) : a.title,
    body: body.body !== undefined ? text(body, 'body', { max: 1000 }) : a.body,
    tone: body.tone ? oneOf(body, 'tone', ['info', 'success', 'warning']) : a.tone,
    active: body.active !== undefined ? Boolean(body.active) : a.active,
    starts_at: body.startsAt !== undefined ? dateOrNull(body.startsAt) : a.starts_at,
    ends_at: body.endsAt !== undefined ? dateOrNull(body.endsAt) : a.ends_at,
  });
  return { ok: true };
}, S);

route('DELETE', '/api/admin/announcements/:id', async ({ params }) => { await remove('announcements', { id: idParam(params.id) }); return { ok: true }; }, S);
route('DELETE', '/api/admin/newsletter/:id', async ({ params }) => { await remove('newsletter', { id: idParam(params.id) }); return { ok: true }; }, S);

route('POST', '/api/admin/codes', async ({ req, user, body }) => {
  const code = text(body, 'code', { label: 'Kod', min: 3, max: 30, required: true }).toUpperCase().replace(/\s+/g, '');
  const percent = num(body.percent, NaN);
  if (!(percent > 0 && percent <= 100)) throw new HttpError(422, 'Rabat musi wynosić od 1 do 100%.', { percent: '1–100' });
  if (await findOne('discount_codes', { code })) throw new HttpError(409, 'Taki kod już istnieje.', { code: 'Zajęty' });
  const c = await insert('discount_codes', {
    code, percent, description: text(body, 'description', { max: 200 }), max_uses: Math.max(0, Math.round(num(body.maxUses))),
    used: 0, active: body.active !== false, expires_at: dateOrNull(body.expiresAt), created_at: nowIso(),
  });
  audit(req, user, 'code.created', 'code', c.id, code);
  return { id: c.id };
}, S);

route('PATCH', '/api/admin/codes/:id', async ({ params, body }) => {
  const c = must(await findOne('discount_codes', { id: idParam(params.id) }), 'kodu');
  await update('discount_codes', { id: c.id }, {
    active: body.active !== undefined ? Boolean(body.active) : c.active,
    description: body.description !== undefined ? text(body, 'description', { max: 200 }) : c.description,
    max_uses: body.maxUses !== undefined ? Math.max(0, Math.round(num(body.maxUses))) : c.max_uses,
    expires_at: body.expiresAt !== undefined ? dateOrNull(body.expiresAt) : c.expires_at,
  });
  return { ok: true };
}, S);

route('DELETE', '/api/admin/codes/:id', async ({ params }) => { await remove('discount_codes', { id: idParam(params.id) }); return { ok: true }; }, S);

// =====================================================================
// Ustawienia, dziennik, eksport
// =====================================================================
route('GET', '/api/admin/settings', () => ({ settings: getSettings() }), A);
route('PUT', '/api/admin/settings', async ({ req, user, body }) => {
  const s = await setSettings(body || {});
  audit(req, user, 'settings.updated', 'settings', null, Object.keys(body || {}).join(', '));
  return { settings: s };
}, A);

route('GET', '/api/admin/audit', async ({ query }) => {
  const s = query.get('q');
  const filter = s ? { $or: [{ action: rx(s) }, { user_name: rx(s) }, { details: rx(s) }] } : {};
  return { entries: await findAll('audit_log', filter, { sort: { id: -1 }, limit: 500 }) };
}, S);

const pl = (n) => Number(n || 0).toFixed(2).replace('.', ',');
const EXPORTS = {
  uzytkownicy: async () => [await findAll('users', {}, { sort: { id: 1 } }), [
    { label: 'ID', key: 'id' }, { label: 'E-mail', key: 'email' }, { label: 'Imię i nazwisko', key: 'name' }, { label: 'Firma', key: 'company' },
    { label: 'NIP', key: 'nip' }, { label: 'Telefon', key: 'phone' }, { label: 'Rola', key: 'role' }, { label: 'Status', key: 'status' },
    { label: 'Utworzono', key: 'created_at' }, { label: 'Ostatnie logowanie', key: 'last_login_at' }]],
  leady: async () => [await findAll('leads', {}, { sort: { id: 1 } }), [
    { label: 'ID', key: 'id' }, { label: 'Data', key: 'created_at' }, { label: 'Status', key: 'status' }, { label: 'Nazwa', key: 'name' }, { label: 'E-mail', key: 'email' },
    { label: 'Telefon', key: 'phone' }, { label: 'Firma', key: 'company' }, { label: 'Temat', key: 'topic' }, { label: 'Źródło', get: (r) => r.utm_source || r.source },
    { label: 'Wartość', key: 'value' }, { label: 'Wiadomość', key: 'message' }]],
  faktury: async () => {
    const users = await mapById('users');
    return [(await findAll('invoices', {}, { sort: { issue_date: 1 } })).map((r) => ({ ...r, client: clientName(users.get(r.user_id)) })), [
      { label: 'Numer', key: 'number' }, { label: 'Klient', key: 'client' }, { label: 'Wystawiona', key: 'issue_date' }, { label: 'Termin', key: 'due_date' },
      { label: 'Status', get: (r) => invoiceStatus(r) }, { label: 'Netto', get: (r) => pl(totalsOf(r).net) }, { label: 'VAT', get: (r) => pl(totalsOf(r).vat) },
      { label: 'Brutto', get: (r) => pl(totalsOf(r).gross) }, { label: 'Kod rabatowy', key: 'discount_code' }]];
  },
  wplaty: async () => {
    const [users, invoices] = await Promise.all([mapById('users'), mapById('invoices')]);
    return [(await findAll('payments', {}, { sort: { paid_at: 1 } })).map((r) => ({ ...r, client: clientName(users.get(r.user_id)), number: invoices.get(r.invoice_id)?.number })), [
      { label: 'Data', key: 'paid_at' }, { label: 'Klient', key: 'client' }, { label: 'Faktura', key: 'number' }, { label: 'Kwota', get: (r) => pl(r.amount) },
      { label: 'Metoda', key: 'method' }, { label: 'Notatka', key: 'note' }]];
  },
  newsletter: async () => [(await findAll('newsletter', {}, { sort: { id: 1 } })).filter((n) => !n.unsubscribed_at), [
    { label: 'E-mail', key: 'email' }, { label: 'Źródło', key: 'source' }, { label: 'Zapisano', key: 'created_at' }]],
  oprogramowanie: async () => {
    const users = await mapById('users');
    return [(await findAll('software', {}, { sort: { id: 1 } })).map((r) => ({ ...r, client: clientName(users.get(r.user_id)) })), [
      { label: 'Nazwa', key: 'name' }, { label: 'Klient', key: 'client' }, { label: 'Plan', key: 'plan' }, { label: 'Status', key: 'status' },
      { label: 'Abonament', get: (r) => pl(r.monthly_fee) }, { label: 'Odnowienie', key: 'renewal_date' }, { label: 'Adres', key: 'url' }]];
  },
};

route('GET', '/api/admin/export/:type', async ({ req, res, user, params }) => {
  const fn = EXPORTS[params.type];
  if (!fn) throw new HttpError(404, 'Nieznany typ eksportu.');
  const [rows, cols] = await fn();
  const csv = toCsv(rows, cols);
  audit(req, user, 'export', params.type, null, `${rows.length} wierszy`);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="modulio-${params.type}-${today()}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.end(csv);
}, S);

// Komunikat do wszystkich aktywnych klientów (jako zgłoszenie w ich panelu)
route('POST', '/api/admin/broadcast', async ({ req, user, body }) => {
  const title = text(body, 'title', { label: 'Tytuł', min: 2, max: 140, required: true });
  const msg = text(body, 'message', { label: 'Treść', min: 5, max: 4000, required: true });
  const clients = await findAll('users', { role: 'client', status: 'active' });
  const now = nowIso();
  for (const c of clients) {
    const t = await insert('tickets', { user_id: c.id, project_id: null, assigned_to: user.id, subject: title, category: 'pytanie', priority: 'normalny', status: 'oczekuje_na_klienta', created_at: now, updated_at: now });
    await insert('ticket_messages', { ticket_id: t.id, author_type: 'team', author_name: user.name, body: msg, created_at: now });
  }
  audit(req, user, 'broadcast.sent', 'broadcast', null, `${title} → ${clients.length} klientów`);
  return { ok: true, sent: clients.length };
}, A);
