"use strict";

import { runLiveness, cameraErrorCopy } from "./face-capture.mjs";
import {
  locationAreas,
  locationAreaLabels,
  isResidentArea,
  icon,
  brandMark,
  esc,
  appDateParts,
  dateLabel,
  dateTimeLabel,
  todayISO,
  readOptionalCoordinate,
  scheduleClockMinutes,
  statusPill,
  roleLabel,
  idFor,
  emptyState,
  localSave,
  loadLocalData,
  toast,
  confirmAction,
  currentPath,
  clearSession,
  announceSessionChange,
  startStateUpdates,
  stopStateUpdates,
  getUser,
  getReport,
  displayReportId,
  displayReferenceText,
  userReports,
  sortedReports,
  sortedSchedules,
  scheduleStatusEntry,
  scheduleOccurrenceDates,
  routeUrl,
  inputField,
  selectField,
  reportDraftFromForm,
  calendarEventFromForm,
  calendarEventFromRecord,
  app,
  data,
  currentUser,
  adminReportFilters,
  officialHistorySort,
  setState,
  pendingReportRoute,
  uploadPhotos,
  smtpSettings,
  redirectToFaceCheckIfRequired,
  setFaceCheckActive,
  reportDraft,
  modalState,
  forcedPasswordDismissed,
  calendarMonth,
  calendarYear,
  calendarSelectedDate,
  activityLogState,
  activityFilters,
  activityLogLoadedKey,
  lastKnownHash,
  SESSION_SYNC_KEY,
  processingState,
  profileSummaryCollapsed,
  facePanelOpen,
  idPanelOpen,
  emailPanelOpen,
  passwordPanelOpen,
  searchQuery,
  currentRoute,
  correctionFilters,
  verificationSettings,
} from "./core.mjs";
import {
  ROLES,
  ROLE_THEME,
  STATUSES,
  REPORT_TRANSITIONS,
  COLLECTION_STATUSES,
  CATEGORIES,
  REPORT_PRIORITIES,
  MAX_REPORT_DESCRIPTION_LENGTH,
  FOLLOW_UP_LIMITS,
  PERMISSION_DEFS,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_REASON_STATUSES,
  BARANGAY_WORKING_HOURS,
  HOTLINE_CATEGORIES,
  HOTLINE_STATUSES,
  HOTLINE_STATUS_LABELS,
} from "./constants.mjs";
import {
  canOpenPage,
  checkDataConsistency,
  scheduleHistoryMarkup,
  dashboardResident,
  calendarStatusLabel,
  calendarPage,
  dashboardOfficial,
  officialAssignedPage,
  dashboardAdmin,
  assignmentsPage,
  settingsPage,
  emailPage,
  collectionResident,
  locationsPage,
  announcementsPage,
  analyticsPage,
  collectionOfficial,
  reportPage,
  reportsPage,
  notificationsPage,
  hotlinesPage,
  HOTLINE_FIELD_LABELS,
  approvalsPage,
  verificationsPage,
  idImageModalBody,
  faceVerifyPage,
  faceGateMarkup,
  adminFaceEnrollMarkup,
  profilePage,
  userAvatar,
  usersPage,
  rolesPage,
  photoPreviewMarkup,
  rememberOpenPermissionAccounts,
  hasUnsavedPermissionChanges,
  confirmLeaveWithUnsavedPermissions,
  activityResultsMarkup,
  activityLogPage,
  loginMarkup,
  forgotPasswordMarkup,
  resetPasswordMarkup,
  verifyRecoveryMarkup,
  verifyEmailChangeMarkup,
  registerMarkup,
} from "./views.mjs";
import {
  reportMapExpanded,
  announcementMapExpanded,
  announcementMapSelection,
  calendarEventMapExpanded,
  calendarEventMapSelection,
  announcementDetailMaps,
  reportMap,
  announcementMap,
  calendarEventMap,
  locationMapExpanded,
  locationMap,
  locationPickerMap,
  reportMapMarker,
  announcementMapMarker,
  calendarEventMapMarker,
  setMapState,
  palsaraContextMessage,
  useCurrentLocation,
  initializeReportMap,
  initializeReportDetailMap,
  initializeAnnouncementMap,
  initializeCalendarEventMap,
  initializeAnnouncementDetailMap,
  initializeLocationMap,
  setLocationPickerPin,
  initializeLocationPickerMap,
  setLocationFixProvider,
  refreshGoogleMaps,
} from "./map.mjs";
import { destroyAnalyticsCharts, initializeAnalyticsCharts } from "./analytics-charts.mjs";
import { palsaraLocationVerdict } from "../shared/community-map.mjs";
import { ID_TYPE_LABELS } from "../shared/domain-rules.mjs";

let profilePhotoFile = null;
let profilePhotoPreview = null;
let lastCalendarClick = { date: "", at: 0 };

// Report-location gate state. The device fix is authoritative; a map pin only
// marks where the incident happened and can never authorise a submission.
let reportLocationVerdict = { state: "prompt", accuracy: null, distanceToBoundary: null };
let reportLocationPosition = null;
let reportLocationGeneration = 0;
let reportLocationPreviousState = null;
let reportLocationCheckPromise = null;

const LOCATION_BLOCKING_STATES = new Set(["outside", "uncertain", "denied", "unavailable"]);
const HOTLINES_LINK = `<a class="text-button" href="${routeUrl("resident", "hotlines")}">Barangay hotlines</a>`;

const LOCATION_GATE_COPY = {
  prompt: {
    icon: "pin",
    title: "Confirm you're in Palsara",
    detail: () => "We'll ask for your location once so we can confirm you're reporting from the barangay.",
    actions: '<button class="button" type="button" data-action="location-allow">Allow location</button>',
  },
  checking: {
    icon: '<span class="location-gate-spinner" aria-hidden="true"></span>',
    title: "Checking your location…",
    detail: () => "This takes a few seconds while your device finds a clear signal.",
    actions: "",
  },
  inside: {
    icon: "check",
    title: "Location confirmed — you're in Palsara",
    detail: (verdict) =>
      Number.isFinite(verdict.accuracy) && verdict.accuracy > 0
        ? `Accurate to about ${Math.round(verdict.accuracy)} m.`
        : "Your device confirmed you're in the barangay.",
    actions: '<button class="text-button" type="button" data-action="location-recheck">Refresh</button>',
  },
  outside: {
    icon: "close",
    title: "You're outside Palsara",
    detail: () => "Concerns can only be submitted from within the barangay. You can't submit this report from here.",
    actions: `<button class="button secondary" type="button" data-action="location-recheck">Try again</button>${HOTLINES_LINK}`,
  },
  uncertain: {
    icon: "alert",
    title: "We couldn't confirm your location precisely",
    detail: () => "Move away from the boundary or try again. We need a clearer signal before you can submit.",
    actions: '<button class="button secondary" type="button" data-action="location-recheck">Try again</button>',
  },
  denied: {
    icon: "settings",
    title: "Location access is blocked",
    detail: () => "Allow location for this site in your browser settings, then reload this page.",
    actions: `<button class="button secondary" type="button" data-action="location-reload">Reload page</button>${HOTLINES_LINK}`,
  },
  unavailable: {
    icon: "alert",
    title: "Location isn't available here",
    detail: () => "Reporting needs HTTPS and a browser with location support.",
    actions: HOTLINES_LINK,
  },
};

function unavailableLocationVerdict() {
  return { state: "unavailable", accuracy: null, distanceToBoundary: null };
}

function locationErrorVerdict(error) {
  return error?.code === 1
    ? { state: "denied", accuracy: null, distanceToBoundary: null }
    : { ...unavailableLocationVerdict(), code: error?.code };
}

function secureLocationContext() {
  if (window?.isSecureContext) return true;
  const host = window?.location?.hostname || "";
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

async function readLocationPermission() {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status?.state || "unknown";
  } catch {
    return "unknown";
  }
}

// Keep the best (smallest accuracy) fix for up to 15s. A cold GPS fix can take
// much longer than the old 8s timeout, and a noisy point near the boundary
// would otherwise flip a resident from inside to outside unfairly.
function requestDeviceLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ ...unavailableLocationVerdict(), position: null });
  }
  if (typeof navigator.geolocation.watchPosition !== "function") {
    return new Promise((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const coords = position?.coords || {};
            const fix = {
              latitude: coords.latitude,
              longitude: coords.longitude,
              accuracy: coords.accuracy,
              timestamp: position?.timestamp,
            };
            resolve({ ...palsaraLocationVerdict(fix), position: fix });
          },
          (error) => resolve({ ...locationErrorVerdict(error), position: null }),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
        );
      } catch (error) {
        resolve({ ...locationErrorVerdict(error), position: null });
      }
    });
  }
  return new Promise((resolve) => {
    let best = null;
    let watchId = null;
    let timer = null;
    let settled = false;
    let lastState = "";
    let steadyVerdictFrames = 0;
    const finish = (verdict, position) => {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      if (watchId != null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* watcher already gone */
        }
      }
      resolve({ ...verdict, position });
    };
    const evaluate = (position) => {
      const coords = position?.coords || {};
      const fix = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        timestamp: position?.timestamp,
      };
      if (!best || (Number.isFinite(fix.accuracy) && fix.accuracy < best.accuracy)) best = fix;
      const verdict = palsaraLocationVerdict(best);
      // One noisy fix near the boundary must not decide the gate. Wait for a few
      // consistent readings, or finish early on a clearly accurate inside fix.
      steadyVerdictFrames = verdict.state === lastState ? steadyVerdictFrames + 1 : 1;
      lastState = verdict.state;
      // A borderline fix is "uncertain" and needs more frames; a clear inside
      // or outside fix can decide at once.
      if (verdict.state !== "uncertain" || steadyVerdictFrames >= 4) finish(verdict, best);
    };
    try {
      watchId = navigator.geolocation.watchPosition(evaluate, (error) => finish(locationErrorVerdict(error), null), {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      });
    } catch (error) {
      finish(locationErrorVerdict(error), null);
      return;
    }
    timer = setTimeout(() => {
      if (best) finish(palsaraLocationVerdict(best), best);
      else finish(unavailableLocationVerdict(), null);
    }, 15000);
  });
}

function renderLocationGate() {
  const card = app.querySelector("#report-location-gate");
  if (!card) return;
  const config = LOCATION_GATE_COPY[reportLocationVerdict.state] || LOCATION_GATE_COPY.prompt;
  card.dataset.state = reportLocationVerdict.state;
  card.setAttribute("aria-busy", String(reportLocationVerdict.state === "checking"));
  const chip = card.querySelector(".location-gate-chip");
  if (chip) chip.innerHTML = config.icon.includes("<") ? config.icon : icon(config.icon, "location-gate-icon");
  const title = card.querySelector("#report-location-title");
  if (title) title.textContent = config.title;
  const detail = card.querySelector("#report-location-detail");
  if (detail) detail.textContent = config.detail(reportLocationVerdict);
  const actions = card.querySelector("#report-location-actions");
  if (actions) actions.innerHTML = config.actions;
  const locked = reportLocationVerdict.state !== "inside";
  const submit = app.querySelector('[data-action="submit-report"]');
  if (submit) {
    submit.disabled = locked;
    if (locked) submit.setAttribute("aria-describedby", "report-location-detail");
    else submit.removeAttribute("aria-describedby");
  }
  const hint = app.querySelector("#report-location-submit-hint");
  if (hint) {
    hint.hidden = !locked;
    hint.dataset.state = reportLocationVerdict.state;
  }
}

function applyLocationVerdict(verdict, position = null, options = {}) {
  const previous = reportLocationPreviousState;
  reportLocationVerdict = verdict;
  if (position) reportLocationPosition = position;
  reportLocationPreviousState = verdict.state;
  renderLocationGate();
  if (options.announce && LOCATION_BLOCKING_STATES.has(verdict.state) && verdict.state !== previous) {
    const alert = app.querySelector("#report-location-alert");
    if (alert) alert.textContent = LOCATION_GATE_COPY[verdict.state].detail(verdict);
    app.querySelector("#report-location-title")?.focus?.();
  }
}

function resolveReportLocation(options = {}) {
  if (reportLocationCheckPromise && !options.force) return reportLocationCheckPromise;
  const generation = ++reportLocationGeneration;
  const promise = (async () => {
    const permission = await readLocationPermission();
    if (permission === "denied") {
      applyLocationVerdict({ state: "denied", accuracy: null, distanceToBoundary: null }, null, options);
      return;
    }
    if (!secureLocationContext() || typeof navigator === "undefined" || !navigator.geolocation) {
      applyLocationVerdict(unavailableLocationVerdict(), null, options);
      return;
    }
    if (permission === "prompt" && !options.userInitiated) {
      applyLocationVerdict({ state: "prompt", accuracy: null, distanceToBoundary: null }, null, options);
      return;
    }
    applyLocationVerdict({ state: "checking", accuracy: null, distanceToBoundary: null }, null, options);
    const result = await requestDeviceLocation();
    if (generation !== reportLocationGeneration) return;
    applyLocationVerdict(result, result.position, options);
  })().finally(() => {
    if (reportLocationCheckPromise === promise) reportLocationCheckPromise = null;
  });
  reportLocationCheckPromise = promise;
  return promise;
}

// The map picker can place the pin from the fix we already verified.
setLocationFixProvider(() => reportLocationPosition);

function routeState() {
  const path = currentPath();
  // Reachable whether or not the visitor is signed in: the emailed link proves the address.
  if (path[0] === "verify-recovery") return { type: "verify-recovery" };
  if (path[0] === "verify-email") return { type: "verify-email" };
  if (!currentUser) {
    if (path[0] === "register") return { type: "register" };
    if (path[0] === "forgot-password") return { type: "forgot-password" };
    if (path[0] === "reset-password") return { type: "reset-password" };
    return { type: "login" };
  }
  // A temporary password must be replaced before any other gate applies.
  if (currentUser.requiresPasswordChange) return { type: "app", role: currentUser.role, page: "dashboard" };
  if (path[0] === "face-verify") return { type: "face-gate" };
  // A pending session cannot reach the workspace by typing another hash.
  if (currentUser.faceCheckPending) {
    window.history.replaceState(null, "", "#/face-verify");
    return { type: "face-gate" };
  }
  const role = currentUser.role;
  if (path[0] !== role) return { type: "app", role, page: "dashboard" };
  const requestedPage = path[1] || "dashboard";
  const pageName =
    role === "resident" && requestedPage === "history"
      ? "reports"
      : role === "official" && requestedPage === "urgent"
        ? "concerns"
        : requestedPage;
  const pages = {
    resident: ["dashboard", "calendar", "collection", "report", "reports", "hotlines", "notifications", "profile"],
    official: [
      "dashboard",
      "calendar",
      "concerns",
      "assigned",
      "collection",
      "history",
      "announcements",
      "hotlines",
      "notifications",
      "profile",
      "verify",
    ],
    administrator: [
      "dashboard",
      "calendar",
      "reports",
      "assignments",
      "approvals",
      "hotlines",
      "analytics",
      "notifications",
      "users",
      "locations",
      "announcements",
      "roles",
      "activity",
      "verifications",
      "settings",
      "email",
      "profile",
    ],
  };
  const resolvedPage = pages[role]?.includes(pageName) ? pageName : "dashboard";
  if (!canOpenPage(currentUser, resolvedPage)) {
    window.history.replaceState(null, "", routeUrl(role, "dashboard"));
    queueMicrotask(() => toast("That workspace page is not enabled for this role.", "error"));
    return { type: "app", role, page: "dashboard" };
  }
  return { type: "app", role, page: resolvedPage };
}

// The floating account summary is dragged by pointer anywhere on the panel. The
// offset lives outside shared state so live-update re-renders can reapply it.
let profileSummaryOffset = null;

function setupProfileDirtyState() {
  const form = app.querySelector("#profile-form");
  const reset = app.querySelector("[data-profile-reset]");
  if (!form || !reset) return;
  const initial = [...form.elements].filter((field) => field.name).map((field) => ({ field, value: field.value }));
  const sync = () => {
    const dirty = initial.some(({ field, value }) => field.value !== value);
    reset.hidden = !dirty && !profilePhotoFile;
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  reset.addEventListener("click", () => {
    form.reset();
    if (profilePhotoFile) {
      profilePhotoFile = null;
      profilePhotoPreview = null;
      const avatar = app.querySelector(".profile-intro .avatar");
      if (avatar) avatar.outerHTML = userAvatar(currentUser, "large");
    }
    sync();
  });
}

function setupProfileSummaryDrag(panel) {
  const handle = panel.querySelector(".profile-summary-toggle");
  if (!handle) return;
  handle.title = "Drag to move · click to expand or collapse";
  let origin = null;
  let moved = false;
  let suppressClick = false;
  let offset = { x: 0, y: 0 };

  const onMove = (event) => {
    if (!origin) return;
    let dx = event.clientX - origin.x;
    let dy = event.clientY - origin.y;
    if (!moved) {
      if (Math.hypot(dx, dy) < 5) return;
      moved = true;
      panel.classList.add("is-dragging");
      // Freeze the fixed position to explicit left/top so the transform offset
      // starts from a known point and the panel cannot jump when it is committed.
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = `${origin.left}px`;
      panel.style.top = `${origin.top}px`;
    }
    // Clamp the visual offset so the panel stays inside the viewport.
    dx = Math.min(Math.max(dx, -origin.left), window.innerWidth - origin.width - origin.left);
    dy = Math.min(Math.max(dy, -origin.top), window.innerHeight - origin.height - origin.top);
    offset = { x: dx, y: dy };
    // transform is composited, so dragging does not trigger layout on every move.
    panel.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  };

  const onUp = () => {
    if (!origin) return;
    if (moved) {
      // Commit the offset to left/top so a later re-render keeps the position.
      const left = origin.left + offset.x;
      const top = origin.top + offset.y;
      panel.style.transform = "";
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      profileSummaryOffset = { left, top };
      suppressClick = true;
      // A drag may end outside the panel, so its click handler might not run.
      setTimeout(() => (suppressClick = false), 0);
    }
    origin = null;
    moved = false;
    offset = { x: 0, y: 0 };
    panel.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  panel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || window.getComputedStyle(panel).position !== "fixed") return;
    const rect = panel.getBoundingClientRect();
    origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    moved = false;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  // A completed drag must not also fire the collapse/expand action.
  panel.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}

export function render() {
  if (!data) return;
  destroyAnalyticsCharts();
  // Keep expanded per-official override panels expanded when the live update
  // refresh rebuilds the page; the DOM still shows the previous render here.
  rememberOpenPermissionAccounts();
  const route = routeState();
  const previousRouteKey = `${currentRoute?.role}:${currentRoute?.page}`;
  const routeKey = (value) => `${value?.role}:${value?.page}`;
  if (routeKey(currentRoute) !== routeKey(route)) setState({ searchQuery: "" });
  setState({ currentRoute: route });
  if (route.type !== "app" || route.role !== "resident" || route.page !== "report") {
    setMapState({ reportMapExpanded: false });
    setMapState({ reportMapSelection: null });
    reportMap?.remove();
    setMapState({ reportMap: null });
    setMapState({ reportMapElement: null });
    setMapState({ reportMapMarker: null });
  }
  if (modalState?.kind !== "announcement") {
    setMapState({ announcementMapExpanded: false });
    setMapState({ announcementMapSelection: null });
    announcementMap?.remove();
    setMapState({ announcementMap: null });
    setMapState({ announcementMapElement: null });
    setMapState({ announcementMapMarker: null });
  }
  if (modalState?.kind !== "calendar-event") {
    setMapState({ calendarEventMapExpanded: false });
    setMapState({ calendarEventMapSelection: null });
    calendarEventMap?.remove();
    setMapState({ calendarEventMap: null });
    setMapState({ calendarEventMapElement: null });
    setMapState({ calendarEventMapMarker: null });
  }
  if (modalState?.kind !== "location") {
    locationPickerMap?.remove();
    setMapState({
      locationPickerMap: null,
      locationPickerMapElement: null,
      locationPickerMarker: null,
      locationPickerSelection: null,
    });
  }
  if (modalState?.kind !== "announcement-location" && modalState?.kind !== "calendar-event-detail") {
    announcementDetailMaps?.forEach((map) => map?.remove());
    setMapState({ announcementDetailMaps: [] });
    setMapState({ announcementDetailMapElements: [] });
  }
  if (route.type !== "app" || route.role !== "administrator" || route.page !== "locations") {
    locationMap?.remove();
    setMapState({ locationMapExpanded: false, locationMap: null, locationMapElement: null });
  }
  if (route.type === "face-gate") {
    document.documentElement.dataset.theme = "auth";
    app.innerHTML = faceGateMarkup(Boolean(currentUser?.faceEnrolled), currentUser?.faceEnrollmentState === "pending" ? "enroll" : "verify");
    if (modalState) app.insertAdjacentHTML("beforeend", modalMarkup());
    loadOfficialVerificationStatus();
    app.querySelector("#face-gate-title")?.focus?.();
  } else if (currentUser && route.type === "app") {
    if (currentUser.requiresPasswordChange && !modalState && !forcedPasswordDismissed)
      setState({ modalState: { kind: "forced-password" } });
    document.documentElement.dataset.theme = ROLE_THEME[currentUser.role];
    if (window.location.hash !== routeUrl(currentUser.role, route.page)) {
      window.history.replaceState(null, "", routeUrl(currentUser.role, route.page));
    }
    let markup;
    if (route.role === "resident") {
      if (route.page === "dashboard") markup = dashboardResident();
      else if (route.page === "calendar") markup = calendarPage();
      else if (route.page === "collection") markup = collectionResident();
      else if (route.page === "report") markup = reportPage();
      else if (route.page === "reports") markup = reportsPage("resident", route.page);
      else if (route.page === "hotlines") markup = hotlinesPage("resident");
      else if (route.page === "notifications") markup = notificationsPage("resident");
      else markup = profilePage("resident");
    } else if (route.role === "official") {
      if (route.page === "dashboard") markup = dashboardOfficial();
      else if (route.page === "verify") markup = faceVerifyPage();
      else if (route.page === "calendar") markup = calendarPage();
      else if (route.page === "assigned") markup = officialAssignedPage();
      else if (route.page === "collection") markup = collectionOfficial();
      else if (route.page === "concerns" || route.page === "history") markup = reportsPage("official", route.page);
      else if (route.page === "hotlines") markup = hotlinesPage("official");
      else if (route.page === "notifications") markup = notificationsPage("official");
      else if (route.page === "announcements") markup = announcementsPage("official");
      else markup = profilePage("official");
    } else {
      if (route.page === "dashboard") markup = dashboardAdmin();
      else if (route.page === "calendar") markup = calendarPage();
      else if (route.page === "reports") markup = reportsPage("administrator", "reports");
      else if (route.page === "assignments") markup = assignmentsPage();
      else if (route.page === "approvals") markup = approvalsPage();
      else if (route.page === "verifications") markup = verificationsPage();
      else if (route.page === "hotlines") markup = hotlinesPage("administrator");
      else if (route.page === "analytics") markup = analyticsPage();
      else if (route.page === "notifications") markup = notificationsPage("administrator");
      else if (route.page === "users") markup = usersPage();
      else if (route.page === "locations") markup = locationsPage();
      else if (route.page === "announcements") markup = announcementsPage("administrator");
      else if (route.page === "activity") markup = activityLogPage();
      else if (route.page === "roles") markup = rolesPage();
      else if (route.page === "settings") markup = settingsPage();
      else if (route.page === "email") markup = emailPage();
      else markup = profilePage("administrator");
    }
    app.innerHTML = markup;
    const summaryPanel = app.querySelector(".profile-summary-float");
    if (summaryPanel) {
      if (profileSummaryOffset) {
        summaryPanel.style.left = `${profileSummaryOffset.left}px`;
        summaryPanel.style.top = `${profileSummaryOffset.top}px`;
        summaryPanel.style.right = "auto";
        summaryPanel.style.bottom = "auto";
      }
      setupProfileSummaryDrag(summaryPanel);
    }
    if (route.role === "resident" && route.page === "profile") setupProfileDirtyState();
    // The browser restores <details open> across reloads; keep the profile
    // panels closed unless they were opened in this session.
    const facePanel = app.querySelector("#face-panel");
    if (facePanel) facePanel.open = facePanelOpen;
    const idPanel = app.querySelector("#id-panel");
    if (idPanel) idPanel.open = idPanelOpen;
    const emailPanel = app.querySelector("#email-change-panel");
    if (emailPanel) emailPanel.open = emailPanelOpen;
    const passwordPanel = app.querySelector("#password-change-panel");
    if (passwordPanel) passwordPanel.open = passwordPanelOpen;
    if (route.role === "administrator" && route.page === "analytics") {
      initializeAnalyticsCharts(app).catch((error) => {
        console.error("Analytics charts could not be initialized.", error);
        for (const canvas of app.querySelectorAll("canvas[data-analytics-chart]")) {
          const kind = canvas.dataset.analyticsChart;
          app.querySelector(`#${kind}-chart-data`)?.classList.remove("visually-hidden");
          const status = app.querySelector(`#${kind}-chart-status`);
          if (status) status.textContent = "Chart unavailable; data is shown in the table below.";
        }
        toast("Charts could not be loaded. The figures are shown in tables.", "error");
      });
    }
    if (route.role === "administrator" && (route.page === "settings" || route.page === "email")) loadSmtpSettings();
    if (route.role === "administrator" && route.page === "settings") loadVerificationSettings();
    if (route.role === "official" && (route.page === "profile" || route.page === "verify")) loadOfficialVerificationStatus();
    if (route.role === "administrator" && route.page === "activity") {
      loadActivityLog(activityLogState.page).catch((error) => toast(error.message, "error"));
    }
    updatePagination();
    // A render rebuilds the DOM, so put the typed search back before filtering.
    // The admin report box keeps its own query in adminReportFilters.
    const restoredSearch = app.querySelector("[data-search-input]:not([data-admin-report-search])");
    if (restoredSearch && searchQuery) {
      restoredSearch.value = searchQuery;
      restoredSearch.defaultValue = searchQuery;
      refreshSearch(searchQuery);
    }
    const correctionSearchInput = app.querySelector("[data-correction-search]");
    if (correctionSearchInput) {
      correctionSearchInput.value = correctionFilters.query;
      correctionSearchInput.defaultValue = correctionFilters.query;
      const statusSelect = app.querySelector("[data-correction-status-filter]");
      const typeSelect = app.querySelector("[data-correction-type-filter]");
      const dateSelect = app.querySelector("[data-correction-date-filter]");
      if (statusSelect) statusSelect.value = correctionFilters.status;
      if (typeSelect) typeSelect.value = correctionFilters.type;
      if (dateSelect) dateSelect.value = correctionFilters.date;
      refreshSearch(restoredSearch?.value || "");
    }
    if (route.role === "resident" && route.page === "report") {
      renderLocationGate();
      // Re-rendering the same route (e.g. a live update) keeps the existing
      // verdict; only a fresh visit starts a new location check.
      if (`${route.role}:${route.page}` !== previousRouteKey) resolveReportLocation({ announce: false }).catch(() => {});
    }
    if (route.role === "resident" && route.page === "report" && reportMapExpanded) initializeReportMap();
    if (route.role === "administrator" && route.page === "locations" && locationMapExpanded) initializeLocationMap();
    if (modalState?.kind === "location") initializeLocationPickerMap();
    if (modalState?.kind === "announcement" && announcementMapExpanded) initializeAnnouncementMap();
    if (modalState?.kind === "calendar-event" && calendarEventMapExpanded) initializeCalendarEventMap();
    if (modalState) {
      const input = app.querySelector(".modal input:not([type=hidden]), .modal select, .modal textarea");
      const target = input || app.querySelector(".modal #modal-title");
      if (target) requestAnimationFrame(() => target.focus());
    }
  } else {
    document.documentElement.dataset.theme = "auth";
    if (route.type === "register") app.innerHTML = registerMarkup();
    else if (route.type === "forgot-password") app.innerHTML = forgotPasswordMarkup();
    else if (route.type === "reset-password") {
      const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") || "";
      app.innerHTML = resetPasswordMarkup(token);
    } else if (route.type === "verify-recovery") {
      const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") || "";
      app.innerHTML = verifyRecoveryMarkup(token);
    } else if (route.type === "verify-email") {
      const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") || "";
      app.innerHTML = verifyEmailChangeMarkup(token);
    } else app.innerHTML = loginMarkup();
    if (modalState) app.insertAdjacentHTML("beforeend", modalMarkup());
  }
  initializeReportDetailMap();
  initializeAnnouncementDetailMap();
  syncProcessingOverlay();
  setState({ lastKnownHash: window.location.hash });
}

function makeModal(title, body, className = "", subtitle = "") {
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal${className ? ` ${className}` : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header class="modal-head"><div><h2 id="modal-title" tabindex="-1">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></header>
    <div class="modal-content">${body}</div>
  </section></div>`;
}

const OFFICIAL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_OFFICIAL_DAYS = OFFICIAL_DAYS.slice(0, 5);

function availableDayOptions(selectedDays = DEFAULT_OFFICIAL_DAYS) {
  return OFFICIAL_DAYS.map(
    (day) =>
      `<label class="availability-day"><input type="checkbox" name="availableDays" value="${day}" ${selectedDays.includes(day) ? "checked" : ""}><span>${day}</span></label>`,
  ).join("");
}

export function modalMarkup() {
  if (modalState.kind === "activity-detail") {
    const item = modalState.event;
    const body = `<div class="activity-detail-list">${[
      ["Event", item.action],
      ["Actor", `${item.actor} · ${roleLabel(item.role)}`],
      ["When", dateTimeLabel(item.at)],
      ["Result", item.result],
      ["Reason", item.resultReason || "Not recorded"],
      ["Affected record", displayReferenceText(item.affectedId) || "Not recorded"],
      ["Client address", item.clientIp || "Not recorded"],
      ["Source", item.source === "archived" ? `Archived on ${dateTimeLabel(item.archivedAt)}` : "Current log"],
      ["Event ID", item.id],
      ["Details", displayReferenceText(item.detail)],
    ]
      .map(([label, value]) => `<div class="activity-detail-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`)
      .join("")}</div>`;
    return makeModal("Activity event", body);
  }
  if (modalState.kind === "forced-password") {
    const body = `<form id="forced-password-form" class="modal-form"><div class="modal-form-fields"><p class="field-help">Your administrator issued a temporary password. Change it before continuing.</p>${inputField("Temporary password", "currentPassword", "", { type: "password", required: true, autocomplete: "current-password" })}<div class="form-grid">${inputField("New password", "newPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}${inputField("Confirm new password", "confirmPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}</div></div><div class="form-actions"><button class="button" type="submit">Change password</button></div></form>`;
    return makeModal("Change your password", body);
  }
  if (modalState.kind === "user-password") {
    const user = getUser(modalState.id);
    if (!user || user.email === currentUser.email) {
      setState({ modalState: null });
      return "";
    }
    const body = `<form id="user-password-form" class="modal-form"><input type="hidden" name="email" value="${esc(user.email)}">
      <div class="modal-form-fields"><p class="field-help">Approve and generate a temporary password for ${esc(user.name)}. It will be emailed to their primary address and they must change it on next sign-in.</p></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Approve &amp; Generate</button></div></form>`;
    return makeModal(user.resetRequested ? "Approve password reset" : "Reset account password", body);
  }
  if (modalState.kind === "schedule") {
    const schedule = modalState.id ? data.schedules.find((item) => item.id === modalState.id) : null;
    const title = schedule ? "Edit collection schedule" : "Add collection schedule";
    const initialStatus = schedule?.status || "Scheduled";
    const seriesNotice = schedule?.seriesId
      ? `<p class="field-help">This pickup is part of a recurring series. Changes here apply only to ${esc(dateLabel(schedule.date))}, not the other pickups.</p>`
      : "";
    const body = `<form id="schedule-form" class="modal-form" data-initial-status="${esc(initialStatus)}"><input type="hidden" name="id" value="${esc(schedule?.id || "")}">
      <div class="modal-form-fields">${seriesNotice}<div class="form-grid">${selectField("Area", "area", locationAreas(), schedule?.area || locationAreas()[0], { required: true, labels: locationAreaLabels() })}${inputField("Collection date", "date", schedule?.date || todayISO(), { type: "date", required: true, ...(schedule ? {} : { min: todayISO() }) })}${inputField("Waste type", "wasteType", schedule?.wasteType || "", { required: true, placeholder: "e.g. Biodegradable" })}${selectField("Service status", "status", COLLECTION_STATUSES, initialStatus, { required: true })}${inputField("Start time", "start", schedule?.start || "6:00 AM", { required: true })}${inputField("End time", "end", schedule?.end || "9:00 AM", { required: true })}${selectField("Frequency", "frequency", SCHEDULE_FREQUENCIES, schedule?.frequency || "Weekly", { required: true })}${inputField("Repeat until", "recurrenceEnd", schedule?.recurrenceEnd || "", { type: "date", ...(schedule ? {} : { min: todayISO() }) })}${inputField("Collection team", "team", schedule?.team || "Team A · Truck 01")}</div>
        <div class="form-field span-all" id="schedule-status-note-field" hidden>
          <label for="statusNote">Explanation for residents</label>
          <textarea class="textarea" id="statusNote" name="statusNote" maxlength="400" placeholder="e.g. Truck breakdown, flooding along the route, or a public holiday."></textarea>
          <p class="field-help">Required for Delayed and Cancelled. Recorded in the collection history with your name and the time of the change.</p>
        </div>
        <p class="field-help span-all" id="schedule-reschedule-hint" hidden>Set the collection date and times above to the replacement pickup. The original and replacement details will both appear in the collection history.</p>
        <p class="field-help">Weekly, bi-weekly, and monthly schedules create a separate pickup for every date. Leave “Repeat until” empty to cover the next 12 months.</p></div>
      <div class="form-actions">${schedule ? `<button class="button danger" type="button" data-action="delete-schedule" data-id="${esc(schedule.id)}">Remove schedule</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save schedule</button></div></form>`;
    return makeModal(title, body);
  }
  if (modalState.kind === "schedule-detail") {
    const schedule = data.schedules.find((item) => item.id === modalState.id);
    if (!schedule) {
      setState({ modalState: null });
      return "";
    }
    const latest = (schedule.history || []).at(-1);
    const statusNote =
      latest && ["Delayed", "Cancelled", "Rescheduled"].includes(schedule.status) && latest.note
        ? `<div class="notice-bar"><strong>${esc(schedule.status)}</strong><span>${esc(latest.note)}</span></div>`
        : "";
    const body = `<div class="modal-form-fields schedule-detail-fields">
      <div class="status-line">${statusPill(schedule.status)}<span class="muted small">${esc(schedule.area)} · ${esc(schedule.zone)}</span></div>
      <ul class="plain-list schedule-detail-list">
        <li><span>Service</span><strong>${esc(schedule.wasteType)}</strong></li>
        <li><span>Collection date</span><strong>${esc(dateLabel(schedule.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</strong></li>
        <li><span>Collection window</span><strong>${esc(schedule.start)} – ${esc(schedule.end)}</strong></li>
        <li><span>Collection team</span><strong>${esc(schedule.team)}</strong></li>
      </ul>
      ${statusNote}
      <div class="section-heading schedule-history-heading"><div><h2>Collection history</h2><p>Previous status, new status, who changed it, and why.</p></div></div>
      ${scheduleHistoryMarkup(schedule.history)}
    </div>
    `;
    return makeModal(`Collection details · ${schedule.id}`, body, "modal--schedule-details");
  }
  if (modalState.kind === "location") {
    const location = data.locations.find((item) => item.id === modalState.id);
    const body = `<form id="location-form" class="modal-form"><input type="hidden" name="id" value="${esc(location?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${inputField("Barangay", "barangay", location?.barangay || "Palsara", { required: true, maxLength: 100 })}${inputField("Purok", "purok", location?.purok || "", { required: true, maxLength: 100 })}${inputField("Landmark", "landmark", location?.landmark || "", { maxLength: 160, placeholder: "Optional" })}</div>
        <section class="location-map-picker" aria-labelledby="location-map-picker-title">
          <div class="location-map-picker-heading"><div><h3 id="location-map-picker-title">Pin this community location</h3><p class="field-help">Click the map to place the pin, then drag it to the precise spot. A pin is required to save.</p></div><button class="button secondary small" type="button" data-action="clear-location-map-pin" ${location?.latitude != null && location?.longitude != null ? "" : "hidden"}>Clear pin</button></div>
          <input type="hidden" id="location-latitude" name="latitude" value="${esc(location?.latitude ?? "")}">
          <input type="hidden" id="location-longitude" name="longitude" value="${esc(location?.longitude ?? "")}">
          <div class="report-map-canvas location-map-picker-canvas" id="location-map-picker" role="application" aria-label="Map picker. Click to place the community location pin or drag the pin to adjust it."></div>
          <p class="map-status location-map-picker-status" id="location-map-picker-status" role="status" aria-live="polite">${location?.latitude != null && location?.longitude != null ? `Saved pin at ${esc(Number(location.latitude).toFixed(6))}, ${esc(Number(location.longitude).toFixed(6))}.` : "No pin selected. Click the map to place one before saving."}</p>
        </section>
      </div>
      <div class="form-actions">${location ? `<button class="button danger" type="button" data-action="delete-location" data-id="${esc(location.id)}">Remove location</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save location</button></div></form>`;
    return makeModal(location ? "Edit community location" : "Add community location", body);
  }
  if (modalState.kind === "recycling") {
    const item = data.recyclingLocations.find((record) => record.id === modalState.id);
    const body = `<form id="recycling-form" class="modal-form"><input type="hidden" name="id" value="${esc(item?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${inputField("Business or site name", "name", item?.name || "", { required: true, maxLength: 120 })}${inputField("Barangay", "barangay", item?.barangay || "Palsara", { required: true, maxLength: 100 })}${inputField("Street or address", "street", item?.street || "", { required: true, maxLength: 160 })}${inputField("Purok", "purok", item?.purok || "", { maxLength: 100, placeholder: "Optional" })}${inputField("Nearby landmark", "landmark", item?.landmark || "", { maxLength: 160, placeholder: "Optional" })}${inputField("Contact number", "phone", item?.phone || "", { type: "tel", maxLength: 40, placeholder: "Optional" })}${inputField("Accepted materials", "materials", item?.materials || "", { required: true, maxLength: 500, placeholder: "e.g. PET bottles, cardboard, aluminum" })}${inputField("Opening hours", "hours", item?.hours || "", { maxLength: 120, placeholder: "Optional" })}<label class="checkbox-field span-all"><input name="active" type="checkbox" ${item?.active === false ? "" : "checked"}><span><strong>Show this listing to residents</strong></span></label></div></div>
      <div class="form-actions">${item ? `<button class="button danger" type="button" data-action="delete-recycling" data-id="${esc(item.id)}">Remove listing</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Save listing</button></div></form>`;
    return makeModal(item ? "Edit recycling location" : "Add recycling location", body);
  }
  if (modalState.kind === "announcement") {
    const item = data.announcements.find((record) => record.id === modalState.id);
    const needsApproval = currentUser.role === "official";
    const body = `<form id="announcement-form" class="modal-form"><input type="hidden" name="id" value="${esc(item?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${inputField("Title", "title", item?.title || "", { required: true, maxLength: 120 })}${inputField("Publish date", "date", item?.date || todayISO(), { type: "date", required: true, ...(item ? {} : { min: todayISO() }) })}<div class="form-field span-all"><label for="announcement-detail">Message *</label><textarea class="textarea" id="announcement-detail" name="detail" required maxlength="1000">${esc(item?.detail || "")}</textarea></div>
        <div class="form-field span-all announcement-map-picker">
          <label class="checkbox-field"><input type="checkbox" id="announcement-is-event" name="isEvent" ${announcementMapExpanded ? "checked" : ""}><span><strong>This announcement is for an event</strong><span class="muted small">Add a map pin so residents know where it will be held.</span></span></label>
          <input type="hidden" id="announcement-latitude" name="latitude" value="${esc(announcementMapSelection?.latitude ?? "")}">
          <input type="hidden" id="announcement-longitude" name="longitude" value="${esc(announcementMapSelection?.longitude ?? "")}">
          <div class="report-map-region" id="announcement-map-region" ${announcementMapExpanded ? "" : "hidden"}>
            <div class="button-row"><button class="button secondary" type="button" data-action="clear-announcement-map-pin" ${announcementMapSelection ? "" : "hidden"}>Clear pin</button></div>
            <p class="visually-hidden" id="announcement-map-status" role="status" aria-live="polite"></p>
            <div class="report-map-canvas" id="announcement-map" role="application" aria-label="OpenStreetMap. Click to place the event location pin, or drag the pin to adjust it."></div>
            <p class="field-help">Click the map to place the pin, or drag it to adjust.</p>
          </div>
        </div>
      </div></div>
      <div class="form-actions">${item ? `<button class="button danger" type="button" data-action="delete-announcement" data-id="${esc(item.id)}">Remove announcement</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${item ? (needsApproval ? "Save and send for approval" : "Save changes") : needsApproval ? "Send for approval" : "Publish announcement"}</button></div></form>`;
    return makeModal(item ? "Edit announcement" : "New announcement", body);
  }
  if (modalState.kind === "announcement-location") {
    const item = data.announcements.find((record) => record.id === modalState.id);
    if (!item || !item.isEvent || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
      setState({ modalState: null });
      return "";
    }
    const isEvent = Boolean(item.isEvent);
    const statusVariant = item.approvalStatus === "pending" ? "pending" : item.approvalStatus === "declined" ? "declined" : "approved";
    const statusLabel = item.approvalStatus === "pending" ? "Pending" : item.approvalStatus === "declined" ? "Declined" : "Approved";
    const accent = statusVariant === "approved" ? "var(--success)" : statusVariant === "pending" ? "var(--warning)" : "var(--danger)";
    const lat = item.latitude.toFixed(5);
    const lng = item.longitude.toFixed(5);
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.latitude},${item.longitude}`)}`;
    const body = `<div class="content-stack">
      <div class="event-detail-card" style="--card-accent: ${accent};">
        <div class="event-card-top">
          <span class="event-card-category">${isEvent ? "Event" : "Announcement"}</span>
          <span class="event-card-status event-card-status--${statusVariant}">${esc(statusLabel)}</span>
        </div>
        <h4 class="event-card-title">${esc(item.title)}</h4>
        <div class="event-card-meta">
          <span class="event-card-location">${icon("pin", "event-card-icon")}${lat}, ${lng}</span>
        </div>
        <div class="event-card-map-panel">
          <div id="announcement-detail-map" class="report-map-canvas report-detail-map" data-latitude="${item.latitude}" data-longitude="${item.longitude}" role="region" aria-label="${currentUser?.role === "official" ? "Map with Palsara context, approximate purok locations, and the event pin" : "Map centered on this event's location"}"></div>
          <p class="map-status" id="announcement-detail-map-status" role="status" aria-live="polite">Pin at ${lat}, ${lng}.</p>
        </div>
      </div>
      <div class="form-actions"><a class="button secondary" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a><button class="button secondary" type="button" data-action="close-modal">Close</button></div>
    </div>`;
    return makeModal("Event location", body, "modal--event-details");
  }
  if (modalState.kind === "calendar-event") {
    const date = modalState.date || todayISO();
    const isAdmin = currentUser?.role === "administrator";
    const body = `<form id="calendar-event-form" class="modal-form"><input type="hidden" name="date" value="${esc(date)}">
      <div class="modal-form-fields"><p class="field-help"><strong>${esc(dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</strong> · ${isAdmin ? "This event is added to the calendar right away." : "Your request is sent to the administrator for approval."}</p><div class="form-grid">${inputField("Event title", "title", "", { required: true, maxLength: 120 })}</div><div class="form-field span-all"><label for="calendar-event-detail">Details *</label><textarea class="textarea" id="calendar-event-detail" name="detail" required maxlength="1000" placeholder="What happens, where, and at what time?"></textarea></div><div class="form-field span-all calendar-event-map-picker"><label class="checkbox-field"><input type="checkbox" id="calendar-event-has-location" name="hasLocation" ${calendarEventMapExpanded ? "checked" : ""}><span><strong>Add event location</strong><span class="muted small">Place a map pin so people know where it will be held.</span></span></label><input type="hidden" id="calendar-event-latitude" name="latitude" value="${esc(calendarEventMapSelection?.latitude ?? "")}"><input type="hidden" id="calendar-event-longitude" name="longitude" value="${esc(calendarEventMapSelection?.longitude ?? "")}"><div class="form-field span-all calendar-event-map-region" id="calendar-event-map-region" ${calendarEventMapExpanded ? "" : "hidden"}><div class="button-row"><button class="button secondary" type="button" data-action="clear-calendar-event-map-pin" ${calendarEventMapSelection ? "" : "hidden"}>Clear pin</button></div><p class="visually-hidden" id="calendar-event-map-status" role="status" aria-live="polite"></p><div class="report-map-canvas" id="calendar-event-map" role="application" aria-label="OpenStreetMap. Click to place the event location pin, or drag the pin to adjust it."></div><p class="field-help">Click the map to place the pin, or drag it to adjust.</p></div></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${isAdmin ? "Add event" : "Submit for approval"}</button></div></form>`;
    return makeModal(isAdmin ? "Add calendar event" : "Request a calendar event", body);
  }
  if (modalState.kind === "calendar-event-detail") {
    const date = modalState.date || todayISO();
    const events = calendarEventsForDate(date);
    const eventList = events.length
      ? events
          .map((event) => {
            const hasMap =
              ((event.kind === "Announcement" && event.isEvent) || event.kind === "Event") &&
              Number.isFinite(event.latitude) &&
              Number.isFinite(event.longitude);
            let badgeLabel;
            let badgeVariant;
            let leftBorder;
            if (event.kind === "Event") {
              badgeLabel = calendarStatusLabel(event.status);
              badgeVariant = event.status === "pending" ? "pending" : event.status === "declined" ? "declined" : "approved";
              leftBorder = event.status === "pending" ? "var(--warning)" : event.status === "declined" ? "var(--danger)" : "var(--accent)";
            } else if (event.kind === "Announcement" && event.isEvent) {
              badgeLabel = "Approved";
              badgeVariant = "approved";
              leftBorder = "var(--success)";
            } else {
              badgeLabel = "Approved";
              badgeVariant = "approved";
              leftBorder = "var(--accent)";
            }
            const detailText = String(event.detail || "");
            const detailParts = detailText
              .split(" · ")
              .map((p) => p.trim())
              .filter(Boolean);
            const timePart = detailParts.find((p) => /AM|PM/.test(p));
            const locationPart = detailParts.filter((p) => !/AM|PM/.test(p)).join(" · ");
            return `<div class="event-detail-card" style="--card-accent: ${leftBorder};">
          <div class="event-card-top">
            <span class="event-card-category">${esc(event.kind)}</span>
            <span class="event-card-status event-card-status--${badgeVariant}">${esc(badgeLabel)}</span>
          </div>
          <h4 class="event-card-title">${esc(event.title)}</h4>
          <div class="event-card-meta">
            ${timePart ? `<span class="event-card-time">${icon("clock", "event-card-icon")}${esc(timePart)}</span>` : ""}
            ${locationPart ? `<span class="event-card-location">${icon("pin", "event-card-icon")}${esc(locationPart)}</span>` : ""}
          </div>
          ${!timePart && !locationPart && detailText ? `<p class="event-card-body">${esc(detailText)}</p>` : ""}
          ${hasMap ? `<div class="event-card-map-panel"><div id="announcement-detail-map-${event.id}" class="report-map-canvas report-detail-map" data-latitude="${event.latitude}" data-longitude="${event.longitude}" role="region" aria-label="${currentUser?.role === "official" ? "Map with Palsara context, approximate purok locations, and the event pin" : "Map centered on this event's location"}"></div><p class="map-status" id="announcement-detail-map-status-${event.id}" role="status" aria-live="polite">Map pin at ${event.latitude.toFixed(6)}, ${event.longitude.toFixed(6)}.</p><a class="button secondary small" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${event.latitude},${event.longitude}`)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div>` : ""}
        </div>`;
          })
          .join("")
      : `<div class="event-detail-empty"><strong>No events</strong><p>Nothing is scheduled on ${esc(dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}.</p></div>`;
    const body = `<div class="event-detail-modal"><div class="event-detail-head"><h3 class="event-detail-date-title">${esc(dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</h3></div><div class="event-detail-list">${eventList}</div></div>`;
    return makeModal("Event details", body, "modal--event-details");
  }
  if (modalState.kind === "report-reopen") {
    const report = data.reports.find((item) => item.id === modalState.id);
    if (!report || report.status !== "Resolved" || report.userEmail !== currentUser.email) {
      setState({ modalState: null });
      return "";
    }
    const body = `<form id="report-reopen-form" class="modal-form"><input type="hidden" name="reportId" value="${esc(report.id)}">
      <div class="modal-form-fields"><p class="field-help">Tell barangay staff why ${esc(displayReportId(report))} needs another look. It returns to the concern queue with your reason.</p><div class="form-field span-all"><label for="report-reopen-reason">Reason *</label><textarea class="textarea" id="report-reopen-reason" name="reason" required maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Request reopening</button></div></form>`;
    return makeModal("Request reopening", body);
  }
  if (modalState.kind === "calendar-decline") {
    const body = `<form id="calendar-decline-form" class="modal-form"><input type="hidden" name="id" value="${esc(modalState.id || "")}">
      <div class="modal-form-fields"><p class="field-help">Tell the barangay official why this event was rejected. The reason is sent to them along with the decision.</p><div class="form-field span-all"><label for="calendar-decline-reason">Reason *</label><textarea class="textarea" id="calendar-decline-reason" name="reason" required maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Reject event</button></div></form>`;
    return makeModal("Reject event request", body);
  }
  if (modalState.kind === "announcement-decline") {
    const body = `<form id="announcement-decline-form" class="modal-form"><input type="hidden" name="id" value="${esc(modalState.id || "")}">
      <div class="modal-form-fields"><p class="field-help">Tell the barangay official why this announcement was declined. The reason is shown to them with the decision.</p><div class="form-field span-all"><label for="announcement-decline-reason">Reason *</label><textarea class="textarea" id="announcement-decline-reason" name="reason" required maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Decline announcement</button></div></form>`;
    return makeModal("Decline announcement", body);
  }
  if (modalState.kind === "forgot-password") {
    const body = `<form id="forgot-password-form" class="modal-form"><div class="modal-form-fields"><div class="form-field span-all"><label for="forgot-email">Email address</label><p class="field-help">Enter the email address tied to your account. If an account exists, your barangay administrator will be notified to issue a reset.</p><input class="input" id="forgot-email" name="email" type="email" required autocomplete="email"></div></div><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Send reset request</button></div></form>`;
    return makeModal("Forgot password", body);
  }
  if (modalState.kind === "verify-id") {
    const integrated = currentUser?.role === "official";
    const idTypeItems = Object.keys(ID_TYPE_LABELS);
    const titles = integrated
      ? ["Upload ID", "Scan ID", "Face capture", "Face match", "Personal info", "Final result"]
      : ["Upload ID", "Scan ID", "Personal info", "Final result"];
    idStepCount = titles.length;
    const steps = titles
      .map((label, index) => `<div class="wizard-step${index === 0 ? " current" : ""}" data-step="${index + 1}"><strong>${index + 1}</strong><span>${label}</span></div>`)
      .join('<span class="wizard-divider"></span>');
    const personalStep = integrated ? 5 : 3;
    const finalStep = integrated ? 6 : 4;
    const body = `<form id="id-submit-form" class="modal-form id-verify-form" novalidate><div class="modal-form-fields">
      <div class="wizard-progress" aria-label="Step 1 of ${idStepCount}">${steps}</div>

      <section class="id-step span-all" data-step="1">
        <div class="id-scan-card">
          <h3>1. Upload your ID</h3>
          <p class="field-help">Supported IDs: PhilSys ID, Driver's License, Passport, and UMID. Use your camera or upload a clear photo of the front. Scanning sends the image to the OCR provider.</p>
          <div class="id-scan-actions">
            <button class="button" type="button" data-action="id-scan-camera">${icon("image")} Use camera</button>
            <label class="button secondary" for="id-scan-file">${icon("upload")} Upload photo<input class="visually-hidden" id="id-scan-file" type="file" accept="image/jpeg,image/png"></label>
          </div>
          <div class="id-scan-camera" id="id-scan-camera" hidden>
            <video id="id-scan-video" playsinline muted></video>
            <div class="id-scan-actions">
              <button class="button" type="button" data-action="id-scan-capture">Capture photo</button>
              <button class="button secondary" type="button" data-action="id-scan-close">Cancel</button>
            </div>
          </div>
          <div class="id-scan-results" id="id-scan-results" hidden>
            <div class="id-scan-preview"><img id="id-scan-preview-image" alt="Preview of the scanned ID"></div>
          </div>
          <p class="field-help" id="id-ocr-status" role="status" aria-live="polite"></p>
          <div class="id-scan-loading" id="id-scan-loading" hidden><span class="id-scan-spinner" aria-hidden="true"></span></div>
        </div>
        <div class="form-grid mt-16">
          <div class="form-field span-all"><span class="field"><label for="id-back-photo">Back of ID (optional)</label><label class="upload-box id-back-upload" for="id-back-photo">${icon("upload")}<span class="id-back-prompt"><strong>Add the back of your ID</strong><span>JPG or PNG. This side is optional.</span></span><img class="id-side-preview" id="id-back-preview" alt="Preview of the back of your ID" hidden><input class="visually-hidden" id="id-back-photo" name="photos" type="file" accept="image/jpeg,image/png"></label><button class="text-button id-back-remove" type="button" data-action="id-back-remove" hidden>Remove back photo</button><span class="field-help id-back-file-name" id="id-back-file-name" hidden></span></span></div>
        </div>
      </section>

      <section class="id-step span-all" data-step="2" hidden>
        <h3>2. Scan and extract</h3>
        <p class="field-help">We check whether the required details are readable and complete. If the scan is poor, retry with a clearer photo.</p>
        <div class="id-check-result" id="id-check-result"></div>
        <div class="form-actions"><button class="button secondary" type="button" data-action="id-scan-retry">Retry scan</button></div>
      </section>

      ${integrated ? `
      <section class="id-step span-all" data-step="3" hidden>
        <div class="id-face-capture" id="id-face-capture">
          <h3>3. Face registration</h3>
          <p class="field-help">The camera turns on after the ID scan. Look straight, turn left and right, move closer or slightly farther away, keep your whole face visible, and maintain proper lighting.</p>
          <div class="face-video-frame" data-camera-state="idle" data-capturing="false">
            <video id="id-selfie-video" class="face-video" autoplay playsinline muted aria-hidden="true"></video>
            <span class="face-live" aria-hidden="true"><span class="face-live-dot"></span>Live preview</span>
            <div class="face-camera-state" id="id-face-camera-state" role="status">
              <span class="face-camera-icon" aria-hidden="true">${icon("cameraOff", "face-camera-icon-svg")}</span>
              <strong class="face-camera-title">Camera is off</strong>
              <span class="face-camera-detail">Start the capture to turn on your camera.</span>
              <span class="face-camera-note">The preview stays on this device.</span>
            </div>
            <div class="face-guide" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
            <div class="face-hud" aria-hidden="true">
              <div class="face-hud-progress" id="id-face-hud-progress"><span></span><span></span><span></span><span></span></div>
              <span class="face-hud-chip" id="id-face-hud-chip">Centre your face</span>
              <p class="face-hud-instruction" id="id-face-hud-instruction">Look straight at the camera.</p>
            </div>
            <button class="face-hud-cancel" type="button" data-action="id-face-cancel" hidden>Cancel</button>
          </div>
          <p class="field-help" id="id-face-stage" role="status" aria-live="polite">Press start when you are ready.</p>
          <div class="form-actions">
            <button class="button" type="button" id="id-face-start" data-action="id-face-start">Start face capture</button>
            <button class="button secondary" type="button" id="id-face-cancel" data-action="id-face-cancel" hidden>Cancel</button>
          </div>
        </div>
      </section>
      <section class="id-step span-all" data-step="4" hidden>
        <h3>4. Face matching</h3>
        <p class="field-help">We compare the captured face with the photograph on your uploaded ID.</p>
        <p class="field-help" id="id-face-result" role="status" aria-live="polite">Not checked yet.</p>
        <div class="form-actions"><button class="button secondary" type="button" id="id-face-retry" data-action="id-face-retry" hidden>Retake face capture</button></div>
      </section>` : ""}

      <section class="id-step span-all" data-step="${personalStep}" hidden>
        <h3>${personalStep}. Personal information</h3>
        <p class="field-help">Filled from the ID. Review every field before continuing.</p>
        <div class="id-details-grid">
          ${selectField("ID type", "idType", idTypeItems, "philsys", { required: true, labels: ID_TYPE_LABELS })}
          ${inputField("ID number", "idNumber", "", { required: true, maxLength: 40, autocomplete: "off", placeholder: "As printed on the card" })}
          ${inputField("Full name (as printed)", "idFullName", currentUser.name, { required: true, maxLength: 120, autocomplete: "name" })}
          <div class="form-field"><label for="idBirthDate">Birth date *</label><input class="input" id="idBirthDate" name="idBirthDate" type="date"></div>
          <div class="form-field"><label for="idAge">Age</label><input class="input" id="idAge" type="text" readonly value="—" aria-describedby="id-age-help"><span class="field-help" id="id-age-help">Calculated from the birth date.</span></div>
          <div class="form-field span-all"><label for="idAddress">Address</label><input class="input" id="idAddress" name="idAddress" maxlength="160" placeholder="As printed on the ID"></div>
          <div class="form-field"><label for="idExpirationDate">Expiration date (if applicable)</label><input class="input" id="idExpirationDate" name="idExpirationDate" type="date"></div>
        </div>
        <div class="form-field span-all" id="id-manual-photo-field" hidden><label for="id-manual-photo">Front of ID *</label><input class="input" id="id-manual-photo" type="file" accept="image/jpeg,image/png"><span class="field-help">Attach the front photo to submit details you entered yourself.</span></div>
      </section>

      <section class="id-step span-all" data-step="${finalStep}" hidden>
        <h3>${finalStep}. Final verification result</h3>
        <div class="verify-result" id="id-final-result"></div>
        <label class="settings-toggle"><input type="checkbox" name="consent" value="1"> <span>I consent to CommUnity storing this ID to confirm my identity. Only administrators can see it, and I can delete it at any time from my profile.</span></label>
        <p class="field-help">An administrator reviews the image and the number before the verified badge appears.</p>
      </section>
    </div>
    <div class="form-actions id-step-actions">
      <button class="button secondary" type="button" data-action="id-step-back" hidden>Back</button>
      <button class="text-button" type="button" data-action="id-step-manual" hidden>Enter details manually</button>
      <button class="button" type="button" data-action="id-step-next">Continue</button>
      <button class="button" type="button" data-action="id-step-submit" hidden>Submit for review</button>
    </div></form>`;
    idStep = 1;
    return makeModal(integrated ? "Verify your ID and face" : "Verify your ID", body, "id-verify-modal");
  }
  if (modalState.kind === "id-image") {
    const item = (data.verificationQueue || []).find((entry) => entry.userId === modalState.id);
    if (!item) {
      setState({ modalState: null });
      return "";
    }
    return makeModal(`${item.name}'s ID`, idImageModalBody(item), "id-image-modal", "Review both sides and the submitted details before deciding.");
  }
  if (modalState.kind === "clear-face") {
    const user = modalState.id ? getUser(modalState.id) : null;
    if (!user) {
      setState({ modalState: null });
      return "";
    }
    const body = `<form id="clear-face-form" class="modal-form"><input type="hidden" name="email" value="${esc(user.email)}">
      <div class="modal-form-fields"><p class="field-help">This removes ${esc(user.name)}'s enrolled face reference and duty-check timestamp. They will need to enroll again at the office PC. Use this only when the ordinary check keeps failing.</p><div class="form-field span-all"><label for="clear-face-reason">Reason *</label><textarea class="textarea" id="clear-face-reason" name="reason" required maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Clear face reference</button></div></form>`;
    return makeModal("Clear face reference", body);
  }
  if (modalState.kind === "reject-id") {
    const item = (data.verificationQueue || []).find((entry) => entry.userId === modalState.id);
    if (!item) {
      setState({ modalState: null });
      return "";
    }
    const body = `<form id="id-reject-form" class="modal-form"><input type="hidden" name="userId" value="${esc(item.userId)}">
      <div class="modal-form-fields"><p class="field-help">Tell ${esc(item.name)} why this ID cannot be approved. The reason is shown to them so they can fix it and submit again.</p><div class="form-field span-all"><label for="id-reject-reason">Reason *</label><textarea class="textarea" id="id-reject-reason" name="note" required minlength="5" maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Reject ID</button></div></form>`;
    return makeModal("Reject ID", body);
  }
  if (modalState.kind === "deactivate") {
    const user = modalState.id ? getUser(modalState.id) : null;
    if (!user) {
      setState({ modalState: null });
      return "";
    }
    const body = `<form id="deactivate-form" class="modal-form"><input type="hidden" name="email" value="${esc(user.email)}">
      <div class="modal-form-fields"><p class="field-help">Why is ${esc(user.name)} being deactivated? The reason is recorded with the account.</p><div class="form-field span-all"><label for="deactivate-reason">Reason *</label><textarea class="textarea" id="deactivate-reason" name="reason" required maxlength="500"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button danger" type="submit">Deactivate account</button></div></form>`;
    return makeModal("Deactivate account", body);
  }
  if (modalState.kind === "hotline") {
    const item = modalState.id ? (data.hotlines || []).find((hotline) => hotline.id === modalState.id) : null;
    if (modalState.id && !item) {
      setState({ modalState: null });
      return "";
    }
    const draftNote =
      item && !item.published
        ? `<p class="notice-bar field-help hotline-draft-note"><span>Draft</span><strong>This hotline is hidden until you publish it.</strong></p>`
        : "";
    const manageActions = item
      ? `<div class="hotline-manage-actions"><button class="button secondary small" type="button" data-action="verify-hotline" data-id="${esc(item.id)}">Mark as verified</button><button class="button danger small" type="button" data-action="delete-hotline" data-id="${esc(item.id)}">Remove hotline</button></div>`
      : "";
    const body = `<form id="hotline-form" class="modal-form"><input type="hidden" name="id" value="${esc(item?.id || "")}">
      <div class="modal-form-fields">${draftNote}${manageActions}<div class="form-grid hotline-form-grid">
        ${inputField("Hotline name", "name", item?.name || "", { required: true, maxLength: 120, placeholder: "e.g. Palsara Barangay Police Station", className: "span-all" })}
        ${selectField("Category", "category", HOTLINE_CATEGORIES, item?.category || HOTLINE_CATEGORIES[0], { required: true })}
        ${selectField("Availability", "status", HOTLINE_STATUSES, item?.status || "Active", { required: true, labels: HOTLINE_STATUS_LABELS })}
        ${inputField("Contact number", "contactNumber", item?.contactNumber || "", { type: "tel", required: true, maxLength: 40, placeholder: "e.g. 0917 000 0000" })}
        ${inputField("Alternate number", "alternativeContactNumber", item?.alternativeContactNumber || "", { type: "tel", maxLength: 40, placeholder: "Optional" })}
        ${inputField("Office address", "officeAddress", item?.officeAddress || "", { maxLength: 200, placeholder: "Optional", className: "span-all" })}
        ${inputField("Operating hours", "operatingHours", item?.operatingHours || "", { maxLength: 120, placeholder: "e.g. 24 hours" })}
        <div class="form-field"><label for="hotline-verified">Verification date</label><input class="input" id="hotline-verified" type="text" value="${esc(item?.verifiedAt ? dateTimeLabel(item.verifiedAt) : "Not yet verified")}" disabled><span class="field-help">Recorded automatically when you mark the hotline as verified.</span></div>
        <div class="form-field span-all"><label for="hotline-description">Short description</label><textarea class="textarea" id="hotline-description" name="description" maxlength="300" rows="3" placeholder="What should residents call this number for?">${esc(item?.description || "")}</textarea><span class="field-help">Shown on the hotline card to help residents choose the right number.</span></div>
      </div></div>
      <div class="form-actions hotline-form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button secondary" type="submit" data-publish="false">Save as Draft</button><button class="button" type="submit" data-publish="true">Publish Hotline</button></div></form>`;
    return makeModal(item ? "Edit hotline" : "Add hotline", body);
  }
  if (modalState.kind === "hotline-correction") {
    const item = (data.hotlines || []).find((hotline) => hotline.id === modalState.id);
    if (!item) {
      setState({ modalState: null });
      return "";
    }
    const body = `<form id="hotline-correction-form" class="modal-form"><input type="hidden" name="hotlineId" value="${esc(item.id)}">
      <div class="modal-form-fields"><p class="field-help">Correct <strong>${esc(item.name)}</strong>. An administrator reviews the change before the directory is updated.</p><div class="form-grid">
        ${inputField("Current number", "currentNumber", item.contactNumber, { readonly: true })}
        ${inputField("Corrected contact number", "contactNumber", item.contactNumber, { type: "tel", required: true, maxLength: 40 })}
        ${inputField("Corrected alternate number", "alternativeContactNumber", item.alternativeContactNumber || "", { type: "tel", maxLength: 40, placeholder: "Optional" })}
      </div>
      <div class="form-field span-all"><label for="hotline-correction-reason">Reason for correction *</label><textarea class="textarea" id="hotline-correction-reason" name="reason" required maxlength="500" placeholder="e.g. The old number is disconnected; this is the new desk line."></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Submit correction</button></div></form>`;
    return makeModal("Suggest a correction", body);
  }
  if (modalState.kind === "hotline-suggestion") {
    const body = `<form id="hotline-suggestion-form" class="modal-form">
      <div class="modal-form-fields"><p class="field-help">Suggest a contact that is missing from the directory. An administrator reviews it and publishes it as a draft.</p><div class="form-grid">
        ${inputField("Hotline name", "name", "", { required: true, maxLength: 120 })}
        ${selectField("Category", "category", HOTLINE_CATEGORIES, HOTLINE_CATEGORIES[0], { required: true })}
        ${inputField("Contact number", "contactNumber", "", { type: "tel", required: true, maxLength: 40 })}
        ${inputField("Alternate number", "alternativeContactNumber", "", { type: "tel", maxLength: 40, placeholder: "Optional" })}
        ${inputField("Office address", "officeAddress", "", { maxLength: 200, placeholder: "Optional" })}
        ${inputField("Operating hours", "operatingHours", "", { maxLength: 120, placeholder: "e.g. 24 hours" })}
      </div>
      <div class="form-field span-all"><label for="hotline-suggestion-description">Short description</label><textarea class="textarea" id="hotline-suggestion-description" name="description" maxlength="300"></textarea></div>
      <div class="form-field span-all"><span class="field"><label for="hotline-suggestion-support">Supporting information (optional)</label><label class="upload-box supporting-upload" for="hotline-suggestion-support">${icon("upload")}<strong>Drag and drop a file here, or click to upload</strong><span>Supported formats: JPG, PNG, PDF (Max 2MB)</span><input class="visually-hidden" id="hotline-suggestion-support" type="file" name="supportingFile" accept=".jpg,.jpeg,.png,.pdf"></label><span class="field-help supporting-file-name" data-supporting-file-name hidden></span></span></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">Submit suggestion</button></div></form>`;
    return makeModal("Suggest a contact", body);
  }
  if (modalState.kind === "hotline-correction-detail") {
    const item = (data.hotlineCorrections || []).find((correction) => correction.id === modalState.id);
    if (!item) {
      setState({ modalState: null });
      return "";
    }
    const proposed = Object.entries(item.proposed || {})
      .filter(([field]) => field !== "supportingFile")
      .map(([field, value]) => `<li><span>${esc(HOTLINE_FIELD_LABELS[field] || field)}</span><strong>${esc(value)}</strong></li>`)
      .join("");
    const statusLabel = item.status === "pending" ? "Pending" : item.status === "approved" ? "Approved" : "Rejected";
    const supporting = correctionSupportingFile(item);
    const body = `<div class="modal-form-fields"><p class="field-help">${item.kind === "suggestion" ? "New contact suggestion" : "Hotline correction"} · ${esc(statusLabel)}</p><ul class="plain-list hotline-review-list">${proposed || "<li>No fields recorded</li>"}</ul><div class="notice-bar"><span>Reason</span><strong>${esc(item.reason || "—")}</strong></div>${supporting ? `<div class="notice-bar"><span>Supporting information</span><a href="${esc(supporting.url)}" target="_blank" rel="noopener">${esc(supporting.name)}</a></div>` : ""}${item.reviewNote ? `<div class="notice-bar"><span>Admin feedback</span><strong>${esc(item.reviewNote)}</strong></div>` : ""}</div>`;
    return makeModal("Correction request details", body);
  }
  if (modalState.kind === "hotline-correction-review") {
    const item = (data.hotlineCorrections || []).find((correction) => correction.id === modalState.id);
    if (!item) {
      setState({ modalState: null });
      return "";
    }
    const decision = modalState.decision === "rejected" ? "rejected" : "approved";
    const target = (data.hotlines || []).find((hotline) => hotline.id === item.hotlineId);
    const proposed = Object.entries(item.proposed || {})
      .filter(([field]) => field !== "supportingFile")
      .map(([field, value]) => `<li><span>${esc(HOTLINE_FIELD_LABELS[field] || field)}</span><strong>${esc(value)}</strong></li>`)
      .join("");
    const supporting = correctionSupportingFile(item);
    const body = `<form id="hotline-correction-review-form" class="modal-form"><input type="hidden" name="id" value="${esc(item.id)}"><input type="hidden" name="decision" value="${decision}">
      <div class="modal-form-fields"><p class="field-help">${item.kind === "suggestion" ? "New contact suggestion" : `Correction for ${esc(target?.name || "a removed hotline")}`} from ${esc(item.submittedByName || "an official")}.</p>
      <ul class="plain-list hotline-review-list">${proposed || "<li>No fields recorded</li>"}</ul>
      <div class="notice-bar"><span>Reason</span><strong>${esc(item.reason || "—")}</strong></div>
      ${supporting ? `<div class="notice-bar"><span>Supporting information</span><a href="${esc(supporting.url)}" target="_blank" rel="noopener">${esc(supporting.name)}</a></div>` : ""}
      <div class="form-field span-all"><label for="hotline-review-note">${decision === "rejected" ? "Rejection note *" : "Note (optional)"}</label><textarea class="textarea" id="hotline-review-note" name="note" ${decision === "rejected" ? "required" : ""} maxlength="500" placeholder="${decision === "rejected" ? "Tell the official what to correct." : "Recorded with the decision."}"></textarea></div></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button ${decision === "rejected" ? "danger" : ""}" type="submit">${decision === "rejected" ? "Reject request" : "Approve correction"}</button></div></form>`;
    return makeModal(decision === "rejected" ? "Reject hotline correction" : "Approve hotline correction", body);
  }
  const user = modalState.id ? getUser(modalState.id) : null;
  const accountRole = user?.role || "resident";
  const accountAreas = locationAreas();
  const selectedArea = accountAreas.includes(user?.area) ? user.area : user ? "" : accountAreas[0];
  const availableDays = Array.isArray(user?.availableDays) ? user.availableDays : DEFAULT_OFFICIAL_DAYS;
  const accountRoles = ["resident", "official"];
  const body = `<form id="user-form" class="modal-form"><input type="hidden" name="originalEmail" value="${esc(user?.email || "")}">
  <div class="modal-form-fields"><div class="form-grid">${inputField("Full name", "name", user?.name || "", { required: true })}${inputField("Email address", "email", user?.email || "", { type: "email", required: true, autocomplete: "email" })}${inputField("Contact number", "phone", user?.phone || "", { type: "tel", placeholder: "Optional" })}${selectField("Area", "area", accountAreas, selectedArea, { required: true, labels: locationAreaLabels(), placeholder: selectedArea ? "" : "Choose a managed location" })}${selectField("Role", "role", accountRoles, accountRole, { required: true, labels: ROLES })}${!user ? selectField("Account status", "status", ["Active", "Inactive"], "Active", { required: true }) : ""}<fieldset class="availability-field span-all" ${accountRole !== "official" ? "hidden" : ""}><legend>Available days</legend><p class="availability-help">Choose the days this official is available.</p><div class="availability-days">${availableDayOptions(availableDays)}</div></fieldset>${user ? "" : inputField("Initial password", "password", "", { type: "password", required: true, minLength: 8, help: "Choose a unique password with at least 8 characters." })}</div>${!user && accountRole === "official" ? '<p class="field-help span-all">Officials add their face at first sign-in. They cannot open their workspace until it is enrolled and verified.</p>' : ""}${user && user.role === "official" && user.status === "Active" ? adminFaceEnrollMarkup(user) : ""}</div>
    <div class="form-actions">${user && user.email !== currentUser.email ? `<button class="button secondary" type="button" data-action="reset-user-password" data-id="${esc(user.email)}" ${user.status === "Active" ? "" : 'disabled aria-disabled="true" title="Reactivate this account first"'}>${user.resetRequested ? "Approve &amp; Generate" : "Reset password"}</button><button class="button ${user.status === "Active" ? "danger" : "secondary"}" type="button" data-action="toggle-user" data-id="${esc(user.email)}">${user.status === "Active" ? "Deactivate account" : "Reactivate account"}</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${user ? "Save account" : "Add account"}</button></div></form>`;
  return makeModal(
    user ? "Edit account" : "Add account",
    body,
    "modal--account",
    user ? `${user.name} · ${roleLabel(user.role)} · ${user.status}` : "Create a resident or official account.",
  );
}

function syncScheduleStatusFields(form) {
  const status = String(form.elements.status?.value || "Scheduled");
  const initialStatus = String(form.dataset.initialStatus || "");
  const changed = !initialStatus || status !== initialStatus;
  const noteField = form.querySelector("#schedule-status-note-field");
  const noteInput = form.querySelector("#statusNote");
  const rescheduleHint = form.querySelector("#schedule-reschedule-hint");
  const needsReason = changed && SCHEDULE_REASON_STATUSES.includes(status);
  if (noteField) noteField.hidden = !changed;
  if (noteInput) {
    noteInput.required = needsReason;
    noteInput.setAttribute("aria-required", needsReason ? "true" : "false");
  }
  if (rescheduleHint) rescheduleHint.hidden = !(changed && status === "Rescheduled");
}

function showSupportingFileName(file) {
  const label = app.querySelector("[data-supporting-file-name]");
  if (!label) return;
  label.textContent = file ? `Selected: ${file.name}` : "";
  label.hidden = !file;
}

function correctionSupportingFile(item) {
  try {
    const proposed = typeof item.proposed === "string" ? JSON.parse(item.proposed) : item.proposed || {};
    return proposed.supportingFile || null;
  } catch {
    return null;
  }
}

function showModal(kind, id = "") {
  if (kind === "verify-id") {
    idStep = 1;
    idScanState = { readable: false, complete: false };
    idFaceState = { status: "idle" };
    idFaceFile = null;
    clearIdPreview();
  }
  if (kind === "announcement") {
    const item = id ? data.announcements.find((record) => record.id === id) : null;
    setMapState({ announcementMapExpanded: Boolean(item?.isEvent) });
    setMapState({
      announcementMapSelection:
        item?.isEvent && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
          ? { latitude: item.latitude, longitude: item.longitude }
          : null,
    });
  }
  setState({ modalState: { kind, id } });
  render();
}

function closeModal() {
  stopIdCamera();
  adminFaceAbortController?.abort();
  idFaceAbortController?.abort();
  clearIdPreview();
  setState({ modalState: null });
  render();
  app.querySelector(".workspace-main")?.focus();
}

function refreshSearch(searchValue) {
  const query = searchValue.toLowerCase().trim();
  const roleFilter = app.querySelector("[data-user-role-filter]")?.value || "all";
  const statusFilter = app.querySelector("[data-user-status-filter]")?.value || "all";
  const priorityFilter = app.querySelector("[data-official-priority-filter]")?.value || "all";
  const officialStatusFilter = app.querySelector("[data-official-status-filter]")?.value || "all";
  const announcementStatusFilter = app.querySelector("[data-official-announcement-filter]")?.value || "all";
  const hotlineCategoryFilter = app.querySelector("[data-hotline-category-filter]")?.value || "all";
  const correctionSearch = app.querySelector("[data-correction-search]");
  const correctionQuery = (correctionSearch?.value || "").toLowerCase().trim();
  const correctionStatus = app.querySelector("[data-correction-status-filter]")?.value || "all";
  const correctionType = app.querySelector("[data-correction-type-filter]")?.value || "all";
  const correctionDate = app.querySelector("[data-correction-date-filter]")?.value || "all";
  const correctionNow = new Date();
  app.querySelectorAll(".filter-item").forEach((row) => {
    const isCorrection = row.classList.contains("hotline-correction-row");
    const matchesText = !query || (isCorrection && correctionSearch ? true : row.dataset.search.includes(query));
    const matchesRole = roleFilter === "all" || row.dataset.search.includes(ROLES[roleFilter].toLowerCase());
    const matchesStatus = statusFilter === "all" || row.dataset.accountStatus === statusFilter;
    const matchesPriority = priorityFilter === "all" || row.dataset.priority === priorityFilter;
    const matchesOfficialStatus = officialStatusFilter === "all" || row.dataset.officialStatus === officialStatusFilter;
    const matchesAnnouncementStatus = announcementStatusFilter === "all" || row.dataset.announcementStatus === announcementStatusFilter;
    const matchesHotlineCategory =
      hotlineCategoryFilter === "all" || (row.dataset.hotlineCategory ? row.dataset.hotlineCategory === hotlineCategoryFilter : true);
    let matchesCorrection = true;
    if (isCorrection && correctionSearch) {
      const matchesCorrectionQuery = !correctionQuery || row.dataset.search.includes(correctionQuery);
      const matchesCorrectionStatus = correctionStatus === "all" || row.dataset.correctionStatus === correctionStatus;
      const matchesCorrectionType = correctionType === "all" || row.dataset.correctionType === correctionType;
      let matchesCorrectionDate = true;
      if (correctionDate !== "all" && row.dataset.submitted) {
        const submitted = new Date(`${row.dataset.submitted}T00:00:00`);
        const windowDays = correctionDate === "7d" ? 7 : correctionDate === "30d" ? 30 : 365;
        matchesCorrectionDate = submitted <= correctionNow && correctionNow - submitted <= windowDays * 24 * 60 * 60 * 1000;
      }
      matchesCorrection = matchesCorrectionQuery && matchesCorrectionStatus && matchesCorrectionType && matchesCorrectionDate;
    }
    const matches = !!(
      matchesText &&
      matchesRole &&
      matchesStatus &&
      matchesPriority &&
      matchesOfficialStatus &&
      matchesAnnouncementStatus &&
      matchesHotlineCategory &&
      matchesCorrection
    );
    row.dataset.filteredOut = String(!matches);
    if (row.closest("[data-hotline-results]")) row.hidden = !matches;
  });
  app.querySelectorAll("[data-hotline-results]").forEach((grid) => {
    const empty =
      grid.closest(".panel-body")?.querySelector(".hotline-no-results") || grid.parentElement?.querySelector(".hotline-no-results");
    if (!empty) return;
    const hasVisible = [...grid.querySelectorAll(".filter-item")].some((item) => !item.hidden);
    const hasItems = grid.querySelectorAll(".filter-item").length > 0;
    empty.hidden = !hasItems || hasVisible;
  });
  const correctionTable = app.querySelector(".hotline-correction-records-admin, .hotline-correction-records-official");
  const correctionEmpty = app.querySelector("[data-correction-no-results]");
  if (correctionTable && correctionEmpty) {
    const rows = [...correctionTable.querySelectorAll(".filter-item")];
    correctionEmpty.hidden = !rows.length || rows.some((row) => row.dataset.filteredOut !== "true");
  }
  updatePagination();
}

function updatePagination(onlyRecords = null) {
  const tables = onlyRecords ? [onlyRecords] : [...app.querySelectorAll(".records[data-page-size]")];
  for (const table of tables) {
    const rows = [...table.querySelectorAll(".filter-item")];
    const visible = rows.filter((row) => row.dataset.filteredOut !== "true");
    const pageSize = Number(table.dataset.pageSize);
    const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
    const page = Math.min(Number(table.dataset.page || 0), pageCount - 1);
    table.dataset.page = String(page);
    if (table.dataset.resultsCounter) {
      const summary = app.querySelector(`[data-results-summary="${table.dataset.resultsCounter}"]`);
      if (summary) {
        const firstResult = visible.length ? page * pageSize + 1 : 0;
        const lastResult = Math.min((page + 1) * pageSize, visible.length);
        summary.textContent = `Showing ${firstResult}-${lastResult} of ${visible.length} results`;
      }
    }
    visible.forEach((row, index) => {
      row.hidden = index < page * pageSize || index >= (page + 1) * pageSize;
    });
    rows
      .filter((row) => row.dataset.filteredOut === "true")
      .forEach((row) => {
        row.hidden = true;
      });
    const paginationTarget = table.dataset.paginationTarget ? app.querySelector(`#${table.dataset.paginationTarget}`) : null;
    let controls =
      paginationTarget?.querySelector(".pagination") ||
      (table.nextElementSibling?.classList.contains("pagination") ? table.nextElementSibling : null);
    if (pageCount <= 1) {
      controls?.remove();
      continue;
    }
    if (!controls) {
      controls = document.createElement("nav");
      controls.className = "pagination";
      controls.setAttribute("aria-label", "Table pages");
      if (paginationTarget) paginationTarget.append(controls);
      else table.after(controls);
    }
    table.dataset.paginationId ||= `table-${Math.random().toString(36).slice(2, 10)}`;
    controls.innerHTML = `<button class="button secondary small" type="button" data-action="change-page" data-pagination-id="${table.dataset.paginationId}" data-direction="-1" ${page === 0 ? "disabled" : ""}>Previous</button><span class="pagination-status" aria-live="polite">Page ${page + 1} of ${pageCount}</span><button class="button secondary small" type="button" data-action="change-page" data-pagination-id="${table.dataset.paginationId}" data-direction="1" ${page >= pageCount - 1 ? "disabled" : ""}>Next</button>`;
  }
}

function safeCsvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv(filename, headers, rows, note = "") {
  const contents = [headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", contents], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(note || "Your CSV export is ready.", note ? "error" : "success");
}

function exportReports(history = false) {
  const reports = sortedReports(currentUser.role === "resident" ? userReports() : data.reports);
  if (history) {
    exportCsv(
      "community-report-history.csv",
      [
        "Report ID",
        "Resident",
        "Category",
        "Barangay",
        "Purok or area",
        "Street or landmark",
        "Latitude",
        "Longitude",
        "Status",
        "Date and time",
        "Update",
        "Updated by",
      ],
      reports.flatMap((report) =>
        report.history.map((item) => [
          displayReportId(report),
          report.name,
          report.category,
          report.barangay || "",
          report.area,
          report.locationDetail || "",
          report.latitude ?? "",
          report.longitude ?? "",
          item.status,
          item.at,
          item.note,
          item.actorName || "",
        ]),
      ),
    );
    return;
  }
  exportCsv(
    "community-reports.csv",
    [
      "Report ID",
      "Resident",
      "Email",
      "Category",
      "Concern",
      "Barangay",
      "Purok or area",
      "Street or landmark",
      "Latitude",
      "Longitude",
      "Description",
      "Urgent",
      "Priority",
      "Status",
      "Assigned official",
      "Submitted",
      "Updated",
    ],
    reports.map((report) => [
      displayReportId(report),
      report.name,
      report.userEmail,
      report.category,
      report.title,
      report.barangay || "",
      report.area,
      report.locationDetail || "",
      report.latitude ?? "",
      report.longitude ?? "",
      report.description,
      report.urgent ? "Yes" : "No",
      report.priority || "Medium",
      report.status,
      report.assignedTo?.name || "",
      report.submittedAt,
      report.updatedAt,
    ]),
  );
}

function activityQuery() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(activityFilters)) {
    if (value && value !== "all") params.set(key, value);
  }
  return params;
}

async function loadActivityLog(page = 1, force = false) {
  const params = activityQuery();
  params.set("page", String(page));
  params.set("pageSize", String(activityLogState.pageSize || 25));
  const key = params.toString();
  if (!force && key === activityLogLoadedKey) return;
  const response = await fetch(`/api/community/activity?${key}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The activity log could not be loaded.");
  setState({ activityLogState: result });
  setState({ activityLogLoadedKey: key });
  const region = app.querySelector("#activity-results");
  if (region) region.innerHTML = activityResultsMarkup();
}

async function exportActivityLog() {
  const response = await fetch(`/api/community/activity/export?${activityQuery()}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The activity log could not be exported.");
  exportCsv(
    "community-activity-log.csv",
    [
      "Event ID",
      "Date and time",
      "Actor",
      "Role",
      "Action",
      "Details",
      "Result",
      "Result reason",
      "Affected record",
      "Client address",
      "Source",
      "Archived at",
    ],
    result.activities.map((item) => [
      item.id,
      item.at,
      item.actor,
      roleLabel(item.role),
      item.action,
      displayReferenceText(item.detail),
      item.result,
      item.resultReason || "",
      item.affectedId || "",
      item.clientIp || "",
      item.source || "current",
      item.archivedAt || "",
    ]),
    result.truncated
      ? `Export limited to ${result.activities.length} of ${result.total} records. Narrow the date range to export the rest.`
      : "",
  );
}

async function compressPhoto(file) {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error(`${file.name}: choose a JPG or PNG image.`);
  const image =
    typeof createImageBitmap === "function"
      ? await createImageBitmap(file)
      : await new Promise((resolve, reject) => {
          const objectUrl = URL.createObjectURL(file);
          const fallbackImage = new Image();
          fallbackImage.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(fallbackImage);
          };
          fallbackImage.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(`${file.name}: this image could not be opened.`));
          };
          fallbackImage.src = objectUrl;
        });
  if (!image.width || !image.height) throw new Error(`${file.name}: this image has no usable dimensions.`);
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser could not prepare the selected photo.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (typeof image.close === "function") image.close();
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error(`${file.name}: this image could not be prepared.`))),
      "image/jpeg",
      0.72,
    ),
  );
  if (blob.size > 5 * 1024 * 1024) throw new Error(`${file.name}: each photo must be 5 MB or smaller.`);
  return {
    name: file.name.slice(0, 120),
    file: new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" }),
    previewUrl: URL.createObjectURL(blob),
  };
}

function nextReportId() {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const randomBytes = crypto.getRandomValues(new Uint8Array(10));
  const suffix = Array.from(randomBytes, (value) => alphabet[value % alphabet.length]).join("");
  return `R-${suffix}`;
}

// Submission is gated on the device fix, never on the map pin. Unknown or
// denied location blocks too — allowing a pin fallback would let someone
// outside Palsara submit by dropping a pin inside the barangay.
export async function residentOutsidePalsara() {
  await resolveReportLocation({ userInitiated: true, announce: true, force: true });
  return reportLocationVerdict.state !== "inside";
}

async function submitReportDraft() {
  if (!reportDraft) return;
  if (await residentOutsidePalsara()) return;
  const confirmed = await confirmAction({
    title: "Submit concern?",
    message: `Submit this ${reportDraft.urgent ? "urgent " : ""}concern report to barangay staff?`,
    confirmLabel: "Submit concern",
  });
  if (!confirmed) return;
  const now = new Date().toISOString();
  const reportId = nextReportId();
  let photos = [];
  if (uploadPhotos.length) {
    const form = new FormData();
    uploadPhotos.forEach((photo) => form.append("photos", photo.file, photo.file.name));
    const response = await fetch(`/api/report-photos?reportId=${encodeURIComponent(reportId)}`, { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The report photos could not be uploaded.");
    photos = result.photos;
  }
  const report = {
    id: reportId,
    userEmail: currentUser.email,
    name: currentUser.name,
    category: reportDraft.category,
    title:
      reportDraft.category === "Other community concern"
        ? `Community concern in ${reportDraft.area}`
        : `${reportDraft.category} · ${reportDraft.area}`,
    area: reportDraft.area,
    barangay: reportDraft.barangay,
    locationDetail: reportDraft.locationDetail,
    latitude: reportDraft.latitude,
    longitude: reportDraft.longitude,
    description: reportDraft.description,
    urgent: reportDraft.priority === "High",
    priority: reportDraft.priority || "Medium",
    assignedTo: null,
    status: "Submitted",
    submittedAt: now,
    updatedAt: now,
    photos,
    history: [{ status: "Submitted", at: now, note: "Report received." }],
  };
  data.reports.unshift(report);
  if (!(await localSave())) {
    data.reports = data.reports.filter((item) => item.id !== report.id);
    return;
  }
  setState({ reportDraft: null });
  setMapState({ reportMapExpanded: false });
  setMapState({ reportMapSelection: null });
  setState({ uploadPhotos: [] });
  setState({ selectedReportId: null });
  window.location.hash = routeUrl("resident", "reports");
  toast(`${displayReportId(getReport(report.id) || report)} was submitted to barangay staff.`, "success");
}

async function updateReportStatus(form) {
  const report = getReport(form.get("reportId"));
  if (!report) throw new Error("This report could not be found. Return to the concerns list and try again.");
  const status = String(form.get("status"));
  const note = String(form.get("note") || "").trim();
  if (!STATUSES.includes(status)) throw new Error("Choose a valid report status.");
  if (status !== report.status) {
    const allowed = REPORT_TRANSITIONS[report.status] ?? [];
    if (!allowed.includes(status)) {
      throw new Error(
        `This concern cannot move from ${report.status} to ${status}. Follow the path: Submitted → Under Review → In Progress → Resolved.`,
      );
    }
    if (!note) throw new Error(`Add an update note when changing the status to ${status}.`);
  }
  if (status === report.status && !note) {
    toast("Choose a new status or add an update for the resident.", "error");
    return;
  }
  const confirmed = await confirmAction({
    title: "Update report?",
    message: `Update ${displayReportId(report)} to “${status}” and notify the resident?`,
    confirmLabel: "Update report",
  });
  if (!confirmed) return;
  const now = new Date().toISOString();
  report.status = status;
  report.updatedAt = now;
  report.history.push({ status, at: now, note: note || `Status updated to ${status}.` });
  if (!(await localSave())) return;
  setState({ selectedReportId: null });
  render();
  toast(`${displayReportId(report)} updated. The resident has an in-app notification.`, "success");
}

async function updateReportAssignment(id, claim) {
  const report = getReport(id);
  if (!report || currentUser.role !== "official") throw new Error("This concern cannot be assigned from this workspace.");
  if (claim && report.assignedTo) throw new Error("This concern is already assigned. Refresh the queue before trying again.");
  if (!claim && report.assignedTo?.id !== currentUser.id) throw new Error("You can only release a concern assigned to you.");
  const confirmed = await confirmAction({
    title: claim ? "Claim concern?" : "Release concern?",
    message: claim ? `Assign ${displayReportId(report)} to yourself?` : `Release ${displayReportId(report)} back to the queue?`,
    confirmLabel: claim ? "Claim concern" : "Release concern",
    tone: claim ? "primary" : "danger",
  });
  if (!confirmed) return;
  report.assignedTo = claim ? { id: currentUser.id, name: currentUser.name } : null;
  if (!(await localSave())) return;
  render();
  toast(claim ? `${displayReportId(report)} assigned to you.` : `${displayReportId(report)} released to the queue.`, "success");
}

async function assignReportToOfficial(reportId, officialId) {
  const report = getReport(reportId);
  const official = data.users.find((user) => user.id === officialId);
  if (currentUser.role !== "administrator" || !canOpenPage(currentUser, "assignments"))
    throw new Error("You do not have permission to assign concerns.");
  if (!report || report.status === "Resolved") throw new Error("Only an unresolved concern can be assigned.");
  if (report.assignedTo) throw new Error("This concern is already assigned. Refresh the queue before trying again.");
  if (!official || official.role !== "official" || official.status !== "Active")
    throw new Error("Select an active Barangay Official account.");
  const confirmed = await confirmAction({
    title: "Assign concern?",
    message: `Assign ${displayReportId(report)} to ${official.name}?`,
    confirmLabel: "Assign concern",
  });
  if (!confirmed) return;
  const response = await fetch("/api/reports/assignment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, officialId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The concern could not be assigned.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "The concern was assigned, but the queue could not be refreshed.");
  setState({ data: state.data, dataRevision: state.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(state.data) });
  render();
  toast(`${displayReportId(report)} assigned to ${official.name}.`, "success");
}

async function confirmReport(reportId, note) {
  const report = getReport(reportId);
  if (!report || currentUser.role !== "resident") throw new Error("This concern could not be found.");
  if (report.userEmail !== currentUser.email) throw new Error("Residents can only confirm their own concerns.");
  if (report.status !== "Resolved") throw new Error("Only a resolved concern can be confirmed as addressed.");
  const confirmed = await confirmAction({
    title: "Confirm addressed?",
    message: `Confirm that ${displayReportId(report)} was addressed and close the follow-up?`,
    confirmLabel: "Confirm addressed",
  });
  if (!confirmed) return;
  const response = await fetch("/api/community/report-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, note }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The concern could not be confirmed.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "The concern was confirmed, but the report list could not be refreshed.");
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ selectedReportId: null });
  render();
  toast(`${displayReportId(report)} confirmed as addressed.`, "success");
}

async function reopenReport(reportId, reason) {
  const report = getReport(reportId);
  if (!report || currentUser.role !== "resident") throw new Error("This concern could not be found.");
  if (report.userEmail !== currentUser.email) throw new Error("Residents can only reopen their own concerns.");
  if (report.status !== "Resolved") throw new Error("Only a resolved concern can be reopened.");
  const response = await fetch("/api/community/report-reopen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The concern could not be reopened.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "The concern was reopened, but the report list could not be refreshed.");
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ selectedReportId: null });
  setState({ modalState: null });
  render();
  toast(`${displayReportId(report)} reopened. It is back in the concern queue.`, "success");
}

function followUpLimitFor(priority) {
  return Object.hasOwn(FOLLOW_UP_LIMITS, priority) ? FOLLOW_UP_LIMITS[priority] : FOLLOW_UP_LIMITS.Medium;
}

async function submitFollowUp(form) {
  const reportId = String(form.get("reportId") || "");
  const message = String(form.get("message") || "").trim();
  if (!message) throw new Error("Enter a follow-up message.");
  const report = data.reports.find((item) => item.id === reportId);
  if (!report) throw new Error("This report could not be found.");
  if (report.status === "Resolved") throw new Error("This concern is resolved and no longer accepts follow-ups.");
  const limit = followUpLimitFor(report.priority || "Medium");
  const count = Number(report.followUpCount || 0);
  const remaining = limit === null ? null : Math.max(0, limit - count);
  if (limit !== null && remaining <= 0) {
    throw new Error(`This ${report.priority || "Medium"} priority concern has reached its ${limit} follow-up limit.`);
  }
  const limitLine =
    limit === null
      ? "Unlimited follow-ups remain for this High priority concern."
      : `${remaining} of ${limit} follow-ups remaining for this ${report.priority} priority concern.`;
  const confirmed = await confirmAction({
    title: "Send follow-up?",
    message: `Send this follow-up to barangay staff for ${report ? displayReportId(report) : "this report"}?\n\n${limitLine}`,
    confirmLabel: "Send follow-up",
  });
  if (!confirmed) return;
  const response = await fetch("/api/community/follow-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, message }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The follow-up could not be sent.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (stateResponse.ok) {
    setState({ data: state.data });
    setState({ dataRevision: state.revision });
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
  } else {
    console.error("CommUnity could not refresh state after follow-up.", state.error);
    const localReport = data.reports.find((item) => item.id === reportId);
    if (localReport && typeof result.count === "number") localReport.followUpCount = result.count;
  }
  setState({ selectedReportId: null });
  render();
  const nextLine = result.remaining == null ? "Unlimited follow-ups remain." : `${result.remaining} follow-up(s) remain.`;
  toast(`Your follow-up was sent to barangay staff. ${nextLine}`, "success");
}

async function updateReportPriority(form) {
  const reportId = String(form.get("reportId") || "");
  const priority = String(form.get("priority") || "").trim();
  if (!REPORT_PRIORITIES.includes(priority)) throw new Error("Choose a valid concern priority.");
  const report = data.reports.find((item) => item.id === reportId);
  if (!report) throw new Error("This report could not be found.");
  if (report.priority === priority) {
    toast(`${displayReportId(report)} is already ${priority} priority.`, "info");
    return;
  }
  const confirmed = await confirmAction({
    title: "Update concern priority?",
    message: `Change ${displayReportId(report)} priority from ${report.priority || "Medium"} to ${priority}?`,
    confirmLabel: "Update priority",
  });
  if (!confirmed) return;
  const response = await fetch("/api/community/report-priority", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId, priority }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The priority could not be updated.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "The priority was updated, but the report list could not be refreshed.");
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  render();
  toast(`${displayReportId(report)} priority updated to ${priority}.`, "success");
}

async function updateCollection(form) {
  const id = String(form.get("id") || "");
  const existing = id ? data.schedules.find((item) => item.id === id) : null;
  const date = String(form.get("date") || "");
  const area = String(form.get("area") || "");
  const status = String(form.get("status") || "");
  const frequency = String(form.get("frequency") || "Weekly");
  const recurrenceEnd = String(form.get("recurrenceEnd") || "").trim() || null;
  if (!locationAreas().includes(area) || !COLLECTION_STATUSES.includes(status) || !date)
    throw new Error("Choose a valid area, collection date, and service status.");
  if (!SCHEDULE_FREQUENCIES.includes(frequency)) throw new Error("Choose a valid collection frequency.");
  const record = {
    ...(existing || { id: nextScheduleId(date) }),
    area,
    zone: existing?.zone || `Zone ${String.fromCharCode(65 + Math.max(0, locationAreas().indexOf(area)))}`,
    date,
    wasteType: String(form.get("wasteType") || "").trim(),
    start: String(form.get("start") || "").trim(),
    end: String(form.get("end") || "").trim(),
    frequency,
    recurrenceEnd: frequency === "One-time" ? null : recurrenceEnd,
    seriesId: existing?.seriesId || null,
    team: String(form.get("team") || "").trim() || "Collection team",
    status,
  };
  const endMinutes = scheduleClockMinutes(record.end);
  const startMinutes = scheduleClockMinutes(record.start);
  if (endMinutes < 0 || startMinutes < 0 || endMinutes <= startMinutes)
    throw new Error("Use a valid time such as 6:00 AM, and make sure the end time is later.");
  if (!record.wasteType || !record.start || !record.end) throw new Error("Complete the service, collection time, and waste type.");
  const statusNote = String(form.get("statusNote") || "").trim();
  if (!existing && status === "Rescheduled") throw new Error("Save this collection first, then reschedule it to a replacement pickup.");
  const historyEntry = scheduleStatusEntry(existing, {
    status,
    note: statusNote,
    date: record.date,
    start: record.start,
    end: record.end,
    actorName: currentUser.name,
    actorRole: currentUser.role,
  });
  const statusChanged = !existing || existing.status !== status;
  const statusSummary = statusChanged
    ? status === "Rescheduled"
      ? `Move this ${record.wasteType} pickup from ${dateLabel(existing.date)} to ${dateLabel(record.date)}, ${record.start}–${record.end}?`
      : `Mark this ${record.wasteType} pickup as ${status.toLowerCase()}${statusNote ? `: ${statusNote}` : ""}?`
    : "";
  const occurrenceDates = existing ? [] : scheduleOccurrenceDates(date, frequency, record.recurrenceEnd);
  const confirmed = await confirmAction({
    title: existing ? "Save schedule?" : "Add schedule?",
    message: existing
      ? `${statusSummary ? `${statusSummary} ` : ""}${
          existing.seriesId ? `The other pickups in this recurring series stay unchanged.` : `Residents will be notified about this change.`
        }`
      : occurrenceDates.length > 1
        ? `Add ${occurrenceDates.length} ${record.wasteType} pickups for ${record.area}, from ${dateLabel(occurrenceDates[0])} to ${dateLabel(occurrenceDates.at(-1))}? Residents will be notified about the new schedule.`
        : `Add this ${record.wasteType} collection schedule for ${record.area}? Residents will be notified.`,
    confirmLabel: existing ? "Save schedule" : "Add schedule",
  });
  if (!confirmed) return;
  if (existing) {
    if (historyEntry) existing.history = [...(existing.history || []), historyEntry];
    Object.assign(existing, record);
  } else {
    const seriesId = occurrenceDates.length > 1 ? nextScheduleId(occurrenceDates[0]) : null;
    const creationEntry = scheduleStatusEntry(null, {
      status,
      note: statusNote,
      date: record.date,
      start: record.start,
      end: record.end,
      actorName: currentUser.name,
      actorRole: currentUser.role,
    });
    const records = occurrenceDates.map((occurrenceDate, index) => ({
      ...record,
      id: nextScheduleId(occurrenceDate, index),
      date: occurrenceDate,
      seriesId,
      history: [{ ...creationEntry }],
    }));
    data.schedules.push(...records);
  }
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast("Collection schedule saved. Residents in the affected area have an in-app update.", "success");
}

async function saveLocation(form) {
  const id = String(form.get("id") || idFor("LOC"));
  const latitudeText = String(form.get("latitude") || "").trim();
  const longitudeText = String(form.get("longitude") || "").trim();
  const latitude = latitudeText ? Number(latitudeText) : NaN;
  const longitude = longitudeText ? Number(longitudeText) : NaN;
  if (
    !latitudeText ||
    !longitudeText ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Place a pin or enter valid latitude and longitude for this community location before saving.");
  }
  const record = {
    id,
    barangay: String(form.get("barangay") || "").trim(),
    purok: String(form.get("purok") || "").trim(),
    landmark: String(form.get("landmark") || "").trim(),
    latitude,
    longitude,
  };
  // A location's area label is its purok. Editing a purok keeps the stored area
  // label so accounts, reports, and schedules that point at it stay valid.
  const existing = data.locations.find((item) => item.id === id);
  record.area = existing ? existing.area : record.purok;
  record.street = existing?.street || "";
  if (!record.area || !record.barangay || !record.purok) throw new Error("Enter a barangay and purok.");
  if (data.locations.some((item) => item.area.toLowerCase() === record.area.toLowerCase() && item.id !== id)) {
    throw new Error("Another location already uses this purok.");
  }
  const confirmed = await confirmAction({
    title: existing ? "Save location?" : "Add location?",
    message: existing
      ? `Save changes to ${record.area}, including its map pin?`
      : `Add ${record.area} as a community location with the selected map pin?`,
    confirmLabel: existing ? "Save location" : "Add location",
  });
  if (!confirmed) return;
  if (existing) Object.assign(existing, record);
  else data.locations.push(record);
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast("Community location saved.", "success");
}

async function saveRecyclingLocation(form) {
  const id = String(form.get("id") || idFor("REC"));
  const record = {
    id,
    name: String(form.get("name") || "").trim(),
    barangay: String(form.get("barangay") || "").trim(),
    street: String(form.get("street") || "").trim(),
    purok: String(form.get("purok") || "").trim(),
    landmark: String(form.get("landmark") || "").trim(),
    materials: String(form.get("materials") || "").trim(),
    phone: String(form.get("phone") || "").trim(),
    hours: String(form.get("hours") || "").trim(),
    active: Boolean(form.get("active")),
  };
  if (!record.name || !record.barangay || !record.street || !record.materials) {
    throw new Error("Enter the business name, barangay, street address, and accepted materials.");
  }
  const existing = data.recyclingLocations.find((item) => item.id === id);
  const confirmed = await confirmAction({
    title: existing ? "Save listing?" : "Add listing?",
    message: existing ? `Save changes to ${record.name}?` : `Add ${record.name} to the recycling directory?`,
    confirmLabel: existing ? "Save listing" : "Add listing",
  });
  if (!confirmed) return;
  if (existing) Object.assign(existing, record);
  else data.recyclingLocations.push(record);
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast("Recycling directory listing saved.", "success");
}

// Edits keep their original publish date; only new announcements must be dated today or later.
export function announcementDateAllowed(date, id) {
  return Boolean(id) || date >= todayISO();
}

async function saveAnnouncement(form) {
  const id = String(form.get("id") || "");
  const isEvent = Boolean(form.get("isEvent"));
  let latitude = readOptionalCoordinate(form.get("latitude"));
  let longitude = readOptionalCoordinate(form.get("longitude"));
  if (isEvent) {
    if (
      latitude === null ||
      longitude === null ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error("Place a pin or enter valid coordinates for this event, or turn off the event option.");
    }
  } else {
    latitude = null;
    longitude = null;
  }
  const body = {
    title: String(form.get("title") || "").trim(),
    date: String(form.get("date") || ""),
    detail: String(form.get("detail") || "").trim(),
    isEvent,
    latitude,
    longitude,
  };
  if (!body.title || !body.date || !body.detail) throw new Error("Enter an announcement title, date, and message.");
  if (!announcementDateAllowed(body.date, id)) throw new Error("Announcements cannot be published before today.");
  const needsApproval = currentUser.role === "official";
  const confirmed = await confirmAction({
    title: id
      ? needsApproval
        ? "Resubmit announcement for approval?"
        : "Save announcement?"
      : needsApproval
        ? "Send announcement for approval?"
        : "Publish announcement?",
    message: id
      ? needsApproval
        ? "Save these changes and send the announcement to an administrator for approval. Residents will see it after it is approved."
        : "Save changes to this announcement?"
      : needsApproval
        ? "Send this announcement to an administrator for approval. Residents will see it after it is approved."
        : "Publish this announcement? It will be visible to residents.",
    confirmLabel: needsApproval ? "Send for approval" : id ? "Save changes" : "Publish announcement",
  });
  if (!confirmed) return;
  const response = await fetch("/api/announcements", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(id ? { ...body, id } : body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The announcement could not be saved.");
  setMapState({ announcementMapExpanded: false });
  setMapState({ announcementMapSelection: null });
  announcementMap?.remove();
  setMapState({ announcementMap: null });
  setMapState({ announcementMapElement: null });
  setMapState({ announcementMapMarker: null });
  setState({ modalState: null });
  if (result.data) {
    setState({ data: result.data });
    if (result.revision) setState({ dataRevision: result.revision });
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
  }
  render();
  toast(
    needsApproval
      ? id
        ? "Announcement updated and sent for approval."
        : "Announcement sent for approval."
      : id
        ? "Announcement updated."
        : "Announcement published.",
    "success",
  );
}

async function decideAnnouncement(id, status, reason = "") {
  const confirmed = await confirmAction({
    title: status === "declined" ? "Decline announcement?" : "Approve announcement?",
    message:
      status === "declined"
        ? "Decline this announcement and send the reason to the official?"
        : "Approve and publish this announcement to residents?",
    confirmLabel: status === "declined" ? "Decline announcement" : "Approve & publish",
    tone: status === "declined" ? "danger" : "primary",
  });
  if (!confirmed) return;
  const response = await fetch("/api/announcements/approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The announcement decision could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast(status === "declined" ? "Announcement declined." : "Announcement approved and published.", "success");
}

async function saveHotline(form, published) {
  const id = String(form.get("id") || "");
  const body = {
    name: String(form.get("name") || "").trim(),
    category: String(form.get("category") || ""),
    contactNumber: String(form.get("contactNumber") || "").trim(),
    alternativeContactNumber: String(form.get("alternativeContactNumber") || "").trim(),
    officeAddress: String(form.get("officeAddress") || "").trim(),
    description: String(form.get("description") || "").trim(),
    operatingHours: String(form.get("operatingHours") || "").trim(),
    status: String(form.get("status") || "Active"),
    published: Boolean(published),
  };
  if (id) body.id = id;
  const confirmed = await confirmAction({
    title: published ? "Publish hotline?" : "Save as draft?",
    message: published
      ? "Published hotlines are visible to residents and officials."
      : "A draft stays hidden from residents and officials until you publish it.",
    confirmLabel: published ? "Publish hotline" : "Save draft",
  });
  if (!confirmed) return;
  const response = await fetch("/api/hotlines", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The hotline could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast(published ? (id ? "Hotline updated and published." : "Hotline published.") : "Draft saved.", "success");
}

async function deleteHotline(id) {
  const item = (data.hotlines || []).find((hotline) => hotline.id === id);
  if (!item) throw new Error("This hotline could not be found.");
  const confirmed = await confirmAction({
    title: "Remove hotline?",
    message: `Remove “${item.name}” from the emergency directory? Residents will no longer see it.`,
    confirmLabel: "Remove hotline",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/hotlines", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The hotline could not be removed.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  render();
  toast("Hotline removed.", "success");
}

async function verifyHotline(id) {
  const item = (data.hotlines || []).find((hotline) => hotline.id === id);
  if (!item) throw new Error("This hotline could not be found.");
  const confirmed = await confirmAction({
    title: "Mark as verified?",
    message: `Confirm that “${item.name}” still answers on ${item.contactNumber}. The verification date is recorded now.`,
    confirmLabel: "Mark as verified",
  });
  if (!confirmed) return;
  const response = await fetch("/api/hotlines/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The hotline could not be marked as verified.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  render();
  toast("Hotline marked as verified.", "success");
}

async function submitHotlineCorrection(form) {
  const proposed = {
    contactNumber: String(form.get("contactNumber") || "").trim(),
    alternativeContactNumber: String(form.get("alternativeContactNumber") || "").trim(),
  };
  const confirmed = await confirmAction({
    title: "Submit correction?",
    message: "An administrator will review the corrected number before the directory is updated.",
    confirmLabel: "Submit correction",
  });
  if (!confirmed) return;
  const response = await fetch("/api/hotlines/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "correction",
      hotlineId: String(form.get("hotlineId") || ""),
      proposed,
      reason: String(form.get("reason") || "").trim(),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The correction could not be submitted.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast("Correction submitted for administrator review.", "success");
}

async function submitHotlineSuggestion(form) {
  const confirmed = await confirmAction({
    title: "Submit suggestion?",
    message: "An administrator will review this contact before adding it to the directory.",
    confirmLabel: "Submit suggestion",
  });
  if (!confirmed) return;
  const proposed = {
    name: String(form.get("name") || "").trim(),
    category: String(form.get("category") || ""),
    contactNumber: String(form.get("contactNumber") || "").trim(),
    alternativeContactNumber: String(form.get("alternativeContactNumber") || "").trim(),
    officeAddress: String(form.get("officeAddress") || "").trim(),
    operatingHours: String(form.get("operatingHours") || "").trim(),
    description: String(form.get("description") || "").trim(),
  };
  const file = form.get("supportingFile");
  const hasFile = file && typeof file !== "string" && file.size > 0;
  let response;
  if (hasFile) {
    const body = new FormData();
    body.append("kind", "suggestion");
    body.append("proposed", JSON.stringify(proposed));
    body.append("supportingFile", file, file.name);
    response = await fetch("/api/hotlines/corrections", { method: "POST", body });
  } else {
    response = await fetch("/api/hotlines/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "suggestion", proposed }),
    });
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The suggestion could not be submitted.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast("Contact suggestion submitted for review.", "success");
}

async function reviewHotlineCorrection(form) {
  const decision = String(form.get("decision") || "");
  const response = await fetch("/api/hotlines/corrections/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: String(form.get("id") || ""),
      decision,
      note: String(form.get("note") || "").trim(),
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The correction decision could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast(decision === "rejected" ? "Correction rejected." : "Correction approved.", "success");
}

async function copyHotline(number) {
  try {
    await navigator.clipboard.writeText(number);
    toast("Number copied.", "success");
  } catch {
    toast("Copy failed. Select the number and copy it manually.", "error");
  }
}

async function saveCalendarEvent(form) {
  const body = calendarEventFromForm(form);
  if (!body.title || !body.date) throw new Error("Enter an event title and date.");
  if (body.date < todayISO()) throw new Error("Events cannot be scheduled before today.");
  const isAdmin = currentUser.role === "administrator";
  const confirmed = await confirmAction({
    title: isAdmin ? "Add calendar event?" : "Submit event request?",
    message: isAdmin
      ? `Add “${body.title}” to the community calendar on ${body.date}?`
      : `Submit “${body.title}” for administrator approval?`,
    confirmLabel: isAdmin ? "Add event" : "Submit request",
  });
  if (!confirmed) return;
  const response = await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The calendar event could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ currentUser: result.user || currentUser });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  setState({ calendarSelectedDate: body.date });
  render();
  toast(currentUser.role === "administrator" ? "Event added to the calendar." : "Event request sent for approval.", "success");
}

async function decideCalendarEvent(id, status, reason = "") {
  const confirmed = await confirmAction({
    title: status === "declined" ? "Reject event request?" : "Approve event?",
    message:
      status === "declined"
        ? "Reject this event request and send the reason to the official?"
        : "Approve this event and add it to the calendar?",
    confirmLabel: status === "declined" ? "Reject event" : "Approve event",
    tone: status === "declined" ? "danger" : "primary",
  });
  if (!confirmed) return;
  const response = await fetch("/api/calendar/events/approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The event decision could not be saved.");
  setState({ data: result.data || data });
  if (result.revision) setState({ dataRevision: result.revision });
  setState({ currentUser: result.user || currentUser });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast(
    status === "declined" ? "Event rejected and the reason sent to the official." : "Event approved and added to the calendar.",
    "success",
  );
}

function calendarEventsForDate(dateStr) {
  if (!dateStr || !data) return [];
  const isResident = currentUser?.role === "resident";
  const schedules = isResident
    ? sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area)
    : sortedSchedules(data.schedules);
  const calendarEvents = (data.calendarEvents || []).map(calendarEventFromRecord);
  const activeEvents = calendarEvents.filter((event) => event.status !== "declined");
  const events = [
    ...data.announcements
      .filter((item) => item.approvalStatus === "approved")
      .map((item) => ({
        id: String(item.id),
        date: item.date,
        title: item.title,
        detail: item.detail,
        kind: "Announcement",
        status: item.approvalStatus,
        isEvent: Boolean(item.isEvent),
        latitude: item.latitude ?? null,
        longitude: item.longitude ?? null,
      })),
    ...schedules.map((item) => ({
      date: item.date,
      title: `${item.wasteType} collection`,
      detail: `${item.start}–${item.end} · ${item.area} · ${item.zone}`,
      kind: "Collection",
    })),
    ...activeEvents,
  ];
  return events.filter((event) => event.date === dateStr);
}

function nextScheduleId(date, offset = 0) {
  const text = String(date || "");
  const year = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(0, 4) : String(appDateParts(date).year);
  const largest = data.schedules.reduce((value, schedule) => {
    const match = schedule.id.match(/-(\d+)$/);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `GCS-${year}-${String(largest + 1 + offset).padStart(3, "0")}`;
}

async function updateProfile(form) {
  const name = String(form.get("name") || "").trim();
  const area = String(form.get("area") || "").trim();
  if (name.length < 2) throw new Error("Enter your full name.");
  if (currentUser.role === "resident" && !locationAreas().includes(area)) throw new Error("Choose an affected area.");
  const confirmed = await confirmAction({
    title: "Save profile?",
    message: "Save your profile changes?",
    confirmLabel: "Save profile",
  });
  if (!confirmed) return;
  const fields = {
    name,
    area,
    phone: String(form.get("phone") || "").trim(),
    recoveryEmail: String(form.get("recoveryEmail") || "").trim(),
  };
  // Either everything is saved in one request (fields plus photo) or nothing is.
  let response;
  if (profilePhotoFile) {
    const body = new FormData();
    body.append("name", fields.name);
    body.append("area", fields.area);
    body.append("phone", fields.phone);
    body.append("recoveryEmail", fields.recoveryEmail);
    body.append("photos", profilePhotoFile, profilePhotoFile.name);
    response = await fetch("/api/profile", { method: "PUT", body });
  } else {
    response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Profile changes could not be saved.");
  if (profilePhotoFile) {
    profilePhotoFile = null;
    profilePhotoPreview = null;
    const input = app.querySelector("#profile-photo");
    if (input) input.value = "";
  }
  setState({ currentUser: result.user });
  setState({ data: result.data });
  setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  render();
  toast(profileSavedMessage(result.recoveryEmail), "success");
}

async function requestEmailChange(form) {
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const currentPassword = String(form.get("currentPassword") || "");
  const response = await fetch("/api/auth/change-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, currentPassword }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The email change could not be requested.");
  // The submit handler passes FormData, not the form element; reset the form
  // itself so a successful request clears the fields instead of throwing after
  // the verification email has already been sent.
  (typeof form.reset === "function" ? form : document.getElementById("change-email-form"))?.reset();
  toast(result.message || "A verification link was sent to your new email address.", "success");
}

function profileSavedMessage(recovery = {}) {
  if (recovery.verified) return "Profile saved. Recovery email verified.";
  if (recovery.verificationSent) return "Profile saved. A verification link was sent to your recovery email.";
  if (recovery.verificationFailed)
    return "Profile saved, but the verification email failed. Recovery is not active until it is sent; save again to retry.";
  if (currentUser.recoveryEmail) return "Profile saved. No verification link was sent — email delivery is not configured for this portal.";
  return "Profile saved.";
}

async function loadSmtpSettings() {
  const response = await fetch("/api/settings/smtp");
  const result = await response.json();
  if (!response.ok) return;
  // Keep the server's encryption-readiness flag so the settings page can show a
  // clear notice instead of a form that would fail at save time.
  setState({ smtpSettings: { ...result.settings, encryptionReady: result.encryptionReady === true } });
  const form = app.querySelector("#smtp-settings-form");
  if (!form) return;
  for (const [name, value] of Object.entries(smtpSettings)) {
    const field = form.elements.namedItem(name);
    if (field && name !== "configured") field.value = value || "";
  }
  const password = form.elements.namedItem("pass");
  if (password && smtpSettings.configured) password.placeholder = "Leave blank to keep current password";
}

async function saveSmtpSettings(form) {
  const body = Object.fromEntries(new FormData(form));
  const confirmed = await confirmAction({
    title: "Save SMTP settings?",
    message: "Save these SMTP settings?",
    confirmLabel: "Save settings",
  });
  if (!confirmed) return;
  const response = await fetch("/api/settings/smtp", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "SMTP settings could not be saved.");
  setState({ smtpSettings: result.settings });
  form.elements.namedItem("pass").value = "";
  toast(
    result.restartRequired
      ? "SMTP settings saved. Restart every server instance before mail uses them."
      : "SMTP settings saved.",
    "success",
  );
}

function applySmtpPreset(provider) {
  const presets = {
    gmail: [
      "smtp.gmail.com",
      "587",
      'Gmail: turn on 2-Step Verification, then <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">create an App Password</a>. Enter that generated password here.',
    ],
    outlook: [
      "smtp.office365.com",
      "587",
      'Outlook/Microsoft 365: <a href="https://support.microsoft.com/account-billing/how-to-get-and-use-app-passwords-5896ed9c-9f7f-4d4b-ae2c-7c9f6b2c0f2a" target="_blank" rel="noopener noreferrer">learn about app passwords</a> if your account supports them. If SMTP AUTH is disabled, ask your Microsoft 365 administrator to enable it.',
    ],
    sendgrid: [
      "smtp.sendgrid.net",
      "587",
      'SendGrid: <a href="https://docs.sendgrid.com/ui/account-and-settings/api-keys" target="_blank" rel="noopener noreferrer">create an API key</a> in Settings > API Keys. Enter apikey as the username and the generated API key as the password.',
    ],
    custom: [
      "",
      "587",
      "Other provider: open its SMTP or mail-client setup page and copy the SMTP host, port, username, and app password or service key here.",
    ],
  };
  const preset = presets[provider];
  const form = app.querySelector("#smtp-settings-form");
  if (!preset || !form) return;
  form.elements.namedItem("host").value = preset[0];
  form.elements.namedItem("port").value = preset[1];
  const help = app.querySelector("#smtp-provider-help");
  if (help) help.innerHTML = preset[2];
  form.elements.namedItem("host").focus();
}

async function updatePassword(form) {
  const fields = new FormData(form);
  const oldPassword = String(fields.get("currentPassword") || "");
  const password = String(fields.get("newPassword") || "");
  const confirm = String(fields.get("confirmPassword") || "");
  if (password.length < 8) throw new Error("Choose a password with at least 8 characters.");
  if (password !== confirm) throw new Error("The new passwords do not match.");
  const confirmed = await confirmAction({
    title: "Change password?",
    message: "Change your password? You will stay signed in on this device.",
    confirmLabel: "Change password",
  });
  if (!confirmed) return false;
  const response = await fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword: password, confirmPassword: confirm }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Your session expired. Please sign in again before changing your password."
        : result.error || "The password could not be changed.",
    );
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) {
    if (state.code === "FACE_VERIFICATION_REQUIRED") {
      // The password is already changed; the sign-in session still needs the
      // face gate. Hand over to it instead of reporting a failed reload.
      setState({ currentUser: { ...currentUser, requiresPasswordChange: false, faceCheckPending: true } });
      setState({ data: emptyState() });
      setState({ dataRevision: 0 });
      setState({ lastPersistedSnapshot: "" });
      stopStateUpdates();
      window.location.hash = "#/face-verify";
      render();
      return true;
    }
    throw new Error(state.error || "The account was updated, but CommUnity could not reload.");
  }
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ currentUser: state.user });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  startStateUpdates();
  form.reset();
  toast("Password updated.", "success");
  return true;
}

async function createResident(form) {
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") || "");
  const confirm = String(form.get("confirmPassword") || "");
  const area = String(form.get("area") || "").trim();
  if (!isResidentArea(area)) throw new Error("Choose a valid purok or area.");
  if (name.length < 2) throw new Error("Enter your full name.");
  if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
  if (password !== confirm) throw new Error("The passwords do not match.");
  const confirmed = await confirmAction({
    title: "Create account?",
    message: `Create a resident account for ${name}?`,
    confirmLabel: "Create account",
  });
  if (!confirmed) return;
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      email,
      area,
      phone: String(form.get("phone") || "").trim(),
      password,
      confirmPassword: confirm,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Your account could not be created.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "Your account was created, but CommUnity could not load it.");
  setState({ currentUser: state.user || result.user });
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  startStateUpdates();
  window.location.hash = routeUrl("resident", "dashboard");
  announceSessionChange();
  toast("Your resident account is ready.", "success");
}

async function loadWorkspaceAfterGate(message = "") {
  stopStateUpdates();
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "CommUnity could not load your information.");
  setState({ currentUser: state.user || currentUser });
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(state.data) });
  setState({ selectedReportId: null });
  setState({ reportDraft: null });
  startStateUpdates();
  window.location.hash = routeUrl(currentUser.role, "dashboard");
  render();
  announceSessionChange();
  if (message) toast(message, "success");
}

export async function login(emailInput, password, remember = false) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailInput.trim().toLowerCase(), password, remember }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Those sign-in details do not match an active account.");
  setState({ currentUser: result.user || null });
  if (!currentUser) throw new Error("Signed in, but CommUnity could not load your information.");
  setState({ forcedPasswordDismissed: false });
  // The module-load attempt ran on the login page (no session), so /api/map-config
  // returned 401 and ensureGoogleMaps() cleared its promise. Retry now that the
  // session cookie exists, before any of the post-login branches run.
  refreshGoogleMaps();
  if (currentUser.requiresPasswordChange) {
    // The server answers only the password change until the temporary password is
    // replaced, so load the empty shell and let the forced dialog run first. The
    // real state loads inside updatePassword() once the change succeeds.
    setState({ data: emptyState() });
    setState({ dataRevision: 0 });
    setState({ lastPersistedSnapshot: "" });
    window.location.hash = routeUrl(currentUser.role, "dashboard");
    render();
    announceSessionChange();
    return;
  }
  if (result.faceCheckRequired || currentUser.faceCheckPending) {
    // The session is restricted until the face gate completes: no workspace
    // state, no polling, and no navigation away from this page.
    setState({ data: emptyState() });
    setState({ dataRevision: 0 });
    setState({ lastPersistedSnapshot: "" });
    setState({ faceCheckNotice: "" });
    stopStateUpdates();
    window.location.hash = "#/face-verify";
    render();
    announceSessionChange();
    return;
  }
  await loadWorkspaceAfterGate(`Signed in to the ${ROLES[currentUser.role]} workspace.`);
}

// After any verification mutation, re-pull the workspace so the badge, the
// review queue and the revision all agree with the server.
async function refreshWorkspace() {
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) {
    const error = new Error(state.error || "The workspace could not be refreshed.");
    error.code = state.code;
    throw error;
  }
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ currentUser: state.user });
  setState({ lastPersistedSnapshot: JSON.stringify(state.data) });
}

let idScanStream = null;

let idStep = 1;
let idStepCount = 4;
let idAttachedFile = null;
let idScanState = { readable: false, complete: false };
let idFaceState = { status: "idle" };
let idFaceFile = null;
let idFaceAbortController = null;
const idIntegrated = () => currentUser?.role === "official";
// Servers without Face++ skip the match; "unavailable" satisfies the face step.
const idFaceSatisfied = (status) => status === "matched" || status === "unavailable";

// One live region carries progress and errors for the whole dialog.
function idStatus(message = "", tone = "") {
  const status = document.getElementById("id-ocr-status");
  if (!status) return;
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

// Panes toggle in place so typed values and the camera stream survive a step
// change; the tracker uses the report wizard's own components and vocabulary.
function setIdStep(step) {
  const form = document.getElementById("id-submit-form");
  if (!form) return;
  idStep = Math.max(1, Math.min(idStepCount, step));
  form.querySelectorAll(".id-step").forEach((pane) => {
    pane.hidden = Number(pane.dataset.step) !== idStep;
  });
  form.querySelectorAll(".wizard-step").forEach((node) => {
    const number = Number(node.dataset.step);
    node.classList.toggle("current", number === idStep);
    node.classList.toggle("done", number < idStep);
    const marker = node.querySelector("strong");
    if (marker) marker.innerHTML = number < idStep ? icon("check") : String(number);
  });
  form.querySelector(".wizard-progress")?.setAttribute("aria-label", `Step ${idStep} of ${idStepCount}`);
  const back = form.querySelector('[data-action="id-step-back"]');
  const next = form.querySelector('[data-action="id-step-next"]');
  const submit = form.querySelector('[data-action="id-step-submit"]');
  const manual = form.querySelector('[data-action="id-step-manual"]');
  if (manual) manual.hidden = idStep !== 1;
  if (back) back.hidden = idStep === 1;
  if (next) next.hidden = idStep === idStepCount;
  if (submit) submit.hidden = idStep !== idStepCount;
  const manualPhoto = form.querySelector("#id-manual-photo-field");
  const personalStep = idIntegrated() ? 5 : 3;
  if (manualPhoto && idStep !== personalStep) manualPhoto.hidden = true;
  if (idStep === idStepCount) renderIdFinalResult();
  // Entering the match step runs the comparison once the live frame is ready.
  if (idIntegrated() && idStep === 4 && idFaceFile && idFaceState.status === "captured") runIdFaceCheck(idFaceFile);
  idStatus("");
  form.closest(".modal")?.querySelector(".modal-content")?.scrollTo?.({ top: 0 });
}

function renderIdFinalResult() {
  const holder = document.getElementById("id-final-result");
  if (!holder) return;
  const scanOk = idScanState.readable && idScanState.complete;
  const faceOk = idFaceSatisfied(idFaceState.status);
  const rows = [["ID uploaded and scanned", scanOk]];
  if (idIntegrated())
    rows.push([faceOk && idFaceState.status === "unavailable" ? "Face match not required on this server" : "Face captured and matched", faceOk]);
  rows.push(["Personal information populated", true]);
  holder.innerHTML = `<div class="verify-result-card"><ul class="id-check-list">${rows
    .map(([label, ok]) => `<li class="${ok ? "ok" : "bad"}"><span aria-hidden="true">${ok ? "✓" : "!"}</span>${label}</li>`)
    .join("")}</ul><p class="field-help">Submitting saves the record. An administrator completes the final review.</p></div>`;
}

function setIdLoading(on) {
  const form = document.getElementById("id-submit-form");
  if (!form) return;
  form.setAttribute("aria-busy", on ? "true" : "false");
  const next = form.querySelector('[data-action="id-step-next"]');
  if (next) {
    next.disabled = on;
    next.textContent = on ? "Reading the ID…" : "Continue";
  }
  form
    .querySelectorAll('[data-action="id-scan-camera"], #id-scan-file, #id-manual-photo, #id-back-photo')
    .forEach((node) => {
      node.disabled = on;
    });
  const spinner = document.getElementById("id-scan-loading");
  if (spinner) spinner.hidden = !on;
}

async function idStepNext() {
  const nextButton = document.querySelector('#id-submit-form [data-action="id-step-next"]');
  if (nextButton?.disabled) return;
  if (idStep === 1) {
    if (!idAttachedFile) {
      idStatus("Scan or upload the front of your ID to continue.", "error");
      return;
    }
    idStatus("");
    setIdLoading(true);
    let read = false;
    try {
      read = await scanIdImage(idAttachedFile, idAttachedFile.name);
    } catch (error) {
      idStatus(error.message || "The ID could not be read.", "error");
    } finally {
      setIdLoading(false);
    }
    if (!read) {
      idStatus("No details could be read. Try a clearer photo or enter the details manually.", "error");
      return;
    }
    setIdStep(2);
    return;
  }
  if (idStep === 2) {
    if (!idScanState.readable || !idScanState.complete) {
      idStatus("The scan must be readable and complete. Retry with a clearer photo.", "error");
      return;
    }
    setIdStep(3);
    return;
  }
  const personalStep = idIntegrated() ? 5 : 3;
  if (idIntegrated() && idStep === 3) {
    if (!idFaceFile) {
      setIdStatus("Start the face capture to continue.", "error");
      return;
    }
    setIdStep(4);
    return;
  }
  if (idIntegrated() && idStep === 4) {
    if (idFaceState.status === "captured") await runIdFaceCheck(idFaceFile);
    if (!idFaceSatisfied(idFaceState.status)) {
      setIdStatus("The face must match the ID photo before you continue.", "error");
      return;
    }
    setIdStep(personalStep);
    return;
  }
  if (idStep === personalStep) {
    const required = ["idType", "idNumber", "idFullName", "idBirthDate"];
    const missing = required.filter((id) => !String(document.getElementById(id)?.value || "").trim());
    if (missing.length) {
      idStatus("Fill in the ID details before continuing.", "error");
      document.getElementById(missing[0])?.focus();
      return;
    }
  }
  setIdStep(idStep + 1);
}

// Test-only driver: seed the wizard state, run the real Next handler, and report the resulting step.
export async function __driveIdStepNext({ step, faceStatus }) {
  idStep = step;
  idFaceState = { status: faceStatus };
  await idStepNext();
  return idStep;
}

function setIdStatus(message = "", tone = "") {
  const status = document.getElementById("id-face-stage") || document.getElementById("id-ocr-status");
  if (!status) return;
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

// Pure summary of the server's own validation, so the badge says "pass" only
// for checks the submit will also accept. Not a document-authenticity verdict.
export function idCheckSummary(checks = {}, suggestions = {}) {
  const errors = checks.errors || [];
  const warnings = checks.warnings || [];
  const fields = ["idType", "idNumber", "idFullName", "idBirthDate"];
  const found = fields.filter((field) => Boolean(String(suggestions[field] || "").trim())).length;
  const has = (fragment) => [...errors, ...warnings].some((message) => String(message).toLowerCase().includes(fragment));
  const rows = [
    { label: "Image readable", ok: checks.readable === true },
    { label: "All four details found", ok: found === fields.length, detail: found === fields.length ? "" : `${found} of ${fields.length}` },
    { label: "ID type recognised", ok: !has("id type") },
    { label: "ID number format", ok: !has("id number") && !has("id_number") },
    { label: "Full name", ok: !has("full name") },
    { label: "Birth date", ok: !has("birth date") && !has("birth year") && !has("future") },
    { label: "Name matches account", ok: !has("does not match the account name") },
    { label: "Number not already registered", ok: checks.duplicate !== true },
    { label: "Address read", ok: Boolean(String(suggestions.idAddress || "").trim()), optional: true },
    { label: "Expiration date read (if applicable)", ok: Boolean(String(suggestions.idExpirationDate || "").trim()), optional: true },
  ];
  return { status: rows.filter((row) => !row.optional).every((row) => row.ok) ? "pass" : "review", rows };
}

let idPreviewUrl = "";

function showIdPreview(file) {
  const image = document.getElementById("id-scan-preview-image");
  const wrapper = document.getElementById("id-scan-results");
  if (!image || !wrapper) return;
  if (idPreviewUrl) URL.revokeObjectURL(idPreviewUrl);
  idPreviewUrl = URL.createObjectURL(file);
  image.src = idPreviewUrl;
  wrapper.hidden = false;
}

// Adding an image only previews and attaches it. Reading it happens on Continue.
function attachIdImage(file) {
  if (!file) return;
  idAttachedFile = file;
  showIdPreview(file);
  idStatus("");
}

function clearIdPreview() {
  idAttachedFile = null;
  if (idPreviewUrl) URL.revokeObjectURL(idPreviewUrl);
  idPreviewUrl = "";
  const image = document.getElementById("id-scan-preview-image");
  if (image) image.removeAttribute("src");
  const holder = document.getElementById("id-check-result");
  if (holder) holder.innerHTML = "";
  const wrapper = document.getElementById("id-scan-results");
  if (wrapper) wrapper.hidden = true;
  resetBackPreview();
}

let idBackPreviewUrl = "";

// The back box becomes the image itself once a file is chosen. The input stays
// inside the label, so clicking the preview still opens the picker to replace it.
function resetBackPreview() {
  if (idBackPreviewUrl) URL.revokeObjectURL(idBackPreviewUrl);
  idBackPreviewUrl = "";
  const image = document.getElementById("id-back-preview");
  if (image) {
    image.removeAttribute("src");
    image.hidden = true;
  }
  document.querySelector(".id-back-upload")?.classList.remove("is-filled");
  const remove = document.querySelector('[data-action="id-back-remove"]');
  if (remove) remove.hidden = true;
  const note = document.getElementById("id-back-file-name");
  if (note) {
    note.textContent = "";
    note.hidden = true;
  }
}

function showBackPreview(file) {
  resetBackPreview();
  if (!file) return;
  idBackPreviewUrl = URL.createObjectURL(file);
  const image = document.getElementById("id-back-preview");
  if (image) {
    image.src = idBackPreviewUrl;
    image.hidden = false;
  }
  document.querySelector(".id-back-upload")?.classList.add("is-filled");
  const remove = document.querySelector('[data-action="id-back-remove"]');
  if (remove) remove.hidden = false;
  const note = document.getElementById("id-back-file-name");
  if (note) {
    note.textContent = `Attached: ${file.name}`;
    note.hidden = false;
  }
}

function renderIdChecks(result) {
  const holder = document.getElementById("id-check-result");
  if (!holder) return;
  const summary = idCheckSummary(result?.checks || {}, result?.suggestions || {});
  const match = result?.match;
  const signals = Array.isArray(result?.signals) ? result.signals : [];
  const toneClass = { pass: "ok", warn: "review", fail: "fail", unknown: "muted" };
  const rows = signals.length
    ? signals.map((signal) => ({ label: signal.label, detail: signal.detail, tone: signal.tone, ok: signal.tone === "pass" }))
    : [...summary.rows];
  if (!signals.length && match) {
    const failed = match.rows.filter((row) => !row.ok).map((row) => row.field);
    rows.push({
      label: "Details match your account",
      ok: match.ok,
      detail: failed.length ? `Different: ${failed.join(", ")}` : "",
    });
  }
  const status = match && !match.ok ? "fail" : summary.status;
  const passed = rows.filter((row) => row.ok).length;
  holder.innerHTML = `<div class="id-check-status ${status}"><strong>${status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "NEEDS REVIEW"}</strong><span>${passed}/${rows.length} checks passed</span></div>
    <ul class="id-check-list">${rows
      .map(
        (row) =>
          `<li class="${row.tone ? toneClass[row.tone] || "muted" : row.ok ? "ok" : "bad"}"><span aria-hidden="true">${row.ok ? "✓" : "!"}</span>${esc(row.label)}${row.detail ? ` — ${esc(row.detail)}` : ""}</li>`,
      )
      .join("")}</ul>
    <p class="field-help">Checks the details on the card, not whether the document is genuine. An administrator reviews every ID.</p>`;
}

function updateIdAge() {
  const input = document.getElementById("idBirthDate");
  const age = document.getElementById("idAge");
  if (!input || !age) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) {
    age.value = "—";
    return;
  }
  const dob = new Date(`${input.value}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) {
    age.value = "—";
    return;
  }
  const now = new Date();
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate()))
    years -= 1;
  age.value = years >= 0 && years < 130 ? String(years) : "—";
}

async function scanIdImage(source, name = "id-scan.jpg") {
  try {
    const file = source instanceof File ? source : new File([source], name, { type: source.type || "image/jpeg" });
    const compressed = (await compressPhoto(file)).file;
    showIdPreview(compressed);
    const form = new FormData();
    form.append("photos", compressed);
    // Send what the user already typed so the server can compare it with what
    // OCR read before the fields get replaced.
    for (const field of ["idType", "idNumber", "idFullName", "idBirthDate", "idAddress", "idExpirationDate"]) {
      form.append(field, String(document.getElementById(field)?.value || ""));
    }
    const response = await fetch("/api/verification/id/ocr", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The ID could not be scanned.");
    const suggestions = payload.suggestions || {};
    let filled = 0;
    for (const field of ["idType", "idNumber", "idFullName", "idBirthDate", "idAddress", "idExpirationDate"]) {
      const input = document.getElementById(field);
      const value = suggestions[field];
      if (!input || !value) continue;
      input.value = String(value); // the scan is the source of truth; users can still correct it
      filled += 1;
    }
    updateIdAge();
    idScanState = {
      readable: payload.checks?.readable === true,
      complete: ["idType", "idNumber", "idFullName", "idBirthDate"].every((field) => String(suggestions[field] || "").trim()),
    };
    renderIdChecks(payload);
    idStatus(
      filled
        ? `Filled ${filled} field${filled === 1 ? "" : "s"} from the ID. Check them before submitting.`
        : "No fields could be read. Check the photo and try again.",
      filled ? "" : "error",
    );
    return filled > 0;
  } catch (error) {
    idStatus(error.message || "The ID could not be scanned.", "error");
    return false;
  }
}

function updateIdFaceHud(message, meta = {}) {
  const instruction = document.getElementById("id-face-hud-instruction");
  const chip = document.getElementById("id-face-hud-chip");
  if (instruction) instruction.textContent = message;
  if (chip) chip.textContent = meta.detected === false ? "No face" : meta.framed === false ? "Adjust position" : "Face visible";
  const progress = document.getElementById("id-face-hud-progress");
  const index = ["front", "blink", "turn", "final"].indexOf(meta.step);
  if (progress) progress.dataset.progress = String(Math.max(1, index + 1));
}

function updateIdFaceCameraState(state) {
  const frame = document.querySelector("#id-face-capture .face-video-frame");
  const copy = document.getElementById("id-face-camera-state");
  if (frame) frame.setAttribute("data-camera-state", state === "live" ? "live" : state === "done" ? "done" : "idle");
  if (copy) copy.hidden = ["live", "capturing", "done"].includes(state);
}

// The captured frame is a data URL; turn it into a File locally so a failed
// network fetch cannot be reported as a camera failure.
function dataUrlToFile(dataUrl, name) {
  const [header, encoded] = String(dataUrl || "").split(",", 2);
  const mime = /^data:image\/(?:jpeg|png)/.exec(header || "")?.[0]?.slice(5) || "image/jpeg";
  const bytes = Uint8Array.from(atob(encoded || ""), (character) => character.charCodeAt(0));
  return new File([bytes], name, { type: mime });
}

async function startIdFaceCapture() {
  const video = document.getElementById("id-selfie-video");
  const start = document.getElementById("id-face-start");
  const cancel = document.getElementById("id-face-cancel");
  if (!video || idFaceAbortController) return;
  const controller = new AbortController();
  idFaceAbortController = controller;
  idFaceState = { status: "capturing" };
  if (start) start.disabled = true;
  if (cancel) cancel.hidden = false;
  setIdStatus("Starting the camera…");
  try {
    const capture = await runLiveness(
      video,
      (message, meta) => {
        setIdStatus(message);
        updateIdFaceHud(message, meta);
      },
      { signal: controller.signal, onState: updateIdFaceCameraState },
    );
    idFaceFile = dataUrlToFile(capture.image, "face-capture.jpg");
    idFaceState = { status: "captured" };
    setIdStatus("Face captured. Continue to match it with your ID.");
  } catch (error) {
    const copy = cameraErrorCopy(error);
    idFaceState = { status: error?.name === "AbortError" ? "idle" : "failed" };
    setIdStatus(error?.name === "AbortError" ? "Face capture cancelled." : `${copy.title}: ${copy.detail}`, "error");
  } finally {
    idFaceAbortController = null;
    if (start) {
      start.disabled = false;
      start.textContent = idFaceFile ? "Retake face capture" : "Start face capture";
    }
    if (cancel) cancel.hidden = true;
  }
}

async function runIdFaceCheck(faceFile) {
  const result = document.getElementById("id-face-result");
  const retry = document.getElementById("id-face-retry");
  const idPhoto = idAttachedFile;
  if (!result || !idPhoto || !faceFile) return;
  idFaceState = { status: "checking" };
  result.textContent = "Comparing the captured face with the photo on your ID…";
  try {
    const form = new FormData();
    form.append("photos", (await compressPhoto(idPhoto)).file);
    form.append("photos", (await compressPhoto(faceFile)).file);
    const response = await fetch("/api/verification/id/face-check", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The face check could not run.");
    if (payload.status === "matched") {
      idFaceState = { status: "matched", confidence: payload.confidence };
      result.textContent = `Face matches your ID (confidence ${Math.round(payload.confidence)}).`;
    } else if (payload.status === "mismatch") {
      idFaceState = { status: "mismatch" };
      result.textContent = "The captured face does not match the ID photo. Retake the capture and try again.";
    } else if (payload.status === "unclear") {
      idFaceState = { status: "unclear" };
      result.textContent = payload.reason || "The image was unclear. Retake the face capture.";
    } else {
      idFaceState = { status: "unavailable" };
      result.textContent = `${payload.reason || "Face matching is not available on this server."} No face match is required; continue when ready.`;
    }
  } catch (error) {
    idFaceState = { status: "unavailable" };
    result.textContent = `${error.message || "The face check could not run."} No face match is required; continue when ready.`;
  }
  if (retry) retry.hidden = idFaceSatisfied(idFaceState.status);
  result.dataset.status = idFaceState.status;
}

async function startIdCamera() {
  const panel = document.getElementById("id-scan-camera");
  const video = document.getElementById("id-scan-video");
  if (!panel || !video) return;
  try {
    idScanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = idScanStream;
    panel.hidden = false;
    await video.play();
    idStatus("Camera on. Hold the ID steady, then capture.");
  } catch {
    idStatus("Camera unavailable. Use “Upload ID photo” instead.");
  }
}

function stopIdCamera() {
  if (idScanStream) {
    idScanStream.getTracks().forEach((track) => track.stop());
    idScanStream = null;
  }
  const panel = document.getElementById("id-scan-camera");
  const video = document.getElementById("id-scan-video");
  if (video) video.srcObject = null;
  if (panel) panel.hidden = true;
}

async function captureIdPhoto() {
  const video = document.getElementById("id-scan-video");
  if (!video?.videoWidth) {
    idStatus("Camera is still starting.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  stopIdCamera();
  if (blob) attachIdImage(new File([blob], "id-camera.jpg", { type: "image/jpeg" }));
  idStatus("ID photo attached. Press Continue to read it.");
}

async function submitIdVerification(form) {
  const frontFile = idAttachedFile;
  if (!frontFile) throw new Error("Attach a photo of the front of your ID.");
  const backFile = form.elements.namedItem("id-back-photo")?.files?.[0];
  const formData = new FormData();
  for (const [key, value] of new FormData(form).entries()) {
    if (value instanceof File) continue;
    formData.append(key, value);
  }
  formData.append("photos", (await compressPhoto(frontFile)).file);
  if (backFile) formData.append("photos", (await compressPhoto(backFile)).file);
  const confirmed = await confirmAction({
    title: "Submit ID for review?",
    message:
      "An administrator will check the image and the number against this account, then mark the ID verified or ask you to try again.",
    confirmLabel: "Submit ID",
  });
  if (!confirmed) return;
  stopIdCamera();
  clearIdPreview();
  const response = await fetch("/api/verification/id", { method: "POST", body: formData });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The ID could not be submitted.");
  setState({ modalState: null });
  render();
  try {
    await refreshWorkspace();
    render();
  } catch (error) {
    // On the face gate the restricted session cannot read workspace state yet.
    // The ID submission itself succeeded, so keep the dialog closed.
    if (error.code !== "FACE_VERIFICATION_REQUIRED") throw error;
  }
  toast("ID submitted. An administrator will review it.", "success");
}

async function removeIdVerification() {
  const confirmed = await confirmAction({
    title: "Remove verification?",
    message:
      "This permanently deletes your ID image, the stored details, and the verification badge. You can submit a new ID any time afterwards.",
    confirmLabel: "Remove ID data",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/verification/id", { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The verification could not be removed.");
  await refreshWorkspace();
  render();
  toast("Your ID data was removed.", "success");
}

async function reviewIdVerification(userId, decision, note = "") {
  const body = { userId, decision };
  if (decision === "rejected") body.note = note;
  const response = await fetch("/api/verification/id/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The decision could not be recorded.");
  setState({ modalState: null });
  await refreshWorkspace();
  render();
  toast(
    decision === "verified" ? "ID approved. The resident is now verified." : "ID rejected. The resident can submit a new one.",
    decision === "verified" ? "success" : "",
  );
}

async function clearFaceReference(form) {
  const email = String(form.get("email") || "");
  const reason = String(form.get("reason") || "").trim();
  const user = getUser(email);
  if (!user) throw new Error("That account could not be found.");
  if (reason.length < 5) throw new Error("Give the removal a reason of at least 5 characters.");
  const confirmed = await confirmAction({
    title: "Clear face reference?",
    message: `Remove ${user.name}'s face reference and duty-check timestamp? They will need to enroll again at the office PC.`,
    confirmLabel: "Clear face reference",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/verification/face", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: user.id, reason }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The face reference could not be cleared.");
  setState({ modalState: null });
  await refreshWorkspace();
  render();
  toast(`Face reference cleared for ${user.name}.`, "success");
}

async function removeOwnFaceReference() {
  const confirmed = await confirmAction({
    title: "Remove face data?",
    message:
      "This permanently deletes your face reference, the liveness flag, and the duty-check timestamp. Enroll again to use the face check.",
    confirmLabel: "Remove face data",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/verification/face", { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The face reference could not be removed.");
  setState({ faceCheckNotice: "" });
  await refreshWorkspace();
  render();
  toast("Your face data was removed.", "success");
}

let faceCheckAbortController = null;
let adminFaceAbortController = null;

function setFaceCameraState(state, copy = {}, root = document) {
  const frame = root.querySelector(".face-video-frame");
  if (frame) frame.dataset.cameraState = state;
  const iconNode = root.querySelector(".face-camera-icon");
  const title = root.querySelector(".face-camera-title");
  const detail = root.querySelector(".face-camera-detail");
  const note = root.querySelector(".face-camera-note");
  if (iconNode)
    iconNode.innerHTML =
      state === "loading"
        ? '<span class="face-camera-spinner" aria-hidden="true"></span>'
        : icon(copy.icon || "cameraOff", "face-camera-icon-svg");
  if (title) title.textContent = copy.title || "Camera is off";
  if (detail) detail.textContent = copy.detail || "Start the check to turn on your camera.";
  if (note) note.textContent = copy.note || "The preview stays on this device.";
  const startButton = root.querySelector("[data-face-start]");
  const hudCancel = root.querySelector(".face-hud-cancel");
  const running = state === "loading" || state === "live";
  if (startButton) {
    startButton.disabled = running;
    startButton.textContent =
      state === "loading"
        ? "Starting…"
        : state === "live"
          ? startButton.dataset.busyLabel || "Checking…"
          : startButton.dataset.idleLabel || "Start face check";
  }
  if (hudCancel) hudCancel.hidden = !running;
}

function setFaceProgress(meta = {}, root = document) {
  const stageNode = root.querySelector(".face-check-stage");
  const guide = root.querySelector(".face-guide");
  const step = meta.step || "front";
  if (stageNode) stageNode.dataset.step = step;
  if (guide) {
    guide.dataset.detected = String(Boolean(meta.detected));
    if (meta.framed !== undefined) guide.dataset.framed = String(Boolean(meta.framed));
  }
  const progressNode = root.querySelector(".face-hud-progress");
  if (progressNode) progressNode.dataset.progress = String(step === "final" ? 4 : ["front", "blink", "turn"].indexOf(step) + 1);
  const instruction = root.querySelector(".face-hud-instruction");
  if (instruction && meta.message) instruction.textContent = meta.message;
  const chip = root.querySelector(".face-hud-chip");
  if (chip) {
    if (meta.secondsLeft !== undefined) {
      chip.dataset.framing = "poor";
      chip.textContent = "Time is running out — follow the prompt.";
    } else if (meta.framed !== undefined) {
      chip.dataset.framing = meta.framed ? "good" : meta.detected ? "poor" : "none";
      chip.textContent = meta.framed ? "Good framing" : meta.detected ? "Centre your face" : "Face not found";
    }
  }
  const order = ["front", "blink", "turn"];
  const currentIndex = order.indexOf(step);
  stageNode?.querySelectorAll(".face-check-steps li").forEach((item, index) => {
    delete item.dataset.active;
    delete item.dataset.done;
    if (step === "final" || (currentIndex >= 0 && index < currentIndex)) item.dataset.done = "";
    else if (index === currentIndex) item.dataset.active = "";
  });
}

async function finishFaceCheck(mode) {
  const message =
    mode === "enroll" ? "Face enrolled. Your face is now registered for duty checks." : "Face verified. Changes are unlocked for this shift.";
  const resultBox = document.getElementById("face-check-result");
  if (resultBox) {
    resultBox.textContent = message;
    resultBox.dataset.state = "success";
  }
  setState({ faceCheckNotice: message });
  setFaceCameraState("done", { title: "Camera stopped", detail: "Your check is complete.", note: "" });
  if (routeState().type === "face-gate") {
    await loadWorkspaceAfterGate("Face check complete. Welcome back.");
    return;
  }
  await refreshWorkspace();
  render();
  toast(message, "success");
}

async function runAdminFaceEnroll(userId) {
  if (adminFaceAbortController) return;
  const panel = document.getElementById("admin-face-panel");
  const video = document.getElementById("admin-face-video");
  const stage = document.getElementById("admin-face-stage");
  const target = (data.users || []).find((item) => item.id === userId);
  if (!panel || !video || !stage || !target) return;
  const controller = new AbortController();
  adminFaceAbortController = controller;
  setFaceCheckActive(true);
  setFaceCameraState("loading", { title: "Starting camera", detail: "Loading the face models…" }, panel);
  try {
    const capture = await runLiveness(
      video,
      (message, meta) => {
        stage.textContent = message;
        setFaceProgress({ ...meta, message }, panel);
      },
      {
        signal: controller.signal,
        onState: (cameraState) => {
          if (cameraState === "live") setFaceCameraState("live", {}, panel);
        },
      },
    );
    const confirmed = await confirmAction({
      title: "Save this face?",
      message: `Save this captured face as ${target.name}'s verification reference?`,
      confirmLabel: "Save face",
      tone: "danger",
    });
    if (!confirmed) {
      setFaceCameraState("idle", {}, panel);
      stage.textContent = "Capture discarded. No face was saved.";
      return;
    }
    stage.textContent = "Saving face reference…";
    const response = await fetch("/api/users/face-enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, image: capture.image, embedding: capture.descriptor }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The face could not be saved.");
    setFaceCameraState("done", { title: "Camera stopped", detail: "Face reference saved.", note: "" }, panel);
    stage.textContent = "Face reference saved.";
    toast(`Face reference saved for ${target.name}.`, "success");
    setState({ modalState: null });
    await refreshWorkspace();
    render();
  } catch (error) {
    if (error.name === "AbortError") {
      setFaceCameraState("idle", {}, panel);
      stage.textContent = "Capture cancelled. No face was saved.";
    } else {
      const copy = cameraErrorCopy(error);
      setFaceCameraState("error", copy, panel);
      stage.textContent = copy.detail || error.message || "The face could not be captured.";
    }
  } finally {
    adminFaceAbortController = null;
    setFaceCheckActive(false);
  }
}

function showFaceFailure(title, detail) {
  setFaceCameraState("error", { title, detail, icon: "alert", note: "" });
  const stage = document.getElementById("face-stage");
  const resultBox = document.getElementById("face-check-result");
  if (stage) stage.textContent = detail;
  if (resultBox) {
    resultBox.textContent = detail;
    resultBox.dataset.state = "error";
  }
}

async function runFaceCheck(mode) {
  const video = document.getElementById("face-video");
  const stage = document.getElementById("face-stage");
  const resultBox = document.getElementById("face-check-result");
  const startButton = document.getElementById("face-check-start");
  if (!video || !stage || !resultBox || !startButton || faceCheckAbortController) return;
  const controller = new AbortController();
  faceCheckAbortController = controller;
  setFaceCheckActive(true);
  setState({ faceCheckNotice: "" });
  resultBox.textContent = "";
  resultBox.dataset.state = "";
  setFaceProgress({ step: "front", detected: false });
  setFaceCameraState("loading", { title: "Starting camera", detail: "Loading the face models…" });
  try {
    const capture = await runLiveness(
      video,
      (message, meta) => {
        stage.textContent = message;
        setFaceProgress({ ...meta, message });
      },
      {
        signal: controller.signal,
        onState: (state) => {
          if (state === "live") setFaceCameraState("live", { title: "Live", detail: "Follow the prompts to complete the check." });
          if (state === "capturing") {
            const chip = document.getElementById("face-hud-chip");
            if (chip) {
              chip.dataset.framing = "good";
              chip.textContent = "Capturing…";
            }
          }
        },
      },
    );
    stage.textContent = "Matching against your reference…";
    const endpoint = mode === "enroll" ? "/api/verification/face/enroll" : "/api/verification/face/verify";
    const answer = await sendFaceSample(endpoint, capture.descriptor, capture.liveness, capture.image);
    if (answer.ok) {
      await finishFaceCheck(mode);
      return;
    }
    if (answer.mismatch) {
      showFaceFailure(
        "This isn't your enrolled face",
        "The new sample doesn't match your enrolled reference. Ask an administrator to reset it, then try again.",
      );
    } else {
      showFaceFailure("Face check could not finish", answer.error);
    }
  } catch (error) {
    const copy = cameraErrorCopy(error);
    showFaceFailure(copy.title, copy.detail);
  } finally {
    faceCheckAbortController = null;
    setFaceCheckActive(false);
    const frame = document.getElementById("face-panel")?.querySelector(".face-video-frame");
    if (resultBox.dataset.state !== "success" && frame && ["loading", "live", "done"].includes(frame.dataset.cameraState))
      setFaceCameraState("idle");
  }
}

async function sendFaceSample(endpoint, descriptor, liveness, image = null) {
  const body = endpoint.endsWith("/enroll") ? { embedding: descriptor, liveness } : { embedding: descriptor };
  // The image is ignored when Face++ is off, so the local path stays unchanged.
  if (image) body.image = image;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (response.ok) return { ok: true };
  if (response.status === 409 && payload.code === "FACE_MISMATCH") return { mismatch: true };
  return { error: payload.error || "The check failed. Try again." };
}

async function loadOfficialVerificationStatus() {
  try {
    const response = await fetch("/api/verification/status");
    if (!response.ok) return;
    const status = await response.json();
    const enabled = Boolean(status.faceppEnabled);
    if (enabled === Boolean(verificationSettings.faceppEnabled)) return;
    setState({ verificationSettings: { ...verificationSettings, faceppEnabled: enabled } });
    render();
  } catch {
    // Keep the previous value; the note is informational only.
  }
}

async function loadVerificationSettings() {
  const response = await fetch("/api/settings/verification");
  const result = await response.json();
  if (!response.ok) return;
  setState({ verificationSettings: result.settings });
  const form = app.querySelector("#verification-settings-form");
  if (!form) return;
  const { faceVerificationEnabled, requireFaceOnLogin, dutyHours, matchThreshold, faceppEnabled, faceppThreshold, ocrEnabled } =
    result.settings || {};
  form.elements.namedItem("requireFaceOnLogin").checked = requireFaceOnLogin === true;
  form.elements.namedItem("faceVerificationEnabled").checked = faceVerificationEnabled === true;
  form.elements.namedItem("dutyHours").value = String(dutyHours || 9);
  form.elements.namedItem("matchThreshold").value = String(matchThreshold ?? 0.033);
  form.elements.namedItem("faceppEnabled").checked = faceppEnabled === true;
  form.elements.namedItem("faceppThreshold").value = String(faceppThreshold ?? 80);
  form.elements.namedItem("ocrEnabled").checked = ocrEnabled === true;
}

async function saveVerificationSettings(form) {
  const fields = new FormData(form);
  const body = {
    requireFaceOnLogin: fields.get("requireFaceOnLogin") === "1",
    faceVerificationEnabled: fields.get("faceVerificationEnabled") === "1",
    dutyHours: Number(fields.get("dutyHours") || 9),
    matchThreshold: Number(fields.get("matchThreshold") || 0.033),
    faceppEnabled: fields.get("faceppEnabled") === "1",
    faceppThreshold: Number(fields.get("faceppThreshold") || 80),
    ocrEnabled: fields.get("ocrEnabled") === "1",
  };
  const thirdParty = body.faceppEnabled || body.ocrEnabled
    ? " Enabling Face++ or OCR sends face or ID images to a third-party service."
    : "";
  const confirmed = await confirmAction({
    title: "Save verification settings?",
    message: (body.faceVerificationEnabled
      ? "Barangay officials will need a fresh face check before they can make changes. Their next check applies immediately."
      : "The face duty check will be turned off. Stored references are kept until the official removes their face data.") + thirdParty,
    confirmLabel: "Save settings",
  });
  if (!confirmed) return;
  const response = await fetch("/api/settings/verification", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The verification settings could not be saved.");
  setState({ verificationSettings: result.settings });
  toast("Verification settings saved.", "success");
}

async function resetUserPassword(form) {
  const email = String(form.get("email") || "");
  const user = getUser(email);
  if (!user || user.status !== "Active") {
    toast("Reactivate this account before resetting its password.", "error");
    return;
  }
  const confirmed = await confirmAction({
    title: "Reset password?",
    message: `Generate a temporary password for ${user?.name || email} and email it to them?`,
    confirmLabel: "Generate password",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/users/password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The account password could not be reset.");
  setState({ data: result.data });
  setState({ dataRevision: result.revision });
  setState({ currentUser: result.user });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast("Temporary password generated and emailed to the account holder.", "success");
}

async function forgotPassword(form) {
  const fields = new FormData(form);
  const recoveryEmail = String(fields.get("recoveryEmail") || "")
    .trim()
    .toLowerCase();
  if (!recoveryEmail) throw new Error("Enter your recovery email address.");
  const confirmed = await confirmAction({
    title: "Send reset request?",
    message: `Send a password reset request for ${recoveryEmail}?`,
    confirmLabel: "Send request",
  });
  if (!confirmed) return;
  const response = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recoveryEmail }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The reset request could not be sent.");
  toast(result.message || "If an account uses that recovery email, a reset link has been sent.", "success");
  window.location.hash = "#/login";
}

async function resetPassword(form) {
  const fields = new FormData(form);
  const token = String(fields.get("token") || "").trim();
  const newPassword = String(fields.get("newPassword") || "");
  const confirm = String(fields.get("confirmPassword") || "");
  if (newPassword.length < 8) throw new Error("Choose a password with at least 8 characters.");
  if (newPassword !== confirm) throw new Error("The new passwords do not match.");
  const confirmed = await confirmAction({
    title: "Reset password?",
    message: "Set your new password?",
    confirmLabel: "Reset password",
  });
  if (!confirmed) return;
  const response = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The password could not be reset.");
  toast("Password reset. Sign in with your new password.", "success");
  window.location.hash = "#/login";
}

async function verifyRecovery(form) {
  const token = String(form.get("token") || "").trim();
  if (!token) throw new Error("This verification link is missing its code.");
  const confirmed = await confirmAction({
    title: "Verify recovery email?",
    message: "Confirm this address for password recovery?",
    confirmLabel: "Verify email",
  });
  if (!confirmed) return;
  const response = await fetch("/api/auth/verify-recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "This verification link is invalid or expired.");
  toast("Recovery email verified. Password reset links will be sent there.", "success");
  window.location.hash = "#/login";
}

async function verifyEmailChange(form) {
  const token = String(form.get("token") || "").trim();
  if (!token) throw new Error("This verification link is missing its code.");
  const response = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "This verification link is invalid or expired.");
  if (result.user) {
    setState({ currentUser: result.user });
    window.location.hash = `#/${result.user.role}/profile`;
    render();
    toast("Email address updated. Use it the next time you sign in.", "success");
  } else {
    toast("Email address updated. Use it the next time you sign in.", "success");
    window.location.hash = "#/login";
  }
}

async function addOrEditUser(form) {
  if (adminFaceAbortController) throw new Error("Finish or cancel the face capture before saving the account.");
  const originalEmail = String(form.get("originalEmail") || "");
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const role = String(form.get("role") || "");
  const area = String(form.get("area") || "");
  const status = String(form.get("status") || "");
  const existing = originalEmail ? getUser(originalEmail) : null;
  if (originalEmail && !existing) throw new Error("This account could not be found. Refresh the user list and try again.");
  // Account status changes of an existing account must go through the dedicated
  // deactivate/reactivate endpoints, which revoke the account's sessions. The
  // account editor never changes an existing account's status.
  const accountStatus = existing ? existing.status : status;
  if (name.length < 2) throw new Error("Enter the account holder's name.");
  if (!Object.hasOwn(ROLES, role)) throw new Error("Select a valid account role.");
  if (!existing && !["Active", "Inactive"].includes(status)) throw new Error("Select a valid account status.");
  if (role === "resident" && !data.locations.some((location) => location.area === area)) {
    throw new Error("Choose a resident area from the managed community locations.");
  }
  const selectedDays = form.getAll("availableDays").map(String);
  if (role === "official" && selectedDays.length === 0) throw new Error("Select at least one day the official is available.");
  const savedAvailableDays =
    role === "official" ? OFFICIAL_DAYS.filter((day) => selectedDays.includes(day)) : existing?.availableDays || DEFAULT_OFFICIAL_DAYS;
  const savedWorkingHours = role === "official" ? BARANGAY_WORKING_HOURS : existing?.workingHours || BARANGAY_WORKING_HOURS;
  if (data.users.some((user) => user.email.toLowerCase() === email && user.email !== originalEmail))
    throw new Error("An account already uses this email address.");
  if (email !== originalEmail && originalEmail === currentUser.email)
    throw new Error("You cannot change your own administrator sign-in address here.");
  if (area.length < 2) throw new Error("Enter an area for this account.");
  const password = existing ? "" : String(form.get("password") || "");
  if (!existing && password.length < 8) throw new Error("Use an initial password with at least 8 characters.");
  if (existing?.email === currentUser.email && (role !== "administrator" || accountStatus !== "Active"))
    throw new Error("You cannot remove your own administrator access or deactivate your account.");
  const confirmed = await confirmAction({
    title: existing ? "Save account?" : "Create account?",
    message: existing ? `Save changes to ${existing.name}'s account?` : `Create an account for ${name} as ${ROLES[role]}?`,
    confirmLabel: existing ? "Save account" : "Create account",
  });
  if (!confirmed) return;
  if (existing) {
    const oldEmail = existing.email;
    Object.assign(existing, {
      name,
      email,
      role,
      area,
      status: accountStatus,
      workingHours: savedWorkingHours,
      availableDays: savedAvailableDays,
      phone: String(form.get("phone") || "").trim(),
    });
    data.reports
      .filter((report) => report.userEmail === oldEmail)
      .forEach((report) => {
        report.name = name;
      });
    if (oldEmail !== email) {
      data.notifications.forEach((item) => {
        if (item.targetEmail === oldEmail) item.targetEmail = email;
      });
      data.reports.forEach((report) => {
        if (report.userEmail === oldEmail) report.userEmail = email;
      });
    }
  } else {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        name,
        area,
        role,
        status,
        workingHours: savedWorkingHours,
        availableDays: savedAvailableDays,
        phone: String(form.get("phone") || "").trim(),
        password,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The account could not be added.");
    setState({ data: result.data });
    setState({ dataRevision: result.revision });
    setState({ currentUser: result.user });
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
    setState({ modalState: null });
    render();
    toast("Account added.", "success");
    return;
  }
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast(existing ? "Account updated." : "Account added.", "success");
}

async function toggleAccount(email) {
  const user = getUser(email);
  if (!user) throw new Error("This account could not be found.");
  if (user.email === currentUser.email) throw new Error("You cannot deactivate the administrator account you are using.");
  if (user.status !== "Active") {
    const confirmed = await confirmAction({
      title: "Reactivate account?",
      message: `Reactivate ${user.name}'s account?`,
      confirmLabel: "Reactivate",
    });
    if (!confirmed) return;
    const response = await fetch("/api/users/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The account could not be reactivated.");
    const stateResponse = await fetch("/api/state");
    const state = await stateResponse.json();
    if (!stateResponse.ok) throw new Error(state.error || "The account was reactivated, but the user list could not be refreshed.");
    setState({ data: state.data });
    setState({ dataRevision: state.revision });
    setState({ currentUser: state.user });
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
    setState({ modalState: null });
    render();
    announceSessionChange();
    const reactivated = getUser(email);
    toast(`${reactivated.name}'s account is ${reactivated.status.toLowerCase()}.`, "success");
    return;
  }
  showModal("deactivate", email);
}

async function deactivateAccount(email, reason) {
  const user = getUser(email);
  if (!user) throw new Error("This account could not be found.");
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason) throw new Error("A deactivation reason is required.");
  const confirmed = await confirmAction({
    title: "Deactivate account?",
    message: `Deactivate ${user.name}'s account? They will no longer be able to sign in.`,
    confirmLabel: "Deactivate account",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/users/deactivate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, reason: trimmedReason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The account could not be deactivated.");
  // The server revoked this account's sessions in the same transaction. Refresh
  // state from the server instead of saving the local copy, so the account
  // editor can never replay an old status change through /api/state.
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "The account was deactivated, but the user list could not be refreshed.");
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ currentUser: state.user });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  announceSessionChange();
  const deactivated = getUser(email);
  toast(`${deactivated.name}'s account is ${deactivated.status.toLowerCase()}.`, "success");
}

function openReport(id) {
  const report = getReport(id);
  if (!report) {
    toast("This report could not be found. Return to the concerns list and try again.", "error");
    return;
  }
  if (currentUser.role === "resident" && report.userEmail !== currentUser.email) {
    toast("Residents can only open their own reports.", "error");
    return;
  }
  setState({ selectedReportId: report.id });
  const destination = routeUrl(
    currentUser.role,
    currentUser.role === "resident" ? "reports" : currentUser.role === "administrator" ? "reports" : "concerns",
  );
  if (window.location.hash === destination) {
    setState({ pendingReportRoute: "" });
    render();
  } else {
    setState({ pendingReportRoute: destination });
    window.location.hash = destination;
  }
}

async function markNotification(id) {
  const item = data.notifications.find((notification) => notification.id === id && notification.targetEmail === currentUser.email);
  if (!item) throw new Error("This notification could not be found.");
  if (item.read) return;
  const confirmed = await confirmAction({
    title: "Mark as read?",
    message: "Mark this notification as read?",
    confirmLabel: "Mark read",
  });
  if (!confirmed) return;
  item.read = true;
  try {
    const response = await fetch("/api/community/mark-notifications-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    if (!response.ok) throw new Error("Could not mark notification as read.");
  } catch (error) {
    item.read = false;
    throw error;
  }
  render();
}

async function handleAction(button, clickEvent) {
  const action = button.dataset.action;
  if (action === "forgot-password") {
    window.location.hash = "#/forgot-password";
  } else if (action === "request-admin-reset") {
    const email = window.prompt("Enter your CommUnity account email:");
    if (email?.trim()) {
      const confirmed = await confirmAction({
        title: "Send reset request?",
        message: `Send a password reset request for ${email.trim().toLowerCase()}?`,
        confirmLabel: "Send request",
      });
      if (!confirmed) return;
      const response = await fetch("/api/auth/request-admin-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The request could not be sent.");
      toast(result.message || "If an account exists, an admin has been notified.", "success");
    }
  } else if (action === "toggle-password") {
    const field = app.querySelector('#login-form input[name="password"]');
    if (field) {
      field.type = field.type === "password" ? "text" : "password";
      button.setAttribute("aria-label", field.type === "password" ? "Show password" : "Hide password");
    }
  } else if (action === "toggle-password-field") {
    const field = document.getElementById(button.dataset.target);
    if (!field || !app.contains(field) || !field.matches("input[type=password], input[type=text]"))
      throw new Error("This password field could not be found.");
    field.type = field.type === "password" ? "text" : "password";
    button.setAttribute("aria-label", `${field.type === "password" ? "Show" : "Hide"} ${field.labels?.[0]?.textContent || "password"}`);
  } else if (action === "face-gate-signout") {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("CommUnity could not sign you out. Try again.");
    clearSession();
    stopStateUpdates();
    setState({ faceCheckNotice: "" });
    window.location.hash = "#/login";
    render();
    announceSessionChange();
  } else if (action === "logout") {
    const hasUnsaved = hasUnsavedPermissionChanges();
    const confirmed = await confirmAction({
      title: "Sign out?",
      message: hasUnsaved
        ? "You have unsaved role permission changes. Sign out and discard them?"
        : "You will need to sign in again to continue.",
      confirmLabel: "Sign out",
      tone: "danger",
    });
    if (!confirmed) return;
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("CommUnity could not sign you out. Try again.");
    clearSession();
    stopStateUpdates();
    setState({ permissionDrafts: {} });
    setState({ permissionOpenGroups: {} });
    setState({ permissionOpenAccounts: {} });
    setState({ selectedPermissionAccount: null });
    window.location.hash = "#/login";
    render();
    announceSessionChange();
    toast("You have signed out.", "success");
  } else if (action === "test-smtp") {
    const confirmed = await confirmAction({
      title: "Send test email?",
      message: "Send a test email using the current SMTP settings?",
      confirmLabel: "Send test email",
    });
    if (!confirmed) return;
    const response = await fetch("/api/settings/smtp/test", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The test email could not be sent.");
    toast("Test email sent to your administrator address.", "success");
  } else if (action === "smtp-preset") {
    applySmtpPreset(button.dataset.provider);
  } else if (action === "view-report" || action === "view-notification-report") {
    openReport(button.dataset.id);
  } else if (action === "claim-report" || action === "release-report") {
    await updateReportAssignment(button.dataset.id, action === "claim-report");
  } else if (action === "assign-report") {
    const officialId = button.closest(".assignment-record")?.querySelector("[name=officialId]")?.value || "";
    if (!officialId) throw new Error("Select an official before assigning this concern.");
    await assignReportToOfficial(button.dataset.id, officialId);
  } else if (action === "confirm-report") {
    await confirmReport(button.dataset.id, "");
  } else if (action === "reopen-report") {
    setState({ modalState: { kind: "report-reopen", id: button.dataset.id } });
    render();
  } else if (action === "back-list") {
    setState({ selectedReportId: null });
    render();
  } else if (action === "filter-reports") {
    setState({ reportFilter: button.dataset.value });
    render();
  } else if (action === "filter-official-assigned") {
    setState({ officialAssignedFilter: button.dataset.value });
    render();
  } else if (action === "sort-official-history") {
    const sort =
      button.dataset.value === "date"
        ? officialHistorySort === "newest"
          ? "oldest"
          : "newest"
        : officialHistorySort === "concern-asc"
          ? "concern-desc"
          : "concern-asc";
    setState({ officialHistorySort: sort });
    render();
  } else if (action === "filter-admin-reports") {
    setState({ adminReportFilters: { ...adminReportFilters, status: button.dataset.value } });
    render();
  } else if (action === "clear-admin-report-filters") {
    setState({ adminReportFilters: { status: "all", area: "all", sort: "newest", query: "" }, searchQuery: "" });
    render();
  } else if (action === "clear-report-area") {
    setState({ adminReportFilters: { ...adminReportFilters, area: "all" } });
    render();
  } else if (action === "analytics-area-reports") {
    setState({
      adminReportFilters: {
        status: "open",
        area: button.dataset.area || "all",
        sort: "newest",
        query: button.dataset.issue || "",
      },
    });
    window.history.replaceState(null, "", routeUrl("administrator", "reports"));
    render();
  } else if (action === "filter-approvals") {
    setState({ approvalFilter: button.dataset.value });
    render();
  } else if (action === "filter-notifications") {
    setState({ notificationFilter: button.dataset.value });
    render();
  } else if (action === "change-page") {
    const table = app.querySelector(`.records[data-pagination-id="${button.dataset.paginationId}"]`);
    if (table) {
      table.dataset.page = String(Number(table.dataset.page || 0) + Number(button.dataset.direction));
      updatePagination(table);
    }
  } else if (action === "mark-read") {
    await markNotification(button.dataset.id);
  } else if (action === "mark-all-read") {
    const unreadItems = data.notifications.filter((item) => item.targetEmail === currentUser.email && !item.read);
    if (!unreadItems.length) {
      toast("There are no unread notifications.", "success");
      return;
    }
    const confirmed = await confirmAction({
      title: "Mark all as read?",
      message: `Mark all ${unreadItems.length} notifications as read?`,
      confirmLabel: "Mark all read",
    });
    if (!confirmed) return;
    const unreadIds = unreadItems.map((item) => item.id);
    unreadItems.forEach((item) => {
      item.read = true;
    });
    try {
      if (unreadIds.length) {
        const response = await fetch("/api/community/mark-notifications-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: unreadIds }),
        });
        if (!response.ok) throw new Error("Could not mark notifications as read.");
      }
      render();
      toast("All notifications marked as read.", "success");
    } catch (error) {
      unreadItems.forEach((item) => {
        item.read = false;
      });
      throw error;
    }
  } else if (action === "add-schedule") {
    showModal("schedule");
  } else if (action === "view-schedule") {
    showModal("schedule-detail", button.dataset.id);
  } else if (action === "edit-schedule") {
    showModal("schedule", button.dataset.id);
  } else if (action === "delete-schedule") {
    const schedule = data.schedules.find((item) => item.id === button.dataset.id);
    if (!schedule) throw new Error("This schedule could not be found.");
    const confirmed = await confirmAction({
      title: "Remove schedule?",
      message: `Remove the ${schedule.wasteType} collection schedule for ${schedule.area}? A notice will be posted to residents in the affected area.`,
      confirmLabel: "Remove schedule",
      tone: "danger",
    });
    if (confirmed) {
      data.schedules = data.schedules.filter((item) => item.id !== schedule.id);
      if (await localSave()) {
        closeModal();
        toast("Schedule removed and residents notified.", "success");
      }
    }
  } else if (action === "add-user") {
    showModal("user");
  } else if (action === "edit-user") {
    showModal("user", button.dataset.id);
  } else if (action === "reset-user-password") {
    showModal("user-password", button.dataset.id);
  } else if (action === "clear-face") {
    showModal("clear-face", button.dataset.id);
  } else if (action === "verify-id") {
    idStep = 1;
    idScanState = { readable: false, complete: false };
    idFaceState = { status: "idle" };
    idFaceFile = null;
    showModal("verify-id");
  } else if (action === "id-scan-camera") {
    await startIdCamera();
  } else if (action === "id-scan-capture") {
    await captureIdPhoto();
  } else if (action === "id-scan-close") {
    stopIdCamera();
  } else if (action === "id-back-remove") {
    resetBackPreview();
    const input = document.getElementById("id-back-photo");
    if (input) input.value = "";
  } else if (action === "id-step-next") {
    idStepNext();
  } else if (action === "id-step-back") {
    stopIdCamera();
    setIdStep(idStep - 1);
  } else if (action === "id-step-manual") {
    const field = document.getElementById("id-manual-photo-field");
    if (field) field.hidden = false;
    setIdStep(idIntegrated() ? 5 : 3);
  } else if (action === "id-scan-retry") {
    clearIdPreview();
    setIdStep(1);
  } else if (action === "id-face-start") {
    await startIdFaceCapture();
  } else if (action === "id-face-cancel") {
    idFaceAbortController?.abort();
  } else if (action === "id-face-retry") {
    idFaceState = { status: "idle" };
    idFaceFile = null;
    setIdStep(3);
  } else if (action === "id-step-submit") {
    const consent = document.querySelector('#id-submit-form input[name="consent"]');
    if (!consent?.checked) {
      idStatus("Check the consent box before submitting.", "error");
      consent?.focus();
      return;
    }
    idStatus("");
    await submitIdVerification(document.getElementById("id-submit-form"));
  } else if (action === "id-remove") {
    await removeIdVerification();
  } else if (action === "view-id-image") {
    showModal("id-image", button.dataset.id);
  } else if (action === "approve-id") {
    const userId = button.dataset.id;
    const confirmed = await confirmAction({
      title: "Approve ID?",
      message: `Mark ${button.dataset.email || "this resident"} as ID verified? Staff will see the badge next to their name.`,
      confirmLabel: "Approve ID",
    });
    if (!confirmed) return;
    await reviewIdVerification(userId, "verified");
  } else if (action === "reject-id") {
    showModal("reject-id", button.dataset.id);
  } else if (action === "face-check-start") {
    await runFaceCheck("verify");
  } else if (action === "face-enroll-start") {
    await runFaceCheck("enroll");
  } else if (action === "admin-face-enroll") {
    await runAdminFaceEnroll(button.dataset.id);
  } else if (action === "admin-face-cancel") {
    adminFaceAbortController?.abort();
  } else if (action === "face-check-cancel") {
    faceCheckAbortController?.abort();
  } else if (action === "face-self-remove") {
    await removeOwnFaceReference();
  } else if (action === "toggle-user") {
    const user = getUser(button.dataset.id);
    if (user?.status === "Active") showModal("deactivate", button.dataset.id);
    else await toggleAccount(button.dataset.id);
  } else if (action === "add-location") {
    showModal("location");
  } else if (action === "edit-location") {
    showModal("location", button.dataset.id);
  } else if (action === "delete-location") {
    const location = data.locations.find((item) => item.id === button.dataset.id);
    if (!location) throw new Error("This community location could not be found.");
    const confirmed = await confirmAction({
      title: "Remove location?",
      message: `Remove ${location.area}? Locations used by accounts, reports, or schedules cannot be removed.`,
      confirmLabel: "Remove location",
      tone: "danger",
    });
    if (confirmed) {
      data.locations = data.locations.filter((item) => item.id !== location.id);
      if (await localSave()) {
        setState({ modalState: null });
        render();
        toast("Community location removed.", "success");
      }
    }
  } else if (action === "add-recycling") {
    showModal("recycling");
  } else if (action === "edit-recycling") {
    showModal("recycling", button.dataset.id);
  } else if (action === "delete-recycling") {
    const item = data.recyclingLocations.find((record) => record.id === button.dataset.id);
    if (!item) throw new Error("This recycling listing could not be found.");
    const confirmed = await confirmAction({
      title: "Remove listing?",
      message: `Remove ${item.name} from the recycling directory?`,
      confirmLabel: "Remove listing",
      tone: "danger",
    });
    if (confirmed) {
      data.recyclingLocations = data.recyclingLocations.filter((record) => record.id !== item.id);
      if (await localSave()) {
        setState({ modalState: null });
        render();
        toast("Recycling listing removed.", "success");
      }
    }
  } else if (action === "add-announcement") {
    showModal("announcement");
  } else if (action === "add-hotline") {
    showModal("hotline");
  } else if (action === "edit-hotline") {
    showModal("hotline", button.dataset.id);
  } else if (action === "delete-hotline") {
    await deleteHotline(button.dataset.id);
  } else if (action === "verify-hotline") {
    await verifyHotline(button.dataset.id);
  } else if (action === "request-hotline-correction") {
    showModal("hotline-correction", button.dataset.id);
  } else if (action === "suggest-hotline") {
    showModal("hotline-suggestion");
  } else if (action === "review-hotline-correction") {
    setState({ modalState: { kind: "hotline-correction-review", id: button.dataset.id, decision: button.dataset.decision } });
    render();
  } else if (action === "view-hotline-correction") {
    setState({ modalState: { kind: "hotline-correction-detail", id: button.dataset.id } });
    render();
  } else if (action === "copy-hotline") {
    await copyHotline(button.dataset.number);
  } else if (action === "reset-correction-filters") {
    setState({ correctionFilters: { query: "", status: "all", type: "all", date: "all" } });
    render();
  } else if (action === "edit-announcement") {
    showModal("announcement", button.dataset.id);
  } else if (action === "approve-announcement") {
    await decideAnnouncement(button.dataset.id, "approved");
  } else if (action === "decline-announcement") {
    setState({ modalState: { kind: "announcement-decline", id: button.dataset.id } });
    render();
  } else if (action === "delete-announcement") {
    const item = data.announcements.find((record) => record.id === button.dataset.id);
    if (!item) throw new Error("This announcement could not be found.");
    const confirmed = await confirmAction({
      title: "Remove announcement?",
      message: `Remove the announcement “${item.title}”?`,
      confirmLabel: "Remove announcement",
      tone: "danger",
    });
    if (confirmed) {
      const response = await fetch("/api/announcements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The announcement could not be removed.");
      setState({ data: result.data });
      setState({ dataRevision: result.revision });
      setState({ currentUser: result.user });
      setState({ lastPersistedSnapshot: JSON.stringify(data) });
      setState({ modalState: null });
      render();
      toast("Announcement removed.", "success");
    }
  } else if (action === "toggle-account-permission") {
    const email = button.dataset.email;
    const permission = button.dataset.permission;
    const account = (data.users || []).find((user) => user.email === email);
    if (account?.role !== "official") throw new Error("Only Barangay official accounts can have permission overrides.");
    const existingOverrides = data.accountOverrides?.[email] || {};
    const current = existingOverrides[permission] ?? Boolean(data.permissions.official?.[permission]);
    const permissionLabel = PERMISSION_DEFS.find((item) => item.id === permission)?.label || permission;
    const confirmed = await confirmAction({
      title: current ? "Disable permission?" : "Enable permission?",
      message: `${current ? "Disable" : "Enable"} ${permissionLabel} for ${account.name}?`,
      confirmLabel: current ? "Disable" : "Enable",
      tone: current ? "danger" : "primary",
    });
    if (!confirmed) return;
    data.accountOverrides = data.accountOverrides || {};
    data.accountOverrides[email] = data.accountOverrides[email] || {};
    data.accountOverrides[email][permission] = !current;
    if (await localSave()) {
      render();
      toast("Barangay official permissions saved.", "success");
    }
  } else if (action === "reset-account-permission") {
    const email = button.dataset.email;
    const permission = button.dataset.permission;
    const account = (data.users || []).find((user) => user.email === email);
    if (account?.role !== "official") throw new Error("Only Barangay official accounts can have permission overrides.");
    const existingOverrides = data.accountOverrides?.[email] || {};
    if (!Object.hasOwn(existingOverrides, permission)) {
      toast("No override to clear.", "success");
      return;
    }
    const confirmed = await confirmAction({
      title: "Clear override?",
      message: `Remove the ${permission} override for ${account.name} and fall back to the role default?`,
      confirmLabel: "Clear override",
      tone: "danger",
    });
    if (!confirmed) return;
    delete data.accountOverrides[email][permission];
    if (Object.keys(data.accountOverrides[email]).length === 0) {
      delete data.accountOverrides[email];
    }
    if (await localSave()) {
      render();
      toast(`Override cleared for ${account.name}.`, "success");
    }
  } else if (action === "reset-account-permissions") {
    const email = button.dataset.email;
    const account = (data.users || []).find((user) => user.email === email);
    if (account?.role !== "official") throw new Error("Only Barangay official accounts can have permission overrides.");
    if (data.accountOverrides?.[email]) {
      const confirmed = await confirmAction({
        title: "Reset permissions?",
        message: `Reset ${account.name}'s permission overrides to the role default?`,
        confirmLabel: "Reset permissions",
        tone: "danger",
      });
      if (!confirmed) return;
      delete data.accountOverrides[email];
      if (await localSave()) {
        render();
        toast("Barangay official permissions reset to role default.", "success");
      }
    } else {
      toast("No overrides to reset.", "success");
    }
  } else if (action === "export-activity-log") {
    await exportActivityLog();
  } else if (action === "view-activity") {
    const event = activityLogState.activities.find((item) => item.id === button.dataset.id);
    if (event) {
      setState({ modalState: { kind: "activity-detail", event } });
      render();
    }
  } else if (action === "activity-page") {
    await loadActivityLog(activityLogState.page + Number(button.dataset.direction), true);
  } else if (action === "clear-activity-filters") {
    setState({ activityFilters: { from: "", to: "", role: "" } });
    await loadActivityLog(1, true);
    render();
  } else if (action === "export-reports") {
    exportReports();
  } else if (action === "export-report-history") {
    exportReports(true);
  } else if (action === "toggle-menu") {
    const drawer = app.querySelector("#mobile-navigation");
    drawer.hidden = false;
    button.setAttribute("aria-expanded", "true");
    app.querySelector(".mobile-drawer [data-action=close-menu]")?.focus();
  } else if (action === "close-menu" || action === "close-menu-backdrop") {
    const drawer = app.querySelector("#mobile-navigation");
    if (drawer && (action !== "close-menu-backdrop" || button === clickEvent.target)) {
      drawer.hidden = true;
      app.querySelector(".mobile-menu-button")?.setAttribute("aria-expanded", "false");
      app.querySelector(".mobile-menu-button")?.focus();
    }
  } else if (action === "toggle-profile-summary") {
    // Toggle in place: a full render would rebuild an open ID wizard and send
    // the resident back to step 1, losing their capture and typed details.
    const collapsed = !profileSummaryCollapsed;
    setState({ profileSummaryCollapsed: collapsed });
    const panel = app.querySelector(".profile-summary-float");
    panel?.classList.toggle("is-collapsed", collapsed);
    const toggle = panel?.querySelector(".profile-summary-toggle");
    toggle?.setAttribute("aria-expanded", String(!collapsed));
    const iconNode = toggle?.querySelector(".profile-summary-toggle-icon");
    if (iconNode) iconNode.textContent = collapsed ? "+" : "−";
    const body = panel?.querySelector("#profile-summary-body");
    if (body) body.hidden = collapsed;
  } else if (action === "close-modal") {
    closeModal();
  } else if (action === "close-modal-backdrop" && button === clickEvent.target) {
    closeModal();
  } else if (action === "calendar-prev") {
    if (calendarMonth === 0) {
      setState({ calendarMonth: 11, calendarYear: calendarYear - 1 });
    } else {
      setState({ calendarMonth: calendarMonth - 1 });
    }
    render();
  } else if (action === "calendar-next") {
    if (calendarMonth === 11) {
      setState({ calendarMonth: 0, calendarYear: calendarYear + 1 });
    } else {
      setState({ calendarMonth: calendarMonth + 1 });
    }
    render();
  } else if (action === "calendar-day") {
    const date = button.dataset.date || "";
    const now = Date.now();
    const isDoubleClick = clickEvent.detail === 2 || (lastCalendarClick.date === date && now - lastCalendarClick.at < 450);
    lastCalendarClick = { date, at: now };
    if (isDoubleClick && button.classList.contains("calendar-cell--has-events")) {
      lastCalendarClick = { date: "", at: 0 };
      setState({ calendarSelectedDate: date });
      setState({ modalState: { kind: "calendar-event-detail", date } });
      render();
      return;
    }
    setState({ calendarSelectedDate: date });
    render();
  } else if (action === "add-calendar-event") {
    setState({ modalState: { kind: "calendar-event", id: "", date: button.dataset.date || calendarSelectedDate || todayISO() } });
    render();
  } else if (action === "approve-calendar-event") {
    await decideCalendarEvent(button.dataset.id, "approved");
  } else if (action === "decline-calendar-event") {
    setState({ modalState: { kind: "calendar-decline", id: button.dataset.id } });
    render();
  } else if (action === "toggle-location-map") {
    const expanded = !locationMapExpanded;
    if (!expanded) {
      locationMap?.remove();
      setMapState({ locationMap: null, locationMapElement: null });
    }
    setMapState({ locationMapExpanded: expanded });
    render();
  } else if (action === "toggle-report-map") {
    setMapState({ reportMapExpanded: !reportMapExpanded });
    const region = app.querySelector("#report-map-region");
    const toggle = app.querySelector('[data-action="toggle-report-map"]');
    region.hidden = !reportMapExpanded;
    toggle.setAttribute("aria-expanded", String(reportMapExpanded));
    toggle.textContent = reportMapExpanded ? "Hide map" : "Where did this happen?";
    if (reportMapExpanded) initializeReportMap();
  } else if (action === "location-allow" || action === "location-recheck") {
    resolveReportLocation({ userInitiated: true, announce: true, force: true }).catch(() => {});
  } else if (action === "location-reload") {
    window.location.reload();
  } else if (action === "use-current-location") {
    useCurrentLocation();
  } else if (action === "clear-report-map-pin") {
    setMapState({ reportMapSelection: null });
    app.querySelector("#report-latitude").value = "";
    app.querySelector("#report-longitude").value = "";
    app.querySelector('[data-action="clear-report-map-pin"]').hidden = true;
    if (reportMapMarker) reportMap.removeLayer(reportMapMarker);
    setMapState({ reportMapMarker: null });
    const status = app.querySelector("#report-map-status");
    if (status) status.textContent = "No pin selected. Click the map to place one, or continue without it.";
  } else if (action === "clear-announcement-map-pin") {
    setMapState({ announcementMapSelection: null });
    const latitudeField = app.querySelector("#announcement-latitude");
    const longitudeField = app.querySelector("#announcement-longitude");
    if (latitudeField) latitudeField.value = "";
    if (longitudeField) longitudeField.value = "";
    const clearButton = app.querySelector('[data-action="clear-announcement-map-pin"]');
    if (clearButton) clearButton.hidden = true;
    if (announcementMapMarker && announcementMap) announcementMap.removeLayer(announcementMapMarker);
    setMapState({ announcementMapMarker: null });
    const status = app.querySelector("#announcement-map-status");
    if (status) status.textContent = "No pin selected. Click the map to place the event location.";
  } else if (action === "toggle-calendar-event-map") {
    setMapState({ calendarEventMapExpanded: !calendarEventMapExpanded });
    const region = app.querySelector("#calendar-event-map-region");
    region.hidden = !calendarEventMapExpanded;
    if (calendarEventMapExpanded) initializeCalendarEventMap();
  } else if (action === "clear-calendar-event-map-pin") {
    setMapState({ calendarEventMapSelection: null });
    const latitudeField = app.querySelector("#calendar-event-latitude");
    const longitudeField = app.querySelector("#calendar-event-longitude");
    if (latitudeField) latitudeField.value = "";
    if (longitudeField) longitudeField.value = "";
    const clearButton = app.querySelector('[data-action="clear-calendar-event-map-pin"]');
    if (clearButton) clearButton.hidden = true;
    if (calendarEventMapMarker && calendarEventMap) calendarEventMap.removeLayer(calendarEventMapMarker);
    setMapState({ calendarEventMapMarker: null });
    const status = app.querySelector("#calendar-event-map-status");
    if (status) status.textContent = "No pin selected. Click the map to place the event location.";
  } else if (action === "clear-location-map-pin") {
    setLocationPickerPin(null);
  } else if (action === "view-announcement-location") {
    setState({ modalState: { kind: "announcement-location", id: button.dataset.id } });
    render();
  } else if (action === "edit-report-draft") {
    reportDraft.step = "details";
    setMapState({
      reportMapSelection:
        reportDraft.latitude === null
          ? null
          : {
              latitude: reportDraft.latitude,
              longitude: reportDraft.longitude,
            },
    });
    render();
  } else if (action === "submit-report") {
    submitReportDraft().catch((error) => toast(error.message, "error"));
  } else if (action === "remove-photo") {
    uploadPhotos.splice(Number(button.dataset.index), 1);
    // Refresh only the preview row so an in-progress report form is not rebuilt.
    const preview = app.querySelector("#photo-preview");
    if (preview) preview.innerHTML = photoPreviewMarkup();
    else render();
  }
}

async function handleSubmit(formEvent) {
  const form = formEvent.target;
  const formId = form.getAttribute("id");
  const fields = new FormData(form);
  try {
    if (formId === "login-form") {
      await login(String(fields.get("email") || ""), String(fields.get("password") || ""), Boolean(fields.get("remember")));
    } else if (formId === "id-submit-form") {
      await submitIdVerification(form);
    } else if (formId === "id-reject-form") {
      await reviewIdVerification(String(fields.get("userId") || ""), "rejected", String(fields.get("note") || "").trim());
    } else if (formId === "clear-face-form") {
      await clearFaceReference(fields);
    } else if (formId === "verification-settings-form") {
      await saveVerificationSettings(form);
    } else if (formId === "register-form") {
      await createResident(fields);
    } else if (formId === "report-draft-form") {
      const draft = reportDraftFromForm(fields);
      if (!CATEGORIES.includes(draft.category) || !isResidentArea(draft.area)) {
        throw new Error("Choose a valid area within Palsara barangay.");
      }
      if (!draft.locationDetail || draft.locationDetail.length > 250)
        throw new Error("Enter a street or nearby landmark no longer than 250 characters.");
      if (draft.description.length < 12) throw new Error("Describe the concern in at least 12 characters.");
      if (draft.description.length > MAX_REPORT_DESCRIPTION_LENGTH)
        throw new Error(`Describe the concern in ${MAX_REPORT_DESCRIPTION_LENGTH} characters or fewer.`);
      if (
        (draft.latitude === null) !== (draft.longitude === null) ||
        (draft.latitude !== null &&
          (!Number.isFinite(draft.latitude) ||
            draft.latitude < -90 ||
            draft.latitude > 90 ||
            !Number.isFinite(draft.longitude) ||
            draft.longitude < -180 ||
            draft.longitude > 180))
      ) {
        throw new Error("Choose a valid map location or clear the pin before continuing.");
      }
      setMapState({
        reportMapSelection:
          draft.latitude === null
            ? null
            : {
                latitude: draft.latitude,
                longitude: draft.longitude,
              },
      });
      setState({ reportDraft: draft });
      render();
    } else if (formId === "report-status-form") {
      await updateReportStatus(fields);
    } else if (formId === "follow-up-form") {
      await submitFollowUp(fields);
    } else if (formId === "report-reopen-form") {
      const reason = String(fields.get("reason") || "").trim();
      if (!reason) throw new Error("Enter a reason before reopening the concern.");
      if (reason.length > 500) throw new Error("Keep the reopening reason within 500 characters.");
      await reopenReport(String(fields.get("reportId") || ""), reason);
    } else if (formId === "report-priority-form") {
      await updateReportPriority(fields);
    } else if (formId === "schedule-form") {
      await updateCollection(fields);
    } else if (formId === "profile-form") {
      await updateProfile(fields);
    } else if (formId === "change-email-form") {
      await requestEmailChange(fields);
    } else if (formId === "smtp-settings-form") {
      await saveSmtpSettings(form);
    } else if (formId === "password-form") {
      await updatePassword(form);
    } else if (formId === "forced-password-form") {
      if (await updatePassword(form)) {
        setState({ modalState: null });
        render();
      }
    } else if (formId === "user-form") {
      await addOrEditUser(fields);
    } else if (formId === "user-password-form") {
      await resetUserPassword(fields);
    } else if (formId === "deactivate-form") {
      await deactivateAccount(String(fields.get("email") || ""), String(fields.get("reason") || ""));
    } else if (formId === "forgot-password-form") {
      await forgotPassword(form);
    } else if (formId === "reset-password-form") {
      await resetPassword(form);
    } else if (formId === "verify-recovery-form") {
      await verifyRecovery(fields);
    } else if (formId === "verify-email-form") {
      await verifyEmailChange(fields);
    } else if (formId === "activity-filter-form") {
      const fields = new FormData(form);
      setState({
        activityFilters: {
          from: String(fields.get("from") || ""),
          to: String(fields.get("to") || ""),
          role: String(fields.get("role") || ""),
        },
      });
      await loadActivityLog(1, true);
    } else if (formId === "location-form") {
      await saveLocation(fields);
    } else if (formId === "recycling-form") {
      await saveRecyclingLocation(fields);
    } else if (formId === "announcement-form") {
      await saveAnnouncement(fields);
    } else if (formId === "hotline-form") {
      await saveHotline(fields, formEvent.submitter?.dataset.publish === "true");
    } else if (formId === "hotline-correction-form") {
      await submitHotlineCorrection(fields);
    } else if (formId === "hotline-suggestion-form") {
      await submitHotlineSuggestion(fields);
    } else if (formId === "hotline-correction-review-form") {
      await reviewHotlineCorrection(fields);
    } else if (formId === "calendar-event-form") {
      await saveCalendarEvent(fields);
    } else if (formId === "calendar-decline-form") {
      await decideCalendarEvent(String(fields.get("id") || ""), "declined", String(fields.get("reason") || "").trim());
    } else if (formId === "announcement-decline-form") {
      await decideAnnouncement(String(fields.get("id") || ""), "declined", String(fields.get("reason") || "").trim());
    }
  } catch (error) {
    if (redirectToFaceCheckIfRequired(error)) return;
    console.warn(`CommUnity could not complete ${formId}.`, error);
    toast(error.message || "The change could not be completed. Check the form and try again.", "error");
  }
}

async function handlePhotoSelection(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  if (uploadPhotos.length + files.length > 3) {
    toast("Attach up to three photos to one report.", "error");
    input.value = "";
    return;
  }
  try {
    const prepared = [];
    for (const file of files) prepared.push(await compressPhoto(file));
    uploadPhotos.push(...prepared);
    input.value = "";
    // Refresh only the preview row so an in-progress report form is not rebuilt.
    const preview = app.querySelector("#photo-preview");
    if (preview) preview.innerHTML = photoPreviewMarkup();
    else render();
  } catch (error) {
    console.error("CommUnity could not prepare the selected report photo.", error);
    toast(error.message, "error");
  }
}

async function handleProfilePhotoSelection(input) {
  const files = Array.from(input.files || []);
  if (!files.length) {
    profilePhotoFile = null;
    profilePhotoPreview = null;
    return;
  }
  const file = files[0];
  try {
    const prepared = await compressPhoto(file);
    profilePhotoFile = prepared.file;
    profilePhotoPreview = prepared.previewUrl;
    input.value = "";
    const avatarEl = app.querySelector(".profile-intro .avatar");
    if (avatarEl) {
      let img = avatarEl.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        avatarEl.textContent = "";
        avatarEl.removeAttribute("aria-hidden");
        avatarEl.append(img);
      }
      img.src = profilePhotoPreview;
      img.alt = "Profile photo preview";
    }
  } catch (error) {
    profilePhotoFile = null;
    profilePhotoPreview = null;
    console.error("CommUnity could not prepare the selected profile photo.", error);
    toast(error.message, "error");
  }
}

function showFatal(error) {
  console.error("CommUnity could not start.", error);
  app.innerHTML = `<main class="fatal-screen">${brandMark()}<h1>CommUnity could not start</h1><p>${esc(error.message || "Check that the Node server is running and reload this page.")}</p>`;
}

let sessionSyncing = false;
let processingShowTimer = null;
let processingHideTimer = null;

export function isProcessing() {
  return processingState.depth > 0;
}

function syncProcessingOverlay() {
  const existing = document.getElementById("processing-modal");
  if (!processingState.visible) {
    if (existing && !existing.classList.contains("is-hiding")) existing.remove();
    return;
  }
  if (existing?.classList.contains("is-hiding")) {
    existing.classList.remove("is-hiding");
  }
  const markup = processingMarkup();
  if (existing) {
    existing.outerHTML = markup;
  } else {
    app.insertAdjacentHTML("beforeend", markup);
  }
}

function processingMarkup() {
  const label = esc(processingState.label || "Processing...");
  const visible = processingState.visible ? " is-visible" : "";
  return `<div id="processing-modal" class="processing-modal${visible}" role="status" aria-live="polite" aria-label="${label}" aria-busy="true"><div class="processing-backdrop"></div><div class="processing-card"><span class="processing-spinner" aria-hidden="true"></span><p class="processing-label">${label}</p></div></div>`;
}

function beginProcessing(label = "Processing...") {
  if (processingHideTimer) {
    clearTimeout(processingHideTimer);
    processingHideTimer = null;
  }
  const nextDepth = processingState.depth + 1;
  setState({ processingState: { ...processingState, depth: nextDepth, label } });
  if (nextDepth === 1) {
    if (processingShowTimer) clearTimeout(processingShowTimer);
    processingShowTimer = setTimeout(() => {
      processingShowTimer = null;
      if (processingState.depth > 0) {
        setState({ processingState: { ...processingState, visible: true } });
        syncProcessingOverlay();
        requestAnimationFrame(() => document.getElementById("processing-modal")?.classList.add("is-visible"));
      }
    }, 140);
  } else if (processingState.visible) {
    syncProcessingOverlay();
  }
}

function endProcessing() {
  const nextDepth = Math.max(0, processingState.depth - 1);
  if (nextDepth > 0) {
    setState({ processingState: { ...processingState, depth: nextDepth } });
    return;
  }
  if (processingShowTimer) {
    clearTimeout(processingShowTimer);
    processingShowTimer = null;
  }
  const modal = document.getElementById("processing-modal");
  setState({ processingState: { ...processingState, depth: 0, visible: false } });
  if (modal && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    modal.classList.remove("is-visible");
    modal.classList.add("is-hiding");
    processingHideTimer = setTimeout(() => {
      processingHideTimer = null;
      modal.remove();
    }, 160);
  } else {
    modal?.remove();
  }
}

async function withProcessing(task, label = "Processing...") {
  beginProcessing(label);
  try {
    return await task();
  } finally {
    endProcessing();
  }
}

async function syncSessionAcrossTabs() {
  if (sessionSyncing) return;
  sessionSyncing = true;
  try {
    const sessionResponse = await fetch("/api/session");
    const session = await sessionResponse.json();
    if (!sessionResponse.ok) return;
    const nextUser = session.user || null;
    if ((nextUser?.email || "") === (currentUser?.email || "")) return;

    if (!nextUser) {
      clearSession();
      stopStateUpdates();
      setState({ data: emptyState() });
      setState({ dataRevision: 0 });
      setState({ lastPersistedSnapshot: "" });
      setState({ modalState: null });
      setState({ permissionDrafts: {} });
      window.location.hash = "#/login";
      render();
      return;
    }

    const stateResponse = await fetch("/api/state");
    const state = await stateResponse.json();
    if (!stateResponse.ok) return;
    setState({ currentUser: state.user });
    setState({ data: state.data });
    setState({ dataRevision: state.revision });
    startStateUpdates();
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
    setState({ modalState: null });
    setState({ permissionDrafts: {} });
    setState({ selectedReportId: null });
    window.location.hash = routeUrl(currentUser.role, "dashboard");
    render();
    toast(`This browser is now signed in as ${currentUser.name}.`, "success");
  } catch (error) {
    console.error("CommUnity could not sync the tab session.", error);
  } finally {
    sessionSyncing = false;
  }
}

function watchSessionAcrossTabs() {
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_SYNC_KEY) syncSessionAcrossTabs();
  });
}

async function initialize() {
  watchSessionAcrossTabs();
  await loadLocalData();
  if (!data) return;
  checkDataConsistency();
  if (currentUser && !currentUser.faceCheckPending) startStateUpdates();
  if (!window.location.hash) window.history.replaceState(null, "", currentUser ? routeUrl(currentUser.role, "dashboard") : "#/login");
  setState({ lastKnownHash: window.location.hash });
  render();
  if (currentUser) refreshGoogleMaps();
}

export function startCommUnity() {
  app.addEventListener("click", async (clickEvent) => {
    const button = clickEvent.target.closest("[data-action]");
    if (!button) return;
    if (isProcessing()) {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      return;
    }
    try {
      // Camera actions own their loading state in the face-check HUD. The
      // global processing overlay would cover the live preview and block Cancel.
      const cameraAction = [
        "face-check-start", "face-enroll-start", "face-check-cancel", "admin-face-enroll", "admin-face-cancel",
        "id-face-start", "id-face-cancel", "id-face-retry",
      ].includes(button.dataset.action);
      if (cameraAction) await handleAction(button, clickEvent);
      else await withProcessing(() => handleAction(button, clickEvent));
    } catch (error) {
      if (redirectToFaceCheckIfRequired(error)) return;
      console.warn("CommUnity action failed.", error);
      toast(error.message || "This action could not be completed.", "error");
    }
  });

  app.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    if (isProcessing()) return;
    withProcessing(() => handleSubmit(submitEvent)).catch((error) => {
      if (redirectToFaceCheckIfRequired(error)) return;
      console.warn("CommUnity submit failed.", error);
      toast(error.message || "The change could not be completed. Check the form and try again.", "error");
    });
  });

  app.addEventListener("input", (inputEvent) => {
    if (inputEvent.target.matches("#description")) {
      const counter = app.querySelector("#description-counter");
      if (counter) counter.textContent = `${inputEvent.target.value.length}/${inputEvent.target.maxLength}`;
    } else if (inputEvent.target.matches("[data-admin-report-search]")) {
      setState({ adminReportFilters: { ...adminReportFilters, query: inputEvent.target.value } });
      refreshSearch(inputEvent.target.value);
    } else if (inputEvent.target.matches("[data-search-input]")) {
      setState({ searchQuery: inputEvent.target.value });
      refreshSearch(inputEvent.target.value);
    } else if (inputEvent.target.matches("[data-correction-search]")) {
      setState({ correctionFilters: { ...correctionFilters, query: inputEvent.target.value } });
      refreshSearch(app.querySelector("[data-search-input]")?.value || "");
    }
  });

  app.addEventListener("dragover", (dragEvent) => {
    const box = dragEvent.target.closest?.(".supporting-upload");
    if (!box) return;
    dragEvent.preventDefault();
    box.classList.add("is-dragging");
  });
  app.addEventListener("dragleave", (dragEvent) => {
    dragEvent.target.closest?.(".supporting-upload")?.classList.remove("is-dragging");
  });
  app.addEventListener("drop", (dragEvent) => {
    const box = dragEvent.target.closest?.(".supporting-upload");
    if (!box) return;
    dragEvent.preventDefault();
    box.classList.remove("is-dragging");
    const file = dragEvent.dataTransfer?.files?.[0];
    const input = box.querySelector('input[type="file"]');
    if (!file || !input) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  app.addEventListener(
    "toggle",
    (toggleEvent) => {
      if (toggleEvent.target?.id === "face-panel") setState({ facePanelOpen: toggleEvent.target.open });
      if (toggleEvent.target?.id === "id-panel") setState({ idPanelOpen: toggleEvent.target.open });
      if (toggleEvent.target?.id === "email-change-panel") setState({ emailPanelOpen: toggleEvent.target.open });
      if (toggleEvent.target?.id === "password-change-panel") setState({ passwordPanelOpen: toggleEvent.target.open });
    },
    true,
  );

  app.addEventListener("change", (changeEvent) => {
    const target = changeEvent.target;
    if (target.matches("#hotline-suggestion-support")) {
      showSupportingFileName(target.files?.[0]);
      return;
    }
    if (target.matches("#id-scan-file")) {
      const file = target.files?.[0];
      target.value = "";
      if (file) {
        attachIdImage(file);
        idStatus("ID photo attached. Press Continue to read it.");
      }
      return;
    }
    if (target.matches("#id-back-photo")) {
      showBackPreview(target.files?.[0]);
      return;
    }
    if (target.matches("#id-manual-photo")) {
      const file = target.files?.[0];
      if (file) attachIdImage(file);
      return;
    }
    if (target.matches("#idBirthDate")) {
      updateIdAge();
      return;
    }
    if (target.matches('#id-submit-form input[name="consent"]') && target.checked) {
      idStatus("");
      return;
    }
    if (target.matches("#report-photos")) handlePhotoSelection(target);
    else if (target.matches("#profile-photo")) handleProfilePhotoSelection(target);
    else if (target.id === "status" && target.form?.getAttribute("id") === "schedule-form") syncScheduleStatusFields(target.form);
    else if (target.matches("#permission-role")) {
      const account = (data.users || []).find((user) => user.email === target.value && user.role === "official");
      if (!account) {
        toast("Choose a valid Barangay official.", "error");
        return;
      }
      setState({ selectedPermissionAccount: target.value });
      render();
      app.querySelector("#permission-role")?.focus();
    } else if (target.matches("[data-admin-report-filter]")) {
      const field = target.dataset.adminReportFilter;
      const value = target.value;
      setState({ adminReportFilters: { ...adminReportFilters, [field]: value } });
      render();
    } else if (target.matches("[data-analytics-range]")) {
      setState({ analyticsRange: target.value });
      render();
    } else if (target.matches("[data-official-history-sort]")) {
      const validSorts = ["newest", "oldest", "concern-asc", "concern-desc", "resident-asc", "resident-desc"];
      if (!validSorts.includes(target.value)) throw new Error("Choose a valid report-history sort option.");
      setState({ officialHistorySort: target.value });
      render();
    } else if (target.matches("[data-resident-report-sort]")) {
      if (!["newest", "oldest"].includes(target.value)) throw new Error("Choose a valid report date sort order.");
      setState({ residentReportSort: target.value });
      render();
    } else if (target.matches("[data-correction-status-filter], [data-correction-type-filter], [data-correction-date-filter]")) {
      const field = target.dataset.correctionStatusFilter ? "status" : target.dataset.correctionTypeFilter ? "type" : "date";
      setState({ correctionFilters: { ...correctionFilters, [field]: target.value } });
      refreshSearch(app.querySelector("[data-search-input]")?.value || "");
    } else if (
      target.matches(
        "[data-official-priority-filter], [data-official-status-filter], [data-official-announcement-filter], [data-hotline-category-filter]",
      )
    ) {
      refreshSearch(app.querySelector("[data-search-input]")?.value || "");
    } else if (target.matches("[data-announcement-sort]")) {
      const records = app.querySelector("[data-announcement-records]");
      if (records) {
        const direction = target.value === "oldest" ? 1 : -1;
        const rows = [...records.querySelectorAll(".record-row:not(.record-head)")];
        rows.sort((left, right) => direction * String(left.dataset.date || "").localeCompare(String(right.dataset.date || "")));
        rows.forEach((row) => records.append(row));
        records.dataset.page = "0";
      }
      refreshSearch(app.querySelector("[data-search-input]")?.value || "");
    } else if (target.matches("#announcement-is-event")) {
      setMapState({ announcementMapExpanded: target.checked });
      const region = app.querySelector("#announcement-map-region");
      if (region) region.hidden = !target.checked;
      if (target.checked) {
        initializeAnnouncementMap();
        const status = app.querySelector("#announcement-map-status");
        if (status && !announcementMapSelection) {
          status.textContent =
            currentUser?.role === "official"
              ? `${palsaraContextMessage()} Click to place the event pin.`
              : "Click the map to place the event location pin.";
        }
      } else {
        setMapState({ announcementMapSelection: null });
        const latitudeField = app.querySelector("#announcement-latitude");
        const longitudeField = app.querySelector("#announcement-longitude");
        if (latitudeField) latitudeField.value = "";
        if (longitudeField) longitudeField.value = "";
        const clearButton = app.querySelector('[data-action="clear-announcement-map-pin"]');
        if (clearButton) clearButton.hidden = true;
        if (announcementMapMarker && announcementMap) announcementMap.removeLayer(announcementMapMarker);
        setMapState({ announcementMapMarker: null });
        const status = app.querySelector("#announcement-map-status");
        if (status)
          status.textContent = currentUser?.role === "official" ? `No pin selected. ${palsaraContextMessage()}` : "No pin selected.";
      }
    } else if (target.matches("#calendar-event-has-location")) {
      setMapState({ calendarEventMapExpanded: target.checked });
      const region = app.querySelector("#calendar-event-map-region");
      if (region) region.hidden = !target.checked;
      if (target.checked) {
        initializeCalendarEventMap();
        const status = app.querySelector("#calendar-event-map-status");
        if (status && !calendarEventMapSelection) {
          status.textContent =
            currentUser?.role === "official"
              ? `${palsaraContextMessage()} Click to place the event pin.`
              : "Click the map to place the event location pin.";
        }
      } else {
        setMapState({ calendarEventMapSelection: null });
        const latitudeField = app.querySelector("#calendar-event-latitude");
        const longitudeField = app.querySelector("#calendar-event-longitude");
        if (latitudeField) latitudeField.value = "";
        if (longitudeField) longitudeField.value = "";
        const clearButton = app.querySelector('[data-action="clear-calendar-event-map-pin"]');
        if (clearButton) clearButton.hidden = true;
        if (calendarEventMapMarker && calendarEventMap) calendarEventMap.removeLayer(calendarEventMapMarker);
        setMapState({ calendarEventMapMarker: null });
        const status = app.querySelector("#calendar-event-map-status");
        if (status)
          status.textContent = currentUser?.role === "official" ? `No pin selected. ${palsaraContextMessage()}` : "No pin selected.";
      }
    } else if (target.matches("#user-form [name=role]")) {
      const areaField = app.querySelector("#user-form [name=area]");
      if (!areaField) return;
      const areas = locationAreas();
      const originalEmail = app.querySelector("#user-form [name=originalEmail]")?.value;
      const selected = areas.includes(areaField.value) ? areaField.value : originalEmail ? "" : areas[0];
      areaField.innerHTML = `${selected ? "" : '<option value="">Choose a managed location</option>'}${areas.map((area) => `<option value="${esc(area)}" ${area === selected ? "selected" : ""}>${esc(locationAreaLabels()[area] || area)}</option>`).join("")}`;
      const availabilityField = app.querySelector(".availability-field");
      availabilityField.hidden = target.value !== "official";
      availabilityField.querySelectorAll("[name=availableDays]").forEach((field) => {
        field.disabled = target.value !== "official";
      });
    } else if (target.matches("[data-user-role-filter], [data-user-status-filter]")) {
      const query = app.querySelector("[data-search-input]")?.value || "";
      refreshSearch(query);
    }
  });

  document.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Escape" && modalState) closeModal();
    if (keyEvent.key === "Escape") {
      const drawer = app.querySelector("#mobile-navigation");
      if (drawer && !drawer.hidden) {
        drawer.hidden = true;
        app.querySelector(".mobile-menu-button")?.setAttribute("aria-expanded", "false");
        app.querySelector(".mobile-menu-button")?.focus();
      }
    }
    if (keyEvent.key !== "Tab") return;
    const dialog = app.querySelector(".modal-backdrop .modal, #mobile-navigation:not([hidden]) .mobile-drawer");
    if (!dialog) return;
    const focusable = [
      ...dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) {
      keyEvent.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (keyEvent.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      keyEvent.preventDefault();
      last.focus();
    } else if (!keyEvent.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      keyEvent.preventDefault();
      first.focus();
    }
  });

  // "#" is the router namespace, so the skip link must not navigate.
  document.querySelector(".skip-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("main-content")?.focus();
  });

  window.addEventListener("hashchange", () => {
    const destination = window.location.hash;
    if (destination !== lastKnownHash && !confirmLeaveWithUnsavedPermissions()) {
      window.history.replaceState(null, "", lastKnownHash || "#/login");
      setState({ pendingReportRoute: "" });
      return;
    }
    if (destination !== lastKnownHash) setState({ permissionDrafts: {}, modalState: null });
    if (window.location.hash !== pendingReportRoute) setState({ selectedReportId: null });
    setState({ pendingReportRoute: "" });
    // Clear any lingering toast so a validation error from one public route does
    // not bleed onto the next (QA-001).
    const staleToast = document.getElementById("toast");
    if (staleToast) {
      staleToast.classList.remove("visible");
      staleToast.textContent = "";
    }
    render();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedPermissionChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("load", () => initialize().catch(showFatal));
}
