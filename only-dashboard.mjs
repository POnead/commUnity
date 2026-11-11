import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

test("renders latest reports with status pill and view button on resident dashboard", async () => {
  const views = await readFile(new URL("./app-views.js", import.meta.url), "utf8");
  const esc = (value) => String(value ?? "");
  const asDate = (value) => new Date(value);
  const context = {
    currentUser: { role: "resident", area: "Purok 1", email: "resident@example.test" },
    communityOfficialHours: [],
    data: { announcements: [], reports: [], schedules: [], users: [] },
    EMERGENCY_HOTLINES: [],
    esc, asDate,
    dateLabel: (value) => String(value),
    userReports: () => [{ id: "RPT-2026-001", title: "Blocked drainage", status: "Submitted", updatedAt: "2026-11-01T10:00:00.000Z" }],
    sortedReports: (reports = []) => [...reports],
    sortedSchedules: () => [],
    upcomingSchedule: () => null,
    statusPill: (status) => `<span class="status">${esc(status)}</span>`,
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
