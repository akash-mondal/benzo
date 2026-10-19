# Phase 7 batch B50: the remaining verify/settle P2s (H1, H3, H5, H6, H7) and H21

Head design, 2026-10-19. Rows: `docs/design/phase7-hardening.md`. Each item is small and independent. Give each one its own commit and its own red/green case. **H2 is not in this batch:** after H3 puts the one-pool rule on every build path, no batch can pay two pools, so H2's pool-less `{party, output_index}` attribution is never ambiguous. Disclose that in H2's row and close it as "mitigated by H3".

1. **H1: receipt-attestation requires the two maps to agree fully.** `api/public-auction.ts` receipt-attestation checks two pinned witnesses on a receipt's txid and outputs, but not that the two maps agree on batch, defaults, balance_refunds, strays and bond fields. Use `mapPairAgrees` (`witness/index.ts`), as the other checks do. Proof: two maps that agree on txid and outputs but differ in `strays` (or `defaults`) are refused. Honest published dirs still verify.
2. **H3: one pool per batch on every build path, as a typed set-aside.** Today only the local build refuses a batch that pays more than one pool (`settle/cli.ts`), and that refusal is untyped, so it wedges the batch. Apply the same rule in custody `hostBuild` (`settle/cli.ts`), `sign build` and `sign approve`, as an R46-style typed set-aside: exit 3 with the named rows, and the rows wait in the exception queue with the reason. Proof: a candidate paying two pools is refused typed on each path, and the batch's other rows still pay (`tools/repro/b47-settle-e2e.ts` stubs can drive the worker).
3. **H5: exact shapes for batch `proofs`, `inspect` and `signing`** in `api/public-auction.ts`. Derive each shape from what the worker actually writes (read `settle/cli.ts`). Refuse unknown keys and wrong types. Proof: an extra key, or a blob in place of a field, is refused. Every committed published dir still verifies; list them.
4. **H6: the receipt exact-key check moves into receipt-attestation**, so it also runs on result-less (cancelled) settlements (`api/public-auction.ts`). Proof: a cancelled fixture whose receipt carries an extra key is refused. Honest cancelled dirs still verify.
5. **H7: a bond auction whose every batch is set aside publishes a no-payment settlement** that carries the set-aside reasons (`cli/product.ts:90`, `pick === null`), instead of not publishing at all. Verify accepts it (no receipts, the exception rows listed). Proof: a fixture where every batch is set aside publishes, and verify accepts it.
6. **H21: `sign derivable` lists refund rows when the seller binding mismatches** and tags only the seller row as refused (typed). `sign approve` gives the typed `["seller"]` refusal (exit 3) for a mis-shaped seller output. Proof: extend `tools/repro/b48-p3s.ts`. A mismatched `seller_ua` on a cleared auction lists and pays refunds while the seller row waits, and a mis-shaped seller output in approve is refused typed.

Also: update the H1–H7 and H21 rows in `phase7-hardening.md` to say closed, by which commit, and close H2 as mitigated. If any verify-shape change touches old evidence, it must keep verifying. Folds that replay old dirs (r78, r82, r77, r81, r73) must stay green.

## Rules

- Work only in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b50 -b b50-p2-sweep <HEAD>`.
- Offline only (stubs as in b47). Do not override the git identity. Commit `--no-verify` (R32); if the verify bundle changes, rebuild it, commit it with its sha file, and say so. Commit after each item.
- No mid-line `//` after code in scripted edits.
- Run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, and the b44, b46, b47, b48, h10, h13 and h14 folds.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
