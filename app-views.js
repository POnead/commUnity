"use strict";

function navGroups(role) {
  const groups = role === "resident" ? [
    { title: "Community", links: [["dashboard", "Overview", "home"], ["collection", "Garbage collection", "calendar"], ["recycling", "Recycling directory", "leaf"], ["report", "Report a concern", "flag"]] },
    { title: "Your activity", links: [["reports", "My reports", "clipboard"], ["history", "Report history", "clock"], ["notifications", "Notifications", "bell", unreadCount()]] },
    { title: "Account", links: [["profile", "Profile", "user"]] },
  ] : role === "official" ? [
    { title: "Community", links: [["dashboard", "Overview", "home"], ["concerns", "Community concerns", "clipboard"], ["urgent", "Urgent concerns", "alert"]] },
    { title: "Services", links: [["collection", "Garbage collection", "calendar"], ["history", "Report history", "clock"], ["announcements", "Announcements", "activity"], ["notifications", "Notifications", "bell", unreadCount()]] },
    { title: "Account", links: [["profile", "Profile", "user"]] },
  ] : [
    { title: "Administration", links: [["dashboard", "Overview", "home"], ["reports", "Community reports", "clipboard"], ["monitoring", "System monitoring", "activity"], ["users", "User management", "users"], ["locations", "Locations & recycling", "pin"], ["announcements", "Announcements", "activity"], ["roles", "Role management", "shield"], ["audit", "Audit activity", "activity"], ["settings", "System settings", "settings"]] },
    { title: "Updates", links: [["notifications", "Notifications", "bell", unreadCount()]] },
    { title: "Account", links: [["profile", "Profile", "user"]] },
  ];
  return groups.map((group) => ({ ...group, links: group.links.filter(([key]) => canOpenPage(role, key)) }));
}
function requiredPermission(role, pageName) {
  const map = {
    resident: { collection: "viewSchedules", report: "submitReports", reports: "submitReports", history: "submitReports" },
    official: { concerns: "manageReports", urgent: "manageReports", history: "manageReports", collection: "manageSchedules", announcements: "manageAnnouncements" },
    administrator: { reports: "manageReports", monitoring: "manageReports", users: "manageUsers", locations: "manageUsers", announcements: "manageAnnouncements", roles: "manageRoles", audit: "viewAudit" },
  };
  return map[role]?.[pageName] || "";
}

function canOpenPage(role, pageName) {
  const permission = requiredPermission(role, pageName);
  return !permission || Boolean(data.permissions?.[role]?.[permission]);
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
        ${group.links.map(([key, label, iconName, count]) => `
          <a class="nav-link ${key === page ? "active" : ""}" href="${routeUrl(role, key)}" ${key === page ? 'aria-current="page"' : ""}>
            ${icon(iconName)}<span>${esc(label)}</span>${count ? `<span class="nav-count" aria-label="${count} unread">${count}</span>` : ""}
          </a>`).join("")}
      </nav>
    </div>`).join("");
}

function pageTitle(role, page) {
  const titles = {
    resident: {
      dashboard: ["Your community today", "Service updates and a clear view of your reports."],
      collection: ["Garbage collection", "Check your area's collection schedule and service updates."],
      recycling: ["Recycling and junkshops", "Find nearby places that accept reusable and recyclable materials."],
      report: ["Report a concern", "Share what happened and where."],
      reports: ["My reports", "Follow the progress of concerns you have submitted."],
      history: ["Report history", "Review previous concerns and the actions recorded."],
      notifications: ["Notifications", "Updates for your reports and barangay services."],
      profile: ["Your profile", "Keep your contact and area details up to date."],
    },
    official: {
      dashboard: ["Barangay overview", "The latest concerns and collection activity across the community."],
      concerns: ["Community concerns", "Review resident reports and record the next step."],
      urgent: ["Urgent concerns", "Hazards flagged by residents for prompt review."],
      collection: ["Collection management", "Maintain schedules and post service-status changes."],
      history: ["Report history", "Review concern updates recorded by the barangay."],
      notifications: ["Notifications", "New concerns and service updates for your team."],
      announcements: ["Announcements", "Publish service notices for residents and staff."],
      profile: ["Your profile", "Keep your official account details up to date."],
    },
    administrator: {
      dashboard: ["System overview", "A concise view of accounts and recent activity."],
      reports: ["Community reports", "Monitor concerns submitted by residents across the barangay."],
      monitoring: ["System monitoring", "Review report activity, collection schedules, and workspace availability."],
      users: ["User management", "Review accounts and adjust access."],
      locations: ["Locations and recycling", "Manage resident areas and nearby recycling or junkshop listings."],
      announcements: ["Announcements", "Publish service notices for residents and staff."],
      roles: ["Role management", "Review the permissions shown in each workspace."],
      audit: ["Audit activity", "A record of account and service activity."],
      settings: ["System settings", "Manage accounts, roles, and service information."],
      profile: ["Your profile", "Keep your administrator account details up to date."],
      notifications: ["Notifications", "Report and service updates for this account."],
    },
  };
  return titles[role]?.[page] || ["CommUnity", "Barangay services and community updates."];
}

function shell(role, page, title, description, body, actions = "") {
  const roleLabel = ROLES[role];
  const unread = unreadCount();
  const date = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  const account = `<div class="user-chip"><div class="avatar" aria-hidden="true">${esc(initials(currentUser.name))}</div><div class="user-chip-copy"><strong>${esc(currentUser.name)}</strong><span>${esc(roleLabel)}</span></div></div>`;
  return `
    <div class="workspace">
      <header class="topbar">
        <div class="topbar-leading">
          <button class="icon-button mobile-menu-button" type="button" data-action="toggle-menu" aria-label="Open navigation" aria-expanded="false" aria-controls="mobile-navigation">${icon("menu")}</button>
          <div class="crumb"><span>CommUnity</span><span class="crumb-separator" aria-hidden="true">/</span><strong>${esc(roleLabel)}</strong></div>
        </div>
        <div class="topbar-actions">
          <span class="topbar-date">${esc(date)}</span>
          <a class="icon-button notification-button" href="${routeUrl(role, "notifications")}" aria-label="Notifications${unread ? `, ${unread} unread` : ""}">${icon("bell")}${unread ? '<span class="notification-dot" aria-hidden="true"></span>' : ""}</a>
          <button class="icon-button" type="button" data-action="logout" aria-label="Sign out">${icon("logout")}</button>
        </div>
      </header>
      <div class="workspace-layout">
        <aside class="sidebar" aria-label="Main navigation">
          <a class="brand-lockup" href="${routeUrl(role, "dashboard")}">
            ${brandMark()}
            <span><span class="brand-name">CommUnity</span><span class="brand-caption">Balete community desk</span></span>
          </a>
          <div class="sidebar-place">${icon("pin")}<span>${role === "resident" ? esc(currentUser.area || "Balete, Batangas") : "Balete, Batangas"}</span></div>
          ${navMarkup(role, page)}
          <div class="sidebar-bottom">
            ${account}
          </div>
        </aside>
        <main class="workspace-main" id="main-content" tabindex="-1">
          <header class="page-heading">
            <div class="page-title-block"><h1>${esc(title)}</h1><p>${esc(description)}</p></div>
            ${actions ? `<div class="page-heading-actions">${actions}</div>` : ""}
          </header>
          ${body}
          <footer class="small muted mt-20">CommUnity · Balete, Batangas</footer>
        </main>
      </div>
      <div class="mobile-drawer-backdrop" id="mobile-navigation" hidden>
        <aside class="mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
          <div class="mobile-drawer-header">
            <a class="brand-lockup" href="${routeUrl(role, "dashboard")}">${brandMark()}<span><span class="brand-name">CommUnity</span><span class="brand-caption">Balete community desk</span></span></a>
            <button class="icon-button" type="button" data-action="close-menu" aria-label="Close navigation">${icon("close")}</button>
          </div>
          <div class="sidebar-place">${icon("pin")}<span>${role === "resident" ? esc(currentUser.area || "Balete, Batangas") : "Balete, Batangas"}</span></div>
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
  return `<section class="panel ${options.className || ""}"><header class="panel-head"><div><h2>${esc(title)}</h2>${options.subtitle ? `<p>${esc(options.subtitle)}</p>` : ""}</div>${options.action || ""}</header><div class="panel-body">${body}</div></section>`;
}

function emergencyNotice() {
  return `<div class="notice" data-tone="warning">${icon("alert", "notice-icon")}<div class="notice-copy"><strong>Immediate danger?</strong><span>${EMERGENCY_GUIDANCE}</span></div></div>`;
}

function reportRows(reports, role) {
  if (!reports.length) return `<div class="empty-state"><strong>No concerns in this view</strong>When a report is submitted, it will appear here.</div>`;
  const headers = role === "resident"
    ? ["Concern", "Affected area", "Date submitted", "Status", "Action"]
    : ["Concern", "Resident", "Affected area", "Status", "Action"];
  const cells = reports.map((report) => {
    const first = `<div role="cell"><button class="text-button record-primary" type="button" data-action="view-report" data-id="${esc(report.id)}">${esc(report.title)}</button><span class="record-secondary">${esc(report.id)}${report.urgent ? " · Urgent" : ""}</span></div>`;
    const second = role === "resident"
      ? `<div class="record-meta" role="cell" data-label="Affected area">${esc(report.area)}</div>`
      : `<div class="record-meta" role="cell" data-label="Resident">${esc(report.name)}</div>`;
    const third = role === "resident"
      ? `<div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(report.submittedAt))}</div>`
      : `<div class="record-meta" role="cell" data-label="Area">${esc(report.area)}<span class="record-secondary">${esc(dateLabel(report.submittedAt))}</span></div>`;
    return `<div class="record-row filter-item" role="row" data-search="${esc(`${report.id} ${report.title} ${report.category} ${report.name} ${report.barangay || ""} ${report.area} ${report.locationDetail || ""} ${report.status}`.toLowerCase())}">
      ${first}${second}${third}<div role="cell" data-label="Status">${statusPill(report.status)}${report.urgent ? `<span class="visually-hidden"> Urgent concern.</span>` : ""}</div>
      <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>
    </div>`;
  }).join("");
  return `<div class="records" data-page-size="10" role="table" aria-label="Community concerns"><div class="record-row record-head" role="row">${headers.map((header) => `<span role="columnheader">${esc(header)}</span>`).join("")}</div>${cells}</div>`;
}

function reportFilters(reports) {
  const options = [["all", "All reports"], ["Submitted", "Submitted"], ["Under Review", "Under review"], ["In Progress", "In progress"], ["Resolved", "Resolved"]];
  return `<div class="filter-row" role="group" aria-label="Filter reports">${options.map(([value, label]) => {
    const count = value === "all" ? reports.length : reports.filter((report) => report.status === value).length;
    return `<button type="button" class="filter-button ${reportFilter === value ? "selected" : ""}" data-action="filter-reports" data-value="${esc(value)}" aria-pressed="${reportFilter === value}">${esc(label)} <span class="filter-count">${count}</span></button>`;
  }).join("")}</div>`;
}

function searchToolbar(label = "Search concerns by report ID, resident or description") {
  return `<div class="toolbar mt-16"><label class="search-field">${icon("search")}<span class="visually-hidden">${esc(label)}</span><input class="input" type="search" data-search-input placeholder="Search reports…" autocomplete="off"></label></div>`;
}

function timelineMarkup(history) {
  return `<ol class="timeline">${history.map((item, index) => `
    <li class="timeline-item ${index === 0 ? "" : "future"}"><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-copy"><strong>${esc(item.status)}</strong><span>${esc(item.note)} · ${esc(dateTimeLabel(item.at))}</span></div></li>`).join("")}</ol>`;
}

function reportDetail(report, role) {
  const isResident = role === "resident";
  const statusForm = role === "official" ? `
    <form class="form-stack" id="report-status-form">
      <input type="hidden" name="reportId" value="${esc(report.id)}">
      ${selectField("Update status", "status", STATUSES, report.status)}
      <div class="form-field"><label for="status-note">Update for the resident</label><textarea class="textarea" id="status-note" name="note" maxlength="400" placeholder="Add a short, clear update about the next step."></textarea></div>
      <div class="form-actions"><button class="button" type="submit">Save report update</button></div>
    </form>` : "";
  const photos = (report.photos || []).length
    ? `<div class="photo-preview">${report.photos.map((photo) => `<a class="photo-thumb" href="${photo.data}" target="_blank" rel="noreferrer" aria-label="Open report photo ${esc(photo.name)}"><img src="${photo.data}" alt="Photo attached to ${esc(report.id)}"></a>`).join("")}</div>`
    : `<p class="muted small">No photo was attached to this report.</p>`;
  const body = `
    <div class="content-stack">
      ${report.urgent ? `<div class="notice" data-tone="danger">${icon("alert", "notice-icon")}<div class="notice-copy"><strong>Urgent concern</strong><span>The resident flagged this report as a possible immediate hazard. Follow the established barangay response process.</span></div></div>` : ""}
      <div class="profile-layout">
        <div class="content-stack">
          <section class="panel"><div class="panel-body">
            <div class="inline-between"><div><h2 class="report-detail-title">${esc(report.title)}</h2><p class="record-secondary report-detail-id">${esc(report.id)} · ${esc(report.category)}</p></div>${statusPill(report.status)}</div>
            <p class="report-description">${esc(report.description)}</p>
            <div class="notice-bar"><span>Barangay</span><strong>${esc(report.barangay || "—")}</strong></div>
            <div class="notice-bar mt-16"><span>Purok or area</span><strong>${esc(report.area)}</strong></div>
            <div class="notice-bar mt-16"><span>Street or landmark</span><strong>${esc(report.locationDetail || "Not provided")}</strong></div>
            <div class="inline-between mt-16"><span class="muted small">Submitted ${esc(dateTimeLabel(report.submittedAt))}</span><span class="muted small">Updated ${esc(dateTimeLabel(report.updatedAt))}</span></div>
          </div></section>
          ${panel("Attached photos", photos)}
          ${role === "official" ? panel("Record an update", statusForm) : ""}
        </div>
        <div class="content-stack">
          ${role !== "resident" ? `<section class="panel"><header class="panel-head"><div><h2>Reported by</h2></div></header><div class="panel-body"><div class="account-summary"><div class="avatar" aria-hidden="true">${esc(initials(report.name))}</div><div><strong>${esc(report.name)}</strong><span>${esc((getUser(report.userEmail)?.area || report.area) + " · Resident")}</span><span>${esc(report.userEmail)}</span></div></div></div></section>` : ""}
          <section class="panel"><header class="panel-head"><div><h2>Status history</h2><p>Each update recorded for this report</p></div></header><div class="panel-body">${timelineMarkup(report.history)}</div></section>
          ${isResident ? emergencyNotice() : ""}
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
  const active = reports.filter((report) => report.status !== "Resolved");
  const urgent = active.filter((report) => report.urgent).length;
  const inProgress = reports.filter((report) => report.status === "In Progress").length;
  const resolved = reports.filter((report) => report.status === "Resolved").length;
  const next = upcomingSchedule(currentUser.area);
  const latest = sortedReports(reports).slice(0, 4);
  const actions = linkButton(`${icon("plus")} Report a concern`, routeUrl("resident", "report"), "");
  const body = `
    <div class="content-stack">
      <section class="welcome-panel">
        <div><h2>Good to see you, ${esc(currentUser.name.split(" ")[0])}.</h2><p>See what is happening around ${esc(currentUser.area || "your community")} today.</p></div>
        <div class="welcome-user"><div class="avatar large" aria-hidden="true">${esc(initials(currentUser.name))}</div><div><strong>${esc(currentUser.name)}</strong><small>Resident · ${esc(currentUser.area || "Balete, Batangas")}</small></div></div>
      </section>
      ${statsStrip([
        stat("Submitted concerns", reports.length, "Reports you've shared"),
        stat("Need attention", urgent, urgent ? "Urgent reports you filed" : "No urgent reports", urgent ? "danger" : ""),
        stat("In progress", inProgress, "Being followed up"),
        stat("Resolved", resolved, "Marked as addressed", resolved ? "success" : ""),
      ])}
      <div class="grid-main-side">
        <div class="content-stack">
          ${panel("Your latest reports", `<div class="quick-list">${latest.map((report) => `<div class="report-item"><span class="item-mark">${icon(report.urgent ? "alert" : "clipboard")}</span><div class="item-copy"><strong class="truncate">${esc(report.title)}</strong><span>${esc(report.id)} · ${esc(dateLabel(report.updatedAt))}</span></div>${statusPill(report.status)}<button class="icon-button" type="button" data-action="view-report" data-id="${esc(report.id)}" aria-label="View ${esc(report.id)}">${icon("arrow")}</button></div>`).join("") || `<div class="empty-state"><strong>No reports yet</strong>When you share a concern, its updates will appear here.</div>`}</div><div class="form-actions">${linkButton("View all reports", routeUrl("resident", "reports"), "secondary", "small")}</div>`, { subtitle: "Updates from reports you have submitted" })}
          ${panel("Announcements", `<ul class="plain-list">${data.announcements.map((item) => `<li><div><strong class="announcement-title">${esc(item.title)}</strong><div class="muted small">${esc(item.detail)}</div></div><span class="muted small">${esc(dateLabel(item.date, { month: "short", day: "numeric" }))}</span></li>`).join("")}</ul>`, { subtitle: "Notes shared by your barangay" })}
        </div>
        <div class="content-stack">
          ${panel("Next collection", next ? `<div class="account-summary"><span class="item-mark">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.wasteType)} · ${esc(next.start)}–${esc(next.end)}</span><span>${esc(next.area)} · ${esc(next.zone)}</span></div></div><div class="status-line mt-16">${statusPill(next.status)}<span class="muted small">${esc(next.team)}</span></div><div class="form-actions">${linkButton("View collection schedule", routeUrl("resident", "collection"), "secondary", "small")}</div>` : `<div class="empty-state"><strong>No upcoming pickup posted</strong>Check back for a schedule update from your barangay.</div>`)}
          ${panel("Quick actions", `<div class="quick-list"><a class="quick-item" href="${routeUrl("resident", "report")}"><span class="item-mark">${icon("flag")}</span><span class="item-copy"><strong>Report a concern</strong><span>Send details to your barangay</span></span>${icon("arrow")}</a><a class="quick-item" href="${routeUrl("resident", "reports")}"><span class="item-mark">${icon("clipboard")}</span><span class="item-copy"><strong>Track your reports</strong><span>See the latest status update</span></span>${icon("arrow")}</a></div>`)}
          ${emergencyNotice()}
        </div>
      </div>
    </div>`;
  return page("resident", "dashboard", body, actions);
}

function dashboardOfficial() {
  const open = data.reports.filter((report) => report.status !== "Resolved");
  const urgent = open.filter((report) => report.urgent);
  const pending = open.filter((report) => report.status === "Submitted" || report.status === "Under Review");
  const inProgress = data.reports.filter((report) => report.status === "In Progress");
  const resolved = data.reports.filter((report) => report.status === "Resolved");
  const latest = sortedReports().slice(0, 5);
  const next = upcomingSchedule("");
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat("All concerns", data.reports.length, "Recorded concerns"),
        stat("Urgent concerns", urgent.length, urgent.length ? "Open hazards to review" : "No open urgent reports", urgent.length ? "danger" : ""),
        stat("Awaiting review", pending.length, "Submitted or under review", pending.length ? "warning" : ""),
        stat("In progress", inProgress.length, `${resolved.length} resolved`, resolved.length ? "success" : ""),
      ])}
      ${urgent.length ? `<div class="notice" data-tone="danger">${icon("alert", "notice-icon")}<div class="notice-copy"><strong>${urgent.length} open urgent ${urgent.length === 1 ? "concern" : "concerns"}</strong><span>${esc(urgent.slice(0, 2).map((report) => `${report.title} · ${report.area}`).join(" / "))}. Review and coordinate through barangay response procedures.</span></div>${linkButton("Review urgent", routeUrl("official", "urgent"), "secondary", "small")}</div>` : ""}
      <div class="grid-main-side">
        ${panel("Recent concerns", `<div class="quick-list">${latest.map((report) => `<div class="report-item"><span class="item-mark">${icon(report.urgent ? "alert" : "clipboard")}</span><div class="item-copy"><strong class="truncate">${esc(report.title)}</strong><span>${esc(report.id)} · ${esc(report.name)} · ${esc(report.area)}</span></div>${statusPill(report.urgent ? "urgent" : report.status, report.urgent ? "Urgent" : report.status)}<button class="icon-button" type="button" data-action="view-report" data-id="${esc(report.id)}" aria-label="Review ${esc(report.id)}">${icon("arrow")}</button></div>`).join("")}</div><div class="form-actions">${linkButton("View all concerns", routeUrl("official", "concerns"), "secondary", "small")}</div>`, { subtitle: "Most recently submitted and updated" })}
        <div class="content-stack">
          ${panel("Collection service", next ? `<div class="account-summary"><span class="item-mark">${icon("calendar")}</span><div><strong>${esc(next.area)} · ${esc(next.wasteType)}</strong><span>${esc(dateLabel(next.date, { weekday: "long", month: "short", day: "numeric" }))} · ${esc(next.start)}–${esc(next.end)}</span><span>${esc(next.zone)} · ${esc(next.team)}</span></div></div><div class="status-line mt-16">${statusPill(next.status)}</div><div class="form-actions">${linkButton("Manage schedules", routeUrl("official", "collection"), "secondary", "small")}</div>` : `<div class="empty-state">No future collections are scheduled.</div>`)}
          ${panel("Team activity", `<div class="activity-list">${data.activities.slice(0, 3).map((item) => `<div class="activity-item"><span class="item-mark">${icon(item.action.toLowerCase().includes("concern") ? "flag" : "activity")}</span><div class="item-copy"><strong>${esc(item.action)}</strong><span>${esc(item.detail)} · ${esc(dateTimeLabel(item.at))}</span></div></div>`).join("")}</div>`, { action: `<a href="${routeUrl("official", "history")}">Report history</a>` })}
        </div>
      </div>
    </div>`;
  return page("official", "dashboard", body, linkButton(`${icon("clipboard")} Review concerns`, routeUrl("official", "concerns"), ""));
}

function dashboardAdmin() {
  const residentCount = data.users.filter((user) => user.role === "resident").length;
  const officialCount = data.users.filter((user) => user.role === "official").length;
  const activeCount = data.users.filter((user) => user.status === "Active").length;
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat("User accounts", data.users.length, `${activeCount} active in this workspace`),
        stat("Residents", residentCount, "Resident accounts"),
        stat("Barangay officials", officialCount, "Official accounts"),
        stat("Community reports", data.reports.length, "Recorded concerns"),
      ])}
      <div class="grid-main-side">
        ${panel("Recent activity", `<div class="activity-list">${data.activities.slice(0, 6).map((item) => `<div class="activity-item"><span class="item-mark">${icon(item.action.toLowerCase().includes("account") ? "users" : "activity")}</span><div class="item-copy"><strong>${esc(item.action)}</strong><span>${esc(item.actor)} · ${esc(item.detail)}</span></div><span class="item-end">${esc(dateTimeLabel(item.at))}</span></div>`).join("")}</div><div class="form-actions">${linkButton("View audit activity", routeUrl("administrator", "audit"), "secondary", "small")}</div>`, { subtitle: "Latest changes in this workspace" })}
        <div class="content-stack">
          ${panel("Workspace status", `<ul class="plain-list"><li><span>Database</span>${statusPill("active", "Available")}</li><li><span>Last activity</span><strong class="small">${data.activities.length ? esc(dateTimeLabel(data.activities[0].at)) : "—"}</strong></li></ul>`)}
          ${panel("Account roles", `<ul class="plain-list">${Object.entries(ROLES).map(([role, label]) => `<li><span>${esc(label)}</span><strong class="num">${data.users.filter((user) => user.role === role).length}</strong></li>`).join("")}</ul><div class="form-actions">${linkButton("Manage users", routeUrl("administrator", "users"), "secondary", "small")}</div>`)}
          <div class="notice" data-tone="success">${icon("shield", "notice-icon")}<div class="notice-copy"><strong>Protected workspace</strong><span>Sign-in and role access are enforced by the server. Review reports, locations, and service information from the administration menu.</span></div></div>
        </div>
      </div>
    </div>`;
  return page("administrator", "dashboard", body, linkButton(`${icon("users")} Manage users`, routeUrl("administrator", "users"), ""));
}

function collectionResident() {
  const schedules = sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area);
  const next = upcomingSchedule(currentUser.area);
  const body = `
    <div class="content-stack">
      <div class="grid-main-side">
        ${panel("Your next collection", next ? `<div class="account-summary"><span class="item-mark">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.wasteType)} · ${esc(next.start)}–${esc(next.end)}</span><span>${esc(next.area)} · ${esc(next.zone)}</span></div></div><div class="status-line mt-16">${statusPill(next.status)}<span class="muted small">${esc(next.team)}</span></div>` : `<div class="empty-state"><strong>No upcoming collection posted</strong>Your barangay will appear here when a schedule is available.</div>`)}
        <div class="notice" data-tone="warning">${icon("bell", "notice-icon")}<div class="notice-copy"><strong>In-app collection reminders</strong><span>A reminder is added to your notifications the day before an eligible pickup. Collection status is maintained by barangay staff; SMS and live route updates are not available.</span></div></div>
      </div>
      ${panel("Collection schedule", `${scheduleRows(schedules)}`, { subtitle: "Upcoming collections for your selected area" })}
      ${panel("Missed collection?", `<p class="muted">If your scheduled pickup was missed, send the barangay a report so the team can check the route.</p><div class="form-actions">${linkButton(`${icon("flag")} Report a missed pickup`, routeUrl("resident", "report"), "")}</div>`)}
    </div>`;
  return page("resident", "collection", body);
}

function recyclingPage() {
  const listings = data.recyclingLocations.filter((item) => item.active);
  const body = `
    <div class="content-stack">
      ${listings.length ? `<section class="panel"><div class="records" data-page-size="10" role="table" aria-label="Recycling and junkshop directory">
        <div class="record-row record-head" role="row"><span role="columnheader">Business or site</span><span role="columnheader">Location</span><span role="columnheader">Accepted materials</span><span role="columnheader">Contact</span><span role="columnheader">Hours</span></div>
        ${listings.map((item) => `<div class="record-row filter-item" role="row" data-search="${esc(`${item.name} ${item.barangay} ${item.street} ${item.purok} ${item.landmark} ${item.materials}`.toLowerCase())}">
          <div role="cell"><strong class="record-primary">${esc(item.name)}</strong><span class="record-secondary">${esc(item.landmark || item.purok || item.barangay)}</span></div>
          <div class="record-meta" role="cell" data-label="Location">${esc([item.street, item.purok, item.barangay].filter(Boolean).join(", "))}</div>
          <div class="record-meta" role="cell" data-label="Accepted materials">${esc(item.materials)}</div>
          <div class="record-meta" role="cell" data-label="Contact">${esc(item.phone || "Not listed")}</div>
          <div class="record-meta" role="cell" data-label="Hours">${esc(item.hours || "Not listed")}</div>
        </div>`).join("")}
      </div></section>` : `<div class="empty-state"><strong>No recycling locations listed yet</strong>Check back after the barangay verifies nearby recycling and junkshop details.</div>`}
      <div class="notice" data-tone="warning">${icon("leaf", "notice-icon")}<div class="notice-copy"><strong>Confirm details before visiting.</strong><span>Listings are provided by the barangay and may change. CommUnity does not verify opening hours in real time.</span></div></div>
    </div>`;
  return page("resident", "recycling", body);
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
    ${panel("Resident areas", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search community locations</span><input class="input" type="search" data-search-input placeholder="Search areas, streets, or landmarks…" autocomplete="off"></label></div>
      <div class="records mt-16" data-page-size="10" role="table" aria-label="Community areas"><div class="record-row record-head" role="row"><span role="columnheader">Area and barangay</span><span role="columnheader">Street</span><span role="columnheader">Purok</span><span role="columnheader">Landmark</span><span role="columnheader">Action</span></div>${locationRows || `<div class="empty-state"><strong>No areas configured</strong>Add an area before residents register or file reports.</div>`}</div>`,
      { subtitle: "Manage the areas residents can select for accounts, reports, and collection schedules.", action: actionButton(`${icon("plus")} Add area`, "add-location", "small") })}
    ${panel("Recycling and junkshop directory", `<div class="records" data-page-size="10" role="table" aria-label="Recycling locations"><div class="record-row record-head" role="row"><span role="columnheader">Business or site</span><span role="columnheader">Location</span><span role="columnheader">Contact</span><span role="columnheader">Visibility</span><span role="columnheader">Action</span></div>${recyclingRows || `<div class="empty-state"><strong>No directory listings</strong>Add verified recycling or junkshop information for residents.</div>`}</div>`,
      { subtitle: "Only active listings appear in the resident directory.", action: actionButton(`${icon("plus")} Add listing`, "add-recycling", "small") })}
  </div>`;
  return page("administrator", "locations", body);
}

function announcementsPage(role) {
  const isManager = role === "official" || role === "administrator";
  const announcements = [...data.announcements].sort((a, b) => asDate(b.date) - asDate(a.date));
  const rows = announcements.map((item) => `<div class="record-row filter-item" role="row" data-search="${esc(`${item.title} ${item.detail}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(item.title)}</strong><span class="record-secondary">${esc(item.detail)}</span></div>
    <div class="record-date" role="cell" data-label="Publish date">${esc(dateLabel(item.date))}</div>
    ${isManager ? `<div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-announcement" data-id="${esc(item.id)}">Edit</button></div>` : ""}
  </div>`).join("");
  const body = `<div class="content-stack">
    ${panel("Community announcements", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search announcements</span><input class="input" type="search" data-search-input placeholder="Search announcements…" autocomplete="off"></label></div>
      <div class="records mt-16" data-page-size="10" role="table" aria-label="Announcements"><div class="record-row record-head" role="row"><span role="columnheader">Announcement</span><span role="columnheader">Date</span>${isManager ? '<span role="columnheader">Action</span>' : ""}</div>${rows || `<div class="empty-state"><strong>No announcements yet</strong>Updates published by barangay staff will appear here.</div>`}</div>`,
      { subtitle: isManager ? "Create or update a notice for residents and staff." : "Service information shared by barangay staff.", action: isManager ? actionButton(`${icon("plus")} New announcement`, "add-announcement", "small") : "" })}
  </div>`;
  return page(role, "announcements", body);
}

function monitoringPage() {
  const reports = data.reports;
  const schedules = sortedSchedules(data.schedules);
  const open = reports.filter((report) => report.status !== "Resolved");
  const due = schedules.filter((item) => item.date >= todayISO() && !["Completed", "Cancelled"].includes(item.status));
  const body = `<div class="content-stack">
    ${statsStrip([
      stat("Database", "Available", "Latest server data loaded", "success"),
      stat("Open reports", open.length, `${reports.length} total reports`),
      stat("Urgent reports", open.filter((report) => report.urgent).length, "Need prompt review"),
      stat("Upcoming collections", due.length, "Scheduled or in progress"),
    ])}
    <div class="grid-main-side">
      ${panel("Report status", `<ul class="plain-list">${STATUSES.map((status) => `<li><span>${esc(status)}</span><strong class="num">${reports.filter((report) => report.status === status).length}</strong></li>`).join("")}</ul><div class="form-actions">${linkButton("Open community reports", routeUrl("administrator", "reports"), "secondary", "small")}</div>`, { subtitle: "Counts from the current database snapshot" })}
      ${panel("Collection service", `<ul class="plain-list">${COLLECTION_STATUSES.map((status) => `<li><span>${esc(status)}</span><strong class="num">${schedules.filter((item) => item.status === status).length}</strong></li>`).join("")}</ul><div class="form-actions">${linkButton("Manage locations and listings", routeUrl("administrator", "locations"), "secondary", "small")}</div>`, { subtitle: "Schedules and statuses currently stored" })}
    </div>
    <div class="notice" data-tone="warning">${icon("activity", "notice-icon")}<div class="notice-copy"><strong>Monitoring reflects the latest saved data.</strong><span>Service statuses are maintained by staff. This page does not provide live vehicle tracking, SMS delivery, or external uptime monitoring.</span></div></div>
  </div>`;
  return page("administrator", "monitoring", body);
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
      ${panel("Collection schedules", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search schedules</span><input class="input" type="search" data-search-input placeholder="Search by area, zone or service…" autocomplete="off"></label></div>${scheduleRows(schedules, true)}`, { subtitle: "Edit an existing schedule or add a collection", action: actionButton(`${icon("plus")} Add schedule`, "add-schedule", "small") })}
      <div class="notice" data-tone="warning">${icon("alert", "notice-icon")}<div class="notice-copy"><strong>Service updates appear in resident accounts.</strong><span>SMS, email, and live route updates are not available.</span></div></div>
    </div>`;
  return page("official", "collection", body);
}

function reportFormMarkup() {
  const draft = reportDraft || {};
  const defaultArea = draft.area || currentUser.area || locationAreas()[0];
  const reportBarangay = draft.barangay || data.locations.find((location) => location.area === defaultArea)?.barangay || locationBarangays()[0];
  const reportAreas = areasInBarangay(reportBarangay);
  const selectedReportArea = reportAreas.includes(draft.area || defaultArea) ? draft.area || defaultArea : reportAreas[0];
  return `
    <div class="grid-main-side">
      <section class="panel"><div class="panel-body">
        <div class="wizard-progress" aria-label="Step ${reportDraft?.step === "review" ? "2" : "1"} of 2">
          <div class="wizard-step ${reportDraft?.step === "review" ? "done" : "current"}"><strong>${reportDraft?.step === "review" ? icon("check") : "1"}</strong><span>Concern details</span></div><span class="wizard-divider"></span>
          <div class="wizard-step ${reportDraft?.step === "review" ? "current" : ""}"><strong>2</strong><span>Review & submit</span></div>
        </div>
        ${reportDraft?.step === "review" ? `
          <div class="content-stack">
            <div class="notice" data-tone="${draft.urgent ? "danger" : "success"}">${icon(draft.urgent ? "alert" : "check", "notice-icon")}<div class="notice-copy"><strong>Review before you submit</strong><span>Your report will be saved to your account.</span></div></div>
            ${draft.urgent ? emergencyNotice() : ""}
            <div class="notice-bar"><span>Concern</span><strong>${esc(draft.category)}</strong></div>
            <div class="notice-bar"><span>Barangay</span><strong>${esc(draft.barangay)}</strong></div>
            <div class="notice-bar"><span>Purok or area</span><strong>${esc(draft.area)}</strong></div>
            <div class="notice-bar"><span>Street or landmark</span><strong>${esc(draft.locationDetail)}</strong></div>
            <div class="notice-bar"><span>Urgency</span><strong>${draft.urgent ? "Flagged for prompt attention" : "Standard report"}</strong></div>
            <div class="form-field"><span class="field-help">Description</span><p class="report-draft-description">${esc(draft.description)}</p></div>
            <div><span class="field-help">Photos</span>${uploadPhotos.length ? `<div class="photo-preview">${uploadPhotos.map((photo) => `<div class="photo-thumb"><img src="${photo.data}" alt="${esc(photo.name)}"></div>`).join("")}</div>` : `<p class="muted small">No photos attached.</p>`}</div>
            <div class="form-actions"><button class="button secondary" type="button" data-action="edit-report-draft">Edit details</button><button class="button" type="button" data-action="submit-report">Submit concern</button></div>
          </div>` : `
          <form id="report-draft-form" class="form-stack">
            <div class="form-grid">
              ${selectField("Concern category", "category", CATEGORIES, draft.category || "", { required: true, placeholder: "Choose a concern type", help: "Choose the closest match, or Other community concern if none fit." })}
              ${selectField("Barangay", "barangay", locationBarangays(), reportBarangay, { required: true })}
              ${selectField("Purok or area", "area", reportAreas, selectedReportArea, { required: true, labels: locationAreaLabels(), help: "Select where the issue happened; it may differ from your home area." })}
              ${inputField("Street or nearby landmark", "locationDetail", draft.locationDetail || "", { required: true, maxLength: 250, placeholder: "Help the team locate the exact spot" })}
              <div class="form-field span-all"><label for="description">Describe what happened *</label><textarea class="textarea" id="description" name="description" required minlength="12" maxlength="1200" aria-describedby="description-help" placeholder="Include details that can help the barangay understand the concern.">${esc(draft.description || "")}</textarea><span class="field-help" id="description-help">Include a location landmark if it helps identify the issue. Do not include passwords or sensitive personal information.</span></div>
              <div class="form-field span-all"><span class="field"><label for="report-photos">Attach photos (optional)</label><span class="upload-box">${icon("image")}<strong>Choose photos from this device</strong><span>JPG or PNG · Up to 5 MB each, up to 3 photos</span><input class="visually-hidden" id="report-photos" name="photos" type="file" accept="image/jpeg,image/png" multiple aria-describedby="photo-help"></span><span class="field-help" id="photo-help">Photos are resized before they are attached to your report.</span><div class="photo-preview" id="photo-preview">${uploadPhotos.map((photo, index) => `<div class="photo-thumb"><img src="${photo.data}" alt="${esc(photo.name)}"><button type="button" data-action="remove-photo" data-index="${index}" aria-label="Remove ${esc(photo.name)}">${icon("close")}</button></div>`).join("")}</div></div>
              <div class="span-all">${emergencyNotice()}</div>
              <label class="checkbox-field span-all"><input name="urgent" type="checkbox" ${draft.urgent ? "checked" : ""}><span><strong>This concern needs urgent attention</strong><span>For possible hazards such as dangerous flooding, a blocked road, or a fallen object. This flag is not an emergency dispatch service.</span></span></label>
            </div>
            <div class="form-actions"><a class="button secondary" href="${routeUrl("resident", "dashboard")}">Cancel</a><button class="button" type="submit">Review report ${icon("arrow")}</button></div>
          </form>`}
      </div></section>
      <div class="content-stack">
        ${panel("What happens next", `<ol class="plain-list"><li><span>Your concern is stored in the shared CommUnity database.</span><span class="muted small">Submitted</span></li><li><span>Assigned barangay officials and administrators receive an in-app notification.</span><span class="muted small">Staff notified</span></li><li><span>Track status changes under My reports. For immediate danger, contact emergency services directly.</span><span class="muted small">Updates</span></li></ol>`)}
      </div>
    </div>`;
}

function reportPage() {
  return page("resident", "report", reportFormMarkup());
}

function reportsPage(role, view) {
  const userRows = role === "resident" ? userReports() : data.reports;
  const selection = selectedReportId ? getReport(selectedReportId) : null;
  if (selection && (role !== "resident" || selection.userEmail === currentUser.email)) return reportDetail(selection, role);
  const filtered = view === "urgent"
    ? userRows.filter((report) => report.urgent && report.status !== "Resolved")
    : sortedReports(userRows);
  const title = view === "history" ? "Report history" : view === "urgent" ? "Urgent concerns" : role === "resident" ? "My reports" : role === "administrator" ? "Community reports" : "Community concerns";
  const subtitle = view === "history"
    ? "A complete record of submitted concerns and their latest updates."
    : view === "urgent" ? "Possible hazards residents have flagged for prompt review." : pageTitle(role, view)[1];
  const activeRows = view === "history" || view === "urgent" ? filtered : filtered.filter((report) => report.status !== "Resolved");
  const resolvedRows = view === "history" ? [] : filtered.filter((report) => report.status === "Resolved");
  const primaryAction = role === "resident"
    ? linkButton(`${icon("plus")} Report a concern`, routeUrl("resident", "report"), "")
    : "";
  const statusHelp = role === "resident" ? `<details class="context-help"><summary>What do these statuses mean?</summary><p>Statuses show the latest update recorded for each concern. They do not confirm action by barangay staff.</p><dl><div><dt>Submitted</dt><dd>Added to your account.</dd></div><div><dt>Under Review</dt><dd>Marked for review.</dd></div><div><dt>In Progress</dt><dd>Marked as being addressed.</dd></div><div><dt>Resolved</dt><dd>Marked as addressed.</dd></div></dl></details>` : "";
  const exportActions = `<div class="button-row"><button class="button secondary small" type="button" data-action="export-reports">${icon("download")} Export reports</button><button class="button secondary small" type="button" data-action="export-report-history">${icon("download")} Export history</button></div>`;
  const body = `
    <div class="content-stack">
      ${view === "urgent" ? `<div class="notice" data-tone="danger">${icon("alert", "notice-icon")}<div class="notice-copy"><strong>${activeRows.length} active ${activeRows.length === 1 ? "urgent concern" : "urgent concerns"}</strong><span>Review reports promptly and coordinate through the established response process.</span></div></div>` : ""}
      ${role === "resident" && view !== "reports" ? statsStrip([
        stat("All reports", filtered.length, "Your submitted concerns"),
        stat("Submitted", filtered.filter((report) => report.status === "Submitted").length, "Received"),
        stat("In progress", filtered.filter((report) => ["Under Review", "In Progress"].includes(report.status)).length, "Being followed up"),
        stat("Resolved", filtered.filter((report) => report.status === "Resolved").length, "Marked as addressed"),
      ]) : role !== "resident" ? statsStrip([
        stat("All concerns", data.reports.length, "Recorded concerns"),
        stat("Pending review", data.reports.filter((report) => ["Submitted", "Under Review"].includes(report.status)).length, "Submitted or under review"),
        stat("In progress", data.reports.filter((report) => report.status === "In Progress").length, "Being addressed"),
        stat("Urgent", data.reports.filter((report) => report.urgent && report.status !== "Resolved").length, "Active hazards", "danger"),
      ]) : ""}
      ${panel(view === "history" ? "Past and current concerns" : view === "urgent" ? "Urgent reports" : "Reports", `${view === "reports" ? reportFilters(filtered) : ""}${statusHelp}${searchToolbar()}<div class="mt-16" data-report-table>${reportRows(view === "history" ? filtered : activeRows, role)}</div>${resolvedRows.length && view !== "history" ? `<div class="section-heading mt-20"><div><h2>Resolved concerns</h2><p>${resolvedRows.length} marked as addressed</p></div></div><div data-report-table>${reportRows(resolvedRows, role)}</div>` : ""}`, { subtitle, action: exportActions })}
      ${role === "resident" && view !== "history" ? `<div class="notice" data-tone="warning">${icon("alert", "notice-icon")}<div class="notice-copy"><strong>Need to report another issue?</strong><span>Start a new concern with its location and a clear description.</span></div>${linkButton("New report", routeUrl("resident", "report"), "secondary", "small")}</div>` : ""}
    </div>`;
  return page(role, view, body, primaryAction);
}

function notificationsPage(role) {
  const notifications = sortedNotifications(data.notifications.filter((item) => item.targetEmail === currentUser.email));
  const visible = notificationFilter === "unread" ? notifications.filter((item) => !item.read) : notifications;
  const body = `
    <div class="content-stack">
      ${statsStrip([stat("All updates", notifications.length, "In this workspace"), stat("Unread", notifications.filter((item) => !item.read).length, "For this account"), stat("Report updates", notifications.filter((item) => item.reportId).length, "Concern activity"), stat("Service updates", notifications.filter((item) => !item.reportId).length, "Collection and account")])}
      ${panel("Your notifications", `<div class="filter-row" role="group" aria-label="Filter notifications"><button type="button" class="filter-button ${notificationFilter === "all" ? "selected" : ""}" data-action="filter-notifications" data-value="all" aria-pressed="${notificationFilter === "all"}">All updates <span class="filter-count">${notifications.length}</span></button><button type="button" class="filter-button ${notificationFilter === "unread" ? "selected" : ""}" data-action="filter-notifications" data-value="unread" aria-pressed="${notificationFilter === "unread"}">Unread <span class="filter-count">${notifications.filter((item) => !item.read).length}</span></button></div>
        <div class="notification-list mt-16">${visible.length ? visible.map((item) => `<article class="notification-item ${item.read ? "" : "notification-unread"}"><span class="item-mark">${icon(item.reportId ? "clipboard" : "bell")}</span><div class="item-copy"><strong>${esc(item.title)}</strong><span>${esc(item.body)}</span><span>${esc(dateTimeLabel(item.createdAt))}</span>${item.reportId ? `<button type="button" class="text-button mt-16" data-action="view-notification-report" data-id="${esc(item.reportId)}">View related report ${icon("arrow")}</button>` : ""}</div>${item.read ? `<span class="muted small">Read</span>` : `<button class="button secondary small" type="button" data-action="mark-read" data-id="${esc(item.id)}">Mark read</button>`}</article>`).join("") : `<div class="empty-state"><strong>All caught up</strong>There are no ${notificationFilter === "unread" ? "unread " : ""}updates for this account.</div>`}</div>`, { subtitle: "Collection reminders and report-status changes", action: notifications.some((item) => !item.read) ? actionButton("Mark all as read", "mark-all-read", "tertiary", "small") : "" })}
      <div class="notice">${icon("bell", "notice-icon")}<div class="notice-copy"><strong>Updates appear in this account.</strong><span>Email and text notifications are not available.</span></div></div>
    </div>`;
  return page(role, "notifications", body);
}

function profilePage(role) {
  const body = `
    <div class="profile-layout">
      <div class="content-stack">
        <section class="panel">
          <div class="profile-intro"><div class="avatar large" aria-hidden="true">${esc(initials(currentUser.name))}</div><div><strong>${esc(currentUser.name)}</strong><span>${esc(ROLES[role])} · ${esc(currentUser.area || "Balete, Batangas")}</span></div></div>
          <div class="panel-body">
            <form id="profile-form" class="form-stack">
              <div class="section-heading"><div><h2>Personal information</h2><p>Update the name and contact details on your account.</p></div></div>
              <div class="form-grid">
                ${inputField("Full name", "name", currentUser.name, { required: true, autocomplete: "name" })}
                ${inputField("Email address", "email", currentUser.email, { readonly: true, autocomplete: "email", help: "Account email cannot be changed here." })}
                ${inputField("Contact number", "phone", currentUser.phone || "", { type: "tel", autocomplete: "tel", placeholder: "Optional" })}
                ${role === "resident" ? selectField("Purok or area", "area", locationAreas(), currentUser.area, { required: true, labels: locationAreaLabels() }) : inputField("Barangay", "area", currentUser.area || "Balete, Batangas", { readonly: true })}
              </div>
              <div class="form-actions"><button class="button" type="submit">Save profile</button></div>
            </form>
          </div>
        </section>
        <section class="panel"><div class="panel-body">
          <form id="password-form" class="form-stack">
            <div class="section-heading"><div><h2>Account password</h2><p>Passwords are not stored as plain text. Account identity is not verified by the barangay.</p></div></div>
            ${inputField("Current password", "currentPassword", "", { type: "password", required: true, autocomplete: "current-password" })}
            <div class="form-grid">
              ${inputField("New password", "newPassword", "", { type: "password", required: true, minLength: 10, autocomplete: "new-password", help: "Use at least 10 characters." })}
              ${inputField("Confirm new password", "confirmPassword", "", { type: "password", required: true, minLength: 10, autocomplete: "new-password" })}
            </div>
            <div class="form-actions"><button class="button secondary" type="submit">Update password</button></div>
          </form>
        </div></section>
      </div>
      <div class="content-stack">
        ${panel("Your workspace", `<div class="account-summary"><div class="avatar" aria-hidden="true">${esc(initials(currentUser.name))}</div><div><strong>${esc(ROLES[role])}</strong><span>${esc(currentUser.email)}</span><span>CommUnity account</span></div></div><div class="notice-bar mt-16"><span>Account status</span>${statusPill(currentUser.status || "Active")}</div>`)}
        <div class="notice" data-tone="warning">${icon("shield", "notice-icon")}<div class="notice-copy"><strong>Share only necessary personal information.</strong><span>Passwords are hashed by CommUnity. Verify your hosting provider's database encryption, backup, and retention settings before using real resident records.</span></div></div>
      </div>
    </div>`;
  return page(role, "profile", body);
}

function userRowsMarkup(users) {
  if (!users.length) return `<div class="empty-state"><strong>No accounts match</strong>Try another name, email, role, or status.</div>`;
  return `<div class="records" data-page-size="10" role="table" aria-label="User accounts"><div class="record-row record-head user-record-head" role="row"><span role="columnheader">Account</span><span role="columnheader">Role</span><span role="columnheader">Area</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>${users.map((user) => `<div class="record-row user-record filter-item" role="row" data-search="${esc(`${user.name} ${user.email} ${ROLES[user.role]} ${user.area} ${user.status}`.toLowerCase())}">
    <div class="identity" role="cell"><span class="avatar" aria-hidden="true">${esc(initials(user.name))}</span><span><strong class="record-primary">${esc(user.name)}</strong><span class="record-secondary">${esc(user.email)}</span></span></div>
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
      ${panel("Accounts", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search by name or email</span><input class="input" type="search" data-search-input placeholder="Search by name or email…" autocomplete="off"></label><select class="select" data-user-role-filter aria-label="Filter accounts by role"><option value="all">All roles</option>${Object.entries(ROLES).map(([role, label]) => `<option value="${esc(role)}">${esc(label)}</option>`).join("")}</select><select class="select" data-user-status-filter aria-label="Filter accounts by status"><option value="all">All statuses</option><option>Active</option><option>Inactive</option></select></div><div class="mt-16" data-user-table>${userRowsMarkup([...data.users].sort((a, b) => a.name.localeCompare(b.name)))}</div>`, { subtitle: "Manage accounts and role assignments", action: actionButton(`${icon("plus")} Add user`, "add-user", "small") })}
      <div class="notice" data-tone="warning">${icon("shield", "notice-icon")}<div class="notice-copy"><strong>Role settings do not secure system access.</strong><span>They change this interface only; access to stored data is not restricted by the server.</span></div></div>
    </div>`;
  return page("administrator", "users", body);
}

function rolesPage() {
  const roles = Object.keys(ROLES);
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
  const roleDescriptions = {
    resident: "Controls which community services appear in this workspace.",
    official: "Controls report review and service tools in this workspace.",
    administrator: "Controls account, role, and activity tools in this workspace.",
  };
  const roleTabs = roles.map((role) => `<button class="permission-role-button" type="button" data-action="select-permission-role" data-role="${esc(role)}" aria-pressed="${role === selectedRole}"><span>${esc(ROLES[role])}</span>${isDirty(role) ? '<span class="permission-unsaved">Unsaved</span>' : ""}</button>`).join("");
  const permissionGroups = [...new Set(PERMISSION_DEFS.map(({ group }) => group))].map((group) => {
    const items = PERMISSION_DEFS.filter((permission) => permission.group === group);
    return `<details class="permission-group" data-permission-group="${esc(group)}" ${openGroups.includes(group) ? "open" : ""}><summary><span>${esc(group)}</span><span class="permission-group-count">${items.length} permissions</span></summary><div class="permission-list">${items.map((permission) => `<div class="permission-row"><span class="permission-copy"><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span><button class="switch" type="button" role="switch" aria-checked="${Boolean(permissionDrafts[selectedRole][permission.id])}" aria-label="${esc(`${ROLES[selectedRole]}: ${permission.label}`)}" data-action="toggle-permission" data-permission="${esc(permission.id)}"></button></div>`).join("")}</div></details>`;
  }).join("");
  const body = `
    <div class="content-stack">
      <div class="notice" data-tone="warning">${icon("shield", "notice-icon")}<div class="notice-copy"><strong>Role changes affect server access.</strong><span>Keep at least one active administrator with account and role management enabled.</span></div></div>
      ${panel("Role permissions", `<div class="permission-roles" role="group" aria-label="Choose a role to edit">${roleTabs}</div><div class="permission-role-context"><strong>${esc(ROLES[selectedRole])}</strong><span>${esc(roleDescriptions[selectedRole])}</span></div><div class="permission-groups">${permissionGroups}</div><div class="permission-actions"><span class="permission-save-status" aria-live="polite">${dirtyCount ? `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}` : "No unsaved changes"}</span><button class="button secondary" type="button" data-action="discard-permission-draft" ${dirtyCount ? "" : "disabled"}>Discard changes</button><button class="button" type="button" data-action="save-permission-draft" ${dirtyCount ? "" : "disabled"}>Save ${esc(ROLES[selectedRole])} permissions</button></div>`, { subtitle: "Edit one role at a time. Changes are applied only when saved." })}
      ${panel("Workspace responsibilities", `<ul class="plain-list"><li><span><strong>Resident</strong><span class="record-secondary">Submit concerns, track updates, and view collection schedules.</span></span><span class="muted small">Community member</span></li><li><span><strong>Barangay official</strong><span class="record-secondary">Review reports and maintain collection-service updates.</span></span><span class="muted small">Service team</span></li><li><span><strong>Administrator</strong><span class="record-secondary">Manage accounts, roles, and activity history.</span></span><span class="muted small">Portal administrator</span></li></ul>`, { className: "role-responsibilities" })}
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

function auditPage() {
  const rows = [...data.activities].sort((a, b) => asDate(b.at) - asDate(a.at));
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat("Recorded activity", rows.length, "Workspace activity"),
        stat("Account changes", rows.filter((item) => /account|role|profile/i.test(item.action)).length, "User and role updates"),
        stat("Report activity", rows.filter((item) => /report|concern/i.test(`${item.action} ${item.detail}`)).length, "Concern workflows"),
        stat("Service activity", rows.filter((item) => /collection|schedule/i.test(`${item.action} ${item.detail}`)).length, "Collection workflows"),
      ])}
      ${panel("Activity history", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search activity</span><input class="input" type="search" data-search-input placeholder="Search by person or activity…" autocomplete="off"></label><button class="button secondary small" type="button" data-action="export-audit">${icon("download")} Export CSV</button></div>
      <div class="records mt-16" data-page-size="10" role="table" aria-label="Audit activity"><div class="record-row record-head audit-record-head" role="row"><span role="columnheader">Person and activity</span><span role="columnheader">Date and time</span><span role="columnheader">Workspace</span><span role="columnheader">Result</span><span role="columnheader"></span></div>
        ${rows.map((item) => `<div class="record-row audit-record filter-item" role="row" data-search="${esc(`${item.actor} ${item.action} ${item.detail} ${item.role} ${item.result}`.toLowerCase())}"><div role="cell"><strong class="record-primary">${esc(item.action)}</strong><span class="record-secondary">${esc(item.actor)} · ${esc(item.detail)}</span></div><div class="record-date" role="cell" data-label="Date and time">${esc(dateTimeLabel(item.at))}</div><div class="record-meta" role="cell" data-label="Workspace">${esc(ROLES[item.role] || item.role)}</div><div role="cell" data-label="Result">${statusPill("active", item.result)}</div><div role="cell" data-label=""></div></div>`).join("") || `<div class="empty-state"><strong>No activity recorded</strong>Actions recorded in this workspace will appear here.</div>`}
      </div>`, { subtitle: "Actions recorded in this workspace" })}
      <div class="notice" data-tone="warning">${icon("activity", "notice-icon")}<div class="notice-copy"><strong>Application activity is not an independent security audit.</strong><span>For production, also configure provider monitoring, access logs, retention, and alerting.</span></div></div>
    </div>`;
  return page("administrator", "audit", body);
}

function settingsPage() {
  const body = `
    <div class="content-stack">
      ${panel("Workspace data", `<div class="account-summary"><span class="item-mark">${icon("settings")}</span><div><strong>Managed database</strong><span>Accounts, reports, schedules, notifications, and role permissions are stored in relational tables.</span><span>Back up and restore this workspace using your PostgreSQL provider's tools.</span></div></div>`, { subtitle: "Manage your CommUnity information" })}
      ${panel("Getting started", `<ul class="plain-list"><li><span>Residents can register and follow their own reports.</span><span class="muted small">Resident access</span></li><li><span>Officials review concerns, schedules, and announcements.</span><span class="muted small">Official workspace</span></li><li><span>Administrators manage accounts, locations, and monitoring.</span><span class="muted small">Administration</span></li></ul>`)}
      <div class="notice" data-tone="warning">${icon("alert", "notice-icon")}<div class="notice-copy"><strong>Protect personal information.</strong><span>Use HTTPS and verify provider-level database encryption, backups, access retention, and monitoring before using real resident records.</span></div></div>
      <div class="notice" data-tone="warning">${icon("activity", "notice-icon")}<div class="notice-copy"><strong>Verify information before relying on it.</strong><span>Names, contact details, reports, and collection schedules have not been verified against current barangay records.</span></div></div>
    </div>`;
  return page("administrator", "settings", body);
}

function loginMarkup() {
  return `
    <main class="login-page" id="main-content">
      <section class="login-story" aria-label="About CommUnity">
        <a class="brand-lockup" href="#/login">${brandMark()}<span><span class="brand-name">CommUnity</span><span class="brand-caption">Balete, Batangas</span></span></a>
        <div class="login-story-content">
          <p class="login-statement">Your community, a little closer.</p>
          <p>One place to follow barangay services, share a concern, and hear what happens next.</p>
          <div class="login-benefits">
            <div class="login-benefit">${icon("calendar")}<span>See collection schedules and service updates.</span></div>
            <div class="login-benefit">${icon("flag")}<span>Share a community concern with its location and details.</span></div>
            <div class="login-benefit">${icon("clipboard")}<span>Follow report progress from submission to resolution.</span></div>
          </div>
        </div>
        <div class="login-story-foot">Resident, barangay official, and administrator workspaces</div>
      </section>
      <section class="login-pane" aria-labelledby="login-title">
        <div class="login-box">
          ${brandMark()}
          <h1 id="login-title">Welcome to CommUnity</h1>
          <p>Sign in to your CommUnity account.</p>
          <form class="login-form" id="login-form">
            ${inputField("Email address", "email", "", { required: true, type: "email", autocomplete: "username" })}
            <div class="form-field"><label for="password">Password</label><div class="password-field"><input class="input" id="password" name="password" type="password" required autocomplete="current-password" placeholder="Enter your password"><button class="password-toggle" type="button" data-action="toggle-password" aria-label="Show password">${icon("eye")}</button></div></div>
            <div class="remember-line"><label><input type="checkbox" name="remember"> Keep me signed in on this device</label><button class="text-button" type="button" data-action="forgot-password">Forgot password?</button></div>
            <button class="button" type="submit">Sign in</button>
          </form>
          <p class="login-register">New to CommUnity? <a href="#/register">Create a resident account</a></p>
          <div class="demo-note">Sign-in is protected by a server-managed session. Use a unique password and do not share your account.</div>
        </div>
      </section>
    </main>`;
}

function registerMarkup() {
  return `
    <main class="login-page" id="main-content">
      <section class="login-story" aria-label="About CommUnity">
        <a class="brand-lockup" href="#/login">${brandMark()}<span><span class="brand-name">CommUnity</span><span class="brand-caption">Balete, Batangas</span></span></a>
        <div class="login-story-content"><p class="login-statement">A clearer way to stay connected.</p><p>Create a resident account to view barangay services, report concerns, and follow up on updates.</p><div class="login-benefits"><div class="login-benefit">${icon("shield")}<span>Public registration creates a resident account.</span></div><div class="login-benefit">${icon("user")}<span>Keep your contact details and purok current.</span></div></div></div>
        <div class="login-story-foot">Resident services · Balete, Batangas</div>
      </section>
      <section class="login-pane" aria-labelledby="register-title"><div class="register-box">
        ${brandMark()}<h1 id="register-title">Create a resident account</h1><p>Register to report concerns, follow updates, and view collection schedules.</p>
        <form class="form-stack" id="register-form">
          <div class="form-grid">${inputField("Full name", "name", "", { required: true, autocomplete: "name", placeholder: "Your name" })}${inputField("Email address", "email", "", { required: true, type: "email", autocomplete: "email" })}${inputField("Contact number", "phone", "", { type: "tel", autocomplete: "tel", placeholder: "Optional" })}${selectField("Purok or area", "area", locationAreas(), locationAreas()[0], { required: true, labels: locationAreaLabels() })}${inputField("Password", "password", "", { type: "password", required: true, minLength: 12, autocomplete: "new-password", help: "Use at least 12 characters. Do not reuse a password from another account." })}${inputField("Confirm password", "confirmPassword", "", { type: "password", required: true, minLength: 12, autocomplete: "new-password" })}</div>
          <div class="notice" data-tone="warning">${icon("shield", "notice-icon")}<div class="notice-copy"><strong>Protect your account</strong><span>Account identity is not verified. Choose a unique password you do not use elsewhere.</span></div></div>
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Create account</button></div>
        </form>
      </div></section>
    </main>`;
}
