"use strict";

import { inputField, currentUser } from "../../core.mjs";
import { page, userAvatar, profileSummaryCard, passwordInput } from "../shared.mjs";

export function administratorProfilePage() {
  const body = `
    <div class="content-stack profile-main-stack admin-profile-cards admin-profile-layout">
      ${profileSummaryCard("administrator")}
      <section class="panel">
        <header class="panel-head"><div><h2>Profile Information</h2><p class="field-help">Keep your administrator contact details up to date.</p></div><button class="button small" type="submit" form="profile-form">Save Changes</button></header>
        <div class="panel-body"><form id="profile-form" class="form-grid admin-profile-form">
          ${inputField("Full name", "name", currentUser.name, { id: "profile-name", required: true, autocomplete: "name" })}
          ${inputField("Contact number", "phone", currentUser.phone || "", { id: "profile-phone", type: "tel", autocomplete: "tel" })}
          ${inputField("Purok", "area", currentUser.area || "Palsara", { id: "profile-area", readonly: true })}
          ${inputField("Sign-in email", "email", currentUser.email, { id: "profile-sign-in-email", readonly: true, autocomplete: "email" })}
          <input type="file" id="profile-photo" accept="image/jpeg,image/png" class="visually-hidden">
          <label class="profile-photo-control" for="profile-photo">${userAvatar(currentUser, "large")}<span class="field-help">Click your photo to change it. JPG or PNG, up to 5 MB.</span></label>
        </form></div>
      </section>
      <div class="grid-equal admin-account-security">
        <details class="panel profile-collapsible-panel">
          <summary class="panel-head"><div><h2>Email Change</h2></div></summary>
          <div class="panel-body"><form id="change-email-form" class="form-stack">
            ${inputField("New email address", "email", "", { id: "change-email-address", required: true, type: "email", autocomplete: "email" })}
            ${passwordInput("Current password", "currentPassword", "profile-email-current-password", "current-password")}
            <p class="field-help">Confirm the verification link sent to the new address.</p>
            <div class="form-actions"><button class="button secondary" type="submit">Send Verification Link</button></div>
          </form></div>
        </details>
        <details class="panel profile-collapsible-panel">
          <summary class="panel-head"><h2>Password Management</h2></summary>
          <div class="panel-body"><form id="password-form" class="form-stack">
            ${passwordInput("Current password", "currentPassword", "profile-current-password", "current-password")}
            ${passwordInput("New password", "newPassword", "profile-new-password", "new-password", 8)}
            ${passwordInput("Confirm new password", "confirmPassword", "profile-confirm-password", "new-password", 8)}
            <div class="form-actions"><button class="button" type="submit">Update Password</button></div>
          </form></div>
        </details>
      </div>
    </div>`;
  return page("administrator", "profile", body);
}
