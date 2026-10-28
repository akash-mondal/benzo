// Starting rounds from the site, with no chain: the form's checks, the request the operator would build (read back
// from the gateway's own request file), OTC and RFQ invites joined from separate browsers (each makes its own party
// key; only the public half reaches the gateway), and "Mine" listing what this browser started.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tmp/requests-e2e");
const saved = (rid: string) => JSON.parse(readFileSync(path.join(REQ, `${rid}.json`), "utf8"));
let ua = "";
test.beforeAll(async ({ request }) => {
  const list = await (await request.get("/api/auctions")).json();
  ua = (await (await request.get(`/api/auctions/${list[0].id}`)).json()).deposit_addresses[1];
});

test("start a uniform round: the form refuses bad terms, the request carries the terms, Mine lists it", async ({ page }) => {
  await page.goto("/start/");
  await page.getByTestId("start-uniform").click();
  await expect(page).toHaveURL(/\/start\/\?market=uniform$/);
  await page.getByTestId("start-lot").fill("Test lamp");
  await page.getByTestId("start-supply").fill("2");
  await page.getByTestId("start-reserve").fill("105");
  await page.getByTestId("start-payout_ua").fill(ua);
  await page.getByTestId("start-submit").click();
  await expect(page.getByText("Use steps of 10.")).toBeVisible();
  await expect(page.getByTestId("start-error")).toContainText("need fixing");
  await page.getByTestId("start-reserve").fill("100");
  await page.getByTestId("start-payout_ua").fill("t1notshielded");
  await page.getByTestId("start-submit").click();
  await expect(page.getByTestId("start-error")).toContainText("payout address");
  await page.getByTestId("start-payout_ua").fill(ua);
  await page.getByTestId("start-submit").click();
  await expect(page).toHaveURL(/\/round\/\?r=[0-9a-f]{16}&t=[0-9a-f]{32}$/);
  const rid = new URL(page.url()).searchParams.get("r")!;
  await expect(page.getByTestId("request")).toHaveAttribute("data-status", "queued");
  await expect(page.getByTestId("ticket-title")).toHaveText("Test lamp");
  const r = saved(rid);
  expect(r.spec).toMatchObject({ mode: "uniform", lot: "Test lamp", supply: 2, reserve_zats: "100", B_max_zats: "3000", payout_ua: ua, house_bids: 0, request: rid });
  await page.goto("/mine/");
  await expect(page.getByTestId("mine-rounds")).toContainText("Test lamp");
});

test("OTC: the seller starts, the buyer joins from the invite in another browser, both keys are pinned", async ({ page, browser }) => {
  await page.goto("/start/?market=otc");
  await page.getByTestId("start-lot").fill("Block of 50 ZEC");
  await page.getByTestId("start-side").selectOption("seller");
  await page.getByTestId("start-submit").click();
  await expect(page.getByTestId("request")).toHaveAttribute("data-status", "waiting");
  await expect(page.getByTestId("request-party")).toContainText("Seller");
  const invite = await page.locator("[data-invite]").getAttribute("data-invite");
  expect(invite).toMatch(/\/round\/\?r=[0-9a-f]{16}&i=[0-9a-f]{32}$/);
  const rid = new URL(page.url()).searchParams.get("r")!;
  const sellerKey = await page.evaluate((r) => JSON.parse(localStorage.getItem("benzo:parties")!).find((p: any) => p.rid === r), rid);
  expect(saved(rid).spec.otc.seller_key).toBe(sellerKey.public_hex);

  const other = await browser.newContext({ baseURL: page.url().split("/round")[0] });
  const buyer = await other.newPage();
  await buyer.goto(invite!);
  await buyer.getByTestId("request-join").click();
  await expect(buyer.getByTestId("request-party")).toContainText("Buyer");
  await expect(buyer.getByTestId("request")).toHaveAttribute("data-status", "queued");
  const buyerKey = await buyer.evaluate((r) => JSON.parse(localStorage.getItem("benzo:parties")!).find((p: any) => p.rid === r), rid);
  const r = saved(rid);
  expect(r.spec.otc).toEqual({ buyer_key: buyerKey.public_hex, seller_key: sellerKey.public_hex });
  expect(JSON.stringify(r)).not.toContain(buyerKey.private_hex);
  expect(JSON.stringify(r)).not.toContain(sellerKey.private_hex);
  // The same invite cannot be used twice.
  const again = await (await other.request.post(`/api/rounds/${rid}/join`, { data: { invite: new URL(invite!).searchParams.get("i"), key: "ab".repeat(32) } })).json();
  expect(again.error).toContain("already");
  await other.close();
});

test("RFQ: two dealers join from their invites; the request pins both dealer keys and the buyer's budget", async ({ page, browser }) => {
  await page.goto("/start/?market=rfq");
  await page.getByTestId("start-lot").fill("Audit of a wallet");
  await page.getByTestId("start-max_price").fill("500");
  await page.getByTestId("start-budget").fill("800");
  await page.getByTestId("start-treasury_ua").fill(ua);
  await page.getByTestId("start-submit").click();
  await expect(page.getByTestId("request")).toHaveAttribute("data-status", "waiting");
  const links = await page.locator("[data-invite]").evaluateAll((els) => els.map((e) => e.getAttribute("data-invite")!));
  expect(links).toHaveLength(2);
  const rid = new URL(page.url()).searchParams.get("r")!, keys: string[] = [];
  for (const link of links) {
    const ctx = await browser.newContext({ baseURL: page.url().split("/round")[0] });
    const p = await ctx.newPage();
    await p.goto(link);
    await p.getByTestId("request-join").click();
    await expect(p.getByTestId("request-party")).toContainText("Dealer");
    keys.push(await p.evaluate((r) => JSON.parse(localStorage.getItem("benzo:parties")!).find((x: any) => x.rid === r).public_hex, rid));
    await ctx.close();
  }
  const r = saved(rid);
  expect(r.status).toBe("queued");
  expect(r.spec.rfq).toMatchObject({ dealer_keys: keys, budget_zats: "800", max_price_zats: "500", treasury_ua: ua });
});

test("every market's form opens from the start page and from its own sky", async ({ page }) => {
  // Launch rounds start from the command line in this release; the start page says so in place of a form.
  await page.goto("/start/");
  await expect(page.getByTestId("start-launch-note")).toBeVisible();
  for (const m of ["uniform", "drop", "buyback", "otc", "rfq"]) {
    await page.goto("/start/");
    await page.getByTestId(`start-${m}`).click();
    await expect(page.getByTestId("start-form")).toBeVisible();
    await expect(page.getByTestId("start-lot")).toBeVisible();
  }
  await page.goto("/markets/uniform/");
  await expect(page.locator('a[data-door-label][href="/start/?market=uniform"]')).toBeAttached();
});
