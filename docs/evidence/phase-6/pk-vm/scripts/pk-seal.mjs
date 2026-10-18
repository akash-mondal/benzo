// Stranger-side seal: the same steps 4-6 as tools/repro/bidder-bundle-proof.ts, with inputs from the
// published launch manifest and the drand quicknet constants; runs the copied driver in a fresh dir.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const H = process.env.HOME;
const env = Object.fromEntries(readFileSync(`${H}/in/drand.env`, "utf8").trim().split("\n").map(l => l.split(/=(.*)/s).slice(0, 2)));
const CHAIN = env.BNZ_DRAND_CHAIN_HASH, GENESIS = Number(env.BNZ_DRAND_GENESIS), PERIOD = Number(env.BNZ_DRAND_PERIOD);
const DRAND = `${env.BNZ_DRAND_URLS.split(",")[0]}/${CHAIN}`;
const manifest = JSON.parse(Buffer.from(JSON.parse(readFileSync(`${H}/in/bid-manifest.json`, "utf8")).bytes, "base64").toString("utf8"));
const tick = BigInt(manifest.tick_zats), reserve = BigInt(manifest.reserve_zats), cap = BigInt(manifest.B_max_zats);
const steps = Number((cap - reserve) / tick);
const price = (reserve + tick * BigInt(randomBytes(4).readUInt32BE() % (steps + 1))).toString();
const quantity = String(1 + randomBytes(4).readUInt32BE() % manifest.q_max);
const latest = (await (await fetch(`${DRAND}/public/latest`)).json()).round;
const round = latest + 5;
const opening = new Date((GENESIS + (round - 1) * PERIOD) * 1000).toISOString();
const inputs = { opening, auction: manifest.auction_id, price, quantity, collateral: String(manifest.C_zats),
  address: String(manifest.deposit_addresses[0]), nonce: randomBytes(16).toString("hex"),
  owner: randomBytes(32).toString("hex"), commitment: randomBytes(32).toString("hex") };
console.log(`OK manifest-inputs bid-manifest.json: auction=${inputs.auction} C=${inputs.collateral} address=${inputs.address.slice(0, 16)}… price=${price} quantity=${quantity}`);
console.log(`OK drand-round latest=${latest} sealing-to=${round} opening=${opening}`);
const shellDir = `${H}/.cache/ms-playwright/chromium_headless_shell-1243`;
const sub = readdirSync(shellDir).find(d => d.startsWith("chrome-"));
const CHROME = path.join(shellDir, sub, "chrome-headless-shell");
const r = spawnSync(process.execPath, ["run-proof.mjs"], { cwd: process.cwd(), stdio: "inherit", env: {
  HOME: process.env.HOME, PATH: process.env.PATH, BR_DIR: path.resolve("benzo-bidder-0.1.0"), BR_CHROME: CHROME,
  BR_TLE: `${H}/gopath/bin/tle`, BR_DRAND: DRAND, BR_CHAIN: CHAIN, BR_GENESIS: String(GENESIS),
  BR_PERIOD: String(PERIOD), BR_ROUND: String(round), BR_INPUTS: JSON.stringify(inputs) } });
process.exit(r.status ?? 1);
