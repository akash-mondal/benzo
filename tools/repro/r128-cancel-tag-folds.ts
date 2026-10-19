// R128: runs cli-auction's r26-1 and r23-2 folds standalone (offline). They build a cancelled auction whose R is 30 days
// out and need `sign envelope-opens` to authenticate framing-v2 tag-bound records with NO beacon. Red at 7526940 (the
// final RG's cli-auction: r26-1-report-parties, r26-1-two-refund-rows, r23-2-report-signed), green after.
// Build+run: npx esbuild tools/repro/r128-cancel-tag-folds.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r128.mjs && node tmp/r128.mjs
import { foldR261 } from "../../e2e/lib/readpath-r261";
import { foldR232 } from "../../e2e/lib/readpath-r232";
let fails = 0;
const run: any = {
  check: async (id: string, _t: string, fn: () => any) => { try { await fn(); console.log("PASS", id); } catch (e) { fails++; console.log("FAIL", id, String((e as Error).message).slice(0, 300)); } },
  notRun: (ids: string[], why: string) => { fails++; console.log("NOTRUN", ids.join(","), why); },
  narrowed: (id: string, why: string) => console.log("NARROWED", id, why),
};
for (const f of [foldR261, foldR232]) await f(run);
console.log(fails ? `RESULT FAIL ${fails}` : "RESULT PASS"); process.exit(fails ? 1 : 0);
