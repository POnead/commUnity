"use strict";

import { esc, dateLabel, data } from "../../core.mjs";
import { page, panel, userAvatar, stat, statsStrip } from "../shared.mjs";
import { ID_TYPE_LABELS } from "../../constants.mjs";

const ID_SIGNAL_TONES = { pass: "ok", warn: "review", fail: "fail", unknown: "muted" };
const ID_SIGNAL_SHORT_LABELS = { "ID type": "Type", "ID number": "No.", "Full name": "Name", "Birth date": "Date" };
const ID_SIGNAL_SHORT_REASONS = {
  idType: "Type differs",
  idNumber: "No. differs",
  idFullName: "Name differs",
  idBirthDate: "Date differs",
};

function readIdScan(item) {
  let scan = item.idScanChecks;
  if (typeof scan === "string") {
    try {
      scan = JSON.parse(scan);
    } catch {
      scan = {};
    }
  }
  return scan || {};
}

function shortSignal(signal) {
  if (signal.id === "duplicate") return "Duplicate no.";
  if (String(signal.id || "").startsWith("match_")) {
    const field = String(signal.id).slice("match_".length);
    return ID_SIGNAL_SHORT_REASONS[field] || "Details differ";
  }
  if (String(signal.id || "").startsWith("format_")) return "Format issue";
  const label = ID_SIGNAL_SHORT_LABELS[signal.label] || signal.label;
  if (signal.tone === "pass") return `${label} Pass`;
  if (signal.tone === "unknown") return `${label} Not read`;
  return `${label} Check`;
}

// Compact chips for the ID review dialog, with a short one-line reason for each
// failed check — no verbose OCR text and no hover tooltips.

function idCheckChips(item, withMismatch = false) {
  const scan = readIdScan(item);
  const signals = (Array.isArray(scan.signals) ? scan.signals : []).filter((signal) => signal.tone !== "unknown");
  if (!signals.length) return "";
  const chips = signals
    .map(
      (signal) =>
        `<span class="id-check-chip ${ID_SIGNAL_TONES[signal.tone] || "muted"}" title="${esc(signal.detail || shortSignal(signal))}">${esc(shortSignal(signal))}</span>`,
    )
    .join("");
  let mismatches = "";
  if (withMismatch) {
    const lines = signals
      .filter((signal) => signal.tone === "warn" || signal.tone === "fail")
      .map((signal) => {
        const text = shortSignal(signal);
        const short = text.length > 52 ? `${text.slice(0, 49)}…` : text;
        return `<span class="id-check-mismatch" title="${esc(signal.detail || text)}">${esc(short)}</span>`;
      });
    if (lines.length) mismatches = `<div class="id-check-mismatches">${lines.join("")}</div>`;
  }
  return `<div class="id-check-chips">${chips}</div>${mismatches}`;
}

export function idImageModalBody(item) {
  const id = encodeURIComponent(item.userId);
  const name = esc(item.name || "this resident");
  const facts = [
    ["Resident", item.name],
    ["Email", item.email],
    ["ID type", (item.idType && ID_TYPE_LABELS[item.idType]) || item.idType],
    ["ID number", item.idNumber],
    ["Name on ID", item.idFullName],
    ["Birth date", item.idBirthDate],
    ["Address", item.idAddress],
    ["Expires", item.idExpirationDate],
    ["Face check", item.idFaceStatus],
    ["Submitted", dateLabel(item.idSubmittedAt)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join("");
  return `<div class="id-image-layout">
    <div class="id-image-figures">
      <figure><img src="/api/verification/id/${id}/image" alt="Front of ${name}'s ID"><figcaption>Front of ID</figcaption></figure>
      ${item.hasIdBackImage ? `<figure><img src="/api/verification/id/${id}/image-back" alt="Back of ${name}'s ID"><figcaption>Back of ID</figcaption></figure>` : ""}
    </div>
    <dl class="id-image-details">${facts}</dl>
    ${idCheckChips(item, true)}
    <div class="form-actions id-image-actions">
      <button class="button danger" type="button" data-action="reject-id" data-id="${esc(item.userId)}">Reject ID</button>
      <button class="button" type="button" data-action="approve-id" data-id="${esc(item.userId)}" data-email="${esc(item.email)}">Approve ID</button>
    </div>
  </div>`;
}

export function verificationsPage() {
  const queue = (data.verificationQueue || []).slice();
  const rows = queue
    .map(
      (
        item,
      ) => `<div class="record-row filter-item verification-record" role="row" data-search="${esc(`${item.name} ${item.email} ${item.idNumber}`.toLowerCase())}">
        <div class="identity" role="cell">${userAvatar({ name: item.name, photoUrl: "" })}<span><strong class="record-primary">${esc(item.name)}</strong><span class="record-secondary">${esc(item.role === "official" ? "Official" : "Resident")} · ${esc(item.email)} · ${esc(item.area || "—")}</span></span></div>
        <div class="record-meta" role="cell" data-label="ID type">${esc((item.idType && ID_TYPE_LABELS[item.idType]) || item.idType || "—")}</div>
        <div class="record-meta" role="cell" data-label="ID number"><code>${esc(item.idNumber || "—")}</code>${item.idBirthDate ? `<br><span class="record-secondary">Born ${esc(item.idBirthDate)}</span>` : ""}</div>
        <div class="record-date" role="cell" data-label="Submitted">${esc(dateLabel(item.idSubmittedAt) || "—")}</div>
        <div class="record-actions" role="cell" data-label="Action"><div class="approval-actions"><button class="button secondary small" type="button" data-action="view-id-image" data-id="${esc(item.userId)}" data-email="${esc(item.email)}">View ID</button></div></div>
      </div>`,
    )
    .join("");
  const empty = `<div class="empty-state"><strong>Nothing to review</strong>Residents and officials who submit an ID will appear here.</div>`;
  const body = `<div class="content-stack">
    ${statsStrip([stat("Pending Reviews", queue.length, "Waiting for your decision", "blue", "clock")])}
    ${panel("ID reviews", `<div class="records verification-records" role="table" aria-label="ID reviews"><div class="record-row record-head" role="row"><span role="columnheader">User</span><span role="columnheader">ID type</span><span role="columnheader">ID number</span><span role="columnheader">Submitted</span><span role="columnheader">Action</span></div>${rows || empty}</div>`, { subtitle: "Review the image, check the number, then approve or reject. Self-reported until approved.", icon: "check" })}
  </div>`;
  return page("administrator", "verifications", body);
}
