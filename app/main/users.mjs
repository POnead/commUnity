"use strict";

import { announceSessionChange, confirmAction, currentUser, data, getUser, localSave, setState, toast } from "../core.mjs";
import { DEFAULT_OFFICIAL_DAYS, OFFICIAL_DAYS, render } from "./render.mjs";
import { adminFaceAbortController } from "./verification.mjs";
import { BARANGAY_WORKING_HOURS, ROLES } from "../constants.mjs";
import { showModal } from "./ui.mjs";

export async function resetUserPassword(form) {
  const email = String(form.get("email") || "");
  const user = getUser(email);
  if (!user || user.status !== "Active") {
    toast("Reactivate this account before resetting its password.", "error");
    return;
  }
  const confirmed = await confirmAction({
    title: "Reset password?",
    message: `Generate a temporary password for ${user?.name || email} and email it to them?`,
    confirmLabel: "Generate password",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/users/password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The account password could not be reset.");
  setState({ data: result.data });
  setState({ dataRevision: result.revision });
  setState({ currentUser: result.user });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  toast("Temporary password generated and emailed to the account holder.", "success");
}

export async function forgotPassword(form) {
  const fields = new FormData(form);
  const recoveryEmail = String(fields.get("recoveryEmail") || "")
    .trim()
    .toLowerCase();
  if (!recoveryEmail) throw new Error("Enter your recovery email address.");
  const confirmed = await confirmAction({
    title: "Send reset request?",
    message: `Send a password reset request for ${recoveryEmail}?`,
    confirmLabel: "Send request",
  });
  if (!confirmed) return;
  const response = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recoveryEmail }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The reset request could not be sent.");
  toast(result.message || "If an account uses that recovery email, a reset link has been sent.", "success");
  window.location.hash = "#/login";
}

export async function resetPassword(form) {
  const fields = new FormData(form);
  const token = String(fields.get("token") || "").trim();
  const newPassword = String(fields.get("newPassword") || "");
  const confirm = String(fields.get("confirmPassword") || "");
  if (newPassword.length < 8) throw new Error("Choose a password with at least 8 characters.");
  if (newPassword !== confirm) throw new Error("The new passwords do not match.");
  const confirmed = await confirmAction({
    title: "Reset password?",
    message: "Set your new password?",
    confirmLabel: "Reset password",
  });
  if (!confirmed) return;
  const response = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The password could not be reset.");
  toast("Password reset. Sign in with your new password.", "success");
  window.location.hash = "#/login";
}

export async function verifyRecovery(form) {
  const token = String(form.get("token") || "").trim();
  if (!token) throw new Error("This verification link is missing its code.");
  const confirmed = await confirmAction({
    title: "Verify recovery email?",
    message: "Confirm this address for password recovery?",
    confirmLabel: "Verify email",
  });
  if (!confirmed) return;
  const response = await fetch("/api/auth/verify-recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "This verification link is invalid or expired.");
  toast("Recovery email verified. Password reset links will be sent there.", "success");
  window.location.hash = "#/login";
}

export async function verifyEmailChange(form) {
  const token = String(form.get("token") || "").trim();
  if (!token) throw new Error("This verification link is missing its code.");
  const response = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "This verification link is invalid or expired.");
  if (result.user) {
    setState({ currentUser: result.user });
    window.location.hash = `#/${result.user.role}/profile`;
    render();
    toast("Email address updated. Use it the next time you sign in.", "success");
  } else {
    toast("Email address updated. Use it the next time you sign in.", "success");
    window.location.hash = "#/login";
  }
}

export async function addOrEditUser(form) {
  if (adminFaceAbortController) throw new Error("Finish or cancel the face capture before saving the account.");
  const originalEmail = String(form.get("originalEmail") || "");
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const role = String(form.get("role") || "");
  const area = String(form.get("area") || "");
  const status = String(form.get("status") || "");
  const existing = originalEmail ? getUser(originalEmail) : null;
  if (originalEmail && !existing) throw new Error("This account could not be found. Refresh the user list and try again.");
  // Account status changes of an existing account must go through the dedicated
  // deactivate/reactivate endpoints, which revoke the account's sessions. The
  // account editor never changes an existing account's status.
  const accountStatus = existing ? existing.status : status;
  if (name.length < 2) throw new Error("Enter the account holder's name.");
  if (!Object.hasOwn(ROLES, role)) throw new Error("Select a valid account role.");
  if (!existing && !["Active", "Inactive"].includes(status)) throw new Error("Select a valid account status.");
  if (role === "resident" && !data.locations.some((location) => location.area === area)) {
    throw new Error("Choose a resident area from the managed community locations.");
  }
  const selectedDays = form.getAll("availableDays").map(String);
  if (role === "official" && selectedDays.length === 0) throw new Error("Select at least one day the official is available.");
  const savedAvailableDays =
    role === "official" ? OFFICIAL_DAYS.filter((day) => selectedDays.includes(day)) : existing?.availableDays || DEFAULT_OFFICIAL_DAYS;
  const savedWorkingHours = role === "official" ? BARANGAY_WORKING_HOURS : existing?.workingHours || BARANGAY_WORKING_HOURS;
  if (data.users.some((user) => user.email.toLowerCase() === email && user.email !== originalEmail))
    throw new Error("An account already uses this email address.");
  if (email !== originalEmail && originalEmail === currentUser.email)
    throw new Error("You cannot change your own administrator sign-in address here.");
  if (area.length < 2) throw new Error("Enter an area for this account.");
  const password = existing ? "" : String(form.get("password") || "");
  if (!existing && password.length < 8) throw new Error("Use an initial password with at least 8 characters.");
  if (existing?.email === currentUser.email && (role !== "administrator" || accountStatus !== "Active"))
    throw new Error("You cannot remove your own administrator access or deactivate your account.");
  const confirmed = await confirmAction({
    title: existing ? "Save account?" : "Create account?",
    message: existing ? `Save changes to ${existing.name}'s account?` : `Create an account for ${name} as ${ROLES[role]}?`,
    confirmLabel: existing ? "Save account" : "Create account",
  });
  if (!confirmed) return;
  if (existing) {
    const oldEmail = existing.email;
    Object.assign(existing, {
      name,
      email,
      role,
      area,
      status: accountStatus,
      workingHours: savedWorkingHours,
      availableDays: savedAvailableDays,
      phone: String(form.get("phone") || "").trim(),
    });
    data.reports
      .filter((report) => report.userEmail === oldEmail)
      .forEach((report) => {
        report.name = name;
      });
    if (oldEmail !== email) {
      data.notifications.forEach((item) => {
        if (item.targetEmail === oldEmail) item.targetEmail = email;
      });
      data.reports.forEach((report) => {
        if (report.userEmail === oldEmail) report.userEmail = email;
      });
    }
  } else {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        name,
        area,
        role,
        status,
        workingHours: savedWorkingHours,
        availableDays: savedAvailableDays,
        phone: String(form.get("phone") || "").trim(),
        password,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The account could not be added.");
    setState({ data: result.data });
    setState({ dataRevision: result.revision });
    setState({ currentUser: result.user });
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
    setState({ modalState: null });
    render();
    toast("Account added.", "success");
    return;
  }
  if (!(await localSave())) return;
  setState({ modalState: null });
  render();
  toast(existing ? "Account updated." : "Account added.", "success");
}

export async function toggleAccount(email) {
  const user = getUser(email);
  if (!user) throw new Error("This account could not be found.");
  if (user.email === currentUser.email) throw new Error("You cannot deactivate the administrator account you are using.");
  if (user.status !== "Active") {
    const confirmed = await confirmAction({
      title: "Reactivate account?",
      message: `Reactivate ${user.name}'s account?`,
      confirmLabel: "Reactivate",
    });
    if (!confirmed) return;
    const response = await fetch("/api/users/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The account could not be reactivated.");
    const stateResponse = await fetch("/api/state");
    const state = await stateResponse.json();
    if (!stateResponse.ok) throw new Error(state.error || "The account was reactivated, but the user list could not be refreshed.");
    setState({ data: state.data });
    setState({ dataRevision: state.revision });
    setState({ currentUser: state.user });
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
    setState({ modalState: null });
    render();
    announceSessionChange();
    const reactivated = getUser(email);
    toast(`${reactivated.name}'s account is ${reactivated.status.toLowerCase()}.`, "success");
    return;
  }
  showModal("deactivate", email);
}

export async function deactivateAccount(email, reason) {
  const user = getUser(email);
  if (!user) throw new Error("This account could not be found.");
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason) throw new Error("A deactivation reason is required.");
  const confirmed = await confirmAction({
    title: "Deactivate account?",
    message: `Deactivate ${user.name}'s account? They will no longer be able to sign in.`,
    confirmLabel: "Deactivate account",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/users/deactivate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, reason: trimmedReason }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The account could not be deactivated.");
  // The server revoked this account's sessions in the same transaction. Refresh
  // state from the server instead of saving the local copy, so the account
  // editor can never replay an old status change through /api/state.
  const stateResponse = await fetch("/api/state");
  const state = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(state.error || "The account was deactivated, but the user list could not be refreshed.");
  setState({ data: state.data });
  setState({ dataRevision: state.revision });
  setState({ currentUser: state.user });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  setState({ modalState: null });
  render();
  announceSessionChange();
  const deactivated = getUser(email);
  toast(`${deactivated.name}'s account is ${deactivated.status.toLowerCase()}.`, "success");
}
