import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { migrate } from "./server.mjs";

// These tests boot a real PostgreSQL 18 cluster (zonky embedded binaries) so the
// migration suite is exercised against the same engine managed deployments use,
// not only PGlite. Clusters are ephemeral: data lives in a temp dir and is
// removed on exit.
async function startPostgres() {
  const base = await mkdtemp(path.join(os.tmpdir(), "community-migration-pg-"));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const embedded = new EmbeddedPostgres({
    databaseDir: path.join(base, "data"),
    user: "postgres",
    password: "migration-test-password",
    port,
    persistent: false,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    onError: () => {},
  });
  await embedded.initialise();
  await embedded.start();
  const pool = new pg.Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "migration-test-password",
    database: "postgres",
  });
  const stop = async () => {
    await pool.end();
    await embedded.stop();
    await rm(base, { recursive: true, force: true });
  };
  return { pool, stop };
}

async function appliedVersions(pool) {
  const result = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
  return result.rows.map((row) => Number(row.version));
}

test("migrations apply against a real PostgreSQL database and are idempotent", async () => {
  const { pool, stop } = await startPostgres();
  try {
    await migrate(pool);
    assert.deepEqual(await appliedVersions(pool), [1, 2]);

    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    const names = new Set(tables.rows.map((row) => row.tablename));
    for (const expected of [
      "schema_migrations",
      "app_meta",
      "users",
      "user_credentials",
      "reports",
      "report_history",
      "report_photos",
      "report_follow_ups",
      "schedules",
      "schedule_history",
      "notifications",
      "activities",
      "activity_archive",
      "role_permissions",
      "announcements",
      "calendar_events",
      "web_sessions",
      "community_locations",
      "recycling_locations",
      "password_reset_tokens",
      "recovery_email_tokens",
    ]) {
      assert.ok(names.has(expected), `missing table: ${expected}`);
    }

    const permissions = await pool.query("SELECT count(*)::integer AS count FROM role_permissions");
    assert.ok(permissions.rows[0].count > 0, "role permissions are seeded");

    const meta = await pool.query("SELECT revision FROM app_meta WHERE id = 1");
    assert.equal(Number(meta.rows[0].revision), 0, "the shared revision counter exists");

    // Re-running the suite applies nothing and does not fail.
    await migrate(pool);
    assert.deepEqual(await appliedVersions(pool), [1, 2]);
  } finally {
    await stop();
  }
});

test("a PostgreSQL database from migration v1 upgrades and backfills service-cycle fields", async () => {
  const { pool, stop } = await startPostgres();
  try {
    await migrate(pool);
    // Simulate a deployment that was created at migration v1 (before the
    // service-cycle and priority columns existed) and is now being upgraded.
    await pool.query("DELETE FROM schema_migrations WHERE version = 2");
    await pool.query("ALTER TABLE reports DROP COLUMN IF EXISTS priority");
    await pool.query("ALTER TABLE reports DROP COLUMN IF EXISTS responded_at");
    await pool.query("ALTER TABLE reports DROP COLUMN IF EXISTS resolved_at");
    await pool.query("ALTER TABLE reports DROP COLUMN IF EXISTS response_deadline");
    await pool.query("ALTER TABLE reports DROP COLUMN IF EXISTS resolution_deadline");
    await pool.query("ALTER TABLE reports DROP COLUMN IF EXISTS service_cycle_started_at");

    await pool.query(
      "INSERT INTO users (id, email, name, area, role, status) VALUES ($1, $2, $3, $4, 'resident', 'Active')",
      ["U-LEGACY-1", "legacy-upgrade@example.test", "Legacy Upgrade", "Purok 2"],
    );
    await pool.query(
      `INSERT INTO reports (id, user_email, name, category, title, area, description, status, submitted_at, updated_at, urgent)
       VALUES ('R-LEGACY-UPGRADE', 'legacy-upgrade@example.test', 'Legacy Upgrade', 'Road damage', 'Legacy pothole', 'Purok 2', 'A large pothole near the school.', 'Resolved', '2026-01-02T08:00:00Z', '2026-01-05T11:00:00Z', false)`,
    );
    const history = [
      ["Submitted", "2026-01-02T08:00:00Z", "Report received.", "resident"],
      ["Under Review", "2026-01-03T09:00:00Z", "A barangay official is reviewing this report.", "official"],
      ["In Progress", "2026-01-04T10:00:00Z", "The crew is scheduled to patch the pothole.", "official"],
      ["Resolved", "2026-01-05T11:00:00Z", "The pothole is patched.", "official"],
    ];
    for (const [position, [status, at, note, actorRole]] of history.entries()) {
      await pool.query(
        `INSERT INTO report_history (report_id, position, status, at, note, actor_name, actor_role)
         VALUES ('R-LEGACY-UPGRADE', $1, $2, $3, $4, $5, $6)`,
        [position, status, at, note, actorRole === "resident" ? "Legacy Upgrade" : "Official One", actorRole],
      );
    }

    await migrate(pool);
    assert.deepEqual(await appliedVersions(pool), [1, 2]);

    const backfilled = await pool.query(
      "SELECT service_cycle_started_at, responded_at, resolved_at, response_deadline, resolution_deadline, priority FROM reports WHERE id = 'R-LEGACY-UPGRADE'",
    );
    const row = backfilled.rows[0];
    assert.equal(new Date(row.service_cycle_started_at).toISOString(), "2026-01-02T08:00:00.000Z");
    assert.equal(new Date(row.responded_at).toISOString(), "2026-01-03T09:00:00.000Z");
    assert.equal(new Date(row.resolved_at).toISOString(), "2026-01-05T11:00:00.000Z");
    assert.equal(row.priority, "Medium", "non-urgent legacy concerns default to Medium priority");
    // Medium priority: 3-day response target and 14-day resolution target, measured from the service cycle.
    assert.equal(new Date(row.response_deadline).toISOString(), "2026-01-05T08:00:00.000Z");
    assert.equal(new Date(row.resolution_deadline).toISOString(), "2026-01-16T08:00:00.000Z");
  } finally {
    await stop();
  }
});
