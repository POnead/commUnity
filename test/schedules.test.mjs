import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer, api, signIn } from "./helpers.mjs";

test("stores recurring schedule occurrences as independent dated rows", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-recurring-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Recurring Resident",
        email: "recurring-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];
    let state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    const series = [
      ["GCS-2027-101", "2027-01-05"],
      ["GCS-2027-102", "2027-01-12"],
      ["GCS-2027-103", "2027-01-19"],
    ];
    for (const [id, date] of series) {
      state.data.schedules.push({
        id,
        area: "Purok 1",
        zone: "Zone A",
        date,
        wasteType: "Biodegradable",
        start: "6:00 AM",
        end: "9:00 AM",
        frequency: "Weekly",
        team: "Team A",
        status: "Scheduled",
        seriesId: "GCS-2027-101",
        recurrenceEnd: "2027-01-19",
      });
    }
    let response = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    state = await response.json();
    const saved = state.data.schedules.filter((item) => item.seriesId === "GCS-2027-101");
    assert.deepEqual(
      saved.map((item) => item.id),
      ["GCS-2027-101", "GCS-2027-102", "GCS-2027-103"],
    );
    assert.deepEqual(
      saved.map((item) => item.date),
      ["2027-01-05", "2027-01-12", "2027-01-19"],
    );
    assert.equal(
      saved.every((item) => item.recurrenceEnd === "2027-01-19"),
      true,
    );

    const residentAfterSeries = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    const addedNotifications = residentAfterSeries.data.notifications.filter(
      (item) => item.title === "Collection schedule added for Purok 1",
    );
    assert.equal(addedNotifications.length, 1);
    assert.match(addedNotifications[0].body, /3 Biodegradable pickups/);

    const delayed = saved.find((item) => item.id === "GCS-2027-101");
    delayed.status = "Delayed";
    delayed.history.push({
      previousStatus: "Scheduled",
      status: "Delayed",
      at: new Date().toISOString(),
      actorName: "Forged name",
      actorRole: "resident",
      note: "Heavy rain flooded the route.",
      previousDate: delayed.date,
      previousStart: delayed.start,
      previousEnd: delayed.end,
      replacementDate: null,
      replacementStart: null,
      replacementEnd: null,
    });
    response = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(response.status, 200);
    state = await response.json();
    const delayedStored = state.data.schedules.find((item) => item.id === "GCS-2027-101");
    assert.equal(delayedStored.status, "Delayed");
    assert.equal(delayedStored.history.at(-1).note, "Heavy rain flooded the route.");
    assert.equal(delayedStored.history.at(-1).previousStatus, "Scheduled");
    assert.notEqual(delayedStored.history.at(-1).actorName, "Forged name");
    assert.equal(delayedStored.history.at(-1).actorRole, "administrator");
    assert.equal(state.data.schedules.find((item) => item.id === "GCS-2027-102").status, "Scheduled");
    assert.equal(state.data.schedules.find((item) => item.id === "GCS-2027-103").status, "Scheduled");
    const residentAfterDelay = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    const delayNotifications = residentAfterDelay.data.notifications.filter((item) => item.title === "Collection update for Purok 1");
    assert.equal(delayNotifications.length, 1);
    assert.match(delayNotifications[0].body, /Heavy rain flooded the route/);

    const stored = await app.db.query(`
      SELECT count(*)::integer AS count, count(DISTINCT series_id)::integer AS series,
        count(DISTINCT recurrence_end)::integer AS recurrence_ends
      FROM schedules
    `);
    assert.deepEqual(stored.rows[0], { count: 3, series: 1, recurrence_ends: 1 });

    const invalidSeries = structuredClone(state.data);
    invalidSeries.schedules[0].seriesId = "not a valid id!";
    const rejected = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: invalidSeries },
    });
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("collection status changes keep a history and require reasons and replacement pickups", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-schedule-history-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const registered = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "History Resident",
        email: "history-resident@example.test",
        area: "Purok 1",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registered.status, 201);
    const residentCookie = registered.headers.get("set-cookie").split(";")[0];
    let state = await api(app, "/api/state", { cookie: admin.cookie }).then((response) => response.json());
    state.data.schedules.push({
      id: "GCS-2028-001",
      area: "Purok 1",
      zone: "Zone A",
      date: "2028-03-06",
      wasteType: "Biodegradable",
      start: "6:00 AM",
      end: "9:00 AM",
      frequency: "One-time",
      team: "Team A",
      status: "Scheduled",
      seriesId: null,
      recurrenceEnd: null,
    });
    let response = await api(app, "/api/state", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(response.status, 200);
    state = await response.json();
    let schedule = state.data.schedules.find((item) => item.id === "GCS-2028-001");
    assert.equal(schedule.history.length, 1);
    assert.equal(schedule.history[0].status, "Scheduled");
    assert.equal(schedule.history[0].previousStatus, null);

    const entry = (previousStatus, status, note, overrides = {}) => ({
      previousStatus,
      status,
      at: new Date().toISOString(),
      actorName: "",
      actorRole: "",
      note,
      previousDate: null,
      previousStart: null,
      previousEnd: null,
      replacementDate: null,
      replacementStart: null,
      replacementEnd: null,
      ...overrides,
    });
    const put = (mutate) => {
      const next = structuredClone(state.data);
      mutate(next.schedules.find((item) => item.id === "GCS-2028-001"));
      return api(app, "/api/state", { method: "PUT", cookie: admin.cookie, body: { revision: state.revision, data: next } });
    };

    response = await put((item) => {
      item.status = "Delayed";
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /history/);

    response = await put((item) => {
      item.status = "Delayed";
      item.history.push(entry("Scheduled", "Delayed", "   "));
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /need a reason/);

    response = await put((item) => {
      item.status = "Rescheduled";
      item.history.push(entry("Scheduled", "Rescheduled", "Route change."));
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /replacement pickup date and time/);

    response = await put((item) => {
      item.status = "Cancelled";
      item.history.push(
        entry("Scheduled", "Cancelled", "Holiday closure.", {
          previousDate: item.date,
          previousStart: item.start,
          previousEnd: item.end,
        }),
      );
    });
    assert.equal(response.status, 200);
    state = await response.json();
    schedule = state.data.schedules.find((item) => item.id === "GCS-2028-001");
    assert.equal(schedule.status, "Cancelled");
    assert.equal(schedule.history.at(-1).note, "Holiday closure.");
    assert.equal(schedule.history.at(-1).previousStatus, "Scheduled");
    assert.ok(schedule.history.at(-1).actorName);
    assert.equal(schedule.history.at(-1).actorRole, "administrator");
    const residentAfterCancel = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    assert.ok(residentAfterCancel.data.notifications.some((item) => /Holiday closure/.test(item.body)));

    response = await put((item) => {
      item.status = "Rescheduled";
      item.date = "2028-03-08";
      item.start = "7:00 AM";
      item.end = "10:00 AM";
      item.history.push(
        entry("Cancelled", "Rescheduled", "Replacement after the holiday.", {
          previousDate: "2028-03-06",
          previousStart: "6:00 AM",
          previousEnd: "9:00 AM",
          replacementDate: "2028-03-08",
          replacementStart: "7:00 AM",
          replacementEnd: "10:00 AM",
        }),
      );
    });
    assert.equal(response.status, 200);
    state = await response.json();
    schedule = state.data.schedules.find((item) => item.id === "GCS-2028-001");
    assert.equal(schedule.date, "2028-03-08");
    assert.equal(schedule.start, "7:00 AM");
    assert.equal(schedule.history.at(-1).previousDate, "2028-03-06");
    assert.equal(schedule.history.at(-1).replacementDate, "2028-03-08");
    assert.equal(schedule.history.at(-1).actorRole, "administrator");
    const storedHistory = await app.db.query("SELECT count(*)::integer AS count FROM schedule_history WHERE schedule_id='GCS-2028-001'");
    assert.equal(storedHistory.rows[0].count, 3);
    const residentAfterReschedule = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    assert.ok(residentAfterReschedule.data.notifications.some((item) => /rescheduled from 2028-03-06/.test(item.body)));

    response = await put((item) => {
      item.history.push(entry("Rescheduled", "Rescheduled", "Tampered history."));
    });
    assert.equal(response.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
