// 012 — optional third-party verification. Face++ face tokens sit beside the
// existing on-device descriptors; OCR needs no new column (it only suggests
// fields the resident still confirms). Both features stay off until an admin
// turns them on, so existing deployments keep their local-only behaviour.
export default {
  version: 12,
  name: "facepp_verification",
  statements: [`ALTER TABLE users ADD COLUMN IF NOT EXISTS facepp_tokens jsonb NOT NULL DEFAULT '[]'`],
};
