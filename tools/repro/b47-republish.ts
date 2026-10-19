// B47 settle-e2e harness helper (test-only): the real product publish for one seeded world. The e2e's
// seedPostBatchOne writes the seeded settlement through the real Ledger class and then needs the public dir
// written from exactly those state files — `cli/product.ts publish(id)` — so the red/green legs start from
// the same public document `benzo settle` would have published. No product code changes; the existing
// `bin/benzo settle` publish path is the same function.
// Build: npx esbuild tools/repro/b47-republish.ts --bundle --packages=external --platform=node --format=esm
//   --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);'
//   --outfile=tmp/b47-republish.mjs
// Run (with the world's env, as tools/repro/b47-settle-e2e.ts does): node tmp/b47-republish.mjs AUCTION_ID
import { publish } from "../../cli/product";

publish(process.argv[2] ?? "");
