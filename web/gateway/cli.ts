// Every `benzo` command the gateway runs takes turns on locks, not on one queue for everything:
//   - one lock per round: a round's commands (its ledger, its vault wallet, its public folder) run one at a time;
//   - one shared lock for what touches shared state: signing and DKG sessions on the hosts (a settle closes every
//     session it finds), the house wallet that pays house bids, and setting up a round.
// A shared-lock command takes its round's lock first, and a round-lock command never waits for the shared lock, so the
// two can't deadlock. A 30-minute settle of one round no longer holds up freezing, opening or admitting deposits in
// another. Each call runs bin/benzo with the checkout's environment and returns the last JSON line it printed, or
// throws with its ERROR lines.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const tails = new Map<string, Promise<unknown>>();
async function hold(key: string): Promise<() => void> {
  const before = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const chained = before.then(() => mine);
  tails.set(key, chained);
  void chained.then(() => { if (tails.get(key) === chained) tails.delete(key); });
  await before;
  return release;
}
const SHARED = new Set(["settle", "cancel", "auction", "witness", "drand"]);
export function locksFor(args: string[]): string[] {
  const at = args.indexOf("--id"), id = at >= 0 ? args[at + 1] : null, dir = args.indexOf("--dir") >= 0 ? args[args.indexOf("--dir") + 1] : null;
  const own = id ? `round:${id}` : dir ? `dir:${dir}` : null;
  const shared = SHARED.has(args[0]) || (args[0] === "hosts" && args[1] !== "witness" && args[1] !== "envelope-opens")
    || (args[0] === "claim-refund" && !(args.includes("--defer") && args[args.indexOf("--defer") + 1] === "true"))
    || (args[0] === "bid" && (args[1] !== "deposit" || args.includes("--pay")));
  return [...(own ? [own] : []), ...(shared || !own ? ["shared"] : [])];
}

export class CliError extends Error {
  constructor(message: string, readonly output: string) { super(message); }
}

export function benzo(root: string, state: string, args: string[], input?: unknown, timeoutMs = 30 * 60_000): Promise<any> {
  const run = async () => {
    let file: string | null = null;
    if (input !== undefined) {
      const dir = path.join(state, "web", "tmp");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      file = path.join(dir, `${randomBytes(8).toString("hex")}.json`);
      writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    }
    try {
      const out = await new Promise<string>((resolve, reject) => {
        execFile(path.join(root, "bin/benzo"), file ? [...args, "--file", file] : args,
          { cwd: root, env: { ...process.env, BNZ_LWD_SINGLE: "1" }, timeout: timeoutMs, maxBuffer: 64 << 20, killSignal: "SIGKILL" },
          (err, stdout, stderr) => {
            const all = `${stdout}\n${stderr}`;
            if (err) {
              const errors = all.split("\n").filter((l) => /^ERROR/.test(l)).slice(-3).join(" | ");
              return reject(new CliError(errors || String(err.message).slice(0, 300), all.slice(-4000)));
            }
            resolve(stdout);
          });
      });
      const line = out.split("\n").filter((l) => l.startsWith("{")).at(-1);
      return line ? JSON.parse(line) : {};
    } finally {
      if (file) rmSync(file, { force: true });
    }
  };
  return (async () => {
    const releases: (() => void)[] = [];
    try { for (const k of locksFor(args)) releases.push(await hold(k)); return await run(); }
    finally { for (const r of releases.reverse()) r(); }
  })();
}
