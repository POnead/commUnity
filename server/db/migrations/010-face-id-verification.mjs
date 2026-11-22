// 010 — opt-in identity verification. Residents submit a government ID for
// staff review and earn a "Verified resident" badge; officials enroll a face
// reference for the optional shift duty check. Nothing here touches account
// status or any existing workflow.
export default {
  version: 10,
  name: "face_id_verification",
  statements: [
    // Face verification (staff). References are 128-float embeddings only —
    // no face image is stored.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS face_references jsonb NOT NULL DEFAULT '[]'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrolled_at timestamptz`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS face_liveness_verified boolean NOT NULL DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_face_verified_at timestamptz`,
    // ID verification (residents). The images are files under UPLOADS_DIR; the
    // columns hold who/where/what, never the pixels.
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_image_filename text NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_back_image_filename text NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_type text NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number text NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_full_name text NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_birth_date date`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_status text NOT NULL DEFAULT 'unverified'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_review_note text NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_reviewed_at timestamptz`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_reviewed_by text NOT NULL DEFAULT ''`,
    // Explicit consent is required before an ID leaves the resident's device (RA 10173).
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_consent_at timestamptz`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS id_submitted_at timestamptz`,
    `DO $$ BEGIN ALTER TABLE users ADD CONSTRAINT users_id_status_check CHECK (id_status IN ('unverified','pending','verified','rejected')); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    // One ID number per resident, across both pending and verified records. Leading
    // zeros are preserved because the number is text; rejected rows free the number.
    `CREATE UNIQUE INDEX IF NOT EXISTS users_id_number_unique ON users (id_type, lower(id_number)) WHERE id_status IN ('pending','verified') AND id_number <> ''`,
  ],
};
