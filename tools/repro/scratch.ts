// Ruling R43 (head, 2026-10-08, after the A20 state-directory incident): a script may delete a state
// directory ONLY if its resolved path is under tmp/ or $TMPDIR. Every tools/repro driver that deletes
// calls assertScratch before any I/O on the target and refuses otherwise — a test driver is never allowed
// to delete (or rebuild) anything at the real $BNZ_STATE_DIR/.benzo. settle/io.ts self-loads .env
// (BNZ_STATE_DIR=./.benzo), so a driver that resolves its scratch state from that variable and rmSync's it
// would delete the real state; the guard makes that impossible before a single byte is touched.
import { tmpdir } from "node:os";
import path from "node:path";
// The explicit .ts extension lets plain-Node .mjs repro drivers import this guard too (F17); esbuild
// (how the .ts drivers run) resolves it either way.
import { repoRoot } from "../../manifest/root.ts";

export function assertScratch(target: string): string {
  const root = repoRoot();
  const r = path.resolve(root, target);
  const under = (base: string) => r === base || r.startsWith(base + path.sep);
  // "/tmp" is the POSIX shared temp root; on macOS os.tmpdir() is /var/folders/... so it is a distinct base
  // (the clean-machine bidder proof deliberately uses a literal /tmp fresh dir, F17 sweep).
  if (!under(path.join(root, "tmp")) && !under(path.resolve(tmpdir())) && !under(path.resolve("/tmp"))) {
    throw new Error(`R43: refusing to delete or rebuild outside tmp/ or $TMPDIR: ${r}`);
  }
  return r;
}
