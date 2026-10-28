# Reproducible builds

How to rebuild Benzo's three release artifacts **byte-for-byte** on any machine, and what their
sha256 values must be. Every input is pinned; nothing resolves `@latest` or a branch. The transcript
of one such rebuild from a fresh clone in `/tmp` is recorded at
`docs/evidence/reproducible-build/pk-rebuild-rg.out`.

## 1. Pinned toolchain

Runtime of the build (recorded by the rebuild transcript; other patch versions of Node/npm may work
but are not what these digests were produced with):

| Tool | Version | Pinned by |
|---|---|---|
| Node.js | v24.15.0 | build machine (`.nvm`); no engines field |
| npm | 12.0.2 | build machine |
| tar | bsdtar (any libarchive 3.5+ tested: macOS 3.5.3, Ubuntu 3.7.2) | `tools/deterministic-tar.mjs` picks bsdtar explicitly and refuses GNU tar |
| gzip | Node's bundled zlib (no system gzip) | the pinned Node.js above |
| esbuild | 0.28.2 | `package.json` + `package-lock.json` |
| typescript | 5.9.3 | `package.json` + `package-lock.json` |
| Playwright (Chromium pin) | `@playwright/test` 1.63.0 → `chromium_headless_shell-1243` | `package-lock.json` + `npx playwright install` |
| tlock-js | 0.9.0 | `package.json` + `package-lock.json` |

The tarballs rebuild the same on macOS and Linux (arm64 and x86-64 measured).

The full npm dependency tree is pinned exactly in `package-lock.json` (committed; `npm ci` refuses
anything else). The three artifacts build from these packages only.

The rest of the pinned toolchain lives in `tools/pins.env` and is built into `$BNZ_STATE_DIR/bin` by
`tools/bootstrap.sh` (recorded in `versions.txt`). It does not enter the three artifacts below, but
it is the toolchain the project's evidence runs against:

| Tool | Pin (`tools/pins.env`) |
|---|---|
| zcash-devtool (pczt 0.9.3) | `5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8` |
| frost-tools (frostd, frost-client, zcash-sign) | `06c0dbdbb1bac9b99cd255e74ba2f387c295e660` |
| `tle` (Go) | `v1.2.0` |
| `grpcurl` (Go) | `v1.9.3` |
| lightwalletd protos | `d16d48124e9ad4157ebc2324b5090c6ba201470c` (SHA-256 checked) |

## 2. Artifacts and expected sha256

| Artifact | Built by | Expected sha256 |
|---|---|---|
| `dist/benzo-verify.mjs` (shipped verify bundle) | `npm run build:verify` | `61cfcf2d1c143e5de7b7c40f4d66dd9e77b0d6dec9adb366231ffc48066b23ff` (also in `docs/verify-bundle.sha256`) |
| `dist/benzo-0.1.0.tgz` (npm package: CLI + verify bundle + pinned production deps) | `npm run package` | `646f5e3b7eb4e48ec3847656279836d03b53a3c8a5f95e342012bc60cc07905d` |
| `dist/benzo-bidder-0.1.0.tgz` (bidder bundle: the browser sealer) | `npm run package:bidder` | `f6afad1394f15d9ef4d787edffa25479b0c35b77b94cd21e9b7db51c9cd07c38` |

## 3. The commands (fresh clone)

```sh
git clone <this-repository> benzo-rebuild   # main
cd benzo-rebuild
git rev-parse --short HEAD        # the commit these digests are recorded at

npm ci                            # exact tree from package-lock.json

npm run build:verify              # rebuilds the shipped verify bundle + its digest
shasum -a 256 dist/benzo-verify.mjs
# 61cfcf2d1c143e5de7b7c40f4d66dd9e77b0d6dec9adb366231ffc48066b23ff  dist/benzo-verify.mjs
shasum -a 256 -c docs/verify-bundle.sha256

npm run package                   # build:cli + build:seal + check:bundle, then the tarball
shasum -a 256 dist/benzo-0.1.0.tgz
# 646f5e3b7eb4e48ec3847656279836d03b53a3c8a5f95e342012bc60cc07905d  dist/benzo-0.1.0.tgz

npm run package:bidder            # build:seal, then the bidder tarball
shasum -a 256 dist/benzo-bidder-0.1.0.tgz
# f6afad1394f15d9ef4d787edffa25479b0c35b77b94cd21e9b7db51c9cd07c38  dist/benzo-bidder-0.1.0.tgz
```

`npm run check:bundle` (run inside `npm run package`) refuses to package a tree whose
`dist/benzo-verify.mjs` differs from a fresh rebuild (the bundle is only ever produced by
`npm run build:verify` from the checkout that commits it).

## 4. Why the tarballs are byte-stable

Both `.tgz` artifacts go through `tools/deterministic-tar.mjs`:

- **ustar**, not pax: pax extended headers record file atime and make the archive depend on when the
  files were read (tested; two copies with equal mtimes but different atimes produced different
  pax archives, ustar archives were identical).
- a **sorted file list** (`-T`), never filesystem walk order;
- **fixed mtime** `2026-01-01T00:00:00Z` on every entry — including symlinks, which get
  `lutimesSync` because `cpSync` stamps symlink copies with the copy time and `utimesSync` would
  follow the link (`node_modules/.bin/*` are symlinks);
- **absolute symlink targets rewritten** to archive-relative links when they point inside the source
  tree (npm's `node_modules/.bin` can carry absolute links — they embedded the builder's own
  directory in the tarball and dangled on every other machine; found by the fresh-clone run);
- **modes normalized** to 0644, or 0755 when the file has any execute bit (so umask never leaks in);
- **uid/gid 0 with the owner names pinned** (`--uid 0 --gid 0 --uname root --gname root`), so
  neither the builder's account nor the platform's name for gid 0 (macOS `wheel`, Linux `root`) can
  leak in;
- Node's **`zlib.gzipSync` at level 9 with the header pinned** (OS byte 3): Apple gzip and GNU gzip
  emit different deflate streams for the same tar, while Node's bundled zlib emits the same stream
  on macOS and Linux (arm64 and x86-64 measured), and FLG 0 / MTIME 0 keep any filename or
  build time out of the gzip header.

The verify bundle is esbuild output of pinned inputs with a pinned esbuild: byte-stable by
construction (`npm run build:verify` twice from absent output produces the same digest).

## 5. Checked on a clean machine

[`docs/evidence/reproducible-build`](evidence/reproducible-build/) holds the runs: on a fresh Linux VM with no network,
no checkout and an empty home, the published package installs, verifies a real round (every check `OK`) and refuses
two tampered copies; a fresh clone rebuilds every artifact byte for byte (`04-rebuild.out`: `OK` for each).
