// Browser proof that the verification and hotline workspaces are actually
// routed and rendered — not just present as exported view functions.
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@example.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "AdminTestPassword-2026!";
const ORIGIN = { Origin: "http://127.0.0.1:8799" };

async function login(page) {
  await page.goto("/#/login");
  await page.locator("#login-form #email").fill(ADMIN_EMAIL);
  await page.locator("#login-form #password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/administrator\/dashboard/);
}

test("1. administrator reaches the ID review and hotline workspaces", async ({ page, request: api }) => {
  const signed = await api.post("/api/auth/login", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, headers: ORIGIN });
  expect(signed.ok()).toBeTruthy();
  await login(page);

  await page.goto("/#/administrator/verification");
  await expect(page.getByRole("heading", { name: "ID review queue" })).toBeVisible();
  await expect(page.locator("#verification-settings-form")).toBeVisible();
  await expect(page.locator("body")).toContainText("No IDs to review");

  await page.goto("/#/administrator/hotlines");
  await expect(page.getByRole("heading", { name: "Emergency hotlines" })).toBeVisible();
  await expect(page.locator('[data-action="add-hotline"]')).toBeVisible();
  await expect(page.locator('[data-action="filter-hotlines"]').first()).toBeVisible();
});

test("2. resident reaches the ID submission and hotline directory pages", async ({ page, request: api }) => {
  const email = "wiring-resident@example.test";
  const password = "WiringResidentPassword-2026!";
  const created = await api.post("/api/auth/register", {
    data: { name: "Wiring Resident", email, area: "Purok 1", password, confirmPassword: password },
    headers: ORIGIN,
  });
  expect(created.ok()).toBeTruthy();
  const cookie = created.headers()["set-cookie"]?.split(";")[0] || "";
  const state = await api.get("/api/state", { headers: { ...ORIGIN, Cookie: cookie } });
  expect(state.ok()).toBeTruthy();

  await page.goto("/#/login");
  await page.locator("#login-form #email").fill(email);
  await page.locator("#login-form #password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/resident\/dashboard/);

  await page.goto("/#/resident/verification");
  await expect(page.getByRole("heading", { name: "Identity verification" })).toBeVisible();
  await expect(page.locator("#id-submit-form")).toBeVisible();

  await page.goto("/#/resident/hotlines");
  await expect(page.getByRole("heading", { name: "Emergency hotlines" })).toBeVisible();
  await expect(page.locator('[data-action="filter-hotlines"]').first()).toBeVisible();
});
