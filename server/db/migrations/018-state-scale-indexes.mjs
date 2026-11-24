// 018 — indexes for the staff workspace reads. The concern queue orders the
// whole report list by submission time, and the ID review queue filters pending
// accounts by submission date. Both are read on every state poll.
export default {
  version: 18,
  name: "state_scale_indexes",
  statements: [
    `CREATE INDEX IF NOT EXISTS reports_submitted_idx ON reports (submitted_at DESC, id)`,
    `CREATE INDEX IF NOT EXISTS users_pending_id_idx ON users (id_submitted_at NULLS LAST, email) WHERE id_status='pending'`,
  ],
};
