"use strict";

import {
  locationAreas,
  icon,
  esc,
  asDate,
  dateLabel,
  dateTimeLabel,
  monthKey,
  monthKeyOffset,
  normalizeStatus,
  statusPill,
  roleLabel,
  initials,
  displayReportId,
  displayReferenceText,
  displayReportTitle,
  effectivePermissions,
  sortedReports,
  routeUrl,
  linkButton,
  actionButton,
  inputField,
  app,
  data,
  currentUser,
  adminReportFilters,
  analyticsRange,
  approvalFilter,
  smtpSettings,
  selectedPermissionAccount,
  permissionOpenAccounts,
  activityLogState,
  activityFilters,
} from "../core.mjs";
import { ROLES, ID_TYPE_LABELS, PERMISSION_DEFS, ADMIN_ROLE_PERMISSION_IDS } from "../constants.mjs";
import { locationMapExpanded } from "../map.mjs";
import {
  page,
  stat,
  statsStrip,
  panel,
  userAvatar,
  reportRows,
  hotlineAvailabilityMarkup,
  hotlineVerifiedLabel,
  hotlineDirectoryToolbar,
  hotlineCorrectionInfo,
  hotlineCorrectionToolbar,
  profileSummaryCard,
  passwordInput,
} from "./shared.mjs";
import { hasUnsavedPermissionChanges } from "../core.mjs";

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

export function settingsPage() {
  const accountItems = [
    ["User Management", "Accounts and status", "users", "users"],
    ["Profile and Password", "Your administrator account", "user", "profile"],
  ];
  const workspaceItems = [
    ["Locations", "Community areas and landmarks", "pin", "locations"],
    ["Announcements", "Community service notices", "activity", "announcements"],
    ["Analytics", "Workspace report and account trends", "chart", "analytics"],
    ["Assignment queue", "Assign unresolved concerns to officials", "users", "assignments"],
    ["Activity Log", "Recorded account and service activity", "clock", "activity"],
    ["Role Management", "Workspace permissions", "shield", "roles"],
  ];
  const systemItems = [["Email Configuration", "SMTP email setup", "mail", "email"]];
  const verificationSection = `<section class="settings-section"><details class="verification-config">
    <summary class="settings-row"><span class="settings-row-icon">${icon("shield")}</span><span class="settings-row-copy"><strong>Verification</strong><small>Face duty check for officials and ID reviews</small></span><span class="settings-row-arrow" aria-hidden="true">${icon("arrow")}</span></summary>
    <div class="verification-settings-body">
    <form id="verification-settings-form" class="verification-settings">
    <label class="settings-toggle"><input type="checkbox" name="requireFaceOnLogin" value="1"> <span class="smtp-config-title"><strong>Face check at sign-in</strong><small>Officials verify their face after entering their password. Skipped while the duty window is still valid. New officials must enroll first.</small></span></label>
    <label class="settings-toggle"><input type="checkbox" name="faceVerificationEnabled" value="1"> <span class="smtp-config-title"><strong>Face duty check</strong><small>Barangay officials face-check once per shift before they can make changes. Administrators are exempt.</small></span></label>
    <div class="form-grid mt-16">
      <div class="form-field"><label for="verification-duty-hours">Duty check lasts</label><select class="select" id="verification-duty-hours" name="dutyHours">${[1, 2, 4, 6, 8, 9, 10, 12].map((hours) => `<option value="${hours}">${hours} hour${hours === 1 ? "" : "s"}</option>`).join("")}</select></div>
      <div class="form-field"><label for="verification-threshold">Match threshold</label><input class="input" id="verification-threshold" name="matchThreshold" type="number" step="0.001" min="0.02" max="0.2" value="0.033" required><span class="field-help">Cosine distance below this passes. Lower is stricter. Default 0.033.</span></div>
    </div>
    <label class="settings-toggle"><input type="checkbox" name="faceppEnabled" value="1"> <span class="smtp-config-title"><strong>Face++ face match (opt-in)</strong><small>Compare staff face images with Face++ instead of the on-device descriptor. Sends face images to a third party.</small></span></label>
    <label class="settings-toggle"><input type="checkbox" name="ocrEnabled" value="1"> <span class="smtp-config-title"><strong>OCR ID prefill (opt-in)</strong><small>Suggest ID fields from the uploaded ID photo. Sends ID images to a third party; residents still confirm every field.</small></span></label>
    <div class="form-grid mt-16"><div class="form-field"><label for="verification-facepp-threshold">Face++ confidence</label><input class="input" id="verification-facepp-threshold" name="faceppThreshold" type="number" step="1" min="50" max="99" value="80" required></div></div>
    <p class="field-help">Enroll officials from a face-check page or their profile. Turning this off never locks residents out. Both third-party options are off by default.</p>
    <div class="form-actions"><button class="button small" type="submit">Save verification settings</button></div>
  </form></div></details></section>`;
  const rows = (items) =>
    items
      .map(
        ([title, description, iconName, pageName]) =>
          `<a class="settings-row" href="${routeUrl("administrator", pageName)}"><span class="settings-row-icon">${icon(iconName)}</span><span class="settings-row-copy"><strong>${esc(title)}</strong><small>${esc(description)}</small></span><span class="settings-row-arrow">${icon("arrow")}</span></a>`,
      )
      .join("");
  const body = `<div class="content-stack settings-groups"><section class="settings-section"><h2>Account Management</h2><div class="settings-list settings-card-grid">${rows(accountItems)}</div></section><section class="settings-section"><h2>Workspace Management</h2><div class="settings-list">${rows(workspaceItems)}</div></section><section class="settings-section settings-full-width"><h2>System Configuration</h2><div class="settings-list">${rows(systemItems)}</div></section>${verificationSection}</div>`;
  return page("administrator", "settings", body);
}

export function emailPage() {
  const body = `<div class="content-stack">${emailDeliverySection()}</div>`;
  return page("administrator", "email", body);
}

export function emailDeliverySection() {
  if (smtpSettings.encryptionReady === false) {
    // Encryption is a server concern, so say so plainly instead of offering a form
    // that can only fail with a 503 at save time.
    return `<section class="settings-section"><h2>Email</h2><div class="empty-state" role="status"><strong>Email is not set up on this server yet</strong><p>Set the <code>SMTP_SETTINGS_KEY</code> environment variable to a long random secret, then restart the server. The SMTP password is stored AES-GCM encrypted in the database, and the encryption key never comes from the database. See the environment variable table in the README (<code>SMTP_SETTINGS_KEY</code>).</p></div></section>`;
  }
  return `<section class="settings-section smtp-settings-section"><h2>Email Configuration</h2><details class="smtp-config" open><summary><span class="smtp-config-title"><strong>SMTP email</strong><small>Report and collection notifications</small></span><span class="smtp-status" data-enabled="${Boolean(smtpSettings.configured)}"><span aria-hidden="true"></span>SMTP email: ${smtpSettings.configured ? "enabled" : "disabled"}</span><span class="smtp-config-chevron" aria-hidden="true">⌄</span></summary><form id="smtp-settings-form" class="settings-email"><div class="smtp-guide"><strong>Start with your email provider</strong><span>Choose a provider to fill the server details. Use an app password or service API key when your provider offers one; do not use your normal email password.</span><div class="smtp-provider-list"><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="gmail">Gmail</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="outlook">Outlook</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="sendgrid">SendGrid</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="custom">Other provider</button></div><p class="field-help" id="smtp-provider-help">Select a provider to see where its SMTP password or API key comes from.</p></div><div class="form-grid mt-16">${inputField("SMTP host", "host", smtpSettings.host, { required: true })}${inputField("SMTP port", "port", smtpSettings.port || "587", { type: "number", required: true, min: 1, max: 65535 })}${inputField("SMTP username", "user", smtpSettings.user, { required: true })}${inputField("Sender address", "from", smtpSettings.from, { required: true })}${inputField("SMTP password", "pass", "", { type: "password", autocomplete: "new-password", placeholder: smtpSettings.configured ? "Leave blank to keep current password" : "" })}</div><div class="form-actions"><button class="button" type="submit">Save SMTP settings</button><button class="button secondary" type="button" data-action="test-smtp">Send test email</button></div><p class="field-help">The password is encrypted on the server and never returned to this browser.</p></form></details></section>`;
}

export function locationsPage() {
  const locationRows = data.locations
    .map(
      (
        location,
      ) => `<div class="record-row filter-item" role="row" data-search="${esc(`${location.area} ${location.barangay} ${location.street} ${location.purok} ${location.landmark}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(location.purok || location.area)}</strong></div>
    <div class="record-meta" role="cell" data-label="Landmark">${esc(location.landmark || "—")}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-location" data-id="${esc(location.id)}">Edit</button></div>
  </div>`,
    )
    .join("");
  const body = `<div class="content-stack">
    ${panel(
      "Managed Locations",
      `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search purok or landmark</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search purok or landmark"></label></div>
      <div class="records mt-16" data-page-size="10" data-pagination-target="locations-pagination" role="table" aria-label="Community locations"><div class="record-row record-head location-record-head" role="row"><span role="columnheader">Purok</span><span role="columnheader">Landmark</span><span role="columnheader">Action</span></div>${locationRows || `<div class="empty-state"><strong>No locations configured</strong>Add an area before residents register or file reports.</div>`}</div>
      <div class="locations-footer"><div class="locations-footer-copy"><span><strong>${data.locations.length}</strong> ${data.locations.length === 1 ? "location" : "locations"}</span><button class="button secondary small" type="button" data-action="toggle-location-map" aria-expanded="${locationMapExpanded}">${icon("pin")} ${locationMapExpanded ? "Hide Barangay Map" : "View Barangay Map"} ${icon("arrow")}</button></div><div id="locations-pagination"></div></div>
      <section class="location-map-region" ${locationMapExpanded ? "" : "hidden"} aria-label="Barangay map"><div id="location-map" role="application" aria-label="Map of managed community locations"></div><p id="location-map-status" class="field-help">Administrator-selected pins mark saved locations. Unpinned legacy areas use approximate markers; no boundaries are inferred.</p></section>`,
      {
        subtitle: "Manage community areas and verified landmarks.",
        action: actionButton(`${icon("plus")} Add area`, "add-location", "small"),
      },
    )}
  </div>`;
  return page("administrator", "locations", body);
}

export function analyticsPage() {
  const reports = data.reports;
  const totalReports = reports.length;
  const openReports = reports.filter((report) => report.status !== "Resolved").length;
  const resolvedReports = reports.filter((report) => report.status === "Resolved").length;
  const areaNames = [...new Set([...locationAreas(), ...reports.map((report) => report.area).filter(Boolean)])];
  const priorityRank = { High: 3, Medium: 2, Low: 1 };
  const issueGroups = new Map();
  for (const report of reports) {
    if (report.status === "Resolved" || !report.area) continue;
    const issue = report.category || report.title || "—";
    const key = `${report.area}\u0000${issue}`;
    if (!issueGroups.has(key)) issueGroups.set(key, { area: report.area, issue, reports: [], people: new Set() });
    const group = issueGroups.get(key);
    group.reports.push(report);
    group.people.add(report.userEmail || report.name || report.id);
  }
  const attentionByArea = new Map();
  for (const group of issueGroups.values()) {
    const priority = group.reports.reduce(
      (highest, report) => (priorityRank[report.priority || "Medium"] > priorityRank[highest] ? report.priority || "Medium" : highest),
      "Low",
    );
    const highPriority = priorityRank[priority] === priorityRank.High;
    // A high-priority concern is surfaced on its own; repeated issues still
    // need two different residents reporting them.
    if (group.people.size < 2 && !highPriority) continue;
    const oldest = [...group.reports].sort((left, right) => asDate(left.submittedAt) - asDate(right.submittedAt))[0];
    const daysPending = Math.max(0, Math.floor((Date.now() - asDate(oldest.submittedAt).getTime()) / 86400000));
    const item = {
      area: group.area,
      reports: group.reports.length,
      people: group.people.size,
      commonIssue: group.issue,
      daysPending,
      priority,
      highPriority,
    };
    const current = attentionByArea.get(group.area);
    const stronger =
      !current ||
      Number(item.highPriority) > Number(current.highPriority) ||
      (item.highPriority === current.highPriority &&
        (item.people > current.people ||
          (item.people === current.people &&
            (item.daysPending > current.daysPending || (item.daysPending === current.daysPending && item.reports > current.reports)))));
    if (stronger) attentionByArea.set(group.area, item);
  }
  const attention = [...attentionByArea.values()].sort(
    (left, right) =>
      Number(right.highPriority) - Number(left.highPriority) || right.people - left.people || right.daysPending - left.daysPending,
  );
  const byCategory = new Map();
  for (const report of reports) byCategory.set(report.category, (byCategory.get(report.category) || 0) + 1);
  const categoryData = [...byCategory.entries()].sort((left, right) => right[1] - left[1]);
  const chartColors = ["#1e5aa8", "#3486d1", "#57a4e7", "#83bce9", "#f0a343", "#34a879", "#d96f74", "#8068c8"];
  const chartMarkup = ({ id, type, labels, fullLabels = labels, values, colors = [], height, centerValue = "", tableDetails = null }) => {
    const chartNames = {
      category: "Reports by category",
      area: "Reports by area",
      monthly: "Monthly report submissions",
    };
    const chartData = { labels, fullLabels, values, colors };
    const chartName = chartNames[id];
    const tableRows = labels
      .map(
        (_, index) =>
          `<tr><th scope="row">${esc(fullLabels[index])}</th><td>${values[index]}</td>${tableDetails ? `<td>${esc(tableDetails[index])}</td>` : ""}</tr>`,
      )
      .join("");
    const canvas = `<div class="analytics-chart-canvas"${height ? ` style="height:${height}px"` : ""}><canvas data-analytics-chart="${id}" data-chart-type="${type}" data-chart-data="${esc(JSON.stringify(chartData))}" aria-label="${esc(`${chartName}. Focus the chart and use the arrow keys to inspect values.`)}" aria-describedby="${id}-chart-summary ${id}-chart-status" aria-keyshortcuts="ArrowLeft ArrowRight" role="group" tabindex="0"></canvas>${centerValue ? `<div class="analytics-donut-center" aria-hidden="true"><strong>${centerValue}</strong><span>reports</span></div>` : ""}</div>`;
    return `<div class="analytics-chart-shell">${canvas}<p class="analytics-chart-selection" id="${id}-chart-status" role="status" aria-live="polite" aria-atomic="true">Use the arrow keys or point at a chart value to inspect it.</p><p class="visually-hidden" id="${id}-chart-summary">Interactive chart. A data table follows.</p></div><table class="visually-hidden" id="${id}-chart-data"><caption>${esc(chartName)}</caption><thead><tr><th scope="col">${id === "category" ? "Category" : id === "area" ? "Area" : "Month"}</th><th scope="col">Reports</th>${tableDetails ? '<th scope="col">Share</th>' : ""}</tr></thead><tbody>${tableRows}</tbody></table>`;
  };
  const categoryChart = totalReports
    ? `<div class="analytics-donut-layout"><div class="analytics-donut-visual">${chartMarkup({
        id: "category",
        type: "doughnut",
        labels: categoryData.map(([category]) => category),
        values: categoryData.map(([, count]) => count),
        colors: categoryData.map((_, index) => chartColors[index % chartColors.length]),
        centerValue: totalReports,
        tableDetails: categoryData.map(([, count]) => `${Math.round((count / totalReports) * 100)}%`),
      })}</div><ul class="analytics-legend">${categoryData
        .map(
          ([category, count], index) =>
            `<li><span class="analytics-legend-dot" style="--chart-color:${chartColors[index % chartColors.length]}"></span><span>${esc(category)}</span><strong>${count}</strong><small>${Math.round((count / totalReports) * 100)}%</small></li>`,
        )
        .join("")}</ul></div>`
    : `<div class="empty-state"><strong>No reports to chart</strong>Category data will appear when residents submit concerns.</div>`;
  const areaData = areaNames
    .map((area) => [area, reports.filter((report) => report.area === area).length])
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const areaChart = areaData.length
    ? chartMarkup({
        id: "area",
        type: "bar",
        labels: areaData.map(([area]) => area),
        values: areaData.map(([, count]) => count),
        height: Math.max(230, Math.min(420, areaData.length * 38)),
      })
    : `<div class="empty-state"><strong>No areas configured</strong>Area data will appear here when locations are added.</div>`;
  const months = [];
  const range = [3, 6, 12].includes(Number(analyticsRange)) ? Number(analyticsRange) : 6;
  for (let index = range - 1; index >= 0; index -= 1) months.push(monthKeyOffset(-index, new Date()));
  const monthlyData = months.map((month) => reports.filter((report) => monthKey(report.submittedAt) === month).length);
  const monthLabels = months.map((month) =>
    new Intl.DateTimeFormat("en-PH", { month: "short", year: "2-digit" }).format(new Date(`${month}-01T00:00:00`)),
  );
  const monthNames = months.map((month) =>
    new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`)),
  );
  const monthlyChart = chartMarkup({
    id: "monthly",
    type: "line",
    labels: monthLabels,
    fullLabels: monthNames,
    values: monthlyData,
  });
  const attentionRows = attention
    .map(
      (
        item,
      ) => `<div class="record-row attention-record filter-item" role="row" data-search="${esc(`${item.area} ${item.commonIssue} ${item.people}`.toLowerCase())}">
        <div class="record-meta" role="cell"><strong>${esc(item.area)}</strong></div><div role="cell">${item.reports}</div><div class="record-meta" role="cell">${esc(item.commonIssue)}</div><div class="record-meta" role="cell">${item.daysPending} ${item.daysPending === 1 ? "day" : "days"}</div><div role="cell">${statusPill(normalizeStatus(item.priority), item.priority)}</div><div class="record-actions" role="cell"><button class="button secondary small" type="button" data-action="analytics-area-reports" data-area="${esc(item.area)}" data-issue="${esc(item.commonIssue)}">View Reports</button></div>
      </div>`,
    )
    .join("");
  const body = `<div class="content-stack analytics-content">
    ${statsStrip([
      stat("Total Reports", totalReports, "All submitted concerns", "blue", "clipboard"),
      stat("Open Reports", openReports, "Awaiting resolution", "warning", "clock"),
      stat("Resolved Reports", resolvedReports, "Marked resolved", "success", "check"),
      stat("Areas Needing Attention", attention.length, "Repeated issues or high priority", attention.length ? "danger" : "blue", "alert"),
    ])}
    ${panel("Areas Needing Attention", attention.length ? `<div class="analytics-attention-table records" role="table" aria-label="Areas needing attention"><div class="record-row record-head" role="row"><span role="columnheader">Purok / Location</span><span role="columnheader">Number of Concerns</span><span role="columnheader">Most Common Issue</span><span role="columnheader">Longest Pending</span><span role="columnheader">Priority</span><span role="columnheader">Action</span></div>${attentionRows}</div>` : `<div class="empty-state"><strong>No areas need attention</strong>An issue reported by at least two residents in the same area, or any High priority concern, will appear here.</div>`, { subtitle: "Areas with repeated issues or a high-priority concern." })}
    <div class="grid-equal analytics-chart-grid">
      ${panel("Reports by Category", categoryChart, { subtitle: "Share of all reported concerns" })}
      ${panel("Reports by Area", areaChart, { subtitle: "Concern volume across managed locations" })}
    </div>
      ${panel("Monthly Report Submissions", `<div class="analytics-chart-toolbar"><p>Submissions over time</p><label><span class="visually-hidden">Monthly chart range</span><select class="select" data-analytics-range aria-label="Monthly chart range"><option value="3"${range === 3 ? " selected" : ""}>Last 3 months</option><option value="6"${range === 6 ? " selected" : ""}>Last 6 months</option><option value="12"${range === 12 ? " selected" : ""}>Last 12 months</option></select></label></div><div class="analytics-line-wrap">${monthlyChart}</div>`, { subtitle: `Report submissions by month for the last ${range} months.` })}
  </div>`;
  return page("administrator", "analytics", body);
}

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

export function adminHotlinesPage() {
  const hotlines = data.hotlines || [];
  const corrections = data.hotlineCorrections || [];
  const pending = corrections.filter((item) => item.status === "pending");
  const hotlineRows = hotlines
    .map((item) => {
      const status = item.published ? hotlineAvailabilityMarkup(item) : `<span class="status" data-status="draft">Draft</span>`;
      return `<div class="record-row filter-item hotline-directory-row" role="row" data-hotline-category="${esc(item.category)}" data-search="${esc(`${item.name} ${item.category} ${item.description} ${item.contactNumber} ${item.officeAddress} ${item.status} ${item.published ? "published" : "draft"}`.toLowerCase())}">
        <div role="cell"><strong class="record-primary">${esc(item.name)}</strong><span class="record-secondary">${esc(item.description || "No description")}</span></div>
        <div class="record-meta" role="cell" data-label="Category">${esc(item.category)}</div>
        <div class="record-meta" role="cell" data-label="Contact number">${esc(item.contactNumber)}</div>
        <div role="cell" data-label="Status">${status}</div>
        <div class="record-meta" role="cell" data-label="Last verified">${esc(hotlineVerifiedLabel(item))}</div>
        <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="edit-hotline" data-id="${esc(item.id)}">Edit</button></div>
      </div>`;
    })
    .join("");
  const correctionRows = corrections
    .map((item) => {
      const { requestId, requestType, hotlineName, category, proposed } = hotlineCorrectionInfo(item, hotlines);
      const action =
        item.status === "pending"
          ? `<div class="approval-actions"><button class="button small" type="button" data-action="review-hotline-correction" data-id="${esc(item.id)}" data-decision="approved">Approve</button><button class="button danger small" type="button" data-action="review-hotline-correction" data-id="${esc(item.id)}" data-decision="rejected">Reject</button></div>`
          : `${statusPill(item.status, item.status === "approved" ? "Approved" : "Rejected")}${item.reviewNote ? `<span class="record-secondary">${esc(item.reviewNote)}</span>` : ""}`;
      return `<div class="record-row filter-item hotline-correction-row" role="row" data-correction-status="${esc(item.status)}" data-correction-type="${esc(requestType)}" data-submitted="${esc(String(item.createdAt || "").slice(0, 10))}" data-search="${esc(`${requestId} ${requestType} ${hotlineName} ${category} ${item.submittedByName || ""} ${item.reason} ${proposed} ${item.status}`.toLowerCase())}">
        <div class="record-meta" role="cell" data-label="Request ID">${esc(requestId)}</div>
        <div class="record-meta" role="cell" data-label="Request Type">${esc(requestType)}</div>
        <div role="cell"><strong class="record-primary">${esc(hotlineName)}</strong><span class="record-secondary">${esc(item.reason)}</span></div>
        <div class="record-meta" role="cell" data-label="Category">${esc(category)}</div>
        <div class="record-meta" role="cell" data-label="Submitted by">${esc(item.submittedByName || "-")}</div>
        <div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(item.createdAt))}</div>
        <div class="hotline-correction-status" role="cell" data-label="Action">${action}</div>
      </div>`;
    })
    .join("");
  const body = `<div class="content-stack">
    ${statsStrip([
      stat("Total hotlines", hotlines.length, "", "", "phone"),
      stat("Published", hotlines.filter((item) => item.published).length, "", "blue", "check"),
      stat("Drafts", hotlines.filter((item) => !item.published).length, "", "blue", "clipboard"),
      stat("Pending corrections", pending.length, "", "blue", "clock"),
    ])}
    ${panel(
      "Emergency hotlines",
      `${hotlineDirectoryToolbar()}<div class="records mt-16 hotline-directory-records" data-page-size="10" role="table" aria-label="Emergency hotlines"><div class="record-row record-head" role="row"><span role="columnheader">Hotline</span><span role="columnheader">Category</span><span role="columnheader">Contact number</span><span role="columnheader">Status</span><span role="columnheader">Last verified</span><span role="columnheader">Action</span></div>${hotlineRows || `<div class="empty-state"><strong>No hotlines yet</strong>Add the barangay, police, fire, and medical contacts residents should call.</div>`}</div>`,
      {
        icon: "phone",
        subtitle: "Publish verified contacts. Drafts stay hidden from residents and officials.",
        action: actionButton(`${icon("plus")} Add hotline`, "add-hotline", "small"),
      },
    )}
    ${panel(
      "Correction requests",
      `${hotlineCorrectionToolbar()}<div class="records mt-16 hotline-correction-records hotline-correction-records-admin" data-page-size="5" role="table" aria-label="Hotline correction requests"><div class="record-row record-head" role="row"><span role="columnheader">Request ID</span><span role="columnheader">Request Type</span><span role="columnheader">Hotline Name</span><span role="columnheader">Category</span><span role="columnheader">Submitted By</span><span role="columnheader">Date Submitted</span><span role="columnheader">Actions</span></div>${correctionRows || `<div class="empty-state"><strong>No correction requests</strong>Corrections and suggested contacts from officials will appear here.</div>`}</div><div class="empty-state hotline-no-results" data-correction-no-results hidden><strong>No matching requests</strong>Try changing the filters.</div>`,
      { icon: "clipboard", subtitle: "Approve a correction to update the directory, or reject it with a note." },
    )}
  </div>`;
  return page("administrator", "hotlines", body);
}

export function approvalsPage() {
  const events = (data.calendarEvents || []).map((item) => ({ ...item, requestKind: "event" }));
  const announcements = (data.announcements || []).map((item) => ({ ...item, requestKind: "announcement" }));
  const requests = [...events, ...announcements].map((item) => ({
    ...item,
    status: item.approvalStatus === "pending" || item.approvalStatus === "declined" ? item.approvalStatus : "approved",
  }));
  const counts = Object.fromEntries(
    ["pending", "approved", "declined"].map((status) => [status, requests.filter((item) => item.status === status).length]),
  );
  const selectedStatus = ["pending", "approved", "declined"].includes(approvalFilter) ? approvalFilter : "pending";
  const visible = requests
    .filter((item) => item.status === selectedStatus)
    .sort(
      (left, right) => asDate(right.createdAt || right.requestedAt || right.date) - asDate(left.createdAt || left.requestedAt || left.date),
    );
  const statusTabs = [
    ["pending", "Pending", "Pending Requests"],
    ["approved", "Approved", "Approved Requests"],
    ["declined", "Rejected", "Rejected Requests"],
  ]
    .map(
      ([value, label, title]) =>
        `<button class="filter-button ${selectedStatus === value ? "selected" : ""}" type="button" data-action="filter-approvals" data-value="${value}" aria-pressed="${selectedStatus === value}">${label} <span class="filter-count">${counts[value]}</span><span class="visually-hidden">${title}</span></button>`,
    )
    .join("");
  const rows = visible
    .map((item) => {
      const requestedBy =
        item.createdByName ||
        (data.users || []).find((user) => user.id === item.createdBy)?.name ||
        (item.createdBy === currentUser.id ? currentUser.name : "—");
      const requestedAt = item.createdAt || item.requestedAt || item.submittedAt || item.date;
      const action =
        item.status === "pending"
          ? `<div class="approval-actions"><button class="button small" type="button" data-action="${item.requestKind === "event" ? "approve-calendar-event" : "approve-announcement"}" data-id="${esc(item.id)}">Approve</button><button class="button danger small" type="button" data-action="${item.requestKind === "event" ? "decline-calendar-event" : "decline-announcement"}" data-id="${esc(item.id)}">Reject</button></div>`
          : statusPill(item.status === "approved" ? "active" : "cancelled", item.status === "approved" ? "Approved" : "Rejected");
      return `<div class="record-row filter-item approval-record" role="row" data-request-kind="${item.requestKind}" data-search="${esc(`${item.title} ${item.detail || ""} ${requestedBy} ${item.priority || ""}`.toLowerCase())}">
        <div role="cell"><strong class="record-primary">${esc(item.title)}</strong></div>
        <div class="record-secondary" role="cell" data-label="Details">${esc(item.detail || "No additional details.")}</div>
        <div class="record-meta" role="cell" data-label="Requested by">${esc(requestedBy)}</div>
        <div class="record-date" role="cell" data-label="Date requested">${esc(dateLabel(requestedAt))}</div>
        <div class="record-actions" role="cell" data-label="Action">${action}</div>
      </div>`;
    })
    .join("");
  const empty = `<div class="empty-state"><strong>No ${selectedStatus === "declined" ? "rejected" : selectedStatus} requests</strong>${selectedStatus === "pending" ? "New calendar and announcement requests will appear here." : `There are no ${selectedStatus} requests to show.`}</div>`;
  const body = `<div class="content-stack">
    ${statsStrip([
      stat("Pending Requests", counts.pending, "Waiting for your decision", "blue", "clock"),
      stat("Approved Requests", counts.approved, "Published or scheduled", "success", "check"),
      stat("Rejected Requests", counts.declined, "Declined requests", "danger", "close"),
    ])}
    ${panel("Requests", `<div class="filter-row approval-status-tabs" role="group" aria-label="Filter approval requests">${statusTabs}</div><div class="records approval-records mt-16" data-page-size="10" role="table" aria-label="Approval requests"><div class="record-row record-head" role="row"><span role="columnheader">Title</span><span role="columnheader">Details</span><span role="columnheader">Requested By</span><span role="columnheader">Date Requested</span><span role="columnheader">Action</span></div>${rows || `<div class="approval-empty">${empty}</div>`}</div>`, { subtitle: "Review and decide on event and announcement requests." })}
  </div>`;
  return page("administrator", "approvals", body);
}

export function adminFaceEnrollMarkup(user) {
  return `<section class="admin-face-enroll" id="admin-face-panel" aria-labelledby="admin-face-title">
    <h3 id="admin-face-title">Official face enrollment</h3>
    <p class="field-help">Capture ${esc(user.name)}'s face with this camera. It becomes their verification reference. Ask them to face the camera in good light, remove glasses or a mask, and hold still for about 20 seconds.</p>
    <div class="face-video-frame" data-camera-state="idle" data-capturing="false">
      <video id="admin-face-video" class="face-video" autoplay playsinline muted aria-hidden="true"></video>
      <div class="face-camera-state">
        <span class="face-camera-icon" aria-hidden="true">${icon("cameraOff", "face-camera-icon-svg")}</span>
        <strong class="face-camera-title">Camera is off</strong>
        <span class="face-camera-detail">Start the capture, then ask ${esc(user.name)} to look straight at the camera.</span>
        <span class="face-camera-note">The preview stays on this device.</span>
      </div>
      <div class="face-guide" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <span class="face-live" aria-hidden="true"><span class="face-live-dot"></span>Live</span>
      <div class="face-hud" aria-hidden="true">
        <div class="face-hud-progress"><span></span><span></span><span></span><span></span></div>
        <span class="face-hud-chip">Centre the face</span>
        <p class="face-hud-instruction">Look straight at the camera.</p>
      </div>
      <span class="face-capture-ring" aria-hidden="true"></span>
      <button class="face-hud-cancel" type="button" data-action="admin-face-cancel" hidden>Cancel</button>
    </div>
    <p class="admin-face-stage" id="admin-face-stage" role="status" aria-live="polite">Ready to capture.</p>
    <div class="admin-face-actions">
      <button class="button secondary" type="button" data-face-start data-idle-label="Capture official face" data-busy-label="Capturing…" data-action="admin-face-enroll" data-id="${esc(user.id)}">Capture official face</button>
      <button class="button danger small" type="button" data-action="clear-face" data-id="${esc(user.email)}" title="Remove this official's enrolled face reference; they will need to enroll again">Clear face reference</button>
    </div>
  </section>`;
}

export function administratorProfilePage() {
  const body = `
    <div class="content-stack profile-main-stack admin-profile-cards admin-profile-layout">
      ${profileSummaryCard("administrator")}
      <section class="panel">
        <header class="panel-head"><div><h2>Profile Information</h2><p class="field-help">Keep your administrator contact details up to date.</p></div><button class="button small" type="submit" form="profile-form">Save Changes</button></header>
        <div class="panel-body"><form id="profile-form" class="form-grid admin-profile-form">
          ${inputField("Full name", "name", currentUser.name, { id: "profile-name", required: true, autocomplete: "name" })}
          ${inputField("Contact number", "phone", currentUser.phone || "", { id: "profile-phone", type: "tel", autocomplete: "tel" })}
          ${inputField("Purok", "area", currentUser.area || "Palsara", { id: "profile-area", readonly: true })}
          ${inputField("Sign-in email", "email", currentUser.email, { id: "profile-sign-in-email", readonly: true, autocomplete: "email" })}
          <input type="file" id="profile-photo" accept="image/jpeg,image/png" class="visually-hidden">
          <label class="profile-photo-control" for="profile-photo">${userAvatar(currentUser, "large")}<span class="field-help">Click your photo to change it. JPG or PNG, up to 5 MB.</span></label>
        </form></div>
      </section>
      <div class="grid-equal admin-account-security">
        <details class="panel profile-collapsible-panel">
          <summary class="panel-head"><div><h2>Email Change</h2></div></summary>
          <div class="panel-body"><form id="change-email-form" class="form-stack">
            ${inputField("New email address", "email", "", { id: "change-email-address", required: true, type: "email", autocomplete: "email" })}
            ${passwordInput("Current password", "currentPassword", "profile-email-current-password", "current-password")}
            <p class="field-help">Confirm the verification link sent to the new address.</p>
            <div class="form-actions"><button class="button secondary" type="submit">Send Verification Link</button></div>
          </form></div>
        </details>
        <details class="panel profile-collapsible-panel">
          <summary class="panel-head"><h2>Password Management</h2></summary>
          <div class="panel-body"><form id="password-form" class="form-stack">
            ${passwordInput("Current password", "currentPassword", "profile-current-password", "current-password")}
            ${passwordInput("New password", "newPassword", "profile-new-password", "new-password", 8)}
            ${passwordInput("Confirm new password", "confirmPassword", "profile-confirm-password", "new-password", 8)}
            <div class="form-actions"><button class="button" type="submit">Update Password</button></div>
          </form></div>
        </details>
      </div>
    </div>`;
  return page("administrator", "profile", body);
}

export function userRowsMarkup(users) {
  if (!users.length) return `<div class="empty-state"><strong>No accounts match</strong>Try another name, email, role, or status.</div>`;
  return `<div class="records" data-page-size="10" role="table" aria-label="User accounts"><div class="record-row record-head user-record-head" role="row"><span role="columnheader">Account</span><span role="columnheader">Role</span><span role="columnheader">Area</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>${users
    .map(
      (
        user,
      ) => `<div class="record-row user-record filter-item" role="row" data-account-status="${esc(user.status)}" data-search="${esc(`${user.name} ${user.email} ${ROLES[user.role]} ${user.area} ${user.status}`.toLowerCase())}">
    <div class="identity" role="cell">${userAvatar(user)}<span><strong class="record-primary">${esc(user.name)}</strong><span class="record-secondary">${esc(user.email)}</span>${user.resetRequested ? `<span class="record-secondary" style="color:var(--warning,#b45309)">Reset requested</span>` : ""}</span></div>
    <div class="record-meta" role="cell" data-label="Role">${esc(ROLES[user.role] || user.role)}</div>
    <div class="record-meta" role="cell" data-label="Area">${esc(user.area || "—")}</div>
    <div role="cell" data-label="Status">${statusPill(user.status || "Active")}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-user" data-id="${esc(user.email)}">Edit</button></div>
  </div>`,
    )
    .join("")}</div>`;
}

const ID_SIGNAL_TONES = { pass: "ok", warn: "review", fail: "fail", unknown: "muted" };
const ID_SIGNAL_SHORT_LABELS = { "ID type": "Type", "ID number": "No.", "Full name": "Name", "Birth date": "Date" };
const ID_SIGNAL_SHORT_REASONS = {
  idType: "Type differs",
  idNumber: "No. differs",
  idFullName: "Name differs",
  idBirthDate: "Date differs",
};

function readIdScan(item) {
  let scan = item.idScanChecks;
  if (typeof scan === "string") {
    try {
      scan = JSON.parse(scan);
    } catch {
      scan = {};
    }
  }
  return scan || {};
}

function shortSignal(signal) {
  if (signal.id === "duplicate") return "Duplicate no.";
  if (String(signal.id || "").startsWith("match_")) {
    const field = String(signal.id).slice("match_".length);
    return ID_SIGNAL_SHORT_REASONS[field] || "Details differ";
  }
  if (String(signal.id || "").startsWith("format_")) return "Format issue";
  const label = ID_SIGNAL_SHORT_LABELS[signal.label] || signal.label;
  if (signal.tone === "pass") return `${label} Pass`;
  if (signal.tone === "unknown") return `${label} Not read`;
  return `${label} Check`;
}

// Compact chips for the ID review dialog, with a short one-line reason for each
// failed check — no verbose OCR text and no hover tooltips.
function idCheckChips(item, withMismatch = false) {
  const scan = readIdScan(item);
  const signals = (Array.isArray(scan.signals) ? scan.signals : []).filter((signal) => signal.tone !== "unknown");
  if (!signals.length) return "";
  const chips = signals
    .map(
      (signal) =>
        `<span class="id-check-chip ${ID_SIGNAL_TONES[signal.tone] || "muted"}" title="${esc(signal.detail || shortSignal(signal))}">${esc(shortSignal(signal))}</span>`,
    )
    .join("");
  let mismatches = "";
  if (withMismatch) {
    const lines = signals
      .filter((signal) => signal.tone === "warn" || signal.tone === "fail")
      .map((signal) => {
        const text = shortSignal(signal);
        const short = text.length > 52 ? `${text.slice(0, 49)}…` : text;
        return `<span class="id-check-mismatch" title="${esc(signal.detail || text)}">${esc(short)}</span>`;
      });
    if (lines.length) mismatches = `<div class="id-check-mismatches">${lines.join("")}</div>`;
  }
  return `<div class="id-check-chips">${chips}</div>${mismatches}`;
}

export function idImageModalBody(item) {
  const id = encodeURIComponent(item.userId);
  const name = esc(item.name || "this resident");
  const facts = [
    ["Resident", item.name],
    ["Email", item.email],
    ["ID type", (item.idType && ID_TYPE_LABELS[item.idType]) || item.idType],
    ["ID number", item.idNumber],
    ["Name on ID", item.idFullName],
    ["Birth date", item.idBirthDate],
    ["Address", item.idAddress],
    ["Expires", item.idExpirationDate],
    ["Face check", item.idFaceStatus],
    ["Submitted", dateLabel(item.idSubmittedAt)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join("");
  return `<div class="id-image-layout">
    <div class="id-image-figures">
      <figure><img src="/api/verification/id/${id}/image" alt="Front of ${name}'s ID"><figcaption>Front of ID</figcaption></figure>
      ${item.hasIdBackImage ? `<figure><img src="/api/verification/id/${id}/image-back" alt="Back of ${name}'s ID"><figcaption>Back of ID</figcaption></figure>` : ""}
    </div>
    <dl class="id-image-details">${facts}</dl>
    ${idCheckChips(item, true)}
    <div class="form-actions id-image-actions">
      <button class="button danger" type="button" data-action="reject-id" data-id="${esc(item.userId)}">Reject ID</button>
      <button class="button" type="button" data-action="approve-id" data-id="${esc(item.userId)}" data-email="${esc(item.email)}">Approve ID</button>
    </div>
  </div>`;
}

export function verificationsPage() {
  const queue = (data.verificationQueue || []).slice();
  const rows = queue
    .map(
      (
        item,
      ) => `<div class="record-row filter-item verification-record" role="row" data-search="${esc(`${item.name} ${item.email} ${item.idNumber}`.toLowerCase())}">
        <div class="identity" role="cell">${userAvatar({ name: item.name, photoUrl: "" })}<span><strong class="record-primary">${esc(item.name)}</strong><span class="record-secondary">${esc(item.role === "official" ? "Official" : "Resident")} · ${esc(item.email)} · ${esc(item.area || "—")}</span></span></div>
        <div class="record-meta" role="cell" data-label="ID type">${esc((item.idType && ID_TYPE_LABELS[item.idType]) || item.idType || "—")}</div>
        <div class="record-meta" role="cell" data-label="ID number"><code>${esc(item.idNumber || "—")}</code>${item.idBirthDate ? `<br><span class="record-secondary">Born ${esc(item.idBirthDate)}</span>` : ""}</div>
        <div class="record-date" role="cell" data-label="Submitted">${esc(dateLabel(item.idSubmittedAt) || "—")}</div>
        <div class="record-actions" role="cell" data-label="Action"><div class="approval-actions"><button class="button secondary small" type="button" data-action="view-id-image" data-id="${esc(item.userId)}" data-email="${esc(item.email)}">View ID</button></div></div>
      </div>`,
    )
    .join("");
  const empty = `<div class="empty-state"><strong>Nothing to review</strong>Residents and officials who submit an ID will appear here.</div>`;
  const body = `<div class="content-stack">
    ${statsStrip([stat("Pending Reviews", queue.length, "Waiting for your decision", "blue", "clock")])}
    ${panel("ID reviews", `<div class="records verification-records" role="table" aria-label="ID reviews"><div class="record-row record-head" role="row"><span role="columnheader">User</span><span role="columnheader">ID type</span><span role="columnheader">ID number</span><span role="columnheader">Submitted</span><span role="columnheader">Action</span></div>${rows || empty}</div>`, { subtitle: "Review the image, check the number, then approve or reject. Self-reported until approved.", icon: "check" })}
  </div>`;
  return page("administrator", "verifications", body);
}

export function usersPage() {
  const users = (data.users || []).filter((user) => user.role !== "administrator");
  const countFor = (role) => users.filter((user) => user.role === role).length;
  const inactive = users.filter((user) => user.status === "Inactive").length;
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat("Total Accounts", users.length, "Residents and officials", "blue", "users"),
        stat("Residents", countFor("resident"), "Resident accounts", "success", "user"),
        stat("Barangay Officials", countFor("official"), "Official accounts", "violet", "shield"),
        stat("Inactive", inactive, "Deactivated accounts", "warning", "alert"),
      ])}
      ${panel(
        "Accounts",
        `<div class="toolbar user-toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search by name or email</span><input class="input" type="search" data-search-input autocomplete="off"></label><select class="select" data-user-role-filter aria-label="Filter accounts by role"><option value="all">All roles</option>${Object.entries(
          ROLES,
        )
          .map(([role, label]) => `<option value="${esc(role)}">${esc(label)}</option>`)
          .join(
            "",
          )}</select><select class="select" data-user-status-filter aria-label="Filter accounts by status"><option value="all">All statuses</option><option>Active</option><option>Inactive</option></select></div><div class="mt-16" data-user-table>${userRowsMarkup([...users].sort((a, b) => a.name.localeCompare(b.name)))}</div>`,
        {
          subtitle: "Manage accounts without changing role capabilities.",
          action: actionButton(`${icon("plus")} Add user`, "add-user", "small"),
        },
      )}
    </div>`;
  return page("administrator", "users", body);
}

export function rolesPage() {
  const officials = (data.users || []).filter((user) => user.role === "official");
  const selected = officials.find((user) => user.email === selectedPermissionAccount) || officials[0] || null;
  const effective = selected ? effectivePermissions(selected, data) : {};
  const overrides = (selected && data.accountOverrides?.[selected.email]) || {};
  const permissions = PERMISSION_DEFS.filter(({ id }) => ADMIN_ROLE_PERMISSION_IDS.includes(id));
  const accountOptions = officials
    .map(
      (user) =>
        `<option value="${esc(user.email)}"${user.email === selected?.email ? " selected" : ""}>${esc(user.name)} · ${esc(user.email)}</option>`,
    )
    .join("");
  const accountPicker = officials.length
    ? `<div class="form-field role-select-field"><label for="permission-role">Barangay official</label><select class="select" id="permission-role" aria-label="Barangay official account">${accountOptions}</select></div>`
    : `<div class="empty-state"><strong>No Barangay official accounts</strong>Create an official account to assign its permissions.</div>`;
  const permissionRows = selected
    ? permissions
        .map((permission) => {
          const enabled = Boolean(effective[permission.id]);
          const custom = Object.hasOwn(overrides, permission.id);
          const controls = `${custom ? `<span class="permission-effective-state">Custom</span><button class="button secondary small" type="button" data-action="reset-account-permission" data-email="${esc(selected.email)}" data-permission="${esc(permission.id)}">Reset to default</button>` : ""}<button class="switch" type="button" role="switch" aria-checked="${enabled}" aria-label="${esc(`${selected.name} · ${permission.label}`)}" data-action="toggle-account-permission" data-email="${esc(selected.email)}" data-permission="${esc(permission.id)}"></button>`;
          return `<div class="permission-row"><span class="permission-copy"><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span><span class="permission-account-controls">${controls}</span></div>`;
        })
        .join("")
    : `<div class="empty-state"><strong>No official selected</strong>Choose a Barangay official account to edit its permissions.</div>`;
  const body = `
    <div class="content-stack">
      ${panel("Official Accounts", accountPicker, { subtitle: "Choose the official whose permissions you want to change." })}
      ${panel("Permissions", `<div class="permission-list role-permission-list">${permissionRows}</div>`, { subtitle: "Changes save immediately for the selected official." })}
    </div>`;
  return page("administrator", "roles", body);
}

// Capture expanded per-official override panels before a rebuild so the live
// update refresh does not collapse the panel the administrator is reading.
export function rememberOpenPermissionAccounts() {
  for (const email of Object.keys(permissionOpenAccounts)) delete permissionOpenAccounts[email];
  for (const account of app.querySelectorAll("details.permission-account[open]")) {
    if (account.dataset.email) permissionOpenAccounts[account.dataset.email] = true;
  }
}

export function confirmLeaveWithUnsavedPermissions() {
  return (
    !hasUnsavedPermissionChanges() ||
    window.confirm("You have unsaved role permission changes. Leave without saving? Your changes will be discarded.")
  );
}

export function activityResultsMarkup() {
  const rows = activityLogState.activities || [];
  const total = Number(activityLogState.total || 0);
  const pageCount = Math.max(1, Number(activityLogState.pageCount || 1));
  const page = Math.min(Math.max(1, Number(activityLogState.page || 1)), pageCount);
  return `
    <div class="activity-results-heading"><h2>Activity records</h2><span>${total} ${total === 1 ? "entry" : "entries"}</span></div>
    <div class="records activity-records" role="table" aria-label="Activity log">
      <div class="record-row record-head activity-record-head" role="row"><span role="columnheader">Person</span><span role="columnheader">Action</span><span role="columnheader">Activity</span><span role="columnheader">Date &amp; Time</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>
      ${
        rows
          .map(
            (item) => `<div class="record-row activity-record" role="row">
        <div class="activity-person" role="cell"><span class="avatar activity-avatar" aria-hidden="true">${esc(initials(item.actor))}</span><span><strong>${esc(item.actor)}</strong><small>${esc(roleLabel(item.role))}</small></span></div>
        <div role="cell"><span class="activity-action-badge" data-action-kind="${esc(item.action)}">${esc(item.action)}</span></div>
        <div class="record-meta" role="cell" data-label="Activity">${esc(displayReferenceText(item.detail || item.action))}</div>
        <div class="record-date" role="cell" data-label="Date and time">${esc(dateTimeLabel(item.at))}</div>
        <div role="cell" data-label="Status"><span class="activity-result" data-result="${esc(item.result || "Info")}">${esc(item.result || "Info")}</span></div>
        <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="view-activity" data-id="${esc(item.id)}">Details</button></div>
      </div>`,
          )
          .join("") ||
        `<div class="activity-empty"><div class="empty-state"><strong>No activity matches these filters</strong>Change or clear the filters to see more records.</div></div>`
      }
    </div>
    ${pageCount > 1 ? `<nav class="pagination" aria-label="Activity log pages"><button class="button secondary small" type="button" data-action="activity-page" data-direction="-1" ${page <= 1 ? "disabled" : ""}>Previous</button><span class="pagination-status" aria-live="polite">Page ${page} of ${pageCount} · ${total} records</span><button class="button secondary small" type="button" data-action="activity-page" data-direction="1" ${page >= pageCount ? "disabled" : ""}>Next</button></nav>` : ""}`;
}

export function activityLogPage() {
  const roles = [
    ["", "All roles"],
    ["administrator", "Administrator"],
    ["resident", "Resident"],
    ["official", "Barangay official"],
  ];
  const body = `
    <div class="content-stack">
      ${panel(
        "Activity Log",
        `<form id="activity-filter-form" class="activity-filter-form">
        <div class="form-field"><label for="activity-from">From date</label><input class="input" id="activity-from" name="from" type="date" value="${esc(activityFilters.from)}"></div>
        <div class="form-field"><label for="activity-to">To date</label><input class="input" id="activity-to" name="to" type="date" value="${esc(activityFilters.to)}"></div>
        <div class="form-field"><label for="activity-role">Role</label><select class="select" id="activity-role" name="role">${roles.map(([value, label]) => `<option value="${value}"${activityFilters.role === value ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></div>
        <div class="form-actions activity-filter-actions"><button class="button" type="submit">Apply Filters</button><button class="button secondary" type="button" data-action="clear-activity-filters">Clear</button><button class="button secondary" type="button" data-action="export-activity-log">${icon("download")} Export CSV</button></div>
      </form>
      <div id="activity-results">${activityResultsMarkup()}</div>`,
        { subtitle: "Every retained action and security event" },
      )}
    </div>`;
  return page("administrator", "activity", body);
}
