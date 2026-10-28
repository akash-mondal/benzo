// Deterministic tar+gzip for the release artifacts: ustar headers (no atime records), the
// staged files listed in sorted order, fixed mtime and normalized modes, uid/gid 0 with the owner
// names pinned to root, then Node's own gzip with a pinned header. Two builds of identical content
// produce byte-identical .tgz files — here, on a fresh clone, and on Linux (arm64 and x86-64
// measured on a clean VM).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, lutimesSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

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

// Pick bsdtar (libarchive) explicitly and never GNU tar: the archive bytes must not depend on which
// tar the machine happens to have, and GNU tar does not even accept --uid/--uname (it failed exactly
// that way on a clean VM). macOS ships bsdtar as `tar`; Debian/Ubuntu ship GNU tar as `tar`
// and put bsdtar on PATH after `apt install libarchive-tools`.
function pickBsdtar() {
  try {
    execFileSync("bsdtar", ["--version"], { stdio: "ignore" });
    return "bsdtar";
  } catch {
    // No bsdtar under that name; try `tar` below.
  }
  try {
    const version = execFileSync("tar", ["--version"], { encoding: "utf8" });
    if (version.startsWith("bsdtar")) return "tar";
  } catch {
    // No readable tar version output either; refuse below.
  }
  console.error("ERROR packaging needs bsdtar (macOS: built in; Debian/Ubuntu: apt install libarchive-tools)");
  process.exit(1);
}

// Symlink permission bits follow the build system, not the files: Linux symlinks are always 0777,
// while macOS symlinks carry their own mode (npm's node_modules/.bin links come out 0755). Readers
// ignore a symlink's mode, so every symlink header is pinned to 0777 here, and its header checksum
// is recomputed in the format bsdtar writes (six octal digits, NUL, space). Without this the npm
// package differed between macOS and Linux in exactly these headers.
function pinSymlinkModes(tar) {
  const out = Buffer.from(tar);
  for (let o = 0; o + 512 <= out.length; ) {
    const header = out.subarray(o, o + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(header.toString("latin1", 124, 136).replace(/[^0-7]/g, "") || "0", 8);
    if (header[156] === 0x32) {
      header.write("000777 \0", 100, "latin1");
      header.fill(0x20, 148, 156);
      let sum = 0;
      for (const b of header) sum += b;
      header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
    }
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// tarGz(stageDir, outPath, opts?): opts.linkRoot — when a staged symlink points at an absolute path
// under linkRoot (npm's node_modules/.bin can carry such links), rewrite it to the equivalent
// archive-relative link. Left alone it would embed the builder's own directory in the tarball (and
// dangle on every other machine).
export function tarGz(stageDir, outPath, opts = {}) {
  const files = stageFiles(stageDir);
  for (const rel of files) {
    const p = path.join(stageDir, rel), st = lstatSync(p);
    // Symlink mtimes live on the link itself (cpSync stamps the copy time); utimesSync would follow
    // the link and leave the tar's symlink header unstable — use lutimesSync for those.
    if (st.isSymbolicLink()) {
      const target = readlinkSync(p);
      if (path.isAbsolute(target) && opts.linkRoot && target.startsWith(opts.linkRoot + path.sep)) {
        const top = rel.split(path.sep)[0];
        rmSync(p);
        symlinkSync(path.relative(path.dirname(rel), path.join(top, path.relative(opts.linkRoot, target))), p);
      }
      lutimesSync(p, MTIME, MTIME);
    } else {
      chmodSync(p, st.mode & 0o111 ? 0o755 : 0o644);
      utimesSync(p, MTIME, MTIME);
    }
  }
  const listFile = `${outPath}.list`, tarPath = `${outPath}.tar`;
  writeFileSync(listFile, files.map((f) => f.split(path.sep).join("/")).join("\n") + "\n");
  // The owner names are pinned alongside uid/gid 0: macOS bsdtar writes the group name `wheel` for
  // gid 0 and Linux writes `root`, so one header field per entry differed across systems (measured
  // on a clean VM). With --uname root --gname root both write byte-identical tars.
  execFileSync(pickBsdtar(), ["--format", "ustar", "--uid", "0", "--gid", "0", "--uname", "root", "--gname", "root", "-cf", tarPath, "-C", stageDir, "-T", listFile]);
  const tar = pinSymlinkModes(readFileSync(tarPath));
  // gzip in Node, not the system gzip command: Apple gzip and GNU gzip emit different deflate
  // streams for the same tar, while Node's bundled zlib emits the same stream on macOS and Linux
  // (arm64 and x86-64 measured). Only zlib's header OS byte follows the build platform
  // (19 on macOS, 3 on Linux), so it is pinned to 3 — Unix, what GNU `gzip -n` writes — or the
  // digest would still depend on where the build ran.
  const gz = gzipSync(tar, { level: 9 });
  gz[9] = 3;
  // Refuse anything but the pinned gzip header shape: magic 1f 8b, CM 08, FLG 0 (no name, comment
  // or extra fields) and MTIME 0 (no build timestamp), or the stream would not be rebuildable.
  const bad = gz[0] !== 0x1f || gz[1] !== 0x8b || gz[2] !== 0x08 || gz[3] !== 0
    || gz[4] !== 0 || gz[5] !== 0 || gz[6] !== 0 || gz[7] !== 0;
  if (bad) {
    const hex = [...gz.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    throw new Error(`ERROR gzip header is not the pinned 1f 8b 08 00 00 00 00 00 shape: ${hex}`);
  }
  writeFileSync(outPath, gz);
  rmSync(tarPath);
  rmSync(listFile);
  return { sha256: createHash("sha256").update(gz).digest("hex"), bytes: gz.length, files: files.length };
}
