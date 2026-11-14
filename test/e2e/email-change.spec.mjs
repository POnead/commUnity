// Browser-level coverage of the resident email-change workflow end to end:
// request the change, follow the emailed verification link, sign in with the
// new address, and confirm the resident keeps their existing concern, photo,
// and notifications.
//
// The shared e2e server starts without SMTP; this spec brings up an in-process
// SMTP sink and saves it through the administrator settings endpoint. Once the
// email-change tests finish, the settings are deleted again so any later suite
// that triggers an email runs against a server with no mailer at all, matching
// the default state other specs see at the start of the run. Each spec file
// runs in its own worker process, so the sink cannot outlive this file.
import { test, expect } from "@playwright/test";
import { mailText, startSmtpSink } from "../helpers.mjs";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@example.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "AdminTestPassword-2026!";
const BEFORE_EMAIL = "email.change.before@example.test";
const AFTER_EMAIL = "email.change.after@example.test";
const RESIDENT_PASSWORD = "EmailChangePassword-2026!";
const OFFICIAL_EMAIL = "email.spec.official@example.test";
const OFFICIAL_PASSWORD = "EmailSpecOfficialPassword-2026!";
const OFFICIAL_NAME = "Email Spec Official";
const ORIGIN = { Origin: "http://127.0.0.1:8799" };

// A real 1x1 transparent PNG; the server validates magic bytes.
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let sink;
let reportId = "";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForMail(pattern, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const message = sink.messages.map(mailText).find((text) => pattern.test(text));
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} was not delivered to the SMTP sink`);
}

async function login(page, email, password, role) {
  await page.goto("/#/login");
  await page.locator("#login-form #email").fill(email);
  await page.locator("#login-form #password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/${role}\\/dashboard`));
}

async function logout(page) {
  await page.locator('.topbar-actions [data-action="logout"]').click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page).toHaveURL(/#\/login/);
}

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ request: api }) => {
  // Only the email-change spec needs SMTP; leaving it configured would make
  // every later suite log ECONNREFUSED once this spec's worker exits and
  // takes the sink with it. If the admin session is intact, delete the saved
  // configuration so the rest of the suite sees the same no-mailer state as at
  // the start of the run.
  try {
    const signedIn = await api.post("/api/auth/login", {
      headers: ORIGIN,
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    if (signedIn.ok()) {
      await api.delete("/api/settings/smtp", { headers: ORIGIN });
    }
  } catch {
    // The delete endpoint is the best-effort half of the cleanup; the sink
    // still closes when this process exits.
  }
  if (sink) await new Promise((resolve) => sink.close(resolve));
});

test("1. administrator configures email delivery for the workflow", async ({ request: api }) => {
  sink = await startSmtpSink();
  const signedIn = await api.post("/api/auth/login", {
    headers: ORIGIN,
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(signedIn.ok()).toBeTruthy();

  const saved = await api.put("/api/settings/smtp", {
    headers: ORIGIN,
    data: {
      host: "127.0.0.1",
      port: sink.address().port,
      user: "mailer",
      pass: "smtp-password",
      from: "CommUnity <no-reply@example.test>",
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();

  // Prove the settings actually reach the sink before relying on them.
  const tested = await api.post("/api/settings/smtp/test", { headers: ORIGIN, data: {} });
  expect(tested.ok(), await tested.text()).toBeTruthy();
  const testMail = await waitForMail(/Subject: CommUnity SMTP test/i, "the SMTP test email");
  expect(testMail).toContain("successfully sent this test email");
  sink.messages.length = 0;

  const official = await api.post("/api/users", {
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
      password: OFFICIAL_PASSWORD,
    },
  });
  expect([201, 400, 409]).toContain(official.status());
});

test("2. resident registers and submits a concern with a photo", async ({ page }) => {
  await page.goto("/#/register");
  await page.locator("#name").fill("Email Change Resident");
  await page.locator("#email").fill(BEFORE_EMAIL);
  await page.locator("#phone").fill("09178887777");
  await page.locator("#area").selectOption("Purok 1");
  await page.locator("#password").fill(RESIDENT_PASSWORD);
  await page.locator("#confirmPassword").fill(RESIDENT_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page).toHaveURL(/#\/resident\/dashboard/);

  await page.goto("/#/resident/report");
  await page.locator("#category").selectOption("Drainage problem");
  await page.locator("#priority").selectOption("Medium");
  await page.locator("#area").selectOption("Purok 1");
  await page.locator("#locationDetail").fill("Across from the barangay hall");
  await page.locator("#description").fill("The canal across from the barangay hall is blocked and overflows.");
  await page.locator("#report-photos").setInputFiles({
    name: "email-change-photo.png",
    mimeType: "image/png",
    buffer: PNG_BUFFER,
  });
  await expect(page.locator(".photo-thumb img")).toBeVisible();
  await page.getByRole("button", { name: /Review report/ }).click();
  await page.getByRole("button", { name: "Submit concern" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page).toHaveURL(/#\/resident\/reports/);

  reportId = await page.locator('[data-action="view-report"]').first().getAttribute("data-id");
  expect(reportId).toMatch(/^R-[0-9A-Z]{10}$/);
  await page.locator(`[data-action="view-report"][data-id="${reportId}"]`).first().click();
  await expect(page.locator('img[src*="/api/reports/"]')).toBeVisible();
});

test("3. resident changes the sign-in email through the profile and the emailed link", async ({ page }) => {
  await login(page, BEFORE_EMAIL, RESIDENT_PASSWORD, "resident");
  await page.goto("/#/resident/profile");

  const changeForm = page.locator("#change-email-form");
  await changeForm.locator('[name="email"]').fill(AFTER_EMAIL);
  await changeForm.locator('[name="currentPassword"]').fill(RESIDENT_PASSWORD);
  await page.getByRole("button", { name: "Send verification link" }).click();
  await expect(page.locator("#toast")).toContainText(`A verification link was sent to ${AFTER_EMAIL}.`);

  const mail = await waitForMail(new RegExp(`To: .*${escapeRegExp(AFTER_EMAIL)}`, "i"), "the email-change verification");
  expect(mail).toContain("Confirm your CommUnity email address");
  const token = mail.match(/(?:verify-email\?token=|token=)([A-Za-z0-9_-]{20,})/);
  expect(token, "the verification mail should carry a token").toBeTruthy();

  await page.goto(`/#/verify-email?token=${token[1]}`);
  await expect(page.getByRole("heading", { name: "Confirm new email" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(page).toHaveURL(/#\/resident\/profile/);
  await expect(page.locator("#toast")).toContainText("Email address updated. Use it the next time you sign in.");
  await expect(page.getByText(AFTER_EMAIL).first()).toBeVisible();

  // The old address no longer signs in; the new one does.
  await logout(page);
  await page.locator("#login-form #email").fill(BEFORE_EMAIL);
  await page.locator("#login-form #password").fill(RESIDENT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/login/);
  await expect(page.locator("#toast")).toContainText("Those sign-in details do not match an active account.");

  await login(page, AFTER_EMAIL, RESIDENT_PASSWORD, "resident");
  await expect(page.locator("body")).toContainText("Your latest reports");
});

test("4. the concern, photo, and new-address notifications survive the change", async ({ page }) => {
  await login(page, AFTER_EMAIL, RESIDENT_PASSWORD, "resident");
  await page.goto("/#/resident/reports");
  const row = page.locator(`[data-action="view-report"][data-id="${reportId}"]`).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('img[src*="/api/reports/"]')).toBeVisible();

  // Nothing should be sent to the retired address once the change is verified.
  await logout(page);
  sink.messages.length = 0;
  await login(page, OFFICIAL_EMAIL, OFFICIAL_PASSWORD, "official");
  await page.goto("/#/official/concerns");
  await page.locator(`[data-action="view-report"][data-id="${reportId}"]`).first().click();
  await page.locator("#status").selectOption("Under Review");
  await page.locator("#status-note").fill("Received at the new address and referred to the drainage crew.");
  await page.getByRole("button", { name: "Save report update" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page.locator("body")).toContainText("Under Review");

  const statusMail = await waitForMail(new RegExp(`To: .*${escapeRegExp(AFTER_EMAIL)}`, "i"), "the status update email");
  expect(statusMail).toContain(`Subject: Your report ${reportId} is under review`);
  expect(sink.messages.map(mailText).some((text) => new RegExp(`To: .*${escapeRegExp(BEFORE_EMAIL)}`, "i").test(text))).toBe(false);

  await logout(page);
  await login(page, AFTER_EMAIL, RESIDENT_PASSWORD, "resident");
  await page.goto("/#/resident/notifications");
  await expect(page.locator("body")).toContainText("Report under review");
  await expect(page.locator("body")).toContainText(reportId);
});
