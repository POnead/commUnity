"use strict";

import { icon, esc, dateLabel, data, actionButton } from "../../core.mjs";
import {
  page,
  panel,
  hotlineCard,
  hotlineDirectoryToolbar,
  stat,
  statsStrip,
  hotlineCorrectionInfo,
  hotlineCorrectionToolbar,
} from "../shared.mjs";

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
