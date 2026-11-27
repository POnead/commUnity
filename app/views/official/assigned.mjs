"use strict";

import { REPORT_PRIORITIES } from "../../constants.mjs";
import {
  icon,
  esc,
  statusPill,
  displayReportId,
  displayReportTitle,
  sortedReports,
  data,
  currentUser,
  dateTimeLabel,
  officialAssignedFilter,
} from "../../core.mjs";
import { page, panel, stat, statsStrip } from "../shared.mjs";

export function officialAssignedPage() {
  const assigned = sortedReports(data.reports.filter((report) => report.assignedTo?.id === currentUser.id));
  const counts = {
    all: assigned.length,
    "In Progress": assigned.filter((report) => report.status === "In Progress").length,
    "Under Review": assigned.filter((report) => report.status === "Under Review").length,
    Resolved: assigned.filter((report) => report.status === "Resolved").length,
  };
  const selectedFilter = ["all", "In Progress", "Under Review", "Resolved"].includes(officialAssignedFilter)
    ? officialAssignedFilter
    : "all";
  const visible = selectedFilter === "all" ? assigned : assigned.filter((report) => report.status === selectedFilter);
  const tabs = [
    ["all", "All assigned"],
    ["In Progress", "In progress"],
    ["Under Review", "Under review"],
    ["Resolved", "Resolved"],
  ]
    .map(
      ([value, label]) =>
        `<button class="filter-button ${selectedFilter === value ? "selected" : ""}" type="button" data-action="filter-official-assigned" data-value="${esc(value)}" aria-pressed="${selectedFilter === value}">${esc(label)} <span class="filter-count">${counts[value]}</span></button>`,
    )
    .join("");
  const rows = visible
    .map(
      (
        report,
      ) => `<div class="record-row filter-item" role="row" data-search="${esc(`${displayReportId(report)} ${report.id} ${report.title} ${displayReportTitle(report)} ${report.category} ${report.area} ${report.name} ${report.priority || "Medium"} ${report.status}`.toLowerCase())}" data-priority="${esc(report.priority || "Medium")}" data-official-status="${esc(report.status)}">
        <div role="cell"><strong class="record-primary">${esc(displayReportId(report))}</strong></div>
        <div role="cell"><strong class="record-primary">${esc(displayReportTitle(report))}</strong></div>
        <div class="record-meta" role="cell" data-label="Location">${esc(report.area)}</div>
        <div role="cell" data-label="Priority">${statusPill(report.priority || "Medium")}</div>
        <div role="cell" data-label="Status">${statusPill(report.status)}</div>
        <div class="record-date" role="cell" data-label="Assigned date">${esc(report.assignedAt ? dateTimeLabel(report.assignedAt) : "Not recorded")}</div>
        <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>
      </div>`,
    )
    .join("");
  const body = `<div class="content-stack official-assigned-page">
    ${statsStrip([
      stat("Total assigned", assigned.length, "", "", "folder"),
      stat("In progress", counts["In Progress"], "", "success", "clock"),
      stat("Under review", counts["Under Review"], "", "blue", "check"),
      stat("Resolved", counts.Resolved, "", "success", "check"),
    ])}
    ${panel(
      "Assigned concerns",
      `<div class="filter-row official-assigned-tabs" role="group" aria-label="Filter assigned concerns">${tabs}</div>
      <div class="toolbar official-assigned-toolbar">
        <label class="search-field">${icon("search")}<span class="visually-hidden">Search assigned concerns</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search assigned concerns..."></label>
        <label class="official-filter-field"><span class="visually-hidden">Filter by priority</span><select class="select" data-official-priority-filter><option value="all">All priority</option>${REPORT_PRIORITIES.map((priority) => `<option value="${esc(priority)}">${esc(priority)}</option>`).join("")}</select></label>
        <label class="official-filter-field"><span class="visually-hidden">Filter by status</span><select class="select" data-official-status-filter><option value="all">All status</option><option value="In Progress">In progress</option><option value="Under Review">Under review</option><option value="Resolved">Resolved</option></select></label>
      </div>
      <div class="records official-assigned-records mt-16" data-page-size="5" role="table" aria-label="My assigned concerns"><div class="record-row record-head" role="row"><span role="columnheader">Concern ID</span><span role="columnheader">Concern</span><span role="columnheader">Location</span><span role="columnheader">Priority</span><span role="columnheader">Status</span><span role="columnheader">Assigned date</span><span role="columnheader">Action</span></div>${rows || `<div class="empty-state"><strong>No concerns assigned to you</strong>Claim an open concern from the queue to start tracking it here.</div>`}</div>`,
      { icon: "clipboard" },
    )}
  </div>`;
  return page("official", "assigned", body);
}
