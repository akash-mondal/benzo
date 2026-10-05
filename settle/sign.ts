// Glue for frostd, frost-client and zcash-sign: one FROST signing session per randomizer (trap 7), answered on the
// prompts the tools print (trap 6).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { bin, env, inspect, STATE, ROOT, timing } from "./io";
const E2E=path.join(STATE,"run");

const TLS = path.join(STATE, "tls");
const cfg = (name: string) => path.join(STATE, "frost", `${name}.toml`);
export const pubkey = (name: string) => readFileSync(path.join(STATE, "frost", `${name}.pubkey`), "utf8").trim();
export const groupKey = () => readFileSync(path.join(STATE, "group-key.txt"), "utf8").trim();

type Proc = { child: ChildProcess; out: string; err: string; done: Promise<number> };

function start(cmd: string, args: string[], extraEnv: Record<string, string> = {}): Proc {
  const child = spawn(cmd, args, { env: { ...process.env, ...extraEnv } });
  const p: Proc = { child, out: "", err: "", done: Promise.resolve(0) };
  child.stdout!.on("data", (d) => (p.out += d));
  child.stderr!.on("data", (d) => (p.err += d));
  p.done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      appendFileSync(path.join(E2E, "cli.log"), `\n$ ${path.basename(cmd)} ${args.join(" ")}\n${p.out}${p.err}`);
      resolve(code ?? -1);
    });
  });
  return p;
}

// Resolves when `text` appears on stdout or stderr; rejects if the process exits first.
function when(p: Proc, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => (p.out + p.err).includes(text) && resolve();
    p.child.stdout!.on("data", check);
    p.child.stderr!.on("data", check);
    p.done.then((code) => reject(new Error(`"${text}" never appeared; exited ${code}: ${(p.err || p.out).trim().slice(-300)}`)));
    check();
  });
}

const frostClient = (args: string[]) => start(bin("frost-client"), args, { SSL_CERT_FILE: path.join(TLS, "rootCA.pem") });
// §11 H4 (host custody): an auction that ran its own DKG keeps its shares on the OrbStack signer hosts. The FROST
// coordinator runs on the first chosen host (its auction config holds the group) and each participant joins from
// its own host through `benzo sign join`, which answers frost-client's prompt itself against its own approval.
export type HostCustody = { id: string; groupKey: string; server: string; network: string }; // network: the signed manifest's (G-7)
const H = "/home/benzo/.benzo";
const orb = (name: string, args: string[]) => start("orb", ["run", "-m", `benzo-${name}`, "-u", "benzo", ...args]);
const hostPubkeys = new Map<string, string>();
export function hostPubkey(name: string): string {
  if (!hostPubkeys.has(name)) {
    const r = require_spawnSync("orb", ["run", "-m", `benzo-${name}`, "-u", "benzo", "cat", `${H}/contacts/${name}.pubkey`]);
    if (!/^[0-9a-f]{64}$/.test(r)) throw new Error(`host ${name} published no contact pubkey`);
    hostPubkeys.set(name, r);
  }
  return hostPubkeys.get(name)!;
}
function require_spawnSync(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 4).join(" ")} exited ${r.status}: ${(r.stderr || "").trim().slice(-200)}`);
  return r.stdout.trim();
}


export type Session = { signers: string[]; sighash: string; randomizer: string; signature: string; participantsSaw: string[]; coordinator_started_at:number;duration_ms:number };

// One coordinator session (the first selected member coordinates; both selected members sign) for one sighash and one randomizer.
async function signOnce(sighash: string, randomizer: string, check: (name:string, randomizer:string, sighash:string)=>void,pair:string[],auction?:string,batch?:number,candidate?:string,custody?:HostCustody): Promise<Session> {
  const started=Date.now();
  if (custody) {
    // Host custody: approvals were recorded on the hosts before signing (worker); nothing is answered from here.
    const signers = pair.map(hostPubkey), coordinator_started_at = Date.now();
    const coordinator = orb(pair[0], ["env", `SSL_CERT_FILE=${H}/tls/rootCA.pem`, `${H}/bin/frost-client`, "coordinator", "-c", `${H}/auctions/${custody.id}/frost.toml`, "-s", custody.server, "-g", custody.groupKey, "-S", signers.join(","), "-m", "-", "-r", "-", "-o", "-"]);
    coordinator.child.stdin!.end(`${sighash}\n${randomizer}\n`);
    await when(coordinator, "Waiting for participants to send their commitments");
    const participants: Proc[] = [];
    for (const n of pair) {
      const p = orb(n, [`${H}/bin/benzo`, "sign", "join", "--id", custody.id, "--name", n, "--sighash", sighash, "--randomizer", randomizer, "--server", custody.server]);
      participants.push(p); await when(p, "Joining signing session...");
      // Test-only drill hook (BNZ_DRILL_STOP=<signer>): stop that signer's host after it joined, mid-session, once.
      if (process.env.BNZ_DRILL_STOP === n && !process.env.BNZ_DRILL_DONE) { process.env.BNZ_DRILL_DONE = "1"; require_spawnSync("orb", ["stop", `benzo-${n}`]); }
    }
    // A participant that dies mid-session (host stopped) aborts the session at once: the coordinator would wait
    // for its share forever. The error names the failed signers so the worker can re-plan the batch without them.
    const failed: string[] = [];
    // The FIRST participant to fail is the lost signer; the session is then dead for everyone, so the coordinator and
    // every other participant are stopped too (a survivor would otherwise wait forever for a session that is gone).
    let aborted = false;
    participants.forEach((p, i) => p.done.then((c) => {
      if (c !== 0 && !aborted) { aborted = true; failed.push(pair[i]); coordinator.child.kill(); participants.forEach((q, j) => { if (j !== i) q.child.kill(); }); }
    }));
    const timer = setTimeout(() => coordinator.child.kill(), 180_000);
    const codes = await Promise.all([coordinator.done, ...participants.map((p) => p.done)]);
    clearTimeout(timer);
    if (codes.some((c) => c !== 0)) {
      const lostErr = failed.length ? (participants[pair.indexOf(failed[0])] as any).err?.trim().slice(-200) ?? "" : "";
      const e = new Error(`host signing session exit codes ${codes.join(",")} (failed: ${failed.join(",") || "coordinator"}${lostErr ? `: ${lostErr}` : ""}): ${(coordinator.err || coordinator.out).trim().slice(-200)}`) as Error & { failedSigners?: string[] };
      e.failedSigners = failed.length ? failed : [pair[0]];
      throw e;
    }
    const sigs = coordinator.out.match(/^[0-9a-f]{128}$/gm);
    if (!sigs) throw new Error("host coordinator printed no signature");
    const participantsSaw = participants.map((p) => p.out.match(/Message to be signed \(hex-encoded\):\n([0-9a-f]+)/)?.[1] ?? "");
    return { signers, sighash, randomizer, signature: sigs[sigs.length - 1], participantsSaw, coordinator_started_at, duration_ms: Date.now() - started };
  }
  for(const name of pair)check(name,randomizer,sighash);
  const signers = pair.map(pubkey);
  const addr = env("BNZ_FROSTD_ADDR");
  const coordinator_started_at=Date.now();
  const coordinator = frostClient(["coordinator", "-c", cfg(pair[0]), "-s", addr, "-g", groupKey(), "-S", signers.join(","), "-m", "-", "-r", "-", "-o", "-"]);
  coordinator.child.stdin!.end(`${sighash}\n${randomizer}\n`);
  await when(coordinator, "Waiting for participants to send their commitments");
  const participants:Proc[]=[];
  for(const n of pair) {
    const p=auction?start(process.execPath,[path.join(ROOT,"cli/dist/benzo.mjs"),"sign","join","--id",auction,"--batch",String(batch),"--candidate",candidate!,"--name",n,"--randomizer",randomizer,"--sighash",sighash]):frostClient(["participant", "-c", cfg(n), "-s", addr, "-g", groupKey()]);
    participants.push(p);await when(p,"Joining signing session...");
  }
  await Promise.all(participants.map((p) => when(p, "Do you want to sign it? (y/n)").then(() => p.child.stdin!.end("y\n"))));
  const codes = await Promise.all([coordinator.done, ...participants.map((p) => p.done)]);
  if (codes.some((c) => c !== 0)) throw new Error(`signing session exit codes ${codes.join(",")}: ${coordinator.err.trim().slice(-300)}`);
  const sigs = coordinator.out.match(/^[0-9a-f]{128}$/gm);
  if (!sigs) throw new Error("coordinator printed no signature");
  const participantsSaw = participants.map((p) => p.out.match(/Message to be signed \(hex-encoded\):\n([0-9a-f]+)/)?.[1] ?? "");
  return { signers, sighash, randomizer, signature: sigs[sigs.length - 1], participantsSaw, coordinator_started_at,duration_ms:Date.now()-started };
}

// Phase 6 (R29): host custody signs every spend of a transaction at once — one single-message coordinator session per
// randomizer on the pair's first host, all open together, and one `benzo sign join --count N` per signer host that joins
// each of them (frost-client's participant signs only the first message of a session, so no multi-message session).
// Measured live: one ~8 s session per spend, serially, was the settlement bottleneck (docs/design/phase6-scale.md §2.1).
async function signParallelHost(sighash: string, randomizers: string[], pair: string[], custody: HostCustody): Promise<Session[]> {
  const started = Date.now(), coordinator_started_at = started, signers = pair.map(hostPubkey);
  const coordinators = randomizers.map(r => {
    const c = orb(pair[0], ["env", `SSL_CERT_FILE=${H}/tls/rootCA.pem`, `${H}/bin/frost-client`, "coordinator", "-c", `${H}/auctions/${custody.id}/frost.toml`, "-s", custody.server, "-g", custody.groupKey, "-S", signers.join(","), "-m", "-", "-r", "-", "-o", "-"]);
    c.child.stdin!.end(`${sighash}\n${r}\n`); return c;
  });
  const all: Proc[] = [...coordinators];
  const failed: string[] = [];
  let aborted = false;
  const abort = () => { if (!aborted) { aborted = true; all.forEach(p => p.child.kill()); } };
  coordinators.forEach(c => c.done.then(code => { if (code !== 0) abort(); }));
  const timer = setTimeout(abort, 300_000);
  try {
    // Every session exists before a host lists them.
    try { await Promise.all(coordinators.map(c => when(c, "Waiting for participants to send their commitments"))); }
    catch (e) { const f = new Error(`host coordinator setup on ${pair[0]}: ${(e as Error).message}`) as Error & { failedSigners?: string[] }; f.failedSigners = [pair[0]]; throw f; }
    const participants = pair.map(n => orb(n, [`${H}/bin/benzo`, "sign", "join", "--id", custody.id, "--name", n, "--sighash", sighash, "--count", String(randomizers.length), "--server", custody.server]));
    all.push(...participants);
    participants.forEach((p, i) => p.done.then(code => { if (code !== 0 && !aborted) { failed.push(pair[i]); abort(); } }));
    const codes = await Promise.all(all.map(p => p.done));
    if (codes.some(c => c !== 0)) {
      const lostErr = failed.length ? participants[pair.indexOf(failed[0])].err.trim().slice(-200) : "";
      const bad = coordinators.find(c => c.child.exitCode !== 0);
      const e = new Error(`host signing sessions exit codes ${codes.join(",")} (failed: ${failed.join(",") || "coordinator"}${lostErr ? `: ${lostErr}` : ""}): ${bad ? (bad.err || bad.out).trim().slice(-200) : ""}`) as Error & { failedSigners?: string[] };
      e.failedSigners = failed.length ? failed : [pair[0]];
      throw e;
    }
    // The N joins on a host share one stdout, so a message cannot be tied to session k: a participant is recorded as
    // having seen the sighash only if it printed it for every session and nothing else (R29 review P2).
    const saw = participants.map(p => { const m = [...p.out.matchAll(/Message to be signed \(hex-encoded\):\n([0-9a-f]+)/g)].map(x => x[1]); return m.length === randomizers.length && m.every(x => x === sighash) ? sighash : ""; });
    return coordinators.map((c, k) => {
      const sigs = c.out.match(/^[0-9a-f]{128}$/gm);
      if (!sigs) throw new Error(`host coordinator ${k} printed no signature`);
      return { signers, sighash, randomizer: randomizers[k], signature: sigs[sigs.length - 1], participantsSaw: saw, coordinator_started_at, duration_ms: Date.now() - started };
    });
  } catch (e) { abort(); throw e; } finally { clearTimeout(timer); }
}

// Runs `zcash-sign sign`, answering each `Randomizer #i` prompt with a fresh FROST session.
// One FROST signing round at a time on this machine (live part 2: two auctions settling at once collided — a host's
// frost-client serves one session per identity, and a failover's --close-all ended the other auction's session).
// A lock dir under state/run, taken for the whole round, stale after 15 minutes.
export async function zcashSign(input: string, output: string, check:(name:string,randomizer:string,sighash:string)=>void,pair=["alice","bob"],auction?:string,batch?:number,custody?:HostCustody):Promise<{ sighash: string; sessions: Session[] }> {
  return withSigningLock(() => zcashSignRound(input, output, check, pair, auction, batch, custody));
}
// Reentrant within one process: the host-custody signer (settle/cli.ts hostSign) holds it across its whole attempt
// loop, including the failover's session closes, so no other auction's round runs in between.
let signingLockDepth = 0;
export async function withSigningLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = path.join(STATE, "run", "frost-signing.lock");
  if (signingLockDepth === 0) for (;;) {
    try { mkdirSync(lock); break; }
    catch { try { if (Date.now() - statSync(lock).mtimeMs > 15 * 60_000) rmSync(lock, { recursive: true, force: true }); } catch {} await new Promise(r => setTimeout(r, 3000)); }
  }
  signingLockDepth++;
  // R33 P2-3: staleness is judged from the last heartbeat, not creation — a held lock is touched every minute, so a
  // legal attempt loop longer than 15 minutes is never taken over by another auction's settle.
  const beat = signingLockDepth === 1 ? setInterval(() => { try { const t = new Date(); utimesSync(lock, t, t); } catch {} }, 60_000) : undefined;
  try { return await fn(); } finally { if (beat) clearInterval(beat); if (--signingLockDepth === 0) rmSync(lock, { recursive: true, force: true }); }
}
async function zcashSignRound(input: string, output: string, check:(name:string,randomizer:string,sighash:string)=>void,pair=["alice","bob"],auction?:string,batch?:number,custody?:HostCustody):Promise<{ sighash: string; sessions: Session[] }> {
  if(pair.length!==2||new Set(pair).size!==2||pair.some(n=>!["alice","bob","carol"].includes(n)))throw Error("choose two distinct FROST signers");
  const p = start(bin("zcash-sign"), ["sign", "-n", custody?.network ?? env("BNZ_NETWORK"), "-i", input, "-o", output]);
  let sighash = "";
  const sessions: Session[] = [];
  let parallel: { expected: { pool: string; index: number; alpha: string }[]; sessions: Session[] } | undefined;
  try {for await (const line of readline.createInterface({ input: p.child.stdout! })) {
    const s = line.match(/^SIGHASH: ([0-9a-f]{64})$/);
    if (s) sighash = s[1];
    const r = line.match(/^Randomizer #(\d+) \((\w+)\): ([0-9a-f]{64})$/);
    if (r && custody && process.env.BNZ_SERIAL_SIGN !== "1") {
      // R29: every spend's randomizer comes from this machine's own inspect of the same PCZT; zcash-sign then asks for
      // them in the same order, and any mismatch stops the round before a signature is handed over.
      if (!parallel) {
        const expected = (inspect(input, custody.network, true).randomizers ?? []) as { pool: string; index: number; alpha: string }[];
        if (!expected.length) throw new Error("inspect found no spends awaiting signature");
        const t0 = Date.now();
        parallel = { expected, sessions: await signParallelHost(sighash, expected.map(x => x.alpha), pair, custody) };
        timing({ auction: auction ?? null, batch: batch ?? null, phase: "frost-parallel", ms: Date.now() - t0, spends: expected.length, custody: true });
      }
      const k = sessions.length, want = parallel.expected[k];
      if (!want || want.alpha !== r[3] || want.pool !== r[2] || String(want.index) !== r[1]) throw new Error(`zcash-sign randomizer #${r[1]} (${r[2]}) is not inspect's spend ${k}`);
      sessions.push(parallel.sessions[k]);
      p.child.stdin!.write(parallel.sessions[k].signature + "\n");
    } else if (r) {
      const t0 = Date.now();
      const session = await signOnce(sighash, r[3], check,pair,auction,batch,input,custody);
      timing({ auction: auction ?? null, batch: batch ?? null, phase: "frost-session", ms: Date.now() - t0, pool: r[2], custody: !!custody });
      sessions.push(session);
      p.child.stdin!.write(session.signature + "\n");
    }
  }
  } catch(e) {p.child.kill();throw e}
  const code = await p.done;
  if (code !== 0) throw new Error(`zcash-sign exited ${code}: ${p.err.trim().slice(-300)}`);
  if (!sighash) throw new Error("zcash-sign printed no SIGHASH");
  if (parallel && sessions.length !== parallel.expected.length) throw new Error(`zcash-sign asked for ${sessions.length} of ${parallel.expected.length} signatures`);
  return { sighash, sessions };
}
