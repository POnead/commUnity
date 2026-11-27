"use strict";

import { AREAS } from "../../constants.mjs";
import { locationAreas, esc, inputField, selectField, currentUser, emailPanelOpen, passwordPanelOpen } from "../../core.mjs";
import { page, userAvatar, idVerificationPanel, profileSummaryCard, passwordInput } from "../shared.mjs";

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
