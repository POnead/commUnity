"use strict";

import {
  app,
  currentUser,
  data,
  dataRevision,
  hasUnsavedPermissionChanges,
  lastPersistedSnapshot,
  modalState,
  setState,
} from "./state.mjs";
import { emptyState, mergeStateForRetry, stateMatchesIgnoringNotifications } from "./data.mjs";
import { redirectToFaceCheckIfRequired, toast } from "./feedback.mjs";
import { DEFAULT_PERMISSIONS, setAppTimeZone } from "../constants.mjs";
import { appDateParts, brandMark, esc } from "./format.mjs";
import { isProcessing, render } from "../main.mjs";

// A camera capture holds local DOM references. A re-render under it would
// detach the video and result nodes, so state adoption pauses until it ends.
let faceCheckActive = false;
export function setFaceCheckActive(value) {
  faceCheckActive = value;
}

export async function localSave() {
  let refreshed = false;
  while (true) {
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, revision: dataRevision }),
      });
      const result = await response.json();
      if (!response.ok) {
        // Background jobs and other sessions share one revision counter, so a
        // server-created notification can advance it while this browser works.
        // When the server's state is otherwise unchanged, adopt the new revision
        // and retry once; the server still re-validates every field.
        if (response.status === 409 && !refreshed) {
          const stateResponse = await fetch("/api/state");
          const state = await stateResponse.json();
          if (
            stateResponse.ok &&
            state.revision !== dataRevision &&
            stateMatchesIgnoringNotifications(state.data, JSON.parse(lastPersistedSnapshot || "null"))
          ) {
            setState({ dataRevision: state.revision });
            refreshed = true;
            continue;
          }
          // The merge preserves this browser's own pending changes when the
          // revision moved. Residents and officials are the roles whose shared
          // save is most likely to collide in practice and whose writes are
          // safely additive (new report, notification read flags, own profile,
          // concern status changes, assignments). Administrators still get a
          // clean rollback and a clear error instead of a guessed write.
          if (stateResponse.ok && data && (currentUser?.role === "resident" || currentUser?.role === "official")) {
            const snapshot = JSON.parse(lastPersistedSnapshot || "null");
            setState({ data: mergeStateForRetry(data, state.data, snapshot) });
            setState({ dataRevision: state.revision });
            refreshed = true;
            continue;
          }
        }
        const gateError = new Error(result.error || "CommUnity could not save this change.");
        gateError.code = result.code;
        if (redirectToFaceCheckIfRequired(gateError)) return false;
        throw gateError;
      }
      setState({ dataRevision: result.revision });
      setState({ data: result.data });
      setState({ currentUser: result.user });
      setState({ lastPersistedSnapshot: JSON.stringify(data) });
      announceSessionChange();
      return true;
    } catch (error) {
      console.error("CommUnity could not save data.", error);
      if (lastPersistedSnapshot) {
        setState({ data: JSON.parse(lastPersistedSnapshot) });
      }
      toast(error.message || "Your change could not be saved. Check that the CommUnity server is running, then try again.", "error");
      return false;
    }
  }
}

export async function loadLocalData() {
  try {
    const sessionResponse = await fetch("/api/session");
    const session = await sessionResponse.json();
    if (!sessionResponse.ok) throw new Error(session.error || "CommUnity could not check your sign-in.");
    // The server runs on the deployment's zone; the browser must agree or the two render different days.
    setAppTimeZone(session.timeZone);
    const parts = appDateParts();
    setState({ calendarMonth: Number(parts.month) - 1 });
    setState({ calendarYear: Number(parts.year) });
    setState({ currentUser: session.user });
    if (!currentUser) {
      setState({ data: emptyState() });
      const locationResponse = await fetch("/api/locations");
      const locationResult = await locationResponse.json();
      if (!locationResponse.ok) throw new Error(locationResult.error || "CommUnity could not load community locations.");
      data.locations = locationResult.locations;
      setState({ dataRevision: 0 });
      setState({ lastPersistedSnapshot: "" });
      return false;
    }
    if (currentUser.requiresPasswordChange) {
      // A temporary password may only reach the password-change dialog, so the
      // server refuses /api/state until it is replaced. This takes priority over
      // the face gate — the password must be changed first.
      setState({ data: emptyState() });
      setState({ dataRevision: 0 });
      setState({ lastPersistedSnapshot: "" });
      return true;
    }
    if (currentUser.faceCheckPending) {
      // A pending face check is a restricted session: /api/state answers 403
      // until the gate completes. Load the shell and let routeState() show it.
      setState({ data: emptyState() });
      setState({ dataRevision: 0 });
      setState({ lastPersistedSnapshot: "" });
      return true;
    }
    const response = await fetch("/api/state");
    const stored = await response.json();
    if (!response.ok) {
      const error = new Error(stored.error || "CommUnity could not load your information.");
      error.code = stored.code;
      throw error;
    }
    setState({ dataRevision: stored.revision });
    setState({ data: stored.data });
    setState({ currentUser: stored.user });
    if (!data || data.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.reports) || !Array.isArray(data.schedules)) {
      throw new Error("The saved data version is not supported. Reset the saved CommUnity data to continue.");
    }
    data.notifications ||= [];
    data.activities ||= [];
    data.permissions ||= structuredClone(DEFAULT_PERMISSIONS);
    data.announcements ||= [];
    setState({ lastPersistedSnapshot: stored.data ? JSON.stringify(data) : "" });
    return Boolean(stored.data);
  } catch (error) {
    console.error("CommUnity could not read saved data.", error);
    if (error?.code === "FACE_VERIFICATION_REQUIRED") {
      // Defensive fallback: the session may have been restricted between the
      // /api/session and /api/state calls. Route to the gate, not the fatal screen.
      if (currentUser) setState({ currentUser: { ...currentUser, faceCheckPending: true } });
      setState({ data: emptyState() });
      setState({ dataRevision: 0 });
      setState({ lastPersistedSnapshot: "" });
      window.location.hash = "#/face-verify";
      return true;
    }
    app.innerHTML = `<main class="fatal-screen">${brandMark()}<h1>Saved data could not be opened</h1><p>${esc(error.message)}</p></main>`;
    return null;
  }
}

export function currentPath() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
}

export function clearSession() {
  setState({ currentUser: null });
  setState({ selectedReportId: null });
  setState({ reportDraft: null });
  setState({ uploadPhotos: [] });
  document.documentElement.dataset.theme = "auth";
}

export const SESSION_SYNC_KEY = "community.session-sync";
export const sessionSyncChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("community-session") : null;

export function announceSessionChange() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(SESSION_SYNC_KEY, stamp);
  } catch {
    // Storage can be unavailable; the broadcast channel still covers modern browsers.
  }
  try {
    sessionSyncChannel?.postMessage({ type: "session", stamp });
  } catch {
    // Ignore channel failures.
  }
}

sessionSyncChannel?.addEventListener("message", async (event) => {
  if (event.data?.type !== "session") return;
  // Same pause rules as the live-refresh poll: never rebuild under an open form,
  // unsaved input or an in-flight action.
  if (modalState || hasUnsavedPermissionChanges() || hasUnsavedFormInput() || isProcessing() || faceCheckActive) return;
  try {
    await loadLocalData();
    render();
  } catch (error) {
    console.error("CommUnity could not refresh session data.", error);
  }
});

// Live updates: poll the cheap revision endpoint and adopt server changes only
// when one exists. Polling /api/state/revision keeps the common case to a few
// bytes; a full state fetch happens only when the revision actually moved.
// Forms the user is editing are never rebuilt over: modal state, unsaved
// role-permission drafts and any inline form holding user input all pause
// adoption until the user finishes with them.
export const STATE_REFRESH_INTERVAL_MS = 30000;
export let stateRefreshTimer = null;

// A form holds unsaved input when one of its controls differs from what was
// rendered — typed text, a changed select/checkbox/radio, a chosen file, or a
// dropped pin in the hidden map fields. Pre-filled controls match their
// rendered defaults, so ordinary untouched forms read as clean. No listeners
// or bookkeeping are kept in sync: the DOM is the single source of truth, and
// any rebuild returns every control to its rendered default automatically.
export function hasUnsavedFormInput() {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return false;
  const controlIsDirty = (control) => {
    if (!control || control.disabled) return false;
    const tag = String(control.tagName || "").toUpperCase();
    const type = String(control.type || "").toLowerCase();
    if (type === "file") return Boolean(control.files && control.files.length);
    if (type === "checkbox" || type === "radio") return control.checked !== control.defaultChecked;
    if (tag === "SELECT") {
      const options = control.options ? [...control.options] : [];
      return control.selectedIndex !== options.findIndex((option) => option.defaultSelected);
    }
    // Covers text-like inputs, hidden inputs, and textareas.
    return typeof control.value === "string" && control.value !== control.defaultValue;
  };
  for (const form of document.querySelectorAll("form")) {
    const elements = form.elements ? [...form.elements] : [];
    if (elements.some(controlIsDirty)) return true;
  }
  // Typed list-search boxes are not wrapped in a <form> but hold input a rebuild would erase too.
  for (const input of document.querySelectorAll("[data-search-input]")) {
    if (typeof input.value === "string" && input.value !== input.defaultValue) return true;
  }
  return false;
}

export async function checkForStateUpdates() {
  if (
    !currentUser ||
    currentUser.requiresPasswordChange ||
    currentUser.faceCheckPending ||
    !Number.isSafeInteger(dataRevision) ||
    dataRevision < 1
  )
    return false;
  if (faceCheckActive) return false; // do not detach a live camera capture
  if (typeof modalState !== "undefined" && modalState) return false; // do not re-render an open form
  if (typeof hasUnsavedPermissionChanges === "function" && hasUnsavedPermissionChanges()) return false;
  if (hasUnsavedFormInput()) return false; // do not rebuild a form the user is editing
  let revisionResponse;
  try {
    revisionResponse = await fetch("/api/state/revision");
  } catch (error) {
    console.error("CommUnity could not check for updates.", error);
    return false;
  }
  if (!revisionResponse.ok) return false;
  const { revision } = await revisionResponse.json();
  if (!Number.isSafeInteger(revision) || revision === dataRevision) return false;
  let stateResponse;
  try {
    stateResponse = await fetch("/api/state");
  } catch (error) {
    console.error("CommUnity could not refresh state.", error);
    return false;
  }
  const state = await stateResponse.json();
  if (!stateResponse.ok || !state?.data) return false;
  setState({ data: state.data });
  setState({ currentUser: state.user ?? currentUser });
  setState({ dataRevision: state.revision });
  setState({ lastPersistedSnapshot: JSON.stringify(data) });
  if (typeof render === "function") render();
  toast("Updated with the latest changes.", "success");
  return true;
}

export function startStateUpdates() {
  if (stateRefreshTimer) return;
  stateRefreshTimer = setInterval(() => {
    checkForStateUpdates().catch((error) => console.error("CommUnity could not refresh.", error));
  }, STATE_REFRESH_INTERVAL_MS);
}

export function stopStateUpdates() {
  clearInterval(stateRefreshTimer);
  stateRefreshTimer = null;
}
