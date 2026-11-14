"use strict";

import {
  APP_TIME_ZONE,
  ROLES,
  COLLECTION_STATUSES,
  REPORT_PRIORITIES,
  AREAS,
  DEFAULT_PERMISSIONS,
  SCHEDULE_FREQUENCIES,
  RECURRENCE_DEFAULT_MONTHS,
  MAX_RECURRENCE_OCCURRENCES,
  SCHEDULE_REASON_STATUSES,
} from "./constants.mjs";
// render lives in main.mjs and hasUnsavedPermissionChanges in views.mjs; both are
// only invoked at runtime, so the import cycle main -> core -> main/views is safe
// (function declarations are hoisted and call sites run post-evaluation).
import { render } from "./main.mjs";
import { hasUnsavedPermissionChanges } from "./views.mjs";

export function locationAreas() {
  return data?.locations?.map((location) => location.area) || AREAS;
}
export function locationBarangays() {
  return [...new Set((data?.locations || []).map((location) => location.barangay))];
}
export function areasInBarangay(barangay) {
  return (data?.locations || []).filter((location) => location.barangay === barangay).map((location) => location.area);
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

export const app = document.getElementById("app");
export const toastEl = document.getElementById("toast");
export let data;
export let currentUser;
export let communityOfficialHours = [];
export let currentRoute;
export let dataRevision = 0;
export let lastKnownHash = window.location.hash;
export let selectedReportId = null;
export let pendingReportRoute = "";
export let reportFilter = "all";
export let notificationFilter = "all";
export let uploadPhotos = [];
export let smtpSettings = { host: "", port: "", user: "", from: "", configured: false, encryptionReady: undefined };
export let reportDraft = null;
export let modalState = null;
export let forcedPasswordDismissed = false;
export const calendarToday = appDateParts();
export let calendarMonth = Number(calendarToday.month) - 1;
export let calendarYear = Number(calendarToday.year);
export let calendarSelectedDate = "";
export let selectedPermissionRole = "resident";
export let permissionDrafts = {};
export let permissionOpenGroups = {};
// Which per-official override panels the administrator has expanded. Kept so a
// live-update rebuild does not collapse the panel while it is being read.
export let permissionOpenAccounts = {};
export let toastTimer;
export let lastPersistedSnapshot = "";
// The activity log is browsed from the server, so its page and filters live outside the shared state.
export let activityLogState = { activities: [], total: 0, page: 1, pageSize: 25, pageCount: 1, summary: {} };
export let activityFilters = { from: "", to: "", actor: "", action: "", result: "", affectedId: "", source: "all" };
export let activityLogLoadedKey = "";

export const icons = {
  home: '<path d="m3.5 10 8.5-7 8.5 7"></path><path d="M5.5 9v11h13V9"></path><path d="M9 20v-6h6v6"></path>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="16" rx="2"></rect><path d="M7.5 3v4M16.5 3v4M3.5 9h17"></path><path d="M7.5 13h3M7.5 16h6"></path>',
  flag: '<path d="M5 21V4"></path><path d="M5 5c5-3 9 3 14 0v10c-5 3-9-3-14 0"></path>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2"></rect><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h7M8.5 18h4"></path>',
  clock: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3.5 2"></path>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>',
  user: '<circle cx="12" cy="8" r="3.5"></circle><path d="M5 20a7 7 0 0 1 14 0"></path>',
  users:
    '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"></path><circle cx="9.5" cy="7" r="3.5"></circle><path d="M17 11a3.5 3.5 0 1 0-1.2-6.8M17 14.5h1a4 4 0 0 1 4 4V20"></path>',
  shield: '<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"></path><path d="m9 12 2 2 4-4"></path>',
  settings:
    '<circle cx="12" cy="12" r="3"></circle><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.9 1.1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.9-1.1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2.2l-1.4-1.1L6.9 9.3l1.7.7a8 8 0 0 1 1.9-1.1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.9 1.1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 2.2Z"></path>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 4 4"></path>',
  chevron: '<path d="m8 10 4 4 4-4"></path>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"></path><circle cx="12" cy="10" r="2"></circle>',
  check: '<path d="m5 12 4 4L19 6"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"></path>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"></path>',
  eye: '<path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m21 15-5-5L5 20"></path>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"></path>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"></path>',
  leaf: '<path d="M20 4c-9 0-15 4-15 11a5 5 0 0 0 5 5c7 0 11-6 10-16Z"></path><path d="M4 21c3-5 6-8 12-11"></path>',
  alert: '<path d="m12 3 9 17H3z"></path><path d="M12 9v4m0 3h.01"></path>',
};

export function icon(name, extra = "") {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="${extra}">${icons[name] || icons.home}</svg>`;
}
export function brandMark() {
  return '<span class="brand-mark"><img src="/logo/palsara-transparent.png" alt="Palsara barangay logo"></span>';
}

export function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

export function asDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("A saved CommUnity date is invalid.");
  return parsed;
}

export function appDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A saved CommUnity date is invalid.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

export function dateLabel(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeZone: APP_TIME_ZONE, ...options }).format(asDate(value));
}

export function dateTimeLabel(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(asDate(value));
}

export function dateInputValue(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const { year, month, day } = appDateParts(value);
  return `${year}-${month}-${day}`;
}

export function todayISO() {
  return dateInputValue(new Date());
}

// A month bucket key in the barangay's time zone, matching the report trend table.
export function monthKey(value = new Date()) {
  const { year, month } = appDateParts(value);
  return `${year}-${month}`;
}

export function monthKeyOffset(offset, from = new Date()) {
  const { year, month } = appDateParts(from);
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function normalizeStatus(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll(" ", "-");
}

export function statusPill(value, label = value) {
  return `<span class="status" data-status="${esc(normalizeStatus(value))}">${esc(label)}</span>`;
}

// "system" is an audit role, not an account role, so it is not part of ROLES.
export function roleLabel(role) {
  return role === "system" ? "System" : ROLES[role] || role;
}

export function initials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "C"
  );
}

export function idFor(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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

export async function localSave() {
  let refreshed = false;
  while (true) {
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, revision: dataRevision }),
      });
      const result = await response.json();
      if (!response.ok) {
        // Background jobs and other sessions share one revision counter, so a
        // server-created notification can advance it while this browser works.
        // When the server's state is otherwise unchanged, adopt the new revision
        // and retry once; the server still re-validates every field.
        if (response.status === 409 && !refreshed) {
          const stateResponse = await fetch("/api/state");
          const state = await stateResponse.json();
          if (
            stateResponse.ok &&
            state.revision !== dataRevision &&
            stateMatchesIgnoringNotifications(state.data, JSON.parse(lastPersistedSnapshot || "null"))
          ) {
            dataRevision = state.revision;
            refreshed = true;
            continue;
          }
        }
        throw new Error(result.error || "CommUnity could not save this change.");
      }
      dataRevision = result.revision;
      data = result.data;
      currentUser = result.user;
      lastPersistedSnapshot = JSON.stringify(data);
      announceSessionChange();
      return true;
    } catch (error) {
      console.error("CommUnity could not save data.", error);
      if (lastPersistedSnapshot) {
        data = JSON.parse(lastPersistedSnapshot);
      }
      toast(error.message || "Your change could not be saved. Check that the CommUnity server is running, then try again.", "error");
      return false;
    }
  }
}

export async function loadCommunityOfficialHours() {
  communityOfficialHours = [];
  if (currentUser?.role !== "resident") return;
  try {
    const response = await fetch("/api/community/working-hours");
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.officials)) return;
    communityOfficialHours = result.officials;
  } catch (error) {
    console.error("CommUnity could not load official working hours.", error);
  }
}

export async function loadLocalData() {
  try {
    const sessionResponse = await fetch("/api/session");
    const session = await sessionResponse.json();
    if (!sessionResponse.ok) throw new Error(session.error || "CommUnity could not check your sign-in.");
    currentUser = session.user;
    if (!currentUser) {
      data = emptyState();
      const locationResponse = await fetch("/api/locations");
      const locationResult = await locationResponse.json();
      if (!locationResponse.ok) throw new Error(locationResult.error || "CommUnity could not load community locations.");
      data.locations = locationResult.locations;
      dataRevision = 0;
      lastPersistedSnapshot = "";
      return false;
    }
    if (currentUser.requiresPasswordChange) {
      // A temporary password may only reach the password-change dialog, so the
      // server refuses /api/state until it is replaced. Start from the empty
      // shell; updatePassword() loads the real state once the change succeeds.
      data = emptyState();
      dataRevision = 0;
      lastPersistedSnapshot = "";
      communityOfficialHours = [];
      return true;
    }
    const response = await fetch("/api/state");
    const stored = await response.json();
    if (!response.ok) throw new Error(stored.error || "CommUnity could not load your information.");
    dataRevision = stored.revision;
    data = stored.data;
    currentUser = stored.user;
    if (!data || data.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.reports) || !Array.isArray(data.schedules)) {
      throw new Error("The saved data version is not supported. Reset the saved CommUnity data to continue.");
    }
    data.notifications ||= [];
    data.activities ||= [];
    data.permissions ||= structuredClone(DEFAULT_PERMISSIONS);
    data.announcements ||= [];
    await loadCommunityOfficialHours();
    lastPersistedSnapshot = stored.data ? JSON.stringify(data) : "";
    return Boolean(stored.data);
  } catch (error) {
    console.error("CommUnity could not read saved data.", error);
    app.innerHTML = `<main class="fatal-screen">${brandMark()}<h1>Saved data could not be opened</h1><p>${esc(error.message)}</p></main>`;
    return null;
  }
}

export function toast(message, kind = "") {
  toastEl.textContent = message;
  toastEl.dataset.kind = kind;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 3400);
}

export let activeConfirmation = null;

export function confirmAction({
  title = "Confirm change",
  message = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
} = {}) {
  if (activeConfirmation) return Promise.resolve(false);
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop confirm-backdrop";
    backdrop.innerHTML = `<section class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
      <header class="modal-head"><div><h2 id="confirm-dialog-title">${esc(title)}</h2></div></header>
      <div class="modal-content confirm-content">
        <p id="confirm-dialog-message">${esc(message)}</p>
        <div class="form-actions"><button class="button secondary" type="button" data-confirm="cancel">${esc(cancelLabel)}</button><button class="button${tone === "danger" ? " danger" : ""}" type="button" data-confirm="accept">${esc(confirmLabel)}</button></div>
      </div>
    </section>`;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.append(backdrop);
    const acceptButton = backdrop.querySelector('[data-confirm="accept"]');
    const cancelButton = backdrop.querySelector('[data-confirm="cancel"]');
    const finish = (value) => {
      if (!activeConfirmation) return;
      activeConfirmation = null;
      backdrop.remove();
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
      resolve(value);
    };
    activeConfirmation = { finish };
    acceptButton.addEventListener("click", () => finish(true));
    cancelButton.addEventListener("click", () => finish(false));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(false);
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const focusable = [...backdrop.querySelectorAll("button:not([disabled])")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    cancelButton.focus();
  });
}

export function currentPath() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
}

export function clearSession() {
  currentUser = null;
  selectedReportId = null;
  reportDraft = null;
  uploadPhotos = [];
  document.documentElement.dataset.theme = "auth";
}

export const SESSION_SYNC_KEY = "community.session-sync";
export const sessionSyncChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("community-session") : null;

export function announceSessionChange() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(SESSION_SYNC_KEY, stamp);
  } catch {
    // Storage can be unavailable; the broadcast channel still covers modern browsers.
  }
  try {
    sessionSyncChannel?.postMessage({ type: "session", stamp });
  } catch {
    // Ignore channel failures.
  }
}

sessionSyncChannel?.addEventListener("message", async (event) => {
  if (event.data?.type !== "session") return;
  if (modalState) return; // do not disrupt an open form or modal
  try {
    await loadLocalData();
    render();
  } catch (error) {
    console.error("CommUnity could not refresh session data.", error);
  }
});

// Live updates: poll the cheap revision endpoint and adopt server changes only
// when one exists. Polling /api/state/revision keeps the common case to a few
// bytes; a full state fetch happens only when the revision actually moved.
// Forms the user is editing are never rebuilt over: modal state, unsaved
// role-permission drafts and any inline form holding user input all pause
// adoption until the user finishes with them.
export const STATE_REFRESH_INTERVAL_MS = 30000;
export let stateRefreshTimer = null;

// A form holds unsaved input when one of its controls differs from what was
// rendered — typed text, a changed select/checkbox/radio, a chosen file, or a
// dropped pin in the hidden map fields. Pre-filled controls match their
// rendered defaults, so ordinary untouched forms read as clean. No listeners
// or bookkeeping are kept in sync: the DOM is the single source of truth, and
// any rebuild returns every control to its rendered default automatically.
export function hasUnsavedFormInput() {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return false;
  const controlIsDirty = (control) => {
    if (!control || control.disabled) return false;
    const tag = String(control.tagName || "").toUpperCase();
    const type = String(control.type || "").toLowerCase();
    if (type === "file") return Boolean(control.files && control.files.length);
    if (type === "checkbox" || type === "radio") return control.checked !== control.defaultChecked;
    if (tag === "SELECT") {
      const options = control.options ? [...control.options] : [];
      return control.selectedIndex !== options.findIndex((option) => option.defaultSelected);
    }
    // Covers text-like inputs, hidden inputs, and textareas.
    return typeof control.value === "string" && control.value !== control.defaultValue;
  };
  for (const form of document.querySelectorAll("form")) {
    const elements = form.elements ? [...form.elements] : [];
    if (elements.some(controlIsDirty)) return true;
  }
  // Typed list-search boxes are not wrapped in a <form> but hold input a rebuild would erase too.
  for (const input of document.querySelectorAll("[data-search-input]")) {
    if (typeof input.value === "string" && input.value !== input.defaultValue) return true;
  }
  return false;
}

export async function checkForStateUpdates() {
  if (!currentUser || currentUser.requiresPasswordChange || !Number.isSafeInteger(dataRevision) || dataRevision < 1) return false;
  if (typeof modalState !== "undefined" && modalState) return false; // do not re-render an open form
  if (typeof hasUnsavedPermissionChanges === "function" && hasUnsavedPermissionChanges()) return false;
  if (hasUnsavedFormInput()) return false; // do not rebuild a form the user is editing
  let revisionResponse;
  try {
    revisionResponse = await fetch("/api/state/revision");
  } catch (error) {
    console.error("CommUnity could not check for updates.", error);
    return false;
  }
  if (!revisionResponse.ok) return false;
  const { revision } = await revisionResponse.json();
  if (!Number.isSafeInteger(revision) || revision === dataRevision) return false;
  let stateResponse;
  try {
    stateResponse = await fetch("/api/state");
  } catch (error) {
    console.error("CommUnity could not refresh state.", error);
    return false;
  }
  const state = await stateResponse.json();
  if (!stateResponse.ok || !state?.data) return false;
  data = state.data;
  currentUser = state.user ?? currentUser;
  dataRevision = state.revision;
  lastPersistedSnapshot = JSON.stringify(data);
  if (typeof render === "function") render();
  toast("Updated with the latest changes.", "success");
  return true;
}

export function startStateUpdates() {
  if (stateRefreshTimer) return;
  stateRefreshTimer = setInterval(() => {
    checkForStateUpdates().catch((error) => console.error("CommUnity could not refresh.", error));
  }, STATE_REFRESH_INTERVAL_MS);
}

export function stopStateUpdates() {
  clearInterval(stateRefreshTimer);
  stateRefreshTimer = null;
}

export function unreadCount(user = currentUser) {
  if (!user || !data.notifications) return 0;
  return data.notifications.filter((item) => item.targetEmail === user.email && !item.read).length;
}
export function displayReportId(id) {
  const value = String(id || "");
  const timestampId = value.match(/^R(\d{13})(?:-([a-z0-9]{6}))?$/i);
  if (timestampId) {
    const suffix = timestampId[2] ? `-${timestampId[2].toUpperCase()}` : "";
    return `R-${Number(timestampId[1]).toString(36).toUpperCase()}${suffix}`;
  }
  const match = value.match(/^R(?:PT-\d{4}-)?(\d+)$/i);
  return match ? `R${String(Number(match[1])).padStart(2, "0")}` : String(id || "");
}

export function addActivity(action, detail, result = "Success") {
  data.activities.push({
    id: idFor("A"),
    actor: currentUser?.name || "Resident",
    role: currentUser?.role || "resident",
    action,
    detail,
    at: new Date().toISOString(),
    result,
  });
}

export function addNotification(targetEmail, title, body, reportId = "") {
  data.notifications.unshift({
    id: idFor("N"),
    targetEmail,
    title,
    body,
    reportId,
    createdAt: new Date().toISOString(),
    read: false,
  });
}

export function addRoleNotification(role, title, body, reportId = "") {
  data.users
    .filter((user) => user.role === role && user.status === "Active")
    .forEach((user) => addNotification(user.email, title, body, reportId));
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

export function selectedAreaFor(user = currentUser) {
  return user?.area || "Palsara";
}

export function routeUrl(role, page) {
  return `#/${role}/${page}`;
}

export function linkButton(label, href, variant = "secondary", extra = "") {
  return `<a class="button ${variant} ${extra}" href="${esc(href)}">${label}</a>`;
}

export function actionButton(label, action, variant = "secondary", extra = "", attrs = "") {
  return `<button class="button ${variant} ${extra}" type="button" data-action="${esc(action)}" ${attrs}>${label}</button>`;
}

export function selectOptions(items, selected, labels = {}) {
  return items
    .map((item) => `<option value="${esc(item)}" ${item === selected ? "selected" : ""}>${esc(labels[item] || item)}</option>`)
    .join("");
}

export function inputField(label, name, value = "", options = {}) {
  const id = options.id || name;
  const type = options.type || "text";
  const required = options.required ? "required" : "";
  const readonly = options.readonly ? "readonly" : "";
  const placeholder = options.placeholder ? `placeholder="${esc(options.placeholder)}"` : "";
  const help = options.help ? `<p class="field-help">${esc(options.help)}</p>` : "";
  return `<div class="form-field"><label for="${esc(id)}">${esc(label)}${options.required ? " *" : ""}</label><input class="input" id="${esc(id)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${required} ${readonly} ${placeholder} ${options.minLength ? `minlength="${options.minLength}"` : ""} ${options.maxLength ? `maxlength="${options.maxLength}"` : ""} ${options.autocomplete ? `autocomplete="${esc(options.autocomplete)}"` : ""}>${help}</div>`;
}

export function selectField(label, name, items, selected, options = {}) {
  const labelMap = options.labels || {};
  const required = options.required ? "required" : "";
  return `<div class="form-field"><label for="${esc(name)}">${esc(label)}${options.required ? " *" : ""}</label><select class="select" id="${esc(name)}" name="${esc(name)}" ${required}>${options.placeholder ? `<option value="">${esc(options.placeholder)}</option>` : ""}${items.map((item) => `<option value="${esc(item)}" ${item === selected ? "selected" : ""}>${esc(labelMap[item] || item)}</option>`).join("")}</select></div>`;
}

export function reportDraftFromForm(fields) {
  const readOptionalCoordinate = (value) => {
    const text = String(value || "").trim();
    return text ? Number(text) : null;
  };
  const priority = String(fields.get("priority") || "").trim();
  if (!REPORT_PRIORITIES.includes(priority)) throw new Error("Choose a valid concern priority.");
  return {
    category: String(fields.get("category") || ""),
    barangay: "Palsara",
    area: String(fields.get("area") || ""),
    locationDetail: String(fields.get("locationDetail") || "").trim(),
    latitude: readOptionalCoordinate(fields.get("latitude")),
    longitude: readOptionalCoordinate(fields.get("longitude")),
    description: String(fields.get("description") || "").trim(),
    priority,
    urgent: priority === "High",
    step: "review",
  };
}

export function calendarEventFromForm(fields) {
  const readOptionalCoordinate = (value) => {
    const text = String(value || "").trim();
    return text ? Number(text) : null;
  };
  const latitude = readOptionalCoordinate(fields.get("latitude"));
  const longitude = readOptionalCoordinate(fields.get("longitude"));
  if (
    (latitude === null) !== (longitude === null) ||
    (latitude !== null &&
      (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180))
  ) {
    throw new Error("Choose a valid map location or clear the pin before continuing.");
  }
  return {
    title: String(fields.get("title") || "").trim(),
    detail: String(fields.get("detail") || "").trim(),
    date: String(fields.get("date") || ""),
    latitude,
    longitude,
  };
}

export function calendarEventFromRecord(item) {
  return {
    id: String(item.id),
    date: item.date,
    title: item.title,
    detail: item.detail || "",
    kind: "Event",
    status: item.approvalStatus || "approved",
    declineReason: item.declineReason || "",
    createdBy: item.createdBy || "",
    createdByName: item.createdByName || "",
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
  };
}

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
    selectedPermissionRole: (v) => (selectedPermissionRole = v),
    communityOfficialHours: (v) => (communityOfficialHours = v),
    selectedReportId: (v) => (selectedReportId = v),
    reportFilter: (v) => (reportFilter = v),
    notificationFilter: (v) => (notificationFilter = v),
    uploadPhotos: (v) => (uploadPhotos = v),
    smtpSettings: (v) => (smtpSettings = v),
    forcedPasswordDismissed: (v) => (forcedPasswordDismissed = v),
    currentRoute: (v) => (currentRoute = v),
    pendingReportRoute: (v) => (pendingReportRoute = v),
    toastTimer: (v) => (toastTimer = v),
    lastKnownHash: (v) => (lastKnownHash = v),
  };
  for (const [key, value] of Object.entries(changes)) {
    if (!handlers[key]) throw new Error(`setState: unknown key "${key}"`);
    handlers[key](value);
  }
}

// Test hook: lets the vm-based frontend tests override module state.
export function __setTestState(next = {}) {
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
    selectedPermissionRole: (v) => (selectedPermissionRole = v),
    communityOfficialHours: (v) => (communityOfficialHours = v),
    selectedReportId: (v) => (selectedReportId = v),
    reportFilter: (v) => (reportFilter = v),
    notificationFilter: (v) => (notificationFilter = v),
    uploadPhotos: (v) => (uploadPhotos = v),
    smtpSettings: (v) => (smtpSettings = v),
    forcedPasswordDismissed: (v) => (forcedPasswordDismissed = v),
    currentRoute: (v) => (currentRoute = v),
    pendingReportRoute: (v) => (pendingReportRoute = v),
    toastTimer: (v) => (toastTimer = v),
  };
  for (const [key, value] of Object.entries(next)) {
    if (!handlers[key]) throw new Error(`__setTestState: unknown key "${key}"`);
    handlers[key](value);
  }
}
