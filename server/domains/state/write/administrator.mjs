"use strict";

import { hasPermission, requireRole } from "../../../platform/session.mjs";
import { assertKnownArea, jsonEqual, validateAccount, validateAvailableDays, validateWorkingHours } from "../../../platform/validate.mjs";
import { HttpError } from "../../../platform/http.mjs";
import { comparableReport } from "../../service-targets.mjs";
import { insertActivity, syncActivities } from "../../activity.mjs";
import { replaceReport } from "../../reports.mjs";
import { syncSchedules } from "../../schedules.mjs";
import { syncLocations, syncRecyclingLocations } from "../../locations.mjs";
import { syncNotifications } from "../../notifications.mjs";
import { PERMISSIONS, ROLES } from "../../../platform/roles.mjs";

export async function applyAdministratorSave({ after, before, db, user, visibility, visibleBefore }) {
  requireRole(user, ["administrator"]);
  // Hiding a restricted page or button is not access control. An administrator
  // whose permission has been disabled must not change that workspace area,
  // even with a hand-crafted request. The comparisons run before any write.
  const beforeUsersById = new Map(before.users.map((account) => [account.id, account]));
  const accountsChanged =
    after.users.length !== before.users.length ||
    after.users.some((account) => {
      const old = beforeUsersById.get(account.id);
      return !old || !jsonEqual(old, account);
    });
  if (accountsChanged && !(await hasPermission(db, user, "manageUsers")))
    throw new HttpError(403, "Account management is not enabled for this role.");
  const beforeReportsById = new Map(before.reports.map((report) => [report.id, report]));
  const reportsChanged =
    after.reports.length !== before.reports.length ||
    after.reports.some((report) => {
      const old = beforeReportsById.get(report.id);
      return !old || !jsonEqual(comparableReport(old), comparableReport(report));
    });
  if (reportsChanged && !(await hasPermission(db, user, "manageReports")))
    throw new HttpError(403, "Report management is not enabled for this role.");
  if (!jsonEqual(before.schedules, after.schedules) && !(await hasPermission(db, user, "manageSchedules")))
    throw new HttpError(403, "Schedule management is not enabled for this role.");
  const locationsChanged = !jsonEqual(before.locations, after.locations) || !jsonEqual(before.recyclingLocations, after.recyclingLocations);
  if (locationsChanged && !(await hasPermission(db, user, "manageUsers")))
    throw new HttpError(403, "Location and directory settings are bundled with account management for this role.");
  const permissionsChanged =
    !jsonEqual(before.permissions, after.permissions) || !jsonEqual(before.accountOverrides || {}, after.accountOverrides || {});
  if (permissionsChanged && !(await hasPermission(db, user, "manageRoles")))
    throw new HttpError(403, "Role management is not enabled for this role.");
  if (visibility.manageUsers) {
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
      if (!jsonEqual(old, account)) {
        await insertActivity(db, user, "Updated user account", `${account.name.trim()} · ${account.role}`);
      }
    }
    const activeAdmins = await db.query("SELECT count(*)::integer AS count FROM users WHERE role='administrator' AND status='Active'");
    if (Number(activeAdmins.rows[0].count) < 1) throw new HttpError(400, "At least one active administrator must remain.");
  }
  const adminAfterReportsById = new Map(after.reports.map((report) => [report.id, report]));
  for (const old of before.reports) {
    const incoming = adminAfterReportsById.get(old.id);
    if (!incoming) throw new HttpError(403, "Reports cannot be deleted from the administrator workspace.");
    if (incoming.userEmail !== old.userEmail) {
      throw new HttpError(403, "Report ownership cannot be changed through the administrator workspace.");
    }
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
    const old = beforeReportsById.get(report.id);
    if (!old) throw new HttpError(403, "Reports can only be created through the concern form.");
    if (jsonEqual(comparableReport(old), comparableReport(report))) continue;
    await replaceReport(db, report);
  }
  await syncSchedules(db, before.schedules, after.schedules, user);
  await syncLocations(db, before.locations, after.locations, user);
  await syncRecyclingLocations(db, before.recyclingLocations, after.recyclingLocations, user);
  if (!jsonEqual(before.announcements, after.announcements))
    throw new HttpError(403, "Announcements cannot be changed through this workspace.");
  if (!jsonEqual(before.calendarEvents, after.calendarEvents))
    throw new HttpError(403, "Calendar events cannot be changed through this workspace.");
  await syncNotifications(db, visibleBefore.notifications, after.notifications, user);
  const changedPermissions = [];
  for (const role of ROLES) {
    if (!after.permissions[role] || typeof after.permissions[role] !== "object") throw new HttpError(400, "Role permissions are invalid.");
    if (Object.keys(after.permissions[role]).length !== Object.keys(PERMISSIONS[role]).length) {
      throw new HttpError(400, "Role permissions are incomplete.");
    }
    for (const [permission, enabled] of Object.entries(after.permissions[role])) {
      if (typeof enabled !== "boolean" || !Object.hasOwn(PERMISSIONS[role], permission))
        throw new HttpError(400, "Role permissions are invalid.");
      if (before.permissions?.[role]?.[permission] !== enabled) changedPermissions.push([role, permission, enabled]);
    }
  }
  for (const [role, permission, enabled] of changedPermissions) {
    await db.query(
      "INSERT INTO role_permissions(role,permission,enabled) VALUES($1,$2,$3) ON CONFLICT(role,permission) DO UPDATE SET enabled=excluded.enabled",
      [role, permission, enabled],
    );
    await insertActivity(db, user, "Changed role permission", `${role} · ${permission}`);
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
  await syncActivities(db, before.activities, after.activities);
}
