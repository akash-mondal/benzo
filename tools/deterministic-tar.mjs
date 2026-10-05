// Deterministic tar+gzip for the release artifacts (gate PK): ustar headers (no atime records), the
// staged files listed in sorted order, fixed mtime and normalized modes, uid/gid 0, then gzip -n
// (no name/timestamp in the gzip header). Two builds of identical content produce byte-identical
// .tgz files, on this machine and on a fresh clone.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, lutimesSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

const MTIME = new Date("2026-01-01T00:00:00Z");

// Every regular file under dir, relative and sorted (JS string order; names are ASCII paths).
// Every entry under dir, relative and sorted (JS string order; names are ASCII paths). Symlinks are
// kept as links (node_modules/.bin has many) and never followed.
export function stageFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (lstatSync(p).isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

export function tarGz(stageDir, outPath) {
  const files = stageFiles(stageDir);
  for (const rel of files) {
    const p = path.join(stageDir, rel), st = lstatSync(p);
    // Symlink mtimes live on the link itself (cpSync stamps the copy time); utimesSync would follow
    // the link and leave the tar's symlink header unstable — use lutimesSync for those.
    if (st.isSymbolicLink()) lutimesSync(p, MTIME, MTIME);
    else {
      chmodSync(p, st.mode & 0o111 ? 0o755 : 0o644);
      utimesSync(p, MTIME, MTIME);
    }
  }
  const listFile = `${outPath}.list`, tarPath = `${outPath}.tar`;
  writeFileSync(listFile, files.map((f) => f.split(path.sep).join("/")).join("\n") + "\n");
  execFileSync("tar", ["--format", "ustar", "--uid", "0", "--gid", "0", "-cf", tarPath, "-C", stageDir, "-T", listFile]);
  execFileSync("sh", ["-c", 'gzip -n -9 -c "$1" > "$2"', "sh", tarPath, outPath]);
  rmSync(tarPath);
  rmSync(listFile);
  const bytes = readFileSync(outPath);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, files: files.length };
}
