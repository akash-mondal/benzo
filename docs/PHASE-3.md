# Phase 3: settlement and custody

- **Window:** 2026-10-12 to 2026-10-16 23:59 UTC (start earlier only if Phase 2 is at READY FOR REVIEW).
- **Networks:** Zcash testnet (Ironwood) and drand mainnet quicknet. No mainnet transaction.
- **Ownership:** head agent owns this file. Results and Questions go in `docs/STATUS.md`. Artifacts in `docs/evidence/phase-3/`. Changes only via Rulings (section 10).
- **Master plan:** this is slot 3 of `benzo-master-plan.md`. Do not renumber or cut other phases without the user.

## 1. Goal and finish line

Phase 2 left a sealed auction with a verified `result.json`. This phase moves **money** for that result: batched refunds and payouts, three signers who each check the result, crash-safe ledgers, and the failure drills. UI is Phase 4.

| Gate | Question |
|---|---|
| J | Do multi-output PCZT refund/payout batches move funds correctly (payouts to winners, exact-C refunds to losers / invalid bids)? |
| K | Does each signer independently recompute the result and check every output (recipient, amount, fee) before signing? |
| L | After a crash mid-batch, does resume pay nobody twice (idempotent ledger states)? |
| M | Drand outage / cancel path: everyone gets fixed C back **without** opening bids. |
| N | If one of three signers is offline, does 2-of-3 still complete, and is the offline case recorded? |

| Decision | Options |
|---|---|
| Batch size | pin recipients per tx (default 50; measure and record) |
| Ledger states | pin the idempotent state machine (seen → confirmed → eligible → allocated → paid/refunded/exception) |
| Receipt format | pin the private settlement receipt fields |

**Finish line:** all gates READY FOR REVIEW or FAILED/BLOCKED with evidence and a one-command repro; one `BNZ_EVIDENCE_DIR=docs/evidence/phase-3 npm run e2e:live` at a recorded commit; `verify.sh` exit 0 and seen failing on a corrupted copy; crash-recovery test seen failing under its mutations; three decisions in STATUS + `EVIDENCE.md`; STATUS READY FOR REVIEW.

## 2. Inherit

AGENTS.md test rules, pins, traps 1–11 from Phase 1, Phase 2 manifest/freeze/clearing. Read DESIGN §6 (custody and settlement) and §14 (limits). Re-use `create-max` / `pczt prove` / `zcash-sign` / `frost-client` session order from Phase 1 PR #593 path; extend to **multi-output** batches.

## 3. Product rules

- Settlement is a pure function of `result.json` + the frozen set + the chain state of deposits. No operator discretion.
- Refund amount for losers / invalid / cancelled is **exact C** (fees from a fee-reserve note, per Phase 2 R2).
- Winners pay from their escrowed C toward the clearing price; leftover returns in shielded ZEC (document the exact zatoshi rounding in the pinned clearing spec).
- Each signer session signs only after locally checking `result.json` against the frozen root and the opened ciphertexts (same clear CLI as Phase 2).
- One signature per randomizer (Phase 1 trap 7). Keep raw PCZTs only under `$BNZ_STATE_DIR`.
- Private settlement receipt: enough for a bidder to confirm in their own wallet (txid, output index or note commitment reference, amount, auction id). No bid plaintext in the receipt.

## 4. Failure drills (must run on the real stack)

1. **Crash mid-payout:** kill the worker after some outputs are allocated; resume; assert no output is paid twice; final balances match `result.json` exactly.
2. **Drand down / cancel:** refuse to open; refund fixed C to all deposits; zero `tle -d` on that path.
3. **Signer offline:** run with only 2 of 3 participants available; 2-of-3 completes; STATUS records the limitation (already assumed in DESIGN §1).

## 5. Layout

```
settle/           batch worker + idempotent ledger (sqlite under $BNZ_STATE_DIR, not in git)
e2e/              + e2e/settle-crash.spec.ts  (the one new test this phase)
docs/evidence/phase-3/
```

Do not build a signer console or UI (Phase 4). Do not build mode B (Phase 5).

Budget: +600 lines hand-written beyond Phase 2. Justify overage under Questions.

## 6. Out of scope

- Screens, hosting, WebZjs, consumer wallets.
- Mainnet, own nodes, mode B, NEAR, marketplace adapters.
- More than the tests in section 7.

## 7. Tests this phase adds: exactly one

Project ceiling 8 E2E total. Phase 1 used 2, Phase 2 uses 1, this phase adds **1** (crash recovery). Two reserved for Phase 4 and contingency.

**4. `e2e/settle-crash.spec.ts`** (live; ~30–40 minutes). Owns **J, L, M, N** (K is checked in setup/tooling and the signer step logs; assert K1 on the recorded sign-off payloads).

- **J1** Batch pays every winner and refunds every loser/invalid at the pinned amounts; Σin = Σpayout + Σrefund + fees (from `pczt inspect` + balances).
- **J2** Receipts exist for each settled party and contain no bid plaintext.
- **K1** Each coordinator log shows a local result check before `frost-client`; signer pubkeys and one signature per randomizer.
- **L1** Crash after k outputs allocated; resume; ledger has no duplicate paid state; final totals equal J1.
- **M1** Cancel/drill path refunds C with zero `tle -d` invocations.
- **N1** Session succeeds with 2 of 3 participants; offline signer named in STATUS/evidence.

Mutations:
- **P1** Ledger marks paid before broadcast (L1 fails on crash-resume double-pay).
- **P2** Batch skips amount check against `result.json` (J1 fails).
- **P3** Cancel path decrypts first (M1 fails).

## 8. Decisions

Record batch size, ledger states, receipt fields with evidence (tx counts, crash log, receipt samples without secrets).

## 9. Evidence

Same rules as Phase 1 §10 / Phase 2 §9. `verify.sh` re-checks batch txids on both endpoints, balances vs `result.json`, signature presence, ledger summary hashes, `run.json` hashes. Negative check: corrupt one amount in the settle summary → `ERROR J` / `ERROR L`. Keep evidence dir &lt; 1 MB.

## 10. Rulings

Head agent only, `head@benzo.invalid`, newest last.

- R1 2026-10-01: Phase 3 work may start only after Phase 2 is at READY FOR REVIEW (evidence + verify.sh done). Do not claim Phase 2 PASSED (head does that). Overnight: finish Phase 2 first, then implement Phase 3 without waiting if Phase 2’s finish line is met.
