"use strict";

import { brandMark, currentUser, data, esc, icon, initials, modalState, routeUrl, unreadCount } from "../../core.mjs";
import { ROLES, STATUSES, getAppTimeZone } from "../../constants.mjs";
import { modalMarkup } from "../../main.mjs";

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

export function passwordInput(label, name, id, autocomplete, minimum = 0, help = "") {
  const helpId = help ? `${id}-help` : "";
  const describedBy = helpId ? ` aria-describedby="${helpId}"` : "";
  return `<div class="form-field"><label for="${id}">${esc(label)}</label><div class="password-field"><input class="input" id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" ${minimum ? `minlength="${minimum}"` : ""}${describedBy} required><button class="password-toggle" type="button" data-action="toggle-password-field" data-target="${id}" aria-label="Show ${esc(label.toLowerCase())}">${icon("eye")}</button></div>${helpId ? `<p class="field-help" id="${helpId}">${esc(help)}</p>` : ""}</div>`;
}
