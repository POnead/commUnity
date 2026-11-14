// Browser-level coverage of the administrator workspace: account management,
// role permissions and per-official overrides, analytics, and the activity log.
//
// The backend has integration coverage for these endpoints; this suite proves
// the administrator's actual screens are wired to them. It shares the seeded
// e2e server with commUnity.spec.mjs, so it is serial and seeds what it needs
// through the API before driving the browser (the e2e server has no SMTP, so
// the password-reset UI is expected to surface that server error).
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@example.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "AdminTestPassword-2026!";
const MANAGED_EMAIL = "browser-managed@example.test";
const MANAGED_PASSWORD = "BrowserManagedPassword-2026!";
const MANAGED_NAME = "Browser Managed Resident";
const MANAGED_UPDATED_NAME = "Browser Managed Resident Updated";
const OFFICIAL_EMAIL = "admin.spec.official@example.test";
const OFFICIAL_NAME = "Admin Spec Official";
const ORIGIN = { Origin: "http://127.0.0.1:8799" };

async function apiLogin(api) {
  const response = await api.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: ORIGIN,
  });
  expect(response.ok()).toBeTruthy();
}

async function ensureOfficial(api) {
  await apiLogin(api);
  const response = await api.post("/api/users", {
    headers: ORIGIN,
    data: {
      name: OFFICIAL_NAME,
      email: OFFICIAL_EMAIL,
      area: "Purok 3",
      phone: "",
      role: "official",
      status: "Active",
      workingHours: "Monday-Friday, 8:00 AM-5:00 PM",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      password: "AdminSpecOfficialPassword-2026!",
    },
  });
  expect([201, 400, 409]).toContain(response.status());
}

async function login(page) {
  await page.goto("/#/login");
  await page.locator("#login-form #email").fill(ADMIN_EMAIL);
  await page.locator("#login-form #password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/administrator\/dashboard/);
}

function userRow(page, email) {
  return page.locator(".user-record").filter({ hasText: email });
}

async function confirm(page) {
  await page.locator("[data-confirm='accept']").click();
}

// The roles page refreshes itself every 30 seconds and rebuilds the DOM. The
// app keeps an expanded override panel expanded across that rebuild, but a
// blind summary click would collapse it, so only click when it is closed and
// then assert the panel really is open before touching its controls.
async function openOfficialOverrides(page) {
  const details = page.locator("details.permission-account").filter({ hasText: OFFICIAL_EMAIL });
  await expect(details).toBeVisible();
  if (!(await details.evaluate((element) => element.open))) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
  return details;
}

test.describe.configure({ mode: "serial" });

test("1. administrator manages an account through the user interface", async ({ page }) => {
  await login(page);
  await page.goto("/#/administrator/users");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();

  // Create a resident through the same modal an administrator uses.
  await page.getByRole("button", { name: "Add user" }).click();
  const form = page.locator("#user-form");
  await expect(form).toBeVisible();
  await form.locator('[name="name"]').fill(MANAGED_NAME);
  await form.locator('[name="email"]').fill(MANAGED_EMAIL);
  await form.locator('[name="phone"]').fill("09179990000");
  await form.locator('[name="area"]').selectOption("Purok 3");
  await form.locator('[name="role"]').selectOption("resident");
  await form.locator('[name="password"]').fill(MANAGED_PASSWORD);
  await page.getByRole("button", { name: "Add account" }).click();
  await confirm(page);
  await expect(page.locator("#toast")).toContainText("Account added.");
  await expect(userRow(page, MANAGED_EMAIL)).toContainText(MANAGED_NAME);

  // The account can be searched and the filters narrow the list.
  await page.locator("[data-search-input]").fill("browser-managed");
  await expect(userRow(page, MANAGED_EMAIL)).toBeVisible();
  await page.locator("[data-search-input]").fill("no-such-account");
  await expect(userRow(page, MANAGED_EMAIL)).toBeHidden();
  await page.locator("[data-search-input]").fill("");
  await expect(userRow(page, MANAGED_EMAIL)).toBeVisible();
  await page.locator("[data-user-role-filter]").selectOption("resident");
  await page.locator("[data-user-status-filter]").selectOption("Active");
  await expect(userRow(page, MANAGED_EMAIL)).toBeVisible();
  await page.locator("[data-user-role-filter]").selectOption("all");
  await page.locator("[data-user-status-filter]").selectOption("all");

  // Edit the account and confirm the saved value is rendered.
  await userRow(page, MANAGED_EMAIL).getByRole("button", { name: "Edit" }).click();
  await expect(form).toBeVisible();
  await form.locator('[name="name"]').fill(MANAGED_UPDATED_NAME);
  await page.getByRole("button", { name: "Save account" }).click();
  await confirm(page);
  await expect(page.locator("#toast")).toContainText("Account updated.");
  await expect(userRow(page, MANAGED_EMAIL)).toContainText(MANAGED_UPDATED_NAME);

  // Deactivate with a recorded reason, then reactivate from the same editor.
  await userRow(page, MANAGED_EMAIL).getByRole("button", { name: "Edit" }).click();
  await form.getByRole("button", { name: "Deactivate account" }).click();
  const deactivateForm = page.locator("#deactivate-form");
  await expect(deactivateForm).toBeVisible();
  await deactivateForm.locator("#deactivate-reason").fill("Moved to another barangay.");
  await deactivateForm.getByRole("button", { name: "Deactivate account" }).click();
  await confirm(page);
  await expect(page.locator("#toast")).toContainText("is inactive.");
  await expect(userRow(page, MANAGED_EMAIL)).toContainText("Inactive");

  await page.locator("[data-user-status-filter]").selectOption("Inactive");
  await expect(userRow(page, MANAGED_EMAIL)).toBeVisible();
  await page.locator("[data-user-status-filter]").selectOption("Active");
  await expect(userRow(page, MANAGED_EMAIL)).toBeHidden();
  await page.locator("[data-user-status-filter]").selectOption("all");

  await userRow(page, MANAGED_EMAIL).getByRole("button", { name: "Edit" }).click();
  await form.getByRole("button", { name: "Reactivate account" }).click();
  await confirm(page);
  await expect(page.locator("#toast")).toContainText("is active.");
  await expect(userRow(page, MANAGED_EMAIL)).toContainText("Active");

  // Password reset is wired to the endpoint; without SMTP the server refuses
  // and the interface must surface that refusal instead of claiming success.
  await userRow(page, MANAGED_EMAIL).getByRole("button", { name: "Edit" }).click();
  await form.getByRole("button", { name: "Reset password" }).click();
  const passwordForm = page.locator("#user-password-form");
  await expect(passwordForm).toBeVisible();
  await passwordForm.getByRole("button", { name: "Approve & Generate" }).click();
  await confirm(page);
  await expect(page.locator("#toast")).toContainText("Email service is not configured");
  await expect(passwordForm).toBeVisible();
  await passwordForm.getByRole("button", { name: "Cancel" }).click();
});

test("2. administrator edits role permissions and per-official overrides", async ({ page, request: api }) => {
  await ensureOfficial(api);
  await login(page);
  await page.goto("/#/administrator/roles");
  await expect(page.getByRole("heading", { name: "Role defaults" })).toBeVisible();

  // Role defaults: change, discard, save, then restore.
  await page.locator('[data-action="select-permission-role"][data-role="resident"]').click();
  const scheduleSwitch = page.locator('[data-action="toggle-permission"][data-permission="viewSchedules"]');
  await expect(scheduleSwitch).toHaveAttribute("aria-checked", "true");
  await scheduleSwitch.click();
  await expect(scheduleSwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("1 unsaved change for Resident")).toBeVisible();

  await page.getByRole("button", { name: "Discard changes" }).click();
  await confirm(page);
  await expect(page.locator("#toast")).toContainText("discarded");
  await expect(page.getByText("unsaved change for Resident")).toHaveCount(0);
  await expect(scheduleSwitch).toHaveAttribute("aria-checked", "true");

  await scheduleSwitch.click();
  await page.getByRole("button", { name: "Save role defaults" }).click();
  await confirm(page);
  await expect(page.locator("#toast")).toContainText("Resident permissions saved.");
  await expect(page.getByText("unsaved change for Resident")).toHaveCount(0);
  await expect(scheduleSwitch).toHaveAttribute("aria-checked", "false");

  await scheduleSwitch.click();
  await page.getByRole("button", { name: "Save role defaults" }).click();
  await confirm(page);
  await expect(scheduleSwitch).toHaveAttribute("aria-checked", "true");

  // Per-official override on the seeded official, then clear it.
  const details = page.locator("details.permission-account").filter({ hasText: OFFICIAL_EMAIL });
  await expect(details).toContainText(OFFICIAL_NAME);
  await expect(details).not.toHaveAttribute("open", "");
  const reportsRow = details.locator(".permission-row").filter({ hasText: "Review and update reports" });

  await openOfficialOverrides(page);
  await reportsRow.getByRole("button", { name: "Disable override" }).click();
  await page.locator(".confirm-modal").getByRole("button", { name: "Disable", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("Barangay official permissions saved.");
  await expect(details).toContainText("Override: Disabled");
  await expect(details).toContainText("Effective: Off");

  await openOfficialOverrides(page);
  await reportsRow.getByRole("button", { name: "Clear override" }).click();
  await page.locator(".confirm-modal").getByRole("button", { name: "Clear override", exact: true }).click();
  await expect(page.locator("#toast")).toContainText(`Override cleared for ${OFFICIAL_NAME}.`);
  await expect(details).toContainText("Role default");
  await expect(details).toContainText("Effective: On");

  // The effective-permissions table reflects the computed result.
  const effective = page.locator(".permission-effective-table").filter({ hasText: OFFICIAL_EMAIL });
  await expect(effective).toContainText(OFFICIAL_NAME);
});

test("3. administrator sees analytics for reports, areas, and official workload", async ({ page, request: api }) => {
  await apiLogin(api);
  const stateResponse = await api.get("/api/state");
  expect(stateResponse.ok()).toBeTruthy();
  const state = await stateResponse.json();
  const now = new Date().toISOString();
  state.data.reports.push({
    id: "RPT-admin-analytics",
    userEmail: ADMIN_EMAIL,
    name: "Portal administrator",
    category: "Flooding",
    title: "Analytics seeded concern",
    area: "Purok 2",
    barangay: "Palsara",
    locationDetail: "Near the covered court",
    latitude: 14.01799,
    longitude: 121.09465,
    description: "Water pools near the covered court after heavy rain.",
    urgent: false,
    priority: "Medium",
    status: "Submitted",
    submittedAt: now,
    updatedAt: now,
    photos: [],
    history: [{ status: "Submitted", at: now, note: "Report received." }],
  });
  const saved = await api.put("/api/state", {
    headers: ORIGIN,
    data: { revision: state.revision, data: state.data },
  });
  expect(saved.ok()).toBeTruthy();

  await login(page);
  await page.goto("/#/administrator/analytics");
  await expect(page.getByRole("heading", { name: "Reports by area" })).toBeVisible();
  const total = page.locator(".stat").filter({ hasText: "Total reports" }).locator(".stat-value");
  await expect(total).not.toHaveText("0");
  await expect(page.locator("body")).toContainText("Open reports");
  await expect(page.locator("body")).toContainText("Avg. first review");
  await expect(page.getByRole("heading", { name: "Reports by area" })).toBeVisible();
  await expect(page.locator(".plain-list").filter({ hasText: "Purok 2" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reports by category" })).toBeVisible();
  await expect(page.locator("body")).toContainText("Flooding");
  await expect(page.getByRole("heading", { name: "Monthly submissions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Collection service" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Official workload" })).toBeVisible();
  await expect(page.locator(".workload-table")).toContainText(OFFICIAL_NAME);
});

test("4. administrator filters, inspects, pages, and exports the activity log", async ({ page, request: api }) => {
  // Seed enough deterministic entries to exercise pagination and the export.
  await apiLogin(api);
  const stateResponse = await api.get("/api/state");
  expect(stateResponse.ok()).toBeTruthy();
  const state = await stateResponse.json();
  const at = new Date().toISOString();
  for (let index = 1; index <= 30; index += 1) {
    state.data.activities.push({
      id: `A-browser-audit-${String(index).padStart(2, "0")}`,
      actor: "Portal administrator",
      role: "administrator",
      action: "Added user account",
      detail: `Browser audit seed ${String(index).padStart(2, "0")}`,
      at,
      result: "Success",
    });
  }
  const saved = await api.put("/api/state", {
    headers: ORIGIN,
    data: { revision: state.revision, data: state.data },
  });
  expect(saved.ok()).toBeTruthy();

  await login(page);
  await page.goto("/#/administrator/activity");
  await expect(page.getByRole("heading", { name: "Activity Log", level: 2 })).toBeVisible();
  await expect(page.locator("#activity-results")).toContainText("Matching records");
  await expect(page.locator('[data-action="view-activity"]').first()).toBeVisible();

  // Apply filters through the form, not by calling the endpoint directly.
  await page.locator("#activity-action").fill("Added user account");
  await page.locator("#activity-actor").fill("Portal administrator");
  await page.locator("#activity-result").selectOption("Success");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("#activity-results")).toContainText("Added user account");
  await expect(page.locator("#activity-results")).toContainText("Browser audit seed");
  const matching = page.locator(".stat").filter({ hasText: "Matching records" }).locator(".stat-value");
  await expect(matching).not.toHaveText("0");

  // The custom pagination moves between pages of the filtered log.
  await expect(page.locator('[data-action="activity-page"]')).toHaveCount(2);
  const pageStatus = page.locator("#activity-results .pagination-status");
  await expect(pageStatus).toContainText("Page 1 of");
  await page.locator('[data-action="activity-page"][data-direction="1"]').click();
  await expect(pageStatus).toContainText("Page 2 of");
  await page.locator('[data-action="activity-page"][data-direction="-1"]').click();
  await expect(pageStatus).toContainText("Page 1 of");

  // A record opens its detail dialog.
  await page.locator('[data-action="view-activity"]').first().click();
  const detail = page.getByRole("heading", { name: "Activity event" });
  await expect(detail).toBeVisible();
  await expect(page.locator(".activity-detail-list")).toContainText("Event ID");
  await expect(page.locator(".activity-detail-list")).toContainText("Portal administrator");
  await page.getByRole("button", { name: "Close dialog" }).click();

  // The export returns the filtered rows as a CSV download.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export CSV/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("community-activity-log.csv");
  const csvPath = await download.path();
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain("Browser audit seed");
  expect(csv).toContain("Added user account");

  // Clearing the filters restores the unfiltered log.
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator("#activity-action")).toHaveValue("");
  await expect(page.locator("#activity-actor")).toHaveValue("");
  await expect(page.locator("#activity-results")).toContainText("Matching records");
});
