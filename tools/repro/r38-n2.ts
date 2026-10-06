// Ruling R38 item 1 (N2, A17 item 1) lab repro for the `auction create` half: the fresh-address property is
// enforced where it is ours to enforce — create refuses a generated balance address that already holds a note
// (`a generated balance address already holds N note(s); refusing`), after syncing its vault so a stale wallet
// cannot regenerate a paid address unchecked. (The settlement-time refusal this replaces is replayed over the
// A17 item 6 live run as docs/evidence/phase-5/mutations/A17-N2.)
// The pinned wallet derives the next address at a clock-based diversifier index (now + 2817325936, skipping
// indices the wallet itself exposed — zcash_client_sqlite get_next_available_address). This repro exposes a
// consecutive run of indices with a burst of address generations, so EVERY later generation whose clock base
// falls inside the burst's span skips the run and lands deterministically on the run's next index: a peek copy
// of the wallet reveals that address, the project's bidder wallet dusts it (a real testnet note), and the
// shipped `benzo auction create` regenerates exactly that address and must refuse it. The dust sits in the lab
// wallet (the bidder's own keys, under $BNZ_STATE_DIR) and is swept back at the end.
// Run: npx esbuild tools/repro/r38-n2.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r38-n2.mjs && node tmp/r38-n2.mjs
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR || ".benzo");
const DEVTOOL = path.join(STATE, "bin", "zcash-devtool"), LWD = process.env.BNZ_LWD_URL!;
const PCZT = path.join(ROOT, "settle/target/release/benzo-pczt"), BENZO = path.join(ROOT, "cli/dist/benzo.mjs");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r38-n2.mjs (tools/repro/r38-n2.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const sh = (cmd: string, args: string[], input?: string, env?: Record<string, string>) => {
  try { return { code: 0, out: execFileSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, ...env } }), err: "" }; }
  catch (e: any) { return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? String(e) }; }
};
let failures = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, reason: string) => { failures++; console.log(`ERROR ${id} ${reason}`); };

// A consistent wallet copy: sqlite online backup (a plain file copy races the WAL and can lose tables).
const copyWallet = (src: string, dst: string) => {
  mkdirSync(dst, { recursive: true, mode: 0o700 });
  for (const f of ["data.sqlite", "blockmeta.sqlite"]) sh("sqlite3", [path.join(src, f), `.backup "${path.join(dst, f)}"`]);
  if (existsSync(path.join(src, "keys.toml"))) cpSync(path.join(src, "keys.toml"), path.join(dst, "keys.toml"));
};

const MODE = process.argv[2] ?? "create";
if (MODE !== "derivable") {
// 1. The lab state: a copy of the bidder wallet (its own keys stay under $BNZ_STATE_DIR) as the create's vault.
const lab = path.join(STATE, "lab-n2"), vault = path.join(lab, "vault"), peek = path.join(lab, "peek");
rmSync(lab, { recursive: true, force: true }); mkdirSync(path.join(lab, "vault"), { recursive: true, mode: 0o700 }); mkdirSync(path.join(lab, "run"), { recursive: true, mode: 0o700 });
copyWallet(path.join(STATE, "bidder"), vault);

const addrOf = (w: string) => { const a = sh(PCZT, ["address", w, "--network", "test"]).out.trim().split("\n").at(-1) ?? ""; if (!a.startsWith("u")) throw new Error(`could not generate an address for ${w}: ${a}`); return a; };

// 2. Burst: expose a consecutive run of diversifier indices in the create wallet (one call per index; the calls
// are ~4/s so the clock base advances slower than the run and the indices stay consecutive).
const K = 4800;
const t0 = Date.now();
for (let i = 0; i < K; i++) addrOf(vault);
const burstSeconds = Math.round((Date.now() - t0) / 1000);
// 3. The peek copy reveals the run's next index — the one every generation inside the burst's span lands on.
copyWallet(vault, peek);
const target = addrOf(peek);
console.log(`burst: ${K} generations in ${burstSeconds}s; every create generation inside that span lands on ${target.slice(0, 20)}…`);
const windowLeft = Math.floor(K - burstSeconds - (Date.now() - t0) / 1000);
if (windowLeft < 90) { fail("n2-create-refuses-paid-address", `the index window has only ${windowLeft}s left after the burst`); process.exit(1); }

// 4. Dust it with one real testnet note from the bidder wallet (sync first — a stale tip builds an expired tx).
sh(DEVTOOL, ["wallet", "-w", path.join(STATE, "bidder"), "sync", "-s", LWD]);
const dust = sh(DEVTOOL, ["wallet", "-w", path.join(STATE, "bidder"), "pay", "-i", path.join(STATE, "bidder.age"), "--disable-confirmation", "-s", LWD, "--payment-uri", `zcash:?address=${target}&amount=0.0001`]);
const dustTx = (dust.out.match(/^[0-9a-f]{64}$/gm) ?? []).at(-1);
if (dust.code !== 0 || !dustTx) { fail("n2-create-refuses-paid-address", `dust payment refused: ${(dust.err || dust.out).trim().slice(-200)}`); process.exit(1); }
console.log(`dust ${dustTx.slice(0, 16)}… sent to the target address; waiting for it to mine (the check syncs the vault first, so it must be on chain)`);

// 5. Wait until the lab vault's own scan sees the note (bounded; the index window is ~K seconds long).
const scan = () => sh(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", vault]).out.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
let seen = false;
for (let i = 0; i < 240 && !seen; i++) {
  sh(DEVTOOL, ["wallet", "-w", vault, "sync", "-s", LWD]); sh(DEVTOOL, ["wallet", "-w", vault, "enhance", "-s", LWD]);
  seen = scan().some((n: any) => n.address === target && n.height);
  if (!seen) { if (Date.now() - t0 > (K - 20) * 1000) break; await new Promise(r => setTimeout(r, 15_000)); }
}
if (!seen) { fail("n2-create-refuses-paid-address", `the dust never became visible to the vault scan inside the index window (sent ${dustTx.slice(0, 16)}…)`); process.exit(1); }

// 6. The shipped `benzo auction create` regenerates the paid address (its clock base is inside the burst's span)
// and must refuse it. The minimal manifest reaches the bond block (the refusal runs before mode validation).
const manifest = JSON.stringify({
  version: 1, network: "test", auction_id: randomBytes(32).toString("hex"),
  refund: { invalid: "full_C" }, deposit_addresses: [addrOf(peek)],
  bond: { bond_bps: 1000, balance_window_blocks: 40, balance_window_start_height: 5_000_000 },
});
const created = sh(process.execPath, [BENZO, "auction", "create"], manifest, { BNZ_STATE_DIR: lab });
const msg = (created.err + created.out).trim();
if (/a generated balance address already holds 1 note\(s\); refusing/.test(msg)) pass("n2-create-refuses-paid-address", `create refused the regenerated paid address: ${msg.split("\n").filter(l => /refusing/.test(l)).at(-1)?.trim()}`);
else fail("n2-create-refuses-paid-address", `create did not refuse the paid address (exit ${created.code}): ${msg.slice(-300)}`);

// 7. Recover: the dust was sent to an address derived from the bidder's own seed, so it never left the
// bidder's keyspace — the bidder wallet itself tracks it (the scan trial-decrypts every derived index).
sh(DEVTOOL, ["wallet", "-w", path.join(STATE, "bidder"), "sync", "-s", LWD]);
sh(DEVTOOL, ["wallet", "-w", path.join(STATE, "bidder"), "enhance", "-s", LWD]);
const mine = sh(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "bidder")]).out.trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
  .find((n: any) => n.address === target && !n.spent_in_txid);
mine ? pass("n2-recovered", `the dust note (${mine.value_zats} zats) is a note of the bidder's own wallet at its derived address — nothing left the project's keyspace`)
     : fail("n2-recovered", `the bidder wallet does not see the dust note at ${target.slice(0, 20)}…`);
}

// ---- mode `derivable`: the settlement half (R38 item 1 / N2) ---------------------------------------
// `node tmp/r38-n2.mjs derivable <benzo-bin> <auction-id>` runs the shipped `benzo sign derivable` (the entry
// point whose host derivation held the pre-change refusal) over a lab copy of that run's OWN state and packet.
// The run must carry third-party dust at a balance address mined before the window start (the A17 drop scenario
// sends it). Green: the host derives every payable row from its own data — including the out-of-window refund
// row for that dust, matching the published counts (R38 item 4) — and says nothing about pre-window notes.
// Red (docs/evidence/phase-5/mutations/A17-N2.patch, the pre-change refusal restored): the same derivation
// wedges with its own "stale or pre-funded value refused" — the refusal over chain state a third party can
// create, exactly what R38 deletes. The lab state holds only key material under $BNZ_STATE_DIR (group key =
// the manifest's own published value, the vault UFVK and wallet copy, this signer's envelope key).
if (MODE === "derivable") {
  const [binPath, id] = process.argv.slice(3);
  const docFile = path.join(ROOT, "tmp/markets/public", id, "auction.json");
  const doc = JSON.parse(readFileSync(docFile, "utf8"));
  const manifest = JSON.parse(Buffer.from(doc.manifest.bytes, "base64").toString("utf8"));
  const lab2 = path.join(STATE, "lab-n2b");
  rmSync(lab2, { recursive: true, force: true });
  for (const d of ["run", "auctions", "vaults", "signers"]) mkdirSync(path.join(lab2, d), { recursive: true, mode: 0o700 });
  try { cpSync(path.join(STATE, "bin"), path.join(lab2, "bin"), { recursive: true, dereference: true }); } catch { /* tools resolve from the build tree too */ }
  cpSync(path.join(STATE, "proto"), path.join(lab2, "proto"), { recursive: true });
  mkdirSync(path.join(lab2, "auctions", id), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(lab2, "auctions", id, "group-key.txt"), manifest.frost_group_key + "\n", { mode: 0o600 });
  mkdirSync(path.join(lab2, "vaults", id), { recursive: true, mode: 0o700 });
  copyWallet(path.join(STATE, "vaults", id, "wallet"), path.join(lab2, "vaults", id, "wallet"));
  cpSync(path.join(STATE, "vaults", id, "ufvk.txt"), path.join(lab2, "vaults", id, "ufvk.txt"));
  // This signer's envelope key comes from its own signer host (the manifest pins the HOSTS' keys; the Mac's
  // pre-host-custody copy is stale). Key material stays under $BNZ_STATE_DIR.
  mkdirSync(path.join(lab2, "signers", "alice"), { recursive: true, mode: 0o700 });
  const ek = sh("orb", ["run", "-m", "benzo-alice", "-u", "benzo", "cat", "/home/benzo/.benzo/signers/alice/envelope-key.json"]);
  if (ek.code !== 0 || !ek.out.trim().startsWith("{")) { console.log(`ERROR n2-derivable could not fetch this signer's envelope key from its host: ${(ek.err || ek.out).trim().slice(-160)}`); process.exit(1); }
  writeFileSync(path.join(lab2, "signers", "alice", "envelope-key.json"), ek.out.trim() + "\n", { mode: 0o600 });
  const packet = path.join(STATE, "settle", id, "derivable");
  const run = sh(process.execPath, [binPath, "sign", "derivable", "--id", id, "--packet", packet, "--name", "alice"], undefined, { BNZ_STATE_DIR: lab2, BNZ_LWD_SINGLE: "1" });
  const out = run.out + run.err;
  const rows = (() => { try { return JSON.parse(out.trim().split("\n").filter(l => l.startsWith("{")).at(-1)!).rows as { party: string; amount_zats: string }[]; } catch { return []; } })();
  const want = (doc.settlement?.balance_refunds ?? []) as { leaf_index: number; amount_zats: string }[];
  const got = want.map(w => rows.find(r => r.party === `leaf:${w.leaf_index}` && r.amount_zats === w.amount_zats) ? 1 : 0);
  const ok = run.code === 0 && want.length > 0 && got.every(Boolean) && !/stale or pre-funded/.test(out);
  console.log(`${ok ? "PASS" : "FAIL"} n2-derivable exit ${run.code}; host rows ${JSON.stringify(rows)}; published balance_refunds ${JSON.stringify(want)}${ok ? "" : `; output tail: ${out.trim().split("\n").slice(-2).join(" | ").slice(-300)}`}`);
  if (!ok) console.log(`ERROR n2-derivable ${run.code === 0 ? "the host did not derive the out-of-window refund rows it must" : `the derivation refused (exit ${run.code}): ${out.split("\n").filter(l => /ERROR|refused/.test(l)).at(-1)?.trim()}`}`);
  else pass("n2-derivable", "the host derives every payable row from its own data, including the out-of-window refund row");
  if (!ok) failures++;
}

console.log(failures ? "RESULT FAIL r38-n2" : "RESULT PASS r38-n2");
process.exitCode = failures ? 1 : 0;
