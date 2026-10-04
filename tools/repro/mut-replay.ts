// Mutation replays for the pure-function mutations of PHASE-5 §6 (5M1, 5M3): the buyback spec's own V1b and X1b
// assertions, re-executed against the published data of the live passing run (docs/evidence/phase-5/buyback-run4)
// with the code under test mutated. Each must turn its assertion red.
import { readFileSync } from "node:fs";
import { clearForMode } from "../../clear/registry";
import { checkCertificates, freezeStatement, validateWitnessSet } from "../../witness";
import { clientCommon } from "../../clear/registry";
import { verifyRecord } from "../../manifest/schema";
const d = JSON.parse(readFileSync(process.argv[2], "utf8")), signer = d.signer;
const out: string[] = [];
// V1b: the pure clear on the published opened set must give price 210, outcomes winner,winner,unfilled, treasury 420.
try {
  const pure: any = clearForMode({ manifest: d.manifest, signer, frozen: d.frozen, opened: d.opened, reserve_opening: d.reserve_opening ?? null });
  const ok = pure.clearing_price_zats === "210" && pure.allocations.map((a: any) => a.outcome).join() === "winner,winner,unfilled" && pure.conservation.treasury_zats === "420";
  out.push(`${ok ? "PASS" : "FAIL"} V1b price ${pure.clearing_price_zats} outcomes ${pure.allocations.map((a: any) => a.outcome).join(",")} treasury ${pure.conservation.treasury_zats}`);
} catch (e) { out.push(`FAIL V1b threw ${(e as Error).message}`); }
// X1b: one witness's certificate twice must not satisfy q_w = 2.
try {
  const m = clientCommon(d.manifest, signer).manifest, spec = validateWitnessSet(verifyRecord<any>(d.witness_set, signer), m.auction_id);
  const c = d.witness_cert[0];
  checkCertificates([c, { ...c }], spec, freezeStatement(m, d.frozen));
  out.push("FAIL X1b one witness counted twice reached the quorum");
} catch (e) { out.push(`PASS X1b refused: ${(e as Error).message}`); }
console.log(out.join("\n"));
