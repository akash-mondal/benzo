// R26 item 3 repro (Reviewer R F5) — `benzo verify` reports ERROR when the opened/beacon/receipts/summary
// projection files diverge from the canonical auction.json, and passes when they agree.
//
// Checks (each prints one PASS/ERROR <id> line; exit 0 only if all PASS):
//   r26-3-projections-match            all four projections byte-identical to the document -> OK projection
//   r26-3-opened-diverges              opened.json differs -> ERROR projection refused: opened.json projection differs
//   r26-3-beacon-diverges              beacon.json differs -> ERROR projection refused: beacon.json projection differs
//   r26-3-receipts-diverges            receipts.json differs -> ERROR projection refused: receipts.json projection differs
//   r26-3-summary-diverges             summary.json differs -> ERROR projection refused: summary.json projection differs
//   r26-3-projection-without-field     summary.json present with no document settlement -> ERROR
//                                      projection refused: summary.json projection without document field
//
// The corpus is BUILT by this run: fresh signer key, fresh 128-byte bids tlock-sealed with the pinned Go
// tle to a past drand quicknet round, the published beacon fetched from drand at run time, a real merkle
// freeze tree, the shipped clearing recomputed by the shipped verifier. Only the projection files are then
// tampered with — exactly the divergence an untrusted publisher could introduce beside an honest auction.json.
//
// Usage: node tools/repro/r26-3-projection-repro.mjs
// Needs: npm ci; tools/bootstrap.sh (pinned Go tle in $BNZ_STATE_DIR/bin); network to drand quicknet.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString().trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tools/repro/r26-3-projection-repro.mjs");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

// Build what the checks drive from this working tree: the shipped CLI and the modules under test.
execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(path.join(ROOT, "tmp/repro-r26-3-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as merkle from "../clear/merkle";',
  'export * as core from "../clear/core";',
  'export * as env from "../envelope/index";',
  'export * as bid from "../envelope/bid";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r26-3-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r26-3-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const { schema, merkle, core, env, bid } = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r26-3-lib.mjs")).href);

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, e) => { failures++; console.log(`ERROR ${id} ${e instanceof Error ? e.message : String(e)}`); };
const need = (ok, why) => { if (!ok) throw new Error(why); };

// ---- one fresh two-bid corpus over real tlock ciphertexts (the r15 corpus shape, unpinned pre-W manifest) ----
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
const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const auction_id = rndHex(32);
const manifest = {
  version: 1, network: "test", auction_id,
  escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r26-3 repro lot", supply: 1,
  reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
  C_zats: C.toString(), fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35)],
  drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
};
const packet = schema.signRecord(manifest, signerPem);
const leaves = [];
for (const [i, price] of [C, 1000n].entries()) {
  const nonce_hex = randomBytes(16).toString("hex");
  const owner = env.generateOwnerKey();
  const plaintext = bid.buildBidPlaintext({ auction_id, price_zats: price, quantity: 1, nonce_hex, owner_public_hex: owner.public_hex, settlement_commitment_hex: env.settlementCommitment(nonce_hex, "") }).toString("hex");
  const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(plaintext, "hex"), maxBuffer: 1 << 20 });
  need(sealed.status === 0, `tle seal ${i}: ${sealed.stderr?.toString().trim()}`);
  leaves.push({ auction_id, manifest_hash: packet.sha256, ciphertext_hash: sha256(sealed.stdout), deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[i], diversifier_index: String(i) }, leaf_index: i, ciphertext_hex: sealed.stdout.toString("hex") });
}
const { root, paths } = merkle.tree(leaves);
const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: T_freeze, published_at, leaves, paths };
const opened = leaves.map((l) => {
  const r = spawnSync(TLE, ["-d", "-c", chain], { input: Buffer.from(l.ciphertext_hex, "hex"), maxBuffer: 1 << 20 });
  need(r.status === 0, `tle open ${l.leaf_index}: ${r.stderr?.toString().trim()}`);
  return { leaf_index: l.leaf_index, plaintext_hex: r.stdout.toString("hex") };
});
const result = core.clear({ manifest: packet, signer, frozen, opened });
const strayParty = `deposit:${rndHex(32)}:0`;
const settlement = {
  rows: [
    { party: "seller", amount_zats: C.toString(), state: "exception" },
    { party: "leaf:1", amount_zats: C.toString(), state: "exception" },
    { party: strayParty, amount_zats: "250000", state: "refunded" },
  ],
  receipts: [{ auction_id, party: strayParty, txid: rndHex(32), pool: "ironwood", output_index: 0, amount_zats: "250000" }],
};
const beaconField = { round: beacon.round, signature: beacon.signature, chain_hash: chain };
const doc = { version: 1, auction_id, signer, manifest: packet, state: "CLEARED", receipts: [], frozen, result, opened, envelopes: [], beacon: beaconField, settlement };

const dir = path.join(ROOT, "tmp/repro-r26-3/public");
rmSync(path.join(ROOT, "tmp/repro-r26-3"), { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const write = (name, value) => writeFileSync(path.join(dir, name), schema.jsonBytes(value));
write("auction.json", doc);
write("manifest.json", packet);
write("frozen.json", frozen);
write("result.json", result);
write("opened.json", opened);
write("beacon.json", beaconField);
write("receipts.json", doc.receipts);
write("summary.json", settlement);

const verifyRun = () => {
  const r = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", dir, "--signer", signer], { encoding: "utf8", cwd: ROOT, maxBuffer: 64 << 20 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const tamper = (name, value) => write(name, value);
const restoreAll = () => { write("opened.json", opened); write("beacon.json", beaconField); write("receipts.json", doc.receipts); write("summary.json", settlement); write("auction.json", doc); };

// ---- r26-3-projections-match: byte-identical projections verify clean ----
try {
  restoreAll();
  const r = verifyRun();
  need(r.code === 0 && r.out.includes("OK projection") && !r.out.includes("ERROR projection"),
    `got exit ${r.code}: ${(r.out.match(/ERROR [^\n]*/g) ?? ["no OK projection"]).join(" | ")}`);
  pass("r26-3-projections-match");
} catch (e) { fail("r26-3-projections-match", e); }

// ---- one divergence per projection file: the ERROR must name the diverging file ----
const diverge = (id, name, mutate) => {
  try {
    restoreAll();
    mutate();
    const r = verifyRun();
    const expected = `ERROR projection refused: ${name} projection differs`;
    need(r.code === 1 && r.out.includes(expected), `got exit ${r.code}, expected \`${expected}\`: ${(r.out.match(/ERROR [^\n]*/g) ?? ["no ERROR line"]).join(" | ")}`);
    pass(id);
  } catch (e) { fail(id, e); } finally { restoreAll(); }
};
diverge("r26-3-opened-diverges", "opened.json", () => tamper("opened.json", [...opened, { leaf_index: 9, plaintext_hex: "00".repeat(128) }]));
diverge("r26-3-beacon-diverges", "beacon.json", () => tamper("beacon.json", { ...beaconField, signature: beaconField.signature.replace(/^./, (c) => (c === "a" ? "b" : "a")) }));
diverge("r26-3-receipts-diverges", "receipts.json", () => tamper("receipts.json", [{ auction_id, party: strayParty, txid: rndHex(32), pool: "ironwood", output_index: 0, amount_zats: "250000" }]));
diverge("r26-3-summary-diverges", "summary.json", () => tamper("summary.json", { ...settlement, rows: settlement.rows.slice(0, 2) }));

// ---- r26-3-projection-without-field: a projection whose field the document does not carry is refused ----
try {
  restoreAll();
  const { settlement: _drop, ...withoutSettlement } = doc;
  write("auction.json", withoutSettlement);
  const r = verifyRun();
  const expected = "ERROR projection refused: summary.json projection without document field";
  need(r.code === 1 && r.out.includes(expected), `got exit ${r.code}, expected \`${expected}\`: ${(r.out.match(/ERROR [^\n]*/g) ?? ["no ERROR line"]).join(" | ")}`);
  pass("r26-3-projection-without-field");
} catch (e) { fail("r26-3-projection-without-field", e); } finally { restoreAll(); }

console.log(failures === 0 ? "RESULT PASS all r26-3 projection divergence assertions" : `RESULT FAIL ${failures}`);
process.exit(failures === 0 ? 0 : 1);
