"use strict";

import { currentUser, data } from "./state.mjs";
import {
  AREAS,
  COLLECTION_STATUSES,
  DEFAULT_PERMISSIONS,
  MAX_RECURRENCE_OCCURRENCES,
  RECURRENCE_DEFAULT_MONTHS,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_REASON_STATUSES,
} from "../constants.mjs";
import { asDate } from "./format.mjs";

export function locationAreas() {
  return data?.locations?.map((location) => location.area) || AREAS;
}
export function locationAreaLabels() {
  return Object.fromEntries(
    (data?.locations || []).map((location) => [
      location.area,
      `${location.barangay} · ${location.purok}${location.street ? ` · ${location.street}` : ""}`,
    ]),
  );
}
export function residentAreaOptions(barangay = "Palsara") {
  const areas = [
    ...new Set(
      (data?.locations || []).filter((location) => location?.barangay === barangay && location.area).map((location) => location.area),
    ),
  ];
  return areas.length ? areas : AREAS;
}
export function isResidentArea(area, barangay = "Palsara") {
  return residentAreaOptions(barangay).includes(area);
}

export function effectivePermissions(user, dataContext = null) {
  const effectiveData = dataContext || data;
  if (!user || !effectiveData) return {};
  const roleDefaults = effectiveData?.permissions?.[user.role] || {};
  const overrides = effectiveData?.accountOverrides?.[user.email] || {};
  const effective = {};
  for (const id of Object.keys(roleDefaults)) {
    effective[id] = Object.hasOwn(overrides, id) ? Boolean(overrides[id]) : Boolean(roleDefaults[id]);
  }
  return effective;
}

export function emptyState() {
  return {
    version: 1,
    users: [],
    reports: [],
    schedules: [],
    notifications: [],
    activities: [],
    permissions: structuredClone(DEFAULT_PERMISSIONS),
    accountOverrides: {},
    announcements: [],
    calendarEvents: [],
    locations: [],
    recyclingLocations: [],
  };
}

// Merge the browser's own pending changes into a fresh copy of the server
// state for the retry the browser performs when the revision moved while it
// was working. Deliberately small: the client may only grow reports and
// activities (their ids are random), flip its own read flags on notifications,
// and, for residents, change the three own-profile fields the server lets
// residents change. Everything else comes from the server; the PUT
// revalidates all of it.
function byId(items = []) {
  return new Map((items || []).filter(Boolean).map((item) => [item.id, item]));
}

export function mergeStateForRetry(localData, serverData, snapshotData) {
  const merged = structuredClone(serverData);
  const snapshotReports = byId(snapshotData?.reports);
  const localReports = byId(localData?.reports);
  const serverReports = byId(merged.reports);
  for (const [id, report] of localReports) {
    if (!snapshotReports.has(id)) {
      serverReports.set(id, report);
      continue;
    }
    const before = snapshotReports.get(id);
    const server = serverReports.get(id);
    // Keep the user's new status/assignment entries but build on the server's
    // history, so a change another writer already saved is not thrown away.
    if (server && JSON.stringify(before) !== JSON.stringify(report)) {
      const added = (report.history || []).slice((before.history || []).length);
      const history = [...(server.history || []), ...added];
      serverReports.set(id, {
        ...server,
        status: report.status,
        history,
        assignedTo: report.assignedTo,
        updatedAt: history.at(-1)?.at || server.updatedAt,
      });
    }
  }
  merged.reports = [...serverReports.values()];

  const snapshotActivities = byId(snapshotData?.activities);
  const localActivities = byId(localData?.activities);
  const serverActivities = byId(merged.activities);
  for (const [id, item] of localActivities) if (!snapshotActivities.has(id)) serverActivities.set(id, item);
  merged.activities = [...serverActivities.values()];

  // Read flags are the only writable part of a notification the client may touch;
  // take the server's copy and flip read on for items the browser also marked read.
  const localNotifications = byId(localData?.notifications);
  merged.notifications = (merged.notifications || []).map((item) => {
    const local = localNotifications.get(item.id);
    return local && local.read ? { ...item, read: true } : item;
  });

  if (currentUser?.role === "resident") {
    const edited = (localData?.users || []).find((item) => item.id === currentUser?.id);
    const before = (snapshotData?.users || []).find((item) => item.id === currentUser?.id);
    const profileEdited = JSON.stringify(edited || null) !== JSON.stringify(before || null);
    if (edited && profileEdited) {
      merged.users = (merged.users || []).map((item) =>
        item.id === currentUser.id
          ? { ...item, name: edited.name ?? item.name, area: edited.area ?? item.area, phone: edited.phone ?? item.phone }
          : item,
      );
    }
  }
  return merged;
}

// The browser's base snapshot and the server's current state can differ in
// server-owned rows (a collection reminder, a pruned notification) without the
// user's change being stale. Compare everything except notifications to decide
// whether a revision conflict is safe to retry.
export function stateMatchesIgnoringNotifications(left, right) {
  if (!left || !right) return false;
  const { notifications: _left, ...leftRest } = left;
  const { notifications: _right, ...rightRest } = right;
  return JSON.stringify(leftRest) === JSON.stringify(rightRest);
}

export function unreadCount(user = currentUser) {
  if (!user || !data.notifications) return 0;
  return data.notifications.filter((item) => item.targetEmail === user.email && !item.read).length;
}
export function displayReportTitle(report) {
  const title = String(report?.title || "");
  const area = report?.area ? String(report.area) : "";
  const suffix = area ? ` · ${area}` : "";
  return area && title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

export function displayReportId(report) {
  const reference = Number(report?.reference);
  if (Number.isInteger(reference) && reference > 0) return `R-${String(reference).padStart(4, "0")}`;
  // Rows imported before the reference column existed have no number yet; show
  // their stored id rather than an empty cell.
  const value = String(report?.id || (typeof report === "string" ? report : ""));
  const timestampId = value.match(/^R(\d{13})(?:-([a-z0-9]{6}))?$/i);
  if (timestampId) {
    const suffix = timestampId[2] ? `-${timestampId[2].toUpperCase()}` : "";
    return `R-${Number(timestampId[1]).toString(36).toUpperCase()}${suffix}`;
  }
  const match = value.match(/^R(?:PT-\d{4}-)?(\d+)$/i);
  return match ? `R${String(Number(match[1])).padStart(2, "0")}` : value;
}

// Stored notification/activity text can contain an older opaque concern id.
// Show the current reference on screen instead of rewriting that history.
export function displayReferenceText(text, replacements) {
  let value = String(text || "");
  const map =
    replacements || new Map((data.reports || []).filter((report) => report?.id).map((report) => [report.id, displayReportId(report)]));
  for (const [id, reference] of map) {
    if (id && reference && reference !== id && value.includes(id)) value = value.split(id).join(reference);
  }
  return value;
}

export function getUser(email) {
  return data.users.find((user) => user.email === email);
}

export function getReport(id) {
  return data.reports.find((report) => report.id === id);
}

export function userReports(user = currentUser) {
  return data.reports.filter((report) => report.userEmail === user?.email);
}

export function sortedReports(reports = data.reports) {
  return [...reports].sort((a, b) => asDate(b.submittedAt) - asDate(a.submittedAt));
}

export function sortedSchedules(schedules = data.schedules) {
  return [...schedules].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

export function scheduleDateValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error("Choose a valid collection date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error("Choose a valid collection date.");
  }
  return parsed;
}

export function addMonthsUtc(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function scheduleClockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 1 || hours > 12 || minutes > 59) return -1;
  return (hours % 12) * 60 + minutes + (match[3].toUpperCase() === "PM" ? 720 : 0);
}

export function scheduleStatusEntry(
  previous,
  { status, note = "", date, start, end, at = new Date().toISOString(), actorName = "", actorRole = "" } = {},
) {
  if (!COLLECTION_STATUSES.includes(status)) throw new Error("Choose a valid collection status.");
  if (previous && previous.status === status) return null;
  const reason = String(note || "").trim();
  if (SCHEDULE_REASON_STATUSES.includes(status) && !reason) {
    throw new Error(`${status} collections need an explanation residents can read.`);
  }
  let replacement = { date: null, start: null, end: null };
  if (status === "Rescheduled") {
    const replacementDate = String(date || "").trim();
    const replacementStart = String(start || "").trim();
    const replacementEnd = String(end || "").trim();
    if (!replacementDate) throw new Error("Enter the replacement pickup date.");
    scheduleDateValue(replacementDate);
    const startMinutes = scheduleClockMinutes(replacementStart);
    const endMinutes = scheduleClockMinutes(replacementEnd);
    if (startMinutes < 0 || endMinutes < 0 || endMinutes <= startMinutes) {
      throw new Error("Enter a valid replacement pickup time such as 6:00 AM, with the end time later.");
    }
    if (previous && replacementDate === previous.date && replacementStart === previous.start && replacementEnd === previous.end) {
      throw new Error("Change the pickup date or time so residents can see the replacement.");
    }
    replacement = { date: replacementDate, start: replacementStart, end: replacementEnd };
  }
  return {
    previousStatus: previous?.status || null,
    status,
    at,
    actorName,
    actorRole,
    note: reason || (previous ? `Collection marked ${status.toLowerCase()}.` : "Collection scheduled."),
    previousDate: previous?.date || null,
    previousStart: previous?.start || null,
    previousEnd: previous?.end || null,
    replacementDate: replacement.date,
    replacementStart: replacement.start,
    replacementEnd: replacement.end,
  };
}

export function scheduleOccurrenceDates(startDate, frequency, endDate = null) {
  if (!SCHEDULE_FREQUENCIES.includes(frequency)) throw new Error("Choose a valid collection frequency.");
  const start = scheduleDateValue(startDate);
  if (frequency === "One-time") return [startDate];
  let end;
  if (endDate) {
    end = scheduleDateValue(endDate);
    if (end < start) throw new Error("The repeat-until date must be on or after the first collection date.");
  } else {
    end = new Date(addMonthsUtc(start, RECURRENCE_DEFAULT_MONTHS).getTime() - 86400000);
  }
  const stepDays = frequency === "Weekly" ? 7 : frequency === "Bi-weekly" ? 14 : 0;
  const dates = [];
  for (let index = 0; ; index += 1) {
    const candidate = stepDays ? new Date(start.getTime() + index * stepDays * 86400000) : addMonthsUtc(start, index);
    if (candidate > end) break;
    if (dates.length >= MAX_RECURRENCE_OCCURRENCES) throw new Error("Choose a repeat-until date within five years.");
    dates.push(candidate.toISOString().slice(0, 10));
  }
  return dates;
}

export function sortedNotifications(items = data.notifications || []) {
  return [...items].sort((a, b) => asDate(b.createdAt) - asDate(a.createdAt));
}
