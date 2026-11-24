// 014 — a new official must enroll a face at first sign-in. If they leave
// before enrolling, the account locks until an administrator enrolls it.
// Legacy officials keep 'none' (self-enroll as before); only new accounts start
// as 'pending', so this migration never locks out an existing user.
export default {
  version: 14,
  name: "face_enrollment_state",
  statements: [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrollment_state text NOT NULL DEFAULT 'none'`,
    `UPDATE users SET face_enrollment_state='enrolled' WHERE role='official' AND (
      (jsonb_typeof(face_references)='array' AND jsonb_array_length(face_references)>0)
      OR (jsonb_typeof(facepp_tokens)='array' AND jsonb_array_length(facepp_tokens)>0)
    )`,
  ],
};
