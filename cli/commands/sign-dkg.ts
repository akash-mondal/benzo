// benzo sign dkg — a fresh dealerless 2-of-3 RedPallas DKG per auction, run ON each
// signer machine. The machine's own contact config (state/frost/<name>.toml, with the other two signers already in
// its address book) is copied to state/auctions/<id>/frost.toml and the DKG writes this auction's share there, so
// the global setup share is never touched and no share ever leaves its machine. Prints only the group public key.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireThat } from "../../manifest/schema";

export const noun = "sign", verb = "dkg";
export const help = "benzo sign dkg --id AUCTION_ID --name SIGNER --server HOST:PORT [--peers PUBKEY,PUBKEY] — run this signer's part of the auction's 2-of-3 FROST DKG on this machine (the initiator passes the other two contact pubkeys); prints the group public key";

const state = () => process.env.BNZ_STATE_DIR ? path.resolve(process.env.BNZ_STATE_DIR) : path.join(os.homedir(), ".benzo");
const groupKeyOf = (fc: string, cfg: string, env: NodeJS.ProcessEnv): string | null => {
  const r = spawnSync(fc, ["groups", "-c", cfg], { encoding: "utf8", env });
  const keys = [...`${r.stdout}${r.stderr}`.matchAll(/^Public key ([0-9a-f]{64})$/gm)].map(m => m[1]);
  requireThat(keys.length <= 1, "auction config holds more than one group");
  return keys[0] ?? null;
};

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--name", "--server", "--peers"].includes(argv[i]) || argv[i + 1] === undefined) { process.stderr.write(`ERROR sign dkg usage: ${help}\n`); return 2; }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  try {
    requireThat(/^[0-9a-f]{64}$/.test(o.id ?? ""), "auction id");
    requireThat(["alice", "bob", "carol"].includes(o.name ?? ""), "signer name");
    requireThat(/^[A-Za-z0-9.-]+:[0-9]{1,5}$/.test(o.server ?? ""), "frostd server HOST:PORT");
    const peers = o.peers ? o.peers.split(",") : [];
    requireThat(peers.length === 0 || (peers.length === 2 && peers.every(p => /^[0-9a-f]{64}$/.test(p)) && peers[0] !== peers[1]), "--peers takes the other two signers' contact pubkeys");
    const st = state(), fc = path.join(st, "bin", "frost-client"), base = path.join(st, "frost", `${o.name}.toml`);
    const dir = path.join(st, "auctions", o.id), cfg = path.join(dir, "frost.toml"), keyFile = path.join(dir, "group-key.txt");
    const env = { ...process.env, SSL_CERT_FILE: path.join(st, "tls", "rootCA.pem") };
    requireThat(existsSync(base), "this machine's contact config is missing (deploy/signers/up.sh)");
    // Idempotent: a finished DKG for this auction is reported, never redone (a second group would be a new key).
    if (existsSync(keyFile)) return { auction_id: o.id, name: o.name, group_key: readFileSync(keyFile, "utf8").trim(), reused: true };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!existsSync(cfg)) copyFileSync(base, cfg);
    requireThat(groupKeyOf(fc, cfg, env) === null, "auction config already holds a group without a recorded key; refusing");
    if (peers.length === 0) {
      // A joiner waits until frostd lists the session it was invited to (up to 2 minutes).
      let listed = false;
      for (let i = 0; i < 240 && !listed; i++) {
        const r = spawnSync(fc, ["sessions", "-c", cfg, "-s", o.server], { encoding: "utf8", env });
        listed = /^Session with ID/m.test(`${r.stdout}${r.stderr}`);
        if (!listed) await new Promise(r => setTimeout(r, 500));
      }
      requireThat(listed, "no DKG session for this signer appeared on frostd within 2 minutes");
    }
    const args = ["dkg", "-c", cfg, "-d", `benzo ${o.id}`, "-s", o.server, "-C", "redpallas", "-t", "2", ...(peers.length ? ["-S", peers.join(",")] : [])];
    const code = await new Promise<number>((resolve, reject) => {
      const p = spawn(fc, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let log = "";
      p.stdout!.on("data", d => (log += d)); p.stderr!.on("data", d => (log += d));
      p.on("error", reject);
      p.on("close", c => { writeFileSync(path.join(dir, "dkg.log"), log, { mode: 0o600 }); resolve(c ?? -1); });
    });
    requireThat(code === 0, `frost-client dkg exited ${code} (see ${path.join(dir, "dkg.log")})`);
    const groupKey = groupKeyOf(fc, cfg, env);
    requireThat(groupKey !== null, "DKG finished but the auction config lists no group");
    writeFileSync(keyFile, groupKey + "\n", { mode: 0o600 });
    return { auction_id: o.id, name: o.name, group_key: groupKey };
  } catch (e) {
    process.stderr.write(`ERROR sign dkg ${(e as Error).message}\n`);
    return 1;
  }
}
