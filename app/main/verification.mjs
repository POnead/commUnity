"use strict";

import {
  app,
  confirmAction,
  currentUser,
  data,
  esc,
  getUser,
  icon,
  setFaceCheckActive,
  setState,
  toast,
  verificationSettings,
} from "../core.mjs";
import { compressPhoto } from "./reports.mjs";
import { cameraErrorCopy, runLiveness } from "../face-capture.mjs";
import { render } from "./render.mjs";
import { loadWorkspaceAfterGate, refreshWorkspace } from "./bootstrap.mjs";
import { routeState } from "./ui.mjs";

export let idScanStream = null;

export let idStep = 1;
export let idStepCount = 4;
export let idAttachedFile = null;
export let idScanState = { readable: false, complete: false };
export let idFaceState = { status: "idle" };
export let idFaceFile = null;
export let idFaceAbortController = null;
export const idIntegrated = () => currentUser?.role === "official";
// Servers without Face++ skip the match; "unavailable" satisfies the face step.
export const idFaceSatisfied = (status) => status === "matched" || status === "unavailable";

// One live region carries progress and errors for the whole dialog.
export function idStatus(message = "", tone = "") {
  const status = document.getElementById("id-ocr-status");
  if (!status) return;
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

// Panes toggle in place so typed values and the camera stream survive a step
// change; the tracker uses the report wizard's own components and vocabulary.
export function setIdStep(step) {
  const form = document.getElementById("id-submit-form");
  if (!form) return;
  idStep = Math.max(1, Math.min(idStepCount, step));
  form.querySelectorAll(".id-step").forEach((pane) => {
    pane.hidden = Number(pane.dataset.step) !== idStep;
  });
  form.querySelectorAll(".wizard-step").forEach((node) => {
    const number = Number(node.dataset.step);
    node.classList.toggle("current", number === idStep);
    node.classList.toggle("done", number < idStep);
    const marker = node.querySelector("strong");
    if (marker) marker.innerHTML = number < idStep ? icon("check") : String(number);
  });
  form.querySelector(".wizard-progress")?.setAttribute("aria-label", `Step ${idStep} of ${idStepCount}`);
  const back = form.querySelector('[data-action="id-step-back"]');
  const next = form.querySelector('[data-action="id-step-next"]');
  const submit = form.querySelector('[data-action="id-step-submit"]');
  const manual = form.querySelector('[data-action="id-step-manual"]');
  if (manual) manual.hidden = idStep !== 1;
  if (back) back.hidden = idStep === 1;
  if (next) next.hidden = idStep === idStepCount;
  if (submit) submit.hidden = idStep !== idStepCount;
  const manualPhoto = form.querySelector("#id-manual-photo-field");
  const personalStep = idIntegrated() ? 5 : 3;
  if (manualPhoto && idStep !== personalStep) manualPhoto.hidden = true;
  if (idStep === idStepCount) renderIdFinalResult();
  // Entering the match step runs the comparison once the live frame is ready.
  if (idIntegrated() && idStep === 4 && idFaceFile && idFaceState.status === "captured") runIdFaceCheck(idFaceFile);
  idStatus("");
  form.closest(".modal")?.querySelector(".modal-content")?.scrollTo?.({ top: 0 });
}

export function renderIdFinalResult() {
  const holder = document.getElementById("id-final-result");
  if (!holder) return;
  const scanOk = idScanState.readable && idScanState.complete;
  const faceOk = idFaceSatisfied(idFaceState.status);
  const rows = [["ID uploaded and scanned", scanOk]];
  if (idIntegrated())
    rows.push([
      faceOk && idFaceState.status === "unavailable" ? "Face match not required on this server" : "Face captured and matched",
      faceOk,
    ]);
  rows.push(["Personal information populated", true]);
  holder.innerHTML = `<div class="verify-result-card"><ul class="id-check-list">${rows
    .map(([label, ok]) => `<li class="${ok ? "ok" : "bad"}"><span aria-hidden="true">${ok ? "✓" : "!"}</span>${label}</li>`)
    .join("")}</ul><p class="field-help">Submitting saves the record. An administrator completes the final review.</p></div>`;
}

export function setIdLoading(on) {
  const form = document.getElementById("id-submit-form");
  if (!form) return;
  form.setAttribute("aria-busy", on ? "true" : "false");
  const next = form.querySelector('[data-action="id-step-next"]');
  if (next) {
    next.disabled = on;
    next.textContent = on ? "Reading the ID…" : "Continue";
  }
  form.querySelectorAll('[data-action="id-scan-camera"], #id-scan-file, #id-manual-photo, #id-back-photo').forEach((node) => {
    node.disabled = on;
  });
  const spinner = document.getElementById("id-scan-loading");
  if (spinner) spinner.hidden = !on;
}

export async function idStepNext() {
  const nextButton = document.querySelector('#id-submit-form [data-action="id-step-next"]');
  if (nextButton?.disabled) return;
  if (idStep === 1) {
    if (!idAttachedFile) {
      idStatus("Scan or upload the front of your ID to continue.", "error");
      return;
    }
    idStatus("");
    setIdLoading(true);
    let read = false;
    try {
      read = await scanIdImage(idAttachedFile, idAttachedFile.name);
    } catch (error) {
      idStatus(error.message || "The ID could not be read.", "error");
    } finally {
      setIdLoading(false);
    }
    if (!read) {
      idStatus("No details could be read. Try a clearer photo or enter the details manually.", "error");
      return;
    }
    setIdStep(2);
    return;
  }
  if (idStep === 2) {
    if (!idScanState.readable || !idScanState.complete) {
      idStatus("The scan must be readable and complete. Retry with a clearer photo.", "error");
      return;
    }
    setIdStep(3);
    return;
  }
  const personalStep = idIntegrated() ? 5 : 3;
  if (idIntegrated() && idStep === 3) {
    if (!idFaceFile) {
      setIdStatus("Start the face capture to continue.", "error");
      return;
    }
    setIdStep(4);
    return;
  }
  if (idIntegrated() && idStep === 4) {
    if (idFaceState.status === "captured") await runIdFaceCheck(idFaceFile);
    if (!idFaceSatisfied(idFaceState.status)) {
      setIdStatus("The face must match the ID photo before you continue.", "error");
      return;
    }
    setIdStep(personalStep);
    return;
  }
  if (idStep === personalStep) {
    const required = ["idType", "idNumber", "idFullName", "idBirthDate"];
    const missing = required.filter((id) => !String(document.getElementById(id)?.value || "").trim());
    if (missing.length) {
      idStatus("Fill in the ID details before continuing.", "error");
      document.getElementById(missing[0])?.focus();
      return;
    }
  }
  setIdStep(idStep + 1);
}

// Test-only driver: seed the wizard state, run the real Next handler, and report the resulting step.
export async function __driveIdStepNext({ step, faceStatus }) {
  idStep = step;
  idFaceState = { status: faceStatus };
  await idStepNext();
  return idStep;
}

export function setIdStatus(message = "", tone = "") {
  const status = document.getElementById("id-face-stage") || document.getElementById("id-ocr-status");
  if (!status) return;
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

// Pure summary of the server's own validation, so the badge says "pass" only
// for checks the submit will also accept. Not a document-authenticity verdict.
export function idCheckSummary(checks = {}, suggestions = {}) {
  const errors = checks.errors || [];
  const warnings = checks.warnings || [];
  const fields = ["idType", "idNumber", "idFullName", "idBirthDate"];
  const found = fields.filter((field) => Boolean(String(suggestions[field] || "").trim())).length;
  const has = (fragment) => [...errors, ...warnings].some((message) => String(message).toLowerCase().includes(fragment));
  const rows = [
    { label: "Image readable", ok: checks.readable === true },
    { label: "All four details found", ok: found === fields.length, detail: found === fields.length ? "" : `${found} of ${fields.length}` },
    { label: "ID type recognised", ok: !has("id type") },
    { label: "ID number format", ok: !has("id number") && !has("id_number") },
    { label: "Full name", ok: !has("full name") },
    { label: "Birth date", ok: !has("birth date") && !has("birth year") && !has("future") },
    { label: "Name matches account", ok: !has("does not match the account name") },
    { label: "Number not already registered", ok: checks.duplicate !== true },
    { label: "Address read", ok: Boolean(String(suggestions.idAddress || "").trim()), optional: true },
    { label: "Expiration date read (if applicable)", ok: Boolean(String(suggestions.idExpirationDate || "").trim()), optional: true },
  ];
  return { status: rows.filter((row) => !row.optional).every((row) => row.ok) ? "pass" : "review", rows };
}

export let idPreviewUrl = "";

export function showIdPreview(file) {
  const image = document.getElementById("id-scan-preview-image");
  const wrapper = document.getElementById("id-scan-results");
  if (!image || !wrapper) return;
  if (idPreviewUrl) URL.revokeObjectURL(idPreviewUrl);
  idPreviewUrl = URL.createObjectURL(file);
  image.src = idPreviewUrl;
  wrapper.hidden = false;
}

// Adding an image only previews and attaches it. Reading it happens on Continue.
export function attachIdImage(file) {
  if (!file) return;
  idAttachedFile = file;
  showIdPreview(file);
  idStatus("");
}

export function clearIdPreview() {
  idAttachedFile = null;
  if (idPreviewUrl) URL.revokeObjectURL(idPreviewUrl);
  idPreviewUrl = "";
  const image = document.getElementById("id-scan-preview-image");
  if (image) image.removeAttribute("src");
  const holder = document.getElementById("id-check-result");
  if (holder) holder.innerHTML = "";
  const wrapper = document.getElementById("id-scan-results");
  if (wrapper) wrapper.hidden = true;
  resetBackPreview();
}

export let idBackPreviewUrl = "";

// The back box becomes the image itself once a file is chosen. The input stays
// inside the label, so clicking the preview still opens the picker to replace it.
export function resetBackPreview() {
  if (idBackPreviewUrl) URL.revokeObjectURL(idBackPreviewUrl);
  idBackPreviewUrl = "";
  const image = document.getElementById("id-back-preview");
  if (image) {
    image.removeAttribute("src");
    image.hidden = true;
  }
  document.querySelector(".id-back-upload")?.classList.remove("is-filled");
  const remove = document.querySelector('[data-action="id-back-remove"]');
  if (remove) remove.hidden = true;
  const note = document.getElementById("id-back-file-name");
  if (note) {
    note.textContent = "";
    note.hidden = true;
  }
}

export function showBackPreview(file) {
  resetBackPreview();
  if (!file) return;
  idBackPreviewUrl = URL.createObjectURL(file);
  const image = document.getElementById("id-back-preview");
  if (image) {
    image.src = idBackPreviewUrl;
    image.hidden = false;
  }
  document.querySelector(".id-back-upload")?.classList.add("is-filled");
  const remove = document.querySelector('[data-action="id-back-remove"]');
  if (remove) remove.hidden = false;
  const note = document.getElementById("id-back-file-name");
  if (note) {
    note.textContent = `Attached: ${file.name}`;
    note.hidden = false;
  }
}

export function renderIdChecks(result) {
  const holder = document.getElementById("id-check-result");
  if (!holder) return;
  const summary = idCheckSummary(result?.checks || {}, result?.suggestions || {});
  const match = result?.match;
  const signals = Array.isArray(result?.signals) ? result.signals : [];
  const toneClass = { pass: "ok", warn: "review", fail: "fail", unknown: "muted" };
  const rows = signals.length
    ? signals.map((signal) => ({ label: signal.label, detail: signal.detail, tone: signal.tone, ok: signal.tone === "pass" }))
    : [...summary.rows];
  if (!signals.length && match) {
    const failed = match.rows.filter((row) => !row.ok).map((row) => row.field);
    rows.push({
      label: "Details match your account",
      ok: match.ok,
      detail: failed.length ? `Different: ${failed.join(", ")}` : "",
    });
  }
  const status = match && !match.ok ? "fail" : summary.status;
  const passed = rows.filter((row) => row.ok).length;
  holder.innerHTML = `<div class="id-check-status ${status}"><strong>${status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "NEEDS REVIEW"}</strong><span>${passed}/${rows.length} checks passed</span></div>
    <ul class="id-check-list">${rows
      .map(
        (row) =>
          `<li class="${row.tone ? toneClass[row.tone] || "muted" : row.ok ? "ok" : "bad"}"><span aria-hidden="true">${row.ok ? "✓" : "!"}</span>${esc(row.label)}${row.detail ? ` — ${esc(row.detail)}` : ""}</li>`,
      )
      .join("")}</ul>
    <p class="field-help">Checks the details on the card, not whether the document is genuine. An administrator reviews every ID.</p>`;
}

export function updateIdAge() {
  const input = document.getElementById("idBirthDate");
  const age = document.getElementById("idAge");
  if (!input || !age) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) {
    age.value = "—";
    return;
  }
  const dob = new Date(`${input.value}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) {
    age.value = "—";
    return;
  }
  const now = new Date();
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) years -= 1;
  age.value = years >= 0 && years < 130 ? String(years) : "—";
}

export async function scanIdImage(source, name = "id-scan.jpg") {
  try {
    const file = source instanceof File ? source : new File([source], name, { type: source.type || "image/jpeg" });
    const compressed = (await compressPhoto(file)).file;
    showIdPreview(compressed);
    const form = new FormData();
    form.append("photos", compressed);
    // Send what the user already typed so the server can compare it with what
    // OCR read before the fields get replaced.
    for (const field of ["idType", "idNumber", "idFullName", "idBirthDate", "idAddress", "idExpirationDate"]) {
      form.append(field, String(document.getElementById(field)?.value || ""));
    }
    const response = await fetch("/api/verification/id/ocr", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The ID could not be scanned.");
    const suggestions = payload.suggestions || {};
    let filled = 0;
    for (const field of ["idType", "idNumber", "idFullName", "idBirthDate", "idAddress", "idExpirationDate"]) {
      const input = document.getElementById(field);
      const value = suggestions[field];
      if (!input || !value) continue;
      input.value = String(value); // the scan is the source of truth; users can still correct it
      filled += 1;
    }
    updateIdAge();
    idScanState = {
      readable: payload.checks?.readable === true,
      complete: ["idType", "idNumber", "idFullName", "idBirthDate"].every((field) => String(suggestions[field] || "").trim()),
    };
    renderIdChecks(payload);
    idStatus(
      filled
        ? `Filled ${filled} field${filled === 1 ? "" : "s"} from the ID. Check them before submitting.`
        : "No fields could be read. Check the photo and try again.",
      filled ? "" : "error",
    );
    return filled > 0;
  } catch (error) {
    idStatus(error.message || "The ID could not be scanned.", "error");
    return false;
  }
}

export function updateIdFaceHud(message, meta = {}) {
  const instruction = document.getElementById("id-face-hud-instruction");
  const chip = document.getElementById("id-face-hud-chip");
  if (instruction) instruction.textContent = message;
  if (chip) chip.textContent = meta.detected === false ? "No face" : meta.framed === false ? "Adjust position" : "Face visible";
  const progress = document.getElementById("id-face-hud-progress");
  const index = ["front", "blink", "turn", "final"].indexOf(meta.step);
  if (progress) progress.dataset.progress = String(Math.max(1, index + 1));
}

export function updateIdFaceCameraState(state) {
  const frame = document.querySelector("#id-face-capture .face-video-frame");
  const copy = document.getElementById("id-face-camera-state");
  if (frame) frame.setAttribute("data-camera-state", state === "live" ? "live" : state === "done" ? "done" : "idle");
  if (copy) copy.hidden = ["live", "capturing", "done"].includes(state);
}

// The captured frame is a data URL; turn it into a File locally so a failed
// network fetch cannot be reported as a camera failure.
export function dataUrlToFile(dataUrl, name) {
  const [header, encoded] = String(dataUrl || "").split(",", 2);
  const mime = /^data:image\/(?:jpeg|png)/.exec(header || "")?.[0]?.slice(5) || "image/jpeg";
  const bytes = Uint8Array.from(atob(encoded || ""), (character) => character.charCodeAt(0));
  return new File([bytes], name, { type: mime });
}

export async function startIdFaceCapture() {
  const video = document.getElementById("id-selfie-video");
  const start = document.getElementById("id-face-start");
  const cancel = document.getElementById("id-face-cancel");
  if (!video || idFaceAbortController) return;
  const controller = new AbortController();
  idFaceAbortController = controller;
  idFaceState = { status: "capturing" };
  if (start) start.disabled = true;
  if (cancel) cancel.hidden = false;
  setIdStatus("Starting the camera…");
  try {
    const capture = await runLiveness(
      video,
      (message, meta) => {
        setIdStatus(message);
        updateIdFaceHud(message, meta);
      },
      { signal: controller.signal, onState: updateIdFaceCameraState },
    );
    idFaceFile = dataUrlToFile(capture.image, "face-capture.jpg");
    idFaceState = { status: "captured" };
    setIdStatus("Face captured. Continue to match it with your ID.");
  } catch (error) {
    const copy = cameraErrorCopy(error);
    idFaceState = { status: error?.name === "AbortError" ? "idle" : "failed" };
    setIdStatus(error?.name === "AbortError" ? "Face capture cancelled." : `${copy.title}: ${copy.detail}`, "error");
  } finally {
    idFaceAbortController = null;
    if (start) {
      start.disabled = false;
      start.textContent = idFaceFile ? "Retake face capture" : "Start face capture";
    }
    if (cancel) cancel.hidden = true;
  }
}

export async function runIdFaceCheck(faceFile) {
  const result = document.getElementById("id-face-result");
  const retry = document.getElementById("id-face-retry");
  const idPhoto = idAttachedFile;
  if (!result || !idPhoto || !faceFile) return;
  idFaceState = { status: "checking" };
  result.textContent = "Comparing the captured face with the photo on your ID…";
  try {
    const form = new FormData();
    form.append("photos", (await compressPhoto(idPhoto)).file);
    form.append("photos", (await compressPhoto(faceFile)).file);
    const response = await fetch("/api/verification/id/face-check", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The face check could not run.");
    if (payload.status === "matched") {
      idFaceState = { status: "matched", confidence: payload.confidence };
      result.textContent = `Face matches your ID (confidence ${Math.round(payload.confidence)}).`;
    } else if (payload.status === "mismatch") {
      idFaceState = { status: "mismatch" };
      result.textContent = "The captured face does not match the ID photo. Retake the capture and try again.";
    } else if (payload.status === "unclear") {
      idFaceState = { status: "unclear" };
      result.textContent = payload.reason || "The image was unclear. Retake the face capture.";
    } else {
      idFaceState = { status: "unavailable" };
      result.textContent = `${payload.reason || "Face matching is not available on this server."} No face match is required; continue when ready.`;
    }
  } catch (error) {
    idFaceState = { status: "unavailable" };
    result.textContent = `${error.message || "The face check could not run."} No face match is required; continue when ready.`;
  }
  if (retry) retry.hidden = idFaceSatisfied(idFaceState.status);
  result.dataset.status = idFaceState.status;
}

export async function startIdCamera() {
  const panel = document.getElementById("id-scan-camera");
  const video = document.getElementById("id-scan-video");
  if (!panel || !video) return;
  try {
    idScanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = idScanStream;
    panel.hidden = false;
    await video.play();
    idStatus("Camera on. Hold the ID steady, then capture.");
  } catch {
    idStatus("Camera unavailable. Use “Upload ID photo” instead.");
  }
}

export function stopIdCamera() {
  if (idScanStream) {
    idScanStream.getTracks().forEach((track) => track.stop());
    idScanStream = null;
  }
  const panel = document.getElementById("id-scan-camera");
  const video = document.getElementById("id-scan-video");
  if (video) video.srcObject = null;
  if (panel) panel.hidden = true;
}

export async function captureIdPhoto() {
  const video = document.getElementById("id-scan-video");
  if (!video?.videoWidth) {
    idStatus("Camera is still starting.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  stopIdCamera();
  if (blob) attachIdImage(new File([blob], "id-camera.jpg", { type: "image/jpeg" }));
  idStatus("ID photo attached. Press Continue to read it.");
}

export async function submitIdVerification(form) {
  const frontFile = idAttachedFile;
  if (!frontFile) throw new Error("Attach a photo of the front of your ID.");
  const backFile = form.elements.namedItem("id-back-photo")?.files?.[0];
  const formData = new FormData();
  for (const [key, value] of new FormData(form).entries()) {
    if (value instanceof File) continue;
    formData.append(key, value);
  }
  formData.append("photos", (await compressPhoto(frontFile)).file);
  if (backFile) formData.append("photos", (await compressPhoto(backFile)).file);
  const confirmed = await confirmAction({
    title: "Submit ID for review?",
    message:
      "An administrator will check the image and the number against this account, then mark the ID verified or ask you to try again.",
    confirmLabel: "Submit ID",
  });
  if (!confirmed) return;
  stopIdCamera();
  clearIdPreview();
  const response = await fetch("/api/verification/id", { method: "POST", body: formData });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The ID could not be submitted.");
  setState({ modalState: null });
  render();
  try {
    await refreshWorkspace();
    render();
  } catch (error) {
    // On the face gate the restricted session cannot read workspace state yet.
    // The ID submission itself succeeded, so keep the dialog closed.
    if (error.code !== "FACE_VERIFICATION_REQUIRED") throw error;
  }
  toast("ID submitted. An administrator will review it.", "success");
}

export async function removeIdVerification() {
  const confirmed = await confirmAction({
    title: "Remove verification?",
    message:
      "This permanently deletes your ID image, the stored details, and the verification badge. You can submit a new ID any time afterwards.",
    confirmLabel: "Remove ID data",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/verification/id", { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The verification could not be removed.");
  await refreshWorkspace();
  render();
  toast("Your ID data was removed.", "success");
}

export async function reviewIdVerification(userId, decision, note = "") {
  const body = { userId, decision };
  if (decision === "rejected") body.note = note;
  const response = await fetch("/api/verification/id/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The decision could not be recorded.");
  setState({ modalState: null });
  await refreshWorkspace();
  render();
  toast(
    decision === "verified" ? "ID approved. The resident is now verified." : "ID rejected. The resident can submit a new one.",
    decision === "verified" ? "success" : "",
  );
}

export async function clearFaceReference(form) {
  const email = String(form.get("email") || "");
  const reason = String(form.get("reason") || "").trim();
  const user = getUser(email);
  if (!user) throw new Error("That account could not be found.");
  if (reason.length < 5) throw new Error("Give the removal a reason of at least 5 characters.");
  const confirmed = await confirmAction({
    title: "Clear face reference?",
    message: `Remove ${user.name}'s face reference and duty-check timestamp? They will need to enroll again at the office PC.`,
    confirmLabel: "Clear face reference",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/verification/face", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: user.id, reason }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The face reference could not be cleared.");
  setState({ modalState: null });
  await refreshWorkspace();
  render();
  toast(`Face reference cleared for ${user.name}.`, "success");
}

export async function removeOwnFaceReference() {
  const confirmed = await confirmAction({
    title: "Remove face data?",
    message:
      "This permanently deletes your face reference, the liveness flag, and the duty-check timestamp. Enroll again to use the face check.",
    confirmLabel: "Remove face data",
    tone: "danger",
  });
  if (!confirmed) return;
  const response = await fetch("/api/verification/face", { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The face reference could not be removed.");
  setState({ faceCheckNotice: "" });
  await refreshWorkspace();
  render();
  toast("Your face data was removed.", "success");
}

export let faceCheckAbortController = null;
export let adminFaceAbortController = null;

export function setFaceCameraState(state, copy = {}, root = document) {
  const frame = root.querySelector(".face-video-frame");
  if (frame) frame.dataset.cameraState = state;
  const iconNode = root.querySelector(".face-camera-icon");
  const title = root.querySelector(".face-camera-title");
  const detail = root.querySelector(".face-camera-detail");
  const note = root.querySelector(".face-camera-note");
  if (iconNode)
    iconNode.innerHTML =
      state === "loading"
        ? '<span class="face-camera-spinner" aria-hidden="true"></span>'
        : icon(copy.icon || "cameraOff", "face-camera-icon-svg");
  if (title) title.textContent = copy.title || "Camera is off";
  if (detail) detail.textContent = copy.detail || "Start the check to turn on your camera.";
  if (note) note.textContent = copy.note || "The preview stays on this device.";
  const startButton = root.querySelector("[data-face-start]");
  const hudCancel = root.querySelector(".face-hud-cancel");
  const running = state === "loading" || state === "live";
  if (startButton) {
    startButton.disabled = running;
    startButton.textContent =
      state === "loading"
        ? "Starting…"
        : state === "live"
          ? startButton.dataset.busyLabel || "Checking…"
          : startButton.dataset.idleLabel || "Start face check";
  }
  if (hudCancel) hudCancel.hidden = !running;
}

export function setFaceProgress(meta = {}, root = document) {
  const stageNode = root.querySelector(".face-check-stage");
  const guide = root.querySelector(".face-guide");
  const step = meta.step || "front";
  if (stageNode) stageNode.dataset.step = step;
  if (guide) {
    guide.dataset.detected = String(Boolean(meta.detected));
    if (meta.framed !== undefined) guide.dataset.framed = String(Boolean(meta.framed));
  }
  const progressNode = root.querySelector(".face-hud-progress");
  if (progressNode) progressNode.dataset.progress = String(step === "final" ? 4 : ["front", "blink", "turn"].indexOf(step) + 1);
  const instruction = root.querySelector(".face-hud-instruction");
  if (instruction && meta.message) instruction.textContent = meta.message;
  const chip = root.querySelector(".face-hud-chip");
  if (chip) {
    if (meta.secondsLeft !== undefined) {
      chip.dataset.framing = "poor";
      chip.textContent = "Time is running out — follow the prompt.";
    } else if (meta.framed !== undefined) {
      chip.dataset.framing = meta.framed ? "good" : meta.detected ? "poor" : "none";
      chip.textContent = meta.framed ? "Good framing" : meta.detected ? "Centre your face" : "Face not found";
    }
  }
  const order = ["front", "blink", "turn"];
  const currentIndex = order.indexOf(step);
  stageNode?.querySelectorAll(".face-check-steps li").forEach((item, index) => {
    delete item.dataset.active;
    delete item.dataset.done;
    if (step === "final" || (currentIndex >= 0 && index < currentIndex)) item.dataset.done = "";
    else if (index === currentIndex) item.dataset.active = "";
  });
}

export async function finishFaceCheck(mode) {
  const message =
    mode === "enroll"
      ? "Face enrolled. Your face is now registered for duty checks."
      : "Face verified. Changes are unlocked for this shift.";
  const resultBox = document.getElementById("face-check-result");
  if (resultBox) {
    resultBox.textContent = message;
    resultBox.dataset.state = "success";
  }
  setState({ faceCheckNotice: message });
  setFaceCameraState("done", { title: "Camera stopped", detail: "Your check is complete.", note: "" });
  if (routeState().type === "face-gate") {
    await loadWorkspaceAfterGate("Face check complete. Welcome back.");
    return;
  }
  await refreshWorkspace();
  render();
  toast(message, "success");
}

export async function runAdminFaceEnroll(userId) {
  if (adminFaceAbortController) return;
  const panel = document.getElementById("admin-face-panel");
  const video = document.getElementById("admin-face-video");
  const stage = document.getElementById("admin-face-stage");
  const target = (data.users || []).find((item) => item.id === userId);
  if (!panel || !video || !stage || !target) return;
  const controller = new AbortController();
  adminFaceAbortController = controller;
  setFaceCheckActive(true);
  setFaceCameraState("loading", { title: "Starting camera", detail: "Loading the face models…" }, panel);
  try {
    const capture = await runLiveness(
      video,
      (message, meta) => {
        stage.textContent = message;
        setFaceProgress({ ...meta, message }, panel);
      },
      {
        signal: controller.signal,
        onState: (cameraState) => {
          if (cameraState === "live") setFaceCameraState("live", {}, panel);
        },
      },
    );
    const confirmed = await confirmAction({
      title: "Save this face?",
      message: `Save this captured face as ${target.name}'s verification reference?`,
      confirmLabel: "Save face",
      tone: "danger",
    });
    if (!confirmed) {
      setFaceCameraState("idle", {}, panel);
      stage.textContent = "Capture discarded. No face was saved.";
      return;
    }
    stage.textContent = "Saving face reference…";
    const response = await fetch("/api/users/face-enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, image: capture.image, embedding: capture.descriptor }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The face could not be saved.");
    setFaceCameraState("done", { title: "Camera stopped", detail: "Face reference saved.", note: "" }, panel);
    stage.textContent = "Face reference saved.";
    toast(`Face reference saved for ${target.name}.`, "success");
    setState({ modalState: null });
    await refreshWorkspace();
    render();
  } catch (error) {
    if (error.name === "AbortError") {
      setFaceCameraState("idle", {}, panel);
      stage.textContent = "Capture cancelled. No face was saved.";
    } else {
      const copy = cameraErrorCopy(error);
      setFaceCameraState("error", copy, panel);
      stage.textContent = copy.detail || error.message || "The face could not be captured.";
    }
  } finally {
    adminFaceAbortController = null;
    setFaceCheckActive(false);
  }
}

export function showFaceFailure(title, detail) {
  setFaceCameraState("error", { title, detail, icon: "alert", note: "" });
  const stage = document.getElementById("face-stage");
  const resultBox = document.getElementById("face-check-result");
  if (stage) stage.textContent = detail;
  if (resultBox) {
    resultBox.textContent = detail;
    resultBox.dataset.state = "error";
  }
}

export async function runFaceCheck(mode) {
  const video = document.getElementById("face-video");
  const stage = document.getElementById("face-stage");
  const resultBox = document.getElementById("face-check-result");
  const startButton = document.getElementById("face-check-start");
  if (!video || !stage || !resultBox || !startButton || faceCheckAbortController) return;
  const controller = new AbortController();
  faceCheckAbortController = controller;
  setFaceCheckActive(true);
  setState({ faceCheckNotice: "" });
  resultBox.textContent = "";
  resultBox.dataset.state = "";
  setFaceProgress({ step: "front", detected: false });
  setFaceCameraState("loading", { title: "Starting camera", detail: "Loading the face models…" });
  try {
    const capture = await runLiveness(
      video,
      (message, meta) => {
        stage.textContent = message;
        setFaceProgress({ ...meta, message });
      },
      {
        signal: controller.signal,
        onState: (state) => {
          if (state === "live") setFaceCameraState("live", { title: "Live", detail: "Follow the prompts to complete the check." });
          if (state === "capturing") {
            const chip = document.getElementById("face-hud-chip");
            if (chip) {
              chip.dataset.framing = "good";
              chip.textContent = "Capturing…";
            }
          }
        },
      },
    );
    stage.textContent = "Matching against your reference…";
    const endpoint = mode === "enroll" ? "/api/verification/face/enroll" : "/api/verification/face/verify";
    const answer = await sendFaceSample(endpoint, capture.descriptor, capture.liveness, capture.image);
    if (answer.ok) {
      await finishFaceCheck(mode);
      return;
    }
    if (answer.mismatch) {
      showFaceFailure(
        "This isn't your enrolled face",
        "The new sample doesn't match your enrolled reference. Ask an administrator to reset it, then try again.",
      );
    } else {
      showFaceFailure("Face check could not finish", answer.error);
    }
  } catch (error) {
    const copy = cameraErrorCopy(error);
    showFaceFailure(copy.title, copy.detail);
  } finally {
    faceCheckAbortController = null;
    setFaceCheckActive(false);
    const frame = document.getElementById("face-panel")?.querySelector(".face-video-frame");
    if (resultBox.dataset.state !== "success" && frame && ["loading", "live", "done"].includes(frame.dataset.cameraState))
      setFaceCameraState("idle");
  }
}

export async function sendFaceSample(endpoint, descriptor, liveness, image = null) {
  const body = endpoint.endsWith("/enroll") ? { embedding: descriptor, liveness } : { embedding: descriptor };
  // The image is ignored when Face++ is off, so the local path stays unchanged.
  if (image) body.image = image;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (response.ok) return { ok: true };
  if (response.status === 409 && payload.code === "FACE_MISMATCH") return { mismatch: true };
  return { error: payload.error || "The check failed. Try again." };
}

export async function loadOfficialVerificationStatus() {
  try {
    const response = await fetch("/api/verification/status");
    if (!response.ok) return;
    const status = await response.json();
    const enabled = Boolean(status.faceppEnabled);
    if (enabled === Boolean(verificationSettings.faceppEnabled)) return;
    setState({ verificationSettings: { ...verificationSettings, faceppEnabled: enabled } });
    render();
  } catch {
    // Keep the previous value; the note is informational only.
  }
}

export async function loadVerificationSettings() {
  const response = await fetch("/api/settings/verification");
  const result = await response.json();
  if (!response.ok) return;
  setState({ verificationSettings: result.settings });
  const form = app.querySelector("#verification-settings-form");
  if (!form) return;
  const { faceVerificationEnabled, requireFaceOnLogin, dutyHours, matchThreshold, faceppEnabled, faceppThreshold, ocrEnabled } =
    result.settings || {};
  form.elements.namedItem("requireFaceOnLogin").checked = requireFaceOnLogin === true;
  form.elements.namedItem("faceVerificationEnabled").checked = faceVerificationEnabled === true;
  form.elements.namedItem("dutyHours").value = String(dutyHours || 9);
  form.elements.namedItem("matchThreshold").value = String(matchThreshold ?? 0.033);
  form.elements.namedItem("faceppEnabled").checked = faceppEnabled === true;
  form.elements.namedItem("faceppThreshold").value = String(faceppThreshold ?? 80);
  form.elements.namedItem("ocrEnabled").checked = ocrEnabled === true;
}

export async function saveVerificationSettings(form) {
  const fields = new FormData(form);
  const body = {
    requireFaceOnLogin: fields.get("requireFaceOnLogin") === "1",
    faceVerificationEnabled: fields.get("faceVerificationEnabled") === "1",
    dutyHours: Number(fields.get("dutyHours") || 9),
    matchThreshold: Number(fields.get("matchThreshold") || 0.033),
    faceppEnabled: fields.get("faceppEnabled") === "1",
    faceppThreshold: Number(fields.get("faceppThreshold") || 80),
    ocrEnabled: fields.get("ocrEnabled") === "1",
  };
  const thirdParty =
    body.faceppEnabled || body.ocrEnabled ? " Enabling Face++ or OCR sends face or ID images to a third-party service." : "";
  const confirmed = await confirmAction({
    title: "Save verification settings?",
    message:
      (body.faceVerificationEnabled
        ? "Barangay officials will need a fresh face check before they can make changes. Their next check applies immediately."
        : "The face duty check will be turned off. Stored references are kept until the official removes their face data.") + thirdParty,
    confirmLabel: "Save settings",
  });
  if (!confirmed) return;
  const response = await fetch("/api/settings/verification", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The verification settings could not be saved.");
  setState({ verificationSettings: result.settings });
  toast("Verification settings saved.", "success");
}

export function assignIdStep(value) {
  idStep = value;
}
export function setIdStepCount(value) {
  idStepCount = value;
}
export function assignIdScanState(value) {
  idScanState = value;
}
export function assignIdFaceState(value) {
  idFaceState = value;
}
export function assignIdFaceFile(value) {
  idFaceFile = value;
}
