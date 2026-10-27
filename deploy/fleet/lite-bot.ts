// lite-bot.ts: the test-bidder fleet, run inside the one the host server (deploy/render/start.sh, BNZ_FLEET_BOTS) rather
// than on machines of its own. Each bot has its own testnet wallet and does what the bid page does, with the same code:
// it takes a deposit address (POST /api/auctions/:id/slot), checks the operator's signature on the round
// (GET .../packet), builds the order with envelope/bid.ts, seals it with the shipped sealer bundle (seal/dist/main.js,
// run here with a stand-in for its form instead of a browser), pays the deposit from its own wallet and hands in the
// sealed record (POST .../bids). Every bid is a real sealed shielded deposit; refunds come back to the bot's wallet.
// One bot may also start rounds through POST /api/rounds, the call the Start page makes. The README and the rounds
// board say this fleet runs. It runs at the lowest CPU priority, one wallet command at a time, so rounds come first.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bindSealedBid, prepareBid } from "../../envelope/bid";
import { generateOwnerKey } from "../../envelope/index";
import { sealedBidShape } from "../../envelope/opening";
import { hash, validateManifest, verifyRecord } from "../../manifest/schema";

const env = process.env;
const SITE = env.FLEET_SITE ?? "http://127.0.0.1:10000";
const DIR = env.FLEET_DIR ?? "/var/benzo/fleet";
const BOTS = Number(env.FLEET_BOTS ?? 8);
const LWD = env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
const DEVTOOL = env.FLEET_DEVTOOL ?? "/home/benzo/opt/bin/zcash-devtool";
const SEALER = env.FLEET_SEALER ?? "/home/benzo/app/seal/dist/main.js";
const TARGET_OPEN = Number(env.FLEET_TARGET_OPEN ?? 4);
const PAUSE = [Number(env.FLEET_PAUSE_MIN ?? 120), Number(env.FLEET_PAUSE_MAX ?? 480)];
// The markets the fleet starts and bids in (FLEET_MODES). Launch is left out by default: on the site its rounds clear and
// pay, but the winners' delivery list is a CLI step (benzo launch deliver), so their Verify page shows that check missing.
const PUBLIC = (env.FLEET_MODES ?? "uniform,drop,buyback").split(",").filter((m) => ["uniform", "drop", "launch", "buyback"].includes(m));
// Invite-only markets the fleet also plays (FLEET_PARTY_MODES): one bot starts the round with its party key, other bots
// join through the invite links (the creator sends them in a real round) and each party places its one sealed order.
const PARTY = (env.FLEET_PARTY_MODES ?? "otc,rfq").split(",").filter((m) => ["otc", "rfq"].includes(m));
const PARTY_EVERY_MIN = Number(env.FLEET_PARTY_EVERY_MIN ?? 25);
const LAYOUT: Record<string, number> = { uniform: 0, vickrey: 0, buyback: 0, launch: 1, rfq: 2, otc: 3 };
const QUICKNET = { genesis: 1692803367, period: 3 };
const MIN_SPENDABLE = 260_000;

const say = (bot: string, m: string) => console.log(`${new Date().toISOString()} [${bot}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

// One wallet command at a time across the whole fleet: proving is the heavy part, and the server signs rounds too.
let lock: Promise<unknown> = Promise.resolve();
// The tool's own log lines (colour codes and INFO noise removed); the error is usually the last of them.
const tidy = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => l.trim() && !/ INFO /.test(l)).slice(-4).join(" | ").slice(0, 600);
function dev(args: string[], timeout = 10 * 60_000): Promise<string> {
  // stdin is closed at once: `wallet init` waits on an open stdin (for a phrase to import) and never finishes.
  const run = lock.then(() => new Promise<string>((ok, no) => execFile(DEVTOOL, args, { encoding: "utf8", timeout, maxBuffer: 16 << 20 },
    (e, out, err) => e ? no(new Error(`${args[2] ?? args[0]} failed: ${tidy(err || e.message)}`)) : ok(out)).stdin?.end()));
  lock = run.catch(() => {});
  return run;
}

type Bot = { name: string; wallet: string; ua: string };
async function ensureWallet(name: string): Promise<Bot> {
  const wallet = path.join(DIR, name, "wallet");
  // A wallet whose first start failed part-way (no keys file yet) is made again from the start.
  if (existsSync(wallet) && !existsSync(path.join(wallet, "keys.toml"))) { rmSync(wallet, { recursive: true, force: true }); rmSync(`${wallet}.age`, { force: true }); }
  if (!existsSync(wallet)) {
    mkdirSync(path.dirname(wallet), { recursive: true, mode: 0o700 });
    for (let i = 1; ; i++) {
      try { await dev(["wallet", "-w", wallet, "init", "--name", name, "-i", `${wallet}.age`, "-n", "test", "-s", LWD]); break; }
      catch (e) { say(name, `wallet not made (try ${i}): ${(e as Error).message}`); rmSync(wallet, { recursive: true, force: true }); rmSync(`${wallet}.age`, { force: true }); await sleep(60_000); }
    }
    say(name, "wallet made");
  }
  const ua = (await dev(["wallet", "-w", wallet, "list-addresses"])).match(/utest1[0-9a-z]+/)?.[0];
  if (!ua) throw new Error("no wallet address");
  writeFileSync(path.join(DIR, name, "address.txt"), ua + "\n");
  return { name, wallet, ua };
}
async function balance(b: Bot) {
  await dev(["wallet", "-w", b.wallet, "sync", "-s", LWD]);
  const j = JSON.parse(await dev(["wallet", "-w", b.wallet, "balance", "--json"]));
  return { total: Number(j.total), spendable: Number(j.sapling_spendable) + Number(j.orchard_spendable) + Number(j.ironwood_spendable ?? 0) };
}
async function pay(b: Bot, uri: string) {
  await dev(["wallet", "-w", b.wallet, "sync", "-s", LWD]);
  const out = await dev(["wallet", "-w", b.wallet, "pay", "-i", `${b.wallet}.age`, "--disable-confirmation", "-s", LWD, "--payment-uri", uri]);
  const txid = out.match(/^[0-9a-f]{64}$/gm)?.at(-1);
  if (!txid) throw new Error(`no txid: ${out.slice(-160)}`);
  return txid;
}

// ---- the site's public API (the same routes web/src/lib/api.ts calls)
async function api(p: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${SITE}${p}`, { ...init, signal: AbortSignal.timeout(60_000) });
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, body: JSON.parse(t) }; } catch { return { ok: false, status: r.status, body: t.slice(0, 200) }; }
}
const post = (p: string, b: unknown) => api(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
async function openRounds() {
  const r = await api("/api/auctions");
  if (!r.ok || !Array.isArray(r.body)) return [];
  // Leave time for the deposit to be mined before bids close.
  return r.body.filter((a: any) => a.state === "OPEN" && PUBLIC.includes(a.mode) && Number(a.T_submit) - Date.now() / 1000 > 240);
}

// ---- the shipped sealer bundle, unchanged, driven through a stand-in for its form (the page drives it in a frame)
type El = { value: string; textContent: string; submit?: (e: { preventDefault(): void }) => void; addEventListener(t: string, f: any): void };
const els = new Map<string, El>();
const el = (id: string): El => {
  if (!els.has(id)) els.set(id, { value: "", textContent: "", addEventListener(t: string, f: any) { (this as any)[t] = f; } });
  return els.get(id)!;
};
let sealerReady: Promise<unknown> | null = null;
let sealing: Promise<unknown> = Promise.resolve();
function seal(fields: Record<string, string>): Promise<{ envelope: string; uri: string; round: number }> {
  // The browser bundle reaches for require("crypto") where a page has none; in Node it gets Node's own.
  sealerReady ??= (Object.assign(globalThis as any, { document: { getElementById: el }, require: createRequire(import.meta.url) }), import(pathToFileURL(SEALER).href));
  const run = sealing.then(async () => {
    await sealerReady;
    for (const [k, v] of Object.entries(fields)) el(k).value = v;
    el("bid").submit!({ preventDefault() {} });
    for (let i = 0; i < 800; i++) {
      const envelope = el("envelope").textContent, err = el("error").textContent;
      if (err) throw new Error(err);
      if (envelope) return { envelope, uri: el("uri").textContent, round: Number(el("round").textContent) };
      await sleep(25);
    }
    throw new Error("the sealer did not answer");
  });
  sealing = run.catch(() => {});
  return run;
}
function memoParts(hex: string) {
  if (!/^[0-9a-f]{1024}$/.test(hex) || !hex.startsWith("ff424e5a02")) throw new Error("the sealer produced a memo that is not framing v2");
  const len = parseInt(hex.slice(10, 14), 16);
  if (len <= 0 || len > 487 || /[^0]/.test(hex.slice((7 + len + 18) * 2))) throw new Error("memo framing: bad length or padding");
  return { ct: hex.slice(14, 14 + len * 2), tag: hex.slice(14 + len * 2, 14 + (len + 18) * 2) };
}

// The bid page's prepareSealedBid (web/src/lib/bidder/index.ts), step for step.
async function sealedBid(packet: any, signer: string, address: string, price: bigint, refund: string, lot?: string, owner?: { private_hex: string; public_hex: string }) {
  const m: any = verifyRecord(packet, signer);
  const mode = String(m.clearing?.mode ?? "uniform");
  if (mode === "uniform" || mode === "vickrey") validateManifest(m);
  else if (!(Array.isArray(m.deposit_addresses) && Array.isArray(m.envelope_keys) && m.envelope_keys.length === 3 && m.drand?.R > 0)) throw new Error("manifest is not one the bid page can bid in");
  if (!m.deposit_addresses.includes(address)) throw new Error("deposit address is not one of this round's");
  const prep: any = prepareBid({ auction_id: m.auction_id, price_zats: price, quantity: 1, destination_ua: refund, envelope_public_hexs: m.envelope_keys, owner, network: m.network });
  const tag = prep.envelope_ct_hex ? hash(Buffer.from(prep.envelope_ct_hex, "hex")).slice(0, 36) : "00".repeat(18);
  const sealed = await seal({
    opening: new Date((QUICKNET.genesis + (m.drand.R - 1) * QUICKNET.period) * 1000).toISOString(), auction: m.auction_id, price: String(price), quantity: "1",
    collateral: m.C_zats, address, owner: prep.owner.public_hex, nonce: prep.nonce_hex, commitment: prep.settlement_commitment_hex,
    envelope_tag: tag, layout_version: String(LAYOUT[mode] ?? 0), binding: lot ?? m.auction_id, holder: "",
  });
  const parts = memoParts(sealed.envelope);
  if (parts.tag !== tag) throw new Error("memo envelope tag mismatch");
  const shape = sealedBidShape(parts.ct, m.drand.R);
  if (!shape.ok) throw new Error(`sealed bid structure: ${(shape as any).reason}`);
  const ciphertext_hash = hash(Buffer.from(parts.ct, "hex"));
  const bound: any = bindSealedBid(prep, m.auction_id, ciphertext_hash);
  return { m, uri: sealed.uri, ciphertext_hash, owner_private_hex: bound.owner.private_hex, owner_sig_hex: bound.owner_sig_hex, envelope_ct_hex: bound.envelope_ct_hex, envelope_hex: sealed.envelope };
}

async function bid(b: Bot, round: any, party?: { key: { private_hex: string; public_hex: string }; price: number }) {
  const slot = await post(`/api/auctions/${round.id}/slot`, party ? { key: party.key.public_hex } : {});
  if (!slot.ok) throw new Error(`no slot (${slot.status}): ${JSON.stringify(slot.body).slice(0, 120)}`);
  const pk = await api(`/api/auctions/${round.id}/packet`);
  if (!pk.ok) throw new Error(`no packet (${pk.status})`);
  const lots: string[] | undefined = (verifyRecord(pk.body.manifest, pk.body.signer) as any).lots;
  const lot = lots?.length ? pick(lots) : undefined;
  const price = BigInt(party ? party.price : round.mode === "buyback" ? rnd(2, 30) * 10 : rnd(10, 300) * 10);
  const s = await sealedBid(pk.body.manifest, pk.body.signer, slot.body.address, price, b.ua, lot, party?.key);
  // The recovery record, as the page's download: refunds a deposit the round never counted.
  const keys = path.join(DIR, b.name, "keys"); mkdirSync(keys, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(keys, `${round.id.slice(0, 12)}-${s.ciphertext_hash.slice(0, 12)}.json`), JSON.stringify({ auction_id: round.id, address: slot.body.address, ciphertext_hash: s.ciphertext_hash, owner_private_hex: s.owner_private_hex, envelope_hex: s.envelope_hex }), { mode: 0o600 });
  const txid = await pay(b, s.uri);
  const sub = await post(`/api/auctions/${round.id}/bids`, { address: slot.body.address, txid, envelope_hex: s.envelope_hex, envelope_ct_hex: s.envelope_ct_hex, owner_sig_hex: s.owner_sig_hex, ciphertext_hash: s.ciphertext_hash });
  if (!sub.ok) throw new Error(`paid ${txid.slice(0, 12)} but the record was refused (${sub.status}): ${JSON.stringify(sub.body).slice(0, 120)}`);
  say(b.name, `bid ${price} on ${round.mode} ${round.id.slice(0, 8)}: paid ${txid.slice(0, 12)}`);
  appendFileSync(path.join(DIR, "bids.ndjson"), JSON.stringify({ t: Date.now(), bot: b.name, round: round.id, mode: round.mode, txid }) + "\n");
}

const THINGS = ["Night lamp", "Field recorder", "Oak stool", "Print run", "Studio hours", "Seed tranche", "Ceramic set", "Tour tickets", "Wool blanket", "Bike frame", "Camera body", "Vinyl pressing", "Garden plot", "Desk lamp", "Market stall", "Guitar pedal", "Coffee lot", "Tea harvest", "Poster set", "Book run"];
// The demo collection the fleet sells, every way a collection sells: the mint (a sealed uniform-price auction), a set
// of one-of-ones (a drop, each to its own highest bid), floor buybacks, private sales (OTC) and commissions (RFQ).
const ONES = ["Lantern", "Tidewalker", "Ember", "Static", "Hollow", "Moth", "Veil", "Cinder", "Drift", "Signal", "Wisp", "Hush", "Lark", "Gloam"];
const specterNo = () => rnd(1, 9999);
const lotFor = (mode: string) => mode === "uniform" ? `Specters mint: wave ${rnd(2, 99)}` : mode === "drop" ? `Specter one-of-ones ${rnd(2, 99)}`
  : mode === "buyback" ? `Specters floor buyback ${rnd(2, 99)}` : mode === "otc" ? `Specter #${specterNo()} private sale`
  : mode === "rfq" ? `Commission: animate Specter #${specterNo()}` : `${pick(THINGS)} ${rnd(2, 99)}`;
async function startRound(b: Bot) {
  const mode = pick(PUBLIC), lot = lotFor(mode);
  const f: any = { mode, lot, minutes: pick([20, 30, 40, 60]), max_price: 3000, reserve: 10 };
  if (mode === "uniform") Object.assign(f, { supply: rnd(2, 6), payout_ua: b.ua });
  if (mode === "launch") Object.assign(f, { supply: rnd(3, 6), payout_ua: b.ua, minimum_raise: rnd(1, 4) * 500 });
  if (mode === "drop") Object.assign(f, { lots: [...ONES].sort(() => Math.random() - 0.5).slice(0, rnd(2, 5)).map((x) => `#${specterNo()} ${x}`), payout_ua: b.ua });
  if (mode === "buyback") Object.assign(f, { supply: rnd(2, 6), treasury_ua: b.ua, max_price: 300, budget: 1200 });
  const r = await post("/api/rounds", f);
  say(b.name, r.ok ? `started a ${mode} round (${lot})` : `start refused (${r.status}): ${JSON.stringify(r.body).slice(0, 160)}`);
  // A buyback's budget is paid from its request page; the bot pays it from its own wallet.
  if (r.ok && mode === "buyback" && r.body?.rid) void fundRequest(b, r.body).catch((e) => say(b.name, `budget not paid: ${String(e.message).slice(0, 120)}`));
}
// An OTC or RFQ round, played by several bots: b starts it, the invitees join with their own party keys, and once the
// round is taking bids each party seals one order (OTC: a seller's ask and a buyer's limit that usually cross; RFQ: two
// dealers' quotes, with b funding the budget as the buyer).
let lastParty = 0, partyTurn = 0;
async function startPartyRound(b: Bot, all: Bot[]) {
  const mode = PARTY[partyTurn++ % PARTY.length], lot = lotFor(mode);
  const others = all.filter((x) => x !== b).sort(() => Math.random() - 0.5);
  const mine = generateOwnerKey();
  const f: any = mode === "otc" ? { mode, lot, minutes: pick([20, 30]), side: "seller", creator_key: mine.public_hex, max_price: 3000 }
    : { mode, lot, minutes: pick([20, 30]), treasury_ua: b.ua, dealers: 2, max_price: 500, budget: 1000 };
  const r = await post("/api/rounds", f);
  if (!r.ok) { say(b.name, `${mode} start refused (${r.status}): ${JSON.stringify(r.body).slice(0, 140)}`); return; }
  lastParty = Date.now();
  say(b.name, `started a ${mode} round (${lot})`);
  const parties: { bot: Bot; key: { private_hex: string; public_hex: string }; price: number }[] = [];
  if (mode === "otc") parties.push({ bot: b, key: mine, price: rnd(80, 150) * 10 });
  for (const [i, inv] of (r.body.invites ?? []).entries()) {
    const bot = others[i % others.length], key = generateOwnerKey();
    const j = await post(`/api/rounds/${r.body.rid}/join`, { invite: inv.token, key: key.public_hex });
    if (!j.ok) { say(bot.name, `couldn't join the ${mode} round: ${JSON.stringify(j.body).slice(0, 120)}`); return; }
    parties.push({ bot, key, price: mode === "otc" ? rnd(110, 200) * 10 : rnd(10, 50) * 10 });
  }
  say(b.name, `${parties.length} parties joined the ${mode} round`);
  if (mode === "rfq") void fundRequest(b, r.body).catch((e) => say(b.name, `budget not paid: ${String(e.message).slice(0, 120)}`));
  // Wait for the round to take bids, then each party bids once.
  let id: string | undefined;
  for (let i = 0; i < 120 && !id; i++) { await sleep(20_000); id = (await api(`/api/rounds/${r.body.rid}?token=${r.body.token}`)).body?.auction_id; }
  if (!id) { say(b.name, `the ${mode} round never opened`); return; }
  for (let i = 0; i < 30; i++) { const a = await api(`/api/auctions/${id}`); if (a.body?.live) break; await sleep(20_000); }
  for (const p of parties) {
    await bid(p.bot, { id, mode }, { key: p.key, price: p.price }).catch((e) => say(p.bot.name, `${mode} order not placed: ${String(e.message).slice(0, 160)}`));
  }
}

async function fundRequest(b: Bot, req: any) {
  for (let i = 0; i < 120; i++) {
    const v = await api(`/api/rounds/${req.rid}?token=${req.token}`);
    const id = v.body?.auction_id;
    if (id) {
      const f = (await api(`/api/auctions/${id}`)).body?.funding;
      if (f?.address && f?.amount_zats) { const tx = await pay(b, `zcash:${f.address}?amount=${(Number(f.amount_zats) / 1e8).toFixed(8)}`); say(b.name, `budget paid ${tx.slice(0, 12)}`); return; }
    }
    await sleep(20_000);
  }
}

// The last bot also tops up the site's demo wallet (web/gateway/demo.ts) when it runs low: 25 notes of 0.01 TAZ, so
// visitors' demo deposits can be paid one after another without waiting for change. At most once an hour.
let gaveAt = 0;
async function topUpDemo(b: Bot, spendable: number) {
  if (Date.now() - gaveAt < 3600_000 || spendable < 30_000_000) return;
  const d = await api("/api/demo");
  if (!d.ok || !d.body?.low || !/^utest1[0-9a-z]+$/.test(d.body.address ?? "")) return;
  gaveAt = Date.now();
  const q = Array.from({ length: 25 }, (_, i) => `${i ? `address.${i}` : "address"}=${d.body.address}&${i ? `amount.${i}` : "amount"}=0.01`).join("&");
  say(b.name, `demo wallet topped up: ${(await pay(b, `zcash:?${q}`)).slice(0, 12)}`);
}

// One note pays one bid, and its change takes about ten blocks to confirm, so a bot holding one large note bids
// about once every 12 minutes. Once, each bot pays itself 20 notes of 0.02 TAZ so it can bid back to back.
async function splitNotes(b: Bot, spendable: number) {
  const mark = path.join(DIR, b.name, "split.done");
  if (existsSync(mark) || spendable < 50_000_000) return;
  const q = Array.from({ length: 20 }, (_, i) => `${i ? `address.${i}` : "address"}=${b.ua}&${i ? `amount.${i}` : "amount"}=0.02`).join("&");
  const tx = await pay(b, `zcash:?${q}`);
  writeFileSync(mark, tx + "\n"); say(b.name, `split into 20 notes: ${tx.slice(0, 12)}`);
}

async function run(b: Bot, starter: boolean, giver: boolean) {
  for (;;) {
    try {
      const bal = await balance(b);
      await splitNotes(b, bal.spendable).catch((e) => say(b.name, `split: ${String(e.message).slice(0, 140)}`));
      if (bal.spendable < MIN_SPENDABLE) { say(b.name, `waiting for funds (spendable ${bal.spendable}, total ${bal.total})`); await sleep(300_000); continue; }
      if (giver) await topUpDemo(b, bal.spendable).catch((e) => say(b.name, `demo top-up: ${String(e.message).slice(0, 160)}`));
      const open = await openRounds();
      if (starter && open.length < TARGET_OPEN) await startRound(b);
      if (starter && PARTY.length && Date.now() - lastParty > PARTY_EVERY_MIN * 60_000) { lastParty = Date.now(); void startPartyRound(b, allBots).catch((e) => say(b.name, `party round: ${String(e.message).slice(0, 160)}`)); }
      if (!open.length) { await sleep(60_000); continue; }
      await bid(b, pick(open));
    } catch (e) { say(b.name, String((e as Error).message ?? e).split("\n")[0].slice(0, 220)); await sleep(60_000); }
    await sleep(rnd(PAUSE[0], PAUSE[1]) * 1000);
  }
}

// FLEET_CHECK=<round id> <refund ua>: seal one bid against a live round and stop before paying (a deploy check).
if (env.FLEET_CHECK) {
  const [id, ua] = env.FLEET_CHECK.split(" ");
  const slot = await post(`/api/auctions/${id}/slot`, {}), pk = await api(`/api/auctions/${id}/packet`);
  const lots: string[] | undefined = (verifyRecord(pk.body.manifest, pk.body.signer) as any).lots;
  const s = await sealedBid(pk.body.manifest, pk.body.signer, slot.body.address, 1000n, ua, lots?.[0]);
  console.log(JSON.stringify({ sealed: true, mode: s.m.clearing?.mode, uri_ok: s.uri.startsWith(`zcash:${slot.body.address}?amount=`), memo_bytes: s.envelope_hex.length / 2, ciphertext_hash: s.ciphertext_hash.slice(0, 12) }));
  process.exit(0);
}
mkdirSync(DIR, { recursive: true, mode: 0o700 });
const bots: Bot[] = [], allBots = bots;
for (let i = 1; i <= BOTS; i++) {
  const b = await ensureWallet(`bot${i}`);
  say(b.name, `address ${b.ua}`);
  bots.push(b);
}
await Promise.all(bots.map(async (b, i) => { await sleep(i * 20_000); await run(b, i === 0, i === bots.length - 1); }));
