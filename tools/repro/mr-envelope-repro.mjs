// R12 item 1 / R10 item 1 repro — the multi-recipient settlement envelope red/green checks (mr-*).
// Proves, against the shipped entry points and the real pinned tools (Go tle, drand quicknet), that:
//   - the v2 record format is enforced by the one shared rule (exact n = 3 length, magic, stanza
//     recipients equal to the signed manifest's `envelope_keys` in order), and
//   - `benzo verify` refuses (ERROR envelope) any published record the operator should never have
//     admitted, while pre-v2 (572-byte) records stay accepted exactly where the manifest pins no keys
//     (the Phase 2–4 evidence).
// Checks (each prints one PASS/ERROR <id> line; exit 0 only if all PASS):
//   mr-manifest-envelope-keys   manifest pinning: 3 distinct 64-hex keys accepted; 4 keys and duplicates refused
//   mr-3keys-open               one envelope opens to the same destination with each of the 3 recipient keys
//   mr-4th-key-refused          a 4th key is refused (no stanza for it)
//   mr-equal-lengths            every n = 3 envelope ciphertext is 1852 hex (926 bytes)
//   mr-stanza-swap-refused      a whole stanza swapped between envelopes is refused for every recipient
//   mr-shared-rule-export       envelope/ exports envelopeRecordValid(record, envelope_keys) (R12 item 1)
//   mr-verify                   benzo verify accepts a fresh 3-record pinned corpus; an owner_sig flip and an
//                               envelope_ct swap are each caught by the owner binding (R7.4: warn + exception queue)
//   mr-verify-foreign-key       R's probe: a record sealed to an attacker key under pinned envelope_keys
//                               gives OK envelope before the rule and ERROR envelope after
//   mr-verify-foreign-set       a record sealed to [attacker, key2, key3] under pinned keys -> ERROR envelope
//   mr-verify-pre-v2-pinned     a 572-byte record under a pinned manifest -> ERROR envelope
//   mr-verify-2of3-pinned       a record sealed to 2 of the 3 pinned keys -> ERROR envelope
//   mr-verify-pre-v2-unpinned   a 572-byte record under a manifest with no envelope_keys -> OK envelope
//   mr-verify-phase2-4          the Phase 2, 3 and 4 evidence dirs still verify OK (OK envelope)
//
// Usage: node tools/repro/mr-envelope-repro.mjs
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

// Provenance lines come from git and the clock at run time; this output is committed unedited.
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString().trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tools/repro/mr-envelope-repro.mjs`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

// Build what the checks drive from this working tree: the shipped CLI and the modules under test.
execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(path.join(ROOT, "tmp/repro-mr-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as merkle from "../clear/merkle";',
  'export * as core from "../clear/core";',
  'export * as env from "../envelope/index";',
  'export * as bid from "../envelope/bid";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-mr-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-mr-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const lib = await import(pathToFileURL(path.join(ROOT, "tmp/repro-mr-lib.mjs")).href);
const { schema, merkle, core, env, bid } = lib;

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, e) => { failures++; console.log(`ERROR ${id} ${e instanceof Error ? e.message : String(e)}`); };
const refused = (fn, want) => {
  try { fn(); } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes(want)) return;
    throw new Error(`got "${m}", want "${want}"`);
  }
  throw new Error(`accepted, want refusal "${want}"`);
};
const need = (ok, why) => { if (!ok) throw new Error(why); };

// Real Zcash crate test-vector destinations (never published anywhere else).
const SAPLING = "ztestsapling1redacted";
const UA_SHIELDED = "utest1redacted";
const flip = (h, i = 3) => h.slice(0, i * 2) + (h[i * 2] === "0" ? "1" : "0") + h.slice(i * 2 + 1);
const rndHex = (n) => randomBytes(n).toString("hex");

const keys = [env.generateEnvelopeKey(), env.generateEnvelopeKey(), env.generateEnvelopeKey()];
const recipients = keys.map((k) => k.public_hex);
const attacker = env.generateEnvelopeKey();

// ---- mr-manifest-envelope-keys: the signed manifest pins the recipient set ----
try {
  const base = {
    version: 1, network: "test", auction_id: rndHex(32), escrow_ua: "utest1" + rndHex(35),
    frost_group_key: rndHex(32), lot: "envelope proof lot", supply: 5,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: "50000", q_max: 10,
    C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35), "utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R: 32760000 }, T_submit: 1790000000, T_freeze: 1790000800, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    envelope_keys: recipients,
  };
  schema.validateManifest(base);
  refused(() => schema.validateManifest({ ...base, envelope_keys: [...recipients, rndHex(32)] }), "envelope_keys");
  refused(() => schema.validateManifest({ ...base, envelope_keys: [recipients[0], recipients[0], recipients[1]] }), "envelope_keys");
  pass("mr-manifest-envelope-keys");
} catch (e) { fail("mr-manifest-envelope-keys", e); }

// ---- mr-3keys-open / mr-4th-key-refused / mr-equal-lengths ----
let envA = "", envB = "";
try {
  envA = env.sealEnvelope(UA_SHIELDED, recipients);
  const got = keys.map((k) => env.openEnvelope(envA, k.private_hex));
  need(got.every((g) => g === UA_SHIELDED), `opens ${JSON.stringify(got)} != destination`);
  pass("mr-3keys-open");
} catch (e) { fail("mr-3keys-open", e); }
try {
  refused(() => env.openEnvelope(envA, env.generateEnvelopeKey().private_hex), "refused: envelope recipient");
  pass("mr-4th-key-refused");
} catch (e) { fail("mr-4th-key-refused", e); }
try {
  envB = env.sealEnvelope(SAPLING, recipients);
  const lengths = [env.sealEnvelope(SAPLING, recipients), env.sealEnvelope(UA_SHIELDED, recipients), envA, envB].map((ct) => ct.length);
  need(lengths.every((l) => l === 1852), `lengths ${lengths.join(",")} (want all 1852 = 926 bytes)`);
  pass("mr-equal-lengths");
} catch (e) { fail("mr-equal-lengths", e); }

// ---- mr-stanza-swap-refused: swap recipient 0's whole 112-byte stanza between two envelopes to the same set ----
// The swapped stanza's owner unwraps the other envelope's content key and is refused at the key commitment;
// the other two unwrap the right key and are refused by the body (their associated data changed).
try {
  const a = Buffer.from(envA, "hex"), b = Buffer.from(envB, "hex"), off = 18, stanza = 32 + 80;
  const swapped = Buffer.concat([a.subarray(0, off), b.subarray(off, off + stanza), a.subarray(off + stanza)]).toString("hex");
  refused(() => env.openEnvelope(swapped, keys[0].private_hex), "refused: envelope key commitment");
  for (const k of keys.slice(1)) refused(() => env.openEnvelope(swapped, k.private_hex), "refused: envelope body");
  pass("mr-stanza-swap-refused");
} catch (e) { fail("mr-stanza-swap-refused", e); }

// ---- mr-shared-rule-export: the one shared record rule is exported from envelope/ ----
try {
  need(typeof env.envelopeRecordValid === "function", "envelopeRecordValid not exported from envelope/");
  pass("mr-shared-rule-export");
} catch (e) { fail("mr-shared-rule-export", e); }

// ---- corpus builder: a full published auction dir over real tlock ciphertexts and a real quicknet beacon ----
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

const recordCt = {
  good: (d) => env.sealEnvelope(d, recipients),
  "foreign-key": (d) => env.sealEnvelope(d, [attacker.public_hex]), // R's probe
  "foreign-set": (d) => env.sealEnvelope(d, [attacker.public_hex, recipients[1], recipients[2]]),
  "pre-v2": () => randomBytes(572).toString("hex"), // the pre-v2 sealed-box length
  "2of3": (d) => env.sealEnvelope(d, recipients.slice(0, 2)),
};

function buildCorpus(name, { pinned, bids }) {
  const signerKey = generateKeyPairSync("ed25519");
  const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const auction_id = rndHex(32);
  const manifest = {
    version: 1, network: "test", auction_id,
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "envelope repro lot", supply: 5,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: "50000", q_max: 10,
    C_zats: "500000", fee_zats: "0", deposit_addresses: bids.map(() => "utest1" + rndHex(35)),
    drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  };
  if (pinned) manifest.envelope_keys = recipients;
  const packet = schema.signRecord(manifest, signerPem);
  const leaves = [], envelopes = [], owners = [];
  for (const [i, b] of bids.entries()) {
    const ct = recordCt[b.kind](b.destination);
    const owner = env.generateOwnerKey(), nonce_hex = randomBytes(16).toString("hex");
    const commitment = env.settlementCommitment(nonce_hex, ct);
    const plaintext = bid.buildBidPlaintext({ auction_id, price_zats: 10000n + BigInt(i) * 5000n, quantity: 1, nonce_hex, owner_public_hex: owner.public_hex, settlement_commitment_hex: commitment }).toString("hex");
    const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(plaintext, "hex"), maxBuffer: 1 << 20 });
    need(sealed.status === 0, `tle seal ${i}: ${sealed.stderr?.toString().trim()}`);
    const ciphertext_hash = sha256(sealed.stdout);
    owners.push(owner);
    envelopes.push({ ciphertext_hash, envelope_ct: ct, owner_sig: env.signEnvelope(owner, auction_id, ciphertext_hash, ct) });
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
  const dir = path.join(ROOT, "tmp/repro-mr", name);
  const write = (envelopeList) => {
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const doc = { version: 1, auction_id, signer, manifest: packet, state: "CLEARED", receipts: [], frozen, result, opened, envelopes: envelopeList, beacon: { round: beacon.round, signature: beacon.signature, chain_hash: chain } };
    for (const [file, value] of [["auction.json", doc], ["manifest.json", packet], ["frozen.json", frozen], ["result.json", result], ["envelope.json", envelopeList]])
      writeFileSync(path.join(dir, file), schema.jsonBytes(value));
    return doc;
  };
  return { dir, signer, packet, envelopes, owners, write };
}

const verifyRun = (dir, signer, extra = []) => {
  const r = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", dir, "--signer", signer, ...extra], { encoding: "utf8", cwd: ROOT, maxBuffer: 64 << 20 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

// ---- mr-verify: the shipped verifier on a fresh pinned corpus, plus the owner-binding mutations ----
try {
  const c = buildCorpus("good", { pinned: true, bids: [{ kind: "good", destination: SAPLING }, { kind: "good", destination: UA_SHIELDED }, { kind: "good", destination: SAPLING }] });
  c.write(c.envelopes);
  const ok = verifyRun(c.dir, c.signer);
  need(ok.code === 0 && ok.out.includes("OK envelope"), `verify exit ${ok.code}: ${ok.out.slice(0, 300)}`);
  // owner_sig flip: the leaf is never paid to an unauthenticated destination — R7.4 routes it to the exception queue
  c.write(c.envelopes.map((e, i) => (i === 0 ? { ...e, owner_sig: flip(e.owner_sig) } : e)));
  const sig = verifyRun(c.dir, c.signer);
  need(sig.code === 0 && sig.out.includes("WARN invalid envelope 0; refund goes to the exception queue"), `owner_sig flip: exit ${sig.code}: ${sig.out.slice(0, 300)}`);
  // envelope_ct swap between two records (owner_sig still covers the old ct) is caught the same way
  const swapped = c.envelopes.map((e) => ({ ...e }));
  const t = swapped[0].envelope_ct; swapped[0].envelope_ct = swapped[1].envelope_ct; swapped[1].envelope_ct = t;
  c.write(swapped);
  const sw = verifyRun(c.dir, c.signer);
  need(sw.code === 0 && sw.out.includes("WARN invalid envelope 0; refund goes to the exception queue; invalid envelope 1; refund goes to the exception queue"), `ct swap: exit ${sw.code}: ${sw.out.slice(0, 300)}`);
  c.write(c.envelopes);
  pass("mr-verify");
} catch (e) { fail("mr-verify", e); }

// ---- rule probes: published records that break the shared rule must be ERROR envelope ----
const ruleProbe = (id, corpus, want) => {
  try {
    const c = buildCorpus(corpus.name, { pinned: corpus.pinned, bids: [{ kind: corpus.kind, destination: corpus.destination ?? UA_SHIELDED }] });
    c.write(c.envelopes);
    const r = verifyRun(c.dir, c.signer);
    if (want === "ERROR") {
      need(r.code === 1 && r.out.includes("ERROR envelope"), `got exit ${r.code} ${(r.out.match(/OK envelope|ERROR envelope [^\n]*/) ?? ["no envelope line"])[0]}, want ERROR envelope`);
    } else {
      need(r.code === 0 && r.out.includes("OK envelope"), `got exit ${r.code} ${(r.out.match(/OK envelope|ERROR envelope [^\n]*/) ?? ["no envelope line"])[0]}, want OK envelope`);
    }
    pass(id);
  } catch (e) { fail(id, e); }
};
ruleProbe("mr-verify-foreign-key", { name: "foreign-key", pinned: true, kind: "foreign-key" }, "ERROR");
ruleProbe("mr-verify-foreign-set", { name: "foreign-set", pinned: true, kind: "foreign-set" }, "ERROR");
ruleProbe("mr-verify-pre-v2-pinned", { name: "pre-v2-pinned", pinned: true, kind: "pre-v2" }, "ERROR");
ruleProbe("mr-verify-2of3-pinned", { name: "2of3-pinned", pinned: true, kind: "2of3" }, "ERROR");
ruleProbe("mr-verify-pre-v2-unpinned", { name: "pre-v2-unpinned", pinned: false, kind: "pre-v2" }, "OK");

// ---- mr-verify-phase2-4: the Phase 2–4 evidence dirs (pre-v2 records / no envelope_keys) still verify OK ----
try {
  const signerOf = (file, field) => {
    const j = JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
    return field ? j[field] : j.signer;
  };
  const phase2 = verifyRun(path.join(ROOT, "docs/evidence/phase-2/auction"), signerOf("docs/evidence/phase-2/auction/signer.json"), ["--fetch-beacon"]);
  need(phase2.code === 0 && phase2.out.includes("OK envelope"), `phase-2 exit ${phase2.code}: ${phase2.out.slice(0, 300)}`);
  // Phase 3 has no canonical public dir; rebuild one from its recorded artifacts exactly as the R16 corpus was
  // built (manifest/frozen/result/summary + signer.json), with openings re-derived and the beacon fetched fresh.
  const p3 = path.join(ROOT, "tmp/repro-mr/phase3-public");
  rmSync(p3, { recursive: true, force: true }); mkdirSync(p3, { recursive: true });
  for (const f of ["manifest.json", "frozen.json", "result.json", "summary.json"]) copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/main", f), path.join(p3, f));
  copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/signer.json"), path.join(p3, "signer.json"));
  const phase3 = verifyRun(p3, signerOf("docs/evidence/phase-3/settle/signer.json"), ["--fetch-beacon"]);
  need(phase3.code === 0 && phase3.out.includes("OK envelope"), `phase-3 exit ${phase3.code}: ${phase3.out.slice(0, 300)}`);
  const phase4 = verifyRun(path.join(ROOT, "docs/evidence/phase-4/cli"), signerOf("docs/evidence/phase-4/cli/auction.json", "signer"));
  need(phase4.code === 0 && phase4.out.includes("OK envelope"), `phase-4 exit ${phase4.code}: ${phase4.out.slice(0, 300)}`);
  pass("mr-verify-phase2-4");
} catch (e) { fail("mr-verify-phase2-4", e); }

console.log(failures === 0 ? "RESULT PASS all multi-recipient envelope assertions" : `RESULT FAIL ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
