import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import Busboy from "busboy";
import nodemailer from "nodemailer";
import { CONTENT_TYPES, createExpressApp, MAX_STATE_BYTES } from "./http-app.mjs";

const scrypt = promisify(scryptCallback);
const PROJECT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UPLOADS_DIR = path.join(PROJECT_DIR, "data", "uploads");
// CommUnity serves one barangay, so every calendar decision uses its local day
// rather than the host's or the viewer's. Override only for a different municipality.
const DEFAULT_TIME_ZONE = "Asia/Manila";
let appTimeZone = DEFAULT_TIME_ZONE;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_EXTENSIONS = [".jpg", ".png"];
const ORPHAN_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PASSWORD_LENGTH = 200;
const SESSION_COOKIE = "community_session";
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;
const REPORT_STATUSES = ["Submitted", "Under Review", "In Progress", "Resolved"];
const REPORT_TRANSITIONS = {
  Submitted: ["Under Review"],
  "Under Review": ["In Progress"],
  "In Progress": ["Resolved"],
  Resolved: [],
};
const REPORT_PRIORITIES = ["High", "Medium", "Low"];
const RESET_TOKEN_MINUTES = 15;
const RESET_EMAIL_COOLDOWN_MINUTES = 2;
const FORGOT_PASSWORD_IP_LIMIT = 10;
const FORGOT_PASSWORD_EMAIL_LIMIT = 3;
const RECOVERY_VERIFY_LIMIT = 5;
const FOLLOW_UP_LIMITS = { High: null, Medium: 5, Low: 3 };
// Two separate service targets, both measured from the moment the concern was submitted:
// the first staff response, and the resolution of the concern itself.
const RESPONSE_DEADLINE_DAYS = { High: 1, Medium: 3, Low: 7 };
const RESOLUTION_DEADLINE_DAYS = { High: 7, Medium: 14, Low: 30 };
const SCHEDULE_STATUSES = ["Scheduled", "On the way", "Collecting", "Completed", "Delayed", "Cancelled", "Rescheduled"];
const ROLES = ["resident", "official", "administrator"];
const PERMISSIONS = {
  resident: { submitReports: true, viewSchedules: true, manageReports: false, manageSchedules: false, manageAnnouncements: false, manageUsers: false, manageRoles: false, viewAudit: false },
  official: { submitReports: false, viewSchedules: true, manageReports: true, manageSchedules: true, manageAnnouncements: true, manageUsers: false, manageRoles: false, viewAudit: false },
  administrator: { submitReports: false, viewSchedules: true, manageReports: true, manageSchedules: true, manageAnnouncements: true, manageUsers: true, manageRoles: true, viewAudit: true },
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
  const time = appTimeLabel();
  const detail = error?.message || String(error || "");
  const code = error?.code ? ` [${error.code}]` : "";
  const where = context.path ? ` (${context.method || "request"} ${context.path})` : "";
  console.error(`[${time}] ✗ ERROR: ${message}${where} — ${detail}${code}`);
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

function requireJsonBody(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
}

async function readMultipart(request, { maxFiles = 3 } = {}) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new HttpError(415, "Content-Type must be multipart/form-data.");
  }
  return new Promise((resolve, reject) => {
    const parser = Busboy({ headers: request.headers, limits: { files: maxFiles, fileSize: MAX_PHOTO_BYTES } });
    const files = [];
    let failed = false;
    parser.on("file", (fieldName, stream, info) => {
      if (fieldName !== "photos") {
        stream.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      stream.on("data", (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });
      stream.on("limit", () => {
        failed = true;
        reject(new HttpError(413, `${info.filename}: photo files must be 5 MB or smaller.`));
      });
      stream.on("end", () => {
        if (!failed) files.push({ name: info.filename, type: info.mimeType, data: Buffer.concat(chunks), size });
      });
    });
    parser.on("filesLimit", () => reject(new HttpError(400, "Attach up to three photos to one report.")));
    parser.on("error", reject);
    parser.on("finish", () => {
      if (!failed) resolve(files);
    });
    request.pipe(parser);
  });
}

// The browser-declared MIME type is easy to spoof, so the file signature decides
// what is stored and what Content-Type is later served. Only JPEG and PNG pass.
function photoExtension(data) {
  if (!Buffer.isBuffer(data)) return "";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ".jpg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  return "";
}

function createMailer({ smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom }) {
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !smtpFrom) return null;
  return nodemailer.createTransport({
    host: smtpHost,
    port: Number(smtpPort),
    secure: Number(smtpPort) === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

function queueEmail(mailer, message) {
  if (!mailer) return;
  mailer.sendMail(message).catch((error) => logError("CommUnity could not send an email.", error, { subject: message.subject }));
}

function encryptSettings(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptSettings(value, key) {
  const [iv, tag, encrypted] = String(value).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
}

function publicSmtpSettings(settings) {
  return {
    host: settings?.host || "",
    port: settings?.port || "",
    user: settings?.user || "",
    from: settings?.from || "",
    configured: Boolean(settings?.host && settings?.port && settings?.user && settings?.pass && settings?.from),
  };
}

async function loadSmtpSettings(db, encryptionKey, fallback) {
  if (!encryptionKey) return fallback;
  const result = await db.query("SELECT encrypted_value FROM app_settings WHERE key='smtp'");
  if (!result.rows[0]) return fallback;
  try {
    return decryptSettings(result.rows[0].encrypted_value, encryptionKey);
  } catch (error) {
    logError("CommUnity could not decrypt saved SMTP settings.", error);
    return fallback;
  }
}

function cookieValue(request, name) {
  for (const part of (request.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return "";
      }
    }
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

function resolveTimeZone(value) {
  const zone = String(value || "").trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
  } catch {
    throw new Error(`APP_TIME_ZONE must be a valid IANA time zone such as ${DEFAULT_TIME_ZONE}.`);
  }
  return zone;
}

function configureAppTimeZone(value) {
  appTimeZone = resolveTimeZone(value);
  return appTimeZone;
}

function appDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

// The calendar day in the barangay's time zone. This is what a "today" check means.
function appDateISO(value = new Date()) {
  const parts = appDateParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

// Date-only values carry a literal calendar day, so they are anchored at UTC
// midnight and shown in the barangay's zone to keep that day intact. Timestamps
// are shown in the barangay's zone so the displayed day never follows the viewer.
function parseAppDate(value) {
  if (value instanceof Date) return value;
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`);
  return new Date(text);
}

function appDateLabel(value, options = {}) {
  const date = parseAppDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeZone: appTimeZone, ...options }).format(date);
}

function appTimeLabel(value = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: appTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value instanceof Date ? value : new Date(value));
}

function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function publicUser(user) {
  if (!user) return null;
  const { id, email, name, area, phone, role, status, joinedAt, workingHours, availableDays, requiresPasswordChange, recoveryEmail, recoveryEmailVerified, resetRequested, photoUrl } = user;
  return { id, email, name, area, phone, role, status, joinedAt, workingHours, availableDays, requiresPasswordChange: Boolean(requiresPasswordChange), recoveryEmail: recoveryEmail || "", recoveryEmailVerified: Boolean(recoveryEmailVerified), resetRequested: Boolean(resetRequested), photoUrl: photoUrl || "" };
}

function validateAccount({ email, name, area, phone = "" }) {
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100) throw new HttpError(400, "Enter a name between 2 and 100 characters.");
  if (typeof area !== "string" || area.trim().length < 2 || area.length > 120) throw new HttpError(400, "Enter a valid area.");
  if (typeof phone !== "string" || phone.length > 40) throw new HttpError(400, "Contact number is too long.");
}

const OFFICIAL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_OFFICIAL_DAYS = OFFICIAL_DAYS.slice(0, 5);

function validateWorkingHours(value) {
  const dayList = `(?:${OFFICIAL_DAYS.join("|")})(?:,\\s*(?:${OFFICIAL_DAYS.join("|")}))*`;
  const match = typeof value === "string" &&
    value.match(new RegExp(`^(?:(?:Monday-Friday|${dayList}),\\s*)?(\\d{1,2}:\\d{2}\\s[AP]M)-(\\d{1,2}:\\d{2}\\s[AP]M)$`, "i"));
  if (!match) throw new HttpError(400, "Choose valid working-hours start and end times.");
  const minutesAfterMidnight = (time) => {
    const [clock, period] = time.split(" ");
    const [hour, minute] = clock.split(":").map(Number);
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return -1;
    return (hour % 12 + (period.toUpperCase() === "PM" ? 12 : 0)) * 60 + minute;
  };
  const start = minutesAfterMidnight(match[1]);
  const end = minutesAfterMidnight(match[2]);
  if (value.length > 120 || start < 0 || end < 0 || end <= start) {
    throw new HttpError(400, "Working-hours end time must be after its start time.");
  }
}

function validateAvailableDays(value = DEFAULT_OFFICIAL_DAYS) {
  if (!Array.isArray(value) || value.length < 1 || value.length > OFFICIAL_DAYS.length ||
      value.some((day) => typeof day !== "string" || !OFFICIAL_DAYS.includes(day)) ||
      new Set(value).size !== value.length) {
    throw new HttpError(400, "Select at least one valid day the official is available.");
  }
  return OFFICIAL_DAYS.filter((day) => value.includes(day));
}

async function assertKnownArea(db, area, barangay = "") {
  const result = await db.query("SELECT 1 FROM community_locations WHERE area=$1 AND ($2='' OR barangay=$2)", [area.trim(), barangay.trim()]);
  if (!result.rows.length) throw new HttpError(400, "Choose an area managed in the community location settings.");
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Use a password between 8 and ${MAX_PASSWORD_LENGTH} characters.`);
  }
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value);
}

function validISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeReportPriority(report) {
  if (!report || typeof report !== "object") return;
  if (report.priority === undefined) report.priority = report.urgent ? "High" : "Medium";
  report.urgent = report.priority === "High";
}

function serviceDeadline(anchor, days) {
  return new Date(anchor.getTime() + days * 86400000).toISOString();
}

// The service clock runs on an anchor of its own, not on the submission date. It
// starts when the concern is submitted and restarts when a resident reopens it,
// so a later priority change measures against the current cycle instead of
// pulling the deadlines back to the original submission.
function serviceCycleAnchor(source) {
  if (!source) return new Date();
  const started = source.serviceCycleStartedAt || source.submittedAt;
  const anchor = started ? new Date(started) : new Date();
  return Number.isNaN(anchor.getTime()) ? new Date() : anchor;
}

// Each service target is set once, from the moment the current service cycle began.
function computeServiceDeadlines(report) {
  if (!report) return report;
  const anchor = serviceCycleAnchor(report);
  if (!report.responseDeadline) {
    report.responseDeadline = serviceDeadline(anchor, RESPONSE_DEADLINE_DAYS[report.priority] ?? RESPONSE_DEADLINE_DAYS.Medium);
  }
  if (!report.resolutionDeadline) {
    report.resolutionDeadline = serviceDeadline(anchor, RESOLUTION_DEADLINE_DAYS[report.priority] ?? RESOLUTION_DEADLINE_DAYS.Medium);
  }
  return report;
}

// The server owns the service-target fields and recalculates the overdue flags on
// read, so a client copy of them is neither trusted nor compared. A deadline that
// crosses between two reads must not look like a client edit.
function comparableReport(report, core = false) {
  const {
    respondedAt, responseDeadline, resolvedAt, resolutionDeadline,
    overdue, responseOverdue, resolutionOverdue,
    status, updatedAt, history, assignedTo, ...rest
  } = report;
  return core ? rest : { status, updatedAt, history, assignedTo, ...rest };
}

function validateReport(report) {
  normalizeReportPriority(report);
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
      !REPORT_PRIORITIES.includes(report.priority) ||
      (report.responseDeadline !== undefined && report.responseDeadline !== null && typeof report.responseDeadline !== "string") ||
      (report.respondedAt !== undefined && report.respondedAt !== null && typeof report.respondedAt !== "string") ||
      (report.resolutionDeadline !== undefined && report.resolutionDeadline !== null && typeof report.resolutionDeadline !== "string") ||
      (report.resolvedAt !== undefined && report.resolvedAt !== null && typeof report.resolvedAt !== "string") ||
      (report.assignedTo !== undefined && report.assignedTo !== null &&
        (!report.assignedTo || typeof report.assignedTo !== "object" || !validId(report.assignedTo.id) ||
          typeof report.assignedTo.name !== "string" || report.assignedTo.name.length > 100)) ||
      !Array.isArray(report.history) || report.history.length < 1 || report.history.length > 500 ||
      !Array.isArray(report.photos) || report.photos.length > 3) {
    throw new HttpError(400, "A report contains invalid or excessive data.");
  }
  for (const photo of report.photos) {
    if (!photo || typeof photo.name !== "string" || photo.name.length > 120 ||
        typeof photo.photoUrl !== "string" || !photo.photoUrl.startsWith(`/api/reports/${encodeURIComponent(report.id)}/photos/`)) {
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

function validateScheduleHistory(schedule) {
  const history = schedule?.history;
  if (history === undefined) return;
  if (!Array.isArray(history) || history.length > 100) throw new HttpError(400, "Collection history contains invalid data.");
  for (const item of history) {
    const previousStatus = item?.previousStatus ?? null;
    const replacementDate = item?.replacementDate ?? null;
    const previousDate = item?.previousDate ?? null;
    if (!item || !SCHEDULE_STATUSES.includes(item.status) ||
        (previousStatus !== null && !SCHEDULE_STATUSES.includes(previousStatus)) ||
        typeof item.at !== "string" || Number.isNaN(Date.parse(item.at)) ||
        typeof item.note !== "string" || item.note.length > 500 ||
        (item.actorName !== undefined && (typeof item.actorName !== "string" || item.actorName.length > 100)) ||
        (item.actorRole !== undefined && item.actorRole !== "" && !ROLES.includes(item.actorRole)) ||
        (replacementDate !== null && !validISODate(replacementDate)) ||
        typeof (item.replacementStart ?? "") !== "string" || (item.replacementStart ?? "").length > 30 ||
        typeof (item.replacementEnd ?? "") !== "string" || (item.replacementEnd ?? "").length > 30 ||
        (previousDate !== null && !validISODate(previousDate)) ||
        typeof (item.previousStart ?? "") !== "string" || (item.previousStart ?? "").length > 30 ||
        typeof (item.previousEnd ?? "") !== "string" || (item.previousEnd ?? "").length > 30) {
      throw new HttpError(400, "Collection history contains invalid data.");
    }
  }
  if (!history.length) return;
  const latest = history.at(-1);
  if (latest.status !== schedule.status) {
    throw new HttpError(400, "The latest collection history entry must match the current status.");
  }
  if (["Delayed", "Cancelled"].includes(schedule.status) && !latest.note.trim()) {
    throw new HttpError(400, `${schedule.status} collections need a reason in the collection history.`);
  }
  if (schedule.status === "Rescheduled" &&
      (!latest.replacementDate || !String(latest.replacementStart || "").trim() || !String(latest.replacementEnd || "").trim())) {
    throw new HttpError(400, "A rescheduled collection needs the replacement pickup date and time.");
  }
}

function validateSchedule(schedule) {
  const seriesId = schedule?.seriesId ?? null;
  const recurrenceEnd = schedule?.recurrenceEnd ?? null;
  if (!schedule || !validId(schedule.id) || typeof schedule.area !== "string" || schedule.area.length > 120 ||
      typeof schedule.zone !== "string" || schedule.zone.length > 100 ||
      typeof schedule.wasteType !== "string" || !schedule.wasteType.trim() || schedule.wasteType.length > 120 ||
      typeof schedule.date !== "string" || Number.isNaN(Date.parse(schedule.date)) ||
      typeof schedule.start !== "string" || schedule.start.length > 30 ||
      typeof schedule.end !== "string" || schedule.end.length > 30 ||
      typeof schedule.frequency !== "string" || schedule.frequency.length > 50 ||
      typeof schedule.team !== "string" || schedule.team.length > 120 ||
      (seriesId !== null && (typeof seriesId !== "string" || !validId(seriesId))) ||
      (recurrenceEnd !== null && !validISODate(recurrenceEnd)) ||
      !SCHEDULE_STATUSES.includes(schedule.status)) {
    throw new HttpError(400, "A collection schedule contains invalid data.");
  }
  validateScheduleHistory(schedule);
}

function normalizeSchedule(schedule) {
  return {
    id: schedule.id,
    area: schedule.area,
    zone: schedule.zone,
    date: schedule.date,
    wasteType: schedule.wasteType,
    start: schedule.start,
    end: schedule.end,
    frequency: schedule.frequency,
    team: schedule.team,
    status: schedule.status,
    seriesId: schedule.seriesId ?? null,
    recurrenceEnd: schedule.recurrenceEnd ?? null,
    history: (schedule.history || []).map((item) => ({
      previousStatus: item.previousStatus ?? null,
      status: item.status,
      at: item.at,
      actorName: item.actorName || "",
      actorRole: item.actorRole || "",
      note: item.note || "",
      previousDate: item.previousDate ?? null,
      previousStart: item.previousStart ?? null,
      previousEnd: item.previousEnd ?? null,
      replacementDate: item.replacementDate ?? null,
      replacementStart: item.replacementStart ?? null,
      replacementEnd: item.replacementEnd ?? null,
    })),
  };
}

function validateState(data) {
  if (!data || Array.isArray(data) || data.version !== 1 ||
      !["users", "reports", "schedules", "notifications", "activities", "announcements", "locations", "recyclingLocations"].every((key) => Array.isArray(data[key])) ||
      !data.permissions || typeof data.permissions !== "object" || Array.isArray(data.permissions) ||
      data.users.length > 10000 || data.reports.length > 10000 || data.schedules.length > 10000 ||
      data.notifications.length > 100000 || data.activities.length > 100000 || data.announcements.length > 1000 ||
      data.locations.length > 1000 || data.recyclingLocations.length > 1000 ||
      (Array.isArray(data.calendarEvents) && data.calendarEvents.length > 1000)) {
    throw new HttpError(400, "CommUnity data is invalid or exceeds supported limits.");
  }
  // Keep the accepted state shape inside the body limit enforced by the HTTP layer.
  // The report count above is sized for this ceiling, so a save fails with a clear
  // message here instead of an unexplained 413 at the parser.
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_STATE_BYTES) {
    throw new HttpError(413, "The portal state is larger than the 32 MB save limit. Export or archive old records before saving.");
  }
  if (data.reports.some((report) => !report || !validId(report.id)) ||
      new Set(data.reports.map((report) => report.id)).size !== data.reports.length) {
    throw new HttpError(400, "Report identifiers must be valid and unique.");
  }
  if (data.schedules.some((schedule) => !schedule || !validId(schedule.id)) ||
      new Set(data.schedules.map((schedule) => schedule.id)).size !== data.schedules.length) {
    throw new HttpError(400, "Schedule identifiers must be valid and unique.");
  }
  if (data.accountOverrides !== undefined) {
    if (!data.accountOverrides || typeof data.accountOverrides !== "object" || Array.isArray(data.accountOverrides)) {
      throw new HttpError(400, "Account permission overrides are invalid.");
    }
    for (const [email, overrides] of Object.entries(data.accountOverrides)) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !overrides || typeof overrides !== "object" || Array.isArray(overrides) ||
          Object.entries(overrides).some(([permission, enabled]) => typeof enabled !== "boolean" || !Object.hasOwn(PERMISSIONS.official, permission))) {
        throw new HttpError(400, "Account permission overrides are invalid.");
      }
    }
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
    accountOverrides: {},
    announcements: [],
    calendarEvents: [],
    locations: [],
    recyclingLocations: [],
  };
}

async function createDatabase({ dataDir, databaseUrl, poolMax, connectionTimeoutMillis, timeZone }) {
  // PostgreSQL session settings drive CURRENT_DATE, and every pooled connection starts
  // from the server default. Pin the zone on each acquired connection so a managed
  // database running in UTC still reports the barangay's calendar day.
  const setSessionTimeZone = (client) => client.query("SELECT set_config('TimeZone', $1, false)", [timeZone]);
  if (databaseUrl) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: true },
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

const MIGRATIONS = [
  {
    version: 1,
    name: "initial_schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE,
  name text NOT NULL, area text NOT NULL, phone text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator')),
  status text NOT NULL CHECK (status IN ('Active', 'Inactive')),
  working_hours text NOT NULL DEFAULT 'Monday-Friday, 8:00 AM-5:00 PM',
  available_days jsonb NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb,
  permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_password_change boolean NOT NULL DEFAULT false,
  deactivation_reason text NOT NULL DEFAULT '',
  recovery_email text NOT NULL DEFAULT '',
  reset_requested boolean NOT NULL DEFAULT false,
  joined_at date NOT NULL DEFAULT CURRENT_DATE
);`,
      `CREATE TABLE IF NOT EXISTS user_credentials (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL
);`,
      `CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY, user_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE,
  name text NOT NULL, category text NOT NULL, title text NOT NULL, area text NOT NULL,
  barangay text NOT NULL DEFAULT '',
  location_detail text NOT NULL DEFAULT '', latitude double precision, longitude double precision,
  description text NOT NULL, urgent boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'Medium',
  assigned_to text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('Submitted', 'Under Review', 'In Progress', 'Resolved')),
  submitted_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);`,
      `CREATE TABLE IF NOT EXISTS report_history (
  id bigserial PRIMARY KEY, report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  position integer NOT NULL, status text NOT NULL, at timestamptz NOT NULL, note text NOT NULL,
  actor_name text NOT NULL DEFAULT '', actor_role text NOT NULL DEFAULT '',
  UNIQUE (report_id, position)
);`,
      `CREATE TABLE IF NOT EXISTS report_photos (
  id bigserial PRIMARY KEY, report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  position integer NOT NULL, name text NOT NULL, photo_url text NOT NULL,
  UNIQUE (report_id, position)
);`,
      `CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY, area text NOT NULL, zone text NOT NULL, date date NOT NULL,
  waste_type text NOT NULL, start_time text NOT NULL, end_time text NOT NULL,
  frequency text NOT NULL, team text NOT NULL,
  series_id text, recurrence_end date,
  status text NOT NULL CHECK (status IN ('Scheduled', 'On the way', 'Collecting', 'Completed', 'Delayed', 'Cancelled', 'Rescheduled'))
);`,
      `CREATE TABLE IF NOT EXISTS schedule_history (
  id bigserial PRIMARY KEY, schedule_id text NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  position integer NOT NULL, previous_status text, status text NOT NULL,
  at timestamptz NOT NULL, actor_name text NOT NULL DEFAULT '', actor_role text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '', previous_date date, previous_start text NOT NULL DEFAULT '',
  previous_end text NOT NULL DEFAULT '', replacement_date date,
  replacement_start text NOT NULL DEFAULT '', replacement_end text NOT NULL DEFAULT '',
  UNIQUE (schedule_id, position)
);`,
      `CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY, target_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
  report_id text REFERENCES reports(id) ON DELETE SET NULL, title text NOT NULL,
  body text NOT NULL, created_at timestamptz NOT NULL, read boolean NOT NULL DEFAULT false
);`,
      `CREATE TABLE IF NOT EXISTS activities (
  id text PRIMARY KEY, actor text NOT NULL, role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator', 'system')),
  action text NOT NULL, detail text NOT NULL, at timestamptz NOT NULL, result text NOT NULL,
  result_reason text NOT NULL DEFAULT '', affected_id text NOT NULL DEFAULT '', client_ip text NOT NULL DEFAULT ''
);`,
      `CREATE TABLE IF NOT EXISTS activity_archive (
  id text PRIMARY KEY, actor text NOT NULL, role text NOT NULL,
  action text NOT NULL, detail text NOT NULL, at timestamptz NOT NULL, result text NOT NULL,
  result_reason text NOT NULL DEFAULT '', affected_id text NOT NULL DEFAULT '', client_ip text NOT NULL DEFAULT '',
  archived_at timestamptz NOT NULL DEFAULT now()
);`,
      `CREATE TABLE IF NOT EXISTS role_permissions (
  role text NOT NULL CHECK (role IN ('resident', 'official', 'administrator')),
  permission text NOT NULL, enabled boolean NOT NULL, PRIMARY KEY (role, permission)
);`,
      `CREATE TABLE IF NOT EXISTS announcements (
  id bigserial PRIMARY KEY, title text NOT NULL, detail text NOT NULL, date date NOT NULL,
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'declined')),
  decline_reason text NOT NULL DEFAULT '',
  is_event boolean NOT NULL DEFAULT false, latitude double precision, longitude double precision,
  created_by text REFERENCES users(id) ON DELETE SET NULL
);`,
      `CREATE TABLE IF NOT EXISTS calendar_events (
  id bigserial PRIMARY KEY, title text NOT NULL, detail text NOT NULL DEFAULT '', date date NOT NULL,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'declined')),
  decline_reason text NOT NULL DEFAULT '',
  latitude double precision, longitude double precision,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
      `CREATE TABLE IF NOT EXISTS password_reset_requests (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'declined')), handled_by text REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz
);`,
      `CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
      `CREATE TABLE IF NOT EXISTS recovery_email_tokens (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL, token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`,
      `CREATE TABLE IF NOT EXISTS recovery_email_requests (
  recovery_email text PRIMARY KEY, last_requested_at timestamptz NOT NULL DEFAULT now()
);`,
      `CREATE TABLE IF NOT EXISTS report_follow_ups (
  id bigserial PRIMARY KEY, report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
  message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`,
      `CREATE TABLE IF NOT EXISTS community_locations (
  id text PRIMARY KEY, area text NOT NULL UNIQUE, barangay text NOT NULL,
  street text NOT NULL DEFAULT '', purok text NOT NULL, landmark text NOT NULL DEFAULT ''
);`,
      `CREATE TABLE IF NOT EXISTS recycling_locations (
  id text PRIMARY KEY, name text NOT NULL, barangay text NOT NULL, street text NOT NULL,
  purok text NOT NULL DEFAULT '', landmark text NOT NULL DEFAULT '', materials text NOT NULL,
  phone text NOT NULL DEFAULT '', hours text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true
);`,
      `CREATE TABLE IF NOT EXISTS schedule_reminders (
  schedule_id text NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_email text NOT NULL REFERENCES users(email) ON UPDATE CASCADE ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, user_email)
);`,
      `CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`,
      `CREATE TABLE IF NOT EXISTS auth_attempts (
  attempt_key text PRIMARY KEY, attempts integer NOT NULL, window_started_at timestamptz NOT NULL
);`,
      `CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id);`,
      `CREATE INDEX IF NOT EXISTS recovery_email_tokens_user_idx ON recovery_email_tokens(user_id);`,
      `CREATE INDEX IF NOT EXISTS report_follow_ups_report_id_idx ON report_follow_ups(report_id);`,
      `CREATE INDEX IF NOT EXISTS reports_owner_submitted_idx ON reports(user_email, submitted_at DESC);`,
      `CREATE INDEX IF NOT EXISTS reports_status_updated_idx ON reports(status, updated_at DESC);`,
      `CREATE INDEX IF NOT EXISTS schedules_date_area_idx ON schedules(date, area);`,
      `CREATE INDEX IF NOT EXISTS notifications_owner_created_idx ON notifications(target_email, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON web_sessions(expires_at);`,
      `CREATE INDEX IF NOT EXISTS activities_at_idx ON activities(at DESC);`,
      `CREATE INDEX IF NOT EXISTS activity_archive_at_idx ON activity_archive(at DESC);`,
    ],
  },
  {
    version: 2,
    name: "additive_columns_and_backfills",
    statements: [
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS location_detail text NOT NULL DEFAULT '';`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS barangay text NOT NULL DEFAULT '';`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS latitude double precision;`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS longitude double precision;`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'Medium';`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS assigned_to text REFERENCES users(id) ON DELETE SET NULL;`,
      `UPDATE reports SET priority='High' WHERE urgent=true AND priority='Medium';`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS working_hours text NOT NULL DEFAULT 'Monday-Friday, 8:00 AM-5:00 PM';`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS available_days jsonb NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS requires_password_change boolean NOT NULL DEFAULT false;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivation_reason text NOT NULL DEFAULT '';`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email text NOT NULL DEFAULT '';`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email_verified boolean NOT NULL DEFAULT false;`,
      `ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_requested boolean NOT NULL DEFAULT false;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url text NOT NULL DEFAULT '';`,
      `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';`,
      `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS decline_reason text NOT NULL DEFAULT '';`,
      `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_event boolean NOT NULL DEFAULT false;`,
      `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS latitude double precision;`,
      `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS longitude double precision;`,
      `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by text REFERENCES users(id) ON DELETE SET NULL;`,
      `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS latitude double precision;`,
      `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS longitude double precision;`,
      `ALTER TABLE report_history ADD COLUMN IF NOT EXISTS actor_name text NOT NULL DEFAULT '';`,
      `ALTER TABLE report_history ADD COLUMN IF NOT EXISTS actor_role text NOT NULL DEFAULT '';`,
      `ALTER TABLE report_photos ADD COLUMN IF NOT EXISTS photo_url text NOT NULL DEFAULT '';`,
      `ALTER TABLE schedules ADD COLUMN IF NOT EXISTS series_id text;`,
      `ALTER TABLE schedules ADD COLUMN IF NOT EXISTS recurrence_end date;`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS response_deadline timestamptz;`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS responded_at timestamptz;`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_deadline timestamptz;`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz;`,
      `UPDATE reports SET resolved_at = (
  SELECT history.at FROM report_history history
    WHERE history.report_id=reports.id AND history.status='Resolved'
      AND history.actor_role <> 'resident'
    ORDER BY history.position DESC LIMIT 1)
WHERE status='Resolved' AND resolved_at IS NULL;`,
      `UPDATE reports SET responded_at = (
  SELECT history.at FROM report_history history
    WHERE history.report_id=reports.id AND history.status <> 'Submitted'
      AND history.position > COALESCE((
        SELECT cycle.position FROM report_history cycle
          WHERE cycle.report_id=reports.id AND cycle.status='Submitted'
          ORDER BY cycle.position DESC LIMIT 1), 0)
    ORDER BY history.position ASC LIMIT 1)
WHERE status <> 'Submitted' AND responded_at IS NULL;`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS service_cycle_started_at timestamptz;`,
      `UPDATE reports SET service_cycle_started_at = COALESCE(
  (SELECT history.at FROM report_history history
    WHERE history.report_id=reports.id AND history.status = 'Submitted'
      ORDER BY history.position DESC LIMIT 1),
  submitted_at)
WHERE service_cycle_started_at IS NULL;`,
      `ALTER TABLE reports ALTER COLUMN service_cycle_started_at SET DEFAULT now();`,
      `ALTER TABLE reports ALTER COLUMN service_cycle_started_at SET NOT NULL;`,
      `UPDATE reports SET response_deadline = service_cycle_started_at +
  CASE priority WHEN 'High' THEN interval '1 day' WHEN 'Medium' THEN interval '3 days' ELSE interval '7 days' END
WHERE response_deadline IS NULL;`,
      `UPDATE reports SET resolution_deadline = service_cycle_started_at +
  CASE priority WHEN 'High' THEN interval '7 days' WHEN 'Medium' THEN interval '14 days' ELSE interval '30 days' END
WHERE resolution_deadline IS NULL;`,
      `ALTER TABLE activities ADD COLUMN IF NOT EXISTS result_reason text NOT NULL DEFAULT '';`,
      `ALTER TABLE activities ADD COLUMN IF NOT EXISTS affected_id text NOT NULL DEFAULT '';`,
      `ALTER TABLE activities ADD COLUMN IF NOT EXISTS client_ip text NOT NULL DEFAULT '';`,
      `ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_role_check;`,
      `ALTER TABLE activities ADD CONSTRAINT activities_role_check CHECK (role IN ('resident', 'official', 'administrator', 'system'));`,
      `ALTER TABLE report_photos DROP COLUMN IF EXISTS data_url;`,
      `UPDATE report_history history SET actor_name=reports.name, actor_role='resident'
  FROM reports WHERE history.report_id=reports.id AND history.position=0 AND history.actor_name='';`,
      `INSERT INTO community_locations (id, area, barangay, purok) VALUES
  ('balete-purok-1', 'Purok 1', 'Palsara', 'Purok 1'),
  ('balete-purok-2', 'Purok 2', 'Palsara', 'Purok 2'),
  ('balete-purok-3', 'Purok 3', 'Palsara', 'Purok 3'),
  ('balete-purok-4', 'Purok 4', 'Palsara', 'Purok 4'),
  ('balete-purok-5', 'Purok 5', 'Palsara', 'Purok 5'),
  ('balete-main-road', 'Main Road', 'Palsara', 'Main Road')
ON CONFLICT (id) DO UPDATE SET barangay=excluded.barangay, area=excluded.area, purok=excluded.purok;`,
      `UPDATE community_locations SET barangay='Palsara' WHERE barangay='Balete';`,
    ],
  },
];

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
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  await db.query("CREATE TABLE IF NOT EXISTS app_meta (id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL DEFAULT 0)");
  await db.query("INSERT INTO app_meta (id, revision) VALUES (1, 0) ON CONFLICT (id) DO NOTHING");
  await db.query("CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, encrypted_value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
  const appliedVersions = await readAppliedMigrationVersions(db);
  for (const migration of [...MIGRATIONS].sort((left, right) => left.version - right.version)) {
    if (appliedVersions.has(migration.version)) continue;
    await applyMigration(db, migration);
  }
  const permissionRows = Object.entries(PERMISSIONS).flatMap(([role, entries]) =>
    Object.entries(entries).map(([permission, enabled]) => [role, permission, enabled])
  );
  for (const [role, permission, enabled] of permissionRows) {
    await db.query(
      "INSERT INTO role_permissions (role, permission, enabled) VALUES ($1, $2, $3) ON CONFLICT (role, permission) DO NOTHING",
      [role, permission, enabled]
    );
  }
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
    validateAccount({ email, name: "Portal administrator", area: "Palsara" });
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
      [randomUUID(), email.trim().toLowerCase(), "Portal administrator", "Palsara"],
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
    const users = user
      ? await db.query("SELECT id, email, name, area, phone, role, status, working_hours AS \"workingHours\", available_days AS \"availableDays\", requires_password_change AS \"requiresPasswordChange\", deactivation_reason AS \"deactivationReason\", recovery_email AS \"recoveryEmail\", reset_requested AS \"resetRequested\", photo_url AS \"photoUrl\", to_char(joined_at, 'YYYY-MM-DD') AS \"joinedAt\" FROM users WHERE id <> $1 ORDER BY joined_at, email", [user.id])
      : await db.query("SELECT id, email, name, area, phone, role, status, working_hours AS \"workingHours\", available_days AS \"availableDays\", requires_password_change AS \"requiresPasswordChange\", deactivation_reason AS \"deactivationReason\", recovery_email AS \"recoveryEmail\", reset_requested AS \"resetRequested\", photo_url AS \"photoUrl\", to_char(joined_at, 'YYYY-MM-DD') AS \"joinedAt\" FROM users ORDER BY joined_at, email");
    state.users = users.rows;
  } else if (user.role === "resident") {
    const users = await db.query("SELECT id, email, name, area, phone, role, status, working_hours AS \"workingHours\", available_days AS \"availableDays\", requires_password_change AS \"requiresPasswordChange\", photo_url AS \"photoUrl\", to_char(joined_at, 'YYYY-MM-DD') AS \"joinedAt\" FROM users WHERE id=$1", [user.id]);
    state.users = users.rows;
  }

  const reports = await db.query(`
    SELECT r.id, r.user_email AS "userEmail", r.name, r.category, r.title, r.area, r.barangay,
    r.location_detail AS "locationDetail", r.latitude, r.longitude, r.description, r.urgent, r.priority,
    (SELECT count(*)::integer FROM report_follow_ups f WHERE f.report_id=r.id) AS "followUpCount",
    r.assigned_to AS "assignedToId", assignee.name AS "assignedToName", r.status,
    r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
    r.response_deadline AS "responseDeadline", r.responded_at AS "respondedAt",
    r.resolution_deadline AS "resolutionDeadline", r.resolved_at AS "resolvedAt"
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
      SELECT report_id, name, photo_url AS "photoUrl" FROM report_photos
      ${user?.role === "resident" ? "WHERE report_id=ANY($1::text[])" : ""}
      ORDER BY report_id, position
    `, user?.role === "resident" ? [reportIds] : []);
    const photosByReport = new Map();
    for (const row of photos.rows) {
      const list = photosByReport.get(row.report_id) || [];
      const photoPrefix = `/api/reports/${encodeURIComponent(row.report_id)}/photos/`;
      if (list.length >= 3 || typeof row.name !== "string" || row.name.length > 120 ||
          typeof row.photoUrl !== "string" || !row.photoUrl.startsWith(photoPrefix)) continue;
      list.push({ name: row.name, photoUrl: row.photoUrl });
      photosByReport.set(row.report_id, list);
    }
    state.reports = reports.rows.map((report) => {
      const { assignedToId, assignedToName, ...details } = report;
      const responseDeadline = report.responseDeadline ? new Date(report.responseDeadline) : null;
      const resolutionDeadline = report.resolutionDeadline ? new Date(report.resolutionDeadline) : null;
      const now = new Date();
      const unresolved = report.status !== "Resolved";
      // The two service targets are judged separately: a concern can be answered but
      // still unresolved, and that is no longer a failure to respond.
      const responseOverdue = Boolean(unresolved && !report.respondedAt && responseDeadline && responseDeadline < now);
      const resolutionOverdue = Boolean(unresolved && resolutionDeadline && resolutionDeadline < now);
      return {
        ...details,
        assignedTo: assignedToId ? { id: assignedToId, name: assignedToName } : null,
        submittedAt: timestamp(report.submittedAt),
        updatedAt: timestamp(report.updatedAt),
        responseDeadline: report.responseDeadline ? timestamp(report.responseDeadline) : null,
        respondedAt: report.respondedAt ? timestamp(report.respondedAt) : null,
        resolutionDeadline: report.resolutionDeadline ? timestamp(report.resolutionDeadline) : null,
        resolvedAt: report.resolvedAt ? timestamp(report.resolvedAt) : null,
        overdue: responseOverdue || resolutionOverdue,
        responseOverdue,
        resolutionOverdue,
        history: historyByReport.get(report.id) || [],
        photos: photosByReport.get(report.id) || [],
      };
    });
  }
  const schedules = await db.query(`
    SELECT id, area, zone, to_char(date, 'YYYY-MM-DD') AS date, waste_type AS "wasteType",
      start_time AS start, end_time AS "end", frequency, team, status,
      series_id AS "seriesId", to_char(recurrence_end, 'YYYY-MM-DD') AS "recurrenceEnd"
    FROM schedules ORDER BY date, start_time, id
  `);
  const scheduleHistory = await db.query(`
    SELECT schedule_id AS "scheduleId", previous_status AS "previousStatus", status, at,
      actor_name AS "actorName", actor_role AS "actorRole", note,
      to_char(previous_date, 'YYYY-MM-DD') AS "previousDate", previous_start AS "previousStart",
      previous_end AS "previousEnd", to_char(replacement_date, 'YYYY-MM-DD') AS "replacementDate",
      replacement_start AS "replacementStart", replacement_end AS "replacementEnd"
    FROM schedule_history ORDER BY schedule_id, position
  `);
  const scheduleHistoryById = new Map();
  for (const row of scheduleHistory.rows) {
    const { scheduleId, ...entry } = row;
    const list = scheduleHistoryById.get(scheduleId) || [];
    list.push({ ...entry, at: timestamp(entry.at) });
    scheduleHistoryById.set(scheduleId, list);
  }
  state.schedules = schedules.rows.map((schedule) => ({
    ...schedule,
    history: scheduleHistoryById.get(schedule.id) || [],
  }));
  const notifications = await db.query(`
    SELECT id, target_email AS "targetEmail", report_id AS "reportId", title, body,
      created_at AS "createdAt", read FROM notifications
    ${user ? "WHERE target_email=$1" : ""}
    ORDER BY created_at DESC, id
  `, user ? [user.email] : []);
  state.notifications = notifications.rows.map((item) => ({ ...item, reportId: item.reportId || "", createdAt: timestamp(item.createdAt) }));
  if (!user || user.role === "administrator") {
    const activities = await db.query("SELECT id, actor, role, action, detail, at, result, result_reason AS \"resultReason\", affected_id AS \"affectedId\", client_ip AS \"clientIp\" FROM activities ORDER BY at DESC, id LIMIT 200");
    state.activities = activities.rows.map((item) => ({ ...item, at: timestamp(item.at) }));
  }
  const permissions = await db.query("SELECT role, permission, enabled FROM role_permissions ORDER BY role, permission");
  for (const { role, permission, enabled } of permissions.rows) {
    state.permissions[role] ||= {};
    state.permissions[role][permission] = enabled;
  }
  const permissionOverrides = await db.query("SELECT email, permission_overrides AS overrides FROM users WHERE permission_overrides <> '{}'::jsonb");
  state.accountOverrides = Object.fromEntries(
    permissionOverrides.rows
      .filter((row) => row.overrides && typeof row.overrides === "object" && Object.keys(row.overrides).length)
      .map((row) => [row.email, row.overrides]),
  );
  const announcements = await db.query(`
    SELECT id, title, detail, to_char(date, 'YYYY-MM-DD') AS date, approval_status AS "approvalStatus", decline_reason AS "declineReason",
      is_event AS "isEvent", latitude, longitude
    FROM announcements
    ${user && user.role === "resident" ? "WHERE approval_status='approved'" : ""}
    ORDER BY date DESC, id DESC
  `);
  state.announcements = announcements.rows.map((item) => ({ ...item, id: String(item.id) }));
  const calendarEvents = await db.query(`
    SELECT e.id, e.title, e.detail, to_char(e.date, 'YYYY-MM-DD') AS date,
      e.approval_status AS "approvalStatus", e.decline_reason AS "declineReason",
      e.latitude, e.longitude,
      e.created_by AS "createdBy", u.name AS "createdByName", e.created_at AS "createdAt"
    FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by
    ${user && user.role === "administrator" ? "" : user ? "WHERE e.approval_status='approved' OR e.created_by=$1" : "WHERE e.approval_status='approved'"}
    ORDER BY e.date, e.id
  `, user && user.role !== "administrator" ? [user.id] : []);
  state.calendarEvents = calendarEvents.rows.map((item) => ({
    ...item, id: String(item.id), createdAt: timestamp(item.createdAt),
  }));
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
  // Per-account permission overrides carry officials' email addresses, so they
  // are administrative data: an administrator manages every official's
  // overrides, an official needs only their own, and residents need none.
  const overrides = state.accountOverrides || {};
  const ownEmail = user.email.trim().toLowerCase();
  const accountOverrides = user.role === "administrator"
    ? overrides
    : user.role === "official" && Object.hasOwn(overrides, ownEmail)
      ? { [ownEmail]: overrides[ownEmail] }
      : {};
  return {
    ...state,
    accountOverrides,
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
    SELECT u.id, u.email, u.name, u.area, u.phone, u.role, u.status, u.working_hours AS "workingHours",
      u.available_days AS "availableDays", u.permission_overrides AS "permissionOverrides",
      u.requires_password_change AS "requiresPasswordChange", u.photo_url AS \"photoUrl\", to_char(u.joined_at, 'YYYY-MM-DD') AS "joinedAt",
      u.recovery_email AS "recoveryEmail", u.recovery_email_verified AS "recoveryEmailVerified"
    FROM web_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'Active'
  `, [hash(token)]);
  return result.rows[0] || null;
}

async function hasPermission(db, user, permission) {
  if (user?.permissionOverrides && Object.hasOwn(user.permissionOverrides, permission)) {
    return Boolean(user.permissionOverrides[permission]);
  }
  const result = await db.query("SELECT enabled FROM role_permissions WHERE role=$1 AND permission=$2", [user.role, permission]);
  return Boolean(result.rows[0]?.enabled);
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
      attempts = CASE WHEN auth_attempts.window_started_at < now() - interval '5 minutes' THEN 1 ELSE auth_attempts.attempts + 1 END,
      window_started_at = CASE WHEN auth_attempts.window_started_at < now() - interval '5 minutes' THEN now() ELSE auth_attempts.window_started_at END
    RETURNING attempts
  `, [key]);
  if (Number(result.rows[0].attempts) > limit) throw new HttpError(429, "Too many attempts. Wait 5 minutes and try again.");
}

export async function pruneExpiredAuthState(db) {
  const attempts = await db.query("DELETE FROM auth_attempts WHERE window_started_at < now() - interval '24 hours'");
  const sessions = await db.query("DELETE FROM web_sessions WHERE expires_at <= now()");
  await db.query("DELETE FROM password_reset_tokens WHERE expires_at <= now()");
  await db.query("DELETE FROM recovery_email_tokens WHERE expires_at <= now()");
  await db.query("DELETE FROM recovery_email_requests WHERE last_requested_at < now() - interval '24 hours'");
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
  // Same-origin validation guards against cross-site requests. The host may be a
  // LAN address, machine name or proxy host, so it is not limited to loopback.
  return Number(parsed.port) === address?.port &&
    (safeMethod ? (!request.headers.origin || request.headers.origin === requestOrigin) : request.headers.origin === requestOrigin);
}

// Residents and officials may only record activities the server can verify actually
// happened. An administrator is trusted to manage the system, but the log is still
// written from operations the server itself performed, so administrative appends are
// held to the same server-generated action vocabulary instead of accepting any text.
const RESIDENT_ACTIVITY_ACTIONS = new Set(["Submitted a concern", "Submitted an urgent concern"]);
const OFFICIAL_ACTIVITY_ACTIONS = new Set([
  "Updated a report",
  "Claimed a concern",
  "Released a concern",
  "Changed a collection status",
  "Updated a collection schedule",
  "Added a collection schedule",
]);
const ADMIN_ACTIVITY_ACTIONS = new Set([
  ...OFFICIAL_ACTIVITY_ACTIONS,
  "Added user account",
  "Created resident account",
  "Changed account password",
  "Set recovery email",
  "Removed recovery email",
  "Updated profile information",
  "Deactivated user account",
  "Reactivated user account",
  "Submitted an announcement",
  "Published an announcement",
  "Updated an announcement",
  "Approved an announcement",
  "Declined an announcement",
  "Removed an announcement",
  "Approved a calendar event",
  "Declined a calendar event",
]);

function activityActionsFor(user) {
  if (user.role === "resident") return RESIDENT_ACTIVITY_ACTIONS;
  if (user.role === "official") return OFFICIAL_ACTIVITY_ACTIONS;
  if (user.role === "administrator") return ADMIN_ACTIVITY_ACTIONS;
  return null;
}

function validateActivityAppend(oldItems, newItems, user) {
  // Activities are append-only. The server may write newer rows (a failed sign-in,
  // a refused request) between the client's read and its save, so match by id
  // instead of by position; a newer row at the front must not look like an edit.
  const oldById = new Map(oldItems.map((item) => [item.id, item]));
  const allowedActions = activityActionsFor(user);
  for (const item of newItems) {
    const old = oldById.get(item?.id);
    if (old) {
      if (!jsonEqual(old, item)) throw new HttpError(403, "Activity history cannot be altered.");
      continue;
    }
    if (!item || !validId(item.id) || item.actor !== user.name || item.role !== user.role ||
        typeof item.action !== "string" || item.action.length > 100 ||
        typeof item.detail !== "string" || item.detail.length > 1000 ||
        typeof item.result !== "string" || item.result.length > 80 ||
        typeof item.at !== "string" || Number.isNaN(Date.parse(item.at))) {
      throw new HttpError(400, "Activity entry is invalid.");
    }
    if (allowedActions !== null && !allowedActions.has(item.action)) {
      throw new HttpError(403, "You cannot record this activity.");
    }
  }
}

function validateNotificationsReadOnly(oldItems, newItems, user) {
  // The server writes notifications outside any browser save — collection
  // reminders, password-reset notices — and the maintenance job prunes rows
  // older than 90 days. None of that is part of the browser's intent, so the
  // browser's list may be shorter (rows the server created) or longer (rows the
  // server pruned) than the server's. Match by id instead of by length and only
  // refuse items the browser may not touch.
  const oldById = new Map(oldItems.map((item) => [item.id, item]));
  for (const item of newItems) {
    if (!item || !validId(item.id) || item.targetEmail !== user.email) {
      throw new HttpError(403, "You can only mark your own notifications as read.");
    }
    const old = oldById.get(item.id);
    if (!old) continue; // created or pruned by the server after the browser's read
    if (old.targetEmail !== user.email ||
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
  // The server owns the record clock: submittedAt and updatedAt are stamped
  // when the concern is received, never from the browser. A resident cannot
  // submit a concern that already claims a first response or a resolution, and
  // cannot backdate or forward-date a submission to manipulate service targets.
  const now = new Date().toISOString();
  report.submittedAt = now;
  report.updatedAt = now;
  report.respondedAt = null;
  report.resolvedAt = null;
  validateReport(report);
  // A new concern opens its first service cycle at submission. The server always
  // owns the cycle start; a client-supplied serviceCycleStartedAt is never trusted.
  report.serviceCycleStartedAt = now;
  // Both service targets are computed from the server's own clock. Client-supplied
  // deadlines are never trusted for a newly filed concern.
  report.responseDeadline = null;
  report.resolutionDeadline = null;
  computeServiceDeadlines(report);
  await db.query(`
    INSERT INTO reports (id, user_email, name, category, title, area, barangay, location_detail, latitude, longitude, description, urgent, priority, assigned_to, status, submitted_at, updated_at, response_deadline, responded_at, resolution_deadline, resolved_at, service_cycle_started_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
  `, [report.id, report.userEmail, report.name, report.category, report.title, report.area, report.barangay || "",
    report.locationDetail || "", report.latitude ?? null, report.longitude ?? null, report.description, report.urgent, report.priority,
    report.assignedTo?.id || null, report.status, report.submittedAt, report.updatedAt, report.responseDeadline ?? null, report.respondedAt ?? null,
    report.resolutionDeadline ?? null, report.resolvedAt ?? null, report.serviceCycleStartedAt]);
  // The initial history entry is stamped by the server clock; a resident cannot
  // fabricate the moment a concern was submitted.
  if (report.history.length > 0) {
    report.history[0].at = now;
    // The first entry is the server's receipt record: it states that the
    // concern was received, never a status or comment the browser invented.
    report.history[0].status = "Submitted";
    report.history[0].note = "Report received.";
  }
  for (const [position, item] of report.history.entries()) {
    await db.query("INSERT INTO report_history (report_id, position, status, at, note, actor_name, actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [report.id, position, item.status, item.at, item.note, item.actorName || "", item.actorRole || ""]);
  }
  for (const [position, photo] of report.photos.entries()) {
    await db.query("INSERT INTO report_photos (report_id,position,name,photo_url) VALUES ($1,$2,$3,$4)",
      [report.id, position, photo.name, photo.photoUrl]);
  }
}

async function replaceReport(db, report) {
  validateReport(report);
  // The service clock belongs to the server. An existing concern keeps the cycle it
  // is already in, so a reopened concern keeps the clock it was restarted on, and
  // only a newly stored concern opens its cycle at submission. The submission
  // moment is preserved from the database; the client cannot backdate or
  // forward-date a concern.
  const existing = await db.query("SELECT submitted_at, service_cycle_started_at FROM reports WHERE id=$1", [report.id]);
  const existingRow = existing.rows[0];
  report.submittedAt = existingRow ? new Date(existingRow.submitted_at).toISOString() : report.submittedAt;
  report.serviceCycleStartedAt = existingRow && existingRow.service_cycle_started_at
    ? new Date(existingRow.service_cycle_started_at).toISOString()
    : report.submittedAt || new Date().toISOString();
  computeServiceDeadlines(report);
  await db.query(`
    INSERT INTO reports (id, user_email, name, category, title, area, barangay, location_detail, latitude, longitude, description, urgent, priority, assigned_to, status, submitted_at, updated_at, response_deadline, responded_at, resolution_deadline, resolved_at, service_cycle_started_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    ON CONFLICT (id) DO UPDATE SET user_email=excluded.user_email, name=excluded.name, category=excluded.category,
      title=excluded.title, area=excluded.area, barangay=excluded.barangay, location_detail=excluded.location_detail,
      latitude=excluded.latitude, longitude=excluded.longitude, description=excluded.description, urgent=excluded.urgent,
      priority=excluded.priority, assigned_to=excluded.assigned_to, status=excluded.status, submitted_at=excluded.submitted_at, updated_at=excluded.updated_at,
      response_deadline=excluded.response_deadline, responded_at=excluded.responded_at,
      resolution_deadline=excluded.resolution_deadline, resolved_at=excluded.resolved_at,
      service_cycle_started_at=excluded.service_cycle_started_at
  `, [report.id, report.userEmail, report.name, report.category, report.title, report.area, report.barangay || "",
    report.locationDetail || "", report.latitude ?? null, report.longitude ?? null, report.description, report.urgent, report.priority,
    report.assignedTo?.id || null, report.status, report.submittedAt, report.updatedAt, report.responseDeadline ?? null, report.respondedAt ?? null,
    report.resolutionDeadline ?? null, report.resolvedAt ?? null, report.serviceCycleStartedAt]);
  await db.query("DELETE FROM report_history WHERE report_id = $1", [report.id]);
  await db.query("DELETE FROM report_photos WHERE report_id = $1", [report.id]);
  for (const [position, item] of report.history.entries()) {
    await db.query("INSERT INTO report_history (report_id, position, status, at, note, actor_name, actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [report.id, position, item.status, item.at, item.note, item.actorName || "", item.actorRole || ""]);
  }
  for (const [position, photo] of report.photos.entries()) {
    await db.query("INSERT INTO report_photos (report_id,position,name,photo_url) VALUES ($1,$2,$3,$4)",
      [report.id, position, photo.name, photo.photoUrl]);
  }
}

async function insertNotification(db, userEmail, title, body, reportId = "") {
  await db.query(`
    INSERT INTO notifications (id, target_email, report_id, title, body, created_at, read)
    VALUES ($1,$2,$3,$4,$5,now(),false)
  `, [randomUUID(), userEmail, reportId || null, title.slice(0, 200), body.slice(0, 1000)]);
}

async function insertActivity(db, user, action, detail, { result = "Success", resultReason = "", affectedId = "", clientIp = "" } = {}) {
  await db.query(
    "INSERT INTO activities (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip) VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9)",
    [randomUUID(), user.name, user.role, action, detail.slice(0, 1000), result, resultReason.slice(0, 500), affectedId, clientIp || ""],
  );
}

// The activities table accepts resident, official, administrator, and system. "system" is
// used for a security event with no authenticated actor, such as a rejected cross-site request.
async function logSecurityEvent(db, actor, role, action, detail, result, { resultReason = "", affectedId = "", clientIp = "" } = {}) {
  await insertActivity(db, { name: actor || "system", role: role || "system" }, action, detail, { result, resultReason, affectedId, clientIp });
}

// The browsable log is the live table plus everything moved to the archive, so an
// administrator can search every retained record instead of the newest page of each.
const ACTIVITY_LOG_SOURCE = `
  SELECT id, actor, role, action, detail, at, result, result_reason AS "resultReason",
    affected_id AS "affectedId", client_ip AS "clientIp", NULL::timestamptz AS "archivedAt", 'current' AS source
  FROM activities
  UNION ALL
  SELECT id, actor, role, action, detail, at, result, result_reason AS "resultReason",
    affected_id AS "affectedId", client_ip AS "clientIp", archived_at AS "archivedAt", 'archived' AS source
  FROM activity_archive
`;
const ACTIVITY_EXPORT_LIMIT = 10000;

function activityLogFilters(url) {
  const text = (name, limit = 120) => (url.searchParams.get(name) || "").trim().slice(0, limit);
  const date = (name) => {
    const value = text(name, 10);
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Enter a valid date filter.");
    return value;
  };
  const source = url.searchParams.get("source");
  return {
    page: Math.min(Math.max(Number(url.searchParams.get("page")) || 1, 1), 100000),
    pageSize: Math.min(Math.max(Number(url.searchParams.get("pageSize")) || 25, 1), 100),
    from: date("from"),
    to: date("to"),
    actor: text("actor"),
    action: text("action"),
    result: text("result", 80),
    affectedId: text("affectedId"),
    source: ["current", "archived", "all"].includes(source) ? source : "all",
  };
}

function activityLogWhere(filters) {
  const clauses = [];
  const values = [];
  const add = (value, clause) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  if (filters.from) add(filters.from, "at >= ?::date");
  if (filters.to) add(filters.to, "at < (?::date + interval '1 day')");
  if (filters.actor) add(filters.actor, "position(lower(?) in lower(actor)) > 0");
  if (filters.action) add(filters.action, "position(lower(?) in lower(action)) > 0");
  if (filters.result) add(filters.result, "result = ?");
  if (filters.affectedId) add(filters.affectedId, "position(lower(?) in lower(\"affectedId\")) > 0");
  if (filters.source !== "all") add(filters.source, "source = ?");
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

async function syncNotifications(db, oldItems, newItems, user) {
  validateNotificationsReadOnly(oldItems, newItems, user);
  const changed = newItems.filter((item) => oldItems.find((old) => old.id === item.id)?.read !== item.read);
  for (const item of changed) await db.query("UPDATE notifications SET read=true WHERE id=$1 AND target_email=$2", [item.id, user.email]);
}

async function persistScheduleHistory(db, schedule) {
  await db.query("DELETE FROM schedule_history WHERE schedule_id=$1", [schedule.id]);
  for (const [position, item] of normalizeSchedule(schedule).history.entries()) {
    await db.query(`
      INSERT INTO schedule_history (schedule_id,position,previous_status,status,at,actor_name,actor_role,note,
        previous_date,previous_start,previous_end,replacement_date,replacement_start,replacement_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [schedule.id, position, item.previousStatus, item.status, item.at, item.actorName, item.actorRole, item.note,
      item.previousDate, item.previousStart || "", item.previousEnd || "", item.replacementDate,
      item.replacementStart || "", item.replacementEnd || ""]);
  }
}

function scheduleUpdateMessage(schedule) {
  const entry = (schedule.history || []).at(-1);
  const reason = entry?.note ? ` Reason: ${entry.note}` : "";
  if (schedule.status === "Rescheduled" && entry?.replacementDate) {
    const from = entry.previousDate
      ? `${entry.previousDate}${entry.previousStart ? ` ${entry.previousStart}` : ""}`
      : "its original schedule";
    return `${schedule.wasteType} pickup for ${schedule.area} was rescheduled from ${from} to ${entry.replacementDate} ${entry.replacementStart}–${entry.replacementEnd}.${reason}`;
  }
  if (["Delayed", "Cancelled"].includes(schedule.status)) {
    return `${schedule.wasteType} pickup for ${schedule.area} on ${schedule.date} was ${schedule.status.toLowerCase()}.${reason}`;
  }
  return `${schedule.wasteType} pickup ${schedule.status.toLowerCase()} for ${schedule.area} on ${schedule.date}.${reason}`;
}

async function syncSchedules(db, oldSchedules, newSchedules, user) {
  validateScheduleCollection(newSchedules);
  const oldById = new Map(oldSchedules.map((item) => [item.id, item]));
  const newById = new Map(newSchedules.map((item) => [item.id, item]));
  const changed = new Set();
  for (const item of newSchedules) {
    await assertKnownArea(db, item.area);
    const previous = oldById.get(item.id);
    let history = Array.isArray(item.history) ? item.history.map((entry) => ({ ...entry })) : [];
    if (!previous) {
      if (item.status === "Rescheduled") throw new HttpError(400, "A new collection cannot be marked Rescheduled. Save it first, then move it to a replacement date.");
      if (!history.length && ["Delayed", "Cancelled"].includes(item.status)) {
        throw new HttpError(400, `${item.status} collections need a reason in the collection history.`);
      }
      if (history.length > 1) throw new HttpError(400, "A new collection can only start with one history entry.");
      if (!history.length) {
        history = [{
          previousStatus: null,
          status: item.status,
          at: new Date().toISOString(),
          actorName: "",
          actorRole: "",
          note: `Collection ${item.status.toLowerCase()}.`,
          previousDate: null,
          previousStart: null,
          previousEnd: null,
          replacementDate: null,
          replacementStart: null,
          replacementEnd: null,
        }];
      }
      history.at(-1).actorName = user.name;
      history.at(-1).actorRole = user.role;
      history.at(-1).at = new Date().toISOString();
    } else {
      const oldHistory = Array.isArray(previous.history) ? previous.history : [];
      const statusChanged = item.status !== previous.status;
      if (statusChanged) {
        const entry = history.at(-1);
        const validTransition = Boolean(entry) &&
          history.length === oldHistory.length + 1 &&
          jsonEqual(history.slice(0, -1), oldHistory) &&
          entry.status === item.status &&
          (entry.previousStatus ?? null) === previous.status;
        if (!validTransition) {
          throw new HttpError(400, "A collection status change must add one history entry that records the previous and new status.");
        }
        history.at(-1).actorName = user.name;
        history.at(-1).actorRole = user.role;
        history.at(-1).at = new Date().toISOString();
        history.at(-1).previousDate = previous.date;
        history.at(-1).previousStart = previous.start;
        history.at(-1).previousEnd = previous.end;
        if (["Delayed", "Cancelled"].includes(item.status) && !history.at(-1).note.trim()) {
          throw new HttpError(400, `${item.status} collections need a reason in the collection history.`);
        }
        if (item.status === "Rescheduled") {
          const replacement = history.at(-1);
          if (!replacement.replacementDate || !String(replacement.replacementStart || "").trim() ||
              !String(replacement.replacementEnd || "").trim()) {
            throw new HttpError(400, "A rescheduled collection needs the replacement pickup date and time.");
          }
          item.date = replacement.replacementDate;
          item.start = replacement.replacementStart;
          item.end = replacement.replacementEnd;
        }
      } else if (!jsonEqual(history, oldHistory)) {
        throw new HttpError(400, "Collection history can only change together with a status update.");
      }
    }
    item.history = history;
    const schedule = normalizeSchedule(item);
    if (!previous || !jsonEqual(normalizeSchedule(previous), schedule)) {
      changed.add(item.id);
      await db.query(`
        INSERT INTO schedules (id,area,zone,date,waste_type,start_time,end_time,frequency,series_id,recurrence_end,team,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO UPDATE SET area=excluded.area,zone=excluded.zone,date=excluded.date,
          waste_type=excluded.waste_type,start_time=excluded.start_time,end_time=excluded.end_time,
          frequency=excluded.frequency,series_id=excluded.series_id,recurrence_end=excluded.recurrence_end,
          team=excluded.team,status=excluded.status
      `, [schedule.id, schedule.area, schedule.zone, schedule.date, schedule.wasteType, schedule.start,
        schedule.end, schedule.frequency, schedule.seriesId, schedule.recurrenceEnd, schedule.team, schedule.status]);
      await persistScheduleHistory(db, item);
      if (previous && previous.date !== item.date) {
        await db.query("DELETE FROM schedule_reminders WHERE schedule_id=$1", [item.id]);
      }
    }
  }
  for (const item of oldSchedules) {
    if (!newById.has(item.id)) {
      changed.add(item.id);
      await db.query("DELETE FROM schedules WHERE id=$1", [item.id]);
    }
  }
  const additionsByGroup = new Map();
  for (const id of changed) {
    const schedule = newById.get(id);
    if (schedule && !oldById.has(id)) {
      const key = `${schedule.area}\u0000${schedule.wasteType}`;
      if (!additionsByGroup.has(key)) additionsByGroup.set(key, []);
      additionsByGroup.get(key).push(schedule);
      continue;
    }
    const removed = oldById.get(id);
    const message = schedule
      ? scheduleUpdateMessage(schedule)
      : `${removed.wasteType} collection previously scheduled for ${removed.area} has been removed.`;
    const residents = await db.query("SELECT email FROM users WHERE role='resident' AND status='Active' AND area=$1", [(schedule || removed).area]);
    for (const resident of residents.rows) await insertNotification(db, resident.email,
      schedule ? `Collection update for ${schedule.area}` : "Collection schedule removed", message);
  }
  for (const group of additionsByGroup.values()) {
    group.sort((left, right) => left.date.localeCompare(right.date));
    const first = group[0];
    const last = group[group.length - 1];
    const message = group.length === 1
      ? `${first.wasteType} pickup ${first.status.toLowerCase()} for ${first.area} on ${first.date}.`
      : `${group.length} ${first.wasteType} pickups are scheduled for ${first.area} from ${first.date} to ${last.date}.`;
    const title = group.length === 1 ? `Collection update for ${first.area}` : `Collection schedule added for ${first.area}`;
    const residents = await db.query("SELECT email FROM users WHERE role='resident' AND status='Active' AND area=$1", [first.area]);
    for (const resident of residents.rows) await insertNotification(db, resident.email, title, message);
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

async function syncActivities(db, oldItems, newItems, user) {
  validateActivityAppend(oldItems, newItems, user);
  const oldIds = new Set(oldItems.map((item) => item.id));
  const appended = newItems.filter((item) => !oldIds.has(item.id));
  if (!appended.length) return;
  // The archive job may move a record out of the live log while the browser
  // still holds it. Such a row is server history, not a client append, and must
  // never be written back into the live table.
  const archived = await db.query("SELECT id FROM activity_archive WHERE id = ANY($1::text[])", [appended.map((item) => item.id)]);
  const archivedIds = new Set(archived.rows.map((row) => row.id));
  // The server owns the activity clock: a client cannot backdate or forward-date
  // an event, and the actor is always the authenticated account.
  const at = new Date().toISOString();
  for (const item of appended) {
    if (archivedIds.has(item.id)) continue;
    await db.query("INSERT INTO activities (id,actor,role,action,detail,at,result) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",
      [item.id, user.name, user.role, item.action, item.detail.slice(0, 1000), at, item.result.slice(0, 80)]);
  }
}

async function updateState(db, user, body, { mailer, smtpFrom, appOrigin } = {}) {
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new HttpError(400, "A valid database revision is required.");
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data.calendarEvents)) body.data.calendarEvents = [];
  validateState(body.data);
  const before = await readFullState(db, user);
  const visibleBefore = stateForRole(before, user);
  let nextRevision = 0;
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    const revision = await db.query("SELECT revision FROM app_meta WHERE id=1 FOR UPDATE");
    if (Number(revision.rows[0].revision) !== body.revision) throw new HttpError(409, "Data changed in another session. Reload before saving.");
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
        if (!incoming || !jsonEqual(comparableReport(oldReport), comparableReport(incoming))) throw new HttpError(403, "Existing reports cannot be changed by residents.");
      }
      const addedReports = after.reports.filter((report) => !visibleBefore.reports.some((old) => old.id === report.id));
      for (const report of addedReports) {
        validateReport(report);
        if (!report.barangay?.trim() || !report.locationDetail?.trim()) {
          throw new HttpError(400, "A new report must include its barangay and street or landmark.");
        }
        await assertKnownArea(db, report.area, report.barangay || "");
        if (report.userEmail !== user.email || report.status !== "Submitted" ||
            report.history.length !== 1 || report.history[0].status !== "Submitted") {
          throw new HttpError(403, "Residents can only submit a new report for their own account.");
        }
      }
      if (!jsonEqual(visibleBefore.schedules, after.schedules) ||
          !jsonEqual(visibleBefore.permissions, after.permissions) ||
          !jsonEqual(visibleBefore.accountOverrides || {}, after.accountOverrides || {}) ||
          !jsonEqual(visibleBefore.announcements, after.announcements) ||
          !jsonEqual(visibleBefore.calendarEvents, after.calendarEvents) ||
          !jsonEqual(visibleBefore.locations, after.locations) ||
          !jsonEqual(visibleBefore.recyclingLocations, after.recyclingLocations)) throw new HttpError(403, "You cannot change shared workspace data.");
      validateNotificationsReadOnly(visibleBefore.notifications, after.notifications, user);
      if (nextAccount.area.trim() !== oldAccount.area.trim()) await assertKnownArea(db, nextAccount.area);
      await db.query("UPDATE users SET name=$1, area=$2, phone=$3 WHERE id=$4", [nextAccount.name.trim(), nextAccount.area.trim(), nextAccount.phone.trim(), user.id]);
      await syncNotifications(db, visibleBefore.notifications, after.notifications, user);
      await syncActivities(db, visibleBefore.activities, after.activities, user);
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
        for (const account of staff.rows) queueEmail(mailer, {
          from: smtpFrom,
          to: account.email,
          subject: report.urgent ? `Urgent concern: ${report.title}` : `New concern: ${report.title}`,
          text: `${report.name} submitted a report for ${report.barangay}, ${report.area}, near ${report.locationDetail}.\n\nReview it in CommUnity: ${appOrigin || ""}/#/official/concerns`,
        });
        await insertNotification(db, user.email, "Report submitted",
          `Your concern ${report.id} was submitted and is now on file.`, report.id);
      }
    } else if (user.role === "official") {
      if (after.users.length || !jsonEqual(visibleBefore.permissions, after.permissions) ||
          !jsonEqual(visibleBefore.accountOverrides || {}, after.accountOverrides || {}) ||
          !jsonEqual(visibleBefore.announcements, after.announcements) ||
          !jsonEqual(visibleBefore.calendarEvents, after.calendarEvents) ||
          !jsonEqual(visibleBefore.locations, after.locations) ||
          !jsonEqual(visibleBefore.recyclingLocations, after.recyclingLocations)) throw new HttpError(403, "Officials cannot change accounts, locations, or announcements.");
      requireRole(user, ["official"]);
      if (!await hasPermission(db, user, "manageReports") && !jsonEqual(visibleBefore.reports, after.reports)) {
        throw new HttpError(403, "Report management is not enabled for this role.");
      }
      if (!await hasPermission(db, user, "manageSchedules") && !jsonEqual(visibleBefore.schedules, after.schedules)) {
        throw new HttpError(403, "Schedule management is not enabled for this role.");
      }
      if (after.reports.length !== visibleBefore.reports.length) throw new HttpError(403, "Officials cannot add or remove resident reports.");
      for (const oldReport of visibleBefore.reports) {
        const incoming = after.reports.find((report) => report.id === oldReport.id);
        if (!incoming) throw new HttpError(403, "Officials cannot remove resident reports.");
        if (!jsonEqual(comparableReport(oldReport), comparableReport(incoming))) {
          const previousCore = comparableReport(oldReport, true);
          const incomingCore = comparableReport(incoming, true);
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
          if (statusChanged) {
            const allowed = REPORT_TRANSITIONS[oldReport.status] ?? [];
            if (!allowed.includes(incoming.status)) {
              throw new HttpError(403, `Concerns cannot move from ${oldReport.status} to ${incoming.status} directly. Follow the review path: Submitted → Under Review → In Progress → Resolved.`);
            }
            const note = String(incoming.history.at(-1).note || "").trim();
            if (!note) {
              throw new HttpError(400, `Add an update note when changing the status to ${incoming.status}.`);
            }
          }
          // The server owns the update clock. The browser may ask for a status
          // change, but it cannot say when it happened, so the recorded first
          // response, the recorded resolution, the status entry, and the update
          // itself are all stamped with the server's own time.
          const updateAt = new Date().toISOString();
          if (statusChanged) {
            incoming.updatedAt = updateAt;
            incoming.history.at(-1).at = updateAt;
          }
          // The server owns the service-target fields, so a client copy is never trusted.
          incoming.respondedAt = oldReport.respondedAt ?? null;
          incoming.responseDeadline = oldReport.responseDeadline ?? null;
          incoming.resolvedAt = oldReport.resolvedAt ?? null;
          incoming.resolutionDeadline = oldReport.resolutionDeadline ?? null;
          if (statusChanged && oldReport.status === "Submitted") {
            incoming.respondedAt = updateAt;
          }
          if (statusChanged && incoming.status === "Resolved") {
            incoming.resolvedAt = updateAt;
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
            queueEmail(mailer, {
              from: smtpFrom,
              to: incoming.userEmail,
              subject: `Your report ${incoming.id} is ${incoming.status.toLowerCase()}`,
              text: `${incoming.history.at(-1).note || `Your concern is now ${incoming.status.toLowerCase()}.`}\n\nView your reports in CommUnity: ${appOrigin || ""}/#/resident/reports`,
            });
          }
        }
      }
      await syncSchedules(db, visibleBefore.schedules, after.schedules, user);
      await syncNotifications(db, visibleBefore.notifications, after.notifications, user);
      await syncActivities(db, visibleBefore.activities, after.activities, user);
    } else {
      requireRole(user, ["administrator"]);
      if (after.users.length !== before.users.length) throw new HttpError(403, "Create accounts through the account management form.");
      const oldUsers = new Map(before.users.map((account) => [account.id, account]));
      for (const account of after.users) {
        const old = oldUsers.get(account.id);
        if (!old) throw new HttpError(403, "Account identifiers cannot be added or replaced through a state update.");
        validateAccount(account);
        const availableDays = account.availableDays === undefined
          ? (Array.isArray(old.availableDays) && old.availableDays.length ? validateAvailableDays(old.availableDays) : validateAvailableDays())
          : validateAvailableDays(account.availableDays);
        if (account.role === "official" &&
            (account.role !== old.role || account.workingHours !== old.workingHours ||
              !jsonEqual(availableDays, old.availableDays))) {
          validateWorkingHours(account.workingHours);
        }
        if (account.role === "resident" && (account.role !== old.role || account.area !== old.area)) {
          await assertKnownArea(db, account.area);
        }
        if (old.id === user.id && (account.email !== old.email || account.role !== "administrator" || account.status !== "Active")) {
          throw new HttpError(403, "You cannot change your own administrator sign-in or access.");
        }
        if (account.status !== old.status) {
          throw new HttpError(403, "Account status cannot be changed through the account editor. Deactivate or reactivate the account from the user list instead.");
        }
        await db.query("UPDATE users SET email=$1,name=$2,area=$3,phone=$4,role=$5,status=$6,working_hours=$7,available_days=$8::jsonb WHERE id=$9",
          [account.email.trim().toLowerCase(), account.name.trim(), account.area.trim(), account.phone.trim(), account.role, account.status,
            String(account.workingHours || "Monday-Friday, 8:00 AM-5:00 PM").trim(), JSON.stringify(availableDays), account.id]);
        // A demoted account must not keep per-account overrides: hasPermission
        // applies them regardless of role, so they would still elevate access.
        if (old.role === "official" && account.role !== "official") {
          await db.query("UPDATE users SET permission_overrides='{}'::jsonb WHERE id=$1", [account.id]);
        }
      }
      const activeAdmins = await db.query("SELECT count(*)::integer AS count FROM users WHERE role='administrator' AND status='Active'");
      if (Number(activeAdmins.rows[0].count) < 1) throw new HttpError(400, "At least one active administrator must remain.");
      for (const old of before.reports) {
        const incoming = after.reports.find((report) => report.id === old.id);
        if (!incoming) throw new HttpError(403, "Reports cannot be deleted from the administrator workspace.");
        if (!jsonEqual(old.assignedTo, incoming.assignedTo) || !jsonEqual(old.history, incoming.history)) {
          throw new HttpError(403, "Report assignments and status history can only be changed through the concern queue.");
        }
        if (old.priority !== incoming.priority || old.urgent !== incoming.urgent || old.status !== incoming.status) {
          throw new HttpError(403, "Report priority and status can only be changed through the concern queue and priority endpoint.");
        }
        incoming.respondedAt = old.respondedAt ?? null;
        incoming.responseDeadline = old.responseDeadline ?? null;
        incoming.resolvedAt = old.resolvedAt ?? null;
        incoming.resolutionDeadline = old.resolutionDeadline ?? null;
        // The administrator cannot move the update clock either: the concern was
        // last updated when the concern queue recorded the update.
        incoming.updatedAt = old.updatedAt;
      }
      for (const report of after.reports) {
        const old = before.reports.find((item) => item.id === report.id);
        if (old && jsonEqual(comparableReport(old), comparableReport(report))) continue;
        await replaceReport(db, report);
      }
      await syncSchedules(db, before.schedules, after.schedules, user);
      await syncLocations(db, before.locations, after.locations);
      await syncRecyclingLocations(db, before.recyclingLocations, after.recyclingLocations);
      if (!jsonEqual(before.announcements, after.announcements)) throw new HttpError(403, "Announcements cannot be changed through this workspace.");
      if (!jsonEqual(before.calendarEvents, after.calendarEvents)) throw new HttpError(403, "Calendar events cannot be changed through this workspace.");
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
      const nextOverrides = after.accountOverrides || {};
      const beforeAccounts = new Map(before.users.map((account) => [account.id, account]));
      const officialEmails = new Set(after.users.filter((account) => account.role === "official").map((account) => account.email.trim().toLowerCase()));
      // Overrides are keyed by email. Editing an official's email or demoting
      // them leaves the old key behind, which would fail every later save;
      // re-key a moved account and drop a demoted one instead of rejecting
      // the whole workspace for a key the account left behind.
      for (const email of Object.keys(nextOverrides).filter((key) => !officialEmails.has(key))) {
        const moved = after.users.find((account) => {
          const old = beforeAccounts.get(account.id);
          return old && old.role === "official" && old.email.trim().toLowerCase() === email;
        });
        if (!moved) throw new HttpError(400, "Permission overrides can only target official accounts.");
        const newEmail = moved.email.trim().toLowerCase();
        if (moved.role === "official" && officialEmails.has(newEmail) && !Object.hasOwn(nextOverrides, newEmail)) {
          nextOverrides[newEmail] = nextOverrides[email];
        }
        delete nextOverrides[email];
      }
      for (const account of after.users) {
        if (account.role !== "official") continue;
        const overrides = nextOverrides[account.email.trim().toLowerCase()] || {};
        await db.query("UPDATE users SET permission_overrides=$1::jsonb WHERE id=$2", [JSON.stringify(overrides), account.id]);
      }
      const capableAdmins = await db.query(`
        SELECT u.id FROM users u
        JOIN role_permissions p ON p.role='administrator' AND p.permission IN ('manageUsers','manageRoles') AND p.enabled
        WHERE u.role='administrator' AND u.status='Active'
        GROUP BY u.id HAVING count(*)=2
      `);
      if (!capableAdmins.rows.length) throw new HttpError(400, "Keep at least one active administrator with both account and role management enabled.");
      await syncActivities(db, before.activities, after.activities, user);
    }
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    nextRevision = Number(revision.rows[0].revision) + 1;
  });
  return nextRevision;
}

export async function runScheduleReminders(db, { mailer, smtpFrom, appOrigin } = {}) {
  const due = await db.query(`
    SELECT s.id AS schedule_id, s.area, to_char(s.date, 'YYYY-MM-DD') AS date, s.start_time, s.waste_type, u.email AS user_email
    FROM schedules s
    JOIN users u ON u.area=s.area AND u.role='resident' AND u.status='Active'
    WHERE s.date = (now() AT TIME ZONE $1::text)::date + 1 AND s.status NOT IN ('Completed','Cancelled')
  `, [appTimeZone]);
  let created = 0;
  for (const reminder of due.rows) {
    const claimed = await db.query(
      "INSERT INTO schedule_reminders (schedule_id,user_email) VALUES ($1,$2) ON CONFLICT (schedule_id,user_email) DO NOTHING",
      [reminder.schedule_id, reminder.user_email],
    );
    if (!claimed.rowCount) continue;
    const body = `${reminder.waste_type} collection for ${reminder.area} is scheduled tomorrow, ${appDateLabel(reminder.date, { month: "long", day: "numeric" })} at ${reminder.start_time}.`;
    await insertNotification(db, reminder.user_email, "Collection reminder", body);
    queueEmail(mailer, {
      from: smtpFrom,
      to: reminder.user_email,
      subject: `Collection reminder for ${reminder.area}`,
      text: `${body}\n\nView your collection schedule in CommUnity: ${appOrigin || ""}/#/resident/collection`,
    });
    created += 1;
  }
  // Notifications are part of the shared state browsers sync against, so a
  // background write must advance the same revision a browser save does.
  if (created) await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  return created;
}

export async function archiveOldActivities(db) {
  // One transaction: a half-finished archive must never leave a row in both
  // tables, and ON CONFLICT makes a retry after a crash safe.
  await withTransaction(db, async (transaction) => {
    const moved = await transaction.query(`
      INSERT INTO activity_archive (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, archived_at)
      SELECT id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, now()
      FROM activities WHERE at < now() - interval '90 days'
      ON CONFLICT (id) DO NOTHING
    `);
    await transaction.query("DELETE FROM activities WHERE at < now() - interval '90 days'");
    // Archived records leave the live log administrators browse, so the shared
    // revision advances with the archive.
    if (moved.rowCount) await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  });
}

// Notifications older than 90 days leave the shared state, so the shared
// revision advances with the prune and open browsers resync on their next save.
export async function pruneOldNotifications(db) {
  const removed = await db.query("DELETE FROM notifications WHERE created_at < now() - interval '90 days'");
  if (removed.rowCount) await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  return removed.rowCount;
}

// Photo uploads happen before the report is saved, so an abandoned draft leaves a
// directory behind. Remove only directories with no report row and no recent write.
export async function sweepOrphanUploads(db, uploadsDir) {
  let entries;
  try {
    entries = await readdir(uploadsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "profiles" || !validId(entry.name)) continue;
    const existing = await db.query("SELECT 1 FROM reports WHERE id=$1", [entry.name]);
    if (existing.rows.length) continue;
    const directory = path.join(uploadsDir, entry.name);
    const files = await readdir(directory).catch(() => []);
    let newest = 0;
    for (const file of files) {
      const info = await stat(path.join(directory, file)).catch(() => null);
      if (info) newest = Math.max(newest, info.mtimeMs);
    }
    if (files.length && Date.now() - newest <= ORPHAN_UPLOAD_AGE_MS) continue;
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    removed += 1;
  }
  return removed;
}

async function createUser(db, user, body) {
  requireRole(user, ["administrator"]);
  const { email, name, area, phone = "", workingHours = "Monday-Friday, 8:00 AM-5:00 PM", availableDays = DEFAULT_OFFICIAL_DAYS, role, status = "Active", password } = body || {};
  validateAccount({ email, name, area, phone });
  if (role === "official") validateWorkingHours(String(workingHours).trim());
  const validatedAvailableDays = validateAvailableDays(availableDays);
  if (role === "resident") await assertKnownArea(db, area);
  validatePassword(password);
  if (!ROLES.includes(role) || !["Active", "Inactive"].includes(status)) throw new HttpError(400, "Choose a valid role and account status.");
  const id = randomUUID();
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    await db.query("INSERT INTO users (id,email,name,area,phone,working_hours,available_days,role,status) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
      [id, email.trim().toLowerCase(), name.trim(), area.trim(), phone.trim(), String(workingHours).trim(), JSON.stringify(validatedAvailableDays), role, status]);
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
  const isEvent = body.isEvent === true;
  if (!isEvent) return { isEvent: false, latitude: null, longitude: null };
  const { latitude, longitude } = body;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new HttpError(400, "Choose a map location for this event announcement, or turn off the event option.");
  }
  return { isEvent: true, latitude, longitude };
}

const apiHandlers = new Map([
  ["auth", handleAuth],
  ["reports", handleReports],
  ["report-photos", handleReportPhotos],
  ["settings", handleSettings],
  ["locations", handleLocations],
  ["announcements", handleAnnouncements],
  ["calendar", handleCalendar],
  ["profile", handleProfile],
  ["profile-photo", handleProfilePhotos],
  ["session", handleSession],
  ["state", handleState],
  ["users", handleUsers],
  ["community", handleCommunity],
]);

// While a temporary password is in force, only these calls may leave the
// password-change dialog: the change itself, signing out, and the session check
// the interface uses to keep the dialog and its flag current.
function passwordChangeRequestAllowed(request, url) {
  if (url.pathname === "/api/auth/password") return request.method === "POST";
  if (url.pathname === "/api/auth/logout") return request.method === "POST";
  if (url.pathname === "/api/session") return request.method === "GET";
  return false;
}

// Audit policy for failed requests:
//   - A 403 (authorization denied) is always recorded as a security event. A request with
//     no session is attributed to the "system" actor, which the activities table accepts.
//   - A missing session on a protected endpoint returns 401 and is not recorded: it is the
//     normal anonymous answer, and recording every one would let anonymous traffic bury
//     real security events in the audit view. Failed sign-ins are recorded separately with
//     their own limit buckets.
//   - 400, 404 and 409 are client mistakes, not security events.
async function handleApi(request, response, db, options) {
  const { server, appOrigin, trustedProxyAddresses } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  let user = null;
  try {
    // The origin check runs before the session is read, so a rejected cross-site request
    // never reaches the database and is recorded against the system actor.
    if (!validateSameOrigin(request, server, appOrigin)) {
      throw new HttpError(403, "This request did not come from the CommUnity website.");
    }
    if (url.pathname === "/api/healthz" && request.method === "GET") {
      try {
        await db.query("SELECT 1");
        sendJson(response, 200, { status: "ok", database: "available", checked_at: new Date().toISOString() });
      } catch {
        sendJson(response, 503, { status: "error", database: "unavailable", checked_at: new Date().toISOString() });
      }
      return;
    }
    user = await getSessionUser(request, db);
    // A temporary password exists only to reach the password-change dialog. The
    // check lives here in the central dispatcher so no handler has to remember
    // it: until the password is replaced, the session can change the password,
    // sign out, or read its own session — nothing else.
    if (user?.requiresPasswordChange && !passwordChangeRequestAllowed(request, url)) {
      throw new HttpError(403, "Change your password before using CommUnity.");
    }
    const handler = apiHandlers.get(url.pathname.split("/")[2]);
    if (!handler) {
      sendJson(response, 404, { error: "API endpoint not found." });
      return;
    }
    await handler(request, response, db, options, user);
  } catch (error) {
    if (error.status === 403) {
      const clientAddress = requestClientAddress(request, trustedProxyAddresses);
      // An anonymous caller can send refused requests in a loop. Keep one audit
      // row per address per window so the security log stays readable.
      try {
        await recordAttempt(db, hash(`denial:${clientAddress}`), 1);
      } catch {
        throw error;
      }
      const actor = user ? user.name : "system";
      const role = user ? user.role : "system";
      await logSecurityEvent(db, actor, role, "Authorization denied", error.message, "Failed", {
        resultReason: error.message,
        clientIp: clientAddress,
      }).catch((logError2) => logError("CommUnity could not log authorization denial.", logError2));
    }
    throw error;
  }
}

async function handleAuth(request, response, db, options, user) {
  const { secureCookies, trustedProxyAddresses } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    requireJsonBody(request);
    const body = request.body;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" && body.password.length <= MAX_PASSWORD_LENGTH ? body.password : "";
    const clientAddress = requestClientAddress(request, trustedProxyAddresses);
    const ipAttemptKey = hash(`login-ip:${clientAddress}`);
    const accountAttemptKey = hash(`login-account:${email}`);
    await recordAttempt(db, ipAttemptKey, 100);
    await recordAttempt(db, accountAttemptKey);
    const result = await db.query(`
      SELECT u.id,u.email,u.name,u.area,u.phone,u.role,u.status,u.working_hours AS "workingHours",
        u.available_days AS "availableDays",
        u.requires_password_change AS "requiresPasswordChange",to_char(u.joined_at,'YYYY-MM-DD') AS "joinedAt",c.password_hash
      FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.email=$1
    `, [email]);
    const account = result.rows[0];
    const passwordMatches = await verifyPassword(password, account?.password_hash ||
      "scrypt$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
    if (!account || !passwordMatches || account.status !== "Active") {
      await logSecurityEvent(db, email, account?.role || "resident", "Failed sign-in", `Failed sign-in attempt for ${email}`, "Failed", {
        resultReason: "Invalid credentials or inactive account",
        clientIp: clientAddress,
      });
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
    requireJsonBody(request);
    const body = request.body;
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
    requireJsonBody(request);
    const body = request.body;
    validatePassword(body.newPassword);
    if (body.newPassword !== body.confirmPassword) throw new HttpError(400, "The new passwords do not match.");
    const attemptKey = hash(`password-change:${user.id}`);
    await recordAttempt(db, attemptKey, 5);
    const current = await db.query("SELECT password_hash FROM user_credentials WHERE user_id=$1", [user.id]);
    if (!await verifyPassword(String(body.currentPassword || ""), current.rows[0]?.password_hash)) {
      throw new HttpError(400, "The current password does not match this account.");
    }
    const token = cookieValue(request, SESSION_COOKIE);
    await db.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [await passwordHash(body.newPassword), user.id]);
    await db.query("UPDATE users SET requires_password_change=false WHERE id=$1", [user.id]);
    await db.query("DELETE FROM auth_attempts WHERE attempt_key=$1", [attemptKey]);
    await db.query("DELETE FROM web_sessions WHERE user_id=$1 AND token_hash<>$2", [user.id, hash(token)]);
    await insertActivity(db, user, "Changed account password", user.email);
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/auth/password-reset-request" && request.method === "POST") {
    requireJsonBody(request);
    await recordAttempt(db, hash(`password-reset-request:${requestClientAddress(request, trustedProxyAddresses)}`));
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const account = await db.query("SELECT id, email FROM users WHERE email=$1 AND status='Active'", [email]);
    if (account.rows[0]) {
      await db.query("INSERT INTO password_reset_requests(user_id) VALUES($1)", [account.rows[0].id]);
      const admins = await db.query("SELECT email FROM users WHERE role='administrator' AND status='Active'");
      if (admins.rows.length) {
        for (const admin of admins.rows) await insertNotification(db, admin.email, "Password reset requested", `${email} requested a password reset.`);
        // Administrator notifications are shared state, so the revision moves with them.
        await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
      }
    }
    sendJson(response, 202, { ok: true });
    return;
  }
  if (url.pathname === "/api/auth/forgot-password" && request.method === "POST") {
    requireJsonBody(request);
    const recoveryEmail = typeof request.body.recoveryEmail === "string" ? request.body.recoveryEmail.trim().toLowerCase() : "";
    const generic = { ok: true, message: "If an account uses that recovery email, a reset link has been sent." };
    if (!recoveryEmail) { sendJson(response, 200, generic); return; }
    const clientAddress = requestClientAddress(request, trustedProxyAddresses);
    await recordAttempt(db, hash(`forgot-password-ip:${clientAddress}`), FORGOT_PASSWORD_IP_LIMIT);
    await recordAttempt(db, hash(`forgot-password-email:${recoveryEmail}`), FORGOT_PASSWORD_EMAIL_LIMIT);
    const { mailerState, smtpFrom, appOrigin } = options;
    const mailer = mailerState.mailer;
    if (!mailer) throw new HttpError(503, "Email service is not configured. Ask an administrator to set up SMTP before requesting a password reset.");
    const cooldown = await db.query(
      "SELECT 1 FROM recovery_email_requests WHERE recovery_email=$1 AND last_requested_at > now() - ($2 || ' minutes')::interval",
      [recoveryEmail, String(RESET_EMAIL_COOLDOWN_MINUTES)],
    );
    if (cooldown.rows.length) {
      throw new HttpError(429, `A reset email was already sent to this address. Wait ${RESET_EMAIL_COOLDOWN_MINUTES} minutes before requesting another.`);
    }
    // Recorded for every address so an unknown address behaves exactly like a known one.
    await db.query(
      "INSERT INTO recovery_email_requests (recovery_email, last_requested_at) VALUES ($1, now()) ON CONFLICT (recovery_email) DO UPDATE SET last_requested_at = now()",
      [recoveryEmail],
    );
    const account = await db.query(
      "SELECT id, email FROM users WHERE recovery_email=$1 AND recovery_email_verified AND status='Active'",
      [recoveryEmail],
    );
    if (account.rows[0]) {
      const rawToken = randomBytes(32).toString("base64url");
      const tokenHash = hash(rawToken);
      // Earlier links stay usable until they expire or are used, so a repeat request cannot cancel a link already in someone's inbox.
      await db.query("DELETE FROM password_reset_tokens WHERE user_id=$1 AND expires_at <= now()", [account.rows[0].id]);
      await db.query("INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES($1,$2, now() + ($3 || ' minutes')::interval)", [account.rows[0].id, tokenHash, String(RESET_TOKEN_MINUTES)]);
      const resetLink = `${appOrigin || ""}/#/reset-password?token=${rawToken}`;
      await mailer.sendMail({ from: smtpFrom, to: recoveryEmail, subject: "CommUnity password reset", text: `Reset your CommUnity password using this link (valid for ${RESET_TOKEN_MINUTES} minutes): ${resetLink}` });
    }
    sendJson(response, 200, generic);
    return;
  }
  if (url.pathname === "/api/auth/verify-recovery" && request.method === "POST") {
    requireJsonBody(request);
    await recordAttempt(db, hash(`verify-recovery:${requestClientAddress(request, trustedProxyAddresses)}`), RECOVERY_VERIFY_LIMIT * 4);
    const token = typeof request.body.token === "string" ? request.body.token : "";
    if (!token) throw new HttpError(400, "A valid verification token is required.");
    const result = await db.query(`
      SELECT t.user_id, t.email, u.recovery_email
      FROM recovery_email_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash=$1 AND t.expires_at > now()
    `, [hash(token)]);
    if (!result.rows.length) throw new HttpError(400, "This verification link is invalid or expired.");
    if (result.rows[0].recovery_email !== result.rows[0].email) throw new HttpError(400, "This verification link is no longer valid.");
    await withTransaction(db, async (transaction) => {
      await transaction.query("UPDATE users SET recovery_email_verified=true WHERE id=$1", [result.rows[0].user_id]);
      await transaction.query("DELETE FROM recovery_email_tokens WHERE user_id=$1", [result.rows[0].user_id]);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/auth/request-admin-reset" && request.method === "POST") {
    requireJsonBody(request);
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const generic = { ok: true, message: "If an account exists, an admin has been notified." };
    await recordAttempt(db, hash(`admin-reset-ip:${requestClientAddress(request, trustedProxyAddresses)}`), FORGOT_PASSWORD_IP_LIMIT);
    if (email) await recordAttempt(db, hash(`admin-reset-email:${email}`), FORGOT_PASSWORD_EMAIL_LIMIT);
    if (email) {
      const account = await db.query("SELECT id FROM users WHERE email=$1 AND status='Active'", [email]);
      if (account.rows[0]) {
        // The flag and the administrator notices are one change to shared state,
        // so they land in one transaction that also advances the revision.
        await withTransaction(db, async (transaction) => {
          await transaction.query("UPDATE users SET reset_requested=true WHERE id=$1", [account.rows[0].id]);
          const admins = await transaction.query("SELECT email FROM users WHERE role='administrator' AND status='Active'");
          for (const admin of admins.rows) await insertNotification(transaction, admin.email, "Password reset requested", `${email} requested admin help to reset their password.`);
          await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
        });
      }
    }
    sendJson(response, 200, generic);
    return;
  }
  if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
    requireJsonBody(request);
    const token = typeof request.body.token === "string" ? request.body.token : "";
    const newPassword = typeof request.body.newPassword === "string" ? request.body.newPassword : "";
    validatePassword(newPassword);
    if (!token) throw new HttpError(400, "A valid reset token is required.");
    const tokenHash = hash(token);
    // A cheap lookup rejects garbage links without opening a transaction; the
    // authoritative consume happens inside it, so this cannot admit two wins.
    const lookup = await db.query("SELECT user_id FROM password_reset_tokens WHERE token_hash=$1 AND expires_at > now()", [tokenHash]);
    if (!lookup.rows.length) throw new HttpError(400, "This reset link is invalid or expired.");
    const userId = lookup.rows[0].user_id;
    await withTransaction(db, async (transaction) => {
      // One account resets at a time. Locking the user row first gives every
      // concurrent link for that account a single serialization point, so the
      // token consumption and the purge of the account's remaining links can
      // never interleave into a deadlock.
      await transaction.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      // Consuming is the delete itself: a second request sharing this link
      // finds nothing left to consume and is rejected before any password is
      // written. Exactly one consumed row is required.
      const consumed = await transaction.query(
        "DELETE FROM password_reset_tokens WHERE token_hash=$1 AND expires_at > now()",
        [tokenHash],
      );
      if (Number(consumed.rowCount) !== 1) throw new HttpError(400, "This reset link is invalid or expired.");
      // Any other outstanding links for the account stop working with it.
      await transaction.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [userId]);
      await transaction.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [await passwordHash(newPassword), userId]);
      await transaction.query("UPDATE users SET requires_password_change=false WHERE id=$1", [userId]);
      await transaction.query("DELETE FROM web_sessions WHERE user_id=$1", [userId]);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleSession(request, response, db, options, user) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/session" && request.method === "GET") {
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleCommunity(request, response, db, options, user) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/community/unread-count" && request.method === "GET") {
    requireRole(user, ROLES);
    const result = await db.query("SELECT count(*)::integer AS count FROM notifications WHERE target_email=$1 AND read=false", [user.email]);
    sendJson(response, 200, { count: Number(result.rows[0].count) });
    return;
  }
  if (url.pathname === "/api/community/working-hours" && request.method === "GET") {
    requireRole(user, ROLES);
    const result = await db.query("SELECT id,name,working_hours AS \"workingHours\",available_days AS \"availableDays\" FROM users WHERE role='official' AND status='Active' ORDER BY name");
    sendJson(response, 200, { officials: result.rows });
    return;
  }
  if (url.pathname === "/api/community/follow-up" && request.method === "POST") {
    requireRole(user, ["resident"]);
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const message = String(request.body.message || "").trim();
    if (!message || message.length > 1000) throw new HttpError(400, "Enter a follow-up message.");
    let followUpResult = { count: 0, limit: null, remaining: null };
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query("SELECT id,status,priority FROM reports WHERE id=$1 AND user_email=$2 FOR UPDATE", [reportId, user.email]);
      if (!report.rows.length) throw new HttpError(404, "This report could not be found.");
      const current = report.rows[0];
      if (current.status === "Resolved") throw new HttpError(409, "This concern is resolved and no longer accepts follow-ups.");
      const limit = Object.hasOwn(FOLLOW_UP_LIMITS, current.priority) ? FOLLOW_UP_LIMITS[current.priority] : FOLLOW_UP_LIMITS.Medium;
      const counted = await transaction.query("SELECT count(*)::integer AS count FROM report_follow_ups WHERE report_id=$1", [reportId]);
      const count = Number(counted.rows[0].count);
      if (limit !== null && count >= limit) {
        throw new HttpError(429, `This ${current.priority} priority concern has reached its ${limit} follow-up limit.`);
      }
      const position = await transaction.query("SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_history WHERE report_id=$1", [reportId]);
      await transaction.query("INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES($1,$2,$3,now(),$4,$5,'resident')",
        [reportId, Number(position.rows[0].position), current.status, `Follow-up: ${message}`, user.name]);
      await transaction.query("INSERT INTO report_follow_ups(report_id,user_email,message) VALUES($1,$2,$3)", [reportId, user.email, message]);
      const staff = await transaction.query("SELECT email FROM users WHERE role IN ('official','administrator') AND status='Active'");
      for (const account of staff.rows) await insertNotification(transaction, account.email, "Report follow-up received", `${reportId}: ${message}`, reportId);
      await insertActivity(transaction, user, "Added report follow-up", `${reportId} · ${message}`);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
      followUpResult = {
        count: count + 1,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - count - 1),
      };
    });
    sendJson(response, 200, { ok: true, ...followUpResult });
    return;
  }
  if (url.pathname === "/api/community/report-priority" && request.method === "POST") {
    requireRole(user, ["official", "administrator"]);
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const priority = String(request.body.priority || "");
    if (!REPORT_PRIORITIES.includes(priority)) throw new HttpError(400, "Choose a valid concern priority.");
    if (user.role === "official" && !await hasPermission(db, user, "manageReports")) {
      throw new HttpError(403, "Report management is not enabled for this role.");
    }
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query(
        "SELECT id,status,priority,user_email AS \"userEmail\", submitted_at AS \"submittedAt\", service_cycle_started_at AS \"serviceCycleStartedAt\", responded_at AS \"respondedAt\", response_deadline AS \"responseDeadline\" FROM reports WHERE id=$1 FOR UPDATE",
        [reportId],
      );
      if (!report.rows.length) throw new HttpError(404, "This report could not be found.");
      const current = report.rows[0];
      if (current.priority === priority) return;
      if (current.status === "Resolved") throw new HttpError(409, "This concern is resolved; its priority cannot be changed.");
      const newLimit = FOLLOW_UP_LIMITS[priority];
      if (newLimit !== null) {
        const counted = await transaction.query("SELECT count(*)::integer AS count FROM report_follow_ups WHERE report_id=$1", [reportId]);
        if (Number(counted.rows[0].count) > newLimit) {
          throw new HttpError(400, `This report already has ${counted.rows[0].count} follow-ups, exceeding the ${newLimit} limit for ${priority} priority.`);
        }
      }
      // The first-response target only moves while no response has been recorded; the
      // resolution target is still live, so it always follows the new priority. Both
      // are measured from the start of the current service cycle, which is the reopen
      // when the resident reopened the concern and the submission otherwise.
      const anchor = serviceCycleAnchor(current);
      const responseDeadline = current.respondedAt
        ? current.responseDeadline
        : serviceDeadline(anchor, RESPONSE_DEADLINE_DAYS[priority] ?? RESPONSE_DEADLINE_DAYS.Medium);
      const resolutionDeadline = serviceDeadline(anchor, RESOLUTION_DEADLINE_DAYS[priority] ?? RESOLUTION_DEADLINE_DAYS.Medium);
      await transaction.query(
        "UPDATE reports SET priority=$1, urgent=$2, updated_at=now(), response_deadline=$3, resolution_deadline=$4 WHERE id=$5",
        [priority, priority === "High", responseDeadline, resolutionDeadline, reportId],
      );
      const position = await transaction.query("SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_history WHERE report_id=$1", [reportId]);
      await transaction.query("INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES($1,$2,$3,now(),$4,$5,$6)",
        [reportId, Number(position.rows[0].position), current.status, `Priority changed to ${priority}.`, user.name, user.role]);
      await insertNotification(transaction, current.userEmail, "Concern priority updated", `${reportId}: Your concern priority is now ${priority}.`, reportId);
      await insertActivity(transaction, user, "Changed report priority", `${reportId} · ${priority}`);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true, priority });
    return;
  }
  if (url.pathname === "/api/community/report-confirm" && request.method === "POST") {
    requireRole(user, ["resident"]);
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const note = String(request.body.note || "").trim();
    if (note.length > 500) throw new HttpError(400, "Keep the confirmation note within 500 characters.");
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query("SELECT id,status,user_email AS \"userEmail\" FROM reports WHERE id=$1 AND user_email=$2 FOR UPDATE", [reportId, user.email]);
      if (!report.rows.length) throw new HttpError(404, "This report could not be found.");
      const current = report.rows[0];
      if (current.status !== "Resolved") throw new HttpError(409, "Only a resolved concern can be confirmed as addressed.");
      const lastHistory = await transaction.query("SELECT actor_role AS \"actorRole\", note FROM report_history WHERE report_id=$1 ORDER BY position DESC LIMIT 1", [reportId]);
      if (lastHistory.rows[0]?.actorRole === "resident" && String(lastHistory.rows[0].note || "").startsWith("Resident confirmed")) {
        throw new HttpError(409, "This concern is already confirmed as addressed.");
      }
      const position = await transaction.query("SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_history WHERE report_id=$1", [reportId]);
      await transaction.query("INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES($1,$2,$3,now(),$4,$5,'resident')",
        [reportId, Number(position.rows[0].position), current.status, `Resident confirmed the issue was addressed.${note ? ` ${note}` : ""}`, user.name]);
      const staff = await transaction.query("SELECT email FROM users WHERE role IN ('official','administrator') AND status='Active'");
      for (const account of staff.rows) await insertNotification(transaction, account.email, "Concern confirmed addressed", `${reportId}: The resident confirmed this concern was addressed.`, reportId);
      await insertActivity(transaction, user, "Confirmed concern as addressed", `${reportId} · The resident confirmed this concern was addressed.`, { affectedId: reportId });
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/community/report-reopen" && request.method === "POST") {
    requireRole(user, ["resident"]);
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const reason = String(request.body.reason || "").trim();
    if (!reason) throw new HttpError(400, "Explain why the concern should be reopened.");
    if (reason.length > 500) throw new HttpError(400, "Keep the reopening reason within 500 characters.");
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query("SELECT id,status,user_email AS \"userEmail\",priority FROM reports WHERE id=$1 AND user_email=$2 FOR UPDATE", [reportId, user.email]);
      if (!report.rows.length) throw new HttpError(404, "This report could not be found.");
      const current = report.rows[0];
      if (current.status !== "Resolved") throw new HttpError(409, "Only a resolved concern can be reopened.");
      // A reopened concern starts a fresh service clock for both targets, and the
      // earlier first response no longer counts. The clock's own anchor moves with
      // it, so a later priority change still measures from this moment.
      const anchor = new Date();
      const responseDeadline = serviceDeadline(anchor, RESPONSE_DEADLINE_DAYS[current.priority] ?? RESPONSE_DEADLINE_DAYS.Medium);
      const resolutionDeadline = serviceDeadline(anchor, RESOLUTION_DEADLINE_DAYS[current.priority] ?? RESOLUTION_DEADLINE_DAYS.Medium);
      await transaction.query(
        "UPDATE reports SET status='Submitted', updated_at=now(), response_deadline=$1, resolution_deadline=$2, service_cycle_started_at=$3, responded_at=NULL, resolved_at=NULL WHERE id=$4",
        [responseDeadline, resolutionDeadline, anchor.toISOString(), reportId],
      );
      const position = await transaction.query("SELECT COALESCE(MAX(position),-1)+1 AS position FROM report_history WHERE report_id=$1", [reportId]);
      await transaction.query("INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES($1,$2,$3,now(),$4,$5,'resident')",
        [reportId, Number(position.rows[0].position), "Submitted", `Resident requested reopening: ${reason}`, user.name]);
      const staff = await transaction.query("SELECT email FROM users WHERE role IN ('official','administrator') AND status='Active'");
      for (const account of staff.rows) await insertNotification(transaction, account.email, "Concern reopened", `${reportId}: The resident requested this concern be reopened. Reason: ${reason}`, reportId);
      await insertActivity(transaction, user, "Requested concern reopening", `${reportId} · ${reason}`, { affectedId: reportId });
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/community/mark-notifications-read" && request.method === "POST") {
    requireRole(user, ROLES);
    requireJsonBody(request);
    const ids = Array.isArray(request.body.ids) ? request.body.ids.filter((id) => typeof id === "string" && id.length > 0) : [];
    if (ids.length) {
      await db.query("UPDATE notifications SET read=true WHERE target_email=$1 AND id=ANY($2::text[])", [user.email, ids]);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    }
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/community/activity" && request.method === "GET") {
    requireRole(user, ["administrator"]);
    const filters = activityLogFilters(url);
    const { where, values } = activityLogWhere(filters);
    const summary = await db.query(`
      SELECT
        (count(*))::integer AS total,
        (count(*) FILTER (WHERE source='current'))::integer AS current,
        (count(*) FILTER (WHERE source='archived'))::integer AS archived,
        (count(*) FILTER (WHERE result='Failed'))::integer AS failed,
        (count(*) FILTER (WHERE action ~* '(account|role|profile)'))::integer AS accounts,
        (count(*) FILTER (WHERE (action || ' ' || detail) ~* '(report|concern)'))::integer AS reports,
        (count(*) FILTER (WHERE (action || ' ' || detail) ~* '(collection|schedule)'))::integer AS services
      FROM (${ACTIVITY_LOG_SOURCE}) AS log ${where}
    `, values);
    const offset = (filters.page - 1) * filters.pageSize;
    const rows = await db.query(
      `SELECT * FROM (${ACTIVITY_LOG_SOURCE}) AS log ${where} ORDER BY at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filters.pageSize, offset],
    );
    const counts = summary.rows[0];
    const total = Number(counts.total);
    sendJson(response, 200, {
      activities: rows.rows.map((item) => ({ ...item, at: timestamp(item.at), archivedAt: timestamp(item.archivedAt) })),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
      summary: {
        total,
        current: Number(counts.current),
        archived: Number(counts.archived),
        failed: Number(counts.failed),
        accounts: Number(counts.accounts),
        reports: Number(counts.reports),
        services: Number(counts.services),
      },
    });
    return;
  }
  if (url.pathname === "/api/community/activity/export" && request.method === "GET") {
    requireRole(user, ["administrator"]);
    const filters = activityLogFilters(url);
    const { where, values } = activityLogWhere(filters);
    const rows = await db.query(
      `SELECT *, count(*) OVER () AS total_count FROM (${ACTIVITY_LOG_SOURCE}) AS log ${where} ORDER BY at DESC, id DESC LIMIT $${values.length + 1}`,
      [...values, ACTIVITY_EXPORT_LIMIT],
    );
    const total = rows.rows.length ? Number(rows.rows[0].total_count) : 0;
    sendJson(response, 200, {
      activities: rows.rows.map(({ total_count, ...item }) => ({ ...item, at: timestamp(item.at), archivedAt: timestamp(item.archivedAt) })),
      total,
      truncated: total > rows.rows.length,
    });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function sendRecoveryVerification(db, options, user, recoveryEmail) {
  const { mailerState, smtpFrom, appOrigin } = options;
  const mailer = mailerState.mailer;
  if (!mailer) return false;
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hash(rawToken);
  await db.query("DELETE FROM recovery_email_tokens WHERE user_id=$1", [user.id]);
  await db.query(
    "INSERT INTO recovery_email_tokens(user_id, email, token_hash, expires_at) VALUES($1,$2,$3, now() + ($4 || ' minutes')::interval)",
    [user.id, recoveryEmail, tokenHash, String(RESET_TOKEN_MINUTES)],
  );
  const verifyLink = `${appOrigin || ""}/#/verify-recovery?token=${rawToken}`;
  await mailer.sendMail({
    from: smtpFrom,
    to: recoveryEmail,
    subject: "Verify your CommUnity recovery email",
    text: `Confirm this email address for CommUnity password recovery (valid for ${RESET_TOKEN_MINUTES} minutes): ${verifyLink}\n\nPassword reset links are only sent to a recovery email you have confirmed. If you did not request this, ignore this message.`,
  });
  return true;
}

async function handleProfile(request, response, db, options, user) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/profile" && request.method === "PUT") {
    requireRole(user, ROLES);
    requireJsonBody(request);
    const body = request.body;
    validateAccount({ ...body, email: user.email });
    if (user.role === "resident") await assertKnownArea(db, body.area);
    const recoveryEmail = typeof body.recoveryEmail === "string" ? body.recoveryEmail.trim().toLowerCase()
      : (typeof body.recovery_email === "string" ? body.recovery_email.trim().toLowerCase() : "");
    if (recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) throw new HttpError(400, "Enter a valid recovery email address.");
    const stored = await db.query(
      "SELECT recovery_email AS \"recoveryEmail\", recovery_email_verified AS \"recoveryEmailVerified\" FROM users WHERE id=$1",
      [user.id],
    );
    const previousEmail = stored.rows[0]?.recoveryEmail || "";
    const wasVerified = Boolean(stored.rows[0]?.recoveryEmailVerified);
    const emailChanged = recoveryEmail !== previousEmail;
    // A new address, or one that was never confirmed, stays inactive until the owner proves they control it.
    const needsVerification = Boolean(recoveryEmail) && (emailChanged || !wasVerified);
    const verified = Boolean(recoveryEmail) && !emailChanged && wasVerified;
    if (needsVerification) {
      await recordAttempt(db, hash(`recovery-verify-send:${user.id}`), RECOVERY_VERIFY_LIMIT);
    }
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      await db.query("UPDATE users SET name=$1,area=$2,phone=$3,recovery_email=$4,recovery_email_verified=$5 WHERE id=$6",
        [body.name.trim(), body.area.trim(), String(body.phone || "").trim(), recoveryEmail, verified, user.id]);
      if (emailChanged) {
        await transaction.query("DELETE FROM recovery_email_tokens WHERE user_id=$1", [user.id]);
        await insertActivity(db, { ...user, name: body.name.trim() }, recoveryEmail ? "Set recovery email" : "Removed recovery email", recoveryEmail || previousEmail);
      }
      await insertActivity(db, { ...user, name: body.name.trim() }, "Updated profile information", user.email);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const verificationSent = needsVerification ? await sendRecoveryVerification(db, options, user, recoveryEmail) : false;
    const updatedUser = await getSessionUser(request, db);
    const [state, revision] = await Promise.all([
      readFullState(db, updatedUser),
      db.query("SELECT revision FROM app_meta WHERE id=1"),
    ]);
    sendJson(response, 200, {
      data: stateForRole(state, updatedUser),
      revision: Number(revision.rows[0].revision),
      user: publicUser(updatedUser),
      recoveryEmail: { verified, verificationSent },
    });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleState(request, response, db, options, user) {
  const { mailer, smtpFrom, appOrigin } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
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
    requireJsonBody(request);
    const body = request.body;
    const revision = await updateState(db, user, body, { mailer, smtpFrom, appOrigin });
    const currentUser = await getSessionUser(request, db);
    const state = await readFullState(db, currentUser);
    sendJson(response, 200, { revision, data: stateForRole(state, currentUser), user: publicUser(currentUser) });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleUsers(request, response, db, options, user) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/users/password-reset" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const target = await db.query("SELECT id, name, email FROM users WHERE email=$1 AND email<>$2", [email, user.email]);
    if (!target.rows.length) throw new HttpError(404, "The account could not be found.");
    const { mailerState, smtpFrom } = options;
    const mailer = mailerState.mailer;
    if (!mailer) throw new HttpError(503, "Email service is not configured. Configure SMTP before resetting account passwords.");
    const temporaryPassword = `CommUnity-${randomBytes(5).toString("base64url")}`;
    // Send first: if SMTP fails, the password must not have changed yet, otherwise
    // the account is locked out with a temporary password nobody received.
    await mailer.sendMail({ from: smtpFrom, to: target.rows[0].email, subject: "CommUnity temporary password", text: `Your temporary CommUnity password is: ${temporaryPassword}\n\nSign in and change it immediately. The password expires on first use.` });
    await withTransaction(db, async (transaction) => {
      await transaction.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [await passwordHash(temporaryPassword), target.rows[0].id]);
      await transaction.query("UPDATE users SET requires_password_change=true, reset_requested=false WHERE id=$1", [target.rows[0].id]);
      await transaction.query("DELETE FROM web_sessions WHERE user_id=$1", [target.rows[0].id]);
      await transaction.query("UPDATE password_reset_requests SET status='completed',handled_by=$1,handled_at=now() WHERE user_id=$2 AND status='pending'", [user.id, target.rows[0].id]);
      await insertActivity(transaction, user, "Generated temporary password", target.rows[0].name);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/users/deactivate" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const email = String(request.body.email || "").trim().toLowerCase();
    const reason = String(request.body.reason || "").trim();
    if (!reason || reason.length > 500) throw new HttpError(400, "A deactivation reason is required.");
    if (email === user.email) throw new HttpError(400, "You cannot deactivate the administrator account you are using.");
    // Deactivation and session revocation must succeed or fail together: an account
    // that is inactive must not have a usable session left behind, in either order.
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const result = await db.query("UPDATE users SET status='Inactive', deactivation_reason=$1 WHERE email=$2", [reason, email]);
      if (!result.rowCount) throw new HttpError(404, "The account could not be found.");
      const target = await db.query("SELECT id FROM users WHERE email=$1", [email]);
      await db.query("DELETE FROM web_sessions WHERE user_id=$1", [target.rows[0].id]);
      await insertActivity(db, user, "Deactivated user account", `${email} · ${reason}`);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/users/reactivate" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const email = String(request.body.email || "").trim().toLowerCase();
    if (email === user.email) throw new HttpError(400, "You cannot reactivate the administrator account you are using.");
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const result = await db.query("UPDATE users SET status='Active', deactivation_reason='' WHERE email=$1 AND status='Inactive'", [email]);
      if (!result.rowCount) throw new HttpError(404, "The account could not be found or is not inactive.");
      await insertActivity(db, user, "Reactivated user account", `${email}`);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/users/password" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const body = request.body;
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
    requireJsonBody(request);
    await createUser(db, user, request.body);
    const [state, revision] = await Promise.all([readFullState(db, user), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 201, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleAnnouncements(request, response, db, options, user) {
  const { mailerState, appOrigin } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/announcements/approval" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const status = String(request.body.status || "");
    const reason = status === "declined" ? String(request.body.reason || "").trim() : "";
    if (!["approved", "declined"].includes(status) || !/^\d+$/.test(String(request.body.id || ""))) {
      throw new HttpError(400, "Choose a valid announcement decision.");
    }
    if (status === "declined" && (!reason || reason.length > 500)) throw new HttpError(400, "A rejection reason is required.");
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const found = await db.query(`
        SELECT a.id, a.title, to_char(a.date, 'YYYY-MM-DD') AS date, a.created_by AS "createdBy",
          a.approval_status AS "approvalStatus", u.email AS "creatorEmail"
        FROM announcements a LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id=$1 FOR UPDATE OF a
      `, [Number(request.body.id)]);
      if (!found.rows.length) throw new HttpError(404, "This announcement could not be found.");
      const item = found.rows[0];
      if (item.approvalStatus !== "pending") throw new HttpError(409, "This announcement has already been decided.");
      await db.query("UPDATE announcements SET approval_status=$1, decline_reason=$2 WHERE id=$3", [status, reason, item.id]);
      await insertActivity(db, user, `${status === "approved" ? "Approved" : "Declined"} an announcement`, `${item.title}${status === "declined" ? ` · ${reason}` : ""}`);
      if (item.creatorEmail && item.createdBy !== user.id) {
        const title = status === "declined" ? "Announcement declined" : "Announcement approved";
        const text = status === "declined"
          ? `Your announcement "${item.title}" was declined. Reason: ${reason}`
          : `Your announcement "${item.title}" was approved and published.`;
        await insertNotification(db, item.creatorEmail, title, text);
        queueEmail(mailerState?.mailer, {
          from: mailerState?.settings?.from,
          to: item.creatorEmail,
          subject: title,
          text: `${text}\n\nView it in CommUnity: ${appOrigin || ""}/#/official/announcements`,
        });
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
  if (url.pathname === "/api/announcements" && ["POST", "PUT", "DELETE"].includes(request.method)) {
    requireRole(user, ["official", "administrator"]);
    if (!await hasPermission(db, user, "manageAnnouncements")) throw new HttpError(403, "Announcement management is not enabled for this role.");
    requireJsonBody(request);
    const body = request.body;
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      if (request.method === "DELETE") {
        if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) throw new HttpError(400, "Choose a valid announcement.");
        const deleted = await db.query("DELETE FROM announcements WHERE id=$1", [Number(body.id)]);
        if (!deleted.rowCount) throw new HttpError(404, "This announcement could not be found.");
        await insertActivity(db, user, "Removed an announcement", `Announcement ${body.id}`);
      } else {
        const location = validateAnnouncement(body);
        if (request.method === "POST") {
          const approvalStatus = user.role === "official" ? "pending" : "approved";
          await db.query("INSERT INTO announcements (title,detail,date,approval_status,created_by,is_event,latitude,longitude) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [body.title.trim(), body.detail.trim(), body.date, approvalStatus, user.id, location.isEvent, location.latitude, location.longitude]);
          await insertActivity(db, user, approvalStatus === "pending" ? "Submitted an announcement" : "Published an announcement", body.title.trim());
          if (approvalStatus === "pending") {
            const admins = await db.query("SELECT email FROM users WHERE role='administrator' AND status='Active'");
            for (const account of admins.rows) {
              await insertNotification(db, account.email, "Announcement needs approval",
                `${user.name} submitted “${body.title.trim()}” for ${body.date}.`);
              queueEmail(mailerState?.mailer, {
                from: mailerState?.settings?.from,
                to: account.email,
                subject: "Announcement needs approval",
                text: `${user.name} submitted "${body.title.trim()}" for ${body.date}.\n\nReview it in CommUnity: ${appOrigin || ""}/#/administrator/approvals`,
              });
            }
          }
        } else {
          if (typeof body.id !== "string" || !/^\d+$/.test(body.id)) throw new HttpError(400, "Choose a valid announcement.");
          const repending = user.role === "official" ? ",approval_status='pending',decline_reason=''" : "";
          const updated = await db.query(`UPDATE announcements SET title=$1,detail=$2,date=$3,is_event=$4,latitude=$5,longitude=$6${repending} WHERE id=$7`,
            [body.title.trim(), body.detail.trim(), body.date, location.isEvent, location.latitude, location.longitude, Number(body.id)]);
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
  sendJson(response, 404, { error: "API endpoint not found." });
}

function validateCalendarEvent(body) {
  const date = typeof body.date === "string" ? new Date(`${body.date}T00:00:00Z`) : new Date(Number.NaN);
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 120 ||
      typeof body.detail !== "string" || body.detail.length > 1000 ||
      typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.date) {
    throw new HttpError(400, "Enter a title, details, and a valid event date.");
  }
  if (body.date < appDateISO()) throw new HttpError(400, "Events cannot be scheduled before today.");
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if ((body.latitude !== undefined && body.latitude !== null && body.latitude !== "") ||
      (body.longitude !== undefined && body.longitude !== null && body.longitude !== "")) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new HttpError(400, "Enter valid event location coordinates.");
    }
  }
}

async function handleCalendar(request, response, db, options, user) {
  const { mailerState, appOrigin } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/calendar/events" && request.method === "POST") {
    requireRole(user, ["official", "administrator"]);
    if (!await hasPermission(db, user, "manageSchedules")) throw new HttpError(403, "Calendar event management is not enabled for this role.");
    requireJsonBody(request);
    validateCalendarEvent(request.body);
    const approvalStatus = user.role === "official" ? "pending" : "approved";
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const title = request.body.title.trim();
      const detail = String(request.body.detail || "").trim();
      const latitude = request.body.latitude == null || request.body.latitude === "" ? null : Number(request.body.latitude);
      const longitude = request.body.longitude == null || request.body.longitude === "" ? null : Number(request.body.longitude);
      await db.query(
        "INSERT INTO calendar_events (title,detail,date,approval_status,created_by,latitude,longitude) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [title, detail, request.body.date, approvalStatus, user.id, latitude, longitude],
      );
      await insertActivity(db, user,
        approvalStatus === "pending" ? "Requested a calendar event" : "Created a calendar event",
        `${title} · ${request.body.date}`);
      if (approvalStatus === "pending") {
        const admins = await db.query("SELECT email FROM users WHERE role='administrator' AND status='Active'");
        for (const account of admins.rows) {
          await insertNotification(db, account.email, "Calendar event needs approval",
            `${user.name} requested “${title}” on ${request.body.date}.`);
          queueEmail(mailerState?.mailer, {
            from: mailerState?.settings?.from,
            to: account.email,
            subject: "Calendar event needs approval",
            text: `${user.name} requested "${title}" on ${request.body.date}.\n\nReview it in CommUnity: ${appOrigin || ""}/#/administrator/calendar`,
          });
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
  if (url.pathname === "/api/calendar/events/approval" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const id = Number(request.body.id);
    const status = String(request.body.status || "");
    const reason = status === "declined" ? String(request.body.reason || "").trim() : "";
    if (!Number.isInteger(id) || id < 1 || !["approved", "declined"].includes(status)) {
      throw new HttpError(400, "Choose a valid event decision.");
    }
    if (status === "declined" && (!reason || reason.length > 500)) throw new HttpError(400, "A rejection reason is required.");
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const found = await db.query(`
        SELECT e.id, e.title, to_char(e.date, 'YYYY-MM-DD') AS date, e.created_by AS "createdBy",
          e.approval_status AS "approvalStatus", u.email AS "creatorEmail", u.name AS "creatorName"
        FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.id=$1 FOR UPDATE OF e
      `, [id]);
      if (!found.rows.length) throw new HttpError(404, "This event request could not be found.");
      const item = found.rows[0];
      if (item.approvalStatus !== "pending") throw new HttpError(409, "This event request has already been decided.");
      await db.query("UPDATE calendar_events SET approval_status=$1, decline_reason=$2 WHERE id=$3", [status, reason, id]);
      await insertActivity(db, user,
        `${status === "approved" ? "Approved" : "Declined"} a calendar event`,
        `${item.title} · ${item.date}${status === "declined" ? ` · ${reason}` : ""}`);
      if (item.creatorEmail && item.createdBy !== user.id) {
        const title = status === "declined" ? "Calendar event declined" : "Calendar event approved";
        const body = status === "declined"
          ? `Your event “${item.title}” on ${item.date} was declined. Reason: ${reason}`
          : `Your event “${item.title}” on ${item.date} was approved.`;
        await insertNotification(db, item.creatorEmail, title, body);
        queueEmail(mailerState?.mailer, {
          from: mailerState?.settings?.from,
          to: item.creatorEmail,
          subject: title,
          text: `${body}\n\nView the calendar in CommUnity: ${appOrigin || ""}/#/official/calendar`,
        });
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
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleSettings(request, response, db, options, user) {
  const { mailerState, smtpSettingsKey } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/settings/smtp" && request.method === "GET") {
    requireRole(user, ["administrator"]);
    sendJson(response, 200, { settings: publicSmtpSettings(mailerState.settings), encryptionReady: Boolean(smtpSettingsKey) });
    return;
  }
  if (url.pathname === "/api/settings/smtp" && request.method === "PUT") {
    requireRole(user, ["administrator"]);
    if (!smtpSettingsKey) throw new HttpError(503, "Configure SMTP_SETTINGS_KEY on the server before saving SMTP settings.");
    requireJsonBody(request);
    const body = request.body;
    const settings = {
      host: String(body.host || "").trim(),
      port: Number(body.port),
      user: String(body.user || "").trim(),
      pass: String(body.pass || ""),
      from: String(body.from || "").trim(),
    };
    if (!settings.host || !Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535 ||
        !settings.user || !settings.from || (!settings.pass && !mailerState.settings.pass)) {
      throw new HttpError(400, "Enter a host, valid port, username, sender, and password.");
    }
    if (!settings.pass) settings.pass = mailerState.settings.pass;
    await db.query(
      "INSERT INTO app_settings(key,encrypted_value,updated_at) VALUES('smtp',$1,now()) ON CONFLICT(key) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=now()",
      [encryptSettings(settings, smtpSettingsKey)],
    );
    mailerState.settings = settings;
    mailerState.mailer = createMailer({ smtpHost: settings.host, smtpPort: settings.port, smtpUser: settings.user, smtpPass: settings.pass, smtpFrom: settings.from });
    sendJson(response, 200, { settings: publicSmtpSettings(settings) });
    return;
  }
  if (url.pathname === "/api/settings/smtp/test" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    if (!mailerState.mailer) throw new HttpError(400, "Save complete SMTP settings before sending a test email.");
    await mailerState.mailer.sendMail({
      from: mailerState.settings.from,
      to: user.email,
      subject: "CommUnity SMTP test",
      text: "CommUnity successfully sent this test email.",
    });
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleLocations(request, response, db, options, user) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/locations" && request.method === "GET") {
    const locations = await db.query("SELECT id,area,barangay,street,purok,landmark FROM community_locations ORDER BY barangay,purok,street,id");
    sendJson(response, 200, { locations: locations.rows });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleReports(request, response, db, options, user) {
  const { uploadsDir } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const reportPhotoMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/photos\/(\d+)\/([A-Za-z0-9-]+\.(?:jpg|png))$/);
  if (reportPhotoMatch && request.method === "GET") {
    requireRole(user, ROLES);
    const reportId = decodeURIComponent(reportPhotoMatch[1]);
    if (!validId(reportId)) throw new HttpError(404, "The report photo could not be found.");
    const position = Number(reportPhotoMatch[2]);
    const report = await db.query("SELECT user_email FROM reports WHERE id=$1", [reportId]);
    if (!report.rows.length) throw new HttpError(404, "The report photo could not be found.");
    if (user.role === "resident" && report.rows[0].user_email !== user.email) {
      throw new HttpError(403, "You cannot access this report photo.");
    }
    const photo = await db.query("SELECT photo_url FROM report_photos WHERE report_id=$1 AND position=$2", [reportId, position]);
    const photoUrl = photo.rows[0]?.photo_url || "";
    if (photoUrl !== url.pathname) throw new HttpError(404, "The report photo could not be found.");
    const filename = path.basename(photoUrl);
    if (!filename || filename === "." || filename === "..") throw new HttpError(404, "The report photo could not be found.");
    const image = await readFile(path.join(uploadsDir, reportId, filename)).catch(() => {
      throw new HttpError(404, "The report photo could not be found.");
    });
    response.writeHead(200, {
      "Cache-Control": "private, no-store",
      "Content-Type": CONTENT_TYPES[path.extname(filename)] || "application/octet-stream",
      "Content-Length": image.length,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(image);
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleReportPhotos(request, response, db, options, user) {
  const { uploadsDir } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/report-photos" && request.method === "POST") {
    requireRole(user, ["resident"]);
    await recordAttempt(db, hash(`report-photo:${user.id}`), 20);
    const reportId = url.searchParams.get("reportId") || "";
    if (!validId(reportId)) throw new HttpError(400, "The report identifier is invalid.");
    // Photos are uploaded while a concern is still a draft. A concern that is
    // already on file cannot accept them: its photos were registered in
    // report_photos by the submission itself, and an unregistered file would
    // never be served and never be swept as an orphan.
    const existing = await db.query("SELECT 1 FROM reports WHERE id=$1", [reportId]);
    if (existing.rows.length) {
      throw new HttpError(409, "This concern is already on file. Photos can only be attached while it is being submitted.");
    }
    const files = await readMultipart(request);
    if (!files.length) throw new HttpError(400, "Choose at least one JPG or PNG photo.");
    const reportUploadDir = path.join(uploadsDir, reportId);
    await mkdir(reportUploadDir, { recursive: true });
    const uploaded = [];
    try {
      for (const [position, file] of files.entries()) {
        const extension = photoExtension(file.data);
        if (!extension) throw new HttpError(400, `${file.name}: choose a JPG or PNG image.`);
        const filename = `${randomUUID()}${extension}`;
        await writeFile(path.join(reportUploadDir, filename), file.data, { flag: "wx" });
        uploaded.push({
          name: String(file.name || filename).slice(0, 120),
          photoUrl: `/api/reports/${encodeURIComponent(reportId)}/photos/${position}/${filename}`,
          filename,
        });
      }
    } catch (error) {
      await Promise.all(uploaded.map((photo) => unlink(path.join(reportUploadDir, photo.filename)).catch(() => {})));
      throw error;
    }
    sendJson(response, 201, { photos: uploaded.map(({ name, photoUrl }) => ({ name, photoUrl })) });
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

async function handleProfilePhotos(request, response, db, options, user) {
  const { uploadsDir } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/profile-photo" && request.method === "POST") {
    requireRole(user, ROLES);
    await recordAttempt(db, hash(`profile-photo:${user.id}`), 10);
    const files = await readMultipart(request, { maxFiles: 1 });
    if (!files.length) throw new HttpError(400, "Choose a JPG or PNG profile photo.");
    const file = files[0];
    const extension = photoExtension(file.data);
    if (!extension) throw new HttpError(400, `${file.name}: choose a JPG or PNG image.`);
    if (file.data.length > MAX_PHOTO_BYTES) throw new HttpError(413, `${file.name}: photo files must be 5 MB or smaller.`);
    const profileDir = path.join(uploadsDir, "profiles");
    await mkdir(profileDir, { recursive: true });
    const filename = `${user.id}${extension}`;
    const filePath = path.join(profileDir, filename);
    const temporaryPath = path.join(profileDir, `${user.id}.${randomUUID()}.tmp`);
    const photoUrl = `/api/profile-photo/${encodeURIComponent(user.id)}`;
    // Replace the old image atomically. The previous version used an exclusive
    // create (wx), so a second upload failed and the cleanup deleted the good file.
    try {
      await writeFile(temporaryPath, file.data);
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
    await db.query("UPDATE users SET photo_url=$1 WHERE id=$2", [photoUrl, user.id]);
    for (const other of PHOTO_EXTENSIONS) {
      if (other !== extension) await unlink(path.join(profileDir, `${user.id}${other}`)).catch(() => {});
    }
    sendJson(response, 201, { photoUrl });
    return;
  }
  const profilePhotoMatch = url.pathname.match(/^\/api\/profile-photo\/([^/]+)$/);
  if (profilePhotoMatch && request.method === "GET") {
    requireRole(user, ROLES);
    const requestedId = decodeURIComponent(profilePhotoMatch[1]);
    if (requestedId !== user.id && user.role !== "administrator") {
      throw new HttpError(403, "You cannot view this profile photo.");
    }
    let image = null;
    let filename = null;
    for (const ext of PHOTO_EXTENSIONS) {
      const candidate = path.join(uploadsDir, "profiles", `${requestedId}${ext}`);
      try {
        image = await readFile(candidate);
        filename = `${requestedId}${ext}`;
        break;
      } catch {
        continue;
      }
    }
    if (!image || !filename) throw new HttpError(404, "The profile photo could not be found.");
    response.writeHead(200, {
      "Cache-Control": "private, no-store",
      "Content-Type": CONTENT_TYPES[path.extname(filename)] || "application/octet-stream",
      "Content-Length": image.length,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(image);
    return;
  }
  sendJson(response, 404, { error: "API endpoint not found." });
}

export async function createCommunityServer({
  dataDir = path.join(PROJECT_DIR, "data", "pglite"),
  uploadsDir = process.env.UPLOADS_DIR || DEFAULT_UPLOADS_DIR,
  databaseUrl = process.env.DATABASE_URL || "",
  port = 8768,
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
  const db = await createDatabase({ dataDir, databaseUrl, poolMax, connectionTimeoutMillis, timeZone: appTimeZone });
  await migrate(db);
  const mailerState = { settings: await loadSmtpSettings(db, smtpSettingsKey, { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass, from: smtpFrom }), mailer: null };
  mailerState.mailer = createMailer({ smtpHost: mailerState.settings.host, smtpPort: mailerState.settings.port, smtpUser: mailerState.settings.user, smtpPass: mailerState.settings.pass, smtpFrom: mailerState.settings.from });
  await ensureAdministrator(db, initialAdminEmail, initialAdminPassword);
  await pruneExpiredAuthState(db);
  await runScheduleReminders(db, { mailer: mailerState.mailer, smtpFrom: mailerState.settings.from, appOrigin });
  const reminderTimer = setInterval(() => {
    runScheduleReminders(db, { mailer: mailerState.mailer, smtpFrom: mailerState.settings.from, appOrigin }).catch((error) => logError("CommUnity could not create collection reminders.", error));
    pruneExpiredAuthState(db).catch((error) => logError("CommUnity could not prune expired authentication data.", error));
    pruneOldNotifications(db).catch((error) => logError("CommUnity could not prune old notifications.", error));
    archiveOldActivities(db).catch((error) => logError("CommUnity could not archive or prune old activity records.", error));
    sweepOrphanUploads(db, uploadsDir).catch((error) => logError("CommUnity could not remove abandoned photo uploads.", error));
  }, 15 * 60 * 1000);
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
