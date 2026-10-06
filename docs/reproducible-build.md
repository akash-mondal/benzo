# Reproducible builds (gate PK)

How to rebuild Benzo's three release artifacts **byte-for-byte** on any machine, and what their
sha256 values must be. Every input is pinned; nothing resolves `@latest` or a branch. The transcript
of one such rebuild from a fresh clone in `/tmp` is recorded at
`docs/evidence/phase-6/pk-rebuild.out`.

## 1. Pinned toolchain

Runtime of the build (recorded by the rebuild transcript; other patch versions of Node/npm may work
but are not what these digests were produced with):

| Tool | Version | Pinned by |
|---|---|---|
| Node.js | v24.15.0 | build machine (`.nvm`); no engines field |
| npm | 12.0.2 | build machine |
| tar | bsdtar 3.5.3 (libarchive 3.7.4) | macOS system tar |
| gzip | Apple gzip 475 (`gzip -n -9`) | macOS system gzip |
| esbuild | 0.28.2 | `package.json` + `package-lock.json` |
| typescript | 5.9.3 | `package.json` + `package-lock.json` |
| Playwright (Chromium pin) | `@playwright/test` 1.63.0 → `chromium_headless_shell-1243` | `package-lock.json` + `npx playwright install` |
| tlock-js | 0.9.0 | `package.json` + `package-lock.json` |

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
| `dist/benzo-verify.mjs` (shipped verify bundle) | `npm run build:verify` | `807544459ea3f467dcd5c6e4312105e0ea2de68f7e1cccd03e3e3d9cbd1a9371` (also in `docs/verify-bundle.sha256`) |
| `dist/benzo-0.1.0.tgz` (npm package: CLI + verify bundle + pinned production deps) | `npm run package` | `ab18336fd4d52889ebde12925a3e47195bca09c2db395709917c21a1bc4753f9` |
| `dist/benzo-bidder-0.1.0.tgz` (bidder bundle: the browser sealer) | `npm run package:bidder` | `fa54df28e87c507336897f88cf0f831d8df7599f48e54ebeada98dc77cae88f6` |

## 3. The commands (fresh clone)

```sh
git clone --branch track-b <this-repository> benzo-rebuild
cd benzo-rebuild
git rev-parse --short HEAD        # the commit these digests are recorded at

npm ci                            # exact tree from package-lock.json

npm run build:verify              # rebuilds the shipped verify bundle + its digest
shasum -a 256 dist/benzo-verify.mjs
# 807544459ea3f467dcd5c6e4312105e0ea2de68f7e1cccd03e3e3d9cbd1a9371  dist/benzo-verify.mjs
shasum -a 256 -c docs/verify-bundle.sha256

npm run package                   # build:cli + build:seal + check:bundle, then the tarball
shasum -a 256 dist/benzo-0.1.0.tgz
# ab18336fd4d52889ebde12925a3e47195bca09c2db395709917c21a1bc4753f9  dist/benzo-0.1.0.tgz

npm run package:bidder            # build:seal, then the bidder tarball
shasum -a 256 dist/benzo-bidder-0.1.0.tgz
# fa54df28e87c507336897f88cf0f831d8df7599f48e54ebeada98dc77cae88f6  dist/benzo-bidder-0.1.0.tgz
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
- **uid/gid 0** (`--uid 0 --gid 0`), so the builder's account cannot leak in;
- **`gzip -n -9`**, so no filename or timestamp enters the gzip header.

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
- Cargo (`settle/`, `npm run build:settle`) is not part of the three artifacts; the Rust toolchain
  is whatever `cargo build --release --locked` accepts from `settle/Cargo.lock`.
