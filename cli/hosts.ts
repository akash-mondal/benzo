// The three OrbStack signer hosts (Phase 5 part 1 §11), as PRODUCT code: run commands on them, push packets, and the
// per-auction custody steps every host-custody run repeats — fresh DKG on the hosts, the operator's UFVK imported per
// host, host envelope and witness keys, witness certificates and envelope-opens reports computed ON the hosts.
// Batch B42 (gate DOC): this is the move of e2e/lib/hosts.ts into the product (`benzo hosts ...`), so the harness and
// the CLI run one copy. e2e/lib/hosts.ts re-exports this module; the harness behaviour (orb/orbctl call sequences,
// timeouts, retries) is unchanged. Nothing here ever prints private key material.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { requireThat, verifyRecord } from "../manifest/schema";
import { checkCertificates, freezeStatement, validateWitnessSet, type WitnessSet } from "../witness";
import { clientCommon as client } from "../clear/registry";
import { lwdBound, lwdTimedOut } from "../settle/bounded";

// Paths and settings with exactly the semantics e2e/lib/env.ts had (the harness relied on them): the repo root from
// git, .env loaded into unset variables, and BNZ_STATE_DIR resolved against the root.
export const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
for (const line of (existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} in .env`);
  return v;
}
export const STATE = path.join(ROOT, env("BNZ_STATE_DIR").replace(/^\.\//, ""));

export const H = "/home/benzo/.benzo", NAMES = ["alice", "bob", "carol"] as const;
export const FROSTD = `host.orb.internal:${env("BNZ_FROSTD_ADDR").split(":").at(-1)}`;
// `orb`/`orbctl` calls have hung indefinitely on a VM that answered the next call instantly (live R28 run): they get a
// 2-minute timeout and up to 3 attempts. A lightwalletd call is bounded as in the product (R48/R49); every other
// command runs once, unbounded. H8: a stuck `orb` client ignores SIGTERM, so every orb/orbctl bound here kills
// with SIGKILL (settle/cli.ts already does; RG attempt 13 and the final RG each hung 1-2 h on SIGTERM).
const ORB_BOUND = { timeout: 120_000, killSignal: "SIGKILL" as const };
export const sh = (cmd: string, args: string[], input?: string) => {
  const orb = cmd === "orb" || cmd === "orbctl";
  let r = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, ...(orb ? ORB_BOUND : lwdBound(cmd, args)) });
  const stalled = orb ? null : lwdTimedOut(cmd, r);
  if (stalled) throw stalled;
  for (let i = 1; orb && r.status === null && i < 3; i++) r = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, ...ORB_BOUND });
  if (r.error && !orb) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 5).join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
};
// `orb run` has returned an empty stdout once for a command that succeeded (live Y2, a host `cat`); retry empties.
export const host = (n: string, args: string[]) => { for (let i = 0; ; i++) { const out = sh("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "benzo", ...args]); if (out || i >= 2) return out; } };
export const hostTry = (n: string, args: string[]) => spawnSync("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "benzo", ...args], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 15 * 60_000, killSignal: "SIGKILL" });
export const hostBenzo = (n: string, args: string[]) => { const out = host(n, [`${H}/bin/benzo`, ...args]); return JSON.parse(out.split("\n").filter(l => l.startsWith("{")).at(-1)!); };
export const push = (n: string, src: string, dest: string) => {
  sh("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "root", "rm", "-rf", `/home/benzo/${dest}`]);
  sh("orbctl", ["push", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, src, dest]);
  sh("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "root", "chown", "-R", "benzo:benzo", `/home/benzo/${dest}`]);
};

// The operator's own CLI, invoked exactly as the harness invokes it (bin/benzo): the last JSON line of stdout.
export const localBenzo = (args: string[], input?: any): any => {
  const out = sh(benzoBin, args, input === undefined ? undefined : JSON.stringify(input));
  return out.startsWith("{") || out.startsWith("[") ? JSON.parse(out.split("\n").filter(l => l.startsWith("{") || l.startsWith("[")).at(-1)!) : out;
};

// The harness's DKG lock (tools/repro/markets.ts run()): concurrent DKGs on the same hosts and frostd collide, so
// processes take turns over the same lock directory. A crashed holder's lock is stale after 10 minutes; the removal
// keeps the R43 rule (a script may delete only under tmp/), and the fixed path is always there.
const DKG_LOCK = path.join(ROOT, "tmp", "markets-dkg.lock");
export async function withDkgLock<T>(body: () => Promise<T>): Promise<T> {
  mkdirSync(path.dirname(DKG_LOCK), { recursive: true });
  for (;;) {
    try { mkdirSync(DKG_LOCK); break; }
    catch {
      if (existsSync(DKG_LOCK) && Date.now() - statSync(DKG_LOCK).mtimeMs > 600_000) rmUnderTmp(DKG_LOCK);
      else await new Promise(r => setTimeout(r, 5_000));
    }
  }
  try { return await body(); } finally { rmUnderTmp(DKG_LOCK); }
}
function rmUnderTmp(p: string): void {
  const r = path.resolve(p);
  requireThat(r.startsWith(path.join(ROOT, "tmp") + path.sep), "R43: refusing to delete outside tmp/");
  rmSync(r, { recursive: true, force: true });
}

// Fresh 2-of-3 DKG for this auction on the three hosts, then the per-auction vault on the Mac (`benzo auction keys`)
// and the same UFVK imported on every host. Returns the operator's {group_key, escrow_ua} and the reported keys.
export async function dkgOnHosts(id: string, benzo: (args: string[], input?: any) => any) {
  const pk = (n: string) => host(n, ["cat", `${H}/contacts/${n}.pubkey`]);
  // A killed or failed earlier DKG leaves sessions open on frostd, and frost-client then refuses to join ("user has
  // more than one FROST session active"); close each host user's sessions first (callers serialize DKGs).
  for (const n of NAMES) spawnSync("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "benzo", "env", `SSL_CERT_FILE=${H}/tls/rootCA.pem`, `${H}/bin/frost-client`, "sessions", "-c", `${H}/frost/${n}.toml`, "-s", FROSTD, "--close-all"], ORB_BOUND);
  const keys = await Promise.all(NAMES.map((n, i) => new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      const p = spawn("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "benzo", `${H}/bin/benzo`, "sign", "dkg", "--id", id, "--name", n, "--server", FROSTD, ...(i === 0 ? ["--peers", `${pk("bob")},${pk("carol")}`] : [])]);
      let out = "", err = "";
      // H8: a DKG that has not finished in 10 minutes is stuck (a live one takes seconds); SIGKILL it so the caller
      // fails loudly. `sign dkg` is idempotent per auction, so a re-run reports a finished key instead of redoing it.
      const stuck = setTimeout(() => p.kill("SIGKILL"), 10 * 60_000);
      p.stdout.on("data", d => (out += d)); p.stderr.on("data", d => (err += d));
      p.on("close", c => { clearTimeout(stuck); return c === 0 ? resolve(JSON.parse(out.trim().split("\n").at(-1)!).group_key) : reject(new Error(`${n} dkg: ${err.trim().slice(-300)}`)); });
    }, i === 0 ? 0 : 2500);
  })));
  const groupKeys = keys.join(",");
  const k = benzo(["auction", "keys", "--id", id, "--group-keys", groupKeys]);
  // Hosts import the operator's UFVK (zcash-sign draws the non-ak components at random; one UFVK per auction).
  for (const n of NAMES) {
    const f = `ufvk-${id.slice(0, 12)}.txt`;
    sh("orbctl", ["push", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, path.join(STATE, "vaults", id, "ufvk.txt"), f]);
    sh("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "root", "chown", "benzo:benzo", `/home/benzo/${f}`]);
    hostBenzo(n, ["auction", "keys", "--id", id, "--group-keys", groupKeys, "--ufvk", `/home/benzo/${f}`]);
    sh("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "root", "rm", "-f", `/home/benzo/${f}`]);
  }
  return { keys, group_key: k.group_key as string, escrow_ua: k.escrow_ua as string };
}

// Host envelope keys (pinned in the manifest) and host witness keys (in the signed witness set); private halves
// never leave the hosts. Existing keys are reused.
export function hostEnvelopeKeys(): string[] {
  return NAMES.map(n => {
    const f = `${H}/signers/${n}/envelope-key.json`;
    // H8: bounded like every orb call; a killed probe (status null) is retried, then thrown, never read as "absent"
    // (that would mint a new envelope key over the pinned one).
    let t = spawnSync("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "benzo", "test", "-f", f], ORB_BOUND);
    for (let i = 1; t.status === null && i < 3; i++) t = spawnSync("orb", ["run", "-m", `${process.env.BNZ_HOST_PREFIX??"benzo"}-${n}`, "-u", "benzo", "test", "-f", f], ORB_BOUND);
    requireThat(t.status !== null, `host ${n} did not answer the envelope-key probe`);
    const exists = t.status === 0;
    return exists ? JSON.parse(host(n, ["cat", f])).public_hex : hostBenzo(n, ["sign", "envelope-key", "--name", n]).public_hex;
  });
}
export function hostWitnessKeys(): string[] {
  return NAMES.map(n => {
    const reg = path.join(STATE, "custody", `witness-${n}.pub`);
    if (existsSync(reg)) return readFileSync(reg, "utf8").trim();
    const w = hostBenzo(n, ["witness", "keygen", "--name", n]); mkdirSync(path.dirname(reg), { recursive: true }); writeFileSync(reg, w.public_hex); return w.public_hex;
  });
}

// One checked merge for the hosts' witness certificates (B42, gate DOC): the merged certificate list is verified
// q_w-of-n_w against the signed witness set and the frozen statement (checkCertificates) BEFORE it is written, so a
// wrong or forged certificate never reaches the published document. This replaces the harness's raw JSON edit; the
// written document is byte-identical to the one that edit produced. `benzo open` and settle/plan.ts re-check the same
// invariants at their own gates.
export function mergeWitnessCerts(publicDir: string, certs: any[]): void {
  const docFile = path.join(publicDir, "auction.json");
  const doc = JSON.parse(readFileSync(docFile, "utf8"));
  requireThat(doc.frozen, "missing frozen: witness certificates exist only after freeze");
  const { manifest: m } = client(doc.manifest, doc.signer);
  const spec = validateWitnessSet(verifyRecord<WitnessSet>(doc.witness_set, doc.signer), m.auction_id);
  const statement = freezeStatement(m, doc.frozen);
  const merged = [...(doc.witness_cert ?? [])];
  for (const c of certs) if (!merged.some((x: any) => JSON.stringify(x) === JSON.stringify(c))) merged.push(c);
  checkCertificates(merged, spec, statement);
  doc.witness_cert = merged;
  writeFileSync(docFile, JSON.stringify(doc));
}

// Witness certificates signed ON the named hosts (each recomputes the frozen root from its own vault scan first,
// design §5), merged into the Mac's public auction.json through the checked merge above.
export function hostWitnessCerts(id: string, publicDir: string, signer: string, names: string[]) {
  const dir = `pub-${id.slice(0, 12)}`;
  const gathered: any[] = [];
  for (const n of names) {
    push(n, publicDir, dir);
    host(n, [`${H}/bin/benzo`, "witness", "sign", "--dir", `/home/benzo/${dir}`, "--signer", signer, "--key", `${H}/witness/${n}.key`]);
    const hostDoc = JSON.parse(host(n, ["cat", `/home/benzo/${dir}/auction.json`]));
    for (const c of hostDoc.witness_cert ?? []) if (!gathered.some((x: any) => JSON.stringify(x) === JSON.stringify(c))) gathered.push(c);
  }
  mergeWitnessCerts(publicDir, gathered);
}

// R23.2 envelope-opens reports computed ON each host from its own key and vault, saved where the plan reads them.
// Returns the saved reports so `benzo hosts envelope-opens` can summarize them.
export function hostEnvelopeOpens(id: string, publicDir: string): any[] {
  const dir = `pub-${id.slice(0, 12)}`;
  const reports: any[] = [];
  // R15 item 3 / Ruling R40 item 2: the recorded claims join the report input (the claim's opening report
  // supersedes any bid-envelope entry for its row), pushed sealed exactly as the settlement packet relays them.
  const claims = path.join(STATE, "settle", id, "claims.json");
  for (const n of NAMES) {
    for (const v of ["sync", "enhance"]) host(n, [`${H}/bin/zcash-devtool`, "wallet", "-w", `${H}/vaults/${id}/wallet`, v, "-s", env("BNZ_LWD_URL")]);
    push(n, publicDir, dir);
    if (existsSync(claims)) push(n, claims, `claims-${id.slice(0, 12)}.json`);
    const report = hostBenzo(n, ["sign", "envelope-opens", "--id", id, "--name", n, "--public", `/home/benzo/${dir}`, "--witness-key", `${H}/witness/${n}.key`, ...(existsSync(claims) ? ["--claims", `/home/benzo/claims-${id.slice(0, 12)}.json`] : [])]);
    mkdirSync(path.join(STATE, "settle", id), { recursive: true });
    writeFileSync(path.join(STATE, "settle", id, `envelope-opens-${n}.json`), JSON.stringify(report));
    reports.push(report);
  }
  return reports;
}
// Part 2 §2 cross-chain on the hosts: each signer host generates its OWN xchain key (public half registered on the
// Mac for the escrow's pinned signer set; the private half never leaves the host) and signs its attestation record
// over the pushed public dir with `xchain attest --host-record`.
export function hostXchainKeys(chain: "evm" | "solana"): string[] {
  return NAMES.map(n => {
    const reg = path.join(STATE, "custody", `xchain-${chain}-${n}.pub`);
    if (existsSync(reg)) return readFileSync(reg, "utf8").trim();
    const k = hostBenzo(n, ["xchain", "keygen", "--chain", chain, "--name", n]);
    mkdirSync(path.dirname(reg), { recursive: true }); writeFileSync(reg, k.public); return k.public;
  });
}
export const hostXchainAttest = (n: string, args: string[]): any => {
  return JSON.parse(host(n, [`${H}/bin/benzo`, "xchain", "attest", "--host-record", ...args]));
};

// Ruling R40 item 3 (F4): the canonical launch delivery list is built and signed ON the named hosts (each
// opens the sealed records with its own envelope key and checks every owner signature against its own
// openings), merged here and recorded with `benzo launch deliver-list`. Returns the merged list.
export function hostDeliveryList(id: string, publicDir: string, deliveriesFile: string, signer: string, names: string[]): any {
  const dir = `pub-${id.slice(0, 12)}`;
  let merged: any = null;
  for (const n of names) {
    push(n, publicDir, dir);
    push(n, deliveriesFile, "deliveries.json");
    const out = hostBenzo(n, ["sign", "delivery", "--id", id, "--public", `/home/benzo/${dir}`, "--deliveries", "/home/benzo/deliveries.json", "--name", n, "--signer", signer]);
    requireThat(out && out.allocation_file_hash && out.batch && Array.isArray(out.signatures) && out.signatures.length === 1, `${n} delivery-list output`);
    if (!merged) merged = out;
    else {
      if (out.allocation_file_hash !== merged.allocation_file_hash || JSON.stringify(out.batch) !== JSON.stringify(merged.batch))
        throw new Error(`the signing hosts built different delivery lists (${merged.allocation_file_hash.slice(0, 12)}… vs ${out.allocation_file_hash.slice(0, 12)}…)`);
      merged.signatures.push(out.signatures[0]);
    }
  }
  return merged;
}

export const benzoBin = path.join(ROOT, "bin/benzo");
