# Phase 6: hardening, scale and packaging (testnet complete)

- **Status: DRAFT.** The head finalises this contract when Phase 5 is READY FOR REVIEW; until then it is planning only and nobody builds against it.
- **Window:** after the head commits Phase 5 PASSED (Track B may start its offline items once its Phase 5 work is merged). Target **2026-10-18**. Feature freeze **Oct 24**.
- **Networks:** Zcash testnet (NU7 active) + drand mainnet quicknet. **No mainnet transaction.**
- **Ownership:** head agent owns this file. Track A in `docs/STATUS.md`, Track B in `docs/STATUS-B.md`. Artifacts in `docs/evidence/phase-6/`.
- **Still locked:** R6 — **no frontend**. Phase 7 (last) is the user's frontend on the JSON API plus the mainnet release; Phase 8 is submission.

## 1. Goal and finish line

After Phase 5 the product is feature-complete on the CLI. This phase makes it **trustworthy, fast enough and installable by a stranger**, so Phase 7 is only UI and mainnet. No new product features.

| Gate | Question |
|---|---|
| H | Is every **P0 threat** in `docs/research/threat-model.md` (34 rows) either closed on the live path with a pointer to the code + evidence that closes it, or explicitly disclosed as a trust boundary in the README's honest-limits section? |
| SC | **Scale.** Offline: do 17,000 synthetic sealed bids (the organizer's 48-hour volume) pass admission, freeze, open, clear and settlement batching within stated time and memory, with the result reproduced by `benzo verify`? Live: what is the largest testnet auction TAZ allows (target ≥ 50 bids, ≥ 4 settlement batches), and does it settle cleanly? |
| LA | **Leak audit.** Do logs, public dirs, API responses, evidence, crash dumps and git history contain no bid plaintext before R, no refund/delivery addresses, no keys, mnemonics, UFVKs or envelope plaintext? Automated scan + manual review, run on the final regression's full output. |
| PK | **Packaging.** Can a stranger on a clean machine install a pinned CLI (npm package or single binary + reproducible build instructions), run `benzo verify` on a published auction from outside any checkout (no `git rev-parse`; fully offline tlock re-derivation from the published beacon signature), and seal a bid with the bidder bundle? |
| DOC | **Docs.** README (claim, honest limits verbatim from DESIGN §14 updated by H), operator guide, bidder guide, signer guide, "verify it yourself" guide, API reference for the UI. Each guide followed literally by the head on a clean checkout. |
| RG | **Regression.** All specs (Phases 1–5) pass at one commit on post-NU7 testnet; every earlier mutation set is re-shown red at least once on the final code. |

**Finish line.** Gates H, SC, LA, PK, DOC, RG READY FOR REVIEW with evidence and one-command repros; `verify.sh` positive + corrupted copy; public-repo hygiene done (license, no secrets in history, `.env.example` only, pinned lockfiles); STATUS READY FOR REVIEW. **No frontend files. No mainnet.**

## 2. Work split (draft)

### Track B (offline)
1. Offline scale benchmark: synthetic-bid generator (sealed with real tlock to a past round), admission → freeze → open → clear → batch plan at 17,000 bids; timings and memory in EVIDENCE; `benzo verify` on the result.
2. Leak-audit tool (scripted scan over logs, public dirs, API output, evidence, `git log -p`), plus its findings list.
3. Packaging: npm package or single binary for `benzo` read paths and the bidder bundle; offline tlock re-derivation in `verify` (R21 item 7); reproducible-build notes.
4. Docs: README, the five guides, API reference for the UI.
5. Public-repo hygiene checklist.

### Track A (live)
1. P0 closure table for H: walk all 34 P0 rows, link code + evidence, close gaps on the live path, list disclosures.
2. Live scale run: largest auction TAZ allows (ask the user for TAZ if needed), multi-batch settlement, measured fees and timings.
3. Post-NU7 full regression (RG) and the mutation re-runs.
4. Apply schema/packaging changes that touch Track A files; final evidence.

## 3. Tests

Ceiling 8. After Phase 5 part 2: 7 used (`markets.spec.ts`), 1 reserved for the user's browser bid flow. This phase adds **none**; scale and leak audit are evidence runs, not specs.

## 4. Traps

1. Synthetic bids must go through the real seal and real tlock, not stubbed ciphertexts.
2. The leak scan must include the git history the public repo will ship, not only the working tree.
3. Packaging must not pull unpinned dependencies or network fetches into `verify`.
4. Do not "close" a P0 by rewording it; closure needs code + evidence, otherwise it is a disclosed limit.
5. Testnet TAZ: ask before any spend that would drop the bidder below 3C + 40,000 zats.

## 5. Budget

Draft: +700 hand-written lines (Track B ~450 incl. generator/scan/packaging glue, Track A ~250). Docs prose excluded.

## 5a. Research adoptions (R3 of Phase 5, 2026-10-02) — part of this phase's gates
- **DOC headline:** README, the results page and the video's first 10 seconds use the organizer's own track words: *“the price should be public and the participants should not.”* State the honest limit plainly: all bids open (anonymised) at R; losing bids are not secret forever.
- **DOC “Why drand timelock is safe enough here”:** threshold beacon; exact UTC for R (genesis + 3 s × (R−1)); witnessed root before R; no-decrypt C refunds if the beacon never arrives; real escrowed ZEC, not commitments (answers the Starknet STRK20 RFP's timelock objection).
- **Evidence checklist = Logos LP-0004 criteria:** ≥ 5 complete testnet auction cycles with ≥ 3 distinct bidders each (plus the Phase 7 mainnet one), refunds not linkable to bids, restart/resume drill, refund-failure recovery, fee benchmarks (zats per bid / clear / refund), and a **narrated** demo video. One EVIDENCE table row per auction: frozen root, drand round, bidders, txids, `benzo verify` output, fees.
- **H gate:** record the signer-binding (Phase 5 R3 item 8) and the mid-batch signer-kill drill as the evidence for threat-model #13/#15.

## 6. Rulings

(none yet; contract not final)
