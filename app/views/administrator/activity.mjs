"use strict";

import { icon, esc, dateTimeLabel, displayReferenceText, roleLabel, initials, activityLogState, activityFilters } from "../../core.mjs";
import { page, panel } from "../shared.mjs";

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
