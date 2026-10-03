// Signer-side envelope key generation (gate W, R7 item 2): each signer generates its own X25519 envelope
// keypair in its own state dir and shares only the public half, which the signed manifest pins as one of
// `envelope_keys`. The operator's tooling never generates, reads or copies the private half (Reviewer R F-1:
// the operator-held envelope key linked every bidder to their refund destination). After part 1 §1 this
// command runs on the signer's own machine — which has no git checkout (R10 item 5): it takes --state DIR
// or BNZ_STATE_DIR, defaulting to ~/.benzo-signer.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireThat } from "../../manifest/schema";
import { generateEnvelopeKey } from "../../envelope/index";
export const noun = "sign", verb = "envelope-key";
export const help = "benzo sign envelope-key --name SIGNER [--state DIR] — generate the signer's own X25519 envelope keypair in its state dir (default ~/.benzo-signer, or BNZ_STATE_DIR); prints only the public half";
export async function run(argv: string[]): Promise<number | object> {
  let name = "", stateArg = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") name = argv[++i] ?? "";
    else if (argv[i] === "--state") stateArg = argv[++i] ?? "";
    else { process.stderr.write(`ERROR sign envelope-key usage: ${help}\n`); return 2; }
  }
  try {
    requireThat(["alice", "bob", "carol"].includes(name), "signer name");
    // R10 item 5: --state wins; BNZ_STATE_DIR keeps its checkout-relative meaning where a checkout exists;
    // otherwise (a signer host) the state dir is ~/.benzo-signer and no git call is made.
    let state: string;
    if (stateArg) state = path.resolve(stateArg);
    else if (process.env.BNZ_STATE_DIR) {
      try { state = path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(), process.env.BNZ_STATE_DIR); }
      catch { state = path.resolve(process.env.BNZ_STATE_DIR); }
    } else state = path.join(os.homedir(), ".benzo-signer");
    const file = path.join(state, "signers", name, "envelope-key.json");
    requireThat(!existsSync(file), "signer envelope key already exists; refusing to replace it");
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const key = generateEnvelopeKey();
    writeFileSync(file, JSON.stringify(key), { mode: 0o600, flag: "wx" });
    return { name, public_hex: key.public_hex };
  } catch (e) {
    process.stderr.write(`ERROR sign envelope-key ${(e as Error).message}\n`);
    return 1;
  }
}
