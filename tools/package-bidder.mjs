// tools/package-bidder.mjs — package the existing browser sealer (seal/) as the bidder
// release artifact. Packaging only: seal/src and seal/index.html are untouched. Builds seal/dist
// from this tree and writes dist/benzo-bidder-<version>.tgz plus its sha256 sidecar, byte-for-byte
// reproducible (tools/deterministic-tar.mjs).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpSync } from "node:fs";
import path from "node:path";
import { tarGz } from "./deterministic-tar.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (!pkg.version) throw new Error("package.json needs a version");
const name = `benzo-bidder-${pkg.version}`;

execFileSync("npm", ["run", "--silent", "build:seal"], { stdio: "inherit" });

const stage = path.join("tmp", "package-bidder");
rmSync(stage, { recursive: true, force: true });
const dir = path.join(stage, name);
mkdirSync(dir, { recursive: true });
for (const file of ["index.html", "main.js"]) cpSync(path.join("seal", "dist", file), path.join(dir, file));

mkdirSync("dist", { recursive: true });
const out = path.join("dist", `${name}.tgz`);
const result = tarGz(stage, out);
writeFileSync(`${out}.sha256`, `${result.sha256}  ${out}\n`);
console.log(JSON.stringify({ tarball: out, ...result }));
