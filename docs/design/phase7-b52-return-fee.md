# Phase 7 batch B52: the reserve return uses the tool's own fee, not a prediction (Reviewer R round 4, P2-1, H23, P3-4, P3-8c)

Head design, 2026-10-19. Source: `benzo-sol/reports/pr-p7-b49-b51.md` (REQUEST CHANGES; no P0 or P1).

## The finding

`reserveReturnFee(k) = 5000·max(2, k)` (`settle/deposits.ts:146`) predicts the return's fee from the number of source notes. Two things decide the real fee:
- the wallet's ZIP-317 proposal in `benzo-pczt create` (`settle/src/main.rs:21-40`, `propose_transfer` with `StandardFeeRule::Zip317` and a change strategy);
- `inspect`'s check `fee == 5000·max(2, orchard actions + ironwood actions)` (`main.rs:160`).

When the return's output lands in a pool that holds none of the sources, the action count is higher than k. For example, 3 Orchard sources and an Ironwood output give an enforced fee of 20,000 against a planned 15,000. Every host's build then dies untyped, and `benzo settle` exits 1 at the return on every re-run.

When the prediction is too high, the wallet adds a change output instead. Value is then left behind, and the kept accounting throws after broadcast. B51's verify tie (`fee = reserveReturnFee(inputs.length)`) locks in the wrong basis.

## Design: stop predicting the fee

1. **The tool quotes the sweep.** Add `benzo-pczt quote-sweep --wallet W --to UA`.
   - It asks the same wallet and change strategy as `create` for the largest payment to UA that spends every spendable note with no change output. Use librustzcash's send-max proposal if the pinned `zcash_client_backend` has it. Otherwise loop `propose_transfer` from `total − 5000·max(2, n)` upward or downward until the proposal has no change output and spends every note. Bound the loop and say which method you used.
   - It prints `{amount_zats, fee_zats, input_zats, spends, actions}`.
   - The plan (`settle/plan.ts`) sets the return row's amount from this quote, not from `reserveReturnAmount`.
   - When there is no quote (insufficient value, or a note the tool cannot spend), the row is not planned. Print the typed waits line with the true reason, for example `reserve return waits: the vault's value cannot be swept in one transaction (<tool error>)`. Never crash the run.
2. **The hosts check the built transaction, not a formula.** The host runs `inspect` itself, and `inspect` already refuses a fee that differs from ZIP-317 for the real action count. In `cli/host-derive.ts` `deriveReserveReturn`, `sign build` and `sign approve`, the return candidate must have:
   - `input_zats` = this host's scanned unspent total (kept);
   - exactly one output, not change, to the committed return UA;
   - output amount = `input_zats − fee_zats`, using `inspect`'s figures.

   Drop the `total − reserveReturnFee(k)` equality, and remove `reserveReturnFee` and `reserveReturnAmount` wherever they become unused. The host's declared amount check becomes "the declared row amount equals the candidate's single output, which equals input − fee". Anything else is a typed refusal (exit 3, named row), never an untyped crash.
3. **Sapling.** Find out whether any vault address (deposit, fee-reserve, balance, change) can receive Sapling. Read how the UAs are derived.
   - If none can, state that in a comment next to the plan's source rule and in H15's row.
   - If one can, a Sapling note makes the quote fail. That gives the typed waits line, plus a disclosure line in the operator guide.
4. **Verify** (`api/public-auction.ts`, the `reserve_return` tie from B51):
   - `fee_zats === 5000·max(2, paying.inspect.actions)`;
   - `remaining_zats === paying.inspect.input_zats`;
   - the receipt amount `=== input_zats − fee_zats`;
   - `paying.inspect.inputs.length ≤ actions`.

   Remove the `inputs.length` fee equality. Every committed published dir must still verify (the H15 live dir especially); list them.
5. **H23: the return's own-batch rule must not crash.** `settle/cli.ts:391` throws after `ledger.allocate` has committed a mixed batch. Check before allocating, so the plan never allocates the return with other rows. For a pending mixed batch already in the ledger, mark it `exception` with the reason `reserve-return mixed with rows (H23)`, and let the rows re-plan. Close H23.
6. **P3-4:** `hostDerivable` (`settle/cli.ts:149-154`) must also read `sign derivable`'s top-level `refused_rows`, so the reserve row parks with the true reason, not "claimable through benzo claim-refund".
7. **P3-8c:** the stub `inspect` in `tools/repro/h-fixtures.ts`, `b47-world.ts` and `b47-settle-e2e.ts` reports one input per source note, with `actions` computed the real way (per pool, max(spends, outputs), with each bundle padded to at least 2). Add a stub `quote-sweep` that follows the same rule.

## Proof (offline)

Extend `tools/repro/b46-reserve-return.ts` and `b47-settle-e2e.ts`. Each case must be red on base `e4efc29` and green after:
- (a) the reviewer's cross-pool vault (3 Orchard sources, Ironwood return UA): the plan quotes 20,000, the hosts approve, `benzo settle` completes, verify accepts;
- (b) a wallet proposal that would add change: refused typed before signing;
- (c) a vault the tool cannot sweep: the typed waits line, exit 0, nothing broadcast;
- (d) a doctored published `fee_zats` or `remaining_zats`: verify refuses;
- (e) a pending mixed return batch: set aside as an exception, rows re-plan, exit 0.

If the real `benzo-pczt` can run `quote-sweep` offline against a fixture wallet (see `needRealPczt` in `h-fixtures.ts`), add one real-tool case. If it cannot, say so.

Also run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, `cargo build --release` in `settle/`, and the b44, b46, b47, b48, h10, h13 and h14 folds, plus the r77, r78 and r82 replays.

## Rules

- Work only in your own worktree: `git worktree add ../benzo-b52 -b b52-return-fee ca3220b`. Copy `vendor/` from the main checkout. Do not symlink it. Never `git add` `node_modules` or `vendor`.
- Offline only. Do not override the git identity. Commit `--no-verify` (R32). If the verify bundle changes, rebuild it and commit it with its sha file. Commit after each item.
- B53 is editing in parallel: the `settle/cli.ts` confirm and broadcast code (about :480-560), `settle/deposits.ts` `paidByOwnLedger`'s callers, `cli/commands/sign-approve.ts` around the ledger write (:160-215), and `witness/index.ts`. Keep your edits away from those regions.
- No mid-line `//` after code.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
