// Workspace snapshots restore tracked files but drop gitignored ones (.env).
// Keep a copy outside the repository and restore it on every start, so provider
// keys never silently disappear again.
import { copyFile, access, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnv = path.join(projectDir, ".env");
const backupDir = path.join(os.homedir(), ".commUnity");
const backupEnv = path.join(backupDir, "env");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(localEnv))) {
  if (await exists(backupEnv)) {
    await copyFile(backupEnv, localEnv);
    console.warn(`[env] Restored .env from ${backupEnv} — the workspace snapshot had dropped it.`);
  } else {
    console.warn(`[env] No .env and no backup at ${backupEnv}. Copy .env.example to .env and fill in your keys.`);
  }
} else if (!(await exists(backupEnv))) {
  // First run on a machine with keys already in .env: seed the backup.
  await mkdir(backupDir, { recursive: true });
  await copyFile(localEnv, backupEnv);
  console.warn(`[env] Seeded backup at ${backupEnv} from the existing .env.`);
}
