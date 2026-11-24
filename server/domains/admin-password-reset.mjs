import { passwordHash } from "../platform/crypto.mjs";
import { validatePassword } from "../platform/validate.mjs";
import { withTransaction } from "../platform/db.mjs";

export async function resetAdministratorPassword(db, email, password) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail) throw new Error("Enter the active administrator's email address.");
  validatePassword(password);
  const encoded = await passwordHash(password);

  await withTransaction(db, async (transaction) => {
    const result = await transaction.query("SELECT id FROM users WHERE email=$1 AND role='administrator' AND status='Active' FOR UPDATE", [
      normalizedEmail,
    ]);
    const user = result.rows[0];
    if (!user) throw new Error("No active administrator account matches that email.");

    await transaction.query(
      `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
      [user.id, encoded],
    );
    await transaction.query("DELETE FROM web_sessions WHERE user_id=$1", [user.id]);
    await transaction.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [user.id]);
    await transaction.query("DELETE FROM email_change_tokens WHERE user_id=$1", [user.id]);
    await transaction.query("DELETE FROM recovery_email_tokens WHERE user_id=$1", [user.id]);
    await transaction.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
  });
}
