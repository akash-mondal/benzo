// One queue for every `benzo` command the gateway runs (the operator's ledger is one file per auction, and DKG and
// signing sessions on the hosts must take turns). Each call runs bin/benzo with the checkout's environment and
// returns the last JSON line it printed, or throws with its ERROR lines.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

let tail: Promise<unknown> = Promise.resolve();

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
  const p = tail.then(run, run);
  tail = p.catch(() => undefined);
  return p;
}
