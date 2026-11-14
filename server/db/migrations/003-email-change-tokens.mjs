export default {
  version: 3,
  name: "email_change_tokens",
  statements: [
    `CREATE TABLE IF NOT EXISTS email_change_tokens (
  id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_email text NOT NULL, new_email text NOT NULL, token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE INDEX IF NOT EXISTS email_change_tokens_user_idx ON email_change_tokens(user_id);`,
  ],
};
