// Phase 5 part 2 §1 (docs/design/phase5-part2-live.md): one live auction per market mode on the OrbStack signer hosts
// (host custody, R28), driven only by shipped commands. Each scenario checks: the CLI result equals the registry's pure
// clear on the same opened set, the receipts equal the scenario's expected obligations, every refund/payment landed at
// the bidder's own destination, and `benzo verify` passes on a cold copy.
// Build+run: npx esbuild tools/repro/markets.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/markets.mjs && BNZ_LWD_SINGLE=1 node tmp/markets.mjs <scenario>...
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { assertScratch } from "./scratch";
import { Keypair } from "@solana/web3.js";
import { SigningKey, Wallet } from "ethers";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, STATE, env, DRAND } from "../../e2e/lib/env";
import { h19FeeBound } from "../../e2e/lib/h19";
import { hash, jsonBytes, signRecord, verifyRecord } from "../../manifest/schema";
import { validateWitnessSet, verifyApprovalMap, witnessSetHash } from "../../witness";
import { clearForMode } from "../../clear/registry";
import { deliveryRowOrder } from "../../clear/launch";
import { generateOwnerKey, ownerPublic, signStatement } from "../../envelope";
import { benzoBin, dkgOnHosts, hostDeliveryList, hostEnvelopeKeys, hostEnvelopeOpens, hostWitnessCerts, hostWitnessKeys, sh } from "../../e2e/lib/hosts";
import * as z from "../../e2e/lib/zcash";
import { tleBound } from "../../settle/bounded"; // R52: drand spawns are bounded like the product's

const C = 200_000; // part 2: small collateral
const OUT = path.join(ROOT, "tmp/markets"); mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const pczt = path.join(ROOT, "settle/target/release/benzo-pczt"), fresh = (w: string) => sh(pczt, ["address", w, "--network", env("BNZ_NETWORK")]).split("\n").at(-1)!;
const benzo = (args: string[], input?: any) => { const out = sh(benzoBin, args, input === undefined ? undefined : JSON.stringify(input)); return out.startsWith("{") || out.startsWith("[") ? JSON.parse(out.split("\n").filter(l => l.startsWith("{") || l.startsWith("[")).at(-1)!) : out; };
// Raw-stdin variant for the build-mode commands that read key material from fd 0 (e.g. `launch deliver
// --owner-key-stdin`); the key never lands in argv.
const benzoRaw = (args: string[], raw: string) => JSON.parse(sh(benzoBin, args, raw).split("\n").filter(l => l.startsWith("{")).at(-1)!);
// A failed drand fetch (one killed a live run) reads as round 0, so the wait simply polls again.
const latestRound=async()=>{try{return (await (await fetch(`${DRAND}/public/latest`)).json()).round as number}catch{return 0}};

// Part 2 fixtures. Collection drop: three lot ids (32 bytes, bound by each order). The sealed reserve/max-price
// plaintext is u64be price || auction_id, tlocked to round R by the pinned Go tle.
const LOTS = ["a", "b", "c"].map(l => hash(Buffer.from(`benzo-drop-lot-${l}`)));
const sealReserve = (price: number, id: string, R: number): string => {
  const pt = Buffer.alloc(40); pt.writeBigUInt64BE(BigInt(price)); Buffer.from(id, "hex").copy(pt, 8);
  const r = spawnSync(path.join(STATE, "bin/tle"), ["-e", "-f", "-r", String(R), "-c", env("BNZ_DRAND_CHAIN_HASH")], { input: pt, maxBuffer: 1 << 20, ...tleBound });
  if (r.status !== 0) throw new Error(`tle seal failed: ${(r.stderr ?? Buffer.alloc(0)).toString().trim().slice(-200)}`);
  return r.stdout.toString("hex").trim();
};
// Recurring buyback: the marketplace.json collection (adapters/zilkroad.ts) whose hash commits the manifest's lot
// label; every round of the series names it.
const MARKETPLACE = { version: 1, adapter: "zilkroad", collection: "benzo-buyback-collection", serial_range: { first: 1000, count: 24 }, metadata_commitment: hash(Buffer.from("benzo-buyback-collection metadata")) };
const ZILKROAD_LOT = "zilkroad:" + hash(jsonBytes(MARKETPLACE));
const buybackBlock = (c: Ctx) => ({ budget_zats: "500000", max_price_zats: "200000", treasury_ua: c.treasuryUa, funding_ua: c.fundingUa });
// R33 item 2: the balance window and its start are fixed in the SIGNED manifest before bidding. Its start block's
// header time must be at or after R's UTC time (every host checks from its own chain), so the manifest places it
// after the expected height at R. The block cadence is MEASURED from this harness's own lightwalletd and the
// estimate assumes blocks TWICE as fast as measured, plus a 25-block margin: a later window only delays the run
// (settlement waits for it), while an early one is refused by every host (live: run 2d9793f0, 45s assumed against
// a 22s cadence -> "balance window starts before the release round").
const blockTime = (height: number) => Number(JSON.parse(sh(path.join(STATE, "bin/grpcurl"), ["-import-path", path.join(STATE, "proto"), "-proto", "service.proto", "-d", JSON.stringify({ height }), env("BNZ_LWD_URL"), "cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlock"])).time);
const balanceStart = (c: Ctx) => {
  const release = Number(env("BNZ_DRAND_GENESIS")) + (c.R - 1) * 3;
  const spb = Math.max(5, Math.round((blockTime(c.tip - 1) - blockTime(c.tip - 51)) / 50) || 30);
  // R61: testnet cadence swung 14–90 s within a day (RG attempt 6: a 90 s estimate was overtaken by 14 s blocks and
  // the window started before R, which R61 now voids). Assume blocks at least 3× faster than measured and never
  // slower than 10 s: a later window only delays the run; an early one voids the bond and fails the scenario.
  return c.tip + Math.ceil((release - Date.now() / 1000) / Math.min(spb / 3, 10)) + 25;
};

// Cross-process locks (lock dirs). A lock this process holds is released if its scenario throws.
const held = new Set<string>();
// Completed scenarios (the buyback series links round 2 to round 1's result hash).
const ran: Record<string, { id: string; publicDir: string; signer: string; resultHash: string }> = {};
async function takeLock(lock: string, staleMs: number) {
  for (;;) { try { mkdirSync(lock); held.add(lock); return; } catch { if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > staleMs) rmSync(assertScratch(lock), { recursive: true, force: true }); await sleep(5_000); } }
}
function dropLock(lock: string) { rmSync(assertScratch(lock), { recursive: true, force: true }); held.delete(lock); }
type Bid = { price: number; quantity?: number; owner?: { private_hex: string; public_hex: string }; lot?: string; holder?: boolean; deliver?: { chain: string; kind: string; to: string; elgamal?: string } };
type SeriesLink = { series_id: string; round_index: number; previous_result_hash: string | null };
type Ctx = { owners: Record<string, { private_hex: string; public_hex: string }>; treasuryUa: string; fundingUa: string; tip: number; id: string; R: number; series?: SeriesLink };
type Post = { id: string; signer: string; cold: string; doc: () => any; check: (id: string, pass: boolean, d?: string) => void; at: (a: string) => number; sellerUa: string; late: { party: string; amount: number; leaf: number } | null };
type Scenario = { mode: string; supply?: number; treasury?: number; batch_cap?: number; reserve?: number; fundChunk?: number; windows?: [number, number, number]; lots?: string[]; marketplace?: any;
  // Part 2 collection drop (b): the winners that pay their balance in the window and the defaults the run expects;
  // part 2 buyback: the serial each winner takes in (one per winner, in leaf order).
  defaults?: number[]; balancePays?: number[]; balanceDust?: number[]; intakeSerials?: number[];
  // A19 (R41 F7/F9): the leaf whose balance address gets ONE 1-zat note AFTER the two hosts sign batch 1.
  lateDust?: { leaf: number };
  strayClaim?: boolean;
  extra: (ctx: Ctx) => any; owners?: string[]; bids: (o: Record<string, any>) => Bid[];
  // Explicit expected receipts per party; when absent, the registry's own obligations over the published result, plus
  // an outcome assertion (`outcomes`) on that result.
  expect?: (refunds: string[]) => Record<string, number>; outcomes?: (o: string[]) => boolean; post?: (h: Post) => Promise<void> | void };
// Expected receipts are per party in zats (C = 200,000).
// The collection drop's own assertions beside the shared ones: the plan's published defaults are exactly the
// scenario's (the payer is never a default), the forfeited bond and the paid balances land at the seller's own
// destination, and verify replays attachSerials from the published beacon — one flipped serial in the result and
// its projection turns the cold copy red with the replay's own error, so the assignment is recomputed, never copied.
const dropPost = async (h: Post) => {
  h.check("drop-defaults", JSON.stringify(h.doc().settlement?.defaults ?? null) === "[2]", JSON.stringify(h.doc().settlement?.defaults));
  h.check("drop-seller-landed", h.at(h.sellerUa) === 700_000, String(h.at(h.sellerUa)));
  // R37.4 (the r7-5 emit leg): after R the published doc carries the reserve opening and the shipped
  // `benzo verify` accepts its re-derivation (manifest/reserve.ts requireReserveOpening over the beacon).
  // Mutation A16-b (publish drops reserve_opening) turns this red: verify refuses 'reserve opening published
  // differs from re-derived' (replayed: docs/evidence/phase-6/mutations/A16-b.out).
  const ro = h.doc().reserve_opening?.plaintext_hex ?? null;
  const rv = spawnSync(benzoBin, ["verify", "--dir", h.cold, "--signer", h.signer], { encoding: "utf8", maxBuffer: 64 << 20 });
  const rerr = (rv.stdout + rv.stderr).split("\n").filter(l => l.startsWith("ERROR")).join(" | ");
  h.check("drop-reserve-opening", typeof ro === "string" && ro.length > 0 && rv.status === 0,
    `reserve_opening ${ro === null ? "MISSING" : "present"}; verify exit ${rv.status}${rerr ? " " + rerr : ""}`);
  // R33 item 3: the published defaults are carried by two VERIFIED host-signed approval maps from distinct
  // pinned signers (the witness set) — never a coordinator-only list.
  const d = h.doc(), set = validateWitnessSet(verifyRecord(d.witness_set, d.signer), h.id);
  const agreeing = (d.settlement?.approval_maps ?? []).filter((mp: any) => mp && verifyApprovalMap(mp, set.keys) && mp.auction_id === h.id && JSON.stringify(mp.defaults) === "[2]");
  h.check("drop-defaults-maps", new Set(agreeing.map((mp: any) => mp.witness)).size >= 2, `${agreeing.length} agreeing verified maps`);
  // 5M11 (the reviewer's equal-balance swap): a coordinator-swapped defaults list — obligations, rows and
  // receipts are identical for two default sets with the same balance total — must fail benzo verify with its
  // own error, while OK accounting still passes on the forged copy.
  if (!d.settlement) h.check("drop-swapped-defaults-refused", false, "no settlement to swap");
  else {
  const swapped = path.join(OUT, "tamper", h.id + "-defaults");
  rmSync(assertScratch(swapped), { recursive: true, force: true }); cpSync(h.cold, swapped, { recursive: true });
  for (const f of ["auction.json", "summary.json"]) {
    const tdoc = json(path.join(swapped, f));
    if (f === "auction.json") tdoc.settlement.defaults = [0]; else tdoc.defaults = [0];
    writeFileSync(path.join(swapped, f), jsonBytes(tdoc));
  }
  const vd = spawnSync(benzoBin, ["verify", "--dir", swapped, "--signer", h.signer], { encoding: "utf8" });
  // The specific ERROR is the assertion: whatever else also objects (this drop's two lots clear at different
  // prices, so a [2]->[0] swap is not invisible to accounting — the equal-balance case is tools/repro/r33-defaults.ts),
  // verify must refuse a coordinator-swapped defaults list with its own defaults error.
  h.check("drop-swapped-defaults-refused", vd.status !== 0 && /ERROR defaults refused: settlement defaults differ from the host-signed approval maps/.test(vd.stdout + vd.stderr), `exit ${vd.status}`);
  }
  const tampered = path.join(OUT, "tamper", h.id);
  rmSync(assertScratch(tampered), { recursive: true, force: true }); cpSync(h.cold, tampered, { recursive: true });
  const tdoc = json(path.join(tampered, "auction.json"));
  tdoc.result.serial_assignment[0].serials[0] ^= 1;
  writeFileSync(path.join(tampered, "auction.json"), jsonBytes(tdoc));
  writeFileSync(path.join(tampered, "result.json"), jsonBytes(tdoc.result));
  const v = spawnSync(benzoBin, ["verify", "--dir", tampered, "--signer", h.signer], { encoding: "utf8" });
  h.check("drop-serial-replay-enforced", v.status !== 0 && /canonical result differs/.test(v.stdout + v.stderr), `exit ${v.status}`);
  // Ruling R41 (F7/F9): the claimed late row is `paid` and attested in the two agreeing maps of the batch that
  // PAID it (its `balance_refunds` carry the row, its outputs the row's {party, output_index}); the row's claim
  // publishes; and every unpaid refund row publishes as `pending` with no receipt (counts only — verify does not
  // count them). The cold-verify assertion above runs the real balance-refs check over exactly this data.
  if (h.late) {
    const d = h.doc(), set = validateWitnessSet(verifyRecord(d.witness_set, d.signer), h.id);
    const entry = (d.settlement?.balance_refunds ?? []).find((e: any) => e.party === h.late!.party);
    const receipt = (d.settlement?.receipts ?? []).find((r: any) => r.party === h.late!.party);
    const attested = (d.settlement?.approval_maps ?? []).filter((mp: any) => mp && verifyApprovalMap(mp, set.keys) && receipt && mp.txid === receipt.txid &&
      (mp.balance_refunds ?? []).some((r: any) => r.party === h.late!.party && r.amount_zats === String(h.late!.amount)) &&
      (mp.outputs ?? []).some((o: any) => o.party === h.late!.party && o.output_index === receipt.output_index));
    h.check("drop-late-row-attested", entry?.state === "paid" && attested.length === 2 && new Set(attested.map((mp: any) => mp.witness)).size === 2,
      `entry ${entry?.state}; attesting maps ${attested.length} (distinct ${new Set(attested.map((mp: any) => mp.witness)).size})`);
    h.check("drop-late-claim-published", (d.claims ?? []).some((c: any) => c.party === h.late!.party), `${(d.claims ?? []).length} published claims`);
    const unpaid = (d.settlement?.balance_refunds ?? []).filter((e: any) => e.party !== h.late!.party);
    h.check("drop-unpaid-rows-pending", unpaid.length >= 1 && unpaid.every((e: any) => e.state === "pending"),
      `unpaid rows ${JSON.stringify(unpaid.map((e: any) => ({ party: e.party.slice(0, 28) + "…", state: e.state })))}`);
  }
};

const SCENARIOS: Record<string, Scenario> = {
  // Blind OTC, match: buyer bids 1,000, seller asks 600 -> midpoint 800; buyer gets C - 800 back, seller C + 800.
  "otc-match": { mode: "otc", owners: ["buyer", "seller"], extra: c => ({ reserve_zats: "0", otc: { buyer_key: c.owners.buyer.public_hex, seller_key: c.owners.seller.public_hex } }),
    bids: o => [{ price: 1000, owner: o.buyer }, { price: 600, owner: o.seller }], expect: () => ({ "leaf:0": C - 800, "leaf:1": C + 800 }) },
  // Blind OTC, no match: bid 500 < ask 700 -> cancelled; both get exact C back.
  "otc-nomatch": { mode: "otc", owners: ["buyer", "seller"], extra: c => ({ reserve_zats: "0", otc: { buyer_key: c.owners.buyer.public_hex, seller_key: c.owners.seller.public_hex } }),
    bids: o => [{ price: 500, owner: o.buyer }, { price: 700, owner: o.seller }], expect: () => ({ "leaf:0": C, "leaf:1": C }) },
  // Launch (main tranche), minimum raise met: supply 2, bids 300/250/200 -> two lots at the uniform 250; raise 500.
  "launch-meet": { mode: "launch", supply: 2, extra: () => ({ launch: { standard_lot_size: 1, minimum_raise_zats: "500" } }),
    bids: () => [{ price: 300 }, { price: 250 }, { price: 200 }], expect: () => ({ "leaf:0": C - 250, "leaf:1": C - 250, "leaf:2": C, seller: 500 }) },
  // Launch, minimum raise missed (600 > 500): cancelled, everyone gets exact C back.
  "launch-miss": { mode: "launch", supply: 2, extra: () => ({ launch: { standard_lot_size: 1, minimum_raise_zats: "600" } }),
    bids: () => [{ price: 300 }, { price: 250 }, { price: 200 }], expect: () => ({ "leaf:0": C, "leaf:1": C, "leaf:2": C }) },
  // Bid revision (uniform, supply 1): one owner bids 200, then revises to 300 inside the window; only the revision counts
  // and the superseded deposit is refunded exact C.
  // Part 2 §2 cross-chain demos (tools/repro/xchain-demos.ts): each seals the winners' cross-chain destinations
  // (`deliver`) in the bids' envelopes — the ONLY source of target-chain destinations. The fresh deliver targets are
  // generated per run and written to the run's private state as xchain-delivers.json (harness bidder state, like
  // refunds.json) so the demo driver can assert payment at them.
  "xchain-drop": { mode: "uniform", supply: 3, extra: () => ({ q_max: 1 }),
    bids: () => [
      { price: 300, quantity: 2, deliver: { chain: "solana", kind: "address", to: solanaFresh() } },
      { price: 250, deliver: { chain: "solana", kind: "address", to: solanaFresh() } },
      { price: 200, deliver: { chain: "solana", kind: "address", to: solanaFresh() } }] },
  // Mode B buyback window: sellers' asks, paid on Ethereum Sepolia through stealth delivery (R24: Railgun deferred).
  "xchain-buyback": { mode: "buyback", supply: 2, treasury: 600, owners: ["s1", "s2"],
    extra: c => ({ buyback: { budget_zats: "600", max_price_zats: "300", treasury_ua: c.treasuryUa, funding_ua: c.fundingUa } }),
    bids: o => [
      { price: 300, owner: o.s1, deliver: { chain: "evm", kind: "stealth", to: evmFreshMeta() } },
      { price: 250, owner: o.s2, deliver: { chain: "evm", kind: "stealth", to: evmFreshMeta() } }] },
  // ZEC<->SOL blind OTC (the match): the SOL leg settles through the Solana escrow to fresh addresses.
  "xchain-otc": { mode: "otc", owners: ["buyer", "seller"],
    extra: c => ({ reserve_zats: "0", otc: { buyer_key: c.owners.buyer.public_hex, seller_key: c.owners.seller.public_hex } }),
    bids: o => [
      { price: 1000, owner: o.buyer, deliver: { chain: "solana", kind: "address", to: solanaFresh() } },
      { price: 600, owner: o.seller, deliver: { chain: "solana", kind: "address", to: solanaFresh() } }] },
  // RFQ (reverse-Vickrey): dealers A and B allowlisted, X not. Quotes A 400, B 300, X 200: X is refused, B wins and is
  // paid the second-lowest valid quote (400); the buyer funded 500, so 100 returns to its treasury_ua.
  "rfq": { mode: "rfq", treasury: 500, owners: ["A", "B", "X"], extra: c => ({ rfq: rfqBlock(c, [c.owners.A, c.owners.B]) }),
    bids: o => [{ price: 400, owner: o.A }, { price: 300, owner: o.B }, { price: 200, owner: o.X }],
    expect: () => ({ "leaf:0": C, "leaf:1": C + 400, "leaf:2": C, treasury: 100 }), outcomes: o => o[1] === "winner" && o[2] === "not_allowlisted" },
  // RFQ with one valid quote (X not allowlisted): cancelled, every quote refunded exact C and the whole 500 returns.
  "rfq-cancel": { mode: "rfq", treasury: 500, owners: ["A", "B", "X"], extra: c => ({ rfq: rfqBlock(c, [c.owners.A, c.owners.B]) }),
    bids: o => [{ price: 400, owner: o.A }, { price: 200, owner: o.X }], expect: () => ({ "leaf:0": C, "leaf:1": C, treasury: 500 }) },
  // Phase 6 measure-first: one uniform auction with 8 bids (8 deposit spends in the batch), for per-session timing.
  "scale-8": { mode: "uniform", supply: 4, extra: () => ({ q_max: 1 }), bids: () => [300, 290, 280, 270, 260, 250, 240, 230].map(price => ({ price })) },
  // Phase 6 option B (R30): 27 bids + the seller = 28 outputs and 28 spends (27 deposits + the fee reserve) in ONE batch at
  // batch_cap 28, the largest batch under 100 KB; the reserve floor covers the 28-action real fee (140,000 zats) and B55
  // (H19) tops the live funding up to the preflight's worst-case bound + one fee slot (28 notes x 28 rows -> 295,000).
  "scale-27": { mode: "uniform", supply: 13, batch_cap: 28, reserve: 200_000, extra: () => ({ q_max: 1 }), bids: () => Array.from({ length: 27 }, (_, i) => ({ price: 400 - 5 * i })) },
  // Gate SC live half (phase6-h/SC, R85): 55 bids + the seller settle in 4 batches of 14. One funding transaction with
  // 55 deposit outputs would be ~190 KB, so the deposits are paid in 3 transactions of at most 19 (each well under
  // 100 KB), back to back from the bidder's existing notes; the windows are longer so all 3 mature before T_freeze.
  "scale-55": { mode: "uniform", supply: 27, batch_cap: 14, reserve: 400_000, fundChunk: 19, windows: [20, 42, 45], extra: () => ({ q_max: 1 }), bids: () => Array.from({ length: 55 }, (_, i) => ({ price: 600 - 10 * i })) },
  "revision": { mode: "uniform", owners: ["reviser"], extra: () => ({}),
    bids: o => [{ price: 200, owner: o.reviser }, { price: 250 }, { price: 300, owner: o.reviser }],
    outcomes: o => o[0] === "superseded" && o[2] === "winner" && o[1] !== "winner" },
  // Collection drop (part 2 §1 row 1): three lots, four bids, a sealed 300,000 reserve, the drand serial shuffle
  // (seed round R+2) and bond-then-pay (C is the 1,000 bps bond of the 2,000,000 cap). Lot a clears at 500,000
  // over the 400,000 bid, lot b at 450,000, and lot c's 100,000 bid sits below the sealed reserve (lot unfilled).
  // Winner leaf 0 pays its 300,000 balance INSIDE the manifest-fixed window; winner leaf 2 never pays and
  // forfeits its 200,000 bond to the seller (seller 500,000 + 200,000; the two losing bids get exact C back).
  "drop": { mode: "uniform", supply: 1, lots: LOTS, defaults: [2], balancePays: [0], balanceDust: [0], lateDust: { leaf: 0 }, strayClaim: true,
    extra: c => ({ B_max_zats: "2000000", bond: { bond_bps: 1000, balance_window_blocks: 40, balance_window_start_height: balanceStart(c) },
      serials: { first: 0, count: 8, seed_round_offset: 2 }, sealed_reserve: sealReserve(300_000, c.id, c.R) }),
    bids: () => [{ price: 500_000, lot: LOTS[0] }, { price: 400_000, lot: LOTS[0] }, { price: 450_000, lot: LOTS[1] }, { price: 100_000, lot: LOTS[2] }],
    expect: () => ({ "leaf:1": C, "leaf:3": C, seller: 700_000 }), post: dropPost },
  // Recurring buyback (part 2 §1 row 5), round 1 of a linked 2-round series: three asks against the zilkroad
  // collection, a sealed 180,000 max price and a 500,000 treasury budget funded before T_submit. The 190,000
  // ask exceeds the sealed max and is refused; the rest clear at the highest accepted ask (150,000). Every leaf
  // gets exact C plus its payment; 200,000 of the budget returns to the signed treasury_ua.
  "buyback-r1": { mode: "buyback", treasury: 500_000, marketplace: MARKETPLACE, intakeSerials: [1000, 1001],
    extra: c => ({ B_max_zats: "200000", lot: ZILKROAD_LOT, series: c.series, buyback: buybackBlock(c), sealed_reserve: sealReserve(180_000, c.id, c.R) }),
    bids: () => [{ price: 190_000 }, { price: 150_000 }, { price: 120_000 }],
    expect: () => ({ "leaf:0": C, "leaf:1": C + 150_000, "leaf:2": C + 150_000, treasury: 200_000 }) },
  // Round 2 of the same series (previous_result_hash = round 1's result hash): two asks clearing at 160,000.
  "buyback-r2": { mode: "buyback", treasury: 500_000, marketplace: MARKETPLACE, intakeSerials: [1010, 1011],
    extra: c => ({ B_max_zats: "200000", lot: ZILKROAD_LOT, series: c.series, buyback: buybackBlock(c), sealed_reserve: sealReserve(180_000, c.id, c.R) }),
    bids: () => [{ price: 160_000 }, { price: 130_000 }],
    expect: () => ({ "leaf:0": C + 160_000, "leaf:1": C + 160_000, treasury: 180_000 }) },
};

// RFQ block: the allowlisted dealers, a budget and cap, three throwaway delivery-attestation signers (not exercised
// here), a delivery deadline past the round, and the buyer's signed treasury return and funding addresses.
function rfqBlock(c: Ctx, dealers: { public_hex: string }[]) {
  const spki = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return { dealer_keys: dealers.map(d => d.public_hex), max_price_zats: "500", budget_zats: "500", delivery_deadline_height: c.tip + 20000, delivery_signers: [spki(), spki(), spki()], treasury_ua: c.treasuryUa, funding_ua: c.fundingUa };
}
// Fresh cross-chain destinations for the demo drivers (generated here; the sealed envelope is the only carrier).
const solanaFresh = () => Keypair.generate().publicKey.toBase58();
const evmFreshMeta = () => { const s = Wallet.createRandom().signingKey, v = Wallet.createRandom().signingKey; return "0x" + SigningKey.computePublicKey(s.privateKey, true).slice(2) + SigningKey.computePublicKey(v.privateKey, true).slice(2); };
async function run(name: string, link?: SeriesLink) {
  const sc = SCENARIOS[name]; if (!sc) throw new Error(`unknown scenario ${name}`);
  const log = path.join(OUT, `${name}.out`); writeFileSync(log, "");
  const say = (s: string) => { console.log(`[${name}] ${s}`); writeFileSync(log, readFileSync(log, "utf8") + s + "\n"); };
  let ok = true; const check = (id: string, pass: boolean, d = "") => { say(`${pass ? "PASS" : "ERROR"} ${id}${d ? " " + d : ""}`); ok &&= pass; };
  const id = process.env.BNZ_MARKETS_ID ?? randomBytes(32).toString("hex"); // the cross-chain demos pre-bind the id to their escrow lock (lock before bidding)
  say(`auction ${id} mode ${sc.mode}`);
  // Concurrent DKGs on the same hosts and frostd collide (live: "bob dkg exited 1"); processes take turns.
  const dkgLock = assertScratch(path.join(ROOT, "tmp", "markets-dkg.lock")); // R43: the lock lives under tmp/
  await takeLock(dkgLock, 600_000);
  let k: Awaited<ReturnType<typeof dkgOnHosts>>; try { k = await dkgOnHosts(id, benzo); } finally { dropLock(dkgLock); }
  const envelopeKeys = hostEnvelopeKeys(), witnessPubs = hostWitnessKeys();
  const owners = Object.fromEntries((sc.owners ?? []).map(n => [n, generateOwnerKey()]));
  const bids = sc.bids(owners);
  const vault = path.join(STATE, "vaults", id, "wallet"), addr = () => fresh(vault), bidder = () => fresh(path.join(STATE, "bidder"));
  const deposits = [k.escrow_ua, ...bids.slice(1).map(() => addr())], reserveUa = addr();
  const refunds = bids.map(() => bidder()), sellerUa = bidder(), treasuryUa = bidder(), fundingUa = addr();
  const privateDir = path.join(STATE, "run", `markets-${id}`), publicDir = path.join(ROOT, "tmp/markets/public", id); mkdirSync(privateDir, { recursive: true });
  writeFileSync(path.join(privateDir, "refunds.json"), JSON.stringify(refunds)); // test-harness bidder state
  writeFileSync(path.join(privateDir, "xchain-delivers.json"), JSON.stringify(bids.map(b => b.deliver ?? null))); // harness bidder state for the xchain demo driver
  writeFileSync(path.join(privateDir, "scenario.json"), JSON.stringify({ name, balancePays: sc.balancePays, balanceDust: sc.balanceDust, intakeSerials: sc.intakeSerials, defaults: sc.defaults, lateDust: sc.lateDust, strayClaim: sc.strayClaim })); // resume:<id>
  const witnessSet = signRecord({ version: 1, auction_id: id, q_w: 2, keys: witnessPubs }, readFileSync(path.join(STATE, "auction", "manifest-signing.pem"), "utf8"));
  writeFileSync(path.join(privateDir, "witness-set.json"), JSON.stringify(witnessSet));
  writeFileSync(path.join(privateDir, "operator.json"), JSON.stringify({ settlement: { signers: ["alice", "bob"], batch_cap: sc.batch_cap ?? 13, pczt_expiry_blocks: 364 }, routing: { bidders: deposits.map(deposit_ua => ({ deposit_ua })), seller_ua: sellerUa, fee_reserve_ua: reserveUa } }));
  // One bidder wallet funds every scenario: parallel harness processes take turns (a lock dir, stale after 40 min),
  // taken BEFORE the manifest's deadlines are set and held until the funding matured.
  const lock = assertScratch(path.join(ROOT, "tmp", "markets-fund.lock")); // R43: the lock lives under tmp/
  await takeLock(lock, 2_400_000);
  const now = Math.ceil(Date.now() / 1000), [wSubmit, wFreeze, wRelease] = sc.windows ?? [4, 30, 33], release = now + wRelease * 60, R = 1 + Math.ceil((release - Number(env("BNZ_DRAND_GENESIS"))) / 3);
  const manifest = { version: 1, network: "test", auction_id: id, escrow_ua: k.escrow_ua, frost_group_key: k.group_key, ...(sc.lots ? { lots: sc.lots } : { lot: `${sc.mode} round` }), supply: sc.supply ?? 1, reserve_zats: "10", tick_zats: "10", B_max_zats: "3000", q_max: 1, C_zats: String(C), fee_zats: "0", deposit_addresses: deposits, envelope_keys: envelopeKeys, witness_set_hash: witnessSetHash(witnessSet), drand: { chain_hash: env("BNZ_DRAND_CHAIN_HASH"), public_key: env("BNZ_DRAND_PUBLIC_KEY"), scheme: "bls-unchained-g1-rfc9380", genesis: Number(env("BNZ_DRAND_GENESIS")), period: 3, R }, T_submit: now + wSubmit * 60, T_freeze: now + wFreeze * 60, confirmations: 10, clearing: { mode: sc.mode, band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 }, refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1", ...sc.extra({ owners, treasuryUa, fundingUa, tip: z.tip(), id, R, series: link }) };
  // H10 (B42 gate DOC, R93): the same operator.json `auction publish` takes is passed to `auction create`, so the
  // signed manifest carries seller_ua_commitment (the commitment is set from the config's routing.seller_ua, never
  // typed into the manifest) and every live run exercises H10's bound path.
  benzo(["auction", "create", "--witness-set", path.join(privateDir, "witness-set.json"), "--config", path.join(privateDir, "operator.json")], manifest);
  const packet = benzo(["auction", "sign", "--id", id]);
  benzo(["auction", "publish", "--id", id, "--dir", publicDir, "--config", path.join(privateDir, "operator.json")]);
  // The buyback's marketplace.json collection is published with the round; the signed manifest's lot label
  // commits to its exact bytes (adapters/zilkroad.ts re-checks the binding).
  if (sc.marketplace) writeFileSync(path.join(publicDir, "marketplace.json"), jsonBytes(sc.marketplace));
  const signer = packet.signer, manifestFile = path.join(publicDir, "manifest.json");
  const sealed = bids.map((b, i) => ({ ...benzo(["bid", "seal", "--manifest", manifestFile, "--signer", signer], { price_zats: String(b.price), quantity: b.quantity ?? 1, address: deposits[i], refund_ua: refunds[i], ...(b.owner ? { owner_private_hex: b.owner.private_hex } : {}), ...(b.lot ? { lot: b.lot } : {}), ...(b.holder ? { holder: true } : {}), ...(b.deliver ? { deliver: b.deliver } : {}) }), address: deposits[i] }));
  // A20 (R42.1) live stray-claim leg, stage 1: one MORE sealed bid — its own fresh owner key — sealed here
  // (within the submission deadline) and NEVER admitted. Its memo is a valid sealed bid of this auction; the
  // note it pays for is a stray deposit (settle/deposits.ts strayNotes), claimed later with its own owner key.
  let straySealed: any = null;
  if (sc.strayClaim) {
    const owner = generateOwnerKey();
    straySealed = { ...benzo(["bid", "seal", "--manifest", manifestFile, "--signer", signer], { price_zats: "280", quantity: 1, address: deposits[0], refund_ua: refunds[0], lot: LOTS[0], owner_private_hex: owner.private_hex }), owner, destination: bidder() };
  }
  // The sealed bids are kept with the run's private state, so `resume` can admit them if the run stops after funding.
  writeFileSync(path.join(privateDir, "sealed.json"), JSON.stringify(sealed));
  // B55 (H19, docs/design/phase7-b55-cancel-before-r-and-rg-harness.md §2): each leg's fee reserve funds the
  // settle preflight's worst-case bound + one fee slot (the design's max(old reserve, bound + 5000)) — never
  // the real ZIP-317 fee. notes = every spendable vault note at settle (the deposits, the reserve note, the
  // treasury leg, the balance/late/stray notes); rows = the rows the batch pays. Counts round UP where the
  // leg's exact row set depends on its outcomes (a larger bound only over-funds — the preflight refuses only
  // when underfunded), so every leg's run passes the H19 preflight however its outcomes land.
  const notesAtSettle = sealed.length + 1 + (sc.treasury ? 1 : 0) + (sc.balancePays?.length ?? 0) + (sc.lateDust ? 1 : 0) + (sc.strayClaim ? 1 : 0);
  const rowsAtSettle = sealed.length + (sc.mode === "otc" ? 0 : 1) + (sc.lateDust ? 1 : 0) + (sc.strayClaim ? 1 : 0);
  const h19 = h19FeeBound({ notes: notesAtSettle, rows: rowsAtSettle, batchCap: sc.batch_cap ?? 13 });
  const reserveZats = Math.max(sc.reserve ?? 60_000, h19 + 5_000);
  say(`H19 fee reserve ${reserveZats} zats (bound ${h19} + 5000 over ${notesAtSettle} notes x ${rowsAtSettle} rows, floor ${sc.reserve ?? 60_000})`);
  const chunk = sc.fundChunk ?? sealed.length, txOf: Record<string, string> = {}, txids: string[] = [];
  let paid: any; try {
  for (let i = 0; i < sealed.length; i += chunk) {
    const part = sealed.slice(i, i + chunk), first = i === 0;
    // A later chunk may find the wallet's notes still pending from the previous one: wait and retry (bounded).
    // Only a refusal raised BEFORE any broadcast is retried (the bidder floor or the wallet finding too few
    // spendable notes); any other error may have broadcast already, so it stops the run instead of paying twice.
    for (let tries = 0; ; tries++) {
      try { paid = benzo(["bid", "deposit", "--id", id, "--pay"], { bids: part, ...(first ? { reserve: { address: reserveUa, amount_zats: String(reserveZats) } } : {}), ...(first && sc.treasury ? { treasury: { amount_zats: String(sc.treasury) } } : {}) }); break; }
      catch (e) {
        const msg = String((e as Error)?.message ?? e), preBroadcast = /bidder floor|Insufficient balance|InsufficientFunds|insufficient funds/i.test(msg);
        if (first || !preBroadcast || tries >= 12) throw e;
        say(`WARN funding chunk ${i / chunk + 1}: ${msg.slice(-120)}; retry in 60 s`); await sleep(60_000);
      }
    }
    say(`funding ${paid.txid}${chunk < sealed.length ? ` (chunk ${i / chunk + 1}, ${part.length} deposits)` : ""}`);
    txids.push(paid.txid); for (const s of part) txOf[s.address] = paid.txid;
    // Written after every chunk, so a crash between chunks still leaves `resume` the deposits paid so far.
    writeFileSync(path.join(privateDir, "funding.json"), JSON.stringify({ txid: txids[0], txids, by_address: txOf }));
  }
  for (let h = 0; ; await sleep(30_000)) {
    // A transient endpoint error (live: "tls handshake eof") is retried on the next poll, never fatal.
    let t: any, tip = 0;
    try {
      for (const v of ["sync", "enhance"]) z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, v, "-s", env("BNZ_LWD_URL")]);
      const all = JSON.parse(z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, "list-tx", "--json"]));
      const found = txids.map(x => all.find((t: any) => t.txid === x));
      t = found.every((x: any) => x?.mined_height) ? { mined_height: Math.max(...found.map((x: any) => x.mined_height)) } : undefined;
      tip = JSON.parse(z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, "balance", "--json"])).chain_tip_height;
    } catch (e) { say(`WARN funding poll: ${String((e as Error)?.message ?? e).slice(-120)}`); }
    if (t?.mined_height && tip >= t.mined_height + 9) break;
    if (++h > 200) throw new Error("funding did not mature");
  }
  } finally { dropLock(lock); } // held until the funding matured, so the wallet's change is spendable
  writeFileSync(path.join(privateDir, "funding.json"), JSON.stringify({ txid: txids[0], txids, by_address: txOf }));
  for (const s of sealed) benzo(["bid", "deposit", "--id", id], { txid: txOf[s.address], address: s.address, envelope_hex: s.envelope_hex, envelope_ct_hex: s.envelope_ct_hex, owner_sig_hex: s.owner_sig_hex });
  // A20 stray-claim leg, stage 2: the stray is paid in its OWN transaction to the deposit address (never
  // admitted) and matures beside the run's other notes.
  let strayBefore: Set<string> | null = null;
  if (straySealed) {
    const scan0 = () => z.run(z.scanner, ["scan", env("BNZ_NETWORK"), path.join(STATE, "vaults", id, "wallet")]).trim().split("\n").filter(Boolean).map((l: string) => JSON.parse(l));
    z.sync(`vaults/${id}/wallet`); z.enhance(`vaults/${id}/wallet`);
    strayBefore = new Set(scan0().map((n: any) => `${n.txid}:${n.pool}:${n.action_index}`));
    say(`A20 F11: stray deposit paid to ${deposits[0].slice(0, 18)}… (never admitted) ${z.pay(straySealed.uri)}`);
  }
  while (Date.now() / 1000 < manifest.T_submit + 2) await sleep(5_000);
  if (Date.now() / 1000 >= manifest.T_freeze) throw new Error("deposits matured after T_freeze");
  benzo(["freeze", "--id", id]);
  hostWitnessCerts(id, publicDir, signer, ["alice", "bob"]);
  while ((await latestRound()) < R) await sleep(10_000);
  benzo(["open", "--id", id]);
  // Launch: the winners each record their token-chain destinations SEALED to the manifest's envelope_keys
  // (Ruling R40 item 3 — `benzo launch deliver` builds the sealed record with the bid's own owner key signing
  // its SHA-256; the operator records it without seeing the destinations), before the clear. The deliver
  // prefixes descend with winner leaf rank (the random suffix keeps every run's values fresh), so this run's
  // corpus always differs from any earlier leaf-order file — an observation in the run log, never an assertion
  // (R39.2: with few rows the two orders coincide by chance and canonical order is all R34.2 requires).
  const deliveryRecs: { leaf_index: number; destinations: string[] }[] = [], deliverySealed: any[] = [];
  if (sc.mode === "launch") {
    const frozenLeaves = json(path.join(publicDir, "auction.json")).frozen.leaves;
    let rank = 0;
    for (const w of benzo(["launch", "winners", "--id", id]).winners) {
      const ownerHex = json(path.join(STATE, "bids", id, `${frozenLeaves[w.leaf_index].ciphertext_hash}.json`)).owner_private_hex;
      const destinations = Array.from({ length: w.lots }, (_, j) => `token-chain:${(0xffff - 1000 * rank - j).toString(16).padStart(4, "0")}${randomBytes(18).toString("hex")}`);
      const record = benzoRaw(["launch", "deliver", "--id", id, "--leaf-index", String(w.leaf_index), "--destinations", destinations.join(","), "--owner-key-stdin"], ownerHex);
      benzo(["launch", "deliver", "--id", id], record);
      deliveryRecs.push({ leaf_index: w.leaf_index, destinations });
      deliverySealed.push(record);
      rank++;
    }
  }
  benzo(["clear", "--id", id]);
  // Ruling R40 item 3 (F4): after the clear the signing hosts open the sealed records with their own envelope
  // keys, check every owner signature against their own openings, build the canonical delivery list and sign
  // `benzo-delivery-list-v1` over its allocation_file_hash. The merged list is recorded with
  // `benzo launch deliver-list`, which publishes only the canonical allocation.json and the two signatures.
  // R60: a launch with no winners (launch-miss: minimum raise not met) has nothing to deliver; the hosts rightly
  // refuse an empty delivery list (R40), and settlement never needs one.
  if (sc.mode === "launch" && deliverySealed.length > 0) {
    const deliveriesFile = path.join(privateDir, "deliveries.json");
    writeFileSync(deliveriesFile, JSON.stringify(deliverySealed));
    benzo(["launch", "deliver-list", "--id", id], hostDeliveryList(id, publicDir, deliveriesFile, signer, ["alice", "bob"]));
    say(`delivery list signed by alice+bob (${deliverySealed.length} sealed records)`);
  }
  const doc = () => json(path.join(publicDir, "auction.json"));
  const d = doc(), pure: any = clearForMode({ manifest: d.manifest, signer, frozen: d.frozen, opened: d.opened, reserve_opening: d.reserve_opening?.plaintext_hex ?? null, serial_beacon: d.serial_beacon ?? null, launch: d.launch_input });
  check(`${name}-cli-equals-pure-clear`, jsonBytes(d.result.allocations).equals(jsonBytes(pure.allocations)) && jsonBytes(d.result.conservation).equals(jsonBytes(pure.conservation)) && jsonBytes(d.result.serial_assignment ?? null).equals(jsonBytes(pure.serial_assignment ?? null)), `outcomes ${d.result.allocations.map((a: any) => a.outcome).join(",")} price ${d.result.clearing_price_zats}`);
  // R34.2 as replaced by R39.2: the published allocation rows are in canonical (destination bytes, then amount)
  // order and the allocation root is taken over that order (`${name}-cold-verify` replays it). The winner-leaf-order
  // line below is an observation only; the predicate never requires the two to differ.
  // R68: a launch with no winners (launch-miss) publishes no delivery list and no allocation file (R60) — assert that
  // instead of reading a file that rightly does not exist.
  if (sc.mode === "launch" && deliverySealed.length === 0)
    check(`${name}-no-delivery`, !existsSync(path.join(publicDir, "allocation.json")) && d.delivery_list === undefined && d.result.allocations.every((a: any) => a.fill === 0),
      "no winners: no allocation file, no delivery list, every fill 0");
  if (sc.mode === "launch" && deliverySealed.length > 0) {
    const file = readFileSync(path.join(publicDir, "allocation.json"));
    const rows = JSON.parse(file.toString("utf8")).rows as { destination: string; amount: number }[];
    const key = (rs: { destination: string; amount: number }[]) => JSON.stringify(rs.map(r => [r.destination, r.amount]));
    const canonical = key(rows) === key([...rows].sort(deliveryRowOrder));
    // Ruling R40 item 3 (F4): the allocation root is the host-signed quantity (`benzo-delivery-list-v1` over
    // allocation_file_hash, two pinned signers — checked again by `${name}-cold-verify`); the doc carries no
    // leaf<->destination join at all.
    const rooted = hash(file) === d.delivery_list?.allocation_file_hash;
    const noJoin = d.launch_input?.delivery === undefined && !JSON.stringify(d).includes("delivery_envelope_ct");
    const leafRows = d.result.allocations.filter((a: any) => a.fill > 0).flatMap((a: any) => {
      const rec = deliveryRecs.find(r => r.leaf_index === a.leaf_index)!;
      return rec.destinations.map((destination: string) => ({ destination, amount: a.fill / rec.destinations.length }));
    });
    const short = (rs: { destination: string }[]) => JSON.stringify(rs.map(r => r.destination.slice(11, 19)));
    check(`${name}-allocation-order`, canonical && rooted && noJoin,
      `canonical=${canonical} root=${rooted} noJoin=${noJoin}; published rows ${short(rows)} vs winner leaf order ${short(leafRows)}`);
  }
  // Part 2: the drop's bond-then-pay flow and the buyback's serial intake run after the clear, before settlement.
  if (sc.balancePays) await bondFlow(id, sc, d, say);
  if (sc.intakeSerials) intakeFlow(name, id, d, sc.intakeSerials, say);
  // A20 stray-claim leg, stage 3: the stray's own owner key claims its refund to a fresh destination; the
  // F11 fix is proven live by ${name}-stray-row-attested (the paying batch's two agreeing maps attest the
  // note identity and the SHA-256 of the scanned memo).
  let stray: { party: string; amount: number; memo_sha256: string; destination: string } | null = null;
  if (straySealed) {
    const scanS = () => z.run(z.scanner, ["scan", env("BNZ_NETWORK"), path.join(STATE, "vaults", id, "wallet")]).trim().split("\n").filter(Boolean).map((l: string) => JSON.parse(l));
    let note: any = null;
    for (let i = 0; i < 360 && !note; i++) {
      z.sync(`vaults/${id}/wallet`); z.enhance(`vaults/${id}/wallet`);
      note = scanS().find((n: any) => n.address === deposits[0] && n.height && !strayBefore!.has(`${n.txid}:${n.pool}:${n.action_index}`));
      if (!note) await sleep(10_000);
    }
    if (!note) throw new Error("the stray deposit never mined");
    const party = `deposit:${note.txid}:${note.pool}:${note.action_index}`;
    const request = benzoRaw(["claim-refund", "--id", id, "--party", party, "--destination", straySealed.destination, "--owner-key-stdin"], straySealed.owner.private_hex);
    benzo(["claim-refund", "--id", id, "--defer", "true"], request);
    stray = { party, amount: Number(note.value_zats), memo_sha256: hash(Buffer.from(straySealed.envelope_hex, "hex")), destination: straySealed.destination };
    say(`A20 F11: the stray ${party} mined at ${note.height} (${note.value_zats} zats); its own owner key claimed it to a fresh destination`);
  }
  hostEnvelopeOpens(id, publicDir);
  const settleLog = path.join(OUT, `${name}-settle.log`);
  writeFileSync(settleLog, "");
  const runSettle = (tag: string) => {
    const s = spawnSync(benzoBin, ["settle", "--id", id], { encoding: "utf8", maxBuffer: 64 << 20 });
    appendFileSync(settleLog, `\n==== ${tag} ====\n` + ((s.stdout || "") + "\n----\n" + (s.stderr || "")).replace(/\x1b\[[0-9;]*m/g, ""));
    return s;
  };
  let settle: { status: number | null }, late: { party: string; amount: number; leaf: number } | null = null;
  if (!sc.lateDust) settle = runSettle("settle");
  else ({ settle, late } = await lateDustFlow(name, id, sc, d, say, check, runSettle, doc, publicDir, refunds));
  const receipts = Object.fromEntries((doc().settlement?.receipts ?? []).map((r: any) => [r.party, Number(r.amount_zats)]));
  const fin = doc(), owed = Object.fromEntries([...(await import("../../clear/registry")).modeEntry(fin.manifest).obligations(fin.result, { defaults: sc.defaults ?? [] })].map(([p, v]) => [p, Number(v)]));
  const want = sc.expect ? sc.expect(refunds) : owed;
  // The plan adds the treasury return beside the mode's obligations; compare the rest.
  const noT = (o: Record<string, number>) => JSON.stringify(Object.entries(o).filter(([p]) => p !== "treasury").sort());
  if (sc.expect) check(`${name}-expected-equals-obligations`, noT(want) === noT(owed), JSON.stringify(owed));
  if (sc.outcomes) check(`${name}-outcomes`, sc.outcomes(fin.result.allocations.map((a: any) => a.outcome)), fin.result.allocations.map((a: any) => a.outcome).join(","));
  check(`${name}-settled`, settle.status === 0, `exit ${settle.status}`);
  // A19 (R41.1): the claimed late row's receipt sits beside the scenario's expected ones; A20: so does the
  // stray claim's. A stray still waiting out its confirmations gets one more settle before the check.
  if (stray && !(doc().settlement?.receipts ?? []).some((r: any) => r.party === stray!.party)) {
    const s4 = runSettle("settle-stray (the stray claim matures; its batch pays it)");
    check(`${name}-stray-settle`, s4.status === 0, `exit ${s4.status}`);
    settle = s4;
  }
  const wantAll = { ...want, ...(late ? { [late!.party]: late!.amount } : {}), ...(stray ? { [stray!.party]: stray!.amount } : {}) };
  check(`${name}-receipts`, JSON.stringify(Object.entries(receipts).sort()) === JSON.stringify(Object.entries(wantAll).sort()), JSON.stringify(receipts));
  z.sync("bidder"); z.enhance("bidder");
  const got = z.run(z.scanner, ["scan", "test", path.join(STATE, "bidder")]).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  const at = (a: string) => got.filter((n: any) => n.address === a).reduce((s: number, n: any) => s + n.value_zats, 0);
  check(`${name}-landed`, Object.entries(want).every(([p, v]) => p.startsWith("leaf:") ? at(refunds[Number(p.slice(5))]) === v : p === "treasury" ? at(treasuryUa) === v : true), JSON.stringify([...refunds.map(at), at(treasuryUa)]));
  if (late) check(`${name}-late-landed`, at(refunds[late.leaf]) === late.amount, `leaf ${late.leaf}'s own destination holds ${at(refunds[late.leaf])} (the late row refunded to its slot's bidder)`);
  // A20 (R42.1, F11) live: the stray's owner-signed claim is published with its scanned memo, the refund
  // landed at the claim's own destination, and the paying batch's TWO agreeing maps attest the stray's note
  // identity and memo hash — the per-row attestation that replaced the closed strays statement.
  if (stray) {
    check(`${name}-stray-landed`, at(stray.destination) === stray.amount, `the claim's destination holds ${at(stray.destination)} (the stray refunded to its claimant)`);
    const claim = (fin.claims ?? []).find((c: any) => c.party === stray!.party);
    check(`${name}-stray-claim-published`, !!claim && claim.memo_hex?.length === 1024 && !!claim.owner_sig,
      `claim ${claim ? "published with its scanned memo and owner signature" : "MISSING from the published doc"}`);
    const set = validateWitnessSet(verifyRecord(fin.witness_set, fin.signer), id);
    const attested = (fin.settlement?.approval_maps ?? []).filter((mp: any) => mp && verifyApprovalMap(mp, set.keys) && mp.auction_id === id &&
      (mp.strays ?? []).some((s: any) => s.party === stray!.party && s.memo_sha256 === stray!.memo_sha256) &&
      (mp.outputs ?? []).some((o: any) => o.party === stray!.party));
    check(`${name}-stray-row-attested`, attested.length >= 2 && new Set(attested.map((mp: any) => mp.witness)).size >= 2 &&
      JSON.stringify(attested[0].strays) === JSON.stringify(attested[1].strays),
      `${attested.length} agreeing maps attest {party, memo_sha256} (distinct witnesses ${new Set(attested.map((mp: any) => mp.witness)).size})`);
  }
  const cold = path.join(OUT, "cold", id); rmSync(assertScratch(cold), { recursive: true, force: true }); cpSync(publicDir, cold, { recursive: true });
  const v = spawnSync(benzoBin, ["verify", "--dir", cold, "--signer", signer], { encoding: "utf8" });
  check(`${name}-cold-verify`, v.status === 0, (v.stdout + v.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | "));
  if (sc.post) await sc.post({ id, signer, cold, doc, check, at, sellerUa, late });
  say(ok ? `RESULT PASS ${name}` : `RESULT FAIL ${name}`);
  ran[name] = { id, publicDir, signer, resultHash: hash(jsonBytes(doc().result)) };
  return ok;
}

// Part 2 (b), bond-then-pay under R33: the window and the balance addresses are manifest-fixed before bidding
// (deposit slot i pays its balance to bond.balance_addresses[i]). The payers send balance_due INSIDE the window
// (start, start + blocks] — a note at or below the start is refused by every host (P1-1) — the defaulter never
// pays, and settlement waits for tip > start + blocks before deriving the defaults from its own scan.
async function bondFlow(id: string, sc: Pick<Scenario, "balancePays" | "balanceDust">, d: any, say: (s: string) => void) {
  const m = JSON.parse(Buffer.from(d.manifest.bytes, "base64").toString("utf8"));
  const start = m.bond.balance_window_start_height as number, blocks = m.bond.balance_window_blocks as number;
  const slot = (leaf: number) => m.bond.balance_addresses[m.deposit_addresses.indexOf(d.frozen.leaves[leaf].deposit.address)];
  say(`balance window (${start}, ${start + blocks}] manifest-fixed (was operator-chosen after the clear)`);
  // A17 item 1 (R38 N2) proof vehicle: third-party dust at a winner's balance address BEFORE the window opens.
  // Pre-change one such note permanently wedged settlement (a host refusal over chain state a third party can
  // create); the run must still settle with it present. Idempotent on resume (a re-run never doubles the dust).
  const scanVault = () => z.run(z.scanner, ["scan", env("BNZ_NETWORK"), path.join(STATE, "vaults", id, "wallet")]).trim().split("\n").filter(Boolean).map((l: string) => JSON.parse(l));
  const safeTip = () => { try { return z.tip(); } catch { return 0; } };
  for (const leaf of sc.balanceDust ?? []) {
    const ua = slot(leaf);
    if (scanVault().some((n: any) => n.address === ua && n.height && n.height <= start)) say(`dust already present at leaf ${leaf}'s balance address before the window start`);
    // R62: pre-window dust only while the window has not started — a resume past the start sent fresh "pre-window"
    // dust that landed after it (RG attempt 6 resumes of 75d1ab9d…).
    else if (safeTip() + 2 >= start) say(`window start ${start} reached (tip ${safeTip()}); no pre-window dust sent at leaf ${leaf}`);
    else say(`dust sent to leaf ${leaf}'s balance address before the window opens, at tip ${safeTip()} (out of window: never counts as payment, refunds to leaf ${leaf}) (${z.pay(`zcash:?address=${ua}&amount=0.0002`)})`);
  }
  // The bound is a poll count, not a deadline on the chain: slow testnet blocks (A17 live runs) pushed the
  // window hundreds of blocks out and an 80-minute bound aborted a funded run mid-flight (e90f139e). A failed
  // tip fetch (one DNS blip killed a32310dd hours in) reads as 0, so the wait simply polls again.
  for (let i = 0; safeTip() <= start; ) {
    if (++i > 800) throw new Error("balance window never opened");
    await sleep(30_000);
  }
  // The scan must see a freshly synced wallet: an unsynced inWindow re-paid an already-mined balance payment in
  // the drop-r33 resume (the duplicate payment R38 item 4 now refunds instead of stranding).
  const inWindow = (ua: string) => { z.sync(`vaults/${id}/wallet`); z.enhance(`vaults/${id}/wallet`); return scanVault()
    .filter((n: any) => n.address === ua && n.height && n.height > start && n.height <= start + blocks).reduce((s: number, n: any) => s + n.value_zats, 0); };
  for (const leaf of sc.balancePays ?? []) {
    const a = d.result.allocations.find((x: any) => x.leaf_index === leaf), ua = slot(leaf);
    if (inWindow(ua) >= Number(a.balance_due_zats)) { say(`balance already paid for leaf ${leaf} in (${start}, ${start + blocks}]`); continue; }
    say(`balance paid ${a.balance_due_zats} for leaf ${leaf}, sent at tip ${safeTip()} (window (${start}, ${start + blocks}]; a logged height is the SEND tip, never a mined height) (${z.pay(`zcash:?address=${ua}&amount=${(Number(a.balance_due_zats) / 1e8).toFixed(8)}`)})`);
  }
  for (let i = 0; safeTip() <= start + blocks; ) {
    if (++i > 800) throw new Error("balance window did not pass");
    await sleep(30_000);
  }
  say(`balance window closed; the window was (${start}, ${start + blocks}], tip now ${safeTip()}`);
}
// A19 (R41 F7/F9) proof vehicle: ONE 1-zatoshi note sent to a winner's manifest-public balance address AFTER the
// two signer hosts approved batch 1 — the exact wedge window of Reviewer R's F7 repro. The run must complete end
// to end (R41.1): batch 1 finalizes and publishes with the new row `pending`, the owner (the slot's own leaf key)
// claims it to that bidder's own destination, the row stays PENDING until the confirmations rule (R41.3), and the
// NEXT batch pays it — receipts and claims complete. Every settle run must exit 0 (red under A19-F7: the second
// publish refuses over the grown row set; red under A19-F9: the claimed row is paid at 1 confirmation).
async function lateDustFlow(name: string, id: string, sc: Pick<Scenario, "lateDust">, d: any, say: (s: string) => void,
  check: (id: string, pass: boolean, detail?: string) => void, runSettle: (tag: string) => { status: number | null },
  doc: () => any, publicDir: string, refunds: string[]) {
  const m = JSON.parse(Buffer.from(d.manifest.bytes, "base64").toString("utf8"));
  const leaf = sc.lateDust!.leaf;
  const ua = m.bond.balance_addresses[m.deposit_addresses.indexOf(d.frozen.leaves[leaf].deposit.address)];
  const settleDir = path.join(STATE, "settle", id);
  const scanVault = () => z.run(z.scanner, ["scan", env("BNZ_NETWORK"), path.join(STATE, "vaults", id, "wallet")]).trim().split("\n").filter(Boolean).map((l: string) => JSON.parse(l));
  // The settle worker signs batch 1 mid-run; batch-1.maps.json appears only after BOTH hosts approved and the
  // batch signed — after their scans. Start settle detached so the note can land inside that window.
  const s1 = spawn(benzoBin, ["settle", "--id", id]);
  let s1out = "", s1err = "";
  s1.stdout!.on("data", x => s1out += x); s1.stderr!.on("data", x => s1err += x);
  const s1done = new Promise<number | null>(res => s1.on("close", res));
  let s1code: number | null | undefined; s1.on("close", c => { s1code = c; });
  const maps = path.join(settleDir, "batch-1.maps.json");
  // R59: stop waiting as soon as settle exits, and keep its output — RG attempt 6 lost the cause of a failed drop.
  for (let i = 0; !existsSync(maps); ) {
    if (s1code !== undefined || ++i > 480) {
      try { s1.kill("SIGKILL"); } catch {}
      appendFileSync(path.join(OUT, `${name}-settle.log`), `\n==== settle-1 (batch 1 never signed) ====\n${(s1out + "\n----\n" + s1err).replace(/\x1b\[[0-9;]*m/g, "")}`);
      throw new Error(`batch 1 was never signed by two hosts (settle ${s1code === undefined ? "killed after 40 min" : `exited ${s1code}`}): ${s1err.split("\n").filter(l => /^ERROR/.test(l)).slice(-3).join(" | ")}`);
    }
    await sleep(5_000);
  }
  const seen = new Set(scanVault().map((n: any) => `${n.txid}:${n.pool}:${n.action_index}`));
  say(`A19 F7: 1-zat note sent to leaf ${leaf}'s balance address AFTER both hosts signed batch 1 (${z.pay(`zcash:?address=${ua}&amount=0.00000001`)})`);
  check(`${name}-late-settle1`, (await s1done) === 0, "batch 1 finalized and published despite the late note");
  appendFileSync(path.join(OUT, `${name}-settle.log`), `\n==== settle-1 (batch 1; the late note lands after the hosts signed) ====\n${(s1out + "\n----\n" + s1err).replace(/\x1b\[[0-9;]*m/g, "")}`);
  let note: any = null;
  for (let i = 0; i < 360 && !note; i++) {
    z.sync(`vaults/${id}/wallet`); z.enhance(`vaults/${id}/wallet`);
    note = scanVault().find((n: any) => n.address === ua && n.height && !seen.has(`${n.txid}:${n.pool}:${n.action_index}`));
    if (!note) await sleep(10_000);
  }
  if (!note) throw new Error("the late dust note never mined");
  const party = `balance-late:${note.txid}:${note.pool}:${note.action_index}`;
  say(`A19 F7: the late note ${party} mined at ${note.height} (${note.value_zats} zats)`);
  // The owner claim: the slot's own leaf's one-time key signs it to that bidder's own destination.
  const owner = json(path.join(STATE, "bids", id, `${d.frozen.leaves[leaf].ciphertext_hash}.json`)).owner_private_hex;
  const request = benzoRaw(["claim-refund", "--id", id, "--party", party, "--destination", refunds[leaf], "--owner-key-stdin"], owner);
  benzo(["claim-refund", "--id", id, "--defer", "true"], request);
  say(`A19 F7: the claim for ${party} recorded (owner-signed to leaf ${leaf}'s own destination)`);
  hostEnvelopeOpens(id, publicDir); // the two-signer gate opens the claim's sealed destination
  // R41.3 as superseded by Ruling R46 (F23): at low confirmations the claimed row must not exist at all — an
  // unmatured note is invisible to the derivation (no row, no published entry), so nothing can pay it and no
  // reorg of it can move value. (Was: a derived row parked `pending`.)
  const settle2 = runSettle("settle-2 (the claim is recorded; the note is not classified until confirmed)");
  const sum2 = json(path.join(settleDir, "summary.json"));
  const row2 = (sum2.plan?.balance_refunds ?? []).find((r: any) => r.party === party);
  const paid2 = (doc().settlement?.receipts ?? []).some((r: any) => r.party === party);
  const entry2 = (doc().settlement?.balance_refunds ?? []).find((e: any) => e.party === party);
  check(`${name}-late-refund-gate`, settle2.status === 0 && !paid2 && row2 === undefined && entry2 === undefined,
    `settle-2 exit ${settle2.status}; plan row ${row2 ? `present matured ${String(row2.matured)}` : "absent (R46: unmatured notes are invisible)"}; paid ${paid2}; entry ${entry2 ? entry2.state : "absent"} (note at ~${z.tip() - note.height + 1} confs)`);
  // Poll the block height (never a fixed sleep) until the note clears the confirmations rule, then pay the row.
  for (let i = 0; z.tip() - note.height + 1 < 12; ) {
    if (++i > 480) throw new Error("the late note never reached the confirmations rule");
    await sleep(15_000);
  }
  const settle3 = runSettle("settle-3 (the claim matures; the next batch pays the row)");
  const receipt3 = (doc().settlement?.receipts ?? []).filter((r: any) => r.party === party);
  check(`${name}-late-refund-paid`, settle3.status === 0 && receipt3.length === 1 && Number(receipt3[0].amount_zats) === note.value_zats,
    `settle-3 exit ${settle3.status}; receipt ${JSON.stringify(receipt3)}`);
  return { settle: settle3, late: { party, amount: Number(note.value_zats), leaf } };
}
// Part 2 §1 row 5: each round's winners sign the serial intake (the adapters/buyback-report.ts record shape) with
// the one-time owner key inside their own opened bid; `benzo buyback intake` validates every record against the
// round and publishes serial-intake.json and the per-window report.json with it.
function intakeFlow(name: string, id: string, d: any, serials: number[], say: (s: string) => void) {
  const winners = d.result.allocations.filter((a: any) => a.fill > 0).sort((a: any, b: any) => a.leaf_index - b.leaf_index);
  if (winners.length !== serials.length) throw new Error(`intake serials cover ${serials.length} of ${winners.length} winners`);
  const records = winners.map((w: any, i: number) => {
    const ch = d.frozen.leaves[w.leaf_index].ciphertext_hash;
    const private_hex = json(path.join(STATE, "bids", id, `${ch}.json`)).owner_private_hex;
    const body = { auction_id: id, ciphertext_hash: ch, serials: [serials[i]] };
    return { ...body, signature: signStatement({ private_hex, public_hex: ownerPublic(private_hex) }, body) };
  });
  const file = path.join(OUT, `${name}-intake.json`); writeFileSync(file, JSON.stringify(records), { mode: 0o600 });
  benzo(["buyback", "intake", "--id", id, "--file", file]);
  say(`serial intake published ${records.map((r: any) => r.serials[0]).join(",")}`);
}
function claimExceptions(id: string, say: (s: string) => void): number {
  const sum = path.join(STATE, "settle", id, "summary.json"), keysDir = path.join(STATE, "bids", id);
  if (!existsSync(sum) || !existsSync(keysDir)) return 0;
  const claimsFile = path.join(STATE, "settle", id, "claims.json");
  const claimed = new Set<string>((existsSync(claimsFile) ? json(claimsFile) : []).map((c: any) => c.party));
  const rows = (json(sum).rows ?? []).filter((r: any) => r.state === "exception" && /^(deposit|balance-late|balance-excess):/.test(r.party) && !claimed.has(r.party));
  const keys = readdirSync(keysDir).filter(f => f.endsWith(".json")).map(f => json(path.join(keysDir, f)).owner_private_hex as string);
  let recorded = 0;
  for (const r of rows) {
    const destination = fresh(path.join(STATE, "bidder"));
    const ok = keys.some(k => { try { benzo(["claim-refund", "--id", id, "--defer", "true"], benzoRaw(["claim-refund", "--id", id, "--party", r.party, "--destination", destination, "--owner-key-stdin"], k)); return true; } catch { return false; } });
    say(ok ? `claimed ${r.party.slice(0, 40)}… (${r.amount_zats} zats) with its owner key` : `no kept owner key signs for ${r.party.slice(0, 40)}…`);
    if (ok) recorded++;
  }
  return recorded;
}
// `resume:<id>`: finish an existing frozen product auction whose run stopped (certificates, open, clear, envelope-opens,
// settle — whichever is still missing), then check receipts against the registry's obligations and cold-verify.
async function resume(id: string) {
  const say = (s: string) => console.log(`[resume ${id.slice(0, 8)}] ${s}`);
  const cfg = json(path.join(STATE, "product", `${id}.json`)), publicDir = path.resolve(cfg.public_dir), doc = () => json(path.join(publicDir, "auction.json"));
  const signer = doc().signer, m = JSON.parse(Buffer.from(doc().manifest.bytes, "base64").toString("utf8")), stateOf = () => benzo(["auction", "status", "--id", id]).state as string;
  say(`state ${stateOf()}`);
  // Stopped after funding, before admission: admit the kept sealed bids, then freeze (both before T_freeze).
  const priv = path.join(STATE, "run", `markets-${id}`);
  const scen = existsSync(path.join(priv, "scenario.json")) ? json(path.join(priv, "scenario.json")) : null;
  if (stateOf() === "OPEN" && existsSync(path.join(priv, "sealed.json")) && existsSync(path.join(priv, "funding.json"))) {
    const fund = json(path.join(priv, "funding.json"));
    for (const b of json(path.join(priv, "sealed.json"))) { const txid = fund.by_address?.[b.address] ?? fund.txid; try { benzo(["bid", "deposit", "--id", id], { txid, address: b.address, envelope_hex: b.envelope_hex, envelope_ct_hex: b.envelope_ct_hex, owner_sig_hex: b.owner_sig_hex }); } catch (e) { say(`WARN admit: ${String((e as Error).message).slice(-120)}`); } }
    while (Date.now() / 1000 < m.T_submit + 2) await sleep(5_000);
    // A run dropped past the freeze cutoff is a CANCELLED auction (unfrozen after T_freeze): never force the
    // freeze — its deposits refund through their own memo-bound envelopes below.
    if (Date.now() / 1000 < m.T_freeze) benzo(["freeze", "--id", id]);
    else say(`T_freeze passed unfrozen: the auction is cancelled; settlement refunds every deposit through its own memo`);
  }
  // R132 harness gap 1: an auction still OPEN and unfrozen after T_freeze is cancelled with `benzo cancel` (the
  // product's own cancel-before-freeze path), so its deposits route to refunds instead of waiting forever.
  if (stateOf() === "OPEN" && !doc().frozen && Date.now() / 1000 >= m.T_freeze) { benzo(["cancel", "--id", id]); say(`unfrozen after T_freeze: cancelled (state ${stateOf()})`); }
  if ((doc().witness_cert ?? []).length < 2 && doc().frozen) hostWitnessCerts(id, publicDir, signer, ["alice", "bob"]);
  while ((await latestRound()) < m.drand.R) await sleep(10_000);
  if (stateOf() === "SEALED-WAIT") benzo(["open", "--id", id]);
  if (stateOf() === "OPENED") benzo(["clear", "--id", id]);
  // Ruling R40 item 3 (F4): a dropped launch run keeps its sealed delivery records; finish the host-signed
  // delivery list (the `benzo sign delivery` runs and the operator-side record) before settling.
  if (m.clearing?.mode === "launch" && existsSync(path.join(priv, "deliveries.json")) && doc().result && !doc().result.cancelled && !existsSync(path.join(STATE, "settle", id, "delivery-list.json"))) {
    benzo(["launch", "deliver-list", "--id", id], hostDeliveryList(id, publicDir, path.join(priv, "deliveries.json"), signer, ["alice", "bob"]));
    say("delivery list signed by alice+bob (resumed)");
  }
  // The dropped run's own scenario steps (balance window payments) when still missing.
  const d0 = doc();
  if (scen?.balancePays && d0.result) await bondFlow(id, scen, d0, say);
  if (scen?.intakeSerials && d0.result && !existsSync(path.join(publicDir, "serial-intake.json"))) intakeFlow(`resume-${id.slice(0, 8)}`, id, doc(), scen.intakeSerials, say);
  hostEnvelopeOpens(id, publicDir);
  let settle = spawnSync(benzoBin, ["settle", "--id", id], { encoding: "utf8", maxBuffer: 64 << 20 });
  // R132 harness gap 2: exception rows only an owner can claim (an unadmitted deposit of a cancelled run, an
  // out-of-window balance payment). `bid seal` keeps each of this run's owner keys under STATE/bids/<id>/, so
  // resume claims every such row to a fresh bidder address with the key that signs for it (a wrong key is
  // refused at record time and records nothing), re-opens the claim envelopes on the hosts and settles again.
  if (claimExceptions(id, say) > 0) { hostEnvelopeOpens(id, publicDir); settle = spawnSync(benzoBin, ["settle", "--id", id], { encoding: "utf8", maxBuffer: 64 << 20 }); }
  const receipts = Object.fromEntries((doc().settlement?.receipts ?? []).map((r: any) => [r.party, Number(r.amount_zats)]));
  // A cancelled run has no result: its obligations are the deposits themselves, each refunded at its own note
  // value through its memo-bound envelope (or its owner's claim) — and `benzo verify` is the accounting check.
  const owed = doc().result
    ? Object.fromEntries([...(await import("../../clear/registry")).modeEntry(doc().manifest).obligations(doc().result, { defaults: scen?.defaults ?? [] })].map(([p, v]) => [p, Number(v)]))
    : {};
  const ok = settle.status === 0 && (doc().result ? Object.entries(owed).every(([p, v]) => receipts[p] === v) : Object.keys(receipts).length > 0);
  say(`settle exit ${settle.status}; receipts ${JSON.stringify(receipts)}${doc().result ? `; obligations ${JSON.stringify(owed)}` : " (cancelled: each deposit refunds at its own note value)"}`);
  const v = spawnSync(benzoBin, ["verify", "--dir", publicDir, "--signer", signer], { encoding: "utf8" });
  say(`${ok && v.status === 0 ? "RESULT PASS" : "RESULT FAIL"} (verify exit ${v.status})`);
  return ok && v.status === 0;
}
// Recurring buyback (part 2 §1 row 5): a harness loop of two buyback rounds linked by `series` (round 2's
// previous_result_hash is round 1's result hash), each publishing its winners' signed serial intake. `benzo market
// run` is not implemented; this loop drives the same shipped commands, then `benzo report --dir <round2> --previous
// <round1>` prints the per-window report (units, clearing price, ZEC spent, serials).
async function series(): Promise<boolean> {
  const say = (s: string) => console.log(`[buyback-series] ${s}`);
  const series_id = randomBytes(32).toString("hex");
  const ok1 = await run("buyback-r1", { series_id, round_index: 1, previous_result_hash: null });
  const r1 = ran["buyback-r1"];
  const ok2 = r1 ? await run("buyback-r2", { series_id, round_index: 2, previous_result_hash: r1.resultHash }) : false;
  const r2 = ran["buyback-r2"];
  let ok = ok1 && ok2;
  const check = (id: string, pass: boolean, d = "") => { say(`${pass ? "PASS" : "ERROR"} ${id}${d ? " " + d : ""}`); ok &&= pass; };
  try {
    if (!r1 || !r2) throw new Error("a round produced no result");
    const report = (which: "buyback-r1" | "buyback-r2") => JSON.parse(sh(benzoBin, ["report", "--dir", ran[which].publicDir, ...(which === "buyback-r2" ? ["--previous", ran["buyback-r1"].publicDir] : [])]));
    const w2 = report("buyback-r2");
    check("buyback-series-report", w2.series_id === series_id && w2.window_index === 2 && w2.units_bought === 2 && w2.clearing_price_zats === "160000" && w2.spent_zec === "0.00320000" && JSON.stringify(w2.serials_taken_in.map((x: any) => x.serials)) === "[[1010],[1011]]", JSON.stringify(w2).slice(0, 240));
    const w1 = report("buyback-r1");
    check("buyback-series-round1-report", w1.window_index === 1 && w1.units_bought === 2 && w1.clearing_price_zats === "150000" && w1.spent_zec === "0.00300000" && JSON.stringify(w1.serials_taken_in.map((x: any) => x.serials)) === "[[1000],[1001]]", JSON.stringify(w1).slice(0, 240));
    // The chained round verifies with --previous: its series link resolves to round 1's result hash.
    const v = spawnSync(benzoBin, ["verify", "--dir", path.join(OUT, "cold", r2.id), "--signer", r2.signer, "--previous", ran["buyback-r1"].publicDir], { encoding: "utf8" });
    check("buyback-series-linked-verify", v.status === 0 && /OK series/.test(v.stdout), (v.stdout + v.stderr).split("\n").filter(l => /ERROR|series/.test(l)).slice(0, 2).join(" | "));
  } catch (e) { check("buyback-series-report", false, String((e as Error).message).slice(-200)); }
  say(ok ? "RESULT PASS buyback-series" : "RESULT FAIL buyback-series");
  return ok;
}
// Parallel harness processes share one frostd on the fixed port: start one only if none is listening.
const port = env("BNZ_FROSTD_ADDR").split(":").at(-1)!, listening = spawnSync("nc", ["-z", "127.0.0.1", port]).status === 0;
const frostd = listening ? null : spawn(path.join(STATE, "bin/frostd"), ["-i", "127.0.0.1", "-p", env("BNZ_FROSTD_ADDR").split(":").at(-1)!, "-c", path.join(STATE, "tls/frostd.pem"), "-k", path.join(STATE, "tls/frostd.key")], { stdio: "ignore" });
await sleep(2000);
let all = true;
try { for (const n of process.argv.slice(2)) { try { all = (n === "buyback-series" ? await series() : n.startsWith("resume:") ? await resume(n.slice(7)) : await run(n)) && all; } catch (e) { for (const l of [...held]) dropLock(l); console.log(`[${n}] FATAL ${String((e as Error)?.stack ?? e).slice(0, 800)}`); all = false; } } }
finally { frostd?.kill(); for (const n of ["alice", "bob", "carol"]) spawnSync("orb", ["start", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`]); }
process.exitCode = all ? 0 : 1;
