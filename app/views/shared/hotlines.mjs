"use strict";

import { correctionFilters, dateTimeLabel, esc, icon } from "../../core.mjs";
import { HOTLINE_CATEGORIES, HOTLINE_STATUS_LABELS } from "../../constants.mjs";

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
