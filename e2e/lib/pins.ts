// The pinned-binary precondition shared by the live specs (AGENTS.md: a live run on unpinned tools is NOT RUN).
// frostd/frost-client: cargo's own git install records `?rev=<rev>#`. zcash-devtool/zcash-sign (Ruling R27) are path
// installs by tools/nu7/build.sh, and cargo records only the path string, which proves nothing (Reviewer R P1-1 on R47).
// For those, R49 requires the build's provenance record, checked against the live tree: the exact source path, a
// checkout at the pinned rev with only build.sh's own edits, the current NU7 patch digests, and the binary's digest.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { bin, ROOT, STATE } from "./env";

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const BUILD_EDITS = new Set([" M Cargo.toml", " M Cargo.lock", "?? Cargo.lock.pinned"]);

export function pinsMismatch(): string | undefined {
  const pins = Object.fromEntries(readFileSync(path.join(ROOT, "tools/pins.env"), "utf8").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(\S*)$/)).filter((m) => m !== null).map((m) => [m![1], m![2]]));
  const cargo = execFileSync("cargo", ["install", "--list", "--root", STATE]).toString().split("\n");
  for (const crate of ["frostd", "frost-client"])
    if (!cargo.some((l) => l.startsWith(`${crate} v`) && l.includes(`?rev=${pins.FROST_TOOLS_REV}#`))) return `${crate} is not built from ${pins.FROST_TOOLS_REV}`;
  const nu7: [string, string, string, string][] = [["zcash-devtool", pins.DEVTOOL_REV, `zcash-devtool-${pins.DEVTOOL_REV}`, ""], ["zcash-sign", pins.FROST_TOOLS_REV, `frost-tools-${pins.FROST_TOOLS_REV}`, "zcash-sign"]];
  for (const [crate, rev, repo, sub] of nu7) {
    const src = path.join(STATE, "src", repo, sub), checkout = path.join(STATE, "src", repo);
    if (!cargo.some((l) => l.startsWith(`${crate} v`) && l.endsWith(` (${src}):`))) return `${crate} is not installed from ${src}`;
    const pf = path.join(STATE, "nu7-provenance", `${crate}.json`);
    if (!existsSync(pf)) return `${crate} has no build provenance (${pf}); rebuild with tools/nu7/build.sh`;
    const p = JSON.parse(readFileSync(pf, "utf8"));
    const head = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"]).toString().trim();
    if (p.rev !== rev || p.src_head !== rev || head !== rev) return `${crate} source is not at ${rev} (recorded ${p.src_head}, checkout ${head})`;
    const edits = execFileSync("git", ["-C", checkout, "status", "--porcelain", "--untracked-files=normal"]).toString().split("\n").filter(Boolean).filter((l) => !BUILD_EDITS.has(l));
    if (edits.length) return `${crate} source has edits beyond build.sh's: ${edits.slice(0, 3).join(", ")}`;
    for (const [cv, digest] of Object.entries(p.patches as Record<string, string>))
      if (sha(path.join(ROOT, "tools/nu7", `${cv}.patch`)) !== digest) return `${crate} was built with a different ${cv}.patch`;
    if (sha(bin(crate)) !== p.bin_sha256) return `${crate} binary differs from the one tools/nu7/build.sh built`;
  }
  const go: [string, string, string][] = [["tle", "github.com/drand/tlock", pins.TLE_TAG], ["grpcurl", "github.com/fullstorydev/grpcurl", pins.GRPCURL_TAG]];
  for (const [tool, mod, tag] of go)
    if (!existsSync(bin(tool)) || !execFileSync("go", ["version", "-m", bin(tool)]).toString().includes(`\tmod\t${mod}\t${tag}\t`)) return `${tool} is not ${mod}@${tag}`;
}
