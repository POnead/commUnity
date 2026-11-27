"use strict";

import { hasPermission, requestClientAddress, requireRole } from "../../platform/session.mjs";
import { readVerificationSettings } from "./settings.mjs";
import { HttpError, requireJsonBody, sendJson } from "../../platform/http.mjs";
import { assertFaceNotLocked, bumpRevision, clearPendingFaceCheck, faceImageFrom } from "./common.mjs";
import { recordAttempt } from "../../platform/ratelimit.mjs";
import { hash } from "../../platform/crypto.mjs";
import { withTransaction } from "../../platform/db.mjs";
import { insertActivity, logSecurityEvent } from "../activity.mjs";
import { DUPLICATE_DISTANCE, MAX_FACE_REFERENCES, cosineDistance, nearestDistance, parseEmbedding } from "../../platform/face-match.mjs";
import { validId } from "../../platform/validate.mjs";

export async function handleFaceRoutes({ request, response, db, user, url, trustedProxyAddresses, faceppClient }) {
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
          throw new HttpError(
            409,
            "This does not match your enrolled face. Ask an administrator to reset your face reference.",
            "FACE_MISMATCH",
          );
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
        throw new HttpError(
          409,
          "This does not match your enrolled face. Ask an administrator to reset your face reference.",
          "FACE_MISMATCH",
        );
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
      if (!(await hasPermission(db, user, "manageUsers"))) throw new HttpError(403, "Account management is not enabled for this role.");
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

  // Administrator enrollment for a locked official account.
  if (url.pathname === "/api/users/face-enroll" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    if (!(await hasPermission(db, user, "manageUsers"))) throw new HttpError(403, "Account management is not enabled for this role.");
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
      const locked = await transaction.query("SELECT name,role,face_references,facepp_tokens FROM users WHERE id=$1 FOR UPDATE", [
        targetId,
      ]);
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
