// R15 items 1–2 repro (Reviewer R F4/F5) — the `benzo verify` leaf-state-machine red/green checks (r15-*).
// Proves, against the shipped verifier entry points on fresh fabricated corpora (real tlock ciphertexts from
// the pinned Go tle, fresh keys, a real authenticated quicknet beacon), that:
//   - with the manifest pinning envelope_keys the leaf state machine runs for EVERY frozen leaf even when
//     zero envelope records are published (F4): a frozen leaf with a result obligation and a published
//     receipt but no row is refused with "missing row";
//   - a leaf the result owes nothing (refund 0) with no envelope record and no row is a correct no-op state
//     (F5): no false "missing row";
//   - a settlement row/receipt whose party is neither a result obligation nor a stray deposit is an ERROR on
//     the read-API checker even when no result is published (F4 clause b; `benzo verify` itself always has a
//     result, so that leg drives checkPublicAuction — the checker the read API runs);
//   - the Phase 2, 3 and 4 evidence dirs still verify OK (the pre-Phase-5 reading is unchanged).
// Checks (each prints one PASS/ERROR <id> line; exit 0 only if all PASS):
//   r15-machine-runs-without-records   rowless receipt for an obligated recordless leaf -> ERROR envelope missing row
//   r15-zero-refund-needs-no-row       zero-refund leaf, no record, no row -> verify OK envelope
//   r15-strangers-refused              stranger settlement parties without a result -> ERROR (neither a
//                                      result obligation nor a stray deposit)
//   r15-phase2-4                       Phase 2/3/4 evidence dirs verify OK envelope
//
// Usage: node tools/repro/r15-verify-leaves-repro.mjs
// Needs: npm ci; tools/bootstrap.sh (pinned Go tle in $BNZ_STATE_DIR/bin); network to drand quicknet.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const TLE = path.join(STATE, "bin", "tle"); // pinned tool by absolute path, never through PATH
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const rndHex = (n) => randomBytes(n).toString("hex");

// Provenance lines come from git and the clock at run time; this output is committed unedited.
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString().trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tools/repro/r15-verify-leaves-repro.mjs");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

// Build what the checks drive from this working tree: the shipped CLI and the modules under test.
execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(path.join(ROOT, "tmp/repro-r15-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as merkle from "../clear/merkle";',
  'export * as core from "../clear/core";',
  'export * as env from "../envelope/index";',
  'export * as bid from "../envelope/bid";',
  'export * as api from "../api/public-auction";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r15-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r15-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const lib = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r15-lib.mjs")).href);
const { schema, merkle, core, env, bid, api } = lib;

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, e) => { failures++; console.log(`ERROR ${id} ${e instanceof Error ? e.message : String(e)}`); };
const need = (ok, why) => { if (!ok) throw new Error(why); };

// ---- one fresh two-bid clearing over real tlock ciphertexts: leaf 0 wins at price C (refund 0), leaf 1
// loses (refund C). The recomputed obligations map then carries leaf:1 only — F5's exact split. ----
const drandBase = process.env.BNZ_DRAND_URLS.split(",")[0];
const chain = schema.QUICKNET.chain_hash;
const latest = await fetch(`${drandBase}/${chain}/public/latest`);
need(latest.ok, `drand HTTP ${latest.status}`);
const R = (await latest.json()).round - 50;
const release = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
const T_freeze = release - 100, T_submit = T_freeze - 800, published_at = T_freeze - 200;
const beaconRes = await fetch(`${drandBase}/${chain}/public/${R}`);
need(beaconRes.ok, `drand HTTP ${beaconRes.status}`);
const beacon = await beaconRes.json();

const C = 500000n;
function buildCorpus(name, { pinned, settlement, withResult = true }) {
  const signerKey = generateKeyPairSync("ed25519");
  const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const auction_id = rndHex(32);
  const manifest = {
    version: 1, network: "test", auction_id,
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r15 repro lot", supply: 1,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
    C_zats: C.toString(), fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  };
  if (pinned) manifest.envelope_keys = [0, 1, 2].map(() => env.generateEnvelopeKey().public_hex);
  const packet = schema.signRecord(manifest, signerPem);
  const prices = [C, 1000n];
  const leaves = [];
  for (const [i, price] of prices.entries()) {
    const nonce_hex = randomBytes(16).toString("hex");
    const owner = env.generateOwnerKey();
    const commitment = env.settlementCommitment(nonce_hex, ""); // a recordless bid: no envelope
    const plaintext = bid.buildBidPlaintext({ auction_id, price_zats: price, quantity: 1, nonce_hex, owner_public_hex: owner.public_hex, settlement_commitment_hex: commitment }).toString("hex");
    const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(plaintext, "hex"), maxBuffer: 1 << 20 });
    need(sealed.status === 0, `tle seal ${i}: ${sealed.stderr?.toString().trim()}`);
    const ciphertext_hash = sha256(sealed.stdout);
    leaves.push({ auction_id, manifest_hash: packet.sha256, ciphertext_hash, deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[i], diversifier_index: String(i) }, leaf_index: i, ciphertext_hex: sealed.stdout.toString("hex") });
  }
  const { root, paths } = merkle.tree(leaves);
  const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: T_freeze, published_at, leaves, paths };
  const opened = leaves.map((l) => {
    const r = spawnSync(TLE, ["-d", "-c", chain], { input: Buffer.from(l.ciphertext_hex, "hex"), maxBuffer: 1 << 20 });
    need(r.status === 0, `tle open ${l.leaf_index}: ${r.stderr?.toString().trim()}`);
    return { leaf_index: l.leaf_index, plaintext_hex: r.stdout.toString("hex") };
  });
  const result = core.clear({ manifest: packet, signer, frozen, opened });
  need(result.allocations.find((a) => a.leaf_index === 0).refund_zats === "0", "corpus: leaf 0 refund must be 0");
  need(result.allocations.find((a) => a.leaf_index === 1).refund_zats === C.toString(), "corpus: leaf 1 refund must be C");
  const dir = path.join(ROOT, "tmp/repro-r15", name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const doc = { version: 1, auction_id, signer, manifest: packet, state: withResult ? "CLEARED" : "REFUNDING", receipts: [], frozen, ...(withResult ? { result } : {}), opened, envelopes: [], beacon: { round: beacon.round, signature: beacon.signature, chain_hash: chain }, ...(settlement ? { settlement: typeof settlement === "function" ? settlement(auction_id) : settlement } : {}) };
  writeFileSync(path.join(dir, "auction.json"), schema.jsonBytes(doc));
  writeFileSync(path.join(dir, "manifest.json"), schema.jsonBytes(packet));
  writeFileSync(path.join(dir, "frozen.json"), schema.jsonBytes(frozen));
  if (withResult) writeFileSync(path.join(dir, "result.json"), schema.jsonBytes(result));
  if (settlement) writeFileSync(path.join(dir, "summary.json"), schema.jsonBytes(settlement));
  return { dir, signer, auction_id, result };
}

const verifyRun = (dir, signer, extra = []) => {
  const r = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", dir, "--signer", signer, ...extra], { encoding: "utf8", cwd: ROOT, maxBuffer: 64 << 20 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

// ---- r15-machine-runs-without-records (F4): the lying record — a frozen leaf's obligation "satisfied" by a
// published receipt with no row at all — is refused even with zero envelope records published. Pre-fix the
// envelope gate early-returned and `benzo verify` accepted it (accounting's obligation pass takes a receipt
// without a row, and the claims pass only walks rows). ----
try {
  const receipt = (auction_id, party, amount) => ({ auction_id, party, txid: rndHex(32), pool: "ironwood", output_index: 0, amount_zats: amount });
  // the lying record: leaf:1's obligation "satisfied" by a published receipt with no row at all. The seller
  // row is a correct unpaid exception row (R16 F2 makes a PAID seller row fail verify today — Track A's fix).
  const c = buildCorpus("rowless-receipt", { pinned: true, settlement: (id) => ({ rows: [{ party: "seller", amount_zats: C.toString(), state: "exception" }], receipts: [receipt(id, "leaf:1", C.toString())] }) });
  const r = verifyRun(c.dir, c.signer);
  need(r.code === 1 && /ERROR envelope [^\n]*missing row/.test(r.out), `got exit ${r.code}: ${(r.out.match(/ERROR [^\n]*/g) ?? ["no ERROR line"]).join(" | ") || "verify accepted the rowless receipt"}`);
  pass("r15-machine-runs-without-records");
} catch (e) { fail("r15-machine-runs-without-records", e); }

// ---- r15-zero-refund-needs-no-row (F5): leaf 0 is owed nothing (refund 0) and has no envelope record —
// its row-free state is correct; leaf 1's obligation is a correct unpaid exception row. Verify must pass. ----
try {
  const c = buildCorpus("zero-refund", { pinned: true, settlement: { rows: [{ party: "seller", amount_zats: C.toString(), state: "exception" }, { party: "leaf:1", amount_zats: C.toString(), state: "exception" }], receipts: [] } });
  const r = verifyRun(c.dir, c.signer);
  need(r.code === 0 && r.out.includes("OK envelope") && !r.out.includes("ERROR envelope"), `got exit ${r.code}: ${r.out.slice(0, 300)}`);
  need(r.out.includes("missing envelope 1; in the exception queue"), `expected the exception-queue warn for leaf 1: ${r.out.slice(0, 300)}`);
  pass("r15-zero-refund-needs-no-row");
} catch (e) { fail("r15-zero-refund-needs-no-row", e); }

// ---- r15-strangers-refused (F4 clause b): rows/receipts whose party is neither a result obligation nor a
// stray deposit are an ERROR on the read-API checker even with no result published (the CANCELLED path).
// `benzo verify` cannot load a result-less dir (loadCompletePublicAuction), so this leg drives the checker
// directly — the same checkPublicAuction the shipped read API runs. ----
try {
  const c = buildCorpus("strangers", {
    pinned: false, withResult: false,
    settlement: {
      rows: [{ party: "leaf:9", amount_zats: C.toString() }, { party: "junk", amount_zats: "1" }],
      receipts: [{ auction_id: "f".repeat(64), party: "operator", txid: rndHex(32), pool: "ironwood", output_index: 0, amount_zats: "1" }],
    },
  });
  const pub = api.loadPublicAuction(c.dir, { signer: c.signer });
  const checks = api.checkPublicAuction(pub);
  const stranger = checks.find((x) => x.error && x.error.includes("neither a result obligation nor a stray deposit"));
  need(stranger, `stranger parties accepted: ${JSON.stringify(checks.filter((x) => x.error))}`);
  need(stranger.id === "accounting-strays", `stranger error on wrong check ${stranger.id}`);
  pass("r15-strangers-refused");
} catch (e) { fail("r15-strangers-refused", e); }

// ---- r15-phase2-4: the Phase 2, 3 and 4 evidence dirs (no envelope_keys) still verify OK envelope ----
try {
  const signerOf = (file, field) => {
    const j = JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
    return field ? j[field] : j.signer;
  };
  const phase2 = verifyRun(path.join(ROOT, "docs/evidence/phase-2/auction"), signerOf("docs/evidence/phase-2/auction/signer.json"), ["--fetch-beacon"]);
  need(phase2.code === 0 && phase2.out.includes("OK envelope"), `phase-2 exit ${phase2.code}: ${phase2.out.slice(0, 300)}`);
  // Phase 3 has no canonical public dir; rebuild one from its recorded artifacts (the R12 repro's reading).
  const p3 = path.join(ROOT, "tmp/repro-r15/phase3-public");
  rmSync(p3, { recursive: true, force: true }); mkdirSync(p3, { recursive: true });
  for (const f of ["manifest.json", "frozen.json", "result.json", "summary.json"]) copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/main", f), path.join(p3, f));
  copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/signer.json"), path.join(p3, "signer.json"));
  const phase3 = verifyRun(p3, signerOf("docs/evidence/phase-3/settle/signer.json"), ["--fetch-beacon"]);
  need(phase3.code === 0 && phase3.out.includes("OK envelope"), `phase-3 exit ${phase3.code}: ${phase3.out.slice(0, 300)}`);
  const phase4 = verifyRun(path.join(ROOT, "docs/evidence/phase-4/cli"), signerOf("docs/evidence/phase-4/cli/auction.json", "signer"));
  need(phase4.code === 0 && phase4.out.includes("OK envelope"), `phase-4 exit ${phase4.code}: ${phase4.out.slice(0, 300)}`);
  pass("r15-phase2-4");
} catch (e) { fail("r15-phase2-4", e); }

console.log(failures === 0 ? "RESULT PASS all r15 verify leaf-state-machine assertions" : `RESULT FAIL ${failures}`);
process.exit(failures === 0 ? 0 : 1);
