export const ROLES = ["resident", "official", "administrator"];

export const PERMISSIONS = {
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
