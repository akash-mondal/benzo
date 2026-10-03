// Per-auction custody paths (Phase 5 part 1 §11 H1). An auction that ran its own DKG (`benzo auction keys`) has a
// view-only vault at state/vaults/<id>/wallet; every vault use for that auction goes there, everything else keeps
// the global state/vault. Tool binaries resolve from an override, the checkout's build tree, or the state bin dir
// (signer hosts have no checkout).
import { existsSync } from "node:fs";
import path from "node:path";
export function vaultDir(state: string, id: string | undefined = process.env.BNZ_AUCTION_ID): string {
  if (id && /^[0-9a-f]{64}$/.test(id)) {
    const w = path.join(state, "vaults", id, "wallet");
    if (existsSync(w)) return w;
  }
  return path.join(state, "vault");
}
const tool = (override: string | undefined, built: string, state: string, name: string) =>
  override ?? (existsSync(built) ? built : path.join(state, "bin", name));
export const scanBin = (root: string, state: string) => tool(process.env.BNZ_SCAN_BIN, path.join(root, "scan", "target", "release", "benzo-scan"), state, "benzo-scan");
export const pcztBin = (root: string, state: string) => tool(process.env.BNZ_PCZT_BIN, path.join(root, "settle", "target", "release", "benzo-pczt"), state, "benzo-pczt");
// The UFVK that inspects this auction's PCZTs: the per-auction one written by `benzo auction keys`, else the global.
export function ufvkFile(state: string, id: string | undefined = process.env.BNZ_AUCTION_ID): string {
  if (id && /^[0-9a-f]{64}$/.test(id)) {
    const f = path.join(state, "vaults", id, "ufvk.txt");
    if (existsSync(f)) return f;
  }
  return path.join(state, "ufvk.txt");
}
