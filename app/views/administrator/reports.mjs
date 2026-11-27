"use strict";

import { icon, esc, asDate, displayReportId, data, adminReportFilters } from "../../core.mjs";
import { page, panel, reportRows } from "../shared.mjs";

export function administratorReportsPage() {
  const filters = { status: "all", area: "all", sort: "newest", query: "", ...adminReportFilters };
  const reports = [...data.reports];
  const statusCounts = Object.fromEntries(
    ["Submitted", "Under Review", "In Progress", "Resolved"].map((status) => [
      status,
      reports.filter((report) => report.status === status).length,
    ]),
  );
  const summaryCards = [
    ["all", "All Reports", reports.length, "clipboard", "blue"],
    ["Submitted", "Submitted", statusCounts.Submitted, "arrow", "blue"],
    ["Under Review", "Under Review", statusCounts["Under Review"], "clock", "warning"],
    ["In Progress", "In Progress", statusCounts["In Progress"], "activity", "violet"],
    ["Resolved", "Resolved", statusCounts.Resolved, "check", "success"],
  ]
    .map(
      ([value, label, count, iconName, tone]) =>
        `<button class="report-summary-card" type="button" data-tone="${tone}" data-action="filter-admin-reports" data-value="${esc(value)}" aria-pressed="${filters.status === value}"><span class="report-summary-icon" aria-hidden="true">${icon(iconName)}</span><span class="report-summary-copy"><strong>${count}</strong><span>${esc(label)}</span></span></button>`,
    )
    .join("");
  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  const visibleReports = reports
    .filter((report) => {
      const statusMatches =
        filters.status === "all" || (filters.status === "open" ? report.status !== "Resolved" : report.status === filters.status);
      const areaMatches = filters.area === "all" || report.area === filters.area;
      return (
        statusMatches &&
        areaMatches &&
        (!filters.query ||
          `${displayReportId(report)} ${report.id} ${report.title} ${report.description} ${report.category} ${report.name} ${report.area} ${report.locationDetail || ""}`
            .toLowerCase()
            .includes(filters.query.toLowerCase()))
      );
    })
    .sort((left, right) => {
      if (filters.sort === "oldest") return asDate(left.submittedAt) - asDate(right.submittedAt);
      if (filters.sort === "priority") return priorityRank[left.priority || "Medium"] - priorityRank[right.priority || "Medium"];
      if (filters.sort === "area") return left.area.localeCompare(right.area) || asDate(right.submittedAt) - asDate(left.submittedAt);
      return asDate(right.submittedAt) - asDate(left.submittedAt);
    });
  const areaScope =
    filters.area !== "all"
      ? `<div class="active-area-filter"><span>Area: <strong>${esc(filters.area)}</strong></span><button class="text-button" type="button" data-action="clear-report-area">Clear area</button></div>`
      : "";
  const body = `<div class="content-stack">
    <div class="report-summary-grid" role="group" aria-label="Filter reports by status">${summaryCards}</div>
    <div class="admin-report-toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search by concern, resident, or report ID</span><input class="input" type="search" data-admin-report-search data-search-input value="${esc(filters.query)}" placeholder="Search by concern, resident, or report ID" autocomplete="off"></label>
        <label class="admin-report-filter"><span class="admin-report-filter-label">Sort by</span><select class="select" data-admin-report-filter="sort" aria-label="Sort reports"><option value="newest"${filters.sort === "newest" ? " selected" : ""}>Newest first</option><option value="oldest"${filters.sort === "oldest" ? " selected" : ""}>Oldest first</option><option value="priority"${filters.sort === "priority" ? " selected" : ""}>Priority</option><option value="area"${filters.sort === "area" ? " selected" : ""}>Area</option></select></label>
        <button class="button secondary small" type="button" data-action="clear-admin-report-filters">Clear filters</button>
      </div>
    ${panel("Reports", `${areaScope}${reportRows(visibleReports, "administrator")}`, {
      icon: "flag",
      action: `<div class="report-panel-actions"><span class="report-count">${visibleReports.length} ${visibleReports.length === 1 ? "report" : "reports"}</span><button class="button secondary small" type="button" data-action="export-reports">${icon("download")} Export reports</button></div>`,
    })}
  </div>`;
  return page("administrator", "reports", body);
}
