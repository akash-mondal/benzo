// The read-only site over the real published testnet rounds: the sky, the ticket, every page, and the
// "check it yourself" path (download a round's public directory, run the shipped verifier on it offline).
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let featured = "";

test.beforeAll(async ({ request }) => {
  const list = await (await request.get("/api/auctions")).json();
  expect(list.length).toBeGreaterThan(50);
  featured = list.filter((a: any) => a.mode === "uniform" && a.state === "SETTLED" && (a.leaf_count ?? 0) >= 2 && a.clearing_price_zats).sort((a: any, b: any) => b.updated - a.updated)[0].id;
});

// Finds a doodle under the pointer whose sand pill matches.
async function hover(page: any, match: RegExp) {
  for (let y = 100; y < 820; y += 24) for (let x = 60; x < 1400; x += 24) {
    await page.mouse.move(x, y);
    const t = await page.locator("[data-testid=hover-pill]").textContent({ timeout: 30 }).catch(() => null);
    if (t && match.test(t)) return [x, y] as const;
  }
  return null;
}
const ready = (page: any) => page.waitForFunction(() => Number(document.querySelector("[data-testid=field]")?.getAttribute("data-ready") ?? 0) > 40);

test("home: every doodle is a door — a market door dives into that market's sky, a round there opens its ticket", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Benzo");
  await ready(page);
  const door = await hover(page, /^(Uniform price|OTC|RFQ|Launch|Buyback|Drop)\d+ rounds$/);
  expect(door, "no market door found under the pointer").not.toBeNull();
  await page.mouse.click(door![0], door![1]);
  await expect(page).toHaveURL(/\/markets\/(uniform|otc|rfq|launch|buyback|drop)\/$/);
  await expect(page.locator("h1")).toContainText("rounds on Zcash testnet");
  await ready(page);
  const round = await hover(page, /(Settled|Refunded|Running|Stopped|Live)$/);
  expect(round, "no round found under the pointer").not.toBeNull();
  await page.mouse.click(round![0], round![1]);
  const card = page.getByTestId("card");
  await expect(card).toBeVisible();
  await expect(page).toHaveURL(/\/markets\/[a-z]+\/\?lot=[0-9a-f]{64}$/);
  await expect(page.getByTestId("card-light")).toHaveText(/Settled|Settling|Cleared|Open|Frozen|Opened|Refunded|Refunding|Sealed/);
  await card.getByRole("button", { name: "Copy format" }).click();
  await expect(card.getByRole("option")).toHaveCount(4);
  await card.getByRole("option").filter({ hasText: "Verify" }).click();
  await card.getByTestId("card-open").click();
  await expect(page).toHaveURL(/\/auction\/\?id=[0-9a-f]{64}/);
  await expect(page.getByTestId("ticket-title")).not.toHaveText("Loading…");
  expect(errors).toEqual([]);
});

test("home: dragging moves the sky; a round's link lands on its market with its ticket open; Escape closes it; every door is listed", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  const before = await page.locator("canvas").first().screenshot();
  await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(380, 300, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(400);
  expect(Buffer.compare(before, await page.locator("canvas").first().screenshot())).not.toBe(0);
  const nav = page.getByRole("navigation", { name: "Every doodle in the field" });
  for (const href of ["/markets/uniform/", "/markets/drop/", "/how/", "/verify/", "/lots/", "/how/#sealed", "/how/#checked"])
    await expect(nav.locator(`a[href="${href}"]`).first()).toBeAttached();
  await page.goto(`/?lot=${featured}`);
  await expect(page).toHaveURL(new RegExp(`/markets/uniform/\\?lot=${featured}$`));
  await expect(page.getByTestId("card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("card")).toHaveCount(0);
  await expect(page).toHaveURL(/\/markets\/uniform\/$/);
});

test("every lot lists every published round and opens one", async ({ page, request }) => {
  const n = (await (await request.get("/api/auctions")).json()).length;
  await page.goto("/lots/");
  await expect(page.locator("h1")).toHaveText(`${n} rounds on Zcash testnet`);
  await expect(page.getByTestId("lot-row")).toHaveCount(n);
  await page.getByTestId("lot-row").first().click();
  await expect(page).toHaveURL(/\/auction\/\?id=/);
});

test("a settled round: opened bids, payments, 19 checks, and a bid's receipt", async ({ page, request }) => {
  const d = await (await request.get(`/api/auctions/${featured}`)).json();
  await page.goto(`/auction/?id=${featured}`);
  await expect(page.getByTestId("auction-caption")).toContainText(`${d.leaf_count} sealed bids`);
  await expect(page.getByTestId("allocations").locator("tbody tr")).toHaveCount(d.result.allocations.length);
  await expect(page.getByText(`${d.checks.length} of ${d.checks.length} checks pass`)).toBeVisible();
  await page.getByTestId("checks").locator("summary").click();
  await expect(page.getByTestId("checks").locator("li")).toHaveCount(d.checks.length);
  await page.getByPlaceholder("ciphertext hash from your bid key").fill(d.freeze.leaves[0].ciphertext_hash);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByTestId("receipt")).toContainText(d.freeze.leaves[0].ciphertext_hash);
});

test("verify page runs every check on a chosen round", async ({ page }) => {
  await page.goto(`/verify/?id=${featured}`);
  await page.getByTestId("verify-run").click();
  await expect(page.getByTestId("verify-results").locator("li")).toHaveCount(19);
  await expect(page.getByTestId("verify-results")).not.toContainText("ERROR");
});

test("how it works: six steps and the limits", async ({ page }) => {
  await page.goto("/how/");
  await expect(page.locator("ol > li h2")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "What this is not, yet" })).toBeVisible();
});

test("check it yourself: the downloaded public directory verifies offline with the shipped verifier", async ({ request }) => {
  const d = await (await request.get(`/api/auctions/${featured}`)).json();
  const dir = mkdtempSync(path.join(tmpdir(), "benzo-web-verify-"));
  writeFileSync(path.join(dir, "public.tgz"), await (await request.get(`/api/auctions/${featured}/public.tgz`)).body());
  execFileSync("tar", ["-xzf", "public.tgz"], { cwd: dir });
  const out = execFileSync("node", [path.join(REPO, "dist/benzo-verify.mjs"), "--dir", path.join(dir, `public-${featured.slice(0, 8)}`), "--signer", d.signer], { encoding: "utf8" });
  expect(out.split("\n").filter((l) => l.startsWith("OK")).length).toBe(19);
  // and the package the page tells you to npx is the PK-recorded one
  const tgz = await (await request.get("/dl/benzo-0.1.0.tgz")).body();
  const recorded = readFileSync(path.join(REPO, "docs/reproducible-build.md"), "utf8").match(/`(f9a9[0-9a-f]{60})`/)?.[1];
  expect(createHash("sha256").update(tgz).digest("hex")).toBe(recorded);
});
