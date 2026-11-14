import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ADMIN_EMAIL, ADMIN_PASSWORD, api, mailText, signIn, startServer, startSmtpSink } from "./helpers.mjs";

test("account email changes only after password confirmation and verification of the new address", async () => {
  const sink = await startSmtpSink();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-email-change-"));
  const app = await startServer(dataDir, {
    smtpHost: "127.0.0.1",
    smtpPort: String(sink.address().port),
    smtpUser: "mailer",
    smtpPass: "smtp-password",
    smtpFrom: "CommUnity <no-reply@example.test>",
  });
  const newEmail = "princedeano.rodriguez@gmail.com";
  try {
    const admin = await signIn(app);
    const denied = await api(app, "/api/auth/change-email", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: newEmail, currentPassword: "wrong-password" },
    });
    assert.equal(denied.status, 400);

    const requested = await api(app, "/api/auth/change-email", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: newEmail, currentPassword: ADMIN_PASSWORD },
    });
    assert.equal(requested.status, 200, await requested.text());
    const stillOld = await signIn(app, ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.equal(stillOld.response.status, 200, "the current login remains active until the new address is verified");
    const message = sink.messages.find((item) => item.includes("verify-email"));
    assert.ok(message, "a verification message should be sent");
    assert.ok(mailText(message).includes(`${app.origin}/#/verify-email?token=`), "the email should include a complete app link");
    assert.match(message, new RegExp(`To:.*${newEmail}`, "i"));
    const token = mailText(message).match(/token=([A-Za-z0-9_-]{20,})/);
    assert.ok(token, "the verification message should carry a token");

    const verified = await api(app, "/api/auth/verify-email", { method: "POST", cookie: admin.cookie, body: { token: token[1] } });
    assert.equal(verified.status, 200, await verified.clone().text());
    assert.equal((await verified.json()).user.email, newEmail, "the current session receives the new account email");
    assert.equal((await api(app, "/api/auth/verify-email", { method: "POST", body: { token: token[1] } })).status, 400);
    assert.equal((await signIn(app, ADMIN_EMAIL, ADMIN_PASSWORD)).response.status, 401);
    assert.equal((await signIn(app, newEmail, ADMIN_PASSWORD)).response.status, 200);
  } finally {
    await app.close();
    sink.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
