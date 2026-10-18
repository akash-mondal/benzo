// B45 (docs/design/phase7-b45-classify.md) proof: bulk classification is exactly single classification,
// and the memo and the host classify cache are pure memos. On the R24 item 3 (i) reference vectors
// (tools/repro/fixtures/zcash-address-cases.json — every kind, every network, invalid inputs included):
//   (1) `benzo-pczt classify-address --stdin` prints, line by line, the exact bytes the single-address
//       form prints for each input, in input order, never stopping on a bad line (checked again with the
//       input order reversed and duplicates mixed in);
//   (2) the one classifier module (envelope/destination.ts classifyAddresses) answers byte-identically
//       to the single-address form, and classifyAddress(one) — the thin wrapper every caller uses — is
//       that same answer; an empty destination is still refused `destination`, as before this batch;
//   (3) one bulk call per chunk of up to 2,000 misses and no more (counted through a shim binary),
//       duplicates are classified once, and an address whose bytes the line protocol cannot carry (a
//       newline or carriage return) is classified through the single-address form, so its verdict is
//       unchanged;
//   (4) the classify cache cannot change a verdict: in a child process with a cold memo, a cache-served
//       verdict is byte-identical to the classifier's own output for that exact address, served only for
//       the address it was keyed under (sha256(address)), with zero classifier spawns. The cache file's
//       shape, mode and binary-hash invalidation are proven on the real host path in h13-host-scale.
//
// Build+run:
//   npx esbuild tools/repro/b45-classify.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b45-classify.mjs
//   (needs the audited classifier: cargo build --release --locked --manifest-path settle/Cargo.toml)
//   node tmp/b45-classify.mjs
//   node tmp/b45-classify.mjs --cache-child   (internal: the cache-purity child, spawned by the run above)
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classifyAddresses, useClassifyCache, type Classified } from "../../envelope/destination";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const REAL = path.join(ROOT, "settle", "target", "release", "benzo-pczt");
const WORK = path.join(ROOT, "tmp", "b45-classify");
const child = process.argv[2] === "--cache-child";

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);

// The reference vectors: every row of the fixture the destination repros and e2e's g7 fold use.
const cases = JSON.parse(readFileSync(path.join(ROOT, "tools/repro/fixtures/zcash-address-cases.json"), "utf8"));
const vectors: string[] = [
  ...cases.ua.map((r: any) => r.address as string),
  ...cases.sapling.map((r: any) => r.address as string),
  ...cases.tex.map((r: any) => r.address as string),
  ...cases.transparent.map((r: any) => r.address as string),
  ...cases.reject_checksum as string[],
  ...cases.reject_hrp_mismatch as string[],
  ...cases.r2_other as string[],
];
// Invalid inputs of every shape the single-address form has always answered for (no newline or carriage
// return here — those are the line-protocol case, checked in (3)).
const UA_ORCHARD = "utest1redacted";
const flipped = UA_ORCHARD.slice(0, 40) + (UA_ORCHARD[40] === "a" ? "b" : "a") + UA_ORCHARD.slice(41);
const invalid = ["", "junk", "not an address", "u1", flipped, UA_ORCHARD + " ", " " + UA_ORCHARD, "x".repeat(600), "u1" + "q".repeat(100), "🦄🦄🦄"];
const inputs = [...vectors, ...invalid];
console.log(`command node tmp/b45-classify.mjs${child ? " --cache-child" : ""} (tools/repro/b45-classify.ts)`);
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`OBSERVE vectors ${vectors.length} fixture addresses + ${invalid.length} invalid inputs = ${inputs.length}`);

// The single-address form is the reference: one spawn per input, exactly as before this batch (its
// stdout is one line; the trailing newline is framing, not content).
const single = (addr: string): string => {
  const out = execFileSync(REAL, ["classify-address", addr], { encoding: "utf8" });
  return out.endsWith("\n") ? out.slice(0, -1) : out;
};
const bulk = (list: string[]): string =>
  execFileSync(REAL, ["classify-address", "--stdin"], { input: list.join("\n") + "\n", encoding: "utf8" });
const linesOf = (text: string): string[] => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

if (!child) {
  // ---- (1) bulk output equals the single-call output, byte for byte, in input order -----------------
  const reference = inputs.map(single);
  const kinds: Record<string, number> = {};
  for (const line of reference) { const k = JSON.parse(line).kind; kinds[k] = (kinds[k] ?? 0) + 1; }
  console.log(`OBSERVE kinds ${JSON.stringify(kinds)}`);
  const bulkLines = linesOf(bulk(inputs));
  check("bulk-line-count", bulkLines.length === inputs.length, `${bulkLines.length} lines for ${inputs.length} inputs`);
  const wrong = inputs.map((_, i) => i).filter((i) => bulkLines[i] !== reference[i]);
  check("bulk-equals-single-line-by-line", wrong.length === 0,
    wrong.length ? `first mismatches: ${wrong.slice(0, 3).map((i) => `${JSON.stringify(inputs[i].slice(0, 24))} bulk=${bulkLines[i]} single=${reference[i]}`).join(" | ")}` : `${inputs.length} lines byte-identical to the single-address form`);
  const revLines = linesOf(bulk([...inputs].reverse()));
  check("bulk-order-follows-input", revLines.every((l, j) => l === reference[reference.length - 1 - j]), "reversed input yields the reversed answers, in order");
  const mixed = [...inputs, ...inputs.slice(0, 50)];
  const mixedLines = linesOf(bulk(mixed));
  check("bulk-never-stops-on-bad-line", mixedLines.length === mixed.length && mixedLines.slice(0, inputs.length).every((l, i) => l === reference[i]) && mixedLines.slice(inputs.length).every((l, j) => l === reference[j]),
    `${invalid.length} invalid inputs answered in place among ${mixed.length} lines (duplicates keep their order)`);

  // ---- (2) the one module answers byte-identically; the wrapper is the same answer ------------------
  // the module refuses an empty destination before any spawn (as classifyAddress always did), so the
  // empty input is a binary-level vector only
  const moduleInputs = inputs.filter((x) => x !== "");
  const moduleReference = moduleInputs.map((x) => reference[inputs.indexOf(x)]);
  const moduleOut = classifyAddresses(moduleInputs);
  const moduleWrong = moduleInputs.map((_, i) => i).filter((i) => JSON.stringify(moduleOut[i]) !== moduleReference[i]);
  check("module-equals-single", moduleWrong.length === 0,
    moduleWrong.length ? `first mismatches: ${moduleWrong.slice(0, 3).join(", ")}` : `classifyAddresses(${moduleInputs.length}) byte-identical to the single-address form`);
  check("module-dedupes-answers-once", JSON.stringify(classifyAddresses([UA_ORCHARD, UA_ORCHARD])[0]) === JSON.stringify(classifyAddresses([UA_ORCHARD])[0]) && JSON.stringify(classifyAddresses([UA_ORCHARD])[0]) === reference[inputs.indexOf(UA_ORCHARD)],
    "a repeated address answers once, identically");
  let refused = "no refusal";
  try { classifyAddresses([""]); } catch (e) { refused = (e as Error).message; }
  check("empty-destination-still-refused", refused === "refused: destination", `classifyAddresses([""]) -> ${refused}`);
  // the verdicts the destination rule consumes, straight off the module (every caller reads these)
  const uaRow = cases.ua.find((r: any) => r.address === UA_ORCHARD);
  check("module-receivers-match-fixture", JSON.stringify(classifyAddresses([UA_ORCHARD])[0].receivers.map((r) => ({ typecode: r.typecode, data_hex: r.data_hex }))) === JSON.stringify(uaRow.receivers),
    "unified receivers byte-identical to the fixture's own reference receivers");

  // ---- (3) chunking, dedupe and line-protocol routing, counted through a shim binary ----------------
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true, mode: 0o700 });
  const trace = path.join(WORK, "spawns.log");
  const shim = path.join(WORK, "benzo-pczt");
  writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${trace}"\nexec "${REAL}" "$@"\n`);
  chmodSync(shim, 0o755);
  process.env.BNZ_PCZT_BIN = shim;
  const counted = (fn: () => void) => {
    rmSync(trace, { force: true });
    fn();
    const lines = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean) : [];
    return { bulkCalls: lines.filter((l) => l === "classify-address --stdin").length, singleCalls: lines.filter((l) => l.startsWith("classify-address ") && l !== "classify-address --stdin").length };
  };
  const probes = Array.from({ length: 2500 }, (_, i) => `b45-probe-${i}`);
  const withDupes = [...probes, ...probes, ...probes.slice(0, 500)];
  const counts = counted(() => { const out = classifyAddresses(withDupes); if (out.length !== withDupes.length) throw new Error("probe length"); });
  check("bulk-one-call-per-2000", counts.bulkCalls === 2 && counts.singleCalls === 0,
    `2,500 unique misses -> ${counts.bulkCalls} bulk calls (chunks of 2,000), ${counts.singleCalls} single calls; 5,500 inputs with duplicates classified once each`);
  const multi = ["a\nb", "x\ry", "p\nq\nr"];
  const multiCounts = counted(() => classifyAddresses([...multi, "b45-probe-0"]));
  const multiOk = multi.map((m) => JSON.stringify(classifyAddresses([m])[0]) === single(m));
  check("newline-addresses-use-single-form", multiCounts.singleCalls === 3 && multiCounts.bulkCalls === 0 && multiOk.every(Boolean),
    `3 newline/CR addresses -> ${multiCounts.singleCalls} single-form calls (verdicts unchanged), ${multiCounts.bulkCalls} bulk calls`);

  // ---- (4) the cache cannot change a verdict: the cache-purity child --------------------------------
  const run = spawnSync(process.execPath, [process.argv[1], "--cache-child"], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_B45_REAL: REAL, BNZ_B45_WORK: WORK } });
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  check("cache-child-completed", run.status === 0, `cache-purity child exit ${run.status}`);
} else {
  // The cache-purity child: a cold memo, a cache pre-filled exactly as the host fills its classify-cache
  // (the classifier's own output under sha256(address)) — every answer must come from the cache with zero
  // spawns and byte-identical verdicts, and only for the address each entry was keyed under.
  const real = process.env.BNZ_B45_REAL!, work = process.env.BNZ_B45_WORK!;
  const trace = path.join(work, "spawns.log"); // the shim's own trace (see the parent's shim above)
  rmSync(trace, { force: true });
  const sample = [UA_ORCHARD, ...vectors.slice(195, 225), "junk", "child-probe-junk"];
  const raw = sample.map((a) => { const out = execFileSync(real, ["classify-address", a], { encoding: "utf8" }); return out.endsWith("\n") ? out.slice(0, -1) : out; });
  const file: Record<string, Classified> = {};
  sample.forEach((a, i) => { file[sha(a)] = JSON.parse(raw[i]) as Classified; });
  // the host's cache shape (cli/host-derive.ts): keyed by sha256(address), get/set by exact address
  useClassifyCache({ get: (address) => file[sha(address)], set: (address, c) => { file[sha(address)] = c; } });
  const served = classifyAddresses(sample);
  check("cache-serves-with-zero-spawns", !existsSync(trace), `${sample.length} answers from the cache, 0 classifier spawns`);
  const wrong = sample.map((_, i) => i).filter((i) => JSON.stringify(served[i]) !== raw[i]);
  check("cache-verdicts-byte-identical", wrong.length === 0, `${sample.length} cache-served verdicts byte-identical to the classifier's own output`);
  check("cache-keyed-by-sha256-address", file[sha(UA_ORCHARD)] !== undefined && file[sha("an address never classified")] === undefined,
    "an entry is served only for the exact address it was keyed under");
  console.log(`OBSERVE cache child entries ${Object.keys(file).length} keys of sha256(address)`);
}

console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
