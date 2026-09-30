#!/usr/bin/env node
// Narzędzie administracyjne Modulio (bez panelu admina).
// Użycie: npm run cli -- <komenda> [opcje]   |   npm run cli -- help
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { q, nowIso, FILES_DIR } from '../server/db/index.js';
import { hashPassword } from '../server/lib/auth.js';
import { createDemoAccount, seedPlatform } from '../server/db/seed.js';
import { STAGES } from '../server/api/router.js';
import { invoiceTotals } from '../server/lib/money.js';

const [, , cmd, ...rest] = process.argv;
const { values: o, positionals: pos } = parseArgs({
  args: rest, allowPositionals: true, strict: false,
  options: {
    email: { type: 'string' }, name: { type: 'string' }, company: { type: 'string' }, password: { type: 'string' },
    user: { type: 'string' }, project: { type: 'string' }, stage: { type: 'string' }, progress: { type: 'string' },
    title: { type: 'string' }, body: { type: 'string' }, due: { type: 'string' }, manager: { type: 'string' },
    kind: { type: 'string' }, description: { type: 'string' }, modules: { type: 'string' }, status: { type: 'string' },
    number: { type: 'string' }, item: { type: 'string', multiple: true }, file: { type: 'string' }, category: { type: 'string' },
    author: { type: 'string' }, limit: { type: 'string' }, role: { type: 'string' },
  },
});

const die = (m) => { console.error(`✖ ${m}`); process.exit(1); };
const need = (v, label) => { if (!v) die(`Brak opcji --${label}`); return v; };
const userBy = (v) => q('SELECT * FROM users WHERE id = ? OR email = ?').get(Number(v) || -1, String(v)) || die(`Nie ma użytkownika: ${v}`);
const today = () => new Date().toISOString().slice(0, 10);

const commands = {
  help() {
    console.log(`
Modulio CLI

Użytkownicy
  admin:create --email E --name N [--password P]                konto administratora (dostęp do /admin)
  user:create --email E --name N [--company C] [--password P] [--role client|staff|admin]
  user:list
  user:password --user EMAIL|ID [--password P]
  demo                                                          konto demo z przykładowymi danymi

Leady z formularza
  leads [--limit 20]
  lead:status <id> --status nowy|w_kontakcie|klient|odrzucony

Projekty
  project:create --user U --name N [--kind K] [--description D] [--modules "A,B"] [--manager M] [--due RRRR-MM-DD]
  project:update <id> [--stage ${STAGES.map((s) => s.key).join('|')}] [--progress 0-100]
  milestone:add --project P --title T [--due RRRR-MM-DD]
  milestone:done <id>
  update:post --project P --title T [--body B] [--author A]

Zgłoszenia
  tickets [--status nowe]
  ticket:show <id>
  ticket:reply <id> --body "Treść" [--author "Imię"] [--status oczekuje_na_klienta|w_toku|rozwiazane]
  ticket:status <id> --status nowe|w_toku|oczekuje_na_klienta|rozwiazane|zamkniete

Faktury i dokumenty
  invoice:add --user U --number FV/2026/10/001 --due RRRR-MM-DD --item "Nazwa;ilość;cena_netto;vat" [--item ...] [--project P]
  invoice:paid <id>
  doc:add --user U --file ścieżka.pdf [--name "Nazwa"] [--category umowa|specyfikacja|protokol|instrukcja|inne] [--project P]
`);
  },

  async 'admin:create'() { o.role = 'admin'; return commands['user:create'](); },
  async 'user:create'() {
    const email = need(o.email, 'email').toLowerCase();
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) die('Taki e-mail już istnieje.');
    const pw = o.password || crypto.randomBytes(9).toString('base64url');
    const role = ['client', 'staff', 'admin'].includes(o.role) ? o.role : 'client';
    q('INSERT INTO users (email, password_hash, name, company, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(email, await hashPassword(pw), need(o.name, 'name'), o.company || '', role, nowIso());
    console.log(`✔ Utworzono konto ${email}${o.password ? '' : `\n  Hasło tymczasowe: ${pw}`}`);
  },
  'user:list'() {
    console.table(q('SELECT id, email, name, company, role, created_at, last_login_at FROM users ORDER BY id').all());
  },
  async 'user:password'() {
    const u = userBy(need(o.user, 'user'));
    const pw = o.password || crypto.randomBytes(9).toString('base64url');
    q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), u.id);
    q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    console.log(`✔ Nowe hasło dla ${u.email}: ${pw} (wszystkie sesje wylogowane)`);
  },
  async demo() {
    if (q('SELECT 1 FROM users WHERE email = ?').get('demo@modulio.pl')) die('Konto demo już istnieje.');
    await createDemoAccount();
    if (!q('SELECT 1 FROM users WHERE email = ?').get('admin@modulio.pl')) await seedPlatform();
    console.log('✔ demo@modulio.pl / Demo1234!  ·  admin@modulio.pl / Admin1234!');
  },

  leads() {
    console.table(q('SELECT id, created_at, status, topic, name, email, phone, substr(message, 1, 60) AS message FROM leads ORDER BY id DESC LIMIT ?').all(Number(o.limit || 20)));
  },
  'lead:status'() {
    q('UPDATE leads SET status = ? WHERE id = ?').run(need(o.status, 'status'), Number(pos[0]));
    console.log('✔ Zaktualizowano');
  },

  'project:create'() {
    const u = userBy(need(o.user, 'user'));
    const r = q(`INSERT INTO projects (user_id, name, kind, stage, progress, description, modules, manager, start_date, due_date, created_at)
      VALUES (?, ?, ?, 'analiza', 0, ?, ?, ?, ?, ?, ?)`).run(u.id, need(o.name, 'name'), o.kind || 'Pakiet Business', o.description || '',
      JSON.stringify((o.modules || '').split(',').map((s) => s.trim()).filter(Boolean)), o.manager || '', today(), o.due || null, nowIso());
    console.log(`✔ Projekt #${r.lastInsertRowid}`);
  },
  'project:update'() {
    const id = Number(pos[0]);
    if (o.stage) {
      if (!STAGES.some((s) => s.key === o.stage)) die('Nieznany etap.');
      q('UPDATE projects SET stage = ? WHERE id = ?').run(o.stage, id);
    }
    if (o.progress !== undefined) q('UPDATE projects SET progress = ? WHERE id = ?').run(Math.max(0, Math.min(100, Number(o.progress))), id);
    console.log('✔ Zaktualizowano');
  },
  'milestone:add'() {
    const pid = Number(need(o.project, 'project'));
    const { m } = q('SELECT COALESCE(MAX(position), -1) + 1 AS m FROM milestones WHERE project_id = ?').get(pid);
    q('INSERT INTO milestones (project_id, title, due_date, position) VALUES (?, ?, ?, ?)').run(pid, need(o.title, 'title'), o.due || null, m);
    console.log('✔ Dodano kamień milowy');
  },
  'milestone:done'() { q('UPDATE milestones SET done = 1 WHERE id = ?').run(Number(pos[0])); console.log('✔ Oznaczono jako wykonany'); },
  'update:post'() {
    q('INSERT INTO project_updates (project_id, title, body, author, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(Number(need(o.project, 'project')), need(o.title, 'title'), o.body || '', o.author || 'Zespół Modulio', nowIso());
    console.log('✔ Opublikowano aktualizację');
  },

  tickets() {
    const rows = o.status
      ? q(`SELECT t.id, 'MOD-' || (1000 + t.id) AS nr, t.status, t.priority, u.email, t.subject, t.updated_at FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.status = ? ORDER BY t.updated_at DESC`).all(o.status)
      : q(`SELECT t.id, 'MOD-' || (1000 + t.id) AS nr, t.status, t.priority, u.email, t.subject, t.updated_at FROM tickets t JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 50`).all();
    console.table(rows);
  },
  'ticket:show'() {
    const t = q('SELECT * FROM tickets WHERE id = ?').get(Number(pos[0])) || die('Brak zgłoszenia');
    console.log(`\nMOD-${1000 + t.id} · ${t.subject} [${t.status}/${t.priority}]\n`);
    for (const m of q('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at').all(t.id)) {
      console.log(`— ${m.author_name} (${m.author_type}) ${m.created_at}\n${m.body}\n`);
    }
  },
  'ticket:reply'() {
    const id = Number(pos[0]);
    const now = nowIso();
    q(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body, created_at) VALUES (?, 'team', ?, ?, ?)`)
      .run(id, o.author || 'Zespół Modulio', need(o.body, 'body'), now);
    q('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(o.status || 'oczekuje_na_klienta', now, id);
    console.log('✔ Odpowiedź dodana');
  },
  'ticket:status'() { q('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(need(o.status, 'status'), nowIso(), Number(pos[0])); console.log('✔ Zmieniono status'); },

  'invoice:add'() {
    const u = userBy(need(o.user, 'user'));
    const items = (o.item || []).map((s) => {
      const [name, qty, net, vat] = s.split(';');
      return { name, qty: Number(qty || 1), unit_net: Number(net), vat: Number(vat ?? 23) };
    });
    if (!items.length) die('Dodaj co najmniej jedną pozycję --item');
    q('INSERT INTO invoices (user_id, project_id, number, issue_date, due_date, items) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, o.project ? Number(o.project) : null, need(o.number, 'number'), today(), need(o.due, 'due'), JSON.stringify(items));
    console.log(`✔ Faktura dodana, brutto: ${invoiceTotals(items).gross.toFixed(2)} zł`);
  },
  'invoice:paid'() { q(`UPDATE invoices SET status = 'oplacona', paid_at = ? WHERE id = ?`).run(nowIso(), Number(pos[0])); console.log('✔ Oznaczono jako opłaconą'); },

  'doc:add'() {
    const u = userBy(need(o.user, 'user'));
    const src = path.resolve(need(o.file, 'file'));
    if (!fs.existsSync(src)) die('Plik nie istnieje');
    const ext = path.extname(src).toLowerCase();
    const mime = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip' }[ext] || 'application/octet-stream';
    const stored = `${crypto.randomUUID()}${ext}`;
    fs.copyFileSync(src, path.join(FILES_DIR, stored));
    q(`INSERT INTO documents (user_id, project_id, name, category, filename, stored_as, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(u.id, o.project ? Number(o.project) : null, o.name || path.basename(src, ext), o.category || 'inne', path.basename(src), stored, mime, fs.statSync(src).size, nowIso());
    console.log('✔ Dokument dodany');
  },
};

const fn = commands[cmd || 'help'];
if (!fn) die(`Nieznana komenda: ${cmd}. Zobacz: npm run cli -- help`);
await fn();
