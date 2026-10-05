// Sweep the global development vault back to the bidder wallet (the cli-auction spec's own cleanup, standalone): used
// when a run's post-test sweep failed and the next run's precondition refuses a non-empty vault.
// Build+run: npx esbuild tools/repro/sweep-vault.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/sweep.mjs && node tmp/sweep.mjs
import { mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT, STATE } from "../../e2e/lib/env";
import { startFrostd, zcashSign } from "../../e2e/lib/frost";
import * as z from "../../e2e/lib/zcash";

z.sync("vault"); z.enhance("vault");
const live = z.scanVault().filter(n => n.height && !n.spent_in_txid && n.value_zats > 0);
console.log(`vault notes to sweep: ${live.length} (${live.reduce((s, n) => s + n.value_zats, 0)} zats)`);
if (live.length) {
  const stop = await startFrostd();
  try {
    const dir = path.join(STATE, "run", `sweep-${Date.now()}`); mkdirSync(dir, { recursive: true });
    const to = z.run(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).trim().split("\n").at(-1)!;
    z.pczt("vault", "create-max", "--address", to, "--output", path.join(dir, "created.pczt"));
    z.pczt("vault", "prove", path.join(dir, "created.pczt"), "--output", path.join(dir, "proven.pczt"));
    await zcashSign(path.join(dir, "proven.pczt"), path.join(dir, "signed.pczt"));
    console.log(`swept ${z.send(path.join(dir, "signed.pczt"))}`);
  } finally { stop(); }
}
