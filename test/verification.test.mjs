// Face and ID verification. The browser owns the ML; the server owns the
// math, the review queue, and the official duty gate. These tests cover the
// pure matcher and the full enroll -> verify -> gate cycle, plus the ID
// consent/duplicate/review/erasure round trip.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn, registerResident, createOfficial, TEST_JPEG } from "./helpers.mjs";
import { parseEmbedding, cosineDistance, nearestDistance } from "../server/platform/face-match.mjs";
import { idMatchCheck, defaultVerificationSettings, suggestIdFields } from "../server/domains/verification.mjs";
import { sweepExpiredIdImages } from "../server/index.mjs";

const unitA = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0));
const unitB = Array.from({ length: 128 }, (_, i) => (i === 1 ? 1 : 0));
const closeToA = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : i === 1 ? 0.25 : 0)); // distance ≈ 0.03
const farFromA = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : i === 1 ? 0.4 : 0)); // distance ≈ 0.07

function idForm({
  idType = "philsys",
  idNumber = "1234-5678-9012",
  idFullName = "Resident Example",
  idBirthDate = "1990-05-15",
  consent = "1",
  front = true,
  back = false,
} = {}) {
  const form = new FormData();
  form.append("idType", idType);
  form.append("idNumber", idNumber);
  form.append("idFullName", idFullName);
  form.append("idBirthDate", idBirthDate);
  form.append("consent", consent);
  if (front) form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "front.jpg");
  if (back) form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "back.jpg");
  return form;
}

async function postId(app, cookie, form) {
  return fetch(`${app.origin}/api/verification/id`, {
    method: "POST",
    headers: { Origin: app.origin, Cookie: cookie },
    body: form,
  });
}

test("Face++ is on by default when the client is configured", () => {
  assert.equal(defaultVerificationSettings(true).faceppEnabled, true);
  assert.equal(defaultVerificationSettings(false).faceppEnabled, false);
  assert.equal(defaultVerificationSettings(true).faceVerificationEnabled, true);
  assert.equal(defaultVerificationSettings(false).faceVerificationEnabled, false);
  assert.equal(defaultVerificationSettings(true).requireFaceOnLogin, true);
  assert.equal(defaultVerificationSettings(false).requireFaceOnLogin, false);
});

test("OCR only recognises the four supported ID types", () => {
  assert.equal(suggestIdFields("SSS ID\nSOCIAL SECURITY SYSTEM").idType, "");
  assert.equal(suggestIdFields("PHILHEALTH MEMBER ID").idType, "");
  assert.equal(suggestIdFields("UMID CRN\nSSS GSIS").idType, "umid");
  assert.equal(suggestIdFields("PHILSYS ID").idType, "philsys");
  assert.equal(suggestIdFields("DRIVER'S LICENSE").idType, "driver");
  assert.equal(suggestIdFields("PASSPORT").idType, "passport");
});

test("OCR reads a bilingual PhilSys card without treating its header as the name", () => {
  const result = suggestIdFields(
    [
      "REPUBLIKA NG PILIPINAS",
      "Republic of the Philippines",
      "PAMBANSANG PAGKAKAKILANLAN",
      "Philippine Identification Card",
      "3872-4062-9356-0465",
      "Apelyido/Last Name",
      "RODRIGUEZ",
      "Mga Pangalan/Given Names",
      "PRINCE DEANO",
      "Gitnang Apelyido/Middle Name",
      "AGUILA",
      "Petsa ng Kapanganakan/Date of Birth",
      "OCTOBER 29, 2005",
      "Tirahan/Address",
      "BLK 27 LOT 5 TABIGI ST. AMAIA SCAPES, DAGATAN, CITY",
      "OF LIPA, BATANGAS",
      "PHL",
    ].join("\n"),
  );
  assert.equal(result.idType, "philsys");
  assert.equal(result.idNumber, "3872-4062-9356-0465");
  assert.equal(result.idFullName, "PRINCE DEANO AGUILA RODRIGUEZ");
  assert.equal(result.idBirthDate, "2005-10-29");
  assert.match(result.idAddress, /TABIGI ST/);
  assert.equal(idMatchCheck({ ocr: result, accountName: "Prince Deano Aguila Rodriguez", entered: {} }).ok, true);
});

test("OCR extracts address and expiration date from ID text", () => {
  const result = suggestIdFields(
    "PHILSYS ID\nJUAN DELA CRUZ\nADDRESS: 12 MAIN STREET, PALSARA\nBIRTH DATE: 01/02/1990\nVALID UNTIL: 01/02/2030\nID NUMBER: 1234-5678-9012",
  );
  assert.equal(result.idAddress, "12 MAIN STREET, PALSARA");
  assert.equal(result.idExpirationDate, "2030-02-01");
  assert.equal(result.idBirthDate, "1990-02-01");
});

test("official sign-in is gated until face enrollment completes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-login-gate-"));
  const faceppClient = {
    configured: true,
    detectFace: async () => "token-1",
    compareFaces: async () => 95,
  };
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), faceppClient });
  const email = "gate-official@example.test";
  const password = "A-unique-official-password!";
  try {
    const admin = await signIn(app);
    const created = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { name: "Gate Official", email, area: "Palsara", phone: "", role: "official", status: "Active", availableDays: ["Monday"], password },
    });
    assert.equal(created.status, 201, await created.text());
    // An old-style settings row with the write-duty toggle off must still
    // protect sign-in through the dedicated login-gate setting.
    const saved = await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: verificationBody({ requireFaceOnLogin: true, faceppEnabled: true }),
    });
    assert.equal(saved.status, 200, await saved.text());

    const login = await signIn(app, email, password);
    assert.equal(login.result.faceCheckRequired, true);
    const cookie = login.cookie;
    const blocked = await api(app, "/api/state", { cookie });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, "FACE_VERIFICATION_REQUIRED");
    assert.equal((await api(app, "/api/verification/status", { cookie })).status, 200);

    const enroll = await api(app, "/api/verification/face/enroll", {
      method: "POST",
      cookie,
      body: { liveness: true, image: FACE_IMAGE },
    });
    assert.equal(enroll.status, 201, await enroll.text());
    assert.equal((await api(app, "/api/state", { cookie })).status, 200, "the session is released after enrollment");

    const nextLogin = await signIn(app, email, password);
    assert.equal(nextLogin.result.faceCheckRequired, false, "an active duty window skips the gate");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a new official must enroll before logout locks the account until admin enrollment", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-enrollment-lock-"));
  const faceppClient = {
    configured: true,
    detectFace: async () => "token-1",
    compareFaces: async () => 95,
  };
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), faceppClient });
  const email = "new-official@example.test";
  const password = "A-unique-official-password!";
  try {
    const admin = await signIn(app);
    const created = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { name: "New Official", email, area: "Palsara", phone: "", role: "official", status: "Active", availableDays: ["Monday"], password },
    });
    assert.equal(created.status, 201, await created.text());
    const initial = await app.db.query("SELECT face_enrollment_state FROM users WHERE email=$1", [email]);
    assert.equal(initial.rows[0].face_enrollment_state, "pending");

    const firstLogin = await signIn(app, email, password);
    assert.equal(firstLogin.result.faceCheckRequired, true);
    const signOut = await api(app, "/api/auth/logout", { method: "POST", cookie: firstLogin.cookie });
    assert.equal(signOut.status, 200);
    const locked = await app.db.query("SELECT face_enrollment_state FROM users WHERE email=$1", [email]);
    assert.equal(locked.rows[0].face_enrollment_state, "locked");

    const blocked = await signIn(app, email, password);
    assert.equal(blocked.response.status, 403);
    assert.match(blocked.result.error || "", /administrator/i);

    const target = await app.db.query("SELECT id FROM users WHERE email=$1", [email]);
    const enrolled = await api(app, "/api/users/face-enroll", {
      method: "POST",
      cookie: admin.cookie,
      body: { userId: target.rows[0].id, image: FACE_IMAGE, embedding: unitA },
    });
    assert.equal(enrolled.status, 200, await enrolled.text());
    const after = await app.db.query("SELECT face_enrollment_state FROM users WHERE email=$1", [email]);
    assert.equal(after.rows[0].face_enrollment_state, "enrolled");
    const liveness = await app.db.query("SELECT face_liveness_verified FROM users WHERE email=$1", [email]);
    assert.equal(liveness.rows[0].face_liveness_verified, false, "admin enrollment never records liveness as verified");

    const finalLogin = await signIn(app, email, password);
    assert.equal(finalLogin.result.faceCheckRequired, false, "a freshly enrolled official opens the workspace");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("admin enrollment releases an official session that was already pending", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-admin-enroll-session-"));
  const faceppClient = {
    configured: true,
    detectFace: async () => "token-1",
    compareFaces: async () => 95,
  };
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), faceppClient });
  const email = "pending-session-official@example.test";
  const password = "A-unique-official-password!";
  try {
    const admin = await signIn(app);
    const created = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: { name: "Pending Official", email, area: "Palsara", phone: "", role: "official", status: "Active", availableDays: ["Monday"], password },
    });
    assert.equal(created.status, 201, await created.text());
    const firstLogin = await signIn(app, email, password);
    assert.equal(firstLogin.result.faceCheckRequired, true);
    assert.equal((await api(app, "/api/state", { cookie: firstLogin.cookie })).status, 403);

    const target = await app.db.query("SELECT id FROM users WHERE email=$1", [email]);
    const enrolled = await api(app, "/api/users/face-enroll", {
      method: "POST",
      cookie: admin.cookie,
      body: { userId: target.rows[0].id, image: FACE_IMAGE, embedding: unitA },
    });
    assert.equal(enrolled.status, 200, await enrolled.text());
    assert.equal((await api(app, "/api/state", { cookie: firstLogin.cookie })).status, 200, "the existing session is released too");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("face-match: embeddings are bounded and distances behave", () => {
  assert.equal(parseEmbedding(unitA)?.length, 128);
  assert.equal(parseEmbedding([1, 2, 3]), null, "short vector rejected");
  assert.equal(parseEmbedding(Array(128).fill(0)), null, "zero norm rejected");
  assert.equal(parseEmbedding(Array.from({ length: 128 }, () => "nope")), null);
  assert.equal(cosineDistance(unitA, unitA), 0);
  assert.ok(Math.abs(cosineDistance(unitA, unitB) - 1) < 1e-9);
  assert.ok(nearestDistance(unitA, [{ embedding: closeToA }]) < 0.04);
  assert.ok(nearestDistance(unitA, [{ embedding: unitB }]) > 0.9);
  assert.equal(nearestDistance(unitA, []), null);
});

const FACE_IMAGE = `data:image/jpeg;base64,${TEST_JPEG.toString("base64")}`;

function verificationBody(overrides = {}) {
  return {
    faceVerificationEnabled: false,
    requireFaceOnLogin: false,
    dutyHours: 9,
    matchThreshold: 0.033,
    faceppEnabled: false,
    faceppThreshold: 80,
    ocrEnabled: false,
    ...overrides,
  };
}

test("third-party verification stays off until configured keys are present", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-optin-"));
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads") });
  try {
    const admin = await signIn(app);
    const resident = await registerResident(app, "optin-resident@example.test", "Opt In Resident");
    const settings = await api(app, "/api/settings/verification", { cookie: admin.cookie }).then((r) => r.json());
    assert.equal(settings.settings.faceppEnabled, false);
    assert.equal(settings.settings.ocrEnabled, false);

    const form = new FormData();
    form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "id.jpg");
    const blocked = await fetch(`${app.origin}/api/verification/id/ocr`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: resident.cookie },
      body: form,
    });
    assert.equal(blocked.status, 403);

    const enabled = await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: verificationBody({ faceppEnabled: true, ocrEnabled: true }),
    });
    assert.equal(enabled.status, 400, await enabled.text());
    const unchanged = await api(app, "/api/settings/verification", { cookie: admin.cookie }).then((r) => r.json());
    assert.equal(unchanged.settings.faceppEnabled, false);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("manual ID entry completes submission when OCR is not configured", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-manual-id-"));
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads") });
  try {
    const resident = await registerResident(app, "manual-id@example.test", "Manual Resident");
    const details = {
      idType: "philsys",
      idNumber: "1234-5678-9012",
      idFullName: "Manual Resident",
      idBirthDate: "1990-05-15",
    };
    const recorded = await api(app, "/api/verification/id/manual", { method: "POST", cookie: resident.cookie, body: details });
    assert.equal(recorded.status, 200, await recorded.text());
    const submitted = await postId(app, resident.cookie, idForm(details));
    assert.equal(submitted.status, 201, await submitted.text());
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("OCR prefill returns suggestions from the configured OCR client", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-ocr-"));
  const ocrClient = {
    configured: true,
    readIdText: async () => "PHILSYS\nJUAN DELA CRUZ\n1234-5678-9012\n1990-05-15",
  };
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), ocrClient });
  try {
    const admin = await signIn(app);
    const resident = await registerResident(app, "ocr-resident@example.test", "OCR Resident");
    const defaults = await api(app, "/api/settings/verification", { cookie: admin.cookie }).then((r) => r.json());
    assert.equal(defaults.settings.ocrEnabled, true);
    const saved = await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: verificationBody({ ocrEnabled: true }),
    });
    assert.equal(saved.status, 200, await saved.text());

    // Manual entry is refused while scanning is available, and the status
    // endpoint tells the browser to hide the manual button.
    const manualBlocked = await api(app, "/api/verification/id/manual", {
      method: "POST",
      cookie: resident.cookie,
      body: { idType: "philsys", idNumber: "1234-5678-9012", idFullName: "OCR Resident", idBirthDate: "1990-05-15" },
    });
    assert.equal(manualBlocked.status, 403, "manual entry is refused while OCR is enabled");
    const status = await api(app, "/api/verification/status", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(status.ocrEnabled, true);

    // Scanning is allowed before consent; consent is only required at submit.
    const form = new FormData();
    form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "id.jpg");
    const response = await fetch(`${app.origin}/api/verification/id/ocr`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: resident.cookie },
      body: form,
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const payload = JSON.parse(body);
    assert.equal(payload.suggestions.idType, "philsys");
    assert.equal(payload.suggestions.idNumber, "1234-5678-9012");
    assert.equal(payload.suggestions.idFullName, "JUAN DELA CRUZ");
    assert.equal(payload.suggestions.idBirthDate, "1990-05-15");
    assert.ok(payload.match, "OCR response includes the validation result");
    assert.equal(payload.checks.readable, true);
    assert.deepEqual(payload.checks.errors, []);
    assert.equal(payload.checks.duplicate, false);
    assert.ok(payload.checks.warnings.some((warning) => /does not match the account name/.test(warning)));
    const nameSignal = payload.signals.find((signal) => signal.id === "read_idFullName");
    assert.ok(nameSignal);
    assert.equal(nameSignal.detail, "Read from the ID.");
    assert.ok(!payload.signals.some((signal) => /JUAN DELA CRUZ|1234-5678-9012/.test(signal.detail)), "signals must not embed raw ID values");
    const stored = await app.db.query("SELECT id_scan_checks FROM users WHERE email=$1", ["ocr-resident@example.test"]);
    const snapshot = stored.rows[0]?.id_scan_checks;
    const parsed = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
    assert.equal(parsed.fields, undefined, "raw OCR fields must not be persisted");
    assert.deepEqual(parsed.fieldsFound, ["idType", "idNumber", "idFullName", "idBirthDate"]);
    assert.equal(parsed.signals.length, payload.signals.length);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Face++ duty check enrolls and verifies by confidence, and fails below the threshold", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-facepp-"));
  let confidence = 95;
  const faceppClient = {
    configured: true,
    detectFace: async () => "token-1",
    compareFaces: async () => confidence,
  };
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), faceppClient });
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie, "facepp-official@example.test", "Face Official");
    const initial = await api(app, "/api/settings/verification", { cookie: admin.cookie }).then((response) => response.json());
    assert.equal(initial.settings.faceppEnabled, true, "a configured Face++ client is enabled by default");
    const saved = await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: verificationBody({ faceVerificationEnabled: true, faceppEnabled: true }),
    });
    assert.equal(saved.status, 200, await saved.text());

    const enroll = await api(app, "/api/verification/face/enroll", {
      method: "POST",
      cookie: officialCookie,
      body: { liveness: true, image: FACE_IMAGE },
    });
    assert.equal(enroll.status, 201, await enroll.text());
    const status = await api(app, "/api/verification/status", { cookie: officialCookie }).then((r) => r.json());
    assert.equal(status.faceEnrolled, true);
    assert.equal(status.faceppEnabled, true);
    const session = await api(app, "/api/session", { cookie: officialCookie }).then((response) => response.json());
    assert.equal(session.user.faceEnrolled, true, "Face++ enrollment is reflected in the session user");

    const verify = await api(app, "/api/verification/face/verify", {
      method: "POST",
      cookie: officialCookie,
      body: { image: FACE_IMAGE },
    });
    assert.equal(verify.status, 200, await verify.text());

    confidence = 10;
    const failed = await api(app, "/api/verification/face/verify", {
      method: "POST",
      cookie: officialCookie,
      body: { image: FACE_IMAGE },
    });
    assert.equal(failed.status, 401, await failed.text());
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("idMatchCheck tolerates a missing name part but rejects conflicting details", () => {
  const accountName = "Hillary Ira Abrogina";
  const ocr = { idType: "passport", idNumber: "123456789", idBirthDate: "1990-05-15", idFullName: "Hillary Abrogina" };
  const perfect = idMatchCheck({ ocr, accountName, entered: { idFullName: accountName, idNumber: "123456789" } });
  assert.equal(perfect.ok, true);

  const missingMiddle = idMatchCheck({ ocr: { ...ocr, idFullName: "Hillary Abrogina" }, accountName, entered: {} });
  assert.equal(missingMiddle.ok, true);

  const wrongName = idMatchCheck({ ocr: { ...ocr, idFullName: "Juan Dela Cruz" }, accountName, entered: {} });
  assert.equal(wrongName.ok, false);
  assert.equal(wrongName.rows.find((row) => row.field === "idFullName").ok, false);

  const wrongNumber = idMatchCheck({ ocr, accountName, entered: { idNumber: "999" } });
  assert.equal(wrongNumber.ok, false);
  assert.equal(wrongNumber.rows.find((row) => row.field === "idNumber").ok, false);

  const wrongDate = idMatchCheck({ ocr, accountName, entered: { idBirthDate: "2000-01-01" } });
  assert.equal(wrongDate.ok, false);
});

test("integrated face check records a passing match and reports a mismatch", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-id-face-"));
  let confidence = 95;
  const faceppClient = {
    configured: true,
    detectFace: async () => "token",
    compareFaces: async () => 90,
    compareImages: async () => confidence,
  };
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), faceppClient });
  try {
    const admin = await signIn(app);
    await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: verificationBody({ faceppEnabled: true }),
    });
    const email = "face-official@example.test";
    const password = "A-unique-official-password!";
    const created = await api(app, "/api/users", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        name: "Face Official",
        email,
        area: "Palsara",
        phone: "",
        role: "official",
        status: "Active",
        availableDays: ["Monday"],
        password,
      },
    });
    assert.equal(created.status, 201, await created.text());
    const official = await signIn(app, email, password);
    const postFace = async () => {
      const form = new FormData();
      form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "id.jpg");
      form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "face.jpg");
      return fetch(`${app.origin}/api/verification/id/face-check`, {
        method: "POST",
        headers: { Origin: app.origin, Cookie: official.cookie },
        body: form,
      });
    };

    const passed = await postFace();
    const passedRaw = await passed.text();
    assert.equal(passed.status, 200, passedRaw);
    const passedBody = JSON.parse(passedRaw);
    assert.equal(passedBody.status, "matched");
    assert.equal(passedBody.matched, true);
    assert.equal(passedBody.basis, "face");

    confidence = 10;
    const failed = await postFace();
    const failedRaw = await failed.text();
    assert.equal(failed.status, 200, failedRaw);
    assert.equal(JSON.parse(failedRaw).status, "mismatch");

    // A passing match also enrolls the same face for the staff duty check.
    const status = await api(app, "/api/verification/status", { cookie: official.cookie });
    assert.equal((await status.json()).faceEnrolled, true);

    // Residents never reach the integrated face route.
    const resident = await registerResident(app, "face-resident@example.test", "Face Resident");
    const blocked = await postFaceAs(resident.cookie);
    assert.equal(blocked.status, 403, await blocked.text());
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  async function postFaceAs(cookie) {
    const form = new FormData();
    form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "id.jpg");
    form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "face.jpg");
    return fetch(`${app.origin}/api/verification/id/face-check`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: cookie },
      body: form,
    });
  }
});

test("integrated face check refuses a second face once the official already has a token", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-id-face-reenroll-"));
  let selfieToken = "token-a";
  const faceppClient = {
    configured: true,
    // The selfie always matches the ID photo; only the token differs.
    detectFace: async () => selfieToken,
    compareImages: async () => 95,
    compareFaces: async (a, b) => (a === b ? 95 : 10),
  };
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), faceppClient });
  const email = "reenroll-face-official@example.test";
  try {
    const admin = await signIn(app);
    await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: verificationBody({ faceppEnabled: true }),
    });
    const cookie = await createOfficial(app, admin.cookie, email, "Re Enroll Official");
    const postFace = async () => {
      const form = new FormData();
      form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "id.jpg");
      form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "face.jpg");
      return fetch(`${app.origin}/api/verification/id/face-check`, {
        method: "POST",
        headers: { Origin: app.origin, Cookie: cookie },
        body: form,
      });
    };

    // First pass: no existing tokens, so current initial-enrollment behavior stands.
    const first = await postFace();
    const firstRaw = await first.text();
    assert.equal(first.status, 200, firstRaw);
    assert.equal(JSON.parse(firstRaw).status, "matched");
    const before = await app.db.query("SELECT id, facepp_tokens FROM users WHERE email=$1", [email]);
    assert.deepEqual(before.rows[0].facepp_tokens, ["token-a"]);

    // A different selfie still matches the ID photo but must not replace the
    // enrolled duty reference, set a matched status, or clear the gate.
    selfieToken = "token-b";
    // The prior pass left id_face_status='matched'; the failed re-enrollment must clear it itself.
    const beforeSecond = await app.db.query("SELECT id_face_status FROM users WHERE email=$1", [email]);
    assert.equal(beforeSecond.rows[0].id_face_status, "matched");
    const second = await postFace();
    const secondRaw = await second.text();
    assert.equal(second.status, 401, secondRaw);
    assert.match(JSON.parse(secondRaw).error, /does not match your enrolled face/);
    const after = await app.db.query("SELECT facepp_tokens, id_face_status, id_face_checked_at FROM users WHERE email=$1", [email]);
    assert.deepEqual(after.rows[0].facepp_tokens, before.rows[0].facepp_tokens);
    assert.equal(after.rows[0].id_face_status, "mismatch");
    assert.equal(after.rows[0].id_face_checked_at, null);
    const events = await app.db.query(
      "SELECT 1 FROM activities WHERE action='Integrated face enrollment mismatch' AND result='Failed' AND affected_id=$1",
      [before.rows[0].id],
    );
    assert.equal(events.rows.length, 1, "the failed re-enrollment is recorded as a security event");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("an impossible ID birth date is refused before it reaches the database", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-id-date-"));
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads") });
  try {
    const resident = await registerResident(app, "date-resident@example.test", "Date Resident");
    const impossible = await postId(app, resident.cookie, idForm({ idBirthDate: "2000-02-31" }));
    assert.equal(impossible.status, 400);
    assert.match((await impossible.json()).error, /valid birth date/);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a client that sends Content-Type can still delete its own ID", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-id-delete-header-"));
  const ocrClient = { configured: true, readIdText: async () => "PHILSYS\nJUAN DELA CRUZ\n1234-5678-9012\n1990-05-15" };
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), ocrClient });
  try {
    const resident = await registerResident(app, "header-resident@example.test", "Header Resident");
    const scanForm = new FormData();
    scanForm.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "front.jpg");
    const scanned = await fetch(`${app.origin}/api/verification/id/ocr`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: resident.cookie },
      body: scanForm,
    });
    assert.equal(scanned.status, 200, await scanned.text());
    assert.equal((await postId(app, resident.cookie, idForm())).status, 201);
    const removed = await fetch(`${app.origin}/api/verification/id`, {
      method: "DELETE",
      headers: { Origin: app.origin, Cookie: resident.cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(removed.status, 200, await removed.text());
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("official ID submission is gated on both a readable scan and a passing face match", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-integrated-gate-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const ocrClient = { configured: true, readIdText: async () => "PHILSYS\nJUAN DELA CRUZ\n1234-5678-9012\n1990-05-15" };
  const faceppClient = {
    configured: true,
    detectFace: async () => "token",
    compareFaces: async () => 90,
    compareImages: async () => 95,
  };
  const app = await startServer(dataDir, {}, { uploadsDir, ocrClient, faceppClient });
  try {
    const admin = await signIn(app);
    await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: verificationBody({ faceppEnabled: true, ocrEnabled: true }),
    });
    const cookie = await createOfficial(app, admin.cookie, "gate-id-official@example.test", "Gated Official");

    const beforeScan = await postId(app, cookie, idForm());
    assert.equal(beforeScan.status, 400, await beforeScan.text());

    const scanForm = new FormData();
    scanForm.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "front.jpg");
    const scanned = await fetch(`${app.origin}/api/verification/id/ocr`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: cookie },
      body: scanForm,
    });
    assert.equal(scanned.status, 200, await scanned.text());

    const beforeFace = await postId(app, cookie, idForm());
    assert.equal(beforeFace.status, 400, await beforeFace.text());

    const postFace = () => {
      const form = new FormData();
      form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "id.jpg");
      form.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "face.jpg");
      return fetch(`${app.origin}/api/verification/id/face-check`, {
        method: "POST",
        headers: { Origin: app.origin, Cookie: cookie },
        body: form,
      });
    };
    const matched = await postFace();
    const matchedRaw = await matched.text();
    assert.equal(matched.status, 200, matchedRaw);
    assert.equal(JSON.parse(matchedRaw).status, "matched");

    // Removing the face also clears the integrated match, closing the ID gate again.
    const gatedOfficial = await app.db.query("SELECT id FROM users WHERE email=$1", ["gate-id-official@example.test"]);
    const selfDelete = await api(app, "/api/verification/face", { method: "DELETE", cookie });
    assert.equal(selfDelete.status, 403, "an official cannot reset their own face while the duty gate is on");
    const removedFace = await api(app, "/api/verification/face", {
      method: "DELETE",
      cookie: admin.cookie,
      body: { userId: gatedOfficial.rows[0].id, reason: "Test reset of face reference" },
    });
    assert.equal(removedFace.status, 200, await removedFace.text());
    const afterDelete = await postId(app, cookie, idForm());
    const afterDeleteRaw = await afterDelete.text();
    assert.equal(afterDelete.status, 400, afterDeleteRaw);
    assert.match(JSON.parse(afterDeleteRaw).error, /Complete the face match before submitting/);

    const rematched = await postFace();
    assert.equal(JSON.parse(await rematched.text()).status, "matched");

    const submitted = await postId(app, cookie, idForm());
    const submittedRaw = await submitted.text();
    assert.equal(submitted.status, 201, submittedRaw);
    assert.equal(JSON.parse(submittedRaw).idStatus, "pending");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("official ID submit succeeds with Face++ disabled once the scan gate passes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-id-no-facepp-"));
  const ocrClient = { configured: true, readIdText: async () => "PHILSYS\nJUAN DELA CRUZ\n1234-5678-9012\n1990-05-15" };
  // No faceppClient at all: the integrated face route reports "unavailable".
  const app = await startServer(dataDir, {}, { uploadsDir: path.join(dataDir, "uploads"), ocrClient });
  try {
    const admin = await signIn(app);
    await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: verificationBody({ ocrEnabled: true, faceppEnabled: false }),
    });
    const cookie = await createOfficial(app, admin.cookie, "no-facepp-official@example.test", "No Face Official");

    const scanForm = new FormData();
    scanForm.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "front.jpg");
    const scanned = await fetch(`${app.origin}/api/verification/id/ocr`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: cookie },
      body: scanForm,
    });
    assert.equal(scanned.status, 200, await scanned.text());

    const faceForm = new FormData();
    faceForm.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "id.jpg");
    faceForm.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "face.jpg");
    const faceCheck = await fetch(`${app.origin}/api/verification/id/face-check`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: cookie },
      body: faceForm,
    });
    assert.equal(faceCheck.status, 200);
    assert.equal(JSON.parse(await faceCheck.text()).status, "unavailable");

    const submitted = await postId(app, cookie, idForm());
    const submittedRaw = await submitted.text();
    assert.equal(submitted.status, 201, submittedRaw);
    assert.equal(JSON.parse(submittedRaw).idStatus, "pending");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("ID verification round trip: consent, duplicate guard, review, badge, erasure", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-id-verify-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const ocrClient = { configured: true, readIdText: async () => "PHILSYS\nJUAN DELA CRUZ\n1234-5678-9012\n1990-05-15" };
  const app = await startServer(dataDir, {}, { uploadsDir, ocrClient });
  try {
    const admin = await signIn(app);
    const resident = await registerResident(app, "id-resident@example.test", "Resident Example");
    const residentTitles = async () =>
      (await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json())).data.notifications
        .filter((item) => item.targetEmail === resident.email)
        .map((item) => item.title);

    const scanForm = new FormData();
    scanForm.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "front.jpg");
    const scanned = await fetch(`${app.origin}/api/verification/id/ocr`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: resident.cookie },
      body: scanForm,
    });
    assert.equal(scanned.status, 200, await scanned.text());

    const noConsent = await postId(app, resident.cookie, idForm({ consent: "0" }));
    assert.equal(noConsent.status, 400);

    const badNumber = await postId(app, resident.cookie, idForm({ idNumber: "!!!" }));
    assert.equal(badNumber.status, 400);

    const submitted = await postId(app, resident.cookie, idForm({ front: true, back: true }));
    assert.equal(submitted.status, 201, await submitted.text());
    const session = await api(app, "/api/session", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(session.user.idStatus, "pending");
    assert.equal(session.user.hasIdImage, true);
    assert.equal(session.user.hasIdBackImage, true);
    assert.ok((await residentTitles()).includes("ID submitted for review"));

    // A second resident cannot claim the same ID number.
    const other = await registerResident(app, "other@example.test", "Other Resident");
    const duplicate = await postId(app, other.cookie, idForm({ idNumber: "1234-5678-9012" }));
    assert.equal(duplicate.status, 409);

    // The owner can open both stored images; "me" never exposes another account.
    const ownerFront = await fetch(`${app.origin}/api/verification/id/me/image`, {
      headers: { Cookie: resident.cookie, Origin: app.origin },
    });
    assert.equal(ownerFront.status, 200);
    const ownerBack = await fetch(`${app.origin}/api/verification/id/me/image-back`, {
      headers: { Cookie: resident.cookie, Origin: app.origin },
    });
    assert.equal(ownerBack.status, 200);
    const otherFront = await fetch(`${app.origin}/api/verification/id/me/image`, {
      headers: { Cookie: other.cookie, Origin: app.origin },
    });
    assert.equal(otherFront.status, 404);

    // Both can now coexist only if numbers differ textually; check the queue
    // shows the first pending submission and the images stay owner/admin only.
    const officialCookie = await createOfficial(app, admin.cookie, "id-review-official@example.test", "Review Official");
    const queueResponse = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    assert.equal(queueResponse.data.verificationQueue.length, 1);
    assert.equal(queueResponse.data.verificationQueue[0].idNumber, "1234-5678-9012");
    const queueChecks = queueResponse.data.verificationQueue[0].idScanChecks;
    assert.ok(queueChecks?.signals?.length);
    assert.equal(queueChecks.fields, undefined, "the review queue must not expose raw OCR fields");
    assert.ok(queueChecks.fieldsFound.includes("idNumber"));
    assert.ok(!queueChecks.signals.some((signal) => /1234-5678-9012/.test(signal.detail)));

    const adminImage = await fetch(`${app.origin}/api/verification/id/${queueResponse.data.verificationQueue[0].userId}/image`, {
      headers: { Cookie: admin.cookie, Origin: app.origin },
    });
    assert.equal(adminImage.status, 200);
    const officialImage = await fetch(`${app.origin}/api/verification/id/${queueResponse.data.verificationQueue[0].userId}/image`, {
      headers: { Cookie: officialCookie, Origin: app.origin },
    });
    assert.equal(officialImage.status, 403);

    // Reject needs a reason; approve sets the badge.
    const userId = queueResponse.data.verificationQueue[0].userId;
    const rejectNoNote = await api(app, "/api/verification/id/review", {
      method: "POST",
      cookie: admin.cookie,
      body: { userId, decision: "rejected" },
    });
    assert.equal(rejectNoNote.status, 400);
    const rejected = await api(app, "/api/verification/id/review", {
      method: "POST",
      cookie: admin.cookie,
      body: { userId, decision: "rejected", note: "The photo is too blurry to read." },
    });
    assert.equal(rejected.status, 200);
    const afterReject = await api(app, "/api/session", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(afterReject.user.idStatus, "rejected");
    assert.match(afterReject.user.idReviewNote, /blurry/);
    assert.ok((await residentTitles()).includes("ID verification needs attention"));

    // Resubmit from the same resident replaces the record.
    const resubmitted = await postId(app, resident.cookie, idForm({ idNumber: "9876-5432-1098" }));
    assert.equal(resubmitted.status, 201);
    const verified = await api(app, "/api/verification/id/review", {
      method: "POST",
      cookie: admin.cookie,
      body: { userId, decision: "verified" },
    });
    assert.equal(verified.status, 200);
    const afterVerify = await api(app, "/api/session", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(afterVerify.user.idStatus, "verified");
    assert.ok((await residentTitles()).includes("ID verification approved"));

    // Hard delete removes both images and the record.
    const filesBefore = await readdir(path.join(uploadsDir, "verification", userId));
    assert.ok(filesBefore.length >= 1);
    const erased = await api(app, "/api/verification/id", { method: "DELETE", cookie: resident.cookie });
    assert.equal(erased.status, 200);
    assert.equal((await readdir(path.join(uploadsDir, "verification", userId)).catch(() => [])).length, 0);
    const finalSession = await api(app, "/api/session", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(finalSession.user.idStatus, "unverified");
    const cleared = await app.db.query("SELECT id_scan_checks FROM users WHERE id=$1", [userId]);
    const clearedValue = cleared.rows[0]?.id_scan_checks;
    assert.deepEqual(typeof clearedValue === "string" ? JSON.parse(clearedValue) : clearedValue, {});
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("administrator ID removal notifies the account owner", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-id-removal-notice-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const ocrClient = { configured: true, readIdText: async () => "PHILSYS\nJUAN DELA CRUZ\n1234-5678-9012\n1990-05-15" };
  const app = await startServer(dataDir, {}, { uploadsDir, ocrClient });
  try {
    const admin = await signIn(app);
    const resident = await registerResident(app, "remove-notice@example.test", "Remove Notice");
    const scan = new FormData();
    scan.append("photos", new Blob([TEST_JPEG], { type: "image/jpeg" }), "front.jpg");
    assert.equal((await fetch(`${app.origin}/api/verification/id/ocr`, {
      method: "POST", headers: { Origin: app.origin, Cookie: resident.cookie }, body: scan,
    })).status, 200);
    assert.equal((await postId(app, resident.cookie, idForm())).status, 201);
    const row = await app.db.query("SELECT id FROM users WHERE email=$1", [resident.email]);
    const removed = await api(app, "/api/verification/id", {
      method: "DELETE", cookie: admin.cookie,
      body: { userId: row.rows[0].id, reason: "The submitted card was unreadable." },
    });
    assert.equal(removed.status, 200);
    const titles = (await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json())).data.notifications
      .filter((item) => item.targetEmail === resident.email)
      .map((item) => item.title);
    assert.ok(titles.includes("ID verification data removed"));
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("face duty check: enroll, verify, then the gate locks officials out of writes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-face-duty-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const app = await startServer(dataDir, {}, { uploadsDir });
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);

    // Enrollment validates and refuses mismatched re-enrollments without an ack.
    const badEnroll = await api(app, "/api/verification/face/enroll", {
      method: "POST",
      cookie: officialCookie,
      body: { embedding: [1, 2, 3] },
    });
    assert.equal(badEnroll.status, 400);
    const enrolled = await api(app, "/api/verification/face/enroll", {
      method: "POST",
      cookie: officialCookie,
      body: { embedding: unitA, liveness: true },
    });
    assert.equal(enrolled.status, 201, await enrolled.text());
    const enrolledStatus = await api(app, "/api/verification/status", { cookie: officialCookie }).then((r) => r.json());
    assert.equal(enrolledStatus.livenessVerified, false, "a client liveness flag is never recorded as fact");
    const mismatch = await api(app, "/api/verification/face/enroll", {
      method: "POST",
      cookie: officialCookie,
      body: { embedding: farFromA, liveness: true },
    });
    assert.equal(mismatch.status, 409);
    // A matching face still re-enrolls cleanly.
    const matching = await api(app, "/api/verification/face/enroll", {
      method: "POST",
      cookie: officialCookie,
      body: { embedding: closeToA, liveness: true },
    });
    assert.equal(matching.status, 201, await matching.text());

    // Verify works only with a reference that matches.
    const wrongFace = await api(app, "/api/verification/face/verify", {
      method: "POST",
      cookie: officialCookie,
      body: { embedding: unitB },
    });
    assert.equal(wrongFace.status, 401);
    const verified = await api(app, "/api/verification/face/verify", {
      method: "POST",
      cookie: officialCookie,
      body: { embedding: closeToA },
    });
    assert.equal(verified.status, 200, await verified.text());
    const status = await api(app, "/api/verification/status", { cookie: officialCookie }).then((r) => r.json());
    assert.equal(status.faceEnrolled, true);
    assert.equal(status.referenceCount, 1);

    // Turn the gate on: writes pass while the check is fresh.
    const settingsPut = await api(app, "/api/settings/verification", {
      method: "PUT",
      cookie: admin.cookie,
      body: { faceVerificationEnabled: true, dutyHours: 2, matchThreshold: 0.033 },
    });
    assert.equal(settingsPut.status, 200);
    const before = await api(app, "/api/state", { cookie: officialCookie }).then((r) => r.json());
    const allowedPut = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { data: before.data, revision: before.revision },
    });
    assert.notEqual(allowedPut.status, 403, "fresh verification must allow staff writes");

    // Remove the face data: the very next write is refused with the gate code.
    const dutyOfficial = await app.db.query("SELECT id FROM users WHERE email=$1", ["official@example.test"]);
    const selfDelete = await api(app, "/api/verification/face", { method: "DELETE", cookie: officialCookie });
    assert.equal(selfDelete.status, 403, "an official cannot reset their own face while the duty gate is on");
    const removed = await api(app, "/api/verification/face", {
      method: "DELETE",
      cookie: admin.cookie,
      body: { userId: dutyOfficial.rows[0].id, reason: "Test reset of face reference" },
    });
    assert.equal(removed.status, 200);
    const afterRemoval = await api(app, "/api/state", { cookie: officialCookie }).then((r) => r.json());
    const blockedPut = await api(app, "/api/state", {
      method: "PUT",
      cookie: officialCookie,
      body: { data: afterRemoval.data, revision: afterRemoval.revision },
    });
    assert.equal(blockedPut.status, 403);
    const blockedBody = await blockedPut.json();
    assert.equal(blockedBody.code, "FACE_VERIFICATION_REQUIRED");

    // Residents are never gated; administrators are exempt.
    const resident = await registerResident(app, "gate-resident@example.test", "Gate Resident");
    const residentState = await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json());
    const residentPut = await api(app, "/api/state", {
      method: "PUT",
      cookie: resident.cookie,
      body: { data: residentState.data, revision: residentState.revision },
    });
    assert.notEqual(residentPut.status, 403);
    const adminState = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const adminPut = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { data: adminState.data, revision: adminState.revision },
    });
    assert.notEqual(adminPut.status, 403);

    // Signing out and in does not lift an expired gate; only a fresh check does.
    const reenrolled = await api(app, "/api/verification/face/enroll", {
      method: "POST",
      cookie: officialCookie,
      body: { embedding: unitA, liveness: false },
    });
    assert.equal(reenrolled.status, 201);
    const verifiedAgain = await api(app, "/api/verification/face/verify", {
      method: "POST",
      cookie: officialCookie,
      body: { embedding: unitA },
    });
    assert.equal(verifiedAgain.status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a client flag can never acknowledge away a face re-enrollment mismatch", async () => {
  // On-device embedding path.
  const embedDir = await mkdtemp(path.join(os.tmpdir(), "community-enroll-ack-"));
  const embedApp = await startServer(embedDir, {}, { uploadsDir: path.join(embedDir, "uploads") });
  try {
    const admin = await signIn(embedApp);
    const cookie = await createOfficial(embedApp, admin.cookie, "ack-official@example.test", "Ack Official");
    const enrolled = await api(embedApp, "/api/verification/face/enroll", {
      method: "POST", cookie, body: { embedding: unitA },
    });
    assert.equal(enrolled.status, 201, await enrolled.text());
    for (const body of [
      { embedding: farFromA },
      { embedding: farFromA, acknowledgeMismatch: true },
      { embedding: farFromA, liveness: true, acknowledgeMismatch: "1" },
    ]) {
      const mismatch = await api(embedApp, "/api/verification/face/enroll", { method: "POST", cookie, body });
      assert.equal(mismatch.status, 409, `a mismatch must always be refused: ${await mismatch.text()}`);
    }
    const matching = await api(embedApp, "/api/verification/face/enroll", {
      method: "POST", cookie, body: { embedding: closeToA, acknowledgeMismatch: true },
    });
    assert.equal(matching.status, 201, await matching.text());
  } finally {
    await embedApp.close();
    await rm(embedDir, { recursive: true, force: true });
  }

  // Face++ path.
  const faceDir = await mkdtemp(path.join(os.tmpdir(), "community-enroll-ack-facepp-"));
  let token = "token-a";
  const faceppClient = {
    configured: true,
    detectFace: async () => token,
    compareFaces: async (a, b) => (a === b ? 95 : 10),
  };
  const faceApp = await startServer(faceDir, {}, { uploadsDir: path.join(faceDir, "uploads"), faceppClient });
  try {
    const admin = await signIn(faceApp);
    await api(faceApp, "/api/settings/verification", {
      method: "PUT", cookie: admin.cookie, body: verificationBody({ faceppEnabled: true }),
    });
    const cookie = await createOfficial(faceApp, admin.cookie, "ack-facepp@example.test", "Ack Face Official");
    const enrolled = await api(faceApp, "/api/verification/face/enroll", {
      method: "POST", cookie, body: { image: FACE_IMAGE },
    });
    assert.equal(enrolled.status, 201, await enrolled.text());
    token = "token-b";
    const withFlag = await api(faceApp, "/api/verification/face/enroll", {
      method: "POST", cookie, body: { image: FACE_IMAGE, acknowledgeMismatch: true },
    });
    assert.equal(withFlag.status, 409, await withFlag.text());
    const noFlag = await api(faceApp, "/api/verification/face/enroll", {
      method: "POST", cookie, body: { image: FACE_IMAGE },
    });
    assert.equal(noFlag.status, 409, await noFlag.text());
    token = "token-a";
    const matching = await api(faceApp, "/api/verification/face/enroll", {
      method: "POST", cookie, body: { image: FACE_IMAGE },
    });
    assert.equal(matching.status, 201, await matching.text());
  } finally {
    await faceApp.close();
    await rm(faceDir, { recursive: true, force: true });
  }
});

test("expired identity documents are purged after the retention window", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-id-retention-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const app = await startServer(dataDir, {}, { uploadsDir });
  try {
    const stale = await registerResident(app, "id-stale@example.test", "Stale ID");
    const fresh = await registerResident(app, "id-fresh@example.test", "Fresh ID");
    const staleId = (await app.db.query("SELECT id FROM users WHERE email=$1", [stale.email])).rows[0].id;
    const freshId = (await app.db.query("SELECT id FROM users WHERE email=$1", [fresh.email])).rows[0].id;
    const staleDir = path.join(uploadsDir, "verification", staleId);
    await mkdir(staleDir, { recursive: true });
    await writeFile(path.join(staleDir, "front.jpg"), TEST_JPEG);

    await app.db.query(
      `UPDATE users SET id_status='rejected', id_reviewed_at=now() - interval '120 days',
         id_image_filename='front.jpg', id_number='1234', id_full_name='Stale ID',
         face_references='[[0.1]]'::jsonb WHERE id=$1`,
      [staleId],
    );
    await app.db.query(
      `UPDATE users SET id_status='pending', id_reviewed_at=NULL, id_image_filename='front.jpg' WHERE id=$1`,
      [freshId],
    );

    assert.equal(await sweepExpiredIdImages(app.db, uploadsDir, 90), 1);
    assert.deepEqual(await readdir(staleDir), [], "the retained image is removed");
    const staleRow = (await app.db.query("SELECT id_status, id_number, id_image_filename, face_references FROM users WHERE id=$1", [staleId])).rows[0];
    assert.equal(staleRow.id_status, "unverified");
    assert.equal(staleRow.id_number, "");
    assert.equal(staleRow.id_image_filename, "");
    assert.deepEqual(staleRow.face_references, []);
    const freshRow = (await app.db.query("SELECT id_status, id_image_filename FROM users WHERE id=$1", [freshId])).rows[0];
    assert.equal(freshRow.id_status, "pending", "a recent submission is untouched");
    assert.equal(freshRow.id_image_filename, "front.jpg");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
