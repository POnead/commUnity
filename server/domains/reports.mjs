import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hash } from "../platform/crypto.mjs";
import { HttpError, readMultipart, requireJsonBody, sendImage, sendJson } from "../platform/http.mjs";
import { requireRole, hasPermission } from "../platform/session.mjs";
import { withTransaction } from "../platform/db.mjs";
import { recordAttempt } from "../platform/ratelimit.mjs";
import { validId } from "../platform/validate.mjs";
import { photoExtension } from "../platform/uploads.mjs";
import {
  REPORT_PRIORITIES,
  FOLLOW_UP_LIMITS,
  RESPONSE_DEADLINE_DAYS,
  RESOLUTION_DEADLINE_DAYS,
  normalizeReportPriority,
  serviceDeadline,
  serviceCycleAnchor,
  computeServiceDeadlines,
} from "./service-targets.mjs";
import { ROLES } from "../platform/roles.mjs";
import { insertNotification } from "./notifications.mjs";
import { insertActivity } from "./activity.mjs";
import { isWithinPalsaraBounds, validCoordinates } from "../../shared/community-map.mjs";

export const REPORT_STATUSES = ["Submitted", "Under Review", "In Progress", "Resolved"];

// validateReport rejects a report with more than 500 history rows on the next
// staff save. Each follow-up, confirmation, reopen and priority change appends
// one row, so refuse the append here instead of bricking the concern later.
const MAX_REPORT_HISTORY_ROWS = 500;
function assertHistoryHasRoom(count) {
  if (Number(count) >= MAX_REPORT_HISTORY_ROWS)
    throw new HttpError(400, "This concern has reached its history limit and cannot accept more updates.");
}

// One INSERT for all active staff instead of one per account. The text and
// targets match insertNotification; only the write shape changes.
export async function notifyStaff(db, title, body, reportId) {
  const staff = await db.query("SELECT email FROM users WHERE role IN ('official','administrator') AND status='Active'");
  const emails = staff.rows.map((account) => account.email);
  if (!emails.length) return;
  await db.query(
    `INSERT INTO notifications (id,target_email,report_id,title,body,created_at,read)
     SELECT t.id, t.email, $3, $4, $5, now(), false FROM unnest($1::uuid[], $2::text[]) AS t(id,email)`,
    [emails.map(() => randomUUID()), emails, reportId || null, title.slice(0, 200), body.slice(0, 1000)],
  );
}

// The number people read and search for. Internal ids stay in URLs and upload
// paths; this is display-only and never changes once assigned.
export function reportReference(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? `R-${String(number).padStart(4, "0")}` : "";
}

import { REPORT_TRANSITIONS } from "../../shared/domain-rules.mjs";
export { REPORT_TRANSITIONS };

// The position in a photo URL is derived from the photo's slot in the array,
// never from whatever the client captured at upload time. Two single-file
// uploads to the same draft both land at position 0, so trusting the URL
// keeps a saved concern's second photo permanently unreachable.
function normalizeReportPhotos(report) {
  if (!Array.isArray(report?.photos)) return;
  const prefix = `/api/reports/${encodeURIComponent(report.id)}/photos/`;
  for (const [position, photo] of report.photos.entries()) {
    const tail = String(photo?.photoUrl || "").startsWith(prefix) ? photo.photoUrl.slice(prefix.length) : "";
    const match = /^\d+\/([A-Za-z0-9-]+\.(jpg|png))$/.exec(tail);
    if (!match) continue; // validateReport rejects it below
    photo.photoUrl = `${prefix}${position}/${match[1]}`;
  }
}

export function validateReport(report, maxDescriptionLength = 500, skipDescriptionLengthCheck = false) {
  normalizeReportPriority(report);
  if (report && validId(report.id)) normalizeReportPhotos(report);
  if (!skipDescriptionLengthCheck && typeof report?.description === "string" && report.description.length > maxDescriptionLength)
    throw new HttpError(400, "A report description must be 500 characters or fewer.");
  if (
    !report ||
    !validId(report.id) ||
    typeof report.title !== "string" ||
    report.title.length > 200 ||
    typeof report.description !== "string" ||
    (!skipDescriptionLengthCheck && report.description.length < 12) ||
    typeof report.category !== "string" ||
    report.category.length > 100 ||
    typeof report.area !== "string" ||
    report.area.length > 120 ||
    (report.barangay !== undefined && (typeof report.barangay !== "string" || report.barangay.length > 100)) ||
    (report.locationDetail !== undefined && (typeof report.locationDetail !== "string" || report.locationDetail.length > 250)) ||
    (report.latitude !== undefined && report.latitude !== null) !== (report.longitude !== undefined && report.longitude !== null) ||
    (report.latitude != null && !validCoordinates(report.latitude, report.longitude)) ||
    !REPORT_STATUSES.includes(report.status) ||
    typeof report.urgent !== "boolean" ||
    !REPORT_PRIORITIES.includes(report.priority) ||
    (report.responseDeadline !== undefined && report.responseDeadline !== null && typeof report.responseDeadline !== "string") ||
    (report.respondedAt !== undefined && report.respondedAt !== null && typeof report.respondedAt !== "string") ||
    (report.resolutionDeadline !== undefined && report.resolutionDeadline !== null && typeof report.resolutionDeadline !== "string") ||
    (report.resolvedAt !== undefined && report.resolvedAt !== null && typeof report.resolvedAt !== "string") ||
    (report.assignedTo !== undefined &&
      report.assignedTo !== null &&
      (!report.assignedTo ||
        typeof report.assignedTo !== "object" ||
        !validId(report.assignedTo.id) ||
        typeof report.assignedTo.name !== "string" ||
        report.assignedTo.name.length > 100)) ||
    !Array.isArray(report.history) ||
    report.history.length < 1 ||
    report.history.length > 500 ||
    !Array.isArray(report.photos) ||
    report.photos.length > 3
  ) {
    throw new HttpError(400, "A report contains invalid or excessive data.");
  }
  for (const photo of report.photos) {
    const photoPrefix = `/api/reports/${encodeURIComponent(report.id)}/photos/`;
    if (
      !photo ||
      typeof photo.name !== "string" ||
      photo.name.length > 120 ||
      typeof photo.photoUrl !== "string" ||
      !photo.photoUrl.startsWith(photoPrefix) ||
      !/^\d+\/[A-Za-z0-9-]+\.(jpg|png)$/.test(photo.photoUrl.slice(photoPrefix.length))
    ) {
      throw new HttpError(400, "A report photo is invalid or too large.");
    }
  }
  for (const item of report.history) {
    if (
      !item ||
      !REPORT_STATUSES.includes(item.status) ||
      typeof item.note !== "string" ||
      item.note.length > 2000 ||
      typeof item.at !== "string" ||
      Number.isNaN(Date.parse(item.at)) ||
      (item.actorName !== undefined && (typeof item.actorName !== "string" || item.actorName.length > 100)) ||
      (item.actorRole !== undefined && !ROLES.includes(item.actorRole))
    ) {
      throw new HttpError(400, "Report history contains invalid data.");
    }
  }
}

export async function insertReport(db, report) {
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
  if (report.latitude != null && report.longitude != null && !isWithinPalsaraBounds(report.latitude, report.longitude)) {
    throw new HttpError(400, "Choose a report location within the Palsara, Balete map area.");
  }
  // A new concern opens its first service cycle at submission. The server always
  // owns the cycle start; a client-supplied serviceCycleStartedAt is never trusted.
  report.serviceCycleStartedAt = now;
  // Both service targets are computed from the server's own clock. Client-supplied
  // deadlines are never trusted for a newly filed concern.
  report.responseDeadline = null;
  report.resolutionDeadline = null;
  computeServiceDeadlines(report);
  const numbered = await db.query("SELECT nextval('report_reference_seq')::integer AS reference");
  report.reference = Number(numbered.rows[0].reference);
  await db.query(
    `
    INSERT INTO reports (id, user_email, name, category, title, area, barangay, location_detail, latitude, longitude, description, urgent, priority, assigned_to, status, submitted_at, updated_at, response_deadline, responded_at, resolution_deadline, resolved_at, service_cycle_started_at, reference)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
  `,
    [
      report.id,
      report.userEmail,
      report.name,
      report.category,
      report.title,
      report.area,
      report.barangay || "",
      report.locationDetail || "",
      report.latitude ?? null,
      report.longitude ?? null,
      report.description,
      report.urgent,
      report.priority,
      report.assignedTo?.id || null,
      report.status,
      report.submittedAt,
      report.updatedAt,
      report.responseDeadline ?? null,
      report.respondedAt ?? null,
      report.resolutionDeadline ?? null,
      report.resolvedAt ?? null,
      report.serviceCycleStartedAt,
      report.reference,
    ],
  );
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
    await db.query(
      "INSERT INTO report_history (report_id, position, status, at, note, actor_name, actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [report.id, position, item.status, item.at, item.note, item.actorName || "", item.actorRole || ""],
    );
  }
  for (const [position, photo] of report.photos.entries()) {
    await db.query("INSERT INTO report_photos (report_id,position,name,photo_url) VALUES ($1,$2,$3,$4)", [
      report.id,
      position,
      photo.name,
      photo.photoUrl,
    ]);
  }
}

export async function replaceReport(db, report) {
  // The service clock belongs to the server. An existing concern keeps the cycle it
  // is already in, so a reopened concern keeps the clock it was restarted on, and
  // only a newly stored concern opens its cycle at submission. The submission
  // moment is preserved from the database; the client cannot backdate or
  // forward-date a concern.
  const existing = await db.query(
    "SELECT description, submitted_at, service_cycle_started_at, latitude, longitude, reference FROM reports WHERE id=$1",
    [report.id],
  );
  const existingRow = existing.rows[0];
  // A description written before the 500-character cap stays editable; only new
  // text has to fit the current rule.
  const descriptionUnchanged = existingRow?.description === report.description;
  validateReport(report, descriptionUnchanged ? 1200 : 500, descriptionUnchanged);
  if (
    report.latitude != null &&
    report.longitude != null &&
    !isWithinPalsaraBounds(report.latitude, report.longitude) &&
    (existingRow?.latitude !== report.latitude || existingRow?.longitude !== report.longitude)
  ) {
    throw new HttpError(400, "Choose a report location within the Palsara, Balete map area.");
  }
  report.submittedAt = existingRow ? new Date(existingRow.submitted_at).toISOString() : report.submittedAt;
  report.serviceCycleStartedAt =
    existingRow && existingRow.service_cycle_started_at
      ? new Date(existingRow.service_cycle_started_at).toISOString()
      : report.submittedAt || new Date().toISOString();
  computeServiceDeadlines(report);
  let reference = existingRow?.reference ?? null;
  if (reference == null) {
    const numbered = await db.query("SELECT nextval('report_reference_seq')::integer AS reference");
    reference = Number(numbered.rows[0].reference);
  }
  report.reference = Number(reference);
  await db.query(
    `
    INSERT INTO reports (id, user_email, name, category, title, area, barangay, location_detail, latitude, longitude, description, urgent, priority, assigned_to, status, submitted_at, updated_at, response_deadline, responded_at, resolution_deadline, resolved_at, service_cycle_started_at, reference)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT (id) DO UPDATE SET user_email=excluded.user_email, name=excluded.name, category=excluded.category,
      title=excluded.title, area=excluded.area, barangay=excluded.barangay, location_detail=excluded.location_detail,
      latitude=excluded.latitude, longitude=excluded.longitude, description=excluded.description, urgent=excluded.urgent,
      priority=excluded.priority, assigned_to=excluded.assigned_to, status=excluded.status, submitted_at=excluded.submitted_at, updated_at=excluded.updated_at,
      response_deadline=excluded.response_deadline, responded_at=excluded.responded_at,
      resolution_deadline=excluded.resolution_deadline, resolved_at=excluded.resolved_at,
      service_cycle_started_at=excluded.service_cycle_started_at
  `,
    [
      report.id,
      report.userEmail,
      report.name,
      report.category,
      report.title,
      report.area,
      report.barangay || "",
      report.locationDetail || "",
      report.latitude ?? null,
      report.longitude ?? null,
      report.description,
      report.urgent,
      report.priority,
      report.assignedTo?.id || null,
      report.status,
      report.submittedAt,
      report.updatedAt,
      report.responseDeadline ?? null,
      report.respondedAt ?? null,
      report.resolutionDeadline ?? null,
      report.resolvedAt ?? null,
      report.serviceCycleStartedAt,
      report.reference,
    ],
  );
  // Rewriting history/photos on every save churns both tables for edits that
  // never touch them; skip when the stored copies match exactly.
  const existingHistory = await db.query(
    `SELECT status, at, note, actor_name AS "actorName", actor_role AS "actorRole"
     FROM report_history WHERE report_id=$1 ORDER BY position`,
    [report.id],
  );
  const historyUnchanged =
    existingHistory.rows.length === report.history.length &&
    existingHistory.rows.every((row, index) => {
      const item = report.history[index];
      const rowAt = row.at instanceof Date ? row.at.toISOString() : new Date(row.at).toISOString();
      return (
        row.status === item.status &&
        rowAt === item.at &&
        row.note === item.note &&
        (row.actorName || "") === (item.actorName || "") &&
        (row.actorRole || "") === (item.actorRole || "")
      );
    });
  const existingPhotos = await db.query(`SELECT name, photo_url AS "photoUrl" FROM report_photos WHERE report_id=$1 ORDER BY position`, [
    report.id,
  ]);
  const photosUnchanged =
    existingPhotos.rows.length === report.photos.length &&
    existingPhotos.rows.every((row, index) => {
      const photo = report.photos[index];
      return row.name === photo.name && row.photoUrl === photo.photoUrl;
    });
  // The state echo is capped at the newest 50 history / 3 photos per report,
  // so the client's list can be a suffix of the stored rows. Find that suffix
  // and append only genuinely new rows: deleting and rewriting from the echo
  // would drop every history entry and photo older than the cap.
  const rowAt = (value) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
  const appended = (existing, incoming, matches) => {
    for (let size = Math.min(existing.length, incoming.length); size > 0; size--) {
      if (existing.slice(existing.length - size).every((row, index) => matches(row, incoming[index]))) return incoming.slice(size);
    }
    // An empty echo sends no detail to duplicate — it can happen when old rows
    // fail the read-side filter. A non-empty list with no matching suffix would
    // duplicate stored rows, so refuse that save instead.
    if (!incoming.length || !existing.length) return incoming;
    throw new HttpError(400, "The saved report detail is out of date. Reload before saving.");
  };
  if (!historyUnchanged) {
    const newRows = appended(existingHistory.rows, report.history, (row, item) => {
      const itemAt = rowAt(item.at);
      return (
        row.status === item.status &&
        rowAt(row.at) === itemAt &&
        row.note === item.note &&
        (row.actorName || "") === (item.actorName || "") &&
        (row.actorRole || "") === (item.actorRole || "")
      );
    });
    // Check the stored count, not the echo plus its append: the dedicated
    // endpoints allow exactly 500 rows and refuse the 501st, and the shared
    // writer must draw the same line.
    assertHistoryHasRoom(existingHistory.rows.length);
    for (const [offset, item] of newRows.entries()) {
      await db.query(
        "INSERT INTO report_history (report_id, position, status, at, note, actor_name, actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [report.id, existingHistory.rows.length + offset, item.status, item.at, item.note, item.actorName || "", item.actorRole || ""],
      );
    }
  }
  if (!photosUnchanged) {
    const newPhotos = appended(existingPhotos.rows, report.photos, (row, photo) => row.name === photo.name && row.photoUrl === photo.photoUrl);
    for (const [offset, photo] of newPhotos.entries()) {
      await db.query("INSERT INTO report_photos (report_id,position,name,photo_url) VALUES ($1,$2,$3,$4)", [
        report.id,
        existingPhotos.rows.length + offset,
        photo.name,
        photo.photoUrl,
      ]);
    }
  }
}

// Concern photos are served one file at a time behind a session check; resident
// access is limited to their own reports. Returns true when it owns the request.
async function serveReportPhoto(request, response, db, options, user, url, photoMatch) {
  const { uploadsDir } = options;
  const reportId = decodeURIComponent(photoMatch[1]);
  requireRole(user, ROLES);
  // The concern queue is what gives staff photo access. Without the concern
  // permission, photos of any report stay closed; residents keep access to
  // their own concerns, gated by the permission that lets them file them.
  if (user.role === "resident") {
    if (!(await hasPermission(db, user, "submitReports"))) throw new HttpError(403, "Submitting concerns is not enabled for this role.");
  } else if (!(await hasPermission(db, user, "manageReports"))) {
    throw new HttpError(403, "Report management is not enabled for this role.");
  }
  if (!validId(reportId)) throw new HttpError(404, "The report photo could not be found.");
  const uploadsRoot = path.resolve(uploadsDir);
  const reportDirectory = path.resolve(uploadsRoot, reportId);
  if (path.dirname(reportDirectory) !== uploadsRoot) throw new HttpError(404, "The report photo could not be found.");
  const position = Number(photoMatch[2]);
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
  const image = await readFile(path.join(reportDirectory, filename)).catch(() => {
    throw new HttpError(404, "The report photo could not be found.");
  });
  sendImage(response, filename, image);
  return true;
}

export async function handleReports(request, response, db, options, user) {
  const { uploadsDir } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  const reportPhotoMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/photos\/(\d+)\/([A-Za-z0-9-]+\.(?:jpg|png))$/);
  if (reportPhotoMatch && request.method === "GET") {
    return serveReportPhoto(request, response, db, options, user, url, reportPhotoMatch);
  }
  if (url.pathname === "/api/report-photos" && request.method === "POST") {
    requireRole(user, ["resident"]);
    if (!(await hasPermission(db, user, "submitReports"))) throw new HttpError(403, "Submitting concerns is not enabled for this role.");
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
    const uploadsRoot = path.resolve(uploadsDir);
    const reportUploadDir = path.resolve(uploadsRoot, reportId);
    // validId already rules out "." and "..", and never matches a separator, so a
    // resolved child must sit directly inside the uploads directory. Refuse
    // anything else before a single byte is written.
    if (path.dirname(reportUploadDir) !== uploadsRoot) throw new HttpError(400, "The report identifier is invalid.");
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
    return true;
  }
  if (url.pathname === "/api/community/follow-up" && request.method === "POST") {
    requireRole(user, ["resident"]);
    if (!(await hasPermission(db, user, "submitReports"))) throw new HttpError(403, "Submitting concerns is not enabled for this role.");
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const message = String(request.body.message || "").trim();
    if (!message || message.length > 1000) throw new HttpError(400, "Enter a follow-up message.");
    let followUpResult = { count: 0, limit: null, remaining: null };
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query(
        'SELECT id,status,priority,user_email AS "userEmail", reference FROM reports WHERE id=$1 AND user_email=$2 FOR UPDATE',
        [reportId, user.email],
      );
      if (!report.rows.length) throw new HttpError(404, "This report could not be found.");
      const current = report.rows[0];
      const ref = reportReference(current.reference);
      if (current.status === "Resolved") throw new HttpError(409, "This concern is resolved and no longer accepts follow-ups.");
      const limit = Object.hasOwn(FOLLOW_UP_LIMITS, current.priority) ? FOLLOW_UP_LIMITS[current.priority] : FOLLOW_UP_LIMITS.Medium;
      const counted = await transaction.query("SELECT count(*)::integer AS count FROM report_follow_ups WHERE report_id=$1", [reportId]);
      const count = Number(counted.rows[0].count);
      if (limit !== null && count >= limit) {
        throw new HttpError(429, `This ${current.priority} priority concern has reached its ${limit} follow-up limit.`);
      }
      const position = await transaction.query(
        "SELECT count(*)::integer AS count, COALESCE(MAX(position),-1)+1 AS position FROM report_history WHERE report_id=$1",
        [reportId],
      );
      assertHistoryHasRoom(position.rows[0].count);
      await transaction.query(
        "INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES($1,$2,$3,now(),$4,$5,'resident')",
        [reportId, Number(position.rows[0].position), current.status, `Follow-up: ${message}`, user.name],
      );
      await transaction.query("UPDATE reports SET updated_at=now() WHERE id=$1", [reportId]);
      await transaction.query("INSERT INTO report_follow_ups(report_id,user_email,message) VALUES($1,$2,$3)", [
        reportId,
        user.email,
        message,
      ]);
      await notifyStaff(transaction, "Report follow-up received", `${ref}: ${message}`, reportId);
      await insertNotification(
        transaction,
        user.email,
        "Follow-up sent",
        `${ref}: Your follow-up was sent to barangay staff. ${message}`,
        reportId,
      );
      await insertActivity(transaction, user, "Added report follow-up", `${ref} · ${message}`);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
      followUpResult = {
        count: count + 1,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - count - 1),
      };
    });
    sendJson(response, 200, { ok: true, ...followUpResult });
    return true;
  }
  if (url.pathname === "/api/community/report-priority" && request.method === "POST") {
    requireRole(user, ["official", "administrator"]);
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const priority = String(request.body.priority || "");
    if (!REPORT_PRIORITIES.includes(priority)) throw new HttpError(400, "Choose a valid concern priority.");
    if (!(await hasPermission(db, user, "manageReports"))) {
      throw new HttpError(403, "Report management is not enabled for this role.");
    }
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query(
        'SELECT id,status,priority,user_email AS "userEmail", submitted_at AS "submittedAt", service_cycle_started_at AS "serviceCycleStartedAt", responded_at AS "respondedAt", response_deadline AS "responseDeadline", reference FROM reports WHERE id=$1 FOR UPDATE',
        [reportId],
      );
      if (!report.rows.length) throw new HttpError(404, "This report could not be found.");
      const current = report.rows[0];
      const ref = reportReference(current.reference);
      if (current.priority === priority) return;
      if (current.status === "Resolved") throw new HttpError(409, "This concern is resolved; its priority cannot be changed.");
      const newLimit = FOLLOW_UP_LIMITS[priority];
      if (newLimit !== null) {
        const counted = await transaction.query("SELECT count(*)::integer AS count FROM report_follow_ups WHERE report_id=$1", [reportId]);
        if (Number(counted.rows[0].count) > newLimit) {
          throw new HttpError(
            400,
            `This report already has ${counted.rows[0].count} follow-ups, exceeding the ${newLimit} limit for ${priority} priority.`,
          );
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
      const position = await transaction.query(
        "SELECT count(*)::integer AS count, COALESCE(MAX(position),-1)+1 AS position FROM report_history WHERE report_id=$1",
        [reportId],
      );
      assertHistoryHasRoom(position.rows[0].count);
      await transaction.query(
        "INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES($1,$2,$3,now(),$4,$5,$6)",
        [reportId, Number(position.rows[0].position), current.status, `Priority changed to ${priority}.`, user.name, user.role],
      );
      await insertNotification(
        transaction,
        current.userEmail,
        "Concern priority updated",
        `${ref}: Your concern priority is now ${priority}.`,
        reportId,
      );
      await insertActivity(transaction, user, "Changed report priority", `${ref} · ${priority}`);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true, priority });
    return true;
  }
  if (url.pathname === "/api/reports/assignment" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    if (!(await hasPermission(db, user, "manageReports"))) throw new HttpError(403, "Report management is not enabled for this role.");
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const officialId = String(request.body.officialId || "");
    if (!validId(reportId) || !validId(officialId)) throw new HttpError(400, "Choose a valid concern and official.");
    let assignedTo;
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query("SELECT id,assigned_to,status,reference FROM reports WHERE id=$1 FOR UPDATE", [reportId]);
      if (!report.rows.length) throw new HttpError(404, "This concern could not be found.");
      const current = report.rows[0];
      if (current.status === "Resolved") throw new HttpError(409, "Resolved concerns cannot be assigned.");
      if (current.assigned_to) throw new HttpError(409, "This concern has already been assigned.");
      const official = await transaction.query("SELECT id,name,email,role,status FROM users WHERE id=$1 FOR UPDATE", [officialId]);
      if (!official.rows.length || official.rows[0].role !== "official" || official.rows[0].status !== "Active")
        throw new HttpError(400, "Choose an active Barangay Official account.");
      const selectedOfficial = official.rows[0];
      const updated = await transaction.query(
        "UPDATE reports SET assigned_to=$1,updated_at=now() WHERE id=$2 AND assigned_to IS NULL AND status <> 'Resolved' RETURNING id",
        [selectedOfficial.id, reportId],
      );
      if (!updated.rows.length) throw new HttpError(409, "This concern has already been assigned or resolved.");
      await insertActivity(
        transaction,
        user,
        "Assigned concern to official",
        `${reportReference(current.reference)} · ${selectedOfficial.name}`,
        {
          affectedId: reportId,
        },
      );
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
      assignedTo = { id: selectedOfficial.id, name: selectedOfficial.name };
    });
    sendJson(response, 200, { ok: true, assignedTo });
    return true;
  }
  if (url.pathname === "/api/community/report-confirm" && request.method === "POST") {
    requireRole(user, ["resident"]);
    if (!(await hasPermission(db, user, "submitReports"))) throw new HttpError(403, "Submitting concerns is not enabled for this role.");
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const note = String(request.body.note || "").trim();
    if (note.length > 500) throw new HttpError(400, "Keep the confirmation note within 500 characters.");
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query(
        'SELECT id,status,user_email AS "userEmail", reference FROM reports WHERE id=$1 AND user_email=$2 FOR UPDATE',
        [reportId, user.email],
      );
      if (!report.rows.length) throw new HttpError(404, "This report could not be found.");
      const current = report.rows[0];
      const ref = reportReference(current.reference);
      if (current.status !== "Resolved") throw new HttpError(409, "Only a resolved concern can be confirmed as addressed.");
      const lastHistory = await transaction.query(
        'SELECT actor_role AS "actorRole", note FROM report_history WHERE report_id=$1 ORDER BY position DESC LIMIT 1',
        [reportId],
      );
      if (lastHistory.rows[0]?.actorRole === "resident" && String(lastHistory.rows[0].note || "").startsWith("Resident confirmed")) {
        throw new HttpError(409, "This concern is already confirmed as addressed.");
      }
      const position = await transaction.query(
        "SELECT count(*)::integer AS count, COALESCE(MAX(position),-1)+1 AS position FROM report_history WHERE report_id=$1",
        [reportId],
      );
      assertHistoryHasRoom(position.rows[0].count);
      await transaction.query(
        "INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES($1,$2,$3,now(),$4,$5,'resident')",
        [
          reportId,
          Number(position.rows[0].position),
          current.status,
          `Resident confirmed the issue was addressed.${note ? ` ${note}` : ""}`,
          user.name,
        ],
      );
      await transaction.query("UPDATE reports SET updated_at=now() WHERE id=$1", [reportId]);
      await notifyStaff(transaction, "Concern confirmed addressed", `${ref}: The resident confirmed this concern was addressed.`, reportId);
      await insertNotification(
        transaction,
        user.email,
        "Concern confirmed addressed",
        `${ref}: You confirmed this concern was addressed.`,
        reportId,
      );
      await insertActivity(
        transaction,
        user,
        "Confirmed concern as addressed",
        `${ref} · The resident confirmed this concern was addressed.`,
        { affectedId: reportId },
      );
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/community/report-reopen" && request.method === "POST") {
    requireRole(user, ["resident"]);
    if (!(await hasPermission(db, user, "submitReports"))) throw new HttpError(403, "Submitting concerns is not enabled for this role.");
    requireJsonBody(request);
    const reportId = String(request.body.reportId || "");
    const reason = String(request.body.reason || "").trim();
    if (!reason) throw new HttpError(400, "Explain why the concern should be reopened.");
    if (reason.length > 500) throw new HttpError(400, "Keep the reopening reason within 500 characters.");
    await withTransaction(db, async (transaction) => {
      const report = await transaction.query(
        'SELECT id,status,user_email AS "userEmail",priority,reference FROM reports WHERE id=$1 AND user_email=$2 FOR UPDATE',
        [reportId, user.email],
      );
      if (!report.rows.length) throw new HttpError(404, "This report could not be found.");
      const current = report.rows[0];
      const ref = reportReference(current.reference);
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
      const position = await transaction.query(
        "SELECT count(*)::integer AS count, COALESCE(MAX(position),-1)+1 AS position FROM report_history WHERE report_id=$1",
        [reportId],
      );
      assertHistoryHasRoom(position.rows[0].count);
      await transaction.query(
        "INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES($1,$2,$3,now(),$4,$5,'resident')",
        [reportId, Number(position.rows[0].position), "Submitted", `Resident requested reopening: ${reason}`, user.name],
      );
      await notifyStaff(transaction, "Concern reopened", `${ref}: The resident requested this concern be reopened. Reason: ${reason}`, reportId);
      await insertNotification(
        transaction,
        user.email,
        "Concern reopening requested",
        `${ref}: Your request to reopen this concern was sent to barangay staff.`,
        reportId,
      );
      await insertActivity(transaction, user, "Requested concern reopening", `${ref} · ${reason}`, { affectedId: reportId });
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  return false;
}
