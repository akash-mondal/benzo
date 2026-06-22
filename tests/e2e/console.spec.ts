import { test, expect, type Page } from "@playwright/test";

/**
 * B2B console UI e2e (demo mode → deterministic). Desktop only (the console is a
 * desktop product). Exercises the dashboard, the approval release gate, the
 * prove-balance flow, and issuing an auditor grant.
 */
const CONSOLE = "http://localhost:5174";

async function open(page: Page, path = "/") {
  await page.addInitScript(() => {
    localStorage.setItem("benzo.masked", "0");
    localStorage.setItem("benzo.console.onboarded", "1"); // skip the first-run wizard
  });
  await page.goto(CONSOLE + path);
  await expect(page.getByText("Benzo")).toBeVisible();
}

test.describe("console — onboarding (P0-B1)", () => {
  test("SSO → KYB → register treasury keys → workspace", async ({ page }) => {
    // ensure the first-run wizard shows (don't set the onboarded flag)
    await page.addInitScript(() => localStorage.removeItem("benzo.console.onboarded"));
    await page.goto(CONSOLE);
    await expect(page.getByTestId("console-onboarding")).toBeVisible();
    await page.getByTestId("auth-google").click();
    // step 1 — business
    await page.getByTestId("org-name").fill("Acme Robotics");
    await page.getByTestId("org-legal").fill("Acme Robotics Inc.");
    await page.getByTestId("wizard-next").click();
    // step 2 — KYB (labeled mock)
    await page.getByTestId("kyb-run").click();
    await expect(page.getByTestId("kyb-result")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("wizard-next").click();
    // step 3 — compliance zone
    await page.getByTestId("wizard-next").click();
    // step 4 — team
    await page.getByTestId("wizard-next").click();
    // step 5 — register treasury keys
    await page.getByTestId("mvk-register").click();
    await expect(page.getByTestId("mvk-result")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("wizard-next").click();
    // step 6 — review → finish
    await page.getByTestId("onboarding-finish").click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("console — invites (P0-B2)", () => {
  test("contractor invite is consumer-scoped; bulk import adds rows", async ({ page }) => {
    await open(page, "/invites");
    await page.getByTestId("invite-tab-contractor").click();
    await page.getByTestId("invite-name").fill("Grace Hopper");
    await page.getByTestId("invite-create").click();
    await expect(page.getByTestId("invite-link").first()).toContainText("app=consumer", { timeout: 10_000 });
    await page.getByTestId("invite-csv").fill("Ada Lovelace, @ada, 7000");
    await page.getByTestId("invite-bulk").click();
    await expect(page.getByTestId("invite-row").nth(1)).toBeVisible({ timeout: 10_000 });
  });

  test("a team invite is business-scoped (bounces in the consumer wallet)", async ({ page }) => {
    await open(page, "/invites");
    await page.getByTestId("invite-tab-member").click();
    await page.getByTestId("invite-name").fill("Sam Rivera");
    await page.getByTestId("invite-create").click();
    await expect(page.getByTestId("invite-link").first()).toContainText("app=business", { timeout: 10_000 });
  });
});

test.describe("console — dashboard", () => {
  test("renders the treasury metric, approvals, and activity", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByTestId("treasury-total")).toContainText("$85,380.00");
    await expect(page.getByText("Provable")).toBeVisible();
    await expect(page.getByTestId("pending-count")).toHaveText("1");
    await expect(page.getByTestId("live-badge")).toContainText("Demo");
    expect(await page.getByTestId("activity-row").count()).toBeGreaterThan(0);
    // invoice amount is correctly formatted (regression for raw-stroops bug)
    await expect(page.getByText("$4,200.00")).toBeVisible();
  });

  test("sidebar navigates between sections", async ({ page }) => {
    await open(page);
    await page.getByRole("link", { name: "Payroll" }).click();
    await expect(page.getByRole("heading", { name: "Payroll" })).toBeVisible();
    await page.getByRole("link", { name: "Treasury" }).click();
    await expect(page.getByRole("heading", { name: "Treasury" })).toBeVisible();
  });
});

test.describe("console — approvals (release gate)", () => {
  test("M-of-N: needs two approvals (approver → treasurer release) before it clears", async ({ page }) => {
    await open(page, "/approvals");
    await expect(page.getByTestId("approve-btn")).toBeVisible();
    // step 1: the approver — still pending, trail now shows one approver
    await page.getByTestId("approve-btn").click();
    await expect(page.getByTestId("approval-trail")).toContainText("approver", { timeout: 15_000 });
    await expect(page.getByText("All clear")).toHaveCount(0);
    // step 2: the treasurer release → settles → leaves the pending list
    await page.getByTestId("approve-btn").click();
    await expect(page.getByText("All clear")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("console — treasury prove-balance", () => {
  test("generates a proof result", async ({ page }) => {
    await open(page, "/treasury");
    await page.getByTestId("prove-min").fill("1000");
    await page.getByTestId("prove-balance").click();
    await expect(page.getByTestId("prove-result")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("prove-result")).toContainText("Holds ≥");
  });
});

test.describe("console — auditor grants", () => {
  test("issues a scoped viewing grant", async ({ page }) => {
    await open(page, "/grants");
    const before = await page.getByTestId("revoke-grant").count();
    await page.getByTestId("new-grant").click();
    await page.getByTestId("grant-name").fill("Q2 Auditor LLP");
    await page.getByTestId("grant-submit").click();
    await expect(page.getByText("Q2 Auditor LLP")).toBeVisible({ timeout: 15_000 });
    expect(await page.getByTestId("revoke-grant").count()).toBeGreaterThanOrEqual(before + 1);
  });
});

test.describe("console — pay engine", () => {
  test("contractors screen computes a run total from rate cards", async ({ page }) => {
    await open(page, "/contractors");
    await expect(page.getByRole("heading", { name: "Contractors" })).toBeVisible();
    // count() does NOT auto-wait — wait for the async store load first, else we race it
    await expect(page.getByTestId("contractor-row").first()).toBeVisible({ timeout: 15_000 });
    expect(await page.getByTestId("contractor-row").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("run-month")).toBeVisible(); // amounts computed, not typed
  });

  test("invoice-to-pay: paying an inbound invoice settles it through the engine", async ({ page }) => {
    await open(page, "/invoices");
    // wait for the AP inbox to finish loading before counting (count() is non-retrying)
    await expect(page.getByTestId("pay-invoice").first()).toBeVisible({ timeout: 15_000 });
    const before = await page.getByTestId("pay-invoice").count();
    expect(before).toBeGreaterThan(0);
    await page.getByTestId("pay-invoice").first().click();
    // confirm the irreversible single Pay before it settles
    await page.getByTestId("pay-confirm").click();
    // under-threshold invoice settles immediately → moves to the Paid section
    await expect(page.getByText("Paid", { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await page.getByTestId("pay-invoice").count()).toBeLessThan(before);
  });
});
