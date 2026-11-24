// 015 — duplicate detection must ignore formatting differences in ID numbers
// (case, spaces, dashes) and compare the same ID type. The printed id_number is
// kept untouched for display; the canonical column is only used for uniqueness.
export default {
  version: 15,
  name: "id_number_canonical",
  statements: [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number_canonical text NOT NULL DEFAULT ''`,
    `UPDATE users SET id_number_canonical = regexp_replace(lower(id_number), '[ -]', '', 'g') WHERE id_number <> ''`,
    // Older versions allowed "A-123" and "A123" for the same ID type. Keep the
    // first row and reject the rest, or the unique index below aborts startup.
    `UPDATE users SET id_status='rejected', id_number_canonical=''
       WHERE id_status IN ('pending','verified') AND id_number_canonical <> ''
         AND ctid NOT IN (
           SELECT DISTINCT ON (id_type, id_number_canonical) ctid
           FROM users
           WHERE id_status IN ('pending','verified') AND id_number_canonical <> ''
           ORDER BY id_type, id_number_canonical, ctid
         )`,
    `DROP INDEX IF EXISTS users_id_number_unique`,
    `CREATE UNIQUE INDEX IF NOT EXISTS users_id_number_canonical_unique ON users (id_type, id_number_canonical) WHERE id_status IN ('pending','verified') AND id_number_canonical <> ''`,
  ],
};
