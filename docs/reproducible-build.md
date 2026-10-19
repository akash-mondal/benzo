# Reproducible builds (gate PK)

How to rebuild Benzo's three release artifacts **byte-for-byte** on any machine, and what their
sha256 values must be. Every input is pinned; nothing resolves `@latest` or a branch. The transcript
of one such rebuild from a fresh clone in `/tmp` is recorded at
`docs/evidence/phase-6/pk-rebuild-rg.out`.

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

The tarballs now rebuild the same on macOS and Linux (arm64 and x86-64 measured, R90).

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
| `dist/benzo-verify.mjs` (shipped verify bundle) | `npm run build:verify` | `c93f1e19d06c153695d25d3f6d57b6f69ae64db5a6c37032ab81bf5b36be9a25` (also in `docs/verify-bundle.sha256`) |
| `dist/benzo-0.1.0.tgz` (npm package: CLI + verify bundle + pinned production deps) | `npm run package` | `6e666aa19b08c4dc87ed3033eae55c7d90e53542516437ce341f45abf45f8ecb` |
| `dist/benzo-bidder-0.1.0.tgz` (bidder bundle: the browser sealer) | `npm run package:bidder` | `f6afad1394f15d9ef4d787edffa25479b0c35b77b94cd21e9b7db51c9cd07c38` |

## 3. The commands (fresh clone)

```sh
git clone --branch track-b <this-repository> benzo-rebuild
cd benzo-rebuild
git rev-parse --short HEAD        # the commit these digests are recorded at

npm ci                            # exact tree from package-lock.json

npm run build:verify              # rebuilds the shipped verify bundle + its digest
shasum -a 256 dist/benzo-verify.mjs
# c93f1e19d06c153695d25d3f6d57b6f69ae64db5a6c37032ab81bf5b36be9a25  dist/benzo-verify.mjs
shasum -a 256 -c docs/verify-bundle.sha256

npm run package                   # build:cli + build:seal + check:bundle, then the tarball
shasum -a 256 dist/benzo-0.1.0.tgz
# 6e666aa19b08c4dc87ed3033eae55c7d90e53542516437ce341f45abf45f8ecb  dist/benzo-0.1.0.tgz

npm run package:bidder            # build:seal, then the bidder tarball
shasum -a 256 dist/benzo-bidder-0.1.0.tgz
# f6afad1394f15d9ef4d787edffa25479b0c35b77b94cd21e9b7db51c9cd07c38  dist/benzo-bidder-0.1.0.tgz
```

`npm run check:bundle` (run inside `npm run package`) refuses to package a tree whose
`dist/benzo-verify.mjs` differs from a fresh rebuild (R32: the bundle is only ever produced by
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
  on macOS and Linux (arm64 and x86-64 measured, R90), and FLG 0 / MTIME 0 keep any filename or
  build time out of the gzip header.

The verify bundle is esbuild output of pinned inputs with a pinned esbuild: byte-stable by
construction (`npm run build:verify` twice from absent output produces the same digest — see the
run-28 record in `docs/STATUS-B.md`).

## 5. Notes

- The npm package tarball's digest changed a few times while this batch landed (the previous
  `tar czf` recorded per-file copy times and the builder's uid; the first deterministic version
  still leaked an absolute symlink; and `benzo auction keys` loaded `settle/io` — which resolves
  `BNZ_STATE_DIR` at import time — eagerly, which broke every command in an extract without a
  `.env`; it now imports it inside `run()`). The superseded digest (`856fae26…`, run 28) lives in
  git history; `docs/evidence/phase-6/pk-package.out` /
  `pk-package.sha256` / `pk-package-verify.out` were regenerated by this batch (run 32) at the commit
  that made the packager deterministic, and `pk-rebuild.out` proves a fresh clone reproduces all
  three digests above.
- **B33 refresh (run 33).** The digests above were re-recorded at the B33 commit after the README
  refresh, the LICENSE addition and a `docs/verify-it-yourself.md` digest fix (all three ship in the
  tarball). The rebuild found a staleness bug worth knowing: `cli/build.mjs` never prunes
  `cli/dist/commands/`, and the router lists whatever it finds there, so the **removed**
  `benzo auction balance-addresses` command (R33 item 1) stayed live in build output and in the
  first regenerated tarball until `cli/dist` was deleted and rebuilt. The recorded digests come from
  the cleaned tree, and the package digest is re-proven from a fresh clone in the regenerated
  `pk-package.out`. `pk-rebuild.out` stays the run-32 record (its three digests are the run-32
  values). The bidder bundle is unchanged (`fa54df28…` re-checked in run 33 — it ships only
  `seal/` output).
- **B34 refresh (run 34).** Re-recorded after R36 (`package.json` is `"license": "UNLICENSED"`, `LICENSE`
  removed — the tarball never shipped `LICENSE`, but `package.json` does ship, so the npm-package digest
  changes) and R37.5 (`cli/build.mjs` cleans `cli/dist` before building, so the run-33 stale-module
  finding is prevented at its source). New digests: verify bundle `80754445…`, npm package `ab18336f…`
  (18,321 entries, 112 production packages), bidder bundle `fa54df28…` **unchanged** (it ships only
  `seal/` output). All three re-proven: two clean `npm run package` builds identical
  (`docs/evidence/phase-6/pk-package.out`), two clean `npm run package:bidder` builds identical plus the
  clean-machine seal/open proof (`pk-bidder.out`, quicknet round 32818939), and a fresh clone in `/tmp`
  reproduces all three byte-for-byte (`pk-rebuild.out`; the run-32/33 mixed record it replaces is in git
  history). The verify-bundle digest also corrects run-33's table entry: `effd9853…` was the bundle of
  track-b's tree at `50ee067`; the B33 merge resolved `dist/benzo-verify.mjs` to Track A's rebuilt bundle
  (`9634882`, A15 envelope/verify changes are bundle inputs), and `npm run check:bundle` plus
  `pk-rebuild.out` both confirm `80754445…` is byte-equal to a rebuild of the merged tree. The digests
  hold at the commit that records them: everything this refresh commits is `docs/` text and evidence,
  none of which `tools/package.mjs` copies into the tarball. `pk-package-verify.out` re-proves the clean
  extract (`bin/benzo verify` on the shipped Phase 4 evidence, offline, exit 0) and shows the R33-removed
  `auction balance-addresses` is absent from the packaged CLI (router refuses it, exit 2; no tarball
  entry).
- **B36 refresh (run 36, 2026-10-16).** All three values re-recorded after the product rulings that
  landed since run 34's refresh at `3ca5c9f`. `docs/evidence/phase-6/pk-rebuild-rg.out` is the
  fresh-clone record: two independent clones in `/tmp` with empty HOME rebuild all three artifacts
  byte-identically at `638ae26` (and equal to the in-tree build), with `dist/benzo-verify.mjs` equal
  to `docs/verify-bundle.sha256` there. What changed and why:
  - verify bundle `80754445…` → `b122bf2b…`: the bundle was rebuilt by R42's refund/stray verify
    (`28f52e3`, `414bcbd`), R44's F19 defaults tie-break verify (`68fb2f7`), F21 (`bd315fd`), R52's
    `tle` failover bounding in `manifest/reserve.ts` (`42db1fe`), R61's void-bond verify (`38e8d76`),
    R63's bond-is-mode-A-only verify (`03f4404`) and R64's `bond_void` recomputation (`0d50cdd`, the
    commit that recorded `b122bf2b…`). R65 changed no bundle input (`npm run check:bundle` PASS at
    `638ae26`).
  - npm package `ab18336f…` → `9693395b…` (18,323 entries, 112 production packages; the two extra
    entries are R40.3's `launch-deliver-list`/`sign-delivery` command modules): the same verify code,
    plus the CLI/host-side rulings R34.2, R38, R40–R46 and R48–R65 (bounded lightwalletd/drand calls,
    proven-absence re-pay refusals, the void bond, endpoint normalization), and this refresh's
    shipped-doc fix below.
  - bidder bundle `fa54df28…` **unchanged**: `seal/` and its inputs (`seal/src`, `seal/index.html`,
    `package.json`, the packager) are untouched since run 32 — `git log 3ca5c9f..HEAD -- seal/
    package.json tools/package-bidder.mjs tools/deterministic-tar.mjs` is empty — and the fresh-clone
    rebuild re-measures it unchanged.
  - The shipped-doc fix and the two digests. `README.md` and `docs/verify-it-yourself.md` are tarball
    inputs (`tools/package.mjs`) and still recorded the superseded run-33 bundle digest (`effd9853…`)
    although `docs/verify-bundle.sha256` has been `b122bf2b…` since R64; this refresh corrects them,
    which is why the npm digest measured at `638ae26` (`5d36782f…`, in the rebuild transcript) differs
    from the expected `9693395b…` above. `pk-package.out` (two clean `npm run package` builds
    identical) and `pk-package-verify.out` (clean extract in `/tmp` with empty HOME: `bin/benzo verify`
    on the shipped Phase 4 evidence offline, exit 0; `auction balance-addresses` absent, exit 2)
    record `9693395b…` at the tree that carries the fix. Nothing this batch commits afterwards
    touches a tarball input, so the expected values hold at the commit that records them and after.
  - `pk-rebuild.out` stays the run-34 record; `pk-rebuild-rg.out` supersedes it.
- **B41 (run 39, 2026-10-18).** The two tarball digests move to the values above because the
  packager changed; the only code change is `tools/deterministic-tar.mjs`. It now picks bsdtar
  explicitly (`bsdtar` on PATH, else a `tar` that reports `bsdtar`, else a one-line refusal — never
  GNU tar), pins the owner names in the tar call (`--uname root --gname root`; macOS wrote `wheel`
  for gid 0 where Linux writes `root`, measured in `docs/evidence/phase-6/pk-vm/`), and gzip's in
  Node (`zlib.gzipSync`, header OS byte pinned to 3) instead of the system gzip. The tar layers are
  unchanged in content (the bidder layer is byte-equal to the `2ad6eae8…` layer the Ubuntu VM
  measured), `tar -tzf` lists the same 18,323 / 2 entries, and the shipped verify bundle is
  untouched. The verify-bundle row above also corrects a staleness this refresh found: it recorded
  `b122bf2b…` although `docs/verify-bundle.sha256` has carried `96886226…` since the R81/R83
  rebuilds. macOS digests are re-proven twice each at this commit; the matching Linux digests come
  with the head's re-run of the VM step 04.
- Cargo (`settle/`, `npm run build:settle`) is not part of the three artifacts; the Rust toolchain
  is whatever `cargo build --release --locked` accepts from `settle/Cargo.lock`.
