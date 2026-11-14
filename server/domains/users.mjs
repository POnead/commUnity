import path from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { CONTENT_TYPES } from "../platform/constants.mjs";
import { passwordHash, hash } from "../platform/crypto.mjs";
import { HttpError, readMultipart, requireJsonBody, sendJson } from "../platform/http.mjs";
import { getSessionUser, requireRole, publicUser } from "../platform/session.mjs";
import { recordAttempt } from "../platform/ratelimit.mjs";
import {
  assertKnownArea,
  validateAccount,
  validateAvailableDays,
  validatePassword,
  validateWorkingHours,
  DEFAULT_OFFICIAL_DAYS,
} from "../platform/validate.mjs";
import { MAX_PHOTO_BYTES, PHOTO_EXTENSIONS, photoExtension } from "../platform/uploads.mjs";
import { ROLES } from "../platform/roles.mjs";
import { withTransaction } from "../platform/db.mjs";
import { insertActivity } from "./activity.mjs";
import { readFullState, stateForRole } from "./state.mjs";
import { sendRecoveryVerification } from "./auth.mjs";

export async function createUser(db, user, body) {
  requireRole(user, ["administrator"]);
  const {
    email,
    name,
    area,
    phone = "",
    workingHours = "Monday-Friday, 8:00 AM-5:00 PM",
    availableDays = DEFAULT_OFFICIAL_DAYS,
    role,
    status = "Active",
    password,
  } = body || {};
  validateAccount({ email, name, area, phone });
  if (role === "official") validateWorkingHours(String(workingHours).trim());
  const validatedAvailableDays = validateAvailableDays(availableDays);
  if (role === "resident") await assertKnownArea(db, area);
  validatePassword(password);
  if (!ROLES.includes(role) || !["Active", "Inactive"].includes(status))
    throw new HttpError(400, "Choose a valid role and account status.");
  const id = randomUUID();
  await withTransaction(db, async (transaction) => {
    const db = transaction;
    await db.query(
      "INSERT INTO users (id,email,name,area,phone,working_hours,available_days,role,status) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
      [
        id,
        email.trim().toLowerCase(),
        name.trim(),
        area.trim(),
        phone.trim(),
        String(workingHours).trim(),
        JSON.stringify(validatedAvailableDays),
        role,
        status,
      ],
    );
    await db.query("INSERT INTO user_credentials (user_id,password_hash) VALUES ($1,$2)", [id, await passwordHash(password)]);
    await insertActivity(db, user, "Added user account", `${name.trim()} · ${role}`);
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  }).catch((error) => {
    if (error.code === "23505") throw new HttpError(409, "An account already uses this email address.");
    throw error;
  });
}

export async function handleUsers(request, response, db, options, user) {
  const { uploadsDir, mailerState } = options;
  const smtpFrom = mailerState?.settings?.from;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/community/working-hours" && request.method === "GET") {
    requireRole(user, ROLES);
    const result = await db.query(
      "SELECT id,name,working_hours AS \"workingHours\",available_days AS \"availableDays\" FROM users WHERE role='official' AND status='Active' ORDER BY name",
    );
    sendJson(response, 200, { officials: result.rows });
    return true;
  }
  if (url.pathname === "/api/profile" && request.method === "PUT") {
    requireRole(user, ROLES);
    requireJsonBody(request);
    const body = request.body;
    validateAccount({ ...body, email: user.email });
    if (user.role === "resident") await assertKnownArea(db, body.area);
    const recoveryEmail =
      typeof body.recoveryEmail === "string"
        ? body.recoveryEmail.trim().toLowerCase()
        : typeof body.recovery_email === "string"
          ? body.recovery_email.trim().toLowerCase()
          : "";
    if (recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail))
      throw new HttpError(400, "Enter a valid recovery email address.");
    const stored = await db.query(
      'SELECT recovery_email AS "recoveryEmail", recovery_email_verified AS "recoveryEmailVerified" FROM users WHERE id=$1',
      [user.id],
    );
    const previousEmail = stored.rows[0]?.recoveryEmail || "";
    const wasVerified = Boolean(stored.rows[0]?.recoveryEmailVerified);
    const emailChanged = recoveryEmail !== previousEmail;
    // A new address, or one that was never confirmed, stays inactive until the owner proves they control it.
    const needsVerification = Boolean(recoveryEmail) && (emailChanged || !wasVerified);
    const verified = Boolean(recoveryEmail) && !emailChanged && wasVerified;
    if (needsVerification) {
      await recordAttempt(db, hash(`recovery-verify-send:${user.id}`), 5);
    }
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      await db.query("UPDATE users SET name=$1,area=$2,phone=$3,recovery_email=$4,recovery_email_verified=$5 WHERE id=$6", [
        body.name.trim(),
        body.area.trim(),
        String(body.phone || "").trim(),
        recoveryEmail,
        verified,
        user.id,
      ]);
      if (emailChanged) {
        await transaction.query("DELETE FROM recovery_email_tokens WHERE user_id=$1", [user.id]);
        await insertActivity(
          db,
          { ...user, name: body.name.trim() },
          recoveryEmail ? "Set recovery email" : "Removed recovery email",
          recoveryEmail || previousEmail,
        );
      }
      await insertActivity(db, { ...user, name: body.name.trim() }, "Updated profile information", user.email);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const verificationSent = needsVerification ? await sendRecoveryVerification(db, options, request, user, recoveryEmail) : false;
    const updatedUser = await getSessionUser(request, db);
    const [state, revision] = await Promise.all([readFullState(db, updatedUser), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 200, {
      data: stateForRole(state, updatedUser),
      revision: Number(revision.rows[0].revision),
      user: publicUser(updatedUser),
      recoveryEmail: { verified, verificationSent },
    });
    return true;
  }
  if (url.pathname === "/api/users/password-reset" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const target = await db.query("SELECT id, name, email FROM users WHERE email=$1 AND email<>$2", [email, user.email]);
    if (!target.rows.length) throw new HttpError(404, "The account could not be found.");
    const mailer = mailerState.mailer;
    if (!mailer) throw new HttpError(503, "Email service is not configured. Configure SMTP before resetting account passwords.");
    const temporaryPassword = `CommUnity-${randomBytes(5).toString("base64url")}`;
    // Send first: if SMTP fails, the password must not have changed yet, otherwise
    // the account is locked out with a temporary password nobody received.
    await mailer.sendMail({
      from: smtpFrom,
      to: target.rows[0].email,
      subject: "CommUnity temporary password",
      text: `Your temporary CommUnity password is: ${temporaryPassword}\n\nSign in and change it immediately. The password expires on first use.`,
    });
    await withTransaction(db, async (transaction) => {
      await transaction.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [
        await passwordHash(temporaryPassword),
        target.rows[0].id,
      ]);
      await transaction.query("UPDATE users SET requires_password_change=true, reset_requested=false WHERE id=$1", [target.rows[0].id]);
      await transaction.query("DELETE FROM web_sessions WHERE user_id=$1", [target.rows[0].id]);
      await transaction.query(
        "UPDATE password_reset_requests SET status='completed',handled_by=$1,handled_at=now() WHERE user_id=$2 AND status='pending'",
        [user.id, target.rows[0].id],
      );
      await insertActivity(transaction, user, "Generated temporary password", target.rows[0].name);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/users/deactivate" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const email = String(request.body.email || "")
      .trim()
      .toLowerCase();
    const reason = String(request.body.reason || "").trim();
    if (!reason || reason.length > 500) throw new HttpError(400, "A deactivation reason is required.");
    if (email === user.email) throw new HttpError(400, "You cannot deactivate the administrator account you are using.");
    // Deactivation and session revocation must succeed or fail together: an account
    // that is inactive must not have a usable session left behind, in either order.
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const result = await db.query("UPDATE users SET status='Inactive', deactivation_reason=$1 WHERE email=$2", [reason, email]);
      if (!result.rowCount) throw new HttpError(404, "The account could not be found.");
      const target = await db.query("SELECT id FROM users WHERE email=$1", [email]);
      await db.query("DELETE FROM web_sessions WHERE user_id=$1", [target.rows[0].id]);
      await insertActivity(db, user, "Deactivated user account", `${email} · ${reason}`);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/users/reactivate" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const email = String(request.body.email || "")
      .trim()
      .toLowerCase();
    if (email === user.email) throw new HttpError(400, "You cannot reactivate the administrator account you are using.");
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      const result = await db.query("UPDATE users SET status='Active', deactivation_reason='' WHERE email=$1 AND status='Inactive'", [
        email,
      ]);
      if (!result.rowCount) throw new HttpError(404, "The account could not be found or is not inactive.");
      await insertActivity(db, user, "Reactivated user account", `${email}`);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/users/password" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    const body = request.body;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    validatePassword(body.newPassword);
    if (body.newPassword !== body.confirmPassword) throw new HttpError(400, "The new passwords do not match.");
    if (!email || email === user.email) throw new HttpError(400, "Choose another account to reset.");
    await withTransaction(db, async (transaction) => {
      const target = await transaction.query("SELECT id, name FROM users WHERE email=$1", [email]);
      if (!target.rows.length) throw new HttpError(404, "The account could not be found.");
      await transaction.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [
        await passwordHash(body.newPassword),
        target.rows[0].id,
      ]);
      await transaction.query("DELETE FROM web_sessions WHERE user_id=$1", [target.rows[0].id]);
      await insertActivity(transaction, user, "Reset user password", target.rows[0].name);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    const currentUser = await getSessionUser(request, db);
    const [state, revision] = await Promise.all([readFullState(db, currentUser), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 200, {
      data: stateForRole(state, currentUser),
      revision: Number(revision.rows[0].revision),
      user: publicUser(currentUser),
    });
    return true;
  }
  if (url.pathname === "/api/users" && request.method === "POST") {
    requireRole(user, ["administrator"]);
    requireJsonBody(request);
    await createUser(db, user, request.body);
    const [state, revision] = await Promise.all([readFullState(db, user), db.query("SELECT revision FROM app_meta WHERE id=1")]);
    sendJson(response, 201, { data: stateForRole(state, user), revision: Number(revision.rows[0].revision), user: publicUser(user) });
    return true;
  }
  const profilePhotoMatch = url.pathname.match(/^\/api\/profile-photo\/([^/]+)$/);
  if (url.pathname === "/api/profile-photo" && request.method === "POST") {
    requireRole(user, ROLES);
    await recordAttempt(db, hash(`profile-photo:${user.id}`), 10);
    const files = await readMultipart(request, { maxFiles: 1 });
    if (!files.length) throw new HttpError(400, "Choose a JPG or PNG profile photo.");
    const file = files[0];
    const extension = photoExtension(file.data);
    if (!extension) throw new HttpError(400, `${file.name}: choose a JPG or PNG image.`);
    if (file.data.length > MAX_PHOTO_BYTES) throw new HttpError(413, `${file.name}: photo files must be 5 MB or smaller.`);
    const profileDir = path.join(uploadsDir, "profiles");
    await mkdir(profileDir, { recursive: true });
    const filename = `${user.id}${extension}`;
    const filePath = path.join(profileDir, filename);
    const temporaryPath = path.join(profileDir, `${user.id}.${randomUUID()}.tmp`);
    const photoUrl = `/api/profile-photo/${encodeURIComponent(user.id)}`;
    // Replace the old image atomically. The previous version used an exclusive
    // create (wx), so a second upload failed and the cleanup deleted the good file.
    try {
      await writeFile(temporaryPath, file.data);
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
    await db.query("UPDATE users SET photo_url=$1 WHERE id=$2", [photoUrl, user.id]);
    for (const other of PHOTO_EXTENSIONS) {
      if (other !== extension) await unlink(path.join(profileDir, `${user.id}${other}`)).catch(() => {});
    }
    sendJson(response, 201, { photoUrl });
    return true;
  }
  if (profilePhotoMatch && request.method === "GET") {
    requireRole(user, ROLES);
    const requestedId = decodeURIComponent(profilePhotoMatch[1]);
    // Residents can see their own photo, administrators can see every photo,
    // and officials can see resident photos (they handle the concern queue the
    // residents file into). Staff-to-staff photos stay administrator-only.
    let allowed = requestedId === user.id || user.role === "administrator";
    if (!allowed && user.role === "official") {
      const target = await db.query("SELECT role FROM users WHERE id=$1", [requestedId]);
      allowed = target.rows[0]?.role === "resident";
    }
    if (!allowed) {
      throw new HttpError(403, "You cannot view this profile photo.");
    }
    let image = null;
    let filename = null;
    for (const ext of PHOTO_EXTENSIONS) {
      const candidate = path.join(uploadsDir, "profiles", `${requestedId}${ext}`);
      try {
        image = await readFile(candidate);
        filename = `${requestedId}${ext}`;
        break;
      } catch {
        continue;
      }
    }
    if (!image || !filename) throw new HttpError(404, "The profile photo could not be found.");
    response.writeHead(200, {
      "Cache-Control": "private, no-store",
      "Content-Type": CONTENT_TYPES[path.extname(filename)] || "application/octet-stream",
      "Content-Length": image.length,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(image);
    return true;
  }
  return false;
}
