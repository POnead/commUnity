"use strict";

import {
  announceSessionChange,
  app,
  confirmAction,
  currentUser,
  data,
  emptyState,
  isResidentArea,
  locationAreas,
  routeUrl,
  setState,
  smtpSettings,
  startStateUpdates,
  stopStateUpdates,
  toast,
} from "../core.mjs";
import { render } from "./render.mjs";

export let profilePhotoFile = null;
export let profilePhotoPreview = null;
export async function updateProfile(form) {
  const name = String(form.get("name") || "").trim();
  const area = String(form.get("area") || "").trim();
  if (name.length < 2) throw new Error("Enter your full name.");
  if (currentUser.role === "resident" && !locationAreas().includes(area)) throw new Error("Choose an affected area.");
  const confirmed = await confirmAction({
    title: "Save profile?",
    message: "Save your profile changes?",
    confirmLabel: "Save profile",
  });
  if (!confirmed) return;
  const fields = {
    name,
    area,
    phone: String(form.get("phone") || "").trim(),
    recoveryEmail: String(form.get("recoveryEmail") || "").trim(),
  };
  // Either everything is saved in one request (fields plus photo) or nothing is.
  let response;
  if (profilePhotoFile) {
    const body = new FormData();
    body.append("name", fields.name);
    body.append("area", fields.area);
    body.append("phone", fields.phone);
    body.append("recoveryEmail", fields.recoveryEmail);
    body.append("photos", profilePhotoFile, profilePhotoFile.name);
    response = await fetch("/api/profile", { method: "PUT", body });
  } else {
    response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Profile changes could not be saved.");
  if (profilePhotoFile) {
    profilePhotoFile = null;
    profilePhotoPreview = null;
    const input = app.querySelector("#profile-photo");
    if (input) input.value = "";
  }
  setState({ currentUser: result.user });
  setState({ data: result.data });
  setState({ dataRevision: result.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  render();
  toast(profileSavedMessage(result.recoveryEmail), "success");
}

export async function requestEmailChange(form) {
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const currentPassword = String(form.get("currentPassword") || "");
  const response = await fetch("/api/auth/change-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, currentPassword }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The email change could not be requested.");
  // The submit handler passes FormData, not the form element; reset the form
  // itself so a successful request clears the fields instead of throwing after
  // the verification email has already been sent.
  (typeof form.reset === "function" ? form : document.getElementById("change-email-form"))?.reset();
  toast(result.message || "A verification link was sent to your new email address.", "success");
}

export function profileSavedMessage(recovery = {}) {
  if (recovery.verified) return "Profile saved. Recovery email verified.";
  if (recovery.verificationSent) return "Profile saved. A verification link was sent to your recovery email.";
  if (recovery.verificationFailed)
    return "Profile saved, but the verification email failed. Recovery is not active until it is sent; save again to retry.";
  if (currentUser.recoveryEmail) return "Profile saved. No verification link was sent — email delivery is not configured for this portal.";
  return "Profile saved.";
}

export async function loadSmtpSettings() {
  const response = await fetch("/api/settings/smtp");
  const result = await response.json();
  if (!response.ok) return;
  // Keep the server's encryption-readiness flag so the settings page can show a
  // clear notice instead of a form that would fail at save time.
  setState({ smtpSettings: { ...result.settings, encryptionReady: result.encryptionReady === true } });
  const form = app.querySelector("#smtp-settings-form");
  if (!form) return;
  for (const [name, value] of Object.entries(smtpSettings)) {
    const field = form.elements.namedItem(name);
    if (field && name !== "configured") field.value = value || "";
  }
  const password = form.elements.namedItem("pass");
  if (password && smtpSettings.configured) password.placeholder = "Leave blank to keep current password";
}

export async function saveSmtpSettings(form) {
  const body = Object.fromEntries(new FormData(form));
  const confirmed = await confirmAction({
    title: "Save SMTP settings?",
    message: "Save these SMTP settings?",
    confirmLabel: "Save settings",
  });
  if (!confirmed) return;
  const response = await fetch("/api/settings/smtp", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "SMTP settings could not be saved.");
  setState({ smtpSettings: result.settings });
  form.elements.namedItem("pass").value = "";
  toast(
    result.restartRequired ? "SMTP settings saved. Restart every server instance before mail uses them." : "SMTP settings saved.",
    "success",
  );
}

export function applySmtpPreset(provider) {
  const presets = {
    gmail: [
      "smtp.gmail.com",
      "587",
      'Gmail: turn on 2-Step Verification, then <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">create an App Password</a>. Enter that generated password here.',
    ],
    outlook: [
      "smtp.office365.com",
      "587",
      'Outlook/Microsoft 365: <a href="https://support.microsoft.com/account-billing/how-to-get-and-use-app-passwords-5896ed9c-9f7f-4d4b-ae2c-7c9f6b2c0f2a" target="_blank" rel="noopener noreferrer">learn about app passwords</a> if your account supports them. If SMTP AUTH is disabled, ask your Microsoft 365 administrator to enable it.',
    ],
    sendgrid: [
      "smtp.sendgrid.net",
      "587",
      'SendGrid: <a href="https://docs.sendgrid.com/ui/account-and-settings/api-keys" target="_blank" rel="noopener noreferrer">create an API key</a> in Settings > API Keys. Enter apikey as the username and the generated API key as the password.',
    ],
    custom: [
      "",
      "587",
      "Other provider: open its SMTP or mail-client setup page and copy the SMTP host, port, username, and app password or service key here.",
    ],
  };
  const preset = presets[provider];
  const form = app.querySelector("#smtp-settings-form");
  if (!preset || !form) return;
  form.elements.namedItem("host").value = preset[0];
  form.elements.namedItem("port").value = preset[1];
  const help = app.querySelector("#smtp-provider-help");
  if (help) help.innerHTML = preset[2];
  form.elements.namedItem("host").focus();
}

export async function updatePassword(form) {
  const fields = new FormData(form);
  const oldPassword = String(fields.get("currentPassword") || "");
  const password = String(fields.get("newPassword") || "");
  const confirm = String(fields.get("confirmPassword") || "");
  if (password.length < 8) throw new Error("Choose a password with at least 8 characters.");
  if (password !== confirm) throw new Error("The new passwords do not match.");
  const confirmed = await confirmAction({
    title: "Change password?",
    message: "Change your password? You will stay signed in on this device.",
    confirmLabel: "Change password",
  });
  if (!confirmed) return false;
  const response = await fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword: password, confirmPassword: confirm }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Your session expired. Please sign in again before changing your password."
        : result.error || "The password could not be changed.",
    );
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) {
    if (state.code === "FACE_VERIFICATION_REQUIRED") {
      // The password is already changed; the sign-in session still needs the
      // face gate. Hand over to it instead of reporting a failed reload.
      setState({ currentUser: { ...currentUser, requiresPasswordChange: false, faceCheckPending: true } });
      setState({ data: emptyState() });
      setState({ dataRevision: 0 });
      setState({ lastPersistedSnapshot: "" });
      stopStateUpdates();
      window.location.hash = "#/face-verify";
      render();
      return true;
    }
    throw new Error(state.error || "The account was updated, but CommUnity could not reload.");
  }
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ currentUser: state.user });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  startStateUpdates();
  form.reset();
  toast("Password updated.", "success");
  return true;
}

export async function createResident(form) {
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") || "");
  const confirm = String(form.get("confirmPassword") || "");
  const area = String(form.get("area") || "").trim();
  if (!isResidentArea(area)) throw new Error("Choose a valid purok or area.");
  if (name.length < 2) throw new Error("Enter your full name.");
  if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
  if (password !== confirm) throw new Error("The passwords do not match.");
  const confirmed = await confirmAction({
    title: "Create account?",
    message: `Create a resident account for ${name}?`,
    confirmLabel: "Create account",
  });
  if (!confirmed) return;
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      email,
      area,
      phone: String(form.get("phone") || "").trim(),
      password,
      confirmPassword: confirm,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Your account could not be created.");
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "Your account was created, but CommUnity could not load it.");
  setState({ currentUser: state.user || result.user });
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  startStateUpdates();
  window.location.hash = routeUrl("resident", "dashboard");
  announceSessionChange();
  toast("Your resident account is ready.", "success");
}

export function setProfilePhotoFile(value) {
  profilePhotoFile = value;
}
export function setProfilePhotoPreview(value) {
  profilePhotoPreview = value;
}
