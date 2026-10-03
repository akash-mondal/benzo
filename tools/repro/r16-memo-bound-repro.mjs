// R16 item 2 (corrected by R18) repro — the memo-bound envelope red/green checks (r16-*).
// Proves, against the shipped entry points (bin/benzo bid seal + verify, the shared memo parser and cancel
// seam in settle/envelopes.ts) on fresh values (real tlock ciphertexts from the pinned Go tle, fresh keys,
// real authenticated quicknet beacons), that:
//   - `bid seal` writes memo framing v2 — ff424e5a02 || u16be ct_len || tlock_ct || envelope_tag (18) ||
//     zero pad, envelope_tag = first 18 bytes of SHA-256(envelope_ct) (18 zero bytes when the bid carries
//     no envelope) — with the exact 512-byte fit at ct_len 487 (R18), and refuses any longer ciphertext;
//   - the shared parser (memoSealedBid) reads v2 and v1; v1 memos (Phase 1–4 evidence) stay readable and
//     bind no envelope;
//   - a signer authenticates an envelope before R from the scanned memo tag alone (no tlock opening is
//     possible yet) and opens it to the bidder's destination — the offline cancel-before-R fixture; a
//     substituted record, a v1 memo or a zero tag is never opened (exception queue);
//   - `benzo verify` ERRORs a published record that the deposit memo does not commit to, exactly as intake
//     refuses it (one shared memoBindsEnvelope rule for intake, verify and the signer).
// Checks (each prints one PASS/ERROR <id> line; exit 0 only if all PASS):
//   r16-bid-seal-v2          bid seal writes v2 with the 18-byte tag and a 487-byte ct (exact fit); zero tag
//                            without an envelope; the shared parser reads it back
//   r16-ct-len-refused       the shared parser refuses ct_len 488/505 (so `bid seal` refuses > 487) and
//                            accepts 487
//   r16-v1-still-readable    the recorded Phase 2 v1 memo parses with no tag; a v1 memo binds no record
//   r16-cancel-before-r      pre-R (tle open fails: beacon unpublished) the signer opens the memo-bound
//                            record to the exact destination; substituted record / v1 memo / zero tag -> null
//   r16-verify-binding       benzo verify ERRORs "envelope 0 not bound to the deposit memo" for an
//                            owner-signed, commitment-consistent record the memo does not commit to; the
//                            bound corpus verifies OK envelope
//   r16-phase2-4             the Phase 2, 3 and 4 evidence dirs still verify OK envelope
//
// Usage: node tools/repro/r16-memo-bound-repro.mjs
// Needs: npm ci; tools/bootstrap.sh (pinned Go tle in $BNZ_STATE_DIR/bin); network to drand quicknet.
// The intake leg (clear/auction-cli.ts admit) is not reachable offline — it needs the live vault scanner and
// a mined deposit — so the binding rule is driven here through its two other legs (verify + signer cancel),
// which import the same memoBindsEnvelope; the mutation run weakens that one rule and both legs turn red.
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
console.log("command node tools/repro/r16-memo-bound-repro.mjs");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

// Build what the checks drive from this working tree: the shipped CLI (bin/benzo runs the browser sealer for
// bid seal) and the modules under test.
execFileSync("npm", ["run", "--silent", "build:seal"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(path.join(ROOT, "tmp/repro-r16-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as merkle from "../clear/merkle";',
  'export * as core from "../clear/core";',
  'export * as env from "../envelope/index";',
  'export * as bid from "../envelope/bid";',
  'export * as senv from "../settle/envelopes";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r16-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r16-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const lib = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r16-lib.mjs")).href);
const { schema, merkle, core, env, bid, senv } = lib;

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, e) => { failures++; console.log(`ERROR ${id} ${e instanceof Error ? e.message : String(e)}`); };
const need = (ok, why) => { if (!ok) throw new Error(why); };

// Real Zcash crate test-vector destinations (never published anywhere else), as in tools/repro/mr-envelope-repro.mjs.
const SAPLING = "ztestsapling1redacted";
const UA_SHIELDED = "utest1redacted";

// The framing under test (R16 item 2, R18): a fixture writer for the scanned-memo corpus only — every value
// inside it (tlock ct, envelope_ct, keys) is fresh and produced by the pinned tools and shipped modules.
const TAG_LEN = 18;
const v2Memo = (ct, tag18) => {
  const memo = Buffer.alloc(512);
  Buffer.from("ff424e5a02", "hex").copy(memo, 0);
  memo.writeUInt16BE(ct.length, 5);
  ct.copy(memo, 7);
  tag18.copy(memo, 7 + ct.length);
  return memo.toString("hex");
};
const v1Memo = (ct) => {
  const memo = Buffer.alloc(512);
  Buffer.from("ff424e5a01", "hex").copy(memo, 0);
  memo.writeUInt16BE(ct.length, 5);
  ct.copy(memo, 7);
  return memo.toString("hex");
};
const tagOf = (envelopeCtHex) => Buffer.from(sha256(Buffer.from(envelopeCtHex, "hex")).slice(0, TAG_LEN * 2), "hex");

const drandBase = process.env.BNZ_DRAND_URLS.split(",")[0];
const chain = schema.QUICKNET.chain_hash;
const latest = await fetch(`${drandBase}/${chain}/public/latest`);
need(latest.ok, `drand HTTP ${latest.status}`);
const latestRound = (await latest.json()).round;
const R_PAST = latestRound - 50;
const R_FUTURE = latestRound + 100000; // ~83h ahead: its beacon can never exist in this run
const beaconRes = await fetch(`${drandBase}/${chain}/public/${R_PAST}`);
need(beaconRes.ok, `drand HTTP ${beaconRes.status}`);
const beacon = await beaconRes.json();

const keys = [env.generateEnvelopeKey(), env.generateEnvelopeKey(), env.generateEnvelopeKey()];
const recipients = keys.map((k) => k.public_hex);
const C = 500000n;

const bidSeal = (manifestFile, signer, input) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), ["bid", "seal", "--manifest", manifestFile, "--signer", signer], { input: JSON.stringify(input), encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? ""), value: p.status === 0 ? JSON.parse(p.stdout) : null };
};

// ---- r16-bid-seal-v2 / r16-ct-len-refused: the shipped `bid seal` over a fabricated signed manifest (no
// chain involved) writes framing v2 with the exact fit at ct_len 487 and the 18-byte envelope tag. ----
let bidManifestFile = "", bidSigner = "";
{
  const signerKey = generateKeyPairSync("ed25519");
  const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const auction_id = rndHex(32);
  const manifest = {
    version: 1, network: "test", auction_id,
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r16 repro lot", supply: 1,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
    C_zats: C.toString(), fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R: R_FUTURE }, T_submit: schema.QUICKNET.genesis + (R_FUTURE - 1) * schema.QUICKNET.period - 850, T_freeze: schema.QUICKNET.genesis + (R_FUTURE - 1) * schema.QUICKNET.period - 100, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    envelope_keys: recipients,
  };
  const packet = schema.signRecord(manifest, signerPem);
  bidManifestFile = path.join(ROOT, "tmp/repro-r16/manifest.json");
  mkdirSync(path.join(ROOT, "tmp/repro-r16"), { recursive: true });
  writeFileSync(bidManifestFile, schema.jsonBytes(packet));
  bidSigner = signer;
  try {
    const sealed = bidSeal(bidManifestFile, bidSigner, { price_zats: "1000000", quantity: 1, address: manifest.deposit_addresses[0], refund_ua: UA_SHIELDED });
    need(sealed.code === 0, `bid seal exit ${sealed.code}: ${sealed.out.slice(-300)}`);
    const memo = Buffer.from(sealed.value.envelope_hex, "hex");
    need(memo.length === 512, `memo ${memo.length} bytes (want 512)`);
    need(memo.subarray(0, 5).toString("hex") === "ff424e5a02", `header ${memo.subarray(0, 5).toString("hex")} (want ff424e5a02)`);
    const len = memo.readUInt16BE(5);
    need(len === 487, `ct_len ${len} (want 487 — R18 exact fit)`);
    need(memo.subarray(7, 7 + 22).toString("latin1") === "age-encryption.org/v1\n", "ct is not a binary age ciphertext");
    const wantTag = tagOf(sealed.value.envelope_ct_hex);
    need(memo.subarray(7 + len, 7 + len + TAG_LEN).equals(wantTag), `envelope_tag ${memo.subarray(7 + len, 7 + len + TAG_LEN).toString("hex")} != first 18 bytes of SHA-256(envelope_ct) ${wantTag.toString("hex")}`);
    need(memo.subarray(7 + len + TAG_LEN).every((b) => b === 0), "non-zero bytes after the envelope tag");
    const parsed = senv.memoSealedBid(sealed.value.envelope_hex);
    need(parsed && parsed.ciphertext_hex === memo.subarray(7, 7 + len).toString("hex") && parsed.envelope_tag === wantTag.toString("hex"), "the shared parser does not read back what bid seal wrote");
    // without a refund destination the memo commits to 18 zero bytes
    const bare = bidSeal(bidManifestFile, bidSigner, { price_zats: "1000000", quantity: 1, address: manifest.deposit_addresses[1] });
    need(bare.code === 0, `bid seal (no envelope) exit ${bare.code}: ${bare.out.slice(-300)}`);
    const bm = Buffer.from(bare.value.envelope_hex, "hex");
    need(bm.readUInt16BE(5) === 487 && bm.subarray(7 + 487, 7 + 487 + TAG_LEN).equals(Buffer.alloc(TAG_LEN)) && bm.subarray(7 + 487 + TAG_LEN).every((b) => b === 0), "no-envelope memo is not v2 with an 18-zero-byte tag");
    pass("r16-bid-seal-v2");
  } catch (e) { fail("r16-bid-seal-v2", e); }
  try {
    const ct = randomBytes(487); // fresh content; the check is on the framing bound
    const ok = senv.memoSealedBid(v2Memo(ct, Buffer.alloc(TAG_LEN)));
    need(ok && ok.ciphertext_hex === ct.toString("hex"), "ct_len 487 refused");
    for (const claim of [488, 505]) {
      const memo = Buffer.alloc(512);
      Buffer.from("ff424e5a02", "hex").copy(memo, 0);
      memo.writeUInt16BE(claim, 5);
      Buffer.concat([ct, Buffer.alloc(18)]).copy(memo, 7);
      need(senv.memoSealedBid(memo.toString("hex")) === null, `ct_len ${claim} accepted (bid seal must refuse > 487)`);
    }
    need(senv.memoSealedBid(v2Memo(Buffer.alloc(0), Buffer.alloc(TAG_LEN))) === null, "ct_len 0 accepted");
    pass("r16-ct-len-refused");
  } catch (e) { fail("r16-ct-len-refused", e); }
}

// ---- r16-v1-still-readable: the recorded Phase 2 evidence memo (framing v1) still parses; a v1 memo binds
// no record at all. ----
try {
  const memoHex = readFileSync(path.join(ROOT, "docs/evidence/phase-2/auction/bid0.memo.hex"), "utf8").trim();
  const parsed = senv.memoSealedBid(memoHex);
  need(parsed && parsed.envelope_tag === null, "v1 memo did not parse with a null envelope tag");
  const ct = Buffer.from(parsed.ciphertext_hex, "hex");
  need(ct.length === 487 && ct.subarray(0, 22).toString("latin1") === "age-encryption.org/v1\n", `v1 ct ${ct.length} bytes, not a 487-byte age ciphertext`);
  need(senv.memoBindsEnvelope(parsed.envelope_tag, "ab".repeat(100)) === false, "a v1 memo bound a record");
  pass("r16-v1-still-readable");
} catch (e) { fail("r16-v1-still-readable", e); }

// ---- r16-cancel-before-r: the offline cancel fixture. A real bid (fresh owner key, real 487-byte tlock ct
// over the 128-byte layout) with a real n = 3 envelope to a real destination; the scanned deposit memo
// commits to the envelope tag. Before R no beacon exists and `tle -d` fails, yet the signer authenticates
// the record from the memo tag alone and opens it to the exact destination. ----
try {
  const envelope_ct = env.sealEnvelope(UA_SHIELDED, recipients);
  const owner = env.generateOwnerKey(), nonce_hex = randomBytes(16).toString("hex");
  const commitment = env.settlementCommitment(nonce_hex, envelope_ct);
  const plaintext = bid.buildBidPlaintext({ auction_id: rndHex(32), price_zats: 1000000n, quantity: 1, nonce_hex, owner_public_hex: owner.public_hex, settlement_commitment_hex: commitment }).toString("hex");
  const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R_FUTURE), "-c", chain], { input: Buffer.from(plaintext, "hex"), maxBuffer: 1 << 20 });
  need(sealed.status === 0, `tle seal: ${sealed.stderr?.toString().trim()}`);
  const ct = sealed.stdout;
  need(ct.length === 487, `tlock ct ${ct.length} bytes (want 487)`);
  const ciphertext_hash = sha256(ct);
  const rec = { ciphertext_hash, envelope_ct, owner_sig: env.signEnvelope(owner, rndHex(32), ciphertext_hash, envelope_ct) };
  const memoHex = v2Memo(ct, tagOf(envelope_ct)); // the scanned deposit memo (the fixture the scanner returns)
  // pre-R: the tlock ciphertext cannot be opened at all — the beacon for R_FUTURE is unpublished
  const open = spawnSync(TLE, ["-d", "-c", chain], { input: ct, maxBuffer: 1 << 20 });
  need(open.status !== 0, "tle opened the ciphertext before R; the fixture is not pre-R");
  for (const k of keys) need(senv.memoBoundEnvelope(memoHex, rec, k.private_hex) === UA_SHIELDED, "memo-bound envelope did not open to the destination");
  const other = { ...rec, envelope_ct: env.sealEnvelope(SAPLING, recipients) };
  for (const k of keys) need(senv.memoBoundEnvelope(memoHex, other, k.private_hex) === null, "a substituted record was opened");
  need(senv.memoBoundEnvelope(v1Memo(ct), rec, keys[0].private_hex) === null, "a v1 memo opened a record");
  need(senv.memoBoundEnvelope(v2Memo(ct, Buffer.alloc(TAG_LEN)), rec, keys[0].private_hex) === null, "a zero envelope tag opened a record");
  pass("r16-cancel-before-r");
} catch (e) { fail("r16-cancel-before-r", e); }

// ---- r16-verify-binding: `benzo verify` on fresh pinned corpora over real tlock ciphertexts and a real
// beacon. The published record must be the envelope the deposit memo committed to: an owner-signed,
// commitment-consistent record the memo does not commit to is an ERROR even though everything else about
// it is valid (exactly the record the pre-fix verifier accepted). ----
function buildCorpus(name, { substitute }) {
  const signerKey = generateKeyPairSync("ed25519");
  const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const auction_id = rndHex(32);
  const manifest = {
    version: 1, network: "test", auction_id,
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r16 repro lot", supply: 1,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
    C_zats: C.toString(), fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R: R_PAST }, T_submit: 1790000000, T_freeze: 1790000800, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    envelope_keys: recipients,
  };
  const packet = schema.signRecord(manifest, signerPem);
  const prices = [C, 1000n]; // leaf 0 wins at price C (refund 0), leaf 1 loses (refund C)
  const leaves = [], envelopes = [];
  for (const [i, price] of prices.entries()) {
    // The depositor's memo commits to envelope X (fresh, to the real destination). Leaf 0's published record
    // is X unless `substitute`, when the operator publishes Y instead — owner-signed and commitment-consistent
    // over Y (everything the pre-fix verifier checked), but not the envelope the memo committed to.
    const committed = env.sealEnvelope(UA_SHIELDED, recipients);
    const published = substitute && i === 0 ? env.sealEnvelope(SAPLING, recipients) : committed;
    const owner = env.generateOwnerKey(), nonce_hex = randomBytes(16).toString("hex");
    const commitment = env.settlementCommitment(nonce_hex, published);
    const plaintext = bid.buildBidPlaintext({ auction_id, price_zats: price, quantity: 1, nonce_hex, owner_public_hex: owner.public_hex, settlement_commitment_hex: commitment }).toString("hex");
    const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R_PAST), "-c", chain], { input: Buffer.from(plaintext, "hex"), maxBuffer: 1 << 20 });
    need(sealed.status === 0, `tle seal ${i}: ${sealed.stderr?.toString().trim()}`);
    need(sealed.stdout.length === 487, `tle ct ${i}: ${sealed.stdout.length} bytes (want 487)`);
    const ciphertext_hash = sha256(sealed.stdout);
    envelopes.push({ ciphertext_hash, envelope_ct: published, owner_sig: env.signEnvelope(owner, auction_id, ciphertext_hash, published) });
    leaves.push({ auction_id, manifest_hash: packet.sha256, ciphertext_hash, deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[i], diversifier_index: String(i) }, leaf_index: i, ciphertext_hex: sealed.stdout.toString("hex"), memo_envelope_tag: tagOf(committed).toString("hex") });
  }
  const { root, paths } = merkle.tree(leaves);
  const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: 1790000800, published_at: 1790000600, leaves, paths };
  const opened = leaves.map((l) => {
    const r = spawnSync(TLE, ["-d", "-c", chain], { input: Buffer.from(l.ciphertext_hex, "hex"), maxBuffer: 1 << 20 });
    need(r.status === 0, `tle open ${l.leaf_index}: ${r.stderr?.toString().trim()}`);
    return { leaf_index: l.leaf_index, plaintext_hex: r.stdout.toString("hex") };
  });
  const result = core.clear({ manifest: packet, signer, frozen, opened });
  need(result.allocations.find((a) => a.leaf_index === 0).refund_zats === "0", "corpus: leaf 0 refund must be 0");
  need(result.allocations.find((a) => a.leaf_index === 1).refund_zats === C.toString(), "corpus: leaf 1 refund must be C");
  const settlement = { rows: [{ party: "seller", amount_zats: C.toString(), state: "exception" }, { party: "leaf:1", amount_zats: C.toString(), state: "exception" }], receipts: [] };
  const dir = path.join(ROOT, "tmp/repro-r16", name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const doc = { version: 1, auction_id, signer, manifest: packet, state: "CLEARED", receipts: [], frozen, result, opened, envelopes, beacon: { round: beacon.round, signature: beacon.signature, chain_hash: chain }, settlement };
  writeFileSync(path.join(dir, "auction.json"), schema.jsonBytes(doc));
  writeFileSync(path.join(dir, "manifest.json"), schema.jsonBytes(packet));
  writeFileSync(path.join(dir, "frozen.json"), schema.jsonBytes(frozen));
  writeFileSync(path.join(dir, "result.json"), schema.jsonBytes(result));
  writeFileSync(path.join(dir, "summary.json"), schema.jsonBytes(settlement));
  return { dir, signer };
}

const verifyRun = (dir, signer, extra = []) => {
  const r = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", dir, "--signer", signer, ...extra], { encoding: "utf8", cwd: ROOT, maxBuffer: 64 << 20 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

try {
  const good = buildCorpus("bound", { substitute: false });
  const ok = verifyRun(good.dir, good.signer);
  need(ok.code === 0 && ok.out.includes("OK envelope") && !ok.out.includes("ERROR"), `bound corpus: exit ${ok.code}: ${ok.out.slice(0, 300)}`);
  const bad = buildCorpus("substituted", { substitute: true });
  const r = verifyRun(bad.dir, bad.signer);
  need(r.code === 1 && /ERROR envelope [^\n]*not bound to the deposit memo/.test(r.out), `substituted record got exit ${r.code}: ${(r.out.match(/ERROR [^\n]*/g) ?? ["no ERROR line"]).join(" | ") || "verify accepted a record the memo does not commit to"}`);
  pass("r16-verify-binding");
} catch (e) { fail("r16-verify-binding", e); }

// ---- r16-phase2-4: the Phase 2, 3 and 4 evidence dirs (v1 memos, no envelope_keys) still verify OK ----
try {
  const signerOf = (file, field) => {
    const j = JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
    return field ? j[field] : j.signer;
  };
  const phase2 = verifyRun(path.join(ROOT, "docs/evidence/phase-2/auction"), signerOf("docs/evidence/phase-2/auction/signer.json"), ["--fetch-beacon"]);
  need(phase2.code === 0 && phase2.out.includes("OK envelope"), `phase-2 exit ${phase2.code}: ${phase2.out.slice(0, 300)}`);
  const p3 = path.join(ROOT, "tmp/repro-r16/phase3-public");
  rmSync(p3, { recursive: true, force: true }); mkdirSync(p3, { recursive: true });
  for (const f of ["manifest.json", "frozen.json", "result.json", "summary.json"]) copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/main", f), path.join(p3, f));
  copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/signer.json"), path.join(p3, "signer.json"));
  const phase3 = verifyRun(p3, signerOf("docs/evidence/phase-3/settle/signer.json"), ["--fetch-beacon"]);
  need(phase3.code === 0 && phase3.out.includes("OK envelope"), `phase-3 exit ${phase3.code}: ${phase3.out.slice(0, 300)}`);
  const phase4 = verifyRun(path.join(ROOT, "docs/evidence/phase-4/cli"), signerOf("docs/evidence/phase-4/cli/auction.json", "signer"));
  need(phase4.code === 0 && phase4.out.includes("OK envelope"), `phase-4 exit ${phase4.code}: ${phase4.out.slice(0, 300)}`);
  pass("r16-phase2-4");
} catch (e) { fail("r16-phase2-4", e); }

console.log(failures === 0 ? "RESULT PASS all r16 memo-bound envelope assertions" : `RESULT FAIL ${failures}`);
process.exit(failures === 0 ? 0 : 1);
