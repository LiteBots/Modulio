import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

fs.mkdirSync(path.join(config.dataDir, 'files'), { recursive: true });

export const FILES_DIR = path.join(config.dataDir, 'files');
export const db = new DatabaseSync(path.join(config.dataDir, 'modulio.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    company       TEXT NOT NULL DEFAULT '',
    nip           TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'client',   -- client | staff | admin
    status        TEXT NOT NULL DEFAULT 'active',   -- active | blocked
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY,
    token_hash      TEXT NOT NULL UNIQUE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    impersonator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL,
    user_agent      TEXT NOT NULL DEFAULT '',
    ip              TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'Pakiet Business',
    stage       TEXT NOT NULL DEFAULT 'do_zrobienia',
    priority    TEXT NOT NULL DEFAULT 'normalny',
    progress    INTEGER NOT NULL DEFAULT 0,
    budget      REAL NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    modules     TEXT NOT NULL DEFAULT '[]',
    manager     TEXT NOT NULL DEFAULT '',
    start_date  TEXT,
    due_date    TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

  CREATE TABLE IF NOT EXISTS milestones (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    due_date   TEXT,
    done       INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS project_updates (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    author     TEXT NOT NULL DEFAULT 'Zespół Modulio',
    created_at TEXT NOT NULL
  );

  -- Aktywne oprogramowanie (systemy uruchomione u klientów, abonamenty)
  CREATE TABLE IF NOT EXISTS software (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    plan         TEXT NOT NULL DEFAULT 'Business',
    modules      TEXT NOT NULL DEFAULT '[]',
    monthly_fee  REAL NOT NULL DEFAULT 0,
    users_limit  INTEGER NOT NULL DEFAULT 10,
    url          TEXT NOT NULL DEFAULT '',
    version      TEXT NOT NULL DEFAULT '1.0',
    status       TEXT NOT NULL DEFAULT 'aktywne',   -- aktywne | zawieszone | wygasle
    started_at   TEXT,
    renewal_date TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subject     TEXT NOT NULL,
    category    TEXT NOT NULL,
    priority    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'nowe',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id          INTEGER PRIMARY KEY,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL,             -- client | team | system | internal
    author_name TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    number        TEXT NOT NULL UNIQUE,
    issue_date    TEXT NOT NULL,
    due_date      TEXT NOT NULL,
    items         TEXT NOT NULL DEFAULT '[]',  -- [{name, qty, unit_net, vat}]
    discount_code TEXT NOT NULL DEFAULT '',
    discount_pct  REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'oczekuje', -- oczekuje | oplacona | anulowana
    paid_at       TEXT,
    created_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);

  CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     REAL NOT NULL,
    method     TEXT NOT NULL DEFAULT 'przelew',
    paid_at    TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'inne',
    filename   TEXT NOT NULL,
    stored_as  TEXT NOT NULL,
    mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
    size       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    phone       TEXT NOT NULL DEFAULT '',
    company     TEXT NOT NULL DEFAULT '',
    topic       TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'kontakt',
    utm_source  TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'nowy',  -- nowy | w_kontakcie | oferta | wygrany | przegrany
    value       REAL NOT NULL DEFAULT 0,
    notes       TEXT NOT NULL DEFAULT '',
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ip          TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    tone       TEXT NOT NULL DEFAULT 'info',  -- info | success | warning
    active     INTEGER NOT NULL DEFAULT 1,
    starts_at  TEXT,
    ends_at    TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS newsletter (
    id              INTEGER PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    source          TEXT NOT NULL DEFAULT 'stopka',
    created_at      TEXT NOT NULL,
    unsubscribed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS discount_codes (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    percent     REAL NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    max_uses    INTEGER NOT NULL DEFAULT 0,   -- 0 = bez limitu
    used        INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    expires_at  TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name  TEXT NOT NULL DEFAULT '',
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL DEFAULT '',
    entity_id  INTEGER,
    details    TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);

// ---------- Migracje dla baz z wersji 2.0 ----------
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('users', 'nip', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
addColumn('users', 'notes', "TEXT NOT NULL DEFAULT ''");
addColumn('sessions', 'impersonator_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE');
addColumn('projects', 'priority', "TEXT NOT NULL DEFAULT 'normalny'");
addColumn('projects', 'budget', 'REAL NOT NULL DEFAULT 0');
addColumn('tickets', 'assigned_to', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumn('invoices', 'discount_code', "TEXT NOT NULL DEFAULT ''");
addColumn('invoices', 'discount_pct', 'REAL NOT NULL DEFAULT 0');
addColumn('invoices', 'created_at', 'TEXT');
for (const [c, d] of [['company', "TEXT NOT NULL DEFAULT ''"], ['utm_source', "TEXT NOT NULL DEFAULT ''"], ['value', 'REAL NOT NULL DEFAULT 0'], ['notes', "TEXT NOT NULL DEFAULT ''"], ['assigned_to', 'INTEGER'], ['user_id', 'INTEGER'], ['updated_at', 'TEXT']]) addColumn('leads', c, d);

const stmtCache = new Map();
/** Przygotowane zapytanie z cache */
export function q(sql) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}

let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { txDepth--; }
}

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
