# Gate PK: clean-machine run on a fresh VM (2026-10-18, commit 9d09093)

Run by the head under R90 (user, 2026-10-18: "you can do it on a virtual clean machine").

**The machine.** A new OrbStack Ubuntu 24.04 arm64 VM, `benzo-pk`, created for this run. It had no node, npm, git or go. Each step runs through `scripts/clean-run`, which:
- runs as a new user `stranger` with an empty HOME;
- resets the environment to HOME + PATH only;
- covers every host mount (`/Users`, `/mnt/mac`, `/private`, …) with an empty mode-000 tmpfs, so nothing from this Mac is visible.

The inputs were copied in once:
- the two tarballs plus `SHA256SUMS`;
- a git bundle of `9d09093`;
- the published auction `launch-r34/launch-cold`;
- the published launch manifest;
- the bidder driver;
- the public drand quicknet constants.

| Step | What | Result |
|---|---|---|
| `01-node.out` | Node v24.15.0 linux-arm64 from nodejs.org, checked against `SHASUMS256.txt` | OK |
| `02-verify.out` | **Offline** (`--offline`: network namespace, loopback only; `curl` cannot resolve). `sha256sum -c` on the tarballs. Extract `benzo-0.1.0.tgz` outside any checkout (`git rev-parse` fails). The packaged verify bundle = `docs/verify-bundle.sha256` (`96886226…`). `./bin/benzo verify --dir auction --signer …` | **19 OK, exit 0**. Running the bundle directly gives the same. A tampered `result.json` is refused (`ERROR clear`, exit 1). The wrong `--signer` is refused (exit 1) |
| `03a-tools.out` | Go 1.25.6 from go.dev (checksum checked), `tle` v1.2.0 (`tools/pins.env`). Chromium headless shell from the package's own pinned `playwright-core` 1.63.0 | OK |
| `03b-seal.out` | Extract `benzo-bidder-0.1.0.tgz` into a fresh `/tmp` dir, serve it, seal a bid to the published launch manifest in headless Chromium, open it with `tle` after round R | **PASS**: 2 requests, both to the static origin. `tle` refuses before R. Plaintext = inputs |
| `04-rebuild.out` | Fresh clone of the bundle, `npm ci`, the `docs/reproducible-build.md` §3 commands (npm 12.0.2, GNU tar 1.35, GNU gzip 1.12) | Verify bundle **byte-identical** (`96886226…`, `sha256sum -c` OK). Both tarballs **fail to build**: GNU tar has no `--uid` |
| `04b-rebuild-bsdtar.out` | The same, with `bsdtar` 3.7.2 as `tar` | Both build, but **digests differ** from the macOS build: npm `0003acd3…` vs `5a672f39…`, bidder `84c06f3c…` vs `fa54df28…` |

## Why the tarballs differ (measured on the bidder tarball)

- **The tar layer.** The only difference is the group name: macOS writes `wheel` for gid 0, Linux writes `root`. With `--uname root --gname root`, macOS bsdtar 3.5.3 and Linux bsdtar 3.7.2 write byte-identical tars (`2ad6eae8…`).
- **The gzip layer.** Apple gzip 475 and GNU gzip 1.12 produce different streams (`3df96fe6…` vs `84c06f3c…`). Node's own `zlib.gzipSync(tar, {level: 9})` produces the same deflate stream on macOS arm64, Linux arm64 and Linux x86-64 (`2ae12eb0…` after the 10-byte header). An amd64 VM, created for the test and then deleted, gave the x86-64 result. The only header difference is the OS byte (19 on macOS, 3 on Linux).

The fix is batch B41 (`docs/design/phase6-pk-b41.md`).

## What this closes and what stays open

- **Closed by this run:** on a clean machine, a stranger installs the pinned CLI and runs `benzo verify` on a published auction offline, from outside any checkout. Tampering is refused. They seal a bid with the bidder bundle, and it opens only after R.
- **Open (B41):** the two tarballs are reproducible only on macOS. After B41, re-run `04` on this VM; the digests must equal the macOS build.
- **Re-record after merges:** B39 (H10 changes the manifest schema, so the verify bundle changes) and B41 both move the digests. The final PK record is a re-run of steps 02–04 here after they merge.

## Re-run at `e1ddd69` (after B41 + R94): all three artifacts identical across macOS and Linux

`at-e1ddd69/` holds the same VM, the same `clean-run` jail and the same steps, with the new tarballs:

| Step | Result |
|---|---|
| `02-verify.out` (offline) | `sha256sum -c` OK; `benzo verify` 19 OK, exit 0; the bundle alone exit 0; tampered copy and wrong signer refused (exit 1) |
| `03b-seal.out` | PASS: the bidder bundle sealed a bid in headless Chromium, `tle` refused before R and opened after, and the plaintext equals the inputs |
| `04-rebuild.out` | Fresh clone of `e1ddd69` on Linux. Verify bundle `7eda2871…` = committed. **npm `1aa2b077…` = the macOS build, bidder `f6afad13…` = the macOS build**, `sha256sum -c` OK for both |

Packaging on Linux needs `bsdtar` (`apt install libarchive-tools`). `docs/reproducible-build.md` says so, and packaging refuses GNU tar with that message.
