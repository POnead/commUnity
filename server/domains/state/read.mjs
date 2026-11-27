"use strict";

import { makeDefaultState } from "./validate.mjs";
import { timestamp } from "../../platform/time.mjs";
import { publicUser, readVisibility } from "../../platform/session.mjs";
import { sendJson } from "../../platform/http.mjs";

// A state read echoes only the newest slice of a report's detail. Without this,
// a staff/admin workspace with a long concern history is too large to save back:
// the 32 MB ceiling is enforced on PUT, so the browser would be permanently
// locked out of saving. Older rows stay in the database and are restored before
// any write (see replaceReport), so truncation never deletes data.
const MAX_ECHOED_HISTORY_PER_REPORT = 50;
const MAX_ECHOED_PHOTOS_PER_REPORT = 3;

// Enforce the read permissions at the source: what the client may see. A
// disabled permission hides the whole collection rather than leaving it
// readable — the UI hiding the page is cosmetic, not access control.
function withholdState(state, user, visibility) {
  const staff = user.role === "official" || user.role === "administrator";
  // Reports carry descriptions and photo metadata.
  const reportsVisible = user.role === "resident" ? visibility.submitReports : visibility.manageReports;
  if (!reportsVisible) state.reports = [];
  // Schedules need the schedule permission of the caller's role. Calendar events
  // are managed through the same endpoints with the same permission, so they
  // follow the schedule grant, not the announcement grant.
  const schedulesVisible = user.role === "resident" ? visibility.viewSchedules : visibility.manageSchedules;
  if (!schedulesVisible) {
    state.schedules = [];
    if (staff) state.calendarEvents = [];
  }
  // Announcements are a staff workspace kept apart from the calendar.
  if (staff && !visibility.manageAnnouncements) state.announcements = [];
  // Activities are the administrator's audit log.
  if (user.role === "administrator" && !visibility.viewAudit) state.activities = [];
  // Account management: administrators without it get the officials' card view.
  if (user.role === "administrator" && !visibility.manageUsers) {
    state.users = state.users
      .filter((account) => account.role === "resident")
      .map((account) => ({
        id: account.id,
        email: account.email,
        name: account.name,
        area: account.area,
        role: account.role,
        status: account.status,
        photoUrl: account.photoUrl,
      }));
    state.recyclingLocations = state.recyclingLocations.filter((item) => item.active);
  }
  // Role management covers the per-account permission overrides.
  if (user.role === "administrator" && !visibility.manageRoles) state.accountOverrides = {};
  // The ID queue is administrative data: residents and officials never receive it.
  if (!user || user.role !== "administrator") state.verificationQueue = [];
}

const ADMIN_USER_COLUMNS =
  'SELECT id, email, name, area, phone, role, status, working_hours AS "workingHours", available_days AS "availableDays", requires_password_change AS "requiresPasswordChange", deactivation_reason AS "deactivationReason", recovery_email AS "recoveryEmail", reset_requested AS "resetRequested", photo_url AS "photoUrl", id_status AS "idStatus", to_char(joined_at, \'YYYY-MM-DD\') AS "joinedAt" FROM users';

export async function readFullState(db, user = null, { withheld = true } = {}) {
  const state = makeDefaultState();
  if (!user || user.role === "administrator") {
    const users = user
      ? await db.query(`${ADMIN_USER_COLUMNS} WHERE id <> $1 ORDER BY joined_at, email`, [user.id])
      : await db.query(`${ADMIN_USER_COLUMNS} ORDER BY joined_at, email`);
    state.users = users.rows;
  } else if (user.role === "resident") {
    const users = await db.query(
      'SELECT id, email, name, area, phone, role, status, working_hours AS "workingHours", available_days AS "availableDays", requires_password_change AS "requiresPasswordChange", photo_url AS "photoUrl", id_status AS "idStatus", to_char(joined_at, \'YYYY-MM-DD\') AS "joinedAt" FROM users WHERE id=$1',
      [user.id],
    );
    state.users = users.rows;
  } else if (user.role === "official") {
    // Officials handle the concern queue: they see each resident's basic account card and
    // photo, never phone numbers, working hours, recovery emails, or staff accounts.
    const users = await db.query(
      `SELECT id, email, name, area, role, status, photo_url AS "photoUrl", id_status AS "idStatus" FROM users WHERE role='resident' ORDER BY joined_at, email`,
    );
    state.users = users.rows;
  }

  // The admin ID-review queue rides along in the state they already poll.
  if (user?.role === "administrator") {
    const queue = await db.query(
      `SELECT id AS "userId", name, email, area, role, id_type AS "idType", id_number AS "idNumber",
         id_full_name AS "idFullName", to_char(id_birth_date, 'YYYY-MM-DD') AS "idBirthDate",
         id_address AS "idAddress", to_char(id_expiration_date, 'YYYY-MM-DD') AS "idExpirationDate",
         id_face_status AS "idFaceStatus",
         COALESCE(id_back_image_filename, '') <> '' AS "hasIdBackImage",
         to_char(id_submitted_at, 'YYYY-MM-DD') AS "idSubmittedAt", id_scan_checks AS "idScanChecks"
       FROM users WHERE id_status = 'pending' ORDER BY id_submitted_at NULLS LAST, email`,
    );
    state.verificationQueue = queue.rows;
  }

  const residentRead = user?.role === "resident";
  // Scope the follow-up grouping to the reports this caller can see. Without
  // it, a resident reading one report still aggregates the whole follow-up
  // table; the subquery reuses the same resident filter as the outer query.
  const followUpScope = residentRead ? "WHERE report_id IN (SELECT id FROM reports WHERE user_email=$1)" : "";
  const reports = await db.query(
    `
    SELECT r.id, r.reference, r.user_email AS "userEmail", r.name, r.category, r.title, r.area, r.barangay,
    r.location_detail AS "locationDetail", r.latitude, r.longitude, r.description, r.urgent, r.priority,
    COALESCE(f.c, 0)::integer AS "followUpCount",
    r.assigned_to AS "assignedToId", assignee.name AS "assignedToName", r.status,
    r.submitted_at AS "submittedAt", r.updated_at AS "updatedAt",
    r.response_deadline AS "responseDeadline", r.responded_at AS "respondedAt",
    r.resolution_deadline AS "resolutionDeadline", r.resolved_at AS "resolvedAt"
    FROM reports r LEFT JOIN users assignee ON assignee.id=r.assigned_to
    LEFT JOIN (SELECT report_id, count(*) AS c FROM report_follow_ups ${followUpScope} GROUP BY report_id) f ON f.report_id=r.id
    ${residentRead ? "WHERE r.user_email=$1" : ""}
    ORDER BY r.submitted_at DESC, r.id
  `,
    residentRead ? [user.email] : [],
  );
  const reportIds = reports.rows.map((report) => report.id);
  if (reportIds.length) {
    const histories = await db.query(
      `SELECT report_id, status, at, note, actor_name AS "actorName",
      actor_role AS "actorRole" FROM report_history
      ${user?.role === "resident" ? "WHERE report_id=ANY($1::text[])" : ""}
      ORDER BY report_id, position`,
      user?.role === "resident" ? [reportIds] : [],
    );
    const historyByReport = new Map();
    for (const row of histories.rows) {
      const list = historyByReport.get(row.report_id) || [];
      list.push({ status: row.status, at: timestamp(row.at), note: row.note, actorName: row.actorName, actorRole: row.actorRole });
      historyByReport.set(row.report_id, list);
    }
    const photos = await db.query(
      `
      SELECT report_id, name, photo_url AS "photoUrl" FROM report_photos
      ${user?.role === "resident" ? "WHERE report_id=ANY($1::text[])" : ""}
      ORDER BY report_id, position
    `,
      user?.role === "resident" ? [reportIds] : [],
    );
    const photosByReport = new Map();
    for (const row of photos.rows) {
      const list = photosByReport.get(row.report_id) || [];
      const photoPrefix = `/api/reports/${encodeURIComponent(row.report_id)}/photos/`;
      if (
        list.length >= 3 ||
        typeof row.name !== "string" ||
        row.name.length > 120 ||
        typeof row.photoUrl !== "string" ||
        !row.photoUrl.startsWith(photoPrefix)
      )
        continue;
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
        // Echo only the newest detail. The write path reads the full stored
        // rows again and appends to them, so this cannot delete older entries.
        history: (historyByReport.get(report.id) || []).slice(-MAX_ECHOED_HISTORY_PER_REPORT),
        photos: (photosByReport.get(report.id) || []).slice(-MAX_ECHOED_PHOTOS_PER_REPORT),
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
  const notifications = await db.query(
    `
    SELECT id, target_email AS "targetEmail", report_id AS "reportId", title, body,
      created_at AS "createdAt", read FROM notifications
    ${user ? "WHERE target_email=$1" : ""}
    ORDER BY created_at DESC, id
  `,
    user ? [user.email] : [],
  );
  state.notifications = notifications.rows.map((item) => ({
    ...item,
    reportId: item.reportId || "",
    createdAt: timestamp(item.createdAt),
  }));
  if (!user || user.role === "administrator") {
    const activities = await db.query(
      'SELECT id, actor, role, action, detail, at, result, result_reason AS "resultReason", affected_id AS "affectedId", client_ip AS "clientIp" FROM activities ORDER BY at DESC, id LIMIT 200',
    );
    state.activities = activities.rows.map((item) => ({ ...item, at: timestamp(item.at) }));
  }
  const permissions = await db.query("SELECT role, permission, enabled FROM role_permissions ORDER BY role, permission");
  for (const { role, permission, enabled } of permissions.rows) {
    state.permissions[role] ||= {};
    state.permissions[role][permission] = enabled;
  }
  const permissionOverrides = await db.query(
    "SELECT email, permission_overrides AS overrides FROM users WHERE permission_overrides <> '{}'::jsonb",
  );
  state.accountOverrides = Object.fromEntries(
    permissionOverrides.rows
      .filter((row) => row.overrides && typeof row.overrides === "object" && Object.keys(row.overrides).length)
      .map((row) => [row.email, row.overrides]),
  );
  const announcements = await db.query(`
    SELECT a.id, a.title, a.detail, to_char(a.date, 'YYYY-MM-DD') AS date, a.approval_status AS "approvalStatus", a.decline_reason AS "declineReason",
      a.is_event AS "isEvent", a.latitude, a.longitude,
      a.created_by AS "createdBy", u.name AS "createdByName"
    FROM announcements a LEFT JOIN users u ON u.id = a.created_by
    ${user && user.role === "resident" ? "WHERE a.approval_status='approved'" : ""}
    ORDER BY a.date DESC, a.id DESC
  `);
  state.announcements = announcements.rows.map((item) => ({ ...item, id: String(item.id) }));
  const calendarEvents = await db.query(
    `
    SELECT e.id, e.title, e.detail, to_char(e.date, 'YYYY-MM-DD') AS date,
      e.approval_status AS "approvalStatus", e.decline_reason AS "declineReason",
      e.latitude, e.longitude,
      e.created_by AS "createdBy", u.name AS "createdByName", e.created_at AS "createdAt"
    FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by
    ${user && user.role === "administrator" ? "" : user ? "WHERE e.approval_status='approved' OR e.created_by=$1" : "WHERE e.approval_status='approved'"}
    ORDER BY e.date, e.id
  `,
    user && user.role !== "administrator" ? [user.id] : [],
  );
  state.calendarEvents = calendarEvents.rows.map((item) => ({
    ...item,
    id: String(item.id),
    createdAt: timestamp(item.createdAt),
  }));
  const locations = await db.query(
    "SELECT id, area, barangay, street, purok, landmark, latitude, longitude FROM community_locations ORDER BY barangay, purok, street, id",
  );
  state.locations = locations.rows;
  const recyclingLocations = await db.query(`
    SELECT id, name, barangay, street, purok, landmark, materials, phone, hours, active
    FROM recycling_locations ${!user || user.role === "administrator" ? "" : "WHERE active=true"}
    ORDER BY active DESC, name
  `);
  state.recyclingLocations = recyclingLocations.rows;
  // Drafts are staff-only work in progress; residents and officials read the
  // published directory. An inactive hotline stays visible so people can see it
  // is temporarily unavailable instead of assuming it was removed.
  const hotlines = await db.query(`
    SELECT id, name, category, contact_number AS "contactNumber",
      alternative_contact_number AS "alternativeContactNumber", office_address AS "officeAddress",
      description, operating_hours AS "operatingHours", status, published,
      verified_at AS "verifiedAt", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM emergency_hotlines
    ${!user || user.role === "administrator" ? "" : "WHERE published"}
    ORDER BY lower(name), id
  `);
  state.hotlines = hotlines.rows.map((item) => ({
    ...item,
    id: String(item.id),
    verifiedAt: item.verifiedAt ? timestamp(item.verifiedAt) : null,
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
  }));
  const hotlineCorrections = await db.query(
    `
    SELECT c.id, c.hotline_id AS "hotlineId", c.kind, c.submitted_by AS "submittedById",
      u.name AS "submittedByName", c.proposed, c.reason, c.status,
      c.reviewed_at AS "reviewedAt", c.review_note AS "reviewNote", c.created_at AS "createdAt"
    FROM hotline_corrections c LEFT JOIN users u ON u.id = c.submitted_by
    ${user && user.role === "official" ? "WHERE c.submitted_by=$1" : ""}
    ORDER BY c.created_at DESC, c.id DESC
  `,
    user && user.role === "official" ? [user.id] : [],
  );
  state.hotlineCorrections = hotlineCorrections.rows.map((item) => ({
    ...item,
    id: String(item.id),
    hotlineId: item.hotlineId == null ? null : String(item.hotlineId),
    reviewedAt: item.reviewedAt ? timestamp(item.reviewedAt) : null,
    createdAt: timestamp(item.createdAt),
  }));
  if (user && withheld) withholdState(state, user, await readVisibility(db, user));
  return state;
}

// Every mutation that returns the refreshed workspace sends the same trio. One
// home for it so the shape is changed in one place.
export async function sendStateResponse(response, db, user, statusCode = 200, extra = {}) {
  // Read the revision first, then the state. A commit between the two leaves the
  // client with a stale low revision so its next save is refused with a 409
  // rather than silently overwriting newer data.
  const revision = await db.query("SELECT revision FROM app_meta WHERE id=1");
  const state = await readFullState(db, user);
  sendJson(response, statusCode, {
    data: stateForRole(state, user),
    revision: Number(revision.rows[0].revision),
    user: publicUser(user),
    ...extra,
  });
}

export function stateForRole(state, user) {
  // Per-account permission overrides carry officials' email addresses, so they
  // are administrative data: an administrator manages every official's
  // overrides, an official needs only their own, and residents need none.
  const overrides = state.accountOverrides || {};
  const ownEmail = user.email.trim().toLowerCase();
  const accountOverrides =
    user.role === "administrator"
      ? overrides
      : user.role === "official" && Object.hasOwn(overrides, ownEmail)
        ? { [ownEmail]: overrides[ownEmail] }
        : {};
  // Officials handle the concern queue, so they see each resident's basic
  // account card and photo — never phone numbers, working hours, recovery
  // emails, availability, or staff accounts.
  const residentCard = (item) => ({
    id: item.id,
    email: item.email,
    name: item.name,
    area: item.area,
    role: item.role,
    status: item.status,
    photoUrl: item.photoUrl,
    idStatus: item.idStatus || "unverified",
  });
  const users =
    user.role === "administrator"
      ? state.users
      : user.role === "resident"
        ? state.users.filter((item) => item.id === user.id)
        : state.users.filter((item) => item.role === "resident").map(residentCard);
  return {
    ...state,
    accountOverrides,
    users,
    reports: user.role === "resident" ? state.reports.filter((item) => item.userEmail === user.email) : state.reports,
    notifications: state.notifications.filter((item) => item.targetEmail === user.email),
    hotlineCorrections: user.role === "resident" ? [] : state.hotlineCorrections,
    activities: user.role === "administrator" ? state.activities : [],
    recyclingLocations: user.role === "administrator" ? state.recyclingLocations : state.recyclingLocations.filter((item) => item.active),
  };
}
