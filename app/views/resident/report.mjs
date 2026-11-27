"use strict";

import { CATEGORIES, REPORT_PRIORITIES, MAX_REPORT_DESCRIPTION_LENGTH } from "../../constants.mjs";
import {
  residentAreaOptions,
  icon,
  esc,
  normalizeStatus,
  statusPill,
  routeUrl,
  inputField,
  selectField,
  currentUser,
  uploadPhotos,
  reportDraft,
} from "../../core.mjs";
import { reportMapExpanded, reportMapSelection, reportMapGeoLocating } from "../../map.mjs";
import { page, photoPreviewMarkup } from "../shared.mjs";

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
