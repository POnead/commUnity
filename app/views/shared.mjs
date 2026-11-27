"use strict";

import {
  HOTLINE_CATEGORIES,
  HOTLINE_STATUS_LABELS,
  getAppTimeZone,
  ROLES,
  STATUSES,
  REPORT_TRANSITIONS,
  REPORT_PRIORITIES,
  FOLLOW_UP_LIMITS,
} from "../constants.mjs";
import {
  icon,
  brandMark,
  esc,
  asDate,
  dateLabel,
  dateTimeLabel,
  todayISO,
  normalizeStatus,
  statusPill,
  roleLabel,
  initials,
  unreadCount,
  displayReportId,
  displayReferenceText,
  displayReportTitle,
  getUser,
  getReport,
  sortedSchedules,
  sortedNotifications,
  routeUrl,
  actionButton,
  selectField,
  calendarEventFromRecord,
  data,
  currentUser,
  residentReportSort,
  notificationFilter,
  uploadPhotos,
  modalState,
  calendarMonth,
  calendarYear,
  calendarSelectedDate,
  correctionFilters,
  profileSummaryCollapsed,
  facePanelOpen,
  idPanelOpen,
  verificationSettings,
  faceCheckNotice,
} from "../core.mjs";
import { modalMarkup } from "../main.mjs";

export function navGroups(role) {
  const openConcernCount = data.reports.filter((report) => report.status !== "Resolved").length;
  const pendingApprovalCount =
    (data.calendarEvents || []).filter((event) => event.approvalStatus === "pending").length +
    (data.announcements || []).filter((item) => item.approvalStatus === "pending").length;
  const verificationQueueCount = (data.verificationQueue || []).length;
  const groups =
    role === "resident"
      ? [
          {
            title: "Community",
            links: [
              ["dashboard", "Overview", "home"],
              ["calendar", "Calendar", "calendar"],
              ["collection", "Garbage collection", "calendar"],
              ["report", "Report a concern", "flag"],
              ["hotlines", "Emergency hotlines", "phone"],
            ],
          },
          {
            title: "Your activity",
            links: [
              ["reports", "My reports", "clipboard"],
              ["notifications", "Notifications", "bell", unreadCount()],
            ],
          },
          { title: "Account", links: [["profile", "Profile", "user"]] },
        ]
      : role === "official"
        ? [
            {
              title: "Community",
              links: [
                ["dashboard", "Overview", "home"],
                ["concerns", "Concern queue", "clipboard", openConcernCount, "open concerns"],
                ["assigned", "My assigned concerns", "users"],
                ["calendar", "Calendar & schedule", "calendar"],
              ],
            },
            {
              title: "Services",
              links: [
                ["collection", "Garbage collection", "calendar"],
                ["history", "Report history", "clock"],
                ["announcements", "Announcements", "activity"],
                ["hotlines", "Emergency hotlines", "phone"],
                ["notifications", "Notifications", "bell", unreadCount()],
              ],
            },
            {
              title: "Account",
              links: [["profile", "Profile", "user"]],
            },
          ]
        : [
            {
              title: "Community",
              links: [
                ["dashboard", "Overview", "home"],
                ["calendar", "Calendar", "calendar"],
                ["reports", "Community reports", "clipboard"],
                ["approvals", "Approval queue", "check", pendingApprovalCount, "pending requests"],
                ["verifications", "ID reviews", "check", verificationQueueCount, "pending ID reviews"],
                ["hotlines", "Emergency hotlines", "phone"],
              ],
            },
            {
              title: "Updates and account",
              links: [
                ["notifications", "Notifications", "bell", unreadCount()],
                ["settings", "Settings", "settings"],
              ],
            },
          ];
  return groups.map((group) => ({ ...group, links: group.links.filter(([key]) => canOpenPage({ role, email: currentUser?.email }, key)) }));
}
export function requiredPermission(role, pageName) {
  const map = {
    resident: { collection: "viewSchedules", report: "submitReports", reports: "submitReports", history: "submitReports" },
    official: {
      concerns: "manageReports",
      assigned: "manageReports",
      history: "manageReports",
      collection: "manageSchedules",
      announcements: "manageAnnouncements",
    },
    administrator: {
      reports: "manageReports",
      assignments: "manageReports",
      analytics: "manageReports",
      users: "manageUsers",
      verifications: "manageUsers",
      locations: "manageUsers",
      announcements: "manageAnnouncements",
      roles: "manageRoles",
      activity: "viewAudit",
    },
  };
  return map[role]?.[pageName] || "";
}

export function officialReportFilters(reports, activeFilter) {
  const options = [
    ["all", "Open reports"],
    ["Submitted", "Submitted"],
    ["Under Review", "Under review"],
    ["In Progress", "In progress"],
  ];
  return `<div class="filter-row" role="group" aria-label="Filter concerns">${options
    .map(([value, label]) => {
      const count =
        value === "all"
          ? reports.filter((report) => report.status !== "Resolved").length
          : reports.filter((report) => report.status === value).length;
      return `<button type="button" class="filter-button ${activeFilter === value ? "selected" : ""}" data-action="filter-reports" data-value="${esc(value)}" aria-pressed="${activeFilter === value}">${esc(label)} <span class="filter-count">${count}</span></button>`;
    })
    .join("")}</div>`;
}

export function canOpenPage(user, pageName) {
  const permission = requiredPermission(user?.role, pageName);
  if (!permission) return true;
  const override = user?.email ? data.accountOverrides?.[user.email] : null;
  const allowed =
    override && Object.hasOwn(override, permission) ? Boolean(override[permission]) : Boolean(data.permissions?.[user?.role]?.[permission]);
  return allowed;
}

export function userAvatar(user, extra = "") {
  const name = user?.name || "";
  if (user?.photoUrl) {
    return `<span class="avatar ${extra}"><img src="${esc(user.photoUrl)}" alt="Profile photo of ${esc(name)}"></span>`;
  }
  return `<span class="avatar ${extra}" aria-hidden="true">${esc(initials(name))}</span>`;
}

export function checkDataConsistency() {
  const counts = STATUSES.map((status) => data.reports.filter((report) => report.status === status).length);
  console.assert(
    counts.reduce((sum, count) => sum + count, 0) === data.reports.length,
    "Every community report must have one valid status.",
  );
  console.assert(new Set(data.reports.map((report) => report.id)).size === data.reports.length, "Report IDs must be unique.");
  console.assert(new Set(data.schedules.map((schedule) => schedule.id)).size === data.schedules.length, "Schedule IDs must be unique.");
  console.assert(
    data.reports.every((report) => report.userEmail && report.history.at(-1)?.status === report.status),
    "Each report should belong to an account and end with its current status.",
  );
}

export function navMarkup(role, page) {
  return navGroups(role)
    .filter((group) => group.links.length)
    .map(
      (group) => `
    <div class="nav-group">
      <p class="nav-group-label">${esc(group.title)}</p>
      <nav class="nav-list" aria-label="${esc(group.title)}">
        ${group.links
          .map(
            ([key, label, iconName, count, countLabel = "unread"]) => `
          <a class="nav-link ${key === page ? "active" : ""}" href="${routeUrl(role, key)}" ${key === page ? 'aria-current="page"' : ""} ${count ? `aria-label="${esc(`${label} ${count}, ${count} ${countLabel}`)}"` : ""}>
            ${icon(iconName)}<span>${esc(label)}</span>${count ? ` <span class="nav-count" aria-hidden="true">${count}</span>` : ""}
          </a>`,
          )
          .join("")}
      </nav>
    </div>`,
    )
    .join("");
}

export function pageTitle(role, page) {
  const titles = {
    resident: {
      dashboard: ["Resident", "Stay informed. A cleaner and safer community for all."],
      collection: ["Garbage collection", "Check your area's collection schedule and service updates."],
      report: ["Report a concern", "Share what happened and where."],
      reports: ["My reports", "Follow the progress of concerns you have submitted."],
      history: ["Report history", "Review previous concerns and the actions recorded."],
      notifications: ["Notifications", "Updates for your reports and barangay services."],
      calendar: ["Calendar", "Announcements and collection schedules in one place."],
      hotlines: ["Emergency hotlines", "Call the right barangay, police, fire, or medical contact in an emergency."],
      profile: ["Account & profile", "Manage your contact details, ID verification, and sign-in security."],
    },
    official: {
      dashboard: ["Barangay overview", "The latest concerns and collection activity across the community."],
      calendar: ["Calendar", "Announcements and collection schedules in one place."],
      concerns: ["Concern queue", ""],
      assigned: ["My assigned concerns", "Track and manage concerns assigned to you."],
      collection: ["Collection management", "Maintain schedules and post service-status changes."],
      history: ["Report history", "Review concern updates recorded by the barangay."],
      notifications: ["Notifications", "New concerns and service updates for your team."],
      announcements: ["Announcements", "Publish service notices for residents and staff."],
      hotlines: ["Emergency hotlines", "Check published hotlines and suggest corrections to the administrator."],
      profile: ["Account & verification", "Manage your official details, identity checks, and sign-in security."],
      verify: ["Face check", "Prove it is you before making changes while the duty check is on."],
    },
    administrator: {
      dashboard: ["System Overview", "A concise view of accounts and recent activity."],
      calendar: ["Calendar", "Announcements and collection schedules in one place."],
      reports: ["Community Reports", "Monitor concerns submitted by residents across the barangay."],
      assignments: ["Assignment Queue", "Assign unresolved concerns to active barangay officials."],
      approvals: ["Approval Queue", "Review and decide on event and announcement requests from barangay officials."],
      verifications: ["ID reviews", "Confirm resident IDs so verified badges mean something."],
      analytics: ["Analytics", "Review report activity, user activity, and service trends."],
      users: ["User Management", "Review accounts and adjust access."],
      locations: ["Locations", "Manage community areas and verified landmarks."],
      announcements: ["Announcements", "Publish service notices for residents and staff."],
      hotlines: ["Emergency hotlines", "Maintain the published emergency contacts and review official corrections."],
      activity: ["Activity Log", "A record of account and service activity."],
      roles: ["Role & Permissions", "Review the permissions shown in each workspace."],
      profile: ["Your Profile", "Keep your administrator account details up to date."],
      settings: ["Settings", "Manage administrator workspace areas from one place."],
      email: ["Email", "Configure SMTP email for report and collection notifications."],
      notifications: ["Notifications", "Report and service updates for this account."],
    },
  };
  return titles[role]?.[page] || ["CommUnity", "Barangay services and community updates."];
}

export function shell(role, page, title, description, body, actions = "") {
  const roleLabel = ROLES[role];
  const headingIcons = {
    dashboard: role === "resident" ? "users" : "chart",
    calendar: "calendar",
    collection: "calendar",
    report: "flag",
    reports: "clipboard",
    assignments: "users",
    approvals: "check",
    verify: "shield",
    verifications: "check",
    notifications: "bell",
    analytics: "chart",
    users: "users",
    roles: "shield",
    locations: "pin",
    announcements: "activity",
    hotlines: "phone",
    activity: "clipboard",
    profile: "user",
    settings: "settings",
    email: "mail",
  };
  const headingTitle =
    role === "resident" && page === "dashboard"
      ? `${
          String(currentUser?.name || "")
            .trim()
            .split(/\s+/)[0] || "Resident"
        }!`
      : title;
  const headingIcon =
    (role === "administrator" || role === "resident") && headingIcons[page]
      ? `<span class="page-heading-icon">${icon(headingIcons[page])}</span>`
      : "";
  const date = new Intl.DateTimeFormat("en-PH", {
    timeZone: getAppTimeZone(),
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(role === "administrator" || role === "resident" ? { year: "numeric" } : {}),
  }).format(new Date());
  const account = `<div class="user-chip">${userAvatar(currentUser)}<div class="user-chip-copy"><strong>${esc(currentUser.name)}</strong><span>${esc(roleLabel)}</span></div></div>`;
  return `
    <div class="workspace${role === "resident" ? " resident-workspace" : ""}">
      <header class="topbar">
        <div class="topbar-leading">
          <button class="icon-button mobile-menu-button" type="button" data-action="toggle-menu" aria-label="Open navigation" aria-expanded="false" aria-controls="mobile-navigation">${icon("menu")}</button>
          ${role === "resident" ? "" : `<div class="crumb"><span>CommUnity</span><span class="crumb-separator" aria-hidden="true">/</span><strong>${esc(roleLabel)}</strong></div>`}
        </div>
        <div class="topbar-actions">
          <span class="topbar-date">${role === "resident" ? `${icon("calendar")}<span>${esc(date)}</span>` : esc(date)}</span>
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
          ${role === "resident" ? '<div class="resident-leaves" aria-hidden="true"></div>' : ""}
          <header class="page-heading${role === "resident" ? " resident-page-heading" : ""}${role === "resident" && page === "dashboard" ? " resident-welcome-heading" : ""}">
            <div class="page-heading-main">${headingIcon}<div class="page-title-block">${role === "resident" && page === "dashboard" ? '<span class="resident-page-greeting">Welcome back,</span>' : ""}<h1>${esc(headingTitle)}</h1>${(role === "administrator" || role === "resident") && description ? `<p class="page-subtitle">${esc(description)}</p>` : ""}</div></div>
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

export function page(role, view, body, actions = "") {
  const [title, description] = pageTitle(role, view);
  return shell(role, view, title, description, body, actions);
}

export function stat(label, value, note = "", tone = "", iconName = "") {
  const iconMarkup = iconName ? `<span class="stat-icon" aria-hidden="true">${icon(iconName)}</span>` : "";
  const content = `<span class="stat-label">${esc(label)}</span><strong class="stat-value">${esc(value)}</strong>${note ? `<span class="stat-note">${esc(note)}</span>` : ""}`;
  return `<div class="stat" ${tone ? `data-tone="${esc(tone)}"` : ""}>${iconName ? `${iconMarkup}<span class="stat-copy">${content}</span>` : content}</div>`;
}

export function statsStrip(items) {
  return `<section class="stats-strip" aria-label="Summary">${items.join("")}</section>`;
}

export function panel(title, body, options = {}) {
  const titleIcon = options.icon ? `<span class="panel-title-icon" aria-hidden="true">${icon(options.icon)}</span>` : "";
  const header = title
    ? `<header class="panel-head"><div class="${options.icon ? "panel-head-title" : ""}">${titleIcon}<h2>${esc(title)}</h2>${options.subtitle ? `<p>${esc(options.subtitle)}</p>` : ""}</div>${options.action || ""}</header>`
    : "";
  return `<section class="panel ${options.className || ""}">${header}<div class="panel-body">${body}</div></section>`;
}

export function reportRows(reports, role, emptyHint = "") {
  if (!reports.length && role !== "administrator")
    return `<div class="empty-state"><strong>${emptyHint ? "No active concerns" : "No concerns in this view"}</strong>${esc(emptyHint || "When a report is submitted, it will appear here.")}</div>`;
  if (role === "resident") {
    const residentReports = [...reports].sort((a, b) => {
      const direction = residentReportSort === "oldest" ? 1 : -1;
      return direction * (asDate(a.submittedAt) - asDate(b.submittedAt));
    });
    const rows = residentReports
      .map(
        (
          report,
        ) => `<div class="record-row filter-item" role="row" data-submitted="${esc(String(report.submittedAt || "").slice(0, 10))}" data-search="${esc(`${displayReportId(report)} ${report.id} ${report.title} ${report.description} ${report.category} ${report.assignedTo?.name || ""} ${report.area} ${report.status}`.toLowerCase())}">
          <div class="record-meta resident-report-id" role="cell" data-label="Report ID">${esc(displayReportId(report))}</div>
          <div class="resident-report-concern" role="cell" data-label="Concern"><strong class="record-primary">${esc(displayReportTitle(report))}</strong><span class="record-secondary">${esc(report.category)}</span></div>
          <div class="record-meta" role="cell" data-label="Priority"><span class="status" data-status="${esc(normalizeStatus(report.priority || "Medium"))}">${esc(report.priority || "Medium")}</span></div>
          <div class="record-meta" role="cell" data-label="Assigned official">${esc(report.assignedTo?.name || "Not assigned")}</div>
          <div class="record-meta" role="cell" data-label="Affected area">${esc(report.area)}</div>
          <div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(report.submittedAt))}</div>
          <div role="cell" data-label="Status">${statusPill(report.status)}</div>
          <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>
        </div>`,
      )
      .join("");
    return `<div class="records resident-report-records" data-page-size="10" role="table" aria-label="My reports"><div class="record-row record-head" role="row">${["Report ID", "Concern", "Priority", "Assigned Official", "Affected Area", "Date Submitted", "Status", "Action"].map((header) => `<span role="columnheader">${header}</span>`).join("")}</div>${rows}</div>`;
  }
  const officialResolved = role === "official" && reports.length > 0 && reports.every((report) => report.status === "Resolved");
  const headers =
    role === "administrator"
      ? ["Concern", "Concern ID", "Resident", "Priority", "Affected area", "Date submitted", "Status", "Action"]
      : officialResolved
        ? ["Concern", "Resident", "Affected area", "Status", "Action"]
        : ["Concern", "Resident", "Priority", "Affected area", "Status", "Action"];
  const cells = reports
    .map((report) => {
      const priority = report.priority || "Medium";
      const first = `<div role="cell"><button class="text-button record-primary" type="button" data-action="view-report" data-id="${esc(report.id)}">${esc(displayReportTitle(report))}</button>${role === "administrator" ? "" : `<span class="record-secondary">${esc(displayReportId(report))}</span>`}${role === "official" ? `<span class="record-secondary">Assigned to ${esc(report.assignedTo?.name || "no one")}</span>` : ""}</div>`;
      const second = `<div class="record-meta" role="cell" data-label="Resident">${esc(report.name)}</div>`;
      const third = `<div class="record-meta" role="cell" data-label="Area">${esc(report.area)}<span class="record-secondary">${esc(dateLabel(report.submittedAt))}</span></div>`;
      const priorityCell = `<div class="record-meta" role="cell" data-label="Priority"><span class="status" data-status="${esc(normalizeStatus(priority))}">${esc(priority)}</span></div>`;
      const adminIdCell = `<div class="record-meta" role="cell" data-label="Concern ID">${esc(displayReportId(report))}</div>`;
      const adminAreaCell = `<div class="record-meta" role="cell" data-label="Affected area">${esc(report.area)}</div>`;
      const adminDateCell = `<div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(report.submittedAt))}</div>`;
      const overdueBadge = report.overdue
        ? `<span class="status-overdue" title="${esc(report.responseOverdue ? "Past the first-response deadline with no staff response yet" : "Past the resolution deadline and still unresolved")}">Overdue</span>`
        : "";
      const statusCell = `<div role="cell" data-label="Status">${statusPill(report.status)}${overdueBadge}</div>`;
      const actionsCell =
        role === "official"
          ? `<div class="record-actions" role="cell" data-label="">${report.status === "Resolved" ? "" : `<button class="button secondary small" type="button" data-action="claim-report" data-id="${esc(report.id)}" ${report.assignedTo ? `disabled title="Assigned to ${esc(report.assignedTo.name)}"` : ""}>Claim</button>`}<button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>`
          : `<div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>`;
      const ordered = `${second}${priorityCell}${third}`;
      const officialOrdered = officialResolved ? `${second}${third}` : `${second}${priorityCell}${third}`;
      const adminOrdered = `${adminIdCell}${second}${priorityCell}${adminAreaCell}${adminDateCell}${statusCell}${actionsCell}`;
      return `<div class="record-row filter-item" role="row" data-priority="${esc(priority)}" data-report-status="${esc(report.status)}" data-area="${esc(report.area)}" data-submitted="${esc(String(report.submittedAt || "").slice(0, 10))}" data-search="${esc(`${displayReportId(report)} ${report.id} ${report.title} ${report.description} ${report.category} ${report.name} ${report.barangay || ""} ${report.area} ${report.locationDetail || ""} ${report.status} ${priority}`.toLowerCase())}">
      ${first}${role === "administrator" ? adminOrdered : role === "official" ? `${officialOrdered}${statusCell}${actionsCell}` : `${ordered}${statusCell}${actionsCell}`}
    </div>`;
    })
    .join("");
  const emptyRow =
    role === "administrator" && !reports.length
      ? `<div class="report-empty-row" role="row"><div class="empty-state" role="cell"><strong>No reports match these filters</strong>Try changing the status, priority, date range, or search terms.</div></div>`
      : "";
  return `<div class="records ${role === "administrator" ? "admin-report-records" : role === "official" ? `official-report-records${officialResolved ? " official-resolved-records" : ""}` : ""}" data-page-size="10" role="table" aria-label="Community concerns"><div class="record-row record-head" role="row">${headers.map((header) => `<span role="columnheader">${esc(header)}</span>`).join("")}</div>${cells}${emptyRow}</div>`;
}

export function reportAssignmentAction(report) {
  if (report.assignedTo?.id === currentUser.id) {
    return `<button class="button secondary small" type="button" data-action="release-report" data-id="${esc(report.id)}">Release</button>`;
  }
  if (!report.assignedTo) {
    return `<button class="button secondary small" type="button" data-action="claim-report" data-id="${esc(report.id)}">Claim</button>`;
  }
  return "";
}

export function reportHistoryRows(reports, sort = "newest") {
  const updates = reports
    .flatMap((report) => report.history.map((item) => ({ report, item })))
    .sort((a, b) => {
      if (sort === "oldest") return asDate(a.item.at) - asDate(b.item.at);
      if (sort === "concern-asc") return (a.report.category || a.report.title).localeCompare(b.report.category || b.report.title);
      if (sort === "concern-desc") return (b.report.category || b.report.title).localeCompare(a.report.category || a.report.title);
      if (sort === "resident-asc") return a.report.name.localeCompare(b.report.name);
      if (sort === "resident-desc") return b.report.name.localeCompare(a.report.name);
      return asDate(b.item.at) - asDate(a.item.at);
    });
  if (!updates.length) return `<div class="empty-state"><strong>No report updates yet</strong>Status changes will appear here.</div>`;
  const rows = updates
    .map(
      ({
        report,
        item,
      }) => `<div class="record-row filter-item" role="row" data-search="${esc(`${displayReportId(report)} ${report.id} ${report.title} ${report.name} ${report.category} ${item.status} ${item.note}`.toLowerCase())}">
    <div class="record-meta" role="cell" data-label="Concern ID">${esc(displayReportId(report))}</div>
    <div role="cell"><strong class="record-primary">${esc(displayReportTitle(report))}</strong><span class="record-secondary">${esc(report.category)}</span></div>
    <div class="record-meta" role="cell" data-label="Resident">${esc(report.name)}</div>
    <div role="cell" data-label="Update">${statusPill(item.status)}<span class="record-secondary">${esc(item.note)}</span></div>
    <div class="record-date" role="cell" data-label="Date and time">${esc(dateTimeLabel(item.at))}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="view-report" data-id="${esc(report.id)}">View</button></div>
  </div>`,
    )
    .join("");
  const dateSort = sort === "oldest" ? "ascending" : "descending";
  const concernSort = sort === "concern-asc" ? "ascending" : sort === "concern-desc" ? "descending" : "none";
  return `<div class="records official-history-records" data-page-size="10" role="table" aria-label="Report activity"><div class="record-row record-head" role="row"><span role="columnheader">Concern ID</span><span role="columnheader" aria-sort="${concernSort}"><button type="button" class="history-sort-button" data-action="sort-official-history" data-value="concern">Concern${concernSort !== "none" ? `<span class="history-sort-indicator" aria-hidden="true">${concernSort === "ascending" ? "↑" : "↓"}</span>` : ""}</button></span><span role="columnheader">Resident</span><span role="columnheader">Update</span><span role="columnheader" aria-sort="${dateSort}"><button type="button" class="history-sort-button" data-action="sort-official-history" data-value="date">Date &amp; time<span class="history-sort-indicator" aria-hidden="true">${dateSort === "ascending" ? "↑" : "↓"}</span></button></span><span role="columnheader">Action</span></div>${rows}</div>`;
}

export function reportFilters(reports, activeFilter) {
  const options = [
    ["all", "All reports"],
    ["Submitted", "Submitted"],
    ["Under Review", "Under review"],
    ["In Progress", "In progress"],
    ["Resolved", "Resolved"],
  ];
  return `<div class="filter-row" role="group" aria-label="Filter reports">${options
    .map(([value, label]) => {
      const count = value === "all" ? reports.length : reports.filter((report) => report.status === value).length;
      return `<button type="button" class="filter-button ${activeFilter === value ? "selected" : ""}" data-action="filter-reports" data-value="${esc(value)}" aria-pressed="${activeFilter === value}">${esc(label)} <span class="filter-count">${count}</span></button>`;
    })
    .join("")}</div>`;
}

export function searchToolbar(label = "Search concerns by report ID, resident or description") {
  return `<div class="toolbar mt-16"><label class="search-field">${icon("search")}<span class="visually-hidden">${esc(label)}</span><input class="input" type="search" data-search-input autocomplete="off"></label></div>`;
}

export function timelineMarkup(history) {
  return `<ol class="timeline">${history
    .map(
      (item, index) => `
    <li class="timeline-item ${index === 0 ? "" : "future"}"><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-copy"><strong>${esc(item.status)}</strong><span>${esc(item.note)}${item.actorName ? ` · By ${esc(item.actorName)}` : ""} · ${esc(dateTimeLabel(item.at))}</span></div></li>`,
    )
    .join("")}</ol>`;
}

export function photoPreviewMarkup(photos = uploadPhotos) {
  return photos
    .map(
      (photo, index) =>
        `<div class="photo-thumb"><img src="${esc(photo.previewUrl)}" alt="${esc(photo.name)}"><button type="button" data-action="remove-photo" data-index="${index}" aria-label="Remove ${esc(photo.name)}">${icon("close")}</button></div>`,
    )
    .join("");
}

export function reportDetail(report, role) {
  const isResident = role === "resident";
  const nextStatuses = report.status === "Resolved" ? [] : REPORT_TRANSITIONS[report.status] || [];
  const needsNote = nextStatuses.length
    ? `<p class="field-help">Add an update note for the resident. Marking a concern <strong>Resolved</strong> requires a resolution explanation.</p>`
    : "";
  const statusOptions = STATUSES.map((status) => {
    const reachable = nextStatuses.includes(status);
    const reason = status === report.status ? "Current status" : reachable ? "" : `Not available from ${report.status}`;
    return `<option value="${esc(status)}"${status === (nextStatuses[0] || report.status) ? " selected" : ""}${reachable ? "" : " disabled"}>${esc(status)}${reason ? ` — ${esc(reason)}` : ""}</option>`;
  }).join("");
  const statusForm =
    role === "official" && nextStatuses.length
      ? `
    <form class="form-stack" id="report-status-form">
      <input type="hidden" name="reportId" value="${esc(report.id)}">
      <div class="form-field"><label for="status">Update status</label><select class="select" id="status" name="status" required>${statusOptions}</select><span class="field-help">Only the next step from ${esc(report.status)} can be selected. Other statuses stay visible but disabled.</span></div>
      <div class="form-field"><label for="status-note">Update for the resident</label><textarea class="textarea" id="status-note" name="note" maxlength="400"></textarea></div>
      ${needsNote}
      <div class="form-actions"><button class="button" type="submit">Save report update</button></div>
    </form>`
      : role === "official"
        ? `<p class="muted small">This concern is resolved. Residents can confirm it was addressed or request that it be reopened.</p>`
        : "";
  const photos = (report.photos || []).length
    ? `<div class="photo-preview">${report.photos.map((photo) => `<a class="photo-thumb" href="${esc(photo.photoUrl)}" target="_blank" rel="noopener" aria-label="Open report photo ${esc(photo.name)}"><img src="${esc(photo.photoUrl)}" alt="Photo attached to ${esc(report.id)}"></a>`).join("")}</div>`
    : `<p class="muted small">No photo was attached to this report.</p>`;
  const hasMapPin = Number.isFinite(report.latitude) && Number.isFinite(report.longitude);
  const reportLocation =
    role !== "administrator"
      ? panel(
          "Exact map location",
          hasMapPin
            ? `<div id="report-detail-map" class="report-map-canvas report-detail-map" data-latitude="${report.latitude}" data-longitude="${report.longitude}" role="region" aria-label="${role === "official" ? "Map with Palsara context, approximate purok locations, and the exact concern pin" : "Map centered on this concern's reported location"}"></div><p class="map-status" id="report-detail-map-status" role="status" aria-live="polite">Map pin at ${report.latitude.toFixed(6)}, ${report.longitude.toFixed(6)}.</p><a class="text-button map-directions-link" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${report.latitude},${report.longitude}`)}" target="_blank" rel="noopener noreferrer">Open directions in Google Maps</a>`
            : `<p class="muted small">${isResident ? "You did not add a map pin." : "The resident did not include a map pin."} Use the barangay, area, and street or landmark details above to locate this concern.</p>`,
        )
      : "";
  const priority = report.priority || "Medium";
  const followUpLimit = Object.hasOwn(FOLLOW_UP_LIMITS, priority) ? FOLLOW_UP_LIMITS[priority] : FOLLOW_UP_LIMITS.Medium;
  const followUpCount = Number(report.followUpCount || 0);
  const followUpRemaining = followUpLimit === null ? null : Math.max(0, followUpLimit - followUpCount);
  const followUpsOpen = report.status !== "Resolved" && (followUpLimit === null || followUpRemaining > 0);
  const followUpNote =
    report.status === "Resolved"
      ? "This concern is resolved. Follow-ups are closed."
      : followUpLimit === null
        ? `${priority} priority · Unlimited follow-ups.`
        : `${priority} priority · ${followUpRemaining} of ${followUpLimit} follow-ups remaining.`;
  const followUpForm = isResident
    ? panel(
        "Need to add context?",
        `<p class="muted small">${esc(followUpNote)}</p>${followUpsOpen ? `<form id="follow-up-form" class="form-stack"><input type="hidden" name="reportId" value="${esc(report.id)}"><div class="form-field"><label for="follow-up-message">Follow-up message</label><textarea class="textarea" id="follow-up-message" name="message" required maxlength="1000"></textarea></div><div class="form-actions"><button class="button secondary" type="submit">Follow Up</button></div></form>` : ""}`,
      )
    : "";
  const priorityForm =
    role === "official" || role === "administrator"
      ? panel(
          "Concern priority",
          `<form id="report-priority-form" class="form-stack"><input type="hidden" name="reportId" value="${esc(report.id)}"><p class="muted small">Residents choose this at submission; staff can adjust it here.</p>${selectField("Priority", "priority", REPORT_PRIORITIES, priority)}<div class="form-actions"><button class="button secondary" type="submit">Update priority</button></div></form>`,
        )
      : "";
  const body = `
    <div class="content-stack">
      <div class="profile-layout">
        <div class="content-stack">
          <section class="panel"><div class="panel-body">
            <div class="inline-between"><div><h2 class="report-detail-title">${esc(displayReportTitle(report))}</h2><p class="record-secondary report-detail-id">${esc(displayReportId(report))} · ${esc(report.category)}</p></div>${statusPill(report.status)}</div>
            <p class="report-description">${esc(report.description)}</p>
            <div class="notice-bar"><span>Barangay</span><strong>${esc(report.barangay || "—")}</strong></div>
            <div class="notice-bar mt-16"><span>Purok or area</span><strong>${esc(report.area)}</strong></div>
            <div class="notice-bar mt-16"><span>Street or landmark</span><strong>${esc(report.locationDetail || "Not provided")}</strong></div>
            ${role === "administrator" && hasMapPin ? `<div class="notice-bar mt-16"><span>Exact map location</span><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(`${report.latitude},${report.longitude}`)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div>` : ""}
            <div class="inline-between mt-16"><span class="muted small">Submitted ${esc(dateTimeLabel(report.submittedAt))}</span>${report.status === "Resolved" && report.resolvedAt ? `<span class="muted small">Resolved ${esc(dateTimeLabel(report.resolvedAt))}</span>` : `<span class="muted small">Updated ${esc(dateTimeLabel(report.updatedAt))}</span>`}</div>
          </div></section>
          ${reportLocation}
          ${panel("Attached photos", photos)}
          ${followUpForm}
          ${role === "official" ? panel("Record an update", statusForm) : ""}
          ${
            isResident && report.status === "Resolved"
              ? panel(
                  "Close or reopen this concern",
                  `<div class="form-actions"><button class="button" type="button" data-action="confirm-report" data-id="${esc(report.id)}">Confirm addressed</button><button class="button secondary small" type="button" data-action="reopen-report" data-id="${esc(report.id)}">Request reopening</button></div><p class="field-help">Confirming marks the concern as addressed. Reopening returns it to the concern queue with your reason so staff can review it again.</p>`,
                )
              : ""
          }
        </div>
        <div class="content-stack">
          ${role !== "resident" ? `<section class="panel"><header class="panel-head"><div><h2>Reported by</h2></div></header><div class="panel-body"><div class="account-summary">${userAvatar(getUser(report.userEmail) || { name: report.name })}<div><strong>${esc(report.name)}${(getUser(report.userEmail)?.idStatus || "unverified") === "verified" ? ` <span class="id-verified-badge">ID verified</span>` : ""}</strong><span>${esc((getUser(report.userEmail)?.area || report.area) + " · Resident")}</span><span>${esc(report.userEmail)}</span></div></div></div></section>` : ""}
          ${role === "official" ? panel("Assignment", `<div class="inline-between"><span>${report.assignedTo ? `Assigned to ${esc(report.assignedTo.name)}` : "Unassigned"}</span>${reportAssignmentAction(report)}</div>`) : ""}
          ${priorityForm}
          <section class="panel"><header class="panel-head"><div><h2>Status history</h2></div></header><div class="panel-body">${timelineMarkup(report.history)}</div></section>
        </div>
      </div>
    </div>`;
  const listPage = role === "resident" ? "reports" : role === "administrator" ? "reports" : "concerns";
  const actions = `<button class="button secondary" type="button" data-action="back-list">Back to ${isResident ? "my reports" : "reports"}</button>`;
  return page(role, listPage, body, actions);
}

export function upcomingSchedule(area = currentUser.area) {
  return sortedSchedules(data.schedules).find(
    (schedule) =>
      (!area || schedule.area === area || currentUser.role !== "resident") &&
      schedule.date >= todayISO() &&
      !["Cancelled", "Completed"].includes(schedule.status),
  );
}

export function scheduleHistoryMarkup(history = []) {
  if (!history.length)
    return `<div class="empty-state"><strong>No status changes recorded</strong>Updates will appear here as the barangay works through this pickup.</div>`;
  return `<ol class="timeline">${[...history]
    .reverse()
    .map((item, index) => {
      const transition = item.previousStatus ? `${item.previousStatus} → ${item.status}` : item.status;
      const replacement =
        item.status === "Rescheduled" && item.replacementDate
          ? `<span>Replacement pickup: ${esc(dateLabel(item.replacementDate, { weekday: "long", month: "long", day: "numeric" }))}, ${esc(item.replacementStart || "")}–${esc(item.replacementEnd || "")}</span>`
          : "";
      return `<li class="timeline-item ${index === 0 ? "" : "future"}"><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-copy"><strong>${esc(transition)}</strong>${replacement}<span>${esc(item.note || "Status updated.")}${item.actorName ? ` · By ${esc(item.actorName)}` : ""} · ${esc(dateTimeLabel(item.at))}</span></div></li>`;
    })
    .join("")}</ol>`;
}

export function scheduleRows(schedules, canEdit = false) {
  if (!schedules.length)
    return `<div class="empty-state"><strong>No collection schedules</strong>Schedules for this area will appear here when the barangay posts them.</div>`;
  if (!canEdit) {
    const residentRows = schedules
      .map(
        (
          schedule,
        ) => `<div class="record-row resident-collection-row filter-item" role="row" data-search="${esc(`${schedule.area} ${schedule.wasteType} ${schedule.date} ${schedule.status} ${schedule.frequency}`.toLowerCase())}">
          <div class="record-meta" role="cell" data-label="Area">${esc(schedule.area)}</div>
          <div class="record-meta" role="cell" data-label="Service"><strong class="record-primary">${esc(schedule.wasteType)}</strong></div>
          <div class="record-date" role="cell" data-label="Collection date">${esc(dateLabel(schedule.date))}<span class="record-secondary">${esc(dateLabel(schedule.date, { weekday: "long" }))}</span></div>
          <div class="record-meta" role="cell" data-label="Collection window">${esc(schedule.start)} – ${esc(schedule.end)}</div>
          <div role="cell" data-label="Status">${statusPill(schedule.status)}</div>
          <div class="record-meta" role="cell" data-label="Frequency">${esc(schedule.frequency || "Not specified")}</div>
        </div>`,
      )
      .join("");
    return `<div class="records resident-collection-records" data-page-size="10" role="table" aria-label="Collection schedule"><div class="record-row record-head" role="row">${["Area", "Service", "Collection Date", "Collection Window", "Status", "Frequency"].map((header) => `<span role="columnheader">${header}</span>`).join("")}</div>${residentRows}</div>`;
  }
  return `<div class="records ${canEdit ? "official-schedule-records" : ""}" data-page-size="10" role="table" aria-label="Collection schedule">
    <div class="record-row record-head schedule-record-head" role="row"><span role="columnheader">Area</span><span role="columnheader">Service</span><span role="columnheader">Collection date</span><span role="columnheader">Collection window</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>
    ${schedules
      .map((schedule) => {
        const latest = (schedule.history || []).at(-1);
        const statusDetail =
          schedule.status === "Rescheduled" && latest?.replacementDate
            ? `<span class="record-secondary">Moved from ${esc(dateLabel(latest.previousDate || schedule.date))} to ${esc(dateLabel(latest.replacementDate))}</span>`
            : ["Delayed", "Cancelled"].includes(schedule.status) && latest?.note
              ? `<span class="record-secondary">${esc(latest.note)}</span>`
              : "";
        return `<div class="record-row schedule-record filter-item" role="row" data-search="${esc(`${schedule.id} ${schedule.area} ${schedule.zone} ${schedule.wasteType} ${schedule.status}`.toLowerCase())}">
      <div role="cell"><strong class="record-primary">${esc(schedule.area)}</strong><span class="record-secondary">${esc(schedule.zone)}</span></div>
      <div role="cell">${canEdit ? `<button class="text-button record-primary" type="button" data-action="view-schedule" data-id="${esc(schedule.id)}">${esc(schedule.wasteType)}</button>` : `<strong class="record-primary">${esc(schedule.wasteType)}</strong>`}<span class="record-secondary">${esc(schedule.frequency || "Not specified")}</span></div>
      <div class="record-date" role="cell" data-label="Collection date">${esc(dateLabel(schedule.date))}<span class="record-secondary">${esc(dateLabel(schedule.date, { weekday: "long" }))}</span></div>
      <div class="record-meta" role="cell" data-label="Collection window">${esc(schedule.start)} – ${esc(schedule.end)}<span class="record-secondary">${esc(schedule.team)}</span></div>
      <div role="cell" data-label="Status">${statusPill(schedule.status)}${statusDetail}</div>
      <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="view-schedule" data-id="${esc(schedule.id)}">Details</button>${canEdit ? `<button class="button secondary small" type="button" data-action="edit-schedule" data-id="${esc(schedule.id)}">Edit</button>` : `<span class="record-meta">${esc(schedule.frequency)}</span>`}</div>
    </div>`;
      })
      .join("")}</div>`;
}

export function calendarStatusLabel(status) {
  if (status === "pending") return "Pending approval";
  if (status === "declined") return "Declined";
  return "Approved";
}

export function calendarPage() {
  const isResident = currentUser?.role === "resident";
  const schedules = isResident
    ? sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area)
    : sortedSchedules(data.schedules);
  const calendarEvents = (data.calendarEvents || []).map(calendarEventFromRecord);
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
    ...schedules.map((item) => ({
      date: item.date,
      title: `${item.wasteType} collection`,
      detail: `${item.start}–${item.end} · ${item.area} · ${item.zone}`,
      kind: "Collection",
    })),
    ...activeEvents,
  ];
  const byDate = new Map();
  for (const event of events) {
    if (!event.date) continue;
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
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
  const grid = cells
    .map((cell) => {
      if (!cell) return `<div class="calendar-cell calendar-cell--blank" aria-hidden="true"></div>`;
      const hasEvents = cell.events.length > 0;
      const pending = cell.events.some((event) => event.status === "pending");
      const classes = [
        "calendar-cell",
        hasEvents ? "calendar-cell--has-events" : "",
        pending ? "calendar-cell--pending" : "",
        cell.date === today ? "calendar-cell--today" : "",
        cell.date === calendarSelectedDate ? "calendar-cell--selected" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const cellEvents = cell.events
        .slice(0, 2)
        .map(
          (event) =>
            `<span class="calendar-cell-event${event.status === "pending" ? " calendar-cell-event--pending" : ""}">${esc(event.title)}</span>`,
        )
        .join("");
      const more = cell.events.length > 2 ? `<span class="calendar-cell-more">+${cell.events.length - 2} more</span>` : "";
      const eventTitles = cell.events
        .slice(0, 2)
        .map((event) => event.title)
        .join(" ");
      const detailsHint = hasEvents
        ? `, ${cell.events.length} event${cell.events.length === 1 ? "" : "s"}; double-click to view details`
        : "";
      const viewHint = hasEvents
        ? `<span class="calendar-cell-view" aria-hidden="true" title="Double-click to view event details">${icon("arrow", "calendar-cell-view-icon")}</span>`
        : "";
      return `<button type="button" class="${classes}" data-action="calendar-day" data-date="${esc(cell.date)}" aria-label="${esc(hasEvents ? `${cell.day} ${eventTitles} - ${dateLabel(cell.date, { weekday: "long", month: "long", day: "numeric" })}${detailsHint}` : dateLabel(cell.date, { weekday: "long", month: "long", day: "numeric" }))}"><span class="calendar-day-number" aria-hidden="true">${cell.day}</span>${hasEvents ? ` <span class="calendar-cell-events" aria-hidden="true">${cellEvents}${more}</span>` : ""}${viewHint}</button>`;
    })
    .join("");

  const eventMeta = (event) =>
    event.kind === "Event"
      ? `<div class="calendar-event-meta">${statusPill(calendarStatusLabel(event.status))}${event.createdByName ? `<span>Requested by ${esc(event.createdByName)}</span>` : ""}</div>`
      : event.kind === "Announcement" && event.isEvent
        ? `<div class="calendar-event-meta">${announcementEventMarkup(event)}</div>`
        : "";

  const selectedEvents = calendarSelectedDate ? byDate.get(calendarSelectedDate) || [] : [];
  const details = calendarSelectedDate
    ? `<div class="calendar-details"><div class="calendar-details-head"><h3>${esc(dateLabel(calendarSelectedDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</h3></div>${selectedEvents.length ? selectedEvents.map((event) => `<div class="calendar-event"><div class="calendar-date"><strong>${esc(event.kind)}</strong></div><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p>${eventMeta(event)}</div></div>`).join("") : `<div class="empty-state"><strong>No events</strong>Nothing is scheduled on this date.</div>`}</div>`
    : `<div class="calendar-details"><p class="muted small">Select a date to see event details.</p></div>`;

  const upcoming = activeEvents
    .concat(
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
      schedules.map((item) => ({
        date: item.date,
        title: `${item.wasteType} collection`,
        detail: `${item.start}–${item.end} · ${item.area}`,
        kind: "Collection",
        status: "approved",
      })),
    )
    .filter((event) => event.date && event.date >= today)
    .sort((a, b) => asDate(a.date) - asDate(b.date))
    .slice(0, 10);
  const upcomingList = upcoming.length
    ? upcoming
        .map(
          (event) =>
            `<article class="calendar-event"><div class="calendar-date"><strong>${esc(dateLabel(event.date, { day: "numeric", month: "short" }))}</strong><span>${esc(event.kind)}</span></div><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p>${eventMeta(event)}</div></article>`,
        )
        .join("")
    : `<div class="empty-state"><strong>No upcoming events</strong>Announcements and collection schedules will appear here.</div>`;

  const myRequests = calendarEvents.filter((event) => event.status !== "approved" && event.createdBy === currentUser?.id);
  const requestRow = (event) =>
    `<article class="calendar-request"><div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p><span class="record-secondary">${esc(dateLabel(event.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }))}${event.createdByName ? ` · Requested by ${esc(event.createdByName)}` : ""}</span>${event.status === "declined" && event.declineReason ? `<span class="calendar-event-reason">Reason: ${esc(event.declineReason)}</span>` : ""}</div>${statusPill(calendarStatusLabel(event.status))}</article>`;
  const requestsPanel =
    currentUser?.role === "official"
      ? panel(
          "Your event requests",
          myRequests.length
            ? `<div class="calendar-requests">${myRequests.map(requestRow).join("")}</div>`
            : `<div class="empty-state"><strong>No requests yet</strong>Events you request appear here until the administrator reviews them.</div>`,
        )
      : "";

  const body = `
    <div class="content-stack ${isResident ? "resident-calendar-page" : ""}">
      <div class="calendar-toolbar">
        <button type="button" class="button secondary small" data-action="calendar-prev" aria-label="Previous month"><span aria-hidden="true">‹</span></button>
        <h2 class="calendar-month-title">${esc(monthNames[calendarMonth])} ${calendarYear}</h2>
        <button type="button" class="button secondary small" data-action="calendar-next" aria-label="Next month"><span aria-hidden="true">›</span></button>
      </div>
      <div class="calendar-grid" aria-label="Calendar">
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
  return page(currentUser?.role || "resident", "calendar", body);
}

export function announcementEventMarkup(item) {
  if (!item?.isEvent) return "";
  const hasPin = Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
  if (!hasPin) return `<span class="approval-tag">Event</span>`;
  return `<span class="approval-tag">Event</span><button class="text-button" type="button" data-action="view-announcement-location" data-id="${esc(item.id)}">View event location</button>`;
}

const HOTLINE_FIELD_LABELS = {
  name: "Name",
  category: "Category",
  contactNumber: "Contact number",
  alternativeContactNumber: "Alternate number",
  officeAddress: "Office address",
  description: "Description",
  operatingHours: "Operating hours",
};
export { HOTLINE_FIELD_LABELS };

export function hotlineAvailabilityMarkup(item) {
  const active = item.status === "Active";
  return `<span class="status" data-status="${active ? "active" : "unavailable"}">${esc(HOTLINE_STATUS_LABELS[item.status] || item.status)}</span>`;
}

export function hotlineVerifiedLabel(item) {
  return item.verifiedAt ? dateTimeLabel(item.verifiedAt) : "Not yet verified";
}

function hotlineCallHref(number) {
  return `tel:${String(number || "").replace(/[^0-9+]/g, "")}`;
}

export function hotlineCard(item, role) {
  const description = item.description || "Contact this office for assistance.";
  const plantedAt = item.officeAddress ? `<li>${icon("pin")}<span>${esc(item.officeAddress)}</span></li>` : "";
  const hours = item.operatingHours ? `<li>${icon("clock")}<span>${esc(item.operatingHours)}</span></li>` : "";
  const alternate = item.alternativeContactNumber
    ? `<li>${icon("phone")}<span>Alternate: ${esc(item.alternativeContactNumber)}</span></li>`
    : "";
  const officialAction =
    role === "official"
      ? `<button class="button secondary small" type="button" data-action="request-hotline-correction" data-id="${esc(item.id)}" aria-label="Suggest correction for ${esc(item.name)}">Suggest correction</button>`
      : "";
  const callAction =
    item.status === "Active"
      ? `<a class="button small hotline-call-button" href="${esc(hotlineCallHref(item.contactNumber))}" aria-label="Call Now: ${esc(item.name)} at ${esc(item.contactNumber)}">${icon("phone")} Call Now</a>`
      : "";
  const facts = `${hours}${plantedAt}${alternate}`;
  return `<article class="hotline-card filter-item" data-hotline-category="${esc(item.category)}" data-search="${esc(`${item.name} ${item.category} ${item.description} ${item.contactNumber} ${item.officeAddress} ${item.status}`.toLowerCase())}">
    <header class="hotline-card-head"><div class="hotline-card-title"><span class="hotline-category">${esc(item.category)}</span><h3>${esc(item.name)}</h3></div>${hotlineAvailabilityMarkup(item)}</header>
    <p class="hotline-description">${esc(description)}</p>
    <div class="hotline-number-block"><span class="hotline-number-label">Emergency number</span><p class="hotline-number">${esc(item.contactNumber)}</p></div>
    ${facts ? `<ul class="hotline-facts">${facts}</ul>` : ""}
    <footer class="hotline-card-foot"><span class="record-secondary hotline-verified">${esc(hotlineVerifiedLabel(item))}</span><div class="hotline-actions button-row">${callAction}<button class="button secondary small" type="button" data-action="copy-hotline" data-number="${esc(item.contactNumber)}" aria-label="Copy ${esc(item.name)} number">${icon("copy")} Copy</button>${officialAction}</div></footer>
  </article>`;
}

export function hotlineDirectoryToolbar() {
  return `<div class="toolbar hotline-toolbar"><label class="search-field hotline-search-field">${icon("search")}<span class="visually-hidden">Search hotlines by name, category, or number</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search by name, category, or number"></label><label class="official-filter-field hotline-filter-field"><span class="visually-hidden">Filter by category</span><select class="select" data-hotline-category-filter aria-label="Filter hotlines by category"><option value="all">All categories</option>${HOTLINE_CATEGORIES.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label></div>`;
}

export function hotlineCorrectionInfo(item, hotlines) {
  const target = hotlines.find((hotline) => hotline.id === item.hotlineId);
  const fields = item.proposed || {};
  const isSuggestion = item.kind === "suggestion";
  const requestType = isSuggestion
    ? "New Hotline"
    : fields.contactNumber !== undefined || fields.alternativeContactNumber !== undefined
      ? "Update Contact Number"
      : "Update Hotline Details";
  return {
    requestId: `HC-${String(item.id).padStart(3, "0")}`,
    requestType,
    hotlineName: isSuggestion ? fields.name || "—" : target?.name || "—",
    category: isSuggestion ? fields.category || "—" : target?.category || "—",
    proposed: Object.entries(fields)
      .map(([field, value]) => `${HOTLINE_FIELD_LABELS[field] || field}: ${value}`)
      .join(" · "),
  };
}

export function hotlineCorrectionToolbar() {
  const options = (entries, value) =>
    entries
      .map(
        ([optionValue, label]) => `<option value="${esc(optionValue)}"${optionValue === value ? " selected" : ""}>${esc(label)}</option>`,
      )
      .join("");
  return `<div class="toolbar hotline-toolbar hotline-correction-toolbar">
    <label class="search-field hotline-search-field">${icon("search")}<span class="visually-hidden">Search correction requests</span><input class="input" type="search" data-correction-search autocomplete="off" placeholder="Search by ID, hotline, type, or submitter" value="${esc(correctionFilters.query)}"></label>
    <label class="official-filter-field hotline-filter-field"><span class="visually-hidden">Filter correction requests by status</span><select class="select" data-correction-status-filter aria-label="Filter correction requests by status">${options(
      [
        ["all", "All Statuses"],
        ["pending", "Pending"],
        ["approved", "Approved"],
        ["rejected", "Rejected"],
      ],
      correctionFilters.status,
    )}</select></label>
    <label class="official-filter-field hotline-filter-field"><span class="visually-hidden">Filter correction requests by type</span><select class="select" data-correction-type-filter aria-label="Filter correction requests by type">${options(
      [
        ["all", "All Request Types"],
        ["New Hotline", "New Hotline"],
        ["Update Contact Number", "Update Contact Number"],
        ["Update Hotline Details", "Update Hotline Details"],
      ],
      correctionFilters.type,
    )}</select></label>
    <label class="official-filter-field hotline-filter-field"><span class="visually-hidden">Filter correction requests by date</span><select class="select" data-correction-date-filter aria-label="Filter correction requests by date">${options(
      [
        ["all", "All Dates"],
        ["7d", "Last 7 days"],
        ["30d", "Last 30 days"],
        ["year", "This year"],
      ],
      correctionFilters.date,
    )}</select></label>
    <button class="button secondary small" type="button" data-action="reset-correction-filters">Reset</button>
  </div>`;
}

export function notificationsPage(role) {
  const notifications = sortedNotifications(data.notifications.filter((item) => item.targetEmail === currentUser.email));
  const reportUpdates = notifications.filter((item) => item.reportId);
  // Shortcut: account notices are recognised by title. A notification kind
  // column would be cleaner but needs a schema migration across all producers.
  const accountUpdates = notifications.filter((item) =>
    /ID verification|ID submitted|Password reset|Account deactivat|Account reactivat|email (?:verified|changed)/i.test(item.title),
  );
  const serviceUpdates = notifications.filter((item) => !item.reportId && !accountUpdates.includes(item));
  const visible =
    notificationFilter === "unread"
      ? notifications.filter((item) => !item.read)
      : notificationFilter === "read"
        ? notifications.filter((item) => item.read)
        : notificationFilter === "reports"
          ? reportUpdates
          : notificationFilter === "account"
            ? accountUpdates
            : notificationFilter === "service"
              ? serviceUpdates
              : notifications;
  const unread = notifications.filter((item) => !item.read).length;
  const emptyLabel =
    notificationFilter === "read"
      ? "No read notifications"
      : notificationFilter === "unread"
        ? "All caught up"
        : notificationFilter === "reports"
          ? "No report updates"
          : notificationFilter === "account"
            ? "No account updates"
            : notificationFilter === "service"
              ? "No service updates"
              : "No notifications yet";
  const emptyDetail =
    notificationFilter === "reports"
      ? "There are no updates for your concerns yet."
      : notificationFilter === "account"
        ? "Verifications, password changes and account decisions will appear here."
        : notificationFilter === "service"
          ? "There are no collection or barangay service updates yet."
          : `There are no ${notificationFilter === "unread" ? "unread " : notificationFilter === "read" ? "read " : ""}updates for this account.`;
  const countLabel = (count, singular, plural) => `${count} ${count === 1 ? singular : plural}`;
  const notificationSearch = (item) => {
    const report = item.reportId ? getReport(item.reportId) : null;
    return `${item.title} ${item.body} ${report ? displayReportId(report) : ""}`.toLowerCase();
  };
  const reportIdRefs = new Map((data.reports || []).filter((report) => report?.id).map((report) => [report.id, displayReportId(report)]));
  const body = `
    <div class="content-stack ${role === "resident" ? "resident-notifications-page" : ""}">
      ${panel(
        "Notification inbox",
        `<div class="notification-toolbar"><div class="filter-row" role="group" aria-label="Filter notifications">${[
          ["all", "All", notifications.length],
          ["unread", "Unread", unread],
          ["read", "Read", notifications.length - unread],
          ["reports", "Report updates", reportUpdates.length],
          ["account", "Account", accountUpdates.length],
          ["service", "Service updates", serviceUpdates.length],
        ]
          .map(
            ([value, label, count]) =>
              `<button type="button" class="filter-button ${notificationFilter === value ? "selected" : ""}" data-action="filter-notifications" data-value="${value}" aria-pressed="${notificationFilter === value}">${label} <span class="filter-count">${count}</span></button>`,
          )
          .join(
            "",
          )}</div>${unread ? actionButton("Mark all as read", "mark-all-read", "secondary", "small") : ""}</div><div class="notification-breakdown"><span>${countLabel(reportUpdates.length, "report update", "report updates")}</span><span>${countLabel(accountUpdates.length, "account update", "account updates")}</span><span>${countLabel(serviceUpdates.length, "service update", "service updates")}</span></div>
        <div class="notification-list records" data-page-size="5" role="list" aria-label="Notifications">${visible.length ? visible.map((item) => `<article class="notification-item filter-item ${item.read ? "" : "notification-unread"}" role="listitem" data-search="${esc(notificationSearch(item))}"><span class="notification-icon">${icon(item.reportId ? "clipboard" : accountUpdates.includes(item) ? "shield" : /event|calendar/i.test(item.title) ? "calendar" : "bell")}</span><div class="notification-content"><div class="notification-title"><strong>${esc(item.title)}</strong></div><p>${esc(displayReferenceText(item.body, reportIdRefs))}</p><div class="notification-meta"><span>${esc(dateTimeLabel(item.createdAt))}</span>${item.reportId ? `<button type="button" class="text-button" data-action="view-notification-report" data-id="${esc(item.reportId)}">View report</button>` : ""}</div></div><span class="notification-state" data-read="${item.read}">${item.read ? "Read" : "Unread"}</span>${item.read ? "" : `<button class="button secondary small notification-read-button" type="button" data-action="mark-read" data-id="${esc(item.id)}">Mark as read</button>`}</article>`).join("") : `<div class="empty-state"><strong>${emptyLabel}</strong>${emptyDetail}</div>`}</div>`,
        {
          icon: "bell",
          className: role === "resident" ? "resident-account-panel" : "",
          subtitle: `${unread} unread · ${notifications.length} total`,
        },
      )}
    </div>`;
  return page(role, "notifications", body);
}

function idStatusMarkup(status) {
  switch (status) {
    case "verified":
      return `<span class="id-verified-badge">ID verified</span>`;
    case "pending":
      return `<span class="id-status-badge pending">Under review</span>`;
    case "rejected":
      return `<span class="id-status-badge rejected">Rejected</span>`;
    default:
      return `<span class="id-status-badge">Not verified</span>`;
  }
}

export function idVerificationPanel(official = false) {
  const status = currentUser.idStatus || "unverified";
  const note = currentUser.idReviewNote ? esc(currentUser.idReviewNote) : "";
  const verified = status === "verified";
  const pending = status === "pending";
  const rejected = status === "rejected";
  const submitLabel = official
    ? verified || pending
      ? "Replace verification"
      : "Start verification"
    : verified
      ? "Replace ID"
      : pending
        ? "Replace submission"
        : rejected
          ? "Submit again"
          : "Verify my ID";
  const removeButton = `<button class="button danger small" type="button" data-action="id-remove">${pending ? "Cancel submission" : "Remove my ID data"}</button>`;
  const state = verified
    ? {
        title: "Your ID is verified",
        detail: official
          ? "Your ID and face are on file for your official account."
          : "Administrators see a badge beside your name on the concerns you file.",
        icon: "check",
      }
    : pending
      ? {
          title: "Waiting for review",
          detail: "Your submission is with an administrator. Nothing else is needed right now.",
          icon: "clock",
        }
      : rejected
        ? {
            title: "Review needs another look",
            detail: "Check the note below, then send a clearer photo or corrected details.",
            icon: "alert",
          }
        : {
            title: official ? "Verify your ID and face" : "Optional, but recommended",
            detail: official
              ? "Officials confirm their identity with a valid ID and a live face match."
              : "A verified ID confirms that your concerns come from a real resident.",
            icon: "shield",
          };
  const steps = official
    ? [
        ["Upload and scan your ID", "PhilSys, Driver's License, Passport or UMID. Details are read with OCR."],
        ["Register and match your face", "A guided camera check compares your face with the ID photo."],
        ["Barangay review", "An administrator completes the final review."],
      ]
    : [
        ["Take a clear photo", "Front of a government-issued ID; the back is optional."],
        ["Barangay review", "An administrator checks the image and the details on your account."],
        ["Verified badge", "Once approved, your name carries a Verified badge on concerns."],
      ];
  const photoPreviews =
    currentUser.hasIdImage || currentUser.hasIdBackImage
      ? `<div class="id-photo-previews" aria-label="Your submitted ID images">
          ${
            currentUser.hasIdImage
              ? `<figure><img src="/api/verification/id/me/image" alt="Front of your ID"><figcaption>Front of ID</figcaption></figure>`
              : `<figure class="id-photo-empty"><span>No front photo</span><figcaption>Front of ID</figcaption></figure>`
          }
          ${
            currentUser.hasIdBackImage
              ? `<figure><img src="/api/verification/id/me/image-back" alt="Back of your ID"><figcaption>Back of ID</figcaption></figure>`
              : `<figure class="id-photo-empty"><span>No back photo added</span><figcaption>Back of ID (optional)</figcaption></figure>`
          }
        </div>`
      : "";
  return `<details class="panel id-verification-panel profile-collapsible-panel" id="id-panel"${idPanelOpen ? " open" : ""}>
    <summary class="panel-head"><div><h2>${official ? "Integrated identity verification" : "Identity verification"}</h2><p class="field-help">${official ? "Your government ID and face are checked together, then reviewed by an administrator." : "A government-issued ID, reviewed by an administrator. You can delete the image and the record at any time."}</p></div>${idStatusMarkup(status)}</summary>
    <div class="panel-body">
      <div class="id-verification-state" data-status="${esc(status)}">
        <span class="id-verification-icon" aria-hidden="true">${icon(state.icon)}</span>
        <div><strong>${state.title}</strong><span>${state.detail}</span></div>
      </div>
      ${rejected && note ? `<div class="notice-bar id-review-note"><span>Reviewer's note: ${note}</span><strong>Rejected</strong></div>` : ""}
      <ol class="id-verification-steps">
        ${steps.map(([title, detail]) => `<li><div><strong>${title}</strong><span>${detail}</span></div></li>`).join("")}
      </ol>
      ${photoPreviews}
      <p class="field-help">Only you and administrators can see these images. You can permanently remove them and the details from this panel at any time.</p>
      <div class="form-actions id-verification-actions">
        <button class="button${verified || pending ? " secondary" : ""}" type="button" data-action="verify-id">${submitLabel}</button>
        ${status === "unverified" ? "" : removeButton}
      </div>
    </div>
  </details>`;
}

export function faceCheckMarkup(enrolled, allowRemove = true, showGuide = true) {
  return `<div class="face-check">
    <div class="face-check-stage" data-step="front">
      <div class="face-video-frame" data-camera-state="idle" data-capturing="false">
        <video id="face-video" class="face-video" autoplay playsinline muted aria-hidden="true"></video>
        <div class="face-camera-state" id="face-camera-state" role="status">
          <span class="face-camera-icon" aria-hidden="true">${icon("cameraOff", "face-camera-icon-svg")}</span>
          <strong class="face-camera-title">Camera is off</strong>
          <span class="face-camera-detail">Start the check to turn on your camera.</span>
          <span class="face-camera-note">The preview stays on this device.</span>
        </div>
        <div class="face-guide" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <span class="face-live" aria-hidden="true"><span class="face-live-dot"></span>Live</span>
        <div class="face-hud" aria-hidden="true">
          <div class="face-hud-progress" id="face-hud-progress"><span></span><span></span><span></span><span></span></div>
          <span class="face-hud-chip" id="face-hud-chip">Centre your face</span>
          <p class="face-hud-instruction" id="face-hud-instruction">Look straight at the camera.</p>
        </div>
        <span class="face-capture-ring" aria-hidden="true"></span>
        <button class="face-hud-cancel" type="button" data-action="face-check-cancel" hidden>Cancel</button>
      </div>
      <div class="face-check-guide">
        ${
          showGuide
            ? `<p class="face-check-eyebrow">How the check runs</p>
        <ol class="face-check-steps">
          <li data-step="front"><div><strong>Look straight</strong><span>Keep your whole face inside the frame.</span></div></li>
          <li data-step="blink"><div><strong>Blink once</strong><span>Confirms a live person, not a printed photo.</span></div></li>
          <li data-step="turn"><div><strong>Turn left, then right</strong><span>Follow the prompt as it changes.</span></div></li>
        </ol>`
            : ""
        }
        <p class="face-stage" id="face-stage" role="status" aria-live="polite">Press the button when you are ready. Look straight at the camera, blink once, then slowly turn left and right.</p>
      </div>
    </div>
    <p class="face-check-result" id="face-check-result" role="status" aria-live="polite"${faceCheckNotice ? ' data-state="success"' : ""}>${esc(faceCheckNotice)}</p>
    <div class="form-actions face-check-actions">
      <button class="button" type="button" id="face-check-start" data-face-start data-idle-label="${enrolled ? "Start face check" : "Enroll face"}" data-action="${enrolled ? "face-check-start" : "face-enroll-start"}">${enrolled ? "Start face check" : "Enroll face"}</button>
      <button class="button secondary" type="button" id="face-check-cancel" data-action="face-check-cancel" hidden>Cancel</button>
      ${enrolled && allowRemove ? `<button class="button danger" type="button" data-action="face-self-remove">Remove my face data</button>` : ""}
    </div>
    ${showGuide ? `<p class="face-engine-note">Identity check: ${verificationSettings.faceppEnabled ? "Face++" : "on-device"}. ${verificationSettings.faceppEnabled ? "Re-enroll if this account was enrolled before Face++ was enabled." : ""}</p>` : ""}
  </div>`;
}

export function faceVerificationPanel() {
  const enrolled = Boolean(currentUser.faceEnrolled);
  return `<details class="panel face-verification-panel profile-collapsible-panel" id="face-panel"${facePanelOpen ? " open" : ""}>
    <summary class="panel-head face-panel-head">
      <span class="face-panel-icon" aria-hidden="true">${icon("shield")}</span>
      <div class="face-panel-copy"><h2>Face check</h2><p class="face-panel-subtitle">Prove it's you before making changes during a duty check.</p></div>
      <span class="face-panel-status ${enrolled ? "is-enrolled" : ""}"><span class="face-panel-status-dot" aria-hidden="true"></span>${enrolled ? "Enrolled" : "Not enrolled"}</span>
    </summary>
    <div class="panel-body">${faceCheckMarkup(enrolled)}</div>
  </details>`;
}

export function profileSummaryCard(role) {
  const recoveryEmail = currentUser.recoveryEmail || "";
  const recoveryVerified = Boolean(currentUser.recoveryEmailVerified);
  const collapsed = Boolean(profileSummaryCollapsed);
  const accountStatus = normalizeStatus(currentUser.status || "Active");
  const isActive = accountStatus === "active";
  const statusDotClass = isActive ? "is-active" : "is-inactive";
  const recoveryState = recoveryEmail ? (recoveryVerified ? "verified" : "pending") : "unset";

  const rows = [
    `<div class="profile-summary-row"><span class="profile-summary-label">Role</span><span class="profile-summary-value">${esc(ROLES[role] || roleLabel(role))}</span></div>`,
    `<div class="profile-summary-row"><span class="profile-summary-label">Account status</span><span class="profile-summary-value">${statusPill(currentUser.status || "Active")}</span></div>`,
    role === "resident"
      ? `<div class="profile-summary-row"><span class="profile-summary-label">Recovery email</span><span class="profile-summary-value">${recoveryEmail ? statusPill(recoveryVerified ? "active" : "pending", recoveryVerified ? "Verified" : "Not verified") : `<span class="record-meta">Not set</span>`}</span></div>`
      : "",
    role === "resident" || role === "official"
      ? `<div class="profile-summary-row"><span class="profile-summary-label">ID verification</span><span class="profile-summary-value">${idStatusMarkup(currentUser.idStatus)}</span></div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `<section class="profile-summary-float ${collapsed ? "is-collapsed" : ""}" data-theme-role="${esc(role)}" aria-label="Account summary">
    <button class="profile-summary-toggle" type="button" data-action="toggle-profile-summary" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="profile-summary-body">
      <span class="profile-summary-heading"><span class="profile-summary-dot ${statusDotClass}" aria-hidden="true"></span><span class="profile-summary-title">Account summary</span></span>
      <span class="profile-summary-toggle-icon" aria-hidden="true">${collapsed ? "+" : "−"}</span>
    </button>
    <div id="profile-summary-body" class="profile-summary-body" data-recovery="${esc(recoveryState)}"${collapsed ? " hidden" : ""}>${rows}</div>
  </section>`;
}

export function passwordInput(label, name, id, autocomplete, minimum = 0, help = "") {
  const helpId = help ? `${id}-help` : "";
  const describedBy = helpId ? ` aria-describedby="${helpId}"` : "";
  return `<div class="form-field"><label for="${id}">${esc(label)}</label><div class="password-field"><input class="input" id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" ${minimum ? `minlength="${minimum}"` : ""}${describedBy} required><button class="password-toggle" type="button" data-action="toggle-password-field" data-target="${id}" aria-label="Show ${esc(label.toLowerCase())}">${icon("eye")}</button></div>${helpId ? `<p class="field-help" id="${helpId}">${esc(help)}</p>` : ""}</div>`;
}
