"use strict";

import {
  icon,
  esc,
  asDate,
  dateLabel,
  statusPill,
  getReport,
  userReports,
  sortedReports,
  routeUrl,
  linkButton,
  actionButton,
  data,
  currentUser,
  selectedReportId,
  reportFilter,
  residentReportSort,
  officialHistorySort,
} from "./core.mjs";
import { STATUSES } from "./constants.mjs";
import {
  page,
  panel,
  pageTitle,
  reportRows,
  reportHistoryRows,
  reportFilters,
  officialReportFilters,
  searchToolbar,
  reportDetail,
  announcementEventMarkup,
} from "./views/shared.mjs";
import { administratorReportsPage, administratorProfilePage, adminHotlinesPage } from "./views/administrator.mjs";
import { residentProfilePage, residentHotlinesPage } from "./views/resident.mjs";
import { officialHotlinesPage, officialAnnouncementsPage, officialProfilePage } from "./views/official.mjs";

export * from "./views/shared.mjs";
export * from "./views/resident.mjs";
export * from "./views/official.mjs";
export * from "./views/administrator.mjs";
export * from "./views/auth.mjs";
export { hasUnsavedPermissionChanges } from "./core.mjs";

export function announcementsPage(role) {
  if (role === "official") return officialAnnouncementsPage();
  const isManager = role === "official" || role === "administrator";
  const announcements = [...data.announcements].sort((a, b) => asDate(b.date) - asDate(a.date));
  const statusLabel = (item) =>
    item.approvalStatus === "pending" ? "Pending approval" : item.approvalStatus === "declined" ? "Declined" : "Published";
  const rows = announcements
    .map(
      (
        item,
      ) => `<div class="record-row filter-item" role="row" data-date="${esc(item.date)}" data-announcement-status="${esc(item.approvalStatus === "pending" ? "pending" : item.approvalStatus === "declined" ? "declined" : "published")}" data-search="${esc(`${item.title} ${item.detail} ${item.isEvent ? "event" : ""} ${statusLabel(item)}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(item.title)}</strong>${item.isEvent ? `<div class="announcement-event-meta">${announcementEventMarkup(item)}</div>` : ""}<span class="record-secondary">${esc(item.detail)}</span></div>
    <div class="record-date" role="cell" data-label="Publish date">${esc(dateLabel(item.date))}</div>
    <div role="cell" data-label="Status">${statusPill(item.approvalStatus === "pending" ? "pending" : item.approvalStatus === "declined" ? "declined" : "approved", statusLabel(item))}</div>
    <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="edit-announcement" data-id="${esc(item.id)}">Edit</button>${role === "administrator" && item.approvalStatus === "pending" ? `<a class="text-button" href="${routeUrl("administrator", "approvals")}">Review in approval queue</a>` : ""}</div>
  </div>`,
    )
    .join("");
  const body = `<div class="content-stack">
    ${panel(
      "Community announcements",
      `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search announcements</span><input class="input" type="search" data-search-input autocomplete="off"></label><label class="official-filter-field"><span class="visually-hidden">Sort announcements</span><select class="select" data-announcement-sort aria-label="Sort announcements by publish date"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
      <div class="records mt-16" data-announcement-records data-page-size="10" role="table" aria-label="Announcements"><div class="record-row record-head" role="row"><span role="columnheader">Announcement</span><span role="columnheader">Date</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>${rows || `<div class="empty-state"><strong>No announcements yet</strong>Updates published by barangay staff will appear here.</div>`}</div>`,
      {
        subtitle: isManager ? "Create or update a notice for residents and staff." : "Service information shared by barangay staff.",
        action: isManager ? actionButton(`${icon("plus")} New announcement`, "add-announcement", "small") : "",
      },
    )}
  </div>`;
  return page(role, "announcements", body);
}

export function reportsPage(role, view) {
  const selection = selectedReportId ? getReport(selectedReportId) : null;
  if (selection && (role !== "resident" || selection.userEmail === currentUser.email)) return reportDetail(selection, role);
  if (role === "administrator") return administratorReportsPage();
  const userRows = role === "resident" ? userReports() : data.reports;
  const officialQueue = role === "official" && view === "concerns";
  const canFilter = (role === "resident" || role === "administrator") && view === "reports";
  const allowedFilters = officialQueue ? [...STATUSES.slice(0, -1)] : canFilter ? ["all", ...STATUSES] : [];
  const activeFilter = allowedFilters.includes(reportFilter) ? reportFilter : "all";
  const filtered = sortedReports(
    officialQueue || canFilter ? userRows.filter((report) => (activeFilter === "all" ? true : report.status === activeFilter)) : userRows,
  );
  const subtitle =
    view === "history"
      ? role === "official"
        ? ""
        : "A complete record of submitted concerns and their latest updates."
      : pageTitle(role, view)[1];
  const showResolvedSeparately = !canFilter || activeFilter === "all";
  const activeRows = view === "history" || !showResolvedSeparately ? filtered : filtered.filter((report) => report.status !== "Resolved");
  const resolvedRows = view === "history" || !showResolvedSeparately ? [] : filtered.filter((report) => report.status === "Resolved");
  const primaryAction =
    role === "resident" && view !== "reports" ? linkButton(`${icon("plus")} Report a concern`, routeUrl("resident", "report"), "") : "";
  const exportActions =
    role === "resident"
      ? view === "reports"
        ? `<button class="button secondary small" type="button" data-action="export-reports">${icon("download")} Export reports</button>`
        : view === "history"
          ? `<button class="button secondary small" type="button" data-action="export-report-history">${icon("download")} Export history</button>`
          : ""
      : view === "history"
        ? `<button class="button secondary small" type="button" data-action="export-report-history">${icon("download")} Export history</button>`
        : `<button class="button secondary small" type="button" data-action="export-reports">${icon("download")} Export reports</button>`;
  const historyControls =
    role === "resident" && view === "reports"
      ? `<div class="resident-reports-toolbar">${searchToolbar("Search your reports by ID or concern")}<label class="resident-report-sort"><span>Sort by submission date</span><select class="select" data-resident-report-sort aria-label="Sort reports by submission date"><option value="newest"${residentReportSort === "newest" ? " selected" : ""}>Newest first</option><option value="oldest"${residentReportSort === "oldest" ? " selected" : ""}>Oldest first</option></select></label></div>`
      : role === "official" && view === "history"
        ? `<div class="official-history-toolbar">${searchToolbar("Search report activity")}<label class="official-history-sort-field"><span>Sort by</span><select class="select" data-official-history-sort>
          <option value="newest"${officialHistorySort === "newest" ? " selected" : ""}>Date (Newest first)</option>
          <option value="oldest"${officialHistorySort === "oldest" ? " selected" : ""}>Date (Oldest first)</option>
          <option value="concern-asc"${officialHistorySort === "concern-asc" ? " selected" : ""}>Concern type (A-Z)</option>
          <option value="concern-desc"${officialHistorySort === "concern-desc" ? " selected" : ""}>Concern type (Z-A)</option>
          <option value="resident-asc"${officialHistorySort === "resident-asc" ? " selected" : ""}>Resident name (A-Z)</option>
          <option value="resident-desc"${officialHistorySort === "resident-desc" ? " selected" : ""}>Resident name (Z-A)</option>
        </select></label></div>`
        : searchToolbar(role === "official" && view === "history" ? "Search report activity" : undefined);
  const body = `
    <div class="content-stack">
      ${panel(role === "official" && view === "history" ? "Report activity" : view === "history" ? "Past and current concerns" : role === "official" ? "Concern queue" : role === "resident" ? "My Reports" : "Reports", `${role === "official" && view === "history" ? "" : view === "reports" ? reportFilters(userRows, activeFilter) : officialQueue ? officialReportFilters(userRows, activeFilter) : ""}${historyControls}<div class="mt-16" data-report-table>${role === "official" && view === "history" ? reportHistoryRows(userRows, officialHistorySort) : reportRows(view === "history" ? filtered : activeRows, role, resolvedRows.length ? "Resolved ones are listed below." : "")}</div>${resolvedRows.length && view !== "history" ? `<div class="section-heading mt-20"><div><h2>Resolved concerns</h2><p>${resolvedRows.length} marked as addressed</p></div></div><div data-report-table>${reportRows(resolvedRows, role)}</div>` : ""}`, { subtitle: role === "resident" && view === "reports" ? "" : subtitle, action: exportActions, className: role === "resident" && view === "reports" ? "resident-reports-panel" : "" })}
    </div>`;
  return page(role, view, body, primaryAction);
}

export function hotlinesPage(role) {
  if (role === "resident") return residentHotlinesPage();
  if (role === "official") return officialHotlinesPage();
  return adminHotlinesPage();
}

export function profilePage(role) {
  if (role === "administrator") return administratorProfilePage();
  if (role === "resident") return residentProfilePage();
  return officialProfilePage();
}
