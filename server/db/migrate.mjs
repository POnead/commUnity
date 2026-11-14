import { randomUUID } from "node:crypto";
import { withTransaction } from "../platform/db.mjs";
import { passwordHash } from "../platform/crypto.mjs";
import { validateAccount, validatePassword } from "../platform/validate.mjs";
import { PERMISSIONS } from "../platform/roles.mjs";
import migration001 from "./migrations/001-initial.mjs";
import migration002 from "./migrations/002-additive.mjs";
import migration003 from "./migrations/003-email-change-tokens.mjs";
import migration004 from "./migrations/004-web-sessions-user-index.mjs";

// The migrations are numbered files so a fresh deployment and an old database
// both walk the same path. Never edit an applied migration — add a new one.
export const MIGRATIONS = [migration001, migration002, migration003, migration004];

async function readAppliedMigrationVersions(db) {
  const result = await db.query("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(result.rows.map((row) => Number(row.version)));
}

async function applyMigration(db, migration) {
  await withTransaction(db, async (transaction) => {
    for (const statement of migration.statements) {
      await transaction.query(statement);
    }
    await transaction.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING", [migration.version]);
  });
}

export async function migrate(db) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  await db.query("CREATE TABLE IF NOT EXISTS app_meta (id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL DEFAULT 0)");
  await db.query("INSERT INTO app_meta (id, revision) VALUES (1, 0) ON CONFLICT (id) DO NOTHING");
  await db.query(
    "CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, encrypted_value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())",
  );
  const appliedVersions = await readAppliedMigrationVersions(db);
  for (const migration of [...MIGRATIONS].sort((left, right) => left.version - right.version)) {
    if (appliedVersions.has(migration.version)) continue;
    await applyMigration(db, migration);
  }
  const permissionRows = Object.entries(PERMISSIONS).flatMap(([role, entries]) =>
    Object.entries(entries).map(([permission, enabled]) => [role, permission, enabled]),
  );
  for (const [role, permission, enabled] of permissionRows) {
    await db.query(
      "INSERT INTO role_permissions (role, permission, enabled) VALUES ($1, $2, $3) ON CONFLICT (role, permission) DO NOTHING",
      [role, permission, enabled],
    );
  }
}

export async function ensureAdministrator(db, email, password) {
  const configured = Boolean(email || password);
  if (configured && (!email || !password)) throw new Error("Set both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD.");
  if (configured) {
    validateAccount({ email, name: "Portal administrator", area: "Palsara" });
    validatePassword(password);
  }
  const count = await db.query("SELECT count(*)::integer AS count FROM users WHERE role = 'administrator' AND status = 'Active'");
  if (Number(count.rows[0].count) > 0) return;
  if (!configured)
    throw new Error("No active administrator exists. Configure INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD as deployment secrets.");
  const encoded = await passwordHash(password);
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    await db.query(
      "INSERT INTO users (id, email, name, area, role, status) VALUES ($1, $2, $3, $4, 'administrator', 'Active') ON CONFLICT (email) DO NOTHING",
      [randomUUID(), email.trim().toLowerCase(), "Portal administrator", "Palsara"],
    );
    const user = await db.query("SELECT id, role, status FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (user.rows[0]?.role !== "administrator" || user.rows[0]?.status !== "Active") {
      throw new Error("INITIAL_ADMIN_EMAIL is already assigned to a non-administrator account.");
    }
    await db.query("INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [
      user.rows[0].id,
      encoded,
    ]);
  });
}
