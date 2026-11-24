import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HttpError } from "./platform/http.mjs";
import { logError } from "./platform/log.mjs";
import { createOcrClient } from "./platform/ocr.mjs";
import { createFacePpClient } from "./platform/facepp.mjs";
import { createExpressApp } from "./platform/http-app.mjs";
import { createDatabase } from "./platform/db.mjs";
import { handleApi } from "./handle-api.mjs";
import { configureAppTimeZone, getAppTimeZone, DEFAULT_TIME_ZONE } from "./platform/time.mjs";
import { parseTrustedProxyAddresses } from "./platform/session.mjs";
import { loadSmtpSettings, createMailer, createResendMailer } from "./platform/email.mjs";
import { resolveSmtpKey } from "./platform/smtp-key.mjs";
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
  resendApiKey = process.env.RESEND_API_KEY || "",
  resendFrom = process.env.RESEND_FROM || "",
  smtpSettingsKey = process.env.SMTP_SETTINGS_KEY || "",
  timeZone = process.env.APP_TIME_ZONE || DEFAULT_TIME_ZONE,
  production = process.env.NODE_ENV === "production",
  ocrApiKey = process.env.OCR_API_KEY || "",
  faceppApiKey = process.env.FACEPP_API_KEY || "",
  faceppApiSecret = process.env.FACEPP_API_SECRET || "",
  faceppApiBase = process.env.FACEPP_API_BASE || "https://api.faceplusplus.com",
  googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || "",
  ocrClient = null,
  faceppClient = null,
} = {}) {
  if (!databaseUrl && host !== "127.0.0.1" && host !== "::1") {
    throw new Error("The local demo server must bind to loopback.");
  }
  if (production && (!databaseUrl || !appOrigin)) {
    throw new Error("Production requires DATABASE_URL and APP_ORIGIN.");
  }
  if (databaseUrl && !appOrigin) throw new Error("A shared database requires APP_ORIGIN so browser requests can be checked.");
  if (databaseUrl && !smtpSettingsKey) {
    throw new Error("A shared database requires SMTP_SETTINGS_KEY so every instance encrypts saved email settings with the same key.");
  }
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
  // The SMTP password is stored encrypted. A local PGlite demo can generate and
  // reuse a key file with no setup; a shared database must supply SMTP_SETTINGS_KEY
  // above so every instance decrypts the same saved row with the same key.
  const smtpKey = await resolveSmtpKey({ dataDir, envKey: smtpSettingsKey });
  if (!smtpKey.key) {
    console.warn(
      `CommUnity could not prepare the SMTP settings key. Email settings cannot be saved until this is fixed: set SMTP_SETTINGS_KEY or make the data directory writable (failed at ${smtpKey.keyPath || "unknown path"}).`,
    );
  }
  const effectiveSmtpKey = smtpKey.key;
  const mailerState = {
    shared: Boolean(databaseUrl),
    settings: await loadSmtpSettings(db, effectiveSmtpKey, {
      host: smtpHost,
      port: smtpPort,
      user: smtpUser,
      pass: smtpPass,
      from: smtpFrom,
    }),
    mailer: null,
  };
  // HTTPS email (Resend) takes precedence when configured, since SMTP ports may be
  // blocked on restricted networks. Falls back to SMTP otherwise.
  if (resendApiKey) {
    const from = (resendFrom || mailerState.settings.from || smtpFrom || "").trim();
    mailerState.settings = { host: "", port: "", user: "", pass: "", from };
    mailerState.mailer = createResendMailer({ apiKey: resendApiKey, from });
    console.log(`CommUnity is using Resend HTTPS email (from ${from || "unset"}).`);
  } else {
    mailerState.mailer = createMailer({
      smtpHost: mailerState.settings.host,
      smtpPort: mailerState.settings.port,
      smtpUser: mailerState.settings.user,
      smtpPass: mailerState.settings.pass,
      smtpFrom: mailerState.settings.from,
    });
  }
  await ensureAdministrator(db, initialAdminEmail, initialAdminPassword);
  await pruneExpiredAuthState(db);
  await runScheduleReminders(db, { mailer: mailerState.mailer, smtpFrom: mailerState.settings.from, appOrigin });
  const MAINTENANCE_LOCK_KEY = 8675309;
  const reminderTimer = setInterval(
    async () => {
      // A shared Postgres needs one worker per tick; local PGlite is single-process, so it runs every time.
      let client = null;
      let acquired = false;
      try {
        client = typeof db.connect === "function" ? await db.connect() : null;
        acquired = !client;
        if (client) {
          const lock = await client.query("SELECT pg_try_advisory_lock($1)", [MAINTENANCE_LOCK_KEY]);
          acquired = Boolean(lock.rows[0]?.pg_try_advisory_lock);
        }
        if (!acquired) return;
        // Keep the lock until the jobs finish; otherwise another process can start the same work.
        await Promise.all([
          runScheduleReminders(db, { mailer: mailerState.mailer, smtpFrom: mailerState.settings.from, appOrigin }).catch((error) =>
            logError("CommUnity could not create collection reminders.", error),
          ),
          pruneExpiredAuthState(db).catch((error) => logError("CommUnity could not prune expired authentication data.", error)),
          pruneOldNotifications(db).catch((error) => logError("CommUnity could not prune old notifications.", error)),
          archiveOldActivities(db).catch((error) => logError("CommUnity could not archive or prune old activity records.", error)),
          sweepOrphanUploads(db, uploadsDir).catch((error) => logError("CommUnity could not remove abandoned photo uploads.", error)),
        ]);
      } catch (error) {
        logError("CommUnity could not acquire the maintenance lock.", error);
      } finally {
        if (client) {
          try {
            if (acquired) await client.query("SELECT pg_advisory_unlock($1)", [MAINTENANCE_LOCK_KEY]);
          } finally {
            client.release();
          }
        }
      }
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
    smtpSettingsKey: effectiveSmtpKey,
    googleMapsApiKey,
    ocrClient: ocrClient || createOcrClient({ apiKey: ocrApiKey }),
    faceppClient: (() => {
      const client = faceppClient || createFacePpClient({ apiKey: faceppApiKey, apiSecret: faceppApiSecret, apiBase: faceppApiBase });
      if (!client.configured)
        console.warn("[verification] Face++ keys are not configured; identity checks use the on-device matcher. Set FACEPP_API_KEY and FACEPP_API_SECRET in .env.");
      return client;
    })(),
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
  const { server, close } = await createCommunityServer();
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
