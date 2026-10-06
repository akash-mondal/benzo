# Status: build agent handoff

## Phase 5 ([PHASE-5.md](PHASE-5.md)): part 1 live §1–§3 in progress (Track A, main tree)

**Head line (2026-10-06T15:42Z): A17 item 6, the parked run (head).** Drop run 2 (`e90f139e…`) died on the harness poll bound (`FATAL balance window never opened`) after funding and clearing, and its window `(4471861, 4471901]` had not opened. Its deposits are parked. After your new run (or before it, if the hosts are free), **finish it with `resume:e90f139e4b265c0eeaf5b5f8ba18e7d60d62d14be4e8d15dfd81fe0b5e1e19d9`**: the 40-block window is manifest-fixed, so a late resume just counts the winner's in-window payment, or defaults it. Do not leave it parked. Record it as a recovery, not as the clean proof.

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

Updated: 2026-10-06T20:20Z. **Builder A (A17) on main: batch A17 (R38 items 1–6 + R39.2 item 0) — DONE. READY FOR REVIEW.** Head commits built on: 82de922 (R38), c5390af (R38.7), 0670ebc, 49c66cd, 10bf941 (R39), bfceaa8, 9f99f51, 7820746. `npm run e2e` PASS (38 s) and `npm run check:bundle` OK (9478ee38) at the final tree. One live harness at a time held throughout; signer hosts redeployed after the host-code changes (`up.sh` clean, isolation PROOF OK x3).

**Item 0 (R39.2) — DONE (8b3ab80).** The A16 canonical-order assertion stands; `mut-replay-markets.ts`'s launch leg green on the committed corpus `markets/launch/cold-f1170469` (8/8, exit 0) and A16-a re-shown red on the leaf-order corpus (`ERROR launch-meet-allocation-order canonical=false root=false; verify exit 1`) — `docs/evidence/phase-6/markets/launch-r34/replay-green-f1170469.out` + `docs/evidence/phase-6/mutations/A16-a-replay-a17.out`.

**Item 1 (N2) — DONE (94d0d13 + 802b426; the create-half recorded NOT PROVEN, infra).** The settlement-time refusal over pre-window notes is deleted — no settlement-time check refuses chain state a third party can create — and `auction create` refuses a generated balance address that already holds a note (the fresh-address property enforced where it is ours). **Red/green over the 894999d6 run's REAL pre-window dust** (0fb334e2, h=4471226 <= start 4471407): green — the shipped `benzo sign derivable` derives every payable row from its own data including the out-of-window refund row, matching the published counts (`A17-N2-green.out`); red — with the pre-change refusal restored (`A17-N2.patch`, exactly as before 94d0d13) the same derivation wedges: `balance address utest1nqp98zyq82… holds a note at height 4471226 at or below the window start; stale or pre-funded value refused` (`A17-N2.out`). The `auction create` negative leg is recorded NOT PROVEN in `docs/evidence/phase-5/repro/r38-n2-create.out` (five attempts, each beaten by outside causes: today's testnet mined each dust 20–90 min after broadcast while the wallet's generation burst degrades superlinearly); the green side runs in every live `auction create`.

**Item 2 (N1) — DONE (890055f + 7840e76; evidence f8c8fd4).** Per-slot greedy payment in the shared `clear/features.ts` helper (plan, hosts and the replays call it): the reviewer's shared-slot case gives exactly one default (`[1]`), green at 7840e76 and red with the pre-change summing restored (`ERROR case3 one payment settled more than one balance`, `A17-N1.{patch,out}` + `A17-N1-green.out`; the patch regenerated on the A17 tree with the same pre-change loop and the red re-shown with it).

**Item 3 (N3) — DONE (acde5e9; evidence 57bcc71).** `validateManifest` requires `balance_window_blocks >= 40` (the drop scenario uses 40); case4 on the real drop-r33 signed manifest: 39 refused `refused: bond`, 40 validates — red with the pre-floor rule (`ERROR case4`). Historical-corpus note (the A16-Q2 class): the committed drop-r33 corpus carries a 12-block window, so `benzo verify` refuses it under the floor; the A17 corpus (`markets/drop-a17`) is the re-verification target and every replay points at it.

**Item 4 (N4) — DONE (f46bbc4 + a5db6c6 + 025c736).** Out-of-window balance notes are never settlement sources (never swept into change): `clear/features.ts balanceSettlement` derives, from one scan (plan, every signer host, the replays), the in-window sources and per-leaf refund counts attributed to that slot's earliest winning leaf; `obligationsModeA` merges them into that leaf's own row; the plan parks such a row as an exception (never auto-paid — the payer is unknowable) claimable through the EXISTING claim path (`benzo claim-refund --party leaf:<i>`, the leaf's own owner key and refund destination). Published counts only, never addresses (`settlement.balance_refunds` = per-leaf `{leaf_index, amount_zats}`; verify shape-checks it and holds the rows to the ordinary row/receipt accounting). The lab repro `tools/repro/r38-n4.ts` runs over drop-r33's real late payment (f73de8b8): its refund row `[{leaf_index:0, amount_zats:300000}]`, sources exactly the in-window payment (no sweep), pre-window dust neither counted nor refused — green at f46bbc4, red with the pre-change source rule (`ERROR n4-refund-row` + `ERROR n4-no-sweep`). **Proven live three times end to end** (below). The exception row may GROW as the scan sees more out-of-window notes (025c736; live: e90f139e and a32310dd pinned their rows before the late payments mined and the re-plan grew them 20,000 -> 340,000 before the claim); a row money has moved for never changes.

**Item 5 (N6) — DONE (6a07475; evidence f863567).** `benzo-pczt create` bounds the total action count over both bundles to <= 30 alongside `max(spends, outputs) <= 29`, closing the cross-pool 58-action hole. **Measured at the largest allowed shape** (29 spends, 28 recipients + change = 29 actions; `tools/repro/r38-n6.ts`, fresh lab wallet, shipped binaries): proven PCZT 138,779 bytes, **raw transaction 94,380 bytes** fetched from lightwalletd — the same 29-action shape as R30's scale-27 (whose mined raw was also 94,380 bytes), under the 100 KB claim. The lab run is fully recovered (`n6-recovered`). Note: the pinned `zcash-devtool pczt sign` has no ironwood arm (5a26ee8 `src/commands/pczt/sign.rs` KeyRef covers only orchard/sapling/transparent) and silently signs nothing, so the raw measurement uses the wallet's own `pay` (same selector, same builder).

**Item 6 (N5) — DONE (5512435 + c2debf1 + 88dd854 + cb30a55 + e699cc6; evidence 6f4fec0 + 84eed8c).**
- **The attempt-1 `InsufficientFunds` explained (chain facts checked):** `ac51f698` mined in-window at **4469388** (the log's "at height 4469384" is the SEND tip — the reviewer read it as a mined height; the same misreading gave "f73de8b8 height 4471411" for a note that mined at 4471413). The build refused it because `benzo-pczt create` spends through `ConfirmationsPolicy::default()` — ZIP 315 requires **10 confirmations for externally sent notes** (`zcash_client_backend-0.24.0-rc.1` `src/data_api/wallet.rs:452`) — and at the plan's tip the note had 9: the plan counted it by mined height and demanded 1,125,000 while every host's build saw `available 860,000` (the four deposits + the fee reserve exactly). **Fix (5512435):** `settle/plan.ts` waits (bounded) until every in-window balance note it counts is spendable before planning/building. The N6 lab runs demonstrate the same rule live (notes unspendable at 7 confirmations, spendable at 10). The resume's duplicate payment was the harness scanning an unsynced wallet — `inWindow` now syncs + enhances first; the log lines print the true window bounds and label send tips as send tips.
- **The clean live `drop` run: `be7aebe8` at e699cc6 — `RESULT PASS drop`** (`docs/evidence/phase-5/markets/drop-a17/`): `drop-settled exit 0`, `drop-receipts {"leaf:1":200000,"leaf:3":200000,"seller":700000}`, **`drop-landed` green**, **`drop-seller-landed 700000`**, **`drop-cold-verify` green**, `drop-defaults [2]`, `drop-defaults-maps` 2 agreeing verified maps, `drop-swapped-defaults-refused`, `drop-reserve-opening`, `drop-serial-replay-enforced`. Third-party dust (8fb693ae) sat at leaf 0's balance address before the window (4472304, 4472344] and the run settles regardless; it refunds as leaf:0's exception row with published counts. The payment f820dbd7 was sent at tip 4472306 and mined in-window (the N5 maturity wait ready for it).
- **Mutations replayed against the new run (84eed8c):** replay-green 8/8 + exit 0 on `drop-a17/drop-cold`; 5M6 -> `ERROR drop-defaults-window`; 5M7 -> `ERROR drop-forfeit`; 5M11 -> `ERROR drop-swapped-defaults-refused` (the mutated verify accepts the swap); A17-N1 re-shown `ERROR case3`. Each patch applied then reversed; `check:bundle` OK at the clean tree. The 5M6/5M7 patches were regenerated on the A17 tree with identical semantics (the old hunks no longer applied after the N1/N4 rewrite).
- **Every funded run recovered (each N4 claim paid to the party's own refund destination and verified):** run 1 `894999d6` — leaf:0's 20,000 dust refund claimed and landed (h=4471519), SETTLED; run 2 `e90f139e` — 340,000 (two dusts + a late payment) landed, SETTLED; run 3 `a32310dd` — 340,000 landed, SETTLED; run 4 `be7aebe8` — 20,000 landed (h=4472384), SETTLED. Runs 2 and 3 aborted mid-flight on harness/infra defects (my balanceMap argument order; an 80-minute poll bound; one DNS blip) and their `resume`/recovery records are evidence of recovery only — the proof is run 4. The N6 lab wallet was swept back to the bidder; the N2 dusts sit at the bidder's own derived addresses (the bidder wallet tracks them).

**Test audit delta (A17)** — marks per R35: `tools/repro/markets.ts` (market-modes driver; owns M-drop/M-otc-match/M-launch-meet/M-rfq/M-otc-nomatch/M-launch-miss/M-rfq-cancel/M-revision and the drop IDs drop-defaults, drop-defaults-maps, drop-swapped-defaults-refused, drop-reserve-opening) **R**; its covered code changed (clear/features, clear/core, settle/plan, settle/ledger, cli/host-derive) and its cheapest mutations 5M6/5M7/5M11 were re-run red against the new run, plus the A16-b drop replay and the A16-a launch replay for the RG reruns. `tools/repro/r33-balance.ts` (cases 1–4; N1/N3) **R** — mutations A17-N1/A17-N3 re-run red after the last change. `tools/repro/mut-replay-markets.ts` **R** (the replay driver; green 8/8 on the A17 corpus). New R38-sanctioned drivers: `r38-n2.ts` (**R**; A17-N2 replayed red/green), `r38-n4.ts` (**R**; A17-N4 replayed red/green), `r38-n6.ts` (**R**; measurement driver, no mutation by design). A15/A16's table otherwise stands; the specs themselves are untouched by A17 and their RG reruns are unaffected except `cli-auction`/`auction-core` code paths re-covered by the e2e default run (PASS at the final tree).

Environment/deviations (A17): `deploy/signers/up.sh` once after the host-code change (clean, isolation PROOF OK x3); `frostd` started under `$BNZ_STATE_DIR/run/frostd-a17.pid` for the settle runs (pidfile-logged, left running); the verify bundle rebuilt in this checkout for the `manifest/schema.ts` and `api/public-auction.ts` changes (`check:bundle` OK 9478ee38, R32 provenance); four drop-scenario live attempts (894999d6/e90f139e/a32310dd/be7aebe8) because of one code bug and two harness bounds plus one DNS blip, each recovered as above; no pins changed, no mainnet, no frontend.

Questions:
1. R38.4 says the out-of-window refund is "(minus the fee, like a stray)". Settlement requires `fee_zats = "0"` (`settle/plan.ts`) and stray refunds carry the note's full value, so the net-of-fee refund identity equals the full note value on every settle-able manifest; the rows carry the note's full value ("like a stray"). Say if you meant a literal fee subtraction.
2. R38.4's row shape, as implemented: one parked (exception) row per slot's earliest winning leaf `leaf:<i>` carrying the out-of-window notes' value, published as counts only, claimable through the unchanged `benzo claim-refund --party leaf:<i>` (the leaf's own owner key and refund destination); several notes at one slot merge into that leaf's row and the row grows as the scan sees more (never after money has moved). A separate per-note party would break the existing claim path (no memo owner key) and verify's party rules, and would collide with the ledger's unique-party rule. Flag if you wanted per-note rows.
3. The `auction create` negative half of N2 is recorded NOT PROVEN (docs/evidence/phase-5/repro/r38-n2-create.out): five attempts, each beaten by outside causes (today's testnet mined each dust 20-90 min after broadcast; the wallet's generation burst degrades superlinearly). The mechanism (a burst pins the wallet's next generated index deterministically) is documented for a re-attempt on a faster chain; the green side runs in every live create.
4. The N3 floor makes `benzo verify` refuse the historical drop-r33 corpus (12-block window) — the same historical-corpus class as A16's Q2. The A17 corpus (markets/drop-a17) is the re-verification target; all replays point at it.
