// Product router: each command module owns its noun, verb, help and run(args) boundary.
import {readdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'commands');
try {
  const commands=await Promise.all(readdirSync(dir).filter(n=>n.endsWith('.mjs')).map(n=>import(pathToFileURL(path.join(dir,n)).href)));
  const args=process.argv.slice(2),command=commands.find(c=>c.noun===args[0]&&(c.verb?c.verb===args[1]:true));
  if(!args.length||args[0]==='--help')console.log(commands.map(c=>c.help).join('\n'));
  else if(!command) {console.error('ERROR usage unknown command; run benzo --help');process.exitCode=2}
  else if(args.includes('--help'))console.log(command.help);
  else {const value=await command.run(args.slice(command.verb?2:1));if(typeof value==='number')process.exitCode=value;else if(value!==undefined)console.log(JSON.stringify(value))}
} catch(e) {console.error(`ERROR benzo ${(e as Error).message}`);process.exitCode=1}
