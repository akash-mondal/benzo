// Ruling R48: a lightwalletd stream can stall with its TCP connection still open. In gate RG (2026-10-08) a live
// `zcash-devtool wallet sync` sat idle for 51 min at 0 CPU and hung `auction admit`. Every child process that talks to
// a lightwalletd server (grpcurl, or zcash-devtool given `-s`) is therefore bounded, and the timeout reads as a
// transient error. Wallet sync is incremental, so a retry resumes from the last scanned block.
import path from "node:path";

export const LWD_TIMEOUT_MS = Number(process.env.BNZ_LWD_TIMEOUT_MS ?? 600_000);
export const LWD_STALLED = "stalled lightwalletd stream";
// R130: the one transient-error rule for a lightwalletd wallet sync/enhance (load-balancer skew, stalled or reset
// streams, socket timeouts). Every sync caller retries on it: settle/io.ts, settle/plan.ts and the hosts' ownScan.
export const LWD_SYNC_TRANSIENT = /newer than the latest block|past the valid range|Code: (Internal|Unavailable)|backing node|connection reset|stalled lightwalletd stream|NonSequentialBlocks|timed out|os error (54|60)/i;
const talksToLwd = (cmd: string, args: string[]) => path.basename(cmd) === "grpcurl" || (path.basename(cmd) === "zcash-devtool" && args.includes("-s"));
export const lwdBound = (cmd: string, args: string[]) => talksToLwd(cmd, args) ? { timeout: LWD_TIMEOUT_MS, killSignal: "SIGKILL" as const } : {};
// The error to throw when spawnSync hit the bound (it reports ETIMEDOUT), else null.
export const lwdTimedOut = (cmd: string, r: { error?: Error }) =>
  (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ? new Error(`${path.basename(cmd)} timed out after ${LWD_TIMEOUT_MS} ms: ${LWD_STALLED}`) : null;
// R49 (Reviewer R P2-7 on R48): `tle -d` fetches the drand beacon over HTTP, so a stalled relay would block open/cancel at R.
export const DRAND_TIMEOUT_MS = Number(process.env.BNZ_DRAND_TIMEOUT_MS ?? 120_000);
export const tleBound = { timeout: DRAND_TIMEOUT_MS, killSignal: "SIGKILL" as const };
// R65 (Reviewer R P2-1 on R64): endpoints compare as normalized host:port (lowercase, no trailing dot, default 443),
// so one endpoint written two ways ("Host.:443", "host") is never counted as two.
export const endpointKey = (e: string): string => {
  const t = e.trim().toLowerCase().replace(/^https?:\/\//, "");
  const [host, port] = t.includes(":") ? [t.slice(0, t.lastIndexOf(":")), t.slice(t.lastIndexOf(":") + 1)] : [t, "443"];
  return `${host.replace(/\.$/, "")}:${port || "443"}`;
};
