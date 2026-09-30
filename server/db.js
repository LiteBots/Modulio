import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

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
    phone         TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'client',
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    user_agent   TEXT NOT NULL DEFAULT '',
    ip           TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'Pakiet Business',
    stage       TEXT NOT NULL DEFAULT 'analiza',
    progress    INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS tickets (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    subject    TEXT NOT NULL,
    category   TEXT NOT NULL,
    priority   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'nowe',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id          INTEGER PRIMARY KEY,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL,             -- client | team | system
    author_name TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    number     TEXT NOT NULL UNIQUE,
    issue_date TEXT NOT NULL,
    due_date   TEXT NOT NULL,
    items      TEXT NOT NULL DEFAULT '[]',  -- [{name, qty, unit_net, vat}]
    status     TEXT NOT NULL DEFAULT 'oczekuje', -- oczekuje | oplacona | anulowana
    paid_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);

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
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    topic      TEXT NOT NULL DEFAULT '',
    message    TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'kontakt',
    status     TEXT NOT NULL DEFAULT 'nowy',
    ip         TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

const stmtCache = new Map();
/** Przygotowane zapytanie z cache */
export function q(sql) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
