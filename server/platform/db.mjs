import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

// PostgreSQL session settings drive CURRENT_DATE, and every pooled connection starts
// from the server default. Pin the zone on each acquired connection so a managed
// database running in UTC still reports the barangay's calendar day.
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
    });
    const acquire = pool.connect.bind(pool);
    pool.connect = async (...args) => {
      const client = await acquire(...args);
      try {
        await setSessionTimeZone(client);
      } catch (error) {
        client.release();
        throw error;
      }
      return client;
    };
    pool.query = async (text, values) => {
      const client = await pool.connect();
      try {
        return await client.query(text, values);
      } finally {
        client.release();
      }
    };
    await pool.query("SELECT 1");
    return pool;
  }
  await mkdir(path.dirname(dataDir), { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  await setSessionTimeZone(db);
  return db;
}

export async function withTransaction(db, work) {
  const client = typeof db.connect === "function" ? await db.connect() : db;
  try {
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
  } finally {
    if (client !== db) client.release();
  }
}
