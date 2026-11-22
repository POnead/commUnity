// Rules used by both the server and the browser. One definition so a limit
// cannot change in one place and silently disagree with the other.

// Government ID types accepted by the integrated verification flow. The keys
// are also the whitelist and the duplicate-detection namespace, so keep this
// list in one place. Restricted to the four types named in the project
// guidelines; legacy rows with other types stay readable but cannot be
// resubmitted.
export const ID_TYPE_LABELS = {
  philsys: "PhilSys ID",
  driver: "Driver's License",
  passport: "Passport",
  umid: "UMID",
};

export const REPORT_TRANSITIONS = {
  Submitted: ["Under Review"],
  "Under Review": ["In Progress"],
  "In Progress": ["Resolved"],
  Resolved: [],
};

export const FOLLOW_UP_LIMITS = { High: null, Medium: 5, Low: 3 };
export const RESPONSE_DEADLINE_DAYS = { High: 1, Medium: 3, Low: 7 };
export const RESOLUTION_DEADLINE_DAYS = { High: 7, Medium: 14, Low: 30 };

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
