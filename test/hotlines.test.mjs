import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn, registerResident, createOfficial } from "./helpers.mjs";

const FIRE_DEPT = { name: "Palsara Fire Department", category: "Fire Department", contactNumber: "0917 111 2233", alternativeContactNumber: "", officeAddress: "Purok 1, Palsara", description: "Fire and rescue response.", operatingHours: "24 hours" };

function hotlineBody(overrides = {}) {
  return { ...FIRE_DEPT, status: "Active", published: true, ...overrides };
}

async function createHotline(app, cookie, overrides = {}) {
  const response = await api(app, "/api/hotlines", { method: "POST", cookie, body: hotlineBody(overrides) });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return json.data.hotlines[json.data.hotlines.length - 1];
}

test("admin saves a draft, residents cannot see it, publishing reveals it", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-draft-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const resident = await registerResident(app, "resident.hotline.draft@example.test", "Resident Draft");

    const draft = await createHotline(app, admin.cookie, { name: "Fire Draft", published: false });
    assert.equal(draft.published, false);

    const residentState = await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(residentState.data.hotlines.length, 0, "draft must be hidden from residents");

    await api(app, "/api/hotlines", {
      method: "PUT",
      cookie: admin.cookie,
      body: hotlineBody({ id: draft.id, name: "Fire Draft", published: true }),
    }).then((r) => assert.equal(r.status, 200));

    const residentAgain = await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(residentAgain.data.hotlines.length, 1);
    assert.equal(residentAgain.data.hotlines[0].name, "Fire Draft");
    assert.equal(residentAgain.data.hotlines[0].verifiedAt, null, "never verified yet");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("hotline requires a boolean published flag", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-published-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const { published, ...withoutPublished } = hotlineBody({ name: "No flag" });
    const response = await api(app, "/api/hotlines", { method: "POST", cookie: admin.cookie, body: withoutPublished });
    assert.equal(response.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("verify stamps the date and editing the number clears it", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-verify-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const created = await createHotline(app, admin.cookie, { name: "Verify Me" });

    const verified = await api(app, "/api/hotlines/verify", { method: "POST", cookie: admin.cookie, body: { id: created.id } });
    assert.equal(verified.status, 200);
    const verifiedItem = (await verified.json()).data.hotlines.find((item) => item.id === created.id);
    assert.ok(verifiedItem.verifiedAt, "verifiedAt must be set after Mark as Verified");

    // Editing the contact number is a new claim about the line, so the stamp clears.
    const edited = await api(app, "/api/hotlines", {
      method: "PUT",
      cookie: admin.cookie,
      body: hotlineBody({ id: created.id, name: "Verify Me", contactNumber: "0999 000 1111" }),
    });
    assert.equal(edited.status, 200);
    const editedItem = (await edited.json()).data.hotlines.find((item) => item.id === created.id);
    assert.equal(editedItem.verifiedAt, null, "changing the number must clear the verification stamp");

    // Editing only the description keeps the stamp.
    const reVerify = await api(app, "/api/hotlines/verify", { method: "POST", cookie: admin.cookie, body: { id: created.id } });
    assert.equal(reVerify.status, 200);
    const reDesc = await api(app, "/api/hotlines", {
      method: "PUT",
      cookie: admin.cookie,
      body: hotlineBody({ id: created.id, name: "Verify Me", contactNumber: "0999 000 1111", description: "Only the description changed." }),
    });
    const reDescItem = (await reDesc.json()).data.hotlines.find((item) => item.id === created.id);
    assert.ok(reDescItem.verifiedAt, "editing a non-number field must keep the verification stamp");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("officials cannot publish hotlines directly but can request a correction", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-official-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const created = await createHotline(app, admin.cookie, { name: "Official Target" });

    const direct = await api(app, "/api/hotlines", { method: "POST", cookie: officialCookie, body: hotlineBody({ name: "Official Publish" }) });
    assert.equal(direct.status, 403);

    const correction = await api(app, "/api/hotlines/corrections", {
      method: "POST",
      cookie: officialCookie,
      body: { kind: "correction", hotlineId: created.id, proposed: { contactNumber: "0950 555 6666" }, reason: "The old desk line was disconnected." },
    });
    assert.equal(correction.status, 200);
    const correctionState = await correction.json();
    const pending = correctionState.data.hotlineCorrections.find((item) => item.hotlineId === created.id);
    assert.equal(pending.status, "pending");

    const approved = await api(app, "/api/hotlines/corrections/review", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: pending.id, decision: "approved", note: "" },
    });
    assert.equal(approved.status, 200);
    const approvedItem = (await approved.json()).data.hotlines.find((item) => item.id === created.id);
    assert.equal(approvedItem.contactNumber, "0950 555 6666");
    assert.equal(approvedItem.verifiedAt, null, "an approved correction clears the verification stamp");

    // A decided correction cannot be decided again.
    const decideAgain = await api(app, "/api/hotlines/corrections/review", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: pending.id, decision: "rejected", note: "Too late." },
    });
    assert.equal(decideAgain.status, 409);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("correction approval 409s when the target hotline was removed", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-correction-409-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const created = await createHotline(app, admin.cookie, { name: "Vanishing Hotline" });
    const correction = await api(app, "/api/hotlines/corrections", {
      method: "POST",
      cookie: officialCookie,
      body: { kind: "correction", hotlineId: created.id, proposed: { contactNumber: "0950 777 8888" }, reason: "Disconnected." },
    });
    const pending = (await correction.json()).data.hotlineCorrections.find((item) => item.hotlineId === created.id);

    await api(app, "/api/hotlines", { method: "DELETE", cookie: admin.cookie, body: { id: created.id } }).then((r) => assert.equal(r.status, 200));

    const approve = await api(app, "/api/hotlines/corrections/review", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: pending.id, decision: "approved", note: "" },
    });
    assert.equal(approve.status, 409);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("correction for a draft hotline is rejected because residents cannot dial it", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-correction-draft-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const draft = await createHotline(app, admin.cookie, { name: "Draft Only", published: false });
    const correction = await api(app, "/api/hotlines/corrections", {
      method: "POST",
      cookie: officialCookie,
      body: { kind: "correction", hotlineId: draft.id, proposed: { contactNumber: "0950 101 2020" }, reason: "Wrong number." },
    });
    assert.equal(correction.status, 404);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("suggestion accepts optional supporting file and no reason", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-support-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const proposed = { name: "Support Desk", category: "Medical", contactNumber: "0917 444 5555", description: "Test line." };

    const withoutFile = await api(app, "/api/hotlines/corrections", {
      method: "POST",
      cookie: officialCookie,
      body: { kind: "suggestion", proposed },
    });
    assert.equal(withoutFile.status, 200, "reason is optional");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const form = new FormData();
    form.append("kind", "suggestion");
    form.append("proposed", JSON.stringify({ ...proposed, name: "Support File Desk" }));
    form.append("supportingFile", new Blob([png], { type: "image/png" }), "support.png");
    const withFile = await fetch(`${app.origin}/api/hotlines/corrections`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: officialCookie },
      body: form,
    });
    const state = await withFile.json();
    assert.equal(withFile.status, 200, JSON.stringify(state.error || ""));
    const suggestion = state.data.hotlineCorrections.find((item) => item.proposed?.name === "Support File Desk");
    assert.ok(suggestion, "the suggestion is stored");
    assert.equal(suggestion.reason, "");
    assert.equal(suggestion.proposed.supportingFile.name, "support.png");

    const fileResponse = await fetch(`${app.origin}${suggestion.proposed.supportingFile.url}`, {
      headers: { Origin: app.origin, Cookie: officialCookie },
    });
    assert.equal(fileResponse.status, 200);
    assert.equal(fileResponse.headers.get("content-type"), "image/png");

    const badForm = new FormData();
    badForm.append("kind", "suggestion");
    badForm.append("proposed", JSON.stringify({ ...proposed, name: "Bad File Desk" }));
    badForm.append("supportingFile", new Blob(["not an image"], { type: "text/plain" }), "notes.txt");
    const rejected = await fetch(`${app.origin}/api/hotlines/corrections`, {
      method: "POST",
      headers: { Origin: app.origin, Cookie: officialCookie },
      body: badForm,
    });
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("approved suggestion is published to the directory", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-suggestion-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const resident = await registerResident(app, "resident.hotline.suggestion@example.test", "Resident Suggestion");

    const suggestion = await api(app, "/api/hotlines/corrections", {
      method: "POST",
      cookie: officialCookie,
      body: {
        kind: "suggestion",
        proposed: { name: "Palsara Medical Desk", category: "Medical", contactNumber: "0917 303 4040", description: "Barangay health unit nurse line.", operatingHours: "Mon-Fri, 8AM-5PM" },
        reason: "Residents need a direct line to the health unit.",
      },
    });
    assert.equal(suggestion.status, 200);
    const pending = (await suggestion.json()).data.hotlineCorrections.find((item) => item.kind === "suggestion");
    assert.equal(pending.status, "pending");

    const approved = await api(app, "/api/hotlines/corrections/review", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: pending.id, decision: "approved", note: "" },
    });
    assert.equal(approved.status, 200);
    const approvedState = await approved.json();
    const suggested = approvedState.data.hotlines.find((item) => item.name === "Palsara Medical Desk");
    const decision = approvedState.data.hotlineCorrections.find((item) => item.id === pending.id);
    assert.equal(suggested.published, true, "an approved suggestion is published to the directory");
    assert.equal(decision.status, "approved");

    const residentState = await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(
      residentState.data.hotlines.some((item) => item.name === "Palsara Medical Desk"),
      true,
      "approved suggestion becomes visible to residents",
    );
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("rejected correction stores the review note and notifies the official", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-rejection-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const created = await createHotline(app, admin.cookie, { name: "Reject Target" });
    const correction = await api(app, "/api/hotlines/corrections", {
      method: "POST",
      cookie: officialCookie,
      body: { kind: "correction", hotlineId: created.id, proposed: { contactNumber: "0950 999 0000" }, reason: "Has moved office." },
    });
    const pending = (await correction.json()).data.hotlineCorrections.find((item) => item.hotlineId === created.id);

    const rejected = await api(app, "/api/hotlines/corrections/review", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: pending.id, decision: "rejected", note: "That number is the neighbouring barangay." },
    });
    assert.equal(rejected.status, 200);
    const rejectedItem = (await rejected.json()).data.hotlineCorrections.find((item) => item.id === pending.id);
    assert.equal(rejectedItem.status, "rejected");
    assert.equal(rejectedItem.reviewNote, "That number is the neighbouring barangay.");

    const officialState = await api(app, "/api/state", { cookie: officialCookie }).then((r) => r.json());
    const correctionState = officialState.data.hotlineCorrections.find((item) => item.id === pending.id);
    assert.equal(correctionState.status, "rejected");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("residents cannot submit corrections", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-resident-correction-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const resident = await registerResident(app, "resident.hotline.correction@example.test", "Resident Correction");
    const created = await createHotline(app, admin.cookie, { name: "Resident Blocked Target" });
    const correction = await api(app, "/api/hotlines/corrections", {
      method: "POST",
      cookie: resident.cookie,
      body: { kind: "correction", hotlineId: created.id, proposed: { contactNumber: "0950 123 4567" }, reason: "Wrong number." },
    });
    assert.equal(correction.status, 403);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("resident corrections are withheld from residents in the state response", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-correction-state-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const resident = await registerResident(app, "resident.hotline.state@example.test", "Resident State");
    const officialCookie = await createOfficial(app, admin.cookie);
    const created = await createHotline(app, admin.cookie, { name: "State Target" });
    await api(app, "/api/hotlines/corrections", {
      method: "POST",
      cookie: officialCookie,
      body: { kind: "correction", hotlineId: created.id, proposed: { contactNumber: "0950 888 7777" }, reason: "Number changed." },
    });

    const residentState = await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json());
    assert.deepEqual(residentState.data.hotlineCorrections, [], "residents never see the correction queue");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a legacy supporting file saved under the numeric correction id is still served", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-hotline-legacy-support-"));
  const uploadsDir = path.join(dataDir, "uploads");
  const app = await startServer(dataDir, {}, { uploadsDir });
  try {
    const admin = await signIn(app);
    const adminUser = await app.db.query("SELECT id FROM users WHERE role='administrator' LIMIT 1");
    const filename = "3f2a1b6c-9d8e-4f70-8a1b-2c3d4e5f6071.png";
    // Legacy rows had no directory key: the file lived under the numeric correction id.
    const inserted = await app.db.query(
      "INSERT INTO hotline_corrections (hotline_id,kind,submitted_by,proposed,reason) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id",
      [null, "suggestion", adminUser.rows[0].id, JSON.stringify({ supportingFile: { filename } }), "legacy file"],
    );
    const correctionId = String(inserted.rows[0].id);

    const directory = path.join(uploadsDir, "hotline-corrections", correctionId);
    await mkdir(directory, { recursive: true });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await writeFile(path.join(directory, filename), png);

    const response = await fetch(`${app.origin}/api/hotline-corrections/${correctionId}/supporting`, {
      headers: { Origin: app.origin, Cookie: admin.cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
