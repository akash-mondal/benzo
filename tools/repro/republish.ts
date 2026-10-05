// Rebuild a product auction's public directory from its ledger (cli/product.ts publish) — e.g. after a publisher fix.
// Build+run: npx esbuild tools/repro/republish.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/republish.mjs && node tmp/republish.mjs <auction-id>
import { publish } from "../../cli/product";
publish(process.argv[2]); console.log(`republished ${process.argv[2]}`);
