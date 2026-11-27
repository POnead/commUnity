"use strict";

import {
  icon,
  esc,
  asDate,
  dateLabel,
  dateTimeLabel,
  todayISO,
  statusPill,
  displayReportId,
  displayReferenceText,
  displayReportTitle,
  sortedReports,
  sortedSchedules,
  routeUrl,
  linkButton,
  actionButton,
  inputField,
  data,
  currentUser,
  officialAssignedFilter,
} from "../core.mjs";
import { REPORT_PRIORITIES } from "../constants.mjs";
import {
  page,
  stat,
  statsStrip,
  panel,
  userAvatar,
  scheduleRows,
  announcementEventMarkup,
  hotlineCard,
  hotlineDirectoryToolbar,
  hotlineCorrectionInfo,
  hotlineCorrectionToolbar,
  idVerificationPanel,
  faceCheckMarkup,
  faceVerificationPanel,
  profileSummaryCard,
  passwordInput,
} from "./shared.mjs";

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

export function officialAnnouncementsPage() {
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
      ${panel("Collection schedules", `<div class="toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search schedules</span><input class="input" type="search" data-search-input autocomplete="off" placeholder="Search schedules..."></label></div>${scheduleRows(schedules, true)}`, { action: actionButton(`${icon("plus")} Add schedule`, "add-schedule", "small") })}
    </div>`;
  return page("official", "collection", body);
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
        action: actionButton(`${icon("plus")} Suggest contact`, "suggest-hotline", "small"),
      },
    )}
    ${panel(
      "My correction requests",
      `${hotlineCorrectionToolbar()}<div class="records mt-16 hotline-correction-records hotline-correction-records-official" data-page-size="5" role="table" aria-label="My hotline correction requests"><div class="record-row record-head" role="row"><span role="columnheader">Request ID</span><span role="columnheader">Request Type</span><span role="columnheader">Hotline Name</span><span role="columnheader">Category</span><span role="columnheader">Date Submitted</span><span role="columnheader">Actions</span></div>${requestRows || `<div class="empty-state"><strong>No correction requests yet</strong>Corrections you submit will appear here with the administrator's decision.</div>`}</div><div class="empty-state hotline-no-results" data-correction-no-results hidden><strong>No matching requests</strong>Try changing the filters.</div>`,
      { icon: "clipboard" },
    )}
  </div>`;
  return page("official", "hotlines", body);
}

export function officialProfilePage() {
  const role = "official";
  const body = `
    <div class="content-stack profile-main-stack">
      ${profileSummaryCard(role)}
      <section class="panel official-profile-main">
        <div class="panel-body">
          <form id="profile-form" class="form-stack">
            <div class="section-heading"><div><h2>Personal information</h2></div></div>
            <div class="official-profile-intro">
              <label class="profile-photo-control" for="profile-photo" title="Change profile photo">${userAvatar(currentUser, "large")}</label>
              <div><strong>${esc(currentUser.name)}</strong><span>Barangay official &middot; ${esc(currentUser.area || "Palsara")}</span><span class="field-help">Click your photo to change it. JPG or PNG, up to 5 MB.</span></div>
            </div>
            <div class="form-grid">
              ${inputField("Full name", "name", currentUser.name, { required: true, autocomplete: "name" })}
              ${inputField("Sign-in email", "email", currentUser.email, { id: "profile-sign-in-email", readonly: true, autocomplete: "email" })}
              ${inputField("Contact number", "phone", currentUser.phone || "", { type: "tel", autocomplete: "tel" })}
              ${inputField("Purok", "area", currentUser.area || "Palsara", { readonly: true })}
            </div>
            <input type="file" id="profile-photo" accept="image/jpeg,image/png" class="visually-hidden">
            <div class="form-actions"><button class="button secondary small" type="button" data-profile-reset hidden>Reset</button><button class="button" type="submit">Save profile</button></div>
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
            ${passwordInput("Current password", "currentPassword", "profile-email-current-password", "current-password")}
          </div>
          <p class="field-help">Confirm the verification link sent to the new address.</p>
          <div class="form-actions"><button class="button secondary" type="submit">Send verification link</button></div>
        </form></div>
      </details>
      <details class="panel profile-collapsible-panel">
        <summary class="panel-head"><div><h2>Account password</h2></div></summary>
        <div class="panel-body"><form id="password-form" class="form-stack">
          ${passwordInput("Current password", "currentPassword", "profile-current-password", "current-password")}
          <div class="form-grid">
            ${passwordInput("New password", "newPassword", "profile-new-password", "new-password", 8, "Use at least 8 characters. A phrase with numbers or symbols is harder to guess.")}
            ${passwordInput("Confirm new password", "confirmPassword", "profile-confirm-password", "new-password", 8)}
          </div>
          <div class="form-actions"><button class="button secondary" type="submit">Update password</button></div>
        </form></div>
      </details>
    </div>`;
  return page(role, "profile", body);
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
