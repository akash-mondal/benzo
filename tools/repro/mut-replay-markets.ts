// Mutation replays for part 2's pure-clear mutations (5M8–5M10): the markets assertions (outcomes and clearing price)
// re-executed with the code under test mutated, on the published data of the live passing runs
// (docs/evidence/phase-5/markets: revision-cold, rfq-cold). Each mutation must turn its assertion red.
import { readFileSync } from "node:fs";
import { clearForMode } from "../../clear/registry";
const [revision, rfq] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, "utf8")));
const pure = (d: any): any => clearForMode({ manifest: d.manifest, signer: d.signer, frozen: d.frozen, opened: d.opened, reserve_opening: d.reserve_opening ?? null, launch: d.launch_input });
const line = (id: string, f: () => [boolean, string]) => { try { const [ok, d] = f(); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`); } catch (e) { console.log(`FAIL ${id} threw ${(e as Error).message}`); } };
line("revision", () => { const r = pure(revision), o = r.allocations.map((a: any) => a.outcome).join(","); return [o === "superseded,unfilled,winner" && r.clearing_price_zats === "300", `outcomes ${o} price ${r.clearing_price_zats}`]; });
line("rfq", () => { const r = pure(rfq), o = r.allocations.map((a: any) => a.outcome).join(","); return [o === "unfilled,winner,not_allowlisted" && r.clearing_price_zats === "400", `outcomes ${o} price ${r.clearing_price_zats}`]; });
