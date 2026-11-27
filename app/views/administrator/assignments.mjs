"use strict";

import { icon, esc, dateLabel, displayReportId, displayReportTitle, sortedReports, data } from "../../core.mjs";
import { page, panel } from "../shared.mjs";

export function assignmentsPage() {
  const officials = (data.users || [])
    .filter((user) => user.role === "official" && user.status === "Active")
    .sort((left, right) => left.name.localeCompare(right.name));
  const unassignedReports = sortedReports(data.reports.filter((report) => report.status !== "Resolved" && !report.assignedTo));
  const rows = unassignedReports
    .map(
      (
        report,
      ) => `<div class="record-row filter-item assignment-record" role="row" data-search="${esc(`${displayReportId(report)} ${report.id} ${report.title} ${report.name} ${report.area} ${report.category}`.toLowerCase())}">
        <div role="cell"><strong class="record-primary">${esc(displayReportTitle(report))}</strong><span class="record-secondary">${esc(displayReportId(report))}</span></div>
        <div class="record-meta" role="cell" data-label="Resident">${esc(report.name)}</div>
        <div class="record-meta" role="cell" data-label="Location">${esc([report.area, report.locationDetail].filter(Boolean).join(" · ") || "—")}</div>
        <div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(report.submittedAt))}</div>
        <div role="cell" data-label="Assign official"><select class="select assignment-official-select" name="officialId" aria-label="Select official for ${esc(displayReportId(report))}" ${officials.length ? "" : "disabled"}><option value="">${officials.length ? "Select official" : "No active officials"}</option>${officials.map((official) => `<option value="${esc(official.id)}">${esc(official.name)} · ${esc(official.area || "Palsara")}</option>`).join("")}</select></div>
        <div class="record-actions" role="cell" data-label="Action"><button class="button small" type="button" data-action="assign-report" data-id="${esc(report.id)}" ${officials.length ? "" : "disabled"}>Assign</button></div>
      </div>`,
    )
    .join("");
  const content = `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search unassigned concerns</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search concerns or residents"></label></div>${officials.length ? "" : `<p class="notice-bar assignment-notice">There are no active Barangay Official accounts available for assignment.</p>`}<div class="records assignment-records mt-16" data-page-size="10" role="table" aria-label="Unassigned resident concerns"><div class="record-row record-head" role="row"><span role="columnheader">Concern</span><span role="columnheader">Resident</span><span role="columnheader">Location</span><span role="columnheader">Date Submitted</span><span role="columnheader">Assign Official</span><span role="columnheader">Action</span></div>${rows || `<div class="assignment-empty"><div class="empty-state"><strong>No unassigned concerns</strong>Open unresolved concerns will appear here when they need an official.</div></div>`}</div>`;
  return page(
    "administrator",
    "assignments",
    `<div class="content-stack">${panel("Unassigned Resident Concerns", content, { subtitle: "Assign unresolved concerns to active barangay officials." })}</div>`,
  );
}
