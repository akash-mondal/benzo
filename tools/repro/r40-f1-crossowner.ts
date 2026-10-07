// Ruling R40 item 1 (F1, A18 item 1): one bid per deposit slot in a bond-then-pay auction. Reviewer R's
// cross-owner repro (benzo-sol/lab/pr-a16-a17/tests/r39-crossowner.ts) showed the R38.2 greedy rule credits
// whichever co-slot leaf has the lower leaf_index regardless of who paid: two DIFFERENT bidders depositing to
// one shared deposit slot both won, and the non-paying lower leaf free-rode on the honest payer's balance
// payment (the payer defaulted and forfeited). R40 withdraws the greedy rule: only the FIRST deposit note at
// each deposit address (leaf order = chain order) is an order; every later note at that slot is a STRAY,
// refunded through the existing stray path to its own depositor (who loses only the fee). The rule lives in
// the one shared helper (clear/features.ts slotOrders) used by the clearing input (readOrders), the plan
// (settle/deposits.ts strayNotes), every signer host and the witness strays statement.
//
// Green assertions (the F1 invariants; red before the fix with the reviewer's own failure modes):
//   f1-one-order-per-slot  the clear keeps exactly the first note at the shared slot as an order — the
//                          collision leaf never wins and has no allocation row at all;
//   f1-collision-is-stray  the collision's deposit note is a stray (party deposit:<txid>:<pool>:<action>),
//                          refunded through the stray path to its own memo owner key — never to the co-slot
//                          bidder, and never a settlement source;
//   f1-no-greedy           with NO payment at the shared balance address the slot's own bidder defaults
//                          ([0]) — no walk credits one leaf with another's money; the shipped helper refuses
//                          a result where two winning leaves share one balance address (the R38.2 fixture),
//                          because the clear can no longer produce one.
// Residual (the R40 honest limit, printed as an observation): a payment that arrives at the shared balance
// address is the slot owner's (a payer is unobservable on shielded Zcash); a collision is refunded.
// Run: npx esbuild tools/repro/r40-f1-crossowner.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r40-f1-crossowner.mjs && node tmp/r40-f1-crossowner.mjs
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import path from "node:path";
import { timelockEncrypt } from "tlock-js";
import { hash, signRecord, QUICKNET } from "../../manifest/schema";
import { tree, type Deposit, type Leaf } from "../../clear/merkle";
import { clearForMode } from "../../clear/registry";
import { balanceAddressMap, balanceDefaults, slotOrders } from "../../clear/features";
import { strayNotes } from "../../settle/deposits";
import { publishedClient } from "../../cli/published-beacon";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r40-f1-crossowner.mjs (tools/repro/r40-f1-crossowner.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const beacon = JSON.parse(execFileSync("cat", [path.join(ROOT, "docs/evidence/phase-4/cli/beacon.json")], { encoding: "utf8", maxBuffer: 1 << 24 }));
const local = publishedClient(beacon);
const auctionId = randomBytes(32).toString("hex");
const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const ua = (tag: string) => "utest1rfixture" + createHash("sha256").update(tag).digest("hex").slice(0, 40);
const depositsUa = ["dep0", "dep1"].map(t => ua(t)), balanceUa = ["bal0", "bal1"].map(t => ua(t));
const manifest = {
  version: 1, network: "test", auction_id: auctionId, escrow_ua: ua("escrow"), frost_group_key: randomBytes(32).toString("hex"),
  lot: "cross-owner fixture", supply: 2, reserve_zats: "10", tick_zats: "10", B_max_zats: "1000000",
  q_max: 1, C_zats: "200000", fee_zats: "0", deposit_addresses: depositsUa,
  bond: { bond_bps: 2000, balance_window_blocks: 50, balance_window_start_height: 5_000_000, balance_addresses: balanceUa },
  drand: { ...QUICKNET, R: beacon.round }, T_submit: releaseOf() - 1600, T_freeze: releaseOf() - 800, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
} as any;
function releaseOf() { return QUICKNET.genesis + (beacon.round - 1) * QUICKNET.period; }
const packet = signRecord(manifest, signerPem);
const order = (price: number, ownerHex: string): Buffer => {
  const pt = Buffer.alloc(128); pt[0] = 0;
  Buffer.from(auctionId, "hex").copy(pt, 1);
  pt.writeBigUInt64BE(BigInt(price), 33); pt.writeUInt32BE(1, 41);
  Buffer.from(ownerHex, "hex").copy(pt, 61);
  return pt;
};
const edRaw = (k: any) => k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");
const owners = [0, 1, 2].map(() => edRaw(generateKeyPairSync("ed25519")));
// Two DIFFERENT bidders, two txids, ONE deposit address (slot 0) — the reviewer's fixture. Both are valid
// orders at 500,000 with C = 200,000, so each would owe a 300,000 balance. Leaf 0 = the first note (the
// attacker in R's repro), leaf 1 = the second (the victim). Under R40 leaf 1 is a slot collision: not an
// order, refunded through the stray path.
const specs = [
  { price: 500_000, address: depositsUa[0], txid: createHash("sha256").update("dep-a").digest("hex") },
  { price: 500_000, address: depositsUa[0], txid: createHash("sha256").update("dep-b").digest("hex") },
];
const leaves: Leaf[] = [], opened: any[] = [];
for (let i = 0; i < 2; i++) {
  const pt = order(specs[i].price, owners[i]);
  const armored = await timelockEncrypt(beacon.round, pt, local);
  const ctHex = Buffer.from(armored.split("\n").filter(l => l && !l.startsWith("-----")).join(""), "base64").toString("hex");
  const deposit: Deposit = { txid: specs[i].txid, pool: "ironwood", address: specs[i].address, diversifier_index: String(i) };
  leaves.push({ auction_id: auctionId, manifest_hash: packet.sha256, ciphertext_hash: hash(Buffer.from(ctHex, "hex")), deposit, leaf_index: i, ciphertext_hex: ctHex });
  opened.push({ leaf_index: i, plaintext_hex: pt.toString("hex") });
}
const { root, paths } = tree(leaves);
const frozen = { auction_id: auctionId, manifest_hash: packet.sha256, root, leaf_count: 2, cutoff: manifest.T_freeze, published_at: 0, leaves, paths };

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};
const result: any = clearForMode({ manifest: packet, signer, frozen, opened, reserve_opening: null, serial_beacon: null });
console.log(`owners distinct: ${owners[0] !== owners[1]}; allocations ${JSON.stringify(result.allocations.map((a: any) => [a.leaf_index, a.fill, a.balance_due_zats ?? "0", a.outcome]))}`);

// f1-one-order-per-slot: exactly the first note at the shared slot is an order. The collision leaf has no
// allocation row (its deposit is a stray), so no clearing rule can ever attribute one address's payment
// among two bidders. Red before the fix: both leaves rank and win (`allocations` has both).
const { orders, collisions } = slotOrders(manifest, leaves as any);
line("f1-one-order-per-slot",
  orders.length === 1 && orders[0].leaf_index === 0 && collisions.length === 1 && collisions[0].leaf_index === 1 &&
    result.allocations.length === 1 && result.allocations[0].leaf_index === 0 && result.allocations[0].fill === 1,
  `orders ${JSON.stringify(orders.map(o => o.leaf_index))} collisions ${JSON.stringify(collisions.map(o => o.leaf_index))} allocations ${JSON.stringify(result.allocations.map((a: any) => [a.leaf_index, a.fill]))}`);

// f1-collision-is-stray: the collision's deposit note is a stray — party deposit:<txid>:<pool>:<action_index>,
// the existing stray path (its own memo carries the owner key that claims the refund). Red before the fix:
// strayNotes matches it against the frozen leaves and drops it (it was an order then).
const note2 = { txid: specs[1].txid, pool: "ironwood", action_index: 0, address: specs[1].address, height: 4_999_000, value_zats: 200_000, memo_hex: "", spent_in_txid: null };
const strays = strayNotes([note2 as any], manifest, frozen as any);
line("f1-collision-is-stray",
  strays.length === 1 && strays[0].txid === specs[1].txid,
  `strays ${JSON.stringify(strays.map(s => (s as any).txid.slice(0, 8)))} (the collision deposits through the stray path to its own depositor)`);

// f1-no-greedy: with NO payment at the shared balance address the slot's own bidder defaults. There is no
// walk left to credit one leaf with another's payment; the shipped helper refuses the R38.2 shared-slot
// result outright (the clear can no longer produce two winners at one slot). Red before the fix: the greedy
// fixture is accepted and R's exploit leg runs (the lower leaf credited, the payer defaulted).
let refused: string | null = null;
try {
  const sharedResult = { allocations: [
    { leaf_index: 0, fill: 1, balance_due_zats: "300000" },
    { leaf_index: 1, fill: 1, balance_due_zats: "300000" },
  ] } as any;
  const sharedLeaves = [0, 1].map(i => ({ leaf_index: i, deposit: { address: depositsUa[0] } })) as any;
  balanceAddressMap(sharedResult, sharedLeaves, manifest);
} catch (e) { refused = (e as Error).message; }
const defaults = balanceDefaults(manifest as any, result, leaves as any, [], 5_000_100);
line("f1-no-greedy",
  refused !== null && JSON.stringify(defaults) === "[0]",
  `shared-slot fixture refused (${JSON.stringify(refused)}); defaults with no payment at the address ${JSON.stringify(defaults)} (the slot's own bidder defaults; no cross-leaf credit walk)`);

// Observation only (the R40 honest limit): a payment that arrives at the shared balance address is the slot
// owner's. With the victim's 300,000 in-window at slot 0's address leaf 0 is paid — a payer is unobservable
// on shielded Zcash, so no rule can attribute one address's payment; a collision is refunded instead.
const paid = balanceDefaults(manifest as any, result, leaves as any,
  [{ txid: "aa".repeat(32), pool: "ironwood", action_index: 0, address: balanceUa[0], height: 5_000_010, value_zats: 300_000 }] as any, 5_000_100);
console.log(`observation f1-payment-attribution defaults with a 300,000 payment at the shared address ${JSON.stringify(paid)} (the payment is the slot owner's — the R40 honest limit)`);

console.log(all ? "RESULT PASS r40-f1-crossowner" : "RESULT FAIL r40-f1-crossowner");
process.exitCode = all ? 0 : 1;
