import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { logError } from "./log.mjs";

// The SMTP password is stored AES-GCM encrypted in the database (see crypto.mjs).
// The key for that encryption lives in a file next to the data directory, never
// inside the database, so a database-only leak (an exported settings table, a
// query log) cannot reveal the mailbox password. The key is generated once on
// first boot.
//
// Operators who want the key managed separately — for example on a managed
// database where the whole project directory is backed up — can set
// SMTP_SETTINGS_KEY instead; then this file is not created or used.
//
// Note: a full backup of the directory holding the key reveals it, just as a
// full backup of the environment would. That is the trade-off for zero setup.
export async function resolveSmtpKey({ dataDir, envKey }) {
  if (envKey && String(envKey).trim()) {
    return { key: String(envKey).trim(), source: "environment" };
  }
  const keyPath = path.join(path.dirname(path.resolve(dataDir)), "smtp-settings.key");
  try {
    const existing = await readFile(keyPath, "utf8");
    const trimmed = existing.trim();
    if (!trimmed) throw new Error("the key file is empty");
    return { key: trimmed, source: "file" };
  } catch (error) {
    if (error.code !== "ENOENT") {
      logError(`CommUnity could not read the local SMTP settings key at ${keyPath}.`, error);
      return { key: null, source: "unavailable", keyPath };
    }
  }
  try {
    await mkdir(path.dirname(keyPath), { recursive: true });
    const key = randomBytes(32).toString("base64");
    // 0o600 so other local accounts cannot read the key; a no-op on Windows,
    // where ACLs already restrict the data directory.
    await writeFile(keyPath, `${key}\n`, { mode: 0o600, flag: "wx" });
    console.log(`CommUnity generated a local SMTP settings key at ${keyPath}. Set SMTP_SETTINGS_KEY to manage the key yourself.`);
    return { key, source: "generated" };
  } catch (writeError) {
    // Two instances booting at the same time may race; the loser simply adopts the winner's key.
    if (writeError.code === "EEXIST") {
      try {
        const existing = await readFile(keyPath, "utf8");
        const trimmed = existing.trim();
        if (trimmed) return { key: trimmed, source: "file" };
      } catch (readError) {
        logError(`CommUnity could not read the local SMTP settings key at ${keyPath}.`, readError);
      }
    } else {
      logError(`CommUnity could not write the local SMTP settings key at ${keyPath}.`, writeError);
    }
    return { key: null, source: "unavailable", keyPath };
  }
}
