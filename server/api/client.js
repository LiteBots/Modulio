// API panelu klienta — każdy odczyt filtrowany po user_id zalogowanego klienta
import {
  insert, findAll, findOne, update, removeMany, count, readFileStream, nowIso, today,
} from '../db/index.js';
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
const OPEN = { $nin: ['rozwiazane', 'zamkniete'] };

async function projectsWithCounts(userId) {
  const projects = await findAll('projects', { user_id: userId }, { sort: { created_at: -1 } });
  const ids = projects.map((p) => p.id);
  const [ms, tickets] = await Promise.all([
    findAll('milestones', { project_id: { $in: ids } }),
    findAll('tickets', { project_id: { $in: ids }, status: OPEN }),
  ]);
  return projects.map((p) => mapProject({
    ...p,
    milestones_total: ms.filter((m) => m.project_id === p.id).length,
    milestones_done: ms.filter((m) => m.project_id === p.id && m.done).length,
    open_tickets: tickets.filter((t) => t.project_id === p.id).length,
  }));
}

// ---------- Pulpit ----------
route('GET', '/api/dashboard', async ({ user }) => {
  const projects = await projectsWithCounts(user.id);
  const projectIds = projects.map((p) => p.id);
  const pName = new Map(projects.map((p) => [p.id, p.name]));

  const [openTickets, awaitingClient, invoicesRaw, milestonesRaw, updates, tickets, softwareRaw] = await Promise.all([
    count('tickets', { user_id: user.id, status: OPEN }),
    count('tickets', { user_id: user.id, status: 'oczekuje_na_klienta' }),
    findAll('invoices', { user_id: user.id, status: 'oczekuje' }, { sort: { due_date: 1 } }),
    findAll('milestones', { project_id: { $in: projectIds }, done: false }),
    findAll('project_updates', { project_id: { $in: projectIds } }, { sort: { created_at: -1 }, limit: 8 }),
    findAll('tickets', { user_id: user.id }),
    findAll('software', { user_id: user.id }, { sort: { created_at: -1 } }),
  ]);
  const invoices = invoicesRaw.map((i) => mapInvoice(i));
  const milestones = milestonesRaw
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).slice(0, 5)
    .map((m) => ({ id: m.id, title: m.title, dueDate: m.due_date, projectId: m.project_id, projectName: pName.get(m.project_id) }));

  const tMap = new Map(tickets.map((t) => [t.id, t]));
  const teamMsgs = await findAll('ticket_messages', { ticket_id: { $in: [...tMap.keys()] }, author_type: 'team' }, { sort: { created_at: -1 }, limit: 8 });
  const activity = [
    ...updates.map((u) => ({ type: 'update', title: u.title, body: u.body, at: u.created_at, refId: u.project_id, refName: pName.get(u.project_id), author: u.author })),
    ...teamMsgs.map((m) => ({ type: 'ticket', title: tMap.get(m.ticket_id).subject, body: m.body, at: m.created_at, refId: m.ticket_id, refName: ticketNo(m.ticket_id), author: m.author_name })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8).map((a) => ({ ...a, body: a.body.slice(0, 220) }));

  const software = softwareRaw.map(mapSoftware);
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

route('GET', '/api/announcements', async () => {
  const d = today();
  const list = await findAll('announcements', { active: true }, { sort: { created_at: -1 } });
  return {
    announcements: list.filter((a) => (!a.starts_at || a.starts_at <= d) && (!a.ends_at || a.ends_at >= d)).slice(0, 3)
      .map((a) => ({ id: a.id, title: a.title, body: a.body, tone: a.tone, createdAt: a.created_at })),
  };
}, U);

// ---------- Projekty ----------
route('GET', '/api/projects', async ({ user }) => ({ stages: STAGES, projects: await projectsWithCounts(user.id) }), U);

route('GET', '/api/projects/:id', async ({ user, params }) => {
  const p = await findOne('projects', { id: idParam(params.id), user_id: user.id });
  if (!p) throw new HttpError(404, 'Nie znaleziono projektu.');
  const [ms, updates, docs, tickets] = await Promise.all([
    findAll('milestones', { project_id: p.id }, { sort: { position: 1, id: 1 } }),
    findAll('project_updates', { project_id: p.id }, { sort: { created_at: -1 } }),
    findAll('documents', { project_id: p.id, user_id: user.id }, { sort: { created_at: -1 } }),
    findAll('tickets', { project_id: p.id, user_id: user.id }, { sort: { updated_at: -1 } }),
  ]);
  return {
    stages: STAGES,
    project: mapProject(p),
    milestones: ms.map((m) => ({ id: m.id, title: m.title, dueDate: m.due_date, done: !!m.done })),
    updates: updates.map((u) => ({ id: u.id, title: u.title, body: u.body, author: u.author, createdAt: u.created_at })),
    documents: docs.map(mapDocument),
    tickets: tickets.map(mapTicket),
  };
}, U);

// ---------- Zgłoszenia ----------
route('GET', '/api/tickets', async ({ user }) => {
  const [tickets, projects] = await Promise.all([
    findAll('tickets', { user_id: user.id }, { sort: { updated_at: -1 } }),
    findAll('projects', { user_id: user.id }, { sort: { created_at: -1 } }),
  ]);
  const msgs = await findAll('ticket_messages', { ticket_id: { $in: tickets.map((t) => t.id) }, author_type: { $ne: 'internal' } }, { sort: { created_at: 1, id: 1 } });
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  return {
    tickets: tickets.map((t) => {
      const m = msgs.filter((x) => x.ticket_id === t.id);
      return mapTicket({ ...t, project_name: pName.get(t.project_id), messages_count: m.length, last_author: m[m.length - 1]?.author_type });
    }),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
  };
}, U);

route('POST', '/api/tickets', async ({ req, user, body }) => {
  limitOr429(`ticket:${user.id}`, 20, 60 * 60 * 1000);
  const subject = text(body, 'subject', { label: 'Temat', min: 4, max: 160, required: true });
  const category = oneOf(body, 'category', TICKET_CATEGORIES, 'pytanie');
  const priority = oneOf(body, 'priority', TICKET_PRIORITIES, 'normalny');
  const message = text(body, 'message', { label: 'Opis', min: 10, max: 5000, required: true });
  let projectId = null;
  if (body.projectId) {
    const p = await findOne('projects', { id: Number(body.projectId), user_id: user.id });
    if (!p) throw new HttpError(422, 'Wybrany projekt nie istnieje.', { projectId: 'Niepoprawny' });
    projectId = p.id;
  }
  const now = nowIso();
  const t = await insert('tickets', { user_id: user.id, project_id: projectId, assigned_to: null, subject, category, priority, status: 'nowe', created_at: now, updated_at: now });
  await insert('ticket_messages', { ticket_id: t.id, author_type: 'client', author_name: user.name, body: message, created_at: now });
  await insert('ticket_messages', { ticket_id: t.id, author_type: 'system', author_name: 'Modulio', body: `Dziękujemy! Zgłoszenie ${ticketNo(t.id)} zostało przyjęte. Opiekun odpowie w tym wątku.`, created_at: new Date(Date.now() + 1000).toISOString() });
  audit(req, user, 'ticket.created', 'ticket', t.id, subject);
  return { id: t.id, number: ticketNo(t.id) };
}, U);

async function ownTicket(user, id) {
  const t = await findOne('tickets', { id: idParam(id), user_id: user.id });
  if (!t) throw new HttpError(404, 'Nie znaleziono zgłoszenia.');
  if (t.project_id) t.project_name = (await findOne('projects', { id: t.project_id }))?.name;
  return t;
}

route('GET', '/api/tickets/:id', async ({ user, params }) => {
  const t = await ownTicket(user, params.id);
  const msgs = await findAll('ticket_messages', { ticket_id: t.id, author_type: { $ne: 'internal' } }, { sort: { created_at: 1, id: 1 } });
  return {
    ticket: mapTicket(t),
    messages: msgs.map((m) => ({ id: m.id, authorType: m.author_type, authorName: m.author_name, body: m.body, createdAt: m.created_at })),
  };
}, U);

route('POST', '/api/tickets/:id/messages', async ({ user, params, body }) => {
  limitOr429(`ticket-msg:${user.id}`, 60, 60 * 60 * 1000);
  const t = await ownTicket(user, params.id);
  const message = text(body, 'message', { label: 'Wiadomość', min: 2, max: 5000, required: true });
  let status = t.status;
  if (['rozwiazane', 'zamkniete'].includes(status)) status = 'nowe';
  else if (status === 'oczekuje_na_klienta') status = 'w_toku';
  const now = nowIso();
  await insert('ticket_messages', { ticket_id: t.id, author_type: 'client', author_name: user.name, body: message, created_at: now });
  await update('tickets', { id: t.id }, { status, updated_at: now });
  return { ok: true, status };
}, U);

route('POST', '/api/tickets/:id/close', async ({ user, params }) => {
  const t = await ownTicket(user, params.id);
  await update('tickets', { id: t.id }, { status: 'zamkniete', updated_at: nowIso() });
  await insert('ticket_messages', { ticket_id: t.id, author_type: 'system', author_name: 'Modulio', body: `Zgłoszenie zamknięte przez ${user.name}. Możesz je wznowić, odpisując w wątku.`, created_at: nowIso() });
  return { ok: true };
}, U);

// ---------- Faktury, dokumenty ----------
route('GET', '/api/invoices', async ({ user }) => {
  const [list, projects] = await Promise.all([
    findAll('invoices', { user_id: user.id, status: { $ne: 'anulowana' } }, { sort: { issue_date: -1, id: -1 } }),
    findAll('projects', { user_id: user.id }),
  ]);
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const invoices = list.map((i) => mapInvoice({ ...i, project_name: pName.get(i.project_id) }));
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

route('GET', '/api/invoices/:id', async ({ user, params }) => {
  const inv = await findOne('invoices', { id: idParam(params.id), user_id: user.id });
  if (!inv) throw new HttpError(404, 'Nie znaleziono faktury.');
  if (inv.project_id) inv.project_name = (await findOne('projects', { id: inv.project_id }))?.name;
  return {
    invoice: mapInvoice(inv, true),
    seller: company(),
    buyer: { name: user.company || user.name, contact: user.name, email: user.email, nip: user.nip },
  };
}, U);

route('GET', '/api/documents', async ({ user }) => {
  const [docs, projects] = await Promise.all([
    findAll('documents', { user_id: user.id }, { sort: { created_at: -1 } }),
    findAll('projects', { user_id: user.id }),
  ]);
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  return { documents: docs.map((d) => mapDocument({ ...d, project_name: pName.get(d.project_id) })) };
}, U);

/** Wysyła plik z GridFS do przeglądarki. */
export function streamDocument(res, d) {
  return new Promise((resolve) => {
  res.once('close', resolve);
  const ascii = d.filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'dokument';
  const stream = readFileStream(d.stored_as);
  stream.once('error', () => {
    if (!res.headersSent) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'Plik nie jest już dostępny.' })); }
    else res.destroy();
  });
  // Nagłówki wysyłamy dopiero, gdy plik faktycznie istnieje (pierwszy fragment danych)
  stream.once('data', (chunk) => {
    res.writeHead(200, {
      'Content-Type': d.mime,
      'Content-Length': d.size,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
      'Cache-Control': 'private, no-store',
    });
    res.write(chunk);
    stream.pipe(res);
  });
  });
}

route('GET', '/api/documents/:id/download', async ({ user, params, res }) => {
  const d = await findOne('documents', { id: idParam(params.id), user_id: user.id });
  if (!d) throw new HttpError(404, 'Nie znaleziono dokumentu.');
  await streamDocument(res, d);
}, U);

// ---------- Konto ----------
route('PATCH', '/api/account', async ({ req, user, body }) => {
  const set = {
    name: text(body, 'name', { label: 'Imię i nazwisko', min: 2, max: 120, required: true }),
    company: text(body, 'company', { label: 'Firma', max: 160 }),
    phone: text(body, 'phone', { label: 'Telefon', max: 40 }),
    nip: text(body, 'nip', { label: 'NIP', max: 20 }),
  };
  await update('users', { id: user.id }, set);
  audit(req, user, 'account.updated', 'user', user.id);
  return { user: publicUser(await findOne('users', { id: user.id })) };
}, U);

route('POST', '/api/account/password', async ({ req, user, body, session }) => {
  limitOr429(`pw:${user.id}`, 6, 15 * 60 * 1000);
  const row = await findOne('users', { id: user.id });
  if (!(await verifyPassword(String(body.current ?? ''), row.password_hash))) {
    throw new HttpError(422, 'Obecne hasło jest nieprawidłowe.', { current: 'Nieprawidłowe' });
  }
  const next = password(body, 'next');
  await update('users', { id: user.id }, { password_hash: await hashPassword(next) });
  await removeMany('sessions', { user_id: user.id, id: { $ne: session.sessionId } });
  audit(req, user, 'account.password_changed', 'user', user.id);
  return { ok: true };
}, U);

route('GET', '/api/account/sessions', async ({ user, session }) => {
  const list = await findAll('sessions', { user_id: user.id, expires_at: { $gt: nowIso() }, impersonator_id: null }, { sort: { last_seen_at: -1 } });
  return {
    sessions: list.map((s) => ({ id: s.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at, userAgent: s.user_agent, ip: s.ip, current: s.id === session.sessionId })),
  };
}, U);

route('DELETE', '/api/account/sessions', async ({ user, session }) => {
  const r = await removeMany('sessions', { user_id: user.id, id: { $ne: session.sessionId } });
  return { ok: true, removed: Number(r.deletedCount || 0) };
}, U);
