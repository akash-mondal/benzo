// Ruling R38 item 6 (N6, A17 item 5) boundary proof + measurement against the real pinned stack (no mocks):
//   n6-max-shape-created  a 29-spends / 28-recipients batch (28 recipients + change = 29 value-carrying halves,
//                         the largest shape `benzo-pczt create` allows under max(spends, outputs) <= 29 and the
//                         new total-action bound <= 30) is created and proved by the shipped binaries.
//   n6-max-shape-counts   the run's own inspect shows exactly 29 spends and 28 non-change outputs, so the
//                         measurement really is at the largest allowed shape.
//   n6-measured           the measured size of that shape is recorded: the proven PCZT and — via the wallet's
//                         own `pay` building and signing the SAME 29-spends / 28-recipients demand (the pinned
//                         devtool's pczt-sign has no ironwood arm and silently signs nothing) — the mined RAW
//                         transaction fetched from lightwalletd (the same measure as R30's scale-27).
// Lab wallet: a fresh $BNZ_STATE_DIR/lab-n6/wallet funded by the project's own bidder wallet with one
// 29-output self-payment of 200,000 zats (5,800,000 total). The demand is 5,600,000: any 28 of the 29 equal
// notes cannot cover it plus the ZIP-317 fee, all 29 can — so the selector must spend exactly all 29 notes,
// whatever order it picks them in. The batch pays 28 outputs back to the lab wallet's own address and the run
// sweeps everything back to the bidder at the end (a funded run is always recovered). Nothing is broadcast
// except these self-payments.
// Run: npx esbuild tools/repro/r38-n6.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r38-n6.mjs && node tmp/r38-n6.mjs
import { execFileSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as z from "../../e2e/lib/zcash";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR || ".benzo");
const DEVTOOL = path.join(STATE, "bin", "zcash-devtool"), LWD = process.env.BNZ_LWD_URL!;
const PCZT = path.join(ROOT, "settle/target/release/benzo-pczt");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r38-n6.mjs (tools/repro/r38-n6.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const sh = (cmd: string, args: string[], input?: string) => {
  try { return { code: 0, out: execFileSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20 }), err: "" }; }
  catch (e: any) { return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? String(e) }; }
};
let failures = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, reason: string) => { failures++; console.log(`ERROR ${id} ${reason}`); };

const lab = assertScratch(path.join(ROOT, "tmp", "r38-n6-lab")), wallet = path.join(lab, "wallet"), idFile = path.join(lab, "lab-n6.age"); // R43: tmp/ only
const bidderAddr = () => sh(PCZT, ["address", path.join(STATE, "bidder"), "--network", "test"]).out.trim().split("\n").at(-1)!;
const labAddr = () => sh(PCZT, ["address", wallet, "--network", "test"]).out.trim().split("\n").at(-1)!;
const labNotes = () => sh(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", wallet]).out.trim().split("\n").filter(Boolean).map((l: string) => JSON.parse(l)).filter((n: any) => !n.spent_in_txid && n.value_zats > 0);

// 1. A fresh lab wallet (its own mnemonic under $BNZ_STATE_DIR/lab-n6.age), nothing reused across runs. Any
// wallet left by an earlier run is swept back to the bidder before it is deleted — a funded run is recovered.
if (existsSync(wallet)) {
  sh(DEVTOOL, ["wallet", "-w", wallet, "sync", "-s", LWD]); sh(DEVTOOL, ["wallet", "-w", wallet, "enhance", "-s", LWD]);
  const old = Number(JSON.parse(sh(DEVTOOL, ["wallet", "-w", wallet, "balance", "--json"]).out.trim().split("\n").at(-1)!).total);
  if (old > 50_000) {
    sh(DEVTOOL, ["wallet", "-w", path.join(STATE, "bidder"), "sync", "-s", LWD]);
    const back = sh(DEVTOOL, ["wallet", "-w", wallet, "pay", "-i", idFile, "--disable-confirmation", "-s", LWD, "--payment-uri", `zcash:?address=${bidderAddr()}&amount=${((old - 200_000) / 1e8).toFixed(8)}`]);
    console.log(`prior lab wallet recovered: ${old} zats (${(back.out.match(/^[0-9a-f]{64}$/gm) ?? []).at(-1)?.slice(0, 16) ?? "refused"}…)`);
  }
}
rmSync(assertScratch(wallet), { recursive: true, force: true }); mkdirSync(lab, { recursive: true, mode: 0o700 });
const init = sh(DEVTOOL, ["wallet", "-w", wallet, "init", "--name", "lab-n6", "-i", idFile, "-n", "test", "-s", LWD]);
if (init.code !== 0) { fail("n6-max-shape-created", `wallet init refused: ${(init.err || init.out).trim().slice(-200)}`); process.exit(1); }

// 2. Fund 29 equal notes of 200,000 from the bidder (one self-payment; ZIP-317 fee paid to the network). The
// bidder wallet syncs first — `pay` derives the expiry from its own chain tip and a stale tip builds a tx that
// is already expired when the node sees it.
sh(DEVTOOL, ["wallet", "-w", path.join(STATE, "bidder"), "sync", "-s", LWD]);
const V = 200_000, N = 29, target = N * V - 200_000; // 5,600,000: 28 notes + fee cannot cover it, all 29 can
const params = new URLSearchParams();
for (let i = 0; i < N; i++) { const s = i ? `.${i}` : ""; params.set(`address${s}`, labAddr()); params.set(`amount${s}`, (V / 1e8).toFixed(8)); }
const fund = sh(DEVTOOL, ["wallet", "-w", path.join(STATE, "bidder"), "pay", "-i", idFile.replace("lab-n6.age", "bidder.age"), "--disable-confirmation", "-s", LWD, "--payment-uri", "zcash:?" + params]);
const funded = (fund.out.match(/^[0-9a-f]{64}$/gm) ?? []).at(-1);
if (fund.code !== 0 || !funded) { fail("n6-max-shape-created", `funding self-payment refused: ${(fund.err || fund.out).trim().slice(-200)}`); process.exit(1); }
console.log(`funding ${funded} — ${N} notes of ${V} to the lab wallet`);
// ZIP 315: an externally sent note needs 10 confirmations before the wallet will spend it — the exact rule that
// made the drop-r33 attempt-1 build refuse a mined in-window balance payment (R38 N5). Poll, never sleep blind.
const deadline = Date.now() + 40 * 60_000;
for (;;) {
  sh(DEVTOOL, ["wallet", "-w", wallet, "sync", "-s", LWD]);
  sh(DEVTOOL, ["wallet", "-w", wallet, "enhance", "-s", LWD]);
  const ns = labNotes();
  if (ns.length >= N && ns.every((n: any) => n.height && z.tip() - n.height + 1 >= 10)) break;
  if (Date.now() > deadline) { fail("n6-max-shape-created", `lab notes never became spendable (${ns.length} notes, tip ${z.tip()})`); process.exit(1); }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
}

// 3. The largest allowed shape: 28 recipients of 200,000 (5,600,000 out) + change, spending all 29 notes.
const recipients = Array.from({ length: 28 }, () => ({ recipient: labAddr(), amount_zats: String(V) }));
const created = path.join(lab, "created.pczt"), proved = path.join(lab, "proved.pczt"), signed = path.join(lab, "signed.pczt");
const mk = sh(PCZT, ["create", wallet, created, "364", "--network", "test"], JSON.stringify(recipients));
if (mk.code !== 0) { fail("n6-max-shape-created", `create refused: ${(mk.err + mk.out).trim().slice(-200)}`); }
else pass("n6-max-shape-created", `29 spends / 28 recipients + change created by the shipped benzo-pczt create`);

// 4. Prove (measure) and inspect the shape from the shipped binary. The UFVK is written to a private file and
// never printed (it is the lab wallet's view key).
let provenBytes = 0;
if (mk.code === 0) {
  const pv = sh(DEVTOOL, ["pczt", "-w", wallet, "prove", created, "--output", proved]);
  if (pv.code !== 0) fail("n6-max-shape-created", `prove refused: ${(pv.err + pv.out).trim().slice(-200)}`);
  else {
    provenBytes = readFileSync(proved).length;
    const ufvk = sh(DEVTOOL, ["wallet", "-w", wallet, "list-accounts"]).out.match(/UFVK: (\S+)/)?.[1] ?? "";
    const ufvkFile = path.join(lab, "ufvk.txt"); writeFileSync(ufvkFile, ufvk + "\n", { mode: 0o600 });
    const info = JSON.parse(sh(PCZT, ["inspect", proved, ufvkFile, "--network", "test"]).out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!);
    const outs = (info.outputs ?? []).filter((o: any) => !o.is_change).length, spends = (info.randomizers ?? []).length;
    pass("n6-max-shape-counts", `spends ${spends}, non-change outputs ${outs}, change ${(info.outputs ?? []).length - outs} (largest allowed: 29 spends, 28 recipients + change = 29 actions)`);
    if (spends !== 29 || outs !== 28) fail("n6-max-shape-counts", `the shape is not the largest allowed one (${spends} spends, ${outs} outs)`);
  }
}

// 5. The raw-transaction measurement: the wallet's own `pay` builds, signs and sends the SAME 29-spends /
// 28-recipients demand (the same selector and builder), so the mined RAW transaction can be fetched from
// lightwalletd — the same measure as R30's scale-27. (`pczt sign` cannot help here: the pinned devtool's
// pczt-sign has no ironwood arm — sign.rs KeyRef covers only orchard/sapling/transparent — and silently
// signs nothing.) Then sweep everything back to the bidder.
if (mk.code === 0 && provenBytes) {
  const params2 = new URLSearchParams();
  for (let i = 0; i < 28; i++) { const s = i ? `.${i}` : ""; params2.set(`address${s}`, labAddr()); params2.set(`amount${s}`, (V / 1e8).toFixed(8)); }
  const paid = sh(DEVTOOL, ["wallet", "-w", wallet, "pay", "-i", idFile, "--disable-confirmation", "-s", LWD, "--payment-uri", "zcash:?" + params2]);
  const txid = (paid.out.match(/^[0-9a-f]{64}$/gm) ?? []).at(-1);
  if (paid.code !== 0 || !txid) fail("n6-measured", `the same-shape self-payment refused: ${(paid.err + paid.out).trim().slice(-200)}`);
  else {
    let raw = 0;
    for (let i = 0; i < 40 && !raw; i++) { try { raw = z.getTransaction(txid).raw.length; } catch { await new Promise(r => setTimeout(r, 15_000)); } }
    console.log(`MEASURED largest-allowed-shape (29 spends, 28 recipients + change, 29 actions): proven PCZT ${provenBytes} bytes; raw transaction ${raw} bytes (txid ${txid.slice(0, 16)}…; scale-27's 28/28 measured 94,380 bytes raw)`);
    raw > 0 ? pass("n6-measured", `proven PCZT ${provenBytes} bytes, raw tx ${raw} bytes at the largest allowed shape`) : fail("n6-measured", `raw transaction for ${txid} never observed`);
  }
}
// Recover the run: everything left in the lab wallet goes back to the bidder. The pay's own outputs need the
// same 10 confirmations before they are spendable (ZIP 315), so poll like the funding step.
for (let i = 0; i < 40; i++) {
  sh(DEVTOOL, ["wallet", "-w", wallet, "sync", "-s", LWD]); sh(DEVTOOL, ["wallet", "-w", wallet, "enhance", "-s", LWD]);
  const b = JSON.parse(sh(DEVTOOL, ["wallet", "-w", wallet, "balance", "--json"]).out.trim().split("\n").at(-1)!);
  const spendable = Number(b.ironwood_spendable) + Number(b.orchard_spendable) + Number(b.sapling_spendable);
  if (spendable > 300_000) {
    sh(DEVTOOL, ["wallet", "-w", path.join(STATE, "bidder"), "sync", "-s", LWD]);
    const sweep = sh(DEVTOOL, ["wallet", "-w", wallet, "pay", "-i", idFile, "--disable-confirmation", "-s", LWD, "--payment-uri", `zcash:?address=${bidderAddr()}&amount=${((spendable - 200_000) / 1e8).toFixed(8)}`]);
    sweep.code === 0 ? pass("n6-recovered", `${spendable} zats returned to the bidder (${(sweep.out.match(/^[0-9a-f]{64}$/gm) ?? []).at(-1)?.slice(0, 16)}…)`) : fail("n6-recovered", `sweep back refused: ${(sweep.err || sweep.out).trim().slice(-200)}`);
    break;
  }
  if (i === 39) fail("n6-recovered", `lab notes never became spendable to sweep back (${spendable} spendable of ${b.total})`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
}

console.log(failures ? "RESULT FAIL r38-n6" : "RESULT PASS r38-n6");
process.exitCode = failures ? 1 : 0;
