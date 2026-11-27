"use strict";

import { esc, asDate, dateLabel, statusPill, data, currentUser, approvalFilter } from "../../core.mjs";
import { page, panel, stat, statsStrip } from "../shared.mjs";

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
