// Gate PK: clean-machine proof for the bidder bundle (benzo-bidder-<version>.tgz). Builds the bundle
// twice and requires identical sha256, then runs the whole seal-open proof from a fresh /tmp
// directory with an empty HOME and no access to this checkout's node_modules: extract the tarball,
// serve it, drive the sealer headless with the pinned Playwright Chromium, open the ciphertext with
// the pinned Go `tle` after the drand quicknet round and compare the plaintext to the inputs chosen.
// Run: npx esbuild tools/repro/bidder-bundle-proof.ts --bundle --packages=external --platform=node \
//        --format=esm --outfile=tmp/bidder-bundle-proof.mjs && node tmp/bidder-bundle-proof.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const env: Record<string, string> = {};
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2];
}
const CHAIN = env.BNZ_DRAND_CHAIN_HASH, GENESIS = Number(env.BNZ_DRAND_GENESIS), PERIOD = Number(env.BNZ_DRAND_PERIOD);
const DRAND = `${env.BNZ_DRAND_URLS.split(",")[0]}/${CHAIN}`;
const TLE = path.join(root, env.BNZ_STATE_DIR.replace(/^\.\//, ""), "bin", "tle");
const ok = (line: string) => console.log(`OK ${line}`);
const fail = (id: string, why: string): never => { console.log(`ERROR ${id} ${why}`); console.log("FAIL bidder-bundle clean-machine proof"); process.exit(1); };

console.log(`bidder-bundle clean-machine proof — commit ${commit} — ${new Date().toISOString()}`);

// 1. two package:bidder builds must give the identical sha256
const builds: string[] = [];
for (const n of [1, 2]) {
  const out = execFileSync("npm", ["run", "--silent", "package:bidder"], { encoding: "utf8" }).trim().split("\n").pop()!;
  const r = JSON.parse(out) as { tarball: string; sha256: string; bytes: number; files: number };
  builds.push(r.sha256);
  ok(`build-${n} ${r.tarball} sha256=${r.sha256} bytes=${r.bytes} files=${r.files}`);
}
if (builds[0] !== builds[1]) fail("build.identical", `two builds differ: ${builds[0]} vs ${builds[1]}`);
ok(`build-identical ${builds[0]}`);
const tarball = "dist/benzo-bidder-0.1.0.tgz";
if (createHash("sha256").update(readFileSync(tarball)).digest("hex") !== builds[0]) fail("build.sidecar", "tarball bytes differ from the recorded sha256");

// 2. fresh /tmp directory, empty HOME, extract the tarball
const fresh = "/tmp/benzo-bidder-proof", home = path.join(fresh, "home");
rmSync(fresh, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
execFileSync("tar", ["-xzf", path.join(root, tarball), "-C", fresh]);
const bundle = path.join(fresh, "benzo-bidder-0.1.0");
const files = execFileSync("tar", ["-tzf", path.join(root, tarball)], { encoding: "utf8" }).trim().split("\n");
ok(`extract ${tarball} -> ${bundle} (${files.length} entries: ${files.join(" ")})`);

// 3. the same Playwright Chromium the e2e uses (resolved through the pinned playwright-core)
const { chromium } = await import("playwright-core");
const server = await chromium.launchServer();
const chromeExe = server.process().spawnfile;
await server.close();
ok(`chromium ${chromeExe} (Playwright pin @playwright/test ${JSON.parse(readFileSync("package.json", "utf8")).devDependencies["@playwright/test"]})`);

// 4. inputs from the committed signed manifest (docs/evidence/phase-5/markets/launch/cold-f1170469)
const manifestPath = "docs/evidence/phase-5/markets/launch/cold-f1170469/manifest.json";
const manifest = JSON.parse(Buffer.from(JSON.parse(readFileSync(manifestPath, "utf8")).bytes, "base64").toString("utf8"));
const tick = BigInt(manifest.tick_zats), reserve = BigInt(manifest.reserve_zats), cap = BigInt(manifest.B_max_zats);
const steps = Number((cap - reserve) / tick);
const price = (reserve + tick * BigInt(randomBytes(4).readUInt32BE() % (steps + 1))).toString();
const quantity = String(1 + randomBytes(4).readUInt32BE() % manifest.q_max);
// 5. the drand quicknet round: a few rounds ahead of the current one
const latest = (await (await fetch(`${DRAND}/public/latest`)).json() as { round: number }).round;
const round = latest + 5;
const opening = new Date((GENESIS + (round - 1) * PERIOD) * 1000).toISOString();
const inputs = {
  opening,
  auction: manifest.auction_id, price, quantity,
  collateral: String(manifest.C_zats), address: String(manifest.deposit_addresses[0]),
  nonce: randomBytes(16).toString("hex"), owner: randomBytes(32).toString("hex"), commitment: randomBytes(32).toString("hex"),
};
ok(`manifest-inputs ${manifestPath}: auction=${inputs.auction} C=${inputs.collateral} address=${inputs.address.slice(0, 16)}… price=${inputs.price} quantity=${inputs.quantity}`);
ok(`drand-round latest=${latest} sealing-to=${round} opening=${opening}`);

// 6. run the driver inside the fresh directory: empty HOME, environment down to PATH + BR_* only,
// and no NODE_PATH — the driver resolves nothing from this checkout (builtins + absolute tool paths)
copyFileSync("tools/repro/bidder-bundle-driver.mjs", path.join(fresh, "run-proof.mjs"));
const run = spawnSync(process.execPath, ["run-proof.mjs"], {
  cwd: fresh,
  stdio: "inherit",
  env: {
    HOME: home, PATH: process.env.PATH ?? "",
    BR_DIR: bundle, BR_CHROME: chromeExe, BR_TLE: TLE,
    BR_DRAND: DRAND, BR_CHAIN: CHAIN,
    BR_GENESIS: String(GENESIS), BR_PERIOD: String(PERIOD), BR_ROUND: String(round),
    BR_INPUTS: JSON.stringify(inputs),
  },
});
process.exit(run.status ?? 1);
