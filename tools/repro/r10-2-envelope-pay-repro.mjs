// R10 item 2 repro — remove ENVELOPE_INTERIM_REFUSAL and pay through validated v2 envelopes.
//
//   E1 (the flip): a frozen leaf whose owner-signed v2 envelope record is valid (the shared
//      envelopeRecordValid rule — exact n = 3 format, the signed manifest's pinned signer keys as stanza
//      recipients, owner_sig over the ciphertext, matching salted settlement commitment) is PAYABLE to the
//      destination the bidder sealed into its envelope. Before the fix the signer plan moves it to the
//      exception queue with the interim refusal ("multi-recipient envelope format ... not merged") and no
//      batch can pay it; after, the plan owes the refund and the shipped signer check resolves the
//      recipient by opening the envelope with the signer's own key — the exact UA sealed at bid time.
//   E2 (control): the winning leaf's refund is zero and it has no envelope record — it needs no row and
//      the plan owes nothing for it (R15 item 2's rule).
//
// Everything under test is real: fresh tlock ciphertexts from the pinned Go tle to a real quicknet round,
// a real v2 envelope sealed through the shipped envelope/ + envelope/bid modules to the real signer keys,
// a fresh ed25519-signed manifest, the shipped clear CLI for the result, real confirmed deposits (old
// mined fixture deposits, counted by the plan exactly as it counts them), and a real PCZT candidate built
// from the bidder wallet (created and inspected; never signed or broadcast). The corpus runs in a scratch
// BNZ_STATE_DIR; the live auction state is never touched.
//
// Usage: node tools/repro/r10-2-envelope-pay-repro.mjs
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const TLE = path.join(STATE, "bin", "tle");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const rndHex = (n) => randomBytes(n).toString("hex");
execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(path.join(ROOT, "tmp/repro-r10-2-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as merkle from "../clear/merkle";',
  'export * as env from "../envelope/index";',
  'export * as bid from "../envelope/bid";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r10-2-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r10-2-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const { schema, merkle, env, bid } = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r10-2-lib.mjs")).href);

// ---- scratch state -------------------------------------------------------------------------------
const SCRATCH = path.join(ROOT, "tmp/e2e/r10-2-state");
const scratch = (p) => path.join(SCRATCH, p);
const sh = (cmd, args, input) => {
  const p = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: SCRATCH } });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}`, stdout: p.stdout ?? "" };
};
rmSync(SCRATCH, { recursive: true, force: true });
for (const d of ["auction", "product", "settle", "run"]) mkdirSync(scratch(d), { recursive: true });
for (const d of ["bin", "vault", "proto", "frost", "signers"]) symlinkSync(path.join(STATE, d), scratch(d), "dir");
const bidderUfvk = sh(path.join(STATE, "bin", "zcash-devtool"), ["wallet", "-w", path.join(STATE, "bidder"), "list-accounts"]).out.match(/UFVK: (\S+)/)?.[1];
if (!bidderUfvk) { console.error("bidder UFVK unavailable"); process.exit(2); }
writeFileSync(scratch("ufvk.txt"), `${bidderUfvk}\n`, { mode: 0o600 });

// Real confirmed deposits the plan can count: old mined fixture deposits, spent through a mined batch the
// scratch ledger carries (the plan counts exactly those), at one address each so no stray rows appear.
const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sourceAuction = process.argv[2] ?? "3bbfa50130665d5177c6fdcd19ebb610b47fcf2a8016c38a7a0b1a21b2a0801a";
const sourceLedger = path.join(STATE, "settle", sourceAuction, "ledger.sqlite");
const { DatabaseSync } = await import("node:sqlite");
const owned = new Set(new DatabaseSync(sourceLedger, { readOnly: true }).prepare("SELECT txid FROM batches WHERE txid IS NOT NULL AND state!='exception'").all().map((b) => String(b.txid)));
const deposits = [...new Map(notes.filter((n) => n.value_zats === 500000 && n.height && n.memo_hex && n.memo_hex !== "00".repeat(512) && (!n.spent_in_txid || owned.has(n.spent_in_txid)))
  .map((n) => [n.address, n])).values()].slice(0, 2);
if (deposits.length < 2) { console.error("fewer than two usable deposits"); process.exit(2); }
const C = 500000n;

// ---- corpus: signed manifest, two real tlock bids, one real v2 envelope ---------------------------
const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const auction_id = rndHex(32);
const drandBase = process.env.BNZ_DRAND_URLS.split(",")[0];
const chain = schema.QUICKNET.chain_hash;
const latest = await fetch(`${drandBase}/${chain}/public/latest`);
if (!latest.ok) { console.error(`drand HTTP ${latest.status}`); process.exit(2); }
const R = (await latest.json()).round - 50;
const release = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
const T_freeze = release - 100, T_submit = T_freeze - 800, published_at = T_freeze - 200;
const beaconRes = await fetch(`${drandBase}/${chain}/public/${R}`);
if (!beaconRes.ok) { console.error(`drand HTTP ${beaconRes.status}`); process.exit(2); }
const beacon = await beaconRes.json();
const signerKeys = ["alice", "bob", "carol"].map((n) => JSON.parse(readFileSync(path.join(STATE, "signers", n, "envelope-key.json"), "utf8")).public_hex);
const manifest = {
  version: 1, network: "test", auction_id,
  escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r10.2 repro lot", supply: 1,
  reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
  C_zats: C.toString(), fee_zats: "0", deposit_addresses: deposits.map((n) => n.address),
  drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  envelope_keys: signerKeys,
};
const packet = schema.signRecord(manifest, signerPem);
const sealedDestination = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder")]).out.trim();
if (!sealedDestination.startsWith("utest1")) { console.error(`fresh bidder address unavailable: ${sealedDestination}`); process.exit(2); }
const sealBid = (i, price, destination) => {
  const prep = bid.prepareBid({ auction_id, price_zats: price, quantity: 1, destination_ua: destination, envelope_public_hexs: destination ? signerKeys : undefined });
  const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(prep.plaintext_hex, "hex"), maxBuffer: 1 << 20 });
  if (sealed.status !== 0) { console.error(`tle seal: ${sealed.stderr?.toString().trim()}`); process.exit(2); }
  const ciphertext_hash = sha256(sealed.stdout);
  return { bound: bid.bindSealedBid(prep, auction_id, ciphertext_hash), ct: sealed.stdout.toString("hex"), ciphertext_hash };
};
const bid0 = sealBid(0, 1000n, sealedDestination); // the loser: refund C through its v2 envelope
const bid1 = sealBid(1, C, undefined);             // the winner: refund 0, no envelope (E2)
const leaves = [bid0, bid1].map((b, i) => ({ auction_id, manifest_hash: packet.sha256, ciphertext_hash: b.ciphertext_hash,
  deposit: { txid: deposits[i].txid, pool: "ironwood", address: deposits[i].address, diversifier_index: String(deposits[i].diversifier_index) },
  leaf_index: i, ciphertext_hex: b.ct }));
const { root, paths } = merkle.tree(leaves);
const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: T_freeze, published_at, leaves, paths };
const opened = leaves.map((l) => {
  const r = spawnSync(TLE, ["-d", "-c", chain], { input: Buffer.from(l.ciphertext_hex, "hex"), maxBuffer: 1 << 20 });
  if (r.status !== 0) { console.error(`tle open: ${r.stderr?.toString().trim()}`); process.exit(2); }
  return { leaf_index: l.leaf_index, plaintext_hex: r.stdout.toString("hex") };
});
const envelopes = [{ ciphertext_hash: bid0.ciphertext_hash, envelope_ct: bid0.bound.envelope_ct_hex, owner_sig: bid0.bound.owner_sig_hex }];
const clearRun = sh(process.execPath, [path.join(ROOT, "clear/dist/cli.mjs")], JSON.stringify({ manifest: packet, signer, frozen, opened, reserve_opening: null, serial_beacon: null, launch: undefined }));
if (clearRun.code !== 0) { console.error(`clear failed: ${clearRun.out.trim().slice(-200)}`); process.exit(2); }
const result = JSON.parse(clearRun.out);
const refund0 = result.allocations.find((a) => a.leaf_index === 0)?.refund_zats;
if (refund0 !== C.toString()) { console.error(`corpus: leaf 0 refund must be C, got ${refund0}`); process.exit(2); }

const publicDir = scratch("public");
mkdirSync(publicDir, { recursive: true });
const doc = { version: 1, auction_id, signer, manifest: packet, state: "CLEARED", receipts: [], frozen, result, opened, envelopes, beacon: { round: beacon.round, signature: beacon.signature, chain_hash: chain } };
writeFileSync(scratch(`auction/${auction_id}.json`), JSON.stringify(doc), { mode: 0o600 });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(doc));
writeFileSync(scratch(`product/${auction_id}.json`), JSON.stringify({ public_dir: publicDir, settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 } }));
mkdirSync(scratch(`settle/${auction_id}`), { recursive: true });
{
  // The source ledger's mined batches are what make the old deposits count; its old rows are dropped so the
  // corpus plan pins fresh.
  cpSync(sourceLedger, scratch(`settle/${auction_id}/ledger.sqlite`));
  const db = new DatabaseSync(scratch(`settle/${auction_id}/ledger.sqlite`));
  db.exec("DELETE FROM obligations"); db.close();
}
const sellerUa = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder")]).out.trim();
const routing = { bidders: deposits.map((n) => ({ deposit_ua: n.address })), seller_ua: sellerUa, fee_reserve_ua: sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder")]).out.trim() };
for (const name of ["alice", "bob", "carol"]) writeFileSync(scratch(`settle/${auction_id}/routing-${name}.json`), JSON.stringify(routing), { mode: 0o600 });
writeFileSync(scratch(`settle/${auction_id}/routing-commitment.json`), JSON.stringify({ sha256: schema.hash(schema.jsonBytes(routing)), pinned_at: Date.now() }), { mode: 0o600 });

// ---- E1: the shipped signer plan ------------------------------------------------------------------
const planRun = sh(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), auction_id]);
console.log(`E1 plan exit ${planRun.code}`);
let outcome = "INCONCLUSIVE", plan = null;
if (planRun.code === 0) {
  plan = JSON.parse(planRun.stdout);
  console.log(`E1 obligations: ${JSON.stringify(plan.obligations)}`);
  console.log(`E1 exceptions: ${JSON.stringify(plan.exceptions.map((o) => ({ party: o.party, reason: o.reason ?? null })))}`);
  const owed = plan.obligations.find((o) => o.party === "leaf:0");
  const excepted = plan.exceptions.find((o) => o.party === "leaf:0");
  if (excepted && /multi-recipient envelope format/.test(excepted.reason ?? "")) {
    outcome = "CONFIRMED";
    console.log("CONFIRMED: a leaf with a valid v2 envelope is refused with the interim envelope error — the refund waits in the exception queue and no batch can pay it.");
  } else if (owed && owed.amount_zats === C.toString() && !excepted) {
    outcome = "FIXED";
    console.log("FIXED: the plan owes the refund through the validated v2 envelope.");
  } else if (excepted) console.log(`E1 leaf:0 exception reason: ${excepted.reason}`);
} else console.log(`E1 plan stderr: ${planRun.out.trim().slice(-200)}`);

// ---- E2 + the shipped signer check over a real batch ----------------------------------------------
if (plan) {
  const zeroRefundRow = plan.obligations.find((o) => o.party === "leaf:1") ?? plan.exceptions.find((o) => o.party === "leaf:1");
  console.log(`E2 zero-refund leaf:1 needs no row: ${zeroRefundRow === undefined}`);
  execFileSync(process.execPath, ["node_modules/.bin/esbuild", "settle/ledger.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${scratch("ledger.mjs")}`, "--log-level=error"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const { Ledger } = await import(scratch("ledger.mjs"));
  const ledger = new Ledger(SCRATCH, auction_id);
  ledger.pin(plan.obligations, plan.exceptions);
  ledger.eligible();
  const batch = ledger.allocate(13);
  console.log(`E1 scratch batch ${batch ? `${batch.id} with rows ${JSON.stringify(batch.outputs.map((o) => o.party))}` : "none (the envelope refund is not payable)"}`);
  if (batch) {
    const recipient = (party) => party === "seller" ? sellerUa : party === "leaf:0" ? sealedDestination : null;
    const payment = batch.outputs.map((o) => ({ recipient: recipient(o.party), amount_zats: o.amount_zats }));
    const candidate = scratch("candidate.pczt");
    const created = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["create", path.join(STATE, "bidder"), candidate, "364"], JSON.stringify(payment));
    console.log(`E1 candidate PCZT: ${created.code === 0 ? "created" : `create failed ${created.out.trim().slice(-120)}`}`);
    if (created.code === 0) {
      const check = sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "check", auction_id, String(batch.id), candidate, "alice"]);
      console.log(`E1 signer check exit ${check.code}`);
      if (check.code !== 0) console.log(`E1 check stderr: ${check.out.trim().slice(-220)}`);
      if (check.code === 0 && outcome === "FIXED" && batch.outputs.some((o) => o.party === "leaf:0")) {
        console.log(`FIXED: the signer check resolved leaf:0 to the exact UA sealed at bid time and the batch passed against a real PCZT.`);
      }
    }
  } else if (outcome === "CONFIRMED") console.log("CONFIRMED: no payable batch exists for the envelope refund.");
}
console.log(`outcome ${outcome}`);
