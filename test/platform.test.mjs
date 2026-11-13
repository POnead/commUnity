import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn, ADMIN_EMAIL, ADMIN_PASSWORD, registerResident, createOfficial, manilaDate } from "./helpers.mjs";
import { createCommunityServer, withTransaction, requestClientAddress, runScheduleReminders } from "../server/index.mjs";

test("pins PostgreSQL transaction queries to one checked-out connection", async () => {
  const statements = [];
  let released = 0;
  const client = {
    query: async (statement) => {
      statements.push(statement);
      return { rows: [] };
    },
    release: () => {
      released += 1;
    },
  };
  const pool = { connect: async () => client };
  await withTransaction(pool, async (transaction) => {
    await transaction.query("UPDATE users SET status='Active'");
  });
  assert.deepEqual(statements, ["BEGIN", "UPDATE users SET status='Active'", "COMMIT"]);
  assert.equal(released, 1);
});

test("uses forwarded addresses only behind explicitly trusted proxies", () => {
  const directRequest = {
    socket: { remoteAddress: "::ffff:192.0.2.12" },
    headers: { "x-forwarded-for": "198.51.100.4" },
  };
  assert.equal(requestClientAddress(directRequest), "192.0.2.12");

  const proxiedRequest = {
    socket: { remoteAddress: "::ffff:10.0.0.2" },
    headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" },
  };
  assert.equal(requestClientAddress(proxiedRequest, new Set(["10.0.0.1", "10.0.0.2"])), "198.51.100.4");
  assert.equal(requestClientAddress({ ...proxiedRequest, headers: { "x-forwarded-for": "malformed" } }, new Set(["10.0.0.2"])), "10.0.0.2");
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
    assert.equal(home.headers.get("x-powered-by"), null);
    const health = await fetch(`${app.origin}/api/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
    assert.ok(health.headers.get("x-request-id"));
    const homeHtml = await home.text();
    assert.match(homeHtml, /CommUnity/);
    assert.match(homeHtml, /node_modules\/leaflet\/dist\/leaflet\.css/);
    assert.match(homeHtml, /node_modules\/leaflet\/dist\/leaflet\.js/);
    assert.equal((await fetch(`${app.origin}/package.json`)).status, 404);
    for (const [asset, contentType] of [
      ["/app/main.mjs", "text/javascript"],
      ["/app/views.mjs", "text/javascript"],
      ["/app/core.mjs", "text/javascript"],
      ["/app/constants.mjs", "text/javascript"],
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
    // The directory-based allowlist must not leak anything outside its root.
    assert.equal((await fetch(`${app.origin}/app/../server/index.mjs`)).status, 404);
    assert.equal((await fetch(`${app.origin}/app/..%2Fserver%2Findex.mjs`)).status, 404);
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
    assert.deepEqual(
      state.data.users.map((user) => user.email),
      [],
    );
    const sessionUser = await (await api(app, "/api/session", { cookie: signedIn.cookie })).json();
    assert.equal("passwordHash" in sessionUser.user, false);
    assert.equal("password_hash" in sessionUser.user, false);
    const reportId = "RPT-photo-test";
    const photoData = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    await mkdir(path.join(path.dirname(dataDir), "uploads", reportId), { recursive: true });
    await writeFile(path.join(path.dirname(dataDir), "uploads", reportId, "test.jpg"), photoData);
    await app.db.query(
      `
      INSERT INTO reports (id,user_email,name,category,title,area,description,status,submitted_at,updated_at)
      VALUES ($1,$2,'Test resident','Road damage','Test report','Purok 1','A report with a photo','Submitted',now(),now())
    `,
      [reportId, ADMIN_EMAIL],
    );
    await app.db.query("INSERT INTO report_photos (report_id,position,name,photo_url) VALUES ($1,0,'test.jpg',$2)", [
      reportId,
      `/api/reports/${reportId}/photos/0/test.jpg`,
    ]);
    const photoResponse = await api(app, `/api/reports/${reportId}/photos/0/test.jpg`, { cookie: signedIn.cookie });
    assert.equal(photoResponse.status, 200);
    assert.equal(photoResponse.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from((await photoResponse.arrayBuffer()).slice(0, 4)), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    assert.equal((await api(app, `/api/reports/${reportId}/photos/1/test.jpg`, { cookie: signedIn.cookie })).status, 404);

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
  await assert.rejects(createCommunityServer({ dataDir: ":memory:", host: "0.0.0.0", databaseUrl: "" }), /must bind to loopback/);
  await assert.rejects(createCommunityServer({ dataDir: ":memory:", trustedProxyIps: "not-an-ip" }), /TRUSTED_PROXY_IPS/);
  await assert.rejects(createCommunityServer({ dataDir: ":memory:", poolMax: 0 }), /PG_POOL_MAX/);
  await assert.rejects(createCommunityServer({ dataDir: ":memory:", timeZone: "Mars/Olympus_Mons" }), /APP_TIME_ZONE/);
});

test("uses the barangay time zone for calendar days, new accounts and collection reminders", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-timezone-"));
  const app = await startServer(dataDir);
  try {
    // The PostgreSQL session is pinned, so CURRENT_DATE is the barangay's date.
    const zone = await app.db.query("SELECT current_setting('TimeZone') AS tz");
    assert.equal(zone.rows[0].tz, "Asia/Manila");

    const admin = await signIn(app);
    const session = await api(app, "/api/session", { cookie: admin.cookie }).then((response) => response.json());
    assert.equal(session.user.joinedAt, manilaDate(0), "a new account joins on the barangay's day");

    // Date validation uses the barangay's day, not the host's.
    const officialCookie = await createOfficial(app, admin.cookie);
    const past = await api(app, "/api/calendar/events", {
      method: "POST",
      cookie: officialCookie,
      body: { title: "Past event", detail: "This should be refused.", date: manilaDate(-1) },
    });
    assert.equal(past.status, 400);
    const today = await api(app, "/api/calendar/events", {
      method: "POST",
      cookie: officialCookie,
      body: { title: "Today event", detail: "This is allowed today.", date: manilaDate(0) },
    });
    assert.equal(today.status, 200);

    // A collection scheduled for the barangay's tomorrow is the one that reminds.
    const resident = await registerResident(app, "timezone-resident@example.test", "Timezone Resident");
    const state = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    state.data.schedules.push({
      id: "GCS-tz-reminder",
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
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(saved.status, 200);
    assert.equal(await runScheduleReminders(app.db), 1, "the reminder matches the barangay's tomorrow");

    const after = await api(app, "/api/state", { cookie: resident.cookie }).then((response) => response.json());
    const reminder = after.data.notifications.find((item) => item.title === "Collection reminder");
    assert.ok(reminder, "the resident is reminded about tomorrow's collection");
    const expectedDay = new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
    }).format(new Date(`${manilaDate(1)}T00:00:00Z`));
    assert.ok(reminder.body.includes(expectedDay), `the reminder names ${expectedDay}: ${reminder.body}`);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("health endpoint reports database availability", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-health-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const health = await api(app, "/api/healthz", { cookie: admin.cookie });
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.status, "ok");
    assert.equal(body.database, "available");
    assert.ok(body.checked_at);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
