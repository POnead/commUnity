import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createCommunityServer, runScheduleReminders, withTransaction } from "./server.mjs";

const ADMIN_EMAIL = "admin@example.test";
const ADMIN_PASSWORD = "LocalTestPassword-2026!";

async function startServer(dataDir) {
  const instance = await createCommunityServer({
    dataDir,
    port: 0,
    initialAdminEmail: ADMIN_EMAIL,
    initialAdminPassword: ADMIN_PASSWORD,
  });
  await new Promise((resolve, reject) => {
    instance.server.once("error", reject);
    instance.server.listen(0, "127.0.0.1", resolve);
  });
  const address = instance.server.address();
  return { ...instance, origin: `http://127.0.0.1:${address.port}` };
}

async function api(app, endpoint, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Origin", options.origin || app.origin);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.cookie) headers.set("Cookie", options.cookie);
  return fetch(`${app.origin}${endpoint}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function signIn(app, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  const response = await api(app, "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const result = await response.json();
  return { response, result, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}

test("pins PostgreSQL transaction queries to one checked-out connection", async () => {
  const statements = [];
  let released = 0;
  const client = {
    query: async (statement) => { statements.push(statement); return { rows: [] }; },
    release: () => { released += 1; },
  };
  const pool = { connect: async () => client };
  await withTransaction(pool, async (transaction) => {
    await transaction.query("UPDATE users SET status='Active'");
  });
  assert.deepEqual(statements, ["BEGIN", "UPDATE users SET status='Active'", "COMMIT"]);
  assert.equal(released, 1);
});

test("serves hardened static files and protects database routes behind sessions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-auth-"));
  const app = await startServer(dataDir);
  try {
    const home = await fetch(app.origin);
    assert.equal(home.status, 200);
    const contentSecurityPolicy = home.headers.get("content-security-policy");
    assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
    assert.match(contentSecurityPolicy, /tile\.openstreetmap\.org/);
    assert.match(contentSecurityPolicy, /script-src 'self'/);
    assert.match(home.headers.get("referrer-policy"), /strict-origin-when-cross-origin/);
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    const homeHtml = await home.text();
    assert.match(homeHtml, /CommUnity/);
    assert.match(homeHtml, /node_modules\/leaflet\/dist\/leaflet\.css/);
    assert.match(homeHtml, /node_modules\/leaflet\/dist\/leaflet\.js/);
    assert.equal((await fetch(`${app.origin}/package.json`)).status, 404);
    for (const [asset, contentType] of [
      ["/node_modules/leaflet/dist/leaflet.js", "text/javascript"],
      ["/node_modules/leaflet/dist/leaflet.css", "text/css"],
      ["/node_modules/leaflet/dist/images/layers.png", "image/png"],
      ["/node_modules/leaflet/dist/images/layers-2x.png", "image/png"],
      ["/node_modules/leaflet/dist/images/marker-icon.png", "image/png"],
      ["/node_modules/leaflet/dist/images/marker-icon-2x.png", "image/png"],
      ["/node_modules/leaflet/dist/images/marker-shadow.png", "image/png"],
    ]) {
      const response = await fetch(`${app.origin}${asset}`);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get("content-type"), new RegExp(contentType), asset);
      assert.ok(Number(response.headers.get("content-length")) > 0, asset);
    }
    const session = await api(app, "/api/session");
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { user: null });
    assert.equal((await api(app, "/api/state")).status, 401);

    const wrongOrigin = await api(app, "/api/auth/login", {
      method: "POST",
      origin: "https://attacker.example",
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assert.equal(wrongOrigin.status, 403);

    const denied = await signIn(app, ADMIN_EMAIL, "wrong-password");
    assert.equal(denied.response.status, 401);
    const signedIn = await signIn(app);
    assert.equal(signedIn.response.status, 200);
    assert.equal(signedIn.result.user.role, "administrator");
    assert.match(signedIn.response.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(signedIn.response.headers.get("set-cookie"), /SameSite=Lax/i);

    const stateResponse = await api(app, "/api/state", { cookie: signedIn.cookie });
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.deepEqual(state.data.users.map((user) => user.email), [ADMIN_EMAIL]);
    assert.equal("passwordHash" in state.data.users[0], false);
    assert.equal("password_hash" in state.data.users[0], false);

    const forbiddenWrite = await api(app, "/api/state", {
      method: "PUT",
      cookie: "",
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(forbiddenWrite.status, 401);
    const reset = await api(app, "/api/state", { method: "DELETE", cookie: signedIn.cookie });
    assert.equal(reset.status, 404);
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
      barangay: "Balete",
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
      body: { revision: (await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json())).revision, data: changed },
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
    const passwordRecord = await app.db.query("SELECT password_hash FROM user_credentials WHERE user_id=(SELECT id FROM users WHERE email=$1)", ["resident@example.test"]);
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
        area: "Balete, Batangas",
        phone: "",
        role: "official",
        status: "Active",
        password: "A-unique-official-password!",
      },
    });
    assert.equal(officialCreated.status, 201);

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
      barangay: "Balete",
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
    assert.equal(officialState.data.notifications.some((item) => item.targetEmail === "official@example.test"), true);

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
    assert.deepEqual(officialState.data.reports[0].history.at(-1), {
      status: "Under Review",
      at: report.updatedAt,
      note: "A barangay official is reviewing this report.",
      actorName: officialSession.user.name,
      actorRole: "official",
    });
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
    assert.equal(residentAfter.data.notifications.some((item) => item.title === "Report submitted"), true);
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
      barangay: "Balete",
      street: "Mabini Street",
      purok: "Purok 6",
      landmark: "Community Hall",
    });
    adminState.data.recyclingLocations.push({
      id: "REC-test-1",
      name: "Balete Materials Recovery Center",
      barangay: "Balete",
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
    assert.equal(residentState.data.locations.some((item) => item.area === "Purok 6"), true);
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
        area: "Balete, Batangas",
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
    const tomorrow = await app.db.query("SELECT to_char(CURRENT_DATE + 1, 'YYYY-MM-DD') AS date");
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
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("keeps database sessions valid across server restarts and rejects public binds without PostgreSQL", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-session-restart-"));
  let app = await startServer(dataDir);
  try {
    const signedIn = await signIn(app);
    assert.equal(signedIn.response.status, 200);
    await app.close();
    app = await createCommunityServer({ dataDir, port: 0 });
    await new Promise((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", resolve);
    });
    app.origin = `http://127.0.0.1:${app.server.address().port}`;
    const session = await api(app, "/api/session", { cookie: signedIn.cookie });
    assert.equal((await session.json()).user.email, ADMIN_EMAIL);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
  await assert.rejects(
    createCommunityServer({ dataDir: ":memory:", host: "0.0.0.0", databaseUrl: "" }),
    /must bind to loopback/,
  );
});
