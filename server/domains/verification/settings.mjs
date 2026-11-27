"use strict";

import { DEFAULT_MATCH_THRESHOLD } from "../../platform/face-match.mjs";
import { requireRole } from "../../platform/session.mjs";
import { HttpError, requireJsonBody, sendJson } from "../../platform/http.mjs";
import { withTransaction } from "../../platform/db.mjs";
import { insertActivity } from "../activity.mjs";
import { bumpRevision } from "./common.mjs";

// Shortcut: the verification settings row in app_settings carries plain JSON, not
// an encrypted blob like SMTP — nothing in it is a secret. Upgrade path: encrypt
// it through crypto.mjs if it ever grows one.

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
      faceVerificationEnabled:
        parsed?.faceVerificationEnabled === undefined ? defaults.faceVerificationEnabled : parsed.faceVerificationEnabled === true,
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

export async function handleSettingsRoutes({ request, response, db, user, url, ocrClient, faceppClient }) {
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

  return false;
}
