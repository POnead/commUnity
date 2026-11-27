"use strict";

import path from "node:path";
import { SESSION_COOKIE, cookieValue } from "../../platform/cookies.mjs";
import { hash } from "../../platform/crypto.mjs";
import { HttpError } from "../../platform/http.mjs";
import { photoExtension } from "../../platform/uploads.mjs";
import { unlink } from "node:fs/promises";

export const VERIFICATION_DIR = "verification";

// Duplicate detection compares this form, not the printed text: case, spaces
// and dashes are presentation details, while leading zeros are kept.
export const canonicalIdNumber = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[\s-]+/g, "");

// A successful face check releases the restricted sign-in session.
export async function clearPendingFaceCheck(request, db, userId) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  await db.query("UPDATE web_sessions SET face_check_pending=false WHERE token_hash=$1 AND user_id=$2", [hash(token), userId]);
}

// A locked official needs an administrator to enroll a new face reference.
// Without this guard, self-service re-enrollment could clear the lock in one session.
export function assertFaceNotLocked(user) {
  if (user?.role === "official" && user.faceEnrollmentState === "locked")
    throw new HttpError(403, "Ask a barangay administrator to complete face enrollment.");
}

// Face++ needs pixels, unlike the on-device 128-float descriptor. The browser
// sends a JPEG or PNG data URL; size and file signature are checked before it
// leaves. The detected format decides the MIME type sent to the provider.
export function faceImageFrom(value) {
  if (typeof value !== "string") return null;
  const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return null;
  const extension = photoExtension(buffer);
  if (!extension) return null;
  return { data: buffer, mime: extension === ".png" ? "image/png" : "image/jpeg" };
}

export async function removeIdFiles(uploadsDir, userId, ...filenames) {
  for (const filename of filenames) {
    const name = path.basename(String(filename || ""));
    if (!name) continue;
    await unlink(path.join(uploadsDir, VERIFICATION_DIR, userId, name)).catch(() => {});
  }
}

export async function bumpRevision(transaction) {
  await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
}
