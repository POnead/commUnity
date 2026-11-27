"use strict";

import { applyResidentSave } from "./resident.mjs";
import { applyOfficialSave } from "./official.mjs";
import { applyAdministratorSave } from "./administrator.mjs";
import { HttpError } from "../../../platform/http.mjs";
import { validateState } from "../validate.mjs";
import { readFullState, stateForRole } from "../read.mjs";
import { readVisibility } from "../../../platform/session.mjs";
import { recordAttempt } from "../../../platform/ratelimit.mjs";
import { hash } from "../../../platform/crypto.mjs";
import { withTransaction } from "../../../platform/db.mjs";

export async function updateState(db, user, body, { smtpFrom, appOrigin } = {}) {
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0)
    throw new HttpError(400, "A valid database revision is required.");
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data.calendarEvents)) body.data.calendarEvents = [];
  validateState(body.data);
  const before = await readFullState(db, user);
  const visibleBefore = stateForRole(before, user);
  const visibility = await readVisibility(db, user);
  // A new concern emails every active official and administrator. A resident may not
  // file more than a few concerns inside one window, bounding staff mail even if the
  // save is refused and rolls back after this point.
  if (user?.role === "resident" && Array.isArray(body.data?.reports)) {
    const known = new Set(visibleBefore.reports.map((report) => report.id));
    const adding = body.data.reports.filter((report) => report && !known.has(report.id)).length;
    // The normal concern flow files one report per request. A save that sneaks
    // several new ones in at once is refused here, before the transaction can
    // insert records, notify staff, or queue mail for each of them.
    if (adding > 1) throw new HttpError(400, "Only one new report can be submitted per request.");
    if (adding) await recordAttempt(db, hash(`report-submit:${user.id}`), 10);
  }
  let nextRevision = 0;
  // Emails are collected here and delivered by the caller only after this
  // transaction commits, so a rolled-back save sends no mail.
  const pendingEmails = [];
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    // Cheap, non-locking check to reject already-stale saves before any write.
    // The commit-time CAS below stays the authority for a real race that moves
    // the revision after this read.
    const current = await db.query("SELECT revision FROM app_meta WHERE id=1");
    if (Number(current.rows[0].revision) !== body.revision)
      throw new HttpError(409, "Data changed in another session. Reload before saving.");
    const after = body.data;
    // Hotlines and their correction requests are written only by their own
    // endpoints, so a workspace save never carries an editable copy of them.
    after.hotlines = visibleBefore.hotlines;
    after.hotlineCorrections = visibleBefore.hotlineCorrections;
    // Data the caller's permissions do not cover was withheld at read time.
    // Give the server's copy of those collections precedence, so a stale or
    // hand-edited echo is preserved as-is instead of read as deletions.
    const reportsReadable = user.role === "resident" ? visibility.submitReports : visibility.manageReports;
    if (!reportsReadable) {
      // A concern id the server does not know in the client's copy is a new
      // submission attempt, which the disabled permission forbids: refuse it
      // rather than silently dropping it.
      if (Array.isArray(after.reports) && after.reports.length) {
        const ids = [...new Set(after.reports.map((report) => report?.id).filter(Boolean))];
        if (ids.length) {
          const existing = await db.query("SELECT id FROM reports WHERE id = ANY($1::text[])", [ids]);
          const known = new Set(existing.rows.map((row) => row.id));
          if (ids.some((id) => !known.has(id)))
            throw new HttpError(
              403,
              user.role === "resident"
                ? "Submitting concerns is not enabled for this role."
                : "Report management is not enabled for this role.",
            );
        }
      }
      after.reports = visibleBefore.reports;
    }
    if (!(user.role === "resident" ? visibility.viewSchedules : visibility.manageSchedules)) after.schedules = visibleBefore.schedules;
    if (user.role !== "resident" && !visibility.manageAnnouncements) {
      after.announcements = visibleBefore.announcements;
      after.calendarEvents = visibleBefore.calendarEvents;
    }
    if (user.role === "administrator" && !visibility.manageUsers) {
      after.users = visibleBefore.users;
      // Inactive recycling listings are withheld at read time; a stale echo may
      // hold them, so preserve the server's copy rather than fail the save.
      after.recyclingLocations = visibleBefore.recyclingLocations;
    }
    if (user.role === "administrator") {
      if (!visibility.viewAudit) {
        // The audit log is append-only server history; the client echo holds only what it can see.
        // Filter out any row that already exists server-side instead of re-inserting it as new.
        const recent = await db.query("SELECT id FROM activities ORDER BY at DESC LIMIT 1000");
        const knownIds = new Set(recent.rows.map((row) => row.id));
        after.activities = (Array.isArray(after.activities) ? after.activities : []).filter((item) => item && !knownIds.has(item.id));
      }
    }

    const ctx = { db, user, body, after, before, visibleBefore, visibility, pendingEmails, smtpFrom, appOrigin };
    if (user.role === "resident") await applyResidentSave(ctx);
    else if (user.role === "official") await applyOfficialSave(ctx);
    else await applyAdministratorSave(ctx);

    // Compare-and-swap at the end: no global row lock is held while the save is
    // computed, and a concurrent writer makes this UPDATE affect no row. The
    // thrown 409 rolls the whole transaction back, and the caller sends no mail.
    const result = await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1 AND revision=$1 RETURNING revision", [body.revision]);
    if (!result.rowCount) throw new HttpError(409, "Data changed in another session. Reload before saving.");
    nextRevision = Number(result.rows[0].revision);
  });
  return { nextRevision, pendingEmails };
}
