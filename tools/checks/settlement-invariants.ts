// Agent-friendly (class A: settlement wedges / double backing on third-party-growable chain state; ~12 Reviewer R
// P0/P1). Property test of the pure balance-settlement rule over random chain histories. Invariants:
//   I1 never throws on valid chain state;  I2 one note backs at most one row/source;
//   I3 an unmatured note (< 10 confirmations) is invisible;  I4 value conservation over matured notes.
import { balanceSettlement } from "../../clear/features";
let seed = Number(process.argv[2] ?? 1);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const fails: Record<string, number> = { I1: 0, I2: 0, I3: 0, I4: 0 }; let example: Record<string, string> = {};
for (let iter = 0; iter < 3000; iter++) {
  const start = 1000, blocks = 40, end = start + blocks, tip = end + Math.floor(rnd() * 25) + 1;
  const deposits = ["d0", "d1", "d2", "d3"], balance = ["b0", "b1", "b2", "b3"];
  const m: any = { deposit_addresses: deposits, confirmations: 10, bond: { balance_window_start_height: start, balance_window_blocks: blocks, balance_addresses: balance } };
  const leaves = [0, 1, 2].map((i) => ({ leaf_index: i, deposit: { address: deposits[i] } })); // slot d3 has no leaf
  const allocations = leaves.map((l) => { const fill = rnd() < 0.6 ? 1 : 0; return { leaf_index: l.leaf_index, fill, balance_due_zats: fill ? String(100000 + Math.floor(rnd() * 3) * 100000) : "0" }; });
  const notes = Array.from({ length: Math.floor(rnd() * 8) }, (_, k) => ({ txid: (iter * 16 + k).toString(16).padStart(64, "0"), pool: "ironwood", action_index: 0, address: pick(balance),
    height: rnd() < 0.1 ? null : start - 20 + Math.floor(rnd() * (tip - start + 20)), value_zats: pick([0, 20000, 100000, 200000, 300000]) }));
  // R-AF-6: a scan may list one note twice; a duplicate must change nothing.
  if (notes.length && rnd() < 0.3) notes.push({ ...notes[Math.floor(rnd() * notes.length)] });
  const bondVoid = rnd() < 0.25; // R-AF-7: the void path is exercised too
  let out: any;
  try { out = balanceSettlement(m, { allocations } as any, leaves as any, notes as any, tip, bondVoid); }
  catch (e) { fails.I1++; example.I1 ??= (e as Error).message; continue; }
  const matured = (n: any) => !!n.height && tip - n.height + 1 >= 10, key = (n: any) => `${n.txid}:${n.pool}:${n.action_index}`;
  // R42 (F15): a note backs at most one REFUND row (an in-window note may split between the settled due and its excess row).
  const backed: string[] = out.refunds.flatMap((r: any) => r.notes ?? []);
  if (new Set(backed).size !== backed.length) { fails.I2++; example.I2 ??= JSON.stringify(backed); }
  backed.push(...out.sources.map((s: string) => s.replace(/^balance:/, "")));
  const unmatured = new Set(notes.filter((n) => !matured(n)).map(key));
  if (backed.some((b) => unmatured.has(b))) { fails.I3++; example.I3 ??= `unmatured note backs a row at tip ${tip}`; }
  const uniq = [...new Map(notes.map((n) => [key(n), n])).values()]; // one note is one note
  const withLeaf = uniq.filter((n) => matured(n) && Number(n.value_zats) > 0 && balance.indexOf(n.address) < 3);
  const total = withLeaf.reduce((s, n) => s + Number(n.value_zats), 0);
  const refunded = out.refunds.reduce((s: number, r: any) => s + Number(r.amount_zats), 0);
  const settled = bondVoid ? 0 : allocations.filter((a) => a.fill > 0).reduce((s, a) => { // a void bond settles nothing
    const inW = withLeaf.filter((n) => n.address === balance[a.leaf_index] && n.height! > start && n.height! <= end).reduce((x, n) => x + Number(n.value_zats), 0);
    return s + (inW >= Number(a.balance_due_zats) && Number(a.balance_due_zats) > 0 ? Number(a.balance_due_zats) : 0); }, 0);
  if (refunded + settled !== total) { fails.I4++; example.I4 ??= `refunded ${refunded} + settled ${settled} != matured ${total}`; }
}
console.log(JSON.stringify({ fails, example }));
process.exitCode = Object.values(fails).some((v) => v > 0) ? 1 : 0;
