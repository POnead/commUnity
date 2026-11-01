import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const scrypt = promisify(scryptCallback);
const PROJECT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_FILES = new Set([
  "index.html", "styles.css", "app-core.js", "app-views.js", "app.js",
  "node_modules/leaflet/dist/leaflet.js", "node_modules/leaflet/dist/leaflet.css",
  "node_modules/leaflet/dist/images/layers.png", "node_modules/leaflet/dist/images/layers-2x.png",
  "node_modules/leaflet/dist/images/marker-icon.png", "node_modules/leaflet/dist/images/marker-icon-2x.png",
  "node_modules/leaflet/dist/images/marker-shadow.png",
]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PASSWORD_LENGTH = 200;
const SESSION_COOKIE = "community_session";
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;
const REPORT_STATUSES = ["Submitted", "Under Review", "In Progress", "Resolved"];
const SCHEDULE_STATUSES = ["Scheduled", "On the way", "Collecting", "Completed", "Delayed", "Cancelled", "Rescheduled"];
const ROLES = ["resident", "official", "administrator"];
const PERMISSIONS = {
  resident: { submitReports: true, viewSchedules: true, manageReports: false, manageSchedules: false, manageAnnouncements: false, manageUsers: false, manageRoles: false, viewAudit: false },
  official: { submitReports: false, viewSchedules: true, manageReports: true, manageSchedules: true, manageAnnouncements: true, manageUsers: false, manageRoles: false, viewAudit: false },
  administrator: { submitReports: false, viewSchedules: true, manageReports: true, manageSchedules: true, manageAnnouncements: true, manageUsers: true, manageRoles: true, viewAudit: true },
};
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function logError(message, error, context = {}) {
  console.error(JSON.stringify({
    level: "error",
    message,
    ...context,
    error: {
      name: error?.name || "Error",
      message: error?.message || String(error),
      ...(error?.code ? { code: error.code } : {}),
    },
  }));
}

function normalizeIpAddress(address) {
  const normalized = String(address || "").trim().toLowerCase();
  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
}

export function requestClientAddress(request, trustedProxyAddresses = new Set()) {
  const remoteAddress = normalizeIpAddress(request.socket.remoteAddress);
  if (!trustedProxyAddresses.has(remoteAddress)) return remoteAddress;
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor !== "string") return remoteAddress;
  const chain = forwardedFor.split(",").map(normalizeIpAddress);
  if (!chain.length || chain.some((address) => !isIP(address))) return remoteAddress;
  for (const address of chain.reverse()) {
    if (!trustedProxyAddresses.has(address)) return address;
  }
  return remoteAddress;
}

function parseTrustedProxyAddresses(value) {
  if (!value) return new Set();
  const addresses = value.split(",").map(normalizeIpAddress);
  if (addresses.some((address) => !isIP(address))) {
    throw new Error("TRUSTED_PROXY_IPS must contain only comma-separated IPv4 or IPv6 addresses.");
  }
  return new Set(addresses);
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const result = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${result.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, saltHex, digestHex] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(digestHex)) return false;
  const digest = await scrypt(password, Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(digest, Buffer.from(digestHex, "hex"));
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Body must be an object.");
    return body;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function cookieValue(request, name) {
  for (const part of (request.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function cookieHeader(token, { secure, remember = false } = {}) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    ...(remember ? [`Max-Age=${REMEMBER_DAYS * 86400}`] : []),
  ].join("; ");
}

function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
}

function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function publicUser(user) {
  if (!user) return null;
  const { id, email, name, area, phone, role, status, joinedAt } = user;
  return { id, email, name, area, phone, role, status, joinedAt };
}

function validateAccount({ email, name, area, phone = "" }) {
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100) throw new HttpError(400, "Enter a name between 2 and 100 characters.");
  if (typeof area !== "string" || area.trim().length < 2 || area.length > 120) throw new HttpError(400, "Enter a valid area.");
  if (typeof phone !== "string" || phone.length > 40) throw new HttpError(400, "Contact number is too long.");
}

async function assertKnownArea(db, area, barangay = "") {
  const result = await db.query("SELECT 1 FROM community_locations WHERE area=$1 AND ($2='' OR barangay=$2)", [area.trim(), barangay.trim()]);
  if (!result.rows.length) throw new HttpError(400, "Choose an area managed in the community location settings.");
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Use a password between 12 and ${MAX_PASSWORD_LENGTH} characters.`);
  }
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value);
}

function validateReport(report) {
  if (!report || !validId(report.id) || typeof report.title !== "string" || report.title.length > 200 ||
      typeof report.description !== "string" || report.description.length < 12 || report.description.length > 1200 ||
      typeof report.category !== "string" || report.category.length > 100 ||
      typeof report.area !== "string" || report.area.length > 120 ||
      (report.barangay !== undefined && (typeof report.barangay !== "string" || report.barangay.length > 100)) ||
      (report.locationDetail !== undefined && (typeof report.locationDetail !== "string" || report.locationDetail.length > 250)) ||
      ((report.latitude !== undefined && report.latitude !== null) !==
        (report.longitude !== undefined && report.longitude !== null)) ||
      (report.latitude !== undefined && report.latitude !== null &&
        (typeof report.latitude !== "number" || !Number.isFinite(report.latitude) || report.latitude < -90 || report.latitude > 90)) ||
      (report.longitude !== undefined && report.longitude !== null &&
        (typeof report.longitude !== "number" || !Number.isFinite(report.longitude) || report.longitude < -180 || report.longitude > 180)) ||
      !REPORT_STATUSES.includes(report.status) || typeof report.urgent !== "boolean" ||
      (report.assignedTo !== undefined && report.assignedTo !== null &&
        (!report.assignedTo || typeof report.assignedTo !== "object" || !validId(report.assignedTo.id) ||
          typeof report.assignedTo.name !== "string" || report.assignedTo.name.length > 100)) ||
      !Array.isArray(report.history) || report.history.length < 1 || report.history.length > 500 ||
      !Array.isArray(report.photos) || report.photos.length > 3) {
    throw new HttpError(400, "A report contains invalid or excessive data.");
  }
  for (const photo of report.photos) {
    if (!photo || typeof photo.name !== "string" || photo.name.length > 120 ||
        typeof photo.data !== "string" || photo.data.length > 3_000_000 ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(photo.data)) {
      throw new HttpError(400, "A report photo is invalid or too large.");
    }
  }
  for (const item of report.history) {
    if (!item || !REPORT_STATUSES.includes(item.status) || typeof item.note !== "string" || item.note.length > 2000 ||
        typeof item.at !== "string" || Number.isNaN(Date.parse(item.at)) ||
        (item.actorName !== undefined && (typeof item.actorName !== "string" || item.actorName.length > 100)) ||
        (item.actorRole !== undefined && !ROLES.includes(item.actorRole))) {
      throw new HttpError(400, "Report history contains invalid data.");
    }
  }
}

function validateSchedule(schedule) {
  if (!schedule || !validId(schedule.id) || typeof schedule.area !== "string" || schedule.area.length > 120 ||
      typeof schedule.zone !== "string" || schedule.zone.length > 100 ||
      typeof schedule.wasteType !== "string" || !schedule.wasteType.trim() || schedule.wasteType.length > 120 ||
      typeof schedule.date !== "string" || Number.isNaN(Date.parse(schedule.date)) ||
      typeof schedule.start !== "string" || schedule.start.length > 30 ||
      typeof schedule.end !== "string" || schedule.end.length > 30 ||
      typeof schedule.frequency !== "string" || schedule.frequency.length > 50 ||
      typeof schedule.team !== "string" || schedule.team.length > 120 ||
      !SCHEDULE_STATUSES.includes(schedule.status)) {
    throw new HttpError(400, "A collection schedule contains invalid data.");
  }
}

function validateState(data) {
  if (!data || Array.isArray(data) || data.version !== 1 ||
      !["users", "reports", "schedules", "notifications", "activities", "announcements", "locations", "recyclingLocations"].every((key) => Array.isArray(data[key])) ||
      !data.permissions || typeof data.permissions !== "object" || Array.isArray(data.permissions) ||
      data.users.length > 10000 || data.reports.length > 50000 || data.schedules.length > 10000 ||
      data.notifications.length > 100000 || data.activities.length > 100000 || data.announcements.length > 1000 ||
      data.locations.length > 1000 || data.recyclingLocations.length > 1000) {
    throw new HttpError(400, "CommUnity data is invalid or exceeds supported limits.");
  }
  if (data.reports.some((report) => !report || !validId(report.id)) ||
      new Set(data.reports.map((report) => report.id)).size !== data.reports.length) {
    throw new HttpError(400, "Report identifiers must be valid and unique.");
  }
  if (data.schedules.some((schedule) => !schedule || !validId(schedule.id)) ||
      new Set(data.schedules.map((schedule) => schedule.id)).size !== data.schedules.length) {
    throw new HttpError(400, "Schedule identifiers must be valid and unique.");
  }
}

function makeDefaultState() {
  return {
    version: 1,
    users: [],
    reports: [],
    schedules: [],
    notifications: [],
    activities: [],
    permissions: structuredClone(PERMISSIONS),
    announcements: [],
    locations: [],
    recyclingLocations: [],
  };
}

async function createDatabase({ dataDir, databaseUrl, poolMax, connectionTimeoutMillis }) {
  if (databaseUrl) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: true },
      max: poolMax,
      connectionTimeoutMillis,
      idleTimeoutMillis: 30000,
    });
    await pool.query("SELECT 1");
    return pool;
  }
  await mkdir(path.dirname(dataDir), { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  return db;
}

async function migrate(db) {
  const schema = `
    CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS app_meta (id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL DEFAULT 0);
    INSERT INTO app_meta (id, revision) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY, email text NOT NULL UNIQUE,
      name text NOT NULL, area text NOT NULL, phone text NOT NULL DEFAULT '',
      role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator')),
      status text NOT NULL CHECK (status IN ('Active', 'Inactive')),
      joined_at date NOT NULL DEFAULT CURRENT_DATE
    );
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      password_hash text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id text PRIMARY KEY, user_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE,
      name text NOT NULL, category text NOT NULL, title text NOT NULL, area text NOT NULL,
      barangay text NOT NULL DEFAULT '',
      location_detail text NOT NULL DEFAULT '', latitude double precision, longitude double precision,
      description text NOT NULL, urgent boolean NOT NULL DEFAULT false,
      assigned_to text REFERENCES users(id) ON DELETE SET NULL,
      status text NOT NULL CHECK (status IN ('Submitted', 'Under Review', 'In Progress', 'Resolved')),
      submitted_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_history (
      id bigserial PRIMARY KEY, report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      position integer NOT NULL, status text NOT NULL, at timestamptz NOT NULL, note text NOT NULL,
      actor_name text NOT NULL DEFAULT '', actor_role text NOT NULL DEFAULT '',
      UNIQUE (report_id, position)
    );
    CREATE TABLE IF NOT EXISTS report_photos (
      id bigserial PRIMARY KEY, report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      position integer NOT NULL, name text NOT NULL, data_url text NOT NULL,
      UNIQUE (report_id, position)
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id text PRIMARY KEY, area text NOT NULL, zone text NOT NULL, date date NOT NULL,
      waste_type text NOT NULL, start_time text NOT NULL, end_time text NOT NULL,
      frequency text NOT NULL, team text NOT NULL,
      status text NOT NULL CHECK (status IN ('Scheduled', 'On the way', 'Collecting', 'Completed', 'Delayed', 'Cancelled', 'Rescheduled'))
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id text PRIMARY KEY, target_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
      report_id text REFERENCES reports(id) ON DELETE SET NULL, title text NOT NULL,
      body text NOT NULL, created_at timestamptz NOT NULL, read boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS activities (
      id text PRIMARY KEY, actor text NOT NULL, role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator')),
      action text NOT NULL, detail text NOT NULL, at timestamptz NOT NULL, result text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
      role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator')),
      permission text NOT NULL, enabled boolean NOT NULL, PRIMARY KEY (role, permission)
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id bigserial PRIMARY KEY, title text NOT NULL, detail text NOT NULL, date date NOT NULL
    );
    CREATE TABLE IF NOT EXISTS community_locations (
      id text PRIMARY KEY, area text NOT NULL UNIQUE, barangay text NOT NULL,
      street text NOT NULL DEFAULT '', purok text NOT NULL, landmark text NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS recycling_locations (
      id text PRIMARY KEY, name text NOT NULL, barangay text NOT NULL, street text NOT NULL,
      purok text NOT NULL DEFAULT '', landmark text NOT NULL DEFAULT '', materials text NOT NULL,
      phone text NOT NULL DEFAULT '', hours text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS schedule_reminders (
      schedule_id text NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      user_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
      notified_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (schedule_id, user_email)
    );
    CREATE TABLE IF NOT EXISTS web_sessions (
      token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS auth_attempts (
      attempt_key text PRIMARY KEY, attempts integer NOT NULL, window_started_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reports_owner_submitted_idx ON reports(user_email, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS reports_status_updated_idx ON reports(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS schedules_date_area_idx ON schedules(date, area);
    CREATE INDEX IF NOT EXISTS notifications_owner_created_idx ON notifications(target_email, created_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON web_sessions(expires_at);
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS location_detail text NOT NULL DEFAULT '';
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS barangay text NOT NULL DEFAULT '';
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS latitude double precision;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS longitude double precision;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS assigned_to text REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE report_history ADD COLUMN IF NOT EXISTS actor_name text NOT NULL DEFAULT '';
    ALTER TABLE report_history ADD COLUMN IF NOT EXISTS actor_role text NOT NULL DEFAULT '';
    UPDATE report_history history SET actor_name=reports.name, actor_role='resident'
      FROM reports WHERE history.report_id=reports.id AND history.position=0 AND history.actor_name='';
    INSERT INTO community_locations (id, area, barangay, purok) VALUES
      ('balete-purok-1', 'Purok 1', 'Balete', 'Purok 1'),
      ('balete-purok-2', 'Purok 2', 'Balete', 'Purok 2'),
      ('balete-purok-3', 'Purok 3', 'Balete', 'Purok 3'),
      ('balete-purok-4', 'Purok 4', 'Balete', 'Purok 4'),
      ('balete-purok-5', 'Purok 5', 'Balete', 'Purok 5'),
      ('balete-main-road', 'Main Road', 'Balete', 'Main Road')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO schema_migrations (version) VALUES (1), (2) ON CONFLICT (version) DO NOTHING;
  `;
  if (typeof db.exec === "function") await db.exec(schema);
  else await db.query(schema);
  await db.query(
    "INSERT INTO role_permissions (role, permission, enabled) VALUES " +
    Object.entries(PERMISSIONS).flatMap(([role, entries]) => Object.entries(entries).map(([permission, enabled]) =>
      `('${role}', '${permission}', ${enabled})`)).join(", ") +
    " ON CONFLICT (role, permission) DO NOTHING",
  );
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

async function ensureAdministrator(db, email, password) {
  const configured = Boolean(email || password);
  if (configured && (!email || !password)) throw new Error("Set both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD.");
  if (configured) {
    validateAccount({ email, name: "Portal administrator", area: "Balete, Batangas" });
    validatePassword(password);
  }
  const count = await db.query("SELECT count(*)::integer AS count FROM users WHERE role = 'administrator' AND status = 'Active'");
  if (Number(count.rows[0].count) > 0) return;
  if (!configured) throw new Error("No active administrator exists. Configure INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD as deployment secrets.");
  const encoded = await passwordHash(password);
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    await db.query(
      "INSERT INTO users (id, email, name, area, role, status) VALUES ($1, $2, $3, $4, 'administrator', 'Active') ON CONFLICT (email) DO NOTHING",
      [randomUUID(), email.trim().toLowerCase(), "Portal administrator", "Balete, Batangas"],
    );
    const user = await db.query("SELECT id, role, status FROM users WHERE email = $1", [email.trim().toLowerCase()]);
    if (user.rows[0]?.role !== "administrator" || user.rows[0]?.status !== "Active") {
      throw new Error("INITIAL_ADMIN_EMAIL is already assigned to a non-administrator account.");
    }
    await db.query("INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [user.rows[0].id, encoded]);
  });
}

async function readFullState(db, user = null) {
  const state = makeDefaultState();
  if (!user || user.role === "administrator") {
    const users = await db.query("SELECT id, email, name, area, phone, role, status, to_char(joined_at, 'YYYY-MM-DD') AS \"joinedAt\" FROM users ORDER BY joined_at, email");
    state.users = users.rows;
  } else if (user.role === "resident") {
    const users = await db.query("SELECT id, email, name, area, phone, role, status, to_char(joined_at, 'YYYY-MM-DD') AS \"joinedAt\" FROM users WHERE id=$1", [user.id]);
    state.users = users.rows;
  }

  const reports = await db.query(`
    SELECT r.id, r.user_email AS "userEmail", r.name, r.category, r.title, r.area, r.barangay,
    r.location_detail AS "locationDetail", r.latitude, r.longitude, r.description, r.urgent,
    r.assigned_to AS "assignedToId", assignee.name AS "assignedToName", r.status,
    r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt"
    FROM reports r LEFT JOIN users assignee ON assignee.id=r.assigned_to
    ${user?.role === "resident" ? "WHERE r.user_email=$1" : ""}
    ORDER BY submitted_at DESC, id
  `, user?.role === "resident" ? [user.email] : []);
  const reportIds = reports.rows.map((report) => report.id);
  if (reportIds.length) {
    const histories = await db.query(`SELECT report_id, status, at, note, actor_name AS "actorName",
      actor_role AS "actorRole" FROM report_history
      ${user?.role === "resident" ? "WHERE report_id=ANY($1::text[])" : ""}
      ORDER BY report_id, position`, user?.role === "resident" ? [reportIds] : []);
    const historyByReport = new Map();
    for (const row of histories.rows) {
      const list = historyByReport.get(row.report_id) || [];
      list.push({ status: row.status, at: timestamp(row.at), note: row.note, actorName: row.actorName, actorRole: row.actorRole });
      historyByReport.set(row.report_id, list);
    }
    const photos = await db.query(`
      SELECT report_id, name, data_url AS data FROM report_photos
      ${user?.role === "resident" ? "WHERE report_id=ANY($1::text[])" : ""}
      ORDER BY report_id, position
    `, user?.role === "resident" ? [reportIds] : []);
    const photosByReport = new Map();
    for (const row of photos.rows) {
      const list = photosByReport.get(row.report_id) || [];
      list.push({ name: row.name, data: row.data });
      photosByReport.set(row.report_id, list);
    }
    state.reports = reports.rows.map((report) => {
      const { assignedToId, assignedToName, ...details } = report;
      return {
        ...details,
        assignedTo: assignedToId ? { id: assignedToId, name: assignedToName } : null,
        submittedAt: timestamp(report.submittedAt),
        updatedAt: timestamp(report.updatedAt),
        history: historyByReport.get(report.id) || [],
        photos: photosByReport.get(report.id) || [],
      };
    });
  }
  const schedules = await db.query(`
    SELECT id, area, zone, to_char(date, 'YYYY-MM-DD') AS date, waste_type AS "wasteType",
      start_time AS start, end_time AS "end", frequency, team, status
    FROM schedules ORDER BY date, start_time, id
  `);
  state.schedules = schedules.rows;
  const notifications = await db.query(`
    SELECT id, target_email AS "targetEmail", report_id AS "reportId", title, body,
      created_at AS "createdAt", read FROM notifications
    ${user ? "WHERE target_email=$1" : ""}
    ORDER BY created_at DESC, id
  `, user ? [user.email] : []);
  state.notifications = notifications.rows.map((item) => ({ ...item, reportId: item.reportId || "", createdAt: timestamp(item.createdAt) }));
  if (!user || user.role === "administrator") {
    const activities = await db.query("SELECT id, actor, role, action, detail, at, result FROM activities ORDER BY at DESC, id");
    state.activities = activities.rows.map((item) => ({ ...item, at: timestamp(item.at) }));
  }
  const permissions = await db.query("SELECT role, permission, enabled FROM role_permissions ORDER BY role, permission");
  for (const { role, permission, enabled } of permissions.rows) {
    state.permissions[role] ||= {};
    state.permissions[role][permission] = enabled;
  }
  const announcements = await db.query("SELECT id, title, detail, to_char(date, 'YYYY-MM-DD') AS date FROM announcements ORDER BY date DESC, id DESC");
  state.announcements = announcements.rows.map((item) => ({ ...item, id: String(item.id) }));
  const locations = await db.query("SELECT id, area, barangay, street, purok, landmark FROM community_locations ORDER BY barangay, purok, street, id");
  state.locations = locations.rows;
  const recyclingLocations = await db.query(`
    SELECT id, name, barangay, street, purok, landmark, materials, phone, hours, active
    FROM recycling_locations ${user && user.role !== "administrator" ? "WHERE active=true" : ""}
    ORDER BY active DESC, name
  `);
  state.recyclingLocations = recyclingLocations.rows;
  return state;
}

function stateForRole(state, user) {
  return {
    ...state,
    users: user.role === "administrator" ? state.users : user.role === "resident" ? state.users.filter((item) => item.id === user.id) : [],
    reports: user.role === "resident" ? state.reports.filter((item) => item.userEmail === user.email) : state.reports,
    notifications: state.notifications.filter((item) => item.targetEmail === user.email),
    activities: user.role === "administrator" ? state.activities : [],
    recyclingLocations: user.role === "administrator"
      ? state.recyclingLocations
      : state.recyclingLocations.filter((item) => item.active),
  };
}

async function getSessionUser(request, db) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  const result = await db.query(`
    SELECT u.id, u.email, u.name, u.area, u.phone, u.role, u.status, to_char(u.joined_at, 'YYYY-MM-DD') AS "joinedAt"
    FROM web_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'Active'
  `, [hash(token)]);
  return result.rows[0] || null;
}

async function issueSession(response, db, user, remember, secure) {
  const token = randomBytes(32).toString("base64url");
  const duration = remember ? `${REMEMBER_DAYS} days` : `${SESSION_HOURS} hours`;
  await db.query(
    "INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::interval)",
    [hash(token), user.id, duration],
  );
  response.setHeader("Set-Cookie", cookieHeader(token, { secure, remember }));
}

async function recordAttempt(db, key, limit = 10) {
  const result = await db.query(`
    INSERT INTO auth_attempts (attempt_key, attempts, window_started_at) VALUES ($1, 1, now())
    ON CONFLICT (attempt_key) DO UPDATE SET
      attempts = CASE WHEN auth_attempts.window_started_at < now() - interval '15 minutes' THEN 1 ELSE auth_attempts.attempts + 1 END,
      window_started_at = CASE WHEN auth_attempts.window_started_at < now() - interval '15 minutes' THEN now() ELSE auth_attempts.window_started_at END
    RETURNING attempts
  `, [key]);
  if (Number(result.rows[0].attempts) > limit) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.");
}

export async function pruneExpiredAuthState(db) {
  const attempts = await db.query("DELETE FROM auth_attempts WHERE window_started_at < now() - interval '24 hours'");
  const sessions = await db.query("DELETE FROM web_sessions WHERE expires_at <= now()");
  return { attempts: attempts.rowCount, sessions: sessions.rowCount };
}

function requireRole(user, roles) {
  if (!user) throw new HttpError(401, "Sign in to continue.");
  if (!roles.includes(user.role)) throw new HttpError(403, "Your account cannot perform this action.");
}

function validateSameOrigin(request, server, appOrigin) {
  const safeMethod = request.method === "GET" || request.method === "HEAD";
  const host = request.headers.host;
  let requestOrigin;
  try {
    requestOrigin = new URL(`http://${host}`).origin;
  } catch {
    return false;
  }
  if (appOrigin) {
    try {
      if (new URL(appOrigin).host !== new URL(requestOrigin).host) return false;
    } catch {
      return false;
    }
    return safeMethod ? (!request.headers.origin || request.headers.origin === appOrigin) : request.headers.origin === appOrigin;
  }
  const address = server.address();
  let parsed;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return false;
  }
  return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname) &&
    Number(parsed.port) === address?.port &&
    (safeMethod ? (!request.headers.origin || request.headers.origin === requestOrigin) : request.headers.origin === requestOrigin);
}

function validateActivityAppend(oldItems, newItems, user) {
  if (newItems.length < oldItems.length || !oldItems.every((item, index) => jsonEqual(item, newItems[index]))) {
    throw new HttpError(403, "Activity history cannot be altered.");
  }
  for (const item of newItems.slice(oldItems.length)) {
    if (!item || !validId(item.id) || item.actor !== user.name || item.role !== user.role ||
        typeof item.action !== "string" || item.action.length > 100 ||
        typeof item.detail !== "string" || item.detail.length > 1000 ||
        typeof item.result !== "string" || item.result.length > 80 ||
        typeof item.at !== "string" || Number.isNaN(Date.parse(item.at))) {
      throw new HttpError(400, "Activity entry is invalid.");
    }
  }
}

function validateNotificationsReadOnly(oldItems, newItems, user) {
  const oldById = new Map(oldItems.map((item) => [item.id, item]));
  if (newItems.length !== oldItems.length) throw new HttpError(403, "Notifications can only be created by the server.");
  for (const item of newItems) {
    const old = oldById.get(item.id);
    if (!old || item.targetEmail !== user.email || old.targetEmail !== user.email ||
        !jsonEqual({ ...old, read: false }, { ...item, read: false }) ||
        (old.read && !item.read)) {
      throw new HttpError(403, "You can only mark your own notifications as read.");
    }
  }
}

function validateScheduleCollection(schedules) {
  for (const schedule of schedules) validateSchedule(schedule);
}

async function insertReport(db, report) {
  validateReport(report);
  await db.query(`
    INSERT INTO reports (id, user_email, name, category, title, area, barangay, location_detail, latitude, longitude, description, urgent, assigned_to, status, submitted_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
  `, [report.id, report.userEmail, report.name, report.category, report.title, report.area, report.barangay || "",
    report.locationDetail || "", report.latitude ?? null, report.longitude ?? null, report.description, report.urgent,
    report.assignedTo?.id || null, report.status, report.submittedAt, report.updatedAt]);
  for (const [position, item] of report.history.entries()) {
    await db.query("INSERT INTO report_history (report_id, position, status, at, note, actor_name, actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [report.id, position, item.status, item.at, item.note, item.actorName || "", item.actorRole || ""]);
  }
  for (const [position, photo] of report.photos.entries()) {
    await db.query("INSERT INTO report_photos (report_id,position,name,data_url) VALUES ($1,$2,$3,$4)",
      [report.id, position, photo.name, photo.data]);
  }
}

async function replaceReport(db, report) {
  validateReport(report);
  await db.query(`
    INSERT INTO reports (id, user_email, name, category, title, area, barangay, location_detail, latitude, longitude, description, urgent, assigned_to, status, submitted_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (id) DO UPDATE SET user_email=excluded.user_email, name=excluded.name, category=excluded.category,
      title=excluded.title, area=excluded.area, barangay=excluded.barangay, location_detail=excluded.location_detail,
      latitude=excluded.latitude, longitude=excluded.longitude, description=excluded.description, urgent=excluded.urgent,
      assigned_to=excluded.assigned_to, status=excluded.status, submitted_at=excluded.submitted_at, updated_at=excluded.updated_at
  `, [report.id, report.userEmail, report.name, report.category, report.title, report.area, report.barangay || "",
    report.locationDetail || "", report.latitude ?? null, report.longitude ?? null, report.description, report.urgent,
    report.assignedTo?.id || null, report.status, report.submittedAt, report.updatedAt]);
  await db.query("DELETE FROM report_history WHERE report_id = $1", [report.id]);
  await db.query("DELETE FROM report_photos WHERE report_id = $1", [report.id]);
  for (const [position, item] of report.history.entries()) {
    await db.query("INSERT INTO report_history (report_id, position, status, at, note, actor_name, actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [report.id, position, item.status, item.at, item.note, item.actorName || "", item.actorRole || ""]);
  }
  for (const [position, photo] of report.photos.entries()) {
    await db.query("INSERT INTO report_photos (report_id,position,name,data_url) VALUES ($1,$2,$3,$4)",
      [report.id, position, photo.name, photo.data]);
  }
}

async function insertNotification(db, userEmail, title, body, reportId = "") {
  await db.query(`
    INSERT INTO notifications (id, target_email, report_id, title, body, created_at, read)
    VALUES ($1,$2,$3,$4,$5,now(),false)
  `, [randomUUID(), userEmail, reportId || null, title.slice(0, 200), body.slice(0, 1000)]);
}

async function insertActivity(db, user, action, detail) {
  await db.query(
    "INSERT INTO activities (id, actor, role, action, detail, at, result) VALUES ($1,$2,$3,$4,$5,now(),'Success')",
    [randomUUID(), user.name, user.role, action, detail.slice(0, 1000)],
  );
}

async function syncNotifications(db, oldItems, newItems, user) {
  validateNotificationsReadOnly(oldItems, newItems, user);
  const changed = newItems.filter((item) => oldItems.find((old) => old.id === item.id)?.read !== item.read);
  for (const item of changed) await db.query("UPDATE notifications SET read=true WHERE id=$1 AND target_email=$2", [item.id, user.email]);
}

async function syncSchedules(db, oldSchedules, newSchedules) {
  validateScheduleCollection(newSchedules);
  const oldById = new Map(oldSchedules.map((item) => [item.id, item]));
  const newById = new Map(newSchedules.map((item) => [item.id, item]));
  const changed = new Set();
  for (const item of newSchedules) {
    await assertKnownArea(db, item.area);
    const previous = oldById.get(item.id);
    if (!previous || !jsonEqual(previous, item)) {
      changed.add(item.id);
      await db.query(`
        INSERT INTO schedules (id,area,zone,date,waste_type,start_time,end_time,frequency,team,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET area=excluded.area,zone=excluded.zone,date=excluded.date,
          waste_type=excluded.waste_type,start_time=excluded.start_time,end_time=excluded.end_time,
          frequency=excluded.frequency,team=excluded.team,status=excluded.status
      `, [item.id, item.area, item.zone, item.date, item.wasteType, item.start, item.end, item.frequency, item.team, item.status]);
    }
  }
  for (const item of oldSchedules) {
    if (!newById.has(item.id)) {
      changed.add(item.id);
      await db.query("DELETE FROM schedules WHERE id=$1", [item.id]);
    }
  }
  for (const id of changed) {
    const schedule = newById.get(id) || oldById.get(id);
    const message = newById.has(id)
      ? `${schedule.wasteType} pickup ${schedule.status.toLowerCase()} for ${schedule.area} on ${schedule.date}.`
      : `${schedule.wasteType} collection previously scheduled for ${schedule.area} has been removed.`;
    const residents = await db.query("SELECT email FROM users WHERE role='resident' AND status='Active' AND area=$1", [schedule.area]);
    for (const resident of residents.rows) await insertNotification(db, resident.email,
      newById.has(id) ? `Collection update for ${schedule.area}` : "Collection schedule removed", message);
  }
}

function validateLocations(locations) {
  const areas = new Set();
  const ids = new Set();
  for (const location of locations) {
    if (!location || !validId(location.id) ||
        typeof location.area !== "string" || !location.area.trim() || location.area.length > 120 ||
        typeof location.barangay !== "string" || !location.barangay.trim() || location.barangay.length > 100 ||
        typeof location.street !== "string" || location.street.length > 160 ||
        typeof location.purok !== "string" || !location.purok.trim() || location.purok.length > 100 ||
        typeof location.landmark !== "string" || location.landmark.length > 160 ||
        areas.has(location.area.trim().toLowerCase()) || ids.has(location.id)) {
      throw new HttpError(400, "A community location is invalid or duplicates another area.");
    }
    areas.add(location.area.trim().toLowerCase());
    ids.add(location.id);
  }
}

async function syncLocations(db, oldLocations, newLocations) {
  validateLocations(newLocations);
  const oldById = new Map(oldLocations.map((item) => [item.id, item]));
  const newById = new Map(newLocations.map((item) => [item.id, item]));
  for (const item of newLocations) {
    const old = oldById.get(item.id);
    if (old && old.area !== item.area) {
      const references = await db.query(
        "SELECT EXISTS(SELECT 1 FROM users WHERE area=$1) OR EXISTS(SELECT 1 FROM reports WHERE area=$1) OR EXISTS(SELECT 1 FROM schedules WHERE area=$1) AS used",
        [old.area],
      );
      if (references.rows[0].used) throw new HttpError(409, "This location is already used by an account, report, or schedule. Keep its area label unchanged.");
    }
    await db.query(`
      INSERT INTO community_locations (id,area,barangay,street,purok,landmark)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET area=excluded.area,barangay=excluded.barangay,
        street=excluded.street,purok=excluded.purok,landmark=excluded.landmark
    `, [item.id, item.area.trim(), item.barangay.trim(), item.street.trim(), item.purok.trim(), item.landmark.trim()]);
  }
  for (const old of oldLocations) {
    if (newById.has(old.id)) continue;
    const references = await db.query(
      "SELECT EXISTS(SELECT 1 FROM users WHERE area=$1) OR EXISTS(SELECT 1 FROM reports WHERE area=$1) OR EXISTS(SELECT 1 FROM schedules WHERE area=$1) AS used",
      [old.area],
    );
    if (references.rows[0].used) throw new HttpError(409, "This location is already used by an account, report, or schedule and cannot be removed.");
    await db.query("DELETE FROM community_locations WHERE id=$1", [old.id]);
  }
}

function validateRecyclingLocations(locations) {
  const ids = new Set();
  for (const item of locations) {
    if (!item || !validId(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || item.name.length > 120 ||
        typeof item.barangay !== "string" || !item.barangay.trim() || item.barangay.length > 100 ||
        typeof item.street !== "string" || !item.street.trim() || item.street.length > 160 ||
        typeof item.purok !== "string" || item.purok.length > 100 ||
        typeof item.landmark !== "string" || item.landmark.length > 160 ||
        typeof item.materials !== "string" || !item.materials.trim() || item.materials.length > 500 ||
        typeof item.phone !== "string" || item.phone.length > 40 ||
        typeof item.hours !== "string" || item.hours.length > 120 ||
        typeof item.active !== "boolean" || ids.has(item.id)) {
      throw new HttpError(400, "A recycling or junkshop listing contains invalid data.");
    }
    ids.add(item.id);
  }
}

async function syncRecyclingLocations(db, oldLocations, newLocations) {
  validateRecyclingLocations(newLocations);
  const oldById = new Map(oldLocations.map((item) => [item.id, item]));
  const newById = new Map(newLocations.map((item) => [item.id, item]));
  for (const item of newLocations) {
    const old = oldById.get(item.id);
    if (!old || !jsonEqual(old, item)) {
      await db.query(`
        INSERT INTO recycling_locations (id,name,barangay,street,purok,landmark,materials,phone,hours,active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET name=excluded.name,barangay=excluded.barangay,
          street=excluded.street,purok=excluded.purok,landmark=excluded.landmark,
          materials=excluded.materials,phone=excluded.phone,hours=excluded.hours,active=excluded.active
      `, [item.id, item.name.trim(), item.barangay.trim(), item.street.trim(), item.purok.trim(),
        item.landmark.trim(), item.materials.trim(), item.phone.trim(), item.hours.trim(), item.active]);
    }
  }
  for (const old of oldLocations) {
    if (!newById.has(old.id)) await db.query("DELETE FROM recycling_locations WHERE id=$1", [old.id]);
  }
}

async function syncActivities(db, oldItems, newItems, user, administrator) {
  if (administrator) {
    validateActivityAppend(oldItems, newItems, user);
  } else {
    validateActivityAppend(oldItems, newItems, user);
  }
  for (const item of newItems.slice(oldItems.length)) {
    await db.query("INSERT INTO activities (id,actor,role,action,detail,at,result) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [item.id, item.actor, item.role, item.action, item.detail, item.at, item.result]);
  }
}

async function updateState(db, user, body) {
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new HttpError(400, "A valid database revision is required.");
  validateState(body.data);
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    const revision = await db.query("SELECT revision FROM app_meta WHERE id=1 FOR UPDATE");
    if (Number(revision.rows[0].revision) !== body.revision) throw new HttpError(409, "Data changed in another session. Reload before saving.");
    const before = await readFullState(db, user);
    const visibleBefore = stateForRole(before, user);
    const after = body.data;
    if (user.role === "resident") {
      requireRole(user, ["resident"]);
      if (after.users.length !== 1 || after.users[0].id !== user.id) throw new HttpError(403, "Residents can only update their own account.");
      const oldAccount = visibleBefore.users[0];
      const nextAccount = after.users[0];
      const immutableAccount = ({ name, area, phone, ...account }) => account;
      if (!jsonEqual(immutableAccount(oldAccount), immutableAccount(nextAccount))) throw new HttpError(403, "Residents cannot change account access or sign-in details.");
      validateAccount(nextAccount);
      for (const oldReport of visibleBefore.reports) {
        const incoming = after.reports.find((report) => report.id === oldReport.id);
        if (!incoming || !jsonEqual(oldReport, incoming)) throw new HttpError(403, "Existing reports cannot be changed by residents.");
      }
      const addedReports = after.reports.filter((report) => !visibleBefore.reports.some((old) => old.id === report.id));
      for (const report of addedReports) {
        validateReport(report);
        if (!report.barangay?.trim() || !report.locationDetail?.trim()) {
          throw new HttpError(400, "A new report must include its barangay and street or landmark.");
        }
        await assertKnownArea(db, report.area, report.barangay || "");
        if (report.userEmail !== user.email || report.status !== "Submitted" || report.history.length !== 1) {
          throw new HttpError(403, "Residents can only submit a new report for their own account.");
        }
      }
      if (!jsonEqual(visibleBefore.schedules, after.schedules) ||
          !jsonEqual(visibleBefore.permissions, after.permissions) ||
          !jsonEqual(visibleBefore.announcements, after.announcements) ||
          !jsonEqual(visibleBefore.locations, after.locations) ||
          !jsonEqual(visibleBefore.recyclingLocations, after.recyclingLocations)) throw new HttpError(403, "You cannot change shared workspace data.");
      validateNotificationsReadOnly(visibleBefore.notifications, after.notifications, user);
      if (after.activities.length < visibleBefore.activities.length) throw new HttpError(403, "Activity history cannot be removed.");
      await db.query("UPDATE users SET name=$1, area=$2, phone=$3 WHERE id=$4", [nextAccount.name.trim(), nextAccount.area.trim(), nextAccount.phone.trim(), user.id]);
      await syncNotifications(db, visibleBefore.notifications, after.notifications, user);
      for (const report of addedReports) {
        report.name = nextAccount.name;
        if (report.assignedTo) throw new HttpError(403, "New reports cannot be assigned by residents.");
        report.assignedTo = null;
        report.history[0].actorName = nextAccount.name;
        report.history[0].actorRole = "resident";
        await insertReport(db, report);
        const staff = await db.query("SELECT email FROM users WHERE role IN ('official','administrator') AND status='Active'");
        for (const account of staff.rows) await insertNotification(db, account.email,
          report.urgent ? `Urgent concern: ${report.title}` : `New concern: ${report.title}`,
          `${report.name} submitted a report for ${report.barangay}, ${report.area}, near ${report.locationDetail}.`, report.id);
        await insertNotification(db, user.email, "Report submitted",
          `Your concern ${report.id} was submitted and is now on file.`, report.id);
      }
      await syncActivities(db, visibleBefore.activities, after.activities, user, false);
    } else if (user.role === "official") {
      if (after.users.length || !jsonEqual(visibleBefore.permissions, after.permissions) ||
          !jsonEqual(visibleBefore.announcements, after.announcements) ||
          !jsonEqual(visibleBefore.locations, after.locations) ||
          !jsonEqual(visibleBefore.recyclingLocations, after.recyclingLocations)) throw new HttpError(403, "Officials cannot change accounts, locations, or announcements.");
      requireRole(user, ["official"]);
      if (!before.permissions.official.manageReports && !jsonEqual(visibleBefore.reports, after.reports)) {
        throw new HttpError(403, "Report management is not enabled for this role.");
      }
      if (!before.permissions.official.manageSchedules && !jsonEqual(visibleBefore.schedules, after.schedules)) {
        throw new HttpError(403, "Schedule management is not enabled for this role.");
      }
      if (after.reports.length !== visibleBefore.reports.length) throw new HttpError(403, "Officials cannot add or remove resident reports.");
      for (const oldReport of visibleBefore.reports) {
        const incoming = after.reports.find((report) => report.id === oldReport.id);
        if (!incoming) throw new HttpError(403, "Officials cannot remove resident reports.");
        if (!jsonEqual(oldReport, incoming)) {
          const previousCore = (({ status, updatedAt, history, assignedTo, ...rest }) => rest)(oldReport);
          const incomingCore = (({ status, updatedAt, history, assignedTo, ...rest }) => rest)(incoming);
          const assignmentChanged = !jsonEqual(oldReport.assignedTo, incoming.assignedTo);
          const statusChanged = incoming.status !== oldReport.status ||
            incoming.updatedAt !== oldReport.updatedAt ||
            !jsonEqual(oldReport.history, incoming.history);
          const validStatusUpdate = statusChanged &&
            incoming.history.length === oldReport.history.length + 1 &&
            jsonEqual(oldReport.history, incoming.history.slice(0, -1)) &&
            incoming.history.at(-1).status === incoming.status &&
            incoming.history.at(-1).at === incoming.updatedAt;
          if (!jsonEqual(previousCore, incomingCore) ||
              (statusChanged && !validStatusUpdate) ||
              (!assignmentChanged && !statusChanged)) {
            throw new HttpError(403, "Officials may only claim or release an assignment and add a report status update.");
          }
          if (assignmentChanged) {
            const previousAssigneeId = oldReport.assignedTo?.id || null;
            const nextAssigneeId = incoming.assignedTo?.id || null;
            const claiming = !previousAssigneeId && nextAssigneeId === user.id;
            const releasing = previousAssigneeId === user.id && !nextAssigneeId;
            if (!claiming && !releasing) throw new HttpError(403, "Officials can only claim unassigned concerns or release their own assignment.");
            if (claiming) {
              const official = await db.query(
                "SELECT id, name FROM users WHERE id=$1 AND role='official' AND status='Active'",
                [user.id],
              );
              if (!official.rows.length) throw new HttpError(403, "Only an active barangay official can claim a concern.");
              incoming.assignedTo = { id: official.rows[0].id, name: official.rows[0].name };
            } else {
              incoming.assignedTo = null;
            }
          } else {
            incoming.assignedTo = oldReport.assignedTo;
          }
          if (validStatusUpdate) {
            incoming.history.at(-1).actorName = user.name;
            incoming.history.at(-1).actorRole = user.role;
          }
          validateReport(incoming);
          await replaceReport(db, incoming);
          if (validStatusUpdate) {
            await insertNotification(db, incoming.userEmail, `Report ${incoming.status.toLowerCase()}`,
              `${incoming.id}: ${incoming.history.at(-1).note || `Your concern is now ${incoming.status.toLowerCase()}.`}`, incoming.id);
          }
        }
      }
      await syncSchedules(db, visibleBefore.schedules, after.schedules);
      await syncNotifications(db, visibleBefore.notifications, after.notifications, user);
      await syncActivities(db, visibleBefore.activities, after.activities, user, false);
    } else {
      requireRole(user, ["administrator"]);
      if (after.users.length !== before.users.length) throw new HttpError(403, "Create accounts through the account management form.");
      const oldUsers = new Map(before.users.map((account) => [account.id, account]));
      for (const account of after.users) {
        const old = oldUsers.get(account.id);
        if (!old) throw new HttpError(403, "Account identifiers cannot be added or replaced through a state update.");
        validateAccount(account);
        if (account.role === "resident") await assertKnownArea(db, account.area);
        if (old.id === user.id && (account.email !== old.email || account.role !== "administrator" || account.status !== "Active")) {
          throw new HttpError(403, "You cannot change your own administrator sign-in or access.");
        }
        await db.query("UPDATE users SET email=$1,name=$2,area=$3,phone=$4,role=$5,status=$6 WHERE id=$7",
          [account.email.trim().toLowerCase(), account.name.trim(), account.area.trim(), account.phone.trim(), account.role, account.status, account.id]);
      }
      const activeAdmins = await db.query("SELECT count(*)::integer AS count FROM users WHERE role='administrator' AND status='Active'");
      if (Number(activeAdmins.rows[0].count) < 1) throw new HttpError(400, "At least one active administrator must remain.");
      for (const old of before.reports) {
        const incoming = after.reports.find((report) => report.id === old.id);
        if (!incoming) throw new HttpError(403, "Reports cannot be deleted from the administrator workspace.");
        if (!jsonEqual(old.assignedTo, incoming.assignedTo) || !jsonEqual(old.history, incoming.history)) {
          throw new HttpError(403, "Report assignments and status history can only be changed through the concern queue.");
        }
      }
      for (const report of after.reports) await replaceReport(db, report);
      await syncSchedules(db, before.schedules, after.schedules);
      await syncLocations(db, before.locations, after.locations);
      await syncRecyclingLocations(db, before.recyclingLocations, after.recyclingLocations);
      if (!jsonEqual(before.announcements, after.announcements)) throw new HttpError(403, "Announcements cannot be changed through this workspace.");
      await syncNotifications(db, visibleBefore.notifications, after.notifications, user);
      for (const role of ROLES) {
        if (!after.permissions[role] || typeof after.permissions[role] !== "object") throw new HttpError(400, "Role permissions are invalid.");
        if (Object.keys(after.permissions[role]).length !== Object.keys(PERMISSIONS[role]).length) {
          throw new HttpError(400, "Role permissions are incomplete.");
        }
        for (const [permission, enabled] of Object.entries(after.permissions[role])) {
          if (typeof enabled !== "boolean" || !Object.hasOwn(PERMISSIONS[role], permission)) throw new HttpError(400, "Role permissions are invalid.");
          await db.query("INSERT INTO role_permissions(role,permission,enabled) VALUES($1,$2,$3) ON CONFLICT(role,permission) DO UPDATE SET enabled=excluded.enabled",
            [role, permission, enabled]);
        }
      }
      const capableAdmins = await db.query(`
        SELECT u.id FROM users u
        JOIN role_permissions p ON p.role='administrator' AND p.permission IN ('manageUsers','manageRoles') AND p.enabled
        WHERE u.role='administrator' AND u.status='Active'
        GROUP BY u.id HAVING count(*)=2
      `);
      if (!capableAdmins.rows.length) throw new HttpError(400, "Keep at least one active administrator with both account and role management enabled.");
      await syncActivities(db, before.activities, after.activities, user, true);
    }
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  });
  await runScheduleReminders(db);
  return Number((await db.query("SELECT revision FROM app_meta WHERE id=1")).rows[0].revision);
}

export async function runScheduleReminders(db) {
  const result = await db.query(`
    WITH due AS MATERIALIZED (
      SELECT s.id AS schedule_id, s.area, s.date, s.start_time, s.waste_type, u.email AS user_email
      FROM schedules s
      JOIN users u ON u.area=s.area AND u.role='resident' AND u.status='Active'
      WHERE s.date=CURRENT_DATE + 1 AND s.status NOT IN ('Completed','Cancelled')
    ), inserted AS (
      INSERT INTO schedule_reminders (schedule_id,user_email)
      SELECT schedule_id,user_email FROM due
      ON CONFLICT (schedule_id,user_email) DO NOTHING
      RETURNING schedule_id,user_email
    )
    INSERT INTO notifications (id,target_email,title,body,created_at,read)
    SELECT 'collection-reminder:' || inserted.schedule_id || ':' || md5(inserted.user_email),
      inserted.user_email, 'Collection reminder',
      due.waste_type || ' collection for ' || due.area || ' is scheduled tomorrow, ' ||
        to_char(due.date,'FMMonth FMDD') || ' at ' || due.start_time || '.',
      now(), false
    FROM inserted
    JOIN due ON due.schedule_id=inserted.schedule_id AND due.user_email=inserted.user_email
  `);
  return result.rowCount;
}

async function createUser(db, user, body) {
  requireRole(user, ["administrator"]);
  const { email, name, area, phone = "", role, status = "Active", password } = body || {};
  validateAccount({ email, name, area, phone });
  if (role === "resident") await assertKnownArea(db, area);
  validatePassword(password);
  if (!ROLES.includes(role) || !["Active", "Inactive"].includes(status)) throw new HttpError(400, "Choose a valid role and account status.");
  const id = randomUUID();
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    await db.query("INSERT INTO users (id,email,name,area,phone,role,status) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, email.trim().toLowerCase(), name.trim(), area.trim(), phone.trim(), role, status]);
    await db.query("INSERT INTO user_credentials (user_id,password_hash) VALUES ($1,$2)", [id, await passwordHash(password)]);
    await insertActivity(db, user, "Added user account", `${name.trim()} · ${role}`);
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  }).catch((error) => {
    if (error.code === "23505") throw new HttpError(409, "An account already uses this email address.");
    throw error;
  });
}

function validateAnnouncement(body) {
  const date = typeof body.date === "string" ? new Date(`${body.date}T00:00:00Z`) : new Date(Number.NaN);
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 120 ||
      typeof body.detail !== "string" || !body.detail.trim() || body.detail.length > 1000 ||
      typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.date) {
    throw new HttpError(400, "Enter a title, message, and valid announcement date.");
  }
}

async function handleApi(request, response, db, options) {
  const { server, appOrigin, secureCookies, trustedProxyAddresses } = options;
  if (!validateSameOrigin(request, server, appOrigin)) {
    sendJson(response, 403, { error: "This request did not come from the CommUnity website." });
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host}`);
  const user = await getSessionUser(request, db);
  if (url.pathname === "/api/locations" && request.method === "GET") {
    const locations = await db.query("SELECT id,area,barangay,street,purok,landmark FROM community_locations ORDER BY barangay,purok,street,id");
    sendJson(response, 200, { locations: locations.rows });
    return;
  }
  if (url.pathname === "/api/announcements" && ["POST", "PUT", "DELETE"].includes(request.method)) {
    requireRole(user, ["official", "administrator"]);
    const permission = await db.query(
      "SELECT enabled FROM role_permissions WHERE role=$1 AND permission='manageAnnouncements'",
      [user.role],
    );
    if (!permission.rows[0]?.enabled) throw new HttpError(403, "Announcement management is not enabled for this role.");
    const body = await readJson(request);
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      if (request.method === "DELETE") {
        if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) throw new HttpError(400, "Choose a valid announcement.");
        const deleted = await db.query("DELETE FROM announcements WHERE id=$1", [Number(body.id)]);
        if (!deleted.rowCount) throw new HttpError(404, "This announcement could not be found.");
        await insertActivity(db, user, "Removed an announcement", `Announcement ${body.id}`);
      } else {
        validateAnnouncement(body);
        if (request.method === "POST") {
          await db.query("INSERT INTO announcements (title,detail,date) VALUES ($1,$2,$3)",
            [body.title.trim(), body.detail.trim(), body.date]);
          await insertActivity(db, user, "Published an announcement", body.title.trim());
        } else {
          if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) throw new HttpError(400, "Choose a valid announcement.");
          const updated = await db.query("UPDATE announcements SET title=$1,detail=$2,date=$3 WHERE id=$4",
            [body.title.trim(), body.detail.trim(), body.date, Number(body.id)]);
          if (!updated.rowCount) throw new HttpError(404, "This announcement could not be found.");
          await insertActivity(db, user, "Updated an announcement", body.title.trim());
        }
      }
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const [state, revision] = await Promise.all([
      readFullState(db, user),
      db.query("SELECT revision FROM app_meta WHERE id=1"),
    ]);
    sendJson(response, 200, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return;
  }
  if (url.pathname === "/api/profile" && request.method === "PUT") {
    requireRole(user, ROLES);
    const body = await readJson(request);
    validateAccount({ ...body, email: user.email });
    if (user.role === "resident") await assertKnownArea(db, body.area);
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      await db.query("UPDATE users SET name=$1,area=$2,phone=$3 WHERE id=$4",
        [body.name.trim(), body.area.trim(), String(body.phone || "").trim(), user.id]);
      await insertActivity(db, { ...user, name: body.name.trim() }, "Updated profile information", user.email);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const updatedUser = await getSessionUser(request, db);
    const [state, revision] = await Promise.all([
      readFullState(db, updatedUser),
      db.query("SELECT revision FROM app_meta WHERE id=1"),
    ]);
    sendJson(response, 200, {
      data: stateForRole(state, updatedUser),
      revision: Number(revision.rows[0].revision),
      user: publicUser(updatedUser),
    });
    return;
  }
  if (url.pathname === "/api/session" && request.method === "GET") {
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" && body.password.length <= MAX_PASSWORD_LENGTH ? body.password : "";
    const clientAddress = requestClientAddress(request, trustedProxyAddresses);
    const ipAttemptKey = hash(`login-ip:${clientAddress}`);
    const accountAttemptKey = hash(`login-account:${email}`);
    await recordAttempt(db, ipAttemptKey, 100);
    await recordAttempt(db, accountAttemptKey);
    const result = await db.query(`
      SELECT u.id,u.email,u.name,u.area,u.phone,u.role,u.status,to_char(u.joined_at,'YYYY-MM-DD') AS "joinedAt",c.password_hash
      FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.email=$1
    `, [email]);
    const account = result.rows[0];
    const passwordMatches = await verifyPassword(password, account?.password_hash ||
      "scrypt$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
    if (!account || !passwordMatches || account.status !== "Active") {
      throw new HttpError(401, "Those sign-in details do not match an active account.");
    }
    await db.query("DELETE FROM auth_attempts WHERE attempt_key=$1", [accountAttemptKey]);
    await issueSession(response, db, account, Boolean(body.remember), secureCookies);
    await insertActivity(db, account, "Signed in", account.role);
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    sendJson(response, 200, { user: publicUser(account) });
    return;
  }
  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    await recordAttempt(db, hash(`register:${requestClientAddress(request, trustedProxyAddresses)}`));
    validateAccount({ email, name: body.name, area: body.area, phone: body.phone || "" });
    validatePassword(body.password);
    if (body.password !== body.confirmPassword) throw new HttpError(400, "The passwords do not match.");
    const id = randomUUID();
    const newUser = { id, email, name: body.name.trim(), area: body.area.trim(), phone: String(body.phone || "").trim(), role: "resident", status: "Active" };
    await assertKnownArea(db, newUser.area);
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      await db.query("INSERT INTO users (id,email,name,area,phone,role,status) VALUES ($1,$2,$3,$4,$5,'resident','Active')",
        [id, email, newUser.name, newUser.area, newUser.phone]);
      await db.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)", [id, await passwordHash(body.password)]);
      await insertActivity(db, newUser, "Created resident account", `${newUser.name} · ${newUser.area}`);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    }).catch((error) => {
      if (error.code === "23505") throw new HttpError(409, "An account already uses this email address.");
      throw error;
    });
    await issueSession(response, db, newUser, true, secureCookies);
    sendJson(response, 201, { user: publicUser(newUser) });
    return;
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await db.query("DELETE FROM web_sessions WHERE token_hash=$1", [hash(token)]);
    response.setHeader("Set-Cookie", clearSessionCookie(secureCookies));
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/auth/password" && request.method === "POST") {
    requireRole(user, ROLES);
    const body = await readJson(request);
    validatePassword(body.newPassword);
    if (body.newPassword !== body.confirmPassword) throw new HttpError(400, "The new passwords do not match.");
    const current = await db.query("SELECT password_hash FROM user_credentials WHERE user_id=$1", [user.id]);
    if (!await verifyPassword(String(body.currentPassword || ""), current.rows[0]?.password_hash)) {
      throw new HttpError(400, "The current password does not match this account.");
    }
    const token = cookieValue(request, SESSION_COOKIE);
    await db.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [await passwordHash(body.newPassword), user.id]);
    await db.query("DELETE FROM web_sessions WHERE user_id=$1 AND token_hash<>$2", [user.id, hash(token)]);
    await insertActivity(db, user, "Changed account password", user.email);
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/state" && request.method === "GET") {
    requireRole(user, ROLES);
    const [state, revision] = await Promise.all([
      readFullState(db, user),
      db.query("SELECT revision FROM app_meta WHERE id=1"),
    ]);
    sendJson(response, 200, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return;
  }
  if (url.pathname === "/api/state" && request.method === "PUT") {
    requireRole(user, ROLES);
    const body = await readJson(request);
    const revision = await updateState(db, user, body);
    const currentUser = await getSessionUser(request, db);
    const state = await readFullState(db, currentUser);
    sendJson(response, 200, { revision, data: stateForRole(state, currentUser), user: publicUser(currentUser) });
    return;
  }
  if (url.pathname === "/api/users/password" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    validatePassword(body.newPassword);
    if (body.newPassword !== body.confirmPassword) throw new HttpError(400, "The new passwords do not match.");
    if (!email || email === user.email) throw new HttpError(400, "Choose another account to reset.");
    await withTransaction(db, async (transaction) => {
      const target = await transaction.query("SELECT id, name FROM users WHERE email=$1", [email]);
      if (!target.rows.length) throw new HttpError(404, "The account could not be found.");
      await transaction.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [
        await passwordHash(body.newPassword),
        target.rows[0].id,
      ]);
      await transaction.query("DELETE FROM web_sessions WHERE user_id=$1", [target.rows[0].id]);
      await insertActivity(transaction, user, "Reset user password", target.rows[0].name);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const currentUser = await getSessionUser(request, db);
    const [state, revision] = await Promise.all([
      readFullState(db, currentUser),
      db.query("SELECT revision FROM app_meta WHERE id=1"),
    ]);
    sendJson(response, 200, {
      data: stateForRole(state, currentUser),
      revision: Number(revision.rows[0].revision),
      user: publicUser(currentUser),
    });
    return;
  }
  if (url.pathname === "/api/users" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    await createUser(db, user, await readJson(request));
    const [state, revision] = await Promise.all([readFullState(db, user), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 201, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

function addSecurityHeaders(response, secure) {
  response.setHeader("Cache-Control", "no-store");
  // Leaflet positions tiles and markers through inline style attributes.
  response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; font-src 'self'; frame-src 'none'");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  if (secure) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

export async function createCommunityServer({
  dataDir = path.join(PROJECT_DIR, "data", "pglite"),
  databaseUrl = process.env.DATABASE_URL || "",
  port = 8768,
  host = databaseUrl ? "0.0.0.0" : "127.0.0.1",
  appOrigin = process.env.APP_ORIGIN || "",
  trustedProxyIps = process.env.TRUSTED_PROXY_IPS || "",
  poolMax = Number(process.env.PG_POOL_MAX || 10),
  connectionTimeoutMillis = Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
  initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL || "",
  initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD || "",
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
  const db = await createDatabase({ dataDir, databaseUrl, poolMax, connectionTimeoutMillis });
  await migrate(db);
  await ensureAdministrator(db, initialAdminEmail, initialAdminPassword);
  await pruneExpiredAuthState(db);
  await runScheduleReminders(db);
  const reminderTimer = setInterval(() => {
    runScheduleReminders(db).catch((error) => logError("CommUnity could not create collection reminders.", error));
    pruneExpiredAuthState(db).catch((error) => logError("CommUnity could not prune expired authentication data.", error));
  }, 15 * 60 * 1000);
  reminderTimer.unref();
  const server = createServer(async (request, response) => {
    const secure = production || Boolean(databaseUrl);
    addSecurityHeaders(response, secure);
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    try {
      if (request.url?.split("?")[0] === "/healthz") {
        if (request.method !== "GET") {
          response.writeHead(405, { Allow: "GET" }).end();
          return;
        }
        await db.query("SELECT 1");
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (request.url?.startsWith("/api/")) {
        await handleApi(request, response, db, { server, appOrigin, secureCookies: secure, trustedProxyAddresses });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const pathname = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`).pathname;
      const filename = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
      if (!PUBLIC_FILES.has(filename)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(path.join(PROJECT_DIR, filename));
      response.writeHead(200, {
        "Content-Length": body.length,
        "Content-Type": CONTENT_TYPES[path.extname(filename)],
        "Cache-Control": filename === "index.html" ? "no-cache" : "public, max-age=300",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof URIError) {
        sendJson(response, 400, { error: "Invalid URL encoding." });
        return;
      }
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      if (error.code === "23505") {
        sendJson(response, 409, { error: "A record with that identifier or email already exists." });
        return;
      }
      logError("CommUnity server request failed.", error, {
        requestId,
        method: request.method,
        path: request.url?.split("?")[0] || "/",
      });
      sendJson(response, 500, { error: "The server could not complete this request." });
    }
  });
  return {
    db,
    server,
    close: async () => {
      clearInterval(reminderTimer);
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
    console.log(process.env.DATABASE_URL
      ? "Using managed PostgreSQL. Configure TLS at the hosting provider."
      : "Using local PGlite storage on this computer only.");
  });
  const stop = async () => {
    await close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
