import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn, ADMIN_EMAIL, registerResident, createOfficial, manilaDate } from "./helpers.mjs";
import { archiveOldActivities, pruneOldNotifications, runScheduleReminders } from "../server/index.mjs";

test("the revision endpoint reports the shared revision without fetching state, and requires a session", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-revision-endpoint-"));
  const app = await startServer(dataDir);
  try {
    const anonymous = await api(app, "/api/state/revision");
    assert.equal(anonymous.status, 401);

    const cookie = (await signIn(app)).cookie;
    const first = await api(app, "/api/state/revision", { cookie });
    assert.equal(first.status, 200);
    const firstJson = await first.json();
    assert.equal(typeof firstJson.revision, "number");

    // A revision-check read must not move the counter by itself.
    const again = await api(app, "/api/state/revision", { cookie });
    assert.equal((await again.json()).revision, firstJson.revision);

    const stateBefore = await api(app, "/api/state", { cookie }).then((response) => response.json());
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie,
      body: { revision: stateBefore.revision, data: stateBefore.data },
    });
    assert.equal(saved.status, 200);
    const second = await api(app, "/api/state/revision", { cookie });
    assert.equal((await second.json()).revision, Number(firstJson.revision) + 1);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a resident save survives a collection reminder the server created after the browser's read", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-reminder-save-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const resident = await registerResident(app, "reminder-resident@example.test", "Reminder Resident");

    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    officialState.data.schedules.push({
      id: "GCS-reminder-save",
      area: "Purok 2",
      zone: "Zone A",
      date: manilaDate(1),
      wasteType: "Recyclables",
      start: "6:00 AM",
      end: "9:00 AM",
      frequency: "Weekly",
      team: "Team A",
      status: "Scheduled",
    });
    const scheduleSaved = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(scheduleSaved.status, 200);

    // The resident reads state before the reminder job runs.
    const residentState = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    assert.equal(await runScheduleReminders(app.db), 1, "the reminder matches the barangay's tomorrow");

    // The resident submits a concern from the pre-reminder snapshot, carrying
    // the current revision after a resync but without the reminder in its own
    // notification list. That difference is server work, not a forged update.
    const data = structuredClone(residentState.data);
    const now = new Date().toISOString();
    data.reports.push({
      id: "RPT-reminder-save",
      userEmail: resident.email,
      name: resident.name,
      category: "Flooding",
      title: "Reminder save drainage",
      area: "Purok 2",
      barangay: "Palsara",
      locationDetail: "Near the chapel",
      latitude: 14.01799,
      longitude: 121.09465,
      description: "Water pools near the chapel after rain.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos: [],
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });
    data.activities.push({
      id: "A-reminder-save",
      actor: resident.name,
      role: "resident",
      action: "Submitted a concern",
      detail: "RPT-reminder-save · Reminder save drainage",
      at: now,
      result: "Success",
    });
    const currentRevision = Number((await app.db.query("SELECT revision FROM app_meta WHERE id=1")).rows[0].revision);
    const response = await api(app, "/api/state", {
      method: "PUT",
      cookie: resident.cookie,
      body: { revision: currentRevision, data },
    });
    const savedState = await response.json();
    assert.equal(response.status, 200, savedState.error || "the save should be accepted");

    const stored = await app.db.query("SELECT count(*)::integer AS count FROM notifications WHERE title='Collection reminder'");
    assert.equal(stored.rows[0].count, 1, "the reminder is neither lost nor duplicated");
    assert.ok(
      savedState.data.notifications.some((item) => item.title === "Collection reminder"),
      "the resynced state includes the server-created reminder",
    );
    assert.ok(
      savedState.data.reports.some((item) => item.id === "RPT-reminder-save"),
      "the concern the resident submitted is stored",
    );
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an unchanged resident save survives the 90-day notification prune", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-prune-save-"));
  const app = await startServer(dataDir);
  try {
    const resident = await registerResident(app, "prune-resident@example.test", "Prune Resident");
    await app.db.query(
      `
      INSERT INTO notifications (id, target_email, report_id, title, body, created_at, read)
      VALUES ('N-old', $1, NULL, 'Old notice', 'This notice is pruned.', now() - interval '100 days', false)
    `,
      [resident.email],
    );

    const state = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    assert.equal(
      state.data.notifications.some((item) => item.id === "N-old"),
      true,
      "the browser's copy still holds the notice the job is about to prune",
    );

    assert.equal(await pruneOldNotifications(app.db), 1, "the old notice is pruned");

    // The browser saves with the current revision but its list still names the
    // pruned row; the server must not treat that as a forged update.
    const currentRevision = Number((await app.db.query("SELECT revision FROM app_meta WHERE id=1")).rows[0].revision);
    const response = await api(app, "/api/state", {
      method: "PUT",
      cookie: resident.cookie,
      body: { revision: currentRevision, data: state.data },
    });
    assert.equal(response.status, 200, await response.text());

    const stored = await app.db.query("SELECT count(*)::integer AS count FROM notifications WHERE target_email=$1", [resident.email]);
    assert.equal(stored.rows[0].count, 0, "the pruned notice stays pruned");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an administrator save cannot resurrect a record the archive job moved", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-archive-save-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());

    // The record is written after the browser's read, then archived, so the
    // browser's activity list names a row the live log no longer has.
    await app.db.query(`
      INSERT INTO activities (id, actor, role, action, detail, at, result)
      VALUES ('OLD-ARCH', 'system', 'system', 'Old event', 'old', now() - interval '100 days', 'Success')
    `);
    await archiveOldActivities(app.db);

    const currentRevision = Number((await app.db.query("SELECT revision FROM app_meta WHERE id=1")).rows[0].revision);
    const response = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: currentRevision, data: state.data },
    });
    assert.equal(response.status, 200, await response.text());

    const live = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE id='OLD-ARCH'");
    assert.equal(live.rows[0].count, 0, "an archived record stays archived");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("background notification and archive jobs advance the shared revision only when state changes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-revision-jobs-"));
  const app = await startServer(dataDir);
  try {
    const revision = async () => Number((await app.db.query("SELECT revision FROM app_meta WHERE id=1")).rows[0].revision);

    let before = await revision();
    assert.equal(await runScheduleReminders(app.db), 0);
    assert.equal(await revision(), before, "an idle reminder run does not advance the revision");

    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    await registerResident(app, "revision-resident@example.test", "Revision Resident");
    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    officialState.data.schedules.push({
      id: "GCS-revision",
      area: "Purok 2",
      zone: "Zone A",
      date: manilaDate(1),
      wasteType: "Recyclables",
      start: "6:00 AM",
      end: "9:00 AM",
      frequency: "Weekly",
      team: "Team A",
      status: "Scheduled",
    });
    const scheduleSaved = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(scheduleSaved.status, 200);

    before = await revision();
    assert.equal(await runScheduleReminders(app.db), 1);
    assert.equal(await revision(), before + 1, "a created reminder advances the revision");
    assert.equal(await runScheduleReminders(app.db), 0);
    assert.equal(await revision(), before + 1, "a repeat reminder run does not advance the revision");

    await archiveOldActivities(app.db);
    before = await revision();
    await archiveOldActivities(app.db);
    assert.equal(await revision(), before, "archiving nothing does not advance the revision");
    await app.db.query(`
      INSERT INTO activities (id, actor, role, action, detail, at, result)
      VALUES ('OLD-REV', 'system', 'system', 'Old event', 'old', now() - interval '100 days', 'Success')
    `);
    before = await revision();
    await archiveOldActivities(app.db);
    assert.equal(await revision(), before + 1, "archiving a record advances the revision");
    await archiveOldActivities(app.db);
    assert.equal(await revision(), before + 1, "a repeat archive run does not advance the revision");

    before = await revision();
    assert.equal(await pruneOldNotifications(app.db), 0);
    assert.equal(await revision(), before, "pruning nothing does not advance the revision");
    await app.db.query(`
      INSERT INTO notifications (id, target_email, report_id, title, body, created_at, read)
      VALUES ('N-REV', 'admin@example.test', NULL, 'Old', 'old', now() - interval '100 days', false)
    `);
    before = await revision();
    assert.equal(await pruneOldNotifications(app.db), 1);
    assert.equal(await revision(), before + 1, "pruning a notification advances the revision");

    before = await revision();
    const resetRequest = await api(app, "/api/auth/password-reset-request", {
      method: "POST",
      body: { email: "revision-resident@example.test" },
    });
    assert.equal(resetRequest.status, 202);
    assert.equal(await revision(), before + 1, "a password reset request advances the revision");

    before = await revision();
    const adminReset = await api(app, "/api/auth/request-admin-reset", {
      method: "POST",
      body: { email: "revision-resident@example.test" },
    });
    assert.equal(adminReset.status, 200);
    assert.equal(await revision(), before + 1, "an administrator reset request advances the revision");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an unchanged administrator save survives a new activity row", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-save-after-activity-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());

    const failed = await api(app, "/api/auth/login", {
      method: "POST",
      body: { email: ADMIN_EMAIL, password: "wrong-password" },
    });
    assert.equal(failed.status, 401);

    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(saved.status, 200, "A server-written activity must not look like a client edit");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
