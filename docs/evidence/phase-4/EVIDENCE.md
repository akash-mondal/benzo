# Phase 4 evidence

Final run: `BNZ_EVIDENCE_DIR=docs/evidence/phase-4 npm run e2e:live` at commit `78650f9ccd8d1a63fcc376698e79b8ce9600dc22`, window 2026-10-02T09:16:30.452Z–2026-10-02T10:02:10.909Z, exit 0, all 12 IDs PASS (`run.json`, `cli/`). The code equals R8 commit `2818af3c2816083c96531160e6ddba1ab3c532c5` (R26.5): `git diff 2818af3 HEAD -- . ':!docs'` was empty at run time (`tmp/e2e/takeover-regression4-samecode.txt`, 0 bytes). This run supersedes the e8dc402 evidence recorded in 3f60e54, which predates the R6 expiry-364 default and is preserved in git history. Artifact commit `091e927`.

## Gates

| Gate | Evidence |
|---|---|
| O operator lifecycle | O1, O2 PASS (published `result` and `freeze_root` match the pure clear) |
| P bidder | P1, P2 PASS (flipped manifest refused, 128-byte sealed bid at C, receipt/verify agreement) |
| Q signers | Q1 PASS (2-of-3 with a third signer offline) |
| R independent verify | R1 PASS; `verify.sh` positive exit 0, corrupted copy exit 1 |
| S read API | S1 PASS (operator blobs + C only; result matches; flipped manifest refused) |
| T R4 carry-overs | T1–T5 PASS (strays settled, no recipient data, expired batch recovery, signer-derived amounts, runtime pair) |

## R8 regression: all five specs at one commit (R26)

| Spec | Result | Record |
|---|---|---|
| default seal-open | PASS 40 s | `tmp/e2e/takeover-regression3-default.log` @ 2818af3 |
| testnet-golden-path | PASS 562 s (B1, D1–D3, A1–A5) | `tmp/e2e/takeover-regression3-live-artifacts/run.json` @ 2818af3 |
| auction-core | PASS 2854 s (E1, E2, F1, F2, G1–G3, H1–H4, I1) | `tmp/e2e/takeover-regression4-live-artifacts/run.json` @ 78650f9 |
| settle-crash | PASS 1726 s (J1, J2, K1, L1, M1, N1) | same run.json |
| cli-auction | PASS 2739 s (12 IDs) | `run.json` here @ 78650f9 |

## Mutations (red runs under docs/evidence/phase-4/mutations/)

U1 red at T1 (`U1-t1.out`, accepted by R24; `U1.out` records the O2 variant), U2 red at S1, U3 red at R1, U4 red at T4, U5 red at T1 (`U5-expiry.out` repeated after the expiry-364 default). Carry-overs: N1 red at E1 (`N1-regression.out`, I1 collateral was the R22/R25 harness issue), P1 red at L1 (`P1-expiry.out` repeated after expiry-364). Patches are the committed `*.patch` files; each run reversed its patch on a clean tree.

## verify.sh

`docs/evidence/phase-4/verify.sh docs/evidence/phase-4` exit 0: OK O/P, T1/T4/accounting, Q/T3/T5, T2/S, R, run (`tmp/e2e/phase4-final-verify-positive.log`). Corrupted copy (`tmp/e2e/phase4-final-corrupt`, +1 zat on one settlement row) exit 1: `ERROR T1/T4/accounting ledger amount differs from independent clearing/chain`, `ERROR run file hash cli/auction.json`, and `benzo verify` independently refuses (`ERROR accounting-strays … amount`) (`tmp/e2e/phase4-final-verify-negative.log`). Original artifacts untouched.

## Decisions

CLI `bin/benzo` over a `cli/benzo.ts` router (R12/R17); SQLite settlement ledger plus private product JSON under `$BNZ_STATE_DIR`; signed canonical public `auction.json` with projections (`schemas/public-auction.schema.json`); API bound 127.0.0.1:8787 (R11/R18), started by `benzo api serve`. Post-R openings and the drand beacon are public by R16. Settlement receipts hold only `{auction_id, party, txid, pool, output_index, amount_zats}` (T2). Measured batch cap 13 with expiry formula `28*n` blocks (364 at cap; R6), short expiry 4 only for the recovery drill; PCZT expiry checked against NU7 height 4465026 before creation and broadcast (R7). Zero auction fees; network fees come from the fee reserve (R2). The fee-reserve guard refuses mismatches (R25: product guard stays; harness calibrates from the notes the refund actually spends).

## Limitations

Testnet and CLI only: no UI, no mainnet. One machine, public endpoints, drand threshold trust. One operator holds all three dealerless FROST shares; per-signer check processes are started by the coordinator on one host and participants auto-confirm. One wallet plays all bidders and the seller. The T5/N1 third-signer drills show the signing pair pinned in operator config at intake with the third member not selected — not a real signer outage (R28 F4 wording). Private pre-pinned routing does not authenticate an encrypted settlement envelope. Zero auction fees; a finite PCZT expiry makes settlement transactions distinguishable on chain. Public verification checks accounting without refund addresses, while `verify.sh` recovers note amounts with local viewing keys. Sample auction: the cli-auction drill (ten admitted bids plus two strays and the seller; 13 monetary outputs at the measured cap 13; one expired batch recovered live). Final balances after the head's 0.1 TAZ transfer to Track B (R27): bidder 84,932,820 zats spendable at tip 4432745, vault 0.
