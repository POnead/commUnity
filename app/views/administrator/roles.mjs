"use strict";

import {
  esc,
  data,
  effectivePermissions,
  app,
  selectedPermissionAccount,
  permissionOpenAccounts,
  hasUnsavedPermissionChanges,
} from "../../core.mjs";
import { page, panel } from "../shared.mjs";
import { PERMISSION_DEFS, ADMIN_ROLE_PERMISSION_IDS } from "../../constants.mjs";

export function rolesPage() {
  const officials = (data.users || []).filter((user) => user.role === "official");
  const selected = officials.find((user) => user.email === selectedPermissionAccount) || officials[0] || null;
  const effective = selected ? effectivePermissions(selected, data) : {};
  const overrides = (selected && data.accountOverrides?.[selected.email]) || {};
  const permissions = PERMISSION_DEFS.filter(({ id }) => ADMIN_ROLE_PERMISSION_IDS.includes(id));
  const accountOptions = officials
    .map(
      (user) =>
        `<option value="${esc(user.email)}"${user.email === selected?.email ? " selected" : ""}>${esc(user.name)} · ${esc(user.email)}</option>`,
    )
    .join("");
  const accountPicker = officials.length
    ? `<div class="form-field role-select-field"><label for="permission-role">Barangay official</label><select class="select" id="permission-role" aria-label="Barangay official account">${accountOptions}</select></div>`
    : `<div class="empty-state"><strong>No Barangay official accounts</strong>Create an official account to assign its permissions.</div>`;
  const permissionRows = selected
    ? permissions
        .map((permission) => {
          const enabled = Boolean(effective[permission.id]);
          const custom = Object.hasOwn(overrides, permission.id);
          const controls = `${custom ? `<span class="permission-effective-state">Custom</span><button class="button secondary small" type="button" data-action="reset-account-permission" data-email="${esc(selected.email)}" data-permission="${esc(permission.id)}">Reset to default</button>` : ""}<button class="switch" type="button" role="switch" aria-checked="${enabled}" aria-label="${esc(`${selected.name} · ${permission.label}`)}" data-action="toggle-account-permission" data-email="${esc(selected.email)}" data-permission="${esc(permission.id)}"></button>`;
          return `<div class="permission-row"><span class="permission-copy"><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span><span class="permission-account-controls">${controls}</span></div>`;
        })
        .join("")
    : `<div class="empty-state"><strong>No official selected</strong>Choose a Barangay official account to edit its permissions.</div>`;
  const body = `
    <div class="content-stack">
      ${panel("Official Accounts", accountPicker, { subtitle: "Choose the official whose permissions you want to change." })}
      ${panel("Permissions", `<div class="permission-list role-permission-list">${permissionRows}</div>`, { subtitle: "Changes save immediately for the selected official." })}
    </div>`;
  return page("administrator", "roles", body);
}

// Capture expanded per-official override panels before a rebuild so the live
// update refresh does not collapse the panel the administrator is reading.

export function rememberOpenPermissionAccounts() {
  for (const email of Object.keys(permissionOpenAccounts)) delete permissionOpenAccounts[email];
  for (const account of app.querySelectorAll("details.permission-account[open]")) {
    if (account.dataset.email) permissionOpenAccounts[account.dataset.email] = true;
  }
}

export function confirmLeaveWithUnsavedPermissions() {
  return (
    !hasUnsavedPermissionChanges() ||
    window.confirm("You have unsaved role permission changes. Leave without saving? Your changes will be discarded.")
  );
}
