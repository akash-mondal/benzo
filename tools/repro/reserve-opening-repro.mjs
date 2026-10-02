// Reviewer R repro — unauthenticated reserve_opening steers signer-side clearing (r-02 finding F2).
// Builds a signed uniform manifest with a tlock-sealed price bound (manifest.sealed_reserve), a
// frozen set of 3 orders, then runs the shipped pure clearing CLI (clear/dist/cli.mjs — exactly
// what settle/plan.ts invokes on the signer) with two different reserve_opening plaintexts.
// Both runs succeed and both results satisfy the only property plan.ts checks
// ("fresh signer clearing equals published result"). Nothing binds the opening to
// manifest.sealed_reserve; only cli/commands/verify.ts:82-85 decrypts that ciphertext.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
// source: benzo-sol/tests/reserve-opening-repro.mjs (Reviewer R F2), retargeted at this checkout.
const TRACKB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
const jsonBytes = (v) => Buffer.from(canonical(v) + "\n");
const QUICKNET = {
  chain_hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  public_key: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  scheme: "bls-unchained-g1-rfc9380", genesis: 1692803367, period: 3,
};
// signRecord / verifyRecord clone (manifest/schema.ts:116-132): Ed25519 over canonical JSON bytes.
const kp = (() => {
  const raw = Buffer.from(hash("r-repro-signing-key"), "hex");
  const priv = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw]), type: "pkcs8", format: "der" });
  return { priv, pub: createPublicKey(priv).export({ type: "spki", format: "der" }).toString("hex") };
})();
const signRecord = (value) => {
  const bytes = jsonBytes(value);
  return { bytes: bytes.toString("base64"), sha256: hash(bytes), signer: kp.pub, signature: sign(null, bytes, kp.priv).toString("hex") };
};

// ---- manifest: uniform, sealed price bound present -------------------------------
const R = 32704232; // fixed past quicknet round (same one tools/bench.ts uses)
const release = QUICKNET.genesis + (R - 1) * QUICKNET.period;
const auction_id = hash("r-repro-auction");
const address = "utest1" + hash("r-repro-deposit").slice(0, 50);
const manifest = {
  version: 1, network: "test", auction_id, escrow_ua: address, frost_group_key: hash("r-repro-group"),
  lot: "reserve opening repro", supply: 2, reserve_zats: "1000", tick_zats: "1000",
  B_max_zats: "100000", q_max: 2, C_zats: "1000100", fee_zats: "100", deposit_addresses: [address],
  drand: { ...QUICKNET, R }, T_submit: release - 1000, T_freeze: release - 200, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  // tlock ciphertext of the sealed price bound; validateManifest only checks shape (hex, 96..4096).
  sealed_reserve: "ab".repeat(200),
};
const packet = signRecord(manifest);

// ---- three frozen orders: prices 5000 / 4000 / 3000, qty 1 each --------------------
const mkOrder = (i, price) => {
  const pt = Buffer.alloc(128);
  Buffer.from(auction_id, "hex").copy(pt, 1);
  pt.writeBigUInt64BE(BigInt(price), 33); pt.writeUInt32BE(1, 41);
  Buffer.from(hash("nonce:" + i), "hex").subarray(0, 16).copy(pt, 45);
  Buffer.from(hash("owner:" + i), "hex").copy(pt, 61);
  Buffer.from(hash("commit:" + i), "hex").copy(pt, 93);
  return pt;
};
// merkle_root_v1 clone of clear/merkle.ts: leaf SHA256(00 || ctHash || canonical deposit JSON),
// parent SHA256(01 || left || right), odd last node duplicated. A pass proves the frozen block is
// well-formed under the shipped checkFrozen.
const leafHash = (ctHash, deposit) => hash(Buffer.concat([Buffer.from([0]), Buffer.from(ctHash, "hex"), jsonBytes(deposit)]));
const parent = (l, r) => hash(Buffer.concat([Buffer.from([1]), Buffer.from(l, "hex"), Buffer.from(r, "hex")]));
const tree = (leaves) => {
  const levels = [leaves.map((l) => leafHash(l.ciphertext_hash, l.deposit))];
  while (levels.at(-1).length > 1) {
    const level = levels.at(-1), next = [];
    for (let i = 0; i < level.length; i += 2) next.push(parent(level[i], level[i + 1] ?? level[i]));
    levels.push(next);
  }
  return levels.at(-1)[0];
};
const leaves = [5000, 4000, 3000].map((price, i) => {
  const ciphertext_hex = mkOrder(i, price).toString("hex"); // order bytes stand in for the tle ciphertext
  return {
    auction_id, manifest_hash: packet.sha256, leaf_index: i, ciphertext_hash: hash(Buffer.from(ciphertext_hex, "hex")), ciphertext_hex,
    deposit: { txid: hash("txid:" + i), pool: "ironwood", address, diversifier_index: String(i) },
  };
});
const frozen = { auction_id, manifest_hash: packet.sha256, root: tree(leaves), paths: [], leaf_count: 3, cutoff: manifest.T_freeze, published_at: manifest.T_freeze - 100, leaves };
const opened = leaves.map((l, i) => ({ leaf_index: i, plaintext_hex: l.ciphertext_hex }));

// ---- the sealed price bound: true opening 3500 vs coordinator-forged 4500 ---------
const opening = (price) => {
  const pt = Buffer.alloc(40);
  pt.writeBigUInt64BE(BigInt(price), 0);
  Buffer.from(auction_id, "hex").copy(pt, 8); // readReserve binds only auction_id + tick divisibility
  return pt.toString("hex");
};

const clear = (reserve_opening) => {
  const r = spawnSync(process.execPath, [path.join(TRACKB, "clear/dist/cli.mjs")],
    { input: JSON.stringify({ manifest: packet, signer: kp.pub, frozen, opened, reserve_opening }), encoding: "utf8" });
  if (r.status !== 0) throw new Error(`clear failed: ${(r.stderr || r.stdout).slice(-300)}`);
  return JSON.parse(r.stdout);
};

const trueResult = clear(opening(2000));    // what the sealed ciphertext actually decrypts to
const forgedResult = clear(opening(5000));  // coordinator's substitute (would decrypt differently)

const summary = (r) => r.allocations.map((a) => `leaf${a.leaf_index}:${a.outcome}:pay=${a.payment_zats}:refund=${a.refund_zats}`).join(" ") + ` clearing=${r.clearing_price_zats}`;
console.log("true   reserve opening (2000) ->", summary(trueResult));
console.log("forged reserve opening (5000) ->", summary(forgedResult));
const differs = canonical(trueResult) !== canonical(forgedResult);
console.log("\nresults differ:", differs);
if (!differs) { console.error("REGRESSION: forged opening did not change the result"); process.exit(1); }

// ---- signer boundary (R6 fix): the exact shared check settle/plan.ts applies before any signature.
// plan.ts derives the opening from manifest.sealed_reserve with the pinned Go tle and passes it to
// requireReserveOpening together with the coordinator's published opening; a mismatch is refused
// before the clearing is even computed, so no batch row and no signature can come from it.
const { requireReserveOpening } = await import(path.join(TRACKB, "manifest/dist/reserve.mjs"));
const trueOpening = opening(2000), forgedOpening = opening(5000);
let refused = null;
try { requireReserveOpening(manifest, forgedOpening, trueOpening); } catch (e) { refused = e.message; }
if (refused === null) {
  console.log("\nERROR U7 forged reserve opening accepted by the signer-side binding");
  process.exit(1);
}
console.log(`\nsigner-side binding refuses the forged opening: ${refused}`);
requireReserveOpening(manifest, trueOpening, trueOpening);
console.log("F2 FIXED: the signer re-derives the sealed reserve and refuses a forged published opening before any signature.");
