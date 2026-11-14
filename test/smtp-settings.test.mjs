import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn, startSmtpSink, mailText } from "./helpers.mjs";

// The email settings page must work end to end with zero server environment
// configuration: the password is stored AES-GCM encrypted with a locally
// generated key file (see server/platform/smtp-key.mjs).
test("SMTP settings save from the website and send a test email with no environment secrets", async () => {
  const sink = await startSmtpSink();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-smtp-"));
  const keyPath = path.join(path.dirname(dataDir), "smtp-settings.key");
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    const saved = await api(app, "/api/settings/smtp", {
      method: "PUT",
      cookie: admin.cookie,
      body: {
        host: "127.0.0.1",
        port: sink.address().port,
        user: "mailer",
        from: "no-reply@example.test",
        pass: "a-fake-mailbox-password",
      },
    });
    assert.equal(saved.status, 200, `save failed: ${await saved.text()}`);

    const retrieved = await api(app, "/api/settings/smtp", { cookie: admin.cookie }).then((response) => response.json());
    assert.equal(retrieved.encryptionReady, true);
    assert.equal(retrieved.settings.configured, true);
    assert.equal(retrieved.settings.pass, undefined, "the password must never be echoed back");

    // A key file was generated next to the data directory, not inside it or in the database.
    const keyContents = await readFile(keyPath, "utf8");
    assert.ok(keyContents.trim().length > 20, "a generated key file holds the local encryption key");

    // A test email flows through the configured mailer to the administrator's address.
    const testMail = await api(app, "/api/settings/smtp/test", { method: "POST", cookie: admin.cookie });
    assert.equal(testMail.status, 200, `test email failed: ${await testMail.text()}`);
    assert.equal(sink.messages.length, 1, "the sink received the test message");
    assert.match(mailText(sink.messages[0]), /CommUnity SMTP test/);

    // Settings survive a restart: the same key file decrypts them.
    await app.close();
    const reopened = await startServer(dataDir);
    try {
      const restored = await signIn(reopened);
      const again = await api(reopened, "/api/settings/smtp", { cookie: restored.cookie }).then((response) => response.json());
      assert.equal(again.settings.configured, true, "saved SMTP settings decrypt after a restart");
      assert.equal(again.settings.host, "127.0.0.1");
    } finally {
      await reopened.close();
    }
  } finally {
    await app.close().catch(() => {});
    sink.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(keyPath, { force: true });
  }
});

test("clearing SMTP settings from the website round-trips to no mailer configured", async () => {
  const sink = await startSmtpSink();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-smtp-clear-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    const saved = await api(app, "/api/settings/smtp", {
      method: "PUT",
      cookie: admin.cookie,
      body: {
        host: "127.0.0.1",
        port: sink.address().port,
        user: "mailer",
        from: "no-reply@example.test",
        pass: "a-fake-mailbox-password",
      },
    });
    assert.equal(saved.status, 200, `save failed: ${await saved.text()}`);

    const before = await api(app, "/api/settings/smtp", { cookie: admin.cookie }).then((response) => response.json());
    assert.equal(before.settings.configured, true);

    const cleared = await api(app, "/api/settings/smtp", { method: "DELETE", cookie: admin.cookie });
    assert.equal(cleared.status, 200, `clear failed: ${await cleared.text()}`);

    const after = await api(app, "/api/settings/smtp", { cookie: admin.cookie }).then((response) => response.json());
    assert.equal(after.settings.configured, false, "the mailer must be unconfigured after the clear");
    assert.equal(after.settings.host, "", "the host is forgotten");
    const testMail = await api(app, "/api/settings/smtp/test", { method: "POST", cookie: admin.cookie });
    assert.equal(testMail.status, 400, "the test email needs a configured mailer");
  } finally {
    await app.close().catch(() => {});
    sink.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(path.join(path.dirname(dataDir), "smtp-settings.key"), { force: true });
  }
});

test("a broken mail server surfaces a readable error from the test endpoint", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-smtp-unreachable-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const saved = await api(app, "/api/settings/smtp", {
      method: "PUT",
      cookie: admin.cookie,
      body: { host: "127.0.0.1", port: 1, user: "mailer", from: "no-reply@example.test", pass: "a-fake-mailbox-password" },
    });
    assert.equal(saved.status, 200);

    const result = await api(app, "/api/settings/smtp/test", { method: "POST", cookie: admin.cookie });
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /could not be sent/i);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(path.join(path.dirname(dataDir), "smtp-settings.key"), { force: true });
  }
});
