# Phase 7 batch B47: settle worker robustness + an offline end-to-end proof (H20, H19)

Head design, 2026-10-19. The settle worker (`settle/cli.ts`) has failed live four times in two days, each in a path no offline test reaches:
- **R99:** a missing createRequire banner;
- **R107:** the reserve gate refused ordinary batches;
- **R107b:** the gate counted the return itself as outstanding;
- **R108:** a mempool resend exited 1, and a re-run after the return refused to republish.

Each time the plan, host and verify functions were green offline. This batch closes the two open gaps and adds the missing test layer.

## 1. Fixes

1. **Broadcast idempotence (H20 item 1).** When the broadcast fails with `transaction already exists in mempool`, or the txid is already mined (the worker can check its own staged txid against chain or wallet), treat the batch as broadcast and continue to the mined-wait. That covers both the resend after a lost response and a resend on a re-run. Any other send error stays an error.
2. **Re-run after the return (H20 item 2).** Once a `reserve-return` receipt exists, `benzo settle` must republish idempotently. Keep the published `reserve_return` accounting from the ledger or from the already-published doc. Never re-derive it from an emptied vault. A re-run of a fully settled auction (all receipts, return done) exits 0 and changes nothing.
3. **Fee-reserve preflight (H19).** Before the first batch of a run, compare the vault's spendable value with the remaining unpaid obligations plus a fee upper bound of `5,000 × (spendable notes + remaining rows + remaining batches)`. If it is short, stop before any broadcast with `ERROR settle fee reserve short: pay N zats to <fee_reserve_ua> and run benzo settle again`, where N is the exact shortfall plus a 10% margin. Never fail inside a host build for this reason.

## 2. The offline end-to-end proof (new)

Add `tools/repro/b47-settle-e2e.ts`. It runs the **real** `bin/benzo settle --id ID` worker, unmodified product code, against:
- a stub chain: a small local fake lightwalletd, or a stub `zcash-devtool`/`grpcurl` on PATH, that records broadcasts, can answer "already in mempool", and mines on command;
- a stub `orb`/`orbctl` that runs the three host `benzo sign …` commands locally against three per-host state dirs (`tools/repro/b42-hosts-cli.ts` and `tools/repro/h-fixtures.ts` show the fixture machinery);
- a fixture auction with a committed `reserve_return_ua_commitment`.

Required cases, each one `benzo settle` invocation or a sequence, asserting exit codes and the published dir:
- (a) ordinary batches pay every row while the return waits (this catches R107);
- (b) the return is planned after the last batch mines, built, approved, broadcast and recorded (this catches R107b);
- (c) the broadcast answers "already in mempool", and the worker continues and records the receipt (H20 item 1);
- (d) a re-run after the return exits 0 and leaves the published dir byte-identical (H20 item 2);
- (e) an under-funded reserve stops at the preflight with the exact top-up line and broadcasts nothing; after the stub is topped up, it completes (H19);
- (f) a legacy manifest settles with no return and its one WARN line.

If running the real worker against stubs needs a small, test-only seam (for example an env var for the tool paths that already exists in `settle/io.ts`), use only seams that already exist. Otherwise add one, named `BNZ_TEST_*`, refused when `BNZ_NETWORK=main`, and list it.

## 3. Rules

- Work only in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b47 -b b47-settle-worker <HEAD>`.
- Offline only: no main `.benzo/`, `.env`, real OrbStack/`orb`, testnet or wallets. Stubs only.
- Do not override the git identity. Commit `--no-verify` (R32). Commit early.
- Plain English comments; no mid-line `//` after code in scripted edits.
- Run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, and the b46 / h10 / h13 / h14 / b44 folds.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
