import { HttpError, sendJson } from "./platform/http.mjs";
import { hash } from "./platform/crypto.mjs";
import { logError } from "./platform/log.mjs";
import { getSessionUser, requestClientAddress, validateSameOrigin } from "./platform/session.mjs";
import { recordAttempt } from "./platform/ratelimit.mjs";
import { logSecurityEvent } from "./domains/activity.mjs";
import { handleAuth } from "./domains/auth.mjs";
import { handleActivity } from "./domains/activity.mjs";
import { handleAnnouncements } from "./domains/announcements.mjs";
import { handleHotlines } from "./domains/hotlines.mjs";
import { handleLocations } from "./domains/locations.mjs";
import { handleNotifications } from "./domains/notifications.mjs";
import { handleReports } from "./domains/reports.mjs";
import { handleSettings } from "./domains/settings.mjs";
import { handleState } from "./domains/state.mjs";
import { handleUsers } from "./domains/users.mjs";
import { handleVerification, readVerificationSettings } from "./domains/verification.mjs";

// Each domain handler owns a set of endpoints outright. A handler whose paths do
// not match the request returns false and the dispatcher moves to the next one;
// whichever handler matches sends the response. Keep this list short and grouped
// by domain — endpoint ownership lives in the domains, never here.
const domainHandlers = [
  handleAuth,
  handleUsers,
  handleState,
  handleReports,
  handleNotifications,
  handleActivity,
  handleAnnouncements,
  handleHotlines,
  handleSettings,
  handleLocations,
  handleVerification,
];

// While a temporary password is in force, only these calls may leave the
// password-change dialog: the change itself, signing out, and the session check
// the interface uses to keep the dialog and its flag current.
function passwordChangeRequestAllowed(request, url) {
  if (url.pathname === "/api/auth/password") return request.method === "POST";
  if (url.pathname === "/api/auth/logout") return request.method === "POST";
  if (url.pathname === "/api/session") return request.method === "GET";
  return false;
}

// While the face duty check is enabled, officials prove presence once per shift:
// every non-GET call outside the sign-in/face-check surface requires a fresh
// last_face_verified_at. Residents and administrators never see this. The
// check lives in the dispatcher so no handler can forget it.
// A sign-in that needs the face gate gets a restricted session: only the gate's
// own endpoints and signing out are reachable until verification completes.
function faceCheckRequestAllowed(request, url) {
  if (url.pathname === "/api/auth/logout") return request.method === "POST";
  if (url.pathname === "/api/session") return request.method === "GET";
  if (url.pathname === "/api/verification/status") return request.method === "GET";
  // A new official must be able to finish the integrated ID + face flow that
  // releases this restricted session in the first place.
  if (url.pathname.startsWith("/api/verification/id")) return true;
  if (url.pathname === "/api/verification/face/enroll" || url.pathname === "/api/verification/face/verify")
    return request.method === "POST";
  return false;
}

function dutyGateAllowed(url) {
  if (url.pathname.startsWith("/api/auth/")) return true;
  if (url.pathname === "/api/session") return true;
  if (url.pathname.startsWith("/api/verification/")) return true;
  return false;
}

// Audit policy for failed requests:
//   - A 403 (authorization denied) is always recorded as a security event. A request with
//     no session is attributed to the "system" actor, which the activities table accepts.
//   - A missing session on a protected endpoint returns 401 and is not recorded: it is the
//     normal anonymous answer, and recording every one would let anonymous traffic bury
//     real security events in the audit view. Failed sign-ins are recorded separately with
//     their own limit buckets.
//   - 400, 404 and 409 are client mistakes, not security events.
export async function handleApi(request, response, db, options) {
  const { server, appOrigin, trustedProxyAddresses, googleMapsApiKey, faceppClient } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  let user = null;
  try {
    // The origin check runs before the session is read, so a rejected cross-site request
    // never reaches the database and is recorded against the system actor.
    if (!validateSameOrigin(request, server, appOrigin)) {
      throw new HttpError(403, "This request did not come from the CommUnity website.");
    }
    if (url.pathname === "/api/healthz" && request.method === "GET") {
      try {
        await db.query("SELECT 1");
        sendJson(response, 200, { status: "ok", database: "available", checked_at: new Date().toISOString() });
      } catch {
        sendJson(response, 503, { status: "error", database: "unavailable", checked_at: new Date().toISOString() });
      }
      return;
    }
    user = await getSessionUser(request, db);
    if (url.pathname === "/api/map-config" && request.method === "GET") {
      if (!user) throw new HttpError(401, "Sign in to continue.");
      sendJson(response, 200, { googleMapsApiKey: googleMapsApiKey || "" });
      return;
    }
    // A temporary password exists only to reach the password-change dialog. The
    // check lives here in the central dispatcher so no handler has to remember
    // it: until the password is replaced, the session can change the password,
    // sign out, or read its own session — nothing else.
    if (user?.requiresPasswordChange && !passwordChangeRequestAllowed(request, url)) {
      throw new HttpError(403, "Change your password before using CommUnity.");
    }
    if (user?.faceCheckPending && !faceCheckRequestAllowed(request, url)) {
      throw new HttpError(403, "Complete the face check to open your workspace.", "FACE_VERIFICATION_REQUIRED");
    }
    if (user?.role === "official" && request.method !== "GET" && request.method !== "HEAD" && !dutyGateAllowed(url)) {
      const verification = await readVerificationSettings(db, faceppClient?.configured);
      if (verification.faceVerificationEnabled) {
        const row = await db.query("SELECT last_face_verified_at FROM users WHERE id=$1", [user.id]);
        const last = row.rows[0]?.last_face_verified_at ? new Date(row.rows[0].last_face_verified_at).getTime() : 0;
        if (Date.now() >= last + verification.dutyHours * 3600 * 1000) {
          throw new HttpError(
            403,
            "Face verification is required before you can make changes. Open the face check page, complete the check, and try again.",
            "FACE_VERIFICATION_REQUIRED",
          );
        }
      }
    }
    for (const handler of domainHandlers) {
      if (await handler(request, response, db, options, user)) return;
    }
    sendJson(response, 404, { error: "API endpoint not found." });
  } catch (error) {
    if (error.status === 403) {
      const clientAddress = requestClientAddress(request, trustedProxyAddresses);
      // An anonymous caller can send refused requests in a loop. Keep one audit
      // row per address per window so the security log stays readable.
      try {
        await recordAttempt(db, hash(`denial:${clientAddress}`), 1);
      } catch {
        throw error;
      }
      const actor = user ? user.name : "system";
      const role = user ? user.role : "system";
      await logSecurityEvent(db, actor, role, "Authorization denied", error.message, "Failed", {
        resultReason: error.message,
        clientIp: clientAddress,
      }).catch((logError2) => logError("CommUnity could not log authorization denial.", logError2));
    }
    throw error;
  }
}
