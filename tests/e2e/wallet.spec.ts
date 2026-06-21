import { test, expect, type Page } from "@playwright/test";

/**
 * Consumer wallet UI e2e (demo mode → deterministic). Runs on BOTH the desktop
 * and mobile projects: same assertions, two viewports — so the mobile-first
 * layout is exercised under a real phone profile too.
 */
const WALLET = "http://localhost:5175";

async function open(page: Page, path = "/") {
  // skip the one-time onboarding splash + start with the balance visible
  await page.addInitScript(() => {
    localStorage.setItem("benzo.onboarded", "1");
    localStorage.setItem("benzo.hidden", "0");
  });
  await page.goto(WALLET + path);
  await expect(page.getByTestId("app-root")).toBeVisible();
}

test.describe("wallet — home", () => {
  test("shows the balance, privacy chip, actions, and activity", async ({ page }) => {
    await open(page);
    // demo seed balance
    await expect(page.getByLabel("$1,240.50")).toBeVisible();
    await expect(page.getByText(/only you can see this/i)).toBeVisible();
    await expect(page.getByTestId("action-send")).toBeVisible();
    await expect(page.getByTestId("action-request")).toBeVisible();
    await expect(page.getByTestId("action-cashout")).toBeVisible();
    // seeded activity rows
    await expect(page.getByText("Ravi Mehta")).toBeVisible();
    await expect(page.getByText("+$200.00")).toBeVisible();
    await expect(page.getByTestId("bottom-nav")).toBeVisible();
  });

  test("eye toggle masks the balance display", async ({ page }) => {
    await open(page);
    await expect(page.getByLabel("$1,240.50")).toBeVisible();
    await page.getByRole("button", { name: "Hide balance" }).click();
    await expect(page.getByLabel("Balance hidden")).toBeVisible();
    await expect(page.getByLabel("$1,240.50")).toHaveCount(0);
  });
});

test.describe("wallet — send (private, 3-phase ceremony)", () => {
  test("send to a contact plays the ceremony → 'Sent privately'", async ({ page }) => {
    await open(page);
    await page.getByTestId("action-send").click();
    await page.getByTestId("send-handle").fill("@ravi");
    await page.getByLabel("Amount").fill("12.50");
    // a @handle is classified as a private send
    await expect(page.getByTestId("send-kind")).toContainText(/private/i);
    await expect(page.getByTestId("send-submit")).toBeEnabled();
    await page.getByTestId("send-submit").click(); // → confirm
    await page.getByTestId("send-confirm").click(); // → fire
    await expect(page.getByTestId("send-overlay")).toBeVisible();
    await expect(page.getByTestId("ceremony-title")).toContainText("Sent privately", { timeout: 15_000 });
    await expect(page.getByTestId("ceremony-done")).toBeVisible();
  });

  test("a first-time recipient gets a double-check warning (Cash App parity)", async ({ page }) => {
    await open(page, "/send");
    await page.getByTestId("send-handle").fill("@stranger_xyz");
    await page.getByLabel("Amount").fill("3");
    await page.getByTestId("send-submit").click(); // → confirm
    await expect(page.getByTestId("send-new-recipient")).toBeVisible();
    await expect(page.getByTestId("send-new-recipient")).toContainText(/first time/i);
  });

  test("a Stellar G-address is flagged as a public payout", async ({ page }) => {
    await open(page, "/send");
    await page.getByTestId("send-handle").fill("G" + "A".repeat(55));
    await expect(page.getByTestId("send-kind")).toContainText(/public/i);
  });

  test("confirm step shows the device-chosen proving path", async ({ page }) => {
    await open(page, "/send");
    await page.getByTestId("send-handle").fill("@ravi");
    await page.getByLabel("Amount").fill("5");
    await page.getByTestId("send-submit").click(); // → confirm step shows the auto proving plan
    // Proving path is chosen by the device (on-device for capable desktops, the
    // attested enclave/TEE for phones + weak desktops) — no manual toggle.
    await expect(page.getByTestId("send-prover-plan")).toBeVisible();
    await expect(page.getByTestId("send-prover-plan")).toContainText(/device|enclave/i);
  });
});

test.describe("wallet — external invite + claim", () => {
  test("create an invite link, then claim it", async ({ page }) => {
    await open(page, "/invite");
    await page.getByLabel("Amount").fill("3");
    await page.getByTestId("invite-create").click();
    await expect(page.getByTestId("invite-link")).toBeVisible({ timeout: 15_000 });
    const link = (await page.getByTestId("invite-link").innerText()).trim();
    expect(link).toContain("app=consumer");

    await page.goto(WALLET + "/claim?link=" + encodeURIComponent(link));
    await expect(page.getByTestId("claim-accept")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("claim-accept").click();
    await expect(page.getByTestId("claim-done")).toBeVisible({ timeout: 15_000 });
  });

  test("self-claim refund returns an unclaimed invite", async ({ page }) => {
    await open(page, "/invite");
    await page.getByLabel("Amount").fill("2");
    await page.getByTestId("invite-create").click();
    await expect(page.getByTestId("invite-link")).toBeVisible({ timeout: 15_000 });
    await page.getByText("Send another").click();
    await expect(page.getByTestId("invite-refund").first()).toBeVisible();
    await page.getByTestId("invite-refund").first().click();
    // StatusPill text is lowercase in the DOM (CSS `capitalize` only restyles it)
    await expect(page.getByText("refunded", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("a team (member) business invite shows the wrong-app screen", async ({ page }) => {
    const bizLink = "benzo://org?o=org_1&kind=member&app=business#tok123";
    await open(page, "/claim?link=" + encodeURIComponent(bizLink));
    await expect(page.getByTestId("claim-mismatch")).toBeVisible();
    await expect(page.getByText(/Benzo Business invite/i)).toBeVisible();
  });

  test("a contractor business invite onboards here (not a bounce)", async ({ page }) => {
    const link = "benzo://org?o=org_acme&kind=contractor&app=consumer&org=Acme%20Robotics#tok_demo";
    await open(page, "/claim?link=" + encodeURIComponent(link));
    await expect(page.getByTestId("contractor-invite")).toBeVisible();
    await expect(page.getByText(/invited you/i)).toBeVisible();
  });
});

test.describe("wallet — cash (light tabbed widget)", () => {
  test("flips between Add money and Cash out", async ({ page }) => {
    await open(page, "/cash");
    await expect(page.getByText("Added instantly to your balance")).toBeVisible();
    await page.getByRole("button", { name: "Cash out" }).click();
    await expect(page.getByText(/Arrives in your bank/)).toBeVisible();
    await expect(page.getByTestId("cashout-submit")).toBeVisible();
  });
});

test.describe("wallet — activity + profile", () => {
  test("activity lists day-grouped rows", async ({ page }) => {
    await open(page, "/activity");
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    // count() doesn't auto-wait — wait for the async store load before counting
    await expect(page.getByTestId("activity-row").first()).toBeVisible({ timeout: 15_000 });
    expect(await page.getByTestId("activity-row").count()).toBeGreaterThan(0);
  });

  test("tapping a row opens its receipt (detail + timeline)", async ({ page }) => {
    await open(page, "/activity");
    await expect(page.getByTestId("activity-row").first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("activity-row").first().click();
    await expect(page).toHaveURL(/\/activity\/.+/);
    await expect(page.getByTestId("txdetail-amount")).toBeVisible();
    await expect(page.getByTestId("txdetail-timeline")).toBeVisible();
  });

  test("profile shows mode + proof entry", async ({ page }) => {
    await open(page, "/profile");
    await expect(page.getByText("Prove your balance")).toBeVisible();
    await expect(page.getByTestId("profile-mode")).toBeVisible();
  });
});
