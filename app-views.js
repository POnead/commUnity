"use strict";

function displayReportId(id) {
  const value = String(id || "");
  const timestampId = value.match(/^R(\d{13})(?:-([a-z0-9]{6}))?$/i);
  if (timestampId) {
    const suffix = timestampId[2] ? `-${timestampId[2].toUpperCase()}` : "";
    return `R-${Number(timestampId[1]).toString(36).toUpperCase()}${suffix}`;
  }
  const match = value.match(/^R(?:PT-\d{4}-)?(\d+)$/i);
  return match ? `R${String(Number(match[1])).padStart(2, "0")}` : String(id || "");
}

function navGroups(role) {
  const openConcernCount = data.reports.filter((report) => report.status !== "Resolved").length;
  const pendingApprovalCount =
    (data.calendarEvents || []).filter((event) => event.approvalStatus === "pending").length +
    (data.announcements || []).filter((item) => item.approvalStatus === "pending").length;
  const groups = role === "resident" ? [
    { title: "Community", links: [["dashboard", "Overview", "home"], ["calendar", "Calendar", "calendar"], ["collection", "Garbage collection", "calendar"], ["report", "Report a concern", "flag"]] },
    { title: "Your activity", links: [["reports", "My reports", "clipboard"], ["history", "Report history", "clock"], ["notifications", "Notifications", "bell", unreadCount()]] },
    { title: "Account", links: [["profile", "Profile", "user"]] },
  ] : role === "official" ? [
    { title: "Community", links: [["dashboard", "Overview", "home"], ["calendar", "Calendar", "calendar"], ["concerns", "Concern queue", "clipboard", openConcernCount, "open concerns"]] },
    { title: "Services", links: [["collection", "Garbage collection", "calendar"], ["history", "Report history", "clock"], ["announcements", "Announcements", "activity"], ["notifications", "Notifications", "bell", unreadCount()]] },
    { title: "Account", links: [["profile", "Profile", "user"]] },
  ] : [
    { title: "Community", links: [["dashboard", "Overview", "home"], ["calendar", "Calendar", "calendar"], ["reports", "Community reports", "clipboard"], ["approvals", "Approval queue", "check", pendingApprovalCount, "pending requests"]] },
    { title: "Updates and account", links: [["notifications", "Notifications", "bell", unreadCount()], ["settings", "Settings", "settings"], ["activity", "Activity Log", "activity"]] },
  ];
  return groups.map((group) => ({ ...group, links: group.links.filter(([key]) => canOpenPage({ role, email: currentUser?.email }, key)) }));
}
function requiredPermission(role, pageName) {
  const map = {
    resident: { collection: "viewSchedules", report: "submitReports", reports: "submitReports", history: "submitReports" },
    official: { concerns: "manageReports", history: "manageReports", collection: "manageSchedules", announcements: "manageAnnouncements" },
    administrator: { reports: "manageReports", analytics: "manageReports", users: "manageUsers", locations: "manageUsers", announcements: "manageAnnouncements", roles: "manageRoles", activity: "viewAudit" },
  };
  return map[role]?.[pageName] || "";
}

function officialReportFilters(reports, activeFilter) {
  const options = [["all", "All open"], ["Submitted", "Submitted"], ["Under Review", "Under review"], ["In Progress", "In progress"]];
  return `<div class="filter-row" role="group" aria-label="Filter concerns">${options.map(([value, label]) => {
    const count = value === "all"
      ? reports.filter((report) => report.status !== "Resolved").length
      : reports.filter((report) => report.status === value).length;
    return `<button type="button" class="filter-button ${activeFilter === value ? "selected" : ""}" data-action="filter-reports" data-value="${esc(value)}" aria-pressed="${activeFilter === value}">${esc(label)} <span class="filter-count">${count}</span></button>`;
  }).join("")}</div>`;
}

function canOpenPage(user, pageName) {
  const permission = requiredPermission(user?.role, pageName);
  const override = user?.email ? data.accountOverrides?.[user.email] : null;
  const allowed = override && permission ? Boolean(override[permission]) : Boolean(data.permissions?.[user?.role]?.[permission]);
  return !permission || allowed;
}

function userAvatar(user, extra = "") {
  const name = user?.name || "";
  if (user?.photoUrl) {
    return `<span class="avatar ${extra}"><img src="${esc(user.photoUrl)}" alt="Profile photo of ${esc(name)}"></span>`;
  }
  return `<span class="avatar ${extra}" aria-hidden="true">${esc(initials(name))}</span>`;
}

function checkDataConsistency() {
  const counts = STATUSES.map((status) => data.reports.filter((report) => report.status === status).length);
  console.assert(counts.reduce((sum, count) => sum + count, 0) === data.reports.length, "Every community report must have one valid status.");
  console.assert(new Set(data.reports.map((report) => report.id)).size === data.reports.length, "Report IDs must be unique.");
  console.assert(new Set(data.schedules.map((schedule) => schedule.id)).size === data.schedules.length, "Schedule IDs must be unique.");
  console.assert(
    data.reports.every((report) => report.userEmail && report.history.at(-1)?.status === report.status),
    "Each report should belong to an account and end with its current status.",
  );
}

function navMarkup(role, page) {
  return navGroups(role).filter((group) => group.links.length).map((group) => `
    <div class="nav-group">
      <p class="nav-group-label">${esc(group.title)}</p>
      <nav class="nav-list" aria-label="${esc(group.title)}">
        ${group.links.map(([key, label, iconName, count, countLabel = "unread"]) => `
          <a class="nav-link ${key === page ? "active" : ""}" href="${routeUrl(role, key)}" ${key === page ? 'aria-current="page"' : ""} ${count ? `aria-label="${esc(`${label}, ${count} ${countLabel}`)}"` : ""}>
            ${icon(iconName)}<span>${esc(label)}</span>${count ? `<span class="nav-count" aria-hidden="true">${count}</span>` : ""}
          </a>`).join("")}
      </nav>
    </div>`).join("");
}

function pageTitle(role, page) {
  const titles = {
    resident: {
      dashboard: ["Your community today", "Service updates and a clear view of your reports."],
      collection: ["Garbage collection", "Check your area's collection schedule and service updates."],
      report: ["Report a concern", "Share what happened and where."],
      reports: ["My reports", "Follow the progress of concerns you have submitted."],
      history: ["Report history", "Review previous concerns and the actions recorded."],
      notifications: ["Notifications", "Updates for your reports and barangay services."],
      calendar: ["Calendar", "Announcements and collection schedules in one place."],
      profile: ["Your profile", "Keep your contact and area details up to date."],
    },
    official: {
      dashboard: ["Barangay overview", "The latest concerns and collection activity across the community."],
      calendar: ["Calendar", "Announcements and collection schedules in one place."],
      concerns: ["Concern queue", "Review resident reports and record the next step."],
      collection: ["Collection management", "Maintain schedules and post service-status changes."],
      history: ["Report history", "Review concern updates recorded by the barangay."],
      notifications: ["Notifications", "New concerns and service updates for your team."],
      announcements: ["Announcements", "Publish service notices for residents and staff."],
      profile: ["Your profile", "Keep your official account details up to date."],
    },
    administrator: {
      dashboard: ["System overview", "A concise view of accounts and recent activity."],
      calendar: ["Calendar", "Announcements and collection schedules in one place."],
      reports: ["Community reports", "Monitor concerns submitted by residents across the barangay."],
      approvals: ["Approval queue", "Review and decide on event and announcement requests from barangay officials."],
      analytics: ["Analytics", "Review report activity, user activity, and service trends."],
      users: ["User management", "Review accounts and adjust access."],
      locations: ["Locations and recycling", "Manage resident areas and nearby recycling or junkshop listings."],
      announcements: ["Announcements", "Publish service notices for residents and staff."],
      activity: ["Activity Log", "A record of account and service activity."],
      roles: ["Role management", "Review the permissions shown in each workspace."],
      profile: ["Your profile", "Keep your administrator account details up to date."],
      settings: ["Settings", "Manage administrator workspace areas from one place."],
      email: ["Email", "Configure SMTP email for report and collection notifications."],
      notifications: ["Notifications", "Report and service updates for this account."],
    },
  };
  return titles[role]?.[page] || ["CommUnity", "Barangay services and community updates."];
}

function shell(role, page, title, description, body, actions = "") {
  const roleLabel = ROLES[role];
  const date = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  const account = `<div class="user-chip">${userAvatar(currentUser)}<div class="user-chip-copy"><strong>${esc(currentUser.name)}</strong><span>${esc(roleLabel)}</span></div></div>`;
  return `
    <div class="workspace">
      <header class="topbar">
        <div class="topbar-leading">
          <button class="icon-button mobile-menu-button" type="button" data-action="toggle-menu" aria-label="Open navigation" aria-expanded="false" aria-controls="mobile-navigation">${icon("menu")}</button>
          <div class="crumb"><span>CommUnity</span><span class="crumb-separator" aria-hidden="true">/</span><strong>${esc(roleLabel)}</strong></div>
        </div>
        <div class="topbar-actions">
          <span class="topbar-date">${esc(date)}</span>
          <button class="icon-button" type="button" data-action="logout" aria-label="Sign out">${icon("logout")}</button>
        </div>
      </header>
      <div class="workspace-layout">
        <aside class="sidebar" aria-label="Main navigation">
          <a class="brand-lockup" href="${routeUrl(role, "dashboard")}">
            ${brandMark()}
            <span><span class="brand-name">CommUnity</span><span class="brand-caption">Palsara community desk</span></span>
          </a>
          <div class="sidebar-place">${icon("pin")}<span>${role === "resident" ? esc(currentUser.area || "Palsara") : "Palsara"}</span></div>
          ${navMarkup(role, page)}
          <div class="sidebar-bottom">
            ${account}
          </div>
        </aside>
        <main class="workspace-main" id="main-content" tabindex="-1">
          <header class="page-heading">
            <div class="page-title-block"><h1>${esc(title)}</h1></div>
            ${actions ? `<div class="page-heading-actions">${actions}</div>` : ""}
          </header>
          ${body}
        </main>
      </div>
      <div class="mobile-drawer-backdrop" id="mobile-navigation" hidden>
        <aside class="mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
          <div class="mobile-drawer-header">
            <a class="brand-lockup" href="${routeUrl(role, "dashboard")}">${brandMark()}<span><span class="brand-name">CommUnity</span><span class="brand-caption">Palsara community desk</span></span></a>
            <button class="icon-button" type="button" data-action="close-menu" aria-label="Close navigation">${icon("close")}</button>
          </div>
          <div class="sidebar-place">${icon("pin")}<span>${role === "resident" ? esc(currentUser.area || "Palsara") : "Palsara"}</span></div>
          ${navMarkup(role, page)}
          <div class="sidebar-bottom">${account}<button class="button secondary" type="button" data-action="logout">${icon("logout")} Sign out</button></div>
        </aside>
      </div>
      ${modalState ? modalMarkup() : ""}
    </div>`;
}

function page(role, view, body, actions = "") {
  const [title, description] = pageTitle(role, view);
  return shell(role, view, title, description, body, actions);
}

function stat(label, value, note = "", tone = "") {
  return `<div class="stat" ${tone ? `data-tone="${esc(tone)}"` : ""}><span class="stat-label">${esc(label)}</span><strong class="stat-value">${esc(value)}</strong>${note ? `<span class="stat-note">${esc(note)}</span>` : ""}</div>`;
}

function statsStrip(items) {
  return `<section class="stats-strip" aria-label="Summary">${items.join("")}</section>`;
}

function panel(title, body, options = {}) {
  const header = title ? `<header class="panel-head"><div><h2>${esc(title)}</h2></div>${options.action || ""}</header>` : "";
  return `<section class="panel ${options.className || ""}">${header}<div class="panel-body">${body}</div></section>`;
}

function reportRows(reports, role) {
  if (!reports.length) return `<div class="empty-state"><strong>No concerns in this view</strong>When a report is submitted, it will appear here.</div>`;
  const headers = role === "resident"
    ? ["Concern", "Priority", "Affected area", "Date submitted", "Status", "Action"]
    : ["Concern", "Resident", "Priority", "Affected area", "Status", "Action"];
  const cells = reports.map((report) => {
    const priority = report.priority || "Medium";
    const first = `<div role="cell"><button class="text-button record-primary" type="button" data-action="view-report" data-id="${esc(report.id)}">${esc(report.title)}</button><span class="record-secondary">${esc(displayReportId(report.id))}</span>${role === "official" ? `<span class="record-secondary">Assigned to ${esc(report.assignedTo?.name || "no one")}</span>` : ""}</div>`;
    const second = role === "resident"
      ? `<div class="record-meta" role="cell" data-label="Affected area">${esc(report.area)}</div>`
      : `<div class="record-meta" role="cell" data-label="Resident">${esc(report.name)}</div>`;
    const third = role === "resident"
      ? `<div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(report.submittedAt))}</div>`
      : `<div class="record-meta" role="cell" data-label="Area">${esc(report.area)}<span class="record-secondary">${esc(dateLabel(report.submittedAt))}</span></div>`;
    const priorityCell = `<div class="record-meta" role="cell" data-label="Priority"><span class="status" data-status="${esc(normalizeStatus(priority))}">${esc(priority)}</span></div>`;
    const statusCell = `<div role="cell" data-label="Status">${statusPill(report.status)}</div>`;
    const actionsCell = `<div class="record-actions" role="cell" data-label="">${role === "official" ? reportAssignmentAction(report) : ""}<button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>`;
    const ordered = role === "resident" ? `${priorityCell}${second}${third}` : `${second}${priorityCell}${third}`;
    return `<div class="record-row filter-item" role="row" data-search="${esc(`${report.id} ${report.title} ${report.category} ${report.name} ${report.barangay || ""} ${report.area} ${report.locationDetail || ""} ${report.status} ${priority}`.toLowerCase())}">
      ${first}${ordered}${statusCell}${actionsCell}
    </div>`;
  }).join("");
  return `<div class="records" data-page-size="10" role="table" aria-label="Community concerns"><div class="record-row record-head" role="row">${headers.map((header) => `<span role="columnheader">${esc(header)}</span>`).join("")}</div>${cells}</div>`;
}

function reportAssignmentAction(report) {
  if (report.assignedTo?.id === currentUser.id) {
    return `<button class="button secondary small" type="button" data-action="release-report" data-id="${esc(report.id)}">Release</button>`;
  }
  if (!report.assignedTo) {
    return `<button class="button secondary small" type="button" data-action="claim-report" data-id="${esc(report.id)}">Claim</button>`;
  }
  return "";
}

function reportHistoryRows(reports) {
  const updates = reports.flatMap((report) => report.history.map((item) => ({ report, item })))
    .sort((a, b) => asDate(b.item.at) - asDate(a.item.at));
  if (!updates.length) return `<div class="empty-state"><strong>No report updates yet</strong>Status changes will appear here.</div>`;
  const rows = updates.map(({ report, item }) => `<div class="record-row filter-item" role="row" data-search="${esc(`${report.id} ${report.title} ${report.name} ${report.category} ${item.status} ${item.note}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(report.title)}</strong><span class="record-secondary">${esc(displayReportId(report.id))}</span></div>
    <div class="record-meta" role="cell" data-label="Resident">${esc(report.name)}</div>
    <div role="cell" data-label="Update">${statusPill(item.status)}<span class="record-secondary">${esc(item.note)}</span>${item.actorName ? `<span class="record-secondary">By ${esc(item.actorName)}</span>` : ""}</div>
    <div class="record-date" role="cell" data-label="Date and time">${esc(dateTimeLabel(item.at))}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View report</button></div>
  </div>`).join("");
  return `<div class="records" data-page-size="10" role="table" aria-label="Report activity"><div class="record-row record-head" role="row"><span role="columnheader">Concern</span><span role="columnheader">Resident</span><span role="columnheader">Update</span><span role="columnheader">Date and time</span><span role="columnheader">Action</span></div>${rows}</div>`;
}

function reportFilters(reports, activeFilter) {
  const options = [["all", "All reports"], ["Submitted", "Submitted"], ["Under Review", "Under review"], ["In Progress", "In progress"], ["Resolved", "Resolved"]];
  return `<div class="filter-row" role="group" aria-label="Filter reports">${options.map(([value, label]) => {
    const count = value === "all" ? reports.length : reports.filter((report) => report.status === value).length;
    return `<button type="button" class="filter-button ${activeFilter === value ? "selected" : ""}" data-action="filter-reports" data-value="${esc(value)}" aria-pressed="${activeFilter === value}">${esc(label)} <span class="filter-count">${count}</span></button>`;
  }).join("")}</div>`;
}

function searchToolbar(label = "Search concerns by report ID, resident or description") {
  return `<div class="toolbar mt-16"><label class="search-field">${icon("search")}<span class="visually-hidden">${esc(label)}</span><input class="input" type="search" data-search-input autocomplete="off"></label></div>`;
}

function timelineMarkup(history) {
  return `<ol class="timeline">${history.map((item, index) => `
    <li class="timeline-item ${index === 0 ? "" : "future"}"><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-copy"><strong>${esc(item.status)}</strong><span>${esc(item.note)}${item.actorName ? ` · By ${esc(item.actorName)}` : ""} · ${esc(dateTimeLabel(item.at))}</span></div></li>`).join("")}</ol>`;
}

function reportDetail(report, role) {
  const isResident = role === "resident";
  const statusForm = role === "official" ? `
    <form class="form-stack" id="report-status-form">
      <input type="hidden" name="reportId" value="${esc(report.id)}">
      ${selectField("Update status", "status", STATUSES, report.status)}
      <div class="form-field"><label for="status-note">Update for the resident</label><textarea class="textarea" id="status-note" name="note" maxlength="400"></textarea></div>
      <div class="form-actions"><button class="button" type="submit">Save report update</button></div>
    </form>` : "";
  const photos = (report.photos || []).length
    ? `<div class="photo-preview">${report.photos.map((photo) => `<a class="photo-thumb" href="${esc(photo.photoUrl)}" target="_blank" rel="noopener" aria-label="Open report photo ${esc(photo.name)}"><img src="${esc(photo.photoUrl)}" alt="Photo attached to ${esc(report.id)}"></a>`).join("")}</div>`
    : `<p class="muted small">No photo was attached to this report.</p>`;
  const hasMapPin = Number.isFinite(report.latitude) && Number.isFinite(report.longitude);
  const reportLocation = role !== "administrator"
    ? panel("Exact map location", hasMapPin
      ? `<div id="report-detail-map" class="report-map-canvas report-detail-map" data-latitude="${report.latitude}" data-longitude="${report.longitude}" role="region" aria-label="Map centered on this concern's reported location"></div><p class="map-status" id="report-detail-map-status" role="status" aria-live="polite">Map pin at ${report.latitude.toFixed(6)}, ${report.longitude.toFixed(6)}.</p><a class="text-button map-directions-link" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${report.latitude},${report.longitude}`)}" target="_blank" rel="noopener noreferrer">Open directions in Google Maps</a>`
      : `<p class="muted small">${isResident ? "You did not add a map pin." : "The resident did not include a map pin."} Use the barangay, area, and street or landmark details above to locate this concern.</p>`)
    : "";
  const priority = report.priority || "Medium";
  const followUpLimit = FOLLOW_UP_LIMITS[priority] ?? FOLLOW_UP_LIMITS.Medium;
  const followUpCount = Number(report.followUpCount || 0);
  const followUpRemaining = followUpLimit === null ? null : Math.max(0, followUpLimit - followUpCount);
  const followUpsOpen = report.status !== "Resolved" && (followUpLimit === null || followUpRemaining > 0);
  const followUpNote = report.status === "Resolved"
    ? "This concern is resolved. Follow-ups are closed."
    : followUpLimit === null
      ? `${priority} priority · Unlimited follow-ups.`
      : `${priority} priority · ${followUpRemaining} of ${followUpLimit} follow-ups remaining.`;
  const followUpForm = isResident
    ? panel("Need to add context?", `<p class="muted small">${esc(followUpNote)}</p>${followUpsOpen ? `<form id="follow-up-form" class="form-stack"><input type="hidden" name="reportId" value="${esc(report.id)}"><div class="form-field"><label for="follow-up-message">Follow-up message</label><textarea class="textarea" id="follow-up-message" name="message" required maxlength="1000"></textarea></div><div class="form-actions"><button class="button secondary" type="submit">Follow Up</button></div></form>` : ""}`)
    : "";
  const priorityForm = role === "official" || role === "administrator"
    ? panel("Concern priority", `<form id="report-priority-form" class="form-stack"><input type="hidden" name="reportId" value="${esc(report.id)}"><p class="muted small">Residents choose this at submission; staff can adjust it here.</p>${selectField("Priority", "priority", REPORT_PRIORITIES, priority)}<div class="form-actions"><button class="button secondary" type="submit">Update priority</button></div></form>`)
    : "";
  const body = `
    <div class="content-stack">
      <div class="profile-layout">
        <div class="content-stack">
          <section class="panel"><div class="panel-body">
            <div class="inline-between"><div><h2 class="report-detail-title">${esc(report.title)}</h2><p class="record-secondary report-detail-id">${esc(displayReportId(report.id))} · ${esc(report.category)}</p></div>${statusPill(report.status)}</div>
            <p class="report-description">${esc(report.description)}</p>
            <div class="notice-bar"><span>Barangay</span><strong>${esc(report.barangay || "—")}</strong></div>
            <div class="notice-bar mt-16"><span>Purok or area</span><strong>${esc(report.area)}</strong></div>
            <div class="notice-bar mt-16"><span>Street or landmark</span><strong>${esc(report.locationDetail || "Not provided")}</strong></div>
            ${role === "administrator" && hasMapPin ? `<div class="notice-bar mt-16"><span>Exact map location</span><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${report.latitude},${report.longitude}`)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div>` : ""}
            <div class="inline-between mt-16"><span class="muted small">Submitted ${esc(dateTimeLabel(report.submittedAt))}</span><span class="muted small">Updated ${esc(dateTimeLabel(report.updatedAt))}</span></div>
          </div></section>
          ${reportLocation}
          ${panel("Attached photos", photos)}
          ${followUpForm}
          ${role === "official" ? panel("Record an update", statusForm) : ""}
        </div>
        <div class="content-stack">
          ${role !== "resident" ? `<section class="panel"><header class="panel-head"><div><h2>Reported by</h2></div></header><div class="panel-body"><div class="account-summary">${userAvatar({ name: report.name })}<div><strong>${esc(report.name)}</strong><span>${esc((getUser(report.userEmail)?.area || report.area) + " · Resident")}</span><span>${esc(report.userEmail)}</span></div></div></div></section>` : ""}
          ${role === "official" ? panel("Assignment", `<div class="inline-between"><span>${report.assignedTo ? `Assigned to ${esc(report.assignedTo.name)}` : "Unassigned"}</span>${reportAssignmentAction(report)}</div>`) : ""}
          <section class="panel"><header class="panel-head"><div><h2>Status history</h2></div></header><div class="panel-body">${timelineMarkup(report.history)}</div></section>
        </div>
      </div>
    </div>`;
  const listPage = role === "resident" ? "reports" : role === "administrator" ? "reports" : "concerns";
  const actions = `<button class="button secondary" type="button" data-action="back-list">Back to ${isResident ? "my reports" : "reports"}</button>`;
  return page(role, listPage, body, actions);
}

function upcomingSchedule(area = currentUser.area) {
  return sortedSchedules(data.schedules).find((schedule) =>
    (!area || schedule.area === area || currentUser.role !== "resident") &&
    schedule.date >= todayISO() &&
    !["Cancelled", "Completed"].includes(schedule.status),
  );
}

function scheduleRows(schedules, canEdit = false) {
  if (!schedules.length) return `<div class="empty-state"><strong>No collection schedules</strong>Schedules for this area will appear here when the barangay posts them.</div>`;
  return `<div class="records" data-page-size="10" role="table" aria-label="Collection schedule">
    <div class="record-row record-head schedule-record-head" role="row"><span role="columnheader">Area and service</span><span role="columnheader">Collection date</span><span role="columnheader">Collection window</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>
    ${schedules.map((schedule) => `<div class="record-row schedule-record filter-item" role="row" data-search="${esc(`${schedule.id} ${schedule.area} ${schedule.zone} ${schedule.wasteType} ${schedule.status}`.toLowerCase())}">
      <div role="cell"><strong class="record-primary">${esc(schedule.wasteType)}</strong><span class="record-secondary">${esc(schedule.area)} · ${esc(schedule.zone)}</span></div>
      <div class="record-date" role="cell" data-label="Collection date">${esc(dateLabel(schedule.date))}<span class="record-secondary">${esc(new Intl.DateTimeFormat("en-PH", { weekday: "long" }).format(asDate(schedule.date)))}</span></div>
      <div class="record-meta" role="cell" data-label="Collection window">${esc(schedule.start)} – ${esc(schedule.end)}<span class="record-secondary">${esc(schedule.team)}</span></div>
      <div role="cell" data-label="Status">${statusPill(schedule.status)}</div>
      <div class="record-actions" role="cell" data-label="">${canEdit ? `<button class="button secondary small" type="button" data-action="edit-schedule" data-id="${esc(schedule.id)}">Edit</button>` : `<span class="record-meta">${esc(schedule.frequency)}</span>`}</div>
    </div>`).join("")}</div>`;
}

function dashboardResident() {
  const reports = userReports();
  const next = upcomingSchedule(currentUser.area);
  const latest = sortedReports(reports)
    .sort((a, b) =>
      Number(["Submitted", "Under Review"].includes(b.status)) - Number(["Submitted", "Under Review"].includes(a.status)) ||
      asDate(b.updatedAt) - asDate(a.updatedAt)
    )
    .slice(0, 4);
  const actions = linkButton(`${icon("plus")} Report a concern`, routeUrl("resident", "report"), "");
  const body = `
    <div class="grid-main-side">
      <div class="content-stack">
        ${panel("Your latest reports", `<div class="quick-list">${latest.map((report) => `<div class="report-item"><span class="item-mark">${icon("clipboard")}</span><div class="item-copy"><strong class="truncate">${esc(report.title)}</strong><span>${esc(report.id)} · ${esc(dateLabel(report.updatedAt))}</span></div><div class="item-actions">${statusPill(report.status)}<button class="icon-button" type="button" data-action="view-report" data-id="${esc(report.id)}" aria-label="View ${esc(report.id)}">${icon("arrow")}</button></div></div>`).join("") || `<div class="empty-state"><strong>No reports yet</strong>When you share a concern, its updates will appear here.</div>`}</div><div class="form-actions">${linkButton("View all reports", routeUrl("resident", "reports"), "secondary", "small")}</div>`)}
        ${panel("Next collection", next ? `<div class="account-summary"><span class="item-mark">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.wasteType)} · ${esc(next.start)}–${esc(next.end)}</span><span>${esc(next.area)} · ${esc(next.zone)}</span></div></div><div class="status-line mt-16">${statusPill(next.status)}<span class="muted small">${esc(next.team)}</span></div><div class="form-actions">${linkButton("View collection schedule", routeUrl("resident", "collection"), "secondary", "small")}</div>` : `<div class="empty-state"><strong>No upcoming pickup posted</strong>Check back for a schedule update from your barangay.</div>`)}
        ${panel("Official working hours", `<ul class="plain-list">${communityOfficialHours.map((official) => `<li><span>${esc(official.name)}</span><strong>${esc(official.workingHours || "Monday-Friday, 8:00 AM-5:00 PM")}</strong></li>`).join("") || "<li><span>No hours posted</span></li>"}`, { subtitle: "Barangay service desk hours" })}
      </div>
      <div class="content-stack">
        ${panel("Announcements", `<ul class="plain-list">${data.announcements.map((item) => `<li><div><strong class="announcement-title">${esc(item.title)}</strong><div class="muted small">${esc(item.detail)}</div>${item.isEvent ? `<div class="announcement-event-meta">${announcementEventMarkup(item)}</div>` : ""}</div><span class="muted small">${esc(dateLabel(item.date, { month: "short", day: "numeric" }))}</span></li>`).join("")}</ul>`)}
      </div>
    </div>`;
  return page("resident", "dashboard", body, actions);
}

function canManageCalendarEvents() {
  const permission = "manageSchedules";
  const override = data.accountOverrides?.[currentUser?.email];
  const allowed = override && Object.hasOwn(override, permission)
    ? Boolean(override[permission])
    : Boolean(data.permissions?.[currentUser?.role]?.[permission]);
  return Boolean(allowed) && ["official", "administrator"].includes(currentUser?.role);
}

function calendarStatusLabel(status) {
  if (status === "pending") return "Pending approval";
  if (status === "declined") return "Declined";
  return "Approved";
}

function calendarPage() {
  const isResident = currentUser?.role === "resident";
  const canManage = canManageCalendarEvents();
  const isAdmin = currentUser?.role === "administrator";
  const schedules = isResident
    ? sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area)
    : sortedSchedules(data.schedules);
  const calendarEvents = (data.calendarEvents || []).map((item) => ({
    id: String(item.id),
    date: item.date,
    title: item.title,
    detail: item.detail || "",
    kind: "Event",
    status: item.approvalStatus || "approved",
    declineReason: item.declineReason || "",
    createdBy: item.createdBy || "",
    createdByName: item.createdByName || "",
  }));
  const activeEvents = calendarEvents.filter((event) => event.status !== "declined");
  const events = [
    ...data.announcements
      .filter((item) => item.approvalStatus === "approved")
      .map((item) => ({
        id: String(item.id),
        date: item.date,
        title: item.title,
        detail: item.detail,
        kind: "Announcement",
        status: item.approvalStatus,
        isEvent: Boolean(item.isEvent),
        latitude: item.latitude ?? null,
        longitude: item.longitude ?? null,
      })),
    ...schedules.map((item) => ({ date: item.date, title: `${item.wasteType} collection`, detail: `${item.start}–${item.end} · ${item.area} · ${item.zone}`, kind: "Collection" })),
    ...activeEvents,
  ];
  const byDate = new Map();
  for (const event of events) {
    if (!event.date) continue;
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const firstDay = new Date(calendarYear, calendarMonth, 1);
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const startWeekday = firstDay.getDay();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, date: dateStr, events: byDate.get(dateStr) || [] });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayISO();
  const grid = cells.map((cell) => {
    if (!cell) return `<div class="calendar-cell calendar-cell--blank" aria-hidden="true"></div>`;
    const hasEvents = cell.events.length > 0;
    const pending = cell.events.some((event) => event.status === "pending");
    const classes = [
      "calendar-cell",
      hasEvents ? "calendar-cell--has-events" : "",
      pending ? "calendar-cell--pending" : "",
      cell.date === today ? "calendar-cell--today" : "",
      cell.date === calendarSelectedDate ? "calendar-cell--selected" : "",
    ].filter(Boolean).join(" ");
    const cellEvents = cell.events.slice(0, 2).map((event) => `<span class="calendar-cell-event${event.status === "pending" ? " calendar-cell-event--pending" : ""}">${esc(event.title)}</span>`).join("");
    const more = cell.events.length > 2 ? `<span class="calendar-cell-more">+${cell.events.length - 2} more</span>` : "";
    const detailsHint = hasEvents ? `, ${cell.events.length} event${cell.events.length === 1 ? "" : "s"}; double-click to view details` : "";
    const viewHint = hasEvents ? `<span class="calendar-cell-view" aria-hidden="true" title="Double-click to view event details">${icon("arrow", "calendar-cell-view-icon")}</span>` : "";
    return `<button type="button" class="${classes}" data-action="calendar-day" data-date="${esc(cell.date)}" aria-label="${esc(dateLabel(cell.date, { weekday: "long", month: "long", day: "numeric" }))}${detailsHint}"><span class="calendar-day-number">${cell.day}</span>${hasEvents ? `<span class="calendar-cell-events">${cellEvents}${more}</span>` : ""}${viewHint}</button>`;
  }).join("");

  const eventMeta = (event) => event.kind === "Event"
    ? `<div class="calendar-event-meta">${statusPill(calendarStatusLabel(event.status))}${event.createdByName ? `<span>Requested by ${esc(event.createdByName)}</span>` : ""}</div>`
    : event.kind === "Announcement" && event.isEvent
      ? `<div class="calendar-event-meta">${announcementEventMarkup(event)}</div>`
      : "";

  const selectedEvents = calendarSelectedDate ? (byDate.get(calendarSelectedDate) || []) : [];
  const canAddHere = canManage && calendarSelectedDate && calendarSelectedDate >= today;
  const addHere = canAddHere
    ? `<button class="button small" type="button" data-action="add-calendar-event" data-date="${esc(calendarSelectedDate)}">${icon("plus")} Add event</button>`
    : "";
  const details = calendarSelectedDate
    ? `<div class="calendar-details"><div class="calendar-details-head"><h3>${esc(dateLabel(calendarSelectedDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</h3>${addHere}</div>${selectedEvents.length ? selectedEvents.map((event) => `<div class="calendar-event"><div class="calendar-date"><strong>${esc(event.kind)}</strong></div><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p>${eventMeta(event)}</div></div>`).join("") : `<div class="empty-state"><strong>No events</strong>Nothing is scheduled on this date.${canManage && calendarSelectedDate >= today ? " Use Add event to request one." : ""}</div>`}</div>`
    : `<div class="calendar-details"><p class="muted small">Select a date to see event details.${canManage ? " Use Add event there to request an event." : ""}</p></div>`;

  const upcoming = activeEvents.concat(
    data.announcements
      .filter((item) => item.approvalStatus === "approved")
      .map((item) => ({
        id: String(item.id),
        date: item.date,
        title: item.title,
        detail: item.detail,
        kind: "Announcement",
        status: item.approvalStatus,
        isEvent: Boolean(item.isEvent),
        latitude: item.latitude ?? null,
        longitude: item.longitude ?? null,
      })),
    schedules.map((item) => ({ date: item.date, title: `${item.wasteType} collection`, detail: `${item.start}–${item.end} · ${item.area}`, kind: "Collection", status: "approved" })),
  ).filter((event) => event.date && event.date >= today).sort((a, b) => asDate(a.date) - asDate(b.date)).slice(0, 10);
  const upcomingList = upcoming.length
    ? upcoming.map((event) => `<article class="calendar-event"><div class="calendar-date"><strong>${esc(dateLabel(event.date, { day: "numeric", month: "short" }))}</strong><span>${esc(event.kind)}</span></div><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p>${eventMeta(event)}</div></article>`).join("")
    : `<div class="empty-state"><strong>No upcoming events</strong>Announcements and collection schedules will appear here.</div>`;

  const myRequests = calendarEvents.filter((event) => event.status !== "approved" && event.createdBy === currentUser?.id);
  const requestRow = (event) => `<article class="calendar-request"><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p><span class="record-secondary">${esc(dateLabel(event.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }))}${event.createdByName ? ` · Requested by ${esc(event.createdByName)}` : ""}</span>${event.status === "declined" && event.declineReason ? `<span class="calendar-event-reason">Reason: ${esc(event.declineReason)}</span>` : ""}</div>${statusPill(calendarStatusLabel(event.status))}</article>`;
  const requestsPanel = currentUser?.role === "official"
    ? panel("Your event requests", myRequests.length
      ? `<div class="calendar-requests">${myRequests.map(requestRow).join("")}</div>`
      : `<div class="empty-state"><strong>No requests yet</strong>Events you request appear here until the administrator reviews them.</div>`,
      { subtitle: "Events you requested that are waiting for approval or were declined." })
    : "";

  const body = `
    <div class="content-stack">
      <div class="calendar-toolbar">
        <button type="button" class="button secondary small" data-action="calendar-prev" aria-label="Previous month">‹</button>
        <h2 class="calendar-month-title">${esc(monthNames[calendarMonth])} ${calendarYear}</h2>
        <button type="button" class="button secondary small" data-action="calendar-next" aria-label="Next month">›</button>
      </div>
      <div class="calendar-grid" role="grid" aria-label="Calendar">
        <div class="calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="calendar-weekday">${day}</div>`).join("")}</div>
        <div class="calendar-days">${grid}</div>
      </div>
      ${details}
      ${requestsPanel}
      <section class="calendar-upcoming">
        <h3>Upcoming events</h3>
        <div class="calendar-list">${upcomingList}</div>
      </section>
    </div>`;
  const headingAction = isAdmin
    ? `<a class="button secondary small" href="${routeUrl("administrator", "approvals")}">${icon("check")} Approval queue</a>`
    : "";
  return page(currentUser?.role || "resident", "calendar", body, headingAction);
}


function dashboardOfficial() {
  const open = data.reports.filter((report) => report.status !== "Resolved");
  const pending = open.filter((report) => report.status === "Submitted" || report.status === "Under Review");
  const latest = [...open].sort((a, b) =>
    Number(["Submitted", "Under Review"].includes(b.status)) - Number(["Submitted", "Under Review"].includes(a.status)) ||
    asDate(b.updatedAt) - asDate(a.updatedAt),
  ).slice(0, 5);
  const next = upcomingSchedule("");
  const body = `
    <div class="grid-main-side">
      <div class="content-stack">
        ${panel("Concerns needing attention", `<p class="queue-context">${pending.length} awaiting review</p><div class="quick-list">${latest.map((report) => `<div class="report-item"><span class="item-mark">${icon("clipboard")}</span><div class="item-copy"><strong class="truncate">${esc(report.title)}</strong><span>${esc(report.id)} · ${esc(report.name)} · ${esc(report.area)}</span></div>${statusPill(report.status)}<button class="icon-button" type="button" data-action="view-report" data-id="${esc(report.id)}" aria-label="Review ${esc(report.id)}">${icon("arrow")}</button></div>`).join("") || `<div class="empty-state"><strong>No open concerns</strong>New reports will appear here.</div>`}</div><div class="form-actions">${linkButton("View concern queue", routeUrl("official", "concerns"), "secondary", "small")}</div>`)}
        ${panel("Collection service", next ? `<div class="account-summary"><span class="item-mark">${icon("calendar")}</span><div><strong>${esc(next.area)} · ${esc(next.wasteType)}</strong><span>${esc(dateLabel(next.date, { weekday: "long", month: "short", day: "numeric" }))} · ${esc(next.start)}–${esc(next.end)}</span><span>${esc(next.zone)} · ${esc(next.team)}</span></div></div><div class="status-line mt-16">${statusPill(next.status)}</div><div class="form-actions">${linkButton("Manage schedules", routeUrl("official", "collection"), "secondary", "small")}</div>` : `<div class="empty-state">No future collections are scheduled.</div>`)}
      </div>
      <div class="content-stack">
        ${panel("Team activity", `<div class="activity-list">${data.activities.slice(0, 3).map((item) => `<div class="activity-item"><span class="item-mark">${icon(item.action.toLowerCase().includes("concern") ? "flag" : "activity")}</span><div class="item-copy"><strong>${esc(item.action)}</strong><span>${esc(item.detail)} · ${esc(dateTimeLabel(item.at))}</span></div></div>`).join("")}</div>`, { action: `<a href="${routeUrl("official", "history")}">Report history</a>` })}
      </div>
    </div>`;
  return page("official", "dashboard", body);
}

function dashboardAdmin() {
  const residentCount = data.users.filter((user) => user.role === "resident").length;
  const officialCount = data.users.filter((user) => user.role === "official").length;
  const activeCount = data.users.filter((user) => user.status === "Active").length;
  const openReports = data.reports.filter((report) => report.status !== "Resolved").length;
  const body = `
    <div class="content-stack">
      <div class="grid-main-side">
        <div class="content-stack">
          ${panel("Accounts", `<ul class="plain-list"><li><span>All accounts</span><strong class="num">${data.users.length}</strong></li><li><span>Active</span><strong class="num">${activeCount}</strong></li><li><span>Residents</span><strong class="num">${residentCount}</strong></li><li><span>Barangay officials</span><strong class="num">${officialCount}</strong></li></ul><div class="form-actions">${linkButton("Manage users", routeUrl("administrator", "users"), "secondary", "small")}</div>`, { subtitle: "Accounts in this workspace" })}
          ${panel("Open concerns", `<ul class="plain-list"><li><span>Reports needing attention</span><strong class="num">${openReports}</strong></li></ul><div class="form-actions">${linkButton("View community reports", routeUrl("administrator", "reports"), "secondary", "small")}</div>`, { subtitle: "Resident concerns not yet resolved" })}
        </div>
        <div class="content-stack">
          ${panel("Recent activity", `<div class="activity-list">${data.activities.slice(0, 6).map((item) => `<div class="activity-item"><span class="item-mark">${icon(item.action.toLowerCase().includes("account") ? "users" : "activity")}</span><div class="item-copy"><strong>${esc(item.action)}</strong><span>${esc(item.actor)} · ${esc(item.detail)}</span></div><span class="item-end">${esc(dateTimeLabel(item.at))}</span></div>`).join("")}</div><div class="form-actions">${linkButton("View activity log", routeUrl("administrator", "activity"), "secondary", "small")}</div>`, { subtitle: "Latest changes in this workspace" })}
        </div>
      </div>
    </div>`;
  return page("administrator", "dashboard", body, linkButton(`${icon("users")} Manage users`, routeUrl("administrator", "users"), ""));
}

function settingsPage() {
  const accountItems = [
    ["User management", "Accounts and status", "users", "users"],
    ["Profile and password", "Your administrator account", "user", "profile"],
  ];
  const workspaceItems = [
    ["Locations and recycling", "Community areas and verified listings", "pin", "locations"],
    ["Announcements", "Community service notices", "activity", "announcements"],
    ["Analytics", "Workspace report and account trends", "activity", "analytics"],
    ["Activity Log", "Recorded account and service activity", "activity", "activity"],
    ["Role management", "Workspace permissions", "shield", "roles"],
    ["Email", "SMTP email setup", "mail", "email"],
  ];
  const rows = (items) => items.map(([title, description, iconName, pageName]) => `<a class="settings-row" href="${routeUrl("administrator", pageName)}"><span class="settings-row-icon">${icon(iconName)}</span><span class="settings-row-copy"><strong>${esc(title)}</strong><small>${esc(description)}</small></span><span class="settings-row-arrow">${icon("arrow")}</span></a>`).join("");
  const body = `<div class="settings-layout"><section class="settings-section"><h2>Account</h2><div class="settings-list">${rows(accountItems)}</div></section><section class="settings-section"><h2>Workspace</h2><div class="settings-list">${rows(workspaceItems)}</div></section></div>`;
  return page("administrator", "settings", body);
}

function emailPage() {
  const body = `<div class="content-stack">${emailDeliverySection()}</div>`;
  return page("administrator", "email", body);
}

function emailDeliverySection() {
  return `<section class="settings-section"><h2>Email</h2><form id="smtp-settings-form" class="settings-email"><div class="settings-email-head"><span class="settings-row-icon">${icon("mail")}</span><div><strong>SMTP email</strong><small>Report and collection notifications</small></div><span class="settings-row-arrow">${icon("arrow")}</span></div><div class="smtp-guide"><strong>Start with your email provider</strong><span>Choose a provider to fill the server details. Use an app password or service API key when your provider offers one; do not use your normal email password.</span><div class="smtp-provider-list"><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="gmail">Gmail</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="outlook">Outlook</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="sendgrid">SendGrid</button><button class="button secondary small" type="button" data-action="smtp-preset" data-provider="custom">Other provider</button></div><p class="field-help" id="smtp-provider-help">Select a provider to see where its SMTP password or API key comes from.</p></div><div class="form-grid mt-16">${inputField("SMTP host", "host", smtpSettings.host, { required: true })}${inputField("SMTP port", "port", smtpSettings.port || "587", { type: "number", required: true, min: 1, max: 65535 })}${inputField("SMTP username", "user", smtpSettings.user, { required: true })}${inputField("Sender address", "from", smtpSettings.from, { required: true })}${inputField("SMTP password", "pass", "", { type: "password", autocomplete: "new-password", placeholder: smtpSettings.configured ? "Leave blank to keep current password" : "" })}</div><div class="form-actions"><button class="button" type="submit">Save SMTP settings</button><button class="button secondary" type="button" data-action="test-smtp">Send test email</button></div><p class="field-help">The password is encrypted on the server and never returned to this browser.</p></form></section>`;
}

function collectionResident() {
  const schedules = sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area);
  const next = upcomingSchedule(currentUser.area);
  const body = `
    <div class="content-stack">
      <div class="grid-main-side">
        ${panel("Your next collection", next ? `<div class="account-summary"><span class="item-mark">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.wasteType)} · ${esc(next.start)}–${esc(next.end)}</span><span>${esc(next.area)} · ${esc(next.zone)}</span></div></div><div class="status-line mt-16">${statusPill(next.status)}<span class="muted small">${esc(next.team)}</span></div>` : `<div class="empty-state"><strong>No upcoming collection posted</strong>Your barangay will appear here when a schedule is available.</div>`)}
      </div>
      ${panel("Collection schedule", `${scheduleRows(schedules)}`, { subtitle: "Upcoming collections for your selected area" })}
      ${panel("Missed collection?", `<div class="form-actions">${linkButton(`${icon("flag")} Report a missed pickup`, routeUrl("resident", "report"), "")}</div>`)}
    </div>`;
  return page("resident", "collection", body);
}

function locationsPage() {
  const locationRows = data.locations.map((location) => `<div class="record-row filter-item" role="row" data-search="${esc(`${location.area} ${location.barangay} ${location.street} ${location.purok} ${location.landmark}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(location.area)}</strong><span class="record-secondary">${esc(location.barangay)}</span></div>
    <div class="record-meta" role="cell" data-label="Street">${esc(location.street || "—")}</div>
    <div class="record-meta" role="cell" data-label="Purok">${esc(location.purok)}</div>
    <div class="record-meta" role="cell" data-label="Landmark">${esc(location.landmark || "—")}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-location" data-id="${esc(location.id)}">Edit</button></div>
  </div>`).join("");
  const recyclingRows = data.recyclingLocations.map((item) => `<div class="record-row filter-item" role="row" data-search="${esc(`${item.name} ${item.barangay} ${item.street} ${item.materials}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(item.name)}</strong><span class="record-secondary">${esc(item.materials)}</span></div>
    <div class="record-meta" role="cell" data-label="Location">${esc([item.street, item.purok, item.barangay].filter(Boolean).join(", "))}</div>
    <div class="record-meta" role="cell" data-label="Contact">${esc(item.phone || "—")}</div>
    <div role="cell" data-label="Visibility">${statusPill(item.active ? "active" : "inactive", item.active ? "Visible" : "Hidden")}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-recycling" data-id="${esc(item.id)}">Edit</button></div>
  </div>`).join("");
  const body = `<div class="content-stack">
    ${panel("Resident areas", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search community locations</span><input class="input" type="search" data-search-input autocomplete="off"></label></div>
      <div class="records mt-16" data-page-size="10" role="table" aria-label="Community areas"><div class="record-row record-head" role="row"><span role="columnheader">Area and barangay</span><span role="columnheader">Street</span><span role="columnheader">Purok</span><span role="columnheader">Landmark</span><span role="columnheader">Action</span></div>${locationRows || `<div class="empty-state"><strong>No areas configured</strong>Add an area before residents register or file reports.</div>`}</div>`,
      { subtitle: "Manage the areas residents can select for accounts, reports, and collection schedules.", action: actionButton(`${icon("plus")} Add area`, "add-location", "small") })}
    ${panel("Recycling and junkshop directory", `<div class="records" data-page-size="10" role="table" aria-label="Recycling locations"><div class="record-row record-head" role="row"><span role="columnheader">Business or site</span><span role="columnheader">Location</span><span role="columnheader">Contact</span><span role="columnheader">Visibility</span><span role="columnheader">Action</span></div>${recyclingRows || `<div class="empty-state"><strong>No directory listings</strong>Add verified recycling or junkshop information for residents.</div>`}</div>`,
      { subtitle: "Only active listings appear in the resident directory.", action: actionButton(`${icon("plus")} Add listing`, "add-recycling", "small") })}
  </div>`;
  return page("administrator", "locations", body);
}

function announcementEventMarkup(item) {
  if (!item?.isEvent) return "";
  const hasPin = Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
  if (!hasPin) return `<span class="approval-tag">Event</span>`;
  return `<span class="approval-tag">Event</span><button class="text-button" type="button" data-action="view-announcement-location" data-id="${esc(item.id)}">View event location</button>`;
}

function announcementsPage(role) {
  const isManager = role === "official" || role === "administrator";
  const announcements = [...data.announcements].sort((a, b) => asDate(b.date) - asDate(a.date));
  const statusLabel = (item) => item.approvalStatus === "pending" ? "Pending approval" : item.approvalStatus === "declined" ? "Declined" : "Published";
  const rows = announcements.map((item) => `<div class="record-row filter-item" role="row" data-search="${esc(`${item.title} ${item.detail} ${item.isEvent ? "event" : ""}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(item.title)}</strong>${item.isEvent ? `<div class="announcement-event-meta">${announcementEventMarkup(item)}</div>` : ""}<span class="record-secondary">${esc(item.detail)}</span></div>
    <div class="record-date" role="cell" data-label="Publish date">${esc(dateLabel(item.date))}</div>
    ${isManager ? `<div class="record-actions" role="cell" data-label=""><span class="record-secondary">${statusLabel(item)}${item.approvalStatus === "declined" && item.declineReason ? ` · ${esc(item.declineReason)}` : ""}</span><button class="button secondary small" type="button" data-action="edit-announcement" data-id="${esc(item.id)}">Edit</button>${role === "administrator" && item.approvalStatus === "pending" ? `<a class="text-button" href="${routeUrl("administrator", "approvals")}">Review in approval queue</a>` : ""}</div>` : ""}
  </div>`).join("");
  const body = `<div class="content-stack">
    ${panel("Community announcements", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search announcements</span><input class="input" type="search" data-search-input autocomplete="off"></label></div>
      <div class="records mt-16" data-page-size="10" role="table" aria-label="Announcements"><div class="record-row record-head" role="row"><span role="columnheader">Announcement</span><span role="columnheader">Date</span>${isManager ? '<span role="columnheader">Action</span>' : ""}</div>${rows || `<div class="empty-state"><strong>No announcements yet</strong>Updates published by barangay staff will appear here.</div>`}</div>`,
      { subtitle: isManager ? "Create or update a notice for residents and staff." : "Service information shared by barangay staff.", action: isManager ? actionButton(`${icon("plus")} New announcement`, "add-announcement", "small") : "" })}
  </div>`;
  return page(role, "announcements", body);
}

function analyticsPage() {
  const reports = data.reports;
  const schedules = sortedSchedules(data.schedules);
  const open = reports.filter((report) => report.status !== "Resolved");
  const due = schedules.filter((item) => item.date >= todayISO() && !["Completed", "Cancelled"].includes(item.status));
  const body = `<div class="content-stack">
    ${statsStrip([
      stat("Database", "Available", "Latest server data loaded", "success"),
      stat("Open reports", open.length, `${reports.length} total reports`),
      stat("Upcoming collections", due.length, "Scheduled or in progress"),
    ])}
    <div class="grid-main-side">
      ${panel("Report status", `<ul class="plain-list">${STATUSES.map((status) => `<li><span>${esc(status)}</span><strong class="num">${reports.filter((report) => report.status === status).length}</strong></li>`).join("")}</ul><div class="form-actions">${linkButton("Open community reports", routeUrl("administrator", "reports"), "secondary", "small")}</div>`, { subtitle: "Counts from the current database snapshot" })}
      ${panel("Collection service", `<ul class="plain-list">${COLLECTION_STATUSES.map((status) => `<li><span>${esc(status)}</span><strong class="num">${schedules.filter((item) => item.status === status).length}</strong></li>`).join("")}</ul><div class="form-actions">${linkButton("Manage locations and listings", routeUrl("administrator", "locations"), "secondary", "small")}</div>`, { subtitle: "Schedules and statuses currently stored" })}
    </div>
  </div>`;
  return page("administrator", "analytics", body);
}

function collectionOfficial() {
  const schedules = sortedSchedules(data.schedules);
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat("Upcoming collections", schedules.filter((item) => item.date >= todayISO() && !["Cancelled", "Completed"].includes(item.status)).length, "Across all listed areas"),
        stat("In progress", schedules.filter((item) => ["On the way", "Collecting"].includes(item.status)).length, "Current service status"),
        stat("Service changes", schedules.filter((item) => ["Delayed", "Cancelled", "Rescheduled"].includes(item.status)).length, "Review resident notices", schedules.some((item) => ["Delayed", "Cancelled"].includes(item.status)) ? "warning" : ""),
        stat("Collection areas", new Set(schedules.map((item) => item.area)).size, "Areas with schedules"),
      ])}
      ${panel("Collection schedules", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search schedules</span><input class="input" type="search" data-search-input autocomplete="off"></label></div>${scheduleRows(schedules, true)}`, { subtitle: "Edit an existing schedule or add a collection", action: actionButton(`${icon("plus")} Add schedule`, "add-schedule", "small") })}
    </div>`;
  return page("official", "collection", body);
}

function reportFormMarkup() {
  const draft = reportDraft || {};
  const defaultArea = draft.area || currentUser.area || locationAreas()[0];
  const selectedReportArea = defaultArea;
  return `
    <section class="panel"><div class="panel-body">
      <div class="wizard-progress" aria-label="Step ${reportDraft?.step === "review" ? "2" : "1"} of 2">
        <div class="wizard-step ${reportDraft?.step === "review" ? "done" : "current"}"><strong>${reportDraft?.step === "review" ? icon("check") : "1"}</strong><span>Concern details</span></div><span class="wizard-divider"></span>
        <div class="wizard-step ${reportDraft?.step === "review" ? "current" : ""}"><strong>2</strong><span>Review & submit</span></div>
      </div>
      ${reportDraft?.step === "review" ? `
        <div class="content-stack">
          <div class="notice-bar"><span>Concern</span><strong>${esc(draft.category)}</strong></div>
          <div class="notice-bar"><span>Priority</span><strong>${esc(draft.priority || "Medium")}</strong></div>
          <div class="notice-bar"><span>Purok or area</span><strong>${esc(draft.area || defaultArea)}</strong></div>
          <div class="notice-bar"><span>Street or landmark</span><strong>${esc(draft.locationDetail)}</strong></div>
          <div class="notice-bar"><span>Map pin</span><strong>${draft.latitude == null ? "Not selected" : `${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)}`}</strong></div>
          <div class="form-field"><span class="field-help">Description</span><p class="report-draft-description">${esc(draft.description)}</p></div>
          <div><span class="field-help">Photos</span>${uploadPhotos.length ? `<div class="photo-preview">${uploadPhotos.map((photo) => `<div class="photo-thumb"><img src="${esc(photo.previewUrl)}" alt="${esc(photo.name)}"></div>`).join("")}</div>` : `<p class="muted small">No photos attached.</p>`}</div>
          <div class="form-actions"><button class="button secondary" type="button" data-action="edit-report-draft">Edit details</button><button class="button" type="button" data-action="submit-report">Submit concern</button></div>
        </div>` : `
        <form id="report-draft-form" class="form-stack">
          <div class="form-grid">
            ${selectField("Concern category", "category", CATEGORIES, draft.category || "", { required: true, placeholder: "Choose a concern type" })}
            ${selectField("Risk or priority", "priority", REPORT_PRIORITIES, draft.priority || "Medium", { required: true })}
            ${selectField("Purok or area", "area", AREAS, draft.area || selectedReportArea || AREAS[0], { required: true })}
            ${inputField("Street or nearby landmark", "locationDetail", draft.locationDetail || "", { required: true, maxLength: 250 })}
            <div class="form-field span-all report-map-picker">
              <input type="hidden" id="report-latitude" name="latitude" value="${esc(reportMapSelection?.latitude ?? "")}">
              <input type="hidden" id="report-longitude" name="longitude" value="${esc(reportMapSelection?.longitude ?? "")}">
              <div class="button-row">
                <button class="button secondary" type="button" data-action="toggle-report-map" aria-expanded="${reportMapExpanded}">${reportMapExpanded ? "Hide map" : "Choose location on map"}</button>
                <button class="button secondary" type="button" data-action="use-current-location">${reportMapGeoLocating ? "Locating…" : "Choose my current location"}</button>
                <button class="button secondary" type="button" data-action="clear-report-map-pin" ${reportMapSelection ? "" : "hidden"}>Clear pin</button>
              </div>
              <div class="report-map-region" id="report-map-region" ${reportMapExpanded ? "" : "hidden"}>
                <p class="visually-hidden" id="report-map-status" role="status" aria-live="polite"></p>
                <div class="report-map-canvas" id="report-map" role="application" aria-label="OpenStreetMap. Click to place a location pin, or drag the pin to adjust it."></div>
              </div>
            </div>
            <div class="form-field span-all"><label for="description">Describe what happened *</label><textarea class="textarea" id="description" name="description" required minlength="12" maxlength="1200">${esc(draft.description || "")}</textarea></div>
            <div class="form-field span-all"><span class="field"><label for="report-photos">Attach photos (optional)</label><label class="upload-box" for="report-photos">${icon("image")}<strong>Choose photos from this device</strong><input class="visually-hidden" id="report-photos" name="photos" type="file" accept="image/jpeg,image/png" multiple></label><div class="photo-preview" id="photo-preview">${uploadPhotos.map((photo, index) => `<div class="photo-thumb"><img src="${esc(photo.previewUrl)}" alt="${esc(photo.name)}"><button type="button" data-action="remove-photo" data-index="${index}" aria-label="Remove ${esc(photo.name)}">${icon("close")}</button></div>`).join("")}</div></span></div>
          </div>
          <div class="form-actions"><a class="button secondary" href="${routeUrl("resident", "dashboard")}">Cancel</a><button class="button" type="submit">Review report ${icon("arrow")}</button></div>
        </form>`}
    </div></section>`;
}

function reportPage() {
  return page("resident", "report", reportFormMarkup());
}

function reportsPage(role, view) {
  const userRows = role === "resident" ? userReports() : data.reports;
  const selection = selectedReportId ? getReport(selectedReportId) : null;
  if (selection && (role !== "resident" || selection.userEmail === currentUser.email)) return reportDetail(selection, role);
  const officialQueue = role === "official" && view === "concerns";
  const canFilter = (role === "resident" || role === "administrator") && view === "reports";
  const allowedFilters = officialQueue ? [...STATUSES.slice(0, -1)] : canFilter ? ["all", ...STATUSES] : [];
  const activeFilter = allowedFilters.includes(reportFilter) ? reportFilter : "all";
  const filtered = sortedReports(officialQueue || canFilter
    ? userRows.filter((report) => activeFilter === "all"
      ? true
      : report.status === activeFilter)
    : userRows);
  const title = view === "history" ? "Report history" : role === "resident" ? "My reports" : role === "administrator" ? "Community reports" : "Concern queue";
  const subtitle = view === "history"
    ? "A complete record of submitted concerns and their latest updates."
    : pageTitle(role, view)[1];
  const showResolvedSeparately = !canFilter || activeFilter === "all";
  const activeRows = view === "history" || !showResolvedSeparately ? filtered : filtered.filter((report) => report.status !== "Resolved");
  const resolvedRows = view === "history" || !showResolvedSeparately ? [] : filtered.filter((report) => report.status === "Resolved");
  const primaryAction = role === "resident"
    ? linkButton(`${icon("plus")} Report a concern`, routeUrl("resident", "report"), "")
    : "";
  const exportActions = role === "resident"
    ? view === "reports"
      ? `<button class="button secondary small" type="button" data-action="export-reports">${icon("download")} Export reports</button>`
      : view === "history"
        ? `<button class="button secondary small" type="button" data-action="export-report-history">${icon("download")} Export history</button>`
        : ""
    : view === "history"
      ? `<button class="button secondary small" type="button" data-action="export-report-history">${icon("download")} Export history</button>`
      : `<button class="button secondary small" type="button" data-action="export-reports">${icon("download")} Export reports</button>`;
  const body = `
    <div class="content-stack">
      ${panel(role === "official" && view === "history" ? "Report activity" : view === "history" ? "Past and current concerns" : role === "official" ? "Concern queue" : "Reports", `${role === "official" && view === "history" ? "" : view === "reports" ? reportFilters(userRows, activeFilter) : officialQueue ? officialReportFilters(userRows, activeFilter) : ""}${searchToolbar(role === "official" && view === "history" ? "Search report activity" : undefined)}<div class="mt-16" data-report-table>${role === "official" && view === "history" ? reportHistoryRows(userRows) : reportRows(view === "history" ? filtered : activeRows, role)}</div>${resolvedRows.length && view !== "history" ? `<div class="section-heading mt-20"><div><h2>Resolved concerns</h2><p>${resolvedRows.length} marked as addressed</p></div></div><div data-report-table>${reportRows(resolvedRows, role)}</div>` : ""}`, { subtitle: role === "resident" && view === "reports" ? "" : subtitle, action: exportActions })}
    </div>`;
  return page(role, view, body, primaryAction);
}

function notificationsPage(role) {
  const notifications = sortedNotifications(data.notifications.filter((item) => item.targetEmail === currentUser.email));
  const visible = notificationFilter === "unread" ? notifications.filter((item) => !item.read) : notifications;
  const unread = notifications.filter((item) => !item.read).length;
  const reportUpdates = notifications.filter((item) => item.reportId).length;
  const serviceUpdates = notifications.length - reportUpdates;
  const body = `
    <div class="content-stack">
      <section class="notification-summary"><div><span class="eyebrow">Updates</span><h2>Stay in the loop</h2><p>Important changes to your reports and community services.</p></div><div class="notification-summary-count"><strong>${unread}</strong><span>unread</span></div></section>
      ${panel("Notification inbox", `<div class="notification-toolbar"><div class="filter-row" role="group" aria-label="Filter notifications"><button type="button" class="filter-button ${notificationFilter === "all" ? "selected" : ""}" data-action="filter-notifications" data-value="all" aria-pressed="${notificationFilter === "all"}">All <span class="filter-count">${notifications.length}</span></button><button type="button" class="filter-button ${notificationFilter === "unread" ? "selected" : ""}" data-action="filter-notifications" data-value="unread" aria-pressed="${notificationFilter === "unread"}">Unread <span class="filter-count">${unread}</span></button></div>${notifications.some((item) => !item.read) ? actionButton("Mark all read", "mark-all-read", "tertiary", "small") : ""}</div><div class="notification-breakdown"><span>${reportUpdates} report updates</span><span>${serviceUpdates} service updates</span></div>
        <div class="notification-list">${visible.length ? visible.map((item) => `<article class="notification-item ${item.read ? "" : "notification-unread"}"><span class="notification-icon">${icon(item.reportId ? "clipboard" : "bell")}</span><div class="notification-content"><div class="notification-title"><strong>${esc(item.title)}</strong>${item.read ? "" : `<span class="notification-unread-label">New</span>`}</div><p>${esc(item.body)}</p><div class="notification-meta"><span>${esc(dateTimeLabel(item.createdAt))}</span>${item.reportId ? `<button type="button" class="text-button" data-action="view-notification-report" data-id="${esc(item.reportId)}">View report</button>` : ""}${role === "administrator" && /needs approval/i.test(item.title) ? `<a class="text-button" href="${routeUrl("administrator", "approvals")}">Open approval queue</a>` : ""}</div></div>${item.read ? `<span class="notification-state">Read</span>` : `<button class="button secondary small notification-read-button" type="button" data-action="mark-read" data-id="${esc(item.id)}">Mark read</button>`}</article>`).join("") : `<div class="empty-state"><strong>All caught up</strong>There are no ${notificationFilter === "unread" ? "unread " : ""}updates for this account.</div>`}</div>`, { subtitle: "Your latest account and community updates" })}
    </div>`;
  const reviewAction = role === "administrator"
    ? `<a class="button secondary small" href="${routeUrl("administrator", "approvals")}">${icon("check")} Approval queue</a>`
    : "";
  return page(role, "notifications", body, reviewAction);
}

function approvalsPage() {
  const pendingEvents = (data.calendarEvents || []).filter((event) => event.approvalStatus === "pending");
  const pendingAnnouncements = data.announcements.filter((item) => item.approvalStatus === "pending");
  const total = pendingEvents.length + pendingAnnouncements.length;

  const eventRows = pendingEvents.map((event) => `<article class="approval-row">
    <div class="approval-copy">
      <span class="approval-tag">Event</span>
      <h4>${esc(event.title)}</h4>
      <p>${esc(event.detail || "No details provided.")}</p>
      <span class="record-secondary">${esc(dateLabel(event.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}${event.createdByName ? ` · Requested by ${esc(event.createdByName)}` : ""}</span>
    </div>
    <div class="approval-actions">
      <button class="button small" type="button" data-action="approve-calendar-event" data-id="${esc(event.id)}">Approve</button>
      <button class="button danger small" type="button" data-action="decline-calendar-event" data-id="${esc(event.id)}">Reject</button>
    </div>
  </article>`).join("");

  const announcementRows = pendingAnnouncements.map((item) => `<article class="approval-row">
    <div class="approval-copy">
      <span class="approval-tag">Announcement</span>
      <h4>${esc(item.title)}</h4>
      <p>${esc(item.detail)}</p>
      ${item.isEvent ? `<div class="announcement-event-meta">${announcementEventMarkup(item)}</div>` : ""}
      <span class="record-secondary">${esc(dateLabel(item.date))}</span>
    </div>
    <div class="approval-actions">
      <button class="button small" type="button" data-action="approve-announcement" data-id="${esc(item.id)}">Approve</button>
      <button class="button danger small" type="button" data-action="decline-announcement" data-id="${esc(item.id)}">Reject</button>
    </div>
  </article>`).join("");

  const body = `<div class="content-stack">
    ${statsStrip([
      stat("Pending requests", total, "Waiting for your decision"),
      stat("Event requests", pendingEvents.length, "Calendar events"),
      stat("Announcements", pendingAnnouncements.length, "Community notices"),
    ])}
    ${panel("Calendar event requests", eventRows ? `<div class="approval-list">${eventRows}</div>` : `<div class="empty-state"><strong>No event requests</strong>Events requested by barangay officials will appear here for approval.</div>`, { subtitle: "Approve to place the event on the community calendar, or reject with a reason." })}
    ${panel("Announcement requests", announcementRows ? `<div class="approval-list">${announcementRows}</div>` : `<div class="empty-state"><strong>No announcement requests</strong>Announcements submitted by barangay officials will appear here for approval.</div>`, { subtitle: "Approve to publish the notice, or reject with a reason." })}
  </div>`;
  return page("administrator", "approvals", body);
}

function profilePage(role) {
  const body = `
    <div class="profile-layout">
      <div class="content-stack">
        <section class="panel">
          <div class="profile-intro"><label class="profile-avatar" for="profile-photo" title="Change profile photo">${userAvatar(currentUser, "large")}</label><div><strong>${esc(currentUser.name)}</strong><span>${esc(ROLES[role])} · ${esc(currentUser.area || "Palsara")}</span></div></div>
          <div class="panel-body">
            <form id="profile-form" class="form-stack">
              <div class="section-heading"><div><h2>Personal information</h2></div></div>
              <div class="form-grid">
                ${inputField("Full name", "name", currentUser.name, { required: true, autocomplete: "name" })}
                ${inputField("Email address", "email", currentUser.email, { readonly: true, autocomplete: "email" })}
                ${inputField("Contact number", "phone", currentUser.phone || "", { type: "tel", autocomplete: "tel" })}
                ${role === "resident" ? selectField("Purok or area", "area", locationAreas().length ? locationAreas() : AREAS, currentUser.area || (locationAreas().length ? locationAreas()[0] : "Purok 1"), { required: true }) : inputField("Barangay", "area", currentUser.area || "Palsara", { readonly: true })}
                ${role === "resident" ? inputField("Recovery email", "recoveryEmail", currentUser.recoveryEmail || "", { type: "email", placeholder: "Optional", autocomplete: "email", help: "Used to receive password reset links." }) : ""}
              </div>
              <input type="file" id="profile-photo" accept="image/jpeg,image/png" class="visually-hidden">
              <div class="form-actions"><button class="button" type="submit">Save profile</button></div>
            </form>
          </div>
        </section>
        <section class="panel"><div class="panel-body">
          <form id="password-form" class="form-stack">
            <div class="section-heading"><div><h2>Account password</h2></div></div>
            ${inputField("Current password", "currentPassword", "", { type: "password", required: true, autocomplete: "current-password" })}
            <div class="form-grid">
              ${inputField("New password", "newPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}
              ${inputField("Confirm new password", "confirmPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}
            </div>
            <div class="form-actions"><button class="button secondary" type="submit">Update password</button></div>
          </form>
        </div></section>
      </div>
      <div class="content-stack">
        ${panel("Your workspace", `<div class="account-summary">${userAvatar(currentUser)}<div><strong>${esc(ROLES[role])}</strong><span>${esc(currentUser.email)}</span></div></div><div class="notice-bar mt-16"><span>Account status</span>${statusPill(currentUser.status || "Active")}</div>`)}
      </div>
    </div>`;
  return page(role, "profile", body);
}

function userRowsMarkup(users) {
  if (!users.length) return `<div class="empty-state"><strong>No accounts match</strong>Try another name, email, role, or status.</div>`;
  return `<div class="records" data-page-size="10" role="table" aria-label="User accounts"><div class="record-row record-head user-record-head" role="row"><span role="columnheader">Account</span><span role="columnheader">Role</span><span role="columnheader">Area</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>${users.map((user) => `<div class="record-row user-record filter-item" role="row" data-search="${esc(`${user.name} ${user.email} ${ROLES[user.role]} ${user.area} ${user.status}`.toLowerCase())}">
    <div class="identity" role="cell">${userAvatar(user)}<span><strong class="record-primary">${esc(user.name)}</strong><span class="record-secondary">${esc(user.email)}</span>${user.resetRequested ? `<span class="record-secondary" style="color:var(--warning,#b45309)">Reset requested</span>` : ""}</span></div>
    <div class="record-meta" role="cell" data-label="Role">${esc(ROLES[user.role] || user.role)}</div>
    <div class="record-meta" role="cell" data-label="Area">${esc(user.area || "—")}</div>
    <div role="cell" data-label="Status">${statusPill(user.status || "Active")}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-user" data-id="${esc(user.email)}">Edit</button></div>
  </div>`).join("")}</div>`;
}

function usersPage() {
  const counts = Object.keys(ROLES).map((role) => [role, data.users.filter((user) => user.role === role).length]);
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat("All accounts", data.users.length, "In this workspace"),
        ...counts.slice(0, 3).map(([role, count]) => stat(ROLES[role], count, "Accounts in workspace")),
      ])}
      ${panel("Accounts", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search by name or email</span><input class="input" type="search" data-search-input autocomplete="off"></label><select class="select" data-user-role-filter aria-label="Filter accounts by role"><option value="all">All roles</option>${Object.entries(ROLES).map(([role, label]) => `<option value="${esc(role)}">${esc(label)}</option>`).join("")}</select><select class="select" data-user-status-filter aria-label="Filter accounts by status"><option value="all">All statuses</option><option>Active</option><option>Inactive</option></select></div><div class="mt-16" data-user-table>${userRowsMarkup([...data.users].sort((a, b) => a.name.localeCompare(b.name)))}</div>`, { subtitle: "Manage accounts without changing role capabilities.", action: actionButton(`${icon("plus")} Add user`, "add-user", "small") })}
    </div>`;
  return page("administrator", "users", body);
}

function rolesPage() {
  selectedPermissionRole = "official";
  const roles = ["official"];
  const selectedRole = selectedPermissionRole;
  permissionDrafts[selectedRole] ||= { ...data.permissions[selectedRole] };
  if (!Object.hasOwn(permissionOpenGroups, selectedRole)) {
    permissionOpenGroups[selectedRole] = [selectedRole === "administrator" ? "Portal administration" : "Community services"];
  }
  const isDirty = (role) => Boolean(permissionDrafts[role] && PERMISSION_DEFS.some(({ id }) =>
    permissionDrafts[role][id] !== Boolean(data.permissions[role]?.[id]),
  ));
  const dirtyCount = PERMISSION_DEFS.filter(({ id }) =>
    permissionDrafts[selectedRole][id] !== Boolean(data.permissions[selectedRole]?.[id]),
  ).length;
  const openGroups = permissionOpenGroups[selectedRole];
  const canEditRole = false;
  const officialAccounts = (data.users || []).filter((user) => user.role === "official" && user.status === "Active");
  const permissionAccounts = selectedRole === "official" ? (officialAccounts.length ? officialAccounts.map((official) => {
    const override = data.accountOverrides?.[official.email] || {};
    const overrideCount = Object.keys(override).length;
    return `
  <details class="permission-account">
    <summary class="permission-account-head">
      <span class="permission-copy">
        <strong>${esc(official.name)}</strong>
        <small>${esc(official.email)}${overrideCount ? ` · ${overrideCount} override${overrideCount === 1 ? "" : "s"}` : ""}</small>
      </span>
      <span class="permission-account-toggle" aria-hidden="true">▾</span>
    </summary>
    <div class="permission-list">${PERMISSION_DEFS.map((permission) => {
      const enabled = override && permission.id in override ? Boolean(override[permission.id]) : Boolean(data.permissions.official?.[permission.id]);
      const hasOverride = override && permission.id in override;
      return `<div class="permission-row"><span class="permission-copy"><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}${hasOverride ? " · Override active" : ""}</small></span><button class="switch" type="button" role="switch" aria-checked="${enabled}" aria-label="${esc(`Barangay official: ${official.name} · ${permission.label}`)}" data-action="toggle-account-permission" data-email="${esc(official.email)}" data-permission="${esc(permission.id)}"></button></div>`;
    }).join("")}</div>
    <div class="permission-account-foot">
      <button class="button secondary small" type="button" data-action="reset-account-permissions" data-email="${esc(official.email)}">Reset to role default</button>
    </div>
  </details>`;
  }).join("") : `<div class="empty-state"><strong>No accounts yet</strong>Add official accounts in User management to assign per-account permissions.</div>`) : "";
  const roleTabs = roles.length > 1 ? roles.map((role) => `<button class="permission-role-button" type="button" data-action="select-permission-role" data-role="${esc(role)}" aria-pressed="${role === selectedRole}"><span>${esc(ROLES[role])}</span>${isDirty(role) ? '<span class="permission-unsaved">Unsaved</span>' : ""}</button>`).join("") : "";
  const permissionGroups = selectedRole === "official" ? "" : [...new Set(PERMISSION_DEFS.map(({ group }) => group))].map((group) => {
    const items = PERMISSION_DEFS.filter((permission) => permission.group === group);
    return `<details class="permission-group" data-permission-group="${esc(group)}" ${openGroups.includes(group) ? "open" : ""}><summary><span>${esc(group)}</span></summary><div class="permission-list">${items.map((permission) => `<div class="permission-row"><span class="permission-copy"><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span><span class="permission-state">${Boolean(permissionDrafts[selectedRole]?.[permission.id]) ? "Enabled" : "Disabled"}</span></div>`).join("")}</div></details>`;
  }).join("");
  const body = `
    <div class="content-stack">
      ${roleTabs ? `<div class="permission-roles" role="group" aria-label="Choose a role to edit">${roleTabs}</div>` : ""}
      ${selectedRole !== "official" ? `<div class="permission-role-context"><strong>${esc(ROLES[selectedRole])}</strong></div>` : ""}
      ${permissionGroups ? `<div class="permission-groups">${permissionGroups}</div>` : ""}
      ${selectedRole === "official" && permissionAccounts ? `<div class="permission-accounts-intro"><h3>Accounts</h3><p class="field-help">Each official can override the role defaults below. An unset override falls back to the role default; a set override always wins. Changes save immediately.</p></div>` : ""}
      ${permissionAccounts}
    </div>`;
  return page("administrator", "roles", body);
}

function rememberOpenPermissionGroups() {
  permissionOpenGroups[selectedPermissionRole] = [...app.querySelectorAll(".permission-group[open]")]
    .map((group) => group.dataset.permissionGroup);
}

function hasUnsavedPermissionChanges() {
  return Object.entries(permissionDrafts).some(([role, draft]) =>
    PERMISSION_DEFS.some(({ id }) => draft[id] !== Boolean(data.permissions[role]?.[id])),
  );
}

function confirmLeaveWithUnsavedPermissions() {
  return !hasUnsavedPermissionChanges() || window.confirm(
    "You have unsaved role permission changes. Leave without saving? Your changes will be discarded.",
  );
}

function activityLogPage() {
  const rows = [...data.activities].sort((a, b) => asDate(b.at) - asDate(a.at));
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat("Recorded activity", rows.length, "Workspace activity"),
        stat("Account changes", rows.filter((item) => /account|role|profile/i.test(item.action)).length, "User and role updates"),
        stat("Report activity", rows.filter((item) => /report|concern/i.test(`${item.action} ${item.detail}`)).length, "Concern workflows"),
        stat("Service activity", rows.filter((item) => /collection|schedule/i.test(`${item.action} ${item.detail}`)).length, "Collection workflows"),
      ])}
      ${panel("Activity Log", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search activity</span><input class="input" type="search" data-search-input autocomplete="off"></label><button class="button secondary small" type="button" data-action="export-activity-log">${icon("download")} Export CSV</button></div>
      <div class="records mt-16" data-page-size="10" role="table" aria-label="Activity log"><div class="record-row record-head activity-record-head" role="row"><span role="columnheader">Person and activity</span><span role="columnheader">Date and time</span><span role="columnheader">Workspace</span><span role="columnheader">Result</span><span role="columnheader"></span></div>
        ${rows.map((item) => `<div class="record-row activity-record filter-item" role="row" data-search="${esc(`${item.actor} ${item.action} ${item.detail} ${item.role} ${item.result}`.toLowerCase())}"><div role="cell"><strong class="record-primary">${esc(item.action)}</strong><span class="record-secondary">${esc(item.actor)} · ${esc(item.detail)}</span></div><div class="record-date" role="cell" data-label="Date and time">${esc(dateTimeLabel(item.at))}</div><div class="record-meta" role="cell" data-label="Workspace">${esc(ROLES[item.role] || item.role)}</div><div role="cell" data-label="Result">${statusPill("active", item.result)}</div><div role="cell" data-label=""></div></div>`).join("") || `<div class="empty-state"><strong>No activity recorded</strong>Actions recorded in this workspace will appear here.</div>`}
      </div>`, { subtitle: "Actions recorded in this workspace" })}
    </div>`;
  return page("administrator", "activity", body);
}

function loginMarkup() {
  return `
    <main class="login-page" id="main-content">
      <section class="login-story" aria-label="About CommUnity">
        <div class="auth-brand">
          ${brandMark()}
          <div class="auth-brand-copy"><strong>CommUnity</strong><span>Palsara community desk</span></div>
        </div>
      </section>
      <section class="login-pane" aria-labelledby="login-title">
        <div class="login-box">
          <h1 id="login-title">Sign in to CommUnity</h1>
          <form class="login-form" id="login-form">
            ${inputField("Email address", "email", "", { required: true, type: "email", autocomplete: "username" })}
            <div class="form-field"><label for="password">Password</label><div class="password-field"><input class="input" id="password" name="password" type="password" required autocomplete="current-password"><button class="password-toggle" type="button" data-action="toggle-password" aria-label="Show password">${icon("eye")}</button></div></div>
            <div class="remember-line"><label><input type="checkbox" name="remember"> Keep me signed in on this device</label><button class="text-button" type="button" data-action="forgot-password">Forgot password?</button></div>
            <button class="button" type="submit">Sign in</button>
          </form>
          <p class="login-register">New to CommUnity? <a href="#/register">Create a resident account</a></p>
        </div>
      </section>
    </main>`;
}

function forgotPasswordMarkup() {
  return `
    <main class="login-page" id="main-content">
      <section class="login-story" aria-label="About CommUnity">
        <div class="auth-brand">
          ${brandMark()}
          <div class="auth-brand-copy"><strong>CommUnity</strong><span>Palsara community desk</span></div>
        </div>
      </section>
      <section class="login-pane" aria-labelledby="forgot-title"><div class="login-box">
        <h1 id="forgot-title">Forgot password</h1>
        <p class="field-help">Enter the recovery email tied to your account. If an account uses that recovery email, a password reset link will be sent to it.</p>
        <form class="login-form" id="forgot-password-form">
          ${inputField("Recovery email", "recoveryEmail", "", { required: true, type: "email", autocomplete: "email" })}
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Send reset request</button></div>
        </form>
      </div></section>
    </main>`;
}

function resetPasswordMarkup(token) {
  return `
    <main class="login-page" id="main-content">
      <section class="login-story" aria-label="About CommUnity">
        <div class="auth-brand">
          ${brandMark()}
          <div class="auth-brand-copy"><strong>CommUnity</strong><span>Palsara community desk</span></div>
        </div>
      </section>
      <section class="login-pane" aria-labelledby="reset-title"><div class="login-box">
        <h1 id="reset-title">Reset password</h1>
        <p class="field-help">Enter your new password.</p>
        <form class="login-form" id="reset-password-form">
          <input type="hidden" name="token" value="${esc(token)}">
          ${inputField("New password", "newPassword", "", { required: true, type: "password", minLength: 8, autocomplete: "new-password" })}
          ${inputField("Confirm new password", "confirmPassword", "", { required: true, type: "password", minLength: 8, autocomplete: "new-password" })}
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Reset password</button></div>
        </form>
      </div></section>
    </main>`;
}

function registerMarkup() {
  return `
    <main class="login-page" id="main-content">
      <section class="login-story" aria-label="About CommUnity">
        <div class="auth-brand">
          ${brandMark()}
          <div class="auth-brand-copy"><strong>CommUnity</strong><span>Palsara community desk</span></div>
        </div>
      </section>
      <section class="login-pane" aria-labelledby="register-title"><div class="register-box">
        <h1 id="register-title">Create a resident account</h1>
        <form class="form-stack" id="register-form">
          <div class="form-grid">${inputField("Full name", "name", "", { required: true, autocomplete: "name" })}${inputField("Email address", "email", "", { required: true, type: "email", autocomplete: "email" })}${inputField("Contact number", "phone", "", { type: "tel", autocomplete: "tel" })}${selectField("Purok or area", "area", AREAS, "", { required: true })}${inputField("Password", "password", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}${inputField("Confirm password", "confirmPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}</div>
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Create account</button></div>
        </form>
      </div></section>
    </main>`;
}
