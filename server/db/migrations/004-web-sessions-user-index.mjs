// Migration 4: the session table is scanned by user_id on every password change,
// admin reset and deactivation; the prune job scans it by expiry (already covered).
export default {
  version: 4,
  name: "web_sessions_user_index",
  statements: [
    `CREATE INDEX IF NOT EXISTS web_sessions_user_idx ON web_sessions(user_id);`,
  ],
};
