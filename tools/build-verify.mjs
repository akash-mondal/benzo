import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
await build({entryPoints:['cli/verify-standalone.ts'],bundle:true,platform:'node',format:'esm',
  banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'},
  outfile:'dist/benzo-verify.mjs',logLevel:'warning'});
writeFileSync('docs/verify-bundle.sha256',createHash('sha256').update(readFileSync('dist/benzo-verify.mjs')).digest('hex')+'  dist/benzo-verify.mjs\n');
