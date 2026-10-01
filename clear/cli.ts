// Pure shipped boundary: stdin ClearInput JSON -> canonical result JSON. Opening is a separate Go tle operation.
// Gate EN: the signed manifest's clearing.mode dispatches through the registry, so signer recomputation covers
// every mode through one code path.
import { readFileSync } from "node:fs";
import { jsonBytes } from "../manifest/schema";
import { clearForMode } from "./registry";
try { process.stdout.write(jsonBytes(clearForMode(JSON.parse(readFileSync(0,"utf8"))))); }
catch(e) { process.stderr.write(`ERROR clear ${(e as Error).message}\n`); process.exitCode=1; }
