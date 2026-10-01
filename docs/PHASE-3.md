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
- R2 2026-10-01: Q7 fee policy. **Losers, invalid bids and cancellations get exact C.** Network fees come from the separate fee-reserve note (Phase 2 R2). If a nonzero auction fee exists in `result.json`, take it from winner payments or the fee reserve — never from a refund. Zero-fee live drills may continue; when you add a nonzero auction-fee drill, implement that split and show it in J1 accounting.
- R3 2026-10-01: Q5 routing. Pinning private bidder/seller destination copies before funding, and checking PCZT recipients against those copies in K, is **sufficient for Phase 3 evidence**. Do not require the encrypted settlement-envelope / manifest extension now. Do not claim bidder-owned settlement-envelope authentication. DESIGN §14 already scopes that encryption out of the current phase.
- R4 2026-10-01: Q6 mutations. P2 may inject a wrong-amount **real** PCZT at the checker boundary (that is the regression: omitted amount guard). Record it as J1 failing on the faulted proposal. For P1, L1’s final-total equality is the contract: a premature `paid` state that causes missing refunds is FAIL L1 even if it is not a literal double-pay; say which one you observed in the `.out` file. Do not weaken L1 to “no two paid rows” alone.
- R5 2026-10-01: Line budget. Accept ~737 lines (production 481 + spec 153 + verifier 103). The overage is named Phase 3 glue, not new scope. Do not pad further without a new question.
- R6 2026-10-01: **No frontend work by the build agent.** User instruction (2026-10-01, this thread): “i want no work on frontend , that will be manually done by me”. All UI/screens/site styling/hosting UI are user-owned. Build agent does not implement, style, or host frontend. Phase 4 UI slots stay with the user; any later phase that would have added UI must ask for a Ruling and otherwise skip it. Backend, CLI, verifier, and settlement remain build-agent scope.
- R7 2026-10-01: Q8 line count. Accept **744** lines (483 production + 158 spec + 103 verifier). The extra seven lines are the balance-definition fix and local PCZT digest binding already observed in v6. Not a new scope.
- R8 2026-10-01: P2 live run at `tmp/e2e/phase3-P2.log` finished with `ERROR J1` (1706s). Treat that as the recorded J1 failure for the omitted amount guard. Reverse the temporary `settle/cli.ts` change if still dirty, write `P2.out` from that log (label: intentional wrong-amount check at the signer amount checker, not an exploit), then run P3 and the clean final evidence. Stay in this phase; do not wait.
- R9 2026-10-01: **Gate J PASSED.** Clean run `742feb9` (2026-10-01 12:14–12:43 UTC), artifacts `7951dd7`. Main batch `cb7e3b28…d9aba09` at 4428068 pays five recipients; 2,030,000 input = 2,000,000 outputs + 30,000 fee. J2 receipts carry auction_id/party/txid/pool/output_index/amount only.
- R10 2026-10-01: **Gate K PASSED.** Alice/Bob check payloads and local PCZT digest binding recorded before each FROST participant; ten main checks / five randomizers; six cancel checks / three; both endpoint proofs and signature bytes verified.
- R11 2026-10-01: **Gate L PASSED.** SIGKILL after five allocations; resume completes four refunds + one payout; five unique receipts; final totals equal result.json. P1 observed missing refunds (not literal double-pay) and still fails L1 final-total equality. Post-broadcast crash injection is out of this run’s claim (recorded in EVIDENCE limits).
- R12 2026-10-01: **Gate M PASSED.** Cancel/outage `17049334…30a9f12` at 4428087: ECONNREFUSED, `opening_calls` 0, exact 500,000-zat refunds, vault empty. P3 red at M1 on the one real opening attempt.
- R13 2026-10-01: **Gate N PASSED.** Alice + Bob 2-of-3 RedPallas FROST; Carol offline; inherited dealerless group retained.
- R14 2026-10-01: **Phase 3 complete.** Head re-ran `verify.sh`: exit 0 (clearing, J, L, K/N, M/J2, run hashes). Corrupted-copy negative check failed J/L as required. Decisions stand: **batch cap 50**, ledger **seen → confirmed → eligible → allocated → paid/refunded**, receipt fields as in EVIDENCE.md. Limits remain accurate (5-recipient sample, pre-broadcast crash only, zero auction fee, one machine, public endpoints). Finite PCZT expiry target+200 (`311f1d2`) is accepted as a harness repair, not a scope change.
