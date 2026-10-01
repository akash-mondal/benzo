# Phase 3 evidence: READY FOR REVIEW

Contract: PHASE-3 R1–R8 (latest head commit dc28c08). Head approval is pending; no frontend work.

`BNZ_EVIDENCE_DIR=docs/evidence/phase-3 npm run e2e:live` exited 0 at `742feb997a0fa3ab7aecab959e9170afb1493907`; 2026-10-01T12:14:36.124Z–2026-10-01T12:43:57.863Z (1761 seconds). J1/J2/K1/L1/M1/N1 all PASS. Generated artifacts were committed separately at `7951dd7d45f5dd4813f35df8c1f31fe482b76bc3`. Full output: `tmp/e2e/phase3-final-evidence-v2.log`.

| Gate | Recorded evidence |
|---|---|
| J | `settle/main/result.json`, `balances.json`, `summary.json`: five recipients, exact clearing amounts, 2,030,000 input = 2,000,000 refunds/payout + 30,000 network fee; both endpoint proofs agree. |
| K | Both summaries: independent Alice/Bob check payloads before each FROST participant; fresh Go tle openings and clearing, pinned recipients/amounts/fee, local v6 digest equals coordinator digest. Main: ten checks for five randomizers; cancel: six checks for three. |
| L | `settle/main/crash.json`: SIGKILL after 5 allocations; resumed batch has four refunded rows and one paid row, five unique receipts, exact final total. |
| M | `settle/cancel/outage.json`, `summary.json`: ECONNREFUSED, zero opening calls, worker exit 0; two exact 500,000-zat refunds. 1,015,000 input = 1,000,000 refunds + 15,000 reserve fee; vault empty. |
| N | Both summaries/signing sessions: Alice and Bob sign, Carol offline. Actual 2-of-3 RedPallas FROST; inherited dealerless group, no single-key replacement. |

Mined main batch: `cb7e3b2828f8133480ebd733f27c3853f632674b52acedba45695b257d9aba09` at 4428068. Mined cancel batch: `17049334fdf149bc0a303d7bdb10936c1b85818a40fbc70406d69d0ad30a9f12` at 4428087. Proofs from both configured lightwalletd endpoints and actual signature bytes are checked by the verifier.

## Verification

`docs/evidence/phase-3/verify.sh docs/evidence/phase-3` exited 0: OK clearing, J, L, K/N, M/J2, run. Log: `tmp/e2e/phase3-final-verify-positive.log`.

Copied evidence to `tmp/e2e/phase3-final-corrupt`, added one zat to the first main ledger amount, then ran `docs/evidence/phase-3/verify.sh tmp/e2e/phase3-final-corrupt`. Exit 1: `ERROR J ledger amount differs from result`, `ERROR L final ledger amount differs from result`, and summary file-hash rejection. Log: `tmp/e2e/phase3-final-verify-negative.log`. Original artifacts were untouched.

## Decisions and measured limits

- Batch cap: 50 recipients. Measured five main recipients (six Ironwood actions, fee 30,000) and two cancel recipients (three actions, fee 15,000). Fifty-recipient scale is not demonstrated.
- Ledger: seen → confirmed → eligible → allocated → paid/refunded after mining. Allocation/confirmation are SQLite transactions. Signed PCZT file/hash and stable native txid are staged and fsynced before broadcast; the pinned devtool stores raw tx bytes in its wallet before sending. The crash drill is after five allocations, before broadcast; post-broadcast crash injection is not demonstrated. No exception-state drill.
- Private receipt: auction_id, party, txid, pool, output_index, amount_zats. Actual sample (no destination or bid plaintext): `{"amount_zats":"499890","auction_id":"cdf47e066c05c699942a6ee382b8ad7f9ab80de0148466b8ca38156d231ade9d","output_index":0,"party":"leaf:0","pool":"ironwood","txid":"cb7e3b2828f8133480ebd733f27c3853f632674b52acedba45695b257d9aba09"}`.
- Integer zatoshis: winner refund C minus clearing payment; loser/invalid/cancel exact C. Separate reserve notes pay network fees. Auction fee is zero in these drills; nonzero auction-fee settlement is not demonstrated (R2).
- PCZT lifetime: explicit proposal target + 200 blocks through the unchanged pinned SDK API; expiry and NU7 broadcast refusal remain. The first clean attempt safely refused an expired PCZT after the chain advanced 60 blocks during signing, beyond the SDK default 40. Failed artifacts/log are preserved in `tmp/e2e/phase3-final-failed-expiry-artifacts/` and `phase3-final-evidence.log`; recovery mined. Repair commit 311f1d2 builds/typechecks, and the same harness passes here. No pin, assertion, test timeout or line-count change (744 accepted by R7).

## Mutations

- P1.patch / P1.out: premature paid state caused missing refunds (0 of 2,000,000 before cleanup), not observed double payment; ERROR L1. Cheapest mutation rerun after expiry repair at 311f1d2, full log `tmp/e2e/phase3-P1-expiry.log`; honest cancel PASS, cleanup mined, patch restored. Original red is retained in commit 1030943.
- P2.patch / P2.out: intentional incorrect-amount sample at the signer amount checker; expected J1 fail; cleanup/recovery only. ERROR J1 on the real faulted proposal, never broadcast; R4/R8 accepted. Full log `tmp/e2e/phase3-P2.log`; guard restored.
- P3.patch / P3.out: one real Go tle opening attempt on cancel against the closed endpoint; no plaintext opening claimed. ERROR M1, zero refund before cleanup; main five IDs PASS, cleanup mined. Full log `tmp/e2e/phase3-P3.log`; guard restored.

Exactly four E2E tests total. Phase 3 adds only settle-crash.spec.ts with J1/J2/K1/L1/M1/N1; audit R retain. No assertions changed. SDK expiry changed after the initial mutations; cheapest P1 was rerun. Production source unchanged since that rerun through final evidence. Other three specs remain Phase 1/2 regression; their covered source did not change in Phase 3.

Limits: one machine, public lightwalletd/drand endpoints, inherited dealerless testnet group. Private destination copies pinned before funding are sufficient under R3; bidder-owned settlement-envelope authentication is not claimed. Claims remain within DESIGN §1/§14. Frontend implementation/styling/hosting UI are user-owned under R6.
