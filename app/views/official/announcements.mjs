"use strict";

import { icon, esc, asDate, dateLabel, statusPill, data, actionButton } from "../../core.mjs";
import { page, panel, announcementEventMarkup, stat, statsStrip } from "../shared.mjs";

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
