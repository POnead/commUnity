"use strict";

import { icon, esc, asDate, routeUrl, linkButton, data, currentUser, dateTimeLabel } from "../../core.mjs";
import { page, panel } from "../shared.mjs";
import { ROLES } from "../../constants.mjs";

export function dashboardAdmin() {
  const users = data.users || [];
  const adminIsListed = users.some((user) => user.email === currentUser.email);
  const residentCount = users.filter((user) => user.role === "resident").length;
  const officialCount = users.filter((user) => user.role === "official").length;
  const activeCount = users.filter((user) => user.status === "Active").length + Number(!adminIsListed && currentUser.status !== "Inactive");
  const totalAccounts = users.length + Number(!adminIsListed);
  const pendingConcerns = data.reports.filter((report) => ["Submitted", "Under Review"].includes(report.status)).length;
  const resolvedConcerns = data.reports.filter((report) => report.status === "Resolved").length;
  const recentActivities = [...(data.activities || [])].sort((a, b) => asDate(b.at) - asDate(a.at)).slice(0, 6);
  const body = `
    <div class="content-stack">
      <div class="grid-main-side">
        <div class="content-stack">
          ${panel("Accounts", `<ul class="plain-list"><li><span>All accounts</span><strong class="num">${totalAccounts}</strong></li><li><span>Active</span><strong class="num">${activeCount}</strong></li><li><span>Residents</span><strong class="num">${residentCount}</strong></li><li><span>Barangay officials</span><strong class="num">${officialCount}</strong></li></ul><div class="form-actions">${linkButton("View account details", routeUrl("administrator", "users"), "secondary", "small")}</div>`, { subtitle: "Accounts in this workspace", icon: "users" })}
          ${panel("Concerns Summary", `<div class="concern-summary-grid"><div><span class="concern-summary-icon">${icon("clipboard")}</span><strong>${data.reports.length}</strong><span>Total concerns</span></div><div data-tone="warning"><span class="concern-summary-icon">${icon("clock")}</span><strong>${pendingConcerns}</strong><span>Pending concerns</span></div><div data-tone="success"><span class="concern-summary-icon">${icon("check")}</span><strong>${resolvedConcerns}</strong><span>Resolved concerns</span></div></div><div class="form-actions">${linkButton("View community reports", routeUrl("administrator", "reports"), "secondary", "small")}</div>`, { subtitle: "Submitted and resolved resident concerns", icon: "alert" })}
        </div>
        ${panel("Recent Activity", `<ol class="admin-recent-activity">${recentActivities.map((item) => `<li><span class="activity-dot" aria-hidden="true"></span><div><strong>${esc(item.action)}</strong><span>${esc(item.actor)} · ${esc(ROLES[item.role] || item.role || "System")}</span><small>${esc(dateTimeLabel(item.at))}</small></div></li>`).join("") || `<li class="empty-state"><strong>No activity recorded</strong>Recent account and service activity will appear here.</li>`}<li class="admin-activity-link">${linkButton("Open activity log", routeUrl("administrator", "activity"), "secondary", "small")}</li></ol>`, { subtitle: "Latest six changes in this workspace", icon: "clock" })}
      </div>
    </div>`;
  return page("administrator", "dashboard", body);
}
