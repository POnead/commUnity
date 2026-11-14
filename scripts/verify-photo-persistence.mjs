// Rehearse what happens to uploaded photos across a redeploy with and without a
// persistent upload directory — no hosting provider required.
//
// Boots the real server against a PGlite data directory (under the temp dir)
// and a separate uploads directory, registers a resident, submits a concern with
// a photo, then restarts the server twice pointing at different storage:
//
//   1. same data directory + same uploads directory (persistent volume):
//      the photo still resolves 200 OK;
//   2. same data directory + a fresh uploads directory (ephemeral storage):
//      the photo resolves 404, while the concern and its filename remain in the DB.
//
// This is the concrete evidence behind the "photos need a persistent volume"
// requirement in the deployment notes.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createCommunityServer } from "../server/index.mjs";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function multipart(boundary, fields, files) {
  const chunks = [];
  const push = (value) => chunks.push(typeof value === "string" ? Buffer.from(value) : value);
  for (const { name, value } of fields) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  for (const { name, filename, content, type } of files) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
    push(content);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);
  return Buffer.concat(chunks);
}

function request(port, { method = "GET", path: requestPath = "/", body, headers = {}, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: requestPath, method, headers: { connection: "close", ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, body: binary ? buffer : buffer.toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function cookieFrom(res) {
  return (res.headers["set-cookie"] || []).map((value) => value.split(";")[0]).join("; ");
}

async function boot(dataDir, uploadsDir) {
  const instance = await createCommunityServer({
    dataDir,
    uploadsDir,
    port: 0,
    initialAdminEmail: "photos@example.test",
    initialAdminPassword: "PhotoRehearsalAdmin-2026!",
  });
  await new Promise((resolve, reject) => {
    instance.server.once("error", reject);
    instance.server.listen(0, "127.0.0.1", resolve);
  });
  const port = instance.server.address().port;
  return { ...instance, port };
}

async function main() {
  const base = await mkdtemp(path.join(os.tmpdir(), "community-photo-rehearsal-"));
  const dataDir = path.join(base, "data");
  const uploadsDir = path.join(base, "uploads");
  let app;
  const log = (...args) => console.log(...args);
  try {
    app = await boot(dataDir, uploadsDir);
    const port1 = app.port;

    const register = await request(port1, {
      method: "POST",
      path: "/api/auth/register",
      headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port1}` },
      body: JSON.stringify({
        name: "Photo Rehearsal Resident",
        email: "photo@example.test",
        phone: "09181112222",
        area: "Purok 1",
        password: "PhotoRehearsalResident-2026!",
        confirmPassword: "PhotoRehearsalResident-2026!",
      }),
    });
    assert.equal(register.status, 201, register.body);
    const cookie = cookieFrom(register);

    const boundary = "----PhotoRehearsalBoundary";
    const reportId = `R-PHOTO-${Date.now()}`;
    const upload = await request(port1, {
      method: "POST",
      path: `/api/report-photos?reportId=${encodeURIComponent(reportId)}`,
      headers: {
        Origin: `http://127.0.0.1:${port1}`,
        Cookie: cookie,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: multipart(boundary, [], [{ name: "photos", filename: "containment.png", content: PNG, type: "image/png" }]),
    });
    assert.equal(upload.status, 201, upload.body);
    const { photos } = JSON.parse(upload.body);

    const state = await request(port1, { path: "/api/state", headers: { Cookie: cookie } });
    const parsed = JSON.parse(state.body);
    const now = new Date().toISOString();
    const report = {
      id: reportId,
      userEmail: "photo@example.test",
      name: "Photo Rehearsal Resident",
      category: "Drainage problem",
      title: "Photo rehearsal concern",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Beside the covered court",
      description: "Photo rehearsal concern with a sufficiently long description.",
      priority: "Medium",
      urgent: false,
      submittedAt: now,
      updatedAt: now,
      status: "Submitted",
      assignedTo: null,
      responseDeadline: null,
      respondedAt: null,
      resolutionDeadline: null,
      resolvedAt: null,
      history: [{ status: "Submitted", at: now, note: "Received.", actorName: "Photo Rehearsal Resident", actorRole: "resident" }],
      photos: [{ name: "containment.png", photoUrl: photos[0].photoUrl }],
    };
    parsed.data.reports.push(report);
    const save = await request(port1, {
      method: "PUT",
      path: "/api/state",
      headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port1}`, Cookie: cookie },
      body: JSON.stringify({ data: parsed.data, revision: parsed.revision }),
    });
    assert.equal(save.status, 200, save.body);

    await app.close();

    // 1. A restart with the same uploads directory (persistent volume).
    app = await boot(dataDir, uploadsDir);
    const port2 = app.port;
    const login = await request(port2, {
      method: "POST",
      path: "/api/auth/login",
      headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port2}` },
      body: JSON.stringify({ email: "photo@example.test", password: "PhotoRehearsalResident-2026!" }),
    });
    assert.equal(login.status, 200, login.body);
    const cookie2 = cookieFrom(login);
    const persistent = await request(port2, { path: photos[0].photoUrl, headers: { Cookie: cookie2 }, binary: true });
    assert.equal(persistent.status, 200, "the photo must survive a restart with the uploads directory intact");
    assert.equal(persistent.headers["content-type"], "image/png");

    await app.close();

    // 2. A restart against an empty uploads directory (ephemeral storage, database intact).
    const freshUploads = path.join(base, "uploads-fresh");
    app = await boot(dataDir, freshUploads);
    const port3 = app.port;
    const login2 = await request(port3, {
      method: "POST",
      path: "/api/auth/login",
      headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${port3}` },
      body: JSON.stringify({ email: "photo@example.test", password: "PhotoRehearsalResident-2026!" }),
    });
    assert.equal(login2.status, 200, login2.body);
    const cookie3 = cookieFrom(login2);
    const photoBody = await request(port3, { path: photos[0].photoUrl, headers: { Cookie: cookie3 } });
    const reportRow = await request(port3, { path: "/api/state", headers: { Cookie: cookie3 } });
    const parsedState = JSON.parse(reportRow.body);
    const stored = parsedState.data.reports.find((item) => item.id === reportId);
    assert.ok(stored, "the concern must still be on file after the uploads directory was lost");
    assert.equal(photoBody.status, 404, "without a persistent uploads directory the photo must be gone while the record remains");

    log("ok   photo upload and retrieval across a restart with a persistent uploads directory");
    log("ok   the documented failure mode: a fresh uploads directory loses photos while the concern remains on file");
    log(`\nPhoto persistence rehearsal passed (data directory reused, ${path.relative(process.cwd(), uploadsDir)}).`);
  } finally {
    if (app) await app.close().catch(() => {});
    await rm(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }).catch(() => {});
  }
}

await main();
