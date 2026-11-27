"use strict";

import { icon, esc, dateLabel, statusPill, data, actionButton } from "../../core.mjs";
import {
  page,
  panel,
  hotlineDirectoryToolbar,
  stat,
  statsStrip,
  hotlineCorrectionInfo,
  hotlineCorrectionToolbar,
  hotlineAvailabilityMarkup,
  hotlineVerifiedLabel,
} from "../shared.mjs";

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
