// Glue for frostd, frost-client and zcash-sign: one FROST signing session per randomizer (trap 7), answered on the
// prompts the tools print (trap 6).
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { bin, env, STATE, ROOT } from "./io";
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

export type Session = { signers: string[]; sighash: string; randomizer: string; signature: string; participantsSaw: string[]; coordinator_started_at:number;duration_ms:number };

// One coordinator session (alice coordinates; alice and bob sign) for one sighash and one randomizer.
async function signOnce(sighash: string, randomizer: string, check: (name:string, randomizer:string, sighash:string)=>void,pair:string[],auction?:string,batch?:number,candidate?:string): Promise<Session> {
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
    participants.push(p);await when(p,"Do you want to sign it? (y/n)");
  }
  await Promise.all(participants.map((p) => when(p, "Do you want to sign it? (y/n)").then(() => p.child.stdin!.end("y\n"))));
  const codes = await Promise.all([coordinator.done, ...participants.map((p) => p.done)]);
  if (codes.some((c) => c !== 0)) throw new Error(`signing session exit codes ${codes.join(",")}: ${coordinator.err.trim().slice(-300)}`);
  const sigs = coordinator.out.match(/^[0-9a-f]{128}$/gm);
  if (!sigs) throw new Error("coordinator printed no signature");
  const participantsSaw = participants.map((p) => p.out.match(/Message to be signed \(hex-encoded\):\n([0-9a-f]+)/)?.[1] ?? "");
  return { signers, sighash, randomizer, signature: sigs[sigs.length - 1], participantsSaw, coordinator_started_at,duration_ms:Date.now()-coordinator_started_at };
}

// Runs `zcash-sign sign`, answering each `Randomizer #i` prompt with a fresh FROST session.
export async function zcashSign(input: string, output: string, check:(name:string,randomizer:string,sighash:string)=>void,pair=["alice","bob"],auction?:string,batch?:number): Promise<{ sighash: string; sessions: Session[] }> {
  if(pair.length!==2||new Set(pair).size!==2||pair.some(n=>!["alice","bob","carol"].includes(n)))throw Error("choose two distinct FROST signers");
  const p = start(bin("zcash-sign"), ["sign", "-n", env("BNZ_NETWORK"), "-i", input, "-o", output]);
  let sighash = "";
  const sessions: Session[] = [];
  try {for await (const line of readline.createInterface({ input: p.child.stdout! })) {
    const s = line.match(/^SIGHASH: ([0-9a-f]{64})$/);
    if (s) sighash = s[1];
    const r = line.match(/^Randomizer #\d+ \((\w+)\): ([0-9a-f]{64})$/);
    if (r) {
      const session = await signOnce(sighash, r[2], check,pair,auction,batch,input);
      sessions.push(session);
      p.child.stdin!.write(session.signature + "\n");
    }
  }
  } catch(e) {p.child.kill();throw e}
  const code = await p.done;
  if (code !== 0) throw new Error(`zcash-sign exited ${code}: ${p.err.trim().slice(-300)}`);
  if (!sighash) throw new Error("zcash-sign printed no SIGHASH");
  return { sighash, sessions };
}
