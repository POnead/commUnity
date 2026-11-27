"use strict";

import {
  asDate,
  currentUser,
  dateLabel,
  dateTimeLabel,
  displayReportId,
  displayReportTitle,
  esc,
  getUser,
  icon,
  normalizeStatus,
  residentReportSort,
  selectField,
  statusPill,
  uploadPhotos,
} from "../../core.mjs";
import { FOLLOW_UP_LIMITS, REPORT_PRIORITIES, REPORT_TRANSITIONS, STATUSES } from "../../constants.mjs";
import { page, panel, userAvatar } from "./shell.mjs";

export function officialReportFilters(reports, activeFilter) {
  const options = [
    ["all", "Open reports"],
    ["Submitted", "Submitted"],
    ["Under Review", "Under review"],
    ["In Progress", "In progress"],
  ];
  return `<div class="filter-row" role="group" aria-label="Filter concerns">${options
    .map(([value, label]) => {
      const count =
        value === "all"
          ? reports.filter((report) => report.status !== "Resolved").length
          : reports.filter((report) => report.status === value).length;
      return `<button type="button" class="filter-button ${activeFilter === value ? "selected" : ""}" data-action="filter-reports" data-value="${esc(value)}" aria-pressed="${activeFilter === value}">${esc(label)} <span class="filter-count">${count}</span></button>`;
    })
    .join("")}</div>`;
}

export function reportRows(reports, role, emptyHint = "") {
  if (!reports.length && role !== "administrator")
    return `<div class="empty-state"><strong>${emptyHint ? "No active concerns" : "No concerns in this view"}</strong>${esc(emptyHint || "When a report is submitted, it will appear here.")}</div>`;
  if (role === "resident") {
    const residentReports = [...reports].sort((a, b) => {
      const direction = residentReportSort === "oldest" ? 1 : -1;
      return direction * (asDate(a.submittedAt) - asDate(b.submittedAt));
    });
    const rows = residentReports
      .map(
        (
          report,
        ) => `<div class="record-row filter-item" role="row" data-submitted="${esc(String(report.submittedAt || "").slice(0, 10))}" data-search="${esc(`${displayReportId(report)} ${report.id} ${report.title} ${report.description} ${report.category} ${report.assignedTo?.name || ""} ${report.area} ${report.status}`.toLowerCase())}">
          <div class="record-meta resident-report-id" role="cell" data-label="Report ID">${esc(displayReportId(report))}</div>
          <div class="resident-report-concern" role="cell" data-label="Concern"><strong class="record-primary">${esc(displayReportTitle(report))}</strong><span class="record-secondary">${esc(report.category)}</span></div>
          <div class="record-meta" role="cell" data-label="Priority"><span class="status" data-status="${esc(normalizeStatus(report.priority || "Medium"))}">${esc(report.priority || "Medium")}</span></div>
          <div class="record-meta" role="cell" data-label="Assigned official">${esc(report.assignedTo?.name || "Not assigned")}</div>
          <div class="record-meta" role="cell" data-label="Affected area">${esc(report.area)}</div>
          <div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(report.submittedAt))}</div>
          <div role="cell" data-label="Status">${statusPill(report.status)}</div>
          <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>
        </div>`,
      )
      .join("");
    return `<div class="records resident-report-records" data-page-size="10" role="table" aria-label="My reports"><div class="record-row record-head" role="row">${["Report ID", "Concern", "Priority", "Assigned Official", "Affected Area", "Date Submitted", "Status", "Action"].map((header) => `<span role="columnheader">${header}</span>`).join("")}</div>${rows}</div>`;
  }
  const officialResolved = role === "official" && reports.length > 0 && reports.every((report) => report.status === "Resolved");
  const headers =
    role === "administrator"
      ? ["Concern", "Concern ID", "Resident", "Priority", "Affected area", "Date submitted", "Status", "Action"]
      : officialResolved
        ? ["Concern", "Resident", "Affected area", "Status", "Action"]
        : ["Concern", "Resident", "Priority", "Affected area", "Status", "Action"];
  const cells = reports
    .map((report) => {
      const priority = report.priority || "Medium";
      const first = `<div role="cell"><button class="text-button record-primary" type="button" data-action="view-report" data-id="${esc(report.id)}">${esc(displayReportTitle(report))}</button>${role === "administrator" ? "" : `<span class="record-secondary">${esc(displayReportId(report))}</span>`}${role === "official" ? `<span class="record-secondary">Assigned to ${esc(report.assignedTo?.name || "no one")}</span>` : ""}</div>`;
      const second = `<div class="record-meta" role="cell" data-label="Resident">${esc(report.name)}</div>`;
      const third = `<div class="record-meta" role="cell" data-label="Area">${esc(report.area)}<span class="record-secondary">${esc(dateLabel(report.submittedAt))}</span></div>`;
      const priorityCell = `<div class="record-meta" role="cell" data-label="Priority"><span class="status" data-status="${esc(normalizeStatus(priority))}">${esc(priority)}</span></div>`;
      const adminIdCell = `<div class="record-meta" role="cell" data-label="Concern ID">${esc(displayReportId(report))}</div>`;
      const adminAreaCell = `<div class="record-meta" role="cell" data-label="Affected area">${esc(report.area)}</div>`;
      const adminDateCell = `<div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(report.submittedAt))}</div>`;
      const overdueBadge = report.overdue
        ? `<span class="status-overdue" title="${esc(report.responseOverdue ? "Past the first-response deadline with no staff response yet" : "Past the resolution deadline and still unresolved")}">Overdue</span>`
        : "";
      const statusCell = `<div role="cell" data-label="Status">${statusPill(report.status)}${overdueBadge}</div>`;
      const actionsCell =
        role === "official"
          ? `<div class="record-actions" role="cell" data-label="">${report.status === "Resolved" ? "" : `<button class="button secondary small" type="button" data-action="claim-report" data-id="${esc(report.id)}" ${report.assignedTo ? `disabled title="Assigned to ${esc(report.assignedTo.name)}"` : ""}>Claim</button>`}<button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>`
          : `<div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>`;
      const ordered = `${second}${priorityCell}${third}`;
      const officialOrdered = officialResolved ? `${second}${third}` : `${second}${priorityCell}${third}`;
      const adminOrdered = `${adminIdCell}${second}${priorityCell}${adminAreaCell}${adminDateCell}${statusCell}${actionsCell}`;
      return `<div class="record-row filter-item" role="row" data-priority="${esc(priority)}" data-report-status="${esc(report.status)}" data-area="${esc(report.area)}" data-submitted="${esc(String(report.submittedAt || "").slice(0, 10))}" data-search="${esc(`${displayReportId(report)} ${report.id} ${report.title} ${report.description} ${report.category} ${report.name} ${report.barangay || ""} ${report.area} ${report.locationDetail || ""} ${report.status} ${priority}`.toLowerCase())}">
      ${first}${role === "administrator" ? adminOrdered : role === "official" ? `${officialOrdered}${statusCell}${actionsCell}` : `${ordered}${statusCell}${actionsCell}`}
    </div>`;
    })
    .join("");
  const emptyRow =
    role === "administrator" && !reports.length
      ? `<div class="report-empty-row" role="row"><div class="empty-state" role="cell"><strong>No reports match these filters</strong>Try changing the status, priority, date range, or search terms.</div></div>`
      : "";
  return `<div class="records ${role === "administrator" ? "admin-report-records" : role === "official" ? `official-report-records${officialResolved ? " official-resolved-records" : ""}` : ""}" data-page-size="10" role="table" aria-label="Community concerns"><div class="record-row record-head" role="row">${headers.map((header) => `<span role="columnheader">${esc(header)}</span>`).join("")}</div>${cells}${emptyRow}</div>`;
}

export function reportAssignmentAction(report) {
  if (report.assignedTo?.id === currentUser.id) {
    return `<button class="button secondary small" type="button" data-action="release-report" data-id="${esc(report.id)}">Release</button>`;
  }
  if (!report.assignedTo) {
    return `<button class="button secondary small" type="button" data-action="claim-report" data-id="${esc(report.id)}">Claim</button>`;
  }
  return "";
}

export function reportHistoryRows(reports, sort = "newest") {
  const updates = reports
    .flatMap((report) => report.history.map((item) => ({ report, item })))
    .sort((a, b) => {
      if (sort === "oldest") return asDate(a.item.at) - asDate(b.item.at);
      if (sort === "concern-asc") return (a.report.category || a.report.title).localeCompare(b.report.category || b.report.title);
      if (sort === "concern-desc") return (b.report.category || b.report.title).localeCompare(a.report.category || a.report.title);
      if (sort === "resident-asc") return a.report.name.localeCompare(b.report.name);
      if (sort === "resident-desc") return b.report.name.localeCompare(a.report.name);
      return asDate(b.item.at) - asDate(a.item.at);
    });
  if (!updates.length) return `<div class="empty-state"><strong>No report updates yet</strong>Status changes will appear here.</div>`;
  const rows = updates
    .map(
      ({
        report,
        item,
      }) => `<div class="record-row filter-item" role="row" data-search="${esc(`${displayReportId(report)} ${report.id} ${report.title} ${report.name} ${report.category} ${item.status} ${item.note}`.toLowerCase())}">
    <div class="record-meta" role="cell" data-label="Concern ID">${esc(displayReportId(report))}</div>
    <div role="cell"><strong class="record-primary">${esc(displayReportTitle(report))}</strong><span class="record-secondary">${esc(report.category)}</span></div>
    <div class="record-meta" role="cell" data-label="Resident">${esc(report.name)}</div>
    <div role="cell" data-label="Update">${statusPill(item.status)}<span class="record-secondary">${esc(item.note)}</span></div>
    <div class="record-date" role="cell" data-label="Date and time">${esc(dateTimeLabel(item.at))}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>
  </div>`,
    )
    .join("");
  const dateSort = sort === "oldest" ? "ascending" : "descending";
  const concernSort = sort === "concern-asc" ? "ascending" : sort === "concern-desc" ? "descending" : "none";
  return `<div class="records official-history-records" data-page-size="10" role="table" aria-label="Report activity"><div class="record-row record-head" role="row"><span role="columnheader">Concern ID</span><span role="columnheader" aria-sort="${concernSort}"><button type="button" class="history-sort-button" data-action="sort-official-history" data-value="concern">Concern${concernSort !== "none" ? `<span class="history-sort-indicator" aria-hidden="true">${concernSort === "ascending" ? "↑" : "↓"}</span>` : ""}</button></span><span role="columnheader">Resident</span><span role="columnheader">Update</span><span role="columnheader" aria-sort="${dateSort}"><button type="button" class="history-sort-button" data-action="sort-official-history" data-value="date">Date &amp; time<span class="history-sort-indicator" aria-hidden="true">${dateSort === "ascending" ? "↑" : "↓"}</span></button></span><span role="columnheader">Action</span></div>${rows}</div>`;
}

export function reportFilters(reports, activeFilter) {
  const options = [
    ["all", "All reports"],
    ["Submitted", "Submitted"],
    ["Under Review", "Under review"],
    ["In Progress", "In progress"],
    ["Resolved", "Resolved"],
  ];
  return `<div class="filter-row" role="group" aria-label="Filter reports">${options
    .map(([value, label]) => {
      const count = value === "all" ? reports.length : reports.filter((report) => report.status === value).length;
      return `<button type="button" class="filter-button ${activeFilter === value ? "selected" : ""}" data-action="filter-reports" data-value="${esc(value)}" aria-pressed="${activeFilter === value}">${esc(label)} <span class="filter-count">${count}</span></button>`;
    })
    .join("")}</div>`;
}

export function searchToolbar(label = "Search concerns by report ID, resident or description") {
  return `<div class="toolbar mt-16"><label class="search-field">${icon("search")}<span class="visually-hidden">${esc(label)}</span><input class="input" type="search" data-search-input autocomplete="off"></label></div>`;
}

export function timelineMarkup(history) {
  return `<ol class="timeline">${history
    .map(
      (item, index) => `
    <li class="timeline-item ${index === 0 ? "" : "future"}"><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-copy"><strong>${esc(item.status)}</strong><span>${esc(item.note)}${item.actorName ? ` · By ${esc(item.actorName)}` : ""} · ${esc(dateTimeLabel(item.at))}</span></div></li>`,
    )
    .join("")}</ol>`;
}

export function photoPreviewMarkup(photos = uploadPhotos) {
  return photos
    .map(
      (photo, index) =>
        `<div class="photo-thumb"><img src="${esc(photo.previewUrl)}" alt="${esc(photo.name)}"><button type="button" data-action="remove-photo" data-index="${index}" aria-label="Remove ${esc(photo.name)}">${icon("close")}</button></div>`,
    )
    .join("");
}

export function reportDetail(report, role) {
  const isResident = role === "resident";
  const nextStatuses = report.status === "Resolved" ? [] : REPORT_TRANSITIONS[report.status] || [];
  const needsNote = nextStatuses.length
    ? `<p class="field-help">Add an update note for the resident. Marking a concern <strong>Resolved</strong> requires a resolution explanation.</p>`
    : "";
  const statusOptions = STATUSES.map((status) => {
    const reachable = nextStatuses.includes(status);
    const reason = status === report.status ? "Current status" : reachable ? "" : `Not available from ${report.status}`;
    return `<option value="${esc(status)}"${status === (nextStatuses[0] || report.status) ? " selected" : ""}${reachable ? "" : " disabled"}>${esc(status)}${reason ? ` — ${esc(reason)}` : ""}</option>`;
  }).join("");
  const statusForm =
    role === "official" && nextStatuses.length
      ? `
    <form class="form-stack" id="report-status-form">
      <input type="hidden" name="reportId" value="${esc(report.id)}">
      <div class="form-field"><label for="status">Update status</label><select class="select" id="status" name="status" required>${statusOptions}</select><span class="field-help">Only the next step from ${esc(report.status)} can be selected. Other statuses stay visible but disabled.</span></div>
      <div class="form-field"><label for="status-note">Update for the resident</label><textarea class="textarea" id="status-note" name="note" maxlength="400"></textarea></div>
      ${needsNote}
      <div class="form-actions"><button class="button" type="submit">Save report update</button></div>
    </form>`
      : role === "official"
        ? `<p class="muted small">This concern is resolved. Residents can confirm it was addressed or request that it be reopened.</p>`
        : "";
  const photos = (report.photos || []).length
    ? `<div class="photo-preview">${report.photos.map((photo) => `<a class="photo-thumb" href="${esc(photo.photoUrl)}" target="_blank" rel="noopener" aria-label="Open report photo ${esc(photo.name)}"><img src="${esc(photo.photoUrl)}" alt="Photo attached to ${esc(report.id)}"></a>`).join("")}</div>`
    : `<p class="muted small">No photo was attached to this report.</p>`;
  const hasMapPin = Number.isFinite(report.latitude) && Number.isFinite(report.longitude);
  const reportLocation =
    role !== "administrator"
      ? panel(
          "Exact map location",
          hasMapPin
            ? `<div id="report-detail-map" class="report-map-canvas report-detail-map" data-latitude="${report.latitude}" data-longitude="${report.longitude}" role="region" aria-label="${role === "official" ? "Map with Palsara context, approximate purok locations, and the exact concern pin" : "Map centered on this concern's reported location"}"></div><p class="map-status" id="report-detail-map-status" role="status" aria-live="polite">Map pin at ${report.latitude.toFixed(6)}, ${report.longitude.toFixed(6)}.</p><a class="text-button map-directions-link" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${report.latitude},${report.longitude}`)}" target="_blank" rel="noopener noreferrer">Open directions in Google Maps</a>`
            : `<p class="muted small">${isResident ? "You did not add a map pin." : "The resident did not include a map pin."} Use the barangay, area, and street or landmark details above to locate this concern.</p>`,
        )
      : "";
  const priority = report.priority || "Medium";
  const followUpLimit = Object.hasOwn(FOLLOW_UP_LIMITS, priority) ? FOLLOW_UP_LIMITS[priority] : FOLLOW_UP_LIMITS.Medium;
  const followUpCount = Number(report.followUpCount || 0);
  const followUpRemaining = followUpLimit === null ? null : Math.max(0, followUpLimit - followUpCount);
  const followUpsOpen = report.status !== "Resolved" && (followUpLimit === null || followUpRemaining > 0);
  const followUpNote =
    report.status === "Resolved"
      ? "This concern is resolved. Follow-ups are closed."
      : followUpLimit === null
        ? `${priority} priority · Unlimited follow-ups.`
        : `${priority} priority · ${followUpRemaining} of ${followUpLimit} follow-ups remaining.`;
  const followUpForm = isResident
    ? panel(
        "Need to add context?",
        `<p class="muted small">${esc(followUpNote)}</p>${followUpsOpen ? `<form id="follow-up-form" class="form-stack"><input type="hidden" name="reportId" value="${esc(report.id)}"><div class="form-field"><label for="follow-up-message">Follow-up message</label><textarea class="textarea" id="follow-up-message" name="message" required maxlength="1000"></textarea></div><div class="form-actions"><button class="button secondary" type="submit">Follow Up</button></div></form>` : ""}`,
      )
    : "";
  const priorityForm =
    role === "official" || role === "administrator"
      ? panel(
          "Concern priority",
          `<form id="report-priority-form" class="form-stack"><input type="hidden" name="reportId" value="${esc(report.id)}"><p class="muted small">Residents choose this at submission; staff can adjust it here.</p>${selectField("Priority", "priority", REPORT_PRIORITIES, priority)}<div class="form-actions"><button class="button secondary" type="submit">Update priority</button></div></form>`,
        )
      : "";
  const body = `
    <div class="content-stack">
      <div class="profile-layout">
        <div class="content-stack">
          <section class="panel"><div class="panel-body">
            <div class="inline-between"><div><h2 class="report-detail-title">${esc(displayReportTitle(report))}</h2><p class="record-secondary report-detail-id">${esc(displayReportId(report))} · ${esc(report.category)}</p></div>${statusPill(report.status)}</div>
            <p class="report-description">${esc(report.description)}</p>
            <div class="notice-bar"><span>Barangay</span><strong>${esc(report.barangay || "—")}</strong></div>
            <div class="notice-bar mt-16"><span>Purok or area</span><strong>${esc(report.area)}</strong></div>
            <div class="notice-bar mt-16"><span>Street or landmark</span><strong>${esc(report.locationDetail || "Not provided")}</strong></div>
            ${role === "administrator" && hasMapPin ? `<div class="notice-bar mt-16"><span>Exact map location</span><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${report.latitude},${report.longitude}`)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div>` : ""}
            <div class="inline-between mt-16"><span class="muted small">Submitted ${esc(dateTimeLabel(report.submittedAt))}</span>${report.status === "Resolved" && report.resolvedAt ? `<span class="muted small">Resolved ${esc(dateTimeLabel(report.resolvedAt))}</span>` : `<span class="muted small">Updated ${esc(dateTimeLabel(report.updatedAt))}</span>`}</div>
          </div></section>
          ${reportLocation}
          ${panel("Attached photos", photos)}
          ${followUpForm}
          ${role === "official" ? panel("Record an update", statusForm) : ""}
          ${
            isResident && report.status === "Resolved"
              ? panel(
                  "Close or reopen this concern",
                  `<div class="form-actions"><button class="button" type="button" data-action="confirm-report" data-id="${esc(report.id)}">Confirm addressed</button><button class="button secondary small" type="button" data-action="reopen-report" data-id="${esc(report.id)}">Request reopening</button></div><p class="field-help">Confirming marks the concern as addressed. Reopening returns it to the concern queue with your reason so staff can review it again.</p>`,
                )
              : ""
          }
        </div>
        <div class="content-stack">
          ${role !== "resident" ? `<section class="panel"><header class="panel-head"><div><h2>Reported by</h2></div></header><div class="panel-body"><div class="account-summary">${userAvatar(getUser(report.userEmail) || { name: report.name })}<div><strong>${esc(report.name)}${(getUser(report.userEmail)?.idStatus || "unverified") === "verified" ? ` <span class="id-verified-badge">ID verified</span>` : ""}</strong><span>${esc((getUser(report.userEmail)?.area || report.area) + " · Resident")}</span><span>${esc(report.userEmail)}</span></div></div></div></section>` : ""}
          ${role === "official" ? panel("Assignment", `<div class="inline-between"><span>${report.assignedTo ? `Assigned to ${esc(report.assignedTo.name)}` : "Unassigned"}</span>${reportAssignmentAction(report)}</div>`) : ""}
          ${priorityForm}
          <section class="panel"><header class="panel-head"><div><h2>Status history</h2></div></header><div class="panel-body">${timelineMarkup(report.history)}</div></section>
        </div>
      </div>
    </div>`;
  const listPage = role === "resident" ? "reports" : role === "administrator" ? "reports" : "concerns";
  const actions = `<button class="button secondary" type="button" data-action="back-list">Back to ${isResident ? "my reports" : "reports"}</button>`;
  return page(role, listPage, body, actions);
}
