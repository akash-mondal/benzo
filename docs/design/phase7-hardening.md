# Phase 7 hardening list (head, 2026-10-17)

Every item below was found by a reviewer during gate RG (R72–R83), confirmed, and moved here by the R83 scope freeze. A finding blocks gate RG only if it is a regression, so these real but pre-existing defects get a fix and a proof before mainnet instead. Each row names its source report.

## Must land before mainnet

| # | Sev | What | Where | Fix | Source |
|---|---|---|---|---|---|
| H1 | P2 | `receipt-attestation` requires two pinned witnesses on the receipt's txid and outputs, but not that the two maps agree on batch, defaults, balance_refunds, strays and bond fields. The other checks already require full agreement. | `api/public-auction.ts` receipt-attestation | Use `mapPairAgrees` (witness/index.ts) for the pair | Codex sol smoke test (29 reproduced tests), 2026-10-17 |
| H2 | P2 | Maps and receipts attribute outputs by `{party, output_index}`, with no pool. | `witness/index.ts` ApprovalMapBody, `settle/cli.ts` confirm `find` | Add `pool` to the signed map outputs (a new map format with a legacy reader) and resolve receipts by `(pool, index)` | R80 R-1, R81 R-4 |
| H3 | P2 | Only local builds refuse a batch that pays more than one pool. Custody `hostBuild`, `sign build` and `sign approve` do not, and the local refusal is untyped (it wedges the batch instead of an R46 set-aside). | `settle/cli.ts`, `cli/commands/sign-*.ts` | The same one-pool rule on every build path, as a typed set-aside | R81 R-4 |
| H4 | P2 | The seller UA is not checked for payability. A Sapling-only seller UA makes `create` crash-loop. | `cli/commands/sign-build.ts`, `envelope/destination.ts` `isUnifiedOn` | Require an Orchard receiver at manifest creation | R80, R81 R-5 |
| H5 | P2 | Batch `proofs`, `inspect` and `signing` values are not shape-checked. An encoded blob is seen only by the pattern leak guard. | `api/public-auction.ts` | Exact shapes for the three objects | R82-2, R83 P7-1 |
| H6 | P2 | The receipt exact-key check runs only in `accounting`, which is skipped on result-less (cancelled) settlements. | `api/public-auction.ts` | Move the receipt key check into receipt-attestation | R83 P7-2 |
| H7 | P2 | A bond auction whose every batch is set aside cannot publish a settlement (`pick === null`). | `cli/product.ts:90` | Publish a no-payment settlement with the set-aside reasons | R80 P2 |
| H8 | harness | One `orb run … rm -f` on alice hung for 69 min during attempt 13 markets (drop DKG). `sh()` gives orb calls `timeout: 120_000`, but spawnSync's default SIGTERM did not stop the stuck `orb` client, so the timeout never fired. The head SIGKILLed it, the helper's retry ran on the responsive host, and the run continued. | `e2e/lib/hosts.ts` `sh` (orb branch) | `killSignal: "SIGKILL"` on orb spawnSync; the same for the async `spawn` in `dkgOnHosts` | head, 2026-10-17 |
| H9 | harness/ops | Host errors reach the operator cut to their last 200 chars. In attempt 13 the hosts' real failure (the ALT lightwalletd endpoint answering 503) arrived as an empty `lightwalletd GetBlock:` and was first misread as transient; only a manual `orb run … sign derivable` showed it. | `settle/cli.ts` `hostDerivable`, host build/approve error paths (`.slice(-200)`) | Keep the full stderr in the run log (and the first error line in the console); keep the short form only for published refusal details | head, 2026-10-18 |
| H10 | P2 | The seller payout's address comes from the coordinator's packet (`meta.seller_ua`, operator routing). Signer hosts check its amount against the result but not its address, so a coordinator could redirect seller proceeds. Disclosed in README. | `cli/commands/sign-approve.ts:88-91`, `cli/commands/sign-build.ts:39-40` | Put `seller_ua` in the signed manifest (with H4's Orchard-receiver check) and have each host compare the output to the manifest value | gate H rank 16 (B38), head 2026-10-18 |
| H11 | P2 (liveness) | `open` fetches the beacon from the first `BNZ_DRAND_URLS` relay only, then runs `tle -d` once per leaf, and each run contacts the drand relay again. One relay timeout fails the whole open, and the chance grows with the bid count: gate SC scale-55 (55 bids) failed once on `api.drand.sh` i/o timeout and passed on `resume`. Funds are never at risk; the auction waits in SEALED-WAIT. | `clear/auction-cli.ts:113-127` | Decrypt offline with the beacon signature already fetched (or pass every relay to `tle` and retry per leaf), and fall back across all `BNZ_DRAND_URLS` for the beacon fetch | gate SC, head 2026-10-18 |

## The release scrub (R74–R76)

No public export is approved until it passes. The rules are R74 §1 (a)–(e), as amended by R75 and R76:

- the export omits or redacts every real-destination file;
- the demos read the anvil key from the environment;
- each allowlist path has a written justification;
- the `release_time` entries come first;
- a dry run of `leak-audit --git` over the export exits 0, and its archive sha256 matches the pushed tree.

## Carried residuals (accepted, documented)

- **Encoding renderings** escape the pattern guard: base64, split strings, zero-width characters (R78/R79). The release scrub's human pass covers them.
- **`String(destA) === String(destB)`** is true for different destinations (R79 F-7). No call site compares that way.
- **The esbuild single-file bundle of the e2e folds deadlocks** on the envelope's top-level await plus the `api` ↔ `adapters` cycle (R81). The folds run under Playwright.
- **The `--legacy-unattested` flag** forgives fabricated receipts on the three frozen pre-R42 dirs it is used on. It is never used on new documents (R78).
