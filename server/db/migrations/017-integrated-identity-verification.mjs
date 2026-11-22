// 017 — integrated identity verification. Residents keep ID-only checks;
// officials get the full ID + face sequence. The face columns are a receipt
// for a passing Face++ match, not a place to store face images.
export default {
  version: 17,
  name: "integrated_identity_verification",
  statements: [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_address text NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_expiration_date date`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_face_status text NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_face_distance numeric`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_face_checked_at timestamptz`,
  ],
};
