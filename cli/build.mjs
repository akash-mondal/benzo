import {build} from 'esbuild';
import {readdirSync,mkdirSync,readFileSync} from 'node:fs';
// every pinned package stays external (Node loads its real dist), except @scopelift/stealth-address-sdk:
// its dist uses bundler-only directory imports (`./utils/crypto`) that Node ESM refuses to resolve, so
// esbuild inlines it (and its unlisted transitives) into the bundles that need stealth delivery (R19).
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const options={bundle:true,platform:'node',format:'esm',external:[...Object.keys(pkg.dependencies),...Object.keys(pkg.devDependencies)].filter(d=>d!=='@scopelift/stealth-address-sdk'),logLevel:'warning',
  // the inlined SDK pulls CJS transitives whose require() calls of external packages need a real require
  banner:{js:'import { createRequire } from "module"; const require = createRequire(import.meta.url);'}};
mkdirSync('cli/dist/commands',{recursive:true});
await build({...options,entryPoints:['cli/benzo.ts'],outfile:'cli/dist/benzo.mjs'});
for(const file of readdirSync('cli/commands').filter(f=>f.endsWith('.ts')))await build({...options,entryPoints:['cli/commands/'+file],outfile:'cli/dist/commands/'+file.replace(/\.ts$/,'.mjs')});

mkdirSync('api/dist',{recursive:true});await build({...options,entryPoints:['api/server.ts'],outfile:'api/dist/server.mjs'});
