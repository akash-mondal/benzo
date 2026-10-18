// Every ESM bundle built by build:core and build:settle must start with the createRequire banner. Without it a
// bundled CommonJS dependency (tlock-js, @noble/curves) fails at load with "Dynamic require of node:crypto is not
// supported". Offline tests never load settle/dist/cli.mjs, so this broke live `auction publish` once (R99).
// Bundles that are not built yet are skipped; the build scripts themselves are checked too.
import { existsSync, readFileSync } from "node:fs";
const banner = 'import { createRequire } from "module"; const require = createRequire(import.meta.url);';
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const bad = [];
for (const k of ["build:core", "build:settle"]) {
  for (const step of pkg.scripts[k].split(" && ")) {
    if (!step.startsWith("esbuild ") || !step.includes("--format=esm")) continue;
    if (!step.includes("--banner:js=")) bad.push(`${k}: ${step.split(" ")[1]} has no --banner:js`);
    const out = step.match(/--outfile=(\S+)/)?.[1];
    if (out && existsSync(out) && !readFileSync(out, "utf8").startsWith(banner)) bad.push(`${out} does not start with the createRequire banner (rebuild)`);
  }
}
if (bad.length) { for (const b of bad) console.log(`ERROR check:dist-require ${b}`); process.exit(1); }
console.log("OK check:dist-require every build:core/build:settle ESM bundle carries the createRequire banner");
