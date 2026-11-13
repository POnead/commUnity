// Starts a fresh, self-contained CommUnity server for the Playwright tests:
// a throwaway PGlite database and uploads directory in the system temp dir,
// a seeded administrator, no external services. The Playwright webServer
// waits on /api/healthz, then runs the suite against one shared instance,
// so the tests must not depend on execution order beyond what they set up.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCommunityServer } from "../../server/index.mjs";

const port = Number(process.env.E2E_PORT || 8799);
const dataDir = mkdtempSync(path.join(tmpdir(), "community-e2e-pglite-"));
const uploadsDir = mkdtempSync(path.join(tmpdir(), "community-e2e-uploads-"));
writeFileSync(path.join(dataDir, ".e2e-marker"), new Date().toISOString());

const { server, close } = await createCommunityServer({
  dataDir,
  uploadsDir,
  initialAdminEmail: process.env.E2E_ADMIN_EMAIL || "admin@example.test",
  initialAdminPassword: process.env.E2E_ADMIN_PASSWORD || "AdminTestPassword-2026!",
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CommUnity e2e server on http://127.0.0.1:${port} (fresh database in ${dataDir})`);
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  try {
    await close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(uploadsDir, { recursive: true, force: true });
  } finally {
    process.exit(0);
  }
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("exit", () => process.stdout.write("e2e server exiting\n"));
