"use strict";

import { BARANGAY_WORKING_HOURS, HOTLINE_CATEGORIES, HOTLINE_STATUS_LABELS } from "./constants.mjs";
import {
  locationAreas,
  residentAreaOptions,
  icon,
  brandMark,
  esc,
  asDate,
  dateLabel,
  dateTimeLabel,
  todayISO,
  monthKey,
  monthKeyOffset,
  normalizeStatus,
  statusPill,
  roleLabel,
  initials,
  unreadCount,
  displayReportId,
  displayReferenceText,
  displayReportTitle,
  effectivePermissions,
  getUser,
  getReport,
  userReports,
  sortedReports,
  sortedSchedules,
  sortedNotifications,
  routeUrl,
  linkButton,
  actionButton,
  inputField,
  selectField,
  calendarEventFromRecord,
  app,
  data,
  currentUser,
  adminReportFilters,
  analyticsRange,
  approvalFilter,
  selectedReportId,
  reportFilter,
  residentReportSort,
  notificationFilter,
  officialAssignedFilter,
  officialHistorySort,
  uploadPhotos,
  smtpSettings,
  reportDraft,
  modalState,
  calendarMonth,
  calendarYear,
  calendarSelectedDate,
  selectedPermissionAccount,
  correctionFilters,
  permissionDrafts,
  permissionOpenAccounts,
  activityLogState,
  activityFilters,
  profileSummaryCollapsed,
  facePanelOpen,
  idPanelOpen,
  verificationSettings,
  faceCheckNotice,
} from "./core.mjs";
import {
  getAppTimeZone,
  ROLES,
  STATUSES,
  REPORT_TRANSITIONS,
  ID_TYPE_LABELS,
  CATEGORIES,
  REPORT_PRIORITIES,
  FOLLOW_UP_LIMITS,
  MAX_REPORT_DESCRIPTION_LENGTH,
  AREAS,
  PERMISSION_DEFS,
  ADMIN_ROLE_PERMISSION_IDS,
} from "./constants.mjs";
import { modalMarkup } from "./main.mjs";
import { reportMapExpanded, reportMapSelection, reportMapGeoLocating, locationMapExpanded } from "./map.mjs";

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
      profile: ["Your profile", "Keep your contact and area details up to date."],
    },
    official: {
      dashboard: ["Barangay overview", "The latest concerns and collection activity across the community."],
      calendar: ["Calendar", "Announcements and collection schedules in one place."],
      concerns: ["Concern queue", "Review resident reports and record the next step."],
      assigned: ["My assigned concerns", "Track and manage concerns assigned to you."],
      collection: ["Collection management", "Maintain schedules and post service-status changes."],
      history: ["Report history", "Review concern updates recorded by the barangay."],
      notifications: ["Notifications", "New concerns and service updates for your team."],
      announcements: ["Announcements", "Publish service notices for residents and staff."],
      hotlines: ["Emergency hotlines", "Check published hotlines and suggest corrections to the administrator."],
      profile: ["Your profile", "Keep your official account details up to date."],
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

function scheduleDescription(schedule) {
  const service = String(schedule?.wasteType || "Waste").trim();
  const where = [schedule?.area, schedule?.zone].filter(Boolean).join(", ");
  const team = String(schedule?.team || "").trim();
  const parts = [`${service} collection`];
  if (where) parts.push(`in ${where}`);
  if (team) parts.push(`by ${team}`);
  return `${parts.join(" ")}.`;
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
      const eventTitles = cell.events.slice(0, 2).map((event) => event.title).join(" ");
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
          { subtitle: "Events you requested that are waiting for approval or were declined." },
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

export function collectionResident() {
  const schedules = sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area);
  const next = upcomingSchedule(currentUser.area);
  const nextNote = next && ["Delayed", "Cancelled"].includes(next.status) ? (next.history || []).at(-1)?.note : "";
  const body = `
    <div class="content-stack resident-collection-page">
      ${panel("Your next collection", next ? `<div class="resident-next-collection"><div class="resident-collection-date"><span class="resident-collection-icon">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.start)} – ${esc(next.end)}</span><p class="resident-collection-description">${esc(scheduleDescription(next))}</p></div></div><div class="resident-collection-meta"><span>${icon("activity")}<strong>${esc(next.wasteType)}</strong></span><span>${icon("pin")}<strong>${esc(next.area)}${next.zone ? ` · ${esc(next.zone)}` : ""}</strong></span><span>${icon("users")}<strong>${esc(next.team || "Team not listed")}</strong></span></div><div class="resident-collection-status">${statusPill(next.status)}${nextNote ? `<span>${esc(nextNote)}</span>` : ""}</div></div>` : `<div class="empty-state"><strong>No upcoming collection posted</strong>Your barangay will appear here when a schedule is available.</div>`, { icon: "calendar", className: "resident-collection-feature" })}
      ${panel("Collection schedule", scheduleRows(schedules), { icon: "calendar", subtitle: "Collections scheduled for your selected area", className: "resident-collection-table-panel" })}
    </div>`;
  return page("resident", "collection", body);
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

export function announcementEventMarkup(item) {
  if (!item?.isEvent) return "";
  const hasPin = Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
  if (!hasPin) return `<span class="approval-tag">Event</span>`;
  return `<span class="approval-tag">Event</span><button class="text-button" type="button" data-action="view-announcement-location" data-id="${esc(item.id)}">View event location</button>`;
}

export function announcementsPage(role) {
  if (role === "official") return officialAnnouncementsPage();
  const isManager = role === "official" || role === "administrator";
  const announcements = [...data.announcements].sort((a, b) => asDate(b.date) - asDate(a.date));
  const statusLabel = (item) =>
    item.approvalStatus === "pending" ? "Pending approval" : item.approvalStatus === "declined" ? "Declined" : "Published";
  const rows = announcements
    .map(
      (
        item,
      ) => `<div class="record-row filter-item" role="row" data-date="${esc(item.date)}" data-announcement-status="${esc(item.approvalStatus === "pending" ? "pending" : item.approvalStatus === "declined" ? "declined" : "published")}" data-search="${esc(`${item.title} ${item.detail} ${item.isEvent ? "event" : ""} ${statusLabel(item)}`.toLowerCase())}">
    <div role="cell"><strong class="record-primary">${esc(item.title)}</strong>${item.isEvent ? `<div class="announcement-event-meta">${announcementEventMarkup(item)}</div>` : ""}<span class="record-secondary">${esc(item.detail)}</span></div>
    <div class="record-date" role="cell" data-label="Publish date">${esc(dateLabel(item.date))}</div>
    <div role="cell" data-label="Status">${statusPill(item.approvalStatus === "pending" ? "pending" : item.approvalStatus === "declined" ? "declined" : "approved", statusLabel(item))}</div>
    <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="edit-announcement" data-id="${esc(item.id)}">Edit</button>${role === "administrator" && item.approvalStatus === "pending" ? `<a class="text-button" href="${routeUrl("administrator", "approvals")}">Review in approval queue</a>` : ""}</div>
  </div>`,
    )
    .join("");
  const body = `<div class="content-stack">
    ${panel(
      "Community announcements",
      `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search announcements</span><input class="input" type="search" data-search-input autocomplete="off"></label><label class="official-filter-field"><span class="visually-hidden">Sort announcements</span><select class="select" data-announcement-sort aria-label="Sort announcements by publish date"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
      <div class="records mt-16" data-announcement-records data-page-size="10" role="table" aria-label="Announcements"><div class="record-row record-head" role="row"><span role="columnheader">Announcement</span><span role="columnheader">Date</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>${rows || `<div class="empty-state"><strong>No announcements yet</strong>Updates published by barangay staff will appear here.</div>`}</div>`,
      {
        subtitle: isManager ? "Create or update a notice for residents and staff." : "Service information shared by barangay staff.",
        action: isManager ? actionButton(`${icon("plus")} New announcement`, "add-announcement", "small") : "",
      },
    )}
  </div>`;
  return page(role, "announcements", body);
}

function officialAnnouncementsPage() {
  const announcements = [...data.announcements].sort((a, b) => asDate(b.date) - asDate(a.date));
  const published = announcements.filter((item) => !["pending", "declined"].includes(item.approvalStatus)).length;
  const pending = announcements.filter((item) => item.approvalStatus === "pending").length;
  const rows = announcements
    .map((item) => {
      const state = item.approvalStatus === "pending" ? "pending" : item.approvalStatus === "declined" ? "declined" : "published";
      const label = state === "pending" ? "Pending approval" : state === "declined" ? "Declined" : "Published";
      return `<div class="record-row filter-item" role="row" data-announcement-status="${state}" data-search="${esc(`${item.title} ${item.detail} ${item.isEvent ? "event" : ""} ${label}`.toLowerCase())}">
        <div role="cell"><strong class="record-primary">${esc(item.title)}</strong>${item.isEvent ? `<div class="announcement-event-meta">${announcementEventMarkup(item)}</div>` : ""}</div>
        <div class="record-date" role="cell" data-label="Date">${esc(dateLabel(item.date, { month: "short", day: "numeric", year: "numeric" }))}</div>
        <div role="cell" data-label="Status">${statusPill(state, label)}</div>
        <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="edit-announcement" data-id="${esc(item.id)}">Edit</button></div>
      </div>`;
    })
    .join("");
  const body = `<div class="content-stack official-announcements-page">
    ${statsStrip([
      stat("Total announcements", announcements.length, "", "", "activity"),
      stat("Published", published, "", "success", "check"),
      stat("Pending approval", pending, "", "warning", "clock"),
    ])}
    ${panel(
      "Community announcements",
      `<div class="toolbar official-announcement-toolbar">
        <label class="search-field">${icon("search")}<span class="visually-hidden">Search announcements</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search announcements..."></label>
        <label class="official-filter-field"><span class="visually-hidden">Filter by status</span><select class="select" data-official-announcement-filter><option value="all">All statuses</option><option value="published">Published</option><option value="pending">Pending approval</option><option value="declined">Declined</option></select></label>
      </div>
      <div class="records official-announcement-records mt-16" data-page-size="5" data-pagination-target="official-announcement-pagination" data-results-counter="official-announcements" role="table" aria-label="Community announcements"><div class="record-row record-head" role="row"><span role="columnheader">Title</span><span role="columnheader">Date</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>${rows || `<div class="empty-state"><strong>No announcements yet</strong>Updates published by barangay staff will appear here.</div>`}</div>
      <div class="official-announcement-footer"><span data-results-summary="official-announcements"></span><div id="official-announcement-pagination"></div></div>`,
      { action: actionButton(`${icon("plus")} New announcement`, "add-announcement", "small") },
    )}
  </div>`;
  return page("official", "announcements", body);
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

export function collectionOfficial() {
  const schedules = sortedSchedules(data.schedules);
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat(
          "Upcoming collections",
          schedules.filter((item) => item.date >= todayISO() && !["Cancelled", "Completed"].includes(item.status)).length,
          "",
          "",
          "calendar",
        ),
        stat("Completed", schedules.filter((item) => item.status === "Completed").length, "", "success", "check"),
        stat("Cancelled", schedules.filter((item) => item.status === "Cancelled").length, "", "danger", "close"),
        stat("Collection areas", new Set(schedules.map((item) => item.area)).size, "", "", "pin"),
      ])}
      ${panel("Collection schedules", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search schedules</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search schedules..."></label></div>${scheduleRows(schedules, true)}`, { subtitle: "Edit an existing schedule or add a collection", action: actionButton(`${icon("plus")} Add schedule`, "add-schedule", "small") })}
    </div>`;
  return page("official", "collection", body);
}

export function reportFormMarkup() {
  const draft = reportDraft || {};
  const reportAreas = residentAreaOptions();
  const defaultArea = reportAreas.includes(draft.area)
    ? draft.area
    : reportAreas.includes(currentUser.area)
      ? currentUser.area
      : reportAreas[0];
  const selectedReportArea = defaultArea;
  return `
    <section class="panel resident-report-form ${reportDraft?.step === "review" ? "resident-report-review" : ""}"><div class="panel-body">
      <div class="wizard-progress" aria-label="Step ${reportDraft?.step === "review" ? "2" : "1"} of 2">
        <div class="wizard-step ${reportDraft?.step === "review" ? "done" : "current"}"><strong>${reportDraft?.step === "review" ? icon("check") : "1"}</strong><span>Concern details</span></div><span class="wizard-divider"></span>
        <div class="wizard-step ${reportDraft?.step === "review" ? "current" : ""}"><strong>2</strong><span>Review & submit</span></div>
      </div>
      <div class="location-gate" id="report-location-gate" data-state="prompt" role="status" aria-live="polite" aria-busy="false">
        <span class="location-gate-chip" aria-hidden="true">${icon("pin", "location-gate-icon")}</span>
        <div class="location-gate-copy">
          <h2 class="location-gate-title" id="report-location-title" tabindex="-1">Confirm you're in Palsara</h2>
          <p class="location-gate-detail" id="report-location-detail">We'll ask for your location once so we can confirm you're reporting from the barangay.</p>
          <p class="location-gate-footnote">We check your location once when you submit. We don't store it.</p>
        </div>
        <div class="location-gate-actions" id="report-location-actions"><button class="button" type="button" data-action="location-allow">Allow location</button></div>
      </div>
      <p class="visually-hidden" id="report-location-alert" role="alert"></p>
      ${
        reportDraft?.step === "review"
          ? `
        <div class="content-stack">
          <p class="field-help">Review your concern before submitting.</p>
          <section class="report-review-section">
            <div class="section-heading"><div><h2>Concern details</h2></div></div>
            <div class="notice-bar"><span>Concern</span><strong>${esc(draft.category)}</strong></div>
            <div class="notice-bar"><span>Priority</span>${statusPill(normalizeStatus(draft.priority || "Medium"), draft.priority || "Medium")}</div>
            <div class="notice-bar"><span>Purok or area</span><strong>${esc(draft.area || defaultArea)}</strong></div>
            <div class="notice-bar"><span>Street or landmark</span><strong>${esc(draft.locationDetail)}</strong></div>
          </section>
          <section class="report-review-section">
            <div class="section-heading"><div><h2>Location &amp; evidence</h2></div></div>
            ${draft.latitude == null ? `<div class="notice-bar"><span>Location</span><strong>Not selected</strong></div>` : `<div class="form-field report-review-map"><span class="field-help">Location where you placed the pin</span><div class="report-map-region"><p class="visually-hidden" id="report-detail-map-status" role="status" aria-live="polite"></p><div class="report-map-canvas" id="report-detail-map" role="application" data-readonly="true" data-latitude="${esc(String(draft.latitude))}" data-longitude="${esc(String(draft.longitude))}" aria-label="Map showing the location pin you placed"></div></div></div>`}
            <div class="form-field"><span class="field-help">Description</span><p class="report-draft-description">${esc(draft.description)}</p></div>
            <div class="form-field"><span class="field-help">Photos</span>${uploadPhotos.length ? `<div class="photo-preview">${uploadPhotos.map((photo) => `<div class="photo-thumb"><img src="${esc(photo.previewUrl)}" alt="${esc(photo.name)}"></div>`).join("")}</div>` : `<p class="muted small">No photos attached.</p>`}</div>
          </section>
          <div class="form-actions"><button class="button secondary" type="button" data-action="edit-report-draft">Edit details</button><button class="button" type="button" data-action="submit-report" aria-describedby="report-location-detail">Submit concern</button></div>
          <p class="report-location-submit-hint" id="report-location-submit-hint" hidden>Confirm your location to submit.</p>
        </div>`
          : `
        <form id="report-draft-form" class="form-stack">
          <div class="form-grid">
            ${selectField("Concern category", "category", CATEGORIES, draft.category || "", { required: true, placeholder: "Choose a concern type" })}
            ${selectField("Risk or priority", "priority", REPORT_PRIORITIES, draft.priority || "Medium", { required: true })}
            ${selectField("Purok or area", "area", reportAreas, selectedReportArea, { required: true })}
            ${inputField("Street or nearby landmark", "locationDetail", draft.locationDetail || "", { required: true, maxLength: 250 })}
            <div class="form-field span-all report-map-picker">
              <input type="hidden" id="report-latitude" name="latitude" value="${esc(reportMapSelection?.latitude ?? "")}">
              <input type="hidden" id="report-longitude" name="longitude" value="${esc(reportMapSelection?.longitude ?? "")}">
              <span class="field-help">This marks where the concern happened. Your location is checked separately to confirm you're in Palsara.</span>
              <div class="button-row">
                <button class="button secondary" type="button" data-action="toggle-report-map" aria-expanded="${reportMapExpanded}">${reportMapExpanded ? "Hide map" : "Where did this happen?"}</button>
                <button class="button secondary" type="button" data-action="use-current-location">${reportMapGeoLocating ? "Locating…" : "Use my location"}</button>
                <button class="button secondary" type="button" data-action="clear-report-map-pin" ${reportMapSelection ? "" : "hidden"}>Clear pin</button>
              </div>
              <div class="report-map-region" id="report-map-region" ${reportMapExpanded ? "" : "hidden"}>
                <p class="visually-hidden" id="report-map-status" role="status" aria-live="polite"></p>
                <div class="report-map-canvas" id="report-map" role="application" aria-label="Map. Click to place a location pin, or drag the pin to adjust it."></div>
              </div>
            </div>
            <div class="form-field span-all"><div class="resident-description-label"><label for="description">Describe what happened *</label><span id="description-counter" class="resident-description-counter" aria-live="polite">${String(draft.description || "").length}/${MAX_REPORT_DESCRIPTION_LENGTH}</span></div><textarea class="textarea" id="description" name="description" required minlength="12" maxlength="${MAX_REPORT_DESCRIPTION_LENGTH}" aria-describedby="description-help description-counter">${esc(draft.description || "")}</textarea><span class="field-help" id="description-help">Share the key details in up to ${MAX_REPORT_DESCRIPTION_LENGTH} characters.</span></div>
            <div class="form-field span-all"><span class="field"><label for="report-photos">Attach photos (optional)</label><label class="upload-box" for="report-photos">${icon("image")}<strong>Choose photos from this device</strong><input class="visually-hidden" id="report-photos" name="photos" type="file" accept="image/jpeg,image/png" multiple></label><div class="photo-preview" id="photo-preview">${photoPreviewMarkup()}</div></span></div>
          </div>
          <div class="form-actions"><a class="button secondary" href="${routeUrl("resident", "dashboard")}">Cancel</a><button class="button" type="submit">Review report ${icon("arrow")}</button></div>
        </form>`
      }
    </div></section>`;
}

export function reportPage() {
  return page("resident", "report", reportFormMarkup());
}

export function reportsPage(role, view) {
  if (role === "administrator") return administratorReportsPage();
  const userRows = role === "resident" ? userReports() : data.reports;
  const selection = selectedReportId ? getReport(selectedReportId) : null;
  if (selection && (role !== "resident" || selection.userEmail === currentUser.email)) return reportDetail(selection, role);
  const officialQueue = role === "official" && view === "concerns";
  const canFilter = (role === "resident" || role === "administrator") && view === "reports";
  const allowedFilters = officialQueue ? [...STATUSES.slice(0, -1)] : canFilter ? ["all", ...STATUSES] : [];
  const activeFilter = allowedFilters.includes(reportFilter) ? reportFilter : "all";
  const filtered = sortedReports(
    officialQueue || canFilter ? userRows.filter((report) => (activeFilter === "all" ? true : report.status === activeFilter)) : userRows,
  );
  const subtitle = view === "history" ? "A complete record of submitted concerns and their latest updates." : pageTitle(role, view)[1];
  const showResolvedSeparately = !canFilter || activeFilter === "all";
  const activeRows = view === "history" || !showResolvedSeparately ? filtered : filtered.filter((report) => report.status !== "Resolved");
  const resolvedRows = view === "history" || !showResolvedSeparately ? [] : filtered.filter((report) => report.status === "Resolved");
  const primaryAction =
    role === "resident" && view !== "reports" ? linkButton(`${icon("plus")} Report a concern`, routeUrl("resident", "report"), "") : "";
  const exportActions =
    role === "resident"
      ? view === "reports"
        ? `<button class="button secondary small" type="button" data-action="export-reports">${icon("download")} Export reports</button>`
        : view === "history"
          ? `<button class="button secondary small" type="button" data-action="export-report-history">${icon("download")} Export history</button>`
          : ""
      : view === "history"
        ? `<button class="button secondary small" type="button" data-action="export-report-history">${icon("download")} Export history</button>`
        : `<button class="button secondary small" type="button" data-action="export-reports">${icon("download")} Export reports</button>`;
  const historyControls =
    role === "resident" && view === "reports"
      ? `<div class="resident-reports-toolbar">${searchToolbar("Search your reports by ID or concern")}<label class="resident-report-sort"><span>Sort by submission date</span><select class="select" data-resident-report-sort aria-label="Sort reports by submission date"><option value="newest"${residentReportSort === "newest" ? " selected" : ""}>Newest first</option><option value="oldest"${residentReportSort === "oldest" ? " selected" : ""}>Oldest first</option></select></label></div>`
      : role === "official" && view === "history"
        ? `<div class="official-history-toolbar">${searchToolbar("Search report activity")}<label class="official-history-sort-field"><span>Sort by</span><select class="select" data-official-history-sort>
          <option value="newest"${officialHistorySort === "newest" ? " selected" : ""}>Date (Newest first)</option>
          <option value="oldest"${officialHistorySort === "oldest" ? " selected" : ""}>Date (Oldest first)</option>
          <option value="concern-asc"${officialHistorySort === "concern-asc" ? " selected" : ""}>Concern type (A-Z)</option>
          <option value="concern-desc"${officialHistorySort === "concern-desc" ? " selected" : ""}>Concern type (Z-A)</option>
          <option value="resident-asc"${officialHistorySort === "resident-asc" ? " selected" : ""}>Resident name (A-Z)</option>
          <option value="resident-desc"${officialHistorySort === "resident-desc" ? " selected" : ""}>Resident name (Z-A)</option>
        </select></label></div>`
        : searchToolbar(role === "official" && view === "history" ? "Search report activity" : undefined);
  const body = `
    <div class="content-stack">
      ${panel(role === "official" && view === "history" ? "Report activity" : view === "history" ? "Past and current concerns" : role === "official" ? "Concern queue" : role === "resident" ? "My Reports" : "Reports", `${role === "official" && view === "history" ? "" : view === "reports" ? reportFilters(userRows, activeFilter) : officialQueue ? officialReportFilters(userRows, activeFilter) : ""}${historyControls}<div class="mt-16" data-report-table>${role === "official" && view === "history" ? reportHistoryRows(userRows, officialHistorySort) : reportRows(view === "history" ? filtered : activeRows, role, resolvedRows.length ? "Resolved ones are listed below." : "")}</div>${resolvedRows.length && view !== "history" ? `<div class="section-heading mt-20"><div><h2>Resolved concerns</h2><p>${resolvedRows.length} marked as addressed</p></div></div><div data-report-table>${reportRows(resolvedRows, role)}</div>` : ""}`, { subtitle: role === "resident" && view === "reports" ? "" : subtitle, action: exportActions, className: role === "resident" && view === "reports" ? "resident-reports-panel" : "" })}
    </div>`;
  return page(role, view, body, primaryAction);
}

function administratorReportsPage() {
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

function hotlineAvailabilityMarkup(item) {
  const active = item.status === "Active";
  return `<span class="status" data-status="${active ? "active" : "unavailable"}">${esc(HOTLINE_STATUS_LABELS[item.status] || item.status)}</span>`;
}

function hotlineVerifiedLabel(item) {
  return item.verifiedAt ? dateTimeLabel(item.verifiedAt) : "Not yet verified";
}

function hotlineCallHref(number) {
  return `tel:${String(number || "").replace(/[^0-9+]/g, "")}`;
}

function hotlineCard(item, role) {
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

function hotlineDirectoryToolbar() {
  return `<div class="toolbar hotline-toolbar"><label class="search-field hotline-search-field">${icon("search")}<span class="visually-hidden">Search hotlines by name, category, or number</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search by name, category, or number"></label><label class="official-filter-field hotline-filter-field"><span class="visually-hidden">Filter by category</span><select class="select" data-hotline-category-filter aria-label="Filter hotlines by category"><option value="all">All categories</option>${HOTLINE_CATEGORIES.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}</select></label></div>`;
}

function hotlineCorrectionInfo(item, hotlines) {
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

function hotlineCorrectionToolbar() {
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

export function residentHotlinesPage() {
  const hotlines = (data.hotlines || []).filter((item) => item.published);
  const body = `<div class="content-stack resident-hotlines-page">
    ${panel(
      "Emergency contacts",
      `${hotlineDirectoryToolbar()}<div class="hotline-grid mt-16" data-hotline-results>${hotlines.length ? hotlines.map((item) => hotlineCard(item, "resident")).join("") : `<div class="empty-state"><strong>No hotlines published yet</strong>Barangay staff will publish emergency contacts here.</div>`}</div><div class="empty-state hotline-no-results" hidden><strong>No matching hotlines</strong>Try a different name, number, or category.</div>`,
      {
        icon: "phone",
        subtitle: "Call the right office during an emergency. Numbers are checked by barangay staff.",
        className: "resident-hotlines-panel",
      },
    )}
  </div>`;
  return page("resident", "hotlines", body);
}

export function officialHotlinesPage() {
  const hotlines = (data.hotlines || []).filter((item) => item.published);
  const corrections = data.hotlineCorrections || [];
  const pending = corrections.filter((item) => item.status === "pending").length;
  const requestRows = corrections
    .map((item) => {
      const { requestId, requestType, hotlineName, category, proposed } = hotlineCorrectionInfo(item, data.hotlines || []);
      return `<div class="record-row filter-item hotline-correction-row" role="row" data-correction-status="${esc(item.status)}" data-correction-type="${esc(requestType)}" data-submitted="${esc(String(item.createdAt || "").slice(0, 10))}" data-search="${esc(`${requestId} ${requestType} ${hotlineName} ${category} ${item.submittedByName || ""} ${item.reason} ${proposed} ${item.status}`.toLowerCase())}">
        <div class="record-meta" role="cell" data-label="Request ID">${esc(requestId)}</div>
        <div class="record-meta" role="cell" data-label="Request Type">${esc(requestType)}</div>
        <div role="cell"><strong class="record-primary">${esc(hotlineName)}</strong></div>
        <div class="record-meta" role="cell" data-label="Category">${esc(category)}</div>
        <div class="record-date" role="cell" data-label="Date submitted">${esc(dateLabel(item.createdAt))}</div>
        <div class="record-actions" role="cell" data-label="Action"><button class="button secondary small" type="button" data-action="view-hotline-correction" data-id="${esc(item.id)}">View Details</button></div>
      </div>`;
    })
    .join("");
  const body = `<div class="content-stack">
    ${statsStrip([
      stat("Published contacts", hotlines.length, "", "", "phone"),
      stat("Active now", hotlines.filter((item) => item.status === "Active").length, "", "success", "check"),
      stat("My pending requests", pending, "", "warning", "clock"),
    ])}
    ${panel(
      "Published hotlines",
      `${hotlineDirectoryToolbar()}<div class="hotline-grid mt-16" data-hotline-results>${hotlines.length ? hotlines.map((item) => hotlineCard(item, "official")).join("") : `<div class="empty-state"><strong>No hotlines published yet</strong>Published emergency contacts will appear here.</div>`}</div><div class="empty-state hotline-no-results" hidden><strong>No matching hotlines</strong>Try a different name, number, or category.</div>`,
      {
        icon: "phone",
        subtitle: "Check the number, then suggest a correction if something is wrong.",
        action: actionButton(`${icon("plus")} Suggest contact`, "suggest-hotline", "small"),
      },
    )}
    ${panel(
      "My correction requests",
      `${hotlineCorrectionToolbar()}<div class="records mt-16 hotline-correction-records hotline-correction-records-official" data-page-size="5" role="table" aria-label="My hotline correction requests"><div class="record-row record-head" role="row"><span role="columnheader">Request ID</span><span role="columnheader">Request Type</span><span role="columnheader">Hotline Name</span><span role="columnheader">Category</span><span role="columnheader">Date Submitted</span><span role="columnheader">Actions</span></div>${requestRows || `<div class="empty-state"><strong>No correction requests yet</strong>Corrections you submit will appear here with the administrator's decision.</div>`}</div><div class="empty-state hotline-no-results" data-correction-no-results hidden><strong>No matching requests</strong>Try changing the filters.</div>`,
      { icon: "clipboard", subtitle: "Requests are reviewed by an administrator before the directory changes." },
    )}
  </div>`;
  return page("official", "hotlines", body);
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

export function hotlinesPage(role) {
  if (role === "resident") return residentHotlinesPage();
  if (role === "official") return officialHotlinesPage();
  return adminHotlinesPage();
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

function idVerificationPanel(official = false) {
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
          ${currentUser.hasIdImage
            ? `<figure><img src="/api/verification/id/me/image" alt="Front of your ID"><figcaption>Front of ID</figcaption></figure>`
            : `<figure class="id-photo-empty"><span>No front photo</span><figcaption>Front of ID</figcaption></figure>`}
          ${currentUser.hasIdBackImage
            ? `<figure><img src="/api/verification/id/me/image-back" alt="Back of your ID"><figcaption>Back of ID</figcaption></figure>`
            : `<figure class="id-photo-empty"><span>No back photo added</span><figcaption>Back of ID (optional)</figcaption></figure>`}
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

function faceCheckMarkup(enrolled, allowRemove = true, showGuide = true) {
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
        ${showGuide ? `<p class="face-check-eyebrow">How the check runs</p>
        <ol class="face-check-steps">
          <li data-step="front"><div><strong>Look straight</strong><span>Keep your whole face inside the frame.</span></div></li>
          <li data-step="blink"><div><strong>Blink once</strong><span>Confirms a live person, not a printed photo.</span></div></li>
          <li data-step="turn"><div><strong>Turn left, then right</strong><span>Follow the prompt as it changes.</span></div></li>
        </ol>` : ""}
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

function faceVerificationPanel() {
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
    <button class="button secondary" type="button" data-face-start data-idle-label="Capture official face" data-busy-label="Capturing…" data-action="admin-face-enroll" data-id="${esc(user.id)}">Capture official face</button>
  </section>`;
}

export function faceGateMarkup(enrolled, mode = "verify") {
  const enrolling = mode === "enroll" || !enrolled;
  const needsIntegrated = (currentUser?.idStatus || "unverified") !== "verified";
  return `
    <main class="login-page face-gate-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="face-gate-title">
        <div class="login-box face-gate-box">
          <p class="face-gate-eyebrow">Official security check</p>
          <h1 id="face-gate-title" tabindex="-1">Face verification</h1>
          <p class="face-gate-intro">${enrolling ? "New officials must add their face before they can use the workspace. Do not sign out until it is saved." : "One quick face check is required to open your official workspace."}</p>
          ${faceCheckMarkup(!enrolling, false, false)}
          ${needsIntegrated ? `<div class="face-gate-integrated"><p class="field-help">Officials confirm their identity with a valid ID and a live face match.</p><button class="button secondary" type="button" data-action="verify-id">Verify ID and face</button></div>` : ""}
          <div class="face-gate-links"><button class="text-button" type="button" data-action="face-gate-signout">Sign out</button><span aria-hidden="true">·</span><button class="text-button" type="button" data-action="face-gate-signout">Use a different account</button></div>
          <p class="face-gate-support">Camera not working? Contact your barangay administrator.</p>
        </div>
      </section>
    </main>`;
}

function profileSummaryCard(role) {
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

export function profilePage(role) {
  if (role === "administrator") return administratorProfilePage();
  if (role === "resident") return residentProfilePage();
  const body = `
    <div class="content-stack profile-main-stack">
      ${profileSummaryCard(role)}
      <section class="panel">
        <div class="panel-body">
          <form id="profile-form" class="form-stack">
            <div class="section-heading"><div><h2>Personal information</h2></div></div>
            <div class="profile-photo-field"><label class="profile-photo-control" for="profile-photo" title="Change profile photo">${userAvatar(currentUser, "large")}<span class="field-help">Click your photo to change it. JPG or PNG, up to 5 MB.</span></label></div>
            <div class="form-grid">
              ${inputField("Full name", "name", currentUser.name, { required: true, autocomplete: "name" })}
              ${inputField("Sign-in email", "email", currentUser.email, { id: "profile-sign-in-email", readonly: true, autocomplete: "email" })}
              ${inputField("Contact number", "phone", currentUser.phone || "", { type: "tel", autocomplete: "tel" })}
              ${inputField("Purok", "area", currentUser.area || "Palsara", { readonly: true })}
            </div>
            <input type="file" id="profile-photo" accept="image/jpeg,image/png" class="visually-hidden">
            <div class="form-actions"><button class="button" type="submit">Save profile</button></div>
          </form>
        </div>
      </section>
      ${idVerificationPanel(true)}
      ${faceVerificationPanel()}
      <details class="panel profile-collapsible-panel">
        <summary class="panel-head"><div><h2>Change sign-in email</h2></div></summary>
        <div class="panel-body"><form id="change-email-form" class="form-stack">
          <div class="form-grid">
            ${inputField("New email address", "email", "", { id: "change-email-address", required: true, type: "email", autocomplete: "email" })}
            ${inputField("Current password", "currentPassword", "", { id: "profile-email-current-password", required: true, type: "password", autocomplete: "current-password" })}
          </div>
          <p class="field-help">Confirm the verification link sent to the new address.</p>
          <div class="form-actions"><button class="button secondary" type="submit">Send verification link</button></div>
        </form></div>
      </details>
      <details class="panel profile-collapsible-panel">
        <summary class="panel-head"><div><h2>Account password</h2></div></summary>
        <div class="panel-body"><form id="password-form" class="form-stack">
          ${inputField("Current password", "currentPassword", "", { id: "profile-current-password", type: "password", required: true, autocomplete: "current-password" })}
          <div class="form-grid">
            ${inputField("New password", "newPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}
            ${inputField("Confirm new password", "confirmPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}
          </div>
          <div class="form-actions"><button class="button secondary" type="submit">Update password</button></div>
        </form></div>
      </details>
    </div>`;
  return page(role, "profile", body);
}

function residentProfilePage() {
  const recoveryEmail = currentUser.recoveryEmail || "";
  const recoveryVerified = Boolean(currentUser.recoveryEmailVerified);
  const recoveryHelp = recoveryEmail
    ? recoveryVerified
      ? "Verified. Password reset links are sent here."
      : "Not verified yet. Save to send a verification link."
    : "Optional. Add an email to receive password reset links.";
  const areaOptions = locationAreas().length ? locationAreas() : AREAS;
  const body = `
    <div class="content-stack profile-main-stack resident-profile-page">
      ${profileSummaryCard("resident")}
      <section class="panel resident-profile-main">
        <header class="panel-head"><div><h2>Profile Information</h2><p class="field-help">Keep your contact details and service area up to date.</p></div><button class="button small" type="submit" form="profile-form">Save Changes</button></header>
        <div class="panel-body">
          <div class="profile-intro resident-profile-intro"><label class="profile-avatar" for="profile-photo" title="Change profile photo">${userAvatar(currentUser, "large")}</label><div><strong>${esc(currentUser.name)}</strong><span>Resident &middot; ${esc(currentUser.area || "Palsara")}</span><span class="field-help">Click your photo to change it. JPG or PNG, up to 5 MB.</span></div></div>
          <form id="profile-form" class="form-grid resident-profile-form">
            ${inputField("Full name", "name", currentUser.name, { required: true, autocomplete: "name" })}
            ${inputField("Sign-in email", "email", currentUser.email, { id: "profile-sign-in-email", readonly: true, autocomplete: "email" })}
            ${inputField("Contact number", "phone", currentUser.phone || "", { type: "tel", autocomplete: "tel" })}
            ${selectField("Purok", "area", areaOptions, currentUser.area || areaOptions[0], { required: true })}
            ${inputField("Recovery email", "recoveryEmail", recoveryEmail, { type: "email", placeholder: "Optional", autocomplete: "email", help: recoveryHelp })}
            <input type="file" id="profile-photo" accept="image/jpeg,image/png" class="visually-hidden">
          </form>
        </div>
      </section>
      ${idVerificationPanel()}
      <div class="grid-equal resident-profile-security">
        <details class="panel resident-profile-security-panel">
          <summary class="panel-head"><div><h2>Email Change</h2></div></summary>
          <div class="panel-body"><form id="change-email-form" class="form-stack">
            ${inputField("New email address", "email", "", { id: "change-email-address", required: true, type: "email", autocomplete: "email" })}
            ${inputField("Current password", "currentPassword", "", { id: "profile-email-current-password", required: true, type: "password", autocomplete: "current-password" })}
            <p class="field-help">Confirm the verification link sent to the new address.</p>
            <div class="form-actions"><button class="button secondary" type="submit">Send Verification Link</button></div>
          </form></div>
        </details>
        <details class="panel resident-profile-security-panel">
          <summary class="panel-head"><div><h2>Password Management</h2></div></summary>
          <div class="panel-body"><form id="password-form" class="form-stack">
            ${inputField("Current password", "currentPassword", "", { id: "profile-current-password", required: true, type: "password", autocomplete: "current-password" })}
            <div class="form-grid">
              ${inputField("New password", "newPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}
              ${inputField("Confirm new password", "confirmPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}
            </div>
            <div class="form-actions"><button class="button secondary" type="submit">Update Password</button></div>
          </form></div>
        </details>
      </div>
    </div>`;
  return page("resident", "profile", body);
}

function administratorProfilePage() {
  const passwordInput = (label, name, id, autocomplete, minimum = 0) =>
    `<div class="form-field"><label for="${id}">${esc(label)}</label><div class="password-field"><input class="input" id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" ${minimum ? `minlength="${minimum}"` : ""} required><button class="password-toggle" type="button" data-action="toggle-password-field" data-target="${id}" aria-label="Show ${esc(label.toLowerCase())}">${icon("eye")}</button></div></div>`;
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
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-user" data-id="${esc(user.email)}">Edit</button>${user.role === "official" ? `<button class="button secondary small" type="button" data-action="clear-face" data-id="${esc(user.email)}" title="Remove this official's enrolled face reference; they will need to enroll again">Clear face</button>` : ""}</div>
  </div>`,
    )
    .join("")}</div>`;
}

const ID_SIGNAL_TONES = { pass: "ok", warn: "review", fail: "fail", unknown: "muted" };
const ID_SIGNAL_SHORT_LABELS = { "ID type": "Type", "ID number": "No.", "Full name": "Name", "Birth date": "Date" };
const ID_SIGNAL_SHORT_REASONS = { idType: "Type differs", idNumber: "No. differs", idFullName: "Name differs", idBirthDate: "Date differs" };

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

export function faceVerifyPage() {
  const enrolled = Boolean(currentUser.faceEnrolled);
  const needsIntegrated = !enrolled || (currentUser.idStatus || "unverified") !== "verified";
  const body = `<div class="content-stack">
    ${needsIntegrated ? idVerificationPanel(true) : ""}
    ${panel(enrolled ? "Face check" : "Enroll your face", faceCheckMarkup(enrolled), {
      icon: "shield",
      className: "face-check-panel",
      subtitle: "Official duty check",
    })}
  </div>`;
  return page("official", "verify", body);
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

export function hasUnsavedPermissionChanges() {
  return Object.entries(permissionDrafts).some(([role, draft]) =>
    ADMIN_ROLE_PERMISSION_IDS.some((id) => draft[id] !== Boolean(data.permissions[role]?.[id])),
  );
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

function authStory() {
  return `
      <section class="auth-story" aria-label="About CommUnity">
        <div class="auth-story-inner">
          ${brandMark()}
          <div class="auth-wordmark"><strong>CommUnity</strong><span class="auth-brand-rule" aria-hidden="true"></span><span>Palsara community desk</span></div>
          <p class="auth-copy">Community announcements, concern tracking and barangay services — all in one place.</p>
        </div>
        <p class="auth-place"><span class="auth-place-dot" aria-hidden="true"></span>Barangay Palsara · Balete, Batangas</p>
      </section>`;
}

export function loginMarkup() {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="login-title">
        <div class="login-box">
          <h1 id="login-title">Sign in to CommUnity</h1>
          <p class="field-help">Use your CommUnity account to continue to the barangay services portal.</p>
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

export function forgotPasswordMarkup() {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="forgot-title"><div class="login-box">
        <h1 id="forgot-title">Forgot password</h1>
        <p class="field-help">Enter the recovery email tied to your account. If an account uses that recovery email and has confirmed it, a password reset link will be sent to it.</p>
        <form class="login-form" id="forgot-password-form">
          ${inputField("Recovery email", "recoveryEmail", "", { required: true, type: "email", autocomplete: "email" })}
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Send reset request</button></div>
        </form>
      </div></section>
    </main>`;
}

export function resetPasswordMarkup(token) {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
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

export function verifyRecoveryMarkup(token) {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="verify-title"><div class="login-box">
        <h1 id="verify-title">Verify recovery email</h1>
        <p class="field-help">Confirm this email address so CommUnity can send password reset links to it.</p>
        <form class="login-form" id="verify-recovery-form">
          <input type="hidden" name="token" value="${esc(token)}">
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Verify email</button></div>
        </form>
      </div></section>
    </main>`;
}

export function verifyEmailChangeMarkup(token) {
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="verify-email-title"><div class="login-box">
        <h1 id="verify-email-title">Confirm new email</h1>
        <p class="field-help">Confirm that you own this address to change the email used to sign in to CommUnity.</p>
        <form class="login-form" id="verify-email-form">
          <input type="hidden" name="token" value="${esc(token)}">
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Confirm email</button></div>
        </form>
      </div></section>
    </main>`;
}

export function registerMarkup() {
  const areaOptions = residentAreaOptions();
  return `
    <main class="login-page" id="main-content" tabindex="-1">
      ${authStory()}
      <section class="login-pane" aria-labelledby="register-title"><div class="register-box">
        <h1 id="register-title">Create a resident account</h1>
        <form class="form-stack" id="register-form">
          <div class="form-grid">${inputField("Full name", "name", "", { required: true, autocomplete: "name" })}${inputField("Email address", "email", "", { required: true, type: "email", autocomplete: "email" })}${inputField("Contact number", "phone", "", { type: "tel", autocomplete: "tel" })}${selectField("Purok or area", "area", areaOptions, "", { required: true, placeholder: "Choose your purok or area" })}${inputField("Password", "password", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}${inputField("Confirm password", "confirmPassword", "", { type: "password", required: true, minLength: 8, autocomplete: "new-password" })}</div>
          <div class="form-actions"><a class="button secondary" href="#/login">Back to sign in</a><button class="button" type="submit">Create account</button></div>
        </form>
      </div></section>
    </main>`;
}
