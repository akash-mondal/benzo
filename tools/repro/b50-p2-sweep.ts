// B50 (docs/design/phase7-b50-p2-sweep.md): the remaining verify/settle P2s — H1, H3, H5, H6 and H7 (H21's
// cases extend tools/repro/b48-p3s.ts). Every case runs the REAL shipped code (the in-process
// checkPublicAuction / publish the folds use at their real boundary, and the real `bin/benzo` CLI through
// the b47 stub harness for the worker cases) on one small but REAL auction fixture (tools/repro/
// h-fixtures.ts: real tlock ciphertexts to a past quicknet round, signed manifest, frozen set, envelope
// records and a cleared result). Each section is red on the BASE commit's code and green after:
//   red/green h1  receipt-attestation holds its two attesting maps to FULL agreement (mapPairAgrees):
//                  two pinned maps that agree on the receipt's txid and outputs but differ in `strays`,
//                  `defaults` or `batch` jointly attest nothing (base: ACCEPTED — the H1 hole);
//   red/green h3  the one-pool rule on every build path as an R46-style typed set-aside: `sign build` and
//                  `sign approve` refuse a two-pool candidate typed (exit 3, the minority pool's rows
//                  named), the worker sets those rows aside and the batch's other rows still pay —
//                  custody (hostBuild) and local build alike (base: the custody path pays the two-pool
//                  batch, the local path wedges the run untyped);
//   red/green h5  batch `proofs`, `inspect` and `signing` hold their exact shapes: an extra key or a blob
//                  in place of a field is refused (base: ACCEPTED — only the leak guard looked at them);
//   red/green h6  the receipt exact-key check runs in receipt-attestation, so a result-less (cancelled)
//                  settlement's receipt cannot carry an extra key (base: ACCEPTED — the check lived in
//                  accounting, which a cancelled settlement skips);
//   red/green h7  a bond auction whose every batch is set aside publishes a no-payment settlement carrying
//                  the set-aside reasons, and verify accepts it (base: publish refuses at `pick === null`);
//   control dirs  every committed published dir still verifies (listed one by one; identical on both legs).
//
// Build+run (red drives the PRISTINE base commit's bundles — the folds' git-archive recipe):
//   npx esbuild tools/repro/b50-p2-sweep.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b50.mjs
//   BNZ_STATE_DIR=tmp/b50/state node tmp/b50.mjs after [h1|h3|h5|h6|h7|dirs]
//   base tree (built ONCE from the pristine base commit 503826b before any B50 edit):
//     mkdir -p tmp/b50/base-src && git archive 503826b | tar -x -C tmp/b50/base-src
//     ln -s $PWD/node_modules tmp/b50/base-src/node_modules && ln -s $PWD/vendor tmp/b50/base-src/vendor
//     (cd tmp/b50/base-src && node cli/build.mjs && npx esbuild settle/plan.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=settle/dist/plan.mjs && npx esbuild settle/envelopes.ts ... --outfile=settle/dist/envelopes.mjs && npx esbuild settle/cli.ts ... --outfile=settle/dist/cli.mjs && npx esbuild clear/cli.ts ... --outfile=clear/dist/cli.mjs && npx esbuild clear/auction-cli.ts ... --outfile=clear/dist/auction.mjs)
//   the red leg runs THIS driver's sources over the base product code:
//     cp tools/repro/b50-p2-sweep.ts tools/repro/h-fixtures.ts tmp/b50/base-src/tools/repro/
//     (cd tmp/b50/base-src && npx esbuild tools/repro/b50-p2-sweep.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=tmp/b50-base.mjs)
//     BNZ_STATE_DIR=tmp/b50/state node tmp/b50-base.mjs before [section]
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, sellerUaCommitment, reserveReturnUaCommitment } from "../../manifest/schema";
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";
import { deriveClaimOpenings } from "../../cli/published-beacon";
import { modeEntry } from "../../clear/registry";
import { signApprovalMap } from "../../witness";
import { assertScratch } from "./scratch";
import { buildAuction, fetchBeacon, needRealPczt, witnessPrivate, UA_ORCHARD, UA_SAPLING_ONLY, writeHostState, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2], only = process.argv[3];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b50.mjs before|after [h1|h3|h5|h6|h7|dirs]"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b50.mjs ${part}${only ? " " + only : ""} (tools/repro/b50-p2-sweep.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const BASE = path.join(ROOT, "tmp", "b50", "base-src");
const BENZO = part === "before" ? path.join(BASE, "cli", "dist", "benzo.mjs") : path.join(ROOT, "cli", "dist", "benzo.mjs");
if (!existsSync(BENZO)) throw new Error(`${BENZO} missing — build the bundles first (see the header)`);
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT;

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const wants = (section: string) => !only || only === section;

// The in-process verdict — the same path `benzo verify` takes (its claim openings included), reduced to
// ACCEPTED or REFUSED with the first errors (r78's verdict helper).
const verdict = async (pub: any, opts: any = {}): Promise<string> => {
  const claimOpenings = await deriveClaimOpenings(pub.claims ?? [], pub.beacon);
  const errors = checkPublicAuction(pub, { claimOpenings, ...opts }).filter((c: any) => c.error);
  return errors.length ? "REFUSED " + errors.map((c: any) => `${c.id}: ${String(c.error).slice(0, 90)}`).join(" | ") : "ACCEPTED";
};
const sh = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [BENZO, ...args], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: path.join(ROOT, "tmp", "b50", "state"), ...env } });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const lastLine = (r: { out: string; err: string }) => (r.err || r.out).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 160) ?? "";

// ---- the fixture: one small real auction (h-fixtures), its obligations and the two signed maps of one
// paying batch. The fixture's own witness halves (witnessPrivate) sign the maps, so a case can re-sign one
// over a DIFFERENT signed body — exactly what H1's "two maps that agree only on txid and outputs" is.
const R = 32704232;
const TX1 = hash("b50-batch-1"), TX2 = hash("b50-batch-2");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const obligationsOf = (fx: Fixture) => [...modeEntry(fx.manifestPacket).obligations(fx.result as any, null)];

// The all-paid uniform settlement over the fixture's obligations: one paying batch, receipts per row, and
// the two agreeing host-signed maps of that batch (the shape settle/cli.ts finalize and publish write).
const paidSettlement = (fx: Fixture, mapBody: (who: number) => any) => {
  const obs = obligationsOf(fx);
  const rows = obs.map(([party, amount], i) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats: amount, state: "paid", batch: 1, txid: TX1, output_index: i, pool: "ironwood" }));
  const receipts = obs.map(([party, amount], i) => ({ auction_id: fx.id, party, txid: TX1, pool: "ironwood", output_index: i, amount_zats: amount }));
  const maps = [0, 1].map(w => signApprovalMap(mapBody(w) as any, witnessPrivate(String(w))));
  return { rows, receipts, ignored: [], approval_maps: maps };
};
const mapOver = (fx: Fixture, overrides: (who: number) => any = () => ({})) => (who: number) => ({
  auction_id: fx.id, batch: 1, txid: TX1,
  outputs: obligationsOf(fx).map(([party], i) => ({ party, output_index: i })),
  defaults: [], balance_refunds: [], ...overrides(who),
});

const writeFixtureDir = (dir: string, fx: Fixture, settlement: any) => {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const doc: any = {
    version: 1, auction_id: fx.id, signer: fx.signer, manifest: fx.manifestPacket, state: "SETTLED",
    receipts: fx.receipts, frozen: fx.frozen, result: fx.result, opened: fx.opened, beacon: fx.beacon,
    witness_set: fx.witnessSet, witness_cert: fx.witnessCert, envelopes: fx.envelopes, settlement,
  };
  writeFileSync(path.join(dir, "auction.json"), jsonBytes(doc));
  writeFileSync(path.join(dir, "manifest.json"), jsonBytes(fx.manifestPacket));
};

// In-memory settlement tamper over a committed doc (r78's helper): the projection checks re-read the
// files on disk, so a mutated in-memory settlement exercises exactly the settlement guards.
const tamper = (dir: string, f: (s: any) => void) => {
  const pub = loadPublicAuction(dir);
  const s = JSON.parse(JSON.stringify(pub.settlement));
  f(s);
  return { ...pub, settlement: s };
};

const run = async () => {
  const beacon = await fetchBeacon(R);
  const fx: Fixture = await buildAuction({ beacon, commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  check("fixture-seller-payout", /^[1-9][0-9]*$/.test(fx.payout), `the fixture result owes the seller ${fx.payout} zats`);
  const obs = obligationsOf(fx);
  check("fixture-obligations", obs.length >= 2 && obs.some(([p]) => p === "seller"), `the fixture owes ${obs.map(([p, a]) => `${p}:${a}`).join(", ")}`);

  // ---- H1: receipt-attestation requires FULL map agreement -------------------------------------------
  if (wants("h1")) {
    console.log("=== h1: the two attesting maps must agree on every signed field (mapPairAgrees)");
    const dir = path.join(ROOT, "tmp", "b50", "h1-public");
    {
      writeFixtureDir(dir, fx, paidSettlement(fx, mapOver(fx)));
      const v = await verdict(loadPublicAuction(dir));
      check("h1-honest-pair-accepted", v === "ACCEPTED", `two fully agreeing maps: ${v}`);
    }
    {
      const settlement = paidSettlement(fx, mapOver(fx, (who) => (who === 1 ? { strays: [{ party: "deposit:" + "ab".repeat(32) + ":ironwood:9", memo_sha256: "cd".repeat(32) }] } : {})));
      writeFixtureDir(dir, fx, settlement);
      const v = await verdict(loadPublicAuction(dir));
      const refused = /receipt-attestation/.test(v) && v.startsWith("REFUSED");
      check("h1-strays-differ-refused", refused, `maps agreeing on txid+outputs but differing in strays: ${v}`);
    }
    {
      const settlement = paidSettlement(fx, mapOver(fx, (who) => (who === 1 ? { defaults: [0] } : {})));
      writeFixtureDir(dir, fx, settlement);
      const v = await verdict(loadPublicAuction(dir));
      const refused = /receipt-attestation/.test(v) && v.startsWith("REFUSED");
      check("h1-defaults-differ-refused", refused, `maps agreeing on txid+outputs but differing in defaults: ${v}`);
    }
    {
      const settlement = paidSettlement(fx, mapOver(fx, (who) => (who === 1 ? { batch: 2 } : {})));
      writeFixtureDir(dir, fx, settlement);
      const v = await verdict(loadPublicAuction(dir));
      const refused = /receipt-attestation/.test(v) && v.startsWith("REFUSED");
      check("h1-batch-differ-refused", refused, `maps agreeing on txid+outputs but differing in batch: ${v}`);
    }
  }

  // ---- H5: exact shapes for batch proofs, inspect and signing ----------------------------------------
  if (wants("h5")) {
    console.log("=== h5: batch proofs/inspect/signing hold their exact shapes");
    const real = path.join(ROOT, "docs/evidence/phase-6/markets/launch-r34/launch-cold");
    const legacy = path.join(ROOT, "docs/evidence/phase-6/rg/settle-crash/settle/main");
    {
      const v = await verdict(loadPublicAuction(real));
      check("h5-honest-doc-accepted", v === "ACCEPTED", `the committed launch-r34 doc: ${v}`);
    }
    {
      const v = await verdict(loadPublicAuction(legacy));
      check("h5-honest-legacy-proofs-accepted", v === "ACCEPTED", `the committed settle-crash doc (carries proofs): ${v}`);
    }
    const cases: [string, string, (s: any) => void][] = [
      ["h5-signing-blob-refused", "a blob in place of the signing object", (s) => { s.batches[0].signing = "aGVsbG8gd29ybGQ="; }],
      ["h5-signing-extra-key-refused", "an extra key in signing", (s) => { s.batches[0].signing.leak = "aGVsbG8="; }],
      ["h5-signing-field-blob-refused", "a blob in place of signing.sighash", (s) => { s.batches[0].signing.sighash = "aGVsbG8gd29ybGQ="; }],
      ["h5-inspect-blob-refused", "a blob in place of the inspect object", (s) => { s.batches[0].inspect = "aGVsbG8gd29ybGQ="; }],
      ["h5-inspect-extra-key-refused", "an extra key in inspect", (s) => { s.batches[0].inspect.encoded_payload = "aGVsbG8="; }],
      ["h5-inspect-field-blob-refused", "a blob in place of inspect.fee_zats", (s) => { s.batches[0].inspect.fee_zats = "aGVsbG8gd29ybGQ="; }],
      ["h5-inspect-wrong-type-refused", "a string in place of inspect.actions", (s) => { s.batches[0].inspect.actions = "12"; }],
      ["h5-inspect-output-extra-key-refused", "an extra key in an inspect output", (s) => { s.batches[0].inspect.outputs[0].recipient = "aGVsbG8="; }],
      ["h5-proofs-blob-refused", "a blob in place of the proofs list", (s) => { s.batches[0].proofs = "aGVsbG8gd29ybGQ="; }],
      ["h5-proofs-entry-blob-refused", "a blob in place of proofs[0].height", (s) => { s.batches[0].proofs = [{ height: "aGVsbG8=", raw_hash: "ab".repeat(32) }]; }],
    ];
    for (const [id, what, mutate] of cases) {
      const v = await verdict(tamper(real, mutate));
      const refused = v.startsWith("REFUSED");
      check(id, refused, `${what}: ${v}`);
    }
  }

  // ---- H6: the receipt exact-key check runs on result-less (cancelled) settlements --------------------
  if (wants("h6")) {
    console.log("=== h6: the receipt exact-key check moves into receipt-attestation (cancelled settlements)");
    const cancelledDocs = [
      "docs/evidence/phase-5/live-regression-4876156/cli/cancelled.json",
      "docs/evidence/phase-5/live-regression-7b4b0f9/cli/cancelled.json",
      "docs/evidence/phase-6/rg/cli-auction/cli/cancelled.json",
    ];
    const asDir = (i: number) => {
      const dir = path.join(ROOT, "tmp", "b50", `h6-cancelled-${i}`);
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      copyFileSync(path.join(ROOT, cancelledDocs[i]), path.join(dir, "auction.json"));
      return dir;
    };
    for (const [i, f] of cancelledDocs.entries()) {
      const v = await verdict(loadPublicAuction(asDir(i)));
      check(`h6-honest-cancelled-${i}-accepted`, v === "ACCEPTED", `${f}: ${v}`);
    }
    {
      const pub = loadPublicAuction(asDir(1));
      const s = JSON.parse(JSON.stringify(pub.settlement));
      s.receipts[0].extra_key = "a smuggled field";
      const v = await verdict({ ...pub, settlement: s });
      const refused = /receipt/.test(v) && v.startsWith("REFUSED");
      check("h6-cancelled-receipt-extra-key-refused", refused, `a cancelled receipt carrying an extra key: ${v}`);
    }
    {
      const pub = loadPublicAuction(asDir(2));
      const s = JSON.parse(JSON.stringify(pub.settlement));
      s.receipts[1].memo_hex = "aGVsbG8gd29ybGQ=";
      const v = await verdict({ ...pub, settlement: s });
      const refused = /receipt/.test(v) && v.startsWith("REFUSED");
      check("h6-cancelled-receipt-blob-field-refused", refused, `a cancelled receipt carrying a blob field: ${v}`);
    }
  }

  // ---- control: every committed published dir still verifies (listed one by one) ---------------------
  if (wants("dirs")) {
    console.log("=== dirs: every committed published dir still verifies");
    const dirs = execFileSync("bash", ["-c", "cd docs/evidence && find . -name manifest.json | sed 's|/manifest.json$||' | sort"], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const d of dirs) {
      const full = path.join(ROOT, "docs/evidence", d);
      try {
        // The Phase 2/3 and settle-crash legacy dirs keep signer.json beside their subdirs (the r82
        // replay recipe): assemble the reader's view of one in tmp/ before loading it.
        let readDir = full;
        if (!existsSync(path.join(full, "signer.json")) && !existsSync(path.join(full, "auction.json")) && existsSync(path.join(path.dirname(full), "signer.json"))) {
          readDir = path.join(ROOT, "tmp", "b50", "dirs", d.replace(/\//g, "_"));
          rmSync(readDir, { recursive: true, force: true }); mkdirSync(readDir, { recursive: true });
          for (const f of readdirSync(full)) copyFileSync(path.join(full, f), path.join(readDir, f));
          copyFileSync(path.join(path.dirname(full), "signer.json"), path.join(readDir, "signer.json"));
        }
        const pub = loadPublicAuction(readDir);
        const unattested = (pub.settlement?.receipts ?? []).length > 0 && (pub.settlement?.approval_maps ?? []).length === 0;
        const v = await verdict(pub, unattested ? { allowUnattested: true } : {});
        check(`dir ${d}`, v === "ACCEPTED", v);
      } catch (e) {
        check(`dir ${d}`, false, `threw ${(e as Error).message.slice(0, 120)}`);
      }
    }
  }
};

await run();
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
