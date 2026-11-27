"use strict";

import { hasPermission, requireRole } from "../../../platform/session.mjs";
import { HttpError } from "../../../platform/http.mjs";
import { assertKnownArea, jsonEqual, validateAccount } from "../../../platform/validate.mjs";
import { comparableReport } from "../../service-targets.mjs";
import { insertReport, notifyStaff, reportReference, validateReport } from "../../reports.mjs";
import { insertNotification, syncNotifications, validateNotificationsReadOnly } from "../../notifications.mjs";
import { insertActivity, syncActivities } from "../../activity.mjs";
import { buildNewConcernEmail } from "../../../platform/email-template.mjs";

export async function applyResidentSave({ after, appOrigin, db, pendingEmails, smtpFrom, user, visibleBefore }) {
  requireRole(user, ["resident"]);
  if (after.users.length !== 1 || after.users[0].id !== user.id) throw new HttpError(403, "Residents can only update their own account.");
  const oldAccount = visibleBefore.users[0];
  const nextAccount = after.users[0];
  const immutableAccount = ({ name, area, phone, ...account }) => account;
  if (!jsonEqual(immutableAccount(oldAccount), immutableAccount(nextAccount)))
    throw new HttpError(403, "Residents cannot change account access or sign-in details.");
  validateAccount(nextAccount);
  const afterReportsById = new Map(after.reports.map((report) => [report.id, report]));
  for (const oldReport of visibleBefore.reports) {
    const incoming = afterReportsById.get(oldReport.id);
    if (!incoming || !jsonEqual(comparableReport(oldReport), comparableReport(incoming)))
      throw new HttpError(403, "Existing reports cannot be changed by residents.");
  }
  const visibleReportIds = new Set(visibleBefore.reports.map((report) => report.id));
  const addedReports = after.reports.filter((report) => !visibleReportIds.has(report.id));
  if (addedReports.length && !(await hasPermission(db, user, "submitReports"))) {
    throw new HttpError(403, "Submitting concerns is not enabled for this role.");
  }
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
  await syncActivities(db, visibleBefore.activities, after.activities);
  for (const report of addedReports) {
    report.name = nextAccount.name;
    if (report.assignedTo) throw new HttpError(403, "New reports cannot be assigned by residents.");
    report.assignedTo = null;
    report.history[0].actorName = nextAccount.name;
    report.history[0].actorRole = "resident";
    await insertReport(db, report);
    const staff = await db.query("SELECT email FROM users WHERE role IN ('official','administrator') AND status='Active'");
    await notifyStaff(
      db,
      report.urgent ? `Urgent concern: ${report.title}` : `New concern: ${report.title}`,
      `${report.name} submitted a report for ${report.barangay}, ${report.area}, near ${report.locationDetail}.`,
      report.id,
    );
    const concernMail = buildNewConcernEmail({
      name: report.name,
      category: report.category,
      title: report.title,
      barangay: report.barangay,
      area: report.area,
      locationDetail: report.locationDetail,
      priority: report.priority,
      reportId: reportReference(report.reference),
      description: report.description,
      urgent: report.urgent,
      appOrigin,
    });
    for (const account of staff.rows)
      pendingEmails.push({
        from: smtpFrom,
        to: account.email,
        subject: concernMail.subject,
        text: concernMail.text,
        html: concernMail.html,
      });
    await insertNotification(
      db,
      user.email,
      "Report submitted",
      `Your concern ${reportReference(report.reference)} was submitted and is now on file.`,
      report.id,
    );
    await insertActivity(
      db,
      user,
      report.urgent ? "Submitted an urgent concern" : "Submitted a concern",
      `${reportReference(report.reference)} · ${report.title}`,
    );
  }
}
