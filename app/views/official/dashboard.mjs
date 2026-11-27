"use strict";

import {
  esc,
  asDate,
  dateLabel,
  statusPill,
  displayReportId,
  displayReportTitle,
  sortedSchedules,
  routeUrl,
  linkButton,
  data,
  dateTimeLabel,
  displayReferenceText,
} from "../../core.mjs";
import { page, panel, stat, statsStrip } from "../shared.mjs";

export function dashboardOfficial() {
  const open = data.reports.filter((report) => report.status !== "Resolved");
  const resolved = data.reports.filter((report) => report.status === "Resolved");
  const attentionAreas = new Set(open.map((report) => report.area).filter(Boolean));
  const similarCounts = new Map();
  for (const report of open) {
    const key = `${report.category || report.title}\u0000${report.area}`;
    similarCounts.set(key, (similarCounts.get(key) || 0) + 1);
  }
  const attentionReports = [...open]
    .filter((report) => (similarCounts.get(`${report.category || report.title}\u0000${report.area}`) || 1) >= 2)
    .sort((a, b) => {
      const countA = similarCounts.get(`${a.category || a.title}\u0000${a.area}`) || 1;
      const countB = similarCounts.get(`${b.category || b.title}\u0000${b.area}`) || 1;
      return countB - countA || asDate(b.updatedAt) - asDate(a.updatedAt);
    })
    .slice(0, 5);
  const schedules = sortedSchedules(data.schedules)
    .filter((schedule) => !["Cancelled", "Completed"].includes(schedule.status))
    .slice(0, 3);
  const activities = [...(data.activities || [])].sort((a, b) => asDate(b.at) - asDate(a.at)).slice(0, 5);
  const attentionRows = attentionReports
    .map((report) => {
      const similar = similarCounts.get(`${report.category || report.title}\u0000${report.area}`) || 1;
      return `<div class="record-row filter-item" role="row" data-search="${esc(`${displayReportId(report)} ${report.title} ${report.id} ${report.area} ${report.category}`.toLowerCase())}">
        <div role="cell"><strong class="record-primary">${esc(displayReportTitle(report))}</strong><span class="record-secondary">${esc(report.category)}</span></div>
        <div class="record-meta" role="cell" data-label="Concern ID">${esc(displayReportId(report))}</div>
        <div class="record-meta" role="cell" data-label="Location">${esc(report.area)}</div>
        <div class="record-meta official-similar-count" role="cell" data-label="No. of similar concerns">${similar}</div>
        <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View details</button></div>
      </div>`;
    })
    .join("");
  const scheduleRowsMarkup = schedules
    .map(
      (schedule) => `<div class="official-service-row">
        <div><strong>${esc(schedule.area)}</strong><span>${esc(schedule.wasteType)} · ${esc(schedule.zone)}</span></div>
        <div><strong>${esc(dateLabel(schedule.date, { weekday: "short", month: "short", day: "numeric" }))}</strong><span>${esc(schedule.start)} – ${esc(schedule.end)} · ${statusPill(schedule.status)}</span></div>
        <div><strong>${esc(schedule.team)}</strong></div>
      </div>`,
    )
    .join("");
  const activityRows = activities
    .map(
      (item) =>
        `<li class="official-activity-item"><span class="official-activity-dot" aria-hidden="true"></span><div><strong>${esc(item.action)}</strong><span>${esc(item.actor || "Barangay staff")} · ${esc(displayReferenceText(item.detail))}</span><time>${esc(dateTimeLabel(item.at))}</time></div></li>`,
    )
    .join("");
  const body = `
    <div class="content-stack official-overview">
      ${statsStrip([
        stat("In progress", data.reports.filter((report) => report.status === "In Progress").length, "", "blue", "activity"),
        stat("Under review", data.reports.filter((report) => report.status === "Under Review").length, "", "warning", "clock"),
        stat("Resolved reports", resolved.length, "", "success", "check"),
        stat("Areas needing attention", attentionAreas.size, "", "danger", "alert"),
      ])}
      <div class="official-overview-grid">
        <div class="content-stack">
          ${panel("Concerns needing attention", `<div class="records official-attention-records" data-page-size="5" role="table" aria-label="Concerns needing attention"><div class="record-row record-head" role="row"><span role="columnheader">Concern</span><span role="columnheader">Concern ID</span><span role="columnheader">Location</span><span role="columnheader">No. of similar concerns</span><span role="columnheader">Action</span></div>${attentionRows || `<div class="empty-state"><strong>No grouped concerns</strong>Two or more open reports about the same issue and area will appear here.</div>`}</div>`, { icon: "alert" })}
          ${panel("Collection service", `<div class="official-service-table" role="table" aria-label="Collection service"><div class="official-service-head" role="row"><span role="columnheader">Location</span><span role="columnheader">Schedule</span><span role="columnheader">Assigned team</span></div>${scheduleRowsMarkup || `<div class="empty-state"><strong>No future collections scheduled</strong>Published schedules will appear here.</div>`}</div><div class="form-actions official-overview-action">${linkButton("Manage schedule", routeUrl("official", "collection"), "secondary", "small")}</div>`, { icon: "calendar" })}
        </div>
        ${panel("Team activity", `<ol class="official-activity-timeline">${activityRows || `<li class="empty-state"><strong>No team activity yet</strong>Recent official actions will appear here.</li>`}</ol>`, { icon: "users" })}
      </div>
    </div>`;
  return page("official", "dashboard", body);
}
