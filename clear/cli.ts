// Pure shipped boundary: stdin ClearInput JSON -> canonical result JSON. Opening is a separate Go tle operation.
import { readFileSync } from "node:fs";
import { jsonBytes } from "../manifest/schema";
import { clear } from "./core";
try { process.stdout.write(jsonBytes(clear(JSON.parse(readFileSync(0,"utf8"))))); }
catch(e) { process.stderr.write(`ERROR clear ${(e as Error).message}\n`); process.exitCode=1; }
