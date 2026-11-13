import { HttpError } from "./http.mjs";

export async function recordAttempt(db, key, limit = 10) {
  const result = await db.query(
    `
    INSERT INTO auth_attempts (attempt_key, attempts, window_started_at) VALUES ($1, 1, now())
    ON CONFLICT (attempt_key) DO UPDATE SET
      attempts = CASE WHEN auth_attempts.window_started_at < now() - interval '5 minutes' THEN 1 ELSE auth_attempts.attempts + 1 END,
      window_started_at = CASE WHEN auth_attempts.window_started_at < now() - interval '5 minutes' THEN now() ELSE auth_attempts.window_started_at END
    RETURNING attempts
  `,
    [key],
  );
  if (Number(result.rows[0].attempts) > limit) throw new HttpError(429, "Too many attempts. Wait 5 minutes and try again.");
}

export async function pruneExpiredAuthState(db) {
  const attempts = await db.query("DELETE FROM auth_attempts WHERE window_started_at < now() - interval '24 hours'");
  const sessions = await db.query("DELETE FROM web_sessions WHERE expires_at <= now()");
  await db.query("DELETE FROM password_reset_tokens WHERE expires_at <= now()");
  await db.query("DELETE FROM recovery_email_tokens WHERE expires_at <= now()");
  await db.query("DELETE FROM recovery_email_requests WHERE last_requested_at < now() - interval '24 hours'");
  return { attempts: attempts.rowCount, sessions: sessions.rowCount };
}
