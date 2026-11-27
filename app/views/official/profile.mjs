"use strict";

import { esc, inputField, currentUser } from "../../core.mjs";
import { page, userAvatar, idVerificationPanel, profileSummaryCard, passwordInput, faceVerificationPanel } from "../shared.mjs";

export function officialProfilePage() {
  const role = "official";
  const body = `
    <div class="content-stack profile-main-stack">
      ${profileSummaryCard(role)}
      <section class="panel official-profile-main">
        <div class="panel-body">
          <form id="profile-form" class="form-stack">
            <div class="section-heading"><div><h2>Personal information</h2></div></div>
            <div class="official-profile-intro">
              <label class="profile-photo-control" for="profile-photo" title="Change profile photo">${userAvatar(currentUser, "large")}</label>
              <div><strong>${esc(currentUser.name)}</strong><span>Barangay official &middot; ${esc(currentUser.area || "Palsara")}</span><span class="field-help">Click your photo to change it. JPG or PNG, up to 5 MB.</span></div>
            </div>
            <div class="form-grid">
              ${inputField("Full name", "name", currentUser.name, { required: true, autocomplete: "name" })}
              ${inputField("Sign-in email", "email", currentUser.email, { id: "profile-sign-in-email", readonly: true, autocomplete: "email" })}
              ${inputField("Contact number", "phone", currentUser.phone || "", { type: "tel", autocomplete: "tel" })}
              ${inputField("Purok", "area", currentUser.area || "Palsara", { readonly: true })}
            </div>
            <input type="file" id="profile-photo" accept="image/jpeg,image/png" class="visually-hidden">
            <div class="form-actions"><button class="button secondary small" type="button" data-profile-reset hidden>Reset</button><button class="button" type="submit">Save profile</button></div>
          </form>
        </div>
      </section>
      ${idVerificationPanel(true)}
      ${faceVerificationPanel()}
      <details class="panel profile-collapsible-panel">
        <summary class="panel-head"><div><h2>Change sign-in email</h2></div></summary>
        <div class="panel-body"><form id="change-email-form" class="form-stack">
          <div class="form-grid">
            ${inputField("New email address", "email", "", { id: "change-email-address", required: true, type: "email", autocomplete: "email" })}
            ${passwordInput("Current password", "currentPassword", "profile-email-current-password", "current-password")}
          </div>
          <p class="field-help">Confirm the verification link sent to the new address.</p>
          <div class="form-actions"><button class="button secondary" type="submit">Send verification link</button></div>
        </form></div>
      </details>
      <details class="panel profile-collapsible-panel">
        <summary class="panel-head"><div><h2>Account password</h2></div></summary>
        <div class="panel-body"><form id="password-form" class="form-stack">
          ${passwordInput("Current password", "currentPassword", "profile-current-password", "current-password")}
          <div class="form-grid">
            ${passwordInput("New password", "newPassword", "profile-new-password", "new-password", 8, "Use at least 8 characters. A phrase with numbers or symbols is harder to guess.")}
            ${passwordInput("Confirm new password", "confirmPassword", "profile-confirm-password", "new-password", 8)}
          </div>
          <div class="form-actions"><button class="button secondary" type="submit">Update password</button></div>
        </form></div>
      </details>
    </div>`;
  return page(role, "profile", body);
}
