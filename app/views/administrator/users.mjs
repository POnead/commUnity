"use strict";

import { icon, esc, statusPill, data, actionButton } from "../../core.mjs";
import { page, panel, userAvatar, stat, statsStrip } from "../shared.mjs";
import { ROLES } from "../../constants.mjs";

export function userRowsMarkup(users) {
  if (!users.length) return `<div class="empty-state"><strong>No accounts match</strong>Try another name, email, role, or status.</div>`;
  return `<div class="records" data-page-size="10" role="table" aria-label="User accounts"><div class="record-row record-head user-record-head" role="row"><span role="columnheader">Account</span><span role="columnheader">Role</span><span role="columnheader">Area</span><span role="columnheader">Status</span><span role="columnheader">Action</span></div>${users
    .map(
      (
        user,
      ) => `<div class="record-row user-record filter-item" role="row" data-account-status="${esc(user.status)}" data-search="${esc(`${user.name} ${user.email} ${ROLES[user.role]} ${user.area} ${user.status}`.toLowerCase())}">
    <div class="identity" role="cell">${userAvatar(user)}<span><strong class="record-primary">${esc(user.name)}</strong><span class="record-secondary">${esc(user.email)}</span>${user.resetRequested ? `<span class="record-secondary" style="color:var(--warning,#b45309)">Reset requested</span>` : ""}</span></div>
    <div class="record-meta" role="cell" data-label="Role">${esc(ROLES[user.role] || user.role)}</div>
    <div class="record-meta" role="cell" data-label="Area">${esc(user.area || "—")}</div>
    <div role="cell" data-label="Status">${statusPill(user.status || "Active")}</div>
    <div class="record-actions" role="cell" data-label=""><button class="button secondary small" type="button" data-action="edit-user" data-id="${esc(user.email)}">Edit</button></div>
  </div>`,
    )
    .join("")}</div>`;
}

export function adminFaceEnrollMarkup(user) {
  return `<section class="admin-face-enroll" id="admin-face-panel" aria-labelledby="admin-face-title">
    <h3 id="admin-face-title">Official face enrollment</h3>
    <p class="field-help">Capture ${esc(user.name)}'s face with this camera. It becomes their verification reference. Ask them to face the camera in good light, remove glasses or a mask, and hold still for about 20 seconds.</p>
    <div class="face-video-frame" data-camera-state="idle" data-capturing="false">
      <video id="admin-face-video" class="face-video" autoplay playsinline muted aria-hidden="true"></video>
      <div class="face-camera-state">
        <span class="face-camera-icon" aria-hidden="true">${icon("cameraOff", "face-camera-icon-svg")}</span>
        <strong class="face-camera-title">Camera is off</strong>
        <span class="face-camera-detail">Start the capture, then ask ${esc(user.name)} to look straight at the camera.</span>
        <span class="face-camera-note">The preview stays on this device.</span>
      </div>
      <div class="face-guide" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <span class="face-live" aria-hidden="true"><span class="face-live-dot"></span>Live</span>
      <div class="face-hud" aria-hidden="true">
        <div class="face-hud-progress"><span></span><span></span><span></span><span></span></div>
        <span class="face-hud-chip">Centre the face</span>
        <p class="face-hud-instruction">Look straight at the camera.</p>
      </div>
      <span class="face-capture-ring" aria-hidden="true"></span>
      <button class="face-hud-cancel" type="button" data-action="admin-face-cancel" hidden>Cancel</button>
    </div>
    <p class="admin-face-stage" id="admin-face-stage" role="status" aria-live="polite">Ready to capture.</p>
    <div class="admin-face-actions">
      <button class="button secondary" type="button" data-face-start data-idle-label="Capture official face" data-busy-label="Capturing…" data-action="admin-face-enroll" data-id="${esc(user.id)}">Capture official face</button>
      <button class="button danger small" type="button" data-action="clear-face" data-id="${esc(user.email)}" title="Remove this official's enrolled face reference; they will need to enroll again">Clear face reference</button>
    </div>
  </section>`;
}

export function usersPage() {
  const users = (data.users || []).filter((user) => user.role !== "administrator");
  const countFor = (role) => users.filter((user) => user.role === role).length;
  const inactive = users.filter((user) => user.status === "Inactive").length;
  const body = `
    <div class="content-stack">
      ${statsStrip([
        stat("Total Accounts", users.length, "Residents and officials", "blue", "users"),
        stat("Residents", countFor("resident"), "Resident accounts", "success", "user"),
        stat("Barangay Officials", countFor("official"), "Official accounts", "violet", "shield"),
        stat("Inactive", inactive, "Deactivated accounts", "warning", "alert"),
      ])}
      ${panel(
        "Accounts",
        `<div class="toolbar user-toolbar"><label class="search-field">${icon("search")}<span class="visually-hidden">Search by name or email</span><input class="input" type="search" data-search-input autocomplete="off"></label><select class="select" data-user-role-filter aria-label="Filter accounts by role"><option value="all">All roles</option>${Object.entries(
          ROLES,
        )
          .map(([role, label]) => `<option value="${esc(role)}">${esc(label)}</option>`)
          .join(
            "",
          )}</select><select class="select" data-user-status-filter aria-label="Filter accounts by status"><option value="all">All statuses</option><option>Active</option><option>Inactive</option></select></div><div class="mt-16" data-user-table>${userRowsMarkup([...users].sort((a, b) => a.name.localeCompare(b.name)))}</div>`,
        {
          subtitle: "Manage accounts without changing role capabilities.",
          action: actionButton(`${icon("plus")} Add user`, "add-user", "small"),
        },
      )}
    </div>`;
  return page("administrator", "users", body);
}
