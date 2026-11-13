import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  startServer,
  api,
  uploadPhoto,
  signIn,
  TEST_JPEG,
  registerResident,
  createOfficial,
  seedReport,
  postFollowUp,
} from "./helpers.mjs";

test("submits a concern when an existing timestamp-based report ID exceeds integer range", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-report-timestamp-id-"));
  const app = await startServer(dataDir);
  try {
    const resident = await registerResident(app, "timestamp-report@example.test", "Timestamp Resident");
    const now = new Date().toISOString();
    const legacyReportId = "R1794145468286";
    await app.db.query(
      `
      INSERT INTO reports
        (id,user_email,name,category,title,area,barangay,location_detail,description,urgent,priority,status,submitted_at,updated_at)
      VALUES ($1,$2,$3,'Streetlight','Damaged streetlight','Purok 1','Palsara','Near the school',
        'The streetlight is not working near the school.',false,'Medium','Submitted',$4,$4)
    `,
      [legacyReportId, resident.email, resident.name, now],
    );
    await app.db.query("INSERT INTO report_history (report_id,position,status,at,note) VALUES ($1,0,'Submitted',$2,'Report received.')", [
      legacyReportId,
      now,
    ]);

    const state = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    const reportId = "R1794305160000-new-report";
    state.data.reports.unshift({
      id: reportId,
      userEmail: resident.email,
      name: resident.name,
      category: "Streetlight",
      title: "Damaged streetlight · Purok 1",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the community hall",
      latitude: 14.012869,
      longitude: 121.097122,
      description: "The streetlight is not working near the community hall.",
      urgent: false,
      priority: "Medium",
      assignedTo: null,
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
    const responseBody = await submitted.text();
    assert.equal(submitted.status, 200, responseBody);
    const result = JSON.parse(responseBody);
    assert.equal(result.data.reports.length, 2);
    assert.ok(result.data.reports.some((report) => report.id === reportId));
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("legacy report photo metadata does not block unrelated account updates", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-legacy-photo-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Photo Resident",
        email: "photo-resident@example.test",
        area: "Purok 1",
        phone: "",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);

    await app.db.query(`
      INSERT INTO reports (id,user_email,name,category,title,area,description,status,submitted_at,updated_at)
      VALUES ('R-legacy-photo','photo-resident@example.test','Photo Resident','Other','Legacy photo report',
        'Purok 1','A report that has legacy photo metadata.','Submitted',now(),now())
    `);
    await app.db.query(`
      INSERT INTO report_history (report_id,position,status,at,note,actor_name,actor_role)
      VALUES ('R-legacy-photo',0,'Submitted',now(),'Report received.','Photo Resident','resident')
    `);
    await app.db.query(`
      INSERT INTO report_photos (report_id,position,name,photo_url)
      VALUES ('R-legacy-photo',0,'legacy.png','')
    `);

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const report = state.data.reports.find((item) => item.id === "R-legacy-photo");
    assert.deepEqual(report.photos, []);
    state.data.users.find((account) => account.email === "photo-resident@example.test").name = "Updated Resident";
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(saved.status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("enforces official report and schedule permissions and sends resident notifications", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-official-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCreated = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Official One",
        email: "official@example.test",
        area: "Palsara",
        phone: "",
        role: "official",
        status: "Active",
        availableDays: ["Tuesday", "Thursday", "Sunday"],
        password: "A-unique-official-password!",
      },
    });
    assert.equal(officialCreated.status, 201);

    const officialStateResponse = await api(app, "/api/state", { cookie: admin.cookie });
    const initialOfficialState = await officialStateResponse.json();
    const officialAccount = initialOfficialState.data.users.find((account) => account.email === "official@example.test");
    assert.deepEqual(officialAccount.availableDays, ["Tuesday", "Thursday", "Sunday"]);

    const workingHoursResponse = await api(app, "/api/community/working-hours", { cookie: admin.cookie });
    const workingHoursData = await workingHoursResponse.json();
    assert.deepEqual(workingHoursData.officials.find((account) => account.id === officialAccount.id).availableDays, [
      "Tuesday",
      "Thursday",
      "Sunday",
    ]);

    officialAccount.availableDays = ["Monday", "Saturday"];
    officialAccount.workingHours = "Monday, Saturday, 8:00 AM-5:00 PM";
    const savedOfficialState = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: initialOfficialState.revision, data: initialOfficialState.data },
    });
    assert.equal(savedOfficialState.status, 200);
    const persistedOfficialState = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const persistedOfficial = persistedOfficialState.data.users.find((account) => account.email === "official@example.test");
    assert.deepEqual(persistedOfficial.availableDays, ["Monday", "Saturday"]);
    assert.equal(persistedOfficial.workingHours, "Monday, Saturday, 8:00 AM-5:00 PM");

    const residentRegistration = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Resident Hours Viewer",
        email: "resident-hours@example.test",
        area: "Purok 1",
        phone: "",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(residentRegistration.status, 201);
    const resident = await signIn(app, "resident-hours@example.test", "A-unique-resident-password!");
    const residentHoursResponse = await api(app, "/api/community/working-hours", { cookie: resident.cookie });
    assert.equal(residentHoursResponse.status, 200);
    const residentHours = await residentHoursResponse.json();
    assert.deepEqual(
      residentHours.officials.find((account) => account.id === persistedOfficial.id),
      {
        id: persistedOfficial.id,
        name: "Official One",
        workingHours: "Monday, Saturday, 8:00 AM-5:00 PM",
        availableDays: ["Monday", "Saturday"],
      },
    );

    const latestBeforeInvalid = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const invalidOfficialState = structuredClone(latestBeforeInvalid.data);
    invalidOfficialState.users.find((account) => account.email === "official@example.test").availableDays = [];
    const rejectedOfficialState = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: latestBeforeInvalid.revision, data: invalidOfficialState },
    });
    assert.equal(rejectedOfficialState.status, 400);

    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Resident Two",
        email: "resident2@example.test",
        area: "Purok 4",
        phone: "",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];
    let residentState = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    const now = new Date().toISOString();
    residentState.data.reports.push({
      id: "RPT-2026-official-01",
      userEmail: "resident2@example.test",
      name: "Resident Two",
      category: "Road damage",
      title: "Road damage · Purok 4",
      area: "Purok 4",
      barangay: "Palsara",
      locationDetail: "Near the community hall",
      description: "There is a damaged patch of road near the community hall.",
      urgent: false,
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos: [],
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });
    residentState.data.activities.push({
      id: "A-resident-submit",
      actor: "Resident Two",
      role: "resident",
      action: "Submitted a concern",
      detail: "RPT-2026-official-01",
      at: now,
      result: "Success",
    });
    const submitted = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: residentState.revision, data: residentState.data },
    });
    assert.equal(submitted.status, 200);

    const signedIn = await signIn(app, "official@example.test", "A-unique-official-password!");
    assert.equal(signedIn.response.status, 200);
    const officialCookie = signedIn.cookie;
    let officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    assert.equal(officialState.data.users.length, 0);
    assert.equal(officialState.data.reports.length, 1);
    assert.equal(officialState.data.reports[0].latitude, null);
    assert.equal(officialState.data.reports[0].longitude, null);
    assert.equal(
      officialState.data.notifications.some((item) => item.targetEmail === "official@example.test"),
      true,
    );

    const officialSession = await api(app, "/api/session", { cookie: officialCookie }).then((response) => response.json());
    const forgedClaim = structuredClone(officialState.data);
    forgedClaim.reports[0].assignedTo = { id: "another-official", name: "Another Official" };
    const rejectedClaim = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: forgedClaim },
    });
    assert.equal(rejectedClaim.status, 403);

    const claim = structuredClone(officialState.data);
    claim.reports[0].assignedTo = { id: officialSession.user.id, name: "Forged Name" };
    const claimed = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: claim },
    });
    assert.equal(claimed.status, 200);
    officialState = await claimed.json();
    assert.deepEqual(officialState.data.reports[0].assignedTo, {
      id: officialSession.user.id,
      name: officialSession.user.name,
    });

    const release = structuredClone(officialState.data);
    release.reports[0].assignedTo = null;
    const released = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: release },
    });
    assert.equal(released.status, 200);
    officialState = await released.json();

    const reclaim = structuredClone(officialState.data);
    reclaim.reports[0].assignedTo = { id: officialSession.user.id, name: officialSession.user.name };
    const reclaimed = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: reclaim },
    });
    assert.equal(reclaimed.status, 200);
    officialState = await reclaimed.json();

    const report = officialState.data.reports[0];
    report.status = "Under Review";
    report.updatedAt = new Date().toISOString();
    report.history.push({
      status: "Under Review",
      at: report.updatedAt,
      note: "A barangay official is reviewing this report.",
      actorName: "Forged Name",
      actorRole: "resident",
    });
    officialState.data.activities.push({
      id: "A-official-review",
      actor: "Official One",
      role: "official",
      action: "Updated a report",
      detail: `${report.id} · Under Review`,
      at: report.updatedAt,
      result: "Success",
    });
    const reviewed = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(reviewed.status, 200);

    officialState = await reviewed.json();
    const recordedUpdate = officialState.data.reports[0].history.at(-1);
    assert.equal(recordedUpdate.status, "Under Review");
    assert.equal(recordedUpdate.note, "A barangay official is reviewing this report.");
    assert.equal(recordedUpdate.actorName, officialSession.user.name);
    assert.equal(recordedUpdate.actorRole, "official");
    // The server stamps the update itself, so the browser's clock is never the record.
    assert.ok(Math.abs(new Date(recordedUpdate.at).getTime() - Date.now()) < 60000, "the status entry is stamped by the server");
    officialState.data.schedules.push({
      id: "GCS-2026-900",
      area: "Purok 4",
      zone: "Zone D",
      date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
      wasteType: "Recyclables",
      start: "6:00 AM",
      end: "9:00 AM",
      frequency: "Weekly",
      team: "Team A",
      status: "Scheduled",
    });
    officialState.data.activities.push({
      id: "A-official-schedule",
      actor: "Official One",
      role: "official",
      action: "Added a collection schedule",
      detail: "GCS-2026-900 · Purok 4",
      at: new Date().toISOString(),
      result: "Success",
    });
    const scheduled = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(scheduled.status, 200);

    const residentAfter = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    assert.equal(residentAfter.data.reports[0].status, "Under Review");
    assert.equal(residentAfter.data.notifications.length, 3);
    assert.equal(
      residentAfter.data.notifications.some((item) => item.title === "Report submitted"),
      true,
    );
    assert.equal(residentAfter.data.schedules[0].id, "GCS-2026-900");
    const rows = await app.db.query(`
      SELECT
        (SELECT count(*) FROM report_history)::integer AS report_history,
        (SELECT count(*) FROM schedules)::integer AS schedules,
        (SELECT count(*) FROM report_photos)::integer AS photos
    `);
    assert.equal(rows.rows[0].report_history, 2);
    assert.equal(rows.rows[0].schedules, 1);
    assert.equal(rows.rows[0].photos, 0);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("enforces concern status transition sequence, resolution notes, deadlines and resident reopen/confirm", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-status-transition-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const adminCookie = admin.cookie;
    const officialCreated = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Official One",
        email: "official@example.test",
        area: "Palsara",
        phone: "",
        role: "official",
        status: "Active",
        availableDays: ["Tuesday", "Thursday"],
        password: "A-unique-official-password!",
      },
    });
    assert.equal(officialCreated.status, 201);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Transition Resident",
        email: "transition-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];

    const now = new Date().toISOString();
    let state = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    state.data.reports.push({
      id: "RPT-2026-transition-01",
      userEmail: "transition-resident@example.test",
      name: "Transition Resident",
      category: "Road damage",
      title: "Road damage · Purok 1",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the barangay hall",
      description: "A large pothole near the barangay hall needs patching.",
      urgent: false,
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos: [],
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });
    state.data.activities.push({
      id: "A-transition-submit",
      actor: "Transition Resident",
      role: "resident",
      action: "Submitted a concern",
      detail: "RPT-2026-transition-01 · Road damage · Purok 1",
      at: now,
      result: "Success",
    });
    const submitted = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(submitted.status, 200);

    const signedIn = await signIn(app, "official@example.test", "A-unique-official-password!");
    assert.equal(signedIn.response.status, 200);
    const officialCookie = signedIn.cookie;
    state = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const report = state.data.reports.find((item) => item.id === "RPT-2026-transition-01");
    assert.equal(report.status, "Submitted");
    assert.ok(report.responseDeadline, "a response deadline is computed from the priority");

    const put = (mutate) => {
      const next = structuredClone(state.data);
      mutate(next.reports.find((item) => item.id === "RPT-2026-transition-01"));
      return api(app, "/api/state", { method: "PUT", cookie: officialCookie, body: { revision: state.revision, data: next } });
    };

    // A newly submitted concern cannot jump directly to Resolved.
    let response = await put((item) => {
      item.status = "Resolved";
      item.updatedAt = new Date().toISOString();
      item.history.push({ status: "Resolved", at: item.updatedAt, note: "Fixed." });
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /Follow the review path/);

    // Submitted → Under Review is the first valid step.
    response = await put((item) => {
      item.status = "Under Review";
      item.updatedAt = new Date().toISOString();
      item.history.push({ status: "Under Review", at: item.updatedAt, note: "A barangay official is reviewing this report." });
    });
    assert.equal(response.status, 200);
    state = await response.json();
    const underReview = state.data.reports.find((item) => item.id === "RPT-2026-transition-01");
    assert.equal(underReview.status, "Under Review");
    assert.equal(underReview.respondedAt, underReview.updatedAt);
    assert.equal(underReview.history.at(-1).actorRole, "official");

    // A status change without a note is rejected.
    response = await put((item) => {
      item.status = "In Progress";
      item.updatedAt = new Date().toISOString();
      item.history.push({ status: "In Progress", at: item.updatedAt, note: "   " });
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /update note/);

    // Under Review → Resolved skips In Progress and is rejected.
    response = await put((item) => {
      item.status = "Resolved";
      item.updatedAt = new Date().toISOString();
      item.history.push({ status: "Resolved", at: item.updatedAt, note: "All done." });
    });
    assert.equal(response.status, 403);

    // Under Review → In Progress is valid.
    response = await put((item) => {
      item.status = "In Progress";
      item.updatedAt = new Date().toISOString();
      item.history.push({ status: "In Progress", at: item.updatedAt, note: "Crew dispatched to patch the pothole." });
    });
    assert.equal(response.status, 200);
    state = await response.json();

    // In Progress → Resolved with an empty note is rejected.
    response = await put((item) => {
      item.status = "Resolved";
      item.updatedAt = new Date().toISOString();
      item.history.push({ status: "Resolved", at: item.updatedAt, note: "   " });
    });
    assert.equal(response.status, 400);

    // In Progress → Resolved with a resolution explanation is valid.
    response = await put((item) => {
      item.status = "Resolved";
      item.updatedAt = new Date().toISOString();
      item.history.push({ status: "Resolved", at: item.updatedAt, note: "Pothole patched and road surface restored." });
    });
    assert.equal(response.status, 200);
    state = await response.json();
    const resolved = state.data.reports.find((item) => item.id === "RPT-2026-transition-01");
    assert.equal(resolved.status, "Resolved");
    assert.equal(resolved.history.at(-1).note, "Pothole patched and road surface restored.");
    assert.equal(resolved.history.at(-1).actorRole, "official");

    // The resident can confirm a resolved concern as addressed.
    response = await api(app, "/api/community/report-confirm", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-2026-transition-01", note: "Looks good to me." },
    });
    assert.equal(response.status, 200);
    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    assert.ok(officialState.data.notifications.some((item) => /confirmed this concern was addressed/.test(item.body)));

    // The resident can request reopening with a reason.
    response = await api(app, "/api/community/report-reopen", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-2026-transition-01", reason: "The pothole reopened after the rain." },
    });
    assert.equal(response.status, 200);
    state = await api(app, "/api/state", { cookie: adminCookie }).then((response) => response.json());
    const reopened = state.data.reports.find((item) => item.id === "RPT-2026-transition-01");
    assert.equal(reopened.status, "Submitted");
    assert.equal(reopened.history.at(-1).status, "Submitted");
    assert.match(reopened.history.at(-1).note, /requested reopening/);

    // Reopening without a reason is rejected.
    response = await api(app, "/api/community/report-reopen", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-2026-transition-01", reason: "" },
    });
    assert.equal(response.status, 400);

    // Confirming a non-resolved concern is rejected.
    response = await api(app, "/api/community/report-confirm", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-2026-transition-01", note: "" },
    });
    assert.equal(response.status, 409);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("flags concerns past their response deadline as overdue", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-overdue-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const adminCookie = admin.cookie;
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Overdue Resident",
        email: "overdue-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const responseDeadline = new Date(Date.now() - 7 * 86400000).toISOString();
    const resolutionDeadline = new Date(Date.now() + 4 * 86400000).toISOString();
    // Insert directly so the recorded submission moment is backdated: the server
    // normally stamps submittedAt on receipt, but this test needs a concern that
    // was filed long ago to verify overdue detection.
    const registeredJson = await registered.json();
    await app.db.query(
      `
      INSERT INTO reports (id,user_email,name,category,title,area,barangay,location_detail,description,urgent,priority,status,submitted_at,updated_at,response_deadline,resolution_deadline,service_cycle_started_at)
      VALUES ($1,$2,'Overdue Resident','Drainage problem','Blocked drain · Purok 1','Purok 1','Palsara','Near the market','The drain near the market is blocked and flooding the street.',false,'Medium','Submitted',$3,$3,$4,$5,$3)
    `,
      ["RPT-2026-overdue-01", registeredJson.user.email, old, responseDeadline, resolutionDeadline],
    );
    await app.db.query(
      `
      INSERT INTO report_history (report_id,position,status,at,note,actor_name,actor_role)
      VALUES ($1,0,'Submitted',$2,'Report received.','Overdue Resident','resident')
    `,
      ["RPT-2026-overdue-01", old],
    );
    await app.db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    let state = await api(app, "/api/state", { cookie: adminCookie }).then((response) => response.json());
    const report = state.data.reports.find((item) => item.id === "RPT-2026-overdue-01");
    assert.ok(report.responseDeadline);
    assert.ok(report.overdue, "a concern past its Medium-priority deadline is overdue");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function advanceReport(app, cookie, state, reportId, status, note) {
  const next = structuredClone(state.data);
  const report = next.reports.find((item) => item.id === reportId);
  report.status = status;
  report.updatedAt = new Date().toISOString();
  report.history.push({ status, at: report.updatedAt, note });
  const response = await api(app, "/api/state", {
    method: "PUT",
    cookie,
    body: { revision: state.revision, data: next },
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("judges the first response and the resolution target separately", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-two-targets-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Target Resident",
        email: "target-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];

    // Submitted 20 days ago, so the 3-day response target and the 14-day resolution
    // target have both passed. The server normally stamps submittedAt on receipt,
    // so this test inserts directly to backdate the record.
    const old = new Date(Date.now() - 20 * 86400000).toISOString();
    const responseDeadline = new Date(Date.now() - 17 * 86400000).toISOString();
    const resolutionDeadline = new Date(Date.now() - 6 * 86400000).toISOString();
    const registeredJson = await registered.json();
    await app.db.query(
      `
      INSERT INTO reports (id,user_email,name,category,title,area,barangay,location_detail,description,urgent,priority,status,submitted_at,updated_at,response_deadline,resolution_deadline,service_cycle_started_at)
      VALUES ($1,$2,'Target Resident','Road damage','Road damage · Purok 1','Purok 1','Palsara','Near the hall','A large pothole near the barangay hall needs patching.',false,'Medium','Submitted',$3,$3,$4,$5,$3)
    `,
      ["RPT-2026-target-01", registeredJson.user.email, old, responseDeadline, resolutionDeadline],
    );
    await app.db.query(
      `
      INSERT INTO report_history (report_id,position,status,at,note,actor_name,actor_role)
      VALUES ($1,0,'Submitted',$2,'Report received.','Target Resident','resident')
    `,
      ["RPT-2026-target-01", old],
    );
    await app.db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    let state = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    let report = state.data.reports.find((item) => item.id === "RPT-2026-target-01");
    assert.ok(report.responseDeadline, "a first-response deadline is computed");
    assert.ok(report.resolutionDeadline, "a resolution deadline is computed");
    assert.equal(report.responseOverdue, true, "no staff response has arrived yet");
    assert.equal(report.resolutionOverdue, true, "the concern is still unresolved");
    assert.equal(report.overdue, true);

    // Once an official answers, the concern is no longer awaiting a first response.
    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    state = await advanceReport(
      app,
      officialCookie,
      officialState,
      "RPT-2026-target-01",
      "Under Review",
      "A barangay official is reviewing this report.",
    );
    report = state.data.reports.find((item) => item.id === "RPT-2026-target-01");
    assert.ok(report.respondedAt, "the first response is recorded");
    assert.equal(report.responseOverdue, false, "an answered concern is not awaiting a first response");
    assert.equal(report.resolutionOverdue, true, "the concern is still past its resolution target");
    assert.equal(report.overdue, true);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("changing the priority before the first response recomputes the deadline", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-priority-deadline-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Priority Resident",
        email: "priority-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];

    // Submitted two days ago as a Medium concern: the response target is three days.
    // The server stamps submittedAt on receipt, so this test inserts directly to
    // backdate the record and verify that deadline recomputation uses the stored
    // submission moment, not the browser's clock.
    const backdated = new Date(Date.now() - 2 * 86400000).toISOString();
    const originalResponseDeadline = new Date(Date.now() + 1 * 86400000).toISOString();
    const originalResolutionDeadline = new Date(Date.now() + 5 * 86400000).toISOString();
    const registeredJson = await registered.json();
    await app.db.query(
      `
      INSERT INTO reports (id,user_email,name,category,title,area,barangay,location_detail,description,urgent,priority,status,submitted_at,updated_at,response_deadline,resolution_deadline,service_cycle_started_at)
      VALUES ($1,$2,'Priority Resident','Road damage','Road damage · Purok 1','Purok 1','Palsara','Near the hall','A large pothole near the barangay hall needs patching.',false,'Medium','Submitted',$3,$3,$4,$5,$3)
    `,
      ["RPT-2026-priority-01", registeredJson.user.email, backdated, originalResponseDeadline, originalResolutionDeadline],
    );
    await app.db.query(
      `
      INSERT INTO report_history (report_id,position,status,at,note,actor_name,actor_role)
      VALUES ($1,0,'Submitted',$2,'Report received.','Priority Resident','resident')
    `,
      ["RPT-2026-priority-01", backdated],
    );
    await app.db.query("UPDATE app_meta SET revision=revision+1 WHERE id=1");
    let state = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    let report = state.data.reports.find((item) => item.id === "RPT-2026-priority-01");
    // The stored submission moment, not the browser's, is the deadline anchor.
    assert.ok(
      Math.abs(new Date(report.submittedAt).getTime() - new Date(backdated).getTime()) < 60000,
      "the stored submission moment is used",
    );
    assert.equal(report.responseOverdue, false);

    // Raising the priority to High tightens the target to one day, which has passed.
    const raised = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: "RPT-2026-priority-01", priority: "High" },
    });
    assert.equal(raised.status, 200);
    state = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    report = state.data.reports.find((item) => item.id === "RPT-2026-priority-01");
    assert.notEqual(report.responseDeadline, originalResponseDeadline, "the response deadline follows the new priority");
    assert.equal(report.responseDeadline, new Date(new Date(backdated).getTime() + 86400000).toISOString());
    assert.equal(report.resolutionDeadline, new Date(new Date(backdated).getTime() + 7 * 86400000).toISOString());
    assert.equal(report.responseOverdue, true, "the tightened target has already passed");

    // After the first response the recorded target can no longer move.
    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    state = await advanceReport(
      app,
      officialCookie,
      officialState,
      "RPT-2026-priority-01",
      "Under Review",
      "A barangay official is reviewing this report.",
    );
    const answeredDeadline = state.data.reports.find((item) => item.id === "RPT-2026-priority-01").responseDeadline;

    const lowered = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: "RPT-2026-priority-01", priority: "Low" },
    });
    assert.equal(lowered.status, 200);
    state = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    report = state.data.reports.find((item) => item.id === "RPT-2026-priority-01");
    assert.equal(report.responseDeadline, answeredDeadline, "a recorded first response keeps its original target");
    assert.equal(report.responseOverdue, false, "an answered concern is not awaiting a first response");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("reopening a concern resets the first response and restarts both service targets", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-reopen-targets-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Reopen Resident",
        email: "reopen-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];

    const submittedAt = new Date().toISOString();
    let state = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    state.data.reports.push({
      id: "RPT-2026-reopen-01",
      userEmail: "reopen-resident@example.test",
      name: "Reopen Resident",
      category: "Road damage",
      title: "Road damage · Purok 1",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the hall",
      description: "A large pothole near the barangay hall needs patching.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt,
      updatedAt: submittedAt,
      photos: [],
      history: [{ status: "Submitted", at: submittedAt, note: "Report received." }],
    });
    const submitted = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(submitted.status, 200);

    let officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    officialState = await advanceReport(
      app,
      officialCookie,
      officialState,
      "RPT-2026-reopen-01",
      "Under Review",
      "A barangay official is reviewing this report.",
    );
    officialState = await advanceReport(
      app,
      officialCookie,
      officialState,
      "RPT-2026-reopen-01",
      "In Progress",
      "The crew is scheduled to patch the road.",
    );
    officialState = await advanceReport(app, officialCookie, officialState, "RPT-2026-reopen-01", "Resolved", "The road has been patched.");
    const resolved = officialState.data.reports.find((item) => item.id === "RPT-2026-reopen-01");
    assert.ok(resolved.respondedAt, "the concern was answered");
    assert.ok(resolved.resolvedAt, "the resolution is recorded");

    const reopened = await api(app, "/api/community/report-reopen", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-2026-reopen-01", reason: "The patch did not hold after the rain." },
    });
    assert.equal(reopened.status, 200);

    const after = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const report = after.data.reports.find((item) => item.id === "RPT-2026-reopen-01");
    assert.equal(report.status, "Submitted");
    assert.equal(report.respondedAt, null, "the earlier first response no longer counts");
    assert.equal(report.resolvedAt, null, "the earlier resolution no longer counts");
    assert.equal(report.responseOverdue, false, "the reopened concern is waiting on a new first response");
    assert.equal(report.resolutionOverdue, false);
    const expectedResponse = Date.now() + 3 * 86400000;
    assert.ok(
      Math.abs(new Date(report.responseDeadline).getTime() - expectedResponse) < 60000,
      "the response target restarts from the reopen",
    );
    const expectedResolution = Date.now() + 14 * 86400000;
    assert.ok(
      Math.abs(new Date(report.resolutionDeadline).getTime() - expectedResolution) < 60000,
      "the resolution target restarts from the reopen",
    );
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("changing the priority after a reopen keeps both targets on the reopened service cycle", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-reopen-priority-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Reopen Priority Resident",
        email: "reopen-priority-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];

    // Submitted forty days ago, so both Medium targets measured from the original
    // submission date are already in the past.
    const submittedAt = new Date(Date.now() - 40 * 86400000).toISOString();
    let state = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    state.data.reports.push({
      id: "RPT-2026-reopen-priority-01",
      userEmail: "reopen-priority-resident@example.test",
      name: "Reopen Priority Resident",
      category: "Road damage",
      title: "Road damage · Purok 1",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the hall",
      description: "A large pothole near the barangay hall needs patching.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt,
      updatedAt: submittedAt,
      photos: [],
      history: [{ status: "Submitted", at: submittedAt, note: "Report received." }],
    });
    const submitted = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(submitted.status, 200);

    let officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    officialState = await advanceReport(
      app,
      officialCookie,
      officialState,
      "RPT-2026-reopen-priority-01",
      "Under Review",
      "A barangay official is reviewing this report.",
    );
    officialState = await advanceReport(
      app,
      officialCookie,
      officialState,
      "RPT-2026-reopen-priority-01",
      "In Progress",
      "The crew is scheduled to patch the road.",
    );
    officialState = await advanceReport(
      app,
      officialCookie,
      officialState,
      "RPT-2026-reopen-priority-01",
      "Resolved",
      "The road has been patched.",
    );
    const resolved = officialState.data.reports.find((item) => item.id === "RPT-2026-reopen-priority-01");
    assert.ok(resolved.resolvedAt, "the concern was resolved before the reopen");

    const reopenedAt = Date.now();
    const reopened = await api(app, "/api/community/report-reopen", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: "RPT-2026-reopen-priority-01", reason: "The patch did not hold after the rain." },
    });
    assert.equal(reopened.status, 200);

    let report = (await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json())).data.reports.find(
      (item) => item.id === "RPT-2026-reopen-priority-01",
    );
    assert.equal(report.status, "Submitted");
    assert.equal(report.responseOverdue, false, "the reopen cleared the overdue flags");

    // Changing the priority after the reopen must still measure both targets from
    // the reopen, not from the original submission.
    const changed = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: "RPT-2026-reopen-priority-01", priority: "High" },
    });
    assert.equal(changed.status, 200);

    report = (await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json())).data.reports.find(
      (item) => item.id === "RPT-2026-reopen-priority-01",
    );
    assert.equal(report.priority, "High");
    const expectedResponse = reopenedAt + 1 * 86400000;
    assert.ok(
      Math.abs(new Date(report.responseDeadline).getTime() - expectedResponse) < 60000,
      "the response target is measured from the reopen, not the original submission",
    );
    const expectedResolution = reopenedAt + 7 * 86400000;
    assert.ok(
      Math.abs(new Date(report.resolutionDeadline).getTime() - expectedResolution) < 60000,
      "the resolution target is measured from the reopen, not the original submission",
    );
    assert.equal(report.responseOverdue, false, "a reopened concern is not overdue the moment its priority changes");
    assert.equal(report.resolutionOverdue, false);
    assert.equal(report.overdue, false);
    // The original submission date must not creep back into the calculation.
    assert.notEqual(report.responseDeadline, new Date(new Date(submittedAt).getTime() + 1 * 86400000).toISOString());
    assert.notEqual(report.resolutionDeadline, new Date(new Date(submittedAt).getTime() + 7 * 86400000).toISOString());
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an official status update is stamped by the server, not by the browser", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-server-clock-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Clock Resident",
        email: "clock-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];

    const submittedAt = new Date().toISOString();
    let state = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    state.data.reports.push({
      id: "RPT-2026-clock-01",
      userEmail: "clock-resident@example.test",
      name: "Clock Resident",
      category: "Road damage",
      title: "Road damage · Purok 1",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the hall",
      description: "A large pothole near the barangay hall needs patching.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt,
      updatedAt: submittedAt,
      // A concern cannot arrive already answered: the resident has no say in the
      // recorded first response or the recorded resolution.
      respondedAt: "2020-01-01T00:00:00.000Z",
      resolvedAt: "2020-01-01T00:00:00.000Z",
      photos: [],
      history: [{ status: "Submitted", at: submittedAt, note: "Report received." }],
    });
    const submitted = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(submitted.status, 200);
    state = await submitted.json();
    let report = state.data.reports.find((item) => item.id === "RPT-2026-clock-01");
    assert.equal(report.respondedAt, null, "a newly filed concern is unanswered");
    assert.equal(report.resolvedAt, null, "a newly filed concern is unresolved");

    // The official backdates the update. The report timestamp and the status entry
    // are moved into the past together, so the server's own consistency check
    // cannot tell the difference.
    const backdated = "2020-01-01T00:00:00.000Z";
    let officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const target = officialState.data.reports.find((item) => item.id === "RPT-2026-clock-01");
    target.status = "Under Review";
    target.updatedAt = backdated;
    target.history.push({ status: "Under Review", at: backdated, note: "A barangay official is reviewing this report." });
    const reviewed = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(reviewed.status, 200, "the backdated request is still accepted as an update");
    officialState = await reviewed.json();
    report = officialState.data.reports.find((item) => item.id === "RPT-2026-clock-01");
    assert.notEqual(report.respondedAt, backdated, "the recorded first response is not the browser's timestamp");
    assert.notEqual(report.updatedAt, backdated, "the update itself is not the browser's timestamp");
    assert.notEqual(report.history.at(-1).at, backdated, "the status entry is not the browser's timestamp");
    assert.ok(
      Math.abs(new Date(report.respondedAt).getTime() - Date.now()) < 60000,
      "the recorded first response is stamped by the server",
    );
    assert.ok(Math.abs(new Date(report.updatedAt).getTime() - Date.now()) < 60000, "the update is stamped by the server");
    assert.ok(Math.abs(new Date(report.history.at(-1).at).getTime() - Date.now()) < 60000, "the status entry is stamped by the server");
    assert.equal(report.respondedAt, report.updatedAt, "the first response and the update share the server's clock");

    // The resident reads the same server-generated time, not the forged one.
    const residentView = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    const residentReport = residentView.data.reports.find((item) => item.id === "RPT-2026-clock-01");
    assert.equal(residentReport.respondedAt, report.respondedAt);
    assert.equal(residentReport.history.at(-1).at, report.history.at(-1).at);

    // Resolving the concern with a backdated timestamp is stamped the same way.
    officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const resolvedTarget = officialState.data.reports.find((item) => item.id === "RPT-2026-clock-01");
    resolvedTarget.status = "In Progress";
    resolvedTarget.updatedAt = backdated;
    resolvedTarget.history.push({ status: "In Progress", at: backdated, note: "The crew is scheduled to patch the road." });
    await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const inProgress = officialState.data.reports.find((item) => item.id === "RPT-2026-clock-01");
    assert.notEqual(inProgress.updatedAt, backdated);
    assert.ok(Math.abs(new Date(inProgress.updatedAt).getTime() - Date.now()) < 60000);

    officialState = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const finalTarget = officialState.data.reports.find((item) => item.id === "RPT-2026-clock-01");
    finalTarget.status = "Resolved";
    finalTarget.updatedAt = backdated;
    finalTarget.history.push({ status: "Resolved", at: backdated, note: "The road has been patched." });
    const resolved = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: officialState.revision, data: officialState.data },
    });
    assert.equal(resolved.status, 200);
    officialState = await resolved.json();
    report = officialState.data.reports.find((item) => item.id === "RPT-2026-clock-01");
    assert.notEqual(report.resolvedAt, backdated, "the recorded resolution is not the browser's timestamp");
    assert.ok(Math.abs(new Date(report.resolvedAt).getTime() - Date.now()) < 60000, "the recorded resolution is stamped by the server");
    assert.equal(report.resolvedAt, report.updatedAt, "the resolution and the update share the server's clock");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("enforces per-report follow-up limits by priority: Low 3, Medium 5, High unlimited", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-followup-limits-"));
  const app = await startServer(dataDir);
  try {
    const { cookie, email, name } = await registerResident(app, "resident.limit@example.test", "Resident Limit");

    const lowId = await seedReport(app, { cookie, email, name }, { idSuffix: "low", priority: "Low" });
    const mediumId = await seedReport(app, { cookie, email, name }, { idSuffix: "medium", priority: "Medium" });
    const highId = await seedReport(app, { cookie, email, name }, { idSuffix: "high", priority: "High" });

    // Low: 3 allowed, 4th rejected with 429
    for (let i = 0; i < 3; i++) {
      const result = await postFollowUp(app, cookie, lowId, `Low follow-up ${i + 1}`);
      assert.equal(result.status, 200, `low follow-up ${i + 1} accepted`);
      assert.equal(result.json.count, i + 1);
      assert.equal(result.json.limit, 3);
      assert.equal(result.json.remaining, 3 - (i + 1));
    }
    const lowRejected = await postFollowUp(app, cookie, lowId, "Fourth low follow-up.");
    assert.equal(lowRejected.status, 429);
    assert.match(lowRejected.json.error, /follow-up limit/);

    // Medium: 5 allowed, 6th rejected with 429
    for (let i = 0; i < 5; i++) {
      const result = await postFollowUp(app, cookie, mediumId, `Medium follow-up ${i + 1}`);
      assert.equal(result.status, 200, `medium follow-up ${i + 1} accepted`);
      assert.equal(result.json.count, i + 1);
      assert.equal(result.json.limit, 5);
      assert.equal(result.json.remaining, 5 - (i + 1));
    }
    const mediumRejected = await postFollowUp(app, cookie, mediumId, "Sixth medium follow-up.");
    assert.equal(mediumRejected.status, 429);

    // High: more than 5 allowed (unlimited)
    for (let i = 0; i < 7; i++) {
      const result = await postFollowUp(app, cookie, highId, `High follow-up ${i + 1}`);
      assert.equal(result.status, 200, `high follow-up ${i + 1} accepted`);
      assert.equal(result.json.count, i + 1);
      assert.equal(result.json.limit, null);
      assert.equal(result.json.remaining, null);
    }

    // Limits do not leak between reports: medium still blocked, low still blocked
    const mediumStill = await postFollowUp(app, cookie, mediumId, "Extra medium after limit.");
    assert.equal(mediumStill.status, 429);
    const lowStill = await postFollowUp(app, cookie, lowId, "Extra low after limit.");
    assert.equal(lowStill.status, 429);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("rejects follow-ups on resolved concerns with 409", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-followup-resolved-"));
  const app = await startServer(dataDir);
  try {
    const { cookie, email, name } = await registerResident(app, "resident.resolved@example.test", "Resident Resolved");
    const reportId = await seedReport(app, { cookie, email, name }, { idSuffix: "resolved", priority: "High" });

    // Resolve the report directly in the database
    const now = new Date().toISOString();
    await app.db.query("UPDATE reports SET status='Resolved', updated_at=$1 WHERE id=$2", [now, reportId]);
    await app.db.query(
      "INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES ($1,$2,$3,$4,$5,$6,'administrator')",
      [reportId, 1, "Resolved", now, "Concern resolved.", "Portal administrator"],
    );

    const result = await postFollowUp(app, cookie, reportId, "Follow-up after resolution.");
    assert.equal(result.status, 409);
    assert.match(result.json.error, /resolved/);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("resident cannot follow up another resident's report", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-followup-isolation-"));
  const app = await startServer(dataDir);
  try {
    const {
      cookie: ownerCookie,
      email: ownerEmail,
      name: ownerName,
    } = await registerResident(app, "resident.owner@example.test", "Report Owner");
    const reportId = await seedReport(
      app,
      { cookie: ownerCookie, email: ownerEmail, name: ownerName },
      { idSuffix: "isolated", priority: "High" },
    );

    const { cookie: otherCookie } = await registerResident(app, "resident.other@example.test", "Other Resident");
    const result = await postFollowUp(app, otherCookie, reportId, "Someone else's follow-up.");
    assert.equal(result.status, 404);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("existing follow-ups count retroactively toward the priority limit", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-followup-retro-"));
  const app = await startServer(dataDir);
  try {
    const { cookie, email, name } = await registerResident(app, "resident.retro@example.test", "Resident Retro");

    // Seed report with 2 pre-existing follow-ups directly in the database
    const reportId = await seedReport(app, { cookie, email, name }, { idSuffix: "retro", priority: "Low" });
    await app.db.query("INSERT INTO report_follow_ups(report_id, user_email, message) VALUES ($1, $2, $3), ($1, $2, $4)", [
      reportId,
      email,
      "Pre-existing follow-up one.",
      "Pre-existing follow-up two.",
    ]);

    // Low limit is 3, with 2 already counted -> 1 allowed, then blocked
    const first = await postFollowUp(app, cookie, reportId, "Third follow-up.");
    assert.equal(first.status, 200);
    assert.equal(first.json.count, 3);
    assert.equal(first.json.limit, 3);
    assert.equal(first.json.remaining, 0);

    const blocked = await postFollowUp(app, cookie, reportId, "Fourth follow-up after retroactive count.");
    assert.equal(blocked.status, 429);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("staff can adjust concern priority with history, notification, and activity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-priority-staff-"));
  const app = await startServer(dataDir);
  try {
    const {
      cookie: residentCookie,
      email: residentEmail,
      name: residentName,
    } = await registerResident(app, "resident.priority@example.test", "Resident Priority");
    const reportId = await seedReport(
      app,
      { cookie: residentCookie, email: residentEmail, name: residentName },
      { idSuffix: "staff", priority: "Medium" },
    );

    const admin = await signIn(app);
    assert.equal(admin.response.status, 200);
    const officialCreated = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Official One",
        email: "official@example.test",
        area: "Palsara",
        phone: "",
        role: "official",
        status: "Active",
        availableDays: ["Monday"],
        password: "A-unique-official-password!",
      },
    });
    assert.equal(officialCreated.status, 201);
    const signedIn = await signIn(app, "official@example.test", "A-unique-official-password!");
    assert.equal(signedIn.response.status, 200);
    const officialCookie = signedIn.cookie;

    const changed = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId, priority: "High" },
    });
    assert.equal(changed.status, 200);
    const changedJson = await changed.json();
    assert.equal(changedJson.priority, "High");

    const state = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    const report = state.data.reports.find((item) => item.id === reportId);
    assert.equal(report.priority, "High");
    assert.equal(report.urgent, true);
    const priorityHistory = report.history.find((item) => item.note === "Priority changed to High.");
    assert.ok(priorityHistory, "priority change recorded in history");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("report-priority rejects invalid, missing, unauthorized, resolved and over-quota changes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-priority-denials-"));
  const app = await startServer(dataDir);
  try {
    const {
      cookie: residentCookie,
      email: residentEmail,
      name: residentName,
    } = await registerResident(app, "resident.denials@example.test", "Resident Denials");
    const highId = await seedReport(
      app,
      { cookie: residentCookie, email: residentEmail, name: residentName },
      { idSuffix: "denials-high", priority: "High" },
    );
    const resolvedId = await seedReport(
      app,
      { cookie: residentCookie, email: residentEmail, name: residentName },
      { idSuffix: "denials-resolved", priority: "Medium" },
    );
    await app.db.query("UPDATE reports SET status='Resolved' WHERE id=$1", [resolvedId]);

    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);

    // resident cannot change priority at all
    const residentAttempt = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: residentCookie,
      body: { reportId: highId, priority: "Low" },
    });
    assert.equal(residentAttempt.status, 403);

    // invalid priority value
    const invalid = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: highId, priority: "Urgent" },
    });
    assert.equal(invalid.status, 400);

    // missing report
    const missing = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: "RPT-does-not-exist", priority: "Low" },
    });
    assert.equal(missing.status, 404);

    // resolved report cannot be re-prioritized
    const resolvedAttempt = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: resolvedId, priority: "High" },
    });
    assert.equal(resolvedAttempt.status, 409);

    // same-priority is a no-op success
    const noop = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: highId, priority: "High" },
    });
    assert.equal(noop.status, 200);

    // downgrade below existing follow-up count is rejected
    for (let i = 0; i < 4; i++) {
      const followUp = await postFollowUp(app, residentCookie, highId, `Follow-up ${i + 1} before downgrade.`);
      assert.equal(followUp.status, 200);
    }
    const downgrade = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: highId, priority: "Low" },
    });
    assert.equal(downgrade.status, 400);

    // official with manageReports disabled via account override is denied server-side
    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    state.data.accountOverrides = { "official@example.test": { manageReports: false } };
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(saved.status, 200, `override save failed: ${await saved.text()}`);

    // override must persist across a fresh read
    const reloaded = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    assert.deepEqual(reloaded.data.accountOverrides["official@example.test"], { manageReports: false });

    const overrideDenied = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId: highId, priority: "Medium" },
    });
    assert.equal(overrideDenied.status, 403);

    // non-admin cannot set overrides
    const state2 = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    state2.data.accountOverrides = { "official@example.test": {} };
    const officialAttempt = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: state2.revision, data: state2.data },
    });
    assert.equal(officialAttempt.status, 403);

    // override for a non-official account is rejected
    const state3 = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    state3.data.accountOverrides = { [residentEmail]: { manageReports: true } };
    const badOverride = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state3.revision, data: state3.data },
    });
    assert.equal(badOverride.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("set-priority cells: Medium and Low apply urgent mapping and their follow-up limits", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-priority-cells-"));
  const app = await startServer(dataDir);
  try {
    const {
      cookie: residentCookie,
      email: residentEmail,
      name: residentName,
    } = await registerResident(app, "resident.cells@example.test", "Resident Cells");
    const reportId = await seedReport(
      app,
      { cookie: residentCookie, email: residentEmail, name: residentName },
      { idSuffix: "cells", priority: "High" },
    );

    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);

    const toMedium = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId, priority: "Medium" },
    });
    assert.equal(toMedium.status, 200);
    let state = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    let report = state.data.reports.find((item) => item.id === reportId);
    assert.equal(report.priority, "Medium");
    assert.equal(report.urgent, false);
    assert.ok(report.history.some((item) => item.note === "Priority changed to Medium."));

    const toLow = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId, priority: "Low" },
    });
    assert.equal(toLow.status, 200);
    state = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    report = state.data.reports.find((item) => item.id === reportId);
    assert.equal(report.priority, "Low");
    assert.equal(report.urgent, false);
    assert.ok(report.history.some((item) => item.note === "Priority changed to Low."));

    // Low limit (3) now applies
    for (let i = 0; i < 3; i++)
      assert.equal((await postFollowUp(app, residentCookie, reportId, `Low cell follow-up ${i + 1}.`)).status, 200);
    assert.equal((await postFollowUp(app, residentCookie, reportId, "Fourth Low follow-up.")).status, 429);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("follow-up cells: Under Review and In Progress record the current status in history", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-followup-cells-"));
  const app = await startServer(dataDir);
  try {
    const { cookie, email, name } = await registerResident(app, "resident.followcells@example.test", "Resident Follow Cells");
    for (const status of ["Under Review", "In Progress"]) {
      const suffix = status === "Under Review" ? "under-review" : "in-progress";
      const reportId = await seedReport(app, { cookie, email, name }, { idSuffix: suffix, priority: "High" });
      await app.db.query("UPDATE reports SET status=$1 WHERE id=$2", [status, reportId]);
      const result = await postFollowUp(app, cookie, reportId, `Follow-up while ${status}.`);
      assert.equal(result.status, 200, `${status} follow-up accepted`);
      const state = await api(app, "/api/state", { cookie }).then((r) => r.json());
      const report = state.data.reports.find((item) => item.id === reportId);
      const latest = report.history.at(-1);
      assert.equal(latest.status, status, `history records ${status}, not Submitted`);
      assert.match(latest.note, /Follow-up:/);
    }
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("admin state update cannot bypass priority/status guards or set an unmanaged resident area", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-admin-guards-"));
  const app = await startServer(dataDir);
  try {
    const {
      cookie: residentCookie,
      email: residentEmail,
      name: residentName,
    } = await registerResident(app, "resident.guards@example.test", "Resident Guards");
    const reportId = await seedReport(
      app,
      { cookie: residentCookie, email: residentEmail, name: residentName },
      { idSuffix: "guards", priority: "High" },
    );

    const admin = await signIn(app);

    // admin cannot change priority/status via generic state update
    let state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const tamperedPriority = structuredClone(state.data);
    tamperedPriority.reports.find((item) => item.id === reportId).priority = "Low";
    const priorityAttempt = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: tamperedPriority },
    });
    assert.equal(priorityAttempt.status, 403);

    state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const tamperedStatus = structuredClone(state.data);
    tamperedStatus.reports.find((item) => item.id === reportId).status = "Resolved";
    const statusAttempt = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: tamperedStatus },
    });
    assert.equal(statusAttempt.status, 403);

    // resident cannot move to an unmanaged area via state sync
    const residentState = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    const movedResident = structuredClone(residentState.data);
    movedResident.users[0].area = "Not a managed area";
    const areaAttempt = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: residentState.revision, data: movedResident },
    });
    assert.equal(areaAttempt.status, 400);

    // resident can still save an unrelated profile change with legacy area intact
    const residentState2 = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    const renamed = structuredClone(residentState2.data);
    renamed.users[0].name = "Renamed Resident";
    const renameAttempt = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: residentState2.revision, data: renamed },
    });
    assert.equal(renameAttempt.status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a resident cannot submit a concern whose first history entry claims another status", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-forged-history-"));
  const app = await startServer(dataDir);
  try {
    const { cookie, email, name } = await registerResident(app, "forged-history@example.test", "Forged History");
    const state = await api(app, "/api/state", { cookie }).then((r) => r.json());
    const now = new Date().toISOString();
    const data = structuredClone(state.data);
    data.reports.push({
      id: "RPT-forged-open",
      userEmail: email,
      name,
      category: "Flooding",
      title: "Forged first entry",
      area: "Purok 2",
      barangay: "Palsara",
      locationDetail: "Near the school",
      latitude: 14.01799,
      longitude: 121.09465,
      description: "Water pools near the school entrance after rain.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos: [],
      history: [{ status: "Resolved", at: now, note: "The road has been patched.", actorName: "Official One", actorRole: "official" }],
    });
    const attempt = await api(app, "/api/state", { method: "PUT", cookie, body: { revision: state.revision, data } });
    assert.equal(attempt.status, 403, await attempt.text());
    const reloaded = await api(app, "/api/state", { cookie }).then((r) => r.json());
    assert.equal(
      reloaded.data.reports.some((report) => report.id === "RPT-forged-open"),
      false,
      "a concern claiming a first entry it never earned is not stored",
    );
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("confirmation and reopening text is length-limited", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-confirm-caps-"));
  const app = await startServer(dataDir);
  try {
    const { cookie, email, name } = await registerResident(app, "caps-resident@example.test", "Caps Resident");
    const reportId = await seedReport(app, { cookie, email, name }, { idSuffix: "caps", priority: "Medium" });

    const now = new Date().toISOString();
    await app.db.query("UPDATE reports SET status='Resolved', updated_at=$1 WHERE id=$2", [now, reportId]);
    await app.db.query(
      "INSERT INTO report_history(report_id,position,status,at,note,actor_name,actor_role) VALUES ($1,$2,$3,$4,$5,$6,'administrator')",
      [reportId, 1, "Resolved", now, "Concern resolved.", "Portal administrator"],
    );

    const longNote = "x".repeat(501);
    const longConfirm = await api(app, "/api/community/report-confirm", { method: "POST", cookie, body: { reportId, note: longNote } });
    assert.equal(longConfirm.status, 400);
    assert.match((await longConfirm.json()).error ?? "", /500/);

    const confirm = await api(app, "/api/community/report-confirm", {
      method: "POST",
      cookie,
      body: { reportId, note: "Thank you, it is fixed." },
    });
    assert.equal(confirm.status, 200, await confirm.text());

    const longReason = "y".repeat(501);
    const longReopen = await api(app, "/api/community/report-reopen", { method: "POST", cookie, body: { reportId, reason: longReason } });
    assert.equal(longReopen.status, 400);
    assert.match((await longReopen.json()).error ?? "", /500/);

    const reopen = await api(app, "/api/community/report-reopen", {
      method: "POST",
      cookie,
      body: { reportId, reason: "The pothole returned after one week." },
    });
    assert.equal(reopen.status, 200, await reopen.text());
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("photos cannot be uploaded for a concern that is already on file", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-photo-existing-"));
  const app = await startServer(dataDir);
  try {
    const { cookie, email, name } = await registerResident(app, "photo-existing@example.test", "Photo Existing");
    const reportId = await seedReport(app, { cookie, email, name }, { idSuffix: "existing", priority: "Medium" });

    // The concern is already on file, so its photos were registered by the
    // submission: another upload would leak an unservable file on disk.
    const attempt = await uploadPhoto(app, `/api/report-photos?reportId=${reportId}`, cookie, TEST_JPEG);
    assert.equal(attempt.status, 409);

    // The draft flow still works while the concern has not been submitted.
    const draft = await uploadPhoto(app, "/api/report-photos?reportId=R-DRAFTPHOTO", cookie, TEST_JPEG);
    assert.equal(draft.status, 201, await draft.text());
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("priority downgrade at exactly the new limit succeeds, then the next follow-up is blocked", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-downgrade-boundary-"));
  const app = await startServer(dataDir);
  try {
    const {
      cookie: residentCookie,
      email: residentEmail,
      name: residentName,
    } = await registerResident(app, "resident.boundary@example.test", "Resident Boundary");
    const reportId = await seedReport(
      app,
      { cookie: residentCookie, email: residentEmail, name: residentName },
      { idSuffix: "boundary", priority: "High" },
    );

    for (let i = 0; i < 5; i++) {
      assert.equal((await postFollowUp(app, residentCookie, reportId, `Boundary follow-up ${i + 1}.`)).status, 200);
    }

    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);

    // 5 existing follow-ups == Medium limit (5): downgrade allowed, next follow-up blocked
    const downgrade = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId, priority: "Medium" },
    });
    assert.equal(downgrade.status, 200);

    const blocked = await postFollowUp(app, residentCookie, reportId, "One too many.");
    assert.equal(blocked.status, 429);

    // upgrading back to High (unlimited) unblocks
    const upgrade = await api(app, "/api/community/report-priority", {
      method: "POST",
      cookie: officialCookie,
      body: { reportId, priority: "High" },
    });
    assert.equal(upgrade.status, 200);
    assert.equal((await postFollowUp(app, residentCookie, reportId, "Unblocked again.")).status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("report photos survive the state save under the report's own id", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-report-photo-"));
  const app = await startServer(dataDir);
  try {
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Photo Tester",
        email: "photo-tester@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie")?.split(";")[0] || "";
    const stateResponse = await api(app, "/api/state", { cookie });
    const state = await stateResponse.json();
    const reportId = "R-PHOTOTEST1";

    const upload = await uploadPhoto(app, `/api/report-photos?reportId=${reportId}`, cookie, TEST_JPEG);
    assert.equal(upload.status, 201);
    const photos = (await upload.json()).photos;
    assert.equal(photos.length, 1);
    assert.ok(photos[0].photoUrl.startsWith(`/api/reports/${reportId}/photos/`));

    const spoofed = await uploadPhoto(app, `/api/report-photos?reportId=${reportId}`, cookie, Buffer.from("<html>not an image</html>"));
    assert.equal(spoofed.status, 400, "A file renamed to .jpg must be rejected");

    const now = new Date().toISOString();
    const data = structuredClone(state.data);
    data.reports.unshift({
      id: reportId,
      userEmail: "photo-tester@example.test",
      name: "Photo Tester",
      category: "Road damage",
      title: "Road damage · Purok 1",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the covered court",
      latitude: null,
      longitude: null,
      description: "A large pothole is holding water after every rain.",
      urgent: false,
      priority: "Medium",
      assignedTo: null,
      status: "Submitted",
      submittedAt: now,
      updatedAt: now,
      photos,
      history: [{ status: "Submitted", at: now, note: "Report received." }],
    });
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie,
      body: { revision: state.revision, data },
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.deepEqual(savedBody.data.reports[0].photos, photos);

    const image = await fetch(`${app.origin}${photos[0].photoUrl}`, { headers: { Cookie: cookie } });
    assert.equal(image.status, 200, "The stored photo must still be reachable");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("confirming a resolved concern twice is refused", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-confirm-once-"));
  const app = await startServer(dataDir);
  try {
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Confirm Tester",
        email: "confirm-tester@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie")?.split(";")[0] || "";
    await app.db.query(`
      INSERT INTO reports (id, user_email, name, category, title, area, description, status, submitted_at, updated_at)
      VALUES ('R-CONFIRM1', 'confirm-tester@example.test', 'Confirm Tester', 'Road damage',
        'Road damage · Purok 1', 'Purok 1', 'A pothole that was already repaired.', 'Resolved', now(), now())
    `);

    const first = await api(app, "/api/community/report-confirm", {
      method: "POST",
      cookie,
      body: { reportId: "R-CONFIRM1", note: "Fixed." },
    });
    assert.equal(first.status, 200);
    const second = await api(app, "/api/community/report-confirm", {
      method: "POST",
      cookie,
      body: { reportId: "R-CONFIRM1", note: "Fixed again." },
    });
    assert.equal(second.status, 409);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
