// End-to-end coverage of the CommUnity critical paths in a real browser:
// registration, report submission with a map pin and photos, official review,
// resident notifications, reopening, announcement approval, collection
// schedules, and form preservation during the automatic refresh.
//
// The suite runs against a throwaway PGlite database seeded by the server
// (see launch.mjs) and mutates it in order, so the tests are serial and
// build on each other's records.
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@example.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "AdminTestPassword-2026!";
const OFFICIAL_EMAIL = process.env.E2E_OFFICIAL_EMAIL || "official@example.test";
const OFFICIAL_PASSWORD = process.env.E2E_OFFICIAL_PASSWORD || "OfficialTestPassword-2026!";
const OFFICIAL_NAME = "Official One";

// A real 1x1 transparent PNG; the server validates magic bytes.
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let reportId = "";

// Mutating API calls must carry the same Origin a browser would send.
const ORIGIN = { Origin: "http://127.0.0.1:8799" };

async function apiLogin(api, email, password) {
  const response = await api.post("/api/auth/login", { data: { email, password }, headers: ORIGIN });
  expect(response.ok()).toBeTruthy();
}

async function ensureOfficial(api) {
  await apiLogin(api, ADMIN_EMAIL, ADMIN_PASSWORD);
  const response = await api.post("/api/users", {
    headers: ORIGIN,
    data: {
      email: OFFICIAL_EMAIL,
      name: OFFICIAL_NAME,
      area: "Purok 2",
      role: "official",
      password: OFFICIAL_PASSWORD,
      workingHours: "Monday-Friday, 8:00 AM-5:00 PM",
      availableDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
  });
  expect([201, 400, 409]).toContain(response.status());
}

async function registerResident(page) {
  await page.goto("/#/register");
  await page.locator("#name").fill("Resident Example");
  await page.locator("#email").fill("resident@example.test");
  await page.locator("#phone").fill("09171234567");
  await page.locator("#area").selectOption("Purok 1");
  await page.locator("#password").fill("ResidentTestPassword-2026!");
  await page.locator("#confirmPassword").fill("ResidentTestPassword-2026!");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page).toHaveURL(/#\/resident\/dashboard/);
}

async function login(page, email, password) {
  await page.goto("/#/login");
  await page.locator("#login-form #email").fill(email);
  await page.locator("#login-form #password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/(resident|official|administrator)\/dashboard/);
}

async function logout(page) {
  await page.locator('.topbar-actions [data-action="logout"]').click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page).toHaveURL(/#\/login/);
}

test.describe.configure({ mode: "serial" });

test("1. resident can register and then sign back in", async ({ page }) => {
  await registerResident(page);
  await expect(page.locator("body")).toContainText("Your latest reports");

  // Sign out, then sign back in with the same credentials.
  await logout(page);
  await login(page, "resident@example.test", "ResidentTestPassword-2026!");
  await expect(page.locator("body")).toContainText("Your latest reports");
});

test("2. resident can submit a report with a map pin and photos", async ({ page }) => {
  await login(page, "resident@example.test", "ResidentTestPassword-2026!");
  await page.goto("/#/resident/report");

  await page.locator("#category").selectOption("Drainage problem");
  await page.locator("#priority").selectOption("Medium");
  await page.locator("#area").selectOption("Purok 1");
  await page.locator("#locationDetail").fill("Beside the community hall");
  await page.locator("#description").fill("The drain is blocked beside the community hall.");

  await page.getByRole("button", { name: "Choose location on map" }).click();
  const map = page.locator("#report-map");
  await map.waitFor({ state: "visible" });
  const mapBox = await map.boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2 + 40, mapBox.y + mapBox.height / 2 - 30);
  await expect(page.locator("#report-latitude")).not.toHaveValue("");
  await expect(page.locator("#report-longitude")).not.toHaveValue("");

  await page.locator("#report-photos").setInputFiles({
    name: "blocked-drain.png",
    mimeType: "image/png",
    buffer: PNG_BUFFER,
  });
  await expect(page.locator(".photo-thumb img")).toBeVisible();

  await page.getByRole("button", { name: /Review report/ }).click();
  await expect(page.locator("body")).toContainText("Beside the community hall");
  await page.getByRole("button", { name: "Submit concern" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page).toHaveURL(/#\/resident\/reports/);
  const concernLine = page.getByText(/Drainage problem · Purok 1/).first();
  await expect(concernLine).toBeVisible();

  // List rows carry the full report id in their action attributes.
  reportId = await page.locator('[data-action="view-report"]').first().getAttribute("data-id");
  expect(reportId).toMatch(/^R-[0-9A-Z]{10}$/);

  // The photo survives a round-trip to the report detail view.
  await page.locator(`[data-action="view-report"][data-id="${reportId}"]`).first().click();
  await expect(page.locator('img[src*="/api/reports/"]')).toBeVisible();
});

test("3. official can process the concern in the queue", async ({ page, request: api }) => {
  await ensureOfficial(api);
  await login(page, OFFICIAL_EMAIL, OFFICIAL_PASSWORD);
  await page.goto("/#/official/concerns");
  await page.locator(`[data-action="view-report"][data-id="${reportId}"]`).first().click();

  await page.locator("#status").selectOption("Under Review");
  await page.locator("#status-note").fill("The report has been read and referred to the drainage crew.");
  await page.getByRole("button", { name: "Save report update" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page.locator("body")).toContainText("Under Review");
});

test("4. resident sees the status update as a notification", async ({ page }) => {
  await login(page, "resident@example.test", "ResidentTestPassword-2026!");
  await page.goto("/#/resident/notifications");
  await expect(page.locator("body")).toContainText("Report under review");
  await expect(page.locator("body")).toContainText(reportId);
});

test("5. official moves the concern to In Progress and then Resolved, and the resident can request a reopening", async ({ page }) => {
  await login(page, OFFICIAL_EMAIL, OFFICIAL_PASSWORD);
  await page.goto("/#/official/concerns");
  await page.locator(`[data-action="view-report"][data-id="${reportId}"]`).first().click();
  await page.locator("#status").selectOption("In Progress");
  await page.locator("#status-note").fill("Crew dispatched to the covered court side of the drain.");
  await page.getByRole("button", { name: "Save report update" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page.locator("body")).toContainText("In Progress");

  await page.locator(`[data-action="view-report"][data-id="${reportId}"]`).first().click();
  await page.locator("#status").selectOption("Resolved");
  await page.locator("#status-note").fill("The drain has been cleared and is flowing normally.");
  await page.getByRole("button", { name: "Save report update" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page.locator("body")).toContainText("Resolved");

  await logout(page);
  await login(page, "resident@example.test", "ResidentTestPassword-2026!");
  await page.goto("/#/resident/notifications");
  await expect(page.locator("body")).toContainText("Report in progress");
  await expect(page.locator("body")).toContainText("Report resolved");
  await expect(page.locator("body")).toContainText(reportId);

  await page.goto("/#/resident/reports");
  await page.locator(`[data-action="view-report"][data-id="${reportId}"]`).first().click();
  await expect(page.locator("body")).toContainText("Request reopening");

  page.once("dialog", (dialog) => dialog.accept("The drain is blocked again after the rain."));
  await page.getByRole("button", { name: "Request reopening" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page.locator("body")).toContainText("Submitted");
});

test("6. official posts an announcement and the administrator approves it", async ({ page }) => {
  await login(page, OFFICIAL_EMAIL, OFFICIAL_PASSWORD);
  await page.goto("/#/official/announcements");
  await page.getByRole("button", { name: "New announcement" }).click();
  await page.locator("#title").fill("Barangay clean-up drive");
  await page.locator("#announcement-detail").fill("All puroks join the riverside clean-up this Saturday.");
  await page.getByRole("button", { name: "Send for approval" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page.locator("body")).toContainText("Barangay clean-up drive");

  await logout(page);
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/#/administrator/approvals");
  await expect(page.locator("body")).toContainText("Barangay clean-up drive");
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page.getByText("Barangay clean-up drive")).toHaveCount(0);

  await logout(page);
  await login(page, "resident@example.test", "ResidentTestPassword-2026!");
  await page.goto("/#/resident/dashboard");
  await expect(page.locator("body")).toContainText("Barangay clean-up drive");
});

test("7. official creates a collection schedule and the resident sees it", async ({ page }) => {
  await login(page, OFFICIAL_EMAIL, OFFICIAL_PASSWORD);
  await page.goto("/#/official/collection");
  await page.getByRole("button", { name: "Add schedule" }).click();
  await page.locator("#area").selectOption("Purok 1");
  await page.locator("#wasteType").fill("Biodegradable");
  await page.locator("#frequency").selectOption("One-time");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page.locator("body")).toContainText("Biodegradable");

  await logout(page);
  await login(page, "resident@example.test", "ResidentTestPassword-2026!");
  await page.goto("/#/resident/collection");
  await expect(page.locator("body")).toContainText("Biodegradable");
});

test("8. automatic refresh does not erase an inline form being filled", async ({ page, request: api }) => {
  test.setTimeout(90_000);
  await login(page, "resident@example.test", "ResidentTestPassword-2026!");
  await page.goto("/#/resident/report");
  const description = page.locator("#description");
  await description.click();
  await description.fill("This stays exactly as the resident typed it while the browser refreshes itself.");

  // An out-of-band change from staff advances the database revision.
  await apiLogin(api, ADMIN_EMAIL, ADMIN_PASSWORD);
  const bump = await api.post("/api/community/report-priority", {
    data: { reportId, priority: "High" },
    headers: ORIGIN,
  });
  expect(bump.ok()).toBeTruthy();

  // The 30-second revision poll must leave the form alone.
  await page.waitForTimeout(33_000);
  await expect(description).toHaveValue("This stays exactly as the resident typed it while the browser refreshes itself.");
});
