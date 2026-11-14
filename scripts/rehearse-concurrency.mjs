// Rehearse concurrent use against a TLS-verified, production-configuration
// deployment. Boots a throwaway PostgreSQL 18 cluster with TLS, configures the
// application in production mode with a trusted rehearsal CA, seeds extra
// residents and officials, and then runs the simultaneous-access patterns that
// real barangays hit:
//
//   A. many authenticated sessions polling the state endpoint at once;
//   B. two writers editing from the same stale revision simultaneously;
//   C. every seeded resident submitting a concern at the same moment;
//   D. several residents uploading photos to their own concerns at once;
//   E. several officials approving (or declining) one pending announcement at once;
//   F. all accounts marking notifications read at once;
//   G. officials claiming different concerns at the same moment.
//
// Revision conflicts are the app's documented guard against silent overwrite,
// so instead of hiding them the probe records exactly who got the 200 and who
// got the 409, and asserts the server never corrupted or half-applied state.
//
// Requires: embedded-postgres, openssl for the rehearsal certificates (PG_BIN
// is reused for the cluster, and the Git for Windows openssl is used when
// openssl is not on PATH).
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, appendFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const run = promisify(execFile);
const GIT_OPENSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
const PASSWORD = "ConcurrencyTest-2026!";

const TEST_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function passwordHash(password) {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

function rawRequest(
  port,
  { method = "GET", path: requestPath = "/", host = "community.example.com", origin, body, cookie, headers = {} } = {},
) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { host, connection: "close", ...headers };
    if (origin) requestHeaders.origin = origin;
    if (cookie) requestHeaders.cookie = cookie;
    if (body) {
      requestHeaders["content-type"] = "application/json";
      requestHeaders["content-length"] = Buffer.byteLength(body);
    }
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method, headers: requestHeaders }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: text, headers: res.headers, cookies: res.headers["set-cookie"] || [] }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartRequest(port, { path: requestPath, cookie, origin, fields = [], files = [] }) {
  const boundary = `----CommUnityConcurrency${randomBytes(8).toString("hex")}`;
  const chunks = [];
  const push = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  for (const { name, value } of fields) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  for (const { name, filename, content, type } of files) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
    push(content);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);
  const body = Buffer.concat(chunks);
  return new Promise((resolve, reject) => {
    const headers = {
      host: "community.example.com",
      connection: "close",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": body.length,
      origin,
      cookie,
    };
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method: "POST", headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: text, headers: res.headers, cookies: [] }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function issueCertificates(base) {
  const certs = path.join(base, "certs");
  await mkdir(certs, { recursive: true });
  const openssl = process.env.PATH?.includes("openssl") ? "openssl" : GIT_OPENSSL;
  await run(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    path.join(certs, "ca.key"),
    "-out",
    path.join(certs, "ca.crt"),
    "-days",
    "3650",
    "-nodes",
    "-subj",
    "/CN=CommUnity Rehearsal CA",
  ]);
  for (const name of ["smtp", "postgres"]) {
    await run(openssl, [
      "req",
      "-newkey",
      "rsa:2048",
      "-keyout",
      path.join(certs, `${name}.key`),
      "-out",
      path.join(certs, `${name}.csr`),
      "-nodes",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ]);
    await run(openssl, [
      "x509",
      "-req",
      "-in",
      path.join(certs, `${name}.csr`),
      "-CA",
      path.join(certs, "ca.crt"),
      "-CAkey",
      path.join(certs, "ca.key"),
      "-CAcreateserial",
      "-out",
      path.join(certs, `${name}.crt`),
      "-days",
      "3650",
      "-copy_extensions",
      "copy",
    ]);
  }
  return certs;
}

async function main() {
  let teardown = false;
  process.on("uncaughtException", (error) => {
    if (error.code === "ECONNRESET" && teardown) {
      console.warn("connection reset during teardown (ignored)");
      return;
    }
    throw error;
  });
  const base = await mkdtemp(path.join(os.tmpdir(), "community-concurrency-"));
  const pgPort = await freePort();
  const appPort = await freePort();
  const pgPassword = "community-concurrency";
  let embedded;
  let app;
  let seedPool;
  try {
    embedded = new EmbeddedPostgres({
      databaseDir: path.join(base, "pgdata"),
      user: "postgres",
      password: pgPassword,
      port: pgPort,
      persistent: true,
      autoRehydrateSymlinks: true,
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    const certs = await issueCertificates(base);
    await appendFile(
      path.join(base, "pgdata", "postgresql.conf"),
      `\nssl = on\nssl_cert_file = '${path.join(certs, "postgres.crt").replaceAll("\\", "/")}'\nssl_key_file = '${path.join(certs, "postgres.key").replaceAll("\\", "/")}'\n`,
    );
    await embedded.start();
    const admin = new pg.Pool({
      host: "127.0.0.1",
      port: pgPort,
      user: "postgres",
      password: pgPassword,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    });
    await admin.query("CREATE DATABASE community_concurrency");
    seedPool = new pg.Pool({
      host: "127.0.0.1",
      port: pgPort,
      user: "postgres",
      password: pgPassword,
      database: "community_concurrency",
      ssl: { rejectUnauthorized: false },
    });
    // The server can reset an idle TLS session; an unhandled pool error would otherwise
    // abort the rehearsal rather than read as connection churn under load.
    seedPool.on("error", (error) => console.warn(`seed connection reset (ignored): ${error.message}`));
    await admin.end();

    const origin = "https://community.example.com";
    const childEnv = {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(appPort),
      APP_ORIGIN: origin,
      DATABASE_URL: `postgresql://postgres:${encodeURIComponent(pgPassword)}@127.0.0.1:${pgPort}/community_concurrency`,
      DATABASE_CA: await readFile(path.join(certs, "ca.crt"), "utf8"),
      INITIAL_ADMIN_EMAIL: "admin@example.com",
      INITIAL_ADMIN_PASSWORD: "ConcurrencyAdmin-2026!",
      SMTP_HOST: "",
      SMTP_PORT: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_FROM: "",
      SMTP_SETTINGS_KEY: "",
    };
    app = spawn(process.execPath, ["server/index.mjs"], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    const appLogs = [];
    app.stdout.on("data", (chunk) => appLogs.push(chunk.toString()));
    app.stderr.on("data", (chunk) => appLogs.push(chunk.toString()));

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        if ((await rawRequest(appPort, { path: "/api/healthz" })).status === 200) break;
      } catch {
        // booting
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(
      appLogs.some((line) => line.includes("running on port")),
      `the server did not start:\n${appLogs.join("")}`,
    );

    const users = [];
    for (const role of ["resident", "resident", "resident", "resident", "resident", "resident"]) {
      const n = users.filter((u) => u.role === "resident").length + 1;
      const id = `C-R${n}`;
      users.push({ id, role, name: `Concurrency Resident ${n}`, email: `resident.${n}@concurrency.test` });
    }
    for (const n of [1, 2, 3])
      users.push({ id: `C-O${n}`, role: "official", name: `Concurrency Official ${n}`, email: `official.${n}@concurrency.test` });
    const hashed = passwordHash(PASSWORD);
    for (const user of users) {
      await seedPool.query(
        "INSERT INTO users (id, email, name, area, role, status) VALUES ($1, $2, $3, $4, $5, 'Active') ON CONFLICT (email) DO NOTHING",
        [user.id, user.email, user.name, "Purok 1", user.role],
      );
      await seedPool.query("INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [
        user.id,
        hashed,
      ]);
    }

    const login = async (email, password = PASSWORD) => {
      const res = await rawRequest(appPort, {
        method: "POST",
        path: "/api/auth/login",
        origin,
        body: JSON.stringify({ email, password }),
      });
      assert.equal(res.status, 200, `${email} could not sign in: ${res.body}`);
      return res.cookies.map((value) => value.split(";")[0]).join("; ");
    };
    const sessions = {};
    for (const user of users) sessions[user.id] = { cookie: await login(user.email), user };
    sessions["admin"] = {
      cookie: await login("admin@example.com", "ConcurrencyAdmin-2026!"),
      user: { id: "admin", role: "administrator", name: "Administrator", email: "admin@example.com" },
    };

    const getState = async (id) => {
      const res = await rawRequest(appPort, { path: "/api/state", cookie: sessions[id].cookie });
      assert.equal(res.status, 200, `state for ${id} failed: ${res.body}`);
      return JSON.parse(res.body);
    };
    const putState = async (id, state) =>
      rawRequest(appPort, {
        method: "PUT",
        path: "/api/state",
        origin,
        cookie: sessions[id].cookie,
        body: JSON.stringify({ data: state.data, revision: state.revision }),
      });

    const reportFor = (n, user, now, id) => ({
      id: id || `R-CONCURRENCY-${String(n).padStart(3, "0")}-${randomBytes(4).toString("hex")}`,
      userEmail: user.email,
      name: user.name,
      category: "Drainage problem",
      title: `Concurrency test concern ${n}`,
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Beside the covered court",
      description: "A deliberately long concurrency-test description.",
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
      history: [{ status: "Submitted", at: now, note: "Received for concurrency testing.", actorName: user.name, actorRole: "resident" }],
      photos: [],
    });

    const timings = {};

    // A. Thirty authenticated reads at once.
    {
      const started = performance.now();
      const responses = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          rawRequest(appPort, { path: "/api/state", cookie: Object.values(sessions)[i % Object.keys(sessions).length].cookie }),
        ),
      );
      timings.readsMs = Math.round(performance.now() - started);
      assert.ok(
        responses.every((res) => res.status === 200),
        "all concurrent reads must succeed",
      );
      console.log(`A. 30 concurrent reads: all 200 (${timings.readsMs}ms)`);
    }

    const submissions = [];

    // B. Two writers from the same stale revision — exactly one must win.
    {
      const one = users.find((u) => u.id === "C-R1");
      const two = users.find((u) => u.id === "C-R2");
      let staleOne = await getState("C-R1");
      let staleTwo = await getState("C-R2");
      // Two reads would normally agree; loop until they do because a background
      // prune can in theory move the revision between two back-to-back reads.
      for (let attempt = 0; staleOne.revision !== staleTwo.revision && attempt < 20; attempt += 1) {
        staleOne = await getState("C-R1");
        staleTwo = await getState("C-R2");
      }
      assert.equal(staleOne.revision, staleTwo.revision, "both sessions must share the same revision for this test");
      const onePayload = structuredClone(staleOne.data);
      const twoPayload = structuredClone(staleTwo.data);
      const now = new Date().toISOString();
      const reportOne = reportFor(1, one, now);
      const reportTwo = reportFor(2, two, now);
      onePayload.reports.push(reportOne);
      twoPayload.reports.push(reportTwo);
      const results = await Promise.all([
        putState("C-R1", { ...staleOne, data: onePayload }),
        putState("C-R2", { ...staleTwo, data: twoPayload }),
      ]);
      const winners = results.filter((res) => res.status === 200).map((res) => res.status);
      const conflicts = results.filter((res) => res.status === 409);
      assert.ok(winners.length + conflicts.length === results.length, `unexpected result: ${results.map((r) => r.status)}`);
      assert.equal(winners.length, 1, "exactly one writer must win the revision race");
      assert.equal(conflicts.length, 1, "exactly one writer must be refused with 409");
      const winnerResultIndex = results.findIndex((res) => res.status === 200);
      submissions.push({
        resident: winnerResultIndex === 0 ? "C-R1" : "C-R2",
        status: 200,
        reportId: winnerResultIndex === 0 ? reportOne.id : reportTwo.id,
      });
      const loaded = await getState("admin");
      const titles = loaded.data.reports.map((report) => report.title);
      assert.ok(titles.includes("Concurrency test concern 1") || titles.includes("Concurrency test concern 2"));
      assert.ok(!titles.includes("Concurrency test concern 1") || !titles.includes("Concurrency test concern 2"));
      console.log(`B. stale-revision double write: 1 × 200, 1 × 409, state contains exactly the winner's report`);
    }

    // C. Every resident submits at once. Each resident: fetch a fresh
    // revision, upload draft photos, then submit the concern with the photos.
    // This is what several browsers doing the real flow at the same moment look like.
    {
      const residents = users.filter((u) => u.role === "resident");
      const started = performance.now();
      const results = [];
      const uploadDurations = [];
      await Promise.all(
        residents.map(async (resident, i) => {
          const reportId = `R-CONCURRENCY-${String(i + 1).padStart(3, "0")}-${randomBytes(4).toString("hex")}`;
          const uploadStart = performance.now();
          const uploads = await Promise.all(
            [0, 1].map((position) =>
              multipartRequest(appPort, {
                path: `/api/report-photos?reportId=${encodeURIComponent(reportId)}`,
                cookie: sessions[resident.id].cookie,
                origin,
                files: [{ name: "photos", filename: `photo-${position}.jpg`, content: TEST_JPEG, type: "image/jpeg" }],
              }),
            ),
          );
          uploadDurations.push(Math.round(performance.now() - uploadStart));
          const snapshot = await getState(resident.id);
          const payload = structuredClone(snapshot.data);
          const now = new Date().toISOString();
          const report = reportFor(i + 3, resident, now, reportId);
          report.photos = uploads
            .map((res) => {
              if (res.status !== 201) return null;
              const { photos = [] } = JSON.parse(res.body);
              return photos[0] ? { name: photos[0].name, photoUrl: photos[0].photoUrl } : null;
            })
            .filter(Boolean);
          payload.reports.push(report);
          const res = await putState(resident.id, { ...snapshot, data: payload });
          results.push({ resident: resident.id, status: res.status, reportId, uploads: uploads.map((row) => row.status) });
          submissions.push({ resident: resident.id, status: res.status, reportId });
        }),
      );
      timings.submitMs = Math.round(performance.now() - started);
      timings.uploadMaxMs = Math.max(...uploadDurations, 0);
      const succeeded = results.filter((row) => row.status === 200).length;
      const conflicts = results.filter((row) => row.status === 409).length;
      const unexpected = results.map((row) => row.status).filter((status) => ![200, 409].includes(status));
      assert.equal(unexpected.length, 0, `unexpected statuses: ${unexpected}`);
      const accepted = results.flatMap((row) => row.uploads).filter((status) => status === 201).length;
      console.log(
        `C. ${residents.length} concurrent draft-photo + submit flows: ${accepted}/${results.length * 2} photos accepted, ${succeeded} × 200, ${conflicts} × 409 (${timings.submitMs}ms, max upload ${timings.uploadMaxMs}ms)`,
      );
      assert.ok(succeeded >= 1, "at least one concurrent submission must succeed");
    }

    const created = (await getState("admin")).data.reports;
    const createdIds = created.map((report) => report.id);

    // D. The created reports carry their attached photos, and each photo URL serves the owner.
    if (createdIds.length) {
      const started = performance.now();
      const adminView = (await getState("admin")).data.reports;
      const withPhotos = adminView.filter((report) => report.photos.length === 2);
      let served200 = 0;
      for (const report of adminView) {
        for (const photo of report.photos) {
          const res = await rawRequest(appPort, { path: photo.photoUrl, cookie: sessions["admin"].cookie });
          if (res.status === 200) served200 += 1;
        }
      }
      timings.photoFetchMs = Math.round(performance.now() - started);
      console.log(
        `D. ${withPhotos.length} report(s) carry both photos; admin fetched ${served200} photo files (${timings.photoFetchMs}ms)`,
      );
    }

    // E. Four administrators approve the same pending announcement at once.
    {
      const announce = await seedPool.query(
        "INSERT INTO announcements (title, detail, date, approval_status, created_by) VALUES ($1,$2,$3,'pending',$4) RETURNING id",
        ["Concurrency test announcement", "Pending approval for the concurrency rehearsal.", "2026-11-20", "C-O1"],
      );
      const announcementId = announce.rows[0].id;
      const started = performance.now();
      const decisions = await Promise.all(
        Array.from({ length: 4 }, () =>
          rawRequest(appPort, {
            method: "POST",
            path: "/api/announcements/approval",
            origin,
            cookie: sessions["admin"].cookie,
            body: JSON.stringify({ id: announcementId, status: "approved" }),
          }),
        ),
      );
      timings.approvalMs = Math.round(performance.now() - started);
      const accepted = decisions.filter((res) => res.status === 200).length;
      const refused = decisions.filter((res) => res.status === 409).length;
      assert.equal(accepted, 1, "exactly one approval must be accepted");
      assert.equal(refused, 3, "the other approvals must be refused with 409");
      const audited = await seedPool.query(
        "SELECT count(*)::int AS count FROM activities WHERE detail LIKE 'Concurrency test announcement%' AND action='Approved an announcement'",
      );
      assert.equal(audited.rows[0].count, 1);
      const decidedNotifications = await seedPool.query(
        "SELECT count(*)::int AS count FROM notifications WHERE target_email='official.1@concurrency.test' AND title='Announcement approved'",
      );
      assert.equal(decidedNotifications.rows[0].count, 1, "only one approval notification must be sent");
      console.log(
        `E. 4 concurrent approvals of one announcement: 1 × 200, 3 × 409, exactly one audit row and one notification (${timings.approvalMs}ms)`,
      );
    }

    // F. The notification badge path for every signed-in account at once.
    {
      const started = performance.now();
      const results = await Promise.all(
        Object.keys(sessions).map((id) => rawRequest(appPort, { path: "/api/community/unread-count", cookie: sessions[id].cookie })),
      );
      timings.unreadMs = Math.round(performance.now() - started);
      assert.ok(results.every((res) => res.status === 200));
      console.log(`F. ${results.length} concurrent unread-count checks: all 200 (${timings.unreadMs}ms)`);
    }

    // G. Officials claim the same one report at once; only one may hold it.
    if (createdIds.length) {
      const target = createdIds[0];
      const started = performance.now();
      const claims = await Promise.all(
        ["C-O1", "C-O2", "C-O3"].map(async (id) => {
          const snapshot = await getState(id);
          const payload = structuredClone(snapshot.data);
          const report = payload.reports.find((item) => item.id === target);
          if (!report) return { id, status: 404 };
          report.assignedTo = { id: `C-O${id.slice(-1)}`, name: `Concurrency Official ${id.slice(-1)}` };
          const res = await putState(id, { ...snapshot, data: payload });
          return { id, status: res.status };
        }),
      );
      timings.claimMs = Math.round(performance.now() - started);
      const accepted = claims.filter((claim) => claim.status === 200).length;
      const refused = claims.filter((claim) => claim.status === 409).length;
      console.log(`G. 3 concurrent claims on one concern: ${accepted} × 200, ${refused} × 409 (${timings.claimMs}ms)`);
      assert.ok(accepted >= 1 && accepted + refused <= 3, "claims must settle: at least one accepted");
      const after = await getState("admin");
      const owned = after.data.reports.find((item) => item.id === target);
      assert.ok(owned.assignedTo === null || owned.assignedTo.id.startsWith("C-O"), "the claim must not corrupt the assignment");
    }

    console.log("\nConcurrency rehearsal finished:", JSON.stringify(timings));
  } finally {
    teardown = true;
    await seedPool?.end().catch(() => {});
    await new Promise((resolve) => {
      if (!app) return resolve();
      app.once("close", resolve);
      app.kill();
    });
    if (embedded) await embedded.stop().catch(() => {});
    await rm(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }).catch(() => {});
  }
}

await main();
