import path from "node:path";
import { fileURLToPath } from "node:url";

import { resetAdministratorPassword } from "../server/domains/admin-password-reset.mjs";
import { createDatabase } from "../server/platform/db.mjs";
import { configureAppTimeZone, DEFAULT_TIME_ZONE, getAppTimeZone } from "../server/platform/time.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const email = process.env.RESET_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.RESET_ADMIN_PASSWORD;
  delete process.env.RESET_ADMIN_EMAIL;
  delete process.env.RESET_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set RESET_ADMIN_EMAIL and RESET_ADMIN_PASSWORD before running this command.");

  configureAppTimeZone(process.env.APP_TIME_ZONE || DEFAULT_TIME_ZONE);
  const db = await createDatabase({
    dataDir: path.join(PROJECT_DIR, "data", "pglite"),
    databaseUrl: process.env.DATABASE_URL || "",
    poolMax: Number(process.env.PG_POOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
    timeZone: getAppTimeZone(),
  });
  try {
    await resetAdministratorPassword(db, email, password);
    console.log(`Administrator password updated for ${email}. Existing sessions were signed out.`);
  } finally {
    if (typeof db.close === "function") await db.close();
    else await db.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Could not reset the administrator password: ${error.message}`);
    process.exitCode = 1;
  });
}
