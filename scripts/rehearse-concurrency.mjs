// Rehearse concurrent use against a TLS-verified, production-configuration
// deployment. Boots a throwaway PostgreSQL 18 cluster with TLS, configures the
// application in production mode with a trusted rehearsal CA, seeds extra
// residents and officials, and then runs the simultaneous-access patterns that
// real barangays hit:
//
//   A. many authenticated sessions polling the state endpoint at once;
//   B. two writers editing from the same stale revision simultaneously;
//   C. every seeded resident submitting a concern at the same moment;
//   D. the attached photos serving their owner and refusing other residents;
//   E. several administrators approving the same pending announcement at once;
//   F. every signed-in account reading its unread-count at once;
//   G. officials claiming concerns at the same moment (different concerns, then the same one).
//
// Revision conflicts are the app's documented guard against silent overwrite,
// so instead of hiding them the probe records exactly who got the 200 and who
// got the 409, and asserts the server never corrupted or half-applied state.
//
// Requires: embedded-postgres, openssl for the rehearsal certificates (PG_BIN
// is reused for the cluster, and a usable openssl binary is resolved for real
// — PATH lookup first, then the platform's well-known locations — by
// scripts/rehearsal-openssl.mjs).
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
import { findOpenSSL } from "./rehearsal-openssl.mjs";

const run = promisify(execFile);
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
  const openssl = await findOpenSSL();
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
    // Four extra administrators so the announcement fan-out can be decided by
    // four different signed-in accounts, not by one session racing itself.
    for (const n of [1, 2, 3, 4])
      users.push({ id: `C-A${n}`, role: "administrator", name: `Concurrency Administrator ${n}`, email: `admin.${n}@concurrency.test` });
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
      assert.ok(
        responses.every((res) => Number.isSafeInteger(JSON.parse(res.body).revision)),
        "every concurrent read must return a well-formed state with a numeric revision",
      );
      console.log(`A. 30 concurrent reads: all 200 (${timings.readsMs}ms)`);
    }

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
      assert.equal(
        results.length - winners.length - conflicts.length,
        0,
        `only 200 and 409 are legal outcomes here: ${results.map((r) => r.status)}`,
      );
      assert.equal(winners.length, 1, "exactly one writer must win the revision race");
      assert.equal(conflicts.length, 1, "exactly one writer must be refused with 409");
      assert.match(conflicts[0].body, /Data changed in another session/, "the refused writer must get the documented revision conflict");
      const winnerResultIndex = results.findIndex((res) => res.status === 200);
      const winnerReport = winnerResultIndex === 0 ? reportOne : reportTwo;
      const loaded = await getState("admin");
      const competing = loaded.data.reports.filter((report) => [reportOne.id, reportTwo.id].includes(report.id));
      assert.equal(competing.length, 1, "the shared workspace must contain exactly the winner's report");
      assert.equal(competing[0].id, winnerReport.id, "the surviving report must be the winner's");
      // The database — not just the API read — contains exactly one competing report.
      const stored = await seedPool.query("SELECT count(*)::integer AS count FROM reports WHERE id = ANY($1::text[])", [
        [reportOne.id, reportTwo.id],
      ]);
      assert.equal(stored.rows[0].count, 1, "exactly one competing report may be persisted");
      console.log(`B. stale-revision double write: 1 × 200, 1 × 409, state contains exactly the winner's report`);
    }

    // C. Every resident submits at once. Each resident: fetch a fresh
    // revision, upload draft photos, then submit the concern with the photos.
    // This is what several browsers doing the real flow at the same moment look like.
    // Residents who lose the revision race are settled exactly the way the
    // browser recovers — re-read the workspace, splice their own concern in,
    // try again, bounded — so the rehearsal can assert the end state instead
    // of merely "at least one made it".
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
          results.push({ resident: resident.id, status: res.status, reportId, uploads: uploads.map((row) => row.status), report });
        }),
      );
      const firstAttempt = results.map((row) => row.status);
      // Settle the losers: sequential, fresh read each attempt, bounded.
      for (const row of results.filter((entry) => entry.status !== 200)) {
        for (let attempt = 0; attempt < 5 && row.status !== 200; attempt += 1) {
          const snapshot = await getState(row.resident);
          const payload = structuredClone(snapshot.data);
          if (!payload.reports.some((report) => report.id === row.reportId)) {
            payload.reports.push(structuredClone(row.report));
          }
          const res = await putState(row.resident, { ...snapshot, data: payload });
          row.status = res.status;
        }
      }
      timings.submitMs = Math.round(performance.now() - started);
      timings.uploadMaxMs = Math.max(...uploadDurations, 0);
      const firstAttemptOk = firstAttempt.filter((status) => status === 200).length;
      const unexpected = results.map((row) => row.status).filter((status) => status !== 200);
      assert.equal(unexpected.length, 0, `every concern must be on file after the settle loop: ${JSON.stringify(unexpected)}`);
      const accepted = results.flatMap((row) => row.uploads).filter((status) => status === 201).length;
      console.log(
        `C. ${residents.length} concurrent draft-photo + submit flows: ${accepted}/${results.length * 2} photos accepted, ${firstAttemptOk}/${residents.length} won the race outright, all settled (${timings.submitMs}ms, max upload ${timings.uploadMaxMs}ms)`,
      );
      const settled = (await getState("admin")).data.reports;
      for (const { reportId } of results) {
        const onFile = settled.filter((report) => report.id === reportId);
        assert.equal(onFile.length, 1, `concern ${reportId} must be on file exactly once`);
        assert.equal(onFile[0].history.length, 1, "each settled concern carries exactly one history entry");
      }
    }

    const created = (await getState("admin")).data.reports;
    const createdIds = created.map((report) => report.id);

    // D. The created reports carry their attached photos, each photo serves the
    // owning resident, and every other resident is refused.
    if (createdIds.length) {
      const started = performance.now();
      const adminView = (await getState("admin")).data.reports;
      const withPhotos = adminView.filter((report) => report.photos.length === 2);
      assert.ok(withPhotos.length >= 1, "at least one concern must carry its attached photos");
      const residentsByEmail = new Map(users.filter((entry) => entry.role === "resident").map((entry) => [entry.email, entry.id]));
      const residentIds = [...residentsByEmail.values()];
      let served = 0;
      let refused = 0;
      let checked = 0;
      for (const report of withPhotos) {
        const owner = residentsByEmail.get(report.userEmail);
        const stranger = residentIds.find((id) => id !== owner);
        for (const photo of report.photos) {
          const ownerRes = await rawRequest(appPort, { path: photo.photoUrl, cookie: sessions[owner].cookie });
          if (ownerRes.status === 200) served += 1;
          const strangerRes = await rawRequest(appPort, { path: photo.photoUrl, cookie: sessions[stranger].cookie });
          if (strangerRes.status === 403) refused += 1;
          checked += 1;
        }
      }
      timings.photoFetchMs = Math.round(performance.now() - started);
      console.log(
        `D. ${withPhotos.length} report(s) carry both photos; owner 200 for ${served}/${checked}, another resident 403 for ${refused}/${checked} (${timings.photoFetchMs}ms)`,
      );
      assert.equal(served, checked, "every attached photo must serve its owner");
      assert.equal(refused, checked, "no resident may fetch another resident's photo");
    }

    // E. Four administrators approve the same pending announcement at once.
    // The announcement row lock must let exactly one decision commit.
    {
      const announce = await seedPool.query(
        "INSERT INTO announcements (title, detail, date, approval_status, created_by) VALUES ($1,$2,$3,'pending',$4) RETURNING id",
        ["Concurrency test announcement", "Pending approval for the concurrency rehearsal.", "2026-11-20", "C-O1"],
      );
      const announcementId = announce.rows[0].id;
      const approvers = ["C-A1", "C-A2", "C-A3", "C-A4"];
      const started = performance.now();
      const decisions = await Promise.all(
        approvers.map((id) =>
          rawRequest(appPort, {
            method: "POST",
            path: "/api/announcements/approval",
            origin,
            cookie: sessions[id].cookie,
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
      const approved = await seedPool.query("SELECT approval_status FROM announcements WHERE id=$1", [announcementId]);
      assert.equal(approved.rows[0].approval_status, "approved", "the decided announcement must be approved in the database");
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
      assert.ok(
        results.every((res) => Number.isSafeInteger(JSON.parse(res.body).count)),
        "every signed-in account must get a well-formed unread count",
      );
      console.log(`F. ${results.length} concurrent unread-count checks: all 200 (${timings.unreadMs}ms)`);
    }

    // G. Officials claim concerns at the same moment. First different concerns —
    // every claim may land, each report going to its own claimant; then the same
    // concern — the assignment may hold exactly one official.
    assert.ok(createdIds.length >= 4, "the submitted concerns must be on file before the claim test");
    {
      // G1. Different concerns: all three claims land. Every save shares one
      // revision counter, so the losers of the race are refused with 409 and
      // their browsers retry — settle the same way here.
      const claimants = ["C-O1", "C-O2", "C-O3"];
      const targets = [createdIds[0], createdIds[1], createdIds[2]];
      const started = performance.now();
      const claims = claimants.map((id, index) => ({ claimant: id, target: targets[index], status: 0 }));
      await Promise.all(
        claims.map(async (claim) => {
          const snapshot = await getState(claim.claimant);
          const payload = structuredClone(snapshot.data);
          const report = payload.reports.find((item) => item.id === claim.target);
          report.assignedTo = { id: claim.claimant, name: `Concurrency Official ${claim.claimant.slice(-1)}` };
          const res = await putState(claim.claimant, { ...snapshot, data: payload });
          claim.status = res.status;
        }),
      );
      for (const claim of claims.filter((entry) => entry.status !== 200)) {
        for (let attempt = 0; attempt < 5 && claim.status !== 200; attempt += 1) {
          const snapshot = await getState(claim.claimant);
          const payload = structuredClone(snapshot.data);
          const report = payload.reports.find((item) => item.id === claim.target);
          if (report.assignedTo) break; // another official holds it now
          report.assignedTo = { id: claim.claimant, name: `Concurrency Official ${claim.claimant.slice(-1)}` };
          const res = await putState(claim.claimant, { ...snapshot, data: payload });
          claim.status = res.status;
        }
      }
      timings.claimDifferentMs = Math.round(performance.now() - started);
      assert.ok(
        claims.every((claim) => claim.status === 200),
        `every claim on a different concern must succeed: ${claims.map((claim) => claim.status)}`,
      );
      const assigned = await seedPool.query("SELECT id, assigned_to FROM reports WHERE id = ANY($1::text[]) ORDER BY id", [targets]);
      for (const claim of claims) {
        const row = assigned.rows.find((item) => item.id === claim.target);
        assert.equal(row.assigned_to, claim.claimant, `concern ${claim.target} must be assigned to its own claimant`);
      }

      // G2. The same concern: exactly one official may hold it afterwards.
      const target = createdIds[3];
      const sameStarted = performance.now();
      const same = await Promise.all(
        ["C-O1", "C-O2", "C-O3"].map(async (id) => {
          const snapshot = await getState(id);
          const payload = structuredClone(snapshot.data);
          const report = payload.reports.find((item) => item.id === target);
          if (!report) return { id, status: 404 };
          report.assignedTo = { id, name: `Concurrency Official ${id.slice(-1)}` };
          const res = await putState(id, { ...snapshot, data: payload });
          return { id, status: res.status };
        }),
      );
      timings.claimSameMs = Math.round(performance.now() - sameStarted);
      const accepted = same.filter((claim) => claim.status === 200).length;
      // A loser who read before the winner committed loses the revision race
      // (409); a loser who read after the winner committed is refused because
      // the concern is no longer unassigned (403). Both are correct refusals —
      // what may never happen is a second claimant succeeding.
      const refused = same.filter((claim) => [409, 403].includes(claim.status)).length;
      console.log(
        `G. different concerns: all ${claims.length} claimed (${timings.claimDifferentMs}ms); same concern: ${accepted} × 200, ${refused} × refused (${timings.claimSameMs}ms)`,
      );
      assert.equal(accepted, 1, "exactly one official may claim the concern");
      assert.equal(refused, 2, "the other claimants must be refused (409 losing the race, or 403 because another official holds it)");
      const holder = await seedPool.query("SELECT assigned_to FROM reports WHERE id=$1", [target]);
      const winner = same.find((claim) => claim.status === 200);
      assert.equal(holder.rows[0].assigned_to, winner.id, "the official who won the revision race must hold the concern");
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
