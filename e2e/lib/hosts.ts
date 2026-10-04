// The three OrbStack signer hosts (Phase 5 part 1 §11): run commands on them, push packets, and the per-auction
// custody steps every host-custody run repeats — fresh DKG on the hosts, the operator's UFVK imported per host, host
// envelope and witness keys, witness certificates and envelope-opens reports computed ON the hosts.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, STATE, env } from "./env";

export const H = "/home/benzo/.benzo", NAMES = ["alice", "bob", "carol"] as const;
export const FROSTD = `host.orb.internal:${env("BNZ_FROSTD_ADDR").split(":").at(-1)}`;
export const sh = (cmd: string, args: string[], input?: string) => {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 5).join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
};
// `orb run` has returned an empty stdout once for a command that succeeded (live Y2, a host `cat`); retry empties.
export const host = (n: string, args: string[]) => { for (let i = 0; ; i++) { const out = sh("orb", ["run", "-m", `benzo-${n}`, "-u", "benzo", ...args]); if (out || i >= 2) return out; } };
export const hostTry = (n: string, args: string[]) => spawnSync("orb", ["run", "-m", `benzo-${n}`, "-u", "benzo", ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
export const hostBenzo = (n: string, args: string[]) => { const out = host(n, [`${H}/bin/benzo`, ...args]); return JSON.parse(out.split("\n").filter(l => l.startsWith("{")).at(-1)!); };
export const push = (n: string, src: string, dest: string) => {
  sh("orb", ["run", "-m", `benzo-${n}`, "-u", "root", "rm", "-rf", `/home/benzo/${dest}`]);
  sh("orbctl", ["push", "-m", `benzo-${n}`, src, dest]);
  sh("orb", ["run", "-m", `benzo-${n}`, "-u", "root", "chown", "-R", "benzo:benzo", `/home/benzo/${dest}`]);
};

// Fresh 2-of-3 DKG for this auction on the three hosts, then the per-auction vault on the Mac (`benzo auction keys`)
// and the same UFVK imported on every host. Returns the operator's {group_key, escrow_ua} and the reported keys.
export async function dkgOnHosts(id: string, benzo: (args: string[], input?: any) => any) {
  const pk = (n: string) => host(n, ["cat", `${H}/contacts/${n}.pubkey`]);
  const keys = await Promise.all(NAMES.map((n, i) => new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      const p = spawn("orb", ["run", "-m", `benzo-${n}`, "-u", "benzo", `${H}/bin/benzo`, "sign", "dkg", "--id", id, "--name", n, "--server", FROSTD, ...(i === 0 ? ["--peers", `${pk("bob")},${pk("carol")}`] : [])]);
      let out = "", err = "";
      p.stdout.on("data", d => (out += d)); p.stderr.on("data", d => (err += d));
      p.on("close", c => c === 0 ? resolve(JSON.parse(out.trim().split("\n").at(-1)!).group_key) : reject(new Error(`${n} dkg: ${err.trim().slice(-300)}`)));
    }, i === 0 ? 0 : 2500);
  })));
  const groupKeys = keys.join(",");
  const k = benzo(["auction", "keys", "--id", id, "--group-keys", groupKeys]);
  // Hosts import the operator's UFVK (zcash-sign draws the non-ak components at random; one UFVK per auction).
  for (const n of NAMES) {
    const f = `ufvk-${id.slice(0, 12)}.txt`;
    sh("orbctl", ["push", "-m", `benzo-${n}`, path.join(STATE, "vaults", id, "ufvk.txt"), f]);
    sh("orb", ["run", "-m", `benzo-${n}`, "-u", "root", "chown", "benzo:benzo", `/home/benzo/${f}`]);
    hostBenzo(n, ["auction", "keys", "--id", id, "--group-keys", groupKeys, "--ufvk", `/home/benzo/${f}`]);
    sh("orb", ["run", "-m", `benzo-${n}`, "-u", "root", "rm", "-f", `/home/benzo/${f}`]);
  }
  return { keys, group_key: k.group_key as string, escrow_ua: k.escrow_ua as string };
}

// Host envelope keys (pinned in the manifest) and host witness keys (in the signed witness set); private halves
// never leave the hosts. Existing keys are reused.
export function hostEnvelopeKeys(): string[] {
  return NAMES.map(n => {
    const f = `${H}/signers/${n}/envelope-key.json`;
    const exists = spawnSync("orb", ["run", "-m", `benzo-${n}`, "-u", "benzo", "test", "-f", f]).status === 0;
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

// Witness certificates signed ON the named hosts (each recomputes the frozen root from its own vault scan first,
// design §5), merged into the Mac's public auction.json.
export function hostWitnessCerts(id: string, publicDir: string, signer: string, names: string[]) {
  const dir = `pub-${id.slice(0, 12)}`;
  for (const n of names) {
    push(n, publicDir, dir);
    host(n, [`${H}/bin/benzo`, "witness", "sign", "--dir", `/home/benzo/${dir}`, "--signer", signer, "--key", `${H}/witness/${n}.key`]);
    const hostDoc = JSON.parse(host(n, ["cat", `/home/benzo/${dir}/auction.json`]));
    const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
    for (const c of hostDoc.witness_cert ?? []) if (!(doc.witness_cert ?? []).some((x: any) => JSON.stringify(x) === JSON.stringify(c))) (doc.witness_cert ??= []).push(c);
    writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(doc));
  }
}

// R23.2 envelope-opens reports computed ON each host from its own key and vault, saved where the plan reads them.
export function hostEnvelopeOpens(id: string, publicDir: string) {
  const dir = `pub-${id.slice(0, 12)}`;
  for (const n of NAMES) {
    for (const v of ["sync", "enhance"]) host(n, [`${H}/bin/zcash-devtool`, "wallet", "-w", `${H}/vaults/${id}/wallet`, v, "-s", env("BNZ_LWD_URL")]);
    push(n, publicDir, dir);
    const report = hostBenzo(n, ["sign", "envelope-opens", "--id", id, "--name", n, "--public", `/home/benzo/${dir}`, "--witness-key", `${H}/witness/${n}.key`]);
    mkdirSync(path.join(STATE, "settle", id), { recursive: true });
    writeFileSync(path.join(STATE, "settle", id, `envelope-opens-${n}.json`), JSON.stringify(report));
  }
}
export const benzoBin = path.join(ROOT, "bin/benzo");
