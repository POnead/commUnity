"use strict";

import { currentUser, setState, toastEl, toastTimer } from "./state.mjs";
import { esc } from "./format.mjs";

export function toast(message, kind = "") {
  toastEl.textContent = message;
  toastEl.dataset.kind = kind;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  setState({ toastTimer: setTimeout(() => toastEl.classList.remove("visible"), 3400) });
}

// A gated official action answers 403 with a code, not just a message. Treat it
// as "go do the face check first", not as "something broke".
export function redirectToFaceCheckIfRequired(error) {
  if (error?.code !== "FACE_VERIFICATION_REQUIRED" || currentUser?.role !== "official") return false;
  if (window.location.hash !== "#/official/verify") window.location.hash = "#/official/verify";
  toast(error.message || "Complete the face check to continue.", "error");
  return true;
}

export let activeConfirmation = null;

export function confirmAction({
  title = "Confirm change",
  message = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
} = {}) {
  if (activeConfirmation) return Promise.resolve(false);
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop confirm-backdrop";
    backdrop.innerHTML = `<section class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
      <header class="modal-head"><div><h2 id="confirm-dialog-title">${esc(title)}</h2></div></header>
      <div class="modal-content confirm-content">
        <p id="confirm-dialog-message">${esc(message)}</p>
        <div class="form-actions"><button class="button secondary" type="button" data-confirm="cancel">${esc(cancelLabel)}</button><button class="button${tone === "danger" ? " danger" : ""}" type="button" data-confirm="accept">${esc(confirmLabel)}</button></div>
      </div>
    </section>`;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.append(backdrop);
    const acceptButton = backdrop.querySelector('[data-confirm="accept"]');
    const cancelButton = backdrop.querySelector('[data-confirm="cancel"]');
    const finish = (value) => {
      if (!activeConfirmation) return;
      activeConfirmation = null;
      backdrop.remove();
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
      resolve(value);
    };
    activeConfirmation = { finish };
    acceptButton.addEventListener("click", () => finish(true));
    cancelButton.addEventListener("click", () => finish(false));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(false);
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const focusable = [...backdrop.querySelectorAll("button:not([disabled])")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    cancelButton.focus();
  });
}
