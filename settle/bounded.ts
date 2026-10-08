// Ruling R48: a lightwalletd stream can stall with its TCP connection still open. In gate RG (2026-10-08) a live
// `zcash-devtool wallet sync` sat idle for 51 min at 0 CPU and hung `auction admit`. Every child process that talks to
// a lightwalletd server (grpcurl, or zcash-devtool given `-s`) is therefore bounded, and the timeout reads as a
// transient error. Wallet sync is incremental, so a retry resumes from the last scanned block.
import path from "node:path";

export const LWD_TIMEOUT_MS = Number(process.env.BNZ_LWD_TIMEOUT_MS ?? 600_000);
export const LWD_STALLED = "stalled lightwalletd stream";
const talksToLwd = (cmd: string, args: string[]) => path.basename(cmd) === "grpcurl" || (path.basename(cmd) === "zcash-devtool" && args.includes("-s"));
export const lwdBound = (cmd: string, args: string[]) => talksToLwd(cmd, args) ? { timeout: LWD_TIMEOUT_MS, killSignal: "SIGKILL" as const } : {};
// The error to throw when spawnSync hit the bound (it reports ETIMEDOUT), else null.
export const lwdTimedOut = (cmd: string, r: { error?: Error }) =>
  (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ? new Error(`${path.basename(cmd)} timed out after ${LWD_TIMEOUT_MS} ms: ${LWD_STALLED}`) : null;
