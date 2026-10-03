import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
// With an outfile argument (check:bundle) the build goes to that path and no sha256 is written;
// `npm run build:verify` (no argument) rebuilds the shipped bundle and its committed digest.
const out = process.argv[2] ?? 'dist/benzo-verify.mjs';
await build({entryPoints:['cli/verify-standalone.ts'],bundle:true,platform:'node',format:'esm',
  banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'},
  outfile:out,logLevel:'warning'});
if (!process.argv[2]) writeFileSync('docs/verify-bundle.sha256',createHash('sha256').update(readFileSync(out)).digest('hex')+'  dist/benzo-verify.mjs\n');
