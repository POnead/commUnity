import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createContext, runInContext, runInNewContext } from "node:vm";

test("renders saved concern pins inline for residents and officials with a directions fallback", async () => {
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
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
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
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
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
  const context = {
    currentUser: { role: "resident", area: "Purok 1", email: "resident@example.test" },
    communityOfficialHours: [],
    data: { announcements: [], reports: [], schedules: [], users: [] },
    EMERGENCY_HOTLINES: [],
    esc: (value) => String(value ?? ""),
    asDate: (value) => new Date(value),
    dateLabel: (value) => String(value),
    userReports: () => [
      {
        id: "RPT-2026-001",
        title: "Blocked drainage",
        status: "Submitted",
        updatedAt: "2026-11-01T10:00:00.000Z",
      },
    ],
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
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
  const context = {};
  runInNewContext(views, context);

  assert.equal(context.displayReportId("R1794145468286"), "R-MW7VVZB2");
  assert.equal(context.displayReportId("R1794145468286-7wnokm"), "R-MW7VVZB2-7WNOKM");
  assert.equal(context.displayReportId("R-4J8K2M9W7Q"), "R-4J8K2M9W7Q");
  assert.equal(context.displayReportId("R-MJ9F3F4A-7WNOKM"), "R-MJ9F3F4A-7WNOKM");
});

test("builds the report draft with the priority selected in the form", async () => {
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
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
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
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
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
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
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
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
    APP_TIME_ZONE: "Asia/Manila",
    PERMISSION_DEFS: [
      {
        id: "submitReports",
        label: "Submit and track concerns",
        group: "Community services",
        description: "Create concerns and view their updates.",
      },
      {
        id: "viewSchedules",
        label: "View collection schedules",
        group: "Community services",
        description: "See posted collection dates and service updates.",
      },
      {
        id: "manageReports",
        label: "Review and update reports",
        group: "Community services",
        description: "Review resident concerns and record status updates.",
      },
      {
        id: "manageSchedules",
        label: "Manage collection schedules",
        group: "Community services",
        description: "Create, update, and remove service schedules.",
      },
      {
        id: "manageAnnouncements",
        label: "Manage announcements",
        group: "Community services",
        description: "Publish or remove updates shared with residents.",
      },
      {
        id: "manageUsers",
        label: "Manage user accounts",
        group: "Portal administration",
        description: "Review accounts and adjust access in this workspace.",
      },
      {
        id: "manageRoles",
        label: "Change role permissions",
        group: "Portal administration",
        description: "Choose which workspace functions each role can access.",
      },
      {
        id: "viewAudit",
        label: "Review activity history",
        group: "Portal administration",
        description: "Review recorded account and service activity.",
      },
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
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
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
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
  const context = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
  };
  runInNewContext(core, context);

  assert.deepEqual(Array.from(context.scheduleOccurrenceDates("2026-11-02", "Weekly", "2026-11-30")), [
    "2026-11-02",
    "2026-11-09",
    "2026-11-16",
    "2026-11-23",
    "2026-11-30",
  ]);
  assert.deepEqual(Array.from(context.scheduleOccurrenceDates("2026-11-02", "Bi-weekly", "2026-12-01")), [
    "2026-11-02",
    "2026-11-16",
    "2026-11-30",
  ]);
  assert.deepEqual(Array.from(context.scheduleOccurrenceDates("2026-01-31", "Monthly", "2026-04-30")), [
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ]);
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
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
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
    status: "Delayed",
    note: "Heavy rain flooded the route.",
    actorName: "Official One",
    actorRole: "official",
  });
  assert.equal(delayed.previousStatus, "Scheduled");
  assert.equal(delayed.status, "Delayed");
  assert.equal(delayed.note, "Heavy rain flooded the route.");
  assert.equal(delayed.actorName, "Official One");
  assert.equal(delayed.previousDate, "2028-03-06");

  assert.throws(
    () =>
      context.scheduleStatusEntry(scheduled, {
        status: "Rescheduled",
        note: "Next slot.",
        date: "2028-03-06",
        start: "6:00 AM",
        end: "9:00 AM",
      }),
    /Change the pickup date or time/,
  );
  assert.throws(
    () =>
      context.scheduleStatusEntry(scheduled, {
        status: "Rescheduled",
        date: "2028-03-08",
        start: "10:00 AM",
        end: "7:00 AM",
      }),
    /valid replacement pickup time/,
  );

  const moved = context.scheduleStatusEntry(scheduled, {
    status: "Rescheduled",
    note: "Next available slot.",
    date: "2028-03-08",
    start: "7:00 AM",
    end: "10:00 AM",
  });
  assert.equal(moved.replacementDate, "2028-03-08");
  assert.equal(moved.replacementStart, "7:00 AM");
  assert.equal(moved.replacementEnd, "10:00 AM");
  assert.equal(moved.previousDate, "2028-03-06");
  assert.equal(moved.previousStart, "6:00 AM");
});

test("collection history markup shows status transitions, reasons and replacements", async () => {
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
  const context = { esc: (value) => String(value ?? ""), dateLabel: (value) => String(value), dateTimeLabel: (value) => String(value) };
  runInNewContext(views, context);

  const html = context.scheduleHistoryMarkup([
    { previousStatus: null, status: "Scheduled", note: "Collection scheduled.", actorName: "Official One", at: "2028-03-01T08:00:00.000Z" },
    {
      previousStatus: "Scheduled",
      status: "Cancelled",
      note: "Holiday closure.",
      actorName: "Official Two",
      at: "2028-03-05T10:00:00.000Z",
    },
  ]);
  assert.match(html, /Scheduled → Cancelled/);
  assert.match(html, /Holiday closure\./);
  assert.match(html, /By Official Two/);
  assert.match(html, /Collection scheduled\./);
  assert.ok(html.indexOf("Cancelled") < html.indexOf("Collection scheduled."), "newest entry should render first");

  const moved = context.scheduleHistoryMarkup([
    {
      previousStatus: "Scheduled",
      status: "Rescheduled",
      note: "Route change.",
      actorName: "Official One",
      at: "2028-03-05T10:00:00.000Z",
      replacementDate: "2028-03-08",
      replacementStart: "7:00 AM",
      replacementEnd: "10:00 AM",
    },
  ]);
  assert.match(moved, /Replacement pickup: 2028-03-08, 7:00 AM–10:00 AM/);
  assert.match(context.scheduleHistoryMarkup([]), /No status changes recorded/);
});

test("resident area choices come from managed Palsara locations", async () => {
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
  const context = {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
  };
  runInNewContext(core, context);
  runInNewContext(views, context);
  runInNewContext(
    `data = { locations: [
    { id: "LOC-6", area: "Purok 6", barangay: "Palsara", purok: "Purok 6", street: "", landmark: "" },
    { id: "LOC-7", area: "Purok 7", barangay: "Palsara", purok: "Purok 7", street: "", landmark: "" },
    { id: "LOC-8", area: "San Isidro Proper", barangay: "San Isidro", purok: "Purok 1", street: "", landmark: "" }
  ] };`,
    context,
  );

  assert.deepEqual(Array.from(context.residentAreaOptions()), ["Purok 6", "Purok 7"]);
  assert.equal(context.isResidentArea("Purok 6"), true);
  assert.equal(context.isResidentArea("San Isidro Proper"), false);

  const markup = context.registerMarkup();
  assert.match(markup, />Purok 6</);
  assert.match(markup, />Purok 7</);
  assert.doesNotMatch(markup, /San Isidro Proper/);
});

test("renders an event location action only for event announcements", async () => {
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
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

test("analytics page shows report metrics and trends", async () => {
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
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
            {
              status: "Under Review",
              at: new Date(Date.now() - 5 * 86400000).toISOString(),
              note: "Reviewing.",
              actorName: "Official One",
              actorRole: "official",
            },
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
      users: [{ id: "u1", name: "Official One", email: "official@example.test", role: "official", status: "Active" }],
      schedules: [],
    },
    ROLES: { resident: "Resident", official: "Barangay official", administrator: "Administrator" },
    APP_TIME_ZONE: "Asia/Manila",
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

test("the activity log page browses the server page with filters and a detail action", async () => {
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
  const context = createContext({
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
    console,
  });
  runInContext(core, context);
  runInContext(views, context);
  context.__user = { id: "admin", name: "Admin User", email: "admin@example.test", role: "administrator", area: "Palsara" };
  context.__filters = { from: "", to: "", actor: "", action: "", result: "", affectedId: "", source: "all" };
  context.__state = {
    activities: [
      {
        id: "LOG-1",
        actor: "system",
        role: "system",
        action: "Authorization denied",
        detail: "Request refused",
        at: "2026-11-12T09:00:00.000Z",
        result: "Failed",
        resultReason: "Your account cannot perform this action.",
        affectedId: "R-42",
        clientIp: "203.0.113.9",
        source: "current",
        archivedAt: null,
      },
    ],
    total: 36,
    page: 2,
    pageSize: 25,
    pageCount: 2,
    summary: { total: 36, current: 31, archived: 5, failed: 6, accounts: 20, reports: 0, services: 0 },
  };
  runInContext(
    "currentUser = __user; activityFilters = __filters; activityLogState = __state; data = { permissions: {}, notifications: [], reports: [], users: [], schedules: [] };",
    context,
  );

  const html = runInContext("activityLogPage()", context);
  assert.match(html, /Activity Log/);
  assert.match(html, /From date/);
  assert.match(html, /To date/);
  assert.match(html, /Affected record/);
  assert.match(html, /Archived only/);
  assert.match(html, /Apply filters/);
  assert.match(html, /Export CSV/);
  assert.match(html, /Matching records/);
  assert.match(html, /Failed events/);
  assert.match(html, /Authorization denied/);
  assert.match(html, /system/);
  assert.match(html, /Page 2 of 2/);
  assert.match(html, /36 records/);
  assert.match(html, /data-action="view-activity"/);
  assert.match(html, /data-action="activity-page"/);
});

function stubJsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("the browser retries a save once when only server-owned notifications moved", async () => {
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
  const base = {
    version: 1,
    users: [],
    reports: [],
    schedules: [],
    activities: [],
    permissions: {},
    accountOverrides: {},
    announcements: [],
    calendarEvents: [],
    locations: [],
    recyclingLocations: [],
    notifications: [
      {
        id: "N-1",
        targetEmail: "r@example.test",
        reportId: "",
        title: "Old",
        body: "b",
        createdAt: "2026-01-01T00:00:00.000Z",
        read: false,
      },
    ],
  };
  // A reminder the server created while the resident worked, so the browser's
  // list is one row behind the database.
  const fresh = structuredClone(base);
  fresh.notifications.unshift({
    id: "N-2",
    targetEmail: "r@example.test",
    reportId: "",
    title: "Collection reminder",
    body: "b",
    createdAt: "2026-01-02T00:00:00.000Z",
    read: false,
  });
  const saved = structuredClone(fresh);

  const calls = [];
  let putAttempts = 0;
  const context = createContext({
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
    console,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      if (options.method === "PUT") {
        putAttempts += 1;
        if (putAttempts === 1) return stubJsonResponse(409, { error: "Data changed in another session. Reload before saving." });
        return stubJsonResponse(200, { revision: 8, data: saved, user: { role: "resident" } });
      }
      return stubJsonResponse(200, { data: fresh, revision: 7, user: { role: "resident" } });
    },
  });
  runInContext(core, context);
  context.toast = () => {};
  runInContext(
    `
    data = ${JSON.stringify(base)};
    dataRevision = 6;
    lastPersistedSnapshot = ${JSON.stringify(JSON.stringify(base))};
    currentUser = { role: "resident", email: "r@example.test" };
  `,
    context,
  );

  const outcome = await runInContext("localSave()", context);
  assert.equal(outcome, true, "the save succeeds after the resync");
  assert.equal(calls.length, 3, "one save attempt, one state refresh, one retry");
  assert.equal(calls[0].body.revision, 6);
  assert.equal(calls[2].body.revision, 7, "the retry carries the refreshed revision");
  assert.equal(
    calls[2].body.data.notifications.some((item) => item.id === "N-1"),
    true,
    "the retry keeps the browser's own notification list",
  );
  const afterSave = runInContext("({ data, dataRevision })", context);
  assert.equal(afterSave.dataRevision, 8, "the browser adopts the revision the save produced");
  assert.equal(JSON.stringify(afterSave.data), JSON.stringify(saved), "the browser adopts the saved server state");
});

test("the browser does not retry a save when shared data moved with the revision", async () => {
  const core = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
  const base = {
    version: 1,
    users: [],
    reports: [],
    schedules: [],
    activities: [],
    permissions: {},
    accountOverrides: {},
    announcements: [],
    calendarEvents: [],
    locations: [],
    recyclingLocations: [],
    notifications: [],
  };
  const fresh = structuredClone(base);
  fresh.schedules.push({
    id: "GCS-other",
    area: "Purok 2",
    zone: "Zone A",
    date: "2026-01-02",
    wasteType: "Recyclables",
    start: "6:00 AM",
    end: "9:00 AM",
    frequency: "Weekly",
    team: "Team A",
    status: "Scheduled",
    history: [],
  });
  const edited = structuredClone(base);
  edited.reports.push({ id: "RPT-mine", userEmail: "r@example.test", title: "My concern" });

  const calls = [];
  const context = createContext({
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
    console,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      if (options.method === "PUT") return stubJsonResponse(409, { error: "Data changed in another session. Reload before saving." });
      return stubJsonResponse(200, { data: fresh, revision: 7, user: { role: "resident" } });
    },
  });
  runInContext(core, context);
  context.toast = () => {};
  runInContext(
    `
    data = ${JSON.stringify(edited)};
    dataRevision = 6;
    lastPersistedSnapshot = ${JSON.stringify(JSON.stringify(base))};
    currentUser = { role: "resident", email: "r@example.test" };
  `,
    context,
  );

  const outcome = await runInContext("localSave()", context);
  assert.equal(outcome, false, "the save is refused when shared data really moved");
  assert.equal(calls.length, 2, "one save attempt and one state refresh, no blind retry");
  const afterSave = runInContext("({ data })", context);
  assert.equal(JSON.stringify(afterSave.data), JSON.stringify(base), "the browser rolls back to its last persisted snapshot");
});

test("a High priority concern renders unlimited follow-ups, a Medium one shows the cap", async () => {
  const views = await readFile(new URL("../app-views.js", import.meta.url), "utf8");
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
    currentUser: { id: "resident-one", role: "resident", name: "Resident Example" },
    esc: (value) => String(value ?? ""),
    panel: (title, body) => `<section><h2>${title}</h2>${body}</section>`,
    statusPill: (status) => `<span>${status}</span>`,
    selectField: () => "",
    reportAssignmentAction: () => "",
    timelineMarkup: () => "",
    initials: () => "",
    dateTimeLabel: () => "",
    dateLabel: () => "",
    getUser: () => null,
    page: (_role, _listPage, body) => body,
  };
  runInNewContext(views, context);
  // The views file declares its own page/panel; override them after evaluation so
  // the ROLES lookup inside page() is never reached.
  context.panel = (title, body) => `<section><h2>${title}</h2>${body}</section>`;
  context.page = (_role, _listPage, body) => body;

  const report = {
    id: "RPT-followup-limit",
    title: "Blocked drainage",
    category: "Drainage problem",
    status: "Submitted",
    description: "The drain is blocked beside the community hall.",
    barangay: "Palsara",
    area: "Purok 2",
    locationDetail: "Beside the community hall",
    latitude: null,
    longitude: null,
    submittedAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    history: [],
    photos: [],
    assignedTo: null,
    name: "Resident Example",
    userEmail: "resident@example.test",
    followUpCount: 6,
  };

  const high = context.reportDetail({ ...report, priority: "High" }, "resident");
  assert.match(high, /High priority · Unlimited follow-ups\./);
  assert.match(high, /id="follow-up-form"/, "an urgent concern accepts follow-ups past the Medium cap");

  const medium = context.reportDetail({ ...report, priority: "Medium" }, "resident");
  assert.match(medium, /Medium priority · 0 of 5 follow-ups remaining\./);
  assert.doesNotMatch(medium, /id="follow-up-form"/, "a Medium concern at five follow-ups closes the form");

  const low = context.reportDetail({ ...report, priority: "Low", followUpCount: 3 }, "resident");
  assert.match(low, /Low priority · 0 of 3 follow-ups remaining\./);
  assert.doesNotMatch(low, /id="follow-up-form"/);
});
