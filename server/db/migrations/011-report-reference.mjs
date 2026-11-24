// 011 — one short, stable reference per concern. The internal text id stays the
// key used by uploads, links and notifications; this number is only what people
// read, say aloud and search for (R-0001). Existing concerns are numbered in
// submission order so old records look the same as new ones.
export default {
  version: 11,
  name: "report_reference",
  statements: [
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS reference integer`,
    `CREATE SEQUENCE IF NOT EXISTS report_reference_seq`,
    `WITH ordered AS (
       SELECT id, row_number() OVER (ORDER BY submitted_at, id) AS position
       FROM reports
       WHERE reference IS NULL
     )
     UPDATE reports r SET reference = ordered.position
     FROM ordered WHERE r.id = ordered.id`,
    `SELECT setval('report_reference_seq', COALESCE((SELECT max(reference) FROM reports), 0) + 1, false)`,
    `ALTER TABLE reports ALTER COLUMN reference SET DEFAULT nextval('report_reference_seq')`,
    `CREATE UNIQUE INDEX IF NOT EXISTS reports_reference_unique ON reports (reference)`,
    `ALTER TABLE reports ALTER COLUMN reference SET NOT NULL`,
  ],
};
