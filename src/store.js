// Persistence for the self-updating board.
//
// Production uses a SQLite-backed Durable Object (class BoardStore) so the
// deployment can define its own storage without CF administration credentials
// in GitHub. The same method names are implemented by an in-memory store and a
// file-backed store for tests and the local cron simulation.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS observations (
     key TEXT PRIMARY KEY,
     payload TEXT NOT NULL,
     observed_at TEXT,
     attempted_at TEXT,
     last_error TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS vendor_state (
     vendor_id TEXT PRIMARY KEY,
     payload TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     payload TEXT NOT NULL,
     started_at TEXT,
     finished_at TEXT
   )`
];

export const STORE_INTERFACE = [
  'listObservations', 'putObservation', 'markAttempt',
  'getVendorState', 'setVendorState', 'getMeta', 'setMeta',
  'recordRun', 'listRuns', 'acquireLease', 'releaseLease'
];

export class BoardStore {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
    this.sql = state.storage.sql;
    for (const statement of SCHEMA) this.sql.exec(statement);
    this.methods = {
      snapshot: () => this.snapshot(),
      listObservations: () => this.listObservations(),
      putObservation: args => this.putObservation(args[0]),
      markAttempt: args => this.markAttempt(args[0]),
      getVendorState: args => this.getVendorState(args[0]),
      setVendorState: args => this.setVendorState(args[0], args[1]),
      getMeta: args => this.getMeta(args[0]),
      setMeta: args => this.setMeta(args[0], args[1]),
      recordRun: args => this.recordRun(args[0]),
      listRuns: args => this.listRuns(args[0] ?? 10),
      acquireLease: args => this.acquireLease(args[0], args[1], args[2]),
      releaseLease: args => this.releaseLease(args[0])
    };
  }

  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const method = this.methods[body?.op];
    if (!method) return Response.json({ error: `unknown op ${body?.op}` }, { status: 400 });
    try {
      return Response.json({ result: await method(body.args ?? []) });
    } catch (error) {
      return Response.json({ error: error?.message ?? String(error) }, { status: 500 });
    }
  }

  async listObservations() {
    return this.sql.exec('SELECT key, payload, observed_at, attempted_at, last_error FROM observations').toArray()
      .map(row => ({
        ...JSON.parse(row.payload),
        key: row.key,
        observedAt: row.observed_at,
        attemptedAt: row.attempted_at,
        lastError: row.last_error
      }));
  }

  async putObservation(observation) {
    this.sql.exec(
      `INSERT INTO observations (key, payload, observed_at, attempted_at, last_error)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, observed_at = excluded.observed_at, attempted_at = excluded.attempted_at, last_error = NULL`,
      observation.key,
      JSON.stringify(observation),
      observation.observedAt ?? null,
      observation.attemptedAt ?? observation.observedAt ?? null
    );
  }

  async markAttempt({ key, attemptedAt, error }) {
    this.sql.exec('UPDATE observations SET attempted_at = ?, last_error = ? WHERE key = ?', attemptedAt, error ?? null, key);
    this.sql.exec(
      `INSERT INTO observations (key, payload, observed_at, attempted_at, last_error)
       SELECT ?, ?, NULL, ?, ? WHERE NOT EXISTS (SELECT 1 FROM observations WHERE key = ?)`,
      key, '{}', attemptedAt, error ?? null, key
    );
  }

  async snapshot() {
    return {
      observations: await this.listObservations(),
      vendors: this.listVendorState(),
      runs: await this.listRuns(5),
      meta: this.allMeta()
    };
  }

  listVendorState() {
    const out = {};
    for (const row of this.sql.exec('SELECT vendor_id, payload FROM vendor_state').toArray()) {
      out[row.vendor_id] = JSON.parse(row.payload);
    }
    return out;
  }

  allMeta() {
    const out = {};
    for (const row of this.sql.exec('SELECT key, value FROM meta').toArray()) {
      out[row.key] = JSON.parse(row.value);
    }
    return out;
  }

  async getVendorState(vendorId) {
    const row = this.sql.exec('SELECT payload FROM vendor_state WHERE vendor_id = ?', vendorId).toArray()[0];
    return row ? JSON.parse(row.payload) : null;
  }

  async setVendorState(vendorId, value) {
    this.sql.exec(
      `INSERT INTO vendor_state (vendor_id, payload) VALUES (?, ?)
       ON CONFLICT(vendor_id) DO UPDATE SET payload = excluded.payload`,
      vendorId, JSON.stringify(value)
    );
  }

  async getMeta(key) {
    const row = this.sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
    return row ? JSON.parse(row.value) : null;
  }

  async setMeta(key, value) {
    this.sql.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key, JSON.stringify(value)
    );
  }

  async recordRun(run) {
    this.sql.exec('INSERT INTO runs (payload, started_at, finished_at) VALUES (?, ?, ?)', JSON.stringify(run), run.startedAt ?? null, run.finishedAt ?? null);
  }

  async listRuns(limit = 10) {
    return this.sql.exec('SELECT payload FROM runs ORDER BY id DESC LIMIT ?', limit).toArray().map(row => JSON.parse(row.payload));
  }

  async acquireLease(name, holderId, ttlMs) {
    const current = await this.getMeta(`lease:${name}`);
    const now = Date.now();
    if (current && current.expiresAt > now && current.holderId !== holderId) return false;
    await this.setMeta(`lease:${name}`, { holderId, expiresAt: now + ttlMs, acquiredAt: new Date(now).toISOString() });
    return true;
  }

  async releaseLease(name) {
    await this.setMeta(`lease:${name}`, null);
  }
}

/** Client for the DO; safe to call from a Worker request or scheduled handler. */
export function durableStore(env) {
  const id = env.BOARD.idFromName('board');
  return env.BOARD.get(id);
}

export async function callStore(stub, op, args = []) {
  const response = await stub.fetch('https://board.internal/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, args })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? `store error ${response.status}`);
  return payload.result;
}

export function storeClient(stub) {
  const call = (op, ...args) => callStore(stub, op, args);
  return {
    listObservations: () => call('listObservations'),
    putObservation: observation => call('putObservation', observation),
    markAttempt: attempt => call('markAttempt', attempt),
    getVendorState: vendorId => call('getVendorState', vendorId),
    setVendorState: (vendorId, value) => call('setVendorState', vendorId, value),
    getMeta: key => call('getMeta', key),
    setMeta: (key, value) => call('setMeta', key, value),
    recordRun: run => call('recordRun', run),
    listRuns: limit => call('listRuns', limit),
    acquireLease: (name, holderId, ttlMs) => call('acquireLease', name, holderId, ttlMs),
    releaseLease: name => call('releaseLease', name),
    snapshot: () => call('snapshot')
  };
}

/** In-memory implementation with the same interface, used by tests. */
export function createMemoryStore(initial = {}) {
  const observations = new Map();
  for (const observation of initial.observations ?? []) observations.set(observation.key, observation);
  const vendors = new Map(Object.entries(initial.vendors ?? {}));
  const meta = new Map(Object.entries(initial.meta ?? {}));
  const runs = [...(initial.runs ?? [])];
  return {
    async listObservations() {
      return [...observations.values()].map(item => ({ ...item }));
    },
    async putObservation(observation) {
      observations.set(observation.key, { ...observation });
    },
    async markAttempt({ key, attemptedAt, error }) {
      const existing = observations.get(key) ?? { key, product: {}, price: {}, shipping: {} };
      observations.set(key, { ...existing, attemptedAt, lastError: error ?? null });
    },
    async getVendorState(vendorId) {
      return vendors.has(vendorId) ? { ...vendors.get(vendorId) } : null;
    },
    async setVendorState(vendorId, value) {
      vendors.set(vendorId, { ...value });
    },
    async getMeta(key) {
      return meta.has(key) ? { ...meta.get(key) } : null;
    },
    async setMeta(key, value) {
      if (value == null) meta.delete(key);
      else meta.set(key, { ...value });
    },
    async recordRun(run) {
      runs.push({ ...run });
    },
    async listRuns(limit = 10) {
      return runs.slice(-limit).reverse();
    },
    async acquireLease(name, holderId, ttlMs) {
      const current = meta.get(`lease:${name}`);
      const now = Date.now();
      if (current && current.expiresAt > now && current.holderId !== holderId) return false;
      meta.set(`lease:${name}`, { holderId, expiresAt: now + ttlMs, acquiredAt: new Date(now).toISOString() });
      return true;
    },
    async releaseLease(name) {
      meta.delete(`lease:${name}`);
    },
    async snapshot() {
      return {
        observations: [...observations.values()].map(item => ({ ...item })),
        vendors: Object.fromEntries([...vendors.entries()].map(([id, value]) => [id, { ...value }])),
        runs: runs.slice(-5).reverse(),
        meta: Object.fromEntries(meta)
      };
    }
  };
}

/** File-backed store for the local cron simulation (gitignored path). */
export async function createFileStore(path) {
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  let state = {};
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    state = { observations: [], vendors: {}, meta: {}, runs: [] };
  }
  const memory = createMemoryStore(state);
  return {
    ...memory,
    async flush() {
      await mkdir(dirname(path), { recursive: true });
      const snapshot = await memory.snapshot();
      await writeFile(path, `${JSON.stringify({ ...snapshot, runs: await memory.listRuns(20) }, null, 2)}\n`);
    }
  };
}
