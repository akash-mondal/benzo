// Reviewer R repro — coordinator-supplied routing reaches settlement while the owner-signed
// envelope is never consulted (r-02 finding F3, lead 3).
//
// Demonstrates the first half end-to-end with the shipped code: `settle/dist/cli.mjs init`
// (exactly what `cli/product.ts auction publish` calls with the operator's private config)
// pins a routing table whose refund destinations differ from the bidder's owner-signed
// envelope, and no envelope input is even accepted. The second half is proven by bundle
// grep: no shipped settlement artifact contains any envelope-opening code (openEnvelope is
// dead code in envelope/index.ts), so `destinations()` in settle/cli.ts — routing files only —
// is the sole source of every PCZT recipient the signers approve.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// source: benzo-sol/tests/routing-vs-envelope-repro.mjs (Reviewer R F3), retargeted at this checkout.
const TRACKB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATE = path.join(TRACKB, ".benzo");
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
const raw = Buffer.from(hash("r-repro3-signing-key"), "hex");
const priv = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw]), type: "pkcs8", format: "der" });
const signer = createPublicKey(priv).export({ type: "spki", format: "der" }).toString("hex");
const signRecord = (value) => {
  const bytes = jsonBytes(value);
  return { bytes: bytes.toString("base64"), sha256: hash(bytes), signer, signature: sign(null, bytes, priv).toString("hex") };
};

const R = 32704232, release = QUICKNET.genesis + (R - 1) * QUICKNET.period;
const auction_id = hash("r-repro3-auction:" + Date.now()); // fresh per run: init pins routing once per auction
const d1 = "utest1" + hash("r-repro3-deposit1").slice(0, 50), d2 = "utest1" + hash("r-repro3-deposit2").slice(0, 50);
const manifest = {
  version: 1, network: "test", auction_id, escrow_ua: "utest1" + hash("r-repro3-escrow").slice(0, 50), frost_group_key: hash("r-repro3-group"),
  lot: "routing repro", supply: 2, reserve_zats: "1000", tick_zats: "1000",
  B_max_zats: "100000", q_max: 2, C_zats: "1000100", fee_zats: "100", deposit_addresses: [d1, d2],
  drand: { ...QUICKNET, R }, T_submit: release - 1000, T_freeze: release - 200, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
};
const packet = signRecord(manifest);

// --- what the bidder actually signed -------------------------------------------------
// The bidder's refund destination travels only inside the owner-signed settlement envelope
// (docs/design/phase6-docs.md:15). Simulate it as the artifact it is: a sealed, owner-signed
// destination. Settlement never receives it — see the grep proof below.
const envelopeDestination = "utest1" + hash("r-repro3-victim-refund-ua").slice(0, 50); // the bidder's signed refund_ua
const operatorRouting = {
  bidders: [
    { deposit_ua: d1, refund_ua: "utest1" + hash("r-repro3-operator-theft-ua").slice(0, 50) }, // != envelope destination
    { deposit_ua: d2, refund_ua: "utest1" + hash("r-repro3-operator-other-ua").slice(0, 50) },
  ],
  seller_ua: "utest1" + hash("r-repro3-operator-seller-ua").slice(0, 50),
  fee_reserve_ua: "utest1" + hash("r-repro3-operator-reserve-ua").slice(0, 50),
};

// --- run the shipped intake path ------------------------------------------------------
mkdirSync(path.join(STATE, "auction"), { recursive: true });
writeFileSync(path.join(STATE, "auction", auction_id + ".json"), jsonBytes({ manifest: packet, signer, state: "OPEN", receipts: [] }));
const r = spawnSync(process.execPath, [path.join(TRACKB, "settle/dist/cli.mjs"), "init", auction_id], { input: JSON.stringify(operatorRouting), encoding: "utf8", cwd: TRACKB });
console.log("settle init exit:", r.status);
console.log("settle init stdout:", (r.stdout || "").trim());
if (r.status !== 0) { console.error("init refused:", (r.stderr || "").trim()); process.exit(1); }

const pinned = JSON.parse(readFileSync(path.join(STATE, "settle", auction_id, "routing-alice.json"), "utf8"));
const mismatch = pinned.bidders[0].refund_ua !== envelopeDestination;
console.log("\npinned routing bidders[0].refund_ua:", pinned.bidders[0].refund_ua);
console.log("bidder's owner-signed envelope destination:", envelopeDestination);
console.log("mismatch accepted by init:", mismatch);
console.log("routing files written for signers:", ["alice", "bob", "carol"].map((n) => existsSync(path.join(STATE, "settle", auction_id, `routing-${n}.json`))).join(","));

// --- second half: no settlement artifact can even open an envelope --------------------
const bundles = ["settle/dist/cli.mjs", "settle/dist/plan.mjs", "cli/dist/benzo.mjs"].map((f) => path.join(TRACKB, f));
const hits = bundles.filter((f) => existsSync(f) && /openEnvelope/.test(readFileSync(f, "utf8")));
console.log("\nsettlement bundles containing any envelope-opening code:", hits.length === 0 ? "NONE" : hits.join(","));
if (mismatch && hits.length === 0)
  console.log("\nF3 CONFIRMED: init pinned operator routing that contradicts the owner-signed envelope, and no settlement code path can open/compare envelopes.");
else { console.error("REGRESSION: expected mismatch with zero envelope-opening code"); process.exit(1); }
