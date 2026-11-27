"use strict";

import {
  currentUser,
  esc,
  faceCheckNotice,
  facePanelOpen,
  icon,
  idPanelOpen,
  normalizeStatus,
  profileSummaryCollapsed,
  roleLabel,
  statusPill,
  verificationSettings,
} from "../../core.mjs";
import { ROLES } from "../../constants.mjs";

function idStatusMarkup(status) {
  switch (status) {
    case "verified":
      return `<span class="id-verified-badge">ID verified</span>`;
    case "pending":
      return `<span class="id-status-badge pending">Under review</span>`;
    case "rejected":
      return `<span class="id-status-badge rejected">Rejected</span>`;
    default:
      return `<span class="id-status-badge">Not verified</span>`;
  }
}

export function idVerificationPanel(official = false) {
  const status = currentUser.idStatus || "unverified";
  const note = currentUser.idReviewNote ? esc(currentUser.idReviewNote) : "";
  const verified = status === "verified";
  const pending = status === "pending";
  const rejected = status === "rejected";
  const submitLabel = official
    ? verified || pending
      ? "Replace verification"
      : "Start verification"
    : verified
      ? "Replace ID"
      : pending
        ? "Replace submission"
        : rejected
          ? "Submit again"
          : "Verify my ID";
  const removeButton = `<button class="button danger small" type="button" data-action="id-remove">${pending ? "Cancel submission" : "Remove my ID data"}</button>`;
  const state = verified
    ? {
        title: "Your ID is verified",
        detail: official
          ? "Your ID and face are on file for your official account."
          : "Administrators see a badge beside your name on the concerns you file.",
        icon: "check",
      }
    : pending
      ? {
          title: "Waiting for review",
          detail: "Your submission is with an administrator. Nothing else is needed right now.",
          icon: "clock",
        }
      : rejected
        ? {
            title: "Review needs another look",
            detail: "Check the note below, then send a clearer photo or corrected details.",
            icon: "alert",
          }
        : {
            title: official ? "Verify your ID and face" : "Optional, but recommended",
            detail: official
              ? "Officials confirm their identity with a valid ID and a live face match."
              : "A verified ID confirms that your concerns come from a real resident.",
            icon: "shield",
          };
  const steps = official
    ? [
        ["Upload and scan your ID", "PhilSys, Driver's License, Passport or UMID. Details are read with OCR."],
        ["Register and match your face", "A guided camera check compares your face with the ID photo."],
        ["Barangay review", "An administrator completes the final review."],
      ]
    : [
        ["Take a clear photo", "Front of a government-issued ID; the back is optional."],
        ["Barangay review", "An administrator checks the image and the details on your account."],
        ["Verified badge", "Once approved, your name carries a Verified badge on concerns."],
      ];
  const photoPreviews =
    currentUser.hasIdImage || currentUser.hasIdBackImage
      ? `<div class="id-photo-previews" aria-label="Your submitted ID images">
          ${
            currentUser.hasIdImage
              ? `<figure><img src="/api/verification/id/me/image" alt="Front of your ID"><figcaption>Front of ID</figcaption></figure>`
              : `<figure class="id-photo-empty"><span>No front photo</span><figcaption>Front of ID</figcaption></figure>`
          }
          ${
            currentUser.hasIdBackImage
              ? `<figure><img src="/api/verification/id/me/image-back" alt="Back of your ID"><figcaption>Back of ID</figcaption></figure>`
              : `<figure class="id-photo-empty"><span>No back photo added</span><figcaption>Back of ID (optional)</figcaption></figure>`
          }
        </div>`
      : "";
  return `<details class="panel id-verification-panel profile-collapsible-panel" id="id-panel"${idPanelOpen ? " open" : ""}>
    <summary class="panel-head"><div><h2>${official ? "Integrated identity verification" : "Identity verification"}</h2><p class="field-help">${official ? "Your government ID and face are checked together, then reviewed by an administrator." : "A government-issued ID, reviewed by an administrator. You can delete the image and the record at any time."}</p></div>${idStatusMarkup(status)}</summary>
    <div class="panel-body">
      <div class="id-verification-state" data-status="${esc(status)}">
        <span class="id-verification-icon" aria-hidden="true">${icon(state.icon)}</span>
        <div><strong>${state.title}</strong><span>${state.detail}</span></div>
      </div>
      ${rejected && note ? `<div class="notice-bar id-review-note"><span>Reviewer's note: ${note}</span><strong>Rejected</strong></div>` : ""}
      <ol class="id-verification-steps">
        ${steps.map(([title, detail]) => `<li><div><strong>${title}</strong><span>${detail}</span></div></li>`).join("")}
      </ol>
      ${photoPreviews}
      <p class="field-help">Only you and administrators can see these images. You can permanently remove them and the details from this panel at any time.</p>
      <div class="form-actions id-verification-actions">
        <button class="button${verified || pending ? " secondary" : ""}" type="button" data-action="verify-id">${submitLabel}</button>
        ${status === "unverified" ? "" : removeButton}
      </div>
    </div>
  </details>`;
}

export function faceCheckMarkup(enrolled, allowRemove = true, showGuide = true) {
  return `<div class="face-check">
    <div class="face-check-stage" data-step="front">
      <div class="face-video-frame" data-camera-state="idle" data-capturing="false">
        <video id="face-video" class="face-video" autoplay playsinline muted aria-hidden="true"></video>
        <div class="face-camera-state" id="face-camera-state" role="status">
          <span class="face-camera-icon" aria-hidden="true">${icon("cameraOff", "face-camera-icon-svg")}</span>
          <strong class="face-camera-title">Camera is off</strong>
          <span class="face-camera-detail">Start the check to turn on your camera.</span>
          <span class="face-camera-note">The preview stays on this device.</span>
        </div>
        <div class="face-guide" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <span class="face-live" aria-hidden="true"><span class="face-live-dot"></span>Live</span>
        <div class="face-hud" aria-hidden="true">
          <div class="face-hud-progress" id="face-hud-progress"><span></span><span></span><span></span><span></span></div>
          <span class="face-hud-chip" id="face-hud-chip">Centre your face</span>
          <p class="face-hud-instruction" id="face-hud-instruction">Look straight at the camera.</p>
        </div>
        <span class="face-capture-ring" aria-hidden="true"></span>
        <button class="face-hud-cancel" type="button" data-action="face-check-cancel" hidden>Cancel</button>
      </div>
      <div class="face-check-guide">
        ${
          showGuide
            ? `<p class="face-check-eyebrow">How the check runs</p>
        <ol class="face-check-steps">
          <li data-step="front"><div><strong>Look straight</strong><span>Keep your whole face inside the frame.</span></div></li>
          <li data-step="blink"><div><strong>Blink once</strong><span>Confirms a live person, not a printed photo.</span></div></li>
          <li data-step="turn"><div><strong>Turn left, then right</strong><span>Follow the prompt as it changes.</span></div></li>
        </ol>`
            : ""
        }
        <p class="face-stage" id="face-stage" role="status" aria-live="polite">Press the button when you are ready. Look straight at the camera, blink once, then slowly turn left and right.</p>
      </div>
    </div>
    <p class="face-check-result" id="face-check-result" role="status" aria-live="polite"${faceCheckNotice ? ' data-state="success"' : ""}>${esc(faceCheckNotice)}</p>
    <div class="form-actions face-check-actions">
      <button class="button" type="button" id="face-check-start" data-face-start data-idle-label="${enrolled ? "Start face check" : "Enroll face"}" data-action="${enrolled ? "face-check-start" : "face-enroll-start"}">${enrolled ? "Start face check" : "Enroll face"}</button>
      <button class="button secondary" type="button" id="face-check-cancel" data-action="face-check-cancel" hidden>Cancel</button>
      ${enrolled && allowRemove ? `<button class="button danger" type="button" data-action="face-self-remove">Remove my face data</button>` : ""}
    </div>
    ${showGuide ? `<p class="face-engine-note">Identity check: ${verificationSettings.faceppEnabled ? "Face++" : "on-device"}. ${verificationSettings.faceppEnabled ? "Re-enroll if this account was enrolled before Face++ was enabled." : ""}</p>` : ""}
  </div>`;
}

export function faceVerificationPanel() {
  const enrolled = Boolean(currentUser.faceEnrolled);
  return `<details class="panel face-verification-panel profile-collapsible-panel" id="face-panel"${facePanelOpen ? " open" : ""}>
    <summary class="panel-head face-panel-head">
      <span class="face-panel-icon" aria-hidden="true">${icon("shield")}</span>
      <div class="face-panel-copy"><h2>Face check</h2><p class="face-panel-subtitle">Prove it's you before making changes during a duty check.</p></div>
      <span class="face-panel-status ${enrolled ? "is-enrolled" : ""}"><span class="face-panel-status-dot" aria-hidden="true"></span>${enrolled ? "Enrolled" : "Not enrolled"}</span>
    </summary>
    <div class="panel-body">${faceCheckMarkup(enrolled)}</div>
  </details>`;
}

export function profileSummaryCard(role) {
  const recoveryEmail = currentUser.recoveryEmail || "";
  const recoveryVerified = Boolean(currentUser.recoveryEmailVerified);
  const collapsed = Boolean(profileSummaryCollapsed);
  const accountStatus = normalizeStatus(currentUser.status || "Active");
  const isActive = accountStatus === "active";
  const statusDotClass = isActive ? "is-active" : "is-inactive";
  const recoveryState = recoveryEmail ? (recoveryVerified ? "verified" : "pending") : "unset";

  const rows = [
    `<div class="profile-summary-row"><span class="profile-summary-label">Role</span><span class="profile-summary-value">${esc(ROLES[role] || roleLabel(role))}</span></div>`,
    `<div class="profile-summary-row"><span class="profile-summary-label">Account status</span><span class="profile-summary-value">${statusPill(currentUser.status || "Active")}</span></div>`,
    role === "resident"
      ? `<div class="profile-summary-row"><span class="profile-summary-label">Recovery email</span><span class="profile-summary-value">${recoveryEmail ? statusPill(recoveryVerified ? "active" : "pending", recoveryVerified ? "Verified" : "Not verified") : `<span class="record-meta">Not set</span>`}</span></div>`
      : "",
    role === "resident" || role === "official"
      ? `<div class="profile-summary-row"><span class="profile-summary-label">ID verification</span><span class="profile-summary-value">${idStatusMarkup(currentUser.idStatus)}</span></div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `<section class="profile-summary-float ${collapsed ? "is-collapsed" : ""}" data-theme-role="${esc(role)}" aria-label="Account summary">
    <button class="profile-summary-toggle" type="button" data-action="toggle-profile-summary" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="profile-summary-body">
      <span class="profile-summary-heading"><span class="profile-summary-dot ${statusDotClass}" aria-hidden="true"></span><span class="profile-summary-title">Account summary</span></span>
      <span class="profile-summary-toggle-icon" aria-hidden="true">${collapsed ? "+" : "−"}</span>
    </button>
    <div id="profile-summary-body" class="profile-summary-body" data-recovery="${esc(recoveryState)}"${collapsed ? " hidden" : ""}>${rows}</div>
  </section>`;
}
