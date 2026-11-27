"use strict";

import {
  adminReportFilters,
  announceSessionChange,
  app,
  correctionFilters,
  currentUser,
  data,
  emptyState,
  esc,
  lastKnownHash,
  loadLocalData,
  locationAreaLabels,
  locationAreas,
  modalState,
  pendingReportRoute,
  redirectToFaceCheckIfRequired,
  routeUrl,
  setState,
  startStateUpdates,
  stopStateUpdates,
  toast,
} from "../core.mjs";
import { render } from "./render.mjs";
import {
  announcementMap,
  announcementMapMarker,
  announcementMapSelection,
  calendarEventMap,
  calendarEventMapMarker,
  calendarEventMapSelection,
  initializeAnnouncementMap,
  initializeCalendarEventMap,
  palsaraContextMessage,
  refreshGoogleMaps,
  setMapState,
} from "../map.mjs";
import { ROLES } from "../constants.mjs";
import {
  closeModal,
  isProcessing,
  showFatal,
  showSupportingFileName,
  syncScheduleStatusFields,
  watchSessionAcrossTabs,
  withProcessing,
} from "./ui.mjs";
import { checkDataConsistency, confirmLeaveWithUnsavedPermissions, hasUnsavedPermissionChanges } from "../views.mjs";
import { handleAction, handlePhotoSelection, handleProfilePhotoSelection, handleSubmit } from "./actions.mjs";
import { refreshSearch } from "./reports.mjs";
import { attachIdImage, idStatus, showBackPreview, updateIdAge } from "./verification.mjs";

export async function loadWorkspaceAfterGate(message = "") {
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
export async function refreshWorkspace() {
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

export async function initialize() {
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
        "face-check-start",
        "face-enroll-start",
        "face-check-cancel",
        "admin-face-enroll",
        "admin-face-cancel",
        "id-face-start",
        "id-face-cancel",
        "id-face-retry",
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
