"use strict";

import { icon, esc, routeUrl } from "../../core.mjs";
import { page } from "../shared.mjs";

export function settingsPage() {
  const accountItems = [
    ["User Management", "Accounts and status", "users", "users"],
    ["Profile and Password", "Your administrator account", "user", "profile"],
  ];
  const workspaceItems = [
    ["Locations", "Community areas and landmarks", "pin", "locations"],
    ["Announcements", "Community service notices", "activity", "announcements"],
    ["Analytics", "Workspace report and account trends", "chart", "analytics"],
    ["Assignment queue", "Assign unresolved concerns to officials", "users", "assignments"],
    ["Activity Log", "Recorded account and service activity", "clock", "activity"],
    ["Role Management", "Workspace permissions", "shield", "roles"],
  ];
  const systemItems = [["Email Configuration", "SMTP email setup", "mail", "email"]];
  const verificationSection = `<section class="settings-section"><details class="verification-config">
    <summary class="settings-row"><span class="settings-row-icon">${icon("shield")}</span><span class="settings-row-copy"><strong>Verification</strong><small>Face duty check for officials and ID reviews</small></span><span class="settings-row-arrow" aria-hidden="true">${icon("arrow")}</span></summary>
    <div class="verification-settings-body">
    <form id="verification-settings-form" class="verification-settings">
    <label class="settings-toggle"><input type="checkbox" name="requireFaceOnLogin" value="1"> <span class="smtp-config-title"><strong>Face check at sign-in</strong><small>Officials verify their face after entering their password. Skipped while the duty window is still valid. New officials must enroll first.</small></span></label>
    <label class="settings-toggle"><input type="checkbox" name="faceVerificationEnabled" value="1"> <span class="smtp-config-title"><strong>Face duty check</strong><small>Barangay officials face-check once per shift before they can make changes. Administrators are exempt.</small></span></label>
    <div class="form-grid mt-16">
      <div class="form-field"><label for="verification-duty-hours">Duty check lasts</label><select class="select" id="verification-duty-hours" name="dutyHours">${[1, 2, 4, 6, 8, 9, 10, 12].map((hours) => `<option value="${hours}">${hours} hour${hours === 1 ? "" : "s"}</option>`).join("")}</select></div>
      <div class="form-field"><label for="verification-threshold">Match threshold</label><input class="input" id="verification-threshold" name="matchThreshold" type="number" step="0.001" min="0.02" max="0.2" value="0.033" required><span class="field-help">Cosine distance below this passes. Lower is stricter. Default 0.033.</span></div>
    </div>
    <label class="settings-toggle"><input type="checkbox" name="faceppEnabled" value="1"> <span class="smtp-config-title"><strong>Face++ face match (opt-in)</strong><small>Compare staff face images with Face++ instead of the on-device descriptor. Sends face images to a third party.</small></span></label>
    <label class="settings-toggle"><input type="checkbox" name="ocrEnabled" value="1"> <span class="smtp-config-title"><strong>OCR ID prefill (opt-in)</strong><small>Suggest ID fields from the uploaded ID photo. Sends ID images to a third party; residents still confirm every field.</small></span></label>
    <div class="form-grid mt-16"><div class="form-field"><label for="verification-facepp-threshold">Face++ confidence</label><input class="input" id="verification-facepp-threshold" name="faceppThreshold" type="number" step="1" min="50" max="99" value="80" required></div></div>
    <p class="field-help">Enroll officials from a face-check page or their profile. Turning this off never locks residents out. Both third-party options are off by default.</p>
    <div class="form-actions"><button class="button small" type="submit">Save verification settings</button></div>
  </form></div></details></section>`;
  const rows = (items) =>
    items
      .map(
        ([title, description, iconName, pageName]) =>
          `<a class="settings-row" href="${routeUrl("administrator", pageName)}"><span class="settings-row-icon">${icon(iconName)}</span><span class="settings-row-copy"><strong>${esc(title)}</strong><small>${esc(description)}</small></span><span class="settings-row-arrow">${icon("arrow")}</span></a>`,
      )
      .join("");
  const body = `<div class="content-stack settings-groups"><section class="settings-section"><h2>Account Management</h2><div class="settings-list settings-card-grid">${rows(accountItems)}</div></section><section class="settings-section"><h2>Workspace Management</h2><div class="settings-list">${rows(workspaceItems)}</div></section><section class="settings-section settings-full-width"><h2>System Configuration</h2><div class="settings-list">${rows(systemItems)}</div></section>${verificationSection}</div>`;
  return page("administrator", "settings", body);
}
