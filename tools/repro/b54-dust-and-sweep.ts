// Batch B54 proof (offline): the sweep spends what the wallet can spend (Reviewer R round 5: P2-1 the
// dust wall plus P3-1 to P3-6) — docs/design/phase7-b54-dust-and-sweep.md. Every product decision runs
// the real shipped code; only the offline-impossible externals are stubbed (the b47 stub harness
// tools/repro/b47-world.ts makeStubs and the h-fixtures host stubs).
//
// Red on the BASE commit 9324d02 bundles under tmp/b54/base-src (built ONCE from the pristine base
// commit), green after on this tree's bundles. The stubs model the REAL WALLET's note-selection rule on
// both legs (a note of 5,000 zats or less is never selected — the wallet never changed), so the red legs
// show exactly the base's wall; the P3-3 quote bound has one knob to emulate the pre-B54 quote-sweep.
//
// Sections (the optional third argument runs one):
//   p21  P2-1: the dust wall — the reviewer's D-world. A refunded dust stray leaves a 4,000-zat note the
//        wallet can never select. On base the custody return parks forever (the scanned-total mismatch)
//        and the non-custody path strands the dust silently; after the fix both complete, the residue is
//        published (dust_notes/dust_zats) and verify accepts. Units D1–D5 ride along.
//   p21n P3-2 (+ the non-custody dust leg): `settle check` on a non-custody world. A change-carrying
//        return candidate is refused before signing (base: accepted — the kept accounting then wedges
//        every re-run), the correct one-row sweep still passes, and the plan's accounting carries the
//        residue (base: silent).
//   p31  P3-1: a staged mixed batch (the reviewer's C-world) — the H23 expiry must not release its rows.
//        Red: the rows are released and re-allocated into a fresh batch (the double-pay shape). Green:
//        nothing is released — the staged batch goes through the normal confirm (attributable variant)
//        or is parked (unattributable variant).
//   p33  P3-3 (H25): a 30-note vault. Red (the pre-B54 quote-sweep emulation): the row is planned and
//        every build dies on create's 29 bound — set aside, re-planned, forever. Green: quote-sweep
//        refuses typedly and the plan's waits line names it.
//   p34  P3-4: backfillMapped heals only from what the host approved (the reviewer's B-world). A drifted
//        derivation never counts in either direction; no stored amounts, no heal; and `sign approve`
//        stores the attested record the heal reads.
//   p36  P3-6: minedHeight cross-checks a second endpoint; endpoints that disagree mean no height.
//
// Build+run:
//   npx esbuild tools/repro/b54-dust-and-sweep.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b54.mjs
//   node tmp/b54.mjs after  [p21|p21n|p31|p33|p34|p36]
//   node tmp/b54.mjs before [p21|p21n|p31|p33|p34|p36]
//   base bundles, built ONCE from the pristine base commit (the b53 recipe):
//     mkdir -p tmp/b54/base-src && git archive 9324d02 | tar -x -C tmp/b54/base-src && ln -s $PWD/node_modules tmp/b54/base-src/node_modules
//     (cd tmp/b54/base-src && node cli/build.mjs && for f in settle/plan.ts:settle/dist/plan.mjs settle/cli.ts:settle/dist/cli.mjs clear/cli.ts:clear/dist/cli.mjs settle/deposits.ts:settle/dist/deposits.mjs witness/index.ts:dist/witness.mjs cli/host-derive.ts:dist/host-derive.mjs cli/host-chain.ts:dist/host-chain.mjs; do npx esbuild ...; done)
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { hash, jsonBytes, reserveReturnUaCommitment, sellerUaCommitment } from "../../manifest/schema";
import { signApprovalMap, signOpensReport } from "../../witness";
import { sealBlob } from "../../envelope";
import { modeEntry } from "../../clear/registry";
import { Ledger } from "../../settle/ledger";
import * as shippedDeposits from "../../settle/deposits";
import * as shippedHostDerive from "../../cli/host-derive";
import * as shippedHostChain from "../../cli/host-chain";
import { buildAuction, fetchBeacon, needRealPczt, witnessPrivate, writeHostState, writePublicDir, UA_ORCHARD, type Fixture } from "./h-fixtures";
import { makeStubs } from "./b47-world";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2], only = process.argv[3];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b54.mjs before|after [section]"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b54.mjs ${part}${only ? " " + only : ""} (tools/repro/b54-dust-and-sweep.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const BASE = path.join(ROOT, "tmp", "b54", "base-src");
const GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
const BASE_BENZO = path.join(BASE, "cli", "dist", "benzo.mjs");
for (const f of part === "before"
  ? [BASE_BENZO, path.join(BASE, "settle/dist/cli.mjs"), path.join(BASE, "settle/dist/plan.mjs"), path.join(BASE, "settle/dist/deposits.mjs"), path.join(BASE, "dist/host-derive.mjs"), path.join(BASE, "dist/host-chain.mjs")]
  : [GREEN_BENZO, path.join(ROOT, "settle/dist/cli.mjs"), path.join(ROOT, "settle/dist/plan.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — build the bundles first (see the header)`);
const REAL_PCZT = needRealPczt(ROOT);

// The red legs run the BASE tree's own modules; the green legs the shipped ones (the b53 pattern).
const dep: any = part === "before" ? await import(pathToFileURL(path.join(BASE, "settle", "dist", "deposits.mjs")).href) : shippedDeposits;
const hd: any = part === "before" ? await import(pathToFileURL(path.join(BASE, "dist", "host-derive.mjs")).href) : shippedHostDerive;
const hc: any = part === "before" ? await import(pathToFileURL(path.join(BASE, "dist", "host-chain.mjs")).href) : shippedHostChain;
const { paidByOwnLedger, reserveReturnOutstanding, walletSpendable, ZIP317_MARGINAL_FEE_ZATS } = shippedDeposits;

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const wants = (section: string) => !only || only === section;
const sh = (cmd: string, args: string[], env: Record<string, string>, timeoutMs?: number) => {
  const r = spawnSync(cmd, args, { input: "", encoding: "utf8", maxBuffer: 64 << 20,
    ...(timeoutMs ? { timeout: timeoutMs, killSignal: "SIGKILL" } : {}), env: { ...process.env, ...env } });
  return { code: r.status ?? 1, killed: !!(r.error && (r.error as any).code === "ETIMEDOUT"), out: r.stdout ?? "", err: r.stderr ?? "" };
};

const R = 32704232; // a past quicknet round (the h-fixtures machinery fetches its authentic beacon once)
const FEE_RESERVE_UA = "utest1b54feereserveaddress00000000000000000000000000000000000000";
const CHANGE_ADDR = "utest1b54internalchangeaddress000000000000000000000000000000000000";
const CONFIRMATIONS = 10;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const obligationsOf = (fx: Fixture) => [...modeEntry(fx.manifestPacket).obligations(fx.result as any, null)]
  .map(([party, amount_zats]) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats }) as { party: string; kind: string; amount_zats: string });

// ---- the worker worlds (the b47 stub harness via makeStubs, custody always) -----------------------------
type World = {
  label: string; id: string; fx: Fixture; root: string; state: string; publicDir: string; shared: string;
  chainFile: string; stubBin: string; benzo: string; hosts: Record<string, string>;
  rows: { party: string; kind: string; amount_zats: string }[]; obligationZats: number; feeReserve: number;
};

function writeWorld(label: string, fx: Fixture, opts: { root: string; benzo: string; feeReserve: number; extraNotes?: any[]; quoteBound?: boolean }): World {
  const stubs = makeStubs({ realPczt: REAL_PCZT, confirmations: CONFIRMATIONS, changeAddr: CHANGE_ADDR, uaOrchard: UA_ORCHARD });
  const id = fx.id;
  const base = path.join(opts.root, "tmp", "b54-worlds", label);
  rmSync(base, { recursive: true, force: true });
  const state = path.join(base, "state"), publicDir = path.join(base, "public"), shared = path.join(base, "shared");
  const chainFile = path.join(shared, "chain-state.json"), stubBin = path.join(base, "stub-bin");
  for (const d of [state, path.join(state, "run"), path.join(state, "auction"), path.join(state, "product"), shared, stubBin, path.join(state, "vaults", id, "wallet")])
    mkdirSync(d, { recursive: true, mode: 0o700 });
  stubs.writeStateBin(path.join(state, "bin"));
  // quote_sweep_h25_bound:false emulates the PRE-B54 quote-sweep (the real tool before B54's H25 bound)
  // for the P3-3 red leg; default on models the real tool as shipped.
  const fixtureJson = JSON.stringify({ groupKey: fx.groupKey, internal_addresses: [CHANGE_ADDR, FEE_RESERVE_UA],
    ...(opts.quoteBound === false ? { quote_sweep_h25_bound: false } : {}) });
  writeFileSync(path.join(state, "fixture.json"), fixtureJson);
  const rows = obligationsOf(fx);
  const obligationZats = rows.reduce((s, o) => s + Number(o.amount_zats), 0);
  const notes: any[] = [...(opts.extraNotes ?? []), ...fx.notes.map(n => ({ ...n }))];
  notes.push({ txid: hash("b54-fee-reserve-" + label), height: 90100, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "9", action_index: 0, value_zats: opts.feeReserve, memo_hex: null, spent_in_txid: null });
  writeFileSync(chainFile, JSON.stringify({ tip: 100000, send_mode: "ok", notes, pending: [], mined: {}, broadcasts: [] }));
  writeFileSync(path.join(state, "auction", "manifest-signing.pem"), fx.manifestPem, { mode: 0o600 });
  writeFileSync(path.join(state, "auction", `${id}.json`), jsonBytes({ manifest: fx.manifestPacket, signer: fx.signer, state: "CLEARED",
    leaves: fx.leaves, receipts: fx.receipts, frozen: fx.frozen, opened: fx.opened, result: fx.result, trace: [], beacon: fx.beacon,
    envelopes: fx.envelopes, witness_set: fx.witnessSet }));
  const routing = { bidders: [], seller_ua: UA_ORCHARD, fee_reserve_ua: FEE_RESERVE_UA, reserve_return_ua: UA_ORCHARD };
  writeFileSync(path.join(state, "product", `${id}.json`), jsonBytes({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 }, routing, public_dir: publicDir }));
  writeFileSync(path.join(state, "vaults", id, "keys.json"), jsonBytes({ group_key: fx.groupKey }));
  mkdirSync(path.join(state, "settle", id), { recursive: true, mode: 0o700 });
  const dest = hash(Buffer.from(UA_ORCHARD, "utf8"));
  for (const [n, w] of [["alice", "0"], ["bob", "1"]] as const) {
    const body = { signer: n, opens: fx.leaves.map((l: any) => ({ leaf: l.leaf_index, party: `leaf:${l.leaf_index}`, ok: true, dest_sha256: dest })) };
    writeFileSync(path.join(state, "settle", id, `envelope-opens-${n}.json`), jsonBytes({ ...body, ...signOpensReport(body, witnessPrivate(w)) }));
    writeFileSync(path.join(state, "settle", id, `routing-${n}.json`), jsonBytes(routing), { mode: 0o600 });
  }
  writeFileSync(path.join(state, "settle", id, "routing-commitment.json"), jsonBytes({ sha256: hash(jsonBytes(routing)), pinned_at: Date.now() }));
  for (const [n, i] of [["alice", 0], ["bob", 1], ["carol", 2]] as const) {
    for (const d of [path.join(state, "signers", n), path.join(state, "frost")]) mkdirSync(d, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(state, "signers", n, "envelope-key.json"), JSON.stringify(fx.envelopeKeys[i]));
    writeFileSync(path.join(state, "frost", `${n}.toml`), "group = 0\n");
    writeFileSync(path.join(state, "frost", `${n}.pubkey`), createHash("sha256").update("b54-contact-" + n).digest("hex") + "\n");
  }
  writeFileSync(path.join(state, "group-key.txt"), fx.groupKey + "\n");
  const hosts: Record<string, string> = {};
  for (const [n, i] of [["alice", 0], ["bob", 1], ["carol", 2]] as const) {
    const hs = path.join(base, "host-" + n);
    hosts[n] = hs;
    stubs.writeStateBin(path.join(hs, "bin"));
    writeFileSync(path.join(hs, "fixture.json"), fixtureJson);
    for (const d of [hs, path.join(hs, "run"), path.join(hs, "auction"), path.join(hs, "auctions", id), path.join(hs, "signers", n), path.join(hs, "witness")]) mkdirSync(d, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(hs, "auctions", id, "group-key.txt"), fx.groupKey + "\n");
    writeFileSync(path.join(hs, "auctions", id, "frost.toml"), "group = 0\n");
    writeFileSync(path.join(hs, "operator-signer.txt"), fx.signer + "\n");
    writeFileSync(path.join(hs, "ufvk.txt"), "uviewtest1fixture\n");
    writeFileSync(path.join(hs, "signers", n, "envelope-key.json"), JSON.stringify(fx.envelopeKeys[i]));
    writeFileSync(path.join(hs, "witness", `${n}.key`), witnessPrivate(String(i)), { mode: 0o600 });
  }
  stubs.stub(stubBin, "orb", stubs.STUB_ORB);
  stubs.stub(stubBin, "orbctl", stubs.STUB_ORB);
  writeFileSync(path.join(shared, "stub-config.json"), JSON.stringify({ shared, benzo: opts.benzo, hosts }));
  writePublicDir(publicDir, fx);
  return { label, id, fx, root: opts.root, state, publicDir, shared, chainFile, stubBin, benzo: opts.benzo, hosts,
    rows, obligationZats, feeReserve: opts.feeReserve };
}

const worldEnv = (w: World): Record<string, string> => ({
  BNZ_STATE_DIR: w.state, BNZ_TEST_CHAIN: w.chainFile, BNZ_TEST_STUBS: path.join(w.shared, "stub-config.json"),
  BNZ_PCZT_BIN: path.join(w.state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(w.state, "bin", "benzo-scan"),
  BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10", BNZ_DRAND_URLS: "http://127.0.0.1:9/",
  BNZ_FROSTD_HOST: "stub-frostd:2744", BNZ_FROSTD_ADDR: "stub-frostd:2744", BNZ_ROOT: w.root,
  PATH: `${w.stubBin}${path.delimiter}${process.env.PATH ?? ""}`,
});
const runSettle = (w: World, timeoutMs?: number) => w.benzo === GREEN_BENZO
  ? sh(path.join(ROOT, "bin/benzo"), ["settle", "--id", w.id], worldEnv(w), timeoutMs)
  : sh(process.execPath, [w.benzo, "settle", "--id", w.id], worldEnv(w), timeoutMs);
const runVerify = (w: World) => sh(process.execPath, [w.benzo, "verify", "--dir", w.publicDir, "--signer", w.fx.signer], worldEnv(w));
const chain = (w: World) => JSON.parse(readFileSync(w.chainFile, "utf8"));
const receiptsOf = (w: World) => JSON.parse(readFileSync(path.join(w.state, "settle", w.id, "receipts.json"), "utf8"));
const settlementOf = (w: World) => JSON.parse(readFileSync(path.join(w.publicDir, "auction.json"), "utf8")).settlement ?? null;
const ledgerRows = (w: World) => {
  const db = new DatabaseSync(path.join(w.state, "settle", w.id, "ledger.sqlite"), { readOnly: true });
  try { return db.prepare("SELECT party,amount_zats,state,batch,txid FROM obligations ORDER BY party").all() as any[]; } finally { db.close(); }
};
const ledgerBatches = (w: World) => {
  const db = new DatabaseSync(path.join(w.state, "settle", w.id, "ledger.sqlite"), { readOnly: true });
  try { return db.prepare("SELECT id,txid,height,state FROM batches ORDER BY id").all() as any[]; } finally { db.close(); }
};
const settleLog = (w: World) => { try { return readFileSync(path.join(w.state, "run", "settle-cli.log"), "utf8"); } catch { return ""; } };

// The seeded world every worker case starts from: batch 1 paid every ordinary row (the live post-batch-1
// state), published and receipted exactly as the worker left it — written through the REAL Ledger class
// and the real republish (tools/repro/b47-republish.ts, R118). `extraNotes` carry the case's own vault
// residue (the dust note / the many notes).
function seedBatchOne(w: World): { tx1: string; change: number } {
  const id = w.id;
  const tx1 = hash("b54-seed-batch1-" + w.label);
  const c = chain(w);
  const feeNote = hash("b54-fee-reserve-" + w.label);
  const spends = c.notes.filter((n: any) => w.fx.notes.some((f: any) => f.txid === n.txid) || n.txid === feeNote).map((n: any) => `${n.txid}:${n.pool}:${n.action_index}`);
  for (const n of c.notes) if (spends.includes(`${n.txid}:${n.pool}:${n.action_index}`)) n.spent_in_txid = tx1;
  const batchFee = 5000 * Math.max(2, Math.max(spends.length, w.rows.length + 1));
  const change = w.feeReserve - batchFee;
  c.tip = 100012;
  c.mined[tx1] = { height: 100001, rows: [] };
  c.broadcasts.push(tx1);
  c.notes.push({ txid: tx1, height: 100001, pool: "ironwood", address: CHANGE_ADDR, diversifier_index: "99", action_index: 0,
    value_zats: change, memo_hex: null, spent_in_txid: null });
  writeFileSync(w.chainFile, JSON.stringify(c));
  // Each host's own approval ledger records batch 1's rows at their amounts — what the real `sign approve`
  // recorded (the "paid" rule's ledger half).
  for (const n of ["alice", "bob"]) {
    const adir = path.join(w.hosts[n], "approvals", w.id);
    mkdirSync(adir, { recursive: true, mode: 0o700 });
    const mapped = w.rows.map((o, i) => ({ party: o.party, output_index: i, amount_zats: String(o.amount_zats) }));
    const sources = [...new Set(w.rows.map((o) => (o.party.startsWith("leaf:") ? `deposit:${w.fx.notes[Number(o.party.slice(5))].txid}:ironwood:${Number(o.party.slice(5))}` : o.party)))];
    writeFileSync(path.join(adir, "ledger.json"), JSON.stringify([{ batch: 1, txid: tx1, expiry_height: 100364, approved_tip: 100000, sources, mapped }]) + "\n", { mode: 0o600 });
  }
  const pczt = path.join(w.state, "settle", id, "batch-1.pczt");
  writeFileSync(pczt, `b54 seeded batch 1 ${tx1}\n`);
  const ledger = new Ledger(w.state, id);
  ledger.pin(w.rows as any);
  ledger.eligible();
  const batch = ledger.allocate(13)!;
  ledger.stage(batch.id, pczt, tx1);
  ledger.confirm(batch.id, tx1, 100001, w.rows.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "ironwood" })));
  const rows = ledger.rows(), receipts = ledger.receipts();
  ledger.close();
  const sd = path.join(w.state, "settle", id);
  const maps = [0, 1].map(i => signApprovalMap({ auction_id: id, batch: 1, txid: tx1, outputs: w.rows.map((o, i2) => ({ party: o.party, output_index: i2 })), defaults: [], balance_refunds: [] }, witnessPrivate(String(i))));
  writeFileSync(path.join(sd, "batch-1.maps.json"), jsonBytes(maps));
  writeFileSync(path.join(sd, "receipts.json"), jsonBytes(receipts));
  writeFileSync(path.join(sd, "summary.json"), jsonBytes({ auction_id: id, lwd_endpoints: ["127.0.0.1:9", "127.0.0.1:10"], rows: rows.filter((r: any) => r.party !== "reserve-return"),
    batches: [{ id: 1, pczt_hash: hash(readFileSync(pczt)), txid: tx1, height: 100001, state: "mined" }], signoffs: [], plan: {}, offline_signer: "alice" }));
  const republish = path.join(ROOT, "tmp/b47-republish.mjs");
  const r = spawnSync(process.execPath, [republish, id], { encoding: "utf8", env: { ...process.env, ...worldEnv(w) } });
  if (r.status !== 0) throw new Error(`republish failed: ${(r.stderr || r.stdout).trim().slice(-300)}`);
  return { tx1, change };
}

// ---- p21 (P2-1): the dust wall — the reviewer's D-world -----------------------------------------------
async function p21() {
  // Units first: the shared rule over the reviewer's D-notes (D1/D1') and the boundary.
  {
    const notes = [
      { txid: "11".repeat(32), pool: "orchard", action_index: 0, value_zats: "100000", spent_in_txid: null },
      { txid: "22".repeat(32), pool: "orchard", action_index: 1, value_zats: "4000", spent_in_txid: null },
    ];
    const scanned = dep.reserveUnspent(notes as any);
    console.log(`OBSERVE p21-${part} reserveUnspent total=${scanned.total_zats} dust=${scanned.dust_notes}/${scanned.dust_zats}`);
    if (part === "after") {
      check("p21-spendable-total", scanned.total_zats === "100000", `the swept total counts only the notes the wallet can spend (${scanned.total_zats})`);
      check("p21-residue-reported", scanned.dust_notes === 1 && scanned.dust_zats === "4000",
        `the unspendable residue is reported (${scanned.dust_notes} notes / ${scanned.dust_zats} zats)`);
      check("p21-ids-spendable-only", JSON.stringify(scanned.ids) === JSON.stringify(["11".repeat(32) + ":orchard:0"]),
        `the sweep's source ids are the spendable notes only (${JSON.stringify(scanned.ids)})`);
      check("p21-boundary", ZIP317_MARGINAL_FEE_ZATS === 5000 && walletSpendable({ value_zats: 5001 }) && !walletSpendable({ value_zats: 5000 }) && !walletSpendable({ value_zats: 1 }),
        "the rule is value_zats > 5,000 (ZIP-317 MARGINAL_FEE): 5,000 itself is dust, 5,001 is spendable");
    } else {
      check("p21-red-total-counts-dust", scanned.total_zats === "104000" && scanned.dust_notes === undefined,
        `the base counts every positive note (${scanned.total_zats}) and reports no residue — the total every host holds the quote to`);
    }
    // D5: a refunded dust stray is owed and receipted — once its receipt counts, the gate clears; the
    // residue alone is not an owed item.
    const strayParty = "deposit:" + "22".repeat(32) + ":orchard:1";
    const out = reserveReturnOutstanding({ owed: [{ party: strayParty, amount_zats: "4000" }], rows: [],
      receipts: [{ party: strayParty, amount_zats: "4000" }] });
    check("p21-d5-gate-clears-for-a-receipted-dust-stray", out.length === 0,
      "a refunded 4,000-zat stray (paid from other notes) never keeps the return waiting — the dust note is residue, not debt");
  }

  // The custody end-to-end: a refunded dust stray leaves its 4,000-zat note in the vault forever.
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  const dustNote = { txid: hash("b54-dust-stray"), height: 99200, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "21", action_index: 0,
    value_zats: 4000, memo_hex: null, spent_in_txid: null };
  const w = writeWorld(`p21-${part}`, fx, { root: part === "before" ? BASE : ROOT, benzo: part === "before" ? BASE_BENZO : GREEN_BENZO, feeReserve: 60000, extraNotes: [dustNote] });
  const seeded = seedBatchOne(w);
  console.log(`OBSERVE p21-${part} seeded batch 1 ${seeded.tx1.slice(0, 16)}… change ${seeded.change} + dust note 4000`);
  const r = runSettle(w);
  console.log(`OBSERVE p21-${part} settle exit=${r.code}`);
  console.log((r.err || r.out).trim().split("\n").filter(Boolean).slice(-6).map(l => "  | " + l).join("\n"));
  const receipts = existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? receiptsOf(w) : [];
  const settlement = settlementOf(w);
  const rr = settlement?.reserve_return ?? null;
  if (part === "after") {
    check("p21-return-completes", r.code === 0 && receipts.some((x: any) => x.party === "reserve-return" && x.amount_zats === "20000"),
      `the custody return completes: the sweep spends the 30,000 spendable note at the 10,000 fee and returns 20,000 (exit ${r.code}, ${receipts.length} receipts)`);
    check("p21-residue-published", !!rr && rr.remaining_zats === "30000" && rr.fee_zats === "10000" && rr.dust_notes === 1 && rr.dust_zats === "4000",
      `the published accounting carries the residue: ${JSON.stringify(rr)}`);
    const v = runVerify(w);
    check("p21-verify-accepts", v.code === 0 && !/^ERROR/m.test(v.err),
      `benzo verify accepts the published dir with the residue (exit ${v.code}); ${v.out.trim().split("\n").filter(l => l.startsWith("OK")).length} OK lines`);
    const rerun = runSettle(w);
    check("p21-rerun-idempotent", rerun.code === 0 && receiptsOf(w).length === receipts.length && JSON.stringify(settlementOf(w)?.reserve_return ?? null) === JSON.stringify(rr),
      `a re-run is clean and republishes byte-equal accounting (exit ${rerun.code})`);
  } else {
    check("p21-red-parks-forever", r.code === 0 && !receipts.some((x: any) => x.party === "reserve-return") && !rr,
      `run 1 parks the return with the typed reason (exit 0, no receipt, no accounting) — the dust note walls the scanned-total comparison`);
    const summary = (() => { try { return readFileSync(path.join(w.state, "settle", w.id, "summary.json"), "utf8"); } catch { return "" } })();
    check("p21-red-reason-is-the-total-mismatch", /scanned unspent total 34000/.test(settleLog(w) + r.err + summary),
      "the typed reason names the true wall: the tool's quote spends 30000 zats of the scanned unspent total 34000 (it rides on the published exception row)");
    const rerun = runSettle(w);
    check("p21-red-every-rerun", rerun.code === 1 && /no signer host could list its derivable rows/.test(rerun.err) && !receiptsOf(w).some((x: any) => x.party === "reserve-return"),
      `every re-run dies harder (exit ${rerun.code}): the base publishes the bare reserve-return exception row, which its own verify refuses ("a reserve-return row or receipt without the published reserve_return accounting"), so no host can answer the public check ever again — the wall no honest re-run can pass`);
  }
}

// ---- p21n (P3-2 + the non-custody dust leg): `settle check` on a non-custody world ---------------------
async function p21n() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  const dustNote = { txid: hash("b54-dust-stray"), height: 99200, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "21", action_index: 0,
    value_zats: 4000, memo_hex: null, spent_in_txid: null };
  const w = writeWorld(`p21n-${part}`, fx, { root: part === "before" ? BASE : ROOT, benzo: part === "before" ? BASE_BENZO : GREEN_BENZO, feeReserve: 60000, extraNotes: [dustNote] });
  seedBatchOne(w);
  // Non-custody: the coordinator holds the vault keys; check() runs the local pre-sign check.
  rmSync(path.join(w.state, "vaults", w.id, "keys.json"), { force: true });
  // The plan's own derivation over this world (the same command the worker runs).
  const planEnv = { ...worldEnv(w), BNZ_ROOT: w.root };
  const plan = sh(process.execPath, [path.join(w.root, "settle/dist/plan.mjs"), w.id], planEnv);
  const parsed = JSON.parse(plan.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!);
  const rr = parsed.reserve_return ?? null;
  console.log(`OBSERVE p21n-${part} plan exit=${plan.code} reserve_return=${JSON.stringify(rr)}`);
  // Pin the return row at the planned amount and craft the candidates check() sees.
  const ledger = new Ledger(w.state, w.id);
  ledger.pin([{ party: "reserve-return", kind: "payout", amount_zats: rr.amount_zats }] as any);
  ledger.eligible();
  const batch = ledger.allocate(13)!;
  ledger.close();
  const candidate = (label: string, body: object) => {
    const f = path.join(w.state, "settle", w.id, `candidate-${label}.pczt`);
    writeFileSync(f, JSON.stringify(body));
    return f;
  };
  const correct = candidate("correct", { rows: [{ recipient: UA_ORCHARD, amount_zats: rr.amount_zats }], input_zats: rr.remaining_zats, change_zats: 0 });
  const changed = candidate("changed", { rows: [{ recipient: UA_ORCHARD, amount_zats: rr.amount_zats }], input_zats: rr.remaining_zats, change_zats: "5000" });
  const checkRun = (file: string) => sh(process.execPath, [path.join(w.root, "settle/dist/cli.mjs"), "check", w.id, String(batch.id), file, "alice"], planEnv);
  const ok = checkRun(correct), bad = checkRun(changed);
  console.log(`OBSERVE p21n-${part} check correct exit=${ok.code} changed exit=${bad.code}`);
  if (part === "after") {
    check("p21n-correct-sweep-accepted", ok.code === 0, `the correct one-row sweep still signs (exit ${ok.code})`);
    check("p21n-change-candidate-refused", bad.code === 1 && /must pay exactly one output, not change/.test(bad.err),
      `a change-carrying return candidate is refused BEFORE signing (exit ${bad.code}): ${(bad.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1) ?? "").slice(0, 140)}`);
    check("p21n-accounting-carries-residue", !!rr && rr.dust_notes === 1 && rr.dust_zats === "4000",
      "the non-custody plan's accounting carries the residue too (dust_notes/dust_zats) — nothing is stranded silently");
  } else {
    const shapePin = /must pay exactly one output|must spend every unspent|not the unspent value minus the fee|declared reserve-return amount/;
    check("p21n-red-no-shape-pin", bad.code === 1 && !shapePin.test(bad.err),
      `the base check() pins NO return shape — the change-carrying candidate is never refused for its change; it fails only the unrelated recipient-count mismatch (${(bad.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1) ?? "").slice(0, 120)})`);
    check("p21n-red-accounting-silent", rr !== undefined && rr.dust_notes === undefined && rr.remaining_zats === "30000",
      `the base plan reports no residue (remaining ${rr?.remaining_zats}, no dust fields) — the 4,000 zats are stranded silently`);
  }
}

// ---- p31 (P3-1): a staged mixed batch (the reviewer's C-world) ----------------------------------------
function seedMixedStaged(w: World, opts: { mapsCover: "all" | "rows-only" }): { tx1: string; rows: any[] } {
  const id = w.id;
  const ledger = new Ledger(w.state, id);
  ledger.pin([...w.rows, { party: "reserve-return", kind: "payout", amount_zats: "2000" }] as any);
  ledger.eligible();
  const rows = ledger.rows();
  // The pre-B52 shape: ONE batch holding every row together — and STAGED (signed; the txid mined on the
  // stub chain by a crashed run), which no shipped worker ever produced (the own-batch rule threw before
  // staging) but one bad state restore reaches.
  const body = { rows: rows.map(r => ({ recipient: UA_ORCHARD, amount_zats: r.amount_zats })),
    input_zats: String(rows.reduce((s, r) => s + Number(r.amount_zats), 0)), fee_zats: "0", change_zats: 0,
    expiry_height: 100364 };
  const pczt = path.join(w.state, "settle", id, "batch-1.pczt");
  writeFileSync(pczt, JSON.stringify(body));
  const tx1 = hash(readFileSync(pczt));
  ledger.db.exec("INSERT INTO batches(id) VALUES(1)");
  ledger.db.prepare("UPDATE obligations SET state='allocated',batch=1").run();
  ledger.stage(1, pczt, tx1);
  ledger.close();
  const c = chain(w);
  for (const n of c.notes) if (w.fx.notes.some((f: any) => f.txid === n.txid) || n.txid === hash("b54-fee-reserve-" + w.label)) n.spent_in_txid = tx1;
  c.tip = 100012;
  c.mined[tx1] = { height: 100001, rows: [] };
  c.broadcasts.push(tx1);
  c.notes.push({ txid: tx1, height: 100001, pool: "ironwood", address: CHANGE_ADDR, diversifier_index: "99", action_index: 0,
    value_zats: 30000, memo_hex: null, spent_in_txid: null });
  writeFileSync(w.chainFile, JSON.stringify(c));
  const sd = path.join(w.state, "settle", id);
  const covered = opts.mapsCover === "all" ? rows : rows.filter(r => r.party !== "reserve-return");
  const mapBody = { auction_id: id, batch: 1, txid: tx1, outputs: covered.map((r, i) => ({ party: r.party, output_index: i })), defaults: [], balance_refunds: [] };
  writeFileSync(path.join(sd, "batch-1.maps.json"), jsonBytes([0, 1].map(i => signApprovalMap(mapBody as any, witnessPrivate(String(i))))));
  writeFileSync(path.join(sd, "batch-1.build.json"), jsonBytes({ outputs: covered.map((r, i) => ({ party: r.party, output_index: i })) }));
  return { tx1, rows };
}

async function p31() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  // Variant 1: confirm can attribute every row.
  const w = writeWorld(`p31-${part}`, fx, { root: part === "before" ? BASE : ROOT, benzo: part === "before" ? BASE_BENZO : GREEN_BENZO, feeReserve: 60000 });
  const seeded = seedMixedStaged(w, { mapsCover: part === "after" ? "all" : "rows-only" });
  console.log(`OBSERVE p31-${part} seeded staged mixed batch 1 (txid ${seeded.tx1.slice(0, 16)}…, ${seeded.rows.length} rows)`);
  const r = runSettle(w);
  console.log(`OBSERVE p31-${part} settle exit=${r.code}`);
  console.log((r.err || r.out).trim().split("\n").filter(Boolean).slice(-5).map(l => "  | " + l).join("\n"));
  const rows = ledgerRows(w), batches = ledgerBatches(w);
  const h23 = /reserve-return mixed with rows \(H23\)/.test(r.err + settleLog(w));
  const released = rows.filter(x => x.batch === null && x.state === "exception");
  const batchesBeyond = batches.filter(b => b.id !== 1);
  if (part === "after") {
    check("p31-no-release", !h23 && released.length === 0 && rows.every(x => x.batch === 1),
      `the staged mixed batch's rows are never released (H23 line absent; rows still bound: ${rows.map(x => `${x.party}:${x.state}`).join(", ")})`);
    check("p31-no-second-batch", batchesBeyond.length === 0,
      `no fresh batch re-allocates them (batches: ${JSON.stringify(batches)}) — the double-pay shape the reviewer's C2/C3 showed is gone`);
    const paid = rows.filter(x => ["paid", "refunded"].includes(x.state));
    check("p31-confirmed-once-or-parked", paid.length === rows.length ? rows.every(x => x.txid === seeded.tx1) : batches.some(b => b.id === 1 && b.state === "exception" && b.height),
      paid.length === rows.length
        ? `the normal confirm attributed every row once at the staged txid (${rows.map(x => `${x.party}:${x.state}`).join(", ")})`
        : `confirm could not attribute the rows and the batch is parked with its binding kept (${JSON.stringify(batches)})`);
  } else {
    check("p31-red-releases-and-reallocates", h23 && released.length + batchesBeyond.length > 0,
      `the base expires the STAGED mixed batch: ${released.length} rows released${batchesBeyond.length ? ` and re-allocated into ${JSON.stringify(batchesBeyond)}` : ""} — payable twice if the staged transaction mines (the reviewer's C2/C3)`);
  }

  // Variant 2 (green only): confirm cannot attribute — the batch must be parked, its rows stay bound.
  if (part === "after" && (!only || only === "p31")) {
    const w2 = writeWorld("p31-park", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 60000 });
    const s2 = seedMixedStaged(w2, { mapsCover: "rows-only" });
    const r2 = runSettle(w2);
    const rows2 = ledgerRows(w2), batches2 = ledgerBatches(w2);
    console.log(`OBSERVE p31-park settle exit=${r2.code} batches=${JSON.stringify(batches2)}`);
    check("p31-park-keeps-binding", r2.code === 0 && rows2.every(x => x.batch === 1 && x.state === "exception") && batches2.some(b => b.id === 1 && b.state === "exception" && b.height === 100001) && batches2.length === 1,
      `an unattributable staged mixed batch is parked, never released or re-allocated (exit ${r2.code}) — money already moved, so the rows wait for manual reconciliation`);
  }
}

// ---- p33 (P3-3, H25): a 30-note vault ----------------------------------------------------------------
async function p33() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  // The long auction's vault: 30 spendable notes (each fee-reserve top-up is a note).
  const many = Array.from({ length: 30 }, (_, i) => ({ txid: hash("b54-note-" + i), height: 99000 + i, pool: "ironwood", address: FEE_RESERVE_UA,
    diversifier_index: String(30 + i), action_index: 0, value_zats: 10000, memo_hex: null, spent_in_txid: null }));
  // Red models the PRE-B54 quote-sweep (no H25 bound — the real tool before this batch): it quotes the
  // 31-note sweep happily and every build dies on create's standing 29 bound.
  const w = writeWorld(`p33-${part}`, fx, { root: part === "before" ? BASE : ROOT, benzo: part === "before" ? BASE_BENZO : GREEN_BENZO, feeReserve: 60000,
    extraNotes: many, quoteBound: part === "before" ? false : true });
  seedBatchOne(w);
  const r = runSettle(w);
  console.log(`OBSERVE p33-${part} settle exit=${r.code}`);
  console.log((r.err || r.out).trim().split("\n").filter(Boolean).slice(-6).map(l => "  | " + l).join("\n"));
  const receipts = existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? receiptsOf(w) : [];
  const log = settleLog(w) + r.err;
  if (part === "after") {
    const waits = (log.match(/^reserve return waits: the vault's value cannot be swept in one transaction \(.*29 bound \(H25\).*\)$/m) ?? []);
    check("p33-waits-line-names-h25", r.code === 0 && waits.length >= 1 && !receipts.some((x: any) => x.party === "reserve-return"),
      `the plan prints the typed waits line naming create's 29 bound (H25), no row, exit 0: ${waits[0]?.slice(0, 180) ?? "(no line)"}`);
  } else {
    const planned = /allocated/.test(log) && !/29 bound/.test(log);
    check("p33-red-planned-unbuildable-forever", r.code === 0 && planned && !receipts.some((x: any) => x.party === "reserve-return"),
      `the pre-B54 quote prices the 31-note sweep and the row is planned — then every build dies on create's 29 bound ("batch must have at most 29 spends"), set aside and re-planned forever; no receipt, no H25 reason anywhere`);
    const rerun = runSettle(w);
    check("p33-red-every-rerun", !receiptsOf(w).some((x: any) => x.party === "reserve-return") && (rerun.code !== 0 || !receiptsOf(w).some((x: any) => x.party === "reserve-return")),
      `every re-run stays at the wall (exit ${rerun.code} — the set-aside row publishes bare and its own verify then refuses the doc, like the p21 red): no return is ever paid, no H25 reason appears anywhere`);
  }
}

// ---- p34 (P3-4): backfillMapped heals only from what the host approved --------------------------------
async function p34() {
  // Units over the shared rule (the reviewer's B-world). The derived amount is only a cross-check.
  const dir = path.join(ROOT, "tmp", "b54", `p34-${part}-stores`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const txid = "dd".repeat(32);
  const mapFor = (outputs: any[]) => ({ txid, outputs });
  const writeStore = (batch: number, doc: any) => writeFileSync(path.join(dir, `batch-${batch}.json`), JSON.stringify(doc));
  const derived = new Map([["alice-row", "100"], ["bob-row", "200"]]);
  {
    const e1: any[] = [{ batch: 1, txid }];
    check("p34-b1-no-map-no-heal", hd.backfillMapped(e1, dir, derived) === 0 && e1[0].mapped === undefined,
      "no stored map: no heal");
    writeStore(2, { map: mapFor([{ party: "alice-row", output_index: 0 }]) });
    const e2: any[] = [{ batch: 2, txid: "ee".repeat(32) }];
    check("p34-b2-txid-mismatch-no-heal", hd.backfillMapped(e2, dir, derived) === 0 && e2[0].mapped === undefined,
      "a map of a different candidate: no heal");
  }
  {
    // B3 + B7: with the stored attestation the heal runs at the STORED amounts (green); the base heals at
    // today's derived amounts from the map alone (the drift surface), and without stored amounts the green
    // heal fails closed (the disclosed residual).
    writeStore(3, { map: mapFor([{ party: "alice-row", output_index: 0 }]), attested: [{ party: "alice-row", output_index: 0, amount_zats: "100" }] });
    const e3: any[] = [{ batch: 3, txid }];
    hd.backfillMapped(e3, dir, derived);
    const got3 = JSON.stringify(e3[0].mapped ?? null);
    writeStore(4, { map: mapFor([{ party: "alice-row", output_index: 0 }]) });
    const e4: any[] = [{ batch: 4, txid }];
    hd.backfillMapped(e4, dir, derived);
    const got4 = JSON.stringify(e4[0].mapped ?? null);
    console.log(`OBSERVE p34-${part} stored=[${got3}] map-only=[${got4}]`);
    if (part === "after") {
      check("p34-b3-heals-from-stored", got3 === JSON.stringify([{ party: "alice-row", output_index: 0, amount_zats: "100" }]),
        `the heal takes the stored amount and the derived amount matches (${got3})`);
      check("p34-b7-no-stored-no-heal", got4 === "null",
        "a record without stored amounts never heals (pre-B49 test state may stay unhealed, H26; mainnet starts fresh)");
    } else {
      check("p34-red-heals-from-derived", got3 === JSON.stringify([{ party: "alice-row", output_index: 0, amount_zats: "100" }]) && got4 === JSON.stringify([{ party: "alice-row", output_index: 0, amount_zats: "100" }]),
        `the base heals at TODAY's derived amounts from the map alone (stored=[${got3}], map-only=[${got4}]) — an attestation of what the host would derive now, not what it approved`);
    }
  }
  {
    // B4/B5: drift. The batch actually paid 150; today's derivation says 100.
    writeStore(5, { map: mapFor([{ party: "alice-row", output_index: 0 }]), attested: [{ party: "alice-row", output_index: 0, amount_zats: "150" }] });
    const e5: any[] = [{ batch: 5, txid }];
    hd.backfillMapped(e5, dir, new Map([["alice-row", "100"]]));
    const ownLedger = ((e5[0].mapped ?? []) as any[]).map((mm: any) => ({ txid, ...mm }));
    const scan = [{ txid: "ff".repeat(32), height: 10, spent_in_txid: txid }, { txid, height: 500, spent_in_txid: null }];
    const paid = paidByOwnLedger([{ party: "alice-row", amount_zats: "150", txid, output_index: 0 }], ownLedger, scan, 1000, () => 0).length;
    const derivedAmt = paidByOwnLedger([{ party: "alice-row", amount_zats: "100", txid, output_index: 0 }], ownLedger, scan, 1000, () => 0).length;
    console.log(`OBSERVE p34-${part} drift mapped=${JSON.stringify(e5[0].mapped ?? null)} paid-at-150=${paid} paid-at-100=${derivedAmt}`);
    if (part === "after") {
      check("p34-b45-drift-fails-closed-both-ways", e5[0].mapped === undefined && paid === 0 && derivedAmt === 0,
        "a drifted derivation never counts in either direction: nothing heals, so neither the actually-paid 150 nor the drifted 100 can ever count");
    } else {
      check("p34-red-drift-attests-the-drift", derivedAmt === 1 && paid === 0 && Array.isArray(e5[0].mapped),
        "the base attests the DRIFTED amount (a receipt at 100 counts although the transaction paid 150) — the residual P3-4 removes");
    }
  }
  {
    // B6: an existing mapped is never overwritten.
    const e6: any[] = [{ batch: 6, txid, mapped: [{ party: "alice-row", output_index: 7, amount_zats: "999" }] }];
    hd.backfillMapped(e6, dir, derived);
    check("p34-b6-never-overwrites", e6[0].mapped![0].output_index === 7 && e6[0].mapped![0].amount_zats === "999",
      "an existing mapped is never overwritten");
  }

  // The real `sign approve` stores the attested record the heal reads (green only: the base stores none).
  if (part === "after") {
    const beacon = await fetchBeacon(R);
    const fx = await buildAuction({ beacon, count: 3, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
    const st = path.join(ROOT, "tmp", "b54", "p34-approve-state");
    rmSync(st, { recursive: true, force: true });
    writeHostState(st, fx, REAL_PCZT);
    const obs = obligationsOf(fx);
    const packet = path.join(ROOT, "tmp", "b54", "p34-approve-packet");
    rmSync(packet, { recursive: true, force: true }); mkdirSync(path.join(packet, "public"), { recursive: true, mode: 0o700 });
    writePublicDir(path.join(packet, "public"), fx);
    const content = JSON.stringify({ rows: obs.map(o => ({ recipient: UA_ORCHARD, amount_zats: o.amount_zats })) });
    writeFileSync(path.join(packet, "candidate.pczt"), content);
    writeFileSync(path.join(packet, "sealed-alice.bin"), sealBlob(Buffer.from(content), fx.envelopeKeys[0].public_hex), { mode: 0o600 });
    writeFileSync(path.join(packet, "packet.json"), jsonBytes({ auction_id: fx.id, signer: fx.signer, seller_ua: UA_ORCHARD, batch: 1, expiry_blocks: 100,
      plan_version: sha256(readFileSync(path.join(packet, "candidate.pczt"))) }));
    const env = { BNZ_STATE_DIR: st, BNZ_PCZT_BIN: path.join(st, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(st, "bin", "benzo-scan"),
      BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10", BNZ_DRAND_URLS: "http://127.0.0.1:9/" };
    const r = sh(process.execPath, [GREEN_BENZO, "sign", "approve", "--id", fx.id, "--batch", "1", "--packet", packet, "--name", "alice"], env);
    const rec = JSON.parse(readFileSync(path.join(st, "approvals", fx.id, "batch-1.json"), "utf8"));
    const attested = Array.isArray(rec.attested) ? rec.attested : [];
    const inspected = Array.isArray(rec.inspect) ? rec.inspect : [];
    console.log(`OBSERVE p34-approve exit=${r.code} attested=${JSON.stringify(attested.map((a: any) => `${a.party}:${a.amount_zats}`))}`);
    check("p34-stored-attested-record", r.code === 0 && attested.length === obs.length && attested.every((a: any) => typeof a.amount_zats === "string") && inspected.length > 0,
      `sign approve stores the attested {party, output_index, amount_zats} record (and the host's own candidate inspect) next to the signed map (${attested.length} rows)`);
  }
}

// ---- p36 (P3-6): minedHeight cross-checks a second endpoint ------------------------------------------
async function p36() {
  // An endpoint-aware grpcurl stub: GetTransaction answers per configured endpoint.
  const st = path.join(ROOT, "tmp", "b54", `p36-${part}-state`);
  rmSync(st, { recursive: true, force: true });
  mkdirSync(path.join(st, "bin"), { recursive: true, mode: 0o700 });
  const impl = path.join(st, "bin", "grpcurl.cjs");
  writeFileSync(impl, `const a = process.argv.slice(2), method = a[a.length - 1].split("/").pop();
const endpoint = a[a.length - 2];
const answers = JSON.parse(process.env.BNZ_P36_ANSWERS || "{}");
if (method === "GetTransaction") {
  const v = answers[endpoint];
  if (v === undefined || v === null) { process.stderr.write("NotFound\\\\n"); process.exit(1); }
  console.log(JSON.stringify({ height: v }));
  process.exit(0);
}
process.stderr.write("NotFound\\\\n"); process.exit(1);
`);
  chmodSync(impl, 0o755);
  writeFileSync(path.join(st, "bin", "grpcurl"), `#!/bin/sh\nexec node "$(dirname "$0")/grpcurl.cjs" "$@"\n`);
  chmodSync(path.join(st, "bin", "grpcurl"), 0o755);
  const txid = "ab".repeat(32);
  const run = (answers: Record<string, number | null>, env: Record<string, string> = {}) => {
    const prev = process.env.BNZ_P36_ANSWERS;
    process.env.BNZ_P36_ANSWERS = JSON.stringify(answers);
    for (const [k, v] of Object.entries(env)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
    let out: number | string;
    try { out = hc.minedHeight(st, txid); } catch (e) { out = "refused: " + String((e as Error).message).slice(0, 160); }
    for (const k of Object.keys(env)) delete process.env[k];
    if (prev === undefined) delete process.env.BNZ_P36_ANSWERS; else process.env.BNZ_P36_ANSWERS = prev;
    return out;
  };
  const both = { "127.0.0.1:9": 500, "127.0.0.1:10": 500 };
  const disagree = { "127.0.0.1:9": 500, "127.0.0.1:10": 400 };
  const halfKnows = { "127.0.0.1:9": 500 };
  const envBase = { BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10" };
  const agree = run(both, envBase), diff = run(disagree, envBase), half = run(halfKnows, envBase);
  const none = run({}, envBase);
  const single = run(halfKnows, { BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "", BNZ_LWD_SINGLE: "1" });
  const sameTwice = run(both, { BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:9" });
  const noAlt = run(both, { BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "" });
  console.log(`OBSERVE p36-${part} agree=${agree} disagree=${diff} half=${half} none=${none} single=${single} sameTwice=${sameTwice} noAlt=${noAlt}`);
  if (part === "after") {
    check("p36-agree-counts", agree === 500, "endpoints that agree give the height");
    check("p36-disagree-no-height", typeof diff === "string" && /no height/.test(diff) && none === 0,
      `endpoints that disagree mean no height, which fails closed (${diff})`);
    check("p36-half-knowledge-no-height", typeof half === "string" && /no height/.test(half),
      `one endpoint knowing it while the other does not is a disagreement too (${half})`);
    check("p36-single-mode", single === 500, "BNZ_LWD_SINGLE=1 keeps the one-endpoint behaviour (testnet)");
    check("p36-r64-and-config", typeof sameTwice === "string" && typeof noAlt === "string",
      `R64's rule rides along: one endpoint configured twice is not a cross-check (${sameTwice}); and the second endpoint must be configured (${noAlt})`);
  } else {
    check("p36-red-one-endpoint", agree === 500 && diff === 500 && half === 500,
      `the base reads BNZ_LWD_URL alone — a lying or lagging primary is unchallenged (disagree=${diff}, half=${half})`);
  }
}

if (wants("p21")) await p21();
if (wants("p21n")) await p21n();
if (wants("p31")) await p31();
if (wants("p33")) await p33();
if (wants("p34")) await p34();
if (wants("p36")) await p36();
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
