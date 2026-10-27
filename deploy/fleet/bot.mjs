#!/usr/bin/env node
// bot.mjs — a test bidder for the live testnet site, run as a fleet during judging so Benzo is seen under load. It uses
// the site exactly as a person would: starts rounds through the public API (the same call the Start page makes), opens
// each round's bid page in a real browser, seals a bid there, pays the deposit from its own testnet wallet and pastes
// the transaction id. Every bid is a real sealed shielded deposit; refunds come back to the bot's own address.
//   SITE=https://benzo.space WORKERS=3 WALLET=/data/wallet node bot.mjs
// The README and the site say that this fleet runs; nothing here pretends to be a person.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE = process.env.SITE ?? "https://benzo.space";
const WORKERS = Number(process.env.WORKERS ?? 3);
const WALLET = process.env.WALLET ?? "/data/wallet";
const LWD = process.env.LWD ?? "testnet.zec.rocks:443";
const DEVTOOL = process.env.DEVTOOL ?? "/usr/local/bin/zcash-devtool";
const TARGET_OPEN = Number(process.env.TARGET_OPEN ?? 4); // public rounds kept taking bids at once
const STARTER = process.env.STARTER === "1";               // this bot may start rounds
const PAUSE = [Number(process.env.PAUSE_MIN ?? 20), Number(process.env.PAUSE_MAX ?? 90)]; // seconds between bids, per worker
const NAME = process.env.BOT_NAME ?? "bot";
const PUBLIC = ["uniform", "drop", "launch", "buyback"];

const say = (m) => console.log(`${new Date().toISOString()} [${NAME}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const dev = (args, timeout = 10 * 60_000) => execFileSync(DEVTOOL, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });

// ---- the wallet: one per bot, made here on first start; its address is printed so the fleet can be funded.
function ensureWallet() {
  if (!existsSync(WALLET)) { mkdirSync(path.dirname(WALLET), { recursive: true }); dev(["wallet", "-w", WALLET, "init", "--name", NAME, "-i", `${WALLET}.age`, "-n", "test", "-s", LWD]); say("wallet made"); }
  const ua = dev(["wallet", "-w", WALLET, "list-addresses"]).match(/utest1[0-9a-z]+/)?.[0];
  if (!ua) throw new Error("no wallet address");
  return ua;
}
let lock = Promise.resolve();
const serial = (fn) => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };
const balance = () => serial(() => { dev(["wallet", "-w", WALLET, "sync", "-s", LWD]); const b = JSON.parse(dev(["wallet", "-w", WALLET, "balance", "--json"])); return { total: b.total, spendable: b.sapling_spendable + b.orchard_spendable + (b.ironwood_spendable ?? 0) }; });
const pay = (uri) => serial(() => {
  dev(["wallet", "-w", WALLET, "sync", "-s", LWD]);
  const out = dev(["wallet", "-w", WALLET, "pay", "-i", `${WALLET}.age`, "--disable-confirmation", "-s", LWD, "--payment-uri", uri]);
  const txid = out.match(/^[0-9a-f]{64}$/gm)?.at(-1);
  if (!txid) throw new Error(`no txid: ${out.slice(-160)}`);
  return txid;
});

// ---- the site's public API
const api = async (p, init) => { const r = await fetch(`${SITE}${p}`, { ...init, signal: AbortSignal.timeout(30_000) }); const t = await r.text(); try { return { ok: r.ok, status: r.status, body: JSON.parse(t) }; } catch { return { ok: false, status: r.status, body: null }; } };
async function openRounds() {
  const r = await api("/api/auctions");
  if (!r.ok || !Array.isArray(r.body)) return [];
  return r.body.filter((a) => a.state === "OPEN" && PUBLIC.includes(a.mode));
}

const THINGS = ["Night lamp", "Field recorder", "Oak stool", "Print run", "Studio hours", "Seed tranche", "Ceramic set", "Tour tickets", "Wool blanket", "Bike frame", "Camera body", "Vinyl pressing", "Garden plot", "Desk lamp", "Market stall", "Guitar pedal", "Coffee lot", "Tea harvest", "Poster set", "Book run"];
async function startRound(ua) {
  const mode = pick(PUBLIC), lot = `${pick(THINGS)} ${rnd(2, 99)}`;
  const f = { mode, lot, minutes: pick([20, 30, 40, 60]), max_price: 3000, reserve: 10 };
  if (mode === "uniform") Object.assign(f, { supply: rnd(2, 6), payout_ua: ua });
  if (mode === "launch") Object.assign(f, { supply: rnd(3, 6), payout_ua: ua, minimum_raise: rnd(1, 4) * 500 });
  if (mode === "drop") Object.assign(f, { lots: ["A", "B", "C", "D", "E"].slice(0, rnd(2, 5)).map((x) => `${lot.split(" ")[0]} ${x}`), payout_ua: ua });
  if (mode === "buyback") Object.assign(f, { supply: rnd(2, 6), treasury_ua: ua, max_price: 300, budget: 1200 });
  const r = await api("/api/rounds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
  say(r.ok ? `started a ${mode} round (${lot})` : `start refused (${r.status}): ${JSON.stringify(r.body).slice(0, 160)}`);
  // A buyback's budget is paid from its request page; the bot pays it from its own wallet.
  if (r.ok && mode === "buyback" && r.body?.rid) void fundRequest(r.body).catch((e) => say(`budget not paid: ${e.message.slice(0, 120)}`));
}
async function fundRequest(req) {
  for (let i = 0; i < 120; i++) {
    const v = await api(`/api/rounds/${req.rid}?token=${req.token}`);
    const id = v.body?.auction_id;
    if (id) {
      const a = await api(`/api/auctions/${id}`), f = a.body?.funding;
      if (f?.address && f?.amount_zats) { const tx = await pay(`zcash:${f.address}?amount=${(Number(f.amount_zats) / 1e8).toFixed(8)}`); say(`budget paid ${tx.slice(0, 12)}`); return; }
    }
    await sleep(20_000);
  }
}

// ---- one bid, through the bid page, as a person would place it
async function bid(browser, round, ua) {
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await page.goto(`${SITE}/bid/?id=${round.id}`, { timeout: 60_000 });
    const price = round.mode === "buyback" ? rnd(2, 30) * 10 : rnd(10, 300) * 10;
    await page.getByTestId("bid-price").fill(String(price), { timeout: 60_000 });
    await page.getByTestId("bid-refund").fill(ua);
    if (round.mode === "drop") { const n = await page.getByTestId("bid-lot").locator("option").count(); await page.getByTestId("bid-lot").selectOption({ index: rnd(0, Math.max(0, n - 1)) }); }
    await page.getByTestId("bid-next").click();
    await page.getByTestId("bid-seal").click({ timeout: 30_000 });
    await page.getByTestId("bid-qr").waitFor({ state: "visible", timeout: 120_000 });
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bid-key").click()]);
    mkdirSync("/data/keys", { recursive: true, mode: 0o700 });
    await dl.saveAs(`/data/keys/${round.id.slice(0, 12)}-${Date.now()}.json`); // the recovery file: refunds a deposit the round never counted
    const uri = await page.getByTestId("bid-uri").getAttribute("href");
    const txid = await pay(uri);
    await page.getByTestId("bid-txid").fill(txid);
    await page.getByTestId("bid-send").click();
    await page.getByTestId("bid-status").waitFor({ timeout: 60_000 });
    say(`bid ${price} on ${round.mode} ${round.id.slice(0, 8)}: paid ${txid.slice(0, 12)}`);
    return true;
  } finally { await page.close().catch(() => {}); }
}

async function worker(i, browser, ua) {
  await sleep(i * 15_000);
  for (;;) {
    try {
      const b = await balance();
      if (b.spendable < 260_000) { say(`waiting for funds (spendable ${b.spendable}, total ${b.total})`); await sleep(120_000); continue; }
      let open = await openRounds();
      if (STARTER && i === 0 && open.length < TARGET_OPEN) { await startRound(ua); }
      if (!open.length) { await sleep(60_000); continue; }
      await bid(browser, pick(open), ua);
    } catch (e) { say(`worker ${i}: ${String(e.message ?? e).split("\n")[0].slice(0, 200)}`); await sleep(30_000); }
    await sleep(rnd(PAUSE[0], PAUSE[1]) * 1000);
  }
}

const ua = ensureWallet();
say(`address ${ua}`);
writeFileSync(`${path.dirname(WALLET)}/address.txt`, ua + "\n");
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i, browser, ua)));
