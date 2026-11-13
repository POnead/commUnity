import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

// Not a password hash — a fast one-way digest used to fingerprint tokens,
// rate-limit buckets and denial-of-service keys. Never use this for secrets
// someone chooses; those go through passwordHash.
export function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function passwordHash(password) {
  const salt = randomBytes(16);
  const result = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${result.toString("hex")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltHex, digestHex] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(digestHex)) return false;
  const digest = await scrypt(password, Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(digest, Buffer.from(digestHex, "hex"));
}

export function encryptSettings(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSettings(value, key) {
  const [iv, tag, encrypted] = String(value)
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
}
