// Verify the production SMTP path against a real standards-compliant SMTP
// server, not against a stub mailer.
//
// The check starts a throwaway PostgreSQL 18 cluster with TLS (like a managed
// provider), a throwaway SMTP server with STARTTLS and a dedicated CA (like a
// managed mail provider offering TLS), and the real CommUnity server in
// production mode with the SMTP environment configured exactly as a deployment
// would set it. It then drives:
//
//   1. the administrator's SMTP test email, and
//   2. a resident's password-reset link delivered over the same path.
//
// The messages are captured from the SMTP wire, so success means the mailer
// negotiated TLS, validated the certificate, and submitted the message to a
// server that would hand it off — no stub mailer, no sink.
//
// Honest limit: this proves the client path (TLS, auth, message construction)
// rather than any particular provider. A provider can still refuse or bounce;
// that can only be confirmed with real credentials and a recipient.
//
// Requires: embedded-postgres and openssl for the rehearsal certificates
// (the repository bundles neither; PG_BIN is reused for the cluster, and a
// usable openssl binary is resolved for real — PATH lookup first, then the
// platform's well-known locations — by scripts/rehearsal-openssl.mjs).
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, readFile, appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { findOpenSSL } from "./rehearsal-openssl.mjs";

const run = promisify(execFile);

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

function mailText(message) {
  return String(message)
    .replace(/=\r?\n/g, "")
    .replace(/=3[Dd]/g, "=");
}

function rawRequest(port, { method = "GET", path: requestPath = "/", host = "community.example.com", origin, body = "", cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host, connection: "close" };
    if (origin) headers.origin = origin;
    if (cookie) headers.cookie = cookie;
    if (body) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(body);
    }
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: text, headers: res.headers, cookies: res.headers["set-cookie"] || [] }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function startTlsCluster(base, port, password) {
  const embedded = new EmbeddedPostgres({
    databaseDir: path.join(base, "pgdata"),
    user: "postgres",
    password,
    port,
    persistent: true,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    onError: () => {},
  });
  await embedded.initialise();
  return embedded;
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
      `/CN=localhost`,
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

function waitForHealthz(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await rawRequest(port, { path: "/api/healthz" });
        if (res.status === 200) return resolve();
      } catch {
        // The server is still booting.
      }
      if (Date.now() > deadline) return reject(new Error("the production server did not start in time"));
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

async function main() {
  const { SMTPServer } = await import("smtp-server");
  const base = await mkdtemp(path.join(os.tmpdir(), "community-smtp-rehearsal-"));
  const pgPort = await freePort();
  const smtpPort = await freePort();
  const appPort = await freePort();
  const pgPassword = "community-smtp-rehearsal";
  const messages = [];
  let embedded;
  let smtpServer;
  let app;
  try {
    embedded = await startTlsCluster(base, pgPort, pgPassword);
    const certs = await issueCertificates(base);
    const configPath = path.join(base, "pgdata", "postgresql.conf");
    await appendFile(
      configPath,
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
    await admin.query("CREATE DATABASE community_smtp");
    await admin.end();

    smtpServer = new SMTPServer({
      secure: false,
      key: await readFile(path.join(certs, "smtp.key")),
      cert: await readFile(path.join(certs, "smtp.crt")),
      onAuth(auth, _session, callback) {
        if (auth.username === "mailer" && auth.password === "smtp-password") callback(null, { user: auth.username });
        else callback(new Error("invalid credentials"));
      },
      onData(stream, session, callback) {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => {
          messages.push({
            from: session.envelope.mailFrom?.address || "",
            to: (session.envelope.rcptTo || []).map((rcpt) => rcpt.address),
            raw: Buffer.concat(chunks).toString("utf8"),
          });
          callback();
        });
      },
    });
    await new Promise((resolve, reject) => {
      smtpServer.once("error", reject);
      smtpServer.listen(smtpPort, "127.0.0.1", resolve);
    });

    // The whole application, in production mode, with SMTP exactly as a deployment sets it.
    const childEnv = {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(appPort),
      APP_ORIGIN: "https://community.example.com",
      DATABASE_URL: `postgresql://postgres:${encodeURIComponent(pgPassword)}@127.0.0.1:${pgPort}/community_smtp`,
      DATABASE_CA: await readFile(path.join(certs, "ca.crt"), "utf8"),
      NODE_EXTRA_CA_CERTS: path.join(certs, "ca.crt"),
      INITIAL_ADMIN_EMAIL: "admin@example.com",
      INITIAL_ADMIN_PASSWORD: "SmokeAdminPassword-2026!",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpPort),
      SMTP_USER: "mailer",
      SMTP_PASS: "smtp-password",
      SMTP_FROM: "CommUnity <no-reply@example.test>",
      SMTP_SETTINGS_KEY: "community-smtp-rehearsal",
    };
    app = spawn(process.execPath, ["server/index.mjs"], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    const appLogs = [];
    app.stdout.on("data", (chunk) => appLogs.push(chunk.toString()));
    app.stderr.on("data", (chunk) => appLogs.push(chunk.toString()));
    await waitForHealthz(appPort);

    const origin = "https://community.example.com";
    const register = async (email) =>
      rawRequest(appPort, {
        method: "POST",
        path: "/api/auth/register",
        origin,
        body: JSON.stringify({
          name: "SMTP Resident",
          email,
          phone: "09170000000",
          area: "Purok 1",
          password: "SmtpResidentPassword-2026!",
          confirmPassword: "SmtpResidentPassword-2026!",
        }),
      });
    const residentSignup = await register("resident@example.test");
    assert.ok(residentSignup.status === 201, `registration should succeed: ${residentSignup.body}`);

    // 1. The administrator's SMTP test email, over the same path.
    const login = await rawRequest(appPort, {
      method: "POST",
      path: "/api/auth/login",
      origin,
      body: JSON.stringify({ email: "admin@example.com", password: "SmokeAdminPassword-2026!" }),
    });
    assert.equal(login.status, 200, login.body);
    const adminCookie = login.cookies.map((value) => value.split(";")[0]).join("; ");
    const smtpTest = await rawRequest(appPort, {
      method: "POST",
      path: "/api/settings/smtp/test",
      origin,
      body: "{}",
      cookie: adminCookie,
    });
    assert.equal(smtpTest.status, 200, smtpTest.body);

    // 2. A password-recovery mail delivered end to end. Registration sets the recovery
    // email's confirmation mail first (the recovery address is not usable for the
    // password reset until the owner confirms it), then the reset request delivers links.
    const residentLogin = await rawRequest(appPort, {
      method: "POST",
      path: "/api/auth/login",
      origin,
      body: JSON.stringify({ email: "resident@example.test", password: "SmtpResidentPassword-2026!" }),
    });
    assert.equal(residentLogin.status, 200, residentLogin.body);
    const residentCookie = residentLogin.cookies.map((value) => value.split(";")[0]).join("; ");
    const profile = await rawRequest(appPort, {
      method: "PUT",
      path: "/api/profile",
      origin,
      cookie: residentCookie,
      body: JSON.stringify({ name: "SMTP Resident", area: "Purok 1", phone: "09170000000", recoveryEmail: "recovery@example.test" }),
    });
    assert.equal(profile.status, 200, profile.body);

    const mailDeadline = Date.now() + 10_000;
    let verificationMail;
    while (Date.now() < mailDeadline) {
      verificationMail = messages.find((message) => message.to.some((to) => String(to).includes("recovery@example.test")));
      if (verificationMail) {
        verificationMail.raw = mailText(verificationMail.raw);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(verificationMail, `the recovery confirmation email was not delivered:\n${appLogs.join("")}`);
    const verifyMatch = verificationMail.raw.match(/#\/verify-recovery\?token=([A-Za-z0-9_-]{20,})/);
    assert.ok(verifyMatch, `the confirmation email did not include a verification link:\n${verificationMail.raw}`);
    const verify = await rawRequest(appPort, {
      method: "POST",
      path: "/api/auth/verify-recovery",
      origin,
      body: JSON.stringify({ token: verifyMatch[1] }),
    });
    assert.equal(verify.status, 200, verify.body);

    const forgot = await rawRequest(appPort, {
      method: "POST",
      path: "/api/auth/forgot-password",
      origin,
      body: JSON.stringify({ recoveryEmail: "recovery@example.test" }),
    });
    assert.equal(forgot.status, 200, forgot.body);

    const resetDeadline = Date.now() + 10_000;
    let resetMail;
    while (Date.now() < resetDeadline) {
      resetMail = messages.find(
        (message) => message.to.some((to) => String(to).includes("recovery@example.test")) && message !== verificationMail,
      );
      if (resetMail) {
        resetMail.raw = mailText(resetMail.raw);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(resetMail, `the password-recovery email was not delivered:\n${appLogs.join("")}`);
    assert.match(resetMail.raw, /#\/reset-password\?token=/);
    assert.match(resetMail.raw, /community\.example\.com/);

    const adminMessage = mailText(
      (messages.find((message) => message.to.some((to) => String(to).includes("admin@example.com"))) || {}).raw || "",
    );
    assert.ok(adminMessage, "the administrator should receive the test email");
    assert.match(adminMessage, /CommUnity SMTP test/);
    console.log("ok   the production server delivered the admin test email over verified STARTTLS");
    console.log("ok   the production server delivered and verified the recovery confirmation mail");
    console.log("ok   the production server delivered the password-recovery mail end to end");
    console.log(`\nSMTP rehearsal passed: ${messages.length} messages captured with TLS and certificate verification.`);
  } finally {
    await new Promise((resolve) => {
      if (!app) return resolve();
      app.once("close", resolve);
      app.kill();
    });
    await new Promise((resolve) => (smtpServer ? smtpServer.close(resolve) : resolve()));
    if (embedded) await embedded.stop().catch(() => {});
    await rm(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }).catch(() => {});
  }
}

await main();
