// H11 (docs/design/phase7-h10-h11.md): `open` decrypts offline from one verified beacon. The repro seals a
// fixture auction with real tlock to a past quicknet round (the tools/bench.ts machinery) and runs the REAL
// `open` boundary (clear/dist/auction.mjs) in both trees:
//   before — the base commit: its open fails when the first BNZ_DRAND_URLS relay is dead, and with a working
//            relay it opens through one Go `tle` run per leaf (the baseline openings are saved here);
//   after  — the fixed open with the same dead first relay succeeds offline from the one verified beacon, and
//            its opened set is byte-identical to the baseline (including one deliberately undecryptable leaf
//            and one bad-MAC case), `benzo verify` passes on the opened fixture, a forged beacon stops the open
//            (never a bad bid), and a reorged leaf stays {error:"reorg"}.
// Build+run:
//   npx esbuild tools/repro/h11-open-offline.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/h11.mjs
//   (base open bundle, the H11 fix reversed into the tree: npx esbuild clear/auction-cli.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/h11/base-auction.mjs)
//   (green open bundle from the fixed tree: npm run build:core)
//   node tmp/h11.mjs before && node tmp/h11.mjs after
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { jsonBytes } from "../../manifest/schema";
import { buildAuction, fetchBeacon, needRealPczt, writeAuctionLedger, writeHostState, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/h11.mjs before|after"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/h11.mjs ${part} (tools/repro/h11-open-offline.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
const WORK = path.join(ROOT, "tmp", "h11");
mkdirSync(WORK, { recursive: true });
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT;
const BASE_BUNDLE = path.join(WORK, "base-auction.mjs"), GREEN_BUNDLE = path.join(ROOT, "clear", "dist", "auction.mjs");
const BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
const TLE = process.env.BNZ_REAL_TLE ?? path.join(ROOT, "tmp", "b39-tools", "bin", "tle");
if (!existsSync(TLE)) throw new Error(`real Go tle needed for the base-commit baseline at ${TLE} (GOBIN=... go install github.com/drand/tlock/cmd/tle@v1.2.0)`);
if (!existsSync(BASE_BUNDLE)) throw new Error(`${BASE_BUNDLE} missing — build the base-commit open bundle first (see the header)`);
const DEAD = "http://127.0.0.1:9/", PUBLISHED = "https://api.drand.sh";

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);

const runOpen = (label: string, bundle: string, fixture: Fixture, urls: string, realTle: boolean) => {
  const state = path.join(WORK, "state-" + label);
  rmSync(state, { recursive: true, force: true });
  writeHostState(state, fixture, REAL_PCZT);
  if (realTle) { copyFileSync(TLE, path.join(state, "bin", "tle")); rmSync(path.join(state, "bin", "tle.cjs"), { force: true }); }
  writeAuctionLedger(state, fixture);
  const r = spawnSync(process.execPath, [bundle, "open", fixture.id], { input: "{}", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: urls } });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed };
};
const save = (name: string, value: unknown) => writeFileSync(path.join(WORK, name), jsonBytes(value));

if (part === "before") {
  console.log("=== fixtures: real tlock to quicknet round 32704232 (2 intact leaves + one body-tampered + one bad-MAC)");
  const beacon = await fetchBeacon(32704232);
  const main = await buildAuction({ beacon, count: 4, tamper: [{ index: 2, kind: "body" }, { index: 3, kind: "mac" }] });
  const reorg = await buildAuction({ beacon, count: 3, hideDeposit: 1 });
  save("fixtures.json", { main, reorg });
  console.log(`fixture-main leaves=${main.leaves.length} payout=${main.payout} fixture-reorg leaves=${reorg.leaves.length} hidden=leaf 1`);

  console.log(`=== red-before: base commit's open with the dead first relay (${DEAD},${PUBLISHED})`);
  const red = runOpen("red", BASE_BUNDLE, main, `${DEAD},${PUBLISHED}`, false);
  check("red-before-open-fails", red.code !== 0 && /ERROR auction/.test(red.err),
    `the base commit's open failed as expected (exit ${red.code}): ${(red.err || red.out).trim().split("\n").at(-1)?.slice(0, 140)}`);

  console.log(`=== baseline: base commit's open with a working relay (${PUBLISHED}), one Go tle run per leaf`);
  const base = runOpen("baseline", BASE_BUNDLE, main, PUBLISHED, true);
  const tleRuns = (base.parsed?.trace ?? []).filter((t: any) => t.operation === "tle -d").length;
  check("baseline-open-succeeds", base.code === 0 && base.parsed?.opened?.length === main.leaves.length,
    `the base commit's open succeeded with a working relay (exit ${base.code}, ${base.parsed?.opened?.length ?? 0} openings, ${tleRuns} tle -d runs)`);
  save("opened-main-baseline.json", base.parsed?.opened ?? null);
  console.log(`OBSERVE baseline-opened ${Buffer.from(JSON.stringify(base.parsed?.opened ?? null)).toString("base64").slice(0, 48)}… (saved to tmp/h11/opened-main-baseline.json)`);

  console.log("=== baseline-reorg: base commit's open on the reorg fixture (deposit of leaf 1 left the chain)");
  const baseReorg = runOpen("baseline-reorg", BASE_BUNDLE, reorg, PUBLISHED, true);
  check("baseline-reorg-open-succeeds", baseReorg.code === 0 && baseReorg.parsed?.opened?.[1]?.error === "reorg",
    `the base commit's open keeps the reorged leaf {error:"reorg"} (exit ${baseReorg.code})`);
  save("opened-reorg-baseline.json", baseReorg.parsed?.opened ?? null);
} else {
  const { main, reorg } = JSON.parse(readFileSync(path.join(WORK, "fixtures.json"), "utf8")) as { main: Fixture; reorg: Fixture };
  const mainBaseline = JSON.parse(readFileSync(path.join(WORK, "opened-main-baseline.json"), "utf8"));
  const reorgBaseline = JSON.parse(readFileSync(path.join(WORK, "opened-reorg-baseline.json"), "utf8"));
  if (!Array.isArray(mainBaseline) || !Array.isArray(reorgBaseline)) throw new Error("run `node tmp/h11.mjs before` first (no baseline openings saved)");

  console.log(`=== green-after: the fixed open with the dead first relay (${DEAD},${PUBLISHED}), offline from one verified beacon`);
  const green = runOpen("green", GREEN_BUNDLE, main, `${DEAD},${PUBLISHED}`, false);
  check("green-open-succeeds", green.code === 0 && green.parsed?.opened?.length === main.leaves.length,
    `the fixed open succeeded with the first relay dead (exit ${green.code}, ${green.parsed?.opened?.length ?? 0} openings)`);
  const produced = green.parsed?.opened ?? [];
  check("opened-byte-identical-to-base", JSON.stringify(produced) === JSON.stringify(mainBaseline),
    JSON.stringify(produced) === JSON.stringify(mainBaseline)
      ? `opened set is byte-identical to the base commit's (sha ${createHash("sha256").update(JSON.stringify(produced)).digest("hex").slice(0, 16)}…)`
      : `opened sets differ: produced ${JSON.stringify(produced).slice(0, 200)} vs baseline ${JSON.stringify(mainBaseline).slice(0, 200)}`);
  check("opened-classification-exact", JSON.stringify(produced) === JSON.stringify(main.opened),
    "2 intact leaves open by plaintext; the body-tampered and bad-MAC leaves are {error:\"undecryptable\"}, nothing else");
  const trace: any[] = green.parsed?.trace ?? [];
  const count = (op: string) => trace.filter(t => t.operation === op).length;
  check("trace-one-beacon-fetch-one-offline-decrypt", count("beacon fetch") === 1 && count("offline decrypt") === 1 && count("tle -d") === 0,
    `trace: beacon fetch x${count("beacon fetch")}, offline decrypt x${count("offline decrypt")}, tle -d x${count("tle -d")}`);

  console.log("=== verify: benzo verify on the opened fixture (it re-derives every opening offline)");
  const dir = path.join(WORK, "verify-doc");
  rmSync(dir, { recursive: true, force: true });
  writePublicDir(dir, { ...main, opened: produced });
  const v = spawnSync(process.execPath, [BENZO, "verify", "--dir", dir, "--signer", main.signer], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: path.join(WORK, "state-verify") } });
  check("verify-on-opened-fixture-passes", v.status === 0,
    v.status === 0 ? (v.stdout.trim().split("\n").at(-1) ?? "exit 0") : `exit ${v.status}: ${(v.stdout + v.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | ")}`);

  console.log("=== bad beacon: a relay answering with an unverifiable signature must stop the open, never a bad bid");
  const forge = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ round: main.R, signature: "ab".repeat(48) })); });
  await new Promise<void>(r => forge.listen(0, "127.0.0.1", () => r()));
  const forged = runOpen("bad-beacon", GREEN_BUNDLE, main, `${DEAD},http://127.0.0.1:${(forge.address() as any).port}`, false);
  check("bad-beacon-stops-open", forged.code !== 0 && /unavailable or unverified on every endpoint/.test(forged.err) && !forged.parsed,
    `the forged beacon stopped the open (exit ${forged.code}): ${(forged.err || forged.out).trim().split("\n").at(-1)?.slice(0, 120)}`);
  forge.close();

  console.log("=== reorg: a reorged leaf stays {error:\"reorg\"} (the deposit left the chain; its ciphertext still opens)");
  const greenReorg = runOpen("green-reorg", GREEN_BUNDLE, reorg, `${DEAD},${PUBLISHED}`, false);
  check("reorg-open-succeeds", greenReorg.code === 0 && greenReorg.parsed?.opened?.[1]?.error === "reorg",
    `the fixed open keeps the reorged leaf {error:"reorg"} (exit ${greenReorg.code})`);
  check("reorg-opened-byte-identical-to-base", JSON.stringify(greenReorg.parsed?.opened ?? null) === JSON.stringify(reorgBaseline),
    "the reorg fixture's opened set is byte-identical to the base commit's");
}

console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
