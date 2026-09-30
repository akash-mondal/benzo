// Glue for zcash-devtool, grpcurl and the scanner: spawns them by absolute path and parses what they print.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { bin, E2E, env, ROOT, STATE } from "./env";

const LOG = path.join(E2E, "cli.log");

export function run(cmd: string, args: string[], opts: { input?: string; quietArgs?: boolean } = {}): string {
  mkdirSync(E2E, { recursive: true });
  const r = spawnSync(cmd, args, { input: opts.input, encoding: "utf8", maxBuffer: 64 << 20 });
  appendFileSync(LOG, `\n$ ${path.basename(cmd)} ${opts.quietArgs ? "…" : args.join(" ")}\n${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 4).join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ")}`);
  return r.stdout;
}

const LWD = env("BNZ_LWD_URL");
export const wallet = (name: string, ...args: string[]) => run(bin("zcash-devtool"), ["wallet", "-w", path.join(STATE, name), ...args]);
export const pczt = (name: string, ...args: string[]) => run(bin("zcash-devtool"), ["pczt", "-w", path.join(STATE, name), ...args]);

export const sync = (name: string) => wallet(name, "sync", "-s", LWD);
export const enhance = (name: string) => wallet(name, "enhance", "-s", LWD);
export const balance = (name: string): Record<string, number> => JSON.parse(wallet(name, "balance", "--json"));
export const spendable = (b: Record<string, number>) => b.sapling_spendable + b.orchard_spendable + b.ironwood_spendable;

export function generateAddress(name: string): string {
  const m = wallet(name, "generate-address").match(/^\s*Address: (\S+)$/m);
  if (!m) throw new Error(`generate-address on ${name} printed no address`);
  return m[1];
}

const lastTxid = (out: string) => {
  const ids = out.match(/^[0-9a-f]{64}$/gm);
  if (!ids) throw new Error(`no txid in output: ${out.trim().slice(-200)}`);
  return ids[ids.length - 1];
};

export const pay = (uri: string) =>
  lastTxid(wallet("bidder", "pay", "-i", path.join(STATE, "bidder.age"), "--disable-confirmation", "-s", LWD, "--payment-uri", uri));
export const send = (file: string) => lastTxid(pczt("vault", "send", "-s", LWD, file));

function grpc(endpoint: string, method: string, data?: object): any {
  const args = ["-import-path", path.join(STATE, "proto"), "-proto", "service.proto"];
  if (data) args.push("-d", JSON.stringify(data));
  return JSON.parse(run(bin("grpcurl"), [...args, endpoint, `cash.z.wallet.sdk.rpc.CompactTxStreamer/${method}`]));
}

export const tip = (endpoint = LWD) => Number(grpc(endpoint, "GetLatestBlock").height);

// TxFilter.hash is the txid's bytes in reverse display order (docs/PHASE-1.md section 3).
export function getTransaction(txid: string, endpoint = LWD): { height: number; raw: Buffer } {
  const hash = Buffer.from(txid, "hex").reverse().toString("base64");
  const r = grpc(endpoint, "GetTransaction", { hash });
  const height = Number(r.height ?? 0);
  return { height: height > 0 && height < 2 ** 32 - 1 ? height : 0, raw: Buffer.from(r.data, "base64") };
}

export type ScanLine = {
  txid: string;
  height: number | null;
  pool: string;
  address: string | null;
  diversifier_index: string | null;
  value_zats: number;
  memo_hex: string;
  spent_in_txid: string | null;
};

export const scanner = path.join(ROOT, "scan", "target", "release", "benzo-scan");
export const scanVault = (): ScanLine[] =>
  run(scanner, ["scan", env("BNZ_NETWORK"), path.join(STATE, "vault")])
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
