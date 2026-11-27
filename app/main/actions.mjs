"use strict";

import {
  activityLogState,
  adminReportFilters,
  announceSessionChange,
  app,
  calendarMonth,
  calendarSelectedDate,
  calendarYear,
  clearSession,
  confirmAction,
  currentUser,
  data,
  getUser,
  isResidentArea,
  localSave,
  officialHistorySort,
  profileSummaryCollapsed,
  redirectToFaceCheckIfRequired,
  reportDraft,
  reportDraftFromForm,
  routeUrl,
  setState,
  stopStateUpdates,
  toast,
  todayISO,
  uploadPhotos,
} from "../core.mjs";
import { render } from "./render.mjs";
import { hasUnsavedPermissionChanges, photoPreviewMarkup } from "../views.mjs";
import {
  applySmtpPreset,
  createResident,
  profilePhotoPreview,
  requestEmailChange,
  saveSmtpSettings,
  setProfilePhotoFile,
  setProfilePhotoPreview,
  updatePassword,
  updateProfile,
} from "./profile.mjs";
import {
  assignReportToOfficial,
  compressPhoto,
  confirmReport,
  exportActivityLog,
  exportReports,
  loadActivityLog,
  openReport,
  reopenReport,
  submitFollowUp,
  submitReportDraft,
  updateCollection,
  updatePagination,
  updateReportAssignment,
  updateReportPriority,
  updateReportStatus,
} from "./reports.mjs";
import { closeModal, markNotification, showModal } from "./ui.mjs";
import {
  adminFaceAbortController,
  assignIdFaceFile,
  assignIdFaceState,
  assignIdScanState,
  assignIdStep,
  captureIdPhoto,
  clearFaceReference,
  clearIdPreview,
  faceCheckAbortController,
  idFaceAbortController,
  idIntegrated,
  idStatus,
  idStep,
  idStepNext,
  removeIdVerification,
  removeOwnFaceReference,
  resetBackPreview,
  reviewIdVerification,
  runAdminFaceEnroll,
  runFaceCheck,
  saveVerificationSettings,
  setIdStep,
  startIdCamera,
  startIdFaceCapture,
  stopIdCamera,
  submitIdVerification,
} from "./verification.mjs";
import {
  addOrEditUser,
  deactivateAccount,
  forgotPassword,
  resetPassword,
  resetUserPassword,
  toggleAccount,
  verifyEmailChange,
  verifyRecovery,
} from "./users.mjs";
import {
  copyHotline,
  decideAnnouncement,
  decideCalendarEvent,
  deleteHotline,
  lastCalendarClick,
  reviewHotlineCorrection,
  saveAnnouncement,
  saveCalendarEvent,
  saveHotline,
  setLastCalendarClick,
  submitHotlineCorrection,
  submitHotlineSuggestion,
  verifyHotline,
} from "./content.mjs";
import { CATEGORIES, MAX_REPORT_DESCRIPTION_LENGTH, PERMISSION_DEFS } from "../constants.mjs";
import {
  announcementMap,
  announcementMapMarker,
  calendarEventMap,
  calendarEventMapExpanded,
  calendarEventMapMarker,
  initializeCalendarEventMap,
  initializeReportMap,
  locationMap,
  locationMapExpanded,
  reportMap,
  reportMapExpanded,
  reportMapMarker,
  setLocationPickerPin,
  setMapState,
  useCurrentLocation,
} from "../map.mjs";
import { resolveReportLocation, saveLocation, saveRecyclingLocation } from "./location.mjs";
import { login } from "./bootstrap.mjs";

export async function handleAction(button, clickEvent) {
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
    assignIdStep(1);
    assignIdScanState({ readable: false, complete: false });
    assignIdFaceState({ status: "idle" });
    assignIdFaceFile(null);
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
    assignIdFaceState({ status: "idle" });
    assignIdFaceFile(null);
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
    setLastCalendarClick({ date, at: now });
    if (isDoubleClick && button.classList.contains("calendar-cell--has-events")) {
      setLastCalendarClick({ date: "", at: 0 });
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

export async function handleSubmit(formEvent) {
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

export async function handlePhotoSelection(input) {
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

export async function handleProfilePhotoSelection(input) {
  const files = Array.from(input.files || []);
  if (!files.length) {
    setProfilePhotoFile(null);
    setProfilePhotoPreview(null);
    return;
  }
  const file = files[0];
  try {
    const prepared = await compressPhoto(file);
    setProfilePhotoFile(prepared.file);
    setProfilePhotoPreview(prepared.previewUrl);
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
    setProfilePhotoFile(null);
    setProfilePhotoPreview(null);
    console.error("CommUnity could not prepare the selected profile photo.", error);
    toast(error.message, "error");
  }
}
