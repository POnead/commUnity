"use strict";

import { esc } from "./format.mjs";
import { MAX_REPORT_DESCRIPTION_LENGTH, REPORT_PRIORITIES } from "../constants.mjs";

export function routeUrl(role, page) {
  return `#/${role}/${page}`;
}

export function linkButton(label, href, variant = "secondary", extra = "") {
  return `<a class="button ${variant} ${extra}" href="${esc(href)}">${label}</a>`;
}

export function actionButton(label, action, variant = "secondary", extra = "", attrs = "") {
  return `<button class="button ${variant} ${extra}" type="button" data-action="${esc(action)}" ${attrs}>${label}</button>`;
}

export function inputField(label, name, value = "", options = {}) {
  const id = options.id || name;
  const type = options.type || "text";
  const required = options.required ? "required" : "";
  const readonly = options.readonly ? "readonly" : "";
  const placeholder = options.placeholder ? `placeholder="${esc(options.placeholder)}"` : "";
  const helpId = options.help ? `${id}-help` : "";
  const help = helpId ? `<p class="field-help" id="${esc(helpId)}">${esc(options.help)}</p>` : "";
  const describedBy = [options.describedBy, helpId].filter(Boolean).join(" ");
  const describedByAttr = describedBy ? ` aria-describedby="${esc(describedBy)}"` : "";
  const min = options.min === undefined ? "" : `min="${esc(options.min)}"`;
  const max = options.max === undefined ? "" : `max="${esc(options.max)}"`;
  return `<div class="form-field"><label for="${esc(id)}">${esc(label)}${options.required ? " *" : ""}</label><input class="input" id="${esc(id)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${required} ${readonly} ${placeholder} ${min} ${max} ${describedByAttr} ${options.minLength ? `minlength="${options.minLength}"` : ""} ${options.maxLength ? `maxlength="${options.maxLength}"` : ""} ${options.autocomplete ? `autocomplete="${esc(options.autocomplete)}"` : ""}>${help}</div>`;
}

export function selectField(label, name, items, selected, options = {}) {
  const id = options.id || name;
  const labelMap = options.labels || {};
  const required = options.required ? "required" : "";
  const helpId = options.help ? `${id}-help` : "";
  const help = helpId ? `<p class="field-help" id="${esc(helpId)}">${esc(options.help)}</p>` : "";
  const describedBy = [options.describedBy, helpId].filter(Boolean).join(" ");
  const describedByAttr = describedBy ? ` aria-describedby="${esc(describedBy)}"` : "";
  return `<div class="form-field"><label for="${esc(id)}">${esc(label)}${options.required ? " *" : ""}</label><select class="select" id="${esc(id)}" name="${esc(name)}" ${required} ${describedByAttr}>${options.placeholder ? `<option value="">${esc(options.placeholder)}</option>` : ""}${items.map((item) => `<option value="${esc(item)}" ${item === selected ? "selected" : ""}>${esc(labelMap[item] || item)}</option>`).join("")}</select>${help}</div>`;
}

export function readOptionalCoordinate(value) {
  const text = String(value || "").trim();
  return text ? Number(text) : null;
}

export function reportDraftFromForm(fields) {
  const priority = String(fields.get("priority") || "").trim();
  if (!REPORT_PRIORITIES.includes(priority)) throw new Error("Choose a valid concern priority.");
  const description = String(fields.get("description") || "").trim();
  if (description.length > MAX_REPORT_DESCRIPTION_LENGTH) {
    throw new Error(`Describe the concern in ${MAX_REPORT_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  return {
    category: String(fields.get("category") || ""),
    barangay: "Palsara",
    area: String(fields.get("area") || ""),
    locationDetail: String(fields.get("locationDetail") || "").trim(),
    latitude: readOptionalCoordinate(fields.get("latitude")),
    longitude: readOptionalCoordinate(fields.get("longitude")),
    description,
    priority,
    urgent: priority === "High",
    step: "review",
  };
}

export function calendarEventFromForm(fields) {
  const latitude = readOptionalCoordinate(fields.get("latitude"));
  const longitude = readOptionalCoordinate(fields.get("longitude"));
  if (
    (latitude === null) !== (longitude === null) ||
    (latitude !== null &&
      (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180))
  ) {
    throw new Error("Choose a valid map location or clear the pin before continuing.");
  }
  return {
    title: String(fields.get("title") || "").trim(),
    detail: String(fields.get("detail") || "").trim(),
    date: String(fields.get("date") || ""),
    latitude,
    longitude,
  };
}

export function calendarEventFromRecord(item) {
  return {
    id: String(item.id),
    date: item.date,
    title: item.title,
    detail: item.detail || "",
    kind: "Event",
    status: item.approvalStatus || "approved",
    declineReason: item.declineReason || "",
    createdBy: item.createdBy || "",
    createdByName: item.createdByName || "",
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
  };
}
