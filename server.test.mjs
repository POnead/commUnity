import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  createCommunityServer,
  pruneExpiredAuthState,
  requestClientAddress,
  runScheduleReminders,
  withTransaction,
} from "./server.mjs";

const ADMIN_EMAIL = "admin@example.test";
const ADMIN_PASSWORD = "LocalTestPassword-2026!";

async function startServer(dataDir) {
  const instance = await createCommunityServer({
    dataDir,
    uploadsDir: path.join(path.dirname(dataDir), "uploads"),
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
  assert.equal(
    requestClientAddress(proxiedRequest, new Set(["10.0.0.1", "10.0.0.2"])),
    "198.51.100.4",
  );
  assert.equal(
    requestClientAddress(
      { ...proxiedRequest, headers: { "x-forwarded-for": "malformed" } },
      new Set(["10.0.0.2"]),
    ),
    "10.0.0.2",
  );
});

test("renders saved concern pins inline for residents and officials with a directions fallback", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const context = {
    STATUSES: ["Submitted", "Under Review", "In Progress", "Resolved"],
    REPORT_TRANSITIONS: {
      Submitted: ["Under Review"],
      "Under Review": ["In Progress"],
      "In Progress": ["Resolved"],
      Resolved: [],
    },
    REPORT_PRIORITIES: ["High", "Medium", "Low"],
    FOLLOW_UP_LIMITS: { High: null, Medium: 5, Low: 3 },
    currentUser: { id: "official-one" },
    esc: (value) => String(value ?? ""),
    panel: (title, body) => `<section><h2>${title}</h2>${body}</section>`,
    statusPill: (status) => `<span>${status}</span>`,
    selectField: () => "",
    reportAssignmentAction: () => "",
    timelineMarkup: () => "",
    initials: () => "",
    dateTimeLabel: () => "",
    getUser: () => null,
    page: (_role, _listPage, body) => body,
  };
  runInNewContext(views, context);
  context.panel = (title, body) => `<section><h2>${title}</h2>${body}</section>`;
  context.page = (_role, _listPage, body) => body;
  const report = {
    id: "RPT-map-test",
    title: "Blocked drainage",
    category: "Drainage problem",
    status: "Submitted",
    description: "The drain is blocked beside the community hall.",
    barangay: "Palsara",
    area: "Purok 2",
    locationDetail: "Beside the community hall",
    latitude: 14.01799,
    longitude: 121.09465,
    submittedAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    history: [],
    photos: [],
    assignedTo: null,
    name: "Resident Example",
    userEmail: "resident@example.test",
  };

  const officialDetail = context.reportDetail(report, "official");
  assert.match(officialDetail, /id="report-detail-map"/);
  assert.match(officialDetail, /data-latitude="14\.01799"/);
  assert.match(officialDetail, /data-longitude="121\.09465"/);
  assert.match(officialDetail, /Open directions in Google Maps/);
  assert.match(officialDetail, /Beside the community hall/);

  const withoutPin = context.reportDetail({ ...report, latitude: null, longitude: null }, "official");
  assert.doesNotMatch(withoutPin, /id="report-detail-map"/);
  assert.match(withoutPin, /did not include a map pin/);
  assert.match(withoutPin, /Beside the community hall/);

  const residentDetail = context.reportDetail(report, "resident");
  assert.match(residentDetail, /id="report-detail-map"/);
  assert.match(residentDetail, /data-latitude="14\.01799"/);
  assert.match(residentDetail, /data-longitude="121\.09465"/);
  assert.match(residentDetail, /Open directions in Google Maps/);
  assert.match(residentDetail, /Beside the community hall/);

  const residentWithoutPin = context.reportDetail({ ...report, latitude: null, longitude: null }, "resident");
  assert.doesNotMatch(residentWithoutPin, /id="report-detail-map"/);
  assert.match(residentWithoutPin, /You did not add a map pin/);
  assert.match(residentWithoutPin, /Beside the community hall/);
});

test("renders community-wide official hours on the resident dashboard", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const context = {
    currentUser: { role: "resident", area: "Purok 1" },
    communityOfficialHours: [{ name: "Official One", workingHours: "Monday, Saturday, 8:00 AM-5:00 PM" }],
    data: { announcements: [], reports: [], schedules: [], users: [] },
    EMERGENCY_HOTLINES: [],
    esc: (value) => String(value ?? ""),
    userReports: () => [],
    sortedReports: () => [],
    sortedSchedules: () => [],
    icon: () => "",
    panel: (title, body) => `<section><h2>${title}</h2>${body}</section>`,
    linkButton: () => "",
    routeUrl: () => "",
    page: (_role, _pageName, body) => body,
  };
  runInNewContext(views, context);
  context.page = (_role, _pageName, body) => body;

  const dashboard = context.dashboardResident();
  assert.match(dashboard, /Official working hours/);
  assert.match(dashboard, /Official One/);
  assert.match(dashboard, /Monday, Saturday, 8:00 AM-5:00 PM/);
  assert.doesNotMatch(dashboard, /No hours posted/);
});

test("renders latest reports with status pill and view button on resident dashboard", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const context = {
    currentUser: { role: "resident", area: "Purok 1", email: "resident@example.test" },
    communityOfficialHours: [],
    data: { announcements: [], reports: [], schedules: [], users: [] },
    EMERGENCY_HOTLINES: [],
    esc: (value) => String(value ?? ""),
    asDate: (value) => new Date(value),
    dateLabel: (value) => String(value),
    userReports: () => [{
      id: "RPT-2026-001",
      title: "Blocked drainage",
      status: "Submitted",
      updatedAt: "2026-11-01T10:00:00.000Z",
    }],
    sortedReports: (reports = []) => [...reports],
    sortedSchedules: () => [],
    upcomingSchedule: () => null,
    statusPill: (status) => `<span class="status">${String(status)}</span>`,
    icon: () => "",
    panel: (title, body) => `<section><h2>${title}</h2>${body}</section>`,
    linkButton: () => "",
    routeUrl: () => "",
    page: (_role, _pageName, body) => body,
  };
  runInNewContext(views, context);
  context.page = (_role, _pageName, body) => body;

  const dashboard = context.dashboardResident();
  assert.match(dashboard, /Your latest reports/);
  assert.match(dashboard, /Blocked drainage/);
  assert.match(dashboard, /RPT-2026-001/);
  assert.match(dashboard, /class="item-actions"/);
  assert.match(dashboard, /data-action="view-report"/);
  assert.match(dashboard, /aria-label="View RPT-2026-001"/);
});

test("displays timestamp-based concern IDs in a compact format", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const context = {};
  runInNewContext(views, context);

  assert.equal(context.displayReportId("R1794145468286"), "R-MW7VVZB2");
  assert.equal(context.displayReportId("R1794145468286-7wnokm"), "R-MW7VVZB2-7WNOKM");
  assert.equal(context.displayReportId("R-4J8K2M9W7Q"), "R-4J8K2M9W7Q");
  assert.equal(context.displayReportId("R-MJ9F3F4A-7WNOKM"), "R-MJ9F3F4A-7WNOKM");
});

test("builds the report draft with the priority selected in the form", async () => {
  const core = await readFile(new URL("./app-core.js", import.meta.url), "utf8");
  const context = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
  };
  runInNewContext(core, context);

  const formFields = (priority) => {
    const fields = new FormData();
    fields.set("category", "Drainage problem");
    fields.set("area", "Purok 2");
    fields.set("locationDetail", "Beside the community hall");
    fields.set("latitude", "");
    fields.set("longitude", "");
    fields.set("description", "The drain is blocked beside the community hall.");
    fields.set("priority", priority);
    return fields;
  };

  for (const priority of ["High", "Medium", "Low"]) {
    const draft = context.reportDraftFromForm(formFields(priority));
    assert.equal(draft.priority, priority);
    assert.equal(draft.urgent, priority === "High");
  }

  assert.throws(() => context.reportDraftFromForm(formFields("Urgent")), /Choose a valid concern priority/);
});

test("uses only a specific account override without hiding other permitted pages", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const context = {
    data: {
      permissions: {
        official: { manageReports: true, manageSchedules: true, manageAnnouncements: true },
      },
      accountOverrides: {
        "official.one@example.test": { manageSchedules: false },
        "official.two@example.test": { manageReports: false },
      },
    },
  };
  runInNewContext(views, context);

  const officialOne = { role: "official", email: "official.one@example.test" };
  assert.equal(context.canOpenPage(officialOne, "concerns"), true);
  assert.equal(context.canOpenPage(officialOne, "announcements"), true);
  assert.equal(context.canOpenPage(officialOne, "collection"), false);
  assert.equal(context.canOpenPage(officialOne, "profile"), true);

  const officialTwo = { role: "official", email: "official.two@example.test" };
  assert.equal(context.canOpenPage(officialTwo, "concerns"), false);
  assert.equal(context.canOpenPage(officialTwo, "collection"), true);

  const officialWithoutOverride = { role: "official", email: "official.three@example.test" };
  assert.equal(context.canOpenPage(officialWithoutOverride, "concerns"), true);
  assert.equal(context.canOpenPage(officialWithoutOverride, "collection"), true);
});

test("effective permissions combine role defaults and account overrides", async () => {
  const core = await readFile(new URL("./app-core.js", import.meta.url), "utf8");
  const context = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
    data: {
      permissions: {
        official: { manageReports: true, manageSchedules: true, manageAnnouncements: false },
      },
      accountOverrides: {
        "official.one@example.test": { manageSchedules: false, manageAnnouncements: true },
      },
    },
  };
  runInNewContext(core, context);

  const withOverride = { role: "official", email: "official.one@example.test" };
  const eff = context.effectivePermissions(withOverride, context.data);
  assert.equal(eff.manageReports, true, "role default: manageReports on");
  assert.equal(eff.manageSchedules, false, "override: manageSchedules off");
  assert.equal(eff.manageAnnouncements, true, "override: manageAnnouncements on");

  const withoutOverride = { role: "official", email: "official.two@example.test" };
  const eff2 = context.effectivePermissions(withoutOverride, context.data);
  assert.equal(eff2.manageReports, true, "falls back to role default");
  assert.equal(eff2.manageSchedules, true, "falls back to role default");
  assert.equal(eff2.manageAnnouncements, false, "falls back to role default");
});

test("roles page renders role defaults, individual overrides, and effective permissions", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const core = await readFile(new URL("./app-core.js", import.meta.url), "utf8");
  const coreContext = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
    data: { permissions: {} },
  };
  runInNewContext(core, coreContext);

  const context = {
    ...coreContext,
    data: {
      permissions: {
        official: { manageReports: true, manageSchedules: true, manageAnnouncements: false },
      },
      accountOverrides: {
        "official.one@example.test": { manageSchedules: false },
      },
      reports: [],
      calendarEvents: [],
      announcements: [],
      notifications: [],
      users: [
        { id: "u1", name: "Official One", email: "official.one@example.test", role: "official", status: "Active" },
        { id: "u2", name: "Official Two", email: "official.two@example.test", role: "official", status: "Active" },
      ],
    },
    ROLES: { resident: "Resident", official: "Barangay official", administrator: "Administrator" },
    PERMISSION_DEFS: [
      { id: "submitReports", label: "Submit and track concerns", group: "Community services", description: "Create concerns and view their updates." },
      { id: "viewSchedules", label: "View collection schedules", group: "Community services", description: "See posted collection dates and service updates." },
      { id: "manageReports", label: "Review and update reports", group: "Community services", description: "Review resident concerns and record status updates." },
      { id: "manageSchedules", label: "Manage collection schedules", group: "Community services", description: "Create, update, and remove service schedules." },
      { id: "manageAnnouncements", label: "Manage announcements", group: "Community services", description: "Publish or remove updates shared with residents." },
      { id: "manageUsers", label: "Manage user accounts", group: "Portal administration", description: "Review accounts and adjust access in this workspace." },
      { id: "manageRoles", label: "Change role permissions", group: "Portal administration", description: "Choose which workspace functions each role can access." },
      { id: "viewAudit", label: "Review activity history", group: "Portal administration", description: "Review recorded account and service activity." },
    ],
    selectedPermissionRole: "official",
    permissionDrafts: {},
    permissionOpenGroups: {},
    currentUser: { id: "admin", name: "Admin User", email: "admin@example.test", role: "administrator", area: "Palsara" },
    modalState: null,
    esc: (value) => String(value ?? ""),
    page: (_role, _view, body) => body,
  };
  runInNewContext(views, context);

  const html = context.rolesPage();
  assert.match(html, /Role defaults/);
  assert.match(html, /Individual overrides/);
  assert.match(html, /Effective permissions/);
  assert.match(html, /Resident/);
  assert.match(html, /Official/);
  assert.match(html, /Administrator/);
  assert.match(html, /Official One/);
  assert.match(html, /Official Two/);
  assert.match(html, /Effective: On/);
  assert.match(html, /Effective: Off/);
});

test("calendar events send paired map coordinates and keep them on records", async () => {
  const core = await readFile(new URL("./app-core.js", import.meta.url), "utf8");
  const context = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
  };
  runInNewContext(core, context);

  const formFields = (latitude, longitude) => {
    const fields = new FormData();
    fields.set("title", "Community clean-up");
    fields.set("detail", "Meet at the covered court.");
    fields.set("date", "2026-11-20");
    fields.set("latitude", latitude);
    fields.set("longitude", longitude);
    return fields;
  };

  const withPin = context.calendarEventFromForm(formFields("14.01799", "121.09465"));
  assert.equal(withPin.latitude, 14.01799);
  assert.equal(withPin.longitude, 121.09465);

  const withoutPin = context.calendarEventFromForm(formFields("", ""));
  assert.equal(withoutPin.latitude, null);
  assert.equal(withoutPin.longitude, null);

  assert.throws(() => context.calendarEventFromForm(formFields("14.01799", "")), /Choose a valid map location/);
  assert.throws(() => context.calendarEventFromForm(formFields("", "121.09465")), /Choose a valid map location/);
  assert.throws(() => context.calendarEventFromForm(formFields("not-a-number", "121.09465")), /Choose a valid map location/);

  const event = context.calendarEventFromRecord({
    id: 9,
    date: "2026-11-20",
    title: "Community clean-up",
    detail: "Meet at the covered court.",
    approvalStatus: "approved",
    latitude: 14.01799,
    longitude: 121.09465,
  });
  assert.equal(event.latitude, 14.01799);
  assert.equal(event.longitude, 121.09465);

  const eventWithoutPin = context.calendarEventFromRecord({ id: 10, date: "2026-11-21", title: "No pin" });
  assert.equal(eventWithoutPin.latitude, null);
  assert.equal(eventWithoutPin.longitude, null);
});

test("recurring schedules generate separate dated occurrences and reject invalid ranges", async () => {
  const core = await readFile(new URL("./app-core.js", import.meta.url), "utf8");
  const context = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
  };
  runInNewContext(core, context);

  assert.deepEqual(
    Array.from(context.scheduleOccurrenceDates("2026-11-02", "Weekly", "2026-11-30")),
    ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"],
  );
  assert.deepEqual(
    Array.from(context.scheduleOccurrenceDates("2026-11-02", "Bi-weekly", "2026-12-01")),
    ["2026-11-02", "2026-11-16", "2026-11-30"],
  );
  assert.deepEqual(
    Array.from(context.scheduleOccurrenceDates("2026-01-31", "Monthly", "2026-04-30")),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
  );
  assert.deepEqual(Array.from(context.scheduleOccurrenceDates("2026-11-02", "One-time", "2027-11-02")), ["2026-11-02"]);

  const defaultMonthly = context.scheduleOccurrenceDates("2027-01-04", "Monthly");
  assert.equal(defaultMonthly.length, 12);
  assert.equal(defaultMonthly[0], "2027-01-04");
  assert.equal(defaultMonthly[11], "2027-12-04");

  assert.throws(() => context.scheduleOccurrenceDates("2026-11-02", "Weekly", "2026-10-01"), /repeat-until date/);
  assert.throws(() => context.scheduleOccurrenceDates("2026-02-30", "Weekly"), /valid collection date/);
  assert.throws(() => context.scheduleOccurrenceDates("2026-11-02", "Daily"), /valid collection frequency/);
});

test("schedule status entries require a reason or replacement pickup details", async () => {
  const core = await readFile(new URL("./app-core.js", import.meta.url), "utf8");
  const context = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
  };
  runInNewContext(core, context);
  const scheduled = { id: "GCS-2028-001", status: "Scheduled", date: "2028-03-06", start: "6:00 AM", end: "9:00 AM" };

  assert.equal(context.scheduleStatusEntry(scheduled, { status: "Scheduled", note: "" }), null);
  assert.throws(() => context.scheduleStatusEntry(scheduled, { status: "Delayed", note: "" }), /need an explanation/);
  assert.throws(() => context.scheduleStatusEntry(scheduled, { status: "Cancelled", note: "  " }), /need an explanation/);

  const delayed = context.scheduleStatusEntry(scheduled, {
    status: "Delayed", note: "Heavy rain flooded the route.", actorName: "Official One", actorRole: "official",
  });
  assert.equal(delayed.previousStatus, "Scheduled");
  assert.equal(delayed.status, "Delayed");
  assert.equal(delayed.note, "Heavy rain flooded the route.");
  assert.equal(delayed.actorName, "Official One");
  assert.equal(delayed.previousDate, "2028-03-06");

  assert.throws(() => context.scheduleStatusEntry(scheduled, {
    status: "Rescheduled", note: "Next slot.", date: "2028-03-06", start: "6:00 AM", end: "9:00 AM",
  }), /Change the pickup date or time/);
  assert.throws(() => context.scheduleStatusEntry(scheduled, {
    status: "Rescheduled", date: "2028-03-08", start: "10:00 AM", end: "7:00 AM",
  }), /valid replacement pickup time/);

  const moved = context.scheduleStatusEntry(scheduled, {
    status: "Rescheduled", note: "Next available slot.", date: "2028-03-08", start: "7:00 AM", end: "10:00 AM",
  });
  assert.equal(moved.replacementDate, "2028-03-08");
  assert.equal(moved.replacementStart, "7:00 AM");
  assert.equal(moved.replacementEnd, "10:00 AM");
  assert.equal(moved.previousDate, "2028-03-06");
  assert.equal(moved.previousStart, "6:00 AM");
});

test("collection history markup shows status transitions, reasons and replacements", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const context = { esc: (value) => String(value ?? ""), dateLabel: (value) => String(value), dateTimeLabel: (value) => String(value) };
  runInNewContext(views, context);

  const html = context.scheduleHistoryMarkup([
    { previousStatus: null, status: "Scheduled", note: "Collection scheduled.", actorName: "Official One", at: "2028-03-01T08:00:00.000Z" },
    { previousStatus: "Scheduled", status: "Cancelled", note: "Holiday closure.", actorName: "Official Two", at: "2028-03-05T10:00:00.000Z" },
  ]);
  assert.match(html, /Scheduled → Cancelled/);
  assert.match(html, /Holiday closure\./);
  assert.match(html, /By Official Two/);
  assert.match(html, /Collection scheduled\./);
  assert.ok(html.indexOf("Cancelled") < html.indexOf("Collection scheduled."), "newest entry should render first");

  const moved = context.scheduleHistoryMarkup([
    {
      previousStatus: "Scheduled", status: "Rescheduled", note: "Route change.", actorName: "Official One",
      at: "2028-03-05T10:00:00.000Z", replacementDate: "2028-03-08", replacementStart: "7:00 AM", replacementEnd: "10:00 AM",
    },
  ]);
  assert.match(moved, /Replacement pickup: 2028-03-08, 7:00 AM–10:00 AM/);
  assert.match(context.scheduleHistoryMarkup([]), /No status changes recorded/);
});

test("resident area choices come from managed Palsara locations", async () => {
  const core = await readFile(new URL("./app-core.js", import.meta.url), "utf8");
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const context = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
  };
  runInNewContext(core, context);
  runInNewContext(views, context);
  runInNewContext(`data = { locations: [
    { id: "LOC-6", area: "Purok 6", barangay: "Palsara", purok: "Purok 6", street: "", landmark: "" },
    { id: "LOC-7", area: "Purok 7", barangay: "Palsara", purok: "Purok 7", street: "", landmark: "" },
    { id: "LOC-8", area: "San Isidro Proper", barangay: "San Isidro", purok: "Purok 1", street: "", landmark: "" }
  ] };`, context);

  assert.deepEqual(Array.from(context.residentAreaOptions()), ["Purok 6", "Purok 7"]);
  assert.equal(context.isResidentArea("Purok 6"), true);
  assert.equal(context.isResidentArea("San Isidro Proper"), false);

  const markup = context.registerMarkup();
  assert.match(markup, />Purok 6</);
  assert.match(markup, />Purok 7</);
  assert.doesNotMatch(markup, /San Isidro Proper/);
});

test("renders an event location action only for event announcements", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const context = {
    currentUser: { role: "official", email: "official@example.test" },
    data: {
      announcements: [
        {
          id: "1",
          title: "Community clean-up",
          detail: "Meet at the covered court.",
          date: "2026-11-10",
          approvalStatus: "approved",
          isEvent: true,
          latitude: 14.01799,
          longitude: 121.09465,
        },
        {
          id: "2",
          title: "Service notice",
          detail: "No collection on Sunday.",
          date: "2026-11-09",
          approvalStatus: "approved",
          isEvent: false,
          latitude: null,
          longitude: null,
        },
      ],
    },
    esc: (value) => String(value ?? ""),
    asDate: (value) => new Date(value),
    dateLabel: (value) => String(value),
    icon: () => "",
    panel: (_title, body) => `<section>${body}</section>`,
    actionButton: () => "",
    routeUrl: () => "",
    page: (_role, _pageName, body) => body,
  };
  runInNewContext(views, context);
  context.page = (_role, _pageName, body) => body;

  const announcements = context.announcementsPage("official");
  assert.match(announcements, /data-action="view-announcement-location" data-id="1"/);
  assert.match(announcements, /Community clean-up/);
  assert.match(announcements, /Event/);
  assert.match(announcements, /Service notice/);
  assert.doesNotMatch(announcements, /data-action="view-announcement-location" data-id="2"/);
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
    assert.deepEqual(state.data.users.map((user) => user.email), []);
    const sessionUser = await (await api(app, "/api/session", { cookie: signedIn.cookie })).json();
    assert.equal("passwordHash" in sessionUser.user, false);
    assert.equal("password_hash" in sessionUser.user, false);
    const reportId = "RPT-photo-test";
    const photoData = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    await mkdir(path.join(path.dirname(dataDir), "uploads", reportId), { recursive: true });
    await writeFile(path.join(path.dirname(dataDir), "uploads", reportId, "test.jpg"), photoData);
    await app.db.query(`
      INSERT INTO reports (id,user_email,name,category,title,area,description,status,submitted_at,updated_at)
      VALUES ($1,$2,'Test resident','Road damage','Test report','Purok 1','A report with a photo','Submitted',now(),now())
    `, [reportId, ADMIN_EMAIL]);
    await app.db.query(
      "INSERT INTO report_photos (report_id,position,name,photo_url) VALUES ($1,0,'test.jpg',$2)",
      [reportId, `/api/reports/${reportId}/photos/0/test.jpg`],
    );
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

test("limits repeated login attempts and prunes expired authentication data", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-auth-limits-"));
  const app = await startServer(dataDir);
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await api(app, "/api/auth/login", {
        method: "POST",
        body: { email: "unknown@example.test", password: "wrong-password" },
      });
      assert.equal(response.status, 401);
    }
    const limited = await api(app, "/api/auth/login", {
      method: "POST",
      body: { email: "unknown@example.test", password: "wrong-password" },
    });
    assert.equal(limited.status, 429);

    const ipKey = createHash("sha256").update("login-ip:127.0.0.1").digest("hex");
    await app.db.query(`
      INSERT INTO auth_attempts (attempt_key,attempts,window_started_at)
      VALUES ($1,100,now())
      ON CONFLICT (attempt_key) DO UPDATE SET attempts=100,window_started_at=now()
    `, [ipKey]);
    const ipLimited = await api(app, "/api/auth/login", {
      method: "POST",
      body: { email: "different-account@example.test", password: "wrong-password" },
    });
    assert.equal(ipLimited.status, 429);

    const administrator = await app.db.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL]);
    await app.db.query(
      "INSERT INTO auth_attempts (attempt_key,attempts,window_started_at) VALUES ('expired-test',1,now()-interval '2 days')",
    );
    await app.db.query(
      "INSERT INTO web_sessions (token_hash,user_id,expires_at) VALUES ('expired-test',$1,now()-interval '1 minute')",
      [administrator.rows[0].id],
    );
    assert.deepEqual(await pruneExpiredAuthState(app.db), { attempts: 1, sessions: 1 });
    const expiredRows = await app.db.query(`
      SELECT
        (SELECT count(*) FROM auth_attempts WHERE attempt_key='expired-test')::integer AS attempts,
        (SELECT count(*) FROM web_sessions WHERE token_hash='expired-test')::integer AS sessions
    `);
    assert.deepEqual(expiredRows.rows[0], { attempts: 0, sessions: 0 });
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("throttles repeated current-password guesses for a signed-in account", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-password-limits-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const attempt = () => api(app, "/api/auth/password", {
      method: "POST",
      cookie: admin.cookie,
      body: { currentPassword: "not-the-password", newPassword: "A-rotated-password-2026!", confirmPassword: "A-rotated-password-2026!" },
    });
    for (let guess = 0; guess < 5; guess += 1) assert.equal((await attempt()).status, 400);
    assert.equal((await attempt()).status, 429);

    const adminId = (await app.db.query("SELECT id FROM users WHERE email=$1", [ADMIN_EMAIL])).rows[0].id;
    await app.db.query("DELETE FROM auth_attempts WHERE attempt_key=$1", [createHash("sha256").update(`password-change:${adminId}`).digest("hex")]);
    const changed = await api(app, "/api/auth/password", {
      method: "POST",
      cookie: admin.cookie,
      body: { currentPassword: ADMIN_PASSWORD, newPassword: "A-rotated-password-2026!", confirmPassword: "A-rotated-password-2026!" },
    });
    assert.equal(changed.status, 200);
    const attempts = await app.db.query("SELECT count(*)::integer AS count FROM auth_attempts WHERE attempt_key=$1", [
      createHash("sha256").update(`password-change:${adminId}`).digest("hex"),
    ]);
    assert.equal(attempts.rows[0].count, 0);
    assert.equal((await signIn(app, ADMIN_EMAIL, "A-rotated-password-2026!")).response.status, 200);
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
      barangay: "Palsara",
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

test("submits a concern when an existing timestamp-based report ID exceeds integer range", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-report-timestamp-id-"));
  const app = await startServer(dataDir);
  try {
    const resident = await registerResident(app, "timestamp-report@example.test", "Timestamp Resident");
    const now = new Date().toISOString();
    const legacyReportId = "R1794145468286";
    await app.db.query(`
      INSERT INTO reports
        (id,user_email,name,category,title,area,barangay,location_detail,description,urgent,priority,status,submitted_at,updated_at)
      VALUES ($1,$2,$3,'Streetlight','Damaged streetlight','Purok 1','Palsara','Near the school',
        'The streetlight is not working near the school.',false,'Medium','Submitted',$4,$4)
    `, [legacyReportId, resident.email, resident.name, now]);
    await app.db.query(
      "INSERT INTO report_history (report_id,position,status,at,note) VALUES ($1,0,'Submitted',$2,'Report received.')",
      [legacyReportId, now],
    );

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
    assert.deepEqual(workingHoursData.officials.find((account) => account.id === officialAccount.id).availableDays, ["Tuesday", "Thursday", "Sunday"]);

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
    assert.deepEqual(residentHours.officials.find((account) => account.id === persistedOfficial.id), {
      id: persistedOfficial.id,
      name: "Official One",
      workingHours: "Monday, Saturday, 8:00 AM-5:00 PM",
      availableDays: ["Monday", "Saturday"],
    });

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
    let state = await api(app, "/api/state", { cookie: adminCookie }).then((response) => response.json());
    state.data.reports.push({
      id: "RPT-2026-overdue-01",
      userEmail: "overdue-resident@example.test",
      name: "Overdue Resident",
      category: "Drainage problem",
      title: "Blocked drain · Purok 1",
      area: "Purok 1",
      barangay: "Palsara",
      locationDetail: "Near the market",
      description: "The drain near the market is blocked and flooding the street.",
      urgent: false,
      priority: "Medium",
      status: "Submitted",
      submittedAt: old,
      updatedAt: old,
      photos: [],
      history: [{ status: "Submitted", at: old, note: "Report received." }],
    });
    const submitted = await api(app, "/api/state", {
      method: "PUT",
      cookie: adminCookie,
      body: { revision: state.revision, data: state.data },
    });
    assert.equal(submitted.status, 200);
    state = await api(app, "/api/state", { cookie: adminCookie }).then((response) => response.json());
    const report = state.data.reports.find((item) => item.id === "RPT-2026-overdue-01");
    assert.ok(report.responseDeadline);
    assert.ok(report.overdue, "a concern past its Medium-priority deadline is overdue");
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
      barangay: "Palsara",
      street: "Mabini Street",
      purok: "Purok 6",
      landmark: "Community Hall",
    });
    adminState.data.recyclingLocations.push({
      id: "REC-test-1",
      name: "Palsara Materials Recovery Center",
      barangay: "Palsara",
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
        area: "Palsara",
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
    assert.equal(announcement.isEvent, false);
    assert.equal(announcement.latitude, null);
    assert.equal(announcement.longitude, null);

    const createEventAnnouncement = await api(app, "/api/announcements", {
      method: "POST",
      cookie: official.cookie,
      body: {
        title: "Community clean-up",
        detail: "Meet at the covered court before the clean-up starts.",
        date: new Date().toISOString().slice(0, 10),
        isEvent: true,
        latitude: 14.01799,
        longitude: 121.09465,
      },
    });
    assert.equal(createEventAnnouncement.status, 200);
    const eventAnnouncementState = await createEventAnnouncement.json();
    const eventAnnouncement = eventAnnouncementState.data.announcements[0];
    assert.equal(eventAnnouncement.isEvent, true);
    assert.equal(eventAnnouncement.latitude, 14.01799);
    assert.equal(eventAnnouncement.longitude, 121.09465);

    const missingEventPin = await api(app, "/api/announcements", {
      method: "POST",
      cookie: official.cookie,
      body: {
        title: "Event without a pin",
        detail: "This event should be rejected.",
        date: new Date().toISOString().slice(0, 10),
        isEvent: true,
      },
    });
    assert.equal(missingEventPin.status, 400);

    const invalidEventPin = await api(app, "/api/announcements", {
      method: "POST",
      cookie: official.cookie,
      body: {
        title: "Event with an invalid pin",
        detail: "This event should be rejected.",
        date: new Date().toISOString().slice(0, 10),
        isEvent: true,
        latitude: 140,
        longitude: 121.09465,
      },
    });
    assert.equal(invalidEventPin.status, 400);

    const approveEventAnnouncement = await api(app, "/api/announcements/approval", {
      method: "POST",
      cookie: admin.cookie,
      body: { id: eventAnnouncement.id, status: "approved" },
    });
    assert.equal(approveEventAnnouncement.status, 200);
    const residentEventState = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    const residentEvent = residentEventState.data.announcements.find((item) => item.id === eventAnnouncement.id);
    assert.equal(residentEvent.isEvent, true);
    assert.equal(residentEvent.latitude, 14.01799);
    assert.equal(residentEvent.longitude, 121.09465);

    const toggleEventOff = await api(app, "/api/announcements", {
      method: "PUT",
      cookie: official.cookie,
      body: { ...eventAnnouncement, isEvent: false },
    });
    assert.equal(toggleEventOff.status, 200);
    const toggledEvent = (await toggleEventOff.json()).data.announcements.find((item) => item.id === eventAnnouncement.id);
    assert.equal(toggledEvent.isEvent, false);
    assert.equal(toggledEvent.latitude, null);
    assert.equal(toggledEvent.longitude, null);

    const deleteEventAnnouncement = await api(app, "/api/announcements", {
      method: "DELETE",
      cookie: official.cookie,
      body: { id: eventAnnouncement.id },
    });
    assert.equal(deleteEventAnnouncement.status, 200);

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

    const registeredNewArea = await api(app, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Purok Six Resident",
        email: "purok-six-resident@example.test",
        area: "Purok 6",
        password: "A-unique-resident-password!",
        confirmPassword: "A-unique-resident-password!",
      },
    });
    assert.equal(registeredNewArea.status, 201);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

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
    assert.deepEqual(saved.map((item) => item.id), ["GCS-2027-101", "GCS-2027-102", "GCS-2027-103"]);
    assert.deepEqual(saved.map((item) => item.date), ["2027-01-05", "2027-01-12", "2027-01-19"]);
    assert.equal(saved.every((item) => item.recurrenceEnd === "2027-01-19"), true);

    const residentAfterSeries = await api(app, "/api/state", { cookie: residentCookie }).then((response) => response.json());
    const addedNotifications = residentAfterSeries.data.notifications.filter((item) => item.title === "Collection schedule added for Purok 1");
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

    response = await put((item) => { item.status = "Delayed"; });
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
      item.history.push(entry("Scheduled", "Cancelled", "Holiday closure.", {
        previousDate: item.date, previousStart: item.start, previousEnd: item.end,
      }));
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
      item.history.push(entry("Cancelled", "Rescheduled", "Replacement after the holiday.", {
        previousDate: "2028-03-06",
        previousStart: "6:00 AM",
        previousEnd: "9:00 AM",
        replacementDate: "2028-03-08",
        replacementStart: "7:00 AM",
        replacementEnd: "10:00 AM",
      }));
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
  await assert.rejects(
    createCommunityServer({ dataDir: ":memory:", trustedProxyIps: "not-an-ip" }),
    /TRUSTED_PROXY_IPS/,
  );
  await assert.rejects(
    createCommunityServer({ dataDir: ":memory:", poolMax: 0 }),
    /PG_POOL_MAX/,
  );
});

async function registerResident(app, email, name) {
  const registered = await api(app, "/api/auth/register", {
    method: "POST",
    body: {
      name,
      email,
      area: "Purok 2",
      phone: "",
      password: "A-unique-resident-password!",
      confirmPassword: "A-unique-resident-password!",
    },
  });
  assert.equal(registered.status, 201);
  return { cookie: registered.headers.get("set-cookie").split(";")[0], email, name };
}

async function seedReport(app, { cookie, email, name }, overrides = {}) {
  const state = await api(app, "/api/state", { cookie }).then((r) => r.json());
  const now = new Date().toISOString();
  const report = {
    id: `RPT-limit-${overrides.idSuffix || "x"}`,
    userEmail: email,
    name: overrides.name || name,
    category: "Flooding",
    title: "Limit test drainage",
    area: "Purok 2",
    barangay: "Palsara",
    locationDetail: "Near the school",
    latitude: 14.01799,
    longitude: 121.09465,
    description: "Water pools near the school entrance after rain.",
    urgent: overrides.priority === "High",
    priority: overrides.priority || "Medium",
    status: overrides.status || "Submitted",
    submittedAt: now,
    updatedAt: now,
    photos: [],
    history: [{ status: overrides.status || "Submitted", at: now, note: "Report received." }],
  };
  const data = structuredClone(state.data);
  data.reports.push(report);
  data.activities.push({
    id: `A-limit-${overrides.idSuffix || "x"}`,
    actor: report.name,
    role: "resident",
    action: "Submitted a concern",
    detail: `${report.id} · ${report.title}`,
    at: now,
    result: "Success",
  });
  const created = await api(app, "/api/state", {
    method: "PUT",
    cookie,
    body: { revision: state.revision, data },
  });
  assert.equal(created.status, 200, `seedReport failed: ${await created.text()}`);
  return report.id;
}

async function postFollowUp(app, cookie, reportId, message = "Checking in on this concern.") {
  const response = await api(app, "/api/community/follow-up", {
    method: "POST",
    cookie,
    body: { reportId, message },
  });
  return { status: response.status, json: await response.json() };
}

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
    const { cookie: ownerCookie, email: ownerEmail, name: ownerName } = await registerResident(app, "resident.owner@example.test", "Report Owner");
    const reportId = await seedReport(app, { cookie: ownerCookie, email: ownerEmail, name: ownerName }, { idSuffix: "isolated", priority: "High" });

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
    const now = new Date().toISOString();

    // Seed report with 2 pre-existing follow-ups directly in the database
    const reportId = await seedReport(app, { cookie, email, name }, { idSuffix: "retro", priority: "Low" });
    await app.db.query(
      "INSERT INTO report_follow_ups(report_id, user_email, message) VALUES ($1, $2, $3), ($1, $2, $4)",
      [reportId, email, "Pre-existing follow-up one.", "Pre-existing follow-up two."],
    );

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
    const { cookie: residentCookie, email: residentEmail, name: residentName } = await registerResident(app, "resident.priority@example.test", "Resident Priority");
    const reportId = await seedReport(app, { cookie: residentCookie, email: residentEmail, name: residentName }, { idSuffix: "staff", priority: "Medium" });

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

async function createOfficial(app, adminCookie, email = "official@example.test", name = "Official One", extra = {}) {
  const created = await api(app, "/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      name,
      email,
      area: "Palsara",
      phone: "",
      role: "official",
      status: "Active",
      availableDays: ["Monday"],
      password: "A-unique-official-password!",
      ...extra,
    },
  });
  assert.equal(created.status, 201, `createOfficial failed: ${await created.text()}`);
  const signedIn = await signIn(app, email, "A-unique-official-password!");
  assert.equal(signedIn.response.status, 200);
  return signedIn.cookie;
}

test("report-priority rejects invalid, missing, unauthorized, resolved and over-quota changes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-priority-denials-"));
  const app = await startServer(dataDir);
  try {
    const { cookie: residentCookie, email: residentEmail, name: residentName } = await registerResident(app, "resident.denials@example.test", "Resident Denials");
    const highId = await seedReport(app, { cookie: residentCookie, email: residentEmail, name: residentName }, { idSuffix: "denials-high", priority: "High" });
    const resolvedId = await seedReport(app, { cookie: residentCookie, email: residentEmail, name: residentName }, { idSuffix: "denials-resolved", priority: "Medium" });
    await app.db.query("UPDATE reports SET status='Resolved' WHERE id=$1", [resolvedId]);

    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);

    // resident cannot change priority at all
    const residentAttempt = await api(app, "/api/community/report-priority", { method: "POST", cookie: residentCookie, body: { reportId: highId, priority: "Low" } });
    assert.equal(residentAttempt.status, 403);

    // invalid priority value
    const invalid = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId: highId, priority: "Urgent" } });
    assert.equal(invalid.status, 400);

    // missing report
    const missing = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId: "RPT-does-not-exist", priority: "Low" } });
    assert.equal(missing.status, 404);

    // resolved report cannot be re-prioritized
    const resolvedAttempt = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId: resolvedId, priority: "High" } });
    assert.equal(resolvedAttempt.status, 409);

    // same-priority is a no-op success
    const noop = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId: highId, priority: "High" } });
    assert.equal(noop.status, 200);

    // downgrade below existing follow-up count is rejected
    for (let i = 0; i < 4; i++) {
      const followUp = await postFollowUp(app, residentCookie, highId, `Follow-up ${i + 1} before downgrade.`);
      assert.equal(followUp.status, 200);
    }
    const downgrade = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId: highId, priority: "Low" } });
    assert.equal(downgrade.status, 400);

    // official with manageReports disabled via account override is denied server-side
    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    state.data.accountOverrides = { "official@example.test": { manageReports: false } };
    const saved = await api(app, "/api/state", { method: "PUT", cookie: admin.cookie, body: { revision: state.revision, data: state.data } });
    assert.equal(saved.status, 200, `override save failed: ${await saved.text()}`);

    // override must persist across a fresh read
    const reloaded = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    assert.deepEqual(reloaded.data.accountOverrides["official@example.test"], { manageReports: false });

    const overrideDenied = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId: highId, priority: "Medium" } });
    assert.equal(overrideDenied.status, 403);

    // non-admin cannot set overrides
    const state2 = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    state2.data.accountOverrides = { "official@example.test": {} };
    const officialAttempt = await api(app, "/api/state", { method: "PUT", cookie: officialCookie, body: { revision: state2.revision, data: state2.data } });
    assert.equal(officialAttempt.status, 403);

    // override for a non-official account is rejected
    const state3 = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    state3.data.accountOverrides = { [residentEmail]: { manageReports: true } };
    const badOverride = await api(app, "/api/state", { method: "PUT", cookie: admin.cookie, body: { revision: state3.revision, data: state3.data } });
    assert.equal(badOverride.status, 400);
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
    const base = { name: "Bad Official", area: "Palsara", phone: "", role: "official", status: "Active", password: "A-unique-official-password!" };

    const reversed = await api(app, "/api/users", { method: "POST", cookie: admin.cookie, body: { ...base, email: "reversed@example.test", workingHours: "Monday, 5:00 PM-8:00 AM", availableDays: ["Monday"] } });
    assert.equal(reversed.status, 400);

    const duplicate = await api(app, "/api/users", { method: "POST", cookie: admin.cookie, body: { ...base, email: "duplicate@example.test", availableDays: ["Monday", "Monday"] } });
    assert.equal(duplicate.status, 400);

    const unknownDay = await api(app, "/api/users", { method: "POST", cookie: admin.cookie, body: { ...base, email: "unknownday@example.test", availableDays: ["Funday"] } });
    assert.equal(unknownDay.status, 400);

    const malformedTime = await api(app, "/api/users", { method: "POST", cookie: admin.cookie, body: { ...base, email: "malformed@example.test", workingHours: "Monday, breakfast-lunch", availableDays: ["Monday"] } });
    assert.equal(malformedTime.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("event announcement rejects out-of-range and non-numeric coordinates on create and update", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-event-coords-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);
    const base = { title: "Coord test event", detail: "Event detail for coordinate validation.", date: new Date().toISOString().slice(0, 10), isEvent: true };

    const badLongitude = await api(app, "/api/announcements", { method: "POST", cookie: officialCookie, body: { ...base, latitude: 14.01799, longitude: 200 } });
    assert.equal(badLongitude.status, 400);

    const stringLatitude = await api(app, "/api/announcements", { method: "POST", cookie: officialCookie, body: { ...base, latitude: "14.01799", longitude: 121.09465 } });
    assert.equal(stringLatitude.status, 400);

    const created = await api(app, "/api/announcements", { method: "POST", cookie: officialCookie, body: { ...base, latitude: 14.01799, longitude: 121.09465 } });
    assert.equal(created.status, 200);
    const createdJson = await created.json();
    const announcementId = String(createdJson.data.announcements[0].id);

    const badUpdate = await api(app, "/api/announcements", { method: "PUT", cookie: officialCookie, body: { id: announcementId, ...base, title: "Coord test event updated", latitude: -200, longitude: 121.09465 } });
    assert.equal(badUpdate.status, 400);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("set-priority cells: Medium and Low apply urgent mapping and their follow-up limits", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-priority-cells-"));
  const app = await startServer(dataDir);
  try {
    const { cookie: residentCookie, email: residentEmail, name: residentName } = await registerResident(app, "resident.cells@example.test", "Resident Cells");
    const reportId = await seedReport(app, { cookie: residentCookie, email: residentEmail, name: residentName }, { idSuffix: "cells", priority: "High" });

    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);

    const toMedium = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId, priority: "Medium" } });
    assert.equal(toMedium.status, 200);
    let state = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    let report = state.data.reports.find((item) => item.id === reportId);
    assert.equal(report.priority, "Medium");
    assert.equal(report.urgent, false);
    assert.ok(report.history.some((item) => item.note === "Priority changed to Medium."));

    const toLow = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId, priority: "Low" } });
    assert.equal(toLow.status, 200);
    state = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    report = state.data.reports.find((item) => item.id === reportId);
    assert.equal(report.priority, "Low");
    assert.equal(report.urgent, false);
    assert.ok(report.history.some((item) => item.note === "Priority changed to Low."));

    // Low limit (3) now applies
    for (let i = 0; i < 3; i++) assert.equal((await postFollowUp(app, residentCookie, reportId, `Low cell follow-up ${i + 1}.`)).status, 200);
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
      body: { title: "Decline cell notice", detail: "This notice should be declined with a reason.", date: new Date().toISOString().slice(0, 10) },
    });
    assert.equal(created.status, 200);
    const createdJson = await created.json();
    const announcementId = String(createdJson.data.announcements[0].id);
    assert.equal(createdJson.data.announcements[0].approvalStatus, "pending");

    const declined = await api(app, "/api/announcements/approval", { method: "POST", cookie: admin.cookie, body: { id: announcementId, status: "declined", reason: "Not barangay business." } });
    assert.equal(declined.status, 200);

    const adminState = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const declinedItem = adminState.data.announcements.find((item) => String(item.id) === announcementId);
    assert.equal(declinedItem.approvalStatus, "declined");
    assert.equal(declinedItem.declineReason, "Not barangay business.");

    const resident = await registerResident(app, "resident.decline@example.test", "Resident Decline");
    const residentState = await api(app, "/api/state", { cookie: resident.cookie }).then((r) => r.json());
    assert.equal(residentState.data.announcements.some((item) => String(item.id) === announcementId), false, "declined announcement hidden from residents");

    // a decided announcement cannot be re-decided
    const redecide = await api(app, "/api/announcements/approval", { method: "POST", cookie: admin.cookie, body: { id: announcementId, status: "approved" } });
    assert.equal(redecide.status, 409);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("admin state update cannot bypass priority/status guards or set an unmanaged resident area", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-admin-guards-"));
  const app = await startServer(dataDir);
  try {
    const { cookie: residentCookie, email: residentEmail, name: residentName } = await registerResident(app, "resident.guards@example.test", "Resident Guards");
    const reportId = await seedReport(app, { cookie: residentCookie, email: residentEmail, name: residentName }, { idSuffix: "guards", priority: "High" });

    const admin = await signIn(app);

    // admin cannot change priority/status via generic state update
    let state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const tamperedPriority = structuredClone(state.data);
    tamperedPriority.reports.find((item) => item.id === reportId).priority = "Low";
    const priorityAttempt = await api(app, "/api/state", { method: "PUT", cookie: admin.cookie, body: { revision: state.revision, data: tamperedPriority } });
    assert.equal(priorityAttempt.status, 403);

    state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const tamperedStatus = structuredClone(state.data);
    tamperedStatus.reports.find((item) => item.id === reportId).status = "Resolved";
    const statusAttempt = await api(app, "/api/state", { method: "PUT", cookie: admin.cookie, body: { revision: state.revision, data: tamperedStatus } });
    assert.equal(statusAttempt.status, 403);

    // resident cannot move to an unmanaged area via state sync
    const residentState = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    const movedResident = structuredClone(residentState.data);
    movedResident.users[0].area = "Not a managed area";
    const areaAttempt = await api(app, "/api/state", { method: "PUT", cookie: residentCookie, body: { revision: residentState.revision, data: movedResident } });
    assert.equal(areaAttempt.status, 400);

    // resident can still save an unrelated profile change with legacy area intact
    const residentState2 = await api(app, "/api/state", { cookie: residentCookie }).then((r) => r.json());
    const renamed = structuredClone(residentState2.data);
    renamed.users[0].name = "Renamed Resident";
    const renameAttempt = await api(app, "/api/state", { method: "PUT", cookie: residentCookie, body: { revision: residentState2.revision, data: renamed } });
    assert.equal(renameAttempt.status, 200);
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
    const calendarAttempt = await api(app, "/api/calendar/events", { method: "POST", cookie: officialCookie, body: { title: "Blocked event", detail: "Should be denied.", date: new Date().toISOString().slice(0, 10) } });
    assert.equal(calendarAttempt.status, 403);

    assert.equal((await setOverrides({ "official@example.test": { manageAnnouncements: false } })).status, 200);
    const announcementAttempt = await api(app, "/api/announcements", { method: "POST", cookie: officialCookie, body: { title: "Blocked notice", detail: "Should be denied.", date: new Date().toISOString().slice(0, 10) } });
    assert.equal(announcementAttempt.status, 403);

    assert.equal((await setOverrides({ "official@example.test": { manageReports: "yes" } })).status, 400);
    assert.equal((await setOverrides({ "official@example.test": { fly: true } })).status, 400);

    // clearing overrides restores access
    assert.equal((await setOverrides({})).status, 200);
    const allowedAgain = await api(app, "/api/announcements", { method: "POST", cookie: officialCookie, body: { title: "Allowed notice", detail: "Access restored.", date: new Date().toISOString().slice(0, 10) } });
    assert.equal(allowedAgain.status, 200);
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
    const base = { name: "Boundary Official", area: "Palsara", phone: "", role: "official", status: "Active", availableDays: ["Monday"], password: "A-unique-official-password!" };

    const hour13 = await api(app, "/api/users", { method: "POST", cookie: admin.cookie, body: { ...base, email: "hour13@example.test", workingHours: "Monday, 13:00 PM-5:00 PM" } });
    assert.equal(hour13.status, 400);

    const minute60 = await api(app, "/api/users", { method: "POST", cookie: admin.cookie, body: { ...base, email: "minute60@example.test", workingHours: "Monday, 8:60 AM-5:00 PM" } });
    assert.equal(minute60.status, 400);

    const equal = await api(app, "/api/users", { method: "POST", cookie: admin.cookie, body: { ...base, email: "equal@example.test", workingHours: "Monday, 8:00 AM-8:00 AM" } });
    assert.equal(equal.status, 400);

    const midnightNoon = await api(app, "/api/users", { method: "POST", cookie: admin.cookie, body: { ...base, email: "midnightnoon@example.test", workingHours: "Monday, 12:00 AM-12:00 PM" } });
    assert.equal(midnightNoon.status, 201);
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

    const declined = await api(app, "/api/announcements/approval", { method: "POST", cookie: admin.cookie, body: { id: announcementId, status: "declined", reason: "Needs detail." } });
    assert.equal(declined.status, 200);

    const edited = await api(app, "/api/announcements", {
      method: "PUT",
      cookie: officialCookie,
      body: { id: announcementId, title: "Re-pend notice", detail: "Updated detail after decline.", date: new Date().toISOString().slice(0, 10) },
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

test("priority downgrade at exactly the new limit succeeds, then the next follow-up is blocked", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-downgrade-boundary-"));
  const app = await startServer(dataDir);
  try {
    const { cookie: residentCookie, email: residentEmail, name: residentName } = await registerResident(app, "resident.boundary@example.test", "Resident Boundary");
    const reportId = await seedReport(app, { cookie: residentCookie, email: residentEmail, name: residentName }, { idSuffix: "boundary", priority: "High" });

    for (let i = 0; i < 5; i++) {
      assert.equal((await postFollowUp(app, residentCookie, reportId, `Boundary follow-up ${i + 1}.`)).status, 200);
    }

    const admin = await signIn(app);
    const officialCookie = await createOfficial(app, admin.cookie);

    // 5 existing follow-ups == Medium limit (5): downgrade allowed, next follow-up blocked
    const downgrade = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId, priority: "Medium" } });
    assert.equal(downgrade.status, 200);

    const blocked = await postFollowUp(app, residentCookie, reportId, "One too many.");
    assert.equal(blocked.status, 429);

    // upgrading back to High (unlimited) unblocks
    const upgrade = await api(app, "/api/community/report-priority", { method: "POST", cookie: officialCookie, body: { reportId, priority: "High" } });
    assert.equal(upgrade.status, 200);
    assert.equal((await postFollowUp(app, residentCookie, reportId, "Unblocked again.")).status, 200);
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

test("failed sign-in attempts are logged as security events", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-failed-login-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);
    const failed = await api(app, "/api/auth/login", {
      method: "POST",
      body: { email: "nonexistent@example.test", password: "wrong-password!" },
    });
    assert.equal(failed.status, 401);

    const stateAfter = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const failedLoginEvents = stateAfter.data.activities.filter(
      (item) => item.action === "Failed sign-in" && item.result === "Failed",
    );
    assert.ok(failedLoginEvents.length >= 1, "Failed sign-in should be logged as a security event");
    const event = failedLoginEvents[0];
    assert.match(event.detail || "", /nonexistent/);
    assert.ok(event.resultReason);
    assert.ok(event.clientIp);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("analytics page shows report metrics and trends", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const core = await readFile(new URL("./app-core.js", import.meta.url), "utf8");
  const coreContext = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
    data: { permissions: {} },
  };
  runInNewContext(core, coreContext);

  const now = new Date().toISOString();
  const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
  const context = {
    ...coreContext,
    data: {
      permissions: {},
      reports: [
        {
          id: "RPT-2026-001",
          userEmail: "r1@example.test",
          name: "Resident One",
          category: "Road damage",
          title: "Pothole",
          area: "Purok 1",
          barangay: "Palsara",
          locationDetail: "Near hall",
          description: "A large pothole needs patching.",
          urgent: false,
          status: "Resolved",
          submittedAt: oldDate,
          updatedAt: now,
          photos: [],
          history: [
            { status: "Submitted", at: oldDate, note: "Report received." },
            { status: "Under Review", at: new Date(Date.now() - 5 * 86400000).toISOString(), note: "Reviewing.", actorName: "Official One", actorRole: "official" },
            { status: "Resolved", at: now, note: "Fixed.", actorName: "Official One", actorRole: "official" },
          ],
        },
        {
          id: "RPT-2026-002",
          userEmail: "r2@example.test",
          name: "Resident Two",
          category: "Drainage problem",
          title: "Blocked drain",
          area: "Purok 2",
          barangay: "Palsara",
          locationDetail: "Near market",
          description: "The drain is blocked.",
          urgent: false,
          status: "Submitted",
          submittedAt: now,
          updatedAt: now,
          photos: [],
          history: [{ status: "Submitted", at: now, note: "Report received." }],
        },
      ],
      users: [
        { id: "u1", name: "Official One", email: "official@example.test", role: "official", status: "Active" },
      ],
      schedules: [],
    },
    ROLES: { resident: "Resident", official: "Barangay official", administrator: "Administrator" },
    PERMISSION_DEFS: [],
    esc: (value) => String(value ?? ""),
    page: (_role, _view, body) => body,
    selectedPermissionRole: "official",
    permissionDrafts: {},
    permissionOpenGroups: {},
    currentUser: { id: "admin", name: "Admin User", email: "admin@example.test", role: "administrator", area: "Palsara" },
    modalState: null,
  };
  runInNewContext(views, context);

  const html = context.analyticsPage();
  assert.match(html, /Total reports/);
  assert.match(html, /Open reports/);
  assert.match(html, /Resolved reports/);
  assert.match(html, /Overdue concerns/);
  assert.match(html, /Avg. first review/);
  assert.match(html, /Avg. time to resolve/);
  assert.match(html, /Reports by area/);
  assert.match(html, /Reports by category/);
  assert.match(html, /Collection service/);
  assert.match(html, /Official workload/);
  assert.match(html, /Monthly submissions/);
  assert.match(html, /Purok 1/);
  assert.match(html, /Purok 2/);
  assert.match(html, /Road damage/);
  assert.match(html, /Drainage problem/);
});

test("authorization denials are logged as security events even without a session", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-authz-audit-"));
  const app = await startServer(dataDir);
  try {
    // No session cookie -> unauthenticated 403 on a protected endpoint
    const denied = await api(app, "/api/state", {
      method: "PUT",
      body: { revision: 0, data: { version: 1, users: [], reports: [], schedules: [], notifications: [], activities: [], announcements: [], locations: [], recyclingLocations: [], permissions: {} } },
    });
    assert.equal(denied.status, 401);

    const admin = await signIn(app);
    // Resident (not admin) hitting admin-only endpoint -> 403 with user
    const residentCookie = await (() => {
      return api(app, "/api/auth/register", {
        method: "POST",
        body: {
          name: "Audit Resident",
          email: "audit-resident@example.test",
          area: "Purok 1",
          password: "A-unique-resident-password!",
          confirmPassword: "A-unique-resident-password!",
        },
      }).then((r) => r.headers.get("set-cookie")?.split(";")[0] || "");
    })();

    const state = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const tampered = structuredClone(state.data);
    tampered.permissions.administrator.manageUsers = false;
    const elevation = await api(app, "/api/state", {
      method: "PUT",
      cookie: residentCookie,
      body: { revision: state.revision, data: tampered },
    });
    assert.equal(elevation.status, 403);

    const stateAfter = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    const denialEvents = stateAfter.data.activities.filter(
      (item) => item.action === "Authorization denied" && item.result === "Failed",
    );
    assert.ok(denialEvents.length >= 1, "Authorization denial should be logged as a security event");
    const event = denialEvents[0];
    assert.ok(event.resultReason);
    assert.ok(event.clientIp);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("activity archive endpoint returns archived records", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "community-archive-"));
  const app = await startServer(dataDir);
  try {
    const admin = await signIn(app);

    // Insert an activity older than 90 days directly, then run the archive query
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
    await app.db.query(
      "INSERT INTO activities (id, actor, role, action, detail, at, result) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      ["ARCH-OLD-1", "Archived Actor", "administrator", "Archived action", "Archived detail", oldDate, "Success"],
    );

    await app.db.query(
      "INSERT INTO activity_archive (id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, archived_at) SELECT id, actor, role, action, detail, at, result, result_reason, affected_id, client_ip, now() FROM activities WHERE at < now() - interval '90 days'",
    );
    await app.db.query("DELETE FROM activities WHERE at < now() - interval '90 days'");

    const archive = await api(app, "/api/community/activity-archive", { cookie: admin.cookie });
    assert.equal(archive.status, 200);
    const body = await archive.json();
    assert.ok(Array.isArray(body.activities));
    assert.ok(body.activities.some((item) => item.id === "ARCH-OLD-1"), "Archived record should be readable via endpoint");
    assert.ok(body.activities.some((item) => item.archivedAt), "Archived record should have archivedAt timestamp");

    // Current activities should not include the archived one
    const currentState = await api(app, "/api/state", { cookie: admin.cookie }).then((r) => r.json());
    assert.ok(!currentState.data.activities.some((item) => item.id === "ARCH-OLD-1"), "Archived record should not appear in current activities");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
