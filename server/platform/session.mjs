import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { HttpError } from "./http.mjs";
import { hash } from "./crypto.mjs";
import { SESSION_COOKIE, SESSION_HOURS, REMEMBER_DAYS, cookieValue, cookieHeader } from "./cookies.mjs";

export function normalizeIpAddress(address) {
  const normalized = String(address || "")
    .trim()
    .toLowerCase();
  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
}

export function requestClientAddress(request, trustedProxyAddresses = new Set()) {
  const remoteAddress = normalizeIpAddress(request.socket.remoteAddress);
  if (!trustedProxyAddresses.has(remoteAddress)) return remoteAddress;
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor !== "string") return remoteAddress;
  const chain = forwardedFor.split(",").map(normalizeIpAddress);
  if (!chain.length || chain.some((address) => !isIP(address))) return remoteAddress;
  for (const address of chain.reverse()) {
    if (!trustedProxyAddresses.has(address)) return address;
  }
  return remoteAddress;
}

export function parseTrustedProxyAddresses(value) {
  if (!value) return new Set();
  const addresses = value.split(",").map(normalizeIpAddress);
  if (addresses.some((address) => !isIP(address))) {
    throw new Error("TRUSTED_PROXY_IPS must contain only comma-separated IPv4 or IPv6 addresses.");
  }
  return new Set(addresses);
}

export async function getSessionUser(request, db) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  const result = await db.query(
    `
    SELECT u.id, u.email, u.name, u.area, u.phone, u.role, u.status, u.working_hours AS "workingHours",
      u.available_days AS "availableDays", u.permission_overrides AS "permissionOverrides",
      u.requires_password_change AS "requiresPasswordChange", u.photo_url AS "photoUrl", to_char(u.joined_at, 'YYYY-MM-DD') AS "joinedAt",
      u.recovery_email AS "recoveryEmail", u.recovery_email_verified AS "recoveryEmailVerified",
      u.id_status AS "idStatus", u.id_review_note AS "idReviewNote",
      u.id_address AS "idAddress", to_char(u.id_expiration_date, 'YYYY-MM-DD') AS "idExpirationDate",
      u.id_face_status AS "idFaceStatus",
      COALESCE(u.id_image_filename, '') <> '' AS "hasIdImage",
      COALESCE(u.id_back_image_filename, '') <> '' AS "hasIdBackImage",
      ((CASE WHEN jsonb_typeof(u.face_references) = 'array' THEN jsonb_array_length(u.face_references) ELSE 0 END > 0)
        OR (CASE WHEN jsonb_typeof(u.facepp_tokens) = 'array' THEN jsonb_array_length(u.facepp_tokens) ELSE 0 END > 0)) AS "faceEnrolled",
      s.face_check_pending AS "faceCheckPending", u.face_enrollment_state AS "faceEnrollmentState"
    FROM web_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'Active'
  `,
    [hash(token)],
  );
  return result.rows[0] || null;
}

export async function hasPermission(db, user, permission) {
  if (user?.permissionOverrides && Object.hasOwn(user.permissionOverrides, permission)) {
    return Boolean(user.permissionOverrides[permission]);
  }
  const result = await db.query("SELECT enabled FROM role_permissions WHERE role=$1 AND permission=$2", [user.role, permission]);
  return Boolean(result.rows[0]?.enabled);
}

// The permissions that gate which workspace data a caller may retrieve.
// Read visibility is as much a security boundary as the write checks: a role
// matrix without it hides pages but leaks the data behind them. Every caller
// of the state endpoints resolves it before reading or saving.
export async function readVisibility(db, user) {
  if (!user) {
    return {
      submitReports: true,
      viewSchedules: true,
      manageReports: true,
      manageSchedules: true,
      manageAnnouncements: true,
      manageUsers: true,
      manageRoles: true,
      viewAudit: true,
    };
  }
  const keys =
    user.role === "resident"
      ? ["submitReports", "viewSchedules"]
      : user.role === "official"
        ? ["manageReports", "manageSchedules", "manageAnnouncements"]
        : ["manageReports", "manageSchedules", "manageAnnouncements", "manageUsers", "manageRoles", "viewAudit"];
  const result = await db.query("SELECT permission, enabled FROM role_permissions WHERE role=$1", [user.role]);
  const enabledByPermission = new Map(result.rows.map((row) => [row.permission, Boolean(row.enabled)]));
  const overrides = user.permissionOverrides || {};
  return Object.fromEntries(
    keys.map((key) => [key, Object.hasOwn(overrides, key) ? Boolean(overrides[key]) : enabledByPermission.get(key) === true]),
  );
}

export async function issueSession(response, db, user, remember, secure, faceCheckPending = false) {
  const token = randomBytes(32).toString("base64url");
  const duration = remember ? `${REMEMBER_DAYS} days` : `${SESSION_HOURS} hours`;
  await db.query("INSERT INTO web_sessions (token_hash, user_id, expires_at, face_check_pending) VALUES ($1, $2, now() + $3::interval, $4)", [
    hash(token),
    user.id,
    duration,
    Boolean(faceCheckPending),
  ]);
  response.setHeader("Set-Cookie", cookieHeader(token, { secure, remember }));
}

export function requireRole(user, roles) {
  if (!user) throw new HttpError(401, "Sign in to continue.");
  if (!roles.includes(user.role)) throw new HttpError(403, "Your account cannot perform this action.");
}

export function validateSameOrigin(request, server, appOrigin) {
  const safeMethod = request.method === "GET" || request.method === "HEAD";
  const host = request.headers.host;
  let requestOrigin;
  try {
    requestOrigin = new URL(`http://${host}`).origin;
  } catch {
    return false;
  }
  if (appOrigin) {
    try {
      if (new URL(appOrigin).host !== new URL(requestOrigin).host) return false;
    } catch {
      return false;
    }
    return safeMethod ? !request.headers.origin || request.headers.origin === appOrigin : request.headers.origin === appOrigin;
  }
  const address = server.address();
  let parsed;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return false;
  }
  // Same-origin validation guards against cross-site requests. The host may be a
  // LAN address, machine name or proxy host, so it is not limited to loopback.
  return (
    Number(parsed.port) === address?.port &&
    (safeMethod ? !request.headers.origin || request.headers.origin === requestOrigin : request.headers.origin === requestOrigin)
  );
}

export function publicUser(user) {
  if (!user) return null;
  const {
    id,
    email,
    name,
    area,
    phone,
    role,
    status,
    joinedAt,
    workingHours,
    availableDays,
    requiresPasswordChange,
    recoveryEmail,
    recoveryEmailVerified,
    resetRequested,
    photoUrl,
    idStatus,
    idReviewNote,
    idAddress,
    idExpirationDate,
    idFaceStatus,
    hasIdImage,
    hasIdBackImage,
    faceEnrolled,
    faceCheckPending,
    faceEnrollmentState,
  } = user;
  return {
    id,
    email,
    name,
    area,
    phone,
    role,
    status,
    joinedAt,
    workingHours,
    availableDays,
    requiresPasswordChange: Boolean(requiresPasswordChange),
    recoveryEmail: recoveryEmail || "",
    recoveryEmailVerified: Boolean(recoveryEmailVerified),
    resetRequested: Boolean(resetRequested),
    photoUrl: photoUrl || "",
    idStatus: idStatus || "unverified",
    idReviewNote: idReviewNote || "",
    idAddress: idAddress || "",
    idExpirationDate: idExpirationDate || "",
    idFaceStatus: idFaceStatus || "",
    hasIdImage: Boolean(hasIdImage),
    hasIdBackImage: Boolean(hasIdBackImage),
    faceEnrolled: Boolean(faceEnrolled),
    faceCheckPending: Boolean(faceCheckPending),
    faceEnrollmentState: faceEnrollmentState || "none",
  };
}
