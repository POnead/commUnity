import { defineConfig } from "@playwright/test";

// The e2e suite boots a real server on a real port against a throwaway
// embedded database, then drives a real browser through the critical paths.
// Tests share one server, so they are serial and self-contained: each test
// seeds what it needs via the API and cleans nothing up (fresh database per
// run, discarded when the server stops).
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.mjs",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8799",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node test/e2e/launch.mjs",
    url: "http://127.0.0.1:8799/api/healthz",
    timeout: 60_000,
    reuseExistingServer: false,
    env: { E2E_PORT: "8799" },
  },
});
