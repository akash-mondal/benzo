// Ruling R28 (signer hosts): what this host learns from the chain itself, through its own lightwalletd connection
// (BNZ_LWD_URL from the host launcher) and its own grpcurl + pinned protos — never from the coordinator.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { requireThat } from "../manifest/schema";

const TRANSIENT = /Code: (Internal|Unavailable|DeadlineExceeded|Unknown)|backing node|connection reset|EOF/;
function grpc(st: string, method: string, body: object): { ok: boolean; out: string } {
  const lwd = process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync(path.join(st, "bin", "grpcurl"), ["-import-path", path.join(st, "proto"), "-proto", "service.proto", "-d", JSON.stringify(body), lwd, `cash.z.wallet.sdk.rpc.CompactTxStreamer/${method}`], { encoding: "utf8" });
    if (r.status === 0) return { ok: true, out: r.stdout };
    const err = `${r.stderr ?? ""}${r.stdout ?? ""}`;
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
