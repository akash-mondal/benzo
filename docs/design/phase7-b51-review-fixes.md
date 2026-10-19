# Phase 7 batch B51: Reviewer R on B47/B48: the preflight re-run bug, the reserve-address listing wall, and four P3s

Head design, 2026-10-19. Source: `benzo-sol/reports/pr-p7-b47-b48.md` (REQUEST CHANGES; no P0 or P1). Its P2-1 seller branch is H21, already in B50. **Do not touch the seller branch of `cli/commands/sign-derivable.ts`**: B50 is editing it in parallel. Keep your edit in that file to the reserve-return branch.

1. **P2-2: the H19 preflight double-counts on a re-run** (`settle/cli.ts` preflight). When a batch is staged or broadcast but not yet confirmed, its rows stay in `obligationZats` at full value, while the notes it spends have already left `spendableValue`. The reviewer's probe got `ERROR settle fee reserve short: pay 4400440 zats` for a batch that was already paid. Mirror `settle/plan.ts`'s `owned` rule:
   - rows already in a staged or broadcast batch are not remaining obligations;
   - notes spent by this auction's own staged or broadcast txids are excluded from both sides.

   Prove it with the reviewer's world in `tools/repro/b47-settle-e2e.ts`, a re-run with one batch broadcast but unconfirmed: red on base (refuses, demanding the paid total), green (no refusal, it confirms the batch and continues).
2. **P2-1b: a mismatched `reserve_return_ua` walls `sign derivable`** (`cli/commands/sign-derivable.ts:32`). That contradicts R107's rule. Derivable must list every other row and leave out only the reserve-return row, tagging it as refused in its output if the listing format allows. A packet that **declares** the return row with a mismatched address stays refused (typed, exit 3). Proof: a mismatched return UA on a packet without the row lists the refund rows; with the row, a typed refusal.
3. **P3: the fee bound and the margin.** The preflight's bound under-counts the change re-spends a later batch needs: add one spend per remaining batch. Then pin R109's margin, `shortfall + max(ceil(shortfall/10), 5,000)`, in a b47 case: a 20,000-zat shortfall asks for 25,000.
4. **P3: the broadcast catch must not trust the error string alone.** When the send answers "already exists in mempool", confirm the staged txid itself is known: the wallet's `list-tx` sees it, or the next mined-wait finds it. Otherwise treat the batch as not broadcast and retry. Remove the vacuous txid check the reviewer named.
5. **P3: verify checks `reserve_return` self-consistency** (`api/public-auction.ts`): `remaining_zats − fee_zats = the receipt's amount_zats`, and `fee_zats` has the ZIP-317 shape for the published source count. Drop the kept-doc fallback in `settle/cli.ts` (R109's H20.2 fallback to the already-published doc). Keep only the ledger's own record, so a doc can never feed its own accounting back.
6. **P3: `seller check` without `--signer`** prints one `WARN no trust anchor: pass --signer HEX (the auction's published receipt key) to check who signed this manifest` and still checks the commitment.

Not in this batch, but recorded in `phase7-hardening.md` as P3 rows: the name-based rows-loop skip; the mixed-batch crash wedge (B50's H3 typed one-pool rule should cover it, so note that); the lexical `--openings-cache` pin.

## Rules

- Work only in your own worktree: `git worktree add ../benzo-b51 -b b51-review-fixes <HEAD>` in `/Users/akshmnd/Dev Projects/benzo`.
- Offline only (stubs). Do not override the git identity. Commit `--no-verify` (R32); if the verify bundle changes, rebuild it and commit it with its sha file. Commit after each item.
- No mid-line `//` after code.
- B50 is editing `api/public-auction.ts` (receipt-attestation and batch shapes), `settle/cli.ts` (hostBuild pool rule), `cli/commands/sign-{build,approve,derivable}.ts` (the seller branch and the pool rule) and `cli/product.ts`. Keep your edits narrow and in separate functions where you can.
- Run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, and the b44, b46, b47, b48, h10, h13 and h14 folds.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
