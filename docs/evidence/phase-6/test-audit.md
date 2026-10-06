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
  be re-run offline; the other five need the live testnet lane. *(B35: superseded by the RG table in (c) — M2 and the
  fold rows also re-ran offline; the whole offline half is re-shown red at `6802a2f`.)*

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

## (c) Gate RG mutation table (batch B35, the offline half; the live half runs at the head's final regression)

Every mutation ID in the project (87). "Last red" is the newest committed record of that ID turning red,
with the commit the red ran at. "Re-shown" marks the batch-B35 re-runs at `6802a2f` (`mutations/<ID>-rg.out`,
each: clean tree, `git apply`, run, `git apply -R`, `git status --porcelain` clean, red then green). The
command column gives the one command for the head at the live RG; command form for the spec rows is
`git apply docs/evidence/<phase>/mutations/<ID>.patch && BNZ_LIVE=1 npx playwright test --project=<project>`
and the expected red is the ERROR line in the ID's record file. **⚠re-cut** = `git apply --check` fails at
`6802a2f` (source drifted since the red) — re-cut the same semantic mutation first (B33/B35 precedent).
"local" rows need only anvil/solana-test-validator/forge (no testnet); "retired driver" rows were R35.2
one-shots whose scripts are deleted at RG and whose evidence stands (or is covered by a named spec).

| ID | Last red (record @ run commit) | Re-shown red at `6802a2f`? | The one command at the live RG |
|---|---|---|---|
| M1 | `phase-1/mutations/M1.out` @ `36913b6` (ERROR C2) | **yes** (`M1-rg.out`, ERROR C2+C6) | — (offline: `npm run e2e`) |
| M2 | `M2.out` @ `36913b6` (ERROR C7) | **yes** (`M2-rg.out`, ERROR C7) | — (offline: `npm run e2e`) |
| M3 | `M3.out` @ `36913b6` (ERROR C5) | **yes** (`M3-rg.out`, ERROR C5) | — (offline: `npm run e2e`) |
| M4 | `M4.out` @ `36913b6` (ERROR C4) | **yes** (`M4-rg.out`, ERROR C4) | — (offline: `npm run e2e`) |
| M5 | `M5.out` @ `4c5e4a9` (ERROR A4 A5 B1 D1) | no | live: ⚠re-cut + `--project=testnet-golden-path` |
| M6 | `M6.out` @ `4c5e4a9` (ERROR B1 D1) | no | live: ⚠re-cut + `--project=testnet-golden-path` |
| M7 | `M7.out` @ `4c5e4a9` (ERROR B1 D1; mutates the spec itself — harness control) | no | live: apply + `--project=testnet-golden-path` |
| N1 | `phase-4/mutations/N1-regression.out` @ `3174c60` (ERROR E1 I1; `N1.out` @ `c58cdd4`) | no | live: apply + `--project=auction-core` |
| N2 | `phase-2/mutations/N2.out` @ `e04e060` (ERROR E2 H4) | no | live: ⚠re-cut + `--project=auction-core` |
| N3 | `N3.out` @ `3f723de` (ERROR F2 G1) | no | live: ⚠re-cut + `--project=auction-core` |
| N4 | `N4.out` @ `58e1385` (ERROR G1 G2) | no | live: ⚠re-cut + `--project=auction-core` |
| N5 | `N5.out` @ `36d0aa9` (ERROR H2 H3) | no | live: apply + `--project=auction-core` |
| N6 | `N6.out` @ `f8707e0` (ERROR H3 F1) | no | live: apply + `--project=auction-core` |
| N7 | `N7.out` @ `b68d7ab` (ERROR I1) | no | live: apply + `--project=auction-core` |
| P1 | `phase-4/mutations/P1-expiry.out` @ `47b665f` (ERROR J1 J2 K1 L1 N1; `P1.out` @ `311f1d2`, `P1-regression.out` @ `15c8c63`) | no | live: apply + `--project=settle-crash` |
| P2 | `phase-3/mutations/P2.out` @ `5bcb5ec` (ERROR J1) | no | live: ⚠re-cut + `--project=settle-crash` |
| P3 | `P3.out` @ `da560d5` (ERROR M1) | no | live: ⚠re-cut + `--project=settle-crash` |
| U1 | `phase-4/mutations/U1.out` @ `3e199c5` (ERROR O2 P2; `U1-t1.out` @ `27990ca`) | no | live: ⚠re-cut + `--project=cli-auction` |
| U2 | `U2.out` @ `0825666` (ERROR S1) | no | live: apply + `--project=cli-auction` |
| U3 | `U3.out` @ `960f95f` (ERROR R1) | no | live: ⚠re-cut + `--project=cli-auction` |
| U3a | `U3a.out` @ `b99b161` (ERROR R1) | no | live: apply + `--project=cli-auction` |
| U3b | `U3b.out` @ `9c0e35b` (ERROR R1) | no | live: ⚠re-cut + `--project=cli-auction` |
| U4 | `U4.out` @ `960f95f` (ERROR T4) | no | live: ⚠re-cut + `--project=cli-auction` |
| U5 | `U5.out` @ `960f95f` (ERROR T1; `U5-expiry.out` @ `6ec2c30`) | no | live: ⚠re-cut + `--project=cli-auction` |
| U6 | `U6-rerun.out` @ `5296081` (ERROR T1; `U6.out` @ `bd6823f`) | no | live: ⚠re-cut + `--project=cli-auction` |
| 5M1 | `phase-5/mutations/5M1.out` @ `cfd2f84`-era replay (FAIL V1b) | **yes** (`5M1-rg.out`) | — (offline: `mut-replay.ts`) |
| 5M2 | `5M2.out` @ `ecc8368` (ERROR 5M2) | no | live: ⚠re-cut + `--project=buyback-mode` |
| 5M2-host | `5M2-host.out` (live run 2026-10-04T23:50Z, W2 FAIL, deployed with 5M4) | no | live host: ⚠re-cut + `--project=buyback-mode` (together with 5M4; expect W2/W1 FAIL) |
| 5M3 | `5M3.out` @ `cfd2f84`-era replay (FAIL X1b) | **yes** (`5M3-rg.out`) | — (offline: `mut-replay.ts`) |
| 5M4 | `5M4.out` (live run 2026-10-04T23:50Z, W1 FAIL, deployed with 5M2-host) | no | live host: apply + `--project=buyback-mode` (together with 5M2-host) |
| 5M5 | `5M5.out` (live run 2026-10-04T23:13Z, ERROR Y1a; deployed to the three signer hosts) | no | live host: deploy `5M5.patch` to the three signer hosts + `--project=buyback-mode` |
| 5M6 | `5M6.out` @ `baad59b` (ERROR drop-defaults-window) | **yes** (`5M6-rg.out`) | — (offline: `mut-replay-markets.ts`) |
| 5M7 | `5M7.out` @ `baad59b` (ERROR drop-forfeit) | **yes** (`5M7-rg.out`) | — (offline: `mut-replay-markets.ts`) |
| 5M8 | `5M8.out` @ `7dcaeda` (ERROR revision) | **yes** (`5M8-rg.out`) | — (offline: `mut-replay-markets.ts`) |
| 5M9 | `5M9.out` @ `7dcaeda` (ERROR rfq) | **yes** (`5M9-rg.out`) | — (offline: `mut-replay-markets.ts`) |
| 5M10 | `5M10.out` @ `7dcaeda` (ERROR rfq) | **yes** (`5M10-rg.out`) | — (offline: `mut-replay-markets.ts`) |
| 5M11 | `5M11.out` @ `baad59b` (ERROR drop-swapped-defaults-refused) | **yes** (`5M11-rg.out`) | — (offline: `mut-replay-markets.ts`) |
| R14-F1 | `phase-5/mutations/R14-F1.out` @ `c7c417c` (ERROR cpi-forged-submit-refused) | no | local: apply + `bash contracts/solana/test/run.sh` |
| R14-F3 | `R14-F3.out` @ `319a09c` (forge `test_approval_exposes_stored_fields` FAILs) | no | local: apply + `(cd contracts/evm && forge test --match-contract ApprovalGetter)` |
| R14-F3b | `R14-F3b.out` @ `319a09c` (ERROR demo-status-result-hash-mismatch-refused) | no | local: apply + `bash crosschain/local-demo.sh` |
| R15-F4a | `R15-F4a.out` @ `e1b55da` (ERROR r15-machine-runs-without-records) | **yes** (`R15-F4a-rg.out`, fold harness) | — (offline: `tmp/folds.config.ts`) |
| R15-F4b | `R15-F4b.out` @ `e1b55da` (ERROR r15-strangers-refused) | **yes** (`R15-F4b-rg.out`; patch re-cut at B35) | — |
| R15-F5 | `R15-F5.out` @ `e1b55da` (ERROR r15-zero-refund-needs-no-row) | **yes** (`R15-F5-rg.out`) | — |
| R16-2a | `R16-2a.out` @ `8f7b156` (ERROR r16-v1-still-readable / r16-cancel-before-r) | no | retired driver (R35.2; folded seams: seal-open C1/C7 + cli-auction P1); no separate command |
| R16-2b | `R16-2b.out` @ `8f7b156` (ERROR r16-bid-seal-v2) | no | retired driver (as above); no separate command |
| R16-F2a | `R16-F2a.out` @ `e1b55da` (ERROR r15-phase2-4) | **yes** (`R16-F2a-rg.out`) | — |
| R17-4a | `R17-4a.out` @ `e58e3f9` (ERROR demo-attest-result-hash-mismatch-refused) | no | local: apply + `bash crosschain/local-demo.sh` |
| R17-4b | `R17-4b.out` @ `519da8a` (ERROR demo-attest-allocation-mismatch-refused) | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R19-a | `R19-a.out` @ `2649f4b` (ERROR demo-attest-both-chains) | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R19-b | `R19-b.out` @ `2649f4b` | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R19-c | `R19-c.out` @ `2649f4b` | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R21-a | `R21-a.out` @ `9910f85` (ERROR demo-attest-both-chains) | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R21-b | `R21-b.out` @ `9910f85` | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R21-c | `R21-c.out` @ `9910f85` | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R22-a | `R22-a-rerun-r27.out` @ `ded3595` (ERROR xchain result hash mismatch; `R22-a.out` @ `97567fa`) | no | local: apply + `bash crosschain/local-demo.sh` |
| R22-b | `R22-b.out` @ `97567fa` | no | local: apply + `bash crosschain/local-demo.sh` |
| R23-2 | `R23-2.out` @ `9a48cb3` (ERROR r23-2-report-signed) | **yes** (`R23-2-revert-rg.out`; the re-pointed `R23-2-revert.patch`, re-cut at B35) | — |
| R23-3a | `R23-3a.out` @ `e0151bb` (ERROR r23-3-api-claims-no-beacon) | **yes** (`R23-3a-rg.out`) | — |
| R25-1a | `R25-1a.out` @ `be91c62` (ERROR stealth-link-probe-fails) | no | local: ⚠re-cut + `bash crosschain/stealth-demo.sh` |
| R25-1b | `R25-1b.out` @ `be91c62` | no | local: apply + `bash crosschain/stealth-demo.sh` |
| R25-2a | `R25-2a.out` @ `c8d82cd` (ERROR xchain result hash mismatch) | no | local: apply + `bash crosschain/local-demo.sh` |
| R25-2b | `R25-2b.out` @ `c8d82cd` | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R25-3a | `R25-3a.out` @ `45baa16` | no | local: apply + `bash crosschain/local-demo.sh` |
| R25-3b | `R25-3b.out` @ `45baa16` | no | local: apply + `bash crosschain/local-demo.sh` |
| R25-3c | `R25-3c.out` @ `45baa16` | no | local: ⚠re-cut + `bash crosschain/local-demo.sh` |
| R25-4a | `R25-4a.out` @ `493e84e` | no | local: apply + `bash crosschain/local-demo.sh` |
| R25-4b | `R25-4b.out` @ `493e84e` | no | local: apply + `bash crosschain/local-demo.sh` |
| R25-6a | `R25-6a.out` @ `2659f3d` (ERROR xchain --nonce argument) | no | local: apply + `bash crosschain/stealth-demo.sh` |
| R25-6b | `R25-6b.out` @ `2659f3d` | no | local: apply + `bash crosschain/stealth-demo.sh` |
| R7M1 | `R7M1.out` @ `8a37993` (ERROR T1) | no | live: ⚠re-cut + `--project=cli-auction` |
| S2-a | `S2-a.out` @ `2132dd5` (ERROR stealth-release-pays-with-stipend) | no | local: apply + `bash crosschain/stealth-demo.sh` |
| S2-b | `S2-b.out` @ `2132dd5` | no | local: ⚠re-cut + `bash crosschain/stealth-demo.sh` |
| S3-a | `S3-a.out` @ `8a52106` (ERROR ct-deliver-elgamal-matches) | no | live devnet: apply + `bash crosschain/ct-live.sh` |
| S3-b | `S3-b.out` @ `8a52106` | no | live devnet: apply + `bash crosschain/ct-live.sh` |
| S5-a | `S5-a.out` @ `6606298` (ERROR fund quote) | no | retired driver (R35.2, `r5-fund-quote-repro.mjs` deleted; the coverage gap is named in (a)); no command |
| U7 | `phase-5/mutations/U7.out` @ `877327d` (ERROR U7) | **yes** (`U7-rg.out`) | — (offline: `tmp/folds.config.ts`, build:core) |
| X1-a | `X1-a.out` @ `b74a28a` (ERROR host-release-third-party-refused) | no | local: apply + `bash crosschain/host-attest-demo.sh` |
| X1-b | `X1-b.out` @ `b74a28a` (ERROR host-release-swapped-destination-refused) | no | local: apply + `bash crosschain/host-attest-demo.sh` |
| X2-a | `X2-a.out` @ `ec5cb8a` (ERROR demo1-payouts-match-result) | no | local: apply + `bash tools/repro/xchain-demos.sh demo1` |
| X2-b | `X2-b.out` @ `ec5cb8a` (ERROR demo2-no-zcash-on-chain) | no | local: apply + `bash tools/repro/xchain-demos.sh demo2` |
| X3-a | `X3-a.out` @ `37ac903` (ERROR g7-mainnet-ua-refused-on-test) | no | live: apply (re-pointed at the g7 fold) + `BNZ_LIVE=1 npx playwright test --project=auction-core` |
| B31-a | `phase-6/mutations/B31-a.out` @ `973feac` (ERROR batching-equal-cap13; `B31-a-rerun-r33.out` @ `cb4bcab`) | **yes** (`B31-a-rg.out`) | — (offline: `npm run bench -- --stage batch-plan`) |
| B32-a | `B32-a.out` @ `f5a022a` (ERROR shape.auction missing leaf_count) | **yes** (`B32-a-rg.out`) | — (offline: `api-reference-check`) |
| R24-3i-a | `R24-3i-a.out` @ `6b0d24c` (settle/src/main.rs typecodes swapped) | no | retired driver (R35.2; the corpus stays in `fixtures/`, g7-* covers the checks); no command |
| R24-3i-b | `R24-3i-b.out` @ `6b0d24c` (envelope/destination.ts wrong-network rule disabled) | no | retired driver (as above; patch ⚠re-cut); no command |
| R26-3a | `R26-3a.out` @ `82b3590` (ERROR r26-3-opened-diverges) | **yes** (`R26-3a-rg.out`) | — (offline: `tmp/folds.config.ts`) |
| R26-3b | `R26-3b.out` @ `82b3590` (ERROR r26-3-projection-without-field) | **yes** (`R26-3b-rg.out`) | — (offline: `tmp/folds.config.ts`) |

Counts: 87 IDs — 23 re-shown red at `6802a2f` (the whole offline half: seal-open M1–M4, replays 5M1/5M3/5M6–5M11,
B31-a, B32-a, the 9 offline folded IDs), 29 live-only (the live spec rows + the signer-host rows + X3-a, R7M1,
S3-a/b), 30 local-validator rows (anvil/solana-test-validator/forge demos), 5 retired-driver rows. Notes:
- The B35 re-runs use each harness's own failure convention: `mut-replay.ts` prints `FAIL V1b`/`FAIL X1b` (the
  buyback replay convention, unchanged since the committed `5M1.out`/`5M3.out`); everything else prints
  `ERROR <id>`.
- The B35 runs of `mut-replay-markets.ts` pass no launch dir: its A16 `launch-meet-allocation-order` leg's
  `decorrelated` check fails even unmutated on the committed `cold-f1170469` corpus (canonical=true
  decorrelated=false) — a corpus/leg issue for Track A (see STATUS-B Questions), not needed for 5M6–5M11.
- The first U7 pair rebuilt only `cli/dist`, so the mutation never reached `manifest/dist/reserve.mjs` (the
  fold drives that bundle via `build:core`); its green "red run" is not evidence and the recorded pair re-ran
  with `npm run build:core`.
- `e2e/lib/readpath.ts`'s owner_sig tamper was fixed in B35 (it is a no-op for the ~9% of Ed25519 signatures
  whose last byte is already 0x00 — 26/300 measured; commit `77d401f`). Re-runs after the fix are deterministic.
