// R33 item 3 (Reviewer R P1-3) proof: `settlement.defaults` is bound to the signer hosts' signed G-4 maps.
// The reviewer's equal-balance swap — two winners both owe 300,000, leaf 0 defaults and leaf 1 pays, but the
// coordinator publishes `defaults: [1]` — leaves obligations, rows and receipts byte-identical (the reviewer's
// repro proved `obligationsModeA` cannot tell the two lists apart), so only the host-signature binding can
// refuse it. This repro builds one settled bond auction through the shipped primitives (real quicknet beacon +
// tlock ciphertexts, the shipped pure clear, merkle tree, receipts, witness certificates and G-4 maps — the
// g-forged-claim fixture recipe), then drives the SHIPPED `benzo verify` twice:
//   true  — settlement.defaults [0] equals the list in two verified maps from distinct pinned signers: PASS,
//           every check OK including `OK defaults`;
//   swap  — the coordinator's forged [1], same published maps: verify refuses with the specific
//           `ERROR defaults refused: settlement defaults differ from the host-signed approval maps` — while
//           `OK accounting` still passes on the forged copy, showing exactly what the binding adds.
// Chain data is fixture (the corpus is built offline, like the reviewer's lab repros); every signature, tlock
// ciphertext and check is real and every value is recomputed by the shipped code under test.
// Run: npx esbuild tools/repro/r33-defaults.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r33-defaults.mjs && node tmp/r33-defaults.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { timelockEncrypt } from "tlock-js";
import { hash, jsonBytes, signRecord, QUICKNET } from "../../manifest/schema";
import { tree, type Deposit, type Leaf } from "../../clear/merkle";
import { clearForMode } from "../../clear/registry";
import { obligationsModeA } from "../../clear/core";
import { freezeStatement, signApprovalMap, signStatement, validateWitnessSet, witnessSetHash, type WitnessSet } from "../../witness";
import { publishedClient } from "../../cli/published-beacon";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r33-defaults.mjs (tools/repro/r33-defaults.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });

// ---- fixture manifest: a uniform bond auction, C = the 2000 bps bond of the 1,000,000 cap -------------
const beacon = JSON.parse(readFileSync(path.join(ROOT, "docs/evidence/phase-4/cli/beacon.json"), "utf8")); // real quicknet beacon
const local = publishedClient(beacon);
const auctionId = randomBytes(32).toString("hex");
const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex"); // the manifest signer's SPKI-DER key bytes (88 hex)
const edRaw = (k: any) => ({
  private_hex: k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"),
  public_hex: k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
});
const W = [edRaw(generateKeyPairSync("ed25519")), edRaw(generateKeyPairSync("ed25519")), edRaw(generateKeyPairSync("ed25519"))];
const witnessSet = signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: W.map(w => w.public_hex) }, signerPem);
const release = QUICKNET.genesis + (beacon.round - 1) * QUICKNET.period;
const ua = (tag: string) => "utest1r33fixture" + createHash("sha256").update(tag).digest("hex").slice(0, 40);
const depositsUa = [0, 1, 2].map(i => ua(`deposit${i}`)), balanceUa = [0, 1, 2].map(i => ua(`balance${i}`));
const manifest = {
  version: 1, network: "test", auction_id: auctionId, escrow_ua: ua("escrow"), frost_group_key: randomBytes(32).toString("hex"),
  lot: "r33-defaults fixture round", supply: 2, reserve_zats: "10", tick_zats: "10", B_max_zats: "1000000",
  q_max: 1, C_zats: "200000", fee_zats: "0", deposit_addresses: depositsUa,
  bond: { bond_bps: 2000, balance_window_blocks: 50, balance_window_start_height: 5_000_000, balance_addresses: balanceUa },
  drand: { ...QUICKNET, R: beacon.round }, T_submit: release - 1600, T_freeze: release - 800, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  witness_set_hash: hash(jsonBytes(witnessSet)),
};
const packet = signRecord(manifest, signerPem);

// ---- three sealed orders (LAYOUT_V0): two equal winners at 500,000 (each owes a 300,000 balance), one loser ----
const order = (price: number, ownerHex: string): Buffer => {
  const pt = Buffer.alloc(128);
  pt[0] = 0;
  Buffer.from(auctionId, "hex").copy(pt, 1);
  pt.writeBigUInt64BE(BigInt(price), 33);
  pt.writeUInt32BE(1, 41);
  Buffer.from(ownerHex, "hex").copy(pt, 61);
  return pt;
};
const owners = [0, 1, 2].map(() => edRaw(generateKeyPairSync("ed25519")).public_hex);
const prices = [500_000, 500_000, 400_000];
const leaves: Leaf[] = [];
const opened: { leaf_index: number; plaintext_hex: string }[] = [];
for (let i = 0; i < 3; i++) {
  const pt = order(prices[i], owners[i]);
  const armored = await timelockEncrypt(beacon.round, pt, local);
  const ctHex = Buffer.from(armored.split("\n").filter(l => l && !l.startsWith("-----")).join(""), "base64").toString("hex");
  const deposit: Deposit = { txid: createHash("sha256").update(`r33-deposit-${i}`).digest("hex"), pool: "ironwood", address: depositsUa[i], diversifier_index: String(i) };
  leaves.push({ auction_id: auctionId, manifest_hash: packet.sha256, ciphertext_hash: hash(Buffer.from(ctHex, "hex")), deposit, leaf_index: i, ciphertext_hex: ctHex });
  opened.push({ leaf_index: i, plaintext_hex: pt.toString("hex") });
}
const { root, paths } = tree(leaves);
const frozen = { auction_id: auctionId, manifest_hash: packet.sha256, root, leaf_count: 3, cutoff: manifest.T_freeze, published_at: manifest.T_freeze - 10, leaves, paths };

// ---- the shipped pure clear decides the result; the receipt shape follows its obligations (truth: defaults [0]) ----
const result = clearForMode({ manifest: packet, signer, frozen, opened: opened as any, reserve_opening: null, serial_beacon: null });
const truth: number[] = [0];
const obligations = obligationsModeA(result as any, { defaults: truth });
const settlementRows = [...obligations].map(([party, amount_zats]) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats, state: "paid" }));
const receipts = [...obligations].map(([party, amount_zats], i) => ({ auction_id: auctionId, party, txid: createHash("sha256").update(`r33-settle-${party}`).digest("hex"), pool: "ironwood", output_index: i, amount_zats }));

// ---- the signer hosts' G-4 maps carry the defaults list they derived (here: the truth) -----------------
const maps = [0, 1].map(i => signApprovalMap({ auction_id: auctionId, batch: 1, txid: receipts[0].txid, outputs: [{ party: "leaf:2", output_index: 0 }, { party: "seller", output_index: 1 }], defaults: truth }, W[i].private_hex));
const statement = freezeStatement(manifest as any, frozen);

// ---- assemble the published directory exactly as the product publishes it ------------------------------
const doc: any = {
  version: 1, auction_id: auctionId, signer, manifest: packet, state: "SETTLED", receipts: leaves.map(l => signRecord({ auction_id: auctionId, manifest_hash: packet.sha256, ciphertext_hash: l.ciphertext_hash, deposit: l.deposit, leaf_index: l.leaf_index }, signerPem)),
  frozen, result, opened, beacon,
  witness_set: witnessSet, witness_cert: [{ statement, signatures: [signStatement(statement, W[0].private_hex), signStatement(statement, W[1].private_hex)] }],
  settlement: { rows: settlementRows, receipts, offline_signer: "carol", ignored: [], defaults: truth, approval_maps: maps },
};
const writeDir = (dir: string, settlement: typeof doc.settlement) => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const d = { ...doc, settlement };
  for (const [name, value] of [["auction.json", d], ["manifest.json", packet], ["frozen.json", frozen], ["result.json", result], ["opened.json", opened], ["beacon.json", beacon], ["receipts.json", doc.receipts], ["witness-set.json", witnessSet], ["witness.json", doc.witness_cert], ["summary.json", settlement]] as const)
    writeFileSync(path.join(dir, name), jsonBytes(value));
};
const verify = (dir: string) => spawnSync(process.execPath, [path.join(ROOT, "cli/dist/benzo.mjs"), "verify", "--dir", dir, "--signer", signer], { encoding: "utf8", maxBuffer: 64 << 20 });

// 1. The true list passes the shipped verifier: every check OK, including `OK defaults`.
const trueDir = path.join(ROOT, "tmp/r33-defaults/true");
writeDir(trueDir, doc.settlement);
const t = verify(trueDir);
const tOut = t.stdout + t.stderr;
console.log(tOut.trim().split("\n").filter(l => /OK |ERROR |WARN /.test(l)).join("\n"));
const okTrue = t.status === 0 && /OK defaults/.test(tOut);
console.log(okTrue ? "PASS r33-defaults-true-list (settlement.defaults equals two host-signed maps)" : `FAIL r33-defaults-true-list exit ${t.status}`);
console.log(`derivations winners owe: ${JSON.stringify(result.allocations.map((a: any) => [a.leaf_index, a.fill, a.balance_due_zats ?? "0"]))}`);

// 2. The reviewer's equal-balance swap: the coordinator publishes defaults [1]; obligations, rows and receipts
//    are unchanged (same balance total) — `OK accounting` still passes — and only the maps binding refuses it.
const forged = { ...doc.settlement, defaults: [1] };
const forgedDir = path.join(ROOT, "tmp/r33-defaults/forged");
writeDir(forgedDir, forged);
const f = verify(forgedDir);
const fOut = f.stdout + f.stderr;
console.log(fOut.trim().split("\n").filter(l => /defaults|accounting|ERROR /.test(l)).join("\n"));
const swapRefused = f.status !== 0 && /ERROR defaults refused: settlement defaults differ from the host-signed approval maps/.test(fOut);
console.log(swapRefused ? "PASS r33-defaults-swap-refused (coordinator-swapped list refused with its own ERROR)" : `FAIL r33-defaults-swap-refused exit ${f.status}`);
const swapInvisible = /OK accounting/.test(fOut);
console.log(swapInvisible ? "PASS r33-defaults-swap-invisible-to-accounting (obligations/rows/receipts cannot tell the lists apart)" : "FAIL r33-defaults-swap-invisible-to-accounting");

const all = okTrue && swapRefused && swapInvisible;
console.log(all ? "RESULT PASS r33-defaults" : "RESULT FAIL r33-defaults");
process.exitCode = all ? 0 : 1;
