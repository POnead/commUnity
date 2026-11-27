"use strict";

import { HttpError } from "../../platform/http.mjs";
import { MAX_STATE_BYTES } from "../../platform/constants.mjs";
import { validId } from "../../platform/validate.mjs";
import { PERMISSIONS } from "../../platform/roles.mjs";

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
    data.users.length > 2000 ||
    data.reports.length > 2000 ||
    data.schedules.length > 2000 ||
    data.notifications.length > 10000 ||
    data.activities.length > 1000 ||
    data.announcements.length > 1000 ||
    data.locations.length > 1000 ||
    data.recyclingLocations.length > 1000 ||
    (Array.isArray(data.calendarEvents) && data.calendarEvents.length > 1000) ||
    (Array.isArray(data.hotlines) && data.hotlines.length > 1000) ||
    (Array.isArray(data.hotlineCorrections) && data.hotlineCorrections.length > 1000)
  ) {
    throw new HttpError(400, "CommUnity data is invalid or exceeds supported limits.");
  }
  // Keep the accepted state shape inside the body limit enforced by the HTTP layer.
  // Exact worst-case math is impractical (per-item text caps still allow large
  // values), so the array caps above are deliberately conservative and the read
  // side bounds report detail to the newest 50 history / 3 photos per report.
  // This byte check is the final guard: a save fails with a clear message here
  // instead of an unexplained 413 at the parser.
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
    verificationQueue: [],
    announcements: [],
    calendarEvents: [],
    locations: [],
    recyclingLocations: [],
    hotlines: [],
    hotlineCorrections: [],
  };
}
