# Phase 7 batch B54: the sweep spends what the wallet can spend (Reviewer R round 5: P2-1 dust; P3-1 to P3-6)

Head design, 2026-10-19. Source: `benzo-sol/reports/pr-p7-b52-b53.md` (REQUEST CHANGES; no P0 or P1). Base: main HEAD at the time you start.

1. **P2-1: dust.** The pinned wallet never selects a note of 5,000 zats or less: `zcash_client_sqlite` `select_unspent_notes` uses `rn.value > MARGINAL_FEE`, and every selection path, `quote-sweep` included, shares that rule. `reserveUnspent` (`settle/deposits.ts:142`) counts every positive note, so one dust note walls the custody return forever and is stranded silently on the non-custody path.
   - Add one shared rule, `walletSpendable(note) = value_zats > 5000` (name the constant after ZIP-317 `MARGINAL_FEE` and cite the crate lines). The swept total used by the plan, `deriveReserveReturn`, `reserveCandidateVerdict` and the hosts is the sum of spendable notes only.
   - Unspendable residue (count and zats) is reported as `dust_notes` and `dust_zats` in the published `reserve_return` accounting.
   - Verify shape-checks the residue and keeps `remaining_zats === inspect.input_zats`. Disclose the residue in the operator guide and README honest-limits: dust of at most 5,000 zats per note stays in the vault.
   - Check the owed side too. A stray or late balance whose note is dust must not keep the return waiting forever. Read how strays of 5,000 zats or less are refunded today (the reviewer's probe says from other notes), and state the rule in the code.
   - Make the stub `quote-sweep` and `create` in `tools/repro/h-fixtures.ts` (and the b47 worlds) apply the same selection rule.

   Proof: the reviewer's world (probe D1–D5 in `/tmp/r5-probe` if it is still there). A refunded 4,000-zat stray leaves a dust note. On base, custody parks the return forever and non-custody strands the dust silently. After the fix, both complete, the residue is published, and verify accepts.
2. **P3-2: the non-custody `check()`** (`settle/cli.ts:97-117`) runs `reserveCandidateVerdict` when the batch carries the return row. Proof: a change-carrying candidate is refused before signing on the non-custody path.
3. **P3-1: the H23 branch expires a mixed batch only when it has no staged txid.** A staged mixed batch goes through the normal broadcast, mined-wait and confirm. Its rows are one pool, so confirm attributes them; if confirm cannot, the batch is parked. Proof: the reviewer's C2/C3 state no longer releases the rows.
4. **P3-3: the sweep must fit what `create` can build.** `quote-sweep` refuses when the sweep's spends or actions exceed `create`'s 29 bound, with a typed reason. The plan prints the waits line with that reason. Record H25 in `phase7-hardening.md` as a disclosed limit: a vault with more than 28 spendable notes cannot return its reserve in one transaction. Add one line to the operator guide. Do not build a multi-step sweep in this batch.
5. **P3-4: `backfillMapped` must heal from what the host approved, not what it derives today.**
   - From now on, `sign approve` stores the attested `{party, output_index, amount_zats}` next to the signed map as a local record.
   - `backfillMapped` heals only from stored amounts (the stored record, or the host's own stored candidate inspect if one exists), with the derived amount as a cross-check that must match.
   - With no stored amounts, it fails closed: no heal. Say in the H-row that pre-B49 test state may therefore stay unhealed, and that mainnet starts fresh.

   Proof: the reviewer's B4/B5. A drifted derivation never counts in either direction.
6. **P3-6: `minedHeight`** (`cli/host-chain.ts:27-30`) cross-checks a second endpoint, as `blockHeader` does, unless `BNZ_LWD_SINGLE=1`. Endpoints that disagree mean no height, which fails closed.

## Rules

- Work only in your own worktree: `git worktree add ../benzo-b54 -b b54-dust-sweep <main HEAD>`. Copy `vendor/` with `cp -R ../benzo/vendor .`; do not symlink it. Never `git add` `node_modules` or `vendor`, and before each commit `git diff --cached --summary | grep 120000` must print nothing.
- Offline only (stubs). Do not override the git identity. Commit `--no-verify` (R32). If the verify bundle changes, rebuild it and commit it with its sha file. `cargo build --release --locked` in `settle/` if you touch Rust. Commit after each item.
- No mid-line `//` after code.
- Build `tmp/b47-republish.mjs` before the b47 fold (R118). Run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, the b44, b46, b47, b48, h10, h13, h14 and b53 folds, and the r77, r78 and r82 replays.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
