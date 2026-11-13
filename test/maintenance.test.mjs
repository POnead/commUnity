import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn, TEST_JPEG, ADMIN_EMAIL, registerResident } from "./helpers.mjs";
import { archiveOldActivities, runScheduleReminders, sweepOrphanUploads } from "../server/index.mjs";

test("manages locations and announcements and sends idempotent collection reminders", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-directory-"));
  const app = await startServer(dataDir);
  try {
    const publicLocations = await api(app, "/api/locations");
    assert.equal(publicLocations.status, 200);
    assert.equal((await publicLocations.json()).locations.length, 6);

    const admin = await signIn(app);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Directory Resident",
        email: "directory-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];

    const invalidArea = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Invalid Area",
        email: "invalid-area@example.test",
        area: "Not a managed location",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(invalidArea.status, 400);

    let adminState = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    adminState.data.locations.push({
      id: "LOC-test-6",
      area: "Purok 6",
      barangay: "Palsara",
      street: "Mabini Street",
      purok: "Purok 6",
      landmark: "Community Hall",
    });
    adminState.data.recyclingLocations.push({
      id: "REC-test-1",
      name: "Palsara Materials Recovery Center",
      barangay: "Palsara",
      street: "Mabini Street",
      purok: "Purok 6",
      landmark: "Community Hall",
      materials: "PET bottles and cardboard",
      phone: "",
      hours: "Weekdays",
      active: true,
    });
    const updatedDirectory = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: adminState.revision, data: adminState.data },
    });
    assert.equal(updatedDirectory.status, 200);
    const residentState = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    assert.equal(
      residentState.data.locations.some((item) => item.area === "Purok 6"),
      true,
    );
    assert.equal(residentState.data.recyclingLocations.length, 1);

    const alteredDirectory = structuredClone(residentState.data);
    alteredDirectory.locations[0].area = "Tampered";
    const forbiddenDirectoryWrite = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: residentState.revision, data: alteredDirectory },
    });
    assert.equal(forbiddenDirectoryWrite.status, 403);

    const officialCreated = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Directory Official",
        email: "directory-official@example.test",
        area: "Palsara",
        role: "official",
        status: "Active",
        password: "A-unique-official-password!",
      },
    });
    assert.equal(officialCreated.status, 201);
    const official = await signIn(app, "directory-official@example.test", "A-unique-official-password!");
    assert.equal(official.response.status, 200);

    const createAnnouncement = await api(app, "/api/announcements", {
      method: "POST",
      cookie: official.cookie,
      body: { title: "Pickup update", detail: "The next collection begins at 6:00 AM.", date: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(createAnnouncement.status, 200);
    let announcementState = await createAnnouncement.json();
    const announcement = announcementState.data.announcements[0];
    assert.ok(announcement.id);
    assert.equal(announcement.isEvent, false);
    assert.equal(announcement.latitude, null);
    assert.equal(announcement.longitude, null);

    const createEventAnnouncement = await api(app, "/api/announcements", {
      method: "POST",
      cookie: official.cookie,
      body: {
        title: "Community clean-up",
        detail: "Meet at the covered court before the clean-up starts.",
        date: new Date().toISOString().slice(0, 10),
        isEvent: true,
        latitude: 14.01799,
        longitude: 121.09465,
      },
    });
    assert.equal(createEventAnnouncement.status, 200);
    const eventAnnouncementState = await createEventAnnouncement.json();
    const eventAnnouncement = eventAnnouncementState.data.announcements[0];
    assert.equal(eventAnnouncement.isEvent, true);
    assert.equal(eventAnnouncement.latitude, 14.01799);
    assert.equal(eventAnnouncement.longitude, 121.09465);

    const missingEventPin = await api(app, "/api/announcements", {
      method: "POST",
      cookie: official.cookie,
      body: {
        title: "Event without a pin",
        detail: "This event should be rejected.",
        date: new Date().toISOString().slice(0, 10),
        isEvent: true,
      },
    });
    assert.equal(missingEventPin.status, 400);

    const invalidEventPin = await api(app, "/api/announcements", {
      method: "POST",
      cookie: official.cookie,
      body: {
        title: "Event with an invalid pin",
        detail: "This event should be rejected.",
        date: new Date().toISOString().slice(0, 10),
        isEvent: true,
        latitude: 140,
        longitude: 121.09465,
      },
    });
    assert.equal(invalidEventPin.status, 400);

    const approveEventAnnouncement = await api(app, "/api/announcements/approval", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: eventAnnouncement.id, status: "approved" },
    });
    assert.equal(approveEventAnnouncement.status, 200);
    const residentEventState = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    const residentEvent = residentEventState.data.announcements.find((item) => item.id === eventAnnouncement.id);
    assert.equal(residentEvent.isEvent, true);
    assert.equal(residentEvent.latitude, 14.01799);
    assert.equal(residentEvent.longitude, 121.09465);

    const toggleEventOff = await api(app, "/api/announcements", {
      method: "PUT",
      cookie: official.cookie,
      body: { ...eventAnnouncement, isEvent: false },
    });
    assert.equal(toggleEventOff.status, 200);
    const toggledEvent = (await toggleEventOff.json()).data.announcements.find((item) => item.id === eventAnnouncement.id);
    assert.equal(toggledEvent.isEvent, false);
    assert.equal(toggledEvent.latitude, null);
    assert.equal(toggledEvent.longitude, null);

    const deleteEventAnnouncement = await api(app, "/api/announcements", {
      method: "DELETE",
      cookie: official.cookie,
      body: { id: eventAnnouncement.id },
    });
    assert.equal(deleteEventAnnouncement.status, 200);

    const editAnnouncement = await api(app, "/api/announcements", {
      method: "PUT",
      cookie: official.cookie,
      body: { ...announcement, title: "Updated pickup update" },
    });
    assert.equal(editAnnouncement.status, 200);
    const deleteAnnouncement = await api(app, "/api/announcements", {
      method: "DELETE",
      cookie: official.cookie,
      body: { id: announcement.id },
    });
    assert.equal(deleteAnnouncement.status, 200);
    assert.equal((await deleteAnnouncement.json()).data.announcements.length, 0);
    const forbiddenAnnouncement = await api(app, "/api/announcements", {
      method: "POST",
      cookie: residentCookie,
      body: { title: "No access", detail: "Residents cannot publish announcements.", date: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(forbiddenAnnouncement.status, 403);

    const officialState = await api(app, "/api/state", { cookie: official.cookie }).then((response) => response.json());
    const tomorrow = await app.db.query("SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date + 1, 'YYYY-MM-DD') AS date");
    officialState.data.schedules.push({
      id: "GCS-reminder-test",
      area: "Purok 1",
      zone: "Zone A",
      date: tomorrow.rows[0].date,
      wasteType: "Recyclables",
      start: "6:00 AM",
      end: "9:00 AM",
      frequency: "Weekly",
      team: "Team A",
      status: "Scheduled",
    });
    const scheduleResponse = await api(app, "/api/state", {
      method: "PUT",
      cookie: official.cookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(scheduleResponse.status, 200);
    await runScheduleReminders(app.db);
    const afterReminder = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    assert.equal(afterReminder.data.notifications.filter((item) => item.title === "Collection reminder").length, 1);
    const reminderRows = await app.db.query("SELECT count(*)::integer AS count FROM schedule_reminders");
    assert.equal(reminderRows.rows[0].count, 1);

    const registeredNewArea = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Purok Six Resident",
        email: "purok-six-resident@example.test",
        area: "Purok 6",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registeredNewArea.status, 201);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an existing database is upgraded to backfill the recorded resolution and first response", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-resolved-upgrade-"));
  const first = await startServer(dataDir);
  const moments = {
    submitted: new Date("2026-01-02T08:00:00.000Z"),
    underReview: new Date("2026-01-03T09:00:00.000Z"),
    inProgress: new Date("2026-01-04T10:00:00.000Z"),
    resolved: new Date("2026-01-05T11:00:00.000Z"),
    confirmed: new Date("2026-01-06T12:00:00.000Z"),
    reopened: new Date("2026-01-07T13:00:00.000Z"),
    reviewedAgain: new Date("2026-01-08T14:00:00.000Z"),
    resolvedAgain: new Date("2026-01-09T15:00:00.000Z"),
    alreadyRecorded: new Date("2026-01-01T07:00:00.000Z"),
  };
  try {
    const { email, name } = await registerResident(first, "legacy@example.test", "Legacy Resident");
    // Concerns that were filed, answered and resolved before the resolved_at and
    // responded_at columns existed: their status history still holds the moments.
    const insertReport = async (id, status, resolvedAt = null, respondedAt = null, serviceCycleStartedAt = moments.submitted) => {
      await first.db.query(
        `
        INSERT INTO reports (id,user_email,name,category,title,area,description,status,submitted_at,updated_at,responded_at,resolved_at,service_cycle_started_at)
        VALUES ($1,$2,$3,'Road damage',$4,'Purok 2','A large pothole near the barangay hall needs patching.',$5,$6,$6,$7,$8,$9)
      `,
        [id, email, name, id, status, moments.submitted, respondedAt, resolvedAt, serviceCycleStartedAt],
      );
    };
    const insertHistory = async (id, entries) => {
      for (const [position, entry] of entries.entries()) {
        await first.db.query(
          "INSERT INTO report_history (report_id,position,status,at,note,actor_name,actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [id, position, entry.status, entry.at, entry.note, entry.actorRole === "resident" ? name : "Official One", entry.actorRole],
        );
      }
    };

    // Resolved normally, then confirmed by the resident.
    await insertReport("R-LEGACY-01", "Resolved");
    await insertHistory("R-LEGACY-01", [
      { status: "Submitted", at: moments.submitted, note: "Report received.", actorRole: "resident" },
      { status: "Under Review", at: moments.underReview, note: "A barangay official is reviewing this report.", actorRole: "official" },
      { status: "In Progress", at: moments.inProgress, note: "The crew is scheduled to patch the road.", actorRole: "official" },
      { status: "Resolved", at: moments.resolved, note: "The road has been patched.", actorRole: "official" },
      { status: "Resolved", at: moments.confirmed, note: "Resident confirmed the issue was addressed.", actorRole: "resident" },
    ]);

    // Resolved in one step, with no separate review entry.
    await insertReport("R-LEGACY-02", "Resolved");
    await insertHistory("R-LEGACY-02", [
      { status: "Submitted", at: moments.submitted, note: "Report received.", actorRole: "resident" },
      { status: "Resolved", at: moments.resolved, note: "Status updated to Resolved.", actorRole: "official" },
    ]);

    // Reopened after being resolved, then resolved again.
    await insertReport("R-LEGACY-03", "Resolved", null, null, moments.reopened);
    await insertHistory("R-LEGACY-03", [
      { status: "Submitted", at: moments.submitted, note: "Report received.", actorRole: "resident" },
      { status: "Resolved", at: moments.resolved, note: "The road has been patched.", actorRole: "official" },
      { status: "Submitted", at: moments.reopened, note: "Resident requested reopening: The patch did not hold.", actorRole: "resident" },
      { status: "Under Review", at: moments.reviewedAgain, note: "A barangay official is reviewing this report.", actorRole: "official" },
      { status: "Resolved", at: moments.resolvedAgain, note: "The road has been patched again.", actorRole: "official" },
    ]);

    // Still waiting for its first response.
    await insertReport("R-LEGACY-04", "Submitted");
    await insertHistory("R-LEGACY-04", [{ status: "Submitted", at: moments.submitted, note: "Report received.", actorRole: "resident" }]);

    // A concern that already carries its own recorded moments.
    await insertReport("R-LEGACY-05", "Resolved", moments.alreadyRecorded, moments.alreadyRecorded);
    await insertHistory("R-LEGACY-05", [
      { status: "Submitted", at: moments.submitted, note: "Report received.", actorRole: "resident" },
      { status: "Resolved", at: moments.resolved, note: "The road has been patched.", actorRole: "official" },
    ]);

    // Answered but not yet resolved: its first response should be recovered
    // from the Under Review entry, while its resolution stays empty.
    await insertReport("R-LEGACY-06", "In Progress");
    await insertHistory("R-LEGACY-06", [
      { status: "Submitted", at: moments.submitted, note: "Report received.", actorRole: "resident" },
      { status: "Under Review", at: moments.underReview, note: "A barangay official is reviewing this report.", actorRole: "official" },
      { status: "In Progress", at: moments.inProgress, note: "The crew is scheduled to patch the road.", actorRole: "official" },
    ]);

    // A version older than the service-target columns stores no cycle start:
    // make the stored values unknown so the upgrade has to recover them from
    // the status history, in the same order the deadlines are backfilled.
    await first.db.query("ALTER TABLE reports ALTER COLUMN service_cycle_started_at DROP NOT NULL");
    await first.db.query("UPDATE reports SET service_cycle_started_at=NULL WHERE id LIKE 'R-LEGACY-%'");
    // Stand the database down to the migration state before the backfill ran,
    // so the restart upgrades it by applying the missing migration.
    await first.db.query("DELETE FROM schema_migrations WHERE version = 2");
  } finally {
    await first.close();
  }

  // Restarting runs the migration again, as an upgraded deployment would.
  const second = await startServer(dataDir);
  try {
    const rows = await second.db.query(
      `SELECT id, responded_at AS "respondedAt", resolved_at AS "resolvedAt", service_cycle_started_at AS "serviceCycleStartedAt",
              response_deadline AS "responseDeadline", resolution_deadline AS "resolutionDeadline"
         FROM reports WHERE id LIKE 'R-LEGACY-%' ORDER BY id`,
    );
    const stored = new Map(rows.rows.map((row) => [row.id, row]));
    const at = (value) => (value instanceof Date ? value.toISOString() : value);

    assert.equal(
      at(stored.get("R-LEGACY-01").resolvedAt),
      moments.resolved.toISOString(),
      "the resolution is recovered from the status history, not the later confirmation",
    );
    assert.equal(
      at(stored.get("R-LEGACY-01").respondedAt),
      moments.underReview.toISOString(),
      "the first response is recovered from the status history",
    );

    assert.equal(at(stored.get("R-LEGACY-02").resolvedAt), moments.resolved.toISOString());
    assert.equal(
      at(stored.get("R-LEGACY-02").respondedAt),
      moments.resolved.toISOString(),
      "a concern resolved in one step was answered when it was resolved",
    );

    assert.equal(
      at(stored.get("R-LEGACY-03").resolvedAt),
      moments.resolvedAgain.toISOString(),
      "the current cycle's resolution is recovered, not the one before the reopen",
    );
    assert.equal(
      at(stored.get("R-LEGACY-03").respondedAt),
      moments.reviewedAgain.toISOString(),
      "the current cycle's first response is recovered, not the one before the reopen",
    );

    assert.equal(stored.get("R-LEGACY-04").resolvedAt, null, "a concern that was never resolved stays empty");
    assert.equal(stored.get("R-LEGACY-04").respondedAt, null, "a concern that was never answered stays empty");

    assert.equal(at(stored.get("R-LEGACY-05").resolvedAt), moments.alreadyRecorded.toISOString(), "a recorded resolution is left as it is");
    assert.equal(
      at(stored.get("R-LEGACY-05").respondedAt),
      moments.alreadyRecorded.toISOString(),
      "a recorded first response is left as it is",
    );

    // An answered-but-unresolved concern recovers its first response and keeps
    // its resolution empty.
    assert.equal(
      at(stored.get("R-LEGACY-06").respondedAt),
      moments.underReview.toISOString(),
      "an answered but unresolved concern recovers its first response",
    );
    assert.equal(stored.get("R-LEGACY-06").resolvedAt, null, "an unresolved concern keeps its resolution empty");

    // Service cycle start: never-reopened reports measure from submission,
    // reopened reports measure from their latest Submitted (reopening) entry.
    assert.equal(
      at(stored.get("R-LEGACY-01").serviceCycleStartedAt),
      moments.submitted.toISOString(),
      "a never-reopened concern starts its cycle at submission",
    );
    assert.equal(
      at(stored.get("R-LEGACY-03").serviceCycleStartedAt),
      moments.reopened.toISOString(),
      "a reopened concern starts its cycle at the latest Submitted entry",
    );
    assert.equal(
      at(stored.get("R-LEGACY-06").serviceCycleStartedAt),
      moments.submitted.toISOString(),
      "an answered-but-unresolved concern starts its cycle at submission",
    );

    // Deadlines are anchored on the recovered service cycle, so a reopened
    // legacy concern measures from its reopening, not its original submission
    // (Medium priority: response after 3 days, resolution after 14).
    assert.equal(
      at(stored.get("R-LEGACY-03").responseDeadline),
      new Date(moments.reopened.getTime() + 3 * 86400000).toISOString(),
      "a reopened legacy concern's response deadline follows the reopening",
    );
    assert.equal(
      at(stored.get("R-LEGACY-03").resolutionDeadline),
      new Date(moments.reopened.getTime() + 14 * 86400000).toISOString(),
      "a reopened legacy concern's resolution deadline follows the reopening",
    );
    assert.equal(
      at(stored.get("R-LEGACY-01").responseDeadline),
      new Date(moments.submitted.getTime() + 3 * 86400000).toISOString(),
      "a never-reopened legacy concern's deadlines still follow the submission",
    );

    // The recovered moments reach the concern detail the resident and staff read.
    const admin = await signIn(second);
    const state = await api(second, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const report = state.data.reports.find((item) => item.id === "R-LEGACY-01");
    assert.equal(report.resolvedAt, moments.resolved.toISOString());
    assert.equal(report.respondedAt, moments.underReview.toISOString());
  } finally {
    await second.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an existing database is upgraded to accept the system actor", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-authz-upgrade-"));
  const first = await startServer(dataDir);
  try {
    // Restore the older restrictive constraint to stand in for a live deployment.
    await first.db.query("ALTER TABLE activities DROP CONSTRAINT activities_role_check");
    await first.db.query(
      "ALTER TABLE activities ADD CONSTRAINT activities_role_check CHECK (role IN ('resident', 'official', 'administrator'))",
    );
    // Stand the database down to the migration state before the widening ran,
    // so the restart applies the missing migration.
    await first.db.query("DELETE FROM schema_migrations WHERE version = 2");
  } finally {
    await first.close();
  }
  const second = await startServer(dataDir);
  try {
    await second.db.query("INSERT INTO activities (id, actor, role, action, detail, at, result) VALUES ($1, $2, $3, $4, $5, now(), $6)", [
      "UPGRADE-SYSTEM",
      "system",
      "system",
      "Probe",
      "probe detail",
      "Success",
    ]);
    const stored = await second.db.query("SELECT role FROM activities WHERE id='UPGRADE-SYSTEM'");
    assert.equal(stored.rows[0].role, "system", "The upgrade should let the audit table store a system actor");
  } finally {
    await second.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("archiving old activity is safe to run twice and after a partial failure", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-archive-retry-"));
  const app = await startServer(dataDir);
  try {
    await app.db.query(`
      INSERT INTO activities (id, actor, role, action, detail, at, result)
      VALUES ('OLD-ACT', 'system', 'system', 'Old event', 'old', now() - interval '100 days', 'Success')
    `);
    // Stand in for a crash after the archive insert but before the delete.
    await app.db.query(`
      INSERT INTO activity_archive (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, archived_at)
      SELECT id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, now()
      FROM activities WHERE id='OLD-ACT'
    `);

    await archiveOldActivities(app.db);
    await archiveOldActivities(app.db);

    const archived = await app.db.query("SELECT count(*)::integer AS count FROM activity_archive WHERE id='OLD-ACT'");
    assert.equal(archived.rows[0].count, 1, "The archived row must not be duplicated");
    const live = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE id='OLD-ACT'");
    assert.equal(live.rows[0].count, 0, "A retry must still remove the live row");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("abandoned photo uploads are removed but report photos are kept", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-orphan-uploads-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const app = await startServer(dataDir, {}, { uploadsDir });
  try {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await mkdir(path.join(uploadsDir, "R-ORPHAN1"), { recursive: true });
    await writeFile(path.join(uploadsDir, "R-ORPHAN1", "old.jpg"), TEST_JPEG);
    await utimes(path.join(uploadsDir, "R-ORPHAN1", "old.jpg"), old, old);

    await app.db.query(
      `
      INSERT INTO reports (id,user_email,name,category,title,area,description,status,submitted_at,updated_at)
      VALUES ('R-KEEP1',$1,'Test resident','Road damage','Test report','Purok 1','A kept report','Submitted',now(),now())
    `,
      [ADMIN_EMAIL],
    );
    await mkdir(path.join(uploadsDir, "R-KEEP1"), { recursive: true });
    await writeFile(path.join(uploadsDir, "R-KEEP1", "keep.jpg"), TEST_JPEG);
    await utimes(path.join(uploadsDir, "R-KEEP1", "keep.jpg"), old, old);

    const removed = await sweepOrphanUploads(app.db, uploadsDir);
    assert.equal(removed, 1);
    assert.equal(await readFile(path.join(uploadsDir, "R-ORPHAN1", "old.jpg")).catch(() => null), null);
    assert.deepEqual(await readFile(path.join(uploadsDir, "R-KEEP1", "keep.jpg")), TEST_JPEG);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
