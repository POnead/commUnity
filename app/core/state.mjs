"use strict";

import { appDateParts } from "./format.mjs";
import { ADMIN_ROLE_PERMISSION_IDS } from "../constants.mjs";

export const app = document.getElementById("app");
export const toastEl = document.getElementById("toast");
export let data;
export let currentUser;
export let currentRoute;
export let dataRevision = 0;
export let lastKnownHash = window.location.hash;
export let selectedReportId = null;
export let pendingReportRoute = "";
export let reportFilter = "all";
export let residentReportSort = "newest";
export let adminReportFilters = { status: "all", area: "all", sort: "newest", query: "" };
export let assignmentFilter = "unassigned";
export let officialAssignedFilter = "all";
export let officialHistorySort = "newest";
export let analyticsRange = "6";
export let approvalFilter = "pending";
export let notificationFilter = "all";
export let searchQuery = "";
export let uploadPhotos = [];
export let smtpSettings = { host: "", port: "", user: "", from: "", configured: false, encryptionReady: undefined };
export let verificationSettings = { faceVerificationEnabled: false, dutyHours: 9, matchThreshold: 0.033 };
// Kept across renders so a completed face check stays visible after refreshWorkspace().
export let faceCheckNotice = "";
export let reportDraft = null;
export let modalState = null;
export let forcedPasswordDismissed = false;
export let calendarMonth = Number(appDateParts().month) - 1;
export let calendarYear = Number(appDateParts().year);
export let calendarSelectedDate = "";
export let selectedPermissionAccount = null;
export let correctionFilters = { query: "", status: "all", type: "all", date: "all" };
export let permissionDrafts = {};
export function hasUnsavedPermissionChanges() {
  return Object.entries(permissionDrafts).some(([role, draft]) =>
    ADMIN_ROLE_PERMISSION_IDS.some((id) => draft[id] !== Boolean(data.permissions[role]?.[id])),
  );
}
export let permissionOpenGroups = {};
// Which per-official override panels the administrator has expanded. Kept so a
// live-update rebuild does not collapse the panel while it is being read.
export let permissionOpenAccounts = {};
export let toastTimer;
export let lastPersistedSnapshot = "";
export let processingState = { depth: 0, label: "Processing...", visible: false };

export let profileSummaryCollapsed = false;
// Kept so a live-update rebuild does not close the face-check panel mid-check.
export let facePanelOpen = false;
// Kept so a live-update rebuild does not close the ID panel mid-review.
export let idPanelOpen = false;
// Security panels are rebuilt on save; remember which one the resident had open.
export let emailPanelOpen = false;
export let passwordPanelOpen = false;
// The activity log is browsed from the server, so its page and filters live outside the shared state.
export let activityLogState = { activities: [], total: 0, page: 1, pageSize: 25, pageCount: 1, summary: {} };
export let activityFilters = { from: "", to: "", role: "" };
export let activityLogLoadedKey = "";

// Live binding reads are allowed from other modules; writes go through this hook.
export function setState(changes = {}) {
  const handlers = {
    data: (v) => (data = v),
    currentUser: (v) => (currentUser = v),
    modalState: (v) => (modalState = v),
    dataRevision: (v) => (dataRevision = v),
    lastPersistedSnapshot: (v) => (lastPersistedSnapshot = v),
    reportDraft: (v) => (reportDraft = v),
    activityLogState: (v) => (activityLogState = v),
    activityFilters: (v) => (activityFilters = v),
    activityLogLoadedKey: (v) => (activityLogLoadedKey = v),
    permissionDrafts: (v) => (permissionDrafts = v),
    permissionOpenGroups: (v) => (permissionOpenGroups = v),
    permissionOpenAccounts: (v) => (permissionOpenAccounts = v),
    calendarMonth: (v) => (calendarMonth = v),
    calendarYear: (v) => (calendarYear = v),
    calendarSelectedDate: (v) => (calendarSelectedDate = v),
    selectedPermissionAccount: (v) => (selectedPermissionAccount = v),
    correctionFilters: (v) => (correctionFilters = v),
    selectedReportId: (v) => (selectedReportId = v),
    reportFilter: (v) => (reportFilter = v),
    residentReportSort: (v) => (residentReportSort = v),
    adminReportFilters: (v) => (adminReportFilters = v),
    assignmentFilter: (v) => (assignmentFilter = v),
    officialAssignedFilter: (v) => (officialAssignedFilter = v),
    officialHistorySort: (v) => (officialHistorySort = v),
    analyticsRange: (v) => (analyticsRange = v),
    approvalFilter: (v) => (approvalFilter = v),
    notificationFilter: (v) => (notificationFilter = v),
    searchQuery: (v) => (searchQuery = v),
    uploadPhotos: (v) => (uploadPhotos = v),
    smtpSettings: (v) => (smtpSettings = v),
    verificationSettings: (v) => (verificationSettings = v),
    faceCheckNotice: (v) => (faceCheckNotice = v),
    forcedPasswordDismissed: (v) => (forcedPasswordDismissed = v),
    currentRoute: (v) => (currentRoute = v),
    pendingReportRoute: (v) => (pendingReportRoute = v),
    toastTimer: (v) => (toastTimer = v),
    lastKnownHash: (v) => (lastKnownHash = v),
    processingState: (v) => (processingState = v),
    profileSummaryCollapsed: (v) => (profileSummaryCollapsed = v),
    facePanelOpen: (v) => (facePanelOpen = v),
    idPanelOpen: (v) => (idPanelOpen = v),
    emailPanelOpen: (v) => (emailPanelOpen = v),
    passwordPanelOpen: (v) => (passwordPanelOpen = v),
  };
  for (const [key, value] of Object.entries(changes)) {
    if (!handlers[key]) throw new Error(`setState: unknown key "${key}"`);
    handlers[key](value);
  }
}

// Test hook: lets the vm-based frontend tests override module state. Same
// handlers as setState, so the two never drift apart.
export const __setTestState = setState;
