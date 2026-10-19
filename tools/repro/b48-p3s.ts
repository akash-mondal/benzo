// B48 (docs/design/phase7-b48-p3s.md, H18): the three Reviewer R P3s, each with its own proof on the REAL
// shipped host paths offline (tools/repro/h10-seller-binding.ts's shape: every product decision runs the real
// code, only the offline-impossible externals are stubbed through h-fixtures.ts writeHostState).
// H21 (B50, docs/design/phase7-b50-p2-sweep.md item 6) extends this driver: `sign derivable` lists the refund
// rows and tags only the seller row refused (typed) on a mismatched seller_ua, and `sign approve` refuses a
// mis-shaped seller output typed (exit 3, ["seller"]).
//   P3-1 a seller-commitment mismatch refuses only the seller row, and only when the batch has one. A
//        mismatched-seller_ua packet whose batch has NO seller row builds and approves its refund rows; the
//        same packet with the seller row is refused for that row (typed, exit 3, refused-rows ["seller"]).
//        `sign derivable` follows the same rule on its row listing.
//   P3-2 `benzo seller check` accepts only the published signed manifest.json: a raw manifest object is
//        refused with one ERROR line; the wrong --signer is refused and the right one passes.
//   P3-3 `benzo verify --openings-cache` reads only the host's own cache file at its own path: a cache copied
//        elsewhere is refused (its own path, or a link standing in for one at the host's own name), and the
//        host's own cache works as before.
// Batch B51 (docs/design/phase7-b51-review-fixes.md) extends this proof, red on the B51 base commit
// a107447 bundles (BNZ_B48_BENZO=tmp/b51/base-src/cli/dist/benzo.mjs) and green after:
//   P2-1b a mismatched reserve_return_ua never walls the row listing: a packet that declares NO return row
//        lists every other row and tags the reserve-return row refused (exit 0); a packet that DECLARES the
//        return row with the mismatched address stays refused (typed, exit 3).
//   P3-5  `seller check` without --signer prints one no-trust-anchor WARN and still checks the commitment.
// Build+run: npx esbuild tools/repro/b48-p3s.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b48.mjs && node tmp/b48.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonBytes, reserveReturnUaCommitment, sellerUaCommitment } from "../../manifest/schema";
import { sealBlob } from "../../envelope";
import { buildAuction, fetchBeacon, needRealPczt, UA_ORCHARD, UA_SAPLING_ONLY, writeHostState, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/b48.mjs (tools/repro/b48-p3s.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
for (const line of (existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT; // this process classifies through the real audited binary
// The CLI under test. The red-before leg drives the pristine base commit's bundle instead (built from a
// git-archive extraction into tmp/b48/base-src, the folds' recipe — never another worktree).
const BENZO = process.env.BNZ_B48_BENZO ?? path.join(ROOT, "cli", "dist", "benzo.mjs");
const WORK = path.join(ROOT, "tmp", "b48");
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const sh = (args: string[], env: Record<string, string>) => {
  const r = spawnSync(process.execPath, [BENZO, ...args], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const lastLine = (r: { out: string; err: string }) => (r.err || r.out).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 180) ?? "";
const hostEnv = (state: string) => ({ BNZ_STATE_DIR: state, BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"),
  BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/" });

const beacon = await fetchBeacon(32704232);
const fixture: Fixture = await buildAuction({ beacon, commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
// B52 (P3-8c): the stub wallet now charges the real ZIP-317 fee (per pool, max(spends, outputs), each
// bundle padded to its 2-action floor), so these worlds carry one fee-slack note — at a NON-deposit
// address, so it is never a stray or an obligation; it only funds the wallet's fees, as the live fee
// reserve does.
fixture.notes.push({ txid: createHash("sha256").update("b48-fee-slack").digest("hex"), height: 90100, pool: "ironwood",
  address: "utest1b48feeslackaddress0000000000000000000000000000000000000", diversifier_index: "20", action_index: 0,
  value_zats: 30000, memo_hex: null, spent_in_txid: null });
check("fixture-seller-payout", /^[1-9][0-9]*$/.test(fixture.payout),
  `the fixture result owes the seller ${fixture.payout} zats, so the seller-row cases are not vacuous`);

// The packet builders: a build packet carries rows.json (what settle/cli.ts writes for one), an approve
// packet the candidate sealed to alice. `sellerUa` is the packet's meta.seller_ua — the substitute
// UA_SAPLING_ONLY is the "mismatched" one against the manifest's commitment on UA_ORCHARD.
const packetDir = (name: string, fx: Fixture, sellerUa: string | null, rows: any[], candidate?: { rows: { recipient: string; amount_zats: string }[] }, reserve?: { ua?: string | null; row?: { amount_zats: string } | null }) => {
  const dir = path.join(WORK, "packet-" + name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePublicDir(path.join(dir, "public"), fx);
  const meta: any = { auction_id: fx.id, signer: fx.signer, seller_ua: sellerUa };
  // B51 (P2-1b): the packet's reserve-return shape — the routing config's reserve_return_ua (possibly the
  // mismatched substitute) and, for a packet that declares the return row, its `reserve_row` amount.
  if (reserve) {
    if (reserve.ua !== undefined) meta.reserve_return_ua = reserve.ua;
    if (reserve.row) meta.reserve_row = reserve.row;
  }
  if (rows.length) { meta.batch = 1; meta.expiry_blocks = 100; writeFileSync(path.join(dir, "rows.json"), jsonBytes(rows)); }
  if (candidate) {
    const content = JSON.stringify({ rows: candidate.rows });
    writeFileSync(path.join(dir, "candidate.pczt"), content);
    writeFileSync(path.join(dir, "sealed-alice.bin"), sealBlob(Buffer.from(content), fx.envelopeKeys[0].public_hex), { mode: 0o600 });
    meta.batch = 1;
    meta.plan_version = createHash("sha256").update(readFileSync(path.join(dir, "candidate.pczt"))).digest("hex");
  }
  writeFileSync(path.join(dir, "packet.json"), jsonBytes(meta));
  return dir;
};
const createdRows = (state: string) => existsSync(path.join(state, "create-log.jsonl"))
  ? readFileSync(path.join(state, "create-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
const listedRows = (r: { out: string }) => {
  const line = r.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1);
  return line ? (JSON.parse(line).rows ?? []) : []; // a refusal prints no JSON row list
};
// B51 (P2-1b): the listing's refused tag (the JSON output's `refused_rows`).
const listedRefused = (r: { out: string }) => {
  const line = r.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1);
  return line ? (JSON.parse(line).refused_rows ?? []) : [];
};
const parties = (rows: { party: string; amount_zats: string }[]) => JSON.stringify([...rows].map(x => `${x.party}:${x.amount_zats}`).sort());

// ---- P3-1: the mismatch refuses only the seller row, and only when the batch has one -------------------------
// The batch rows this signer derives (the honest listing) minus the seller row: the refund-only batch the P3
// says must never stall. Every fixture envelope refunds to UA_ORCHARD (h-fixtures seals each one to it), so
// that is the recipient the host derives for every refund row.
{
  const dir = packetDir("enum", fixture, UA_ORCHARD, []);
  const state = path.join(WORK, "state-enum"); writeHostState(state, fixture, REAL_PCZT);
  const r = sh(["sign", "derivable", "--id", fixture.id, "--packet", dir, "--name", "alice"], hostEnv(state));
  const listed = listedRows(r) as { party: string; amount_zats: string }[];
  const refundRows = listed.filter(x => x.party !== "seller");
  check("p31-fixture-rows", r.code === 0 && listed.some(x => x.party === "seller") && refundRows.length >= 1,
    `the honest listing derives ${listed.length} rows: ${refundRows.length} refund rows and the seller row`);
  const refundBuildRows = refundRows.map(x => ({ party: x.party, kind: "refund", amount_zats: x.amount_zats }));
  const refundCandidateRows = refundRows.map(x => ({ recipient: UA_ORCHARD, amount_zats: x.amount_zats }));

  // Bullet 1 — a batch WITHOUT a seller row ignores seller_ua (the packet carries the substitute).
  {
    const pdir = packetDir("build-refunds-only", fixture, UA_SAPLING_ONLY, refundBuildRows);
    const st = path.join(WORK, "state-build-refunds-only"); writeHostState(st, fixture, REAL_PCZT);
    const b = sh(["sign", "build", "--id", fixture.id, "--batch", "1", "--packet", pdir, "--name", "alice"], hostEnv(st));
    const built = existsSync(path.join(pdir, "build.json")) ? JSON.parse(readFileSync(path.join(pdir, "build.json"), "utf8")) : null;
    const paid = createdRows(st);
    check("p31-build-refund-rows-built", b.code === 0 && !!built && parties(built.outputs) === parties(refundBuildRows)
      && paid.length === refundBuildRows.length && paid.every((x: any) => x.recipient === UA_ORCHARD),
      `mismatched seller_ua, no seller row in the batch: exit ${b.code}, built ${built ? built.outputs.map((o: any) => o.party).join(",") : "(nothing)"}, paid ${paid.map((x: any) => x.recipient).join(",").slice(0, 32)}… (${lastLine(b)})`);
  }
  {
    const pdir = packetDir("approve-refunds-only", fixture, UA_SAPLING_ONLY, [], { rows: refundCandidateRows });
    const st = path.join(WORK, "state-approve-refunds-only"); writeHostState(st, fixture, REAL_PCZT);
    const a = sh(["sign", "approve", "--id", fixture.id, "--batch", "1", "--packet", pdir, "--name", "alice"], hostEnv(st));
    const recorded = existsSync(path.join(st, "approvals", fixture.id, "batch-1.json"));
    check("p31-approve-refund-rows-approved", a.code === 0 && recorded,
      `mismatched seller_ua, no seller row in the candidate: exit ${a.code}, approval ${recorded ? "recorded" : "not recorded"} (${lastLine(a)})`);
  }

  // Bullet 2 — the SAME packet with the seller row is refused for that row only (typed, as today).
  {
    const pdir = packetDir("build-with-seller", fixture, UA_SAPLING_ONLY, [...refundBuildRows, { party: "seller", kind: "payout", amount_zats: fixture.payout }]);
    const st = path.join(WORK, "state-build-with-seller"); writeHostState(st, fixture, REAL_PCZT);
    const b = sh(["sign", "build", "--id", fixture.id, "--batch", "1", "--packet", pdir, "--name", "alice"], hostEnv(st));
    const typed = /ERROR sign build refused-rows \["seller"\]/.test(b.err);
    check("p31-build-seller-row-refused-typed", b.code === 3 && typed && !existsSync(path.join(pdir, "build.json")) && createdRows(st).length === 0,
      `same packet plus the seller row: exit ${b.code}, ${typed ? 'refused-rows ["seller"]' : `no typed refusal (${lastLine(b)})`}, nothing built`);
  }
  {
    const pdir = packetDir("approve-with-seller", fixture, UA_SAPLING_ONLY, [],
      { rows: [...refundCandidateRows, { recipient: UA_SAPLING_ONLY, amount_zats: fixture.payout }] });
    const st = path.join(WORK, "state-approve-with-seller"); writeHostState(st, fixture, REAL_PCZT);
    const a = sh(["sign", "approve", "--id", fixture.id, "--batch", "1", "--packet", pdir, "--name", "alice"], hostEnv(st));
    const typed = /ERROR sign approve refused-rows \["seller"\]/.test(a.err);
    check("p31-approve-seller-row-refused-typed", a.code === 3 && typed && !existsSync(path.join(st, "approvals", fixture.id, "batch-1.json")),
      `same packet plus the seller row: exit ${a.code}, ${typed ? 'refused-rows ["seller"]' : `no typed refusal (${lastLine(a)})`}, no approval recorded`);
  }

  // `sign derivable` follows the same rule on its own row listing: a listing with NO seller row (the
  // packet names no seller_ua) ignores seller_ua and lists the refund rows. H21 (B50): a listing WITH a
  // seller row and a mismatched packet no longer refuses the listing — it lists the refund rows and tags
  // only the seller row refused (typed: `refused: true` with its reason), so an inconsistent seller config
  // can never stall the refunds at settle (B48 Q2).
  {
    const pdir = packetDir("derivable-mismatch", fixture, UA_SAPLING_ONLY, []);
    const st = path.join(WORK, "state-derivable-mismatch"); writeHostState(st, fixture, REAL_PCZT);
    const d = sh(["sign", "derivable", "--id", fixture.id, "--packet", pdir, "--name", "alice"], hostEnv(st));
    const rows = listedRows(d) as any[];
    const sellerRow = rows.find((x: any) => x.party === "seller");
    const refunds = rows.filter((x: any) => x.party !== "seller");
    const tagged = !!sellerRow && sellerRow.refused === true && /seller_ua_commitment/.test(String(sellerRow.reason ?? ""))
      && refunds.length >= 1 && refunds.every((x: any) => x.refused === undefined);
    check("h21-derivable-mismatch-lists-refunds-tags-seller", d.code === 0 && tagged && parties(refunds.map((x: any) => ({ party: x.party, amount_zats: x.amount_zats }))) === parties(refundRows),
      `mismatched packet with a seller row: exit ${d.code}, listed ${rows.map((x: any) => `${x.party}${x.refused ? "(refused)" : ""}`).join(", ") || "(nothing)"} (${lastLine(d)})`);
  }
  {
    const pdir = packetDir("derivable-no-seller-ua", fixture, null, []);
    const st = path.join(WORK, "state-derivable-no-seller-ua"); writeHostState(st, fixture, REAL_PCZT);
    const d = sh(["sign", "derivable", "--id", fixture.id, "--packet", pdir, "--name", "alice"], hostEnv(st));
    const rows = listedRows(d) as { party: string; amount_zats: string }[];
    check("p31-derivable-no-seller-row-lists-refunds", d.code === 0 && !rows.some(x => x.party === "seller") && parties(rows) === parties(refundRows),
      `listing has no seller row (no seller_ua named): exit ${d.code}, listed ${rows.map(x => x.party).join(",") || "(nothing)"} (${lastLine(d)})`);
  }

  // H21 (B50): a mis-shaped seller output in `sign approve` — an output paying the packet's seller_ua that
  // is not the result's seller payout — is refused TYPED (exit 3, refused-rows ["seller"]), never an untyped
  // exit 1 (B48 Q3).
  {
    const wrongAmount = String(Number(fixture.payout) + 1);
    const pdir = packetDir("approve-mis-shaped-seller", fixture, UA_ORCHARD, [],
      { rows: [...refundCandidateRows, { recipient: UA_ORCHARD, amount_zats: wrongAmount }] });
    const st = path.join(WORK, "state-approve-mis-shaped-seller"); writeHostState(st, fixture, REAL_PCZT);
    const a = sh(["sign", "approve", "--id", fixture.id, "--batch", "1", "--packet", pdir, "--name", "alice"], hostEnv(st));
    const typed = /ERROR sign approve refused-rows \["seller"\]/.test(a.err);
    check("h21-approve-mis-shaped-seller-typed", a.code === 3 && typed && !existsSync(path.join(st, "approvals", fixture.id, "batch-1.json")),
      `a seller_ua output at ${wrongAmount} zats (not the ${fixture.payout}-zat payout): exit ${a.code}, ${typed ? 'refused-rows ["seller"]' : `no typed refusal (${lastLine(a)})`}, no approval recorded`);
  }
}

// ---- B51 P2-1b: a mismatched reserve_return_ua never walls the listing (R107's rule) ---------------------
{
  const dir = packetDir("b51-enum", fixture, UA_ORCHARD, []);
  const state = path.join(WORK, "state-b51-enum"); writeHostState(state, fixture, REAL_PCZT);
  const r = sh(["sign", "derivable", "--id", fixture.id, "--packet", dir, "--name", "alice"], hostEnv(state));
  const honest = listedRows(r) as { party: string; amount_zats: string }[];
  check("b51-honest-listing", r.code === 0 && honest.length >= 2 && !honest.some(x => x.party === "reserve-return") && listedRefused(r).length === 0,
    `the honest listing derives ${honest.length} rows, no reserve-return row (something is still owed) and no refused tag`);

  // A packet WITHOUT a declared return row and a mismatched reserve_return_ua (stale routing): every other
  // row is listed and only the reserve-return row is left out, tagged refused. On base this exits 3 and
  // lists nothing — the wholesale wall (P2-1b).
  {
    const pdir = packetDir("b51-mismatch-no-row", fixture, UA_ORCHARD, [], undefined, { ua: UA_SAPLING_ONLY });
    const st = path.join(WORK, "state-b51-mismatch-no-row"); writeHostState(st, fixture, REAL_PCZT);
    const d = sh(["sign", "derivable", "--id", fixture.id, "--packet", pdir, "--name", "alice"], hostEnv(st));
    const rows = listedRows(d) as { party: string; amount_zats: string }[];
    const refused = listedRefused(d);
    check("b51-mismatched-ua-without-row-lists", d.code === 0 && parties(rows) === parties(honest) && refused.includes("reserve-return"),
      `mismatched reserve_return_ua, no declared return row: exit ${d.code}, listed ${rows.map(x => x.party).join(",") || "(nothing)"}, refused_rows ${JSON.stringify(refused)} (${lastLine(d)})`);
  }
  // A packet that DECLARES the return row with the mismatched address stays refused (typed, exit 3).
  {
    const pdir = packetDir("b51-mismatch-row", fixture, UA_ORCHARD, [], undefined, { ua: UA_SAPLING_ONLY, row: { amount_zats: "1" } });
    const st = path.join(WORK, "state-b51-mismatch-row"); writeHostState(st, fixture, REAL_PCZT);
    const d = sh(["sign", "derivable", "--id", fixture.id, "--packet", pdir, "--name", "alice"], hostEnv(st));
    const typed = /ERROR sign derivable refused-rows \["reserve-return"\]/.test(d.err);
    check("b51-mismatched-ua-with-row-refused-typed", d.code === 3 && typed,
      `mismatched reserve_return_ua with the declared return row: exit ${d.code}, ${typed ? 'refused-rows ["reserve-return"]' : `no typed refusal (${lastLine(d)})`}`);
  }
}

// ---- P3-2: `seller check` requires the signed manifest -------------------------------------------------------
{
  const rawDir = path.join(WORK, "seller-raw"); mkdirSync(rawDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(rawDir, "manifest.json"), JSON.stringify(fixture.manifest));
  const r = sh(["seller", "check", "--manifest", path.join(rawDir, "manifest.json"), "--ua", UA_ORCHARD], { BNZ_STATE_DIR: path.join(WORK, "seller-check-state") });
  const errors = (r.err.match(/^ERROR/gm) ?? []).length;
  check("p32-raw-manifest-refused", r.code !== 0 && errors === 1 && /manifest\.json/.test(r.err),
    `raw manifest object: exit ${r.code}, ${errors} ERROR line(s): ${lastLine(r)}`);
}
{
  const dir = path.join(WORK, "seller-signed"); writePublicDir(dir, fixture);
  const env = { BNZ_STATE_DIR: path.join(WORK, "seller-check-state") };
  const ok = sh(["seller", "check", "--manifest", path.join(dir, "manifest.json"), "--ua", UA_ORCHARD], env);
  check("p32-signed-packet-passes", ok.code === 0 && /"matches":true/.test(ok.out + ok.err) && new RegExp(`"signer":"${fixture.signer}"`).test(ok.out + ok.err),
    `signed packet, committed address: exit ${ok.code} (${lastLine(ok)})`);
  const pinned = sh(["seller", "check", "--manifest", path.join(dir, "manifest.json"), "--ua", UA_ORCHARD, "--signer", fixture.signer], env);
  check("p32-right-signer-passes", pinned.code === 0 && /"matches":true/.test(pinned.out + pinned.err),
    `signed packet, --signer the signing key: exit ${pinned.code} (${lastLine(pinned)})`);
  const wrong = sh(["seller", "check", "--manifest", path.join(dir, "manifest.json"), "--ua", UA_ORCHARD, "--signer", "ab".repeat(44)], env);
  check("p32-wrong-signer-refused", wrong.code !== 0 && /untrusted manifest\/receipt signer/.test(wrong.err),
    `signed packet, --signer a different key: exit ${wrong.code} (${lastLine(wrong)})`);
}

// ---- B51 P3-5: `seller check` without --signer names the missing trust anchor and still checks -----------
{
  const dir = path.join(WORK, "seller-signed-b51"); writePublicDir(dir, fixture);
  const env = { BNZ_STATE_DIR: path.join(WORK, "seller-check-state") };
  const r = sh(["seller", "check", "--manifest", path.join(dir, "manifest.json"), "--ua", UA_ORCHARD], env);
  const anchor = "WARN no trust anchor: pass --signer HEX (the auction's published receipt key) to check who signed this manifest";
  const warns = (r.err.match(/^WARN/gm) ?? []).length;
  check("b51-seller-check-no-signer-warns", r.code === 0 && warns === 1 && r.err.includes(anchor) && /"matches":true/.test(r.out + r.err),
    `without --signer: exit ${r.code}, exactly ${warns} WARN line naming the trust anchor, and the commitment is still checked ("matches":true printed) (${lastLine(r)})`);
  const bad = sh(["seller", "check", "--manifest", path.join(dir, "manifest.json"), "--ua", UA_SAPLING_ONLY], env);
  check("b51-seller-check-no-signer-still-checks", bad.code === 1 && /this address is not the manifest's committed seller payout address/.test(bad.err),
    `without --signer a mismatched UA is still refused (exit ${bad.code}) — the commitment check runs regardless (${lastLine(bad)})`);
}

// ---- P3-3: `verify --openings-cache` reads only the host's own cache file ------------------------------------
{
  const st = path.join(WORK, "state-p33"); writeHostState(st, fixture, REAL_PCZT);
  const pdir = packetDir("p33-enum", fixture, UA_ORCHARD, []);
  const warm = sh(["sign", "derivable", "--id", fixture.id, "--packet", pdir, "--name", "alice"], hostEnv(st));
  const own = path.join(st, "auctions", fixture.id, "openings.json");
  check("p33-host-cache-written", warm.code === 0 && existsSync(own),
    `the host's own derivation wrote ${path.relative(ROOT, own)} (exit ${warm.code})`);
  const pubDir = path.join(WORK, "p33-public"); writePublicDir(pubDir, fixture);
  const verify = (cacheArg: string[]) => sh(["verify", "--dir", pubDir, "--signer", fixture.signer, ...cacheArg], hostEnv(st));

  // The host's own cache works as before.
  const a = verify(["--openings-cache", own]);
  check("p33-own-cache-works", a.code === 0, `--openings-cache on the host's own file: exit ${a.code} (${lastLine(a)})`);

  // A cache copied elsewhere is refused — named directly, and as a link standing in for one at the host's
  // own name (the second refusal is the B48 pin; before B48 the link was read as the host's cache).
  const copied = path.join(WORK, "p33-copied-openings.json");
  copyFileSync(own, copied);
  const b = verify(["--openings-cache", copied]);
  check("p33-copied-cache-refused", b.code !== 0 && /openings cache must be this host's own/.test(b.err),
    `a cache copied elsewhere named directly: exit ${b.code} (${lastLine(b)})`);
  const backup = path.join(WORK, "p33-own-backup.json");
  renameSync(own, backup); symlinkSync(copied, own);
  const c = verify(["--openings-cache", own]);
  check("p33-link-standing-in-refused", c.code !== 0 && /not a link to a cache copied elsewhere/.test(c.err),
    `the host's own name standing in for the copied file (a link): exit ${c.code} (${lastLine(c)})`);
  unlinkSync(own); renameSync(backup, own);
  const d = verify(["--openings-cache", own]);
  check("p33-restored-own-cache-works", d.code === 0, `the restored host's own file works again: exit ${d.code} (${lastLine(d)})`);
}

console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
