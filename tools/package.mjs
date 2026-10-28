// tools/package.mjs — build the versioned tarball a stranger can run.
// Output: dist/benzo-<version>.tgz with the CLI bundles, the shipped verify bundle,
// docs/verify-it-yourself.md and the pinned production dependencies (so the extract
// runs with no network install). The shipped verify bundle must match a fresh rebuild
// of this tree (tools/check-bundle.mjs) or packaging stops. Byte-for-byte reproducible
// (tools/deterministic-tar.mjs): two builds — including one from a fresh clone — give
// the identical sha256 recorded in docs/reproducible-build.md.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tarGz } from "./deterministic-tar.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (!pkg.version) throw new Error("package.json needs a version");
const name = `benzo-${pkg.version}`;
const stage = path.join("tmp", "package", name);

execFileSync("npm", ["run", "--silent", "build:cli"], { stdio: "inherit" });
// seal/dist is gitignored build output; a fresh clone must build it before staging.
execFileSync("npm", ["run", "--silent", "build:seal"], { stdio: "inherit" });
execFileSync(process.execPath, ["tools/check-bundle.mjs"], { stdio: "inherit" });

rmSync(path.join("tmp", "package"), { recursive: true, force: true });
mkdirSync(path.join("dist"), { recursive: true });
for (const dir of ["bin", "cli/dist", "seal/dist", "dist", "docs"]) mkdirSync(path.join(stage, dir), { recursive: true });
// A native addon that npm compiled on install (node-gyp's build/ folder, marked by config.gypi) is skipped: macOS
// installs none of them and each package falls back to plain JS, so the tarball is the same on Linux and macOS.
const gypBuild = (src) => path.basename(src) === "build" && existsSync(path.join(src, "config.gypi"));
const copy = (from, to) => cpSync(from, path.join(stage, to), { recursive: true, preserveTimestamps: true, filter: (src) => !gypBuild(src) });
copy("bin/benzo", "bin/benzo");
copy("cli/dist", "cli/dist");
copy("seal/dist", "seal/dist");
copy("dist/benzo-verify.mjs", "dist/benzo-verify.mjs");
copy("docs/verify-bundle.sha256", "docs/verify-bundle.sha256");
copy("docs/verify-it-yourself.md", "docs/verify-it-yourself.md");
copy("README.md", "README.md");
copy("package.json", "package.json");

// Pinned production dependencies, copied exactly (npm ls --omit=dev lists the closure).
const ls = execFileSync("npm", ["ls", "--omit=dev", "--parseable", "--all"], { encoding: "utf8" });
const prefix = root + path.sep;
const deps = ls.split("\n").map(l => l.trim()).filter(l => l.startsWith(prefix + "node_modules"));
if (!deps.length) throw new Error("npm ls returned no production dependencies");
for (const abs of deps) {
  const rel = abs.slice(prefix.length);
  mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
  copy(rel, rel);
}
// The CLI bundles import @playwright/test at load (the `bid seal` browser sealer runs through it),
// and the router loads every command module, so the test runner ships too. Its browser binaries do
// not: `bid seal` needs a Playwright browser install; `benzo verify` and every read path do not.
for (const rel of ["node_modules/@playwright/test", "node_modules/playwright", "node_modules/playwright-core"]) {
  mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
  copy(rel, rel);
}

const result = tarGz(path.join(root, "tmp", "package"), path.join(root, "dist", `${name}.tgz`), { linkRoot: root });
console.log(JSON.stringify({ tarball: `dist/${name}.tgz`, ...result, production_packages: deps.length }, null, 0));
