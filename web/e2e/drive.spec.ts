// Every action on the site, live on Zcash testnet, one test per market (they run side by side): the round is started
// from the Start page with the starter's own testnet addresses; invited parties open their invite links in their own
// browsers and join; a budget is paid from the request page where the market needs one; bids are sealed in the page by
// separate browsers, each saves its recovery file, pays its deposit from the testnet wallet (zcash-devtool, as a person's
// wallet would from the payment link), pastes the transaction id and follows it to "counted"; the round freezes, opens at
// drand round R, clears and is paid out by two of three signers; then the round's terminal, the bidder's My activity
// (including opening a recovery file) and Verify are checked. One bidder changes their price before paying, once.
// Run with the house operator up (gateway --runner) and the wallet's funds split into notes:
//   BNZ_WEB_TEST_URL=http://127.0.0.1:8790 playwright test --project=drive --workers=6
import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The checkout whose wallet and tools are used (the main one; BNZ_DRIVE_TOOLS points a preview copy at it).
const REPO = process.env.BNZ_DRIVE_TOOLS ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATE = path.join(REPO, ".benzo");
const KEEP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tmp");
const LWD = process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
const WALLET_NAME = process.env.BNZ_DRIVE_WALLET ?? "bidder", WALLET = path.join(STATE, WALLET_NAME); // the wallet paying deposits and budgets
const say = (m: string, s: string) => console.log(`${new Date().toISOString()} [${m}] ${s}`);
const devtool = (args: string[]) => execFileSync(path.join(STATE, "bin/zcash-devtool"), args, { encoding: "utf8", timeout: 15 * 60_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A fresh shielded address of the testnet wallet (refunds, payouts, treasuries: what a person pastes from their wallet).
// (Dry runs never touch the wallet: they use a published deposit address, BNZ_DRIVE_UA, which has the right shape.)
// The wallet takes one writer at a time: a busy database is waited out (the browsers ask for addresses together).
const freshUA = (): string => {
  if (process.env.BNZ_DRIVE_DRY) return process.env.BNZ_DRIVE_UA!;
  for (let i = 0; ; i++) {
    try { return execFileSync(path.join(REPO, "settle/target/release/benzo-pczt"), ["address", WALLET, "--network", "test"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").at(-1)!; }
    catch (e) { if (i > 40 || !/locked|busy/i.test(String((e as any).stderr ?? (e as Error).message))) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 + Math.random() * 1000); }
  }
};

// One payment at a time from the shared wallet (its database takes one writer), waiting for a spendable note.
const LOCK = "/tmp/benzo-drive-pay.lock";
async function pay(m: string, uri: string): Promise<string> {
  for (;;) { try { mkdirSync(LOCK); break; } catch { await sleep(2000); } }
  try {
    for (let i = 0; ; i++) {
      // A sync only reads the chain: retried when the wallet is busy (another process syncing it) or stalls.
      for (let k = 0; ; k++) { try { execFileSync(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", WALLET, "sync", "-s", LWD], { encoding: "utf8", timeout: 5 * 60_000 }); break; } catch (e) { if (k >= 6) throw e; say(m, `wallet sync busy or stalled; retrying`); await sleep(20_000); } }
      try {
        const out = devtool(["wallet", "-w", WALLET, "pay", "-i", path.join(STATE, `${WALLET_NAME}.age`), "--disable-confirmation", "-s", LWD, "--payment-uri", uri]);
        const txid = out.match(/^[0-9a-f]{64}$/gm)?.at(-1);
        if (txid) { say(m, `paid ${txid.slice(0, 12)}`); return txid; }
        throw new Error(`no txid: ${out.slice(-200)}`);
      } catch (e) {
        if (i >= 30 || !/insufficient|InsufficientFunds|not enough|spendable/i.test(String((e as Error).message))) throw e;
        say(m, "waiting for a spendable note"); await sleep(60_000);
      }
    }
  } finally { rmSync(LOCK, { recursive: true, force: true }); }
}

type Plan = { mode: string; fill: (p: Page) => Promise<void>; invites?: number; funds?: boolean; bids: { price: number; lot?: number; party?: number; change?: number }[]; expect: RegExp };
const PLANS: Plan[] = [
  { mode: "uniform", fill: async (p) => { await p.getByTestId("start-lot").fill("Drive - night lamp"); await p.getByTestId("start-supply").fill("2"); await p.getByTestId("start-payout_ua").fill(freshUA()); },
    bids: [{ price: 990 }, { price: 1500, change: 700 }], expect: /2 of 2 sold at 990 zats/ },
  { mode: "drop", fill: async (p) => { await p.getByTestId("start-lot").fill("Drive - two prints"); await p.getByTestId("start-lots").fill("Print A"); await p.locator('input[placeholder="Lot 2 name"]').fill("Print B"); await p.getByTestId("start-payout_ua").fill(freshUA()); },
    bids: [{ price: 500, lot: 0 }, { price: 400, lot: 1 }], expect: /2 of 2 lots sold/ },
  { mode: "launch", fill: async (p) => { await p.getByTestId("start-lot").fill("Drive - seed allocation"); await p.getByTestId("start-payout_ua").fill(freshUA()); },
    bids: [{ price: 1000 }, { price: 800 }, { price: 600 }], expect: /Raised/ },
  { mode: "buyback", fill: async (p) => { await p.getByTestId("start-lot").fill("Drive - buy back two units"); await p.getByTestId("start-treasury_ua").fill(freshUA()); }, funds: true,
    bids: [{ price: 200 }, { price: 250 }], expect: /units? bought back at/ },
  { mode: "otc", fill: async (p) => { await p.getByTestId("start-lot").fill("Drive - block trade"); await p.getByTestId("start-side").selectOption("seller"); }, invites: 1,
    bids: [{ price: 600, party: 0 }, { price: 1000, party: 1 }], expect: /Traded at 800 zats/ },
  { mode: "rfq", fill: async (p) => { await p.getByTestId("start-lot").fill("Drive - wallet audit"); await p.getByTestId("start-treasury_ua").fill(freshUA()); }, invites: 2, funds: true,
    bids: [{ price: 400, party: 1 }, { price: 300, party: 2 }], expect: /Quote accepted · 300 zats|Quote accepted/ },
];

async function newPage(browser: Browser, baseURL: string) { const ctx = await browser.newContext({ baseURL, acceptDownloads: true }); return ctx.newPage(); }

for (const plan of PLANS) test(`drive ${plan.mode}: start, invite, fund, bid, pay, track, settle, check`, async ({ browser, baseURL }) => {
  test.setTimeout(4 * 3600_000);
  const m = plan.mode;
  // 1. Start the round from the Start page (picker → form → review → create).
  const starter = await newPage(browser, baseURL!);
  await starter.goto("/start/");
  await starter.getByTestId(`start-${m}`).click();
  await plan.fill(starter);
  await starter.getByTestId("start-minutes").selectOption("20");
  await starter.getByTestId("start-submit").click();
  await expect(starter).toHaveURL(/\/round\/\?r=[0-9a-f]{16}&t=[0-9a-f]{32}$/, { timeout: 30_000 });
  say(m, `request ${starter.url().split("r=")[1].slice(0, 16)}`);

  // 2. Invited parties join from their own browsers. Party 0 is the starter (OTC: the seller).
  const parties: Page[] = [starter];
  if (plan.invites) {
    await expect(starter.locator("[data-invite]")).toHaveCount(plan.invites, { timeout: 60_000 }); // a remote site renders them a moment later
    const links = await starter.locator("[data-invite]").evaluateAll((els) => els.map((e) => e.getAttribute("data-invite")!));
    expect(links).toHaveLength(plan.invites);
    for (const link of links) {
      const p = await newPage(browser, baseURL!);
      await p.goto(link); await p.getByTestId("request-join").click();
      await expect(p.getByTestId("request-party")).toBeVisible();
      parties.push(p);
    }
    say(m, `${links.length} invite${links.length > 1 ? "s" : ""} joined`);
  }

  if (process.env.BNZ_DRIVE_DRY) { await expect(starter.getByTestId("request")).toHaveAttribute("data-status", /queued|open/, { timeout: 20_000 }); return; } // forms and invites only

  // 3. Wait for the signers to set it up; fund the budget from the request page where the market needs one.
  await expect(starter.getByTestId("request")).toHaveAttribute("data-status", "open", { timeout: 2 * 3600_000 });
  await starter.reload();
  const rid = (await starter.getByTestId("request-round").getAttribute("href"))!.match(/id=([0-9a-f]{64})/)![1];
  say(m, `round ${rid.slice(0, 12)} is taking bids`);
  if (plan.funds) {
    await expect(starter.getByTestId("request-fund")).toBeVisible({ timeout: 120_000 });
    await pay(m, (await starter.getByTestId("request-fund").getAttribute("href"))!);
  }

  // 4. Bids, each from its own browser (or its party's): seal, save the recovery file, pay, paste, track to counted.
  const keys: any[] = [];
  for (const [i, b] of plan.bids.entries()) {
    const p = b.party !== undefined ? parties[b.party] : await newPage(browser, baseURL!);
    await p.goto(`/bid/?id=${rid}`);
    const refund = freshUA();
    const seal = async (price: number) => {
      await p.getByTestId("bid-price").fill(String(price));
      await p.getByTestId("bid-refund").fill(refund);
      if (b.lot !== undefined) await p.getByTestId("bid-lot").selectOption({ index: b.lot });
      await p.getByTestId("bid-next").click();
      await expect(p.getByTestId("bid-review")).toContainText("No money is sent by sealing");
      await p.getByTestId("bid-seal").click();
      await expect(p.getByTestId("bid-qr")).toBeVisible({ timeout: 120_000 });
    };
    if (b.change) {
      // Seal at one price, then change it before paying (the page asks whether the deposit was already sent).
      await seal(b.change);
      await p.getByRole("button", { name: /Change my/ }).click();
      await p.getByRole("button", { name: /Not yet, change my/ }).click();
      await expect(p.getByTestId("bid-price")).toBeVisible();
      say(m, `bid ${i + 1}: sealed at ${b.change}, changed before paying`);
    }
    await seal(b.price);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("bid-key").click()]);
    keys.push(JSON.parse(readFileSync((await dl.path())!, "utf8")));
    // Kept outside the browser (git-ignored tmp/, owner only): a deposit the round never admits refunds only with its owner key.
    mkdirSync(path.join(KEEP, "drive-keys"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(KEEP, "drive-keys", `${m}-${Date.now()}-${i + 1}.json`), JSON.stringify(keys.at(-1)), { mode: 0o600 });
    await p.getByRole("button", { name: "Enlarge the QR code" }).click(); await p.keyboard.press("Escape");
    const txid = await pay(m, (await p.getByTestId("bid-uri").getAttribute("href"))!);
    await p.getByTestId("bid-txid").fill(txid);
    await p.getByTestId("bid-send").click();
    say(m, `bid ${i + 1} at ${b.price}: deposit sent, tracking`);
    (p as any)._benzo = keys.at(-1);
    (b as any)._page = p;
  }
  for (const [i, b] of plan.bids.entries()) {
    const p: Page = (b as any)._page;
    await expect(p.getByTestId("bid-status")).toHaveAttribute("data-status", "admitted", { timeout: 90 * 60_000 });
    say(m, `bid ${i + 1} counted`);
  }

  // 5. The round freezes, opens at R, clears and pays out.
  let d: any = null;
  for (let i = 0; i < 360; i++) {
    d = await (await starter.request.get(`/api/auctions/${rid}`)).json();
    if (d.state === "SETTLED" && d.receipts.length) break;
    if (d.state === "CANCELLED") break;
    await sleep(30_000);
  }
  expect(d.state, `round ${rid} ended ${d.state}`).toBe("SETTLED");
  say(m, `settled: ${d.receipts.length} payments`);

  // 6. The terminal tells the story; its checks pass; Verify agrees; each bidder's My activity has the outcome, and a
  //    recovery file opened there finds the bid.
  await starter.goto(`/auction/?id=${rid}`);
  await expect(starter.getByTestId("story")).toContainText(plan.expect, { timeout: 60_000 });
  for (const tab of ["ladder", "timeline"]) await starter.locator(`[data-testid=chart] [data-tab="${tab}"]`).click();
  await starter.locator('[data-testid=book] [data-tab="activity"]').click();
  for (const tab of ["payments", "terms", "checks"]) await starter.locator(`[data-testid=records] [data-tab="${tab}"]`).click();
  await expect(starter.getByText(`${d.checks.length} of ${d.checks.length} checks pass`)).toBeVisible();
  await starter.goto(`/verify/?id=${rid}`);
  await expect(starter.getByTestId("verify-results").locator("li").first()).toBeVisible({ timeout: 60_000 });
  await expect(starter.getByText("All applicable checks pass")).toBeVisible();
  for (const [i, b] of plan.bids.entries()) {
    const p: Page = (b as any)._page;
    await p.goto("/mine/");
    await expect(p.getByTestId("mine-bids")).toContainText(/Won|Accepted|Didn't win|refunded/i, { timeout: 60_000 });
    const key = keys[i];
    await p.goto(`/auction/?id=${rid}&bid=${key.ciphertext_hash}`);
    await expect(p.getByTestId("receipt")).toContainText(key.ciphertext_hash, { timeout: 60_000 });
  }
  say(m, "all checks on the page pass");
});
