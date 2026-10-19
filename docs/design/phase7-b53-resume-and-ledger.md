# Phase 7 batch B53: resume, re-send and ledger gaps (Reviewer R round 4, P2-2, P3-1, P3-2, P3-3, P3-5, P3-6, P3-7, P3-8a/b)

Head design, 2026-10-19. Source: `benzo-sol/reports/pr-p7-b49-b51.md`. Each item gets its own commit and its own red/green case. Base `e4efc29`.

1. **P2-2: confirm must not attribute receipts by index alone.** Under custody, `settle/cli.ts:543` maps a signed map's pool-less `{party, output_index}` to the mined inspect by index. That wedges or mis-attributes a pending two-pool batch staged before H3. Resolve each mapped row by `(output_index, amount_zats)`, which must match exactly one non-change output.
   - If it is ambiguous or missing, mark the batch `exception` with the reason `manual reconciliation: pre-H3 two-pool batch (H2)`. Do not throw inside the loop. The run continues and exits 0.
   - Update H2's row: mitigated by H3 for new batches, and by this rule for resumed ones.

   Proof: the reviewer's probe world (a pending two-pool batch, already mined), with colliding indexes and different amounts, and with equal amounts. On base it throws, or attributes the wrong pool. After the fix, both cases are attributed correctly or parked as an exception, and a re-run exits 0.
2. **P3-3: the custody re-send.** Under custody the worker sends with `send-without-storing`, so the wallet never knows the transaction, and B51's catch (`settle/cli.ts:497-508`) crash-loops on a true "already exists in mempool".
   - When the error matches that phrase and the wallet does not know the txid, enter the bounded mined-wait for the staged txid. That is the design's "or the next mined-wait finds it" leg.
   - The wait is fail-safe: if it times out, exit with a clear error. A later run retries; nothing is recorded.
   - Every other send error stays an immediate error.

   Proof: a b47 case where run 1 broadcasts and dies, and run 2 gets the true phrase from a wallet that does not know the txid. It must reach mined, confirm, and continue.
3. **P3-1: a zero-change paying batch never counts as paid.** `settle/deposits.ts:172` reads the mined height only from a vault note of the paying txid (its change). When the scan has no such note, the callers of `paidByOwnLedger` (`settle/plan.ts`, `cli/host-derive.ts`) use this host's own chain lookup instead (`cli/host-chain.ts` `minedHeight`), with the same rule: at least 10 deep at or below the host's own tip.
   - Keep the predicate pure: pass a `minedHeightOf(txid)` callback.
   - Offline stubs supply it.

   Proof: a zero-change batch 11 deep counts; 9 deep does not; reorged out does not.
4. **P3-2: heal pre-B49 approval entries.**
   - When `sign approve` re-approves a txid that already has a ledger entry with no `mapped` (`cli/commands/sign-approve.ts:212`), merge the new `mapped` into that entry.
   - On read, also fill a missing `mapped` from the stored `approvals/<id>/batch-<n>.json` map, plus this host's own derived row amounts, but only when that map's txid matches.

   Proof: a pre-B49 ledger entry with no `mapped` counts as paid after migration on read, and after a re-approve.
5. **P3-5: `mapPairAgrees` (`witness/index.ts`) also compares `auction_id` and `txid`.** `earliestAgreedBond`'s defaults selection must require that the chosen list is carried by a pair that agrees under `mapPairAgrees`, not just by two witnesses counted per key. Proof: two map versions, each carried by two witnesses, that disagree on outputs. The selection refuses or picks only a fully agreeing pair.
6. **P3-6:** add a comment at `adapters/zilkroad.ts:37` naming the published-receipt requirement (`:40-42`) as the guard that makes H7's unattested zero-receipt defaults safe. Add one line to the H7 row.
7. **P3-7:** `sign approve` adds a `balance-excess` row's backing notes to the candidate's `sources` (from `balanceRefunds`), so a second live candidate that re-spends them is refused. Proof: a cross-candidate re-spend of an excess row's backing note is refused.
8. **P3-8a/b:** the custody H3 set-aside (`settle/cli.ts:406-410`) carries the one-pool reason, the same text as the local build (`:439`). Remove the unused `setAsideRows` import.

## Rules

- Work only in your own worktree: `git worktree add ../benzo-b53 -b b53-resume-ledger ca3220b`. Copy `vendor/` from the main checkout. Do not symlink it. Never `git add` `node_modules` or `vendor`.
- Offline only. Do not override the git identity. Commit `--no-verify` (R32). If the verify bundle changes, rebuild it and commit it with its sha file. Commit after each item.
- B52 is editing in parallel:
  - the reserve-return fee path (`settle/plan.ts` return planning, `cli/host-derive.ts` `deriveReserveReturn`, the return checks in `sign-build`/`sign-approve`);
  - `api/public-auction.ts` `reserve_return`;
  - `settle/cli.ts` around :149-154 and :385-440;
  - the stub `inspect` in `tools/repro/h-fixtures.ts`, `b47-world.ts` and `b47-settle-e2e.ts`.

  Keep your edits away from those regions. Where you must add a stub case, add it in a new function.
- No mid-line `//` after code.
- Run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, and the b44, b46, b47, b48, h10, h13 and h14 folds plus the r77, r78 and r82 replays.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
