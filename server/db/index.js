// =====================================================================
//  Warstwa danych — MongoDB (Railway) lub baza w pamięci (lokalnie).
//
//  Każdy dokument ma liczbowe pole `id` (licznik w kolekcji `counters`),
//  dzięki czemu adresy URL i relacje pozostają czytelne: /admin/uzytkownicy/12.
//  Daty przechowywane są jako tekst ISO (sortowanie i porównania działają).
// =====================================================================
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { createMemoryDb, MemoryBucket } from './memory.js';

let db = null;
let bucket = null;
let client = null;
export let usingMemory = false;

export const COLLECTIONS = [
  'users', 'sessions', 'projects', 'milestones', 'project_updates', 'software', 'tickets', 'ticket_messages',
  'invoices', 'payments', 'documents', 'leads', 'announcements', 'newsletter', 'discount_codes', 'settings', 'audit_log',
];

export async function connectDb() {
  if (db) return db;
  if (config.mongoUrl) {
    const { MongoClient, GridFSBucket } = await import('mongodb');
    client = new MongoClient(config.mongoUrl, { maxPoolSize: 20, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    db = client.db(config.mongoDbName);
    bucket = new GridFSBucket(db, { bucketName: 'files' });
    console.log(`  [db] Połączono z MongoDB (baza: ${config.mongoDbName})`);
  } else {
    db = createMemoryDb();
    bucket = new MemoryBucket();
    usingMemory = true;
    console.log('  [db] Brak MONGO_URL — używam bazy w pamięci (dane znikną po restarcie).');
  }
  await ensureIndexes();
  return db;
}

async function ensureIndexes() {
  const idx = async (name, spec, opts = {}) => { try { await db.collection(name).createIndex(spec, opts); } catch (e) { console.warn(`[db] indeks ${name}:`, e.message); } };
  for (const c of COLLECTIONS) if (c !== 'settings') await idx(c, { id: 1 }, { unique: true });
  await idx('users', { email: 1 }, { unique: true });
  await idx('sessions', { token_hash: 1 }, { unique: true });
  await idx('sessions', { user_id: 1 });
  await idx('invoices', { number: 1 }, { unique: true });
  await idx('invoices', { user_id: 1 });
  await idx('newsletter', { email: 1 }, { unique: true });
  await idx('discount_codes', { code: 1 }, { unique: true });
  await idx('settings', { key: 1 }, { unique: true });
  await idx('projects', { user_id: 1 });
  await idx('tickets', { user_id: 1 });
  await idx('ticket_messages', { ticket_id: 1 });
  await idx('milestones', { project_id: 1 });
  await idx('payments', { invoice_id: 1 });
  await idx('audit_log', { created_at: -1 });
}

export async function closeDb() { if (client) await client.close(); }

export const col = (name) => db.collection(name);

// ---------------------------------------------------------------------
// Pomocnicze operacje (zwracają zwykłe obiekty bez `_id`)
// ---------------------------------------------------------------------
const strip = (d) => { if (!d) return d; const { _id, ...rest } = d; return rest; };

export async function nextId(name) {
  const r = await col('counters').findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  const doc = r && r.value !== undefined && r.seq === undefined ? r.value : r; // zgodność ze sterownikiem v5 i v6
  return doc.seq;
}

/** Wstawia dokument z nowym liczbowym id. Zwraca wstawiony obiekt. */
export async function insert(name, doc) {
  const id = await nextId(name);
  const full = { id, ...doc };
  await col(name).insertOne({ ...full });
  return full;
}

export async function findAll(name, filter = {}, { sort, limit, skip } = {}) {
  let c = col(name).find(filter);
  if (sort) c = c.sort(sort);
  if (skip) c = c.skip(skip);
  if (limit) c = c.limit(limit);
  return (await c.toArray()).map(strip);
}

export async function findOne(name, filter, opts = {}) {
  return strip(await col(name).findOne(filter, opts));
}

export const byId = (name, id) => findOne(name, { id: Number(id) });

export async function update(name, filter, set, extra = {}) {
  const u = { ...extra };
  if (set && Object.keys(set).length) u.$set = set;
  return col(name).updateOne(filter, u);
}

export async function updateMany(name, filter, set) {
  return col(name).updateMany(filter, { $set: set });
}

export async function remove(name, filter) { return col(name).deleteOne(filter); }
export async function removeMany(name, filter) { return col(name).deleteMany(filter); }
export async function count(name, filter = {}) { return col(name).countDocuments(filter); }

/** Mapa id → dokument (do „złączeń” w JS). */
export async function mapById(name, filter = {}) {
  return new Map((await findAll(name, filter)).map((d) => [d.id, d]));
}

// ---------------------------------------------------------------------
// Pliki (GridFS w MongoDB — trwałe także na Railway)
// ---------------------------------------------------------------------
export async function saveFile(filename, buffer, contentType) {
  await pipeline(Readable.from([buffer]), bucket.openUploadStream(filename, { contentType, metadata: { contentType } }));
}

export function readFileStream(filename) {
  return bucket.openDownloadStreamByName(filename);
}

export async function deleteFile(filename) {
  const files = await bucket.find({ filename }).toArray();
  for (const f of files) await bucket.delete(f._id);
}

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
