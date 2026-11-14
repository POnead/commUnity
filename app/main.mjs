"use strict";

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
  statusPill,
  roleLabel,
  idFor,
  emptyState,
  localSave,
  loadCommunityOfficialHours,
  loadLocalData,
  toast,
  confirmAction,
  currentPath,
  clearSession,
  announceSessionChange,
  startStateUpdates,
  stopStateUpdates,
  addActivity,
  getUser,
  getReport,
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
  setState,
  pendingReportRoute,
  uploadPhotos,
  smtpSettings,
  reportDraft,
  modalState,
  forcedPasswordDismissed,
  calendarMonth,
  calendarYear,
  calendarSelectedDate,
  selectedPermissionRole,
  permissionDrafts,
  activityLogState,
  activityFilters,
  activityLogLoadedKey,
  lastKnownHash,
  SESSION_SYNC_KEY,
  sessionSyncChannel,
} from "./core.mjs";
import {
  ROLES,
  ROLE_THEME,
  STATUSES,
  REPORT_TRANSITIONS,
  COLLECTION_STATUSES,
  CATEGORIES,
  REPORT_PRIORITIES,
  FOLLOW_UP_LIMITS,
  PERMISSION_DEFS,
  SCHEDULE_FREQUENCIES,
  SCHEDULE_REASON_STATUSES,
} from "./constants.mjs";
import {
  canOpenPage,
  checkDataConsistency,
  scheduleHistoryMarkup,
  dashboardResident,
  calendarStatusLabel,
  calendarPage,
  dashboardOfficial,
  dashboardAdmin,
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
  approvalsPage,
  profilePage,
  usersPage,
  rolesPage,
  photoPreviewMarkup,
  rememberOpenPermissionGroups,
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
  reportMapMarker,
  announcementMapMarker,
  calendarEventMapMarker,
  setMapState,
  useCurrentLocation,
  initializeReportMap,
  initializeReportDetailMap,
  initializeAnnouncementMap,
  initializeCalendarEventMap,
  initializeAnnouncementDetailMap,
} from "./map.mjs";

let profilePhotoFile = null;
let profilePhotoPreview = null;
let lastCalendarClick = { date: "", at: 0 };

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
  const role = currentUser.role;
  if (path[0] !== role) return { type: "app", role, page: "dashboard" };
  const requestedPage = path[1] || "dashboard";
  const pageName = role === "official" && requestedPage === "urgent" ? "concerns" : requestedPage;
  const pages = {
    resident: ["dashboard", "calendar", "collection", "report", "reports", "history", "notifications", "profile"],
    official: ["dashboard", "calendar", "concerns", "collection", "history", "announcements", "notifications", "profile"],
    administrator: [
      "dashboard",
      "calendar",
      "reports",
      "approvals",
      "analytics",
      "notifications",
      "users",
      "locations",
      "announcements",
      "roles",
      "activity",
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

export function render() {
  if (!data) return;
  // Keep expanded per-official override panels expanded when the live update
  // refresh rebuilds the page; the DOM still shows the previous render here.
  rememberOpenPermissionAccounts();
  const route = routeState();
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
  if (modalState?.kind !== "announcement-location" && modalState?.kind !== "calendar-event-detail") {
    announcementDetailMaps?.forEach((map) => map?.remove());
    setMapState({ announcementDetailMaps: [] });
    setMapState({ announcementDetailMapElements: [] });
  }
  if (currentUser && route.type === "app") {
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
      else if (route.page === "reports" || route.page === "history") markup = reportsPage("resident", route.page);
      else if (route.page === "notifications") markup = notificationsPage("resident");
      else markup = profilePage("resident");
    } else if (route.role === "official") {
      if (route.page === "dashboard") markup = dashboardOfficial();
      else if (route.page === "calendar") markup = calendarPage();
      else if (route.page === "collection") markup = collectionOfficial();
      else if (route.page === "concerns" || route.page === "history") markup = reportsPage("official", route.page);
      else if (route.page === "notifications") markup = notificationsPage("official");
      else if (route.page === "announcements") markup = announcementsPage("official");
      else markup = profilePage("official");
    } else {
      if (route.page === "dashboard") markup = dashboardAdmin();
      else if (route.page === "calendar") markup = calendarPage();
      else if (route.page === "reports") markup = reportsPage("administrator", "reports");
      else if (route.page === "approvals") markup = approvalsPage();
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
    if (route.role === "administrator" && (route.page === "settings" || route.page === "email")) loadSmtpSettings();
    if (route.role === "administrator" && route.page === "activity") {
      loadActivityLog(activityLogState.page).catch((error) => toast(error.message, "error"));
    }
    updatePagination();
    if (route.role === "resident" && route.page === "report" && reportMapExpanded) initializeReportMap();
    if (modalState?.kind === "announcement" && announcementMapExpanded) initializeAnnouncementMap();
    if (modalState?.kind === "calendar-event" && calendarEventMapExpanded) initializeCalendarEventMap();
    if (modalState) {
      const input = app.querySelector(".modal input:not([type=hidden]), .modal select");
      if (input) requestAnimationFrame(() => input.focus());
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
  setState({ lastKnownHash: window.location.hash });
}

function makeModal(title, body, className = "") {
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal${className ? ` ${className}` : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header class="modal-head"><div><h2 id="modal-title">${esc(title)}</h2></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></header>
    <div class="modal-content">${body}</div>
  </section></div>`;
}

function workingTimeOptions(selected) {
  const options = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      const period = hour < 12 ? "AM" : "PM";
      const displayHour = hour % 12 || 12;
      const value = `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
      options.push(`<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`);
    }
  }
  return options.join("");
}

function parseWorkingHours(value = "") {
  const matches = String(value).match(/(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  return matches
    ? { start: matches[1].replace(/\s+/g, " ").toUpperCase(), end: matches[2].replace(/\s+/g, " ").toUpperCase() }
    : { start: "8:00 AM", end: "5:00 PM" };
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
      ["Affected record", item.affectedId || "Not recorded"],
      ["Client address", item.clientIp || "Not recorded"],
      ["Source", item.source === "archived" ? `Archived on ${dateTimeLabel(item.archivedAt)}` : "Current log"],
      ["Event ID", item.id],
      ["Details", item.detail],
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
      <div class="modal-form-fields">${seriesNotice}<div class="form-grid">${selectField("Area", "area", locationAreas(), schedule?.area || locationAreas()[0], { required: true, labels: locationAreaLabels() })}${inputField("Collection date", "date", schedule?.date || todayISO(), { type: "date", required: true })}${inputField("Waste type", "wasteType", schedule?.wasteType || "", { required: true, placeholder: "e.g. Biodegradable" })}${selectField("Service status", "status", COLLECTION_STATUSES, initialStatus, { required: true })}${inputField("Start time", "start", schedule?.start || "6:00 AM", { required: true })}${inputField("End time", "end", schedule?.end || "9:00 AM", { required: true })}${selectField("Frequency", "frequency", SCHEDULE_FREQUENCIES, schedule?.frequency || "Weekly", { required: true })}${inputField("Repeat until", "recurrenceEnd", schedule?.recurrenceEnd || "", { type: "date" })}${inputField("Collection team", "team", schedule?.team || "Team A · Truck 01")}</div>
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
    const body = `<div class="modal-form-fields">
      <div class="status-line">${statusPill(schedule.status)}<span class="muted small">${esc(schedule.area)} · ${esc(schedule.zone)}</span></div>
      <ul class="plain-list">
        <li><span>Service</span><strong>${esc(schedule.wasteType)}</strong></li>
        <li><span>Collection date</span><strong>${esc(dateLabel(schedule.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</strong></li>
        <li><span>Collection window</span><strong>${esc(schedule.start)} – ${esc(schedule.end)}</strong></li>
        <li><span>Collection team</span><strong>${esc(schedule.team)}</strong></li>
      </ul>
      ${statusNote}
      <div class="section-heading"><div><h2>Collection history</h2><p>Previous status, new status, who changed it, and why.</p></div></div>
      ${scheduleHistoryMarkup(schedule.history)}
    </div>
    <div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Close</button></div>`;
    return makeModal(`Collection details · ${schedule.id}`, body);
  }
  if (modalState.kind === "location") {
    const location = data.locations.find((item) => item.id === modalState.id);
    const body = `<form id="location-form" class="modal-form"><input type="hidden" name="id" value="${esc(location?.id || "")}">
      <div class="modal-form-fields"><div class="form-grid">${inputField("Area label", "area", location?.area || "", { required: true, maxLength: 120, placeholder: "e.g. Purok 6" })}${inputField("Barangay", "barangay", location?.barangay || "Palsara", { required: true, maxLength: 100 })}${inputField("Purok", "purok", location?.purok || "", { required: true, maxLength: 100 })}${inputField("Street", "street", location?.street || "", { maxLength: 160, placeholder: "Optional" })}${inputField("Landmark", "landmark", location?.landmark || "", { maxLength: 160, placeholder: "Optional" })}</div></div>
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
      <div class="modal-form-fields"><div class="form-grid">${inputField("Title", "title", item?.title || "", { required: true, maxLength: 120 })}${inputField("Publish date", "date", item?.date || todayISO(), { type: "date", required: true })}<div class="form-field span-all"><label for="announcement-detail">Message *</label><textarea class="textarea" id="announcement-detail" name="detail" required maxlength="1000">${esc(item?.detail || "")}</textarea></div>
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
          <div id="announcement-detail-map" class="report-map-canvas report-detail-map" data-latitude="${item.latitude}" data-longitude="${item.longitude}" role="region" aria-label="Map centered on this event's location"></div>
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
          ${hasMap ? `<div class="event-card-map-panel"><div id="announcement-detail-map-${event.id}" class="report-map-canvas report-detail-map" data-latitude="${event.latitude}" data-longitude="${event.longitude}" role="region" aria-label="Map centered on this event's location"></div><p class="map-status" id="announcement-detail-map-status-${event.id}" role="status" aria-live="polite">Map pin at ${event.latitude.toFixed(6)}, ${event.longitude.toFixed(6)}.</p><a class="button secondary small" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${event.latitude},${event.longitude}`)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div>` : ""}
        </div>`;
          })
          .join("")
      : `<div class="event-detail-empty"><strong>No events</strong><p>Nothing is scheduled on ${esc(dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}.</p></div>`;
    const body = `<div class="event-detail-modal"><div class="event-detail-head"><h3 class="event-detail-date-title">${esc(dateLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</h3></div><div class="event-detail-list">${eventList}</div></div>`;
    return makeModal("Event details", body, "modal--event-details");
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
  const user = modalState.id ? getUser(modalState.id) : null;
  const accountRole = user?.role || "resident";
  const accountAreas = locationAreas();
  const selectedArea = accountAreas.includes(user?.area) ? user.area : user ? "" : accountAreas[0];
  const workingHours = parseWorkingHours(user?.workingHours);
  const availableDays = Array.isArray(user?.availableDays) ? user.availableDays : DEFAULT_OFFICIAL_DAYS;
  const body = `<form id="user-form" class="modal-form"><input type="hidden" name="originalEmail" value="${esc(user?.email || "")}">
  <div class="modal-form-fields"><div class="form-grid">${inputField("Full name", "name", user?.name || "", { required: true })}${inputField("Email address", "email", user?.email || "", { type: "email", required: true, autocomplete: "email" })}${inputField("Contact number", "phone", user?.phone || "", { type: "tel", placeholder: "Optional" })}${selectField("Area", "area", accountAreas, selectedArea, { required: true, labels: locationAreaLabels(), placeholder: selectedArea ? "" : "Choose a managed location" })}${selectField("Role", "role", Object.keys(ROLES), accountRole, { required: true, labels: ROLES })}${!user ? selectField("Account status", "status", ["Active", "Inactive"], "Active", { required: true }) : ""}<div class="form-field" ${accountRole !== "official" ? "hidden" : ""}><label for="working-hours-start">Working hours start</label><select class="select" id="working-hours-start" name="workingHoursStart" ${accountRole !== "official" ? "disabled" : "required"}>${workingTimeOptions(workingHours.start)}</select></div><div class="form-field" ${accountRole !== "official" ? "hidden" : ""}><label for="working-hours-end">Working hours end</label><select class="select" id="working-hours-end" name="workingHoursEnd" ${accountRole !== "official" ? "disabled" : "required"}>${workingTimeOptions(workingHours.end)}</select></div><fieldset class="availability-field span-all" ${accountRole !== "official" ? "hidden" : ""}><legend>Available days</legend><p class="availability-help">Choose the days this official is available.</p><div class="availability-days">${availableDayOptions(availableDays)}</div></fieldset>${user ? "" : inputField("Initial password", "password", "", { type: "password", required: true, minLength: 8, help: "Choose a unique password with at least 8 characters." })}</div></div>
    <div class="form-actions">${user && user.email !== currentUser.email ? `<button class="button secondary" type="button" data-action="reset-user-password" data-id="${esc(user.email)}">${user.resetRequested ? "Approve &amp; Generate" : "Reset password"}</button><button class="button ${user.status === "Active" ? "danger" : "secondary"}" type="button" data-action="toggle-user" data-id="${esc(user.email)}">${user.status === "Active" ? "Deactivate account" : "Reactivate account"}</button>` : ""}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${user ? "Save account" : "Add account"}</button></div></form>`;
  return makeModal(user ? "Edit account" : "Add account", body);
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

function showModal(kind, id = "") {
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
  setState({ modalState: null });
  render();
  app.querySelector(".workspace-main")?.focus();
}

function refreshSearch(searchValue) {
  const query = searchValue.toLowerCase().trim();
  const roleFilter = app.querySelector("[data-user-role-filter]")?.value || "all";
  const statusFilter = app.querySelector("[data-user-status-filter]")?.value || "all";
  app.querySelectorAll(".filter-item").forEach((row) => {
    const matchesText = !query || row.dataset.search.includes(query);
    const matchesRole = roleFilter === "all" || row.dataset.search.includes(ROLES[roleFilter].toLowerCase());
    const matchesStatus = statusFilter === "all" || row.dataset.accountStatus === statusFilter;
    row.dataset.filteredOut = String(!(matchesText && matchesRole && matchesStatus));
  });
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
    visible.forEach((row, index) => {
      row.hidden = index < page * pageSize || index >= (page + 1) * pageSize;
    });
    rows
      .filter((row) => row.dataset.filteredOut === "true")
      .forEach((row) => {
        row.hidden = true;
      });
    let controls = table.nextElementSibling?.classList.contains("pagination") ? table.nextElementSibling : null;
    if (pageCount <= 1) {
      controls?.remove();
      continue;
    }
    if (!controls) {
      controls = document.createElement("nav");
      controls.className = "pagination";
      controls.setAttribute("aria-label", "Table pages");
      table.after(controls);
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
          report.id,
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
      report.id,
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
      item.detail,
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
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name}: each photo must be 5 MB or smaller.`);
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

async function submitReportDraft() {
  if (!reportDraft) return;
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
  addActivity(report.urgent ? "Submitted an urgent concern" : "Submitted a concern", `${report.id} · ${report.title}`);
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
  toast(`${report.id} was submitted to barangay staff.`, "success");
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
    message: `Update ${report.id} to “${status}” and notify the resident?`,
    confirmLabel: "Update report",
  });
  if (!confirmed) return;
  const now = new Date().toISOString();
  report.status = status;
  report.updatedAt = now;
  report.history.push({ status, at: now, note: note || `Status updated to ${status}.` });
  addActivity("Updated a report", `${report.id} · ${status}`);
  if (!(await localSave())) return;
  setState({ selectedReportId: null });
  render();
  toast(`${report.id} updated. The resident has an in-app notification.`, "success");
}

async function updateReportAssignment(id, claim) {
  const report = getReport(id);
  if (!report || currentUser.role !== "official") throw new Error("This concern cannot be assigned from this workspace.");
  if (claim && report.assignedTo) throw new Error("This concern is already assigned. Refresh the queue before trying again.");
  if (!claim && report.assignedTo?.id !== currentUser.id) throw new Error("You can only release a concern assigned to you.");
  const confirmed = await confirmAction({
    title: claim ? "Claim concern?" : "Release concern?",
    message: claim ? `Assign ${report.id} to yourself?` : `Release ${report.id} back to the queue?`,
    confirmLabel: claim ? "Claim concern" : "Release concern",
    tone: claim ? "primary" : "danger",
  });
  if (!confirmed) return;
  report.assignedTo = claim ? { id: currentUser.id, name: currentUser.name } : null;
  addActivity(claim ? "Claimed a concern" : "Released a concern", `${report.id} · ${report.title}`);
  if (!(await localSave())) return;
  render();
  toast(claim ? `${report.id} assigned to you.` : `${report.id} released to the queue.`, "success");
}

async function confirmReport(reportId, note) {
  const report = getReport(reportId);
  if (!report || currentUser.role !== "resident") throw new Error("This concern could not be found.");
  if (report.userEmail !== currentUser.email) throw new Error("Residents can only confirm their own concerns.");
  if (report.status !== "Resolved") throw new Error("Only a resolved concern can be confirmed as addressed.");
  const confirmed = await confirmAction({
    title: "Confirm addressed?",
    message: `Confirm that ${reportId} was addressed and close the follow-up?`,
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
  toast(`${reportId} confirmed as addressed.`, "success");
}

async function reopenReport(reportId, reason) {
  const report = getReport(reportId);
  if (!report || currentUser.role !== "resident") throw new Error("This concern could not be found.");
  if (report.userEmail !== currentUser.email) throw new Error("Residents can only reopen their own concerns.");
  if (report.status !== "Resolved") throw new Error("Only a resolved concern can be reopened.");
  const confirmed = await confirmAction({
    title: "Reopen concern?",
    message: `Reopen ${reportId} and return it to the concern queue?`,
    confirmLabel: "Reopen concern",
    tone: "danger",
  });
  if (!confirmed) return;
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
  render();
  toast(`${reportId} reopened. It is back in the concern queue.`, "success");
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
    message: `Send this follow-up to barangay staff for ${reportId || "this report"}?\n\n${limitLine}`,
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
    toast(`${report.id} is already ${priority} priority.`, "info");
    return;
  }
  const confirmed = await confirmAction({
    title: "Update concern priority?",
    message: `Change ${report.id} priority from ${report.priority || "Medium"} to ${priority}?`,
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
  toast(`${report.id} priority updated to ${priority}.`, "success");
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
  const endMinutes = timeToMinutes(record.end);
  const startMinutes = timeToMinutes(record.start);
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
    addActivity(
      statusChanged ? "Changed a collection status" : "Updated a collection schedule",
      `${record.id} · ${record.area} · ${existing.status}${statusNote ? ` · ${statusNote}` : ""}`,
    );
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
    addActivity(
      "Added a collection schedule",
      records.length > 1
        ? `${records[0].id} · ${record.area} · ${records.length} recurring pickups`
        : `${records[0].id} · ${record.area} · ${status}`,
    );
  }
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast("Collection schedule saved. Residents in the affected area have an in-app update.", "success");
}

async function saveLocation(form) {
  const id = String(form.get("id") || idFor("LOC"));
  const record = {
    id,
    area: String(form.get("area") || "").trim(),
    barangay: String(form.get("barangay") || "").trim(),
    street: String(form.get("street") || "").trim(),
    purok: String(form.get("purok") || "").trim(),
    landmark: String(form.get("landmark") || "").trim(),
  };
  if (!record.area || !record.barangay || !record.purok) throw new Error("Enter an area label, barangay, and purok.");
  if (data.locations.some((item) => item.area.toLowerCase() === record.area.toLowerCase() && item.id !== id)) {
    throw new Error("Another location already uses this area label.");
  }
  const existing = data.locations.find((item) => item.id === id);
  const confirmed = await confirmAction({
    title: existing ? "Save location?" : "Add location?",
    message: existing ? `Save changes to ${record.area}?` : `Add ${record.area} as a community location?`,
    confirmLabel: existing ? "Save location" : "Add location",
  });
  if (!confirmed) return;
  if (existing) Object.assign(existing, record);
  else data.locations.push(record);
  addActivity(existing ? "Updated a community location" : "Added a community location", `${record.area} · ${record.barangay}`);
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
  addActivity(existing ? "Updated a recycling directory listing" : "Added a recycling directory listing", record.name);
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast("Recycling directory listing saved.", "success");
}

async function saveAnnouncement(form) {
  const id = String(form.get("id") || "");
  const readOptionalCoordinate = (value) => {
    const text = String(value || "").trim();
    return text ? Number(text) : null;
  };
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
      throw new Error("Place a pin on the map for this event announcement, or turn off the event option.");
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
  if (body.date < todayISO()) throw new Error("Announcements cannot be published before today.");
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

function timeToMinutes(value) {
  const match = String(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return -1;
  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hours += 12;
  return hours * 60 + Number(match[2]);
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
  if (currentUser.recoveryEmail)
    return "Profile saved. The recovery email is not verified because the email service is not configured, so no verification link was sent.";
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
  toast("SMTP settings saved.", "success");
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
  if (!stateResponse.ok) throw new Error(state.error || "The account was updated, but CommUnity could not reload.");
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ currentUser: state.user });
  await loadCommunityOfficialHours();
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
  await loadCommunityOfficialHours();
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  startStateUpdates();
  window.location.hash = routeUrl("resident", "dashboard");
  announceSessionChange();
  toast("Your resident account is ready.", "success");
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
  if (currentUser.requiresPasswordChange) {
    // The server answers only the password change until the temporary password is
    // replaced, so load the empty shell and let the forced dialog run first. The
    // real state loads inside updatePassword() once the change succeeds.
    setState({ data: emptyState() });
    setState({ dataRevision: 0 });
    setState({ lastPersistedSnapshot: "" });
    setState({ communityOfficialHours: [] });
    window.location.hash = routeUrl(currentUser.role, "dashboard");
    render();
    announceSessionChange();
    return;
  }
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "Signed in, but CommUnity could not load your information.");
  setState({ currentUser: state.user || result.user });
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  await loadCommunityOfficialHours();
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ selectedReportId: null });
  setState({ reportDraft: null });
  startStateUpdates();
  window.location.hash = routeUrl(currentUser.role, "dashboard");
  render();
  announceSessionChange();
  toast(`Signed in to the ${ROLES[currentUser.role]} workspace.`, "success");
}

async function resetUserPassword(form) {
  const email = String(form.get("email") || "");
  const user = getUser(email);
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
  const startTime = String(form.get("workingHoursStart") || "");
  const endTime = String(form.get("workingHoursEnd") || "");
  const selectedDays = form.getAll("availableDays").map(String);
  const clockMinutes = (time) => {
    const match = time.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/);
    if (!match) return -1;
    const hour = (Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0);
    return hour * 60 + Number(match[2]);
  };
  if (role === "official" && (clockMinutes(startTime) < 0 || clockMinutes(endTime) <= clockMinutes(startTime))) {
    throw new Error("Choose a working-hours end time that is after the start time.");
  }
  if (role === "official" && selectedDays.length === 0) throw new Error("Select at least one day the official is available.");
  const savedAvailableDays =
    role === "official" ? OFFICIAL_DAYS.filter((day) => selectedDays.includes(day)) : existing?.availableDays || DEFAULT_OFFICIAL_DAYS;
  const savedWorkingHours =
    role === "official"
      ? `${savedAvailableDays.join(", ")}, ${startTime}-${endTime}`
      : existing?.workingHours || "Monday-Friday, 8:00 AM-5:00 PM";
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
    addActivity("Updated user account", `${name} · ${ROLES[role]}`);
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
    setState({ selectedPermissionRole: "resident" });
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
  } else if (action === "confirm-report") {
    await confirmReport(button.dataset.id, "");
  } else if (action === "reopen-report") {
    const reason = window.prompt(`Explain why this concern should be reopened:`);
    if (reason === null) return;
    if (!reason.trim()) throw new Error("Enter a reason before reopening the concern.");
    await reopenReport(button.dataset.id, reason.trim());
  } else if (action === "back-list") {
    setState({ selectedReportId: null });
    render();
  } else if (action === "filter-reports") {
    setState({ reportFilter: button.dataset.value });
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
      addActivity("Removed a collection schedule", `${schedule.id} · ${schedule.area}`);
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
      addActivity("Removed a community location", location.area);
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
      addActivity("Removed a recycling directory listing", item.name);
      if (await localSave()) {
        setState({ modalState: null });
        render();
        toast("Recycling listing removed.", "success");
      }
    }
  } else if (action === "add-announcement") {
    showModal("announcement");
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
  } else if (action === "select-permission-role") {
    const { role } = button.dataset;
    if (!Object.hasOwn(data.permissions, role)) throw new Error("This role could not be found.");
    rememberOpenPermissionGroups();
    permissionDrafts[role] ||= { ...data.permissions[role] };
    setState({ selectedPermissionRole: role });
    render();
    app.querySelector(`[data-action="select-permission-role"][data-role="${role}"]`)?.focus();
  } else if (action === "toggle-permission") {
    const permission = button.dataset.permission;
    const role = selectedPermissionRole;
    if (!Object.hasOwn(data.permissions, role) || !Object.hasOwn(data.permissions[role], permission))
      throw new Error("This permission could not be found.");
    permissionDrafts[role] ||= { ...data.permissions[role] };
    permissionDrafts[role][permission] = !permissionDrafts[role][permission];
    rememberOpenPermissionGroups();
    render();
    [...app.querySelectorAll('[data-action="toggle-permission"]')].find((item) => item.dataset.permission === permission)?.focus();
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
  } else if (action === "discard-permission-draft") {
    const confirmed = await confirmAction({
      title: "Discard changes?",
      message: "Discard your unsaved role permission changes?",
      confirmLabel: "Discard changes",
      tone: "danger",
    });
    if (!confirmed) return;
    rememberOpenPermissionGroups();
    delete permissionDrafts[selectedPermissionRole];
    render();
    app.querySelector('[data-action="select-permission-role"][aria-pressed="true"]')?.focus();
    toast("Unsaved role permission changes discarded.", "success");
  } else if (action === "save-permission-draft") {
    rememberOpenPermissionGroups();
    const role = selectedPermissionRole;
    const draft = permissionDrafts[role];
    if (!draft) throw new Error("There are no role permission changes to save.");
    for (const permission of ["manageUsers", "manageRoles"]) {
      if (role === "administrator" && data.permissions[role][permission] && !draft[permission]) {
        const anotherAdminCanManage = data.users.some(
          (user) =>
            user.role === "administrator" &&
            user.status === "Active" &&
            user.email !== currentUser.email &&
            data.permissions.administrator[permission],
        );
        if (!anotherAdminCanManage)
          throw new Error(
            "Keep these permissions enabled for at least one active administrator so the local workspace remains manageable.",
          );
      }
    }
    const changes = PERMISSION_DEFS.filter(({ id }) => draft[id] !== Boolean(data.permissions[role][id]));
    if (!changes.length) {
      delete permissionDrafts[role];
      render();
      return;
    }
    const confirmed = await confirmAction({
      title: "Save permissions?",
      message: `Save ${changes.length} permission change${changes.length === 1 ? "" : "s"} for ${ROLES[role]}?`,
      confirmLabel: "Save permissions",
    });
    if (!confirmed) return;
    data.permissions[role] = { ...draft };
    changes.forEach((permission) => addActivity("Changed role permission", `${ROLES[role]} · ${permission.label}`));
    if (await localSave()) {
      delete permissionDrafts[role];
      render();
      app.querySelector('[data-action="select-permission-role"][aria-pressed="true"]')?.focus();
      toast(`${ROLES[role]} permissions saved.`, "success");
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
    setState({ activityFilters: { from: "", to: "", actor: "", action: "", result: "", affectedId: "", source: "all" } });
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
  } else if (action === "toggle-report-map") {
    setMapState({ reportMapExpanded: !reportMapExpanded });
    const region = app.querySelector("#report-map-region");
    const toggle = app.querySelector('[data-action="toggle-report-map"]');
    region.hidden = !reportMapExpanded;
    toggle.setAttribute("aria-expanded", String(reportMapExpanded));
    toggle.textContent = reportMapExpanded ? "Hide map" : "Choose location on map";
    if (reportMapExpanded) initializeReportMap();
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
  formEvent.preventDefault();
  const form = formEvent.target;
  const formId = form.getAttribute("id");
  const fields = new FormData(form);
  try {
    if (formId === "login-form") {
      await login(String(fields.get("email") || ""), String(fields.get("password") || ""), Boolean(fields.get("remember")));
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
      await updatePassword(fields);
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
          actor: String(fields.get("actor") || "").trim(),
          action: String(fields.get("action") || "").trim(),
          result: String(fields.get("result") || ""),
          affectedId: String(fields.get("affectedId") || "").trim(),
          source: String(fields.get("source") || "all"),
        },
      });
      await loadActivityLog(1, true);
    } else if (formId === "location-form") {
      await saveLocation(fields);
    } else if (formId === "recycling-form") {
      await saveRecyclingLocation(fields);
    } else if (formId === "announcement-form") {
      await saveAnnouncement(fields);
    } else if (formId === "calendar-event-form") {
      await saveCalendarEvent(fields);
    } else if (formId === "calendar-decline-form") {
      await decideCalendarEvent(String(fields.get("id") || ""), "declined", String(fields.get("reason") || "").trim());
    } else if (formId === "announcement-decline-form") {
      await decideAnnouncement(String(fields.get("id") || ""), "declined", String(fields.get("reason") || "").trim());
    }
  } catch (error) {
    console.error(`CommUnity could not complete ${formId}.`, error);
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
      setState({ communityOfficialHours: [] });
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
    await loadCommunityOfficialHours();
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
  sessionSyncChannel?.addEventListener("message", (event) => {
    if (event.data?.type === "session") syncSessionAcrossTabs();
  });
}

async function initialize() {
  watchSessionAcrossTabs();
  await loadLocalData();
  if (!data) return;
  checkDataConsistency();
  if (currentUser) startStateUpdates();
  if (!window.location.hash) window.history.replaceState(null, "", currentUser ? routeUrl(currentUser.role, "dashboard") : "#/login");
  setState({ lastKnownHash: window.location.hash });
  render();
}

export function startCommUnity() {
  app.addEventListener("click", async (clickEvent) => {
    const button = clickEvent.target.closest("[data-action]");
    if (!button) return;
    try {
      await handleAction(button, clickEvent);
    } catch (error) {
      console.error("CommUnity action failed.", error);
      toast(error.message || "This action could not be completed.", "error");
    }
  });

  app.addEventListener("submit", (submitEvent) => {
    handleSubmit(submitEvent);
  });

  app.addEventListener("input", (inputEvent) => {
    if (inputEvent.target.matches("[data-search-input]")) refreshSearch(inputEvent.target.value);
  });

  app.addEventListener("change", (changeEvent) => {
    const target = changeEvent.target;
    if (target.matches("#report-photos")) handlePhotoSelection(target);
    else if (target.matches("#profile-photo")) handleProfilePhotoSelection(target);
    else if (target.id === "status" && target.form?.getAttribute("id") === "schedule-form") syncScheduleStatusFields(target.form);
    else if (target.matches("#announcement-is-event")) {
      setMapState({ announcementMapExpanded: target.checked });
      const region = app.querySelector("#announcement-map-region");
      if (region) region.hidden = !target.checked;
      if (target.checked) {
        initializeAnnouncementMap();
        const status = app.querySelector("#announcement-map-status");
        if (status && !announcementMapSelection) status.textContent = "Click the map to place the event location pin.";
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
        if (status) status.textContent = "No pin selected.";
      }
    } else if (target.matches("#calendar-event-has-location")) {
      setMapState({ calendarEventMapExpanded: target.checked });
      const region = app.querySelector("#calendar-event-map-region");
      if (region) region.hidden = !target.checked;
      if (target.checked) {
        initializeCalendarEventMap();
        const status = app.querySelector("#calendar-event-map-status");
        if (status && !calendarEventMapSelection) status.textContent = "Click the map to place the event location pin.";
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
        if (status) status.textContent = "No pin selected.";
      }
    } else if (target.matches("#user-form [name=role]")) {
      const areaField = app.querySelector("#user-form [name=area]");
      if (!areaField) return;
      const areas = locationAreas();
      const originalEmail = app.querySelector("#user-form [name=originalEmail]")?.value;
      const selected = areas.includes(areaField.value) ? areaField.value : originalEmail ? "" : areas[0];
      areaField.innerHTML = `${selected ? "" : '<option value="">Choose a managed location</option>'}${areas.map((area) => `<option value="${esc(area)}" ${area === selected ? "selected" : ""}>${esc(locationAreaLabels()[area] || area)}</option>`).join("")}`;
      for (const field of app.querySelectorAll("#working-hours-start, #working-hours-end")) {
        field.closest(".form-field").hidden = target.value !== "official";
        field.disabled = target.value !== "official";
        field.required = target.value === "official";
      }
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

  window.addEventListener("hashchange", () => {
    const destination = window.location.hash;
    if (destination !== lastKnownHash && !confirmLeaveWithUnsavedPermissions()) {
      window.history.replaceState(null, "", lastKnownHash || "#/login");
      setState({ pendingReportRoute: "" });
      return;
    }
    if (destination !== lastKnownHash) setState({ permissionDrafts: {} });
    if (window.location.hash !== pendingReportRoute) setState({ selectedReportId: null });
    setState({ pendingReportRoute: "" });
    render();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedPermissionChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("load", () => initialize().catch(showFatal));
}
