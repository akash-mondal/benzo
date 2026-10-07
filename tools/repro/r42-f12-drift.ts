// Ruling R42 item 2 (F12, A20 item 2): `defaults` are attested in the paying batch's approval maps and
// compared MAP-TO-MAP, never against a fresh plan; `Ledger.pin` is monotone for every chain-derived amount —
// a re-derivation that differs from a pinned, unpaid row is logged and the pinned row stands; it never
// throws (the F12 wedge: a fresh-vs-pinned/singed comparison chain drift makes fail forever).
// source: adapted from Reviewer R's benzo-sol/lab/pr-a19/tests/r41-f7-rerun-and-residue.ts part 2 (the four
// w12 probes). Red before = that file run verbatim against a pristine fda25b4 archive (r42-f12-red-before.out).
// Green assertions (mutation-free; each drives the shipped primitives):
//   f12a-defaults-map-to-map    agreedBatchMaps takes NO fresh derivation (the plan parameter is gone): two
//                               agreeing maps finalize a mined batch whatever the plan says, and two maps
//                               whose `defaults` lists disagree are refused map-to-map;
//   f12b-pin-seller-drift       a defaults flip re-deriving `seller` at a different amount never throws —
//                               the pinned row stands and is never made payable at the stale amount;
//   f12c-pin-excess-drift       a re-derived `balance-excess:` amount never throws — the pinned row stands;
//   f12d-pin-row-vanish         a row vanishing from the re-derivation never throws — the pinned row stands;
//   f12e-publish-map-defaults   publish() serves with a DRIFTED plan.defaults and publishes the list carried
//                               by two agreeing maps (the F12 publish wedge is gone).
// Run: npx esbuild tools/repro/r42-f12-drift.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r42-f12-drift.mjs && BNZ_STATE_DIR=tmp/r42-f12-state node tmp/r42-f12-drift.mjs
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { assertScratch } from "./scratch";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, signRecord } from "../../manifest/schema";
import { Ledger, type Obligation } from "../../settle/ledger";
import { agreedBatchMaps, signApprovalMap, type ApprovalMap } from "../../witness";
import { publish } from "../../cli/product";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
for (const l of execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

// This driver rmSync's its state dir at startup; refuse the real one (the A20 incident, docs/STATUS.md).
const state = assertScratch(process.env.BNZ_STATE_DIR ?? "tmp/r42-f12-state"); // R43: tmp/ or $TMPDIR only
const publicDir = path.join(ROOT, "tmp/r42-f12-public");
rmSync(state, { recursive: true, force: true }); rmSync(assertScratch(publicDir), { recursive: true, force: true });
mkdirSync(state, { recursive: true }); mkdirSync(publicDir, { recursive: true });

let all = true;
const line = (id: string, f: () => [boolean, string]) => {
  try { const [ok, d] = f(); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`); if (!ok) { console.log(`ERROR ${id} ${d}`); all = false; } }
  catch (e) { console.log(`FAIL ${id} threw ${(e as Error).message}`); console.log(`ERROR ${id} threw ${(e as Error).message}`); all = false; }
};
const throws = (f: () => void, re: RegExp): string => { try { f(); return "NO-THROW"; } catch (e) { return re.test((e as Error).message) ? `threw "${(e as Error).message}"` : `WRONG-ERROR "${(e as Error).message}"`; } };

const ed = () => generateKeyPairSync("ed25519");
const raw = (k: ReturnType<typeof ed>) => k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");
const wkey = (k: ReturnType<typeof ed>) => k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex");
const alice = ed(), bob = ed(), manifestKey = ed();
const manifestPem = manifestKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = manifestKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const wkeys = [raw(alice), raw(bob)];
const auctionId = hash(randomBytes(32));
const txid1 = "11".repeat(32);
const mapBody = (who: typeof alice, txid: string, batch: number, outputs: { party: string; output_index: number }[], defaults: number[], rows: unknown[] = []) =>
  ({ auction_id: auctionId, batch, txid, outputs, defaults, balance_refunds: rows });

// f12a: no fresh derivation exists to compare against; the two maps' `defaults` bind each other (map-to-map).
{
  const agree: ApprovalMap[] = [signApprovalMap(mapBody(alice, txid1, 1, [{ party: "leaf:0", output_index: 0 }], [0]) as any, wkey(alice)),
    signApprovalMap(mapBody(bob, txid1, 1, [{ party: "leaf:0", output_index: 0 }], [0]) as any, wkey(bob))];
  const split: ApprovalMap[] = [signApprovalMap(mapBody(alice, txid1, 1, [{ party: "leaf:0", output_index: 0 }], [0]) as any, wkey(alice)),
    signApprovalMap(mapBody(bob, txid1, 1, [{ party: "leaf:0", output_index: 0 }], [1]) as any, wkey(bob))];
  line("f12a-defaults-map-to-map", () => {
    const ok = agreedBatchMaps(agree, wkeys, txid1).length === 2;
    const t = throws(() => { agreedBatchMaps(split, wkeys, txid1); }, /missing, unsigned or disagree/);
    return [ok && t.startsWith("threw"), `agreeing maps finalize with no plan comparison (${ok}); disagreeing defaults ${t} (map-to-map only)`];
  });
}

// f12b..d: pin is monotone and total — logged divergences, the pinned row stands, never a throw.
const ledger2 = new Ledger(state, hash(randomBytes(32)));
const seller500: Obligation = { party: "seller", kind: "payout", amount_zats: "500000" };
ledger2.pin([seller500], []);
line("f12b-pin-seller-drift", () => {
  const t = throws(() => { ledger2.pin([{ party: "seller", kind: "payout", amount_zats: "200000" }], []); }, /./);
  const row = ledger2.rows().find(r => r.party === "seller");
  return [t === "NO-THROW" && row?.amount_zats === "500000" && row?.state !== "eligible",
    `${t}; the pinned row stands at ${row?.amount_zats} (state ${row?.state}) — a defaults flip can never wedge or rewrite it`];
});

const ledger3 = new Ledger(state, hash(randomBytes(32)));
ledger3.pin([{ party: "balance-excess:0", kind: "refund", amount_zats: "50000" }], []);
line("f12c-pin-excess-drift", () => {
  const t = throws(() => { ledger3.pin([{ party: "balance-excess:0", kind: "refund", amount_zats: "30000" }], []); }, /./);
  const row = ledger3.rows().find(r => r.party === "balance-excess:0");
  return [t === "NO-THROW" && row?.amount_zats === "50000", `${t}; the pinned row stands at ${row?.amount_zats}`];
});

const ledger4 = new Ledger(state, hash(randomBytes(32)));
const leafRow: Obligation = { party: "leaf:0", kind: "refund", amount_zats: "200000" };
ledger4.pin([leafRow, seller500], []);
line("f12d-pin-row-vanish", () => {
  const t = throws(() => { ledger4.pin([seller500], []); }, /./);
  const row = ledger4.rows().find(r => r.party === "leaf:0");
  return [t === "NO-THROW" && row?.amount_zats === "200000", `${t}; the vanished row stands at ${row?.amount_zats}`];
});

// f12e: publish() with a drifted plan.defaults publishes the maps' agreed list (site #3 of the class).
{
  const b1maps: ApprovalMap[] = [signApprovalMap(mapBody(alice, txid1, 1, [{ party: "leaf:0", output_index: 0 }], [0]) as any, wkey(alice)),
    signApprovalMap(mapBody(bob, txid1, 1, [{ party: "leaf:0", output_index: 0 }], [0]) as any, wkey(bob))];
  const manifest = signRecord({ version: 1, network: "test", auction_id: auctionId, C_zats: "200000" }, manifestPem);
  const witnessSet = signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: wkeys }, manifestPem);
  const dir = path.join(state, "settle", auctionId);
  mkdirSync(path.join(state, "auction"), { recursive: true }); mkdirSync(path.join(state, "product"), { recursive: true }); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(state, "auction", `${auctionId}.json`), jsonBytes({ signer, manifest, state: "SETTLED", receipts: [], witness_set: witnessSet }));
  writeFileSync(path.join(state, "product", `${auctionId}.json`), jsonBytes({ public_dir: publicDir, settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 } }));
  writeFileSync(path.join(dir, "summary.json"), jsonBytes({ auction_id: auctionId, rows: [leafRow], batches: [{ id: 1, txid: txid1, height: 100, state: "mined" }], plan: { defaults: [1] }, offline_signer: "carol" }));
  writeFileSync(path.join(dir, "receipts.json"), jsonBytes([]));
  writeFileSync(path.join(dir, "batch-1.maps.json"), jsonBytes(b1maps));
  line("f12e-publish-map-defaults", () => {
    const doc: any = publish(auctionId);
    return [JSON.stringify(doc.settlement?.defaults) === "[0]", `plan derivation drifted to [1]; publish served and published defaults ${JSON.stringify(doc.settlement?.defaults)} from two agreeing maps`];
  });
}

console.log(all ? "RESULT PASS r42-f12-drift" : "RESULT FAIL r42-f12-drift");
process.exitCode = all ? 0 : 1;
