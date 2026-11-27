"use strict";

import path from "node:path";
import { ID_TYPE_LABELS } from "../../../shared/domain-rules.mjs";
import { validISODate, validId } from "../../platform/validate.mjs";
import { VERIFICATION_DIR, assertFaceNotLocked, bumpRevision, canonicalIdNumber, clearPendingFaceCheck, removeIdFiles } from "./common.mjs";
import { hasPermission, requireRole } from "../../platform/session.mjs";
import { HttpError, readMultipart, requireJsonBody, sendImage, sendJson } from "../../platform/http.mjs";
import { recordAttempt } from "../../platform/ratelimit.mjs";
import { hash } from "../../platform/crypto.mjs";
import { readVerificationSettings } from "./settings.mjs";
import { photoExtension } from "../../platform/uploads.mjs";
import { buildIdSignals, idMatchCheck, suggestIdFields } from "./match.mjs";
import { withTransaction } from "../../platform/db.mjs";
import { insertActivity, logSecurityEvent } from "../activity.mjs";
import { MAX_FACE_REFERENCES } from "../../platform/face-match.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { insertNotification } from "../notifications.mjs";

const ID_TYPES = new Map(Object.entries(ID_TYPE_LABELS));

const nameTokens = (value) =>
  new Set(
    String(value || "")
      .toLowerCase()
      .match(/[a-z]{3,}/g) || [],
  );

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

// Only these four fields gate a submit; persist their presence, not their values.
const requiredScanFields = ["idType", "idNumber", "idFullName", "idBirthDate"];

export async function handleIdRoutes({ request, response, db, user, url, uploadsDir, ocrClient, faceppClient }) {
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
      await transaction.query("UPDATE users SET id_face_status=$1, id_face_distance=$2, id_face_checked_at=now() WHERE id=$3", [
        status,
        confidence,
        user.id,
      ]);
      await insertActivity(transaction, user, "Integrated face match", `${status} (confidence ${Math.round(confidence)})`, {
        affectedId: user.id,
      });
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

  return false;
}
