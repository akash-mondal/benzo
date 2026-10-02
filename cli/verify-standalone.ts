import { run } from "./commands/verify";
process.exitCode = await run(process.argv.slice(2));
