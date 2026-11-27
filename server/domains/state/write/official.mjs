"use strict";

import { jsonEqual } from "../../../platform/validate.mjs";
import { HttpError } from "../../../platform/http.mjs";
import { hasPermission, requireRole } from "../../../platform/session.mjs";
import { comparableReport } from "../../service-targets.mjs";
import { REPORT_TRANSITIONS, replaceReport, reportReference } from "../../reports.mjs";
import { insertActivity, syncActivities } from "../../activity.mjs";
import { insertNotification, syncNotifications } from "../../notifications.mjs";
import { buildReportStatusEmail } from "../../../platform/email-template.mjs";
import { syncSchedules } from "../../schedules.mjs";

export async function applyOfficialSave({ after, appOrigin, db, pendingEmails, smtpFrom, user, visibleBefore }) {
  // Officials are never allowed to change accounts, so the client's copy of
  // the account list is discarded and rebuilt from the fresh database read.
  // That way a stale or hand-edited echo can't block a legitimate update.
  after.users = visibleBefore.users;
  if (
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
  if (after.reports.length !== visibleBefore.reports.length) throw new HttpError(403, "Officials cannot add or remove resident reports.");
  const afterReportsById = new Map(after.reports.map((report) => [report.id, report]));
  for (const oldReport of visibleBefore.reports) {
    const incoming = afterReportsById.get(oldReport.id);
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
        if (note.length > 400) throw new HttpError(400, "An update note must be 400 characters or fewer.");
      }
      // The server owns the update clock. The browser may ask for a status
      // change, but it cannot say when it happened, so the recorded first
      // response, the recorded resolution, the status entry, and the update
      // itself are all stamped with the server's own time.
      const updateAt = new Date().toISOString();
      // Every accepted official update — a claim, a release or a status
      // change — gets the server's clock, not just a status change.
      incoming.updatedAt = updateAt;
      if (statusChanged) {
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
      // replaceReport owns validation: it tolerates unchanged legacy text
      // beyond the current description cap before re-validating the report.
      await replaceReport(db, incoming);
      const ref = reportReference(oldReport.reference ?? incoming.reference);
      if (assignmentChanged) {
        await insertActivity(db, user, incoming.assignedTo ? "Claimed a concern" : "Released a concern", `${ref} · ${incoming.title}`);
      }
      if (validStatusUpdate) {
        await insertActivity(db, user, "Updated a report", `${ref} · ${incoming.status}`);
        await insertNotification(
          db,
          incoming.userEmail,
          `Report ${incoming.status.toLowerCase()}`,
          `${ref}: ${incoming.history.at(-1).note || `Your concern is now ${incoming.status.toLowerCase()}.`}`,
          incoming.id,
        );
        const statusMail = buildReportStatusEmail({
          reportId: ref,
          status: incoming.status,
          category: incoming.category,
          barangay: incoming.barangay,
          area: incoming.area,
          locationDetail: incoming.locationDetail,
          note: incoming.history.at(-1).note,
          appOrigin,
        });
        pendingEmails.push({
          from: smtpFrom,
          to: incoming.userEmail,
          subject: statusMail.subject,
          text: statusMail.text,
          html: statusMail.html,
        });
      }
    }
  }
  await syncSchedules(db, visibleBefore.schedules, after.schedules, user);
  await syncNotifications(db, visibleBefore.notifications, after.notifications, user);
  await syncActivities(db, visibleBefore.activities, after.activities);
}
