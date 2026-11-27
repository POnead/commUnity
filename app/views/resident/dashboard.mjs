"use strict";

import { BARANGAY_WORKING_HOURS } from "../../constants.mjs";
import {
  icon,
  esc,
  asDate,
  dateLabel,
  statusPill,
  displayReportId,
  displayReportTitle,
  userReports,
  sortedReports,
  routeUrl,
  linkButton,
  data,
  currentUser,
} from "../../core.mjs";
import { page, panel, upcomingSchedule, announcementEventMarkup, scheduleDescription } from "../shared.mjs";

export function dashboardResident() {
  const reports = userReports();
  const next = upcomingSchedule(currentUser.area);
  const latest = sortedReports(reports)
    .sort(
      (a, b) =>
        Number(["Submitted", "Under Review"].includes(b.status)) - Number(["Submitted", "Under Review"].includes(a.status)) ||
        asDate(b.updatedAt) - asDate(a.updatedAt),
    )
    .slice(0, 4);
  const announcements = [...data.announcements].sort((a, b) => asDate(b.date) - asDate(a.date)).slice(0, 4);
  const announcementRows = announcements.length
    ? announcements
        .map(
          (item) => `<li class="resident-announcement">
            <time class="resident-announcement-date" datetime="${esc(item.date)}"><strong>${esc(dateLabel(item.date, { day: "numeric" }))}</strong><span>${esc(dateLabel(item.date, { month: "short" }).replace(".", ""))}</span></time>
            <div class="resident-announcement-copy"><strong>${esc(item.title)}</strong><span>${esc(item.detail)}</span>${item.isEvent ? `<div class="announcement-event-meta">${announcementEventMarkup(item)}</div>` : ""}</div>
            <span class="resident-announcement-arrow" aria-hidden="true">${icon("arrow")}</span>
          </li>`,
        )
        .join("")
    : `<li class="resident-announcement-empty"><strong>No announcements yet</strong><span>Updates from the barangay will appear here.</span></li>`;
  const workingHoursRow = `<span class="resident-hours-item"><span class="resident-hours-icon">${icon("clock")}</span><span><strong>Barangay working hours</strong><small>${esc(BARANGAY_WORKING_HOURS)}</small></span></span>`;
  const body = `
    <div class="resident-dashboard">
      <div class="resident-dashboard-grid">
        <div class="content-stack resident-dashboard-primary">
          ${panel("Your Latest Reports", `<div class="quick-list">${latest.map((report) => `<div class="report-item"><span class="item-mark">${icon("clipboard")}</span><div class="item-copy"><strong class="truncate">${esc(displayReportTitle(report))}</strong><span>${esc(displayReportId(report))} · ${esc(dateLabel(report.updatedAt))}</span></div><div class="item-actions">${statusPill(report.status)}<button class="icon-button" type="button" data-action="view-report" data-id="${esc(report.id)}" aria-label="View ${esc(displayReportId(report))}">${icon("arrow")}</button></div></div>`).join("") || `<div class="resident-empty-reports"><span class="resident-empty-icon">${icon("clipboard")}</span><strong>No reports yet</strong><span>When you share a concern, its updates will appear here.</span></div>`}</div><div class="form-actions">${linkButton("View all reports", routeUrl("resident", "reports"), "secondary", "small")}</div>`, { icon: "clipboard", className: "resident-dashboard-panel" })}
          ${panel("Next Collection", next ? `<div class="resident-next-collection"><div class="resident-collection-date"><span class="resident-collection-icon">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.start)} – ${esc(next.end)}</span><p class="resident-collection-description">${esc(scheduleDescription(next))}</p></div></div><div class="resident-collection-meta"><span>${icon("activity")}<strong>${esc(next.wasteType)}</strong></span><span>${icon("pin")}<strong>${esc(next.area)}${next.zone ? ` · ${esc(next.zone)}` : ""}</strong></span><span>${icon("users")}<strong>${esc(next.team || "Team not listed")}</strong></span></div></div><div class="form-actions">${linkButton(`${icon("calendar")} View schedule`, routeUrl("resident", "collection"), "secondary", "small")}</div>` : `<div class="empty-state"><strong>No upcoming pickup posted</strong>Check back for a schedule update from your barangay.</div>`, { icon: "calendar", className: "resident-dashboard-panel" })}
        </div>
        ${panel("Announcements", `<ul class="resident-announcement-list">${announcementRows}</ul>`, { icon: "activity", action: linkButton("View all", routeUrl("resident", "calendar"), "secondary", "small"), className: "resident-dashboard-panel resident-announcements-panel" })}
      </div>
      <section class="resident-hours-strip" aria-label="Barangay working hours">
        ${workingHoursRow}
      </section>
    </div>`;
  return page("resident", "dashboard", body);
}
