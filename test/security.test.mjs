import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  startServer,
  api,
  signIn,
  startSmtpSink,
  mailText,
  registerResident,
  uploadPhoto,
  TEST_JPEG,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from "./helpers.mjs";
import { pruneExpiredAuthState } from "../server/index.mjs";

test("limits repeated login attempts and prunes expired authentication data", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-auth-limits-"));
  const app = await startServer(dataDir);
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await api(app, "/api/auth/login", {
        method: "POST",
        body: { email: "unknown@example.test", password: "wrong-password" },
      });
      assert.equal(response.status, 401);
    }
    const limited = await api(app, "/api/auth/login", {
      method: "POST",
      body: { email: "unknown@example.test", password: "wrong-password" },
    });
    assert.equal(limited.status, 429);

    const ipKey = createHash("sha256").update("login-ip:127.0.0.1").digest("hex");
    await app.db.query(
      `
      INSERT INTO auth_attempts (attempt_key,attempts,window_started_at)
      VALUES ($1,100,now())
      ON CONFLICT (attempt_key) DO UPDATE SET attempts=100,window_started_at=now()
    `,
      [ipKey],
    );
    const ipLimited = await api(app, "/api/auth/login", {
      method: "POST",
      body: { email: "different-account@example.test", password: "wrong-password" },
    });
    assert.equal(ipLimited.status, 429);

    const administrator = await app.db.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL]);
    await app.db.query(
      "INSERT INTO auth_attempts (attempt_key,attempts,window_started_at) VALUES ('expired-test',1,now()-interval '2 days')",
    );
    await app.db.query("INSERT INTO web_sessions (token_hash,user_id,expires_at) VALUES ('expired-test',$1,now()-interval '1 minute')", [
      administrator.rows[0].id,
    ]);
    assert.deepEqual(await pruneExpiredAuthState(app.db), { attempts: 1, sessions: 1 });
    const expiredRows = await app.db.query(`
      SELECT
        (SELECT count(*) FROM auth_attempts WHERE attempt_key='expired-test')::integer AS attempts,
        (SELECT count(*) FROM web_sessions WHERE token_hash='expired-test')::integer AS sessions
    `);
    assert.deepEqual(expiredRows.rows[0], { attempts: 0, sessions: 0 });
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("throttles repeated current-password guesses for a signed-in account", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-password-limits-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const attempt = () =>
      api(app, "/api/auth/password", {
        method: "POST",
        cookie: admin.cookie,
        body: { currentPassword: "not-the-password", newPassword: "A-rotated-password-2026!", confirmPassword: "A-rotated-password-2026!" },
      });
    for (let guess = 0; guess < 5; guess += 1) assert.equal((await attempt()).status, 400);
    assert.equal((await attempt()).status, 429);

    const adminId = (await app.db.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
    await app.db.query("DELETE FROM auth_attempts WHERE attempt_key=$1", [
      createHash("sha256").update(`password-change:${adminId}`).digest("hex"),
    ]);
    const changed = await api(app, "/api/auth/password", {
      method: "POST",
      cookie: admin.cookie,
      body: { currentPassword: ADMIN_PASSWORD, newPassword: "A-rotated-password-2026!", confirmPassword: "A-rotated-password-2026!" },
    });
    assert.equal(changed.status, 200);
    const attempts = await app.db.query("SELECT count(*)::integer AS count FROM auth_attempts WHERE attempt_key=$1", [
      createHash("sha256").update(`password-change:${adminId}`).digest("hex"),
    ]);
    assert.equal(attempts.rows[0].count, 0);
    assert.equal((await signIn(app, ADMIN_EMAIL, "A-rotated-password-2026!")).response.status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("registers residents, scopes their data, and rejects privilege escalation", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-rbac-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Resident One",
        email: "resident@example.test",
        area: "Purok 2",
        phone: "",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];
    const residentStateResponse = await api(app, "/api/state", { cookie: residentCookie });
    const residentState = await residentStateResponse.json();
    assert.equal(residentState.data.users.length, 1);
    assert.equal(residentState.data.users[0].role, "resident");
    assert.deepEqual(residentState.data.reports, []);

    const elevated = structuredClone(residentState);
    elevated.data.permissions.administrator.manageUsers = false;
    const elevationResponse = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: residentState.revision, data: elevated.data },
    });
    assert.equal(elevationResponse.status, 403);

    const now = new Date().toISOString();
    const reportState = structuredClone(residentState.data);
    reportState.reports.push({
      id: "RPT-2026-test-01",
      userEmail: "resident@example.test",
      name: "Resident One",
      category: "Flooding",
      title: "Flooding · Purok 2",
      area: "Purok 2",
      barangay: "Palsara",
      locationDetail: "Near the school entrance",
      latitude: 14.01799,
      longitude: 121.09465,
      description: "Water is pooling across the road near the school entrance.",
      urgent: false,
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos: [],
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });
    const invalidCoordinates = structuredClone(residentState.data);
    invalidCoordinates.reports.push({
      ...reportState.reports[0],
      id: "RPT-2026-test-invalid",
      latitude: 91,
    });
    const invalidReport = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: residentState.revision, data: invalidCoordinates },
    });
    assert.equal(invalidReport.status, 400);
    const incompleteCoordinates = structuredClone(residentState.data);
    incompleteCoordinates.reports.push({
      ...reportState.reports[0],
      id: "RPT-2026-test-incomplete",
      longitude: null,
    });
    const incompleteReport = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: residentState.revision, data: incompleteCoordinates },
    });
    assert.equal(incompleteReport.status, 400);
    reportState.activities.push({
      id: "A-test-1",
      actor: "Resident One",
      role: "resident",
      action: "Submitted a concern",
      detail: "RPT-2026-test-01 · Flooding",
      at: now,
      result: "Success",
    });
    const created = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: residentState.revision, data: reportState },
    });
    assert.equal(created.status, 200);
    const createdResult = await created.json();
    assert.equal(createdResult.data.reports.length, 1);
    assert.equal(createdResult.data.reports[0].latitude, 14.01799);
    assert.equal(createdResult.data.reports[0].longitude, 121.09465);
    const persistedCoordinates = await app.db.query("SELECT latitude, longitude FROM reports WHERE id=$1", ["RPT-2026-test-01"]);
    assert.deepEqual(persistedCoordinates.rows[0], { latitude: 14.01799, longitude: 121.09465 });

    const adminState = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    assert.equal(adminState.data.reports.length, 1);
    const changed = structuredClone(adminState.data);
    changed.reports[0].status = "Resolved";
    changed.reports[0].updatedAt = now;
    changed.reports[0].history.push({ status: "Resolved", at: now, note: "Forged client update." });
    const tampered = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: {
        revision: (await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json())).revision,
        data: changed,
      },
    });
    assert.equal(tampered.status, 403);

    const relations = await app.db.query(`
      SELECT
        (SELECT count(*) FROM users)::integer AS users,
        (SELECT count(*) FROM user_credentials)::integer AS credentials,
        (SELECT count(*) FROM reports)::integer AS reports,
        (SELECT count(*) FROM report_history)::integer AS report_history,
        (SELECT count(*) FROM notifications)::integer AS notifications
    `);
    assert.equal(relations.rows[0].users, 2);
    assert.equal(relations.rows[0].credentials, 2);
    assert.equal(relations.rows[0].reports, 1);
    assert.equal(relations.rows[0].report_history, 1);
    assert.ok(relations.rows[0].notifications > 0);
    const passwordRecord = await app.db.query(
      "SELECT password_hash FROM user_credentials WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["resident@example.test"],
    );
    assert.match(passwordRecord.rows[0].password_hash, /^scrypt\$/);
    assert.equal(passwordRecord.rows[0].password_hash.includes("A-unique-resident-password!"), false);

    const deniedReset = await api(app, "/api/users/password", {
      method: "POST",
      cookie: residentCookie,
      body: {
        email: "resident@example.test",
        newPassword: "A-reset-resident-password!",
        confirmPassword: "A-reset-resident-password!",
      },
    });
    assert.equal(deniedReset.status, 403);
    const reset = await api(app, "/api/users/password", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        email: "resident@example.test",
        newPassword: "A-reset-resident-password!",
        confirmPassword: "A-reset-resident-password!",
      },
    });
    assert.equal(reset.status, 200);
    const remainingSessions = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["resident@example.test"],
    );
    assert.equal(remainingSessions.rows[0].count, 0);
    assert.equal((await api(app, "/api/session", { cookie: residentCookie }).then((response) => response.json())).user, null);
    assert.equal((await signIn(app, "resident@example.test", "A-unique-resident-password!")).response.status, 401);
    assert.equal((await signIn(app, "resident@example.test", "A-reset-resident-password!")).response.status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a reset link cannot set two passwords when concurrent requests race", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-reset-race-"));
  const app = await startServer(dataDir);
  try {
    const email = "race-resident@example.test";
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Race Resident",
        email,
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const rawToken = "race-reset-token-0123456789abcdef";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await app.db.query(
      "INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) SELECT id, $1, now() + interval '30 minutes' FROM users WHERE email=$2",
      [tokenHash, email],
    );

    // Two browsers following the same link at the same time: the token must be
    // consumed by one of them, so only one password change can ever happen.
    const [first, second] = await Promise.all([
      api(app, "/api/auth/reset-password", { method: "POST", body: { token: rawToken, newPassword: "A-first-race-password-1!" } }),
      api(app, "/api/auth/reset-password", { method: "POST", body: { token: rawToken, newPassword: "A-second-race-password-2!" } }),
    ]);
    assert.notDeepEqual([first.status, second.status], [200, 200], "both requests must not report success for one link");
    const remaining = await app.db.query("SELECT count(*)::integer AS count FROM password_reset_tokens");
    assert.equal(remaining.rows[0].count, 0, "the link is consumed even by the request that loses the race");
    const firstTry = await api(app, "/api/auth/login", { method: "POST", body: { email, password: "A-first-race-password-1!" } });
    const secondTry = await api(app, "/api/auth/login", { method: "POST", body: { email, password: "A-second-race-password-2!" } });
    assert.deepEqual([firstTry.status, secondTry.status].sort(), [200, 401], "exactly one of the two submitted passwords is now in effect");

    // The consumed link does not work again on its own either.
    const reuse = await api(app, "/api/auth/reset-password", {
      method: "POST",
      body: { token: rawToken, newPassword: "A-third-race-password-3!" },
    });
    assert.equal(reuse.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("failed sign-in attempts are logged as security events", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-failed-login-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const failed = await api(app, "/api/auth/login", {
      method: "POST",
      body: { email: "nonexistent@example.test", password: "wrong-password!" },
    });
    assert.equal(failed.status, 401);

    const stateAfter = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const failedLoginEvents = stateAfter.data.activities.filter((item) => item.action === "Failed sign-in" && item.result === "Failed");
    assert.ok(failedLoginEvents.length >= 1, "Failed sign-in should be logged as a security event");
    const event = failedLoginEvents[0];
    assert.match(event.detail || "", /nonexistent/);
    assert.ok(event.resultReason);
    assert.ok(event.clientIp);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an unauthenticated request is refused and is not written as a security event", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-authz-anonymous-"));
  const app = await startServer(dataDir);
  try {
    const denied = await api(app, "/api/state", {
      method: "PUT",
      body: {
        revision: 0,
        data: {
          version: 1,
          users: [],
          reports: [],
          schedules: [],
          notifications: [],
          activities: [],
          announcements: [],
          locations: [],
          recyclingLocations: [],
          permissions: {},
        },
      },
    });
    assert.equal(denied.status, 401);

    const admin = await signIn(app);
    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const denials = state.data.activities.filter((item) => item.action === "Authorization denied");
    assert.equal(denials.length, 0, "A missing session is refused but is not an authorization denial");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a rejected cross-site request is logged as a security event with a system actor", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-authz-origin-"));
  const app = await startServer(dataDir);
  try {
    const rejected = await api(app, "/api/state", { method: "GET", origin: "http://evil.example" });
    assert.equal(rejected.status, 403);
    const rejectedAgain = await api(app, "/api/state", { method: "GET", origin: "http://evil.example" });
    assert.equal(rejectedAgain.status, 403, "A flood of refusals still answers 403");

    const admin = await signIn(app);
    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const denials = state.data.activities.filter((item) => item.action === "Authorization denied" && item.result === "Failed");
    assert.equal(denials.length, 1, "A rejected cross-site request should be recorded");
    const event = denials[0];
    assert.equal(event.actor, "system", "A request with no session is attributed to the system actor");
    assert.equal(event.role, "system");
    assert.ok(event.clientIp, "The client address should be recorded");
    assert.match(event.resultReason, /did not come from the CommUnity website/);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an authenticated permission denial is logged against the account that was refused", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-authz-audit-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const residentCookie = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Audit Resident",
        email: "audit-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    }).then((r) => r.headers.get("set-cookie")?.split(";")[0] || "");

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const tampered = structuredClone(state.data);
    tampered.permissions.administrator.manageUsers = false;
    const elevation = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: state.revision, data: tampered },
    });
    assert.equal(elevation.status, 403);

    const stateAfter = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const denialEvents = stateAfter.data.activities.filter((item) => item.action === "Authorization denied" && item.result === "Failed");
    assert.ok(denialEvents.length >= 1, "Authorization denial should be logged as a security event");
    const event = denialEvents[0];
    assert.equal(event.actor, "Audit Resident", "The refusal is attributed to the signed-in account");
    assert.equal(event.role, "resident");
    assert.ok(event.resultReason);
    assert.ok(event.clientIp);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("administrator password reset rejects before changing the password when SMTP is not configured", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-pwreset-nosmtp-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Reset Target",
        email: "reset-target@example.test",
        area: "Purok 1",
        password: "A-unique-target-password!",
        confirmPassword: "A-unique-target-password!",
      },
    });

    const beforeHash = await app.db.query(
      "SELECT password_hash FROM user_credentials WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["reset-target@example.test"],
    );
    const beforeSessions = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["reset-target@example.test"],
    );

    const reset = await api(app, "/api/users/password-reset", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "reset-target@example.test" },
    });
    assert.equal(reset.status, 503, "Password reset must fail when email service is not configured");
    const body = await reset.json();
    assert.match(body.error, /Email service/);

    // Password and sessions must be untouched: no lockout when email cannot be delivered
    const afterHash = await app.db.query("SELECT password_hash FROM user_credentials WHERE user_id=(SELECT id FROM users WHERE email=$1)", [
      "reset-target@example.test",
    ]);
    assert.equal(afterHash.rows[0].password_hash, beforeHash.rows[0].password_hash);
    const afterSessions = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["reset-target@example.test"],
    );
    assert.equal(afterSessions.rows[0].count, beforeSessions.rows[0].count);

    // Resident can still sign in with the old password
    const oldSignIn = await signIn(app, "reset-target@example.test", "A-unique-target-password!");
    assert.equal(oldSignIn.response.status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("forgot-password rejects before issuing a reset link when SMTP is not configured", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-forgot-nosmtp-"));
  const app = await startServer(dataDir);
  try {
    const forgot = await api(app, "/api/auth/forgot-password", {
      method: "POST",
      body: { recoveryEmail: "someone@example.test" },
    });
    assert.equal(forgot.status, 503, "Forgot password must fail when email service is not configured");
    const body = await forgot.json();
    assert.match(body.error, /Email service/);

    // No reset token should have been issued
    const tokens = await app.db.query("SELECT count(*)::integer AS count FROM password_reset_tokens");
    assert.equal(tokens.rows[0].count, 0);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("administrator password reset succeeds and delivers the temporary password when SMTP is configured", async () => {
  const smtpServer = await startSmtpSink();
  const port = smtpServer.address().port;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-pwreset-smtp-"));
  const app = await startServer(dataDir, {
    smtpHost: "127.0.0.1",
    smtpPort: String(port),
    smtpUser: "smtp-user",
    smtpPass: "smtp-pass",
    smtpFrom: "CommUnity <noreply@example.test>",
  });
  try {
    const admin = await signIn(app);

    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Reset Target",
        email: "reset-target@example.test",
        area: "Purok 1",
        password: "A-unique-target-password!",
        confirmPassword: "A-unique-target-password!",
      },
    });

    const reset = await api(app, "/api/users/password-reset", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "reset-target@example.test" },
    });
    assert.equal(reset.status, 200, "Password reset must succeed when email service delivers");
    const resetBody = await reset.json();
    assert.ok(resetBody.data, "the reset response carries the updated state");
    assert.ok(Number.isSafeInteger(resetBody.revision) && resetBody.revision >= 1, "the reset response carries the new revision");
    assert.equal(resetBody.user?.email, ADMIN_EMAIL, "the reset response returns the signed-in administrator");

    // Resident's sessions are closed
    const sessions = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["reset-target@example.test"],
    );
    assert.equal(sessions.rows[0].count, 0);

    // Resident must change password on next sign-in
    const resident = await app.db.query("SELECT requires_password_change FROM users WHERE email=$1", ["reset-target@example.test"]);
    assert.equal(resident.rows[0].requires_password_change, true);

    // Old password no longer works
    const oldSignIn = await signIn(app, "reset-target@example.test", "A-unique-target-password!");
    assert.equal(oldSignIn.response.status, 401);
  } finally {
    await app.close();
    smtpServer.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a temporary password reaches only the password change until it is replaced", async () => {
  const smtpServer = await startSmtpSink();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-forced-pw-"));
  const app = await startServer(dataDir, {
    smtpHost: "127.0.0.1",
    smtpPort: String(smtpServer.address().port),
    smtpUser: "smtp-user",
    smtpPass: "smtp-pass",
    smtpFrom: "CommUnity <noreply@example.test>",
  });
  try {
    const admin = await signIn(app);
    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Temp Resident",
        email: "temp-resident@example.test",
        area: "Purok 1",
        password: "Original-Password-1!",
        confirmPassword: "Original-Password-1!",
      },
    });
    const reset = await api(app, "/api/users/password-reset", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "temp-resident@example.test" },
    });
    assert.equal(reset.status, 200);
    const temporaryPassword = mailText(smtpServer.messages.at(-1)).match(/temporary CommUnity password is: (\S+)/)?.[1];
    assert.ok(temporaryPassword, "the temporary password must be delivered");

    const tempSignIn = await signIn(app, "temp-resident@example.test", temporaryPassword);
    assert.equal(tempSignIn.response.status, 200);
    assert.equal(tempSignIn.result.user.requiresPasswordChange, true);
    const cookie = tempSignIn.cookie;

    // The session check still answers so the interface can keep the dialog up.
    const session = await api(app, "/api/session", { cookie });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.requiresPasswordChange, true);

    // Everything else is refused at the dispatcher, reads and writes alike.
    const state = await api(app, "/api/state", { cookie });
    assert.equal(state.status, 403);
    assert.match((await state.json()).error, /Change your password/);
    const unread = await api(app, "/api/community/unread-count", { cookie });
    assert.ok(unread.status !== 200, "protected endpoints stay unreachable while the flag is set");
    const save = await api(app, "/api/state", { method: "PUT", cookie, body: { data: {}, revision: 0 } });
    assert.ok(save.status !== 200, "protected writes stay unreachable while the flag is set");

    // The first refusal is audited as a security event attributed to the account holder.
    const denials = await app.db.query(
      "SELECT count(*)::integer AS count FROM activities WHERE action='Authorization denied' AND actor=$1",
      ["Temp Resident"],
    );
    assert.ok(Number(denials.rows[0].count) >= 1, "a bypass attempt must be audited");

    // Signing out stays available from the dialog.
    const secondSignIn = await signIn(app, "temp-resident@example.test", temporaryPassword);
    assert.equal(secondSignIn.response.status, 200);
    const signOut = await api(app, "/api/auth/logout", { method: "POST", cookie: secondSignIn.cookie });
    assert.equal(signOut.status, 200);

    // The change itself must still verify the current (temporary) password.
    const wrongCurrent = await api(app, "/api/auth/password", {
      method: "POST",
      cookie,
      body: { currentPassword: "Not-The-Temporary-1!", newPassword: "Replaced-Password-1!", confirmPassword: "Replaced-Password-1!" },
    });
    assert.equal(wrongCurrent.status, 400);
    const unchanged = await app.db.query("SELECT requires_password_change FROM users WHERE email=$1", ["temp-resident@example.test"]);
    assert.equal(unchanged.rows[0].requires_password_change, true);

    const change = await api(app, "/api/auth/password", {
      method: "POST",
      cookie,
      body: { currentPassword: temporaryPassword, newPassword: "Replaced-Password-1!", confirmPassword: "Replaced-Password-1!" },
    });
    assert.equal(change.status, 200);
    const cleared = await app.db.query("SELECT requires_password_change FROM users WHERE email=$1", ["temp-resident@example.test"]);
    assert.equal(cleared.rows[0].requires_password_change, false);

    // The session used for the change survives, and the portal is reachable again.
    const restored = await api(app, "/api/state", { cookie });
    assert.equal(restored.status, 200);
  } finally {
    await app.close();
    smtpServer.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function setupVerifiedRecovery(app, smtpServer, accountEmail, recoveryEmail) {
  await api(app, "/api/auth/register", {
    method: "POST",
    body: {
      name: "Recovery Resident",
      email: accountEmail,
      area: "Purok 1",
      password: "A-unique-recovery-password!",
      confirmPassword: "A-unique-recovery-password!",
    },
  });
  const resident = await signIn(app, accountEmail, "A-unique-recovery-password!");
  await api(app, "/api/profile", {
    method: "PUT",
    cookie: resident.cookie,
    body: { name: "Recovery Resident", area: "Purok 1", phone: "", recoveryEmail },
  });
  const message = smtpServer.messages.find((item) => item.includes("verify-recovery"));
  assert.ok(message, "A recovery verification link should have been emailed");
  assert.ok(
    mailText(message).includes(`${app.origin}/#/verify-recovery?token=`),
    "The email should contain an absolute link to the local app",
  );
  const token = mailText(message).match(/token=([A-Za-z0-9_-]{20,})/);
  assert.ok(token, "The verification email should carry a token");
  const verified = await api(app, "/api/auth/verify-recovery", { method: "POST", body: { token: token[1] } });
  assert.equal(verified.status, 200, "The recovery address should verify");
  return resident;
}

test("a recovery email only authorizes a reset once the owner has confirmed it", async () => {
  const smtpServer = await startSmtpSink();
  const port = smtpServer.address().port;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-recovery-verify-"));
  const app = await startServer(dataDir, {
    smtpHost: "127.0.0.1",
    smtpPort: String(port),
    smtpUser: "smtp-user",
    smtpPass: "smtp-pass",
    smtpFrom: "CommUnity <noreply@example.test>",
  });
  try {
    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Recovery Resident",
        email: "recovery-resident@example.test",
        area: "Purok 1",
        password: "A-unique-recovery-password!",
        confirmPassword: "A-unique-recovery-password!",
      },
    });
    const resident = await signIn(app, "recovery-resident@example.test", "A-unique-recovery-password!");

    // Saving a recovery email starts it as unverified
    const saved = await api(app, "/api/profile", {
      method: "PUT",
      cookie: resident.cookie,
      body: { name: "Recovery Resident", area: "Purok 1", phone: "", recoveryEmail: "recovery-box@example.test" },
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.recoveryEmail.verified, false);
    assert.equal(savedBody.recoveryEmail.verificationSent, true);
    assert.equal(savedBody.user.recoveryEmailVerified, false);

    // An unverified address must not authorize a reset
    const unverified = await api(app, "/api/auth/forgot-password", {
      method: "POST",
      body: { recoveryEmail: "recovery-box@example.test" },
    });
    assert.equal(unverified.status, 200);
    const tokens = await app.db.query("SELECT count(*)::integer AS count FROM password_reset_tokens");
    assert.equal(tokens.rows[0].count, 0, "An unverified recovery email must not produce a reset token");

    // Confirm the address, then it can authorize a reset
    const message = smtpServer.messages.find((item) => item.includes("verify-recovery"));
    const token = mailText(message).match(/token=([A-Za-z0-9_-]{20,})/);
    const verified = await api(app, "/api/auth/verify-recovery", { method: "POST", body: { token: token[1] } });
    assert.equal(verified.status, 200);

    await app.db.query("DELETE FROM recovery_email_requests WHERE recovery_email=$1", ["recovery-box@example.test"]);
    const reset = await api(app, "/api/auth/forgot-password", {
      method: "POST",
      body: { recoveryEmail: "recovery-box@example.test" },
    });
    assert.equal(reset.status, 200);
    const tokensAfter = await app.db.query("SELECT count(*)::integer AS count FROM password_reset_tokens");
    assert.equal(tokensAfter.rows[0].count, 1, "A confirmed recovery email should produce a reset token");
  } finally {
    await app.close();
    smtpServer.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("forgot-password refuses repeat requests with a cooldown and an attempt limit", async () => {
  const smtpServer = await startSmtpSink();
  const port = smtpServer.address().port;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-forgot-limits-"));
  const app = await startServer(dataDir, {
    smtpHost: "127.0.0.1",
    smtpPort: String(port),
    smtpUser: "smtp-user",
    smtpPass: "smtp-pass",
    smtpFrom: "CommUnity <noreply@example.test>",
  });
  try {
    const first = await api(app, "/api/auth/forgot-password", {
      method: "POST",
      body: { recoveryEmail: "limits@example.test" },
    });
    assert.equal(first.status, 200);

    // A second request to the same address is held back by the resend cooldown
    const second = await api(app, "/api/auth/forgot-password", {
      method: "POST",
      body: { recoveryEmail: "limits@example.test" },
    });
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /already sent/);

    // Many different addresses from one client eventually hit the attempt limit
    let limited = null;
    for (let index = 0; index < 15; index += 1) {
      const response = await api(app, "/api/auth/forgot-password", {
        method: "POST",
        body: { recoveryEmail: `probe-${index}@example.test` },
      });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    assert.ok(limited, "Repeated requests from one client should be rate limited");
    assert.match((await limited.json()).error, /Too many attempts/);
  } finally {
    await app.close();
    smtpServer.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a repeat reset request leaves the link already sent usable", async () => {
  const smtpServer = await startSmtpSink();
  const port = smtpServer.address().port;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-reset-tokens-"));
  const app = await startServer(dataDir, {
    smtpHost: "127.0.0.1",
    smtpPort: String(port),
    smtpUser: "smtp-user",
    smtpPass: "smtp-pass",
    smtpFrom: "CommUnity <noreply@example.test>",
  });
  try {
    await setupVerifiedRecovery(app, smtpServer, "repeat@example.test", "repeat-box@example.test");

    await api(app, "/api/auth/forgot-password", { method: "POST", body: { recoveryEmail: "repeat-box@example.test" } });
    const afterFirst = await app.db.query("SELECT id FROM password_reset_tokens ORDER BY id");
    assert.equal(afterFirst.rows.length, 1);

    // Clear the cooldown so a second request goes through
    await app.db.query("DELETE FROM recovery_email_requests WHERE recovery_email=$1", ["repeat-box@example.test"]);
    await api(app, "/api/auth/forgot-password", { method: "POST", body: { recoveryEmail: "repeat-box@example.test" } });
    const afterSecond = await app.db.query("SELECT id FROM password_reset_tokens ORDER BY id");
    assert.equal(afterSecond.rows.length, 2, "A second request must not cancel the earlier link");

    // The earlier link still works
    const resetMessages = smtpServer.messages.filter((item) => item.includes("reset-password"));
    assert.equal(resetMessages.length, 2);
    assert.ok(
      mailText(resetMessages[0]).includes(`${app.origin}/#/reset-password?token=`),
      "Reset emails should contain an absolute app link",
    );
    const firstToken = mailText(resetMessages[0]).match(/token=([A-Za-z0-9_-]{20,})/);
    const used = await api(app, "/api/auth/reset-password", {
      method: "POST",
      body: { token: firstToken[1], newPassword: "A-new-recovery-password!" },
    });
    assert.equal(used.status, 200, "The earlier reset link should still be usable");

    // Using a link clears every outstanding token for that account
    const remaining = await app.db.query("SELECT count(*)::integer AS count FROM password_reset_tokens");
    assert.equal(remaining.rows[0].count, 0);
  } finally {
    await app.close();
    smtpServer.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("admin reset requests are rate limited so notifications cannot be flooded", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-admin-reset-limits-"));
  const app = await startServer(dataDir);
  try {
    const first = await api(app, "/api/auth/request-admin-reset", {
      method: "POST",
      body: { email: "reset-target@example.test" },
    });
    assert.equal(first.status, 200);

    let limited = null;
    for (let index = 0; index < 15; index += 1) {
      const response = await api(app, "/api/auth/request-admin-reset", {
        method: "POST",
        body: { email: `probe-${index}@example.test` },
      });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    assert.ok(limited, "Repeated admin reset requests should be rate limited");
    assert.match((await limited.json()).error, /Too many attempts/);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

const PERMISSION_REPORT = {
  id: "RPT-permission-enforcement",
  userEmail: ADMIN_EMAIL,
  name: "Portal administrator",
  category: "Flooding",
  title: "Permission enforcement concern",
  area: "Purok 2",
  barangay: "Palsara",
  locationDetail: "Near the covered court",
  latitude: 14.01799,
  longitude: 121.09465,
  description: "Concern used to prove the permission boundary on concern writes.",
  urgent: false,
  status: "Submitted",
  submittedAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
  photos: [],
  history: [{ status: "Submitted", at: "2026-11-14T00:00:00.000Z", note: "Report received." }],
};

test("administrators with a disabled permission are refused the corresponding restricted operations", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-permission-admin-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const setAdminPermission = (permission, enabled) =>
      app.db.query("UPDATE role_permissions SET enabled=$1 WHERE role='administrator' AND permission=$2", [enabled, permission]);
    const getState = () => api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const putState = (revision, data) => api(app, "/api/state", { method: "PUT", cookie: admin.cookie, body: { revision, data } });

    // Disabling report and schedule management does not stop unrelated saves:
    // a save that changes nothing restricted is still accepted.
    await setAdminPermission("manageReports", false);
    await setAdminPermission("manageSchedules", false);
    const pristine = await getState();
    const noOp = await putState(pristine.revision, pristine.data);
    assert.equal(noOp.status, 200, "a save with no restricted changes must still be accepted");
    const afterNoOp = await noOp.json();

    // A new concern is refused while manageReports is disabled.
    const withReport = structuredClone(afterNoOp.data);
    withReport.reports.push(PERMISSION_REPORT);
    const refusedReport = await putState(afterNoOp.revision, withReport);
    assert.equal(refusedReport.status, 403, "report creation must be refused without manageReports");
    assert.match((await refusedReport.json()).error, /Report management/);

    // Re-enabling the permission lets the same concern through.
    await setAdminPermission("manageReports", true);
    const seeded = await putState(afterNoOp.revision, withReport);
    assert.equal(seeded.status, 200);
    const seededState = await seeded.json();

    // Editing the concern is refused once manageReports is disabled again.
    await setAdminPermission("manageReports", false);
    const editedReport = structuredClone(seededState.data);
    editedReport.reports[0].title = "Hand-edited title";
    const refusedEdit = await putState(seededState.revision, editedReport);
    assert.equal(refusedEdit.status, 403, "report edits must be refused without manageReports");
    await setAdminPermission("manageReports", true);
    await setAdminPermission("manageSchedules", true);

    // Editing the collection schedule is refused without manageSchedules.
    const forSchedules = await getState(); // now carries the seeded concern
    const withSchedule = structuredClone(forSchedules.data);
    withSchedule.schedules.push({
      id: "S-permission-enforcement",
      area: "Purok 2",
      zone: "Zone 2",
      date: "2026-12-01",
      wasteType: "Residual waste",
      start: "08:00 AM",
      end: "10:00 AM",
      frequency: "One-time",
      team: "Collection crew A",
      status: "Scheduled",
      seriesId: null,
      recurrenceEnd: null,
      history: [],
    });
    const seededSchedule = await putState(forSchedules.revision, withSchedule);
    assert.equal(seededSchedule.status, 200);
    const scheduleState = await seededSchedule.json();
    await setAdminPermission("manageSchedules", false);
    const editedSchedule = structuredClone(scheduleState.data);
    editedSchedule.schedules[0].wasteType = "Bulk items";
    const refusedSchedule = await putState(scheduleState.revision, editedSchedule);
    assert.equal(refusedSchedule.status, 403, "schedule edits must be refused without manageSchedules");
    await setAdminPermission("manageSchedules", true);

    // Account management: account creation and lifecycle endpoints are refused without manageUsers.
    await registerResident(app, "permission-target@example.test", "Permission Target");
    await setAdminPermission("manageUsers", false);
    const createdAccount = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Ungated Account",
        email: "ungated@example.test",
        area: "Purok 1",
        role: "resident",
        password: "A-gated-password-2026!",
      },
    });
    assert.equal(createdAccount.status, 403, "account creation must be refused without manageUsers");
    const passwordReset = await api(app, "/api/users/password-reset", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "permission-target@example.test" },
    });
    assert.equal(passwordReset.status, 403, "password reset must be refused without manageUsers");
    const deactivated = await api(app, "/api/users/deactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "permission-target@example.test", reason: "No longer eligible." },
    });
    assert.equal(deactivated.status, 403, "deactivation must be refused without manageUsers");
    const reactivated = await api(app, "/api/users/reactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "permission-target@example.test" },
    });
    assert.equal(reactivated.status, 403, "reactivation must be refused without manageUsers");
    const setPassword = await api(app, "/api/users/password", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        email: "permission-target@example.test",
        newPassword: "A-different-password-2026!",
        confirmPassword: "A-different-password-2026!",
      },
    });
    assert.equal(setPassword.status, 403, "password change must be refused without manageUsers");

    // Editing an account through a state save is refused without manageUsers.
    const beforeEdit = await getState();
    const account = beforeEdit.data.users.find((item) => item.email === "permission-target@example.test");
    assert.ok(account, "the seeded resident should appear in the administrator state");
    const renamed = structuredClone(beforeEdit.data);
    renamed.users.find((item) => item.email === "permission-target@example.test").name = "Renamed Without Permission";
    const refusedRename = await putState(beforeEdit.revision, renamed);
    assert.equal(refusedRename.status, 403, "account edits through a state save must be refused without manageUsers");

    // Changing the community location directory is refused without manageUsers.
    const withLocation = structuredClone(beforeEdit.data);
    withLocation.locations.push({
      id: "LOC-permission-test",
      area: "Purok 9",
      barangay: "Palsara",
      street: "Side Street",
      purok: "Purok 9",
      landmark: "",
    });
    const refusedLocation = await putState(beforeEdit.revision, withLocation);
    assert.equal(refusedLocation.status, 403, "location edits must be refused without manageUsers");
    await setAdminPermission("manageUsers", true);

    // Role permission changes through a state save are refused without manageRoles.
    await setAdminPermission("manageRoles", false);
    const beforeRoles = await getState();
    const permissionFlip = structuredClone(beforeRoles.data);
    permissionFlip.permissions.official.viewSchedules = false;
    const refusedRoles = await putState(beforeRoles.revision, permissionFlip);
    assert.equal(refusedRoles.status, 403, "role permission edits must be refused without manageRoles");
    assert.match((await refusedRoles.json()).error, /Role management/);
    const overrideFlip = structuredClone(beforeRoles.data);
    overrideFlip.accountOverrides = { "official@example.test": { manageSchedules: false } };
    const refusedOverrides = await putState(beforeRoles.revision, overrideFlip);
    assert.equal(refusedOverrides.status, 403, "permission override edits must be refused without manageRoles");
    await setAdminPermission("manageRoles", true);

    // The announcement decision endpoint is refused without manageAnnouncements.
    await setAdminPermission("manageAnnouncements", false);
    const refusedAnnouncement = await api(app, "/api/announcements/approval", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: "1", status: "approved" },
    });
    assert.equal(refusedAnnouncement.status, 403, "announcement approval must be refused without manageAnnouncements");
    await setAdminPermission("manageAnnouncements", true);

    // The calendar-event decision endpoint is refused without manageSchedules.
    await setAdminPermission("manageSchedules", false);
    const refusedEvent = await api(app, "/api/calendar/events/approval", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: 1, status: "approved" },
    });
    assert.equal(refusedEvent.status, 403, "calendar event approval must be refused without manageSchedules");
    await setAdminPermission("manageSchedules", true);

    // The priority endpoint is refused without manageReports.
    await setAdminPermission("manageReports", false);
    const refusedPriority = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: admin.cookie,
      body: { reportId: PERMISSION_REPORT.id, priority: "Low" },
    });
    assert.equal(refusedPriority.status, 403, "priority changes must be refused without manageReports");
    await setAdminPermission("manageReports", true);

    // The audit log endpoints are refused without viewAudit.
    await setAdminPermission("viewAudit", false);
    const refusedLog = await api(app, "/api/community/activity", { cookie: admin.cookie });
    assert.equal(refusedLog.status, 403, "the activity log must be refused without viewAudit");
    const refusedExport = await api(app, "/api/community/activity/export", { cookie: admin.cookie });
    assert.equal(refusedExport.status, 403, "the activity export must be refused without viewAudit");
    await setAdminPermission("viewAudit", true);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a resident with submitReports disabled cannot submit or act on concerns", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-permission-resident-"));
  const app = await startServer(dataDir);
  try {
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Quiet Resident",
        email: "quiet-resident@example.test",
        area: "Purok 1",
        password: "A-unique-quiet-password!",
        confirmPassword: "A-unique-quiet-password!",
      },
    });
    assert.equal(registered.status, 201);
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];
    const getState = () => api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    const putState = (revision, data) => api(app, "/api/state", { method: "PUT", cookie: residentCookie, body: { revision, data } });
    const now = new Date().toISOString();
    const residentReport = (id) => ({
      id,
      userEmail: "quiet-resident@example.test",
      name: "Quiet Resident",
      category: "Drainage problem",
      title: "Drainage problem",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the school entrance",
      description: "Water is pooling across the road near the school entrance.",
      urgent: false,
      status: "Submitted",
      priority: "Medium",
      submittedAt: now,
      updatedAt: now,
      photos: [],
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });

    // Sanity check: with the default permission the resident can submit a concern.
    const initial = await getState();
    const firstState = structuredClone(initial.data);
    firstState.reports.push(residentReport("RPT-permission-quiet-1"));
    const created = await putState(initial.revision, firstState);
    assert.equal(created.status, 200, "a concern can be submitted while submitReports is enabled");

    await app.db.query("UPDATE role_permissions SET enabled=false WHERE role='resident' AND permission='submitReports'");

    // A second concern is refused while the permission is disabled.
    const afterDisable = await getState();
    const secondState = structuredClone(afterDisable.data);
    secondState.reports.push(residentReport("RPT-permission-quiet-2"));
    const refusedReport = await putState(afterDisable.revision, secondState);
    assert.equal(refusedReport.status, 403, "report submission must be refused without submitReports");
    assert.match((await refusedReport.json()).error, /Submitting concerns/);

    // Concern actions are refused too.
    const followUp = await api(app, "/api/community/follow-up", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-permission-quiet-1", message: "The pool is still there after the rain." },
    });
    assert.equal(followUp.status, 403, "follow-ups must be refused without submitReports");
    const confirm = await api(app, "/api/community/report-confirm", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-permission-quiet-1", note: "" },
    });
    assert.equal(confirm.status, 403, "confirmations must be refused without submitReports");
    const reopen = await api(app, "/api/community/report-reopen", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-permission-quiet-1", reason: "The drain is blocked again." },
    });
    assert.equal(reopen.status, 403, "reopening must be refused without submitReports");
    const photos = await api(app, "/api/report-photos", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-permission-quiet-photos" },
    });
    assert.equal(photos.status, 403, "photo uploads must be refused without submitReports");

    // A save that does not add a concern still succeeds with the permission disabled.
    const unchanged = await putState(afterDisable.revision, afterDisable.data);
    assert.equal(unchanged.status, 200, "a save with no new concern must still be accepted");

    // Re-enabling the permission restores concern submission.
    await app.db.query("UPDATE role_permissions SET enabled=true WHERE role='resident' AND permission='submitReports'");
    const restored = await getState();
    const thirdState = structuredClone(restored.data);
    thirdState.reports.push(residentReport("RPT-permission-quiet-3"));
    const resubmitted = await putState(restored.revision, thirdState);
    assert.equal(resubmitted.status, 200, "concern submission is restored once submitReports is enabled");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("report photo uploads cannot escape the uploads directory", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-traversal-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const app = await startServer(dataDir, {}, { uploadsDir });
  try {
    const { cookie } = await registerResident(app, "traversal@example.test", "Traversal Resident");
    const attempts = [
      ["..", "the parent directory"],
      [".", "the current directory"],
      ["../escape", "a nested traversal"],
      ["..%2f..%2fescape", "percent-encoded separators"],
    ];
    for (const [reportId, label] of attempts) {
      const response = await uploadPhoto(app, `/api/report-photos?reportId=${reportId}`, cookie, TEST_JPEG);
      assert.equal(response.status, 400, `${label} must be refused`);
    }

    // Nothing may be written outside the uploads directory.
    const outside = (await readdir(dataDir)).filter((entry) => /\.(jpe?g|png)$/i.test(entry));
    assert.deepEqual(outside, [], "no image may be written outside the uploads directory");

    // A legitimate draft upload still works and lands inside the uploads directory.
    const ok = await uploadPhoto(app, "/api/report-photos?reportId=R-TRAVERSAL-OK", cookie, TEST_JPEG);
    assert.equal(ok.status, 201, await ok.text());
    assert.equal((await readdir(path.join(uploadsDir, "R-TRAVERSAL-OK"))).length, 1);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
