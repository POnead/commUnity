// 013 — an official who signs in while their duty window has expired (or who
// has never enrolled) gets a restricted session until the face gate completes.
// The pending flag lives on the session, not the account: a new sign-in starts
// a fresh evaluation of the duty window.
export default {
  version: 13,
  name: "face_check_pending",
  statements: [`ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS face_check_pending boolean NOT NULL DEFAULT false`],
};
