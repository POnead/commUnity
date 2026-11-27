"use strict";

import { setLocationFixProvider, setMapState } from "../map.mjs";
import { reportLocationPosition } from "./location.mjs";
import {
  SESSION_SYNC_KEY,
  app,
  brandMark,
  clearSession,
  confirmAction,
  currentPath,
  currentUser,
  data,
  emptyState,
  esc,
  processingState,
  routeUrl,
  setState,
  startStateUpdates,
  stopStateUpdates,
  toast,
} from "../core.mjs";
import { canOpenPage, userAvatar } from "../views.mjs";
import { profilePhotoFile, setProfilePhotoFile, setProfilePhotoPreview } from "./profile.mjs";
import { SCHEDULE_REASON_STATUSES } from "../constants.mjs";
import {
  adminFaceAbortController,
  assignIdFaceFile,
  assignIdFaceState,
  assignIdScanState,
  assignIdStep,
  clearIdPreview,
  idFaceAbortController,
  stopIdCamera,
} from "./verification.mjs";
import { render } from "./render.mjs";

// The map picker can place the pin from the fix we already verified.
setLocationFixProvider(() => reportLocationPosition);

export function routeState() {
  const path = currentPath();
  // Reachable whether or not the visitor is signed in: the emailed link proves the address.
  if (path[0] === "verify-recovery") return { type: "verify-recovery" };
  if (path[0] === "verify-email") return { type: "verify-email" };
  if (!currentUser) {
    if (path[0] === "register") return { type: "register" };
    if (path[0] === "forgot-password") return { type: "forgot-password" };
    if (path[0] === "reset-password") return { type: "reset-password" };
    return { type: "login" };
  }
  // A temporary password must be replaced before any other gate applies.
  if (currentUser.requiresPasswordChange) return { type: "app", role: currentUser.role, page: "dashboard" };
  if (path[0] === "face-verify") return { type: "face-gate" };
  // A pending session cannot reach the workspace by typing another hash.
  if (currentUser.faceCheckPending) {
    window.history.replaceState(null, "", "#/face-verify");
    return { type: "face-gate" };
  }
  const role = currentUser.role;
  if (path[0] !== role) return { type: "app", role, page: "dashboard" };
  const requestedPage = path[1] || "dashboard";
  const pageName =
    role === "resident" && requestedPage === "history"
      ? "reports"
      : role === "official" && requestedPage === "urgent"
        ? "concerns"
        : requestedPage;
  const pages = {
    resident: ["dashboard", "calendar", "collection", "report", "reports", "hotlines", "notifications", "profile"],
    official: [
      "dashboard",
      "calendar",
      "concerns",
      "assigned",
      "collection",
      "history",
      "announcements",
      "hotlines",
      "notifications",
      "profile",
      "verify",
    ],
    administrator: [
      "dashboard",
      "calendar",
      "reports",
      "assignments",
      "approvals",
      "hotlines",
      "analytics",
      "notifications",
      "users",
      "locations",
      "announcements",
      "roles",
      "activity",
      "verifications",
      "settings",
      "email",
      "profile",
    ],
  };
  const resolvedPage = pages[role]?.includes(pageName) ? pageName : "dashboard";
  if (!canOpenPage(currentUser, resolvedPage)) {
    window.history.replaceState(null, "", routeUrl(role, "dashboard"));
    queueMicrotask(() => toast("That workspace page is not enabled for this role.", "error"));
    return { type: "app", role, page: "dashboard" };
  }
  return { type: "app", role, page: resolvedPage };
}

// The floating account summary is dragged by pointer anywhere on the panel. The
// offset lives outside shared state so live-update re-renders can reapply it.
export let profileSummaryOffset = null;

export function setupProfileDirtyState() {
  const form = app.querySelector("#profile-form");
  const reset = app.querySelector("[data-profile-reset]");
  if (!form || !reset) return;
  const initial = [...form.elements].filter((field) => field.name).map((field) => ({ field, value: field.value }));
  const sync = () => {
    const dirty = initial.some(({ field, value }) => field.value !== value);
    reset.hidden = !dirty && !profilePhotoFile;
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  reset.addEventListener("click", () => {
    form.reset();
    if (profilePhotoFile) {
      setProfilePhotoFile(null);
      setProfilePhotoPreview(null);
      const avatar = app.querySelector(".profile-intro .avatar, .profile-photo-field .avatar");
      if (avatar) avatar.outerHTML = userAvatar(currentUser, "large");
    }
    sync();
  });
}

export function setupProfileSummaryDrag(panel) {
  const handle = panel.querySelector(".profile-summary-toggle");
  if (!handle) return;
  handle.title = "Drag to move · click to expand or collapse";
  let origin = null;
  let moved = false;
  let suppressClick = false;
  let offset = { x: 0, y: 0 };

  const onMove = (event) => {
    if (!origin) return;
    let dx = event.clientX - origin.x;
    let dy = event.clientY - origin.y;
    if (!moved) {
      if (Math.hypot(dx, dy) < 5) return;
      moved = true;
      panel.classList.add("is-dragging");
      // Freeze the fixed position to explicit left/top so the transform offset
      // starts from a known point and the panel cannot jump when it is committed.
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = `${origin.left}px`;
      panel.style.top = `${origin.top}px`;
    }
    // Clamp the visual offset so the panel stays inside the viewport.
    dx = Math.min(Math.max(dx, -origin.left), window.innerWidth - origin.width - origin.left);
    dy = Math.min(Math.max(dy, -origin.top), window.innerHeight - origin.height - origin.top);
    offset = { x: dx, y: dy };
    // transform is composited, so dragging does not trigger layout on every move.
    panel.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  };

  const onUp = () => {
    if (!origin) return;
    if (moved) {
      // Commit the offset to left/top so a later re-render keeps the position.
      const left = origin.left + offset.x;
      const top = origin.top + offset.y;
      panel.style.transform = "";
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      profileSummaryOffset = { left, top };
      suppressClick = true;
      // A drag may end outside the panel, so its click handler might not run.
      setTimeout(() => (suppressClick = false), 0);
    }
    origin = null;
    moved = false;
    offset = { x: 0, y: 0 };
    panel.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  panel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || window.getComputedStyle(panel).position !== "fixed") return;
    const rect = panel.getBoundingClientRect();
    origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    moved = false;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  // A completed drag must not also fire the collapse/expand action.
  panel.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}

export function syncScheduleStatusFields(form) {
  const status = String(form.elements.status?.value || "Scheduled");
  const initialStatus = String(form.dataset.initialStatus || "");
  const changed = !initialStatus || status !== initialStatus;
  const noteField = form.querySelector("#schedule-status-note-field");
  const noteInput = form.querySelector("#statusNote");
  const rescheduleHint = form.querySelector("#schedule-reschedule-hint");
  const needsReason = changed && SCHEDULE_REASON_STATUSES.includes(status);
  if (noteField) noteField.hidden = !changed;
  if (noteInput) {
    noteInput.required = needsReason;
    noteInput.setAttribute("aria-required", needsReason ? "true" : "false");
  }
  if (rescheduleHint) rescheduleHint.hidden = !(changed && status === "Rescheduled");
}

export function showSupportingFileName(file) {
  const label = app.querySelector("[data-supporting-file-name]");
  if (!label) return;
  label.textContent = file ? `Selected: ${file.name}` : "";
  label.hidden = !file;
}

export function correctionSupportingFile(item) {
  try {
    const proposed = typeof item.proposed === "string" ? JSON.parse(item.proposed) : item.proposed || {};
    return proposed.supportingFile || null;
  } catch {
    return null;
  }
}

export function showModal(kind, id = "") {
  if (kind === "verify-id") {
    assignIdStep(1);
    assignIdScanState({ readable: false, complete: false });
    assignIdFaceState({ status: "idle" });
    assignIdFaceFile(null);
    clearIdPreview();
  }
  if (kind === "announcement") {
    const item = id ? data.announcements.find((record) => record.id === id) : null;
    setMapState({ announcementMapExpanded: Boolean(item?.isEvent) });
    setMapState({
      announcementMapSelection:
        item?.isEvent && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
          ? { latitude: item.latitude, longitude: item.longitude }
          : null,
    });
  }
  setState({ modalState: { kind, id } });
  render();
}

export function closeModal() {
  stopIdCamera();
  adminFaceAbortController?.abort();
  idFaceAbortController?.abort();
  clearIdPreview();
  setState({ modalState: null });
  render();
  app.querySelector(".workspace-main")?.focus();
}

export async function markNotification(id) {
  const item = data.notifications.find((notification) => notification.id === id && notification.targetEmail === currentUser.email);
  if (!item) throw new Error("This notification could not be found.");
  if (item.read) return;
  const confirmed = await confirmAction({
    title: "Mark as read?",
    message: "Mark this notification as read?",
    confirmLabel: "Mark read",
  });
  if (!confirmed) return;
  item.read = true;
  try {
    const response = await fetch("/api/community/mark-notifications-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    if (!response.ok) throw new Error("Could not mark notification as read.");
  } catch (error) {
    item.read = false;
    throw error;
  }
  render();
}

export function showFatal(error) {
  console.error("CommUnity could not start.", error);
  app.innerHTML = `<main class="fatal-screen">${brandMark()}<h1>CommUnity could not start</h1><p>${esc(error.message || "Check that the Node server is running and reload this page.")}</p>`;
}

export let sessionSyncing = false;
export let processingShowTimer = null;
export let processingHideTimer = null;

export function isProcessing() {
  return processingState.depth > 0;
}

export function syncProcessingOverlay() {
  const existing = document.getElementById("processing-modal");
  if (!processingState.visible) {
    if (existing && !existing.classList.contains("is-hiding")) existing.remove();
    return;
  }
  if (existing?.classList.contains("is-hiding")) {
    existing.classList.remove("is-hiding");
  }
  const markup = processingMarkup();
  if (existing) {
    existing.outerHTML = markup;
  } else {
    app.insertAdjacentHTML("beforeend", markup);
  }
}

export function processingMarkup() {
  const label = esc(processingState.label || "Processing...");
  const visible = processingState.visible ? " is-visible" : "";
  return `<div id="processing-modal" class="processing-modal${visible}" role="status" aria-live="polite" aria-label="${label}" aria-busy="true"><div class="processing-backdrop"></div><div class="processing-card"><span class="processing-spinner" aria-hidden="true"></span><p class="processing-label">${label}</p></div></div>`;
}

export function beginProcessing(label = "Processing...") {
  if (processingHideTimer) {
    clearTimeout(processingHideTimer);
    processingHideTimer = null;
  }
  const nextDepth = processingState.depth + 1;
  setState({ processingState: { ...processingState, depth: nextDepth, label } });
  if (nextDepth === 1) {
    if (processingShowTimer) clearTimeout(processingShowTimer);
    processingShowTimer = setTimeout(() => {
      processingShowTimer = null;
      if (processingState.depth > 0) {
        setState({ processingState: { ...processingState, visible: true } });
        syncProcessingOverlay();
        requestAnimationFrame(() => document.getElementById("processing-modal")?.classList.add("is-visible"));
      }
    }, 140);
  } else if (processingState.visible) {
    syncProcessingOverlay();
  }
}

export function endProcessing() {
  const nextDepth = Math.max(0, processingState.depth - 1);
  if (nextDepth > 0) {
    setState({ processingState: { ...processingState, depth: nextDepth } });
    return;
  }
  if (processingShowTimer) {
    clearTimeout(processingShowTimer);
    processingShowTimer = null;
  }
  const modal = document.getElementById("processing-modal");
  setState({ processingState: { ...processingState, depth: 0, visible: false } });
  if (modal && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    modal.classList.remove("is-visible");
    modal.classList.add("is-hiding");
    processingHideTimer = setTimeout(() => {
      processingHideTimer = null;
      modal.remove();
    }, 160);
  } else {
    modal?.remove();
  }
}

export async function withProcessing(task, label = "Processing...") {
  beginProcessing(label);
  try {
    return await task();
  } finally {
    endProcessing();
  }
}

export async function syncSessionAcrossTabs() {
  if (sessionSyncing) return;
  sessionSyncing = true;
  try {
    const sessionResponse = await fetch("/api/session");
    const session = await sessionResponse.json();
    if (!sessionResponse.ok) return;
    const nextUser = session.user || null;
    if ((nextUser?.email || "") === (currentUser?.email || "")) return;

    if (!nextUser) {
      clearSession();
      stopStateUpdates();
      setState({ data: emptyState() });
      setState({ dataRevision: 0 });
      setState({ lastPersistedSnapshot: "" });
      setState({ modalState: null });
      setState({ permissionDrafts: {} });
      window.location.hash = "#/login";
      render();
      return;
    }

    const stateResponse = await fetch("/api/state");
    const state = await stateResponse.json();
    if (!stateResponse.ok) return;
    setState({ currentUser: state.user });
    setState({ data: state.data });
    setState({ dataRevision: state.revision });
    startStateUpdates();
    setState({ lastPersistedSnapshot: JSON.stringify(data) });
    setState({ modalState: null });
    setState({ permissionDrafts: {} });
    setState({ selectedReportId: null });
    window.location.hash = routeUrl(currentUser.role, "dashboard");
    render();
    toast(`This browser is now signed in as ${currentUser.name}.`, "success");
  } catch (error) {
    console.error("CommUnity could not sync the tab session.", error);
  } finally {
    sessionSyncing = false;
  }
}

export function watchSessionAcrossTabs() {
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_SYNC_KEY) syncSessionAcrossTabs();
  });
}
