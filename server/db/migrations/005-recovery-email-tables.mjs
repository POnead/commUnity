// Migration 5: restore recovery-email tables for databases created before they
// were added to the recorded initial migration.
export default {
  version: 5,
  name: "recovery_email_tables",
  statements: [
    `CREATE TABLE IF NOT EXISTS recovery_email_tokens (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL, token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS recovery_email_requests (
  recovery_email text PRIMARY KEY, last_requested_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE INDEX IF NOT EXISTS recovery_email_tokens_user_idx ON recovery_email_tokens(user_id);`,
  ],
};
