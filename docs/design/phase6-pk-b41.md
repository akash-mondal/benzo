# Gate PK batch B41: release tarballs that rebuild byte-identical on macOS and Linux

Head design, 2026-10-18. Evidence: `docs/evidence/phase-6/pk-vm/` (R90). On a clean Ubuntu VM, the verify bundle rebuilds byte-identical, but `npm run package` and `npm run package:bidder` fail with GNU tar (`--uid` unknown). With bsdtar they build, but the digests differ from the macOS build. Two causes were measured:

1. **tar:** macOS bsdtar writes group name `wheel` for gid 0; Linux bsdtar writes `root`. With `--uname root --gname root`, both write identical bytes.
2. **gzip:** Apple gzip and GNU gzip produce different streams. Node's `zlib.gzipSync(buf, { level: 9 })` produces the same deflate stream on macOS arm64, Linux arm64 and Linux x86-64. Only the gzip header OS byte differs (19 vs 3).

## Change (only `tools/deterministic-tar.mjs`, plus docs)

1. **Pick bsdtar explicitly.** Use `bsdtar` if it is on PATH. Otherwise use `tar` if `tar --version` starts with `bsdtar`. Otherwise stop with one line: `ERROR packaging needs bsdtar (macOS: built in; Debian/Ubuntu: apt install libarchive-tools)`. Never fall back to GNU tar.
2. Add `--uname root --gname root` to the tar call. Keep `--format ustar --uid 0 --gid 0`.
3. **Replace the `gzip -n -9` shell call** with `zlib.gzipSync(tarBytes, { level: 9 })` from `node:zlib`. Then set header byte 9 (OS) to `3` (Unix, as GNU `gzip -n` writes). Then check, and refuse if any differs:
   - bytes 0–2 = `1f 8b 08`;
   - FLG (byte 3) = 0;
   - MTIME (bytes 4–7) = 0.
   No `sh -c` remains.
4. Comments in plain English: why bsdtar, why the names, why Node's zlib and the fixed OS byte.

## Docs

- `docs/reproducible-build.md` §1 toolchain:
  - tar row → "bsdtar (any libarchive 3.5+ tested: macOS 3.5.3, Ubuntu 3.7.2)";
  - gzip row → "Node's bundled zlib (no system gzip)".
  - Add a line: the tarballs now rebuild the same on macOS and Linux (arm64 and x86-64 measured, R90).
- §2 and §3: the new expected digests at your commit. Do not edit `README.md` digest lines unless they quote a tarball digest; list any in your status block.

## Proof (offline, on this Mac)

- Two clean `npm run package` runs and two `npm run package:bidder` runs, each pair with an identical sha256.
- A node check that the new tgz header is `1f8b0800 00000000 02 03`, and that `gzip -dc` of the new tgz equals the tar layer you built. In other words, standard tools still read it.
- `tar -tzf` lists the same entries as before (count 18,323 / 2). The `pk-package-verify` extract still runs `bin/benzo verify` on the shipped Phase 4 evidence, exit 0.
- `npm run typecheck`, `npm run check:structure`.
- The head re-runs step 04 on the `benzo-pk` VM. Do not touch OrbStack.

## Rules

- Work only in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b41 -b b41-pk-tar <HEAD>`.
- Offline only: no `.benzo/`, `.env`, OrbStack/`orb`, testnet or wallets.
- `check:bundle` cannot pass in a worktree (R32): commit with `--no-verify` and say so.
- No mid-line `//` after code in scripted edits.
- One commit: `B41: release tarballs reproducible on macOS and Linux (bsdtar names + Node zlib)`. Add a short status block at the top of `docs/STATUS-B.md`.
- If anything here is wrong, write it under Questions in your status block.
