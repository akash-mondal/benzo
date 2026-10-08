# R43 guard sweep (R44 F17) — every `rmSync` / `rm -rf` / `rm -f` in `tools/`, `e2e/`, `cli/`

- utc: 2026-10-08T00:32Z, base commit `a2e1aaf` (sweep edits in the commit this file ships with).
- Rule (R43): a script may delete a state directory only if its resolved path is under `tmp/` or `$TMPDIR`.
  The guard is `tools/repro/scratch.ts assertScratch`, called before any I/O on the target.
- Sweep command: `grep -rn "rmSync(\|rm -rf\|rm -f " tools/ e2e/ cli/ | grep -v node_modules`
  (imports and the guard's own doc comment excluded; `cli/dist/` listed as generated).
- Verdicts: **guarded** = `assertScratch` wraps the delete (directly or in the target's definition);
  **exempt** = no guard, target can only be a temp/build/own-artifact path; reason given.

## F17 changes in this commit

| site | change |
|---|---|
| `tools/repro/r7-claims-repro.mjs` (was :62) | claim scratch moved `STATE/run/r7-claims-repro` → `tmp/e2e/r7/claims-repro` and both deletes guarded. The old path was the A20 incident shape: `settle/io` self-loads `BNZ_STATE_DIR=./.benzo`, so the resolved target sat under the real state dir. Nothing read that path (swept). |
| `tools/repro/bidder-bundle-driver.mjs` (was :34-35) | `chromium-profile` delete guarded. The driver is copied **standalone** into the fresh dir by `bidder-bundle-proof.ts` and resolves nothing from the checkout, so the guard check is inlined with the same semantics (source noted in the file). |
| `e2e/lib/readpath-live.ts` `foldR7Claims` (was :660) | verbatim fold of `r7-claims-repro.mjs`; kept verbatim by mirroring the same move + guard. |
| `tools/repro/scratch.ts` | `.mjs` drivers can now import it (explicit `.ts` import of `manifest/root.ts`; `tsconfig.json` gains `allowImportingTsExtensions`, legal with `noEmit`). Base set gains the POSIX shared `/tmp`: on macOS `os.tmpdir()` is `/var/folders/...`, so the literal `/tmp` fresh dir of the clean-machine bidder proof was refused by the guard itself. In the env-stripped proof child `os.tmpdir()` *is* `/tmp`, so both bases are needed. |

## Guard demo (the `.mjs`-reachable guard)

```
$ node --input-type=module -e "const { assertScratch } = await import('./tools/repro/scratch.ts'); ..."  # try each path
refuse ./.benzo -> R43: refusing to delete or rebuild outside tmp/ or $TMPDIR: /Users/akshmnd/Dev Projects/benzo/.benzo
refuse /Users/akshmnd/Dev Projects/benzo/.benzo -> R43: refusing to delete or rebuild outside tmp/ or $TMPDIR: .../.benzo
accept tmp/x -> /Users/akshmnd/Dev Projects/benzo/tmp/x
accept /tmp/benzo-bidder-proof/x -> /tmp/benzo-bidder-proof/x
refuse /var/other/x -> R43: refusing to delete or rebuild outside tmp/ or $TMPDIR: /var/other/x
```

`npm run typecheck` clean; `node --check` clean on both `.mjs` drivers; `esbuild --bundle` of a
`scratch.ts` consumer (`tools/repro/r44-f16.ts`) clean.

## tools/ (build and packaging)

| site | target | verdict | reason |
|---|---|---|---|
| `tools/deterministic-tar.mjs:42` | symlink inside the caller's staging tree | exempt | staging roots are literal `tmp/package*` (below); the rewrite touches only links inside it |
| `tools/deterministic-tar.mjs:55-56` | `<out>.tar`, `<out>.list` | exempt | build intermediates the function itself just wrote next to the archive |
| `tools/check-bundle.mjs:19` | `tmp/benzo-verify.check.mjs` | exempt | literal `tmp/` path |
| `tools/package.mjs:25` | `tmp/package` | exempt | literal `tmp/` path |
| `tools/package-bidder.mjs:20` | `tmp/package-bidder` | exempt | literal `tmp/` path |
| `tools/bench.ts:169` | `mkdtempSync(resolve("tmp","batching-equal-"))` | exempt | created under literal `tmp/` |
| `tools/setup-testnet.sh:48,80` | `$PIDFILE` | exempt | the service pidfile the script itself wrote |
| `tools/nu7/build.sh:30` | `${dir:?}/$cv`, `$f` | exempt | pinned-tool crate cache; `${dir:?}` makes an empty path impossible; targets are pinned crate ids / the downloaded `.crate` file |
| `tools/nu7/build.sh:58` | `$src` | exempt | same cache's `src/` dir, and only when `$src/.git` is absent (partial clone) |

## tools/repro/ — guarded (assertScratch)

| site | verdict | note |
|---|---|---|
| `api-reference-check.ts:75,86` | guarded | |
| `batching-equal.ts:47` | guarded | target is an `mkdtemp` under `tmp/` |
| `bidder-bundle-proof.ts:45` | guarded | `fresh=/tmp/benzo-bidder-proof`; this call **refused on macOS before this commit** (guard's `$TMPDIR` base is `/var/folders/...`); fixed by the `/tmp` base |
| `markets.ts:66,68,112,125,443` | guarded | |
| `mut-replay-markets.ts:75,96` | guarded | |
| `r28-replay.ts:21,30` | guarded | `:21` deletes `w` (defined as `assertScratch(...)` at `:20`); `:30` deletes `created`/`proven`, files inside `w` |
| `r33-defaults.ts:111` | guarded | |
| `r38-n2.ts:53,126` | guarded | |
| `r38-n6.ts:62` | guarded | |
| `r40-f2-ledger-growth.ts:143` | guarded | |
| `r40-f3-balances.ts:60` | guarded | |
| `r40-f4-join.ts:46` | guarded | |
| `r41-f7-map-wedge.ts:43` | guarded | `state` defined through `assertScratch` at `:41` (the A20-incident driver) |
| `r42-f12-drift.ts:36` (both) | guarded | `state` asserted at `:33`; `publicDir` wrapped inline |
| `r41-f8-allocation.ts:52` | guarded | |
| `r42-f13-f14-tamper.ts:50` | guarded | |
| `r42-f15-note-refunds.ts:129` | guarded | |
| `r44-f16.ts:22` | guarded | `base` defined through `assertScratch` at `:21` |
| `xchain-demos.ts:192,436` | guarded | |
| `y2-host-custody.ts:91` | guarded | |
| `r7-claims-repro.mjs:65,88` | guarded | **F17** (see above) |
| `bidder-bundle-driver.mjs:48` | guarded | **F17** (inlined guard; see above) |

## tools/repro/ — exempt (targets constructed under `tmp/`)

| site | target | reason |
|---|---|---|
| `r10-2-envelope-pay-repro.mjs:53` | `tmp/e2e/r10-2-state` | literal `tmp/` |
| `r10-4-envelope-agreement-repro.mjs:53` | `tmp/e2e/r10-4-state` | literal `tmp/` |
| `r15-3-claim-envelope-repro.mjs:38` | `tmp/e2e/r15-3-state` | literal `tmp/` |
| `r15-verify-leaves-repro.mjs:119,188` | `tmp/repro-r15/...` | literal `tmp/` |
| `r16-1-cancel-claims-repro.mjs:47` | `tmp/e2e/r16-1-state` | literal `tmp/` |
| `r16-4-stray-claim-opening-repro.mjs:68` | `tmp/e2e/r16-4-dir` | literal `tmp/` |
| `r23-2-signed-opens-repro.mjs:58` | `tmp/e2e/r23-2` | literal `tmp/` |
| `r23-3-api-claims-repro.mjs:35` | `tmp/r23-3-api` | literal `tmp/` |
| `r26-1-deposit-party-repro.mjs:84,473` | `tmp/e2e/r26-1`, its `repo/` | literal `tmp/` |
| `r26-3-projection-repro.mjs:118` | `tmp/repro-r26-3` | literal `tmp/` |
| `r33-p2.ts:91` | `tmp/r33-p2-small.pczt` | literal `tmp/` file |
| `r7-2-envelope-keys-repro.mjs:70` | `tmp/e2e/r7/keys-repro-public` | literal `tmp/` |
| `r7-4-claim-refund-repro.mjs:50,88` | `tmp/e2e/r7/claim-repro`, its `cold/` | literal `tmp/` |
| `r7-5-reserve-opening-repro.mjs:46` | `tmp/e2e/r7/reserve-cold` | literal `tmp/` |
| `r7-6-stray-refunds-repro.mjs:47` | `tmp/e2e/r7/stray-repro-public` | literal `tmp/` |
| `g7-network-repro.mjs:30` | `tmp/g7-network` | literal `tmp/` |
| `g-forged-claim.mjs:163` | `tmp/g-work` | literal `tmp/` |
| `mr-envelope-repro.mjs:200,265` | `tmp/repro-mr/...` | literal `tmp/` |
| `r42-f11-strays.ts:19` | — | `rmSync` imported, no call site (no delete) |
| `r41-f7-map-wedge.ts:45` | `tmp/r41-f7-public` | literal `tmp/` (`:43` in the same driver is guarded) |
| `xchain-demos.sh:31` | `contracts/solana/target/test-ledger-xchaindemos` | fixed literal path in the build tree (solana-test-validator ledger) |

## e2e/

| site | target | verdict | reason |
|---|---|---|---|
| `lib/readpath-live.ts:663,686` | `tmp/e2e/r7/claims-repro`, `tmp/e2e/r7/claims-cold` | guarded | **F17** fold mirror |
| `lib/readpath-live.ts:432,500,538,581,736,913,1134,1232,1380` | `tmp/e2e/...` scratch dirs | exempt | literal `tmp/` (folded repro scripts) |
| `lib/readpath.ts:97,147,257,591,633` | `tmp/r35-folds/...` | exempt | literal `tmp/` |
| `lib/readpath-r232.ts:27` | `tmp/e2e/r23-2` | exempt | literal `tmp/` |
| `lib/readpath-r261.ts:48,437` | `tmp/e2e/r26-1`, its `repo/` | exempt | literal `tmp/` |
| `lib/global-setup.ts:8-9` | `e2e/out`, `e2e/results` | exempt | test-output dirs, rebuilt each run |
| `lib/global-teardown.ts:22-23` | run dirs + `run.json` under the evidence/out copy | exempt | evidence staging the teardown itself assembles |
| `lib/frost.ts:56` | `$PIDFILE` | exempt | service pidfile the harness wrote |
| `settle-crash.spec.ts:43`, `cli-auction.spec.ts:135` | own pidfiles | exempt | files the spec wrote for its own worker |
| `buyback-mode.spec.ts:110,130` | `STATE/settle/<id>/w2`, `STATE/settle/<id>/<tag>` | exempt | live-harness run workdirs the spec itself creates under its own auction's settle dir; fixed literal subpaths keyed by the auction id, cannot resolve to the state root or key material. The live harness deliberately runs under the real `BNZ_STATE_DIR`; R43's driver class is `tools/repro/`. |
| `buyback-mode.spec.ts:116,142` | `created`/`proven`/`full` PCZT files inside those workdirs | exempt | own artifacts inside the workdirs above |
| `buyback-mode.spec.ts:164` | `frozen.json` inside the `tmp/e2e/cold` copy | exempt | single file inside a `tmp/` cold copy (W5 attack fixture) |
| `buyback-mode.spec.ts:196` | `tmp/e2e/cold/<id>` | exempt | literal `tmp/` |
| `auction-core.spec.ts:119` | `STATE/g7` | exempt | same class as the buyback workdirs (spec-created, fixed literal subpath) |

## cli/

| site | target | verdict | reason |
|---|---|---|---|
| `build.mjs:10` | `cli/dist` | exempt | build output dir, fixed literal path |
| `commands/auction-keys.ts:58` | `.ufvk-check.txt` probe | exempt | single probe file the command writes and removes itself |
| `commands/buyback-intake.ts:36` | the intake file it was writing | exempt | own artifact removed on its own error path |
| `commands/sign-build.ts:74` | `created.pczt`, `proven.pczt` in the packet dir | exempt | PCZT artifacts the command itself just wrote |
| `commands/sign-approve.ts:45,112,135` | probe/candidate/recomputed files | exempt | own artifacts (incl. under `--packet`, files it wrote) |
| `dist/commands/*.mjs` (all rows above mirrored) | — | exempt | generated by `cli/build.mjs` from `cli/commands/*.ts`; classified with their sources |

## Findings

1. `bidder-bundle-proof.ts:45` was a latent guard refusal on macOS (guard's `$TMPDIR` base does not
   cover a literal `/tmp` path). Fixed here by adding the POSIX shared `/tmp` as a guard base; R43's
   "tmp/" wording covers it. Noted under Questions in `docs/STATUS.md` for the head.
2. No unguarded state-dir delete remains: the only two state-derived deletes in `tools/repro/`
   (`r7-claims-repro.mjs`, `bidder-bundle-driver.mjs`) are now guarded (F17), and the only
   state-derived deletes anywhere else are the e2e live-harness run workdirs listed above, which the
   harness owns and which cannot resolve to the state root.
