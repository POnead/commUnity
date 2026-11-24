// Identity verification: a resident-submitted government ID that an
// administrator approves before it means anything, and a staff face duty
// check. The browser does the face ML; the server stores embeddings and does
// the math, exactly like the rest of this codebase's client-side ML split.
// Shortcut: the verification settings row in app_settings carries plain JSON, not
// an encrypted blob like SMTP — nothing in it is a secret. Upgrade path: encrypt
// it through crypto.mjs if it ever grows one.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { HttpError, requireJsonBody, readMultipart, sendImage, sendJson } from "../platform/http.mjs";
import { requireRole, requestClientAddress, hasPermission } from "../platform/session.mjs";
import { withTransaction } from "../platform/db.mjs";
import { recordAttempt } from "../platform/ratelimit.mjs";
import { hash } from "../platform/crypto.mjs";
import { ID_TYPE_LABELS } from "../../shared/domain-rules.mjs";
import { photoExtension } from "../platform/uploads.mjs";
import { cookieValue, SESSION_COOKIE } from "../platform/cookies.mjs";
import { validId, validISODate } from "../platform/validate.mjs";
import { insertActivity, logSecurityEvent } from "./activity.mjs";
import { insertNotification } from "./notifications.mjs";
import {
  MAX_FACE_REFERENCES,
  DEFAULT_MATCH_THRESHOLD,
  DUPLICATE_DISTANCE,
  parseEmbedding,
  cosineDistance,
  nearestDistance,
} from "../platform/face-match.mjs";

const ID_TYPES = new Map(Object.entries(ID_TYPE_LABELS));
const VERIFICATION_DIR = "verification";

// Duplicate detection compares this form, not the printed text: case, spaces
// and dashes are presentation details, while leading zeros are kept.
const canonicalIdNumber = (value) => String(value || "").toLowerCase().replace(/[\s-]+/g, "");

// A successful face check releases the restricted sign-in session.
async function clearPendingFaceCheck(request, db, userId) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  await db.query("UPDATE web_sessions SET face_check_pending=false WHERE token_hash=$1 AND user_id=$2", [hash(token), userId]);
}

// A locked official needs an administrator to enroll a new face reference.
// Without this guard, self-service re-enrollment could clear the lock in one session.
function assertFaceNotLocked(user) {
  if (user?.role === "official" && user.faceEnrollmentState === "locked")
    throw new HttpError(403, "Ask a barangay administrator to complete face enrollment.");
}

export function defaultVerificationSettings(faceppConfigured = false, ocrConfigured = false) {
  return {
    faceVerificationEnabled: Boolean(faceppConfigured),
    // Login gate is independent of the write-duty toggle so an old settings row
    // with faceVerificationEnabled=false still protects sign-in.
    requireFaceOnLogin: Boolean(faceppConfigured),
    dutyHours: 9,
    matchThreshold: DEFAULT_MATCH_THRESHOLD,
    // Use the configured provider by default; an admin can still turn it off.
    faceppEnabled: Boolean(faceppConfigured),
    faceppThreshold: 80,
    ocrEnabled: Boolean(ocrConfigured),
  };
}

// A corrupt or missing row must never crash the dispatcher's gate, so the
// stored settings are merged onto the defaults and re-bounds-checked.
export async function readVerificationSettings(db, faceppConfigured = false, ocrConfigured = false) {
  const defaults = defaultVerificationSettings(faceppConfigured, ocrConfigured);
  try {
    const result = await db.query("SELECT encrypted_value FROM app_settings WHERE key = 'verification'");
    const parsed = result.rows[0] ? JSON.parse(result.rows[0].encrypted_value) : {};
    const dutyHours = Number(parsed?.dutyHours);
    const matchThreshold = Number(parsed?.matchThreshold);
    const faceppThreshold = Number(parsed?.faceppThreshold);
    return {
      faceVerificationEnabled: parsed?.faceVerificationEnabled === undefined ? defaults.faceVerificationEnabled : parsed.faceVerificationEnabled === true,
      requireFaceOnLogin: parsed?.requireFaceOnLogin === undefined ? defaults.requireFaceOnLogin : parsed.requireFaceOnLogin === true,
      dutyHours: Number.isInteger(dutyHours) && dutyHours >= 1 && dutyHours <= 12 ? dutyHours : defaults.dutyHours,
      matchThreshold:
        Number.isFinite(matchThreshold) && matchThreshold >= 0.02 && matchThreshold <= 0.2 ? matchThreshold : defaults.matchThreshold,
      faceppEnabled: parsed?.faceppEnabled === undefined ? defaults.faceppEnabled : parsed.faceppEnabled === true,
      faceppThreshold:
        Number.isFinite(faceppThreshold) && faceppThreshold >= 50 && faceppThreshold <= 99 ? faceppThreshold : defaults.faceppThreshold,
      ocrEnabled: parsed?.ocrEnabled === undefined ? defaults.ocrEnabled : parsed.ocrEnabled === true,
    };
  } catch {
    return defaults;
  }
}

const nameTokens = (value) =>
  new Set(
    String(value || "")
      .toLowerCase()
      .match(/[a-z]{3,}/g) || [],
  );

// Face++ needs pixels, unlike the on-device 128-float descriptor. The browser
// sends a JPEG or PNG data URL; size and file signature are checked before it
// leaves. The detected format decides the MIME type sent to the provider.
function faceImageFrom(value) {
  if (typeof value !== "string") return null;
  const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return null;
  const extension = photoExtension(buffer);
  if (!extension) return null;
  return { data: buffer, mime: extension === ".png" ? "image/png" : "image/jpeg" };
}

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
    JANUARY: "01", FEBRUARY: "02", MARCH: "03", APRIL: "04", MAY: "05", JUNE: "06",
    JULY: "07", AUGUST: "08", SEPTEMBER: "09", OCTOBER: "10", NOVEMBER: "11", DECEMBER: "12",
    JAN: "01", FEB: "02", MAR: "03", APR: "04", JUN: "06", JUL: "07", AUG: "08", SEP: "09", SEPT: "09", OCT: "10", NOV: "11", DEC: "12",
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
    const same = lines[index].replace(pattern, " ").replace(/^[:.\s/-]+/, "").trim();
    if (same && !isLabelLine(same)) return same;
    const next = lines[index + 1] || "";
    return isLabelLine(next) ? "" : next;
  };
  const cleanName = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);

  const given = labelValue(/MGA PANGALAN|GIVEN NAMES|FIRST NAME/i);
  const middle = labelValue(/GITNANG APELYIDO|MIDDLE NAME/i);
  const last = labelValue(/APELYIDO|LAST NAME|SURNAME/i);
  const nameFromLabels = [given, middle, last].filter(Boolean).join(" ");
  const idFullName =
    cleanName(nameFromLabels) ||
    cleanName(lines.find((line) => /^[A-Za-zÀ-ÿ'., -]{5,120}$/.test(line) && /\s/.test(line) && !keywords.test(line))) ||
    "";

  let idBirthDate =
    validDate(dateFrom(labelValue(/PETSA NG KAPANGANAKAN|DATE OF BIRTH|BIRTH DATE|BIRTHDATE/i))) ||
    validDate(dateFrom(blob));
  if (idBirthDate && new Date(`${idBirthDate}T00:00:00Z`) > new Date()) idBirthDate = "";
  const expiryLabel = /VALID\s*(?:UNTIL|THRU|THROUGH)|EXPIR(?:Y|ES|ATION)|\bEXP\b/i;
  const expiryIndex = lines.findIndex((line) => expiryLabel.test(line));
  const idExpirationDate =
    expiryIndex >= 0
      ? validDate(dateFrom(`${lines[expiryIndex].replace(expiryLabel, " ")} ${lines[expiryIndex + 1] || ""}`))
      : "";
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
  const normalize = (value) => String(value || "").toUpperCase().replace(/[\s.-]+/g, "");
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

// Field validation + duplicate detection shared by the debounced check and the
// real submit. Never rewrites what the resident typed.
async function assessId(db, user, fields) {
  const errors = [];
  const warnings = [];
  const idType = String(fields.idType || "").trim();
  const idNumber = String(fields.idNumber || "").trim();
  const idFullName = String(fields.idFullName || "").trim();
  const idBirthDate = String(fields.idBirthDate || "").trim();
  const idAddress = String(fields.idAddress || "").trim();
  const idExpirationDate = String(fields.idExpirationDate || "").trim();
  if (!ID_TYPES.has(idType)) errors.push("Choose an ID type.");
  if (idAddress.length > 160) errors.push("The address must be 160 characters or fewer.");
  if (idExpirationDate && !validISODate(idExpirationDate)) errors.push("Enter a valid expiration date.");
  if (!/^[A-Za-z0-9][A-Za-z0-9- ]{3,39}$/.test(idNumber))
    errors.push("Enter the ID number exactly as printed (4–40 letters, digits, spaces or dashes).");
  if (idFullName.length < 2 || idFullName.length > 120) errors.push("Enter the full name as printed on the ID (2–120 characters).");
  const parsedDate = validISODate(idBirthDate) ? new Date(`${idBirthDate}T00:00:00Z`) : null;
  if (!parsedDate) errors.push("Enter a valid birth date.");
  else if (parsedDate > new Date()) errors.push("The birth date cannot be in the future.");
  else if (parsedDate.getUTCFullYear() < 1900) errors.push("Enter a plausible birth year.");
  const accountTokens = nameTokens(user?.name);
  const idTokens = nameTokens(idFullName);
  if (accountTokens.size && idTokens.size) {
    const shared = [...idTokens].some((token) => accountTokens.has(token));
    if (!shared) warnings.push("The name on the ID does not match the account name. Staff will check this during review.");
  }
  let duplicate = false;
  if (idNumber) {
    const found = await db.query(
      "SELECT 1 FROM users WHERE id_type=$1 AND id_number_canonical=$2 AND id_status IN ('pending','verified') AND id<>$3 LIMIT 1",
      [idType, canonicalIdNumber(idNumber), user.id],
    );
    duplicate = found.rows.length > 0;
  }
  return { errors, warnings, duplicate, idType, idNumber, idFullName, idBirthDate, idAddress, idExpirationDate };
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

async function removeIdFiles(uploadsDir, userId, ...filenames) {
  for (const filename of filenames) {
    const name = path.basename(String(filename || ""));
    if (!name) continue;
    await unlink(path.join(uploadsDir, VERIFICATION_DIR, userId, name)).catch(() => {});
  }
}

async function bumpRevision(transaction) {
  await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
}

export async function handleVerification(request, response, db, options, user) {
  const { uploadsDir, trustedProxyAddresses, ocrClient, faceppClient } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  // Only these four fields gate a submit; persist their presence, not their values.
  const requiredScanFields = ["idType", "idNumber", "idFullName", "idBirthDate"];

  // ---------- settings (administrators) ----------
  if (url.pathname === "/api/settings/verification" && request.method === "GET") {
    requireRole(user, ["administrator"]);
    sendJson(response, 200, { settings: await readVerificationSettings(db, faceppClient?.configured, ocrClient?.configured) });
    return true;
  }
  if (url.pathname === "/api/settings/verification" && request.method === "PUT") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const body = request.body || {};
    const dutyHours = Number(body.dutyHours);
    const matchThreshold = Number(body.matchThreshold);
    const faceppThreshold =
      body.faceppThreshold === undefined ? defaultVerificationSettings().faceppThreshold : Number(body.faceppThreshold);
    const faceppEnabled = body.faceppEnabled === true;
    const ocrEnabled = body.ocrEnabled === true;
    if (!Number.isInteger(dutyHours) || dutyHours < 1 || dutyHours > 12)
      throw new HttpError(400, "Duty hours must be a whole number between 1 and 12.");
    if (!Number.isFinite(matchThreshold) || matchThreshold < 0.02 || matchThreshold > 0.2) {
      throw new HttpError(400, "The match threshold must be between 0.02 and 0.2.");
    }
    if (!Number.isFinite(faceppThreshold) || faceppThreshold < 50 || faceppThreshold > 99) {
      throw new HttpError(400, "The Face++ confidence threshold must be between 50 and 99.");
    }
    if (faceppEnabled && !faceppClient?.configured) throw new HttpError(400, "Face++ keys are not configured on this server.");
    if (ocrEnabled && !ocrClient?.configured) throw new HttpError(400, "An OCR API key is not configured on this server.");
    const settings = {
      faceVerificationEnabled: body.faceVerificationEnabled === true,
      requireFaceOnLogin: body.requireFaceOnLogin === true,
      dutyHours,
      matchThreshold,
      faceppEnabled,
      faceppThreshold,
      ocrEnabled,
    };
    await withTransaction(db, async (transaction) => {
      await transaction.query(
        "INSERT INTO app_settings(key, encrypted_value, updated_at) VALUES('verification',$1,now()) ON CONFLICT(key) DO UPDATE SET encrypted_value=excluded.encrypted_value, updated_at=now()",
        [JSON.stringify(settings)],
      );
      await insertActivity(
        transaction,
        user,
        "Updated verification settings",
        `Face duty check ${settings.faceVerificationEnabled ? "enabled" : "disabled"}; Face++ ${settings.faceppEnabled ? "on" : "off"}; OCR ${settings.ocrEnabled ? "on" : "off"}`,
      );
      await bumpRevision(transaction);
    });
    sendJson(response, 200, { settings });
    return true;
  }

  // ---------- staff: face duty check ----------
  if (url.pathname === "/api/verification/status" && request.method === "GET") {
    requireRole(user, ["official", "administrator"]);
    const [row, settings] = await Promise.all([
      db.query(
        `SELECT id_status AS "idStatus",
           (CASE WHEN jsonb_typeof(face_references) = 'array' THEN jsonb_array_length(face_references) ELSE 0 END) AS "referenceCount",
           (CASE WHEN jsonb_typeof(facepp_tokens) = 'array' THEN jsonb_array_length(facepp_tokens) ELSE 0 END) AS "faceppTokenCount",
           face_liveness_verified AS "livenessVerified", last_face_verified_at AS "lastFaceVerifiedAt"
         FROM users WHERE id=$1`,
        [user.id],
      ),
      readVerificationSettings(db, faceppClient?.configured),
    ]);
    const info = row.rows[0] || {};
    const referenceCount = Number(info.referenceCount || 0) + Number(info.faceppTokenCount || 0);
    const last = info.lastFaceVerifiedAt ? new Date(info.lastFaceVerifiedAt) : null;
    const until = last ? last.getTime() + settings.dutyHours * 3600 * 1000 : 0;
    sendJson(response, 200, {
      faceEnrolled: referenceCount > 0,
      referenceCount,
      livenessVerified: Boolean(info.livenessVerified),
      lastFaceVerifiedAt: info.lastFaceVerifiedAt || null,
      dutyHours: settings.dutyHours,
      faceVerificationEnabled: settings.faceVerificationEnabled,
      requireFaceOnLogin: settings.requireFaceOnLogin,
      faceppEnabled: settings.faceppEnabled,
      dutyVerified: !settings.faceVerificationEnabled || Date.now() < until,
    });
    return true;
  }

  if (url.pathname === "/api/verification/face/enroll" && request.method === "POST") {
    requireRole(user, ["official", "administrator"]);
    assertFaceNotLocked(user);
    await recordAttempt(db, hash(`face-enroll:${user.id}`), 10);
    requireJsonBody(request);
    const body = request.body || {};
    // A client cannot attest to liveness; the submitted photo is the only sample.
    const liveness = false;
    const settings = await readVerificationSettings(db, faceppClient?.configured);
    if (settings.faceppEnabled) {
      const image = faceImageFrom(body.image);
      if (!image) throw new HttpError(400, "A face photo is required for Face++ enrollment.");
      const token = await faceppClient.detectFace(image.data, image.mime);
      let tokenCount = 0;
      await withTransaction(db, async (transaction) => {
        const locked = await transaction.query("SELECT facepp_tokens FROM users WHERE id=$1 FOR UPDATE", [user.id]);
        const tokens = Array.isArray(locked.rows[0]?.facepp_tokens) ? [...locked.rows[0].facepp_tokens] : [];
        let bestIndex = -1;
        let best = -1;
        let compared = 0;
        let lastError;
        for (let index = 0; index < tokens.length; index += 1) {
          let score;
          try {
            score = await faceppClient.compareFaces(token, tokens[index]);
          } catch (error) {
            lastError = error;
            continue;
          }
          compared += 1;
          if (score > best) {
            best = score;
            bestIndex = index;
          }
        }
        // Tolerating expired tokens is fine, but if every comparison failed the provider error must reach the caller.
        if (compared === 0 && tokens.length && lastError) throw lastError;
        if (tokens.length && best < settings.faceppThreshold) {
          await logSecurityEvent(
            transaction,
            user.name,
            user.role,
            "Face enrollment mismatch",
            "A new face did not match the account's enrolled Face++ tokens.",
            "Failed",
            { affectedId: user.id },
          );
          throw new HttpError(409, "This does not match your enrolled face. Ask an administrator to reset your face reference.", "FACE_MISMATCH");
        }
        if (bestIndex >= 0 && best >= settings.faceppThreshold) tokens.splice(bestIndex, 1);
        while (tokens.length >= MAX_FACE_REFERENCES) tokens.shift();
        tokens.push(token);
        await transaction.query(
          "UPDATE users SET facepp_tokens=$1::jsonb, face_enrolled_at=now(), last_face_verified_at=now(), face_liveness_verified=$2, face_enrollment_state='enrolled' WHERE id=$3",
          [JSON.stringify(tokens), liveness, user.id],
        );
        await insertActivity(
          transaction,
          user,
          "Enrolled face reference",
          `Face++ reference ${tokens.length}/${MAX_FACE_REFERENCES}${liveness ? " with live check" : " (photo, liveness not checked)"}`,
          { affectedId: user.id },
        );
        await bumpRevision(transaction);
        tokenCount = tokens.length;
      });
      await clearPendingFaceCheck(request, db, user.id);
      sendJson(response, 201, { faceEnrolled: true, referenceCount: tokenCount });
      return true;
    }
    const embedding = parseEmbedding(body.embedding);
    if (!embedding) throw new HttpError(400, "A complete face sample is required to enroll.");
    let referenceCount = 0;
    await withTransaction(db, async (transaction) => {
      const locked = await transaction.query("SELECT face_references FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const references = Array.isArray(locked.rows[0]?.face_references) ? [...locked.rows[0].face_references] : [];
      const nearest = nearestDistance(embedding, references);
      if (references.length && nearest !== null && nearest > DUPLICATE_DISTANCE) {
        await logSecurityEvent(
          transaction,
          user.name,
          user.role,
          "Face enrollment mismatch",
          "A new face reference did not match the account's enrolled references.",
          "Failed",
          { affectedId: user.id },
        );
        throw new HttpError(409, "This does not match your enrolled face. Ask an administrator to reset your face reference.", "FACE_MISMATCH");
      }
      // A near-identical reference is the same face re-enrolled: replace it instead of piling up duplicates.
      if (nearest !== null && nearest < DUPLICATE_DISTANCE) {
        let bestIndex = 0;
        let bestDistance = Infinity;
        references.forEach((reference, index) => {
          const distance = cosineDistance(embedding, reference.embedding);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        });
        references.splice(bestIndex, 1);
      }
      while (references.length >= MAX_FACE_REFERENCES) references.shift();
      references.push({ embedding: [...embedding], liveness, enrolledAt: new Date().toISOString() });
      await transaction.query(
        "UPDATE users SET face_references=$1::jsonb, face_enrolled_at=now(), last_face_verified_at=now(), face_liveness_verified=$2, face_enrollment_state='enrolled' WHERE id=$3",
        [JSON.stringify(references), liveness, user.id],
      );
      await insertActivity(
        transaction,
        user,
        "Enrolled face reference",
        `Reference ${references.length}/${MAX_FACE_REFERENCES}${liveness ? " with live check" : " (photo, liveness not checked)"}`,
        { affectedId: user.id },
      );
      await bumpRevision(transaction);
      referenceCount = references.length;
    });
    await clearPendingFaceCheck(request, db, user.id);
    sendJson(response, 201, { faceEnrolled: true, referenceCount });
    return true;
  }

  if (url.pathname === "/api/verification/face/verify" && request.method === "POST") {
    requireRole(user, ["official", "administrator"]);
    assertFaceNotLocked(user);
    await recordAttempt(db, hash(`face-verify:${user.id}`), 10);
    requireJsonBody(request);
    const clientAddress = requestClientAddress(request, trustedProxyAddresses);
    const [row, settings] = await Promise.all([
      db.query("SELECT face_references, facepp_tokens FROM users WHERE id=$1", [user.id]),
      readVerificationSettings(db, faceppClient?.configured),
    ]);
    let verified;
    if (settings.faceppEnabled) {
      const tokens = Array.isArray(row.rows[0]?.facepp_tokens) ? row.rows[0].facepp_tokens : [];
      if (!tokens.length) throw new HttpError(400, "Enroll your face from the face check page first.");
      const image = faceImageFrom(request.body?.image);
      if (!image) throw new HttpError(400, "A face photo is required.");
      const token = await faceppClient.detectFace(image.data, image.mime);
      let confidence = 0;
      let compared = 0;
      let lastError;
      for (const reference of tokens) {
        try {
          confidence = Math.max(confidence, await faceppClient.compareFaces(token, reference));
          compared += 1;
        } catch (error) {
          lastError = error;
          continue;
        }
      }
      if (compared === 0 && tokens.length && lastError) throw lastError;
      verified = confidence >= settings.faceppThreshold;
    } else {
      const embedding = parseEmbedding(request.body?.embedding);
      if (!embedding) throw new HttpError(400, "A complete face sample is required.");
      const references = Array.isArray(row.rows[0]?.face_references) ? row.rows[0].face_references : [];
      const nearest = nearestDistance(embedding, references);
      if (nearest === null) throw new HttpError(400, "Enroll your face from the face check page first.");
      verified = nearest <= settings.matchThreshold;
    }
    if (!verified) {
      await logSecurityEvent(
        db,
        user.name,
        user.role,
        "Failed face verification",
        "The sample did not match any enrolled reference.",
        "Failed",
        { clientIp: clientAddress },
      );
      throw new HttpError(401, "The face does not match this account. Ask an administrator for help if this persists.");
    }
    await db.query("UPDATE users SET last_face_verified_at=now() WHERE id=$1", [user.id]);
    await db.query("DELETE FROM auth_attempts WHERE attempt_key=$1", [hash(`face-verify:${user.id}`)]);
    await insertActivity(db, user, "Passed face verification", "Face duty check", { clientIp: clientAddress });
    await clearPendingFaceCheck(request, db, user.id);
    sendJson(response, 200, { verified: true, verifiedUntil: new Date(Date.now() + settings.dutyHours * 3600 * 1000).toISOString() });
    return true;
  }

  if (url.pathname === "/api/verification/face" && request.method === "DELETE") {
    requireRole(user, ["official", "administrator"]);
    const hasJson = request.headers["content-type"]?.toLowerCase().startsWith("application/json");
    if (hasJson) requireJsonBody(request);
    const body = hasJson ? request.body || {} : {};
    const requestedId = String(body.userId || "").trim();
    const targetId = requestedId || user?.id;
    const auditReason = String(body.reason || "").trim();
    if (requestedId) {
      if (!validId(requestedId)) throw new HttpError(400, "A valid account identifier is required.");
      if (auditReason.length < 5 || auditReason.length > 500)
        throw new HttpError(400, "Give the removal a reason of at least 5 characters.");
    }
    const targetIsSelf = targetId === user?.id;
    if (!targetIsSelf) {
      requireRole(user, ["administrator"]);
      if (!(await hasPermission(db, user, "manageUsers")))
        throw new HttpError(403, "Account management is not enabled for this role.");
    }
    const target = await db.query("SELECT name, role FROM users WHERE id=$1", [targetId]);
    if (!target.rows[0]) throw new HttpError(404, "That account does not exist.");
    await withTransaction(db, async (transaction) => {
      await transaction.query(
        "UPDATE users SET face_references='[]'::jsonb, facepp_tokens='[]'::jsonb, face_enrolled_at=NULL, face_liveness_verified=false, face_enrollment_state='locked', last_face_verified_at=NULL, id_face_status='', id_face_distance=NULL, id_face_checked_at=NULL WHERE id=$1",
        [targetId],
      );
      await insertActivity(
        transaction,
        user,
        "Removed face verification",
        targetIsSelf ? "Removed own face reference." : `Removed face reference for ${target.rows[0].name}. Reason: ${auditReason}`,
        { affectedId: targetId },
      );
      await bumpRevision(transaction);
    });
    sendJson(response, 200, { ok: true });
    return true;
  }

  // ---------- residents (ID only) and officials (ID + face) ----------
  if (url.pathname === "/api/verification/id" && request.method === "GET") {
    requireRole(user, ["resident", "official"]);
    const row = await db.query(
      `SELECT id_status AS "idStatus", id_type AS "idType", id_number AS "idNumber", id_full_name AS "idFullName",
         to_char(id_birth_date, 'YYYY-MM-DD') AS "idBirthDate", id_address AS "idAddress",
         to_char(id_expiration_date, 'YYYY-MM-DD') AS "idExpirationDate", id_face_status AS "idFaceStatus",
         id_review_note AS "idReviewNote",
         to_char(id_submitted_at, 'YYYY-MM-DD') AS "idSubmittedAt", to_char(id_reviewed_at, 'YYYY-MM-DD') AS "idReviewedAt"
       FROM users WHERE id=$1`,
      [user.id],
    );
    sendJson(response, 200, { verification: row.rows[0] || null });
    return true;
  }

  if (url.pathname === "/api/verification/id/ocr" && request.method === "POST") {
    requireRole(user, ["resident", "official"]);
    await recordAttempt(db, hash(`id-ocr:${user.id}`), 30);
    if (!(await readVerificationSettings(db, faceppClient?.configured, ocrClient?.configured)).ocrEnabled)
      throw new HttpError(403, "ID scanning is not enabled.");
    const { files, fields } = await readMultipart(request, { maxFiles: 1, withFields: true });
    if (!files.length) throw new HttpError(400, "Attach a photo of the front of your ID.");
    const image = files[0].data;
    const extension = photoExtension(image);
    if (!extension) throw new HttpError(400, "The ID image must be a JPEG or PNG photo.");
    const text = await ocrClient.readIdText(image, extension === ".png" ? "image/png" : "image/jpeg");
    const suggestions = suggestIdFields(text);
    const match = idMatchCheck({ ocr: suggestions, accountName: user.name, entered: fields || {} });
    // Same validation the submit uses, so the scan result cannot be more
    // optimistic than what the administrator will actually review.
    const assessment = await assessId(db, user, suggestions);
    const signals = buildIdSignals({ suggestions, match, assessment });
    const fieldsFound = requiredScanFields.filter((key) => String(suggestions[key] || "").trim());
    await db.query("UPDATE users SET id_scan_checks=$1::jsonb WHERE id=$2", [
      JSON.stringify({ signals, readable: Boolean(text.trim()), fieldsFound }),
      user.id,
    ]);
    sendJson(response, 200, {
      suggestions,
      match,
      signals,
      checks: {
        readable: Boolean(text.trim()),
        errors: assessment.errors,
        warnings: assessment.warnings,
        duplicate: assessment.duplicate,
      },
    });
    return true;
  }

  if (url.pathname === "/api/verification/id/face-check" && request.method === "POST") {
    // The integrated face match belongs to officials. Residents only do ID
    // verification, so they never reach this route.
    assertFaceNotLocked(user);
    requireRole(user, ["official"]);
    await recordAttempt(db, hash(`id-face:${user.id}`), 10);
    const settings = await readVerificationSettings(db, faceppClient?.configured);
    if (!settings.faceppEnabled || !faceppClient?.configured) {
      sendJson(response, 200, { status: "unavailable", matched: false, reason: "Face matching is not enabled on this server." });
      return true;
    }
    const files = await readMultipart(request, { maxFiles: 2 });
    if (files.length < 2) throw new HttpError(400, "Attach the ID photo and the captured face image.");
    const idPhoto = files[0].data;
    const facePhoto = files[1].data;
    const idExtension = photoExtension(idPhoto);
    const faceExtension = photoExtension(facePhoto);
    if (!idExtension || !faceExtension) throw new HttpError(400, "Both images must be JPEG or PNG photos.");
    const idMime = idExtension === ".png" ? "image/png" : "image/jpeg";
    const faceMime = faceExtension === ".png" ? "image/png" : "image/jpeg";
    let confidence = 0;
    let faceToken = "";
    try {
      confidence = await faceppClient.compareImages(idPhoto, facePhoto, idMime, faceMime);
      faceToken = await faceppClient.detectFace(facePhoto, faceMime);
    } catch (error) {
      // A missing face is a retryable "unclear", not a failed identity check.
      const unclear =
        error instanceof HttpError &&
        (error.status === 400 || /no face|face not found|could not detect|invalid image/i.test(error.message));
      if (unclear) {
        await db.query("UPDATE users SET id_face_status='unclear', id_face_checked_at=now() WHERE id=$1", [user.id]);
        sendJson(response, 200, { status: "unclear", matched: false, reason: error.message });
        return true;
      }
      throw error;
    }
    const matched = confidence >= settings.faceppThreshold;
    const status = matched ? "matched" : "mismatch";
    let tokenMismatch = false;
    await withTransaction(db, async (transaction) => {
      if (matched) {
        // A passing live capture also becomes the duty-check reference so the
        // integrated flow and the login/duty gate agree on one face. Before
        // replacing that reference, the new face must match the old one.
        const locked = await transaction.query("SELECT facepp_tokens FROM users WHERE id=$1 FOR UPDATE", [user.id]);
        const tokens = Array.isArray(locked.rows[0]?.facepp_tokens) ? [...locked.rows[0].facepp_tokens] : [];
        if (tokens.length) {
          let best = -1;
          let compared = 0;
          let lastError;
          for (const token of tokens) {
            let score;
            try {
              score = await faceppClient.compareFaces(faceToken, token);
            } catch (error) {
              lastError = error;
              continue;
            }
            compared += 1;
            if (score > best) best = score;
          }
          // Same provider-error rule as /face/verify: tolerate expired tokens,
          // but never treat a total provider failure as a mismatch.
          if (compared === 0 && lastError) throw lastError;
          if (best < settings.faceppThreshold) {
            await logSecurityEvent(
              transaction,
              user.name,
              user.role,
              "Integrated face enrollment mismatch",
              "A passing ID face match did not match the official's enrolled Face++ tokens.",
              "Failed",
              { affectedId: user.id },
            );
            // A stale "matched" from an earlier pass must not survive a failed re-enrollment.
            await transaction.query("UPDATE users SET id_face_status='mismatch', id_face_checked_at=NULL WHERE id=$1", [user.id]);
            tokenMismatch = true;
            return;
          }
        }
        const existing = tokens.indexOf(faceToken);
        if (existing >= 0) tokens.splice(existing, 1);
        tokens.push(faceToken);
        while (tokens.length >= MAX_FACE_REFERENCES) tokens.shift();
        await transaction.query(
          `UPDATE users SET facepp_tokens=$1::jsonb, face_enrolled_at=now(), face_liveness_verified=false,
             face_enrollment_state='enrolled', last_face_verified_at=now() WHERE id=$2`,
          [JSON.stringify(tokens), user.id],
        );
      }
      await transaction.query(
        "UPDATE users SET id_face_status=$1, id_face_distance=$2, id_face_checked_at=now() WHERE id=$3",
        [status, confidence, user.id],
      );
      await insertActivity(
        transaction,
        user,
        "Integrated face match",
        `${status} (confidence ${Math.round(confidence)})`,
        { affectedId: user.id },
      );
      await bumpRevision(transaction);
    });
    if (tokenMismatch) {
      throw new HttpError(401, "This does not match your enrolled face. Ask an administrator for help.", "FACE_MISMATCH");
    }
    if (matched) {
      await clearPendingFaceCheck(request, db, user.id);
      await db.query("DELETE FROM auth_attempts WHERE attempt_key=$1", [hash(`id-face:${user.id}`)]);
    }
    sendJson(response, 200, { status, matched, confidence, basis: "face" });
    return true;
  }

  if (url.pathname === "/api/verification/id/validate" && request.method === "POST") {
    requireRole(user, ["resident", "official"]);
    await recordAttempt(db, hash(`id-validate:${user.id}`), 60);
    requireJsonBody(request);
    const assessment = await assessId(db, user, request.body || {});
    sendJson(response, 200, { errors: assessment.errors, warnings: assessment.warnings, duplicate: assessment.duplicate });
    return true;
  }

  if (url.pathname === "/api/verification/id" && request.method === "POST") {
    requireRole(user, ["resident", "official"]);
    await recordAttempt(db, hash(`id-verify:${user.id}`), 10);
    const { files, fields } = await readMultipart(request, { maxFiles: 2, withFields: true });
    if (!files.length) throw new HttpError(400, "Attach a photo of the front of your ID.");
    if (String(fields?.consent || "") !== "1") throw new HttpError(400, "Consent to store your ID is required before you can submit it.");
    const assessment = await assessId(db, user, fields || {});
    if (assessment.errors.length) throw new HttpError(400, assessment.errors[0]);
    if (assessment.duplicate) throw new HttpError(409, "That ID number is already registered.");
    // The personal-information step is only reachable after a readable scan
    // (and, for officials, a passing face match). Enforce the same gate here.
    const scanRow = await db.query("SELECT id_scan_checks FROM users WHERE id=$1", [user.id]);
    const scan = scanRow.rows[0]?.id_scan_checks || {};
    const fieldsFound = Array.isArray(scan.fieldsFound) ? scan.fieldsFound : [];
    const scanned = scan.readable !== false && requiredScanFields.every((key) => fieldsFound.includes(key));
    if (!scanned) throw new HttpError(400, "Scan your ID and confirm the details before submitting.");
    if (user.role === "official") {
      const settings = await readVerificationSettings(db, faceppClient?.configured);
      if (settings.faceppEnabled && faceppClient?.configured) {
        const faceRow = await db.query("SELECT id_face_status, id_face_checked_at FROM users WHERE id=$1", [user.id]);
        const face = faceRow.rows[0] || {};
        const fresh = face.id_face_checked_at ? Date.now() - new Date(face.id_face_checked_at).getTime() <= 15 * 60 * 1000 : false;
        if (face.id_face_status !== "matched" || !fresh) throw new HttpError(400, "Complete the face match before submitting.");
      }
    }
    const stored = [];
    for (const file of files.slice(0, 2)) {
      const extension = photoExtension(file.data);
      if (!extension) throw new HttpError(400, "The ID image must be a JPEG or PNG photo.");
      stored.push({ extension, data: file.data, side: stored.length === 0 ? "front" : "back" });
    }
    if (!stored.some((item) => item.side === "front")) throw new HttpError(400, "Attach a photo of the front of your ID.");
    const directory = path.join(uploadsDir, VERIFICATION_DIR, user.id);
    await mkdir(directory, { recursive: true });
    const frontName = `${randomUUID()}${stored[0].extension}`;
    const backName = stored[1] ? `${randomUUID()}${stored[1].extension}` : "";
    try {
      await writeFile(path.join(directory, frontName), stored[0].data, { flag: "wx" });
      if (backName) await writeFile(path.join(directory, backName), stored[1].data, { flag: "wx" });
    } catch (error) {
      await removeIdFiles(uploadsDir, user.id, frontName, backName);
      throw error;
    }
    let oldFront = "";
    let oldBack = "";
    try {
      await withTransaction(db, async (transaction) => {
        const current = await transaction.query("SELECT id_image_filename, id_back_image_filename FROM users WHERE id=$1", [user.id]);
        oldFront = current.rows[0]?.id_image_filename || "";
        oldBack = current.rows[0]?.id_back_image_filename || "";
        await transaction.query(
          `UPDATE users SET id_image_filename=$1, id_back_image_filename=$2, id_type=$3, id_number=$4, id_number_canonical=$5,
             id_full_name=$6, id_birth_date=$7::date, id_address=$8, id_expiration_date=$9::date,
             id_status='pending', id_review_note='', id_reviewed_at=NULL, id_reviewed_by='',
             id_consent_at=now(), id_submitted_at=now() WHERE id=$10`,
          [
            frontName,
            backName,
            assessment.idType,
            assessment.idNumber,
            canonicalIdNumber(assessment.idNumber),
            assessment.idFullName,
            assessment.idBirthDate,
            assessment.idAddress,
            assessment.idExpirationDate || null,
            user.id,
          ],
        );
        await insertActivity(
          transaction,
          user,
          "Submitted ID verification",
          `${ID_TYPES.get(assessment.idType) || assessment.idType} · awaiting review`,
          { affectedId: user.id },
        );
        await bumpRevision(transaction);
      });
    } catch (error) {
      await removeIdFiles(uploadsDir, user.id, frontName, backName);
      if (error?.code === "23505") throw new HttpError(409, "That ID number is already registered.");
      throw error;
    }
    await removeIdFiles(uploadsDir, user.id, oldFront, oldBack);
    await insertNotification(
      db,
      user.email,
      "ID submitted for review",
      "Your ID was submitted. An administrator will review it and you will be notified here of the decision.",
    );
    sendJson(response, 201, { idStatus: "pending" });
    return true;
  }

  if (url.pathname === "/api/verification/id" && request.method === "DELETE") {
    requireRole(user, ["resident", "official", "administrator"]);
    const hasJson = request.headers["content-type"]?.toLowerCase().startsWith("application/json");
    if (hasJson) requireJsonBody(request);
    const body = hasJson ? request.body || {} : {};
    const requestedId = String(body.userId || "").trim();
    const targetId = requestedId || user?.id;
    const auditReason = String(body.reason || "").trim();
    if (requestedId) {
      if (!validId(requestedId)) throw new HttpError(400, "A valid account identifier is required.");
      if (auditReason.length < 5 || auditReason.length > 500)
        throw new HttpError(400, "Give the removal a reason of at least 5 characters.");
    }
    if (targetId !== user?.id) {
      requireRole(user, ["administrator"]);
      if (!(await hasPermission(db, user, "manageUsers"))) throw new HttpError(403, "Account management is not enabled for this role.");
    }
    const row = await db.query("SELECT name, email, id_image_filename, id_back_image_filename FROM users WHERE id=$1", [targetId]);
    if (!row.rows[0]) throw new HttpError(404, "That account does not exist.");
    const targetName = row.rows[0].name;
    await withTransaction(db, async (transaction) => {
      await transaction.query(
        `UPDATE users SET id_image_filename='', id_back_image_filename='', id_type='', id_number='', id_number_canonical='', id_full_name='',
           id_birth_date=NULL, id_address='', id_expiration_date=NULL, id_face_status='', id_face_distance=NULL, id_face_checked_at=NULL,
           id_status='unverified', id_review_note='', id_reviewed_at=NULL, id_reviewed_by='',
           id_consent_at=NULL, id_submitted_at=NULL, id_scan_checks='{}'::jsonb WHERE id=$1`,
        [targetId],
      );
      await insertActivity(
        transaction,
        user,
        "Removed identity verification",
        targetId === user.id ? "Removed own ID verification." : `Removed ID verification for ${targetName}. Reason: ${auditReason}`,
        { affectedId: targetId },
      );
      if (targetId !== user.id)
        await insertNotification(
          transaction,
          row.rows[0].email,
          "ID verification data removed",
          `An administrator removed your ID verification. Reason: ${auditReason}`,
        );
      await bumpRevision(transaction);
    });
    await removeIdFiles(uploadsDir, targetId, row.rows[0].id_image_filename, row.rows[0].id_back_image_filename);
    sendJson(response, 200, { ok: true });
    return true;
  }

  const imageMatch = url.pathname.match(/^\/api\/verification\/id\/([^/]+)\/image(-back)?$/);
  if (imageMatch && request.method === "GET") {
    // The "me" route is session-owned: residents and officials can only read
    // their own images. Administrators keep the queue-wide review routes.
    const ownerRoute = imageMatch[1] === "me";
    if (ownerRoute) requireRole(user, ["resident", "official"]);
    else requireRole(user, ["administrator"]);
    let targetId = user?.id;
    if (!ownerRoute) {
      try {
        targetId = decodeURIComponent(imageMatch[1]);
      } catch {
        throw new HttpError(404, "That record does not exist.");
      }
    }
    if (!validId(targetId)) throw new HttpError(404, "That record does not exist.");
    const row = await db.query("SELECT id_image_filename, id_back_image_filename FROM users WHERE id=$1", [targetId]);
    const filename = imageMatch[2] ? row.rows[0]?.id_back_image_filename : row.rows[0]?.id_image_filename;
    if (!filename) throw new HttpError(404, "No ID image is stored for that account.");
    const safeName = path.basename(filename);
    const image = await readFile(path.join(uploadsDir, VERIFICATION_DIR, targetId, safeName)).catch(() => null);
    if (!image) throw new HttpError(404, "The stored ID image is missing.");
    sendImage(response, safeName, image);
    return true;
  }

  if (url.pathname === "/api/verification/id/review" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    if (!(await hasPermission(db, user, "manageUsers"))) throw new HttpError(403, "Account management is not enabled for this role.");
    requireJsonBody(request);
    const targetId = String(request.body?.userId || "").trim();
    const decision = String(request.body?.decision || "").trim();
    const note = String(request.body?.note || "").trim();
    if (!targetId || !validId(targetId)) throw new HttpError(400, "A valid account identifier is required.");
    if (decision !== "verified" && decision !== "rejected") throw new HttpError(400, "The decision must be verified or rejected.");
    if (decision === "rejected" && (note.length < 5 || note.length > 500))
      throw new HttpError(400, "Give the rejection a reason of at least 5 characters.");
    let targetName = "";
    await withTransaction(db, async (transaction) => {
      const current = await transaction.query("SELECT name, email, id_image_filename FROM users WHERE id=$1", [targetId]);
      if (!current.rows[0]) throw new HttpError(404, "That account does not exist.");
      if (!current.rows[0].id_image_filename) throw new HttpError(409, "That resident has not submitted an ID yet.");
      targetName = current.rows[0].name;
      try {
        await transaction.query("UPDATE users SET id_status=$1, id_review_note=$2, id_reviewed_at=now(), id_reviewed_by=$3 WHERE id=$4", [
          decision,
          decision === "rejected" ? note : "",
          user.name,
          targetId,
        ]);
      } catch (error) {
        if (error?.code === "23505") throw new HttpError(409, "Another account already holds that ID number.");
        throw error;
      }
      await insertActivity(
        transaction,
        user,
        decision === "verified" ? "Approved ID verification" : "Rejected ID verification",
        decision === "rejected" ? `${targetName}: ${note}` : `Verified ${targetName}.`,
        { affectedId: targetId },
      );
      await insertNotification(
        transaction,
        current.rows[0].email,
        decision === "verified" ? "ID verification approved" : "ID verification needs attention",
        decision === "verified"
          ? "Your ID was approved. Your profile now shows the ID verified badge."
          : `Your ID was not approved. Reason: ${note}`,
      );
      await bumpRevision(transaction);
    });
    sendJson(response, 200, { idStatus: decision });
    return true;
  }

  // Administrator enrollment for a locked official account.
  if (url.pathname === "/api/users/face-enroll" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    if (!(await hasPermission(db, user, "manageUsers")))
      throw new HttpError(403, "Account management is not enabled for this role.");
    requireJsonBody(request);
    const targetId = String(request.body?.userId || "").trim();
    if (!validId(targetId)) throw new HttpError(400, "A valid account is required.");
    const image = faceImageFrom(request.body?.image);
    if (!image) throw new HttpError(400, "A clear face photo is required.");
    const settings = await readVerificationSettings(db, faceppClient?.configured);
    let faceppToken = "";
    let embedding = null;
    if (settings.faceppEnabled) {
      faceppToken = await faceppClient.detectFace(image.data, image.mime);
    } else {
      embedding = parseEmbedding(request.body?.embedding);
      if (!embedding) throw new HttpError(400, "A complete face sample is required.");
    }
    await withTransaction(db, async (transaction) => {
      const locked = await transaction.query("SELECT name,role,face_references,facepp_tokens FROM users WHERE id=$1 FOR UPDATE", [targetId]);
      if (!locked.rows[0]) throw new HttpError(404, "That account does not exist.");
      if (locked.rows[0].role !== "official") throw new HttpError(400, "Only official accounts use face verification.");
      const target = locked.rows[0];
      if (faceppToken) {
        const tokens = (Array.isArray(target.facepp_tokens) ? target.facepp_tokens : []).filter((token) => token !== faceppToken);
        tokens.push(faceppToken);
        while (tokens.length > MAX_FACE_REFERENCES) tokens.shift();
        await transaction.query(
          "UPDATE users SET facepp_tokens=$1::jsonb, face_enrolled_at=now(), last_face_verified_at=now(), face_liveness_verified=false, face_enrollment_state='enrolled' WHERE id=$2",
          [JSON.stringify(tokens), targetId],
        );
      } else {
        const references = Array.isArray(target.face_references) ? [...target.face_references] : [];
        references.push({ embedding, liveness: false, enrolledAt: new Date().toISOString() });
        while (references.length > MAX_FACE_REFERENCES) references.shift();
        await transaction.query(
          "UPDATE users SET face_references=$1::jsonb, face_enrolled_at=now(), last_face_verified_at=now(), face_liveness_verified=false, face_enrollment_state='enrolled' WHERE id=$2",
          [JSON.stringify(references), targetId],
        );
      }
      // A session opened before this enrollment is still restricted; the new reference releases it.
      await transaction.query("UPDATE web_sessions SET face_check_pending=false WHERE user_id=$1", [targetId]);
      await insertActivity(transaction, user, "Enrolled official face reference", `Enrolled face for ${target.name}`, {
        affectedId: targetId,
      });
      await bumpRevision(transaction);
    });
    sendJson(response, 200, { faceEnrolled: true });
    return true;
  }

  return false;
}
