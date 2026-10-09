// Ruling R28 (signer hosts): what this host learns from the chain itself, through its own lightwalletd connection
// (BNZ_LWD_URL from the host launcher) and its own grpcurl + pinned protos — never from the coordinator.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { requireThat } from "../manifest/schema";
import { lwdBound, lwdTimedOut } from "../settle/bounded";

const TRANSIENT = /Code: (Internal|Unavailable|DeadlineExceeded|Unknown)|backing node|connection reset|EOF|stalled lightwalletd stream/;
function grpc(st: string, method: string, body: object, endpoint?: string): { ok: boolean; out: string } {
  const lwd = endpoint ?? process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
  for (let attempt = 1; ; attempt++) {
    const cmd = path.join(st, "bin", "grpcurl"), args = ["-import-path", path.join(st, "proto"), "-proto", "service.proto", "-d", JSON.stringify(body), lwd, `cash.z.wallet.sdk.rpc.CompactTxStreamer/${method}`];
    const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 << 20, ...lwdBound(cmd, args) }); // R49: Reviewer R P1-2 on R48; R60: block ranges are large
    if (r.status === 0) return { ok: true, out: r.stdout };
    const err = lwdTimedOut(cmd, r)?.message ?? `${r.stderr ?? ""}${r.stdout ?? ""}`;
    if (/NotFound|not found/i.test(err)) return { ok: false, out: err };
    requireThat(attempt < 4 && TRANSIENT.test(err), `lightwalletd ${method}: ${err.trim().slice(-160)}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * attempt);
  }
}
export function chainTip(st: string): number {
  const h = Number(JSON.parse(grpc(st, "GetLatestBlock", {}).out).height);
  requireThat(Number.isSafeInteger(h) && h > 0, "lightwalletd tip");
  return h;
}
// The height a transaction mined at, or 0 when this host's endpoint does not know it.
export function minedHeight(st: string, txid: string): number {
  const r = grpc(st, "GetTransaction", { hash: Buffer.from(txid, "hex").reverse().toString("base64") });
  return r.ok ? Number(JSON.parse(r.out).height) || 0 : 0;
}
// R58 (Reviewer R F2 on R57): "this endpoint does not know the txid" is not proof the transaction never mined (all
// hosts share one testnet endpoint, so a lagging or pruned answer is correlated). Absence is proven only from the
// full block range [from, to]: every block present and contiguous, and the txid in none of them.
export function provenAbsent(st: string, txid: string, from: number, to: number): boolean {
  requireThat(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from > 0 && from <= to, `absence range [${from}, ${to}]`);
  const r = grpc(st, "GetBlockRange", { start: { height: from }, end: { height: to } });
  requireThat(r.ok, `lightwalletd GetBlockRange [${from}, ${to}] unavailable`);
  const blocks = r.out.trim().split(/\n(?=\{)/).map((l) => JSON.parse(l));
  requireThat(blocks.length === to - from + 1 && blocks.every((b, i) => Number(b.height) === from + i), `incomplete block range [${from}, ${to}]`);
  const ids = new Set(blocks.flatMap((b) => b.vtx ?? []).map((t: any) => Buffer.from(t.txid, "base64").reverse().toString("hex")));
  return !ids.has(txid);
}
// Ruling R63 (Reviewer R P1-2 on R61): the bond window's start header {height, hash, time} decides a void, so it is
// read from EVERY configured endpoint (BNZ_LWD_URL and BNZ_LWD_URL_ALT; one endpoint only under BNZ_LWD_SINGLE=1,
// testnet only — R27/R28 item 10) and refused unless all agree. The host signs it into its approval map, so two
// hosts must have seen the identical header and verify recomputes the void from the signed time.
export type BlockHeader = { height: number; hash: string; time: number };
export function blockHeader(st: string, height: number, network: string): BlockHeader {
  requireThat(Number.isSafeInteger(height) && height > 0, "block height");
  const single = process.env.BNZ_LWD_SINGLE === "1";
  requireThat(!single || network === "test", "BNZ_LWD_SINGLE is testnet-only; a mainnet header needs two endpoints");
  const endpoints = [process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443", ...(single ? [] : [process.env.BNZ_LWD_URL_ALT ?? ""])];
  requireThat(endpoints.every((e) => e.length > 0), "second lightwalletd endpoint (BNZ_LWD_URL_ALT) not configured");
  const seen = endpoints.map((e) => {
    const b = JSON.parse(grpc(st, "GetBlock", { height }, e).out);
    const h: BlockHeader = { height: Number(b.height), hash: Buffer.from(String(b.hash ?? ""), "base64").reverse().toString("hex"), time: Number(b.time) };
    requireThat(h.height === height && /^[0-9a-f]{64}$/.test(h.hash) && Number.isSafeInteger(h.time) && h.time > 0, `block ${height} header from ${e}`);
    return h;
  });
  requireThat(seen.every((h) => h.hash === seen[0].hash && h.time === seen[0].time), `block ${height} header differs across lightwalletd endpoints`);
  return seen[0];
}
// R33 item 2: the header time of the block at `height` (CompactTxStreamer GetBlock over the pinned protos) —
// the host's own chain view, used to hold the balance window's start to R's release time.
export function blockTime(st: string, height: number): number {
  requireThat(Number.isSafeInteger(height) && height > 0, "block height");
  const t = Number(JSON.parse(grpc(st, "GetBlock", { height }).out).time);
  requireThat(Number.isSafeInteger(t) && t > 0, `block ${height} header time`);
  return t;
}
