import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_JPEG,
  api,
  createOfficial,
  mailText,
  registerResident,
  signIn,
  startServer,
  startSmtpSink,
  uploadPhoto,
} from "./helpers.mjs";

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

async function waitForMail(sink, pattern, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const message = sink.messages.find((item) => pattern.test(mailText(item)));
    if (message) return mailText(message);
    await delay(25);
  }
  assert.fail(`${label} was not delivered to the SMTP sink`);
}

test("a verified email change keeps the resident's reports, photos, and notifications reachable", async () => {
  const sink = await startSmtpSink();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-email-change-continuity-"));
  const app = await startServer(dataDir, {
    smtpHost: "127.0.0.1",
    smtpPort: String(sink.address().port),
    smtpUser: "mailer",
    smtpPass: "smtp-password",
    smtpFrom: "CommUnity <no-reply@example.test>",
  });
  const oldEmail = "before-change@example.test";
  const newEmail = "after-change@example.test";
  const reportId = "RPT-email-continuity";
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const resident = await registerResident(app, oldEmail, "Moving Resident");

    // The resident submits a concern with one photo before changing the address.
    const uploaded = await uploadPhoto(app, `/api/report-photos?reportId=${reportId}`, resident.cookie, TEST_JPEG);
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const photos = (await uploaded.json()).photos;
    assert.equal(photos.length, 1);

    const state = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    const now = new Date().toISOString();
    state.data.reports.push({
      id: reportId,
      userEmail: oldEmail,
      name: resident.name,
      category: "Streetlight",
      title: "Broken streetlight before moving",
      area: "Purok 2",
      barangay: "Palsara",
      locationDetail: "Near the school",
      latitude: 14.01799,
      longitude: 121.09465,
      description: "The streetlight near the school is broken.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos,
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });
    const submitted = await api(app, "/api/state", {
      method: "PUT",
      cookie: resident.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(submitted.status, 200, await submitted.text());
    assert.equal((await fetch(`${app.origin}${photos[0].photoUrl}`, { headers: { Cookie: resident.cookie } })).status, 200);

    // Change and verify the sign-in address.
    const requested = await api(app, "/api/auth/change-email", {
      method: "POST",
      cookie: resident.cookie,
      body: { email: newEmail, currentPassword: "A-unique-resident-password!" },
    });
    assert.equal(requested.status, 200, await requested.text());
    const verification = await waitForMail(sink, /To: .*after-change@example\.test/i, "the email change verification");
    const token = verification.match(/token=([A-Za-z0-9_-]{20,})/);
    assert.ok(token, "the verification message should carry a token");
    const verified = await api(app, "/api/auth/verify-email", {
      method: "POST",
      cookie: resident.cookie,
      body: { token: token[1] },
    });
    assert.equal(verified.status, 200, await verified.clone().text());
    assert.equal((await verified.json()).user.email, newEmail);

    // Everything the resident already had must follow the account to its new address.
    const afterChange = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    assert.ok(
      afterChange.data.reports.some((report) => report.id === reportId),
      "the existing concern still appears on the resident's dashboard",
    );
    assert.ok(
      afterChange.data.notifications.some((item) => item.title === "Report submitted"),
      "the earlier notification is still in the resident's inbox",
    );
    assert.equal(
      (await fetch(`${app.origin}${photos[0].photoUrl}`, { headers: { Cookie: resident.cookie } })).status,
      200,
      "the resident can still open the photo attached before the change",
    );
    const stored = await app.db.query(
      `SELECT
        (SELECT count(*)::integer FROM reports WHERE id=$1 AND user_email=$2) AS reports,
        (SELECT count(*)::integer FROM notifications WHERE target_email=$2) AS notifications,
        (SELECT count(*)::integer FROM reports WHERE user_email=$3) AS old_reports,
        (SELECT count(*)::integer FROM notifications WHERE target_email=$3) AS old_notifications`,
      [reportId, newEmail, oldEmail],
    );
    assert.deepEqual(stored.rows[0], { reports: 1, notifications: 1, old_reports: 0, old_notifications: 0 });

    // A later status update must notify the new address, in-app and by email.
    sink.messages.length = 0;
    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const report = officialState.data.reports.find((item) => item.id === reportId);
    assert.ok(report, "the official can still see the concern");
    const updatedAt = new Date().toISOString();
    report.status = "Under Review";
    report.updatedAt = updatedAt;
    report.history.push({ status: "Under Review", at: updatedAt, note: "We are checking the streetlight." });
    const updated = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(updated.status, 200, await updated.text());

    const statusMail = await waitForMail(sink, /To: .*after-change@example\.test/i, "the status email at the new address");
    assert.match(statusMail, new RegExp(`Subject: Your report ${reportId} is under review`));
    assert.ok(!sink.messages.some((item) => /To: .*before-change@example\.test/i.test(mailText(item))), "no mail goes to the old address");
    const notification = await app.db.query(
      "SELECT count(*)::integer AS count FROM notifications WHERE target_email=$1 AND report_id=$2 AND title='Report under review'",
      [newEmail, reportId],
    );
    assert.equal(notification.rows[0].count, 1, "the in-app update follows the new address");
  } finally {
    await app.close();
    sink.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
