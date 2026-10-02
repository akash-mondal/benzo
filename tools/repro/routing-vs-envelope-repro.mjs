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

// --- run the shipped intake path in PRODUCT mode ---------------------------------------
// Product mode (a product config exists) refuses operator-pinned bidder destinations: those are
// envelope-authenticated (R6). The repro posts the pre-W routing carrying bidders[].refund_ua.
const { generateEnvelopeKey, generateOwnerKey, sealEnvelope, signEnvelope, settlementCommitment } = await import(path.join(TRACKB, "envelope/dist/index.mjs"));
const { envelopeRecipient } = await import(path.join(TRACKB, "settle/dist/envelopes.mjs"));
mkdirSync(path.join(STATE, "auction"), { recursive: true });
mkdirSync(path.join(STATE, "product"), { recursive: true });
writeFileSync(path.join(STATE, "auction", auction_id + ".json"), jsonBytes({ manifest: packet, signer, state: "OPEN", receipts: [] }));
writeFileSync(path.join(STATE, "product", auction_id + ".json"), jsonBytes({ settlement: { signers: ["alice", "bob", "carol"], batch_cap: 13, pczt_expiry_blocks: 364 }, routing: operatorRouting, public_dir: path.join(TRACKB, "tmp/e2e/public") }));
const envelopeKey = generateEnvelopeKey();
writeFileSync(path.join(STATE, "product", auction_id + ".envelope.json"), jsonBytes(envelopeKey));
const r = spawnSync(process.execPath, [path.join(TRACKB, "settle/dist/cli.mjs"), "init", auction_id], { input: JSON.stringify(operatorRouting), encoding: "utf8", cwd: TRACKB });
console.log("settle init exit:", r.status);
console.log("settle init stderr:", (r.stderr || "").trim().split("\n").slice(-1)[0]);
const initRefused = r.status !== 0 && /bidder destinations are envelope-authenticated/.test(r.stderr || "");
console.log("unauthenticated bidder routing refused by init:", initRefused);

// --- settlement bundles open envelopes --------------------------------------------------
const bundles = ["settle/dist/cli.mjs", "settle/dist/plan.mjs", "cli/dist/benzo.mjs"].map((f) => path.join(TRACKB, f));
const hits = bundles.filter((f) => existsSync(f) && /openEnvelope/.test(readFileSync(f, "utf8")));
console.log("\nsettlement bundles containing envelope-opening code:", hits.length ? hits.join(",") : "NONE");

// --- signer boundary: the exact resolution the signer check applies ---------------------
// Real shielded testnet UA (generated once with the pinned benzo-pczt); sealEnvelope enforces the
// shielded-only validator, so the fixture is a genuine envelope, not a hand-rolled stand-in.
const owner = generateOwnerKey();
const nonce = hash("r-repro3-nonce").slice(0, 32);
const envelopeUa = "utest1redacted";
const envelopeCt = sealEnvelope(envelopeUa, [envelopeKey.public_hex]);
const commitment = settlementCommitment(nonce, envelopeCt);
const ciphertextHash = hash("r-repro3-ciphertext");
const pt = Buffer.alloc(128); // docs/PHASE-1.md section 6 layout: nonce@45, owner@61, commitment@93
Buffer.from(nonce, "hex").copy(pt, 45);
Buffer.from(owner.public_hex, "hex").copy(pt, 61);
Buffer.from(commitment, "hex").copy(pt, 93);
const ownerSig = signEnvelope(owner, manifest.auction_id, ciphertextHash, envelopeCt);
const doc = {
  manifest: packet,
  frozen: { leaves: [{ leaf_index: 0, ciphertext_hash: ciphertextHash, deposit: { txid: hash("r-repro3-txid"), pool: "ironwood", address: d1, diversifier_index: "0" } }] },
  opened: [{ leaf_index: 0, plaintext_hex: pt.toString("hex") }],
  envelopes: [{ ciphertext_hash: ciphertextHash, envelope_ct: envelopeCt, owner_sig: ownerSig }],
};
const substituted = "utest1" + hash("r-repro3-operator-theft-ua").slice(0, 50);

const derived = envelopeRecipient(doc, 0, envelopeKey.private_hex, substituted);
console.log("\nenvelope-derived destination:", derived);
console.log("coordinator-pinned substitute:", substituted);
const envelopeWins = derived === envelopeUa && derived !== substituted;
const missing = envelopeRecipient({ ...doc, envelopes: [] }, 0, envelopeKey.private_hex, substituted);
console.log("missing envelope resolves to:", missing);
const refusedWhenMissing = missing === null;

if (envelopeWins && refusedWhenMissing && initRefused && hits.length > 0) {
  console.log("\nF3 FIXED: init refuses unauthenticated bidder routing, and signers derive destinations only from owner-signed envelopes, refusing any output when the envelope is missing.");
} else {
  if (missing !== null) console.log("ERROR 5M2 signer accepts a recipient when the envelope is missing");
  if (!envelopeWins) console.log("ERROR W2 envelope destination did not win over the coordinator substitute");
  if (!initRefused) console.log("ERROR F3 init accepted unauthenticated bidder routing");
  if (!hits.length) console.log("ERROR F3 settlement bundles cannot open envelopes");
  process.exit(1);
}
