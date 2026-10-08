// Ruling R45 item 2 (Reviewer R F21, `benzo-sol/reports/pr-a22-r44.md`): the `defaults` tie-break must not be
// steerable by OMITTING a batch's maps. Verify requires two agreeing maps for EVERY paying batch — payout-only
// batches included, which no other check attests — before the tie-break is computed. The reviewer's probe
// (`lab/pr-a22/tmp/f19-omit.ts`): "both batches present → [0]" vs "batch 1 maps OMITTED → [1]".
// 1. Which behavior does it protect: settlement defaults attribution (R44 F19's deterministic tie-break, DESIGN
//    §6 bond rules) — the earliest paying batch's hosts decide which leaf defaulted, and hiding that batch's
//    maps must never move the decision to a later batch's list.
// 2. Which credible regression makes it fail: the F19 tie-break derives its candidate batches only from the
//    maps PRESENT, so a coordinator who omits the earliest paying batch's maps (a payout-only batch needs no
//    attesting maps anywhere) silently moves the tie-break to a later batch's drifted list — verify accepts.
// 3. Why no existing test catches it: r44-f19 drives both batches' maps present (the drift case); nothing ever
//    omitted a paying batch's maps — the omission case F21 names.
// 4. Production seam: none — this drives the shipped `earliestAgreedDefaults` (witness/index.ts, the shared
//    publish/verify rule) and the shipped `benzo verify` (dist bundle), both at their real boundaries.
// Assertions (the pre-F21 tree turns the three marked [F21] red):
//   f21-probe-both-present          control (green before and after): both batches present → the earliest
//                                    paying batch's list [0];
//   f21-probe-omission-refused      [F21] the reviewer's probe at the shared rule: batch 1's maps omitted — red:
//                                    the tie-break returns the later batch's [1] (steered); green: it refuses
//                                    with the specific ERROR naming the hidden paying batch;
//   f21-verify-omission-refused     [F21] the shipped verify over the omission document (published [1]) — red:
//                                    accepted (exit 0, steered defaults verify); green: refused with the
//                                    specific ERROR;
//   f21-verify-later-batch-attested [F21] EVERY paying batch is required, not just the earliest: batch 2's maps
//                                    omitted (published [0]) — red: accepted; green: refused naming batch 2;
//   f21-verify-both-batches-ok      control (green before and after): the untampered document verifies.
// Run: npx esbuild tools/repro/r45-f21.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r45-f21.mjs && BNZ_STATE_DIR=tmp/r45-f21-state node tmp/r45-f21.mjs [verify-bundle.mjs]
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
import { earliestAgreedDefaults, freezeStatement, signApprovalMap, signStatement, type ApprovalMap, type WitnessSet } from "../../witness";
import { publishedClient } from "../../cli/published-beacon";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r45-f21.mjs (tools/repro/r45-f21.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

const state = assertScratch(process.env.BNZ_STATE_DIR ?? "tmp/r45-f21-state");
rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};

// ---- fixture (the r44-f19 recipe): a uniform bond auction; two paying batches under defaults drift ------
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
const ua = (tag: string) => "utest1r45fixture" + createHash("sha256").update(tag).digest("hex").slice(0, 40);
const depositsUa = [0, 1, 2].map(i => ua(`deposit${i}`)), balanceUa = [0, 1, 2].map(i => ua(`balance${i}`));
const manifest = {
  version: 1, network: "test", auction_id: auctionId, escrow_ua: ua("escrow"), frost_group_key: randomBytes(32).toString("hex"),
  lot: "r45-f21 fixture round", supply: 2, reserve_zats: "10", tick_zats: "10", B_max_zats: "1000000",
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
  const deposit: Deposit = { txid: createHash("sha256").update(`r45-deposit-${i}`).digest("hex"), pool: "ironwood", address: depositsUa[i], diversifier_index: String(i) };
  leaves.push({ auction_id: auctionId, manifest_hash: packet.sha256, ciphertext_hash: hash(Buffer.from(ctHex, "hex")), deposit, leaf_index: i, ciphertext_hex: ctHex });
  opened.push({ leaf_index: i, plaintext_hex: pt.toString("hex") });
}
const { root, paths } = tree(leaves);
const frozen = { auction_id: auctionId, manifest_hash: packet.sha256, root, leaf_count: 3, cutoff: manifest.T_freeze, published_at: manifest.T_freeze - 10, leaves, paths };
const result = clearForMode({ manifest: packet, signer, frozen, opened: opened as any, reserve_opening: null, serial_beacon: null });
const truth: number[] = [0];
const obligations = obligationsModeA(result as any, { defaults: truth });
const settlementRows = [...obligations].map(([party, amount_zats]) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats, state: "paid" }));
const receipts = [...obligations].map(([party, amount_zats], i) => ({ auction_id: auctionId, party, txid: createHash("sha256").update(`r45-settle-${party}`).digest("hex"), pool: "ironwood", output_index: i, amount_zats }));

// ---- the omission fixture: TWO paying batches, both PAYOUT-ONLY (the reviewer's probe body — a payout-only
// batch needs no attesting maps anywhere, so omitting its maps is invisible to every other check). Batch 1
// (earliest) attests [0] with two witnesses; batch 2 attests the drifted [1] with three.
const T1 = receipts[0].txid, T2 = receipts[1].txid;
const mapBody = (txid: string, batch: number, defaults: number[]) =>
  ({ auction_id: auctionId, batch, txid, outputs: [{ party: "seller", output_index: 0 }], defaults, balance_refunds: [] });
const b1maps = [0, 1].map(i => signApprovalMap(mapBody(T1, 1, [0]) as any, W[i].private_hex));
const b2maps = [0, 1, 2].map(i => signApprovalMap(mapBody(T2, 2, [1]) as any, W[i].private_hex));
const allMaps = [...b1maps, ...b2maps];
const keys = W.map(w => w.public_hex);

// ---- the reviewer's probe legs at the shared rule (witness/index.ts earliestAgreedDefaults) --------------
{
  const got = earliestAgreedDefaults(allMaps as unknown as ApprovalMap[], keys, [T1, T2]);
  line("f21-probe-both-present", JSON.stringify(got) === "[0]", `both batches present → ${JSON.stringify(got)} (the earliest paying batch's list [0])`);
}
{
  // Batch 1's maps OMITTED. Red: the tie-break silently falls to batch 2's list (the reviewer's probe). Green:
  // the rule refuses to compute over an invisible paying batch, naming it.
  let got: number[] | null | undefined, refused = "";
  try { got = earliestAgreedDefaults(b2maps as unknown as ApprovalMap[], keys, [T1, T2]); } catch (e) { refused = (e as Error).message; }
  const ok = /paying batch/.test(refused) && refused.includes(T1) && /cannot be steered by omission/.test(refused);
  line("f21-probe-omission-refused", ok,
    ok ? `refused: ${refused.slice(0, 120)}` : `batch 1's maps omitted → earliestAgreedDefaults returned ${JSON.stringify(got)} — the tie-break is steered to the later batch's list`);
}

// ---- verify legs: the shipped `benzo verify` over the assembled corpus (the r44-f19 recipe) -------------
const statement = freezeStatement(manifest as any, frozen);
const doc: any = {
  version: 1, auction_id: auctionId, signer, manifest: packet, state: "SETTLED", receipts: leaves.map(l => signRecord({ auction_id: auctionId, manifest_hash: packet.sha256, ciphertext_hash: l.ciphertext_hash, deposit: l.deposit, leaf_index: l.leaf_index }, signerPem)),
  frozen, result, opened, beacon,
  witness_set: witnessSet, witness_cert: [{ statement, signatures: [signStatement(statement, W[0].private_hex), signStatement(statement, W[1].private_hex)] }],
};
const writeDir = (dir: string, defaults: number[], maps: unknown[]) => {
  rmSync(assertScratch(dir), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const settlement = { rows: settlementRows, receipts, offline_signer: "carol", ignored: [], defaults, balance_refunds: [], approval_maps: maps };
  const d = { ...doc, settlement };
  for (const [name, value] of [["auction.json", d], ["manifest.json", packet], ["frozen.json", frozen], ["result.json", result], ["opened.json", opened], ["beacon.json", beacon], ["receipts.json", doc.receipts], ["witness-set.json", witnessSet], ["witness.json", doc.witness_cert], ["summary.json", settlement]] as const)
    writeFileSync(path.join(dir, name), jsonBytes(value));
};
const verify = (dir: string) => spawnSync(process.execPath, [process.argv[2] ?? path.join(ROOT, "dist/benzo-verify.mjs"), "--dir", dir, "--signer", signer], { encoding: "utf8", maxBuffer: 64 << 20 });

{
  const dir = assertScratch(path.join(ROOT, "tmp/r45-f21/omitted"));
  writeDir(dir, [1], b2maps); // batch 1's maps omitted; the published list is batch 2's [1]
  const t = verify(dir);
  const out = t.stdout + t.stderr;
  const ok = t.status !== 0 && /ERROR defaults refused: paying batch/.test(out) && out.includes(T1) && /cannot be steered by omission/.test(out);
  line("f21-verify-omission-refused", ok,
    ok ? `batch 1's maps omitted, published [1]: refused with the specific ERROR (exit ${t.status})`
      : `batch 1's maps omitted, published [1]: verify exit ${t.status} — the steered defaults ${t.status === 0 ? "VERIFIED (the tie-break cannot see the hidden batch)" : `failed elsewhere: ${out.split("\n").filter(l => /ERROR/.test(l)).join(" | ").slice(0, 160)}`}`);
}
{
  const dir = assertScratch(path.join(ROOT, "tmp/r45-f21/later-omitted"));
  writeDir(dir, [0], b1maps); // batch 2's maps omitted (the LATER batch); published [0] is still the present batches' list
  const t = verify(dir);
  const out = t.stdout + t.stderr;
  const ok = t.status !== 0 && /ERROR defaults refused: paying batch/.test(out) && out.includes(T2) && /cannot be steered by omission/.test(out);
  line("f21-verify-later-batch-attested", ok,
    ok ? `batch 2's maps omitted, published [0]: refused naming the unattested paying batch (exit ${t.status}) — every paying batch is required`
      : `batch 2's maps omitted, published [0]: verify exit ${t.status} — only the earliest batch's attestation was required (R45 requires EVERY paying batch)`);
}
{
  const dir = assertScratch(path.join(ROOT, "tmp/r45-f21/both"));
  writeDir(dir, [0], allMaps);
  const t = verify(dir);
  const out = t.stdout + t.stderr;
  line("f21-verify-both-batches-ok", t.status === 0 && /OK defaults/.test(out),
    `both batches attested, published [0]: verify exit ${t.status}${/OK defaults/.test(out) ? ", OK defaults" : `, ${out.split("\n").filter(l => /ERROR/.test(l)).join(" | ").slice(0, 160)}`}`);
}

rmSync(assertScratch(state), { recursive: true, force: true });
console.log(all ? "RESULT PASS r45-f21" : "RESULT FAIL r45-f21");
process.exitCode = all ? 0 : 1;
