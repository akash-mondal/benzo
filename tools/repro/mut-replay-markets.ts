// Mutation replays for part 2's market mutations: the spec's assertions re-executed with the code under test
// mutated (5M6/5M7) or with the attack applied (5M11), on the published data of the live passing runs
// (docs/evidence/phase-5/markets: revision-cold, rfq-cold, and the R33 drop's cold dir). Each mutation must turn
// its assertion red:
//   5M6  (a pre-window note counts as payment)      -> FAIL drop-defaults-window
//   5M7  (a default refunded instead of forfeited)  -> FAIL drop-forfeit
//   5M11 (a coordinator-swapped defaults list)      -> FAIL drop-swapped-defaults-refused (verify accepts it)
// The drop's window assertion needs notes, which no published document carries: the replay feeds the shipped
// balanceDefaults the run's own manifest/result/leaves with the P1-1 window fixture — the operator pre-funds the
// defaulting winner's (leaf 2's) balance address before the window opens (300,000 at start-1) and the paying
// winner (leaf 0) pays 300,000 inside the window. Only the lower bound separates them.
// Usage: node tmp/mut-replay-markets.mjs <revision-cold.json> <rfq-cold.json> <drop-cold-dir> [launch-cold-dir]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { clearForMode, modeEntry } from "../../clear/registry";
import { balanceDefaults } from "../../clear/features";
import { deliveryRowOrder } from "../../clear/launch";
import { jsonBytes, verifyRecord } from "../../manifest/schema";
import { validateWitnessSet, verifyApprovalMap } from "../../witness";
import { ROOT } from "../../e2e/lib/env";
import { benzoBin } from "../../e2e/lib/hosts";

const [revision, rfq, dropDir, launchDir] = process.argv.slice(2);
const doc = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const pure = (d: any): any => clearForMode({ manifest: d.manifest, signer: d.signer, frozen: d.frozen, opened: d.opened, reserve_opening: d.reserve_opening ?? null, launch: d.launch_input });
const line = (id: string, f: () => [boolean, string]) => {
  try {
    const [ok, d] = f();
    console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
    if (!ok) console.log(`ERROR ${id} ${d}`);
  } catch (e) {
    console.log(`FAIL ${id} threw ${(e as Error).message}`);
    console.log(`ERROR ${id} threw ${(e as Error).message}`);
  }
};

const rev = doc(revision), rfqq = doc(rfq);
line("revision", () => { const r = pure(rev), o = r.allocations.map((a: any) => a.outcome).join(","); return [o === "superseded,unfilled,winner" && r.clearing_price_zats === "300", `outcomes ${o} price ${r.clearing_price_zats}`]; });
line("rfq", () => { const r = pure(rfqq), o = r.allocations.map((a: any) => a.outcome).join(","); return [o === "unfilled,winner,not_allowlisted" && r.clearing_price_zats === "400", `outcomes ${o} price ${r.clearing_price_zats}`]; });

// ---- the R33 drop's bond-then-pay assertions (A15 item 4) -------------------------------------------
const drop = doc(path.join(dropDir, "auction.json"));
const set = validateWitnessSet(verifyRecord(drop.witness_set, drop.signer), drop.auction_id);
const m = JSON.parse(Buffer.from(drop.manifest.bytes, "base64").toString("utf8"));
const start = m.bond.balance_window_start_height, blocks = m.bond.balance_window_blocks;
const slot = (leaf: number) => m.bond.balance_addresses[m.deposit_addresses.indexOf(drop.frozen.leaves[leaf].deposit.address)];
const fixtureNotes = [
  { address: slot(2), height: start - 1, value_zats: 300_000 }, // the operator pre-funds the defaulter (P1-1)
  { address: slot(0), height: start + 2, value_zats: 300_000 }, // the paying winner, inside (start, start+blocks]
];
line("drop-defaults", () => {
  const d = drop.settlement?.defaults ?? null;
  return [JSON.stringify(d) === "[2]", `published defaults ${JSON.stringify(d)}`];
});
line("drop-defaults-maps", () => {
  const maps = (drop.settlement?.approval_maps ?? []).filter((mp: any) => mp && verifyApprovalMap(mp, set.keys) && mp.auction_id === drop.auction_id && JSON.stringify(mp.defaults) === "[2]");
  return [new Set(maps.map((mp: any) => mp.witness)).size >= 2, `${maps.length} agreeing verified maps`];
});
line("drop-defaults-window", () => {
  const d = balanceDefaults(m, drop.result, drop.frozen.leaves, fixtureNotes as any, start + blocks + 5);
  return [JSON.stringify(d) === "[2]", `defaults ${JSON.stringify(d)} (a pre-window note must not count as payment; fixture (${start - 1}, ${start + 2}] in (${start}, ${start + blocks}])`];
});
const C = 200_000;
line("drop-forfeit", () => {
  const owed = Object.fromEntries([...modeEntry(drop.manifest).obligations(drop.result, { defaults: [2] })].map(([p, v]) => [p, Number(v)]));
  const want = { "leaf:1": C, "leaf:3": C, seller: 700_000 };
  return [JSON.stringify(Object.entries(owed).sort()) === JSON.stringify(Object.entries(want).sort()), `obligations ${JSON.stringify(owed)} want ${JSON.stringify(want)} (the defaulter's bond is forfeited to the seller)`];
});
line("drop-swapped-defaults-refused", () => {
  const swapped = path.join(ROOT, "tmp/mut-replay-drop-swap");
  rmSync(swapped, { recursive: true, force: true }); mkdirSync(swapped, { recursive: true }); cpSync(dropDir, swapped, { recursive: true });
  for (const f of ["auction.json", "summary.json"]) {
    const tdoc = doc(path.join(swapped, f));
    if (f === "auction.json") tdoc.settlement.defaults = [0]; else tdoc.defaults = [0];
    writeFileSync(path.join(swapped, f), jsonBytes(tdoc));
  }
  const v = spawnSync(benzoBin, ["verify", "--dir", swapped, "--signer", drop.signer], { encoding: "utf8", maxBuffer: 64 << 20 });
  const out = v.stdout + v.stderr;
  // The specific defaults ERROR is the assertion (see tools/repro/markets.ts dropPost).
  return [v.status !== 0 && /ERROR defaults refused: settlement defaults differ from the host-signed approval maps/.test(out),
    `swapped [0] verify exit ${v.status} (${out.split("\n").filter(l => /^ERROR|^OK defaults/.test(l)).join(" | ")})`];
});

// ---- R34.2 (A16 item 1): the launch delivery rows are canonical (destination bytes, then amount) and never
// winner leaf order, and `benzo verify` replays the same sort over the result's allocation root. Mutation A16-a
// restores winner leaf order in the published allocation.json only; the row-order assertion goes red and verify
// must refuse the file with its own error (launch allocation rows not in canonical order).
if (launchDir) {
  const launch = doc(path.join(launchDir, "auction.json"));
  const rows = doc(path.join(launchDir, "allocation.json")).rows as { destination: string; amount: number }[];
  const recs: { leaf_index: number; destinations: string[] }[] = launch.launch_input?.delivery ?? [];
  const leafRows = launch.result.allocations.filter((a: any) => a.fill > 0).flatMap((a: any) => {
    const rec = recs.find((r: any) => r.leaf_index === a.leaf_index)!;
    return rec.destinations.map((destination: string) => ({ destination, amount: a.fill / rec.destinations.length }));
  });
  line("launch-meet-allocation-order", () => {
    const key = (rs: { destination: string; amount: number }[]) => JSON.stringify(rs.map(r => [r.destination, r.amount]));
    const canonical = key(rows) === key([...rows].sort(deliveryRowOrder));
    const decorrelated = rows.length > 1 ? key(rows) !== key(leafRows) : true;
    const v = spawnSync(benzoBin, ["verify", "--dir", launchDir, "--signer", launch.signer], { encoding: "utf8", maxBuffer: 64 << 20 });
    const err = (v.stdout + v.stderr).split("\n").filter((l: string) => l.startsWith("ERROR")).join(" | ");
    return [canonical && decorrelated && v.status === 0,
      `canonical=${canonical} decorrelated=${decorrelated}; verify exit ${v.status}${err ? ` (${err})` : ""}`];
  });
}
