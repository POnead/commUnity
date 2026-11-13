// Every calendar day shown or validated in the interface is the barangay's day,
// not the day of whatever time zone the browser happens to be in.
export const APP_TIME_ZONE = "Asia/Manila";

export const ROLES = {
  resident: "Resident",
  official: "Barangay official",
  administrator: "Administrator",
};
export const ROLE_THEME = { resident: "resident", official: "official", administrator: "admin" };
export const STATUSES = ["Submitted", "Under Review", "In Progress", "Resolved"];
export const REPORT_TRANSITIONS = {
  Submitted: ["Under Review"],
  "Under Review": ["In Progress"],
  "In Progress": ["Resolved"],
  Resolved: [],
};
export const RESPONSE_DEADLINE_DAYS = { High: 1, Medium: 3, Low: 7 };
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
export const FOLLOW_UP_LIMITS = { High: null, Medium: 5, Low: 3 };
export const AREAS = ["Purok 1", "Purok 2", "Purok 3", "Purok 4", "Purok 5", "Main Road"];
export const PALSARA_CENTER = [14.01799, 121.09465];
export const PALSARA_BOUNDS = [
  [13.99, 121.06],
  [14.045, 121.13],
];
export const AREA_COORDINATES = {
  "Purok 1": [14.01799, 121.09465],
  "Purok 2": [14.025, 121.087],
  "Purok 3": [14.01, 121.102],
  "Purok 4": [14.005, 121.09],
  "Purok 5": [14.03, 121.098],
  "Main Road": [14.02, 121.08],
};

export const DEFAULT_PERMISSIONS = {
  resident: {
    submitReports: true,
    viewSchedules: true,
    manageReports: false,
    manageSchedules: false,
    manageAnnouncements: false,
    manageUsers: false,
    manageRoles: false,
    viewAudit: false,
  },
  official: {
    submitReports: false,
    viewSchedules: true,
    manageReports: true,
    manageSchedules: true,
    manageAnnouncements: true,
    manageUsers: false,
    manageRoles: false,
    viewAudit: false,
  },
  administrator: {
    submitReports: false,
    viewSchedules: true,
    manageReports: true,
    manageSchedules: true,
    manageAnnouncements: true,
    manageUsers: true,
    manageRoles: true,
    viewAudit: true,
  },
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

export const SCHEDULE_FREQUENCIES = ["Weekly", "Bi-weekly", "Monthly", "One-time"];
export const RECURRENCE_DEFAULT_MONTHS = 12;
export const MAX_RECURRENCE_OCCURRENCES = 260;

export const SCHEDULE_REASON_STATUSES = ["Delayed", "Cancelled"];
