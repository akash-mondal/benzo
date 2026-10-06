// R33 item 4 P2s (A15 item 3) boundary proof against the real pinned stack (no mocks):
//   p25-spend-bound          a batch that needs more than 29 value-carrying spends is refused by the shipped
//                            `benzo-pczt create` with its own "batch must have at most 29 spends and 29
//                            outputs" (R30's 100 KB claim now covers spends too). The input notes are made
//                            fresh by this run: the bidder wallet pays ITSELF 32 equal notes, then the batch
//                            is sized to spend essentially all of them (>29), so the bound — not the earlier
//                            recipient bound — is what refuses it.
//   p25-small-ok             the same wallet still creates a 2-recipient batch (the bound never refuses the
//                            normal case; the file is deleted after).
//   p25-recipients-refused   30 recipients still hit the pre-existing 1–28 recipient bound (control).
//   p21-destination-network  the shipped requireShieldedDestination accepts a real testnet UA only under the
//                            manifest's own network ("test") and refuses it under "main" as
//                            "wrong-network address" (G-7 leftovers, P2-1).
// Output: PASS/ERROR per id + RESULT; exit 0 only when all pass. Spends real testnet fees on the project's
// own bidder wallet (a self-payment); creates but never broadcasts any PCZT.
// Run: npx esbuild tools/repro/r33-p2.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r33-p2.mjs && node tmp/r33-p2.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireShieldedDestination } from "../../envelope/destination";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR || ".benzo");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r33-p2.mjs (tools/repro/r33-p2.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const PCZT = path.join(ROOT, "settle/target/release/benzo-pczt");
const DEVTOOL = path.join(STATE, "bin/zcash-devtool");
const SCAN = path.join(ROOT, "scan/target/release/benzo-scan");
const BIDDER = path.join(STATE, "bidder");
const LWD = process.env.BNZ_LWD_URL!;
const sh = (cmd: string, args: string[], input?: string) => {
  try { return { code: 0, ...((() => { const o = execFileSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20 }); return { out: o, err: "" }; })()) }; }
  catch (e: any) { return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? String(e) }; }
};
const addr = () => sh(PCZT, ["address", BIDDER, "--network", "test"]).out.trim().split("\n").at(-1)!;
const scan = () => sh(SCAN, ["scan", "test", BIDDER]).out.trim().split("\n").filter(Boolean).map(l => JSON.parse(l)).filter((n: any) => !n.spent_in_txid);
const walletTotal = () => Number(JSON.parse(sh(DEVTOOL, ["wallet", "-w", BIDDER, "balance", "--json"]).out.trim().split("\n").at(-1)!).total);
const create = (pays: { recipient: string; amount_zats: string }[], name: string) =>
  sh(PCZT, ["create", BIDDER, path.join(ROOT, `tmp/${name}.pczt`), "364", "--network", "test"], JSON.stringify(pays));

let failures = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, reason: string) => { failures++; console.log(`ERROR ${id} ${reason}`); };

// ---- p25: the spend bound ------------------------------------------------
// Fresh notes: one self-payment of 32 equal outputs (testnet fees, own wallet; the ZIP-321 multi-payment URI
// uses bare `address`/`amount` then `address.1`/`amount.1`…, exactly like `benzo bid deposit`). If the wallet
// already holds >= 32 unspent split notes from an earlier run, reuse them.
if (scan().length < 30) {
  const params = new URLSearchParams();
  for (let i = 0; i < 32; i++) { const s = i ? `.${i}` : ""; params.set(`address${s}`, addr()); params.set(`amount${s}`, (0.02).toFixed(8)); }
  const r = sh(DEVTOOL, ["wallet", "-w", BIDDER, "pay", "-i", path.join(STATE, "bidder.age"), "--disable-confirmation", "-s", LWD, "--payment-uri", "zcash:?" + params]);
  if (r.code !== 0) fail("p25-split", `self-payment refused: ${(r.err || r.out).trim().slice(-200)}`);
  else pass("p25-split", `self-payment 32 notes ${(r.out.match(/^[0-9a-f]{64}$/gm) ?? []).at(-1)?.slice(0, 16)}…`);
}
// The batch must be sized to need MORE than 29 of the notes: pay out (wallet total − fee margin) in two
// outputs, so no selection of the largest 29 notes can cover it. (The bidder wallet carries the many small
// change notes of the live runs; a fresh 32-note self-payment above only adds more when it is thin.)
const deadline = Date.now() + 40 * 60_000;
let outcome = "";
for (;;) {
  try { sh(DEVTOOL, ["wallet", "-w", BIDDER, "sync", "-s", LWD]); } catch { /* transient; the next poll retries */ }
  const ns = scan(), total = walletTotal();
  const top29 = [...ns].sort((a: any, b: any) => b.value_zats - a.value_zats).slice(0, 29).reduce((s: number, n: any) => s + n.value_zats, 0);
  if (ns.length >= 30 && total > top29 + 3_000_000) {
    const amount = total - 2_000_000; // fee headroom: this wallet's value is fragmented, and ZIP-317 is 5,000/action
    const r = create([{ recipient: addr(), amount_zats: String(Math.floor(amount / 2)) }, { recipient: addr(), amount_zats: String(amount - Math.floor(amount / 2)) }], "r33-p2-over");
    const msg = (r.err + r.out).trim();
    if (/batch must have at most 29 spends and 29 outputs/.test(msg)) { outcome = `refused with the R33 P2-5 bound over ${ns.length} notes (${total} zats; top-29 ${top29})`; break; }
    if (r.code === 0) { outcome = `created (the selector used <= 29 of ${ns.length} notes); bound not exercised`; break; }
    if (!/InsufficientFunds|Insufficient funds/.test(msg)) { outcome = `unexpected refusal: ${msg.slice(-200)}`; break; }
  }
  if (Date.now() > deadline) { outcome = `notes never became spendable (${ns.length} unspent, total ${total}, top-29 ${top29})`; break; }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
}
outcome.startsWith("refused") ? pass("p25-spend-bound", outcome) : fail("p25-spend-bound", outcome);

// Control: the normal case still creates (and is deleted), and 30 recipients still hit the old bound.
const ok = create([{ recipient: addr(), amount_zats: "1000" }, { recipient: addr(), amount_zats: "1000" }], "r33-p2-small");
ok.code === 0 ? pass("p25-small-ok", "2-recipient batch created") : fail("p25-small-ok", (ok.err + ok.out).trim().slice(-200));
rmSync(path.join(ROOT, "tmp/r33-p2-small.pczt"), { force: true });
const many = Array.from({ length: 30 }, () => ({ recipient: addr(), amount_zats: "1000" }));
const r30 = create(many, "r33-p2-30");
/1–28 recipients|1-28 recipients/.test(r30.err + r30.out) ? pass("p25-recipients-refused", "30 recipients refused by the 1–28 bound") : fail("p25-recipients-refused", (r30.err + r30.out).trim().slice(-200));

// ---- p21: the destination network comes from the manifest -----------------
process.env.BNZ_PCZT_BIN = PCZT;
const ua = addr();
try {
  requireShieldedDestination(ua, "test");
  try { requireShieldedDestination(ua, "main"); fail("p21-destination-network", "a testnet UA passed under manifest network main"); }
  catch (e) { /wrong-network address/.test(String((e as Error).message)) ? pass("p21-destination-network", "testnet UA ok under test, refused wrong-network under main") : fail("p21-destination-network", `unexpected error ${(e as Error).message}`); }
} catch (e) { fail("p21-destination-network", `testnet UA refused under test: ${(e as Error).message}`); }

console.log(failures ? "RESULT FAIL r33-p2" : "RESULT PASS r33-p2");
process.exitCode = failures ? 1 : 0;
