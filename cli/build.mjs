import {build} from 'esbuild';
import {readdirSync,mkdirSync} from 'node:fs';
const options={bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'warning'};
mkdirSync('cli/dist/commands',{recursive:true});
await build({...options,entryPoints:['cli/benzo.ts'],outfile:'cli/dist/benzo.mjs'});
for(const file of readdirSync('cli/commands').filter(f=>f.endsWith('.ts')))await build({...options,entryPoints:['cli/commands/'+file],outfile:'cli/dist/commands/'+file.replace(/\.ts$/,'.mjs')});
