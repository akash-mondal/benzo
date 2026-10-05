// Phase 5 part 2 §1 (docs/design/phase5-part2-live.md): one live auction per market mode on the OrbStack signer hosts
// (host custody, R28), driven only by shipped commands. Each scenario checks: the CLI result equals the registry's pure
// clear on the same opened set, the receipts equal the scenario's expected obligations, every refund/payment landed at
// the bidder's own destination, and `benzo verify` passes on a cold copy.
// Build+run: npx esbuild tools/repro/markets.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/markets.mjs && BNZ_LWD_SINGLE=1 node tmp/markets.mjs <scenario>...
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, STATE, env, DRAND } from "../../e2e/lib/env";
import { jsonBytes, signRecord } from "../../manifest/schema";
import { witnessSetHash } from "../../witness";
import { clearForMode } from "../../clear/registry";
import { generateOwnerKey } from "../../envelope";
import { benzoBin, dkgOnHosts, hostEnvelopeKeys, hostEnvelopeOpens, hostWitnessCerts, hostWitnessKeys, sh } from "../../e2e/lib/hosts";
import * as z from "../../e2e/lib/zcash";

const C = 200_000; // part 2: small collateral
const OUT = path.join(ROOT, "tmp/markets"); mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const pczt = path.join(ROOT, "settle/target/release/benzo-pczt"), fresh = (w: string) => sh(pczt, ["address", w]).split("\n").at(-1)!;
const benzo = (args: string[], input?: any) => { const out = sh(benzoBin, args, input === undefined ? undefined : JSON.stringify(input)); return out.startsWith("{") || out.startsWith("[") ? JSON.parse(out.split("\n").filter(l => l.startsWith("{") || l.startsWith("[")).at(-1)!) : out; };
// A failed drand fetch (one killed a live run) reads as round 0, so the wait simply polls again.
const latestRound=async()=>{try{return (await (await fetch(`${DRAND}/public/latest`)).json()).round as number}catch{return 0}};

// Cross-process locks (lock dirs). A lock this process holds is released if its scenario throws.
const held = new Set<string>();
async function takeLock(lock: string, staleMs: number) {
  for (;;) { try { mkdirSync(lock); held.add(lock); return; } catch { if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > staleMs) rmSync(lock, { recursive: true, force: true }); await sleep(5_000); } }
}
function dropLock(lock: string) { rmSync(lock, { recursive: true, force: true }); held.delete(lock); }
type Bid = { price: number; quantity?: number; owner?: { private_hex: string; public_hex: string }; lot?: string; holder?: boolean };
type Ctx = { owners: Record<string, { private_hex: string; public_hex: string }>; treasuryUa: string; fundingUa: string; tip: number };
type Scenario = { mode: string; supply?: number; treasury?: number; extra: (ctx: Ctx) => any; owners?: string[]; bids: (o: Record<string, any>) => Bid[];
  // Explicit expected receipts per party; when absent, the registry's own obligations over the published result, plus
  // an outcome assertion (`outcomes`) on that result.
  expect?: (refunds: string[]) => Record<string, number>; outcomes?: (o: string[]) => boolean };
// Expected receipts are per party in zats (C = 200,000).
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
  // RFQ (reverse-Vickrey): dealers A and B allowlisted, X not. Quotes A 400, B 300, X 200: X is refused, B wins and is
  // paid the second-lowest valid quote (400); the buyer funded 500, so 100 returns to its treasury_ua.
  "rfq": { mode: "rfq", treasury: 500, owners: ["A", "B", "X"], extra: c => ({ rfq: rfqBlock(c, [c.owners.A, c.owners.B]) }),
    bids: o => [{ price: 400, owner: o.A }, { price: 300, owner: o.B }, { price: 200, owner: o.X }],
    expect: () => ({ "leaf:0": C, "leaf:1": C + 400, "leaf:2": C, treasury: 100 }), outcomes: o => o[1] === "winner" && o[2] === "not_allowlisted" },
  // RFQ with one valid quote (X not allowlisted): cancelled, every quote refunded exact C and the whole 500 returns.
  "rfq-cancel": { mode: "rfq", treasury: 500, owners: ["A", "B", "X"], extra: c => ({ rfq: rfqBlock(c, [c.owners.A, c.owners.B]) }),
    bids: o => [{ price: 400, owner: o.A }, { price: 200, owner: o.X }], expect: () => ({ "leaf:0": C, "leaf:1": C, treasury: 500 }) },
  "revision": { mode: "uniform", owners: ["reviser"], extra: () => ({}),
    bids: o => [{ price: 200, owner: o.reviser }, { price: 250 }, { price: 300, owner: o.reviser }],
    outcomes: o => o[0] === "superseded" && o[2] === "winner" && o[1] !== "winner" },
};

// RFQ block: the allowlisted dealers, a budget and cap, three throwaway delivery-attestation signers (not exercised
// here), a delivery deadline past the round, and the buyer's signed treasury return and funding addresses.
function rfqBlock(c: Ctx, dealers: { public_hex: string }[]) {
  const spki = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return { dealer_keys: dealers.map(d => d.public_hex), max_price_zats: "1000", budget_zats: "500", delivery_deadline_height: c.tip + 20000, delivery_signers: [spki(), spki(), spki()], treasury_ua: c.treasuryUa, funding_ua: c.fundingUa };
}
async function run(name: string) {
  const sc = SCENARIOS[name]; if (!sc) throw new Error(`unknown scenario ${name}`);
  const log = path.join(OUT, `${name}.out`); writeFileSync(log, "");
  const say = (s: string) => { console.log(`[${name}] ${s}`); writeFileSync(log, readFileSync(log, "utf8") + s + "\n"); };
  let ok = true; const check = (id: string, pass: boolean, d = "") => { say(`${pass ? "PASS" : "ERROR"} ${id}${d ? " " + d : ""}`); ok &&= pass; };
  const id = randomBytes(32).toString("hex"); say(`auction ${id} mode ${sc.mode}`);
  // Concurrent DKGs on the same hosts and frostd collide (live: "bob dkg exited 1"); processes take turns.
  const dkgLock = path.join(STATE, "run", "markets-dkg.lock");
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
  const witnessSet = signRecord({ version: 1, auction_id: id, q_w: 2, keys: witnessPubs }, readFileSync(path.join(STATE, "auction", "manifest-signing.pem"), "utf8"));
  writeFileSync(path.join(privateDir, "witness-set.json"), JSON.stringify(witnessSet));
  writeFileSync(path.join(privateDir, "operator.json"), JSON.stringify({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 }, routing: { bidders: deposits.map(deposit_ua => ({ deposit_ua })), seller_ua: sellerUa, fee_reserve_ua: reserveUa } }));
  // One bidder wallet funds every scenario: parallel harness processes take turns (a lock dir, stale after 40 min),
  // taken BEFORE the manifest's deadlines are set and held until the funding matured.
  const lock = path.join(STATE, "run", "markets-fund.lock");
  await takeLock(lock, 2_400_000);
  const now = Math.ceil(Date.now() / 1000), release = now + 33 * 60, R = 1 + Math.ceil((release - Number(env("BNZ_DRAND_GENESIS"))) / 3);
  const manifest = { version: 1, network: "test", auction_id: id, escrow_ua: k.escrow_ua, frost_group_key: k.group_key, lot: `${sc.mode} round`, supply: sc.supply ?? 1, reserve_zats: "10", tick_zats: "10", B_max_zats: "3000", q_max: 1, C_zats: String(C), fee_zats: "0", deposit_addresses: deposits, envelope_keys: envelopeKeys, witness_set_hash: witnessSetHash(witnessSet), drand: { chain_hash: env("BNZ_DRAND_CHAIN_HASH"), public_key: env("BNZ_DRAND_PUBLIC_KEY"), scheme: "bls-unchained-g1-rfc9380", genesis: Number(env("BNZ_DRAND_GENESIS")), period: 3, R }, T_submit: now + 4 * 60, T_freeze: now + 30 * 60, confirmations: 10, clearing: { mode: sc.mode, band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 }, refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1", ...sc.extra({ owners, treasuryUa, fundingUa, tip: z.tip() }) };
  benzo(["auction", "create", "--witness-set", path.join(privateDir, "witness-set.json")], manifest);
  const packet = benzo(["auction", "sign", "--id", id]);
  benzo(["auction", "publish", "--id", id, "--dir", publicDir, "--config", path.join(privateDir, "operator.json")]);
  const signer = packet.signer, manifestFile = path.join(publicDir, "manifest.json");
  const sealed = bids.map((b, i) => ({ ...benzo(["bid", "seal", "--manifest", manifestFile, "--signer", signer], { price_zats: String(b.price), quantity: b.quantity ?? 1, address: deposits[i], refund_ua: refunds[i], ...(b.owner ? { owner_private_hex: b.owner.private_hex } : {}), ...(b.lot ? { lot: b.lot } : {}), ...(b.holder ? { holder: true } : {}) }), address: deposits[i] }));
  let paid: any; try { paid = benzo(["bid", "deposit", "--id", id, "--pay"], { bids: sealed, reserve: { address: reserveUa, amount_zats: "60000" }, ...(sc.treasury ? { treasury: { amount_zats: String(sc.treasury) } } : {}) });
    say(`funding ${paid.txid}`);
  for (let h = 0; ; await sleep(30_000)) {
    for (const v of ["sync", "enhance"]) z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, v, "-s", env("BNZ_LWD_URL")]);
    const t = JSON.parse(z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, "list-tx", "--json"])).find((t: any) => t.txid === paid.txid);
    const tip = JSON.parse(z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, "balance", "--json"])).chain_tip_height;
    if (t?.mined_height && tip >= t.mined_height + 9) break;
    if (++h > 80) throw new Error("funding did not mature");
  }
  } finally { dropLock(lock); } // held until the funding matured, so the wallet's change is spendable
  for (const s of sealed) benzo(["bid", "deposit", "--id", id], { txid: paid.txid, address: s.address, envelope_hex: s.envelope_hex, envelope_ct_hex: s.envelope_ct_hex, owner_sig_hex: s.owner_sig_hex });
  while (Date.now() / 1000 < manifest.T_submit + 2) await sleep(5_000);
  if (Date.now() / 1000 >= manifest.T_freeze) throw new Error("deposits matured after T_freeze");
  benzo(["freeze", "--id", id]);
  hostWitnessCerts(id, publicDir, signer, ["alice", "bob"]);
  while ((await latestRound()) < R) await sleep(10_000);
  benzo(["open", "--id", id]); benzo(["clear", "--id", id]);
  const doc = () => json(path.join(publicDir, "auction.json"));
  const d = doc(), pure: any = clearForMode({ manifest: d.manifest, signer, frozen: d.frozen, opened: d.opened, reserve_opening: d.reserve_opening ?? null });
  check(`${name}-cli-equals-pure-clear`, jsonBytes(d.result.allocations).equals(jsonBytes(pure.allocations)) && jsonBytes(d.result.conservation).equals(jsonBytes(pure.conservation)), `outcomes ${d.result.allocations.map((a: any) => a.outcome).join(",")} price ${d.result.clearing_price_zats}`);
  hostEnvelopeOpens(id, publicDir);
  const settle = spawnSync(benzoBin, ["settle", "--id", id], { encoding: "utf8", maxBuffer: 64 << 20 });
  writeFileSync(path.join(OUT, `${name}-settle.log`), ((settle.stdout || "") + "\n----\n" + (settle.stderr || "")).replace(/\x1b\[[0-9;]*m/g, ""));
  const receipts = Object.fromEntries((doc().settlement?.receipts ?? []).map((r: any) => [r.party, Number(r.amount_zats)]));
  const fin = doc(), owed = Object.fromEntries([...(await import("../../clear/registry")).modeEntry(fin.manifest).obligations(fin.result, null)].map(([p, v]) => [p, Number(v)]));
  const want = sc.expect ? sc.expect(refunds) : owed;
  // The plan adds the treasury return beside the mode's obligations; compare the rest.
  const noT = (o: Record<string, number>) => JSON.stringify(Object.entries(o).filter(([p]) => p !== "treasury").sort());
  if (sc.expect) check(`${name}-expected-equals-obligations`, noT(want) === noT(owed), JSON.stringify(owed));
  if (sc.outcomes) check(`${name}-outcomes`, sc.outcomes(fin.result.allocations.map((a: any) => a.outcome)), fin.result.allocations.map((a: any) => a.outcome).join(","));
  check(`${name}-settled`, settle.status === 0, `exit ${settle.status}`);
  check(`${name}-receipts`, JSON.stringify(Object.entries(receipts).sort()) === JSON.stringify(Object.entries(want).sort()), JSON.stringify(receipts));
  z.sync("bidder"); z.enhance("bidder");
  const got = z.run(z.scanner, ["scan", "test", path.join(STATE, "bidder")]).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  const at = (a: string) => got.filter((n: any) => n.address === a).reduce((s: number, n: any) => s + n.value_zats, 0);
  check(`${name}-landed`, Object.entries(want).every(([p, v]) => p.startsWith("leaf:") ? at(refunds[Number(p.slice(5))]) === v : p === "treasury" ? at(treasuryUa) === v : true), JSON.stringify([...refunds.map(at), at(treasuryUa)]));
  const cold = path.join(OUT, "cold", id); rmSync(cold, { recursive: true, force: true }); cpSync(publicDir, cold, { recursive: true });
  const v = spawnSync(benzoBin, ["verify", "--dir", cold, "--signer", signer], { encoding: "utf8" });
  check(`${name}-cold-verify`, v.status === 0, (v.stdout + v.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | "));
  say(ok ? `RESULT PASS ${name}` : `RESULT FAIL ${name}`);
  return ok;
}

// `resume:<id>`: finish an existing frozen product auction whose run stopped (certificates, open, clear, envelope-opens,
// settle — whichever is still missing), then check receipts against the registry's obligations and cold-verify.
async function resume(id: string) {
  const say = (s: string) => console.log(`[resume ${id.slice(0, 8)}] ${s}`);
  const cfg = json(path.join(STATE, "product", `${id}.json`)), publicDir = path.resolve(cfg.public_dir), doc = () => json(path.join(publicDir, "auction.json"));
  const signer = doc().signer, m = JSON.parse(Buffer.from(doc().manifest.bytes, "base64").toString("utf8")), stateOf = () => benzo(["auction", "status", "--id", id]).state as string;
  say(`state ${stateOf()}`);
  if ((doc().witness_cert ?? []).length < 2) hostWitnessCerts(id, publicDir, signer, ["alice", "bob"]);
  while ((await latestRound()) < m.drand.R) await sleep(10_000);
  if (stateOf() === "SEALED-WAIT") benzo(["open", "--id", id]);
  if (stateOf() === "OPENED") benzo(["clear", "--id", id]);
  hostEnvelopeOpens(id, publicDir);
  const settle = spawnSync(benzoBin, ["settle", "--id", id], { encoding: "utf8", maxBuffer: 64 << 20 });
  const receipts = Object.fromEntries((doc().settlement?.receipts ?? []).map((r: any) => [r.party, Number(r.amount_zats)]));
  const owed = Object.fromEntries([...(await import("../../clear/registry")).modeEntry(doc().manifest).obligations(doc().result, null)].map(([p, v]) => [p, Number(v)]));
  const ok = settle.status === 0 && Object.entries(owed).every(([p, v]) => receipts[p] === v);
  say(`settle exit ${settle.status}; receipts ${JSON.stringify(receipts)}; obligations ${JSON.stringify(owed)}`);
  const v = spawnSync(benzoBin, ["verify", "--dir", publicDir, "--signer", signer], { encoding: "utf8" });
  say(`${ok && v.status === 0 ? "RESULT PASS" : "RESULT FAIL"} (verify exit ${v.status})`);
  return ok && v.status === 0;
}
// Parallel harness processes share one frostd on the fixed port: start one only if none is listening.
const port = env("BNZ_FROSTD_ADDR").split(":").at(-1)!, listening = spawnSync("nc", ["-z", "127.0.0.1", port]).status === 0;
const frostd = listening ? null : spawn(path.join(STATE, "bin/frostd"), ["-i", "127.0.0.1", "-p", env("BNZ_FROSTD_ADDR").split(":").at(-1)!, "-c", path.join(STATE, "tls/frostd.pem"), "-k", path.join(STATE, "tls/frostd.key")], { stdio: "ignore" });
await sleep(2000);
let all = true;
try { for (const n of process.argv.slice(2)) { try { all = (n.startsWith("resume:") ? await resume(n.slice(7)) : await run(n)) && all; } catch (e) { for (const l of [...held]) dropLock(l); console.log(`[${n}] FATAL ${String((e as Error)?.stack ?? e).slice(0, 800)}`); all = false; } } }
finally { frostd?.kill(); for (const n of ["alice", "bob", "carol"]) spawnSync("orb", ["start", `benzo-${n}`]); }
process.exitCode = all ? 0 : 1;
