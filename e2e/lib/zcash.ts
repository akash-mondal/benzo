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

// Shielded-only fresh address via benzo-pczt (as settle-crash does). The pinned devtool's generate-address
// requests all receivers and stops once 20 reserved transparent receivers are unused (bidder hit index 40).
export function generateAddress(name: string): string {
  const ua = run(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, name)]).trim();
  if (!/^utest1[0-9a-z]+$/.test(ua)) throw new Error(`benzo-pczt address on ${name} printed no address`);
  return ua;
}

const lastTxid = (out: string) => {
  const ids = out.match(/^[0-9a-f]{64}$/gm);
  if (!ids) throw new Error(`no txid in output: ${out.trim().slice(-200)}`);
  return ids[ids.length - 1];
};

// The pinned devtool builds the transaction expiry from the wallet's last scanned height and pay does not
// sync first. On the fast testnet chain a stale tip (e.g. after waiting for a drand round) produced a
// transaction already past its expiry at broadcast (consensus: "must not be mined ... greater than its
// expiry"). Sync immediately before building, as cli/product.ts does for bid deposit --pay.
export const pay = (uri: string) => {
  sync("bidder");
  return lastTxid(wallet("bidder", "pay", "-i", path.join(STATE, "bidder.age"), "--disable-confirmation", "-s", LWD, "--payment-uri", uri));
};
export const send = (file: string) => lastTxid(pczt("vault", "send", "-s", LWD, file));

// Head (2026-10-03, live run 10 died on one "error receiving data from backing node"): transient endpoint errors
// (Internal, Unavailable, DeadlineExceeded, backend/connection failures) are retried 4 times with backoff;
// NotFound and every other answer are returned or thrown unchanged.
const TRANSIENT_GRPC = /Code: (Internal|Unavailable|DeadlineExceeded|Unknown)|backing node|connection reset|EOF/;
function retryTransient<T>(f: () => T): T {
  for (let attempt = 1; ; attempt++) {
    try { return f(); } catch (e) {
      if (attempt >= 4 || !TRANSIENT_GRPC.test(String((e as Error)?.message ?? e))) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * 2 ** (attempt - 1));
    }
  }
}
function grpc(endpoint: string, method: string, data?: object): any {
  const args = ["-import-path", path.join(STATE, "proto"), "-proto", "service.proto"];
  if (data) args.push("-d", JSON.stringify(data));
  return JSON.parse(retryTransient(() => run(bin("grpcurl"), [...args, endpoint, `cash.z.wallet.sdk.rpc.CompactTxStreamer/${method}`])));
}

export const tip = (endpoint = LWD) => Number(grpc(endpoint, "GetLatestBlock").height);

// TxFilter.hash is the txid's bytes in reverse display order (docs/PHASE-1.md section 3).
export function getTransaction(txid: string, endpoint = LWD): { height: number; raw: Buffer } {
  const hash = Buffer.from(txid, "hex").reverse().toString("base64");
  const r = grpc(endpoint, "GetTransaction", { hash });
  const height = Number(r.height ?? 0);
  return { height: height > 0 && height < 2 ** 32 - 1 ? height : 0, raw: Buffer.from(r.data, "base64") };
}

// list-tx --json documents null for unmined transactions; RPC errors still fail the run.
export const minedHeight = (txid: string) => {
  sync("vault");
  const mined = JSON.parse(wallet("vault", "list-tx", "--json")).find((t: {txid: string; mined_height: number | null}) => t.txid === txid)?.mined_height;
  return mined ? getTransaction(txid).height : 0;
};

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
