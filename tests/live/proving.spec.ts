import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * LIVE e2e — REAL testnet USDC moved through the wallet UI, proven on-chain.
 * On a complete-tree deployment, the full set works: shield (add money),
 * transfer (send), and unshield (cash out) all settle real on-chain ops with
 * real Groth16 proofs verified on-chain.
 *
 * Proving-path coverage (see tests/live/README.md): LOCAL/on-device proving is
 * exercised here (real proofs verified on-chain) + `packages/core` `wasm.test.ts`;
 * TEE proving is verified on-chain by `node tests/e2e/tee-onchain.mjs`
 * (enclave-produced funds + KYC proofs `verify_proof => true`).
 *
 * Serial + single worker: legs share one wallet + tx source (no concurrency).
 */
const WALLET = "http://localhost:5175";
test.describe.configure({ mode: "serial" });

async function balanceStroops(req: APIRequestContext): Promise<bigint> {
  const r = await req.get(`${WALLET}/api/balance`);
  const b = (await r.json()) as { stroops: string; live: boolean };
  expect(b.live, "BFF must be LIVE (load .env)").toBe(true);
  return BigInt(b.stroops);
}

async function openWallet(page: Page, path = "/") {
  await page.addInitScript(() => {
    localStorage.setItem("benzo.onboarded", "1");
    localStorage.setItem("benzo.hidden", "0");
  });
  await page.goto(WALLET + path);
  await expect(page.getByTestId("app-root")).toBeVisible();
}

test("add money settles a REAL shield (local proof, verified on-chain)", async ({ page, request }) => {
  const before = await balanceStroops(request);
  await openWallet(page, "/cash"); // defaults to the "Add money" tab
  await expect(page.getByText("Added instantly to your balance")).toBeVisible();
  await page.getByLabel("Amount").fill("0.20");
  await page.getByTestId("add-submit").click();
  await expect(page.getByTestId("cash-overlay")).toBeVisible();
  await expect(page.getByText("Money added")).toBeVisible();
  await expect(page.getByTestId("cash-overlay")).not.toContainText("(demo)");
  expect(await balanceStroops(request), "balance must increase after a real shield").toBeGreaterThan(before);
});

test("cash out settles a REAL unshield (balance decreases)", async ({ page, request }) => {
  const before = await balanceStroops(request);
  expect(before, "need a shielded balance to cash out (run the add-money test first)").toBeGreaterThan(500_000n);

  await openWallet(page, "/cash?tab=out");
  await expect(page.getByText(/Arrives in your bank/)).toBeVisible();
  await page.getByLabel("Amount").fill("0.05");
  await page.getByTestId("cashout-submit").click();
  await expect(page.getByTestId("cash-overlay")).toBeVisible();
  await expect(page.getByText("On its way")).toBeVisible();
  await expect(page.getByTestId("cash-overlay")).not.toContainText("(demo)");

  const after = await balanceStroops(request);
  expect(after, "shielded balance must drop after a real unshield").toBeLessThan(before);
});

test("send settles a REAL private transfer (joinsplit) to a @handle", async ({ page }) => {
  await openWallet(page, "/send");
  await page.getByTestId("send-handle").fill("@benzowallet"); // registered on the deployment
  await page.getByLabel("Amount").fill("0.05");
  await page.getByTestId("send-submit").click();
  await expect(page.getByTestId("send-overlay")).toBeVisible();
  await expect(page.getByTestId("send-success")).toContainText("Sent");
  await expect(page.getByTestId("send-overlay")).not.toContainText("(demo)");
});

test("the UI shows the device-chosen proving path (on-device vs enclave)", async ({ page }) => {
  await openWallet(page, "/cash?tab=out");
  // No manual toggle: the device picks the path (on-device for capable desktops,
  // the attested enclave/TEE for phones + weak desktops).
  await expect(page.getByTestId("cash-prover-plan")).toBeVisible();
});
