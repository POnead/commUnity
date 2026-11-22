// 019 — photo upload drafts. An upload directory may only be created for a
// report id the server has issued a token for, so a signed-in resident cannot
// mint directories for arbitrary ids. Tokens expire and are capped per account.
export default {
  version: 19,
  name: "photo_drafts",
  statements: [
    `CREATE TABLE IF NOT EXISTS photo_drafts (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS photo_drafts_user_idx ON photo_drafts (user_id, expires_at)`,
  ],
};
