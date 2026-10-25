// Bundles the gateway (and the repo modules it imports) into gateway/dist/server.mjs.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, "server.ts")], outfile: path.join(here, "dist/server.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", logLevel: "warning",
  banner: { js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);' },
});
console.log("gateway/dist/server.mjs");
