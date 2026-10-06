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

Updated: 2026-10-06T08:35Z. **Builder A (A17) on main: batch A17 (R38 items 1–6 + R39.2 item 0) in progress.** One commit per item + its evidence. Head commits read and built on: 82de922 (R38), c5390af (R38.7), 0670ebc, 49c66cd, 10bf941 (R39), bfceaa8 + 9f99f51 (xchain demos 2/3 live, head). `npm run e2e` PASS (38 s) before new work. xchain-buyback had exited before A17 started (one-live-harness rule held); the stray `api/dist/server.mjs --dir markets/launch/cold-f1170469 --port 18891` (pid 17267, predates A16) is untouched.

**Item 0 (R39.2) — DONE, evidence 8b3ab80.** The A16 canonical-order assertion stands (ca48515). `mut-replay-markets.ts`'s launch leg now proven on the committed corpus `markets/launch/cold-f1170469`: 8/8 PASS, exit 0 (`docs/evidence/phase-6/markets/launch-r34/replay-green-f1170469.out`). A16-a re-shown red as R39.2 says (winner leaf order restored in the published allocation.json only, on `launch-r34/launch-cold` where leaf order differs from canonical): `ERROR launch-meet-allocation-order canonical=false root=false; verify exit 1 (ERROR clear refused: launch allocation rows not in canonical order)`, exit 1 (`docs/evidence/phase-6/mutations/A16-a-replay-a17.out`); patch applied then reversed, `git status --porcelain` afterwards showed only the new evidence files.

**Item 1 (N2) — code in; the dust repro rides the item 6 live run (see below).** `cli/host-derive.ts` no longer refuses a balance address holding a note at or below the window start (the refusal is deleted; the strict window filter alone decides payment and R38 item 4 refunds out-of-window notes). `auction create` now syncs the vault and refuses a generated balance address that already holds a note (`a generated balance address already holds N note(s); refusing`) — the fresh-address property enforced where it is ours to enforce. `npm run build:cli` + `tsc --noEmit` clean.
- The N2 proof needs a note mined at height <= the window start at a balance address — only producible before a real window opens, so the dust is sent in the item 6 live `drop` run and the two legs (refusal restored = pre-change hunk -> the wedge shows; unmutated -> derives and the run settles) replay over that run\'s own state, like A16-b. The `auction create` refusal\'s negative leg is a timing dance over a lab wallet copy (get_next_available_address sweeps a clock-based index, so the dusted address must be the one the create call generates); it runs in stage 2 with the run.
- Not wedging is already proven by construction: the only refusal over third-party chain state in the balance path is gone; `blockTime(start) >= R\'s release` remains (manifest property, not third-party state).

**Where the batch stands:** item 2 (N1 per-slot greedy in `clear/features.ts`), 3 (N3 `balance_window_blocks >= 40`), 4 (N4 out-of-window notes -> host-derived exception refund rows to the slot\'s earliest winning leaf\'s own refund destination, never sources; lab repro over drop-r33\'s real stranded late payment f73de8b8), 5 (N6 total actions <= 30 + measured largest-allowed shape), 6 (N5: settle-maturity fix + window-bounds log lines + one clean live `drop` run at the final commit + mutations 5M6/5M7/5M11 replayed against the new run + recover every funded run).

**N5 attempt-1 `InsufficientFunds` — explained (fix lands with item 6).** Chain facts (checked, not assumed): the first balance payment `ac51f698` mined at **4469388**, inside the manifest window (4469383, 4469395] — the reviewer\'s "mined in-window at 4469384" read the log\'s **send tip** as a mined height (the `balance paid … at height` line prints the send tip — fixed in item 6 with the window-bounds lines). The build\'s `InsufficientFunds { available: 860000, required: 1125000 }`: 860,000 = the four deposits (4469208) + the fee reserve exactly — the 300,000 note was **mined but not yet spendable**: `benzo-pczt create` calls `propose_transfer(..., ConfirmationsPolicy::default(), ...)` and the pinned `zcash_client_backend-0.24.0-rc.1` default (ZIP 315) requires **10 confirmations for untrusted (externally sent) notes** (`src/data_api/wallet.rs:452`); at the plan\'s tip (the window closed at 4469396) the note had 9. The plan counted it in-window immediately (mined-height rule) and demanded 1,125,000; every host\'s build refused it as immature -> the batch could not build. Fix (item 6): settle waits until every in-window balance note it counts has 10 confirmations before planning/building. The resume\'s duplicate payment then came from `bondFlow`\'s unsynced `inWindow` scan (harness log bug + no sync before scan), also fixed in item 6.

Facts recorded for item 4/6: drop-r33 (9c1974b3) vault holds the stranded duplicate `f73de8b8` (300,000, height 4469411 — out of window, N4\'s example) plus 30,000 settlement change = 330,000 spendable. Recovering it through the N4 exception row + claim path is part of item 6\'s "recover every funded run".

Questions:
1. R38.4 says the out-of-window refund is "(minus the fee, like a stray)". Settlement requires `fee_zats = "0"` (`settle/plan.ts`) and stray refunds carry the note\'s full value, so the net-of-fee refund identity equals the full note value on every settle-able manifest; I implement the row at the note\'s full value ("like a stray") and note the identity. Say if you meant a literal fee subtraction.
2. R38.4\'s row shape ("exception row refunding that slot\'s earliest winning leaf to its own refund destination … claimable through the existing claim path"): I read it as one parked (exception) row per slot\'s earliest winning leaf `leaf:<i>` carrying the out-of-window notes\' value, published as counts only (`settlement`-side per-leaf amounts, never addresses), claimable through the unchanged `benzo claim-refund --party leaf:<i>` (the leaf\'s own owner key and refund destination). A separate per-note party would break the existing claim path (no memo owner key) and verify\'s party rules; merging per leaf also keeps third-party dust from ever colliding with the ledger\'s unique-party rule. Flag if you wanted per-note rows.

