"use strict";

import { BARANGAY_WORKING_HOURS, CATEGORIES, REPORT_PRIORITIES, MAX_REPORT_DESCRIPTION_LENGTH, AREAS } from "../constants.mjs";
import {
  locationAreas,
  residentAreaOptions,
  icon,
  esc,
  asDate,
  dateLabel,
  normalizeStatus,
  statusPill,
  displayReportId,
  displayReportTitle,
  userReports,
  sortedReports,
  sortedSchedules,
  routeUrl,
  linkButton,
  inputField,
  selectField,
  data,
  currentUser,
  uploadPhotos,
  reportDraft,
  emailPanelOpen,
  passwordPanelOpen,
} from "../core.mjs";
import { reportMapExpanded, reportMapSelection, reportMapGeoLocating } from "../map.mjs";
import {
  page,
  panel,
  userAvatar,
  photoPreviewMarkup,
  upcomingSchedule,
  scheduleRows,
  announcementEventMarkup,
  hotlineCard,
  hotlineDirectoryToolbar,
  idVerificationPanel,
  profileSummaryCard,
  passwordInput,
} from "./shared.mjs";

function scheduleDescription(schedule) {
  const service = String(schedule?.wasteType || "Waste").trim();
  const where = [schedule?.area, schedule?.zone].filter(Boolean).join(", ");
  const team = String(schedule?.team || "").trim();
  const parts = [`${service} collection`];
  if (where) parts.push(`in ${where}`);
  if (team) parts.push(`by ${team}`);
  return `${parts.join(" ")}.`;
}

export function dashboardResident() {
  const reports = userReports();
  const next = upcomingSchedule(currentUser.area);
  const latest = sortedReports(reports)
    .sort(
      (a, b) =>
        Number(["Submitted", "Under Review"].includes(b.status)) - Number(["Submitted", "Under Review"].includes(a.status)) ||
        asDate(b.updatedAt) - asDate(a.updatedAt),
    )
    .slice(0, 4);
  const announcements = [...data.announcements].sort((a, b) => asDate(b.date) - asDate(a.date)).slice(0, 4);
  const announcementRows = announcements.length
    ? announcements
        .map(
          (item) => `<li class="resident-announcement">
            <time class="resident-announcement-date" datetime="${esc(item.date)}"><strong>${esc(dateLabel(item.date, { day: "numeric" }))}</strong><span>${esc(dateLabel(item.date, { month: "short" }).replace(".", ""))}</span></time>
            <div class="resident-announcement-copy"><strong>${esc(item.title)}</strong><span>${esc(item.detail)}</span>${item.isEvent ? `<div class="announcement-event-meta">${announcementEventMarkup(item)}</div>` : ""}</div>
            <span class="resident-announcement-arrow" aria-hidden="true">${icon("arrow")}</span>
          </li>`,
        )
        .join("")
    : `<li class="resident-announcement-empty"><strong>No announcements yet</strong><span>Updates from the barangay will appear here.</span></li>`;
  const workingHoursRow = `<span class="resident-hours-item"><span class="resident-hours-icon">${icon("clock")}</span><span><strong>Barangay working hours</strong><small>${esc(BARANGAY_WORKING_HOURS)}</small></span></span>`;
  const body = `
    <div class="resident-dashboard">
      <div class="resident-dashboard-grid">
        <div class="content-stack resident-dashboard-primary">
          ${panel("Your Latest Reports", `<div class="quick-list">${latest.map((report) => `<div class="report-item"><span class="item-mark">${icon("clipboard")}</span><div class="item-copy"><strong class="truncate">${esc(displayReportTitle(report))}</strong><span>${esc(displayReportId(report))} · ${esc(dateLabel(report.updatedAt))}</span></div><div class="item-actions">${statusPill(report.status)}<button class="icon-button" type="button" data-action="view-report" data-id="${esc(report.id)}" aria-label="View ${esc(displayReportId(report))}">${icon("arrow")}</button></div></div>`).join("") || `<div class="resident-empty-reports"><span class="resident-empty-icon">${icon("clipboard")}</span><strong>No reports yet</strong><span>When you share a concern, its updates will appear here.</span></div>`}</div><div class="form-actions">${linkButton("View all reports", routeUrl("resident", "reports"), "secondary", "small")}</div>`, { icon: "clipboard", className: "resident-dashboard-panel" })}
          ${panel("Next Collection", next ? `<div class="resident-next-collection"><div class="resident-collection-date"><span class="resident-collection-icon">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.start)} – ${esc(next.end)}</span><p class="resident-collection-description">${esc(scheduleDescription(next))}</p></div></div><div class="resident-collection-meta"><span>${icon("activity")}<strong>${esc(next.wasteType)}</strong></span><span>${icon("pin")}<strong>${esc(next.area)}${next.zone ? ` · ${esc(next.zone)}` : ""}</strong></span><span>${icon("users")}<strong>${esc(next.team || "Team not listed")}</strong></span></div></div><div class="form-actions">${linkButton(`${icon("calendar")} View schedule`, routeUrl("resident", "collection"), "secondary", "small")}</div>` : `<div class="empty-state"><strong>No upcoming pickup posted</strong>Check back for a schedule update from your barangay.</div>`, { icon: "calendar", className: "resident-dashboard-panel" })}
        </div>
        ${panel("Announcements", `<ul class="resident-announcement-list">${announcementRows}</ul>`, { icon: "activity", action: linkButton("View all", routeUrl("resident", "calendar"), "secondary", "small"), className: "resident-dashboard-panel resident-announcements-panel" })}
      </div>
      <section class="resident-hours-strip" aria-label="Barangay working hours">
        ${workingHoursRow}
      </section>
    </div>`;
  return page("resident", "dashboard", body);
}

export function collectionResident() {
  const schedules = sortedSchedules(data.schedules).filter((schedule) => schedule.area === currentUser.area);
  const next = upcomingSchedule(currentUser.area);
  const nextNote = next && ["Delayed", "Cancelled"].includes(next.status) ? (next.history || []).at(-1)?.note : "";
  const body = `
    <div class="content-stack resident-collection-page">
      ${panel("Your next collection", next ? `<div class="resident-next-collection"><div class="resident-collection-date"><span class="resident-collection-icon">${icon("calendar")}</span><div><strong>${esc(dateLabel(next.date, { weekday: "long", month: "long", day: "numeric" }))}</strong><span>${esc(next.start)} – ${esc(next.end)}</span><p class="resident-collection-description">${esc(scheduleDescription(next))}</p></div></div><div class="resident-collection-meta"><span>${icon("activity")}<strong>${esc(next.wasteType)}</strong></span><span>${icon("pin")}<strong>${esc(next.area)}${next.zone ? ` · ${esc(next.zone)}` : ""}</strong></span><span>${icon("users")}<strong>${esc(next.team || "Team not listed")}</strong></span></div><div class="resident-collection-status">${statusPill(next.status)}${nextNote ? `<span>${esc(nextNote)}</span>` : ""}</div></div>` : `<div class="empty-state"><strong>No upcoming collection posted</strong>Your barangay will appear here when a schedule is available.</div>`, { icon: "calendar", className: "resident-collection-feature" })}
      ${panel("Collection schedule", scheduleRows(schedules), { icon: "calendar", subtitle: "Collections scheduled for your selected area", className: "resident-collection-table-panel" })}
    </div>`;
  return page("resident", "collection", body);
}

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

export function residentHotlinesPage() {
  const hotlines = (data.hotlines || []).filter((item) => item.published);
  const body = `<div class="content-stack resident-hotlines-page">
    ${panel(
      "Emergency contacts",
      `${hotlineDirectoryToolbar()}<div class="hotline-grid mt-16" data-hotline-results>${hotlines.length ? hotlines.map((item) => hotlineCard(item, "resident")).join("") : `<div class="empty-state"><strong>No hotlines published yet</strong>Barangay staff will publish emergency contacts here.</div>`}</div><div class="empty-state hotline-no-results" hidden><strong>No matching hotlines</strong>Try a different name, number, or category.</div>`,
      {
        icon: "phone",
        subtitle: "Call the right office during an emergency. Numbers are checked by barangay staff.",
        className: "resident-hotlines-panel",
      },
    )}
  </div>`;
  return page("resident", "hotlines", body);
}

export function residentProfilePage() {
  const recoveryEmail = currentUser.recoveryEmail || "";
  const recoveryVerified = Boolean(currentUser.recoveryEmailVerified);
  const recoveryHelp = recoveryEmail
    ? recoveryVerified
      ? "Verified. Password reset links are sent here."
      : "Not verified yet. Save to send a verification link."
    : "Optional. Add an email to receive password reset links.";
  const areaOptions = locationAreas().length ? locationAreas() : AREAS;
  const body = `
    <div class="content-stack profile-main-stack resident-profile-page">
      ${profileSummaryCard("resident")}
      <section class="panel resident-profile-main">
        <header class="panel-head"><div><h2>Profile Information</h2><p class="field-help">Your contact details, service area, and recovery email.</p></div><div class="profile-form-actions"><button class="button secondary small" type="button" data-profile-reset hidden>Reset</button><button class="button small" type="submit" form="profile-form">Save Changes</button></div></header>
        <div class="panel-body">
          <div class="profile-intro resident-profile-intro"><label class="profile-avatar" for="profile-photo" title="Change profile photo">${userAvatar(currentUser, "large")}</label><div><strong>${esc(currentUser.name)}</strong><span>Resident &middot; ${esc(currentUser.area || "Palsara")}</span><span class="field-help">Click your photo to change it. JPG or PNG, up to 5 MB.</span></div></div>
          <form id="profile-form" class="form-grid resident-profile-form">
            <h3 class="visually-hidden">Contact details</h3>
            ${inputField("Full name", "name", currentUser.name, { required: true, autocomplete: "name" })}
            ${inputField("Sign-in email", "email", currentUser.email, { id: "profile-sign-in-email", readonly: true, autocomplete: "email" })}
            ${inputField("Contact number", "phone", currentUser.phone || "", { type: "tel", autocomplete: "tel" })}
            ${selectField("Purok", "area", areaOptions, currentUser.area || areaOptions[0], { required: true, help: "Collection schedules and report routing follow your purok." })}
            <div class="profile-field-group span-all">
              <h3>Password recovery</h3>
              ${inputField("Recovery email", "recoveryEmail", recoveryEmail, { type: "email", placeholder: "Optional", autocomplete: "email", help: recoveryHelp })}
            </div>
            <input type="file" id="profile-photo" accept="image/jpeg,image/png" class="visually-hidden">
          </form>
        </div>
      </section>
      ${idVerificationPanel()}
      <div class="grid-equal resident-profile-security">
        <details id="email-change-panel" class="panel resident-profile-security-panel" ${emailPanelOpen ? "open" : ""}>
          <summary class="panel-head"><div><h2>Email Change</h2></div></summary>
          <div class="panel-body"><form id="change-email-form" class="form-stack">
            ${inputField("New email address", "email", "", { id: "change-email-address", required: true, type: "email", autocomplete: "email" })}
            ${passwordInput("Current password", "currentPassword", "profile-email-current-password", "current-password")}
            <p class="field-help">Confirm the verification link sent to the new address.</p>
            <div class="form-actions"><button class="button secondary" type="submit">Send verification link</button></div>
          </form></div>
        </details>
        <details id="password-change-panel" class="panel resident-profile-security-panel" ${passwordPanelOpen ? "open" : ""}>
          <summary class="panel-head"><div><h2>Password Management</h2></div></summary>
          <div class="panel-body"><form id="password-form" class="form-stack">
            ${passwordInput("Current password", "currentPassword", "profile-current-password", "current-password")}
            <div class="form-grid">
              ${passwordInput("New password", "newPassword", "profile-new-password", "new-password", 8)}
              ${passwordInput("Confirm new password", "confirmPassword", "profile-confirm-password", "new-password", 8)}
            </div>
            <div class="form-actions"><button class="button secondary" type="submit">Update password</button></div>
          </form></div>
        </details>
      </div>
    </div>`;
  return page("resident", "profile", body);
}
