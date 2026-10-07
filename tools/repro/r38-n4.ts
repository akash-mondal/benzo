// Ruling R38 item 4 (N4, A17 item 4) lab repro over REAL chain data: the drop-r33 run's late balance payment
// (`f73de8b8`, mined at 4469411 — outside its manifest window (4469383, 4469395]) is exactly the reviewer's
// stranded note. The shipped shared rule (clear/features.ts balanceSettlement) must show:
//   n4-refund-row  the late note becomes a refund row to that slot's earliest winning leaf (leaf 0, whose own
//                  refund destination it takes) — the row the plan parks as an exception and the claim path pays;
//   n4-no-sweep    the late note is never a settlement source (never swept into change): the sources list is
//                  exactly the in-window payment `ac51f698`;
//   n4-defaults    the late note never counts as payment (defaults stay [2]) and the pre-window dust case
//                  (synthetic, at leaf 0's balance address below the window start) neither counts as payment
//                  nor is refused — the N2 refusal over third-party chain state is gone (its red leg replays
//                  over the A17 item 6 live run, docs/evidence/phase-5/mutations/A17-N2).
// The values are the run's own: the manifest/result/leaves from docs/evidence/phase-5/markets/drop-r33/drop-cold
// and the notes from a fresh benzo-scan of that auction's vault against the live lightwalletd.
// Run: npx esbuild tools/repro/r38-n4.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r38-n4.mjs && node tmp/r38-n4.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { balanceDefaults, balanceSettlement } from "../../clear/features";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR || ".benzo");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r38-n4.mjs (tools/repro/r38-n4.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const ID = "9c1974b33d2c733ba592c8f60a9090824e13b17f7c09917d77e3fc9d70226254";
const COLD = path.join(ROOT, "docs/evidence/phase-5/markets/drop-r33/drop-cold");
const doc = (f: string) => JSON.parse(readFileSync(path.join(COLD, f), "utf8"));
const manifest = JSON.parse(Buffer.from(doc("manifest.json").bytes, "base64").toString("utf8"));
const result = doc("result.json"), frozen = doc("frozen.json");

// A fresh scan of that auction's own vault (real chain data; sync + enhance first — the scanner needs the memos).
const vault = path.join(STATE, "vaults", ID, "wallet");
const devtool = path.join(STATE, "bin", "zcash-devtool"), lwd = process.env.BNZ_LWD_URL!;
for (const v of ["sync", "enhance"]) {
  const r = spawnSync(devtool, ["wallet", "-w", vault, v, "-s", lwd], { encoding: "utf8" });
  if (r.status !== 0) { console.log(`ERROR n4-scan wallet ${v} failed: ${(r.stderr ?? "").trim().slice(-160)}`); process.exit(1); }
}
const notes = spawnSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", vault], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout
  .trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
const start = manifest.bond.balance_window_start_height, blocks = manifest.bond.balance_window_blocks;
const slot = (leaf: number) => manifest.bond.balance_addresses[manifest.deposit_addresses.indexOf(frozen.leaves[leaf].deposit.address)];
const late = notes.filter((n: any) => n.address === slot(0) && n.height && n.height > start + blocks);
const inWindow = notes.filter((n: any) => n.address === slot(0) && n.height && n.height > start && n.height <= start + blocks);
console.log(`window (${start}, ${start + blocks}] from the run's own signed manifest; late note(s) at leaf 0's balance address: ${late.map((n: any) => `${n.txid.slice(0, 8)}@${n.height}=${n.value_zats}`).join(",")} (f73de8b8: the run's log printed "at height 4469411" — its SEND tip; the note mined at 4469413, out of window either way)`);

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};

const settled = balanceSettlement(manifest as any, result as any, frozen.leaves as any, notes as any, 4469500);
// Ruling R40 item 2 (F2): each late note is its OWN immutable row — `balance-late:<txid>:<pool>:<action_index>`
// to that slot's own leaf — so a newly seen note adds a new row and never grows an existing one.
const lateRows = (ns: any[]) => ns.map(n => ({ party: `balance-late:${n.txid}:${n.pool}:${n.action_index}`, leaf_index: 0, amount_zats: String(n.value_zats) })).sort((a, b) => a.party.localeCompare(b.party));
const shape = (rs: any[]) => rs.map(r => ({ party: r.party, leaf_index: r.leaf_index, amount_zats: r.amount_zats })); // R41.3 maturity flag excluded (r41-f9-confirmations.ts owns it)
// n4-refund-row: one immutable refund row per late note — to that slot's own leaf (leaf 0), for the note's value.
line("n4-refund-row", late.length > 0 && JSON.stringify(shape(settled.refunds)) === JSON.stringify(lateRows(late)),
  `refunds ${JSON.stringify(settled.refunds)} want ${JSON.stringify(lateRows(late))} (one immutable row per late note, to that slot's own leaf)`);
// n4-no-sweep: the settlement's sources are exactly the in-window payment(s) — the late note is never swept.
const wantSources = inWindow.map((n: any) => `balance:${n.txid}:${n.pool}:${n.action_index}`).sort();
line("n4-no-sweep", JSON.stringify([...settled.sources].sort()) === JSON.stringify(wantSources) && wantSources.length > 0 && settled.sources.every(s => !late.some((n: any) => s.includes(n.txid))),
  `sources ${JSON.stringify(settled.sources)} want ${JSON.stringify(wantSources)} (out-of-window notes are never settlement sources)`);
// n4-defaults: the late note never counts as payment, and pre-window dust neither counts nor is refused (N2 gone).
line("n4-defaults", JSON.stringify(balanceDefaults(manifest as any, result as any, frozen.leaves as any, notes as any, 4469500)) === "[2]",
  `defaults ${JSON.stringify(balanceDefaults(manifest as any, result as any, frozen.leaves as any, notes as any, 4469500))} (the late payment never rescues a default)`);
{
  const dust = { txid: "d".repeat(64), pool: "ironwood", action_index: 0, address: slot(0), height: start - 1, value_zats: 5000 };
  const dusted = [...notes, dust];
  const d = balanceDefaults(manifest as any, result as any, frozen.leaves as any, dusted as any, 4469500);
  const s2 = balanceSettlement(manifest as any, result as any, frozen.leaves as any, dusted as any, 4469500);
  // F2: the dust note adds its OWN row; the existing rows never change (immutable per note).
  line("n4-prewindow-dust", JSON.stringify(d) === "[2]" && JSON.stringify(shape(s2.refunds)) === JSON.stringify(lateRows([...late, dust])) && s2.sources.length === wantSources.length,
    `defaults ${JSON.stringify(d)}, refunds ${JSON.stringify(s2.refunds)} (pre-window dust never counts as payment and is refused by nothing: it adds its own per-note refund row)`);
}

console.log(all ? "RESULT PASS r38-n4" : "RESULT FAIL r38-n4");
process.exitCode = all ? 0 : 1;
