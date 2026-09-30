// =====================================================================
//  Baza w pamięci zgodna z podzbiorem API sterownika `mongodb`.
//  Używana automatycznie, gdy nie ustawiono MONGO_URL (tryb lokalny/testy).
//  Dane znikają po restarcie serwera.
// =====================================================================
import { Writable, Readable } from 'node:stream';

const clone = (v) => (v === undefined ? v : structuredClone(v));
const get = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);

function cmp(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchValue(val, cond) {
  if (cond instanceof RegExp) return typeof val === 'string' && cond.test(val);
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case '$eq': return val === arg;
        case '$ne': return val !== arg && !(val === undefined && arg === null);
        case '$in': return arg.some((a) => (a instanceof RegExp ? typeof val === 'string' && a.test(val) : val === a));
        case '$nin': return !arg.includes(val);
        case '$gt': return val !== undefined && val !== null && val > arg;
        case '$gte': return val !== undefined && val !== null && val >= arg;
        case '$lt': return val !== undefined && val !== null && val < arg;
        case '$lte': return val !== undefined && val !== null && val <= arg;
        case '$exists': return arg ? val !== undefined : val === undefined;
        case '$regex': return typeof val === 'string' && new RegExp(arg, cond.$options || '').test(val);
        case '$options': return true;
        default: throw new Error(`Nieobsługiwany operator ${op}`);
      }
    });
  }
  if (cond === null) return val === null || val === undefined;
  return val === cond;
}

export function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return cond.some((f) => matches(doc, f));
    if (k === '$and') return cond.every((f) => matches(doc, f));
    return matchValue(get(doc, k), cond);
  });
}

function applyUpdate(doc, update, inserting = false) {
  for (const [op, fields] of Object.entries(update)) {
    for (const [k, v] of Object.entries(fields)) {
      if (op === '$set') doc[k] = clone(v);
      else if (op === '$inc') doc[k] = (doc[k] || 0) + v;
      else if (op === '$unset') delete doc[k];
      else if (op === '$setOnInsert') { if (inserting) doc[k] = clone(v); }
      else throw new Error(`Nieobsługiwana aktualizacja ${op}`);
    }
  }
}

class Cursor {
  constructor(rows) { this.rows = rows; this._sort = null; this._skip = 0; this._limit = 0; }
  sort(s) { this._sort = s; return this; }
  skip(n) { this._skip = n; return this; }
  limit(n) { this._limit = n; return this; }
  project() { return this; }
  async toArray() {
    let r = this.rows;
    if (this._sort) {
      const keys = Object.entries(this._sort);
      r = [...r].sort((a, b) => { for (const [k, d] of keys) { const c = cmp(get(a, k), get(b, k)); if (c) return c * d; } return 0; });
    }
    r = r.slice(this._skip, this._limit ? this._skip + this._limit : undefined);
    return r.map(clone);
  }
}

class Collection {
  constructor(name) { this.name = name; this.docs = []; this.unique = []; this.seq = 0; }
  _dupCheck(doc, except) {
    for (const key of this.unique) {
      const v = get(doc, key);
      if (v === undefined || v === null) continue;
      if (this.docs.some((d) => d !== except && get(d, key) === v)) {
        const e = new Error(`E11000 duplicate key error collection: ${this.name} index: ${key}`);
        e.code = 11000;
        throw e;
      }
    }
  }
  async createIndex(spec, opts = {}) { if (opts.unique) this.unique.push(Object.keys(spec)[0]); return 'ok'; }
  find(filter = {}) { return new Cursor(this.docs.filter((d) => matches(d, filter))); }
  async findOne(filter = {}, opts = {}) { const r = await this.find(filter).sort(opts.sort || null).limit(1).toArray(); return r[0] || null; }
  async countDocuments(filter = {}) { return this.docs.filter((d) => matches(d, filter)).length; }
  async insertOne(doc) {
    const d = clone(doc);
    if (d._id === undefined) d._id = `${this.name}_${++this.seq}`;
    this._dupCheck(d);
    this.docs.push(d);
    return { acknowledged: true, insertedId: d._id };
  }
  async insertMany(docs) { for (const d of docs) await this.insertOne(d); return { acknowledged: true, insertedCount: docs.length }; }
  async updateOne(filter, update, opts = {}) {
    let d = this.docs.find((x) => matches(x, filter));
    if (!d && opts.upsert) {
      d = {};
      for (const [k, v] of Object.entries(filter)) if (!k.startsWith('$') && (typeof v !== 'object' || v === null)) d[k] = v;
      applyUpdate(d, update, true);
      if (d._id === undefined) d._id = `${this.name}_${++this.seq}`;
      this._dupCheck(d);
      this.docs.push(d);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    if (!d) return { matchedCount: 0, modifiedCount: 0 };
    const copy = clone(d);
    applyUpdate(copy, update);
    this._dupCheck(copy, d);
    Object.keys(d).forEach((k) => delete d[k]);
    Object.assign(d, copy);
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async updateMany(filter, update) {
    const list = this.docs.filter((x) => matches(x, filter));
    list.forEach((d) => applyUpdate(d, update));
    return { matchedCount: list.length, modifiedCount: list.length };
  }
  async findOneAndUpdate(filter, update, opts = {}) {
    await this.updateOne(filter, update, opts);
    const doc = await this.findOne(filter);
    return opts.includeResultMetadata ? { value: doc } : doc;
  }
  async deleteOne(filter) {
    const i = this.docs.findIndex((x) => matches(x, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.docs = this.docs.filter((x) => !matches(x, filter));
    return { deletedCount: before - this.docs.length };
  }
}

class Db {
  constructor() { this.cols = new Map(); }
  collection(name) { if (!this.cols.has(name)) this.cols.set(name, new Collection(name)); return this.cols.get(name); }
  async command() { return { ok: 1 }; }
}

/** Minimalny odpowiednik GridFSBucket (pliki w pamięci). */
export class MemoryBucket {
  constructor() { this.files = new Map(); }
  openUploadStream(filename, opts = {}) {
    const chunks = [];
    const files = this.files;
    return new Writable({
      write(c, _e, cb) { chunks.push(c); cb(); },
      final(cb) { files.set(filename, { filename, data: Buffer.concat(chunks), contentType: opts.contentType }); cb(); },
    });
  }
  openDownloadStreamByName(filename) {
    const f = this.files.get(filename);
    if (!f) { const r = new Readable({ read() {} }); process.nextTick(() => r.destroy(new Error('FileNotFound'))); return r; }
    return Readable.from([f.data]);
  }
  find(filter) { return { toArray: async () => [...this.files.values()].filter((f) => f.filename === filter.filename).map((f) => ({ _id: f.filename, filename: f.filename, length: f.data.length })) }; }
  async delete(id) { this.files.delete(id); }
}

export function createMemoryDb() { return new Db(); }
