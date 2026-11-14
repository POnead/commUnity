import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn, registerResident, createOfficial, seedReport } from "./helpers.mjs";

test("a resident cannot forge activity log entries through the account editor", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-forge-resident-"));
  const app = await startServer(dataDir);
  try {
    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Forger Resident",
        email: "forger-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    const resident = await signIn(app, "forger-resident@example.test", "A-unique-resident-password!");
    assert.equal(resident.response.status, 200);

    const state = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    const forged = structuredClone(state.data);
    forged.activities.push({
      id: "A-forged-delete",
      actor: "Forger Resident",
      role: "resident",
      action: "Deleted a report",
      detail: "RPT-999 · I deleted this report.",
      at: new Date().toISOString(),
      result: "Success",
    });
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: resident.cookie,
      body: { revision: state.revision, data: forged },
    });
    // A client-authored actor entry is ignored, never stored: the server owns the log.
    assert.equal(saved.status, 200, await saved.text());

    const stored = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE action=$1", ["Deleted a report"]);
    assert.equal(stored.rows[0].count, 0, "a resident cannot fabricate a deletion event");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("officials cannot forge activity log entries through the account editor", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-forge-official-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Forger Official",
        email: "forger-official@example.test",
        area: "Palsara",
        role: "official",
        status: "Active",
        availableDays: ["Monday"],
        workingHours: "Monday, 8:00 AM-5:00 PM",
        password: "A-unique-official-password!",
      },
    });
    const official = await signIn(app, "forger-official@example.test", "A-unique-official-password!");
    assert.equal(official.response.status, 200);

    const state = await api(app, "/api/state", { cookie: official.cookie }).then((response) => response.json());
    const forged = structuredClone(state.data);
    forged.activities.push({
      id: "A-forged-priority",
      actor: "Forger Official",
      role: "official",
      action: "Changed report priority",
      detail: "RPT-999 · Low to Critical",
      at: new Date().toISOString(),
      result: "Success",
    });
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: official.cookie,
      body: { revision: state.revision, data: forged },
    });
    assert.equal(saved.status, 200, await saved.text());

    const stored = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE action=$1", ["Changed report priority"]);
    assert.equal(stored.rows[0].count, 0, "an official cannot fabricate a priority change through state sync");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("administrators cannot forge activity log entries through the state save", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-forge-admin-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const forged = structuredClone(state.data);
    forged.activities.push({
      id: "ACT-forged-admin-0001",
      actor: state.data.users.find((item) => item.role === "administrator")?.name || "Portal administrator",
      role: "administrator",
      action: "Deleted a report",
      detail: "The administrator deleted a report they never touched.",
      at: new Date().toISOString(),
      result: "Success",
    });
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: forged },
    });
    assert.equal(saved.status, 200, await saved.text());

    const stored = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE action=$1", ["Deleted a report"]);
    assert.equal(stored.rows[0].count, 0, "an administrator cannot fabricate a deletion event");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the server records an administrator's location change in the audit log", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-admin-activity-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const payload = structuredClone(state.data);
    payload.locations.push({ id: "ACT-TEST-LOC-1", area: "Purok 6", barangay: "Palsara", street: "", purok: "Purok 6", landmark: "" });
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: payload },
    });
    assert.equal(saved.status, 200, await saved.text());
    const stored = await app.db.query(
      "SELECT actor, role FROM activities WHERE action='Added a community location' AND detail LIKE 'Purok 6%'",
    );
    assert.equal(stored.rows.length, 1, "the server records the location the administrator actually added");
    assert.equal(stored.rows[0].role, "administrator");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the server records community and account management operations in the audit log", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-admin-activity-suite-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    await createOfficial(app, admin.cookie, "audit-official@example.test", "Audit Official");
    const load = async () => api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const save = async (data, revision) => {
      const response = await api(app, "/api/state", {
        method: "PUT",
        cookie: admin.cookie,
        body: { revision, data },
      });
      const body = await response.json();
      assert.equal(response.status, 200, body?.error || JSON.stringify(body));
      return body;
    };

    let state = await load();
    // Locations: add, update, remove.
    state.data.locations.push({ id: "ACT-SUITE-LOC", area: "Purok 6", barangay: "Palsara", street: "", purok: "Purok 6", landmark: "" });
    state = await save(state.data, state.revision);
    state.data.locations.find((item) => item.id === "ACT-SUITE-LOC").street = "St. Therese Street";
    state = await save(state.data, state.revision);
    state.data.locations = state.data.locations.filter((item) => item.id !== "ACT-SUITE-LOC");
    state = await save(state.data, state.revision);

    // Recycling listings: add, update, remove.
    state.data.recyclingLocations.push({
      id: "ACT-SUITE-RRL",
      name: "Audit Recyclers",
      barangay: "Palsara",
      street: "Side street",
      purok: "",
      landmark: "",
      materials: "Glass, paper",
      phone: "",
      hours: "9 AM-5 PM",
      active: true,
    });
    state = await save(state.data, state.revision);
    state.data.recyclingLocations.find((item) => item.id === "ACT-SUITE-RRL").hours = "10 AM-6 PM";
    state = await save(state.data, state.revision);
    state.data.recyclingLocations = state.data.recyclingLocations.filter((item) => item.id !== "ACT-SUITE-RRL");
    state = await save(state.data, state.revision);

    // Account edit and role permission change.
    state.data.users.find((item) => item.email === "audit-official@example.test").phone = "09170000000";
    state = await save(state.data, state.revision);
    state.data.permissions.official = { ...state.data.permissions.official, manageReports: false };
    await save(state.data, state.revision);

    const actions = await app.db.query(
      "SELECT DISTINCT action FROM activities WHERE action IN ('Added a community location','Updated a community location','Removed a community location','Added a recycling directory listing','Updated a recycling directory listing','Removed a recycling directory listing','Updated user account','Changed role permission')",
    );
    const found = new Set(actions.rows.map((row) => row.action));
    for (const action of [
      "Added a community location",
      "Updated a community location",
      "Removed a community location",
      "Added a recycling directory listing",
      "Updated a recycling directory listing",
      "Removed a recycling directory listing",
      "Updated user account",
      "Changed role permission",
    ]) {
      assert.ok(found.has(action), `the server recorded: ${action}`);
    }
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the server records an official's collection-schedule removal in the audit log", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-official-activity-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie, "activity-official-2@example.test", "Activity Official 2");
    const load = async () => api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const save = async (data, revision) => {
      const response = await api(app, "/api/state", {
        method: "PUT",
        cookie: officialCookie,
        body: { revision, data },
      });
      const body = await response.json();
      assert.equal(response.status, 200, body?.error || JSON.stringify(body));
      return body;
    };
    let state = await load();
    const pickup = new Date(Date.now() + 86400000 * 14).toISOString().slice(0, 10);
    state.data.schedules.push({
      id: "SCHED-ACT-1",
      area: "Purok 1",
      zone: "Zone A",
      date: pickup,
      wasteType: "Recyclables",
      start: "6:00 AM",
      end: "9:00 AM",
      frequency: "Weekly",
      team: "Team A",
      status: "Scheduled",
    });
    state = await save(state.data, state.revision);
    state.data.schedules = state.data.schedules.filter((item) => item.id !== "SCHED-ACT-1");
    await save(state.data, state.revision);

    const added = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE action='Added a collection schedule'");
    assert.equal(
      added.rows[0].count,
      1,
      "the server records the schedule the official added",
    );
    const removed = await app.db.query("SELECT actor FROM activities WHERE action='Removed a collection schedule' AND detail LIKE 'SCHED-ACT-1%'");
    assert.equal(removed.rows.length, 1, "the server records the schedule the official removed");
    assert.equal(removed.rows[0].actor, "Activity Official 2");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("officials cannot record administrator-only activity through the state save", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-official-admin-activity-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie, "official-admin-activity@example.test", "Official Admin Activity");
    const state = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const unauthorized = structuredClone(state.data);
    unauthorized.activities.push({
      id: "ACT-official-admin-0001",
      actor: "Official Admin Activity",
      role: "official",
      action: "Added a community location",
      detail: "Purok 1 · Palsara",
      at: new Date().toISOString(),
      result: "Success",
    });
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: state.revision, data: unauthorized },
    });
    // A client claim that an operation happened is not evidence; the entry is dropped.
    assert.equal(saved.status, 200, await saved.text());

    const stored = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE id=$1", ["ACT-official-admin-0001"]);
    assert.equal(stored.rows[0].count, 0, "an official cannot record an administrator-only activity");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the server stamps activity timestamps, not the browser", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-activity-time-"));
  const app = await startServer(dataDir);
  try {
    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Timestamp Resident",
        email: "timestamp-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    const resident = await signIn(app, "timestamp-resident@example.test", "A-unique-resident-password!");
    assert.equal(resident.response.status, 200);

    const state = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    const now = new Date().toISOString();
    const payload = structuredClone(state.data);
    payload.reports.unshift({
      id: "RPT-act-time-1",
      userEmail: "timestamp-resident@example.test",
      name: "Timestamp Resident",
      category: "Road damage",
      title: "Road damage · Purok 1",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the chapel",
      description: "A pothole in the road near the chapel is deep enough to damage motorcycles.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos: [],
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });
    const created = await api(app, "/api/state", {
      method: "PUT",
      cookie: resident.cookie,
      body: { revision: state.revision, data: payload },
    });
    assert.equal(created.status, 200, await created.text());

    const stored = await app.db.query("SELECT at FROM activities WHERE action='Submitted a concern' AND actor='Timestamp Resident'");
    assert.equal(stored.rows.length, 1, "the concern submission produced a server-generated entry");
    const storedAt = new Date(stored.rows[0].at).getTime();
    assert.ok(storedAt > new Date("2021-01-01").getTime(), "the entry is stamped by the server, not the browser");
    assert.ok(Math.abs(storedAt - Date.now()) < 60000, "the stored time is near now");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a forged Activity Log entry cannot be appended and existing history cannot be altered", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-forged-activity-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie, "activity-official@example.test", "Activity Official");

    // An official cannot record an action the server never observed them take:
    // the claim is ignored, not stored.
    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((r) => r.json());
    const forged = structuredClone(officialState.data);
    forged.activities.push({
      id: "ACT-forged-0001",
      actor: "Activity Official",
      role: "official",
      action: "Deactivated user account",
      detail: "The official removed an account they never touched.",
      at: new Date().toISOString(),
      result: "Success",
    });
    const forgedAttempt = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: forged },
    });
    const forgedBody = await forgedAttempt.json();
    assert.equal(forgedAttempt.status, 200, forgedBody?.error || JSON.stringify(forgedBody));
    const forgedStored = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE id='ACT-forged-0001'");
    assert.equal(forgedStored.rows[0].count, 0, "the unsupported claim was not recorded");

    // Neither can they record a permitted action under someone else's name:
    // the server stamps the authenticated account as the actor.
    const impersonated = structuredClone(forgedBody.data);
    impersonated.activities.push({
      id: "ACT-forged-0002",
      actor: "Portal Administrator",
      role: "official",
      action: "Claimed a concern",
      detail: "Claimed in the administrator's name.",
      at: new Date().toISOString(),
      result: "Success",
    });
    const impersonatedAttempt = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: forgedBody.revision, data: impersonated },
    });
    const impersonatedBody = await impersonatedAttempt.json();
    assert.equal(impersonatedAttempt.status, 200, impersonatedBody?.error || JSON.stringify(impersonatedBody));
    const impersonatedStored = await app.db.query("SELECT count(*)::integer AS count FROM activities WHERE id='ACT-forged-0002'");
    assert.equal(impersonatedStored.rows[0].count, 0, "the impersonated entry was not recorded");

    // The administrator cannot rewrite a row the server already recorded.
    const adminState = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    assert.ok(adminState.data.activities.length > 0, "the workspace has recorded activity");
    const altered = structuredClone(adminState.data);
    altered.activities[0].detail = "Rewritten by the browser.";
    const alteredAttempt = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: adminState.revision, data: altered },
    });
    assert.equal(alteredAttempt.status, 403);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("confirming and reopening a concern are recorded in the Activity Log", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-confirm-log-"));
  const app = await startServer(dataDir);
  try {
    const { cookie, email, name } = await registerResident(app, "log-resident@example.test", "Log Resident");
    const reportId = await seedReport(app, { cookie, email, name }, { idSuffix: "log", priority: "Medium" });

    const now = new Date().toISOString();
    await app.db.query("UPDATE reports SET status='Resolved', updated_at=$1 WHERE id=$2", [now, reportId]);
    await app.db.query(
      "INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES ($1,$2,$3,$4,$5,$6,'administrator')",
      [reportId, 1, "Resolved", now, "Concern resolved.", "Portal administrator"],
    );

    const confirm = await api(app, "/api/community/report-confirm", { method: "POST", cookie, body: { reportId, note: "It is fixed." } });
    assert.equal(confirm.status, 200, await confirm.text());
    const reopen = await api(app, "/api/community/report-reopen", {
      method: "POST",
      cookie,
      body: { reportId, reason: "The pothole returned after one week." },
    });
    assert.equal(reopen.status, 200, await reopen.text());

    const admin = await signIn(app);
    const log = await api(app, "/api/community/activity", { cookie: admin.cookie }).then((r) => r.json());
    assert.ok(
      log.activities.some((item) => item.action === "Confirmed concern as addressed" && item.detail.includes(reportId)),
      "the confirmation reaches the Activity Log with the concern reference",
    );
    assert.ok(
      log.activities.some(
        (item) => item.action === "Requested concern reopening" && item.detail.includes("The pothole returned after one week."),
      ),
      "the reopening reaches the Activity Log with the resident's reason",
    );
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the activity log pages through every retained record including archived ones", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-activity-log-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    for (let index = 0; index < 30; index += 1) {
      await app.db.query(
        "INSERT INTO activities (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          `LOG-${index}`,
          index % 2 ? "system" : "Portal administrator",
          index % 2 ? "system" : "administrator",
          index % 3 === 0 ? "Authorization denied" : "Updated account profile",
          `detail ${index}`,
          new Date(Date.now() - index * 60000).toISOString(),
          index % 5 === 0 ? "Failed" : "Success",
          index % 5 === 0 ? "refused" : "",
          `R-${index}`,
          "203.0.113.9",
        ],
      );
    }
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
    for (let index = 0; index < 5; index += 1) {
      await app.db.query(
        "INSERT INTO activity_archive (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, archived_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())",
        [
          `OLD-${index}`,
          "Portal administrator",
          "administrator",
          "Archived action",
          `archived detail ${index}`,
          oldDate,
          "Success",
          "",
          `R-old-${index}`,
          "198.51.100.4",
        ],
      );
    }

    const first = await api(app, "/api/community/activity?pageSize=10", { cookie: admin.cookie });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    // 30 seeded current records, 5 archived records, and the sign-in that opened this session.
    assert.equal(firstBody.total, 36, "Every current and archived record should be counted");
    assert.equal(firstBody.pageCount, 4);
    assert.equal(firstBody.activities.length, 10);
    assert.equal(firstBody.summary.current, 31);
    assert.equal(firstBody.summary.archived, 5);
    assert.equal(firstBody.summary.failed, 6);

    const second = await api(app, "/api/community/activity?pageSize=10&page=2", { cookie: admin.cookie });
    const secondBody = await second.json();
    assert.equal(secondBody.activities.length, 10);
    const firstIds = firstBody.activities.map((item) => item.id);
    assert.ok(!secondBody.activities.some((item) => firstIds.includes(item.id)), "Pages should not repeat records");

    const archived = await api(app, "/api/community/activity?source=archived", { cookie: admin.cookie });
    const archivedBody = await archived.json();
    assert.equal(archivedBody.total, 5);
    assert.ok(archivedBody.activities.every((item) => item.source === "archived"));
    assert.ok(archivedBody.activities.every((item) => item.archivedAt));

    const failed = await api(app, "/api/community/activity?result=Failed", { cookie: admin.cookie });
    assert.ok((await failed.json()).activities.every((item) => item.result === "Failed"));
    const actor = await api(app, "/api/community/activity?actor=system", { cookie: admin.cookie });
    assert.ok((await actor.json()).activities.every((item) => item.actor === "system"));
    const affected = await api(app, "/api/community/activity?affectedId=R-old-1", { cookie: admin.cookie });
    assert.equal((await affected.json()).total, 1);
    const action = await api(app, "/api/community/activity?action=authorization", { cookie: admin.cookie });
    assert.ok((await action.json()).activities.every((item) => item.action === "Authorization denied"));

    const everything = await api(app, "/api/community/activity?from=2000-01-01&to=2999-12-31", { cookie: admin.cookie });
    assert.equal((await everything.json()).total, 36);
    const nothing = await api(app, "/api/community/activity?from=1990-01-01&to=1990-01-02", { cookie: admin.cookie });
    assert.equal((await nothing.json()).total, 0);

    const badDate = await api(app, "/api/community/activity?from=notadate", { cookie: admin.cookie });
    assert.equal(badDate.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the activity log export includes archived records and security metadata", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-activity-export-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    await app.db.query(
      "INSERT INTO activities (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip) VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9)",
      ["EXPORT-CURRENT", "system", "system", "Authorization denied", "current detail", "Failed", "denied", "R-42", "203.0.113.9"],
    );
    await app.db.query(
      "INSERT INTO activity_archive (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, archived_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())",
      [
        "EXPORT-ARCHIVED",
        "Portal administrator",
        "administrator",
        "Archived action",
        "archived detail",
        new Date(Date.now() - 100 * 86400000).toISOString(),
        "Failed",
        "refused earlier",
        "R-99",
        "198.51.100.4",
      ],
    );

    const exported = await api(app, "/api/community/activity/export", { cookie: admin.cookie });
    assert.equal(exported.status, 200);
    const body = await exported.json();
    // Two seeded records plus the sign-in that opened this session.
    assert.equal(body.total, 3);
    assert.equal(body.truncated, false);

    const current = body.activities.find((item) => item.source === "current");
    assert.ok(current, "The export should include current records");
    assert.equal(current.actor, "system");
    assert.equal(current.resultReason, "denied");
    assert.equal(current.affectedId, "R-42");
    assert.equal(current.clientIp, "203.0.113.9");

    const archived = body.activities.find((item) => item.source === "archived");
    assert.ok(archived, "The export should include archived records");
    assert.equal(archived.resultReason, "refused earlier");
    assert.equal(archived.affectedId, "R-99");
    assert.equal(archived.clientIp, "198.51.100.4");
    assert.ok(archived.archivedAt, "Archived records should carry the archived timestamp");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the activity log is only available to administrators", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-activity-role-"));
  const app = await startServer(dataDir);
  try {
    const residentCookie = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Activity Resident",
        email: "activity-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    }).then((r) => r.headers.get("set-cookie")?.split(";")[0] || "");

    const browse = await api(app, "/api/community/activity", { cookie: residentCookie });
    assert.equal(browse.status, 403);
    const exported = await api(app, "/api/community/activity/export", { cookie: residentCookie });
    assert.equal(exported.status, 403);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
