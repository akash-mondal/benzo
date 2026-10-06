# Phase 6 test and repro audit (B33 item 1)

Written 2026-10-06 at `1a4846f` from committed evidence only (`git log`, `docs/evidence/phase-*/mutations/*.out`,
`e2e/*.spec.ts`, `tools/repro/`). Nothing was deleted, moved or re-run for this audit; the marks are proposals the
head rules on. Rules applied: AGENTS.md "Tests: few, end to end" (8-test ceiling; "any other committed script that
runs our code and compares its output with an expected value is a test") and AGENTS.md "When a phase reaches READY
FOR REVIEW" (per-test audit mark, assertion IDs, code-changed-since-last-mutation, cheapest mutation to re-run).

## (a) e2e specs (7 of the 8 slots used; 1 reserved for the user's browser bid flow)

Mark legend: R retain, F fix the assertion, C consolidate, D delete. All seven specs mark **R**; the consolidation
work falls on `tools/repro/` (part (b)). "Last mutation run" is the newest `mutations/<ID>.out` that turned the
spec's own assertions red (or re-executed them red on a replay corpus). All specs' covered code changed since that
run, so each owes its cheapest-mutation re-run at the final regression (gate RG, Track A's lane) before READY FOR
REVIEW; the two replayable ones could be re-run offline first.

| Spec (Playwright project) | Assertion IDs it owns | Mark | Code covered changed since its last mutation run? | Cheapest mutation to re-run |
|---|---|---|---|---|
| `e2e/seal-open.spec.ts` (`default`, also `live`) | `C1`–`C7` | R | **Yes.** Last mutation run: `phase-1/mutations/M1–M4.out` at `36913b6`, 2026-09-30T15:50–15:52Z. Range `36913b6..1a4846f` changed 6 covered files: `seal/src/main.ts`, `seal/src/index.html`, `envelope/{bid,deliver,destination,index}.ts` (memo framing v2 at `8f7b156` is the substantive change) | **M2** (`phase-1/mutations/M2.patch`, one `seal/src/main.ts` line) → `ERROR C7`; `npm run e2e` (~40 s, offline) |
| `e2e/testnet-golden-path.spec.ts` (`testnet-golden-path`, `live`) | `A1`–`A5`, `B1`, `D1`–`D3` | R | **Yes.** Last mutation run: `phase-1/mutations/M5–M7.out` at `4c5e4a9`, 2026-09-30T18:54–18:59Z (`M7` mutates the spec itself — a harness control). Range `4c5e4a9..1a4846f` changed 75 covered files (`scan/src`, `manifest`, `clear`, `settle`, `envelope`, `cli`) | **M5** (`M5.patch`, `scan/src/main.rs`) → `ERROR A4 A5 B1 D1`; live project (~35 min, testnet — Track A runs it) |
| `e2e/auction-core.spec.ts` (`auction-core`) | `E1`, `E2`, `F1`, `F2`, `G1`–`G3`, `H1`–`H4`, `I1` | R | **Yes.** Last mutation run: `phase-4/mutations/N1-regression.out` at `3174c60`, 2026-10-01T18:56Z (`ERROR E1 I1`; the `N1–N7` set ran at its own phase-2 base commits). Range `3174c60..1a4846f` changed 60 covered files (`manifest`, `clear`, `cli`, `envelope`, `settle`) | **N7** (`phase-2/mutations/N7.patch`, `clear/auction-cli.ts`) → `ERROR I1` (single assertion); live project |
| `e2e/settle-crash.spec.ts` (`settle-crash`) | `J1`, `J2`, `K1`, `L1`, `M1`, `N1` | R | **Yes.** Last mutation run: `phase-4/mutations/P1-expiry.out` at `47b665f`, 2026-10-02T04:03–04:46Z (`ERROR J1 J2 K1 L1 N1`; `P1–P3` at their phase-3 bases, `P1-regression` at `15c8c63`). Range `47b665f..1a4846f` changed 10 `settle/` files (`cli`, `plan`, `envelopes`, `deposits`, `io`, `sign`, `batching.ts`, `src/main.rs`, `Cargo.*`); `settle/ledger.ts` unchanged | **P3** (`phase-3/mutations/P3.patch`, `settle/plan.ts`) → `ERROR M1` (single assertion); live project |
| `e2e/cli-auction.spec.ts` (`cli-auction`) | `O1`, `O2`, `P1`, `P2`, `Q1`, `R1`, `S1`, `T1`–`T6` | R | **Yes.** Last mutation run: `phase-5/mutations/R7M1.out` at `8a37993`, 2026-10-02T21:43–22:31Z (`ERROR T1`; `U1–U6` + `U6-rerun` at their phase-4 bases). Range `8a37993..1a4846f` changed 52 covered files (`api`, `cli`, `manifest`, `clear`, `settle`, `envelope`) | **U2** (`phase-4/mutations/U2.patch`, `api/public-auction.ts`) → `ERROR S1` (single assertion); live project |
| `e2e/buyback-mode.spec.ts` (`buyback-mode`) | `Y1a`–`Y1c`, `V1a`, `V1b`, `V2`, `W1`–`W6`, `X1a`, `X1b` | R | **Yes.** Last mutation runs: live reds `phase-5/mutations/5M5.out` (2026-10-04T23:13Z, `ERROR Y1a`) and `5M2-host.out`/`5M4.out` (2026-10-04T23:50Z, `ERROR W1 W2`); most recent = the `5M1`/`5M3` replays re-run at `cfd2f84`, 2026-10-04T23:54Z (`FAIL V1b` / `FAIL X1b`, `mut-replay.ts` on buyback-run4's published data). Range `cfd2f84..1a4846f` changed 30 covered files (`clear/{mode-b,features,market,launch,registry,rfq,auction-cli}.ts`, `cli/commands/sign-*`, `manifest/schema.ts`, `settle/*`) | **5M1 replay** (`5M1.patch` + `node tmp/mut-replay.mjs <buyback-run4/cold/…>`): offline, seconds, `FAIL V1b`; live alternative 5M5 → `ERROR Y1a` |
| `e2e/markets.spec.ts` (`markets`) | `M-otc-match`, `M-otc-nomatch`, `M-launch-meet`, `M-launch-miss`, `M-rfq`, `M-rfq-cancel`, `M-revision` | R | **Yes.** Last mutation run: `phase-5/mutations/5M8–5M10.out` replays at `7dcaeda`, 2026-10-05T08:19Z (`FAIL revision`/`FAIL rfq` per mutation). Range `7dcaeda..1a4846f` changed 26 covered files incl. `tools/repro/markets.ts` itself, `clear/*`, `settle/*`, `manifest/schema.ts` | **5M8 replay** (`5M8.patch` + `mut-replay-markets.ts` on `markets/revision-cold`/`rfq-cold`): offline, seconds, `FAIL revision`; live alternative needs a market run |

Notes:
- Ceiling holds as the phase doc counts it: 7 spec files + 1 reserved slot = 8. No spec uses `test.skip`, retries or
  `.only`; live selection is by Playwright project (`playwright.config.ts`).
- R33 P2-6 still owes the collection drop's join to `e2e/markets.spec.ts` (assertions on host-signed defaults plus
  mutations 5M6/5M7/5M11) — that is a sanctioned *addition* on Track A's A14/A15 lane, not an audit mark change.
- The cheapest-mutation re-runs owed above are gate RG work. Only the two replay rows (buyback 5M1, markets 5M8) can
  be re-run offline; the other five need the live testnet lane.

## (b) `tools/repro/` — one row per file (51 entries: 50 files + the `fixtures/` corpus)

Mark legend: KEEP = live harness or cited evidence repro; FOLD = merge into another script or spec (proposal only —
nothing moved); RETIRE = superseded; its evidence stays committed. "Sanction" cites the Ruling named in the file's
introducing commit or the STATUS entry that ordered it; "evidence cites" lists committed files that name the script.

| File | What it proves | Sanction (Ruling / STATUS entry) | Evidence that cites it | Mark |
|---|---|---|---|---|
| `api-reference-check.ts` | every documented API response key set matches the doc's shape blocks (11 shapes + 2 startup cases); mutation B32-a red | STATUS-B run 32 item 1 (`f5a022a`); R34 follow-up | `repro/api-reference.out`, `mutations/B32-a.out`, `EVIDENCE.md` (DOC row) | **KEEP** (gate DOC evidence driver — see count below) |
| `batching-equal.ts` | `planBatches` equals the ledger's `allocate` batch-for-batch at caps 13 and 28 (UTF-8 byte order); mutation B31-a red | STATUS-B run 31 item 1 (`ed0b323`); R30 | `repro/batching-equal.out`, `mutations/B31-a.out`, `EVIDENCE.md` (SC row) | **FOLD** (into the `npm run bench` batch-plan stage — gate SC's evidence run) |
| `bidder-bundle-driver.mjs` | the clean-machine half of the bidder-bundle proof: drives the extracted sealer page over DevTools, asserts the 128-byte plaintext equals the chosen inputs and the stanza/round/networking rules | STATUS-B run 32 item 2 (`979ca65`) | `pk-bidder.out` (run transcript) | **KEEP** (gate PK evidence driver) |
| `bidder-bundle-proof.ts` | two identical bidder-bundle builds + the clean-machine seal/open proof (fresh `/tmp`, empty `HOME`, pinned `tle` and Playwright) | STATUS-B run 32 item 2 (`979ca65`) | `pk-bidder.out`, `EVIDENCE.md` (PK row) | **KEEP** (gate PK evidence driver) |
| `g-forged-claim.mjs` | a forged stray claim (memo not bound by the witnesses' statement) is refused | R23 item 1 (`d4fdc8d`; PHASE-5 R23 cites it) | `repro/g-forged-claim-{before,after}.out` | **FOLD** (into `cli-auction` R1 verify corpus) |
| `g1-tampered-ledger-redirect.mjs` | a tampered settlement ledger redirects a destination; gate W refuses it (Reviewer G probe 1) | run record `5b5b09a` (R7-start task: probes copied from `benzo-sol-g/tests`, root path only) | none by name (leak-audit listings only) | **FOLD** (into `cli-auction` R1/T1) |
| `g2-envelope-crash-not-exception.mjs` | a malformed envelope record goes to the exception queue, never crashes settlement (Reviewer G probe 2) | run record `5b5b09a` (as above); outcome became R7.3 | `repro/g2-{before,after}.out` | **FOLD** (into `cli-auction` T1) |
| `g3-reserve-opening-unpublished.mjs` | Reviewer G probe 3: reserve opening publication rules | run record `5b5b09a` (as above) | none | **RETIRE** (superseded by `reserve-opening-repro.mjs` + mutation U7 / R7.5) |
| `g7-network-repro.mjs` | mainnet UAs refused on testnet and the reverse (G-7 network rules); mutation X3-a red | STATUS-B run 30 item 3 (`37ac903`, mainnet readiness); kept alive by R33 P2-1 | `repro/g7-network.out`, `mutations/X3-a.out` | **FOLD** (into `auction-core` F family) |
| `kc-key-commitment-repro.mjs` | the envelope key-commitment rule (KC_KEY): per-auction keys, commitment binding | R12 item 2 (`c8c622e` — the Ruling ordered committed red/green repros) | `repro/kc-key-commitment-{before,after}.out` | **FOLD** (into `cli-auction` R1) |
| `markets.ts` | the live market-mode harness: per scenario CLI result = the registry's pure clear, receipts = obligations, payments land, cold verify (also `scale-8`/`scale-27`, demo scenarios) | head commit `c040000` (PHASE-5 part 2 §1 live harness) | `markets/README.md`, `scale/scale-*.log`, `EVIDENCE.md` (LP-0004), PHASE-5, PHASE-6 | **KEEP** (live harness of `e2e/markets.spec.ts`) |
| `mr-envelope-repro.mjs` | the shared-envelope rule: one envelope per leaf, dedup, membership (R12.2 companion) | R12 item 2 (`c8c622e`) | `repro/mr-envelope-{before,after}.out` | **FOLD** (into `cli-auction` R1) |
| `mut-replay-markets.ts` | re-executes the markets spec's outcome/price assertions on the live published data with the pure clear mutated (5M8–5M10 red machinery) | head commit `7dcaeda` (PHASE-5 §6 mutations) | `mutations/5M8–5M10.out`, `docs/STATUS.md` | **KEEP** (mutation-replay harness; the offline cheapest red for `markets.spec.ts`) |
| `mut-replay.ts` | the same for the buyback spec's V1b/X1b assertions (5M1/5M3 red machinery) | head commit `ba20583`, re-run `cfd2f84` (PHASE-5 §6) | `mutations/5M1.out`, `mutations/5M3.out`, `docs/STATUS.md` | **KEEP** (mutation-replay harness; the offline cheapest red for `buyback-mode.spec.ts`) |
| `obligations-equal.ts` | the mode-registry `obligations()` equals the old special-case host derivations on the live uniform and buyback results | head commit `82488ea` (A13 item 3) | `markets/obligations-equal.out` (its run record; not named inside) | **RETIRE** (one-shot equivalence proof; its two live results remain the record) |
| `r10-2-envelope-pay-repro.mjs` | settlement pays through validated v2 envelopes (ENVELOPE_INTERIM_REFUSAL removed) | R10 item 2 (`c7f1029`) | `repro/r10-2-{before,after}.out` | **FOLD** (into `cli-auction` T1) |
| `r10-4-envelope-agreement-repro.mjs` | envelope-opens reports + the two-signer agreement gate + authenticated stray/cancelled envelopes | R10 item 4 + R12 item 3 + R20 (`19afc5f`) | `repro/r10-4-{before,after}.out` | **FOLD** (into `cli-auction` T1/R1) |
| `r10-5-signer-state-repro.mjs` | `sign envelope-key --state`/`BNZ_STATE_DIR` defaulting to `~/.benzo-signer` | R10 item 5, P3 (`a95dfb4`) | `repro/r10-5-{before,after}.out` | **RETIRE** (configuration default; evidence stands) |
| `r14-devnet-deploy-cycle.sh` | the one-command repro for the blocked R14 item 3: new-devnet-program deploy + one live `benzo xchain` cycle | R14 item 3 BLOCKED record (`7a31c05`; STATUS-B run 23; AGENTS.md requires a one-command repro for BLOCKED) | STATUS-B run 23 (no evidence file — the run is blocked on devnet funds) | **KEEP** (owed BLOCKED repro) |
| `r15-3-claim-envelope-repro.mjs` | claims carry the destination sealed in a v2 envelope; only `claim_envelope_sha256` is published | R15 item 3 (`5c590a6`) | `repro/r15-3-{before,after}.out` | **FOLD** (into `cli-auction` T1/T2) |
| `r15-verify-leaves-repro.mjs` | machine runs without envelope records, zero-refund rows, strangers refused, phase 2–4 corpora verify (mutations R15-F4a/b/F5, R16-F2a) | R15 items 1–2 tooling (`e1b55da`; STATUS-B run 23/24, run-28 audit) | `repro/r15-verify-leaves.out`, `mutations/R15-F4a/F4b/F5/R16-F2a.out`, `mutations/R15-F5-rerun-r28.out` | **FOLD** (into `cli-auction` R1) |
| `r16-1-cancel-claims-repro.mjs` | cancelled auctions refund through claims; `destinations()` never throws per row | R16 item 1, P0 (`2b2743b`) | `repro/r16-1-{before,after}.out` | **FOLD** (into `cli-auction` T6) |
| `r16-4-stray-claim-opening-repro.mjs` | verify derives every stray claim's owner key from published memo + beacon; `claims[].opening` removed | R16 item 4, P1 (`4928810`) | `repro/r16-4-{before,after}.out` | **FOLD** (into `cli-auction` R1) |
| `r16-memo-bound-repro.mjs` | memo framing v2 binds the refund envelope (cancel path needs no decryption); mutations R16-2a/b red | R16 item 2 (R18) (`8f7b156`) | `repro/r16-memo-bound.out`, `mutations/R16-2a/R16-2b.out` | **RETIRE** (framing asserted by `seal-open` C1/C7 and `cli-auction` P1) |
| `r23-2-signed-opens-repro.mjs` | envelope-opens reports are witness-key-signed; the plan counts only verified reports | R23 item 2 (`9a48cb3`) | `repro/r23-2-{before,after}.out`, `mutations/R23-2.out` | **FOLD** (into `cli-auction` T1) |
| `r23-3-api-claims-repro.mjs` | the read API fails closed with the verify ERROR (never a 500) on claims-without-beacon | R23 item 3, P3/G4 (`0244150`) | `mutations/R23-3a.out`, `mutations/R23-3a-rerun-r28.out` | **FOLD** (into `cli-auction` S1) |
| `r24-3i-classify-address-repro.mjs` | the `zcash_address` swap: 637-case corpus verdicts identical to the old parser + official labels; mutations R24-3i-a/b red | R24 item 3 (i) (`9f50fcf`) | `repro/r24-3i-classify-address.out`, `mutations/R24-3i-a/R24-3i-b.out` | **RETIRE** (one-shot swap proof; corpus stays in `fixtures/`) |
| `r26-1-deposit-party-repro.mjs` | deposit parties by output index; zero-value notes are never obligations (R26.1) | R26 item 1 (`e27788a`) | `repro/r26-1-{before,after}.out` | **FOLD** (into `cli-auction` O2/T1) |
| `r26-3-projection-repro.mjs` | verify ERRORs when any projection diverges from canonical `auction.json`; mutations R26-3a/b red | R26 item 3, P2/F5 (`82b3590`; STATUS-B runs 27/28) | `mutations/R26-3a.out`, `R26-3b.out`, `R26-3a-rerun-r28.out` | **FOLD** (into `cli-auction` R1) |
| `r28-replay.ts` | the R28 review attacks refused for their intended reasons on the live buyback (W6 replay of a mined row) | head commit `889add1` (R28 live proof) | `r28-live/README.md`, `r28-live/w6-replay.out` | **KEEP** (cited evidence repro) |
| `r33-balance.ts` | the R33 balance window/addresses: reviewer's case1/case2 outputs refused before `a1f9d90`, accepted after | Builder A at `a1f9d90` (R33 items 1–2 / A15 item 1) — Track A's file | `repro/r33-balance-{before,after}.out`, `docs/STATUS.md` | **KEEP** (Track A's cited evidence repro; head assigns any fold) |
| `r5-fund-quote-repro.mjs` | `benzo fund quote` quotes only (NEAR Intents 1Click), no round amounts, shielded-only refusal; mutation S5-a red | STATUS-B run 25 item 5 (`6606298`, crosschain.md §5) | `repro/r5-fund-quote.out`, `mutations/S5-a.out` | **RETIRE** (cross-chain quote path; evidence stands; no spec owns it — noted as a coverage gap) |
| `r7-1-ledger-redirect-repro.mjs` | gate W: destinations rooted in signer-derived openings + published envelope records (P0) | R7.1 (`4a7e99e`) | `repro/r7-1-{before,after}.out` | **FOLD** (into `cli-auction` R1/T1) |
| `r7-2-envelope-keys-repro.mjs` | per-signer envelope keys pinned in the signed manifest; the operator holds no envelope private key (P0) | R7.2 (`4d10f40`) | `repro/r7-2-{before,after}.out` | **FOLD** (into `cli-auction` R1) |
| `r7-3-exception-queue-repro.mjs` | a bad envelope moves its leaf to the exception queue, never aborts settlement (P1) | R7.3 (`71d1bcb`; PHASE-5 cites it) | `repro/r7-3-{before,after}.out` | **FOLD** (into `cli-auction` T1) |
| `r7-4-claim-refund-repro.mjs` | `claim-refund` completes exception-queue refunds; verify accepts correct exception states only (P1; live-state) | R7.4 (`062f74f`) | `repro/r7-4-{before,after,live}.out` | **FOLD** (into `cli-auction` T1's claim step) |
| `r7-5-reserve-opening-repro.mjs` | `publish()` emits `reserve_opening` after R; sealed-reserve product auctions settle and verify (P1) | R7.5 (`98fbdf8`) | `repro/r7-5-{before,after}.out` | **FOLD** (into `cli-auction` R1) |
| `r7-6-stray-refunds-repro.mjs` | stray refunds via the stray's own envelope/claim or the exception queue; `stray_refund_ua` dropped (P1) | R7.6 (`1fc9361`) | `repro/r7-6-{before,after}.out` | **FOLD** (into `cli-auction` T1) |
| `r7-claims-repro.mjs` | signer-side envelope-key pin, claim-griefing fix, publicly verifiable claims | R10.3 + R11 + R13 (`07c02bc`) | `repro/r7-claims-{before,after}.out` | **FOLD** (into `cli-auction` R1) |
| `r7-witness-repro.mjs` | gate X: witness certificates emitted and refused (never WARN) without a q_w certificate | R8 G10 (`6109fa3`) | `repro/r7-witness-after.out` | **RETIRE** (refusal asserted by `buyback-mode` X1a; verify checks run in every cold verify) |
| `republish.ts` | ops: rebuild a product auction's public dir from its ledger after a publisher fix | head commit `c4bd9fa` | none (used by the launch-miss repair) | **KEEP** (ops tool — no expected-value comparison, not a test) |
| `reserve-opening-repro.mjs` | signer re-derives the sealed reserve through one shared binding (R6 F2); mutation U7 red | R6 F2 (`c9ce558`) | `repro/f2-{before,after}.out`, `repro/r7-5-{before,after}.out`, `mutations/U7.out` | **FOLD** (into `cli-auction` R1) |
| `routing-vs-envelope-repro.mjs` | operator routing vs sealed-envelope destinations (F3/W2/5M2) | R6 F2 run (`c9ce558`; STATUS-B runs 26/27) | `repro/f3-{before,after}.out`, `mutations/5M2.out` | **RETIRE** (covered by `cli-auction` T1 "never operator routing" + `buyback-mode` W2) |
| `sweep-vault.ts` | ops: sweep the global dev vault back to the bidder wallet when a run's cleanup failed | head commit `fdc9f2b` | none | **KEEP** (ops tool — not a test) |
| `x-cancel-claims.ts` | cancelled-auction exception deposits claimed, host-attested, settled under host custody; amounts/destinations/verify checked | head commit `10a968e` (design §5/PHASE-5 part lanes) | `cancel-claims/xc.out` (its run record; not named inside) | **KEEP** (live evidence driver) |
| `x-witness-recompute.ts` | witnesses recompute the frozen root from their own vault scan; `witness sign` refuses what it cannot see (5 mutations) | head commit `91d9182` (design §5) | `x-witness/recompute-7885.out` (its run record; not named inside) | **KEEP** (live evidence driver) |
| `xchain-demos.sh` | wrapper: builds `xchain-demos.ts` from the tree, boots anvil + solana-test-validator, runs the target-chain half (`--local`) | STATUS-B run 30 item 2 (`ec5cb8a`) | `repro/xchain-demos-local.out`, `mutations/X2-a/X2-b.out` | **KEEP** (harness entry; forward exit status only) |
| `xchain-demos.ts` | the three cross-chain delivery demos (ERC-5564 stealth, Token-2022 CT, OTC deliver/release) incl. 35 `demo*-*` IDs; mutations X2-a/b red | STATUS-B run 30 item 2 (`ec5cb8a`; R31 item 2 governs the live flow) | `repro/xchain-demos-local.out`, `mutations/X2-a/X2-b.out`, `EVIDENCE.md`/`guide-operator.md` cites | **KEEP** (cross-chain demo harness) |
| `y1-per-auction-dkg.sh` | gate Y: per-auction DKG on the three signer hosts (fresh key/UA per auction; reuse/disagreement/global-key refused) | head commit `8ad081f` (PHASE-5 part 1 §2 gate Y) | `y1/y1.out` (its run record) | **KEEP** (live harness) |
| `y2-host-custody.ts` | gate Y live proof: host-custody settlement with the bob kill drill, no duplicate outputs, cold verify | head commit `01e72a7` | `y2/y2.out`, `y2-h7/`, `y2-r28/` (run records) | **KEEP** (live harness) |
| `fixtures/zcash-address-cases.json` | the 637-case address-classification corpus (input data for `r24-3i`/`g7`) | R24 item 3 (i) (`9f50fcf`) | `repro/r24-3i-classify-address.out`, `repro/g7-network.out` | **KEEP** (corpus data, not a script) |

### How many are "tests", and the consolidation proposal

Applying AGENTS.md literally ("any other committed script that runs our code and compares its output with an
expected value is a test"): **47 of the 50 files are tests** — everything except `sweep-vault.ts` and `republish.ts`
(ops tools, no comparison) and `xchain-demos.sh` (a wrapper that only forwards its child's exit status). With the7
e2e specs that is 54 committed tests against a ceiling of 8. The project is over its own rule; the fix is
consolidation, not redefinition. Every one of the 47 lands in exactly one of the three groups below (14 + 25 + 8).
Proposal for the head to rule on (nothing deleted or moved yet):

1. **Named gate evidence drivers and harnesses (14 files, KEEP):** `api-reference-check.ts`,
   `bidder-bundle-proof.ts`, `bidder-bundle-driver.mjs`, `markets.ts`,
   `mut-replay.ts`, `mut-replay-markets.ts`, `y1-per-auction-dkg.sh`, `y2-host-custody.ts`,
   `x-witness-recompute.ts`, `x-cancel-claims.ts`, `xchain-demos.ts`, `r28-replay.ts`, `r33-balance.ts`
   (Track A's; the head assigns it), `r14-devnet-deploy-cycle.sh` (the BLOCKED one-command repro AGENTS.md
   requires). Proposal: one Ruling line extends PHASE-6 §3's "scale and leak audit are evidence runs, not
   specs" to name this list — each runs only as its named gate's evidence run, a spec's live harness, or the
   mutation procedure's replay, exactly like `npm run bench` and `npm run leak-audit`. Their comparisons belong
   to the gate or the spec they drive, not to a standalone test.
2. **Fold 25 scripts into their owners (FOLD), then delete them under the Ruling:** `batching-equal.ts` folds
   into the `npm run bench` batch-plan stage (gate SC's existing evidence run); the other 24 fold into the
   owning spec as Ruling-added assertion IDs — verify/envelope/claims read path (g-forged-claim, g1, g2, kc, mr,
   r10-2, r10-4, r15-3, r15-verify-leaves, r16-1, r16-4, r23-2, r23-3, r26-1, r26-3, r7-1…r7-6, r7-claims,
   reserve-opening → `cli-auction.spec.ts`, whose R1/T1/S1 steps already run `benzo verify` and the read API
   over corpora); g7-network → `auction-core.spec.ts` (F family). Each folded ID keeps its mutation `.patch`, 
   re-pointed at the spec run, as its red proof — no assertion loses its fail-proof.
3. **Retire 8 superseded/covered one-shots (RETIRE):** g3 (superseded), obligations-equal (one-shot
   equivalence), r10-5 (config default), r16-memo-bound (asserted by seal-open C1/C7 + cli-auction P1), r24-3i
   (one-shot swap; the corpus stays in `fixtures/`), r5-fund-quote (coverage gap named above), r7-witness
   (covered by buyback X1a), routing-vs-envelope (covered by cli-auction T1 + buyback W2). Their `.out` evidence
   and mutation patches stay committed either way.

The three files already outside the definition — `sweep-vault.ts`, `republish.ts` (ops, no comparison) and
`xchain-demos.sh` (exit-status wrapper) — plus the `fixtures/` corpus need no action. After (1)–(3): 8 tests
(the 7 specs + the reserved slot), 14 named gate evidence drivers (never run as tests), 2 ops tools, 1 corpus.
The rule's letter and its intent (8 end-to-end tests against real dependencies; everything else is evidence or
a check) both hold. The head rules first; deletions happen only under that Ruling.
