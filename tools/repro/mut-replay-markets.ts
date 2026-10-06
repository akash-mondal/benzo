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
// Usage: node tmp/mut-replay-markets.mjs <revision-cold.json> <rfq-cold.json> <drop-cold-dir>
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { clearForMode, modeEntry } from "../../clear/registry";
import { balanceDefaults } from "../../clear/features";
import { jsonBytes } from "../../manifest/schema";
import { ROOT } from "../../e2e/lib/env";
import { benzoBin } from "../../e2e/lib/hosts";

const [revision, rfq, dropDir] = process.argv.slice(2);
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
const m = JSON.parse(Buffer.from(drop.manifest.bytes, "base64").toString("utf8"));
const start = m.bond.balance_window_start_height, blocks = m.bond.balance_window_blocks;
const slot = (leaf: number) => m.bond.balance_addresses[m.deposit_addresses.indexOf(drop.frozen.leaves[leaf].deposit.address)];
const fixtureNotes = [
  { address: slot(2), height: start - 1, value_zats: 300_000 }, // the operator pre-funds the defaulter (P1-1)
  { address: slot(0), height: start + 2, value_zats: 300_000 }, // the paying winner, inside (start, start+blocks]
];
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
  return [v.status !== 0 && /ERROR defaults refused: settlement defaults differ from the host-signed approval maps/.test(out) && /OK accounting/.test(out),
    `swapped [0] verify exit ${v.status} (${out.split("\n").filter(l => /ERROR defaults|OK accounting/.test(l)).join(" | ")})`];
});
