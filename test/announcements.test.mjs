import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn, registerResident, createOfficial } from "./helpers.mjs";

test("event announcement rejects out-of-range and non-numeric coordinates on create and update", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-event-coords-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const base = {
      title: "Coord test event",
      detail: "Event detail for coordinate validation.",
      date: new Date().toISOString().slice(0, 10),
      isEvent: true,
    };

    const badLongitude = await api(app, "/api/announcements", {
      method: "POST",
      cookie: officialCookie,
      body: { ...base, latitude: 14.01799, longitude: 200 },
    });
    assert.equal(badLongitude.status, 400);

    const stringLatitude = await api(app, "/api/announcements", {
      method: "POST",
      cookie: officialCookie,
      body: { ...base, latitude: "14.01799", longitude: 121.09465 },
    });
    assert.equal(stringLatitude.status, 400);

    const created = await api(app, "/api/announcements", {
      method: "POST",
      cookie: officialCookie,
      body: { ...base, latitude: 14.01799, longitude: 121.09465 },
    });
    assert.equal(created.status, 200);
    const createdJson = await created.json();
    const announcementId = String(createdJson.data.announcements[0].id);

    const badUpdate = await api(app, "/api/announcements", {
      method: "PUT",
      cookie: officialCookie,
      body: { id: announcementId, ...base, title: "Coord test event updated", latitude: -200, longitude: 121.09465 },
    });
    assert.equal(badUpdate.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("stores calendar event coordinates and returns them in saved state", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-calendar-coords-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const response = await api(app, "/api/calendar/events", {
      method: "POST",
      cookie: admin.cookie,
      body: {
        title: "Community clean-up",
        detail: "Meet at the covered court before the clean-up starts.",
        date,
        latitude: 14.01799,
        longitude: 121.09465,
      },
    });
    const created = await response.json();
    assert.equal(response.status, 200, JSON.stringify(created));
    const event = created.data.calendarEvents.find((item) => item.title === "Community clean-up");
    assert.equal(event.latitude, 14.01799);
    assert.equal(event.longitude, 121.09465);

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((result) => result.json());
    const saved = state.data.calendarEvents.find((item) => item.id === event.id);
    assert.equal(saved.latitude, 14.01799);
    assert.equal(saved.longitude, 121.09465);

    const zeroAnchor = await api(app, "/api/calendar/events", {
      method: "POST",
      cookie: admin.cookie,
      body: { title: "Zero anchor", detail: "Coordinates of zero are valid locations.", date, latitude: 0, longitude: 0 },
    });
    const zeroCreated = await zeroAnchor.json();
    assert.equal(zeroAnchor.status, 200, JSON.stringify(zeroCreated));
    const zeroEvent = zeroCreated.data.calendarEvents.find((item) => item.title === "Zero anchor");
    assert.equal(zeroEvent.latitude, 0);
    assert.equal(zeroEvent.longitude, 0);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("pending announcement decline stores reason, notifies creator and hides from residents", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-decline-cell-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const created = await api(app, "/api/announcements", {
      method: "POST",
      cookie: officialCookie,
      body: {
        title: "Decline cell notice",
        detail: "This notice should be declined with a reason.",
        date: new Date().toISOString().slice(0, 10),
      },
    });
    assert.equal(created.status, 200);
    const createdJson = await created.json();
    const announcementId = String(createdJson.data.announcements[0].id);
    assert.equal(createdJson.data.announcements[0].approvalStatus, "pending");

    const declined = await api(app, "/api/announcements/approval", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: announcementId, status: "declined", reason: "Not barangay business." },
    });
    assert.equal(declined.status, 200);

    const adminState = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const declinedItem = adminState.data.announcements.find((item) => String(item.id) === announcementId);
    assert.equal(declinedItem.approvalStatus, "declined");
    assert.equal(declinedItem.declineReason, "Not barangay business.");

    const resident = await registerResident(app, "resident.decline@example.test", "Resident Decline");
    const residentState = await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(
      residentState.data.announcements.some((item) => String(item.id) === announcementId),
      false,
      "declined announcement hidden from residents",
    );

    // a decided announcement cannot be re-decided
    const redecide = await api(app, "/api/announcements/approval", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: announcementId, status: "approved" },
    });
    assert.equal(redecide.status, 409);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("official announcement edit re-pends approval and clears decline reason", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-repend-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const created = await api(app, "/api/announcements", {
      method: "POST",
      cookie: officialCookie,
      body: { title: "Re-pend notice", detail: "Original detail for re-pend test.", date: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(created.status, 200);
    const announcementId = String((await created.json()).data.announcements[0].id);

    const declined = await api(app, "/api/announcements/approval", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: announcementId, status: "declined", reason: "Needs detail." },
    });
    assert.equal(declined.status, 200);

    const edited = await api(app, "/api/announcements", {
      method: "PUT",
      cookie: officialCookie,
      body: {
        id: announcementId,
        title: "Re-pend notice",
        detail: "Updated detail after decline.",
        date: new Date().toISOString().slice(0, 10),
      },
    });
    assert.equal(edited.status, 200);
    const editedItem = (await edited.json()).data.announcements.find((item) => String(item.id) === announcementId);
    assert.equal(editedItem.approvalStatus, "pending");
    assert.equal(editedItem.declineReason, "");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("administrators publish announcements directly while officials submit for approval", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-announcement-roles-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const date = new Date().toISOString().slice(0, 10);

    const adminResponse = await api(app, "/api/announcements", {
      method: "POST",
      cookie: admin.cookie,
      body: { title: "Direct admin notice", detail: "Published directly by an administrator.", date },
    });
    const adminState = await adminResponse.json();
    assert.equal(adminResponse.status, 200, JSON.stringify(adminState));
    const adminAnnouncement = adminState.data.announcements.find((item) => item.title === "Direct admin notice");
    assert.equal(adminAnnouncement.approvalStatus, "approved");

    const officialResponse = await api(app, "/api/announcements", {
      method: "POST",
      cookie: officialCookie,
      body: { title: "Official request", detail: "Submitted for administrator approval.", date },
    });
    const officialState = await officialResponse.json();
    assert.equal(officialResponse.status, 200, JSON.stringify(officialState));
    const officialAnnouncement = officialState.data.announcements.find((item) => item.title === "Official request");
    assert.equal(officialAnnouncement.approvalStatus, "pending");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
