import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

// PostgreSQL session settings drive CURRENT_DATE, and every pooled connection starts
// from the server default. PGlite takes its zone from its own session; managed
// PostgreSQL gets the zone through the startup packet (`options`), so no extra
// round trip is paid per borrowed connection.
//
// PGlite runs one session with no pool. Every query — a single statement or a
// whole transaction — must reach the database inside one queued unit, or two
// requests (or a request and a periodic maintenance job) land in the same open
// transaction and destroy each other's writes. Queueing is in-process only.
// shortcut: one shared queue, fine for the single-process PGlite deployment; managed PostgreSQL keeps real per-connection isolation. Upgrade path: drop the queue if PGlite ever supports sessions.
let pgliteQueue = Promise.resolve();
function enqueue(work) {
  const run = pgliteQueue.then(work);
  // A failed unit must not jam the queue for the next caller.
  pgliteQueue = run.catch(() => {});
  return run;
}

function queuedPglite(db) {
  return {
    query: (text, params) => enqueue(() => db.query(text, params)),
    close: () => db.close(),
    // The queue already serializes units; transactions just run inline inside theirs.
    raw: db,
  };
}

export async function createDatabase({ dataDir, databaseUrl, poolMax, connectionTimeoutMillis, timeZone }) {
  const setSessionTimeZone = (client) => client.query("SELECT set_config('TimeZone', $1, false)", [timeZone]);
  if (databaseUrl) {
    const { Pool } = await import("pg");
    // A managed PostgreSQL provider that issues a private certificate (for example
    // Amazon RDS) is not in the public root store. DATABASE_CA, holding the provider's
    // CA bundle as PEM, lets the strict certificate check pass only for that CA;
    // without it, the default public-root check applies and NODE_EXTRA_CA_CERTS also works.
    const databaseCa = typeof process.env.DATABASE_CA === "string" && process.env.DATABASE_CA.trim() ? process.env.DATABASE_CA : null;
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseCa ? { rejectUnauthorized: true, ca: databaseCa } : { rejectUnauthorized: true },
      max: poolMax,
      connectionTimeoutMillis,
      idleTimeoutMillis: 30000,
      options: `-c TimeZone=${timeZone}`,
    });
    await pool.query("SELECT 1");
    return pool;
  }
  await mkdir(path.dirname(dataDir), { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  await setSessionTimeZone(db);
  return queuedPglite(db);
}

async function runInTransaction(client, work) {
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("CommUnity database transaction rollback failed.", rollbackError);
    }
    throw error;
  }
}

export async function withTransaction(db, work) {
  if (typeof db.connect === "function") {
    const client = await db.connect();
    try {
      return await runInTransaction(client, work);
    } finally {
      client.release();
    }
  }
  // The facade queues its own statements; a transaction needs the raw session so
  // its statements stay inside the unit this call enqueues.
  const raw = db.raw ?? db;
  return enqueue(() => runInTransaction(raw, work));
}
