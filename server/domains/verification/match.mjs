"use strict";

import { validISODate } from "../../platform/validate.mjs";

// Shortcut: ID fields are label-anchored regex guesses over OCR text, not a
// structured PH-ID parser. Residents confirm every field and an administrator
// still reviews the image, so a bad guess cannot become a verified identity.
// Upgrade path: the OCR provider's structured ID parser when it covers PH cards.
export function suggestIdFields(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blob = lines.join(" ");
  const upper = blob.toUpperCase();
  // Only the four ID types named in the project guidelines are supported.
  // UMID is checked before SSS so a UMID card that also prints SSS still reads
  // as UMID. The PhilSys card prints its full name, never the word "PHILSYS".
  const idType = /PHILSYS|PHILIPPINE IDENTIFICATION|PAMBANSANG PAGKAKAKILANLAN/.test(upper)
    ? "philsys"
    : /DRIVER/.test(upper)
      ? "driver"
      : /PASSPORT/.test(upper)
        ? "passport"
        : /UMID/.test(upper)
          ? "umid"
          : "";
  const numbers = blob.match(/[A-Z0-9][A-Z0-9-]{5,39}/g) || [];
  const idNumber = numbers.filter((value) => (value.match(/\d/g) || []).length >= 4).sort((a, b) => b.length - a.length)[0] || "";

  const MONTHS = {
    JANUARY: "01",
    FEBRUARY: "02",
    MARCH: "03",
    APRIL: "04",
    MAY: "05",
    JUNE: "06",
    JULY: "07",
    AUGUST: "08",
    SEPTEMBER: "09",
    OCTOBER: "10",
    NOVEMBER: "11",
    DECEMBER: "12",
    JAN: "01",
    FEB: "02",
    MAR: "03",
    APR: "04",
    JUN: "06",
    JUL: "07",
    AUG: "08",
    SEP: "09",
    SEPT: "09",
    OCT: "10",
    NOV: "11",
    DEC: "12",
  };
  const dateFrom = (value) => {
    const source = String(value || "").toUpperCase();
    const iso = source.match(/\b(19|20)\d{2}[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) return `${iso[0].slice(0, 4)}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    const dmy = source.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.]((?:19|20)\d{2})\b/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    // PhilSys prints dates as "OCTOBER 29, 2005", not as numbers.
    const named = source.match(
      /\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\.?\s+(\d{1,2})(?:ST|ND|RD|TH)?[,]?\s+((?:19|20)\d{2})\b/,
    );
    if (named) {
      const month = MONTHS[named[1].replace(".", "")];
      if (month) return `${named[3]}-${month}-${named[2].padStart(2, "0")}`;
    }
    return "";
  };
  const validDate = (value) => {
    if (!value || !validISODate(value)) return "";
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 1900) return "";
    return value;
  };
  const keywords =
    /PHILSYS|PHILIPPINE|PAMBANSANG|PAGKAKAKILANLAN|DRIVER|PASSPORT|UMID|SSS|PHILHEALTH|VOTER|POSTAL|REPUBLIKA|REPUBLIC|PILIPINAS|BIRTH|DATE|SEX|ADDRESS|TIRAHAN|NAME|PANGALAN|APELYIDO|ID/i;
  const isLabelLine = (line) => keywords.test(line) || /VALID|EXPIR|\bEXP\b|GITNANG|MIDDLE|PETA/i.test(line);

  // Read the value that follows a printed bilingual label, falling back to the
  // remainder of the label line itself when the OCR kept them together.
  const labelValue = (pattern) => {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index < 0) return "";
    const same = lines[index]
      .replace(pattern, " ")
      .replace(/^[:.\s/-]+/, "")
      .trim();
    if (same && !isLabelLine(same)) return same;
    const next = lines[index + 1] || "";
    return isLabelLine(next) ? "" : next;
  };
  const cleanName = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

  const given = labelValue(/MGA PANGALAN|GIVEN NAMES|FIRST NAME/i);
  const middle = labelValue(/GITNANG APELYIDO|MIDDLE NAME/i);
  const last = labelValue(/APELYIDO|LAST NAME|SURNAME/i);
  const nameFromLabels = [given, middle, last].filter(Boolean).join(" ");
  const idFullName =
    cleanName(nameFromLabels) ||
    cleanName(lines.find((line) => /^[A-Za-zÀ-ÿ'., -]{5,120}$/.test(line) && /\s/.test(line) && !keywords.test(line))) ||
    "";

  let idBirthDate =
    validDate(dateFrom(labelValue(/PETSA NG KAPANGANAKAN|DATE OF BIRTH|BIRTH DATE|BIRTHDATE/i))) || validDate(dateFrom(blob));
  if (idBirthDate && new Date(`${idBirthDate}T00:00:00Z`) > new Date()) idBirthDate = "";
  const expiryLabel = /VALID\s*(?:UNTIL|THRU|THROUGH)|EXPIR(?:Y|ES|ATION)|\bEXP\b/i;
  const expiryIndex = lines.findIndex((line) => expiryLabel.test(line));
  const idExpirationDate =
    expiryIndex >= 0 ? validDate(dateFrom(`${lines[expiryIndex].replace(expiryLabel, " ")} ${lines[expiryIndex + 1] || ""}`)) : "";
  // A lone expiry date must not be mistaken for a birth date.
  if (idBirthDate && idBirthDate === idExpirationDate) idBirthDate = "";

  const addressIndex = lines.findIndex((line) => /TIRAHAN|ADDRESS|ADDR|ADD\b/i.test(line));
  let idAddress = "";
  if (addressIndex >= 0) {
    const same = lines[addressIndex].replace(/^(?:TIRAHAN|ADDRESS|ADDR|ADD)\b[:.\s/-]*/i, "").trim();
    if (same && !isLabelLine(same)) idAddress = same;
    else {
      const parts = [];
      for (let i = addressIndex + 1; i < lines.length && parts.length < 2; i += 1) {
        if (isLabelLine(lines[i])) break;
        parts.push(lines[i]);
      }
      idAddress = parts.join(" ");
    }
  }
  if (!idAddress) {
    idAddress =
      lines.find((line) => /STREET|PUROK|BARANGAY|BRGY|BLVD|ROAD|\bRD\b|AVENUE|\bAVE\b|\bST\b/i.test(line) && !keywords.test(line)) || "";
  }
  idAddress = idAddress.replace(/\s+/g, " ").trim().slice(0, 160);
  return { idType, idNumber, idBirthDate, idFullName, idAddress, idExpirationDate };
}

// OCR reads the letters; this compares what it read with the account name and
// the fields already in the form. Name parts are ordered subsets so a missing
// middle name still passes, while a conflicting token fails.
export function idMatchCheck({ ocr = {}, accountName = "", entered = {} } = {}) {
  const tokens = (value) =>
    String(value || "")
      .toLowerCase()
      .match(/[a-z]{3,}/g) || [];
  const normalize = (value) =>
    String(value || "")
      .toUpperCase()
      .replace(/[\s.-]+/g, "");
  const subset = (short, long) => {
    const remaining = [...long];
    return short.every((token) => {
      const index = remaining.indexOf(token);
      if (index === -1) return false;
      remaining.splice(0, index + 1);
      return true;
    });
  };
  const nameAgrees = (a, b) => a.length > 0 && b.length > 0 && (subset(a, b) || subset(b, a));
  const readName = tokens(ocr.idFullName);
  const account = tokens(accountName);
  const typed = tokens(entered.idFullName);
  const nameOk = nameAgrees(readName, typed) || nameAgrees(readName, account);

  const number = normalize(ocr.idNumber);
  const typedNumber = normalize(entered.idNumber);
  const numberOk = Boolean(number) && (!typedNumber || number === typedNumber);
  const date = String(ocr.idBirthDate || "");
  const typedDate = String(entered.idBirthDate || "");
  const dateOk = Boolean(date) && (!typedDate || date === typedDate);
  const typeOk = !ocr.idType || !entered.idType || ocr.idType === entered.idType;

  const rows = [
    { field: "idFullName", ok: nameOk },
    { field: "idNumber", ok: numberOk },
    { field: "idBirthDate", ok: dateOk },
    { field: "idType", ok: typeOk },
  ];
  return { ok: rows.every((row) => row.ok), rows };
}

// Shortcut: these are sentences over the scan's own guesses and validation, not
// a structured ID parser or an authenticity check. Upgrade path: provider
// signals when a provider covers PH cards.
export function buildIdSignals({ suggestions = {}, match = null, assessment = {} } = {}) {
  const labels = {
    idType: "ID type",
    idNumber: "ID number",
    idFullName: "Full name",
    idBirthDate: "Birth date",
    idAddress: "Address",
    idExpirationDate: "Expiration date",
  };
  const signals = Object.entries(labels).map(([field, label]) => {
    const value = String(suggestions[field] || "").trim();
    return value
      ? { id: `read_${field}`, label, tone: "pass", detail: "Read from the ID." }
      : { id: `read_${field}`, label, tone: "unknown", detail: `Could not read the ${label.toLowerCase()} from the ID.` };
  });
  (assessment.errors || []).forEach((detail, index) => signals.push({ id: `format_${index}`, label: "Check", tone: "fail", detail }));
  (assessment.warnings || []).forEach((detail, index) => signals.push({ id: `warning_${index}`, label: "Check", tone: "warn", detail }));
  if (assessment.duplicate)
    signals.push({
      id: "duplicate",
      label: "Duplicate ID",
      tone: "fail",
      detail: "This ID number is already registered to another account.",
    });
  for (const row of match?.rows || []) {
    if (row.ok) continue;
    signals.push({
      id: `match_${row.field}`,
      label: "Details match",
      tone: "warn",
      detail: `The ${labels[row.field] || row.field} read from the ID differs from what you entered.`,
    });
  }
  return signals;
}
