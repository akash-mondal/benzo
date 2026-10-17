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
