"use strict";

import {
  activityFilters,
  activityLogLoadedKey,
  activityLogState,
  app,
  confirmAction,
  currentUser,
  data,
  dateLabel,
  displayReferenceText,
  displayReportId,
  getReport,
  localSave,
  locationAreas,
  reportDraft,
  roleLabel,
  routeUrl,
  scheduleClockMinutes,
  scheduleOccurrenceDates,
  scheduleStatusEntry,
  setState,
  sortedReports,
  toast,
  uploadPhotos,
  userReports,
} from "../core.mjs";
import {
  COLLECTION_STATUSES,
  FOLLOW_UP_LIMITS,
  REPORT_PRIORITIES,
  REPORT_TRANSITIONS,
  ROLES,
  SCHEDULE_FREQUENCIES,
  STATUSES,
} from "../constants.mjs";
import { activityResultsMarkup, canOpenPage } from "../views.mjs";
import { reportLocationVerdict, resolveReportLocation } from "./location.mjs";
import { setMapState } from "../map.mjs";
import { render } from "./render.mjs";
import { nextScheduleId } from "./content.mjs";

export function refreshSearch(searchValue) {
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

export function updatePagination(onlyRecords = null) {
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

export function safeCsvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCsv(filename, headers, rows, note = "") {
  const contents = [headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", contents], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(note || "Your CSV export is ready.", note ? "error" : "success");
}

export function exportReports(history = false) {
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

export function activityQuery() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(activityFilters)) {
    if (value && value !== "all") params.set(key, value);
  }
  return params;
}

export async function loadActivityLog(page = 1, force = false) {
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

export async function exportActivityLog() {
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

export async function compressPhoto(file) {
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

export function nextReportId() {
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

export async function submitReportDraft() {
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

export async function updateReportStatus(form) {
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

export async function updateReportAssignment(id, claim) {
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

export async function assignReportToOfficial(reportId, officialId) {
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

export async function confirmReport(reportId, note) {
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

export async function reopenReport(reportId, reason) {
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

export function followUpLimitFor(priority) {
  return Object.hasOwn(FOLLOW_UP_LIMITS, priority) ? FOLLOW_UP_LIMITS[priority] : FOLLOW_UP_LIMITS.Medium;
}

export async function submitFollowUp(form) {
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

export async function updateReportPriority(form) {
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

export async function updateCollection(form) {
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

export function openReport(id) {
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
