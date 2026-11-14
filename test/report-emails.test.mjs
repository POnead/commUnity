import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startServer, api, signIn, startSmtpSink, mailText, registerResident, createOfficial, seedReport } from "./helpers.mjs";

// Emails are queued after the response is sent, so tests wait for the sink
// instead of assuming the message exists as soon as the request resolves.
async function waitForMessage(sink, pattern, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const message = sink.messages.find((item) => pattern.test(mailText(item)));
    if (message) return mailText(message);
    await delay(25);
  }
  assert.fail(`${label} was not delivered to the SMTP sink`);
}

test("submitting a concern emails staff with the configured sender and keeps in-app notifications", async () => {
  const sink = await startSmtpSink();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-concern-email-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    // Configure SMTP through the same endpoint the settings page uses, so the
    // test also proves a mailer saved at runtime is the one the state handler reads.
    const settings = await api(app, "/api/settings/smtp", {
      method: "PUT",
      cookie: admin.cookie,
      body: {
        host: "127.0.0.1",
        port: sink.address().port,
        user: "mailer",
        pass: "a-fake-mailbox-password",
        from: "no-reply@example.test",
      },
    });
    assert.equal(settings.status, 200, await settings.text());

    await createOfficial(app, admin.cookie);
    const resident = await registerResident(app, "emailing-resident@example.test", "Emailing Resident");

    const state = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    const now = new Date().toISOString();
    state.data.reports.push({
      id: "RPT-email-submit",
      userEmail: resident.email,
      name: resident.name,
      category: "Streetlight",
      title: "Broken streetlight",
      area: "Purok 2",
      barangay: "Palsara",
      locationDetail: "Near the chapel",
      latitude: 14.01799,
      longitude: 121.09465,
      description: "The streetlight near the chapel stopped working after the storm.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos: [],
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });

    const submitted = await api(app, "/api/state", {
      method: "PUT",
      cookie: resident.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(submitted.status, 200, await submitted.text());

    const adminMessage = await waitForMessage(sink, /To: .*admin@example\.test/i, "the administrator concern email");
    assert.match(adminMessage, /From: .*no-reply@example\.test/i, "the saved sender must be used");
    assert.match(adminMessage, /Subject: New concern: Broken streetlight/);
    assert.match(adminMessage, /Emailing Resident submitted a report for Palsara, Purok 2, near Near the chapel\./);
    assert.match(adminMessage, /#\/official\/concerns/, "the email links to the concern queue");

    const officialMessage = await waitForMessage(sink, /To: .*official@example\.test/i, "the official concern email");
    assert.match(officialMessage, /Subject: New concern: Broken streetlight/);

    // In-app notifications are a separate channel and must stay intact.
    const staffNotifications = await app.db.query(
      "SELECT count(*)::integer AS count FROM notifications WHERE report_id=$1 AND title='New concern: Broken streetlight'",
      ["RPT-email-submit"],
    );
    assert.equal(staffNotifications.rows[0].count, 2, "both active staff accounts get an in-app notification");
    const residentNotification = await app.db.query(
      "SELECT count(*)::integer AS count FROM notifications WHERE report_id=$1 AND target_email=$2 AND title='Report submitted'",
      ["RPT-email-submit", resident.email],
    );
    assert.equal(residentNotification.rows[0].count, 1, "the resident's in-app receipt is still recorded");
  } finally {
    await app.close();
    sink.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(path.join(path.dirname(dataDir), "smtp-settings.key"), { force: true });
  }
});

test("an official status update emails the resident and keeps the in-app notification", async () => {
  const sink = await startSmtpSink();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-status-email-"));
  const app = await startServer(dataDir, {
    smtpHost: "127.0.0.1",
    smtpPort: String(sink.address().port),
    smtpUser: "smtp-user",
    smtpPass: "smtp-pass",
    smtpFrom: "CommUnity <no-reply@example.test>",
  });
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const resident = await registerResident(app, "status-resident@example.test", "Status Resident");
    const reportId = await seedReport(app, resident, { idSuffix: "status-email" });
    // The submission itself emailed staff; isolate the status-update message.
    sink.messages.length = 0;

    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const report = officialState.data.reports.find((item) => item.id === reportId);
    assert.ok(report, "the official can see the resident's concern");
    const now = new Date().toISOString();
    report.status = "Under Review";
    report.updatedAt = now;
    report.history.push({ status: "Under Review", at: now, note: "We are checking the drainage." });

    const updated = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(updated.status, 200, await updated.text());

    const message = await waitForMessage(sink, /To: .*status-resident@example\.test/i, "the resident status email");
    assert.match(message, /From: .*no-reply@example\.test/i, "the configured sender must be used");
    assert.match(message, new RegExp(`Subject: Your report ${reportId} is under review`));
    assert.match(message, /We are checking the drainage\./);
    assert.match(message, /#\/resident\/reports/, "the email links to the resident's reports");

    const notification = await app.db.query(
      "SELECT title, body FROM notifications WHERE target_email=$1 AND report_id=$2 AND title='Report under review'",
      [resident.email, reportId],
    );
    assert.equal(notification.rows.length, 1, "the in-app status notification is still recorded");
    assert.equal(notification.rows[0].title, "Report under review");
    assert.match(notification.rows[0].body, /We are checking the drainage\./);
  } finally {
    await app.close();
    sink.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(path.join(path.dirname(dataDir), "smtp-settings.key"), { force: true });
  }
});
