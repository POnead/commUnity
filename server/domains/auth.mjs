import { randomBytes, randomUUID } from "node:crypto";
import { hash, passwordHash, verifyPassword } from "../platform/crypto.mjs";
import { HttpError, requireJsonBody, sendJson } from "../platform/http.mjs";
import { getSessionUser, issueSession, requireRole, publicUser, requestClientAddress } from "../platform/session.mjs";
import { recordAttempt } from "../platform/ratelimit.mjs";
import { cookieValue, SESSION_COOKIE, clearSessionCookie } from "../platform/cookies.mjs";
import { assertKnownArea, validateAccount, validatePassword, MAX_PASSWORD_LENGTH } from "../platform/validate.mjs";
import { ROLES } from "../platform/roles.mjs";
import { withTransaction } from "../platform/db.mjs";
import { insertActivity, logSecurityEvent } from "./activity.mjs";
import { insertNotification } from "./notifications.mjs";

const RESET_TOKEN_MINUTES = 15;
const RESET_EMAIL_COOLDOWN_MINUTES = 2;
const FORGOT_PASSWORD_IP_LIMIT = 10;
const FORGOT_PASSWORD_EMAIL_LIMIT = 3;
const RECOVERY_VERIFY_LIMIT = 5;
const EMAIL_CHANGE_TOKEN_MINUTES = 30;

function emailLinkOrigin(request, appOrigin) {
  if (appOrigin) return appOrigin;
  const protocol = request.socket.encrypted ? "https:" : "http:";
  try {
    const origin = new URL(`${protocol}//${request.headers.host}`);
    if (origin.username || origin.password || origin.pathname !== "/") throw new Error("invalid host");
    return origin.origin;
  } catch {
    throw new HttpError(400, "The website address could not be determined for this email.");
  }
}

// A recovery link is only sent to an address the owner has confirmed, and only the
// account's name and role go into the verification email. Returns false when no
// mailer is configured so the caller can decide what the UI should show.
export async function sendRecoveryVerification(db, options, request, user, recoveryEmail) {
  const { mailerState, appOrigin } = options;
  const mailer = mailerState.mailer;
  if (!mailer) return false;
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hash(rawToken);
  await db.query("DELETE FROM recovery_email_tokens WHERE user_id=$1", [user.id]);
  await db.query(
    "INSERT INTO recovery_email_tokens(user_id, email, token_hash, expires_at) VALUES($1,$2,$3, now() + ($4 || ' minutes')::interval)",
    [user.id, recoveryEmail, tokenHash, String(RESET_TOKEN_MINUTES)],
  );
  const verifyLink = `${emailLinkOrigin(request, appOrigin)}/#/verify-recovery?token=${rawToken}`;
  await mailer.sendMail({
    from: mailerState.settings.from,
    to: recoveryEmail,
    subject: "Verify your CommUnity recovery email",
    text: `Confirm this email address for CommUnity password recovery (valid for ${RESET_TOKEN_MINUTES} minutes): ${verifyLink}\n\nPassword reset links are only sent to a recovery email you have confirmed. If you did not request this, ignore this message.`,
  });
  return true;
}

export async function handleAuth(request, response, db, options, user) {
  const { secureCookies, trustedProxyAddresses, mailerState, appOrigin } = options;
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    requireJsonBody(request);
    const body = request.body;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" && body.password.length <= MAX_PASSWORD_LENGTH ? body.password : "";
    const clientAddress = requestClientAddress(request, trustedProxyAddresses);
    const ipAttemptKey = hash(`login-ip:${clientAddress}`);
    const accountAttemptKey = hash(`login-account:${email}`);
    await recordAttempt(db, ipAttemptKey, 100);
    await recordAttempt(db, accountAttemptKey);
    const result = await db.query(
      `
      SELECT u.id,u.email,u.name,u.area,u.phone,u.role,u.status,u.working_hours AS "workingHours",
        u.available_days AS "availableDays",
        u.requires_password_change AS "requiresPasswordChange",to_char(u.joined_at,'YYYY-MM-DD') AS "joinedAt",c.password_hash
      FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.email=$1
    `,
      [email],
    );
    const account = result.rows[0];
    const passwordMatches = await verifyPassword(
      password,
      account?.password_hash ||
        "scrypt$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    );
    if (!account || !passwordMatches || account.status !== "Active") {
      await logSecurityEvent(db, email, account?.role || "resident", "Failed sign-in", `Failed sign-in attempt for ${email}`, "Failed", {
        resultReason: "Invalid credentials or inactive account",
        clientIp: clientAddress,
      });
      throw new HttpError(401, "Those sign-in details do not match an active account.");
    }
    await db.query("DELETE FROM auth_attempts WHERE attempt_key=$1", [accountAttemptKey]);
    await issueSession(response, db, account, Boolean(body.remember), secureCookies);
    await insertActivity(db, account, "Signed in", account.role);
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    sendJson(response, 200, { user: publicUser(account) });
    return true;
  }
  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    requireJsonBody(request);
    const body = request.body;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    await recordAttempt(db, hash(`register:${requestClientAddress(request, trustedProxyAddresses)}`));
    validateAccount({ email, name: body.name, area: body.area, phone: body.phone || "" });
    validatePassword(body.password);
    if (body.password !== body.confirmPassword) throw new HttpError(400, "The passwords do not match.");
    const id = randomUUID();
    const newUser = {
      id,
      email,
      name: body.name.trim(),
      area: body.area.trim(),
      phone: String(body.phone || "").trim(),
      role: "resident",
      status: "Active",
    };
    await assertKnownArea(db, newUser.area);
    await withTransaction(db, async (transaction) => {
      const db = transaction;
      await db.query("INSERT INTO users (id,email,name,area,phone,role,status) VALUES ($1,$2,$3,$4,$5,'resident','Active')", [
        id,
        email,
        newUser.name,
        newUser.area,
        newUser.phone,
      ]);
      await db.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)", [id, await passwordHash(body.password)]);
      await insertActivity(db, newUser, "Created resident account", `${newUser.name} · ${newUser.area}`);
      await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    }).catch((error) => {
      if (error.code === "23505") throw new HttpError(409, "An account already uses this email address.");
      throw error;
    });
    await issueSession(response, db, newUser, true, secureCookies);
    sendJson(response, 201, { user: publicUser(newUser) });
    return true;
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await db.query("DELETE FROM web_sessions WHERE token_hash=$1", [hash(token)]);
    response.setHeader("Set-Cookie", clearSessionCookie(secureCookies));
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/auth/change-email" && request.method === "POST") {
    requireRole(user, ROLES);
    requireJsonBody(request);
    await recordAttempt(db, hash(`change-email:${user.id}`), 5);
    const newEmail = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const currentPassword =
      typeof request.body.currentPassword === "string" && request.body.currentPassword.length <= MAX_PASSWORD_LENGTH
        ? request.body.currentPassword
        : "";
    validateAccount({ email: newEmail, name: user.name, area: user.area });
    if (newEmail === user.email) throw new HttpError(400, "Enter a different email address.");
    const credentials = await db.query("SELECT password_hash FROM user_credentials WHERE user_id=$1", [user.id]);
    if (!(await verifyPassword(currentPassword, credentials.rows[0]?.password_hash))) {
      throw new HttpError(400, "The current password is incorrect.");
    }
    const exists = await db.query("SELECT 1 FROM users WHERE email=$1 AND id<>$2", [newEmail, user.id]);
    if (exists.rows.length) throw new HttpError(409, "An account already uses this email address.");
    if (!mailerState.mailer) throw new HttpError(503, "Email service is not configured. Set up SMTP before changing your email address.");

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hash(rawToken);
    await withTransaction(db, async (transaction) => {
      await transaction.query("DELETE FROM email_change_tokens WHERE user_id=$1", [user.id]);
      await transaction.query(
        "INSERT INTO email_change_tokens(user_id,current_email,new_email,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+($5 || ' minutes')::interval)",
        [user.id, user.email, newEmail, tokenHash, String(EMAIL_CHANGE_TOKEN_MINUTES)],
      );
    });
    const verifyLink = `${emailLinkOrigin(request, appOrigin)}/#/verify-email?token=${rawToken}`;
    await mailerState.mailer.sendMail({
      from: mailerState.settings.from,
      to: newEmail,
      subject: "Confirm your CommUnity email address",
      text: `Confirm this email address for your CommUnity account (valid for ${EMAIL_CHANGE_TOKEN_MINUTES} minutes): ${verifyLink}\n\nIf you did not request this change, ignore this message.`,
    });
    sendJson(response, 200, {
      ok: true,
      message: `A verification link was sent to ${newEmail}. Your sign-in email will change after you confirm it.`,
    });
    return true;
  }
  if (url.pathname === "/api/auth/verify-email" && request.method === "POST") {
    requireJsonBody(request);
    await recordAttempt(db, hash(`verify-email:${requestClientAddress(request, trustedProxyAddresses)}`), RECOVERY_VERIFY_LIMIT * 4);
    const token = typeof request.body.token === "string" ? request.body.token : "";
    if (!token) throw new HttpError(400, "A valid verification token is required.");
    const pending = await db.query(
      "SELECT user_id,current_email,new_email FROM email_change_tokens WHERE token_hash=$1 AND expires_at>now()",
      [hash(token)],
    );
    if (!pending.rows.length) throw new HttpError(400, "This verification link is invalid or expired.");
    const { user_id: userId, current_email: currentEmail, new_email: newEmail } = pending.rows[0];
    try {
      await withTransaction(db, async (transaction) => {
        const account = await transaction.query("SELECT id,email,name,role FROM users WHERE id=$1 FOR UPDATE", [userId]);
        if (!account.rows.length || account.rows[0].email !== currentEmail) {
          throw new HttpError(400, "This verification link is no longer valid.");
        }
        const duplicate = await transaction.query("SELECT 1 FROM users WHERE email=$1 AND id<>$2", [newEmail, userId]);
        if (duplicate.rows.length) throw new HttpError(409, "An account already uses this email address.");
        await transaction.query("UPDATE users SET email=$1 WHERE id=$2", [newEmail, userId]);
        await transaction.query("DELETE FROM email_change_tokens WHERE user_id=$1", [userId]);
        await insertActivity(transaction, account.rows[0], "Changed account email", `${currentEmail} to ${newEmail}`);
        await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
      });
    } catch (error) {
      if (error.code === "23505") throw new HttpError(409, "An account already uses this email address.");
      throw error;
    }
    const sessionUser = user?.id === userId ? await getSessionUser(request, db) : null;
    sendJson(response, 200, { ok: true, user: sessionUser ? publicUser(sessionUser) : null });
    return true;
  }
  if (url.pathname === "/api/auth/password" && request.method === "POST") {
    requireRole(user, ROLES);
    requireJsonBody(request);
    const body = request.body;
    validatePassword(body.newPassword);
    if (body.newPassword !== body.confirmPassword) throw new HttpError(400, "The new passwords do not match.");
    const attemptKey = hash(`password-change:${user.id}`);
    await recordAttempt(db, attemptKey, 5);
    const current = await db.query("SELECT password_hash FROM user_credentials WHERE user_id=$1", [user.id]);
    if (!(await verifyPassword(String(body.currentPassword || ""), current.rows[0]?.password_hash))) {
      throw new HttpError(400, "The current password does not match this account.");
    }
    const token = cookieValue(request, SESSION_COOKIE);
    await db.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [await passwordHash(body.newPassword), user.id]);
    await db.query("UPDATE users SET requires_password_change=false WHERE id=$1", [user.id]);
    await db.query("DELETE FROM auth_attempts WHERE attempt_key=$1", [attemptKey]);
    await db.query("DELETE FROM web_sessions WHERE user_id=$1 AND token_hash<>$2", [user.id, hash(token)]);
    await insertActivity(db, user, "Changed account password", user.email);
    await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/auth/password-reset-request" && request.method === "POST") {
    requireJsonBody(request);
    await recordAttempt(db, hash(`password-reset-request:${requestClientAddress(request, trustedProxyAddresses)}`));
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const account = await db.query("SELECT id, email FROM users WHERE email=$1 AND status='Active'", [email]);
    if (account.rows[0]) {
      await db.query("INSERT INTO password_reset_requests(user_id) VALUES($1)", [account.rows[0].id]);
      const admins = await db.query("SELECT email FROM users WHERE role='administrator' AND status='Active'");
      if (admins.rows.length) {
        for (const admin of admins.rows)
          await insertNotification(db, admin.email, "Password reset requested", `${email} requested a password reset.`);
        // Administrator notifications are shared state, so the revision moves with them.
        await db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
      }
    }
    sendJson(response, 202, { ok: true });
    return true;
  }
  if (url.pathname === "/api/auth/forgot-password" && request.method === "POST") {
    requireJsonBody(request);
    const recoveryEmail = typeof request.body.recoveryEmail === "string" ? request.body.recoveryEmail.trim().toLowerCase() : "";
    const generic = { ok: true, message: "If an account uses that recovery email, a reset link has been sent." };
    if (!recoveryEmail) {
      sendJson(response, 200, generic);
      return true;
    }
    const clientAddress = requestClientAddress(request, trustedProxyAddresses);
    await recordAttempt(db, hash(`forgot-password-ip:${clientAddress}`), FORGOT_PASSWORD_IP_LIMIT);
    await recordAttempt(db, hash(`forgot-password-email:${recoveryEmail}`), FORGOT_PASSWORD_EMAIL_LIMIT);
    const { mailerState, appOrigin } = options;
    const mailer = mailerState.mailer;
    if (!mailer)
      throw new HttpError(503, "Email service is not configured. Ask an administrator to set up SMTP before requesting a password reset.");
    const cooldown = await db.query(
      "SELECT 1 FROM recovery_email_requests WHERE recovery_email=$1 AND last_requested_at > now() - ($2 || ' minutes')::interval",
      [recoveryEmail, String(RESET_EMAIL_COOLDOWN_MINUTES)],
    );
    if (cooldown.rows.length) {
      throw new HttpError(
        429,
        `A reset email was already sent to this address. Wait ${RESET_EMAIL_COOLDOWN_MINUTES} minutes before requesting another.`,
      );
    }
    // Recorded for every address so an unknown address behaves exactly like a known one.
    await db.query(
      "INSERT INTO recovery_email_requests (recovery_email, last_requested_at) VALUES ($1, now()) ON CONFLICT (recovery_email) DO UPDATE SET last_requested_at = now()",
      [recoveryEmail],
    );
    const account = await db.query("SELECT id, email FROM users WHERE recovery_email=$1 AND recovery_email_verified AND status='Active'", [
      recoveryEmail,
    ]);
    if (account.rows[0]) {
      const rawToken = randomBytes(32).toString("base64url");
      const tokenHash = hash(rawToken);
      // Earlier links stay usable until they expire or are used, so a repeat request cannot cancel a link already in someone's inbox.
      await db.query("DELETE FROM password_reset_tokens WHERE user_id=$1 AND expires_at <= now()", [account.rows[0].id]);
      await db.query(
        "INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES($1,$2, now() + ($3 || ' minutes')::interval)",
        [account.rows[0].id, tokenHash, String(RESET_TOKEN_MINUTES)],
      );
      const resetLink = `${emailLinkOrigin(request, appOrigin)}/#/reset-password?token=${rawToken}`;
      await mailer.sendMail({
        from: mailerState.settings.from,
        to: recoveryEmail,
        subject: "CommUnity password reset",
        text: `Reset your CommUnity password using this link (valid for ${RESET_TOKEN_MINUTES} minutes): ${resetLink}`,
      });
    }
    sendJson(response, 200, generic);
    return true;
  }
  if (url.pathname === "/api/auth/verify-recovery" && request.method === "POST") {
    requireJsonBody(request);
    await recordAttempt(db, hash(`verify-recovery:${requestClientAddress(request, trustedProxyAddresses)}`), RECOVERY_VERIFY_LIMIT * 4);
    const token = typeof request.body.token === "string" ? request.body.token : "";
    if (!token) throw new HttpError(400, "A valid verification token is required.");
    const result = await db.query(
      `
      SELECT t.user_id, t.email, u.recovery_email
      FROM recovery_email_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash=$1 AND t.expires_at > now()
    `,
      [hash(token)],
    );
    if (!result.rows.length) throw new HttpError(400, "This verification link is invalid or expired.");
    if (result.rows[0].recovery_email !== result.rows[0].email) throw new HttpError(400, "This verification link is no longer valid.");
    await withTransaction(db, async (transaction) => {
      await transaction.query("UPDATE users SET recovery_email_verified=true WHERE id=$1", [result.rows[0].user_id]);
      await transaction.query("DELETE FROM recovery_email_tokens WHERE user_id=$1", [result.rows[0].user_id]);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/auth/request-admin-reset" && request.method === "POST") {
    requireJsonBody(request);
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const generic = { ok: true, message: "If an account exists, an admin has been notified." };
    await recordAttempt(db, hash(`admin-reset-ip:${requestClientAddress(request, trustedProxyAddresses)}`), FORGOT_PASSWORD_IP_LIMIT);
    if (email) await recordAttempt(db, hash(`admin-reset-email:${email}`), FORGOT_PASSWORD_EMAIL_LIMIT);
    if (email) {
      const account = await db.query("SELECT id FROM users WHERE email=$1 AND status='Active'", [email]);
      if (account.rows[0]) {
        // The flag and the administrator notices are one change to shared state,
        // so they land in one transaction that also advances the revision.
        await withTransaction(db, async (transaction) => {
          await transaction.query("UPDATE users SET reset_requested=true WHERE id=$1", [account.rows[0].id]);
          const admins = await transaction.query("SELECT email FROM users WHERE role='administrator' AND status='Active'");
          for (const admin of admins.rows)
            await insertNotification(
              transaction,
              admin.email,
              "Password reset requested",
              `${email} requested admin help to reset their password.`,
            );
          await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
        });
      }
    }
    sendJson(response, 200, generic);
    return true;
  }
  if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
    requireJsonBody(request);
    const token = typeof request.body.token === "string" ? request.body.token : "";
    const newPassword = typeof request.body.newPassword === "string" ? request.body.newPassword : "";
    validatePassword(newPassword);
    if (!token) throw new HttpError(400, "A valid reset token is required.");
    const tokenHash = hash(token);
    // A cheap lookup rejects garbage links without opening a transaction; the
    // authoritative consume happens inside it, so this cannot admit two wins.
    const lookup = await db.query("SELECT user_id FROM password_reset_tokens WHERE token_hash=$1 AND expires_at > now()", [tokenHash]);
    if (!lookup.rows.length) throw new HttpError(400, "This reset link is invalid or expired.");
    const userId = lookup.rows[0].user_id;
    await withTransaction(db, async (transaction) => {
      // One account resets at a time. Locking the user row first gives every
      // concurrent link for that account a single serialization point, so the
      // token consumption and the purge of the account's remaining links can
      // never interleave into a deadlock.
      await transaction.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      // Consuming is the delete itself: a second request sharing this link
      // finds nothing left to consume and is rejected before any password is
      // written. Exactly one consumed row is required.
      const consumed = await transaction.query("DELETE FROM password_reset_tokens WHERE token_hash=$1 AND expires_at > now()", [tokenHash]);
      if (Number(consumed.rowCount) !== 1) throw new HttpError(400, "This reset link is invalid or expired.");
      // Any other outstanding links for the account stop working with it.
      await transaction.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [userId]);
      await transaction.query("UPDATE user_credentials SET password_hash=$1 WHERE user_id=$2", [await passwordHash(newPassword), userId]);
      await transaction.query("UPDATE users SET requires_password_change=false WHERE id=$1", [userId]);
      await transaction.query("DELETE FROM web_sessions WHERE user_id=$1", [userId]);
      await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    });
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/session" && request.method === "GET") {
    sendJson(response, 200, { user: publicUser(user) });
    return true;
  }
  return false;
}
