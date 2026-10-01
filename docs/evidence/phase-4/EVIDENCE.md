# Phase 4 evidence — IN PROGRESS

No gate-evidence run yet. Track B’s R16/R18/R20 follow-up, mutation red runs, five-spec regression and positive/corrupt verifier checks remain pending.

| Item | Current observation |
|---|---|
| O/P/Q/T | Development 6a3f9e7, 2026-10-01 17:07:19–17:52:08 UTC: O1/O2/P1/Q1/T1–T5 PASS; P2 FAIL because B commands reject R20 flags |
| R | R1 FAIL, usage exit 2; B follow-up required |
| S | S1 PASS in development; final merged evidence pending |
| Verifier/mutations/regression | Pending |

Development command: `npm run e2e:live`; log `tmp/e2e/phase4-cli-development-v5.log`; generated artifacts `tmp/e2e/phase4-cli-development-v5-artifacts/`. These are development observations, not gate evidence.

R6 sample: ten admitted bids plus two strays and seller; 13 monetary outputs, 11 distinct destinations, 14 actions, 70,000-zat network fee. Bob+Carol signed; Alice did not join. Replacement 771b775acf7d5932ed77a6713f9b0d88c5c65f91bf60b181d76e93782c189996 mined at 4429234, checked on both endpoints. Normal signing: 13 randomizers, 484,697 ms total, 40,705 ms worst, seven blocks from proposal target to mining. Including deliberate expiry/suspension: 1,115,133 ms signing, 174,032 ms worst randomizer, 23 blocks. Per-randomizer values are in generated `cli/drill.json`. Carol paused at 4429211 before expiry 4429215 and resumed at 4429216; first batch became exception and all 13 obligations re-planned without duplicate receipts.

Expiry decision: retain the faster historical Phase 3 observation (60 blocks for five outputs, recorded under STATUS’s 2026-10-01 11:41 failure), alongside this sample. Let `b = max(ceil(60/5), ceil(174032*23/1115133)) = 12` observed blocks per recipient. Pin `expiry_blocks(n) = 2*n*b = 24*n`; at measured cap 13, normal expiry is **312 blocks**, at least 2× the observed worst bound. Cap **13** is the largest measured size. Short expiry 4 remains an ordinary operator-config value used for the live recovery drill. This is a one-host sample; the formula is an observed bound, not a network latency guarantee. Actual PCZT expiry is checked against the published NU7 height 4465026 before creation acceptance and broadcast.

Decisions: CLI `bin/benzo`; SQLite settlement ledger plus private auction/product JSON under BNZ_STATE_DIR; signed canonical public `auction.json` and projections; API local bind 127.0.0.1:8787. After R, public openings/beacon are permitted by R16. Public receipts contain only auction_id, party, txid, pool, output_index and amount_zats. Sign inspectors derive fresh Go-tle openings and clearing amounts using pinned private routing; joins bind their prior approval to candidate/digest/randomizer.

Limits: testnet and CLI only; public endpoints and drand threshold trust; one operator holds all three dealerless FROST shares; per-signer check processes are started by the coordinator on one host and participants auto-confirm; one wallet plays all bidders and seller; private pre-pinned routing does not authenticate an encrypted settlement envelope; zero auction fees; finite expiry distinguishes transactions on chain; public verification checks accounting without revealing refund addresses, while this evidence verifier uses local viewing keys for chain-note amount recovery. No frontend or mainnet work.
