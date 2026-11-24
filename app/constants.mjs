import { PALSARA_CENTER, PALSARA_DEFAULT_ZOOM, PALSARA_BOUNDS } from "../shared/community-map.mjs";

export { PALSARA_CENTER, PALSARA_DEFAULT_ZOOM, PALSARA_BOUNDS };
export { HOTLINE_CATEGORIES, HOTLINE_STATUSES, HOTLINE_STATUS_LABELS } from "../shared/hotlines.mjs";
export {
  ID_TYPE_LABELS,
  REPORT_TRANSITIONS,
  RESPONSE_DEADLINE_DAYS,
  FOLLOW_UP_LIMITS,
  DEFAULT_PERMISSIONS,
} from "../shared/domain-rules.mjs";

// Every calendar day shown or validated in the interface is the barangay's day,
// not the day of whatever time zone the browser happens to be in. The server
// reports the deployment's zone at sign-in (GET /api/session); until then, Manila.
let appTimeZone = "Asia/Manila";
export function getAppTimeZone() {
  return appTimeZone;
}
export function setAppTimeZone(zone) {
  try {
    if (typeof zone === "string" && zone) {
      // Throws RangeError on an invalid zone; the server already validated its own.
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      appTimeZone = zone;
    }
  } catch {
    /* keep the default */
  }
}

export const ROLES = {
  resident: "Resident",
  official: "Barangay official",
  administrator: "Administrator",
};
export const ROLE_THEME = { resident: "resident", official: "official", administrator: "admin" };
export const STATUSES = ["Submitted", "Under Review", "In Progress", "Resolved"];
export const COLLECTION_STATUSES = ["Scheduled", "On the way", "Collecting", "Completed", "Delayed", "Cancelled", "Rescheduled"];
export const CATEGORIES = [
  "Road damage",
  "Broken streetlight",
  "Drainage problem",
  "Flooding",
  "Illegal dumping",
  "Missed garbage collection",
  "Other community concern",
];
export const REPORT_PRIORITIES = ["High", "Medium", "Low"];
export const MAX_REPORT_DESCRIPTION_LENGTH = 500;
export const BARANGAY_WORKING_HOURS = "Monday-Friday, 8:00 AM-5:00 PM";
export const AREAS = ["Purok 1", "Purok 2", "Purok 3", "Purok 4", "Purok 5", "Main Road"];
export const AREA_COORDINATES = {
  "Purok 1": [14.01799, 121.09465],
  "Purok 2": [14.025, 121.087],
  "Purok 3": [14.01, 121.102],
  "Purok 4": [14.005, 121.09],
  "Purok 5": [14.03, 121.098],
  "Main Road": [14.02, 121.08],
};

export const PERMISSION_DEFS = [
  {
    id: "submitReports",
    label: "Submit and track concerns",
    group: "Community services",
    description: "Create concerns and view their updates.",
  },
  {
    id: "viewSchedules",
    label: "View collection schedules",
    group: "Community services",
    description: "See posted collection dates and service updates.",
  },
  {
    id: "manageReports",
    label: "Review and update reports",
    group: "Community services",
    description: "Review resident concerns and record status updates.",
  },
  {
    id: "manageSchedules",
    label: "Manage collection schedules",
    group: "Community services",
    description: "Create, update, and remove service schedules.",
  },
  {
    id: "manageAnnouncements",
    label: "Manage announcements",
    group: "Community services",
    description: "Publish or remove updates shared with residents.",
  },
  {
    id: "manageUsers",
    label: "Manage user accounts",
    group: "Portal administration",
    description: "Review accounts and adjust access in this workspace.",
  },
  {
    id: "manageRoles",
    label: "Change role permissions",
    group: "Portal administration",
    description: "Choose which workspace functions each role can access.",
  },
  {
    id: "viewAudit",
    label: "Review activity history",
    group: "Portal administration",
    description: "Review recorded account and service activity.",
  },
];

export const ADMIN_ROLE_PERMISSION_IDS = ["submitReports", "viewSchedules", "manageReports", "manageSchedules", "manageAnnouncements"];

export const SCHEDULE_FREQUENCIES = ["Weekly", "Bi-weekly", "Monthly", "One-time"];
export const RECURRENCE_DEFAULT_MONTHS = 12;
export const MAX_RECURRENCE_OCCURRENCES = 260;

export const SCHEDULE_REASON_STATUSES = ["Delayed", "Cancelled"];
