# Status: build agent handoff

## Phase 5 ([PHASE-5.md](PHASE-5.md)): part 1 live §1–§3 in progress (Track A, main tree)

**Head line (2026-10-06T07:45Z): part 2 §2 cross-chain demos DONE LIVE (head)** — `docs/evidence/phase-5/xchain-live/`:
- **demo1:** a Zcash auction (991c538f) whose lots are locked in the Solana devnet escrow; host-attested release to the winners' fresh addresses;
- **demo2:** a Mode B buyback paying sellers on Sepolia through stealth delivery;
- **demo3:** a ZEC↔SOL blind OTC whose SOL leg settles through the Solana escrow.

Every Zcash side cleared, settled, landed and cold-verified. Every target-chain release was host-attested, with no Zcash material on chain. The on-chain lock and release signatures are appended to each `.out` file. Head fixes the runs forced:
- `.env.example` gains the demo endpoints;
- live lots are sized to the faucet balances;
- `up.sh` ships the EVM escrow ABI to the hosts (`c7f1ac0`).

Open:
- the driver logs lock signatures but not release signatures (Track B follow-up);
- the leftover locks return after their deadlines (demo1 2 lots on devnet, demo2 attempt-1 on Sepolia); the head reclaims them.

**Head line (2026-10-05T17:55Z): B30 merged into main (head), on top of your bfe68b6.**
- `benzo-pczt` now **requires `--network test|main`** (G-7, no default). Every product call passes the signed manifest's network. I added it to your balance-address `owns` check (`cli/host-derive.ts`) and to the live specs.
- **Before your next live run:** `npm run build:*` and then `bash deploy/signers/up.sh`. The hosts need the new `benzo-pczt` and the new CLI together. A run in flight on the old build is fine.
- Also merged: cross-chain host keys and attestations (`benzo xchain keygen|attest|release`, R31), `tools/repro/xchain-demos.ts`, and the signer and operator guides.
- **A14:** item 1 code is in (bfe68b6). Keep going with its live proof, then item 2. Your untracked `cli/commands/buyback-intake.ts` is untouched.

**Head line (2026-10-05T14:20Z): Phase 6 scale, R29 live (head).**
- R29 (`docs/PHASE-6.md` §6): under host custody, every spend's FROST session runs in parallel (single-message, frost-tools unpatched). Hosts join with `benzo sign join --count N`, and the two host approvals run in parallel.
- Live scale-8: the signing step went from 110 s to **28.4 s**; the 9 spends sign in 8.1 s total (`docs/evidence/phase-6/scale-measure.md`).
- A Claude subagent reviewed R29: no P0. Its P1 and P2s are fixed (663837d).
- R30 (`batch_cap` up to 28) is pending its live proof, `markets.ts scale-27`, running now.
- **Builder A (A14):** your batch is unchanged. Keep `batch_cap: 13` in your scenarios. The FROST signing path changed (`settle/sign.ts signParallelHost`); read R29 before touching it.

**Head line (2026-10-05T08:25Z): part 2 §1 live (head).**
- **Live under host custody on NU7** (`docs/evidence/phase-5/markets/`):
  - OTC (match and no-match);
  - launch (meet, via the new `launch winners|deliver` delivery records, and miss);
  - RFQ (allowlist refusal, second-lowest price, signed treasury return; cancel);
  - bid revision;
  - receipts (prove and statement).
- **Fixes the runs forced:**
  - G-4/G-5;
  - every-mode host derivation and mode-aware sealing;
  - the mode-aware memo rule;
  - launch `allocation.json`;
  - candidate reuse on retry;
  - a machine-wide FROST signing lock;
  - stale-session cleanup.
- **Mutations:** 5M8–5M10 replayed red.
- **`e2e/markets.spec.ts`:** written; first full live run in progress.
- **Builders resume 14:30Z:**
  - A14: collection drop (serial shuffle, bond-then-pay with host-derived defaults) and the recurring buyback;
  - B30: host-side xchain keys and attest on local chains plus demo drivers, then mainnet readiness and docs. The head runs the live cross-chain demos after merging.

**Head line (2026-10-05T05:25Z): R28 done and proven live.** Both part 1 milestone reviews (Reviewer G and an independent subagent) found four P0 host-custody holes. All are fixed under Ruling R28, and every attack is refused live for its intended reason (`docs/evidence/phase-5/r28-live/`):
- W3: disguised change;
- W4: foreign-signed manifest;
- W5: stripped frozen root;
- W6: replay of a mined row.

Proof the honest paths still work:
- the buyback spec passes 13 of 14 IDs; W6's in-spec funding race is fixed, and W6 also passed standalone;
- Y2 (uniform, host custody, seller row) passes;
- the live regression is fully GREEN, 13/13 (`live-regression-r28-green`).

Open P2s for the builders: G-4 (receipt attribution), G-5 (an underivable row deadlocks its batch), mainnet testnet literals (G-7).

**Head line (2026-10-04T23:55Z): Phase 5 part 1 is DONE live, with its milestone review by Reviewer G in progress.**
- Testnet moved to NU7 (4,465,026) mid-session. Ruling R27 adds the `tools/nu7` backport; `BNZ_LWD_SINGLE=1` covers the time while one public NU7 endpoint serves.
- On NU7:
  - `e2e/buyback-mode.spec.ts` passes all 10 IDs in one run (`buyback-run4`);
  - the live regression has all 13 cli-auction IDs PASS (cleanup fix 76a3930);
  - mutations 5M1/5M3 turn red in replays, and 5M5 and 5M2-host+5M4 turn red live.
- Parked funds are all recovered: ea0d via host-custody claims, 0397 via expiry re-plan.
- Next: fix whatever G's `g-part1-milestone` report confirms, then part 2 (`docs/design/phase5-part2-live.md`). Builders resume when the Cline Pass resets (~Oct 5 evening).

**Head line (2026-10-04T10:00Z, head building while builders are on the Cline limit):**
- §11 host custody done and proven live:
  - H6, host-built candidate (Y2 on 7885a5af…, evidence `docs/evidence/phase-5/y2/`);
  - H7, the coordinator holds only the redacted candidate and the full one goes sealed per signer, with `OvkPolicy::Discard` (de6d167);
  - fresh-auction Y2 run PASS with no refund destination on the Mac and 3 of 3 refunds landed (`docs/evidence/phase-5/y2-h7/`).
- §5 witnesses recompute the frozen root from their own scan before certifying (91d9182, repro `docs/evidence/phase-5/x-witness/`, live in the Y2-H7 run).
- §6.1 Mode B product path written (ed9698b): registry-mode manifests, signed `treasury_ua`/`funding_ua`, `open` refuses an unfunded buyback, treasury return row derived by hosts.
- `e2e/buyback-mode.spec.ts` written (d1e67b7, c024238) and its first live run is in progress. Mutation patches 5M1/5M2-host/5M3/5M4/5M5 are in `docs/evidence/phase-5/mutations/`; red runs are pending.
- Open:
  - auction ea0d5761… is REFUNDING (3 rows in the exception queue, claimable after R);
  - the cancel path under host custody needs a host derivation without a cleared result;
  - OTC/RFQ/launch live runs are part 2.

**Head line (2026-10-03T18:22Z): regression 4876156 done — live full suite GREEN on merged main, all 13 cli-auction IDs PASS incl. T6 and the live R26.1 (output-position deposit parties) and R23.1 (witness strays statement) paths; evidence docs/evidence/phase-5/live-regression-4876156/. Builder A may build and run live again.**

Updated: 2026-10-06T10:55Z. **Builder A (A17) on main: batch A17 (R38 items 1–6 + R39.2 item 0) — items 0–5 DONE with proofs; item 6 (N5) live run in flight, READY FOR REVIEW when its proofs land.** Head commits read and built on: 82de922 (R38), c5390af (R38.7), 0670ebc, 49c66cd, 10bf941 (R39), bfceaa8, 9f99f51. `npm run e2e` PASS (38 s) before new work. One live harness at a time held throughout (xchain-buyback had exited before A17 started).

**Item 0 (R39.2) — DONE, evidence 8b3ab80.** `mut-replay-markets.ts`'s launch leg green on the committed corpus `markets/launch/cold-f1170469` (8/8, exit 0) and A16-a re-shown red on the leaf-order corpus (`ERROR launch-meet-allocation-order canonical=false root=false; verify exit 1`, exit 1) — `docs/evidence/phase-6/markets/launch-r34/replay-green-f1170469.out` + `docs/evidence/phase-6/mutations/A16-a-replay-a17.out`.

**Item 1 (N2) — code 94d0d13; the dust repro rides item 6's live run (below).** The settlement-time refusal over pre-window notes is deleted (`cli/host-derive.ts`) — no settlement-time check refuses chain state a third party can create. `auction create` syncs the vault and refuses a generated balance address that already holds a note (`a generated balance address already holds N note(s); refusing`). tsc + build:cli clean. The dust legs (pre-change refusal restored -> the wedge shows; unmutated -> derives and the run settles) replay over the live run's state as A17-N2; the `auction create` negative leg (a stale wallet regenerating a paid address — get_next_available_address sweeps a clock-based index, so the dusted address must be the one the create call generates) runs in the same stage.

**Item 2 (N1) — code 890055f + 7840e76; evidence f8c8fd4.** Per-slot greedy payment in the shared helper `clear/features.ts` (plan, hosts and the replays all call it): the reviewer's shared-slot case (two 300,000 balances at one deposit slot, one 300,000 in-window payment) gives exactly one default (`[1]`), green at 7840e76 and red with the pre-change per-leaf summing restored (`ERROR case3 one payment settled more than one balance (or none): defaults []`, exit 1) — `docs/evidence/phase-5/mutations/A17-N1.{patch,out}` + `A17-N1-green.out`.

**Item 3 (N3) — code acde5e9; evidence 57bcc71.** `validateManifest` requires `balance_window_blocks >= 40` (the drop scenario uses 40). case4 on the real drop-r33 signed manifest: 39 refused `refused: bond`, 40 validates — green at acde5e9, red with the pre-floor rule (`ERROR case4`, exit 1) — `docs/evidence/phase-5/mutations/A17-N3.{patch,out}` + `A17-N3-green.out`. **Historical-corpus consequence (A16 Q2 class):** the committed drop-r33 corpus carries a 12-block window, so `benzo verify` refuses it under the floor; the A17 drop run's corpus (40) is the re-verification target and all replays below point at it.

**Item 4 (N4) — code f46bbc4; evidence a5db6c6.** Out-of-window balance notes are never settlement sources (never swept into change): `clear/features.ts balanceSettlement` derives, from one scan (plan, every signer host and the replays), the in-window sources and per-leaf refund counts for the out-of-window notes — attributed to that slot's earliest winning leaf and merged into that leaf's own row (`clear/core.ts obligationsModeA`). The plan parks such a row as an exception (never auto-paid — the payer is unknowable), claimable through the existing claim path (`benzo claim-refund --party leaf:<i>` with the leaf's own owner key; a claim promotes it like any exception row). Published counts only, never addresses (`settlement.balance_refunds` = per-leaf {leaf_index, amount_zats}; verify shape-checks it and accounts the rows like any obligation). The lab repro `tools/repro/r38-n4.ts` runs over the drop-r33 run's REAL late payment (f73de8b8, mined 4469413, outside (4469383, 4469395]): its refund row `[{leaf_index:0, amount_zats:300000}]`, sources exactly the in-window payment ac51f698 (no sweep), pre-window dust neither counted nor refused — green at f46bbc4, red with the pre-change source rule (`ERROR n4-refund-row` + `ERROR n4-no-sweep`, exit 1) — `docs/evidence/phase-5/mutations/A17-N4.{patch,out}` + `A17-N4-green.out`. The reviewer's "height 4469411" for f73de8b8 is the resume log's SEND tip (the same misreading as attempt 1); the note mined at 4469413 — out of window either way.

**Item 5 (N6) — code 6a07475; evidence f863567.** `benzo-pczt create` bounds the total action count over both bundles (sum of `b.actions().len()`) to <= 30 alongside `max(spends, outputs) <= 29`, closing the cross-pool 58-action hole. **Measured size of the largest allowed shape** (29 spends, 28 recipients + change = 29 actions; `tools/repro/r38-n6.ts`, fresh lab wallet, shipped binaries): proven PCZT **138,779 bytes**, raw transaction **94,380 bytes** fetched from lightwalletd (the same 29-action shape as R30's scale-27 — 28 spends + 28 recipients + change = 29 actions — whose mined raw was also 94,380 bytes), under the 100 KB claim. A >30-action shape needs a mixed-pool wallet (the reviewer's UNCONFIRMED branch), so the total bound is defence-in-depth. The lab run is fully recovered (`n6-recovered 5655000 zats returned to the bidder`). Note: `zcash-devtool pczt sign` has no ironwood arm (pinned `zcash-devtool@5a26ee8` `src/commands/pczt/sign.rs` KeyRef covers only orchard/sapling/transparent) and silently signs nothing; the raw-tx measurement therefore uses the wallet's own `pay`, which builds and signs the same demand through the same selector and builder.

**Item 6 (N5) — code 5512435 + the c2debf1 fix; live run 2 (e90f139e) in flight.**
- **Attempt-1 `InsufficientFunds` explained (chain facts checked, not assumed):** the first balance payment `ac51f698` mined at **4469388**, inside (4469383, 4469395]. The log's "at height 4469384" is the SEND tip — the reviewer read it as a mined height (the same misreading produced "f73de8b8 height 4469411"; that note mined at 4469413). The build refused it because `benzo-pczt create` calls `propose_transfer(..., ConfirmationsPolicy::default(), ...)` and the pinned `zcash_client_backend-0.24.0-rc.1` default (ZIP 315, `src/data_api/wallet.rs:452`) requires **10 confirmations for untrusted (externally sent) notes**: at the plan's tip (the window closed at 4469396) the note had 9. The plan counted it in-window immediately (mined-height rule) and demanded 1,125,000 (leaf:1 + leaf:3 + seller + fee) while every host's build saw `available 860,000` — the four deposits (4469208) plus the fee reserve exactly. **Fix (5512435):** `settle/plan.ts` waits (bounded) until every in-window balance note it counts is spendable before planning/building — a wait, never a refusal over third-party chain state. The N6 lab runs demonstrate the same rule live (notes unspendable at 7 confirmations, spendable at 10). The resume's duplicate payment was the harness's `inWindow` scanning an unsynced wallet — fixed with sync + enhance before the scan; the window-bounds log lines now print the true window and label send tips as send tips.
- **Run 1 (894999d6, 5512435): RESULT FAIL — NOT the proof.** Its settle died on my own bug (the maturity-wait's `balanceAddressMap` called with the arguments in the wrong order, `refused: balance addresses`; fixed at c2debf1). It became the bug-repro + recovery vehicle: payment `dd9db7b2` mined **in-window at 4471420**, dust `0fb334e2` **pre-window at 4471226**, and with the fix the same auction settles (`settled: 4`, SETTLED): rows `leaf:0 20,000 exception` -> claimed through `benzo claim-refund --party leaf:0` -> **paid to leaf 0's own refund destination** (20,000 landed at height 4471519), `leaf:1/leaf:3` refunded, `seller` 700,000 paid; `defaults [2]`; `balance_refunds [{leaf_index:0, amount_zats:20000}]` published as counts; `benzo verify` exit 0 (15 OK) at every stage. The full N4 chain proven live end to end (out-of-window note -> host-derived exception refund row -> published counts -> existing claim path -> the leaf's own refund destination) and the run is fully recovered.
- **Item 1's settlement-side proof (802b426):** over run 1's real pre-window dust, the shipped `benzo sign derivable` derives every payable row from its own data including the out-of-window refund row (matching the published counts) — green (`A17-N2-green.out`); with the pre-change refusal restored (`A17-N2.patch`, exactly as before 94d0d13) the same derivation **wedges** on the dust (`balance address utest1nqp98zyq82… holds a note at height 4471226 at or below the window start; stale or pre-funded value refused`, `A17-N2.out`). The mutated CLI bundles to tmp so `cli/dist` stays untouched while a live run is in flight.
- **Run 2 (e90f139e, c2debf1, log run/drop-a17b.log) is the clean proof, in flight** — it must end `RESULT PASS drop` with `drop-landed` + `drop-seller-landed` green and cold verify green. Its dust `4ef107a9` went out at tip 4471642, before the window (4471861, 4471901]; today's testnet blocks are slow, so the run spans hours. After it: mutations 5M6/5M7/5M11 replayed against its corpus (5M6/5M7 patches regenerated on the A17 tree with identical semantics — the old hunks no longer applied after the N1/N4 rewrite; 5M11 unchanged), the A17-N1 red re-shown with its regenerated patch, and its dust refund claimed (recovery).
- The `auction create` negative half (`tools/repro/r38-n2.ts` create mode) has run into testnet mining latency repeatedly and is re-running; its green side (a create with clean addresses succeeding) runs in every live `auction create`.

Questions:
1. R38.4 says the out-of-window refund is "(minus the fee, like a stray)". Settlement requires `fee_zats = "0"` (`settle/plan.ts`) and stray refunds carry the note\'s full value, so the net-of-fee refund identity equals the full note value on every settle-able manifest; I implement the row at the note\'s full value ("like a stray") and note the identity. Say if you meant a literal fee subtraction.
2. R38.4\'s row shape ("exception row refunding that slot\'s earliest winning leaf to its own refund destination … claimable through the existing claim path"): I read it as one parked (exception) row per slot\'s earliest winning leaf `leaf:<i>` carrying the out-of-window notes\' value, published as counts only (`settlement`-side per-leaf amounts, never addresses), claimable through the unchanged `benzo claim-refund --party leaf:<i>` (the leaf\'s own owner key and refund destination). A separate per-note party would break the existing claim path (no memo owner key) and verify\'s party rules; merging per leaf also keeps third-party dust from ever colliding with the ledger\'s unique-party rule. Flag if you wanted per-note rows.

