// Integration coverage for the atomic profile save. The profile update and the
// photo upload used to be two separate requests, so a failure in the second
// could leave a partially completed profile. The endpoint now accepts the
// fields and the photo in one multipart request, or as plain JSON without a
// photo, and either everything is applied or nothing is.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, registerResident, TEST_JPEG } from "./helpers.mjs";

function putForm(app, endpoint, cookie, form) {
  return fetch(`${app.origin}${endpoint}`, {
    method: "PUT",
    headers: { Origin: app.origin, Cookie: cookie },
    body: form,
  });
}

function profileForm({ name, area, phone, recoveryEmail, filename = "atomic.jpg", type = "image/jpeg", bytes = TEST_JPEG }) {
  const form = new FormData();
  form.append("name", name);
  form.append("area", area);
  form.append("phone", phone);
  form.append("recoveryEmail", recoveryEmail);
  form.append("photos", new Blob([bytes], { type }), filename);
  return form;
}

test("a profile save with a photo applies the fields and the photo together", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-profile-atomic-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const app = await startServer(dataDir, {}, { uploadsDir });
  try {
    const resident = await registerResident(app, "atomic@example.test", "Atomic Resident");
    const saved = await putForm(
      app,
      "/api/profile",
      resident.cookie,
      profileForm({
        name: "Atomic Resident Updated",
        area: "Purok 2",
        phone: "09172345678",
        recoveryEmail: "atomic-recovery@example.test",
      }),
    );
    const savedText = await saved.text();
    assert.equal(saved.status, 200, savedText);
    const result = JSON.parse(savedText);
    assert.equal(result.user.name, "Atomic Resident Updated");
    assert.equal(result.user.phone, "09172345678");
    assert.equal(result.user.recoveryEmail, "atomic-recovery@example.test");
    assert.match(result.user.photoUrl, /^\/api\/profile-photo\//);

    const files = await readdir(path.join(uploadsDir, "profiles"));
    assert.equal(files.length, 1, "exactly one photo must be stored");
    assert.ok(files[0].endsWith(".jpg"));

    const row = await app.db.query('SELECT name, photo_url AS "photoUrl" FROM users WHERE email=$1', ["atomic@example.test"]);
    assert.equal(row.rows[0].name, "Atomic Resident Updated");
    assert.equal(row.rows[0].photoUrl, result.user.photoUrl);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a combined save with an invalid field is refused atomically", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-profile-rollback-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const app = await startServer(dataDir, {}, { uploadsDir });
  try {
    const resident = await registerResident(app, "rollback@example.test", "Rollback Resident");
    // The recovery address is not valid: the save must be refused and the
    // photo must not land anywhere.
    const refused = await putForm(
      app,
      "/api/profile",
      resident.cookie,
      profileForm({ name: "Rollback Resident", area: "Purok 2", phone: "", recoveryEmail: "not-an-email" }),
    );
    assert.equal(refused.status, 400, await refused.text());

    // The name is too short: same outcome.
    const refusedName = await putForm(
      app,
      "/api/profile",
      resident.cookie,
      profileForm({ name: "x", area: "Purok 2", phone: "", recoveryEmail: "" }),
    );
    assert.equal(refusedName.status, 400, await refusedName.text());

    // A file that is not an image: refused too.
    const refusedFile = await putForm(
      app,
      "/api/profile",
      resident.cookie,
      profileForm({
        name: "Rollback Resident",
        area: "Purok 2",
        phone: "",
        recoveryEmail: "",
        filename: "notes.jpg",
        bytes: Buffer.from("<html>not an image</html>"),
      }),
    );
    assert.equal(refusedFile.status, 400, await refusedFile.text());

    const row = await app.db.query('SELECT name, phone, photo_url AS "photoUrl" FROM users WHERE email=$1', ["rollback@example.test"]);
    assert.equal(row.rows[0].name, "Rollback Resident");
    assert.equal(row.rows[0].phone, "");
    assert.ok(!row.rows[0].photoUrl, "no photo may be recorded for a refused save");
    const profileFiles = await readdir(path.join(uploadsDir, "profiles")).catch(() => []);
    assert.deepEqual(profileFiles, [], "no photo file may be written for a refused save");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
