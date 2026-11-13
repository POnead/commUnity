import { HttpError, requireJsonBody, sendJson } from "../platform/http.mjs";
import { MAX_STATE_BYTES } from "../platform/constants.mjs";
import { hasPermission, publicUser, requireRole, getSessionUser } from "../platform/session.mjs";
import {
  assertKnownArea,
  jsonEqual,
  validId,
  validateAccount,
  validateAvailableDays,
  validateWorkingHours,
} from "../platform/validate.mjs";
import { ROLES, PERMISSIONS } from "../platform/roles.mjs";
import { timestamp } from "../platform/time.mjs";
import { queueEmail } from "../platform/email.mjs";
import { withTransaction } from "../platform/db.mjs";
import { comparableReport } from "./service-targets.mjs";
import { REPORT_TRANSITIONS, insertReport, replaceReport, validateReport } from "./reports.mjs";
import { syncSchedules } from "./schedules.mjs";
import { syncLocations, syncRecyclingLocations } from "./locations.mjs";
import { syncNotifications, insertNotification, validateNotificationsReadOnly } from "./notifications.mjs";
import { syncActivities } from "./activity.mjs";

export function validateState(data) {
  if (
    !data ||
    Array.isArray(data) ||
    data.version !== 1 ||
    !["users", "reports", "schedules", "notifications", "activities", "announcements", "locations", "recyclingLocations"].every((key) =>
      Array.isArray(data[key]),
    ) ||
    !data.permissions ||
    typeof data.permissions !== "object" ||
    Array.isArray(data.permissions) ||
    data.users.length > 10000 ||
    data.reports.length > 10000 ||
    data.schedules.length > 10000 ||
    data.notifications.length > 100000 ||
    data.activities.length > 100000 ||
    data.announcements.length > 1000 ||
    data.locations.length > 1000 ||
    data.recyclingLocations.length > 1000 ||
    (Array.isArray(data.calendarEvents) && data.calendarEvents.length > 1000)
  ) {
    throw new HttpError(400, "CommUnity data is invalid or exceeds supported limits.");
  }
  // Keep the accepted state shape inside the body limit enforced by the HTTP layer.
  // The report count above is sized for this ceiling, so a save fails with a clear
  // message here instead of an unexplained 413 at the parser.
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_STATE_BYTES) {
    throw new HttpError(413, "The portal state is larger than the 32 MB save limit. Export or archive old records before saving.");
  }
  if (
    data.reports.some((report) => !report || !validId(report.id)) ||
    new Set(data.reports.map((report) => report.id)).size !== data.reports.length
  ) {
    throw new HttpError(400, "Report identifiers must be valid and unique.");
  }
  if (
    data.schedules.some((schedule) => !schedule || !validId(schedule.id)) ||
    new Set(data.schedules.map((schedule) => schedule.id)).size !== data.schedules.length
  ) {
    throw new HttpError(400, "Schedule identifiers must be valid and unique.");
  }
  if (data.accountOverrides !== undefined) {
    if (!data.accountOverrides || typeof data.accountOverrides !== "object" || Array.isArray(data.accountOverrides)) {
      throw new HttpError(400, "Account permission overrides are invalid.");
    }
    for (const [email, overrides] of Object.entries(data.accountOverrides)) {
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !overrides ||
        typeof overrides !== "object" ||
        Array.isArray(overrides) ||
        Object.entries(overrides).some(
          ([permission, enabled]) => typeof enabled !== "boolean" || !Object.hasOwn(PERMISSIONS.official, permission),
        )
      ) {
        throw new HttpError(400, "Account permission overrides are invalid.");
      }
    }
  }
}

export function makeDefaultState() {
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

export async function readFullState(db, user = null) {
  const state = makeDefaultState();
  if (!user || user.role === "administrator") {
    const users = user
      ? await db.query(
          'SELECT id, email, name, area, phone, role, status, working_hours AS "workingHours", available_days AS "availableDays", requires_password_change AS "requiresPasswordChange", deactivation_reason AS "deactivationReason", recovery_email AS "recoveryEmail", reset_requested AS "resetRequested", photo_url AS "photoUrl", to_char(joined_at, \'YYYY-MM-DD\') AS "joinedAt" FROM users WHERE id <> $1 ORDER BY joined_at, email',
          [user.id],
        )
      : await db.query(
          'SELECT id, email, name, area, phone, role, status, working_hours AS "workingHours", available_days AS "availableDays", requires_password_change AS "requiresPasswordChange", deactivation_reason AS "deactivationReason", recovery_email AS "recoveryEmail", reset_requested AS "resetRequested", photo_url AS "photoUrl", to_char(joined_at, \'YYYY-MM-DD\') AS "joinedAt" FROM users ORDER BY joined_at, email',
        );
    state.users = users.rows;
  } else if (user.role === "resident") {
    const users = await db.query(
      'SELECT id, email, name, area, phone, role, status, working_hours AS "workingHours", available_days AS "availableDays", requires_password_change AS "requiresPasswordChange", photo_url AS "photoUrl", to_char(joined_at, \'YYYY-MM-DD\') AS "joinedAt" FROM users WHERE id=$1',
      [user.id],
    );
    state.users = users.rows;
  }

  const reports = await db.query(
    `
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
  `,
    user?.role === "resident" ? [user.email] : [],
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
    SELECT id, title, detail, to_char(date, 'YYYY-MM-DD') AS date, approval_status AS "approvalStatus", decline_reason AS "declineReason",
      is_event AS "isEvent", latitude, longitude
    FROM announcements
    ${user && user.role === "resident" ? "WHERE approval_status='approved'" : ""}
    ORDER BY date DESC, id DESC
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
    "SELECT id, area, barangay, street, purok, landmark FROM community_locations ORDER BY barangay, purok, street, id",
  );
  state.locations = locations.rows;
  const recyclingLocations = await db.query(`
    SELECT id, name, barangay, street, purok, landmark, materials, phone, hours, active
    FROM recycling_locations ${user && user.role !== "administrator" ? "WHERE active=true" : ""}
    ORDER BY active DESC, name
  `);
  state.recyclingLocations = recyclingLocations.rows;
  return state;
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
  return {
    ...state,
    accountOverrides,
    users: user.role === "administrator" ? state.users : user.role === "resident" ? state.users.filter((item) => item.id === user.id) : [],
    reports: user.role === "resident" ? state.reports.filter((item) => item.userEmail === user.email) : state.reports,
    notifications: state.notifications.filter((item) => item.targetEmail === user.email),
    activities: user.role === "administrator" ? state.activities : [],
    recyclingLocations: user.role === "administrator" ? state.recyclingLocations : state.recyclingLocations.filter((item) => item.active),
  };
}

async function updateState(db, user, body, { mailer, smtpFrom, appOrigin } = {}) {
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0)
    throw new HttpError(400, "A valid database revision is required.");
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data.calendarEvents)) body.data.calendarEvents = [];
  validateState(body.data);
  const before = await readFullState(db, user);
  const visibleBefore = stateForRole(before, user);
  let nextRevision = 0;
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    const revision = await db.query("SELECT revision FROM app_meta WHERE id=1 FOR UPDATE");
    if (Number(revision.rows[0].revision) !== body.revision)
      throw new HttpError(409, "Data changed in another session. Reload before saving.");
    const after = body.data;
    if (user.role === "resident") {
      requireRole(user, ["resident"]);
      if (after.users.length !== 1 || after.users[0].id !== user.id)
        throw new HttpError(403, "Residents can only update their own account.");
      const oldAccount = visibleBefore.users[0];
      const nextAccount = after.users[0];
      const immutableAccount = ({ name, area, phone, ...account }) => account;
      if (!jsonEqual(immutableAccount(oldAccount), immutableAccount(nextAccount)))
        throw new HttpError(403, "Residents cannot change account access or sign-in details.");
      validateAccount(nextAccount);
      for (const oldReport of visibleBefore.reports) {
        const incoming = after.reports.find((report) => report.id === oldReport.id);
        if (!incoming || !jsonEqual(comparableReport(oldReport), comparableReport(incoming)))
          throw new HttpError(403, "Existing reports cannot be changed by residents.");
      }
      const addedReports = after.reports.filter((report) => !visibleBefore.reports.some((old) => old.id === report.id));
      for (const report of addedReports) {
        validateReport(report);
        if (!report.barangay?.trim() || !report.locationDetail?.trim()) {
          throw new HttpError(400, "A new report must include its barangay and street or landmark.");
        }
        await assertKnownArea(db, report.area, report.barangay || "");
        if (
          report.userEmail !== user.email ||
          report.status !== "Submitted" ||
          report.history.length !== 1 ||
          report.history[0].status !== "Submitted"
        ) {
          throw new HttpError(403, "Residents can only submit a new report for their own account.");
        }
      }
      if (
        !jsonEqual(visibleBefore.schedules, after.schedules) ||
        !jsonEqual(visibleBefore.permissions, after.permissions) ||
        !jsonEqual(visibleBefore.accountOverrides || {}, after.accountOverrides || {}) ||
        !jsonEqual(visibleBefore.announcements, after.announcements) ||
        !jsonEqual(visibleBefore.calendarEvents, after.calendarEvents) ||
        !jsonEqual(visibleBefore.locations, after.locations) ||
        !jsonEqual(visibleBefore.recyclingLocations, after.recyclingLocations)
      )
        throw new HttpError(403, "You cannot change shared workspace data.");
      validateNotificationsReadOnly(visibleBefore.notifications, after.notifications, user);
      if (nextAccount.area.trim() !== oldAccount.area.trim()) await assertKnownArea(db, nextAccount.area);
      await db.query("UPDATE users SET name=$1, area=$2, phone=$3 WHERE id=$4", [
        nextAccount.name.trim(),
        nextAccount.area.trim(),
        nextAccount.phone.trim(),
        user.id,
      ]);
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
        for (const account of staff.rows)
          await insertNotification(
            db,
            account.email,
            report.urgent ? `Urgent concern: ${report.title}` : `New concern: ${report.title}`,
            `${report.name} submitted a report for ${report.barangay}, ${report.area}, near ${report.locationDetail}.`,
            report.id,
          );
        for (const account of staff.rows)
          queueEmail(mailer, {
            from: smtpFrom,
            to: account.email,
            subject: report.urgent ? `Urgent concern: ${report.title}` : `New concern: ${report.title}`,
            text: `${report.name} submitted a report for ${report.barangay}, ${report.area}, near ${report.locationDetail}.\n\nReview it in CommUnity: ${appOrigin || ""}/#/official/concerns`,
          });
        await insertNotification(
          db,
          user.email,
          "Report submitted",
          `Your concern ${report.id} was submitted and is now on file.`,
          report.id,
        );
      }
    } else if (user.role === "official") {
      if (
        after.users.length ||
        !jsonEqual(visibleBefore.permissions, after.permissions) ||
        !jsonEqual(visibleBefore.accountOverrides || {}, after.accountOverrides || {}) ||
        !jsonEqual(visibleBefore.announcements, after.announcements) ||
        !jsonEqual(visibleBefore.calendarEvents, after.calendarEvents) ||
        !jsonEqual(visibleBefore.locations, after.locations) ||
        !jsonEqual(visibleBefore.recyclingLocations, after.recyclingLocations)
      )
        throw new HttpError(403, "Officials cannot change accounts, locations, or announcements.");
      requireRole(user, ["official"]);
      if (!(await hasPermission(db, user, "manageReports")) && !jsonEqual(visibleBefore.reports, after.reports)) {
        throw new HttpError(403, "Report management is not enabled for this role.");
      }
      if (!(await hasPermission(db, user, "manageSchedules")) && !jsonEqual(visibleBefore.schedules, after.schedules)) {
        throw new HttpError(403, "Schedule management is not enabled for this role.");
      }
      if (after.reports.length !== visibleBefore.reports.length)
        throw new HttpError(403, "Officials cannot add or remove resident reports.");
      for (const oldReport of visibleBefore.reports) {
        const incoming = after.reports.find((report) => report.id === oldReport.id);
        if (!incoming) throw new HttpError(403, "Officials cannot remove resident reports.");
        if (!jsonEqual(comparableReport(oldReport), comparableReport(incoming))) {
          const previousCore = comparableReport(oldReport, true);
          const incomingCore = comparableReport(incoming, true);
          const assignmentChanged = !jsonEqual(oldReport.assignedTo, incoming.assignedTo);
          const statusChanged =
            incoming.status !== oldReport.status ||
            incoming.updatedAt !== oldReport.updatedAt ||
            !jsonEqual(oldReport.history, incoming.history);
          const validStatusUpdate =
            statusChanged &&
            incoming.history.length === oldReport.history.length + 1 &&
            jsonEqual(oldReport.history, incoming.history.slice(0, -1)) &&
            incoming.history.at(-1).status === incoming.status &&
            incoming.history.at(-1).at === incoming.updatedAt;
          if (!jsonEqual(previousCore, incomingCore) || (statusChanged && !validStatusUpdate) || (!assignmentChanged && !statusChanged)) {
            throw new HttpError(403, "Officials may only claim or release an assignment and add a report status update.");
          }
          if (statusChanged) {
            const allowed = REPORT_TRANSITIONS[oldReport.status] ?? [];
            if (!allowed.includes(incoming.status)) {
              throw new HttpError(
                403,
                `Concerns cannot move from ${oldReport.status} to ${incoming.status} directly. Follow the review path: Submitted → Under Review → In Progress → Resolved.`,
              );
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
            if (!claiming && !releasing)
              throw new HttpError(403, "Officials can only claim unassigned concerns or release their own assignment.");
            if (claiming) {
              const official = await db.query("SELECT id, name FROM users WHERE id=$1 AND role='official' AND status='Active'", [user.id]);
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
            await insertNotification(
              db,
              incoming.userEmail,
              `Report ${incoming.status.toLowerCase()}`,
              `${incoming.id}: ${incoming.history.at(-1).note || `Your concern is now ${incoming.status.toLowerCase()}.`}`,
              incoming.id,
            );
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
        const availableDays =
          account.availableDays === undefined
            ? Array.isArray(old.availableDays) && old.availableDays.length
              ? validateAvailableDays(old.availableDays)
              : validateAvailableDays()
            : validateAvailableDays(account.availableDays);
        if (
          account.role === "official" &&
          (account.role !== old.role || account.workingHours !== old.workingHours || !jsonEqual(availableDays, old.availableDays))
        ) {
          validateWorkingHours(account.workingHours);
        }
        if (account.role === "resident" && (account.role !== old.role || account.area !== old.area)) {
          await assertKnownArea(db, account.area);
        }
        if (old.id === user.id && (account.email !== old.email || account.role !== "administrator" || account.status !== "Active")) {
          throw new HttpError(403, "You cannot change your own administrator sign-in or access.");
        }
        if (account.status !== old.status) {
          throw new HttpError(
            403,
            "Account status cannot be changed through the account editor. Deactivate or reactivate the account from the user list instead.",
          );
        }
        await db.query(
          "UPDATE users SET email=$1,name=$2,area=$3,phone=$4,role=$5,status=$6,working_hours=$7,available_days=$8::jsonb WHERE id=$9",
          [
            account.email.trim().toLowerCase(),
            account.name.trim(),
            account.area.trim(),
            account.phone.trim(),
            account.role,
            account.status,
            String(account.workingHours || "Monday-Friday, 8:00 AM-5:00 PM").trim(),
            JSON.stringify(availableDays),
            account.id,
          ],
        );
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
      if (!jsonEqual(before.announcements, after.announcements))
        throw new HttpError(403, "Announcements cannot be changed through this workspace.");
      if (!jsonEqual(before.calendarEvents, after.calendarEvents))
        throw new HttpError(403, "Calendar events cannot be changed through this workspace.");
      await syncNotifications(db, visibleBefore.notifications, after.notifications, user);
      for (const role of ROLES) {
        if (!after.permissions[role] || typeof after.permissions[role] !== "object")
          throw new HttpError(400, "Role permissions are invalid.");
        if (Object.keys(after.permissions[role]).length !== Object.keys(PERMISSIONS[role]).length) {
          throw new HttpError(400, "Role permissions are incomplete.");
        }
        for (const [permission, enabled] of Object.entries(after.permissions[role])) {
          if (typeof enabled !== "boolean" || !Object.hasOwn(PERMISSIONS[role], permission))
            throw new HttpError(400, "Role permissions are invalid.");
          await db.query(
            "INSERT INTO role_permissions(role,permission,enabled) VALUES($1,$2,$3) ON CONFLICT(role,permission) DO UPDATE SET enabled=excluded.enabled",
            [role, permission, enabled],
          );
        }
      }
      const nextOverrides = after.accountOverrides || {};
      const beforeAccounts = new Map(before.users.map((account) => [account.id, account]));
      const officialEmails = new Set(
        after.users.filter((account) => account.role === "official").map((account) => account.email.trim().toLowerCase()),
      );
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
      if (!capableAdmins.rows.length)
        throw new HttpError(400, "Keep at least one active administrator with both account and role management enabled.");
      await syncActivities(db, before.activities, after.activities, user);
    }
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    nextRevision = Number(revision.rows[0].revision) + 1;
  });
  return nextRevision;
}

export async function handleState(request, response, db, options, user) {
  // TODO(maintainer): `mailer` and `smtpFrom` were never present in options here,
  // so resident notifications from a /api/state save have only ever been inserted
  // in-app while queueEmail silently no-ops. Left exactly as the previous behavior;
  // wire mailerState here deliberately if status-change emails should actually send.
  const { mailer, smtpFrom, appOrigin } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/state/revision" && request.method === "GET") {
    // Cheap live-update check: browsers poll this instead of the full state and
    // only fetch /api/state when the revision actually moved.
    requireRole(user, ROLES);
    const revision = await db.query("SELECT revision FROM app_meta WHERE id=1");
    sendJson(response, 200, { revision: Number(revision.rows[0].revision) });
    return true;
  }
  if (url.pathname === "/api/state" && request.method === "GET") {
    requireRole(user, ROLES);
    const [state, revision] = await Promise.all([readFullState(db, user), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 200, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return true;
  }
  if (url.pathname === "/api/state" && request.method === "PUT") {
    requireRole(user, ROLES);
    requireJsonBody(request);
    const body = request.body;
    const revision = await updateState(db, user, body, { mailer, smtpFrom, appOrigin });
    const currentUser = await getSessionUser(request, db);
    const state = await readFullState(db, currentUser);
    sendJson(response, 200, { revision, data: stateForRole(state, currentUser), user: publicUser(currentUser) });
    return true;
  }
  return false;
}
