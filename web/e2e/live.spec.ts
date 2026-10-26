// The whole site on Zcash testnet: a round the house operator (gateway --runner) opened, a bid sealed in the page,
// its deposit paid from a real testnet wallet (zcash-devtool, the repo's bidder wallet), the sealed record sent through
// the page, admission after 10 confirmations, the round opened at drand round R, cleared and settled by two of three
// signers, and the published result checked: in the page, and offline with the shipped verifier.
// Run with the house operator up: BNZ_WEB_TEST_URL=http://127.0.0.1:8790 playwright test --project=live
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATE = path.join(REPO, ".benzo");
const LWD = process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
const say = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const devtool = (args: string[]) => execFileSync(path.join(STATE, "bin/zcash-devtool"), args, { encoding: "utf8", timeout: 15 * 60_000 });

test("live: seal in the page, pay on testnet, admitted, opened at R, settled, verified", async ({ page, request }) => {
  test.setTimeout(3 * 3600_000);
  // 1. A round taking bids with at least 12 minutes left (so the deposit confirms before the freeze).
  let round: any = null;
  for (let i = 0; i < 120 && !round; i++) {
    const list = await (await request.get("/api/auctions")).json();
    round = list.find((a: any) => a.live && a.state === "OPEN" && a.T_submit - Date.now() / 1000 > 12 * 60) ?? null;
    if (!round) await page.waitForTimeout(30_000);
  }
  expect(round, "the house operator has no round open").not.toBeNull();
  say(`round ${round.id.slice(0, 8)} ${round.lot}, bids close ${new Date(round.T_submit * 1000).toISOString()}`);

  // 2. Seal a bid in the page. The refund goes to a fresh address of the testnet bidder wallet.
  const refund = execFileSync(path.join(REPO, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"], { encoding: "utf8" }).trim().split("\n").at(-1)!;
  await page.goto(`/bid/?id=${round.id}`);
  await page.getByTestId("bid-price").fill("990");
  await page.getByTestId("bid-refund").fill(refund);
  await page.getByTestId("bid-next").click();
  await expect(page.getByTestId("bid-review")).toContainText("No money is sent by sealing");
  await page.getByTestId("bid-seal").click();
  await expect(page.getByTestId("bid-qr")).toBeVisible({ timeout: 120_000 });
  // As a person would: the recovery file first, then the payment link it unlocks.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bid-key").click()]);
  const uri = await page.getByTestId("bid-uri").getAttribute("href") as string;
  const ciphertext = (await page.getByTestId("bid-hash").textContent())!;
  const key = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  say(`sealed ${key.ciphertext_hash.slice(0, 12)} (${ciphertext})`);

  // 3. Pay the deposit link from the wallet, exactly as a person would scan it.
  devtool(["wallet", "-w", path.join(STATE, "bidder"), "sync", "-s", LWD]);
  const out = devtool(["wallet", "-w", path.join(STATE, "bidder"), "pay", "-i", path.join(STATE, "bidder.age"), "--disable-confirmation", "-s", LWD, "--payment-uri", uri]);
  const txid = out.match(/^[0-9a-f]{64}$/gm)?.at(-1);
  expect(txid, `wallet produced no txid: ${out.slice(-300)}`).toBeTruthy();
  say(`paid ${txid}`);

  // 4. Send the sealed record through the page; the intake admits it after 10 confirmations.
  await page.getByTestId("bid-txid").fill(txid!);
  await page.getByTestId("bid-send").click();
  await expect(page.getByTestId("bid-status")).toHaveAttribute("data-status", "admitted", { timeout: 45 * 60_000 });
  say("admitted");

  // 5. The round freezes, is witnessed, opens at R, clears and settles.
  let d: any = null;
  for (let i = 0; i < 240; i++) {
    d = await (await request.get(`/api/auctions/${round.id}`)).json();
    if (d.state === "SETTLED" && d.receipts.length) break;
    await page.waitForTimeout(30_000);
  }
  expect(d.state).toBe("SETTLED");
  say(`settled: cleared at ${d.clearing_price_zats}, ${d.receipts.length} receipts`);

  // 6. Our bid is in the frozen set, opened at our price, and its refund (C minus what it pays) was paid.
  const leaf = d.freeze.leaves.find((l: any) => l.ciphertext_hash === key.ciphertext_hash);
  expect(leaf, "our bid is not in the frozen set").toBeTruthy();
  const alloc = d.result.allocations.find((a: any) => a.leaf_index === Number(leaf.leaf_index));
  expect(alloc.price_zats).toBe("990");
  const paid = d.receipts.find((r: any) => r.party === `leaf:${leaf.leaf_index}`);
  expect(BigInt(paid.amount_zats)).toBe(BigInt(d.C_zats) - BigInt(alloc.payment_zats));
  expect(d.valid).toBe(true);

  // 7. The page shows it: the round's ticket, our receipt, every check passing.
  await page.goto(`/auction/?id=${round.id}&bid=${key.ciphertext_hash}`);
  await expect(page.getByTestId("ticket-light")).toContainText("Settled");
  await expect(page.getByTestId("receipt")).toContainText(key.ciphertext_hash);
  await page.locator('[data-testid=records] [data-tab="checks"]').click();
  await expect(page.getByText(`${d.checks.length} of ${d.checks.length} checks pass`)).toBeVisible();

  // 8. And offline, with the shipped verifier, on the downloaded public directory.
  const dir = mkdtempSync(path.join(tmpdir(), "benzo-live-"));
  writeFileSync(path.join(dir, "p.tgz"), await (await request.get(`/api/auctions/${round.id}/public.tgz`)).body());
  execFileSync("tar", ["-xzf", "p.tgz"], { cwd: dir });
  const v = execFileSync("node", [path.join(REPO, "dist/benzo-verify.mjs"), "--dir", path.join(dir, `public-${round.id.slice(0, 8)}`), "--signer", d.signer], { encoding: "utf8" });
  expect(v).not.toMatch(/^ERROR/m);
  say(`verified offline: ${v.split("\n").filter((l) => l.startsWith("OK")).length} OK`);
});
