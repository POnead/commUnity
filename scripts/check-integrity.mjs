// Fail loudly when a workspace snapshot restores an older version of a file.
// A silent revert is far worse than a start that refuses to boot.
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const checks = [
  ["package.json", "node --env-file-if-exists=.env", "start script must load .env"],
  ["server/handle-api.mjs", "/api/map-config", "map config endpoint must be registered"],
  ["server/platform/http-app.mjs", "shared/hotlines.mjs", "static allowlist must serve shared modules"],
  ["server/index.mjs", "createOcrClient", "server must wire the OCR/Face++ clients"],
  ["app/main.mjs", "verificationPage", "SPA must render the verification page"],
  ["app/views.mjs", "hotlinesPage", "SPA must render the hotline directory"],
];

const problems = [];
for (const [file, marker, why] of checks) {
  try {
    const text = await read(file);
    if (!text.includes(marker)) problems.push(`${file}: missing ${JSON.stringify(marker)} (${why})`);
  } catch {
    problems.push(`${file}: missing file (${why})`);
  }
}

try {
  await access(path.join(root, ".env"));
} catch {
  problems.push(".env: missing provider keys (run: npm start, or restore from ~/.commUnity/env)");
}

if (problems.length) {
  console.error("[integrity] The workspace looks reverted to an older snapshot:");
  for (const problem of problems) console.error("  - " + problem);
  console.error("[integrity] Restore the latest committed files, then run npm start again.");
  process.exit(1);
}
console.log("[integrity] workspace wiring OK");
