// Rehearse the managed-PostgreSQL backup procedure the README documents.
//
// Boots a throwaway PostgreSQL 18 cluster, applies the real schema, seeds a few
// rows across the main tables, then runs the documented round trip:
//
//   pg_dump --format=custom  ->  pg_restore into a fresh database  ->  migrate()
//
// It then compares the row count and a deterministic content checksum of every
// public table. The cluster is disposable; nothing touches a real deployment.
//
// Requires pg_dump and pg_restore on PATH, or set PG_BIN to the directory that
// contains them (for example C:\Program Files\PostgreSQL\18\bin on Windows).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { migrate } from "../server/index.mjs";

const run = promisify(execFile);
const PG_PASSWORD = "community-restore-rehearsal";
const PG_USER = "postgres";

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startCluster(base, port) {
  const embedded = new EmbeddedPostgres({
    databaseDir: path.join(base, "data"),
    user: PG_USER,
    password: PG_PASSWORD,
    port,
    persistent: true,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    onError: () => {},
  });
  await embedded.initialise();
  await embedded.start();
  return embedded;
}

function connectionString(port, database) {
  return `postgresql://${PG_USER}:${encodeURIComponent(PG_PASSWORD)}@127.0.0.1:${port}/${database}`;
}

async function publicTables(pool) {
  const result = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY tablename",
  );
  return result.rows.map((row) => row.tablename);
}

// Count rows and hash their text form in a stable order, so a restore that
// silently drops or rewrites a row is caught even when counts happen to match.
async function tableFingerprint(pool, table) {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  const result = await pool.query(
    `SELECT count(*)::integer AS count, coalesce(md5(string_agg(row_text, E'\\n' ORDER BY row_text)), '') AS checksum
       FROM (SELECT ${quoted}::text AS row_text FROM ${quoted}) rows`,
  );
  return result.rows[0];
}

async function seed(pool) {
  await pool.query(
    `INSERT INTO users (id, email, name, area, role, status, working_hours)
     VALUES
       ('U-ADMIN', 'admin@restore.test', 'Restore Admin', 'Purok 1', 'administrator', 'Active', 'Monday-Friday, 8:00 AM-5:00 PM'),
       ('U-OFFICIAL', 'official@restore.test', 'Restore Official', 'Purok 2', 'official', 'Active', 'Monday-Friday, 8:00 AM-5:00 PM'),
       ('U-RESIDENT', 'resident@restore.test', 'Restore Resident', 'Purok 3', 'resident', 'Active', 'Monday-Friday, 8:00 AM-5:00 PM')`,
  );
  await pool.query(
    `INSERT INTO user_credentials (user_id, password_hash)
     VALUES ('U-ADMIN', 'scrypt$00$00'), ('U-OFFICIAL', 'scrypt$00$00'), ('U-RESIDENT', 'scrypt$00$00')`,
  );
  await pool.query(
    `INSERT INTO reports (id, user_email, name, category, title, area, description, status, submitted_at, updated_at)
     VALUES ('R-RESTORE-1', 'resident@restore.test', 'Restore Resident', 'Drainage problem', 'Blocked canal', 'Purok 3',
             'The canal beside the hall is blocked.', 'Under Review', '2026-02-01T08:00:00Z', '2026-02-02T09:00:00Z')`,
  );
  await pool.query(
    `INSERT INTO report_history (report_id, position, status, at, note, actor_name, actor_role)
     VALUES ('R-RESTORE-1', 0, 'Submitted', '2026-02-01T08:00:00Z', 'Report received.', 'Restore Resident', 'resident'),
            ('R-RESTORE-1', 1, 'Under Review', '2026-02-02T09:00:00Z', 'Reviewing.', 'Restore Official', 'official')`,
  );
  await pool.query(
    `INSERT INTO report_photos (report_id, position, name, photo_url)
     VALUES ('R-RESTORE-1', 0, 'canal.jpg', '/api/reports/R-RESTORE-1/photos/0')`,
  );
  await pool.query(
    `INSERT INTO report_follow_ups (report_id, user_email, message)
     VALUES ('R-RESTORE-1', 'resident@restore.test', 'Any update?')`,
  );
  await pool.query(
    `INSERT INTO schedules (id, area, zone, date, waste_type, start_time, end_time, frequency, team, status)
     VALUES ('S-RESTORE-1', 'Purok 3', 'Zone A', '2026-02-05', 'Biodegradable', '06:00', '09:00', 'Weekly', 'Team A', 'Scheduled')`,
  );
  await pool.query(
    `INSERT INTO schedule_history (schedule_id, position, status, at, actor_name, actor_role, note)
     VALUES ('S-RESTORE-1', 0, 'Scheduled', '2026-02-01T08:00:00Z', 'Restore Official', 'official', 'Posted')`,
  );
  await pool.query(`INSERT INTO schedule_reminders (schedule_id, user_email) VALUES ('S-RESTORE-1', 'resident@restore.test')`);
  await pool.query(
    `INSERT INTO notifications (id, target_email, report_id, title, body, created_at)
     VALUES ('N-RESTORE-1', 'resident@restore.test', 'R-RESTORE-1', 'Report under review', 'An official is reviewing it.', '2026-02-02T09:00:00Z')`,
  );
  await pool.query(
    `INSERT INTO activities (id, actor, role, action, detail, at, result, affected_id)
     VALUES ('A-RESTORE-1', 'Restore Admin', 'administrator', 'Changed role permission', 'Resident · View collection schedules', '2026-02-01T10:00:00Z', 'Success', 'R-RESTORE-1')`,
  );
  await pool.query(
    `INSERT INTO announcements (title, detail, date, created_by)
     VALUES ('Restore rehearsal announcement', 'This row proves announcements survive a restore.', '2026-02-03', 'U-OFFICIAL')`,
  );
  await pool.query(
    `INSERT INTO calendar_events (title, detail, date, approval_status, created_by)
     VALUES ('Restore rehearsal event', 'Calendar events survive too.', '2026-02-10', 'approved', 'U-OFFICIAL')`,
  );
  await pool.query(
    `INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES ('hash-restore-session', 'U-RESIDENT', '2030-01-01T00:00:00Z')`,
  );
  await pool.query(
    `INSERT INTO auth_attempts (attempt_key, attempts, window_started_at) VALUES ('restore-key', 2, '2026-02-01T00:00:00Z')`,
  );
}

async function main() {
  const base = await mkdtemp(path.join(os.tmpdir(), "community-restore-rehearsal-"));
  const port = await freePort();
  const dumpFile = path.join(base, "community.dump");
  const sourceDb = "community_source";
  const restoreDb = "community_restore";
  const serverEnv = { ...process.env, PGPASSWORD: PG_PASSWORD };
  const binDir = process.env.PG_BIN ? path.resolve(process.env.PG_BIN) : "";
  const tool = (name) => (binDir ? path.join(binDir, process.platform === "win32" ? `${name}.exe` : name) : name);
  let embedded;
  try {
    embedded = await startCluster(base, port);
    const adminPool = new pg.Pool({ host: "127.0.0.1", port, user: PG_USER, password: PG_PASSWORD, database: "postgres" });
    try {
      await adminPool.query(`CREATE DATABASE ${sourceDb}`);
      await adminPool.query(`CREATE DATABASE ${restoreDb}`);
    } finally {
      await adminPool.end();
    }

    const source = new pg.Pool({ connectionString: connectionString(port, sourceDb) });
    const restore = new pg.Pool({ connectionString: connectionString(port, restoreDb) });
    try {
      await migrate(source);
      await seed(source);
      const tables = await publicTables(source);
      const before = {};
      for (const table of tables) before[table] = await tableFingerprint(source, table);

      console.log(`Dumping ${Object.keys(before).length} tables from a real PostgreSQL cluster...`);
      await run(
        tool("pg_dump"),
        ["--format=custom", "--no-owner", "--no-privileges", `--file=${dumpFile}`, connectionString(port, sourceDb)],
        {
          env: serverEnv,
        },
      );

      console.log("Restoring the dump into a freshly created, empty database...");
      await run(
        tool("pg_restore"),
        ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${connectionString(port, restoreDb)}`, dumpFile],
        {
          env: serverEnv,
        },
      );

      // Startup migration must be a no-op because schema_migrations came along.
      await migrate(restore);

      const restoredTables = await publicTables(restore);
      assert.deepEqual(restoredTables, tables, "restored schema exposes the same tables");
      const failures = [];
      for (const table of tables) {
        const after = await tableFingerprint(restore, table);
        const matches = after.count === before[table].count && after.checksum === before[table].checksum;
        if (!matches) failures.push({ table, before: before[table], after });
        console.log(`${matches ? "ok  " : "FAIL"} ${table.padEnd(26)} rows=${after.count}`);
      }
      if (failures.length) {
        console.error("Restore mismatches:", JSON.stringify(failures, null, 2));
        process.exitCode = 1;
        return;
      }
      console.log(`\nRestore rehearsal passed: ${tables.length} tables, every row and checksum matched.`);
    } finally {
      await source.end().catch(() => {});
      await restore.end().catch(() => {});
    }
  } finally {
    if (embedded) await embedded.stop().catch((error) => console.warn(`cluster stop: ${error.message}`));
    await rm(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }).catch(() => {});
  }
}

await main();
