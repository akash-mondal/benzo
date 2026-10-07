// Ruling R41 item 1 (F7, A19 item 1): per-row, paid-time attestation — a host attests a refund row only in the
// approval of the batch that PAYS it, and no signature ever covers a set that third parties can still grow.
// Reviewer R's F7 repro (reports/pr-a18-r40.md, tests/r40-map-wedge.ts) showed ONE third-party note arriving
// after the hosts signed wedging every later finalize and publish forever (F2's class reborn at F3's binding).
// This is that scenario driven through the SHIPPED primitives and the SHIPPED worker/publish checks, and it must
// COMPLETE end to end (R41.1: "a 1-zat note after the hosts signed, then the next batch, receipts and claims all
// complete"):
//   f7-late-note-adds-pending-row  the note adds exactly one immutable per-note row (never grows another);
//   f7-pin-accepts                 Ledger.pin accepts the new row after a settled batch (F2 preserved);
//   f7-finalize-accepts            the worker's finalize binding (witness/agreedBatchMaps — the exact check
//                                  settle/cli.ts runs) accepts the mined batch despite the grown row set;
//   f7-publish-serves              the shipped publish() serves: the settlement publishes the pending row as
//                                  counts only, no map-vs-plan set comparison refuses;
//   f7-next-batch-paid             the owner claims the row and the NEXT batch pays it — receipts complete;
//   f7-claims-complete             the claim publishes with the paid row attested in the paying batch's two maps.
// Why no existing test catches this: A18's r40-f2-ledger-growth drove only Ledger.pin and a synthetic
// allocation — the worker's map predicate and publish() were never executed (Reviewer R's exact evidence gap).
// Production seam: none added here — agreedBatchMaps is the worker's own finalize check (settle/cli.ts calls it)
// and publish() is the shipped publisher; this repro drives both at their real boundary.
// Run: npx esbuild tools/repro/r41-f7-map-wedge.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r41-f7-map-wedge.mjs && BNZ_STATE_DIR=tmp/r41-f7-state node tmp/r41-f7-map-wedge.mjs
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, signRecord } from "../../manifest/schema";
import { Ledger, type Obligation } from "../../settle/ledger";
import { agreedBatchMaps, signApprovalMap, type ApprovalMap } from "../../witness";
import { balanceSettlement, type ScannedNote } from "../../clear/features";
import { publish } from "../../cli/product";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r41-f7-map-wedge.mjs (tools/repro/r41-f7-map-wedge.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

const state = path.resolve(ROOT, process.env.BNZ_STATE_DIR ?? "tmp/r41-f7-state");
rmSync(state, { recursive: true, force: true });
const publicDir = path.join(ROOT, "tmp/r41-f7-public");
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(state, { recursive: true }); mkdirSync(publicDir, { recursive: true });

let all = true;
const line = (id: string, f: () => [boolean, string]) => {
  try {
    const [ok, d] = f();
    console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
    if (!ok) { console.log(`ERROR ${id} ${d}`); all = false; }
  } catch (e) {
    console.log(`FAIL ${id} threw ${(e as Error).message}`);
    console.log(`ERROR ${id} threw ${(e as Error).message}`);
    all = false;
  }
};

// --- fixture: one bonded winner (leaf 0 at slot 0 / bal0); the plan at approve time saw NO late notes. -------
const ed = () => generateKeyPairSync("ed25519");
const raw = (k: ReturnType<typeof ed>) => k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");
const wkey = (k: ReturnType<typeof ed>) => k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex");
const alice = ed(), bob = ed(), manifestKey = ed();
const manifestPem = manifestKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = manifestKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const wkeys = [raw(alice), raw(bob)];
const auctionId = hash(randomBytes(32));
const m = { deposit_addresses: ["dep0"], bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["bal0"] } } as any;
const result = { allocations: [{ leaf_index: 0, fill: 1, refund_zats: "200000", balance_due_zats: "300000" }], conservation: { payout_zats: "0", input_zats: "200000", refund_zats: "200000", fees_zats: "0", balances_zats: "300000" } } as any;
const leaves = [{ leaf_index: 0, deposit: { address: "dep0" } }] as any;

const L0 = balanceSettlement(m, result, leaves, [], 1300).refunds; // the approve-time derivation: []
// Batch 1 pays the winner's own leaf refund. Its maps attest ONLY the refund rows batch 1 pays (none) — the
// two hosts' live row sets are never signed (R41).
const txid1 = "11".repeat(32);
const mapBody = (who: any, txid: string, batch: number, outputs: { party: string; output_index: number }[], rows: typeof L0) =>
  ({ auction_id: auctionId, batch, txid, outputs, defaults: [] as number[], balance_refunds: rows });
const b1maps: ApprovalMap[] = [signApprovalMap(mapBody(alice, txid1, 1, [{ party: "leaf:0", output_index: 0 }], []) as any, wkey(alice)),
  signApprovalMap(mapBody(bob, txid1, 1, [{ party: "leaf:0", output_index: 0 }], []) as any, wkey(bob))];

// ONE third-party note arrives AFTER the hosts signed: 1 zatoshi at the manifest-public balance address, out of
// the window. Every later derivation gives it its own immutable row.
const dust: ScannedNote = { txid: "dd".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1200, value_zats: 1 };
const L1 = balanceSettlement(m, result, leaves, [dust], 1300).refunds;
line("f7-late-note-adds-pending-row", () => [JSON.stringify(L1.map(r => ({ party: r.party, leaf_index: r.leaf_index, amount_zats: r.amount_zats }))) ===
  JSON.stringify([{ party: `balance-late:${dust.txid}:${dust.pool}:${dust.action_index}`, leaf_index: 0, amount_zats: "1" }]),
  `plan at approve ${JSON.stringify(L0)}; after one third-party note ${JSON.stringify(L1.map(r => ({ party: r.party.slice(0, 28) + "…", amount: r.amount_zats })))}`]);

// --- the ledger: batch 1 settles, then the new row is pinned and batch 2 pays the claim. ---------------------
const dir = path.join(state, "settle", auctionId);
mkdirSync(path.join(state, "auction"), { recursive: true }); mkdirSync(path.join(state, "product"), { recursive: true });
const ledger = new Ledger(state, auctionId);
const leafRow: Obligation = { party: "leaf:0", kind: "refund", amount_zats: "200000" };
ledger.pin([leafRow], []); ledger.eligible();
const b1 = ledger.allocate(13)!;
const pczt1 = path.join(dir, "batch-1.signed"); mkdirSync(dir, { recursive: true }); writeFileSync(pczt1, "fixture");
ledger.stage(b1.id, pczt1, txid1);
ledger.confirm(b1.id, txid1, 100, [{ party: "leaf:0", amount_zats: "200000", index: 0, pool: "ironwood" }]);
writeFileSync(path.join(dir, "batch-1.maps.json"), jsonBytes(b1maps));

// F2 acceptance (the reviewer's own first check): pin with one more late row after the settled batch.
const dustObligation: Obligation = { party: L1[0].party, kind: "refund", amount_zats: L1[0].amount_zats };
line("f7-pin-accepts", () => {
  ledger.pin([leafRow, dustObligation], []);
  const rows = ledger.rows();
  return [rows.some(r => r.party === dustObligation.party && r.state !== "refunded") && rows.find(r => r.party === "leaf:0")!.state === "refunded",
    `pin accepted the new per-note row after the settled batch (rows=${rows.length})`];
});

// The worker's finalize binding on batch 1 AFTER the note: the maps attest only what batch 1 pays, so the grown
// plan's row set is never compared to them (the F7 wedge point 1 — the reviewer's "WEDGED-AS-CODED worker").
const plan: any = { defaults: [] as number[], balance_refunds: L1 };
line("f7-finalize-accepts", () => {
  const pair = agreedBatchMaps(b1maps, wkeys, txid1, plan);
  return [pair.length === 2, "the mined batch's finalize accepts despite the plan's grown refund-row set"];
});

// The shipped publish() (the F7 wedge point 2 — the reviewer's "WEDGED-AS-CODED publish").
const manifest = signRecord({ version: 1, network: "test", auction_id: auctionId, C_zats: "200000" }, manifestPem);
const witnessSet = signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: wkeys }, manifestPem);
const writeState = (rows: unknown[], batches: unknown[], planBody: unknown, receipts: unknown[]) => {
  writeFileSync(path.join(state, "auction", `${auctionId}.json`), jsonBytes({ signer, manifest, state: "SETTLED", receipts: [], witness_set: witnessSet }));
  writeFileSync(path.join(state, "product", `${auctionId}.json`), jsonBytes({ public_dir: publicDir, settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 } }));
  writeFileSync(path.join(dir, "summary.json"), jsonBytes({ auction_id: auctionId, rows, batches, plan: planBody, offline_signer: "carol" }));
  writeFileSync(path.join(dir, "receipts.json"), jsonBytes(receipts));
};
writeState(ledger.rows(), [{ id: 1, txid: txid1, height: 100, state: "mined" }], { defaults: [], balance_refunds: L1 }, ledger.receipts());
line("f7-publish-serves", () => {
  const doc: any = publish(auctionId);
  const entries = doc.settlement?.balance_refunds ?? [];
  const brief = JSON.stringify(entries.map((e: any) => ({ party: e.party.slice(0, 28) + "…", state: e.state })));
  return [entries.length === 1 && entries[0].party === dustObligation.party && entries[0].state === "pending", `publish served; balance_refunds ${brief}`];
});

// The owner claims the row (leaf 0's owner key) and the NEXT batch pays it: receipts and claims complete.
ledger.eligible();
const b2 = ledger.allocate(13)!;
line("f7-next-batch-paid", () => {
  const txid2 = "22".repeat(32);
  const pczt2 = path.join(dir, "batch-2.signed"); writeFileSync(pczt2, "fixture");
  ledger.stage(b2.id, pczt2, txid2);
  ledger.confirm(b2.id, txid2, 200, [{ party: dustObligation.party, amount_zats: dustObligation.amount_zats, index: 0, pool: "ironwood" }]);
  const b2maps: ApprovalMap[] = [signApprovalMap(mapBody(alice, txid2, 2, [{ party: dustObligation.party, output_index: 0 }], L1) as any, wkey(alice)),
    signApprovalMap(mapBody(bob, txid2, 2, [{ party: dustObligation.party, output_index: 0 }], L1) as any, wkey(bob))];
  writeFileSync(path.join(dir, "batch-2.maps.json"), jsonBytes(b2maps));
  const receipts = ledger.receipts();
  const brief = JSON.stringify(receipts.map(r => ({ party: r.party.slice(0, 28) + "…", amount: r.amount_zats })));
  return [receipts.some(r => r.party === dustObligation.party && r.amount_zats === "1" && r.txid === txid2) &&
    ledger.rows().find(r => r.party === dustObligation.party)!.state === "refunded", `batch 2 paid the claimed row; receipts ${brief}`];
});
line("f7-claims-complete", () => {
  const claim = { party: dustObligation.party, claim_envelope_sha256: hash(randomBytes(32)), owner_sig: "ab".repeat(64) };
  writeState(ledger.rows(), [{ id: 1, txid: txid1, height: 100, state: "mined" }, { id: 2, txid: "22".repeat(32), height: 200, state: "mined" }],
    { defaults: [], balance_refunds: L1, claims_used: [claim] }, ledger.receipts());
  const doc: any = publish(auctionId);
  const entry = (doc.settlement?.balance_refunds ?? []).find((e: any) => e.party === dustObligation.party);
  const maps: ApprovalMap[] = doc.settlement?.approval_maps ?? [];
  const attested = maps.filter(mp => mp.txid === "22".repeat(32) && (mp.balance_refunds ?? []).some(r => r.party === dustObligation.party && r.amount_zats === "1") &&
    (mp.outputs ?? []).some(o => o.party === dustObligation.party && o.output_index === 0));
  return [!!entry && entry.state === "paid" && (doc.claims ?? []).some((c: any) => c.party === dustObligation.party) &&
    attested.length === 2 && new Set(attested.map(mp => mp.witness)).size === 2,
    `entry ${entry ? entry.state : "missing"}; claims published ${(doc.claims ?? []).length}; attesting maps ${attested.length} (distinct ${new Set(attested.map(mp => mp.witness)).size})`];
});

console.log(all ? "RESULT PASS r41-f7-map-wedge" : "RESULT FAIL r41-f7-map-wedge");
process.exitCode = all ? 0 : 1;
