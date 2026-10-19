# Phase 7 batch B49: "paid" means this host approved it and sees it mined (Reviewer R round 2: P0-1, P1-1, P2s)

Head design, 2026-10-19. Source: `benzo-sol/reports/pr-p7-b44-b46.md` (REQUEST CHANGES). B44 is confirmed closed.

## The findings

- **P0-1 (B46):** the reserve-return gate (`settle/deposits.ts` `reserveReturnOutstanding`, used by `cli/host-derive.ts` `deriveReserveReturn`) treats a **packet** receipt as paid. It checks neither attestation nor chain. On a cancelled auction, `deriveRows` runs no `benzo verify` (`cli/host-derive.ts:81-84`) and `loadPublicAuction` does no settlement validation (`api/public-auction.ts:206`). A coordinator can therefore fabricate a receipt for every unclaimed stray, and the hosts then approve a return that sweeps the strays' value to the return address. On a cleared auction, receipts of a batch that was attested but never broadcast do the same, and `benzo verify` passes that variant.
- **P1-1 (B45):** the classify prefetch (`cli/host-derive.ts:164`) throws when a third-party envelope or claim decrypts to a refund string that is empty or contains NUL or a newline. That freezes `sign build/approve/derivable` on every host.
- **P2-a:** the approval ledger keys sources in two namespaces (`deposit:txid:pool:idx` and `txid:pool:idx`), so a reserve-return batch never collision-checks against ordinary batches.
- **P2-b:** a refund whose transaction is reorged out keeps its stale receipt, so the gate can treat value that is owed again as paid.

## Design

1. **One rule for "paid", from the host's own data.** For every gate that needs "this row is paid" (the reserve-return gate today; any later one too), a published receipt counts **only if**:
   - the receipt's txid is in **this host's approval ledger** (`approvals/<id>/…`; the host approved a candidate with that txid and that row among its mapped outputs at that amount); **and**
   - **this host's own vault scan** shows that txid mined (a vault note with `spent_in_txid = txid` and a height), at or below its own tip and at least 10 confirmations deep.

   Packet receipts are only an index; they are never trusted on their own. A row without such a receipt is outstanding. This closes P0-1 for cleared and cancelled auctions alike, and closes P2-b: a reorged-out transaction is no longer mined, so its row is owed again.
2. **The plan uses the same rule** with the coordinator's own ledger and scan, so the plan and the hosts agree. Put the predicate in one shared function (for example `settle/deposits.ts` `paidByOwnLedger(receipts, ownLedger, ownScan, tip)`) used by both.
3. **Verify** cannot see a ledger. Leave its rule as it is and **disclose**: `benzo verify` checks receipt attestation, not on-chain inclusion; inclusion is checked by the hosts before any reserve return. If the published doc already carries the batch txids and their heights, verify should at least require every receipt's txid to be one of the published batch txids with a height. Add that if it is cheap, and say what you did.
4. **P1-1: the prefetch never throws.** Pass only candidate strings that are non-empty with no control characters, and catch any classifier error inside the prefetch (it is an optimization). The per-row path then classifies or refuses that one row exactly as before (`openDestination`'s null contract), so verdicts are unchanged. Add the reviewer's two crafted envelopes (empty refund; NUL and newline) as fixtures: each must yield its row as underivable or refused and the batch must proceed.
5. **P2-a: one namespace.** Normalize every approval-ledger source to one canonical note identity (pick `txid:pool:index` or `deposit:…`, then migrate on read), so reserve-return sources collide-check against ordinary batch sources. Prove a candidate that re-spends a note already spent in another approved candidate is refused across the two kinds.

## Proof (offline)

Extend `tools/repro/b46-reserve-return.ts` and `tools/repro/b47-settle-e2e.ts`. Red on base `5535b74`, green after:
- (a) a cancelled auction with unclaimed strays, plus fabricated receipts in the packet: the hosts refuse the return;
- (b) a cleared auction, plus receipts of an approved but never-broadcast batch: refused;
- (c) a receipt whose transaction was mined and then reorged out (stub chain): the row is outstanding again, and the return is refused;
- (d) honest: approved, mined and 10 deep, so the return proceeds, with every b47 case still green;
- (e) the two crafted envelopes do not crash the prefetch;
- (f) a cross-kind re-spend is refused.

Also: `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, plus the b44, b45, b46, b47, h10, h13 and h14 folds.

## Rules

- Work only in your own worktree: `git worktree add ../benzo-b49 -b b49-paid-mined <HEAD>`.
- Offline only (stubs). Do not override the git identity. Commit `--no-verify` (R32). Commit early.
- No mid-line `//` after code.
- B48 is editing `cli/host-derive.ts` sellerBinding, `cli/commands/seller.ts` and `cli/commands/verify.ts` in parallel. Keep your `host-derive.ts` edits to the prefetch and the reserve gate, and your `verify.ts` edits minimal.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
