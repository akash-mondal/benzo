// Ruling R44 item 4 (Reviewer R F19, `benzo-sol/reports/pr-a20-r42.md`): the `defaults` tie-break is
// deterministic and enforced by verify. Under drift (two host-attested lists, each carried by two witnesses of
// different batches) publish uses the list attested by the maps of the EARLIEST paying batch whose two maps
// agree, and verify applies the same rule — never witness counts then key hex (the old publish pick), and
// never "any attested list" (the old verify acceptance).
// 1. Which behavior does it protect: settlement defaults attribution (R33 P1-3's binding, DESIGN §6 bond
//    rules) — which leaf defaulted must be the one the earliest paying batch's hosts attested, so the
//    published "which leaf defaulted" can never be the wrong one of two host-attested lists.
// 2. Which credible regression makes it fail: the old tie-break — publish picks the list with MORE witnesses
//    (then key hex), so a LATER batch's drifted list wins; and verify accepts either attested list, so the
//    wrong-attributed defaults pass verification (money moves identically — the R33 equal-balance swap).
// 3. Why no existing test catches it: r33-defaults drives one batch and one list (its swap forgeries are
//    UNATTESTED lists); nothing drove two attested lists across batches — the drift case F19 names.
// 4. Production seam: none — this drives the shipped `publish()` (cli/product.ts) and the shipped
//    `benzo verify` (cli/dist), both at their real boundaries.
// Assertions (the pre-F19 tree turns the starred two red):
//   f19-verify-earliest-list-ok        *verify passes the earliest agreeing batch's list (OK defaults) — the
//                                      rule accepts the right list (control: green before and after);
//   f19-verify-refuses-later-list      *verify refuses a DIFFERENT attested list (the later batch's, carried
//                                      by three witnesses) with its own ERROR — never "any attested list";
//   f19-publish-earliest-agreeing-batch *publish() publishes the earliest agreeing batch's list, not the
//                                      witness-count winner of the drifted later batch.
// Run: npx esbuild tools/repro/r44-f19.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r44-f19.mjs && BNZ_STATE_DIR=tmp/r44-f19-state node tmp/r44-f19.mjs [verify-bundle.mjs]
import { execFileSync, spawnSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { timelockEncrypt } from "tlock-js";
import { hash, jsonBytes, signRecord, QUICKNET } from "../../manifest/schema";
import { tree, type Deposit, type Leaf } from "../../clear/merkle";
import { clearForMode } from "../../clear/registry";
import { obligationsModeA } from "../../clear/core";
import { freezeStatement, signApprovalMap, signStatement, validateWitnessSet, witnessSetHash, type WitnessSet } from "../../witness";
import { publishedClient } from "../../cli/published-beacon";
import { publish } from "../../cli/product";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r44-f19.mjs (tools/repro/r44-f19.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

// This driver rmSync's its state dir at startup and publish() resolves the same path from BNZ_STATE_DIR —
// the R43 guard refuses the real one (tools/repro/scratch.ts).
const state = assertScratch(process.env.BNZ_STATE_DIR ?? "tmp/r44-f19-state");
rmSync(state, { recursive: true, force: true });
const publicDir = assertScratch(path.join(ROOT, "tmp/r44-f19-public"));
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(state, { recursive: true }); mkdirSync(publicDir, { recursive: true });

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};

// ---- fixture (the r33-defaults recipe): a uniform bond auction; truth defaults [0]; equal winners ----
const beacon = JSON.parse(readFileSync(path.join(ROOT, "docs/evidence/phase-4/cli/beacon.json"), "utf8")); // real quicknet beacon
const local = publishedClient(beacon);
const auctionId = randomBytes(32).toString("hex");
const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const edRaw = (k: any) => ({
  private_hex: k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"),
  public_hex: k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
});
const W = [edRaw(generateKeyPairSync("ed25519")), edRaw(generateKeyPairSync("ed25519")), edRaw(generateKeyPairSync("ed25519"))];
const witnessSet = signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: W.map(w => w.public_hex) }, signerPem);
const release = QUICKNET.genesis + (beacon.round - 1) * QUICKNET.period;
const ua = (tag: string) => "utest1r44fixture" + createHash("sha256").update(tag).digest("hex").slice(0, 40);
const depositsUa = [0, 1, 2].map(i => ua(`deposit${i}`)), balanceUa = [0, 1, 2].map(i => ua(`balance${i}`));
const manifest = {
  version: 1, network: "test", auction_id: auctionId, escrow_ua: ua("escrow"), frost_group_key: randomBytes(32).toString("hex"),
  lot: "r44-f19 fixture round", supply: 2, reserve_zats: "10", tick_zats: "10", B_max_zats: "1000000",
  q_max: 1, C_zats: "200000", fee_zats: "0", deposit_addresses: depositsUa,
  bond: { bond_bps: 2000, balance_window_blocks: 50, balance_window_start_height: 5_000_000, balance_addresses: balanceUa },
  drand: { ...QUICKNET, R: beacon.round }, T_submit: release - 1600, T_freeze: release - 800, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  witness_set_hash: hash(jsonBytes(witnessSet)),
};
const packet = signRecord(manifest, signerPem);
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
  const deposit: Deposit = { txid: createHash("sha256").update(`r44-deposit-${i}`).digest("hex"), pool: "ironwood", address: depositsUa[i], diversifier_index: String(i) };
  leaves.push({ auction_id: auctionId, manifest_hash: packet.sha256, ciphertext_hash: hash(Buffer.from(ctHex, "hex")), deposit, leaf_index: i, ciphertext_hex: ctHex });
  opened.push({ leaf_index: i, plaintext_hex: pt.toString("hex") });
}
const { root, paths } = tree(leaves);
const frozen = { auction_id: auctionId, manifest_hash: packet.sha256, root, leaf_count: 3, cutoff: manifest.T_freeze, published_at: manifest.T_freeze - 10, leaves, paths };
const result = clearForMode({ manifest: packet, signer, frozen, opened: opened as any, reserve_opening: null, serial_beacon: null });
const truth: number[] = [0];
const obligations = obligationsModeA(result as any, { defaults: truth });
const settlementRows = [...obligations].map(([party, amount_zats]) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats, state: "paid" }));
const receipts = [...obligations].map(([party, amount_zats], i) => ({ auction_id: auctionId, party, txid: createHash("sha256").update(`r44-settle-${party}`).digest("hex"), pool: "ironwood", output_index: i, amount_zats }));

// ---- the drift fixture: TWO paying batches. Batch 1 (earliest) attests the truth [0] with two witnesses;
// batch 2 attests the drifted [1] with three. Rows/receipts are identical under both lists (the R33 swap).
const T1 = receipts[0].txid, T2 = receipts[1].txid;
const mapBody = (who: number, txid: string, batch: number, defaults: number[]) =>
  ({ auction_id: auctionId, batch, txid, outputs: [{ party: "leaf:2", output_index: 0 }, { party: "seller", output_index: 1 }], defaults, balance_refunds: [] });
const b1maps = [0, 1].map(i => signApprovalMap(mapBody(i, T1, 1, [0]) as any, W[i].private_hex));
const b2maps = [0, 1, 2].map(i => signApprovalMap(mapBody(i, T2, 2, [1]) as any, W[i].private_hex));
const driftMaps = [...b1maps, ...b2maps];

// ---- verify leg: the shipped `benzo verify` over the assembled corpus (the r33-defaults recipe) ----------
const statement = freezeStatement(manifest as any, frozen);
const doc: any = {
  version: 1, auction_id: auctionId, signer, manifest: packet, state: "SETTLED", receipts: leaves.map(l => signRecord({ auction_id: auctionId, manifest_hash: packet.sha256, ciphertext_hash: l.ciphertext_hash, deposit: l.deposit, leaf_index: l.leaf_index }, signerPem)),
  frozen, result, opened, beacon,
  witness_set: witnessSet, witness_cert: [{ statement, signatures: [signStatement(statement, W[0].private_hex), signStatement(statement, W[1].private_hex)] }],
};
const writeDir = (dir: string, defaults: number[]) => {
  rmSync(assertScratch(dir), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const settlement = { rows: settlementRows, receipts, offline_signer: "carol", ignored: [], defaults, balance_refunds: [], approval_maps: driftMaps };
  const d = { ...doc, settlement };
  for (const [name, value] of [["auction.json", d], ["manifest.json", packet], ["frozen.json", frozen], ["result.json", result], ["opened.json", opened], ["beacon.json", beacon], ["receipts.json", doc.receipts], ["witness-set.json", witnessSet], ["witness.json", doc.witness_cert], ["summary.json", settlement]] as const)
    writeFileSync(path.join(dir, name), jsonBytes(value));
};
const verify = (dir: string) => spawnSync(process.execPath, [process.argv[2] ?? path.join(ROOT, "dist/benzo-verify.mjs"), "--dir", dir, "--signer", signer], { encoding: "utf8", maxBuffer: 64 << 20 });

{
  const okDir = assertScratch(path.join(ROOT, "tmp/r44-f19/earliest"));
  writeDir(okDir, [0]);
  const t = verify(okDir);
  const tOut = t.stdout + t.stderr;
  line("f19-verify-earliest-list-ok",
    t.status === 0 && /OK defaults/.test(tOut),
    `published [0] (batch 1's two agreeing maps): verify exit ${t.status}${/OK defaults/.test(tOut) ? ", OK defaults" : `, ${tOut.split("\n").filter(l => /ERROR/.test(l)).join(" | ").slice(0, 160)}`}`);
}
{
  const laterDir = assertScratch(path.join(ROOT, "tmp/r44-f19/later"));
  writeDir(laterDir, [1]);
  const f = verify(laterDir);
  const fOut = f.stdout + f.stderr;
  const refused = f.status !== 0 && /ERROR defaults refused: settlement defaults differ from the host-signed approval maps/.test(fOut);
  line("f19-verify-refuses-later-list",
    refused,
    refused ? "published [1] (batch 2's drifted list, 3 witnesses) refused with the specific ERROR"
      : `published [1] ACCEPTED (exit ${f.status}) — the wrong one of two host-attested lists verified`);
}

// ---- publish leg: the shipped publish() over a drift summary (the r41-f7 state recipe) --------------------
const dir = path.join(state, "settle", auctionId);
mkdirSync(path.join(state, "auction"), { recursive: true }); mkdirSync(path.join(state, "product"), { recursive: true }); mkdirSync(dir, { recursive: true });
writeFileSync(path.join(state, "auction", `${auctionId}.json`), jsonBytes({ signer, manifest: packet, state: "SETTLED", receipts: [], witness_set: witnessSet }));
writeFileSync(path.join(state, "product", `${auctionId}.json`), jsonBytes({ public_dir: publicDir, settlement: { signers: ["alice", "bob", "carol"], batch_cap: 13, pczt_expiry_blocks: 364 } }));
writeFileSync(path.join(dir, "summary.json"), jsonBytes({ auction_id: auctionId, rows: settlementRows,
  batches: [{ id: 1, txid: T1, height: 100, state: "mined" }, { id: 2, txid: T2, height: 101, state: "mined" }],
  plan: { defaults: truth, balance_refunds: [] }, offline_signer: "carol" }));
writeFileSync(path.join(dir, "receipts.json"), jsonBytes(receipts));
writeFileSync(path.join(dir, "batch-1.maps.json"), jsonBytes(b1maps));
writeFileSync(path.join(dir, "batch-2.maps.json"), jsonBytes(b2maps));
{
  const doc2: any = publish(auctionId);
  const got = JSON.stringify(doc2.settlement?.defaults ?? null);
  line("f19-publish-earliest-agreeing-batch",
    got === "[0]",
    `publish() served settlement.defaults ${got}; batch 1 (earliest paying) attested [0] with 2 witnesses, batch 2 drifted [1] with 3`);
}

rmSync(assertScratch(state), { recursive: true, force: true });
console.log(all ? "RESULT PASS r44-f19" : "RESULT FAIL r44-f19");
process.exitCode = all ? 0 : 1;
