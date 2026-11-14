import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, uploadPhoto, signIn, TEST_JPEG, ADMIN_EMAIL, registerResident, createOfficial } from "./helpers.mjs";

test("allows unrelated account updates when a resident has a legacy unmanaged area", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-legacy-area-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Legacy Area Resident",
        email: "legacy-area@example.test",
        area: "Purok 4",
        phone: "",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    await app.db.query("UPDATE users SET area='Palsara' WHERE email=$1", ["legacy-area@example.test"]);

    const official = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Account Official",
        email: "account-official@example.test",
        area: "Palsara",
        role: "official",
        status: "Active",
        password: "A-unique-official-password!",
      },
    });
    assert.equal(official.status, 201);

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const officialAccount = state.data.users.find((account) => account.email === "account-official@example.test");
    officialAccount.name = "Updated Official";
    const saved = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(saved.status, 200);

    const refreshed = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const residentAccount = refreshed.data.users.find((account) => account.email === "legacy-area@example.test");
    residentAccount.area = "Not a managed area";
    const rejectedAreaChange = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: refreshed.revision, data: refreshed.data },
    });
    assert.equal(rejectedAreaChange.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("deactivating an account revokes all of its sessions in the same transaction", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-deactivate-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Deactivation Target",
        email: "deactivate-target@example.test",
        area: "Purok 1",
        password: "A-unique-target-password!",
        confirmPassword: "A-unique-target-password!",
      },
    });
    const target = await signIn(app, "deactivate-target@example.test", "A-unique-target-password!");
    assert.equal(target.response.status, 200);

    // Registering issues a remember-me session; signing in adds another.
    const sessionsBefore = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["deactivate-target@example.test"],
    );
    assert.equal(sessionsBefore.rows[0].count, 2);

    const deactivated = await api(app, "/api/users/deactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "deactivate-target@example.test", reason: "No longer part of the community." },
    });
    assert.equal(deactivated.status, 200);
    assert.equal((await deactivated.json()).ok, true);

    const account = await app.db.query("SELECT status, deactivation_reason FROM users WHERE email=$1", ["deactivate-target@example.test"]);
    assert.equal(account.rows[0].status, "Inactive");
    assert.equal(account.rows[0].deactivation_reason, "No longer part of the community.");

    // Sessions are revoked in the same transaction as deactivation.
    const sessionsAfter = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["deactivate-target@example.test"],
    );
    assert.equal(sessionsAfter.rows[0].count, 0);

    // The old session can no longer authenticate the account.
    const oldSession = await api(app, "/api/session", { cookie: target.cookie });
    assert.equal((await oldSession.json()).user, null);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("reactivating an account does not resurrect its revoked sessions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-reactivate-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Reactivation Target",
        email: "reactivate-target@example.test",
        area: "Purok 1",
        password: "A-unique-target-password!",
        confirmPassword: "A-unique-target-password!",
      },
    });
    const target = await signIn(app, "reactivate-target@example.test", "A-unique-target-password!");
    assert.equal(target.response.status, 200);

    const deactivated = await api(app, "/api/users/deactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "reactivate-target@example.test", reason: "Temporary leave." },
    });
    assert.equal(deactivated.status, 200);

    let sessions = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["reactivate-target@example.test"],
    );
    assert.equal(sessions.rows[0].count, 0, "deactivation must revoke sessions before reactivation");

    const reactivated = await api(app, "/api/users/reactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "reactivate-target@example.test" },
    });
    assert.equal(reactivated.status, 200);

    const restored = await app.db.query("SELECT status, deactivation_reason FROM users WHERE email=$1", ["reactivate-target@example.test"]);
    assert.equal(restored.rows[0].status, "Active");
    assert.equal(restored.rows[0].deactivation_reason, "");

    // No old session is valid again: the count stays at zero.
    sessions = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["reactivate-target@example.test"],
    );
    assert.equal(sessions.rows[0].count, 0);
    const oldSession = await api(app, "/api/session", { cookie: target.cookie });
    assert.equal((await oldSession.json()).user, null);

    // The account holder can sign in again, which issues a fresh session.
    const fresh = await signIn(app, "reactivate-target@example.test", "A-unique-target-password!");
    assert.equal(fresh.response.status, 200);
    const sessionsAgain = await app.db.query(
      "SELECT count(*)::integer AS count FROM web_sessions WHERE user_id=(SELECT id FROM users WHERE email=$1)",
      ["reactivate-target@example.test"],
    );
    assert.equal(sessionsAgain.rows[0].count, 1);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the account editor cannot change an account's status through /api/state", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-editor-status-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Status Target",
        email: "status-target@example.test",
        area: "Purok 1",
        password: "A-unique-target-password!",
        confirmPassword: "A-unique-target-password!",
      },
    });

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const target = state.data.users.find((account) => account.email === "status-target@example.test");
    assert.ok(target);
    assert.equal(target.status, "Active");

    const tampered = structuredClone(state.data);
    tampered.users.find((account) => account.email === "status-target@example.test").status = "Inactive";
    const rejected = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: tampered },
    });
    assert.equal(rejected.status, 403, await rejected.text());

    // The account is still active: the editor could not deactivate it.
    const untouched = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const persisted = untouched.data.users.find((account) => account.email === "status-target@example.test");
    assert.equal(persisted.status, "Active");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("official working-hours and available-days validation rejects invalid input at creation", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hours-validation-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const base = {
      name: "Bad Official",
      area: "Palsara",
      phone: "",
      role: "official",
      status: "Active",
      password: "A-unique-official-password!",
    };

    const reversed = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { ...base, email: "reversed@example.test", workingHours: "Monday, 5:00 PM-8:00 AM", availableDays: ["Monday"] },
    });
    assert.equal(reversed.status, 400);

    const duplicate = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { ...base, email: "duplicate@example.test", availableDays: ["Monday", "Monday"] },
    });
    assert.equal(duplicate.status, 400);

    const unknownDay = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { ...base, email: "unknownday@example.test", availableDays: ["Funday"] },
    });
    assert.equal(unknownDay.status, 400);

    const malformedTime = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { ...base, email: "malformed@example.test", workingHours: "Monday, breakfast-lunch", availableDays: ["Monday"] },
    });
    assert.equal(malformedTime.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("account overrides deny schedules and announcements and malformed overrides are rejected", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-override-extended-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);

    const setOverrides = async (overrides) => {
      const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
      state.data.accountOverrides = overrides;
      return api(app, "/api/state", { method: "PUT", cookie: admin.cookie, body: { revision: state.revision, data: state.data } });
    };

    assert.equal((await setOverrides({ "official@example.test": { manageSchedules: false } })).status, 200);
    const calendarAttempt = await api(app, "/api/calendar/events", {
      method: "POST",
      cookie: officialCookie,
      body: { title: "Blocked event", detail: "Should be denied.", date: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(calendarAttempt.status, 403);

    assert.equal((await setOverrides({ "official@example.test": { manageAnnouncements: false } })).status, 200);
    const announcementAttempt = await api(app, "/api/announcements", {
      method: "POST",
      cookie: officialCookie,
      body: { title: "Blocked notice", detail: "Should be denied.", date: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(announcementAttempt.status, 403);

    assert.equal((await setOverrides({ "official@example.test": { manageReports: "yes" } })).status, 400);
    assert.equal((await setOverrides({ "official@example.test": { fly: true } })).status, 400);

    // clearing overrides restores access
    assert.equal((await setOverrides({})).status, 200);
    const allowedAgain = await api(app, "/api/announcements", {
      method: "POST",
      cookie: officialCookie,
      body: { title: "Allowed notice", detail: "Access restored.", date: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(allowedAgain.status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("permission overrides are visible only to their administrator, owner and no one else", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-override-visibility-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const firstCookie = await createOfficial(app, admin.cookie, "first-official@example.test", "First Official");
    const secondCookie = await createOfficial(app, admin.cookie, "second-official@example.test", "Second Official");
    const resident = await registerResident(app, "override-resident@example.test", "Override Resident");

    const adminState = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    adminState.data.accountOverrides = {
      "first-official@example.test": { manageReports: false },
      "second-official@example.test": { manageSchedules: false },
    };
    const overrideSave = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: adminState.revision, data: adminState.data },
    });
    assert.equal(overrideSave.status, 200, await overrideSave.text());

    // The administrator manages every official's overrides.
    const reloaded = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    assert.deepEqual(reloaded.data.accountOverrides, {
      "first-official@example.test": { manageReports: false },
      "second-official@example.test": { manageSchedules: false },
    });

    // An official receives their own overrides and nobody else's, so a colleague's
    // email address and access settings never leave the server for them.
    const first = await api(app, "/api/state", { cookie: firstCookie }).then((r) => r.json());
    assert.deepEqual(first.data.accountOverrides, { "first-official@example.test": { manageReports: false } });
    assert.equal(first.data.accountOverrides["second-official@example.test"], undefined);

    const second = await api(app, "/api/state", { cookie: secondCookie }).then((r) => r.json());
    assert.deepEqual(second.data.accountOverrides, { "second-official@example.test": { manageSchedules: false } });

    // Residents receive none.
    const residentState = await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json());
    assert.deepEqual(residentState.data.accountOverrides, {});

    // An official's own workspace save still works with the restricted copy.
    const noOpSave = await api(app, "/api/state", {
      method: "PUT",
      cookie: firstCookie,
      body: { revision: first.revision, data: first.data },
    });
    assert.equal(noOpSave.status, 200, await noOpSave.text());
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("editing an official's email keeps their permission overrides with the account", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-override-move-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    await createOfficial(app, admin.cookie, "moveable@example.test", "Moveable Official");

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    state.data.accountOverrides = { "moveable@example.test": { manageReports: false } };
    const overrideSave = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(overrideSave.status, 200, await overrideSave.text());

    // The workspace still keys the override by the old address when the
    // account's email is edited; the save must follow the account, not fail.
    const reloaded = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const data = structuredClone(reloaded.data);
    const official = data.users.find((account) => account.email === "moveable@example.test");
    official.email = "moved@example.test";
    const rename = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: reloaded.revision, data },
    });
    assert.equal(rename.status, 200, await rename.text());

    const after = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    assert.deepEqual(after.data.accountOverrides, { "moved@example.test": { manageReports: false } });
    const stored = await app.db.query("SELECT permission_overrides AS overrides FROM users WHERE email='moved@example.test'");
    assert.deepEqual(stored.rows[0].overrides, { manageReports: false });
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("demoting an official clears their permission overrides", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-override-demote-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    await createOfficial(app, admin.cookie, "demotable@example.test", "Demotable Official");

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    state.data.accountOverrides = { "demotable@example.test": { manageReports: false } };
    const overrideSave = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(overrideSave.status, 200, await overrideSave.text());

    const reloaded = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const data = structuredClone(reloaded.data);
    const official = data.users.find((account) => account.email === "demotable@example.test");
    official.role = "resident";
    official.area = "Purok 1";
    const demotion = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: reloaded.revision, data },
    });
    assert.equal(demotion.status, 200, await demotion.text());

    // The stale override key is dropped rather than failing the save, and the
    // stored overrides are cleared so the demoted account keeps no elevation.
    const after = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    assert.deepEqual(after.data.accountOverrides, {});
    const stored = await app.db.query("SELECT permission_overrides AS overrides, role FROM users WHERE email='demotable@example.test'");
    assert.deepEqual(stored.rows[0].overrides, {});
    assert.equal(stored.rows[0].role, "resident");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("deactivating an account revokes its session in the same stroke, and reactivation restores access", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-deactivate-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie, "deactivate-me@example.test", "Deactivate Me");
    assert.equal((await api(app, "/api/state", { cookie: officialCookie })).status, 200);

    const missingReason = await api(app, "/api/users/deactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "deactivate-me@example.test", reason: "   " },
    });
    assert.equal(missingReason.status, 400);
    const selfDeactivate = await api(app, "/api/users/deactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: ADMIN_EMAIL, reason: "Trying to lock myself out." },
    });
    assert.equal(selfDeactivate.status, 400);
    const unknown = await api(app, "/api/users/deactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "nobody@example.test", reason: "No such account." },
    });
    assert.equal(unknown.status, 404);

    const deactivate = await api(app, "/api/users/deactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "deactivate-me@example.test", reason: "No longer serving the barangay." },
    });
    assert.equal(deactivate.status, 200, await deactivate.text());

    // The revocation is not a separate step that can fail on its own: the
    // account's session is gone the moment the status change commits.
    const revoked = await api(app, "/api/state", { cookie: officialCookie });
    assert.equal(revoked.status, 401);

    const log = await api(app, "/api/community/activity", { cookie: admin.cookie }).then((r) => r.json());
    assert.ok(
      log.activities.some((item) => item.action === "Deactivated user account" && item.detail.includes("deactivate-me@example.test")),
      "the deactivation is recorded in the Activity Log",
    );

    const reactivate = await api(app, "/api/users/reactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "deactivate-me@example.test" },
    });
    assert.equal(reactivate.status, 200, await reactivate.text());
    const again = await api(app, "/api/users/reactivate", {
      method: "POST",
      cookie: admin.cookie,
      body: { email: "deactivate-me@example.test" },
    });
    assert.equal(again.status, 404, "an active account cannot be reactivated");

    const signedIn = await signIn(app, "deactivate-me@example.test", "A-unique-official-password!");
    assert.equal(signedIn.response.status, 200);
    assert.equal(
      (await api(app, "/api/state", { cookie: signedIn.cookie })).status,
      200,
      "the reactivated account can sign in and use the workspace again",
    );
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("working-hours boundary values are validated", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hours-boundaries-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const base = {
      name: "Boundary Official",
      area: "Palsara",
      phone: "",
      role: "official",
      status: "Active",
      availableDays: ["Monday"],
      password: "A-unique-official-password!",
    };

    const hour13 = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { ...base, email: "hour13@example.test", workingHours: "Monday, 13:00 PM-5:00 PM" },
    });
    assert.equal(hour13.status, 400);

    const minute60 = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { ...base, email: "minute60@example.test", workingHours: "Monday, 8:60 AM-5:00 PM" },
    });
    assert.equal(minute60.status, 400);

    const equal = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { ...base, email: "equal@example.test", workingHours: "Monday, 8:00 AM-8:00 AM" },
    });
    assert.equal(equal.status, 400);

    const midnightNoon = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { ...base, email: "midnightnoon@example.test", workingHours: "Monday, 12:00 AM-12:00 PM" },
    });
    assert.equal(midnightNoon.status, 201);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a second profile photo replaces the first instead of deleting it", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-profile-photo-"));
  const app = await startServer(dataDir);
  try {
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Profile Tester",
        email: "profile-tester@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie")?.split(";")[0] || "";

    const first = await uploadPhoto(app, "/api/profile-photo", cookie, TEST_JPEG);
    assert.equal(first.status, 201);
    const second = await uploadPhoto(app, "/api/profile-photo", cookie, TEST_JPEG);
    assert.equal(second.status, 201, "Changing a profile photo must work");
    const photoUrl = (await second.json()).photoUrl;
    const filename = decodeURIComponent(new URL(photoUrl, app.origin).pathname.split("/").pop());

    const image = await fetch(`${app.origin}${photoUrl}`, { headers: { Cookie: cookie } });
    assert.equal(image.status, 200, "The replaced photo must still be served");
    const files = await readdir(path.join(path.dirname(dataDir), "uploads", "profiles"));
    assert.ok(files.includes(filename), "the stored filename must be present under uploads/profiles");
    assert.match(filename, /^[A-Za-z0-9._-]+\.jpg$/, "the stored filename must be an immutable id-dot-uuid name");
    assert.equal(
      files.some((file) => file.endsWith(".tmp")),
      false,
      "The temporary file must be renamed",
    );
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("officials and administrators can view a resident's profile photo; staff-to-staff stays administrator-only", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-photo-access-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const subject = await registerResident(app, "photo-subject@example.test", "Photo Subject");
    const uploaded = await uploadPhoto(app, "/api/profile-photo", subject.cookie, TEST_JPEG);
    assert.equal(uploaded.status, 201);
    const { photoUrl } = await uploaded.json();
    assert.ok(photoUrl, "an uploaded photo must come back with a URL");

    const otherResident = await registerResident(app, "photo-other@example.test", "Other Resident");
    const residentAttempt = await fetch(`${app.origin}${photoUrl}`, {
      headers: { Origin: app.origin, Cookie: otherResident.cookie },
    });
    assert.equal(residentAttempt.status, 403, "a resident must not view another account's photo");

    const adminAttempt = await fetch(`${app.origin}${photoUrl}`, {
      headers: { Origin: app.origin, Cookie: admin.cookie },
    });
    assert.equal(adminAttempt.status, 200, "an administrator can view the resident photo");
    assert.match(adminAttempt.headers.get("content-type"), /image\//);
    const adminBytes = new Uint8Array(await adminAttempt.arrayBuffer());
    assert.ok(adminBytes.length > 2 && adminBytes[0] === 0xff && adminBytes[1] === 0xd8, "serves the JPEG bytes");

    const officialCookie = await createOfficial(app, admin.cookie, "photo-viewer@example.test", "Photo Viewer");
    const officialAttempt = await fetch(`${app.origin}${photoUrl}`, {
      headers: { Origin: app.origin, Cookie: officialCookie },
    });
    assert.equal(officialAttempt.status, 200, "an official can view the resident photo");

    // Staff-to-staff photos remain administrator-only.
    const secondOfficial = await createOfficial(app, admin.cookie, "photo-viewer-two@example.test", "Photo Viewer Two");
    const ownUpload = await uploadPhoto(app, "/api/profile-photo", officialCookie, TEST_JPEG);
    assert.equal(ownUpload.status, 201);
    const officialPhotoUrl = (await ownUpload.json()).photoUrl;
    const staffAttempt = await fetch(`${app.origin}${officialPhotoUrl}`, {
      headers: { Origin: app.origin, Cookie: secondOfficial },
    });
    assert.equal(staffAttempt.status, 403, "an official must not view another staff member's photo");

    // Officials receive the resident's minimal account card, not the full list.
    const state = await api(app, "/api/state", { cookie: officialCookie }).then((response) => response.json());
    const listed = (state.data?.users || []).find((item) => item.email === "photo-subject@example.test");
    assert.ok(listed, "the official sees the resident's account card");
    assert.equal(listed.photoUrl, photoUrl, "the official state carries the resident's photo URL");
    assert.equal(listed.phone, undefined, "the official state must not expose phone numbers");
    assert.equal(listed.recoveryEmail, undefined, "the official state must not expose recovery emails");
    assert.equal(listed.availableDays, undefined, "the official state must not expose availability");
    const staffListed = (state.data?.users || []).find((item) => item.role === "official");
    assert.equal(staffListed, undefined, "the official state must not list staff accounts");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
