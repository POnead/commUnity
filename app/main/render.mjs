"use strict";

import {
  activityLogState,
  app,
  correctionFilters,
  currentRoute,
  currentUser,
  data,
  dateLabel,
  dateTimeLabel,
  displayReferenceText,
  displayReportId,
  emailPanelOpen,
  esc,
  facePanelOpen,
  forcedPasswordDismissed,
  getUser,
  icon,
  idPanelOpen,
  inputField,
  locationAreaLabels,
  locationAreas,
  modalState,
  passwordPanelOpen,
  roleLabel,
  routeUrl,
  searchQuery,
  selectField,
  setState,
  statusPill,
  toast,
  todayISO,
} from "../core.mjs";
import { destroyAnalyticsCharts, initializeAnalyticsCharts } from "../analytics-charts.mjs";
import {
  HOTLINE_FIELD_LABELS,
  activityLogPage,
  adminFaceEnrollMarkup,
  analyticsPage,
  announcementsPage,
  approvalsPage,
  assignmentsPage,
  calendarPage,
  calendarStatusLabel,
  collectionOfficial,
  collectionResident,
  dashboardAdmin,
  dashboardOfficial,
  dashboardResident,
  emailPage,
  faceGateMarkup,
  faceVerifyPage,
  forgotPasswordMarkup,
  hotlinesPage,
  idImageModalBody,
  locationsPage,
  loginMarkup,
  notificationsPage,
  officialAssignedPage,
  profilePage,
  registerMarkup,
  rememberOpenPermissionAccounts,
  reportPage,
  reportsPage,
  resetPasswordMarkup,
  rolesPage,
  scheduleHistoryMarkup,
  settingsPage,
  usersPage,
  verificationsPage,
  verifyEmailChangeMarkup,
  verifyRecoveryMarkup,
} from "../views.mjs";
import {
  correctionSupportingFile,
  profileSummaryOffset,
  routeState,
  setupProfileDirtyState,
  setupProfileSummaryDrag,
  syncProcessingOverlay,
} from "./ui.mjs";
import {
  announcementDetailMaps,
  announcementMap,
  announcementMapExpanded,
  announcementMapSelection,
  calendarEventMap,
  calendarEventMapExpanded,
  calendarEventMapSelection,
  initializeAnnouncementDetailMap,
  initializeAnnouncementMap,
  initializeCalendarEventMap,
  initializeLocationMap,
  initializeLocationPickerMap,
  initializeReportDetailMap,
  initializeReportMap,
  locationMap,
  locationMapExpanded,
  locationPickerMap,
  reportMap,
  reportMapExpanded,
  setMapState,
} from "../map.mjs";
import { assignIdStep, idStepCount, loadOfficialVerificationStatus, loadVerificationSettings, setIdStepCount } from "./verification.mjs";
import {
  COLLECTION_STATUSES,
  HOTLINE_CATEGORIES,
  HOTLINE_STATUSES,
  HOTLINE_STATUS_LABELS,
  ROLES,
  ROLE_THEME,
  SCHEDULE_FREQUENCIES,
} from "../constants.mjs";
import { loadSmtpSettings } from "./profile.mjs";
import { loadActivityLog, refreshSearch, updatePagination } from "./reports.mjs";
import { renderLocationGate, resolveReportLocation } from "./location.mjs";
import { calendarEventsForDate } from "./content.mjs";
import { ID_TYPE_LABELS } from "../../shared/domain-rules.mjs";

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
    app.innerHTML = faceGateMarkup(
      Boolean(currentUser?.faceEnrolled),
      currentUser?.faceEnrollmentState === "pending" ? "enroll" : "verify",
    );
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
    if ((route.role === "resident" || route.role === "official") && route.page === "profile") setupProfileDirtyState();
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

export function makeModal(title, body, className = "", subtitle = "") {
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal${className ? ` ${className}` : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header class="modal-head"><div><h2 id="modal-title" tabindex="-1">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">${icon("close")}</button></header>
    <div class="modal-content">${body}</div>
  </section></div>`;
}

export const OFFICIAL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DEFAULT_OFFICIAL_DAYS = OFFICIAL_DAYS.slice(0, 5);

export function availableDayOptions(selectedDays = DEFAULT_OFFICIAL_DAYS) {
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
    setIdStepCount(titles.length);
    const steps = titles
      .map(
        (label, index) =>
          `<div class="wizard-step${index === 0 ? " current" : ""}" data-step="${index + 1}"><strong>${index + 1}</strong><span>${label}</span></div>`,
      )
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

      ${
        integrated
          ? `
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
      </section>`
          : ""
      }

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
    assignIdStep(1);
    return makeModal(integrated ? "Verify your ID and face" : "Verify your ID", body, "id-verify-modal");
  }
  if (modalState.kind === "id-image") {
    const item = (data.verificationQueue || []).find((entry) => entry.userId === modalState.id);
    if (!item) {
      setState({ modalState: null });
      return "";
    }
    return makeModal(
      `${item.name}'s ID`,
      idImageModalBody(item),
      "id-image-modal",
      "Review both sides and the submitted details before deciding.",
    );
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
