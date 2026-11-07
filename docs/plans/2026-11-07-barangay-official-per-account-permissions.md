# Barangay Official Per-Account Permissions / Read-Only Role Edits Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove role-permission editing from the Role management page for the `resident` and `administrator` roles, and give the `official` (Barangay official) role per-account permission overrides so multiple official accounts can hold different permission sets.

**Architecture:** Keep the existing role-based permission engine (`data.permissions[role][permission]` persisted via `/api/state`) as the *default* layer, and add an account-level override layer keyed by user email/id for officials. Effective permission = override (if set) else role default.

**Tech Stack:** Plain browser JS (`app-core.js`, `app-views.js`, `app.js`), Node server (`server.mjs`), PGlite persistence via `/api/state`.

---

## Current state (verified)

- `app-core.js:55-69` — `DEFAULT_PERMISSIONS` (resident/official/administrator) + `PERMISSION_DEFS` (8 permissions, grouped).
- `app-views.js:712-736` — `rolesPage()` renders role tabs + permission groups; toggle via `data-action="toggle-permission"`.
- `app.js:1065-1109` — draft/save/discard logic for role permission drafts; save persists via local save → `/api/state`.
- `server.mjs:1139-1151` — `updateState` validates `data.permissions` shape per role (must have all permission keys; booleans).
- `app-views.js:23-47` — `requiredPermission` + `canOpenPage` resolve permission from `data.permissions[role]`.

## Plan

### Task 1: Make resident and administrator permission editing read-only

**Files:** `app-views.js` (rolesPage), `app.js` (toggle/draft handlers).

**Steps:**
1. In `rolesPage`, render toggle controls only for the `official` role; for `resident`/`administrator`, render read-only rows (or hide the toggle column entirely).
2. In `handleAction` `toggle-permission`, no-op/throw for `resident`/`administrator` (or remove branch).
3. Keep `save-permission-draft` working for `official` only; for others, disable save / no-op.
4. Update copy: "Change role permissions" tab becomes read-only for those roles.

### Task 2: Add per-account permission overrides for officials

**Files:** `app-core.js` (state shape/defaults), `app-views.js` (UI), `app.js` (draft/save), `server.mjs` (state validation + persistence), `server.test.mjs` (tests).

**Steps:**
1. Extend state: `data.accountOverrides = { [userEmail]: { permissionId: boolean } }` (only for official accounts; optional shape).
2. Effective permission helper: `effectivePermission(user, permissionId)` = override[user.email]?.[permissionId] ?? data.permissions[user.role]?.[permissionId].
3. Use effective permission in `canOpenPage`/nav gating for officials.

### Task 3: Admin UI for per-account official permissions

**Files:** `app-views.js` (users page or roles page), `app.js` (handlers/drafts).

**Steps:**
1. In User management (`usersPage`) or a new section in roles page, list active official accounts with per-account toggles for relevant permissions (e.g., manageReports, manageSchedules, manageAnnouncements).
2. Draft per account; save persists via `/api/state` (`data.accountOverrides`).

### Task 4: Tests and verification

**Files:** `server.test.mjs`.

**Steps:**
1. Test that role permission validation still accepts the new state shape (or that official overrides persist through `/api/state`).
2. Run `npm test` → all pass.

---

## Open questions for the user

1. Should `resident`/`administrator` permission edits be **hidden** or just **disabled**?
2. For officials, should the per-account overrides fully replace role defaults, or layer on top (default true/false + override)?
3. Which permissions should be per-account for officials? (manageReports, manageSchedules, manageAnnouncements are the obvious ones.)

---

## Execution options

**Plan complete and saved.** Two execution options:

1. **Subagent-driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Required sub-skill: `subagent`-driven flow via superpowers.
2. **Parallel session** — open a new session with executing-plans.

**Which approach?**
