// 016 — keep what OCR read at scan time so an administrator can compare it
// with the details the resident submitted. Stored as one JSONB blob; no new
// indexes because it is display-only and never used for decisions.
export default {
  version: 16,
  name: "id_scan_checks",
  statements: [`ALTER TABLE users ADD COLUMN IF NOT EXISTS id_scan_checks jsonb NOT NULL DEFAULT '{}'::jsonb`],
};
