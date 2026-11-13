import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HttpError } from "./platform/http.mjs";
import { logError } from "./platform/log.mjs";
import { createExpressApp } from "./platform/http-app.mjs";
import { createDatabase } from "./platform/db.mjs";
import { handleApi } from "./handle-api.mjs";
import { configureAppTimeZone, getAppTimeZone, DEFAULT_TIME_ZONE } from "./platform/time.mjs";
import { parseTrustedProxyAddresses } from "./platform/session.mjs";
import { loadSmtpSettings, createMailer } from "./platform/email.mjs";
import { pruneExpiredAuthState } from "./platform/ratelimit.mjs";
import { sweepOrphanUploads } from "./platform/uploads.mjs";
import { migrate, ensureAdministrator } from "./db/migrate.mjs";
import { runScheduleReminders } from "./domains/schedules.mjs";
import { archiveOldActivities } from "./domains/activity.mjs";
import { pruneOldNotifications } from "./domains/notifications.mjs";

export { migrate } from "./db/migrate.mjs";
export { withTransaction } from "./platform/db.mjs";
export { requestClientAddress } from "./platform/session.mjs";
export { pruneExpiredAuthState } from "./platform/ratelimit.mjs";
export { sweepOrphanUploads } from "./platform/uploads.mjs";
export { runScheduleReminders } from "./domains/schedules.mjs";
export { archiveOldActivities } from "./domains/activity.mjs";
export { pruneOldNotifications } from "./domains/notifications.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_UPLOADS_DIR = path.join(PROJECT_DIR, "data", "uploads");

export async function createCommunityServer({
  dataDir = path.join(PROJECT_DIR, "data", "pglite"),
  uploadsDir = process.env.UPLOADS_DIR || DEFAULT_UPLOADS_DIR,
  databaseUrl = process.env.DATABASE_URL || "",
  host = databaseUrl ? "0.0.0.0" : "127.0.0.1",
  appOrigin = process.env.APP_ORIGIN || "",
  trustedProxyIps = process.env.TRUSTED_PROXY_IPS || "",
  poolMax = Number(process.env.PG_POOL_MAX || 10),
  connectionTimeoutMillis = Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
  initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL || "",
  initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD || "",
  smtpHost = process.env.SMTP_HOST || "",
  smtpPort = process.env.SMTP_PORT || "",
  smtpUser = process.env.SMTP_USER || "",
  smtpPass = process.env.SMTP_PASS || "",
  smtpFrom = process.env.SMTP_FROM || "",
  smtpSettingsKey = process.env.SMTP_SETTINGS_KEY || "",
  timeZone = process.env.APP_TIME_ZONE || DEFAULT_TIME_ZONE,
  production = process.env.NODE_ENV === "production",
} = {}) {
  if (!databaseUrl && host !== "127.0.0.1" && host !== "::1") {
    throw new Error("The local demo server must bind to loopback.");
  }
  if (production && (!databaseUrl || !appOrigin)) {
    throw new Error("Production requires DATABASE_URL and APP_ORIGIN.");
  }
  if (databaseUrl && !appOrigin) throw new Error("A shared database requires APP_ORIGIN so browser requests can be checked.");
  if (appOrigin && new URL(appOrigin).origin !== appOrigin) throw new Error("APP_ORIGIN must be an origin with no path or trailing slash.");
  if ((production || databaseUrl) && appOrigin && new URL(appOrigin).protocol !== "https:") {
    throw new Error("Shared deployment APP_ORIGIN must use HTTPS.");
  }
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) throw new Error("PG_POOL_MAX must be an integer between 1 and 100.");
  if (!Number.isInteger(connectionTimeoutMillis) || connectionTimeoutMillis < 100 || connectionTimeoutMillis > 60000) {
    throw new Error("PG_CONNECTION_TIMEOUT_MS must be an integer between 100 and 60000.");
  }
  const trustedProxyAddresses = parseTrustedProxyAddresses(trustedProxyIps);
  configureAppTimeZone(timeZone);
  const appTimeZone = getAppTimeZone();
  const db = await createDatabase({ dataDir, databaseUrl, poolMax, connectionTimeoutMillis, timeZone: appTimeZone });
  await migrate(db);
  const mailerState = {
    settings: await loadSmtpSettings(db, smtpSettingsKey, {
      host: smtpHost,
      port: smtpPort,
      user: smtpUser,
      pass: smtpPass,
      from: smtpFrom,
    }),
    mailer: null,
  };
  mailerState.mailer = createMailer({
    smtpHost: mailerState.settings.host,
    smtpPort: mailerState.settings.port,
    smtpUser: mailerState.settings.user,
    smtpPass: mailerState.settings.pass,
    smtpFrom: mailerState.settings.from,
  });
  await ensureAdministrator(db, initialAdminEmail, initialAdminPassword);
  await pruneExpiredAuthState(db);
  await runScheduleReminders(db, { mailer: mailerState.mailer, smtpFrom: mailerState.settings.from, appOrigin });
  const reminderTimer = setInterval(
    () => {
      runScheduleReminders(db, { mailer: mailerState.mailer, smtpFrom: mailerState.settings.from, appOrigin }).catch((error) =>
        logError("CommUnity could not create collection reminders.", error),
      );
      pruneExpiredAuthState(db).catch((error) => logError("CommUnity could not prune expired authentication data.", error));
      pruneOldNotifications(db).catch((error) => logError("CommUnity could not prune old notifications.", error));
      archiveOldActivities(db).catch((error) => logError("CommUnity could not archive or prune old activity records.", error));
      sweepOrphanUploads(db, uploadsDir).catch((error) => logError("CommUnity could not remove abandoned photo uploads.", error));
    },
    15 * 60 * 1000,
  );
  reminderTimer.unref();
  const secure = production || Boolean(databaseUrl);
  const app = createExpressApp({
    db,
    secure,
    projectDir: PROJECT_DIR,
    appOrigin,
    trustedProxyAddresses,
    uploadsDir,
    mailerState,
    smtpSettingsKey,
    handleApi,
    HttpError,
    logError,
    timeZone: appTimeZone,
    createRequestId: randomUUID,
  });
  const server = createServer(app);
  return {
    db,
    server,
    close: async () => {
      clearInterval(reminderTimer);
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      if (typeof db.close === "function") await db.close();
      else await db.end();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8768);
  const { server, close } = await createCommunityServer({ port });
  server.listen(port, process.env.DATABASE_URL ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`CommUnity running on port ${port}.`);
    console.log(`Open the website: ${process.env.APP_ORIGIN || `http://127.0.0.1:${port}`}`);
    console.log(
      process.env.DATABASE_URL
        ? "Using managed PostgreSQL. Configure TLS at the hosting provider."
        : "Using local PGlite storage on this computer only.",
    );
  });
  const stop = async () => {
    await close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
