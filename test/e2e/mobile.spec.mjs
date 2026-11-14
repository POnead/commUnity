// Mobile-viewport coverage of the critical paths, emulating an iPhone-class device.
// The app already ships a compact layout with a drawer; these tests prove the
// flow actually works at a phone-sized viewport instead of showing a layout
// that only looked fine in a desktop screenshot.
import { test, expect, devices } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@example.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "AdminTestPassword-2026!";
const RESIDENT_EMAIL = "mobile.e2e@example.test";
const RESIDENT_PASSWORD = "MobileE2ePassword-2026!";
const PHONE = "09179998888";
const AREA = "Purok 2";

// Chrome on Android keeps the Chromium engine the repo (and CI) installs;
// emulating an iOS device would require WebKit, which is not part of the suite.
test.use({ ...devices["Pixel 7"] });

async function noHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(sizes.scrollWidth, `${label} should not overflow horizontally`).toBeLessThanOrEqual(sizes.clientWidth);
}

async function openMobileDrawer(page) {
  const button = page.locator('.mobile-menu-button[data-action="toggle-menu"]');
  await expect(button).toBeVisible();
  await button.tap();
  await expect(page.locator("#mobile-navigation:not([hidden]) .mobile-drawer")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("1. mobile resident registers and reaches a compact dashboard without horizontal overflow", async ({ page }) => {
  await page.goto("/#/register");
  await expect(page.locator("#register-form")).toBeVisible();
  await page.locator("#name").fill("Mobile E2E Resident");
  await page.locator("#email").fill(RESIDENT_EMAIL);
  await page.locator("#phone").fill(PHONE);
  await page.locator("#area").selectOption(AREA);
  await page.locator("#password").fill(RESIDENT_PASSWORD);
  await page.locator("#confirmPassword").fill(RESIDENT_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page).toHaveURL(/#\/resident\/dashboard/);
  await noHorizontalOverflow(page, "resident dashboard");
  await openMobileDrawer(page);
  await page.locator("#mobile-navigation [data-action='close-menu']").tap();
  await expect(page.locator("#mobile-navigation")).toHaveAttribute("hidden", "");
});

test("2. mobile resident can open and complete a concern report", async ({ page }) => {
  await page.goto("/#/login");
  await page.locator("#login-form #email").fill(RESIDENT_EMAIL);
  await page.locator("#login-form #password").fill(RESIDENT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/resident\/dashboard/);

  await page.goto("/#/resident/report");
  await expect(page.locator("#category")).toBeVisible();
  await noHorizontalOverflow(page, "report form");
  await page.locator("#category").selectOption("Drainage problem");
  await page.locator("#priority").selectOption("High");
  await page.locator("#area").selectOption(AREA);
  await page.locator("#locationDetail").fill(" beside the barangay hall");
  await page.locator("#description").fill("The canal beside the barangay hall is overflowing again after the rain.");
  await page.getByRole("button", { name: /Review report/ }).click();
  await page.getByRole("button", { name: "Submit concern" }).click();
  await page.locator("[data-confirm='accept']").click();
  await expect(page).toHaveURL(/#\/resident\/reports/);
  await expect(page.locator("body")).toContainText("Submitted");
  await noHorizontalOverflow(page, "reports list");
});

test("3. mobile administrator can sign in and browse accounts", async ({ page }) => {
  await page.goto("/#/login");
  await page.locator("#login-form #email").fill(ADMIN_EMAIL);
  await page.locator("#login-form #password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/administrator\/dashboard/);
  await noHorizontalOverflow(page, "administrator dashboard");
  await page.goto("/#/administrator/users");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await noHorizontalOverflow(page, "accounts list");
  await openMobileDrawer(page);
  await page.locator("#mobile-navigation [data-action='close-menu']").tap();
  await expect(page.locator("#mobile-navigation")).toHaveAttribute("hidden", "");
});
