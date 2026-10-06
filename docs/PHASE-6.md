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

- R29 2026-10-05 (head): **Parallel single-message signing replaces option A.** Settling one spend at a time cost ~8.1 s per spend (`docs/evidence/phase-6/scale-measure.md`). Reading the pinned frost-tools again showed that its participant both confirms and signs only the first message of a session, so a multi-message session (option A) would need a patch to the signing tool. It also showed that the participant can join a named session (`-S`). Only the earlier one-session limit came from joining without a session ID. Ruling:
  1. Under host custody, settlement opens **one single-message coordinator session per spend, all at once**, on the pair's first host (`settle/sign.ts signParallelHost`). The frost-tools pin is unchanged and no tool is patched.
  2. The randomizers come from the Mac's own `benzo-pczt inspect` of the same PCZT (new `randomizers` field: pool, action index, alpha, in zcash-sign's order). Each zcash-sign prompt must name the same pool, index and alpha in order, or the round stops before any signature is handed over. zcash-sign must also take every signature.
  3. A host joins with `benzo sign join --count N`. It requires an approval of that sighash on this host whose `spends` equals N (`sign approve` now records `spends` from its own inspect). It lists its open sessions and requires exactly N, joins each one with `-S`, and answers each session's prompt against the approved sighash, as before. The **sighash is the security boundary**. A share with any other randomizer verifies under a different rk, so it cannot authorize anything but this approved transaction. The count is a consistency check, not a limit: approvals are not consumed. Head review (Claude subagent, 2026-10-05) found no P0. Its P1: stale sessions from a failed coordinator blocked the retry, because frostd lets only the coordinator close a session. Fixed: every host runs close-all in rounds before each attempt and after a failure. Its P2s, also fixed: the participant evidence (`participantsSaw` is now the sighash only if a host printed it for all N sessions), coordinator setup errors are attributed to the coordinator host, and one failed join on a host stops its other joins.
  4. Signing stays under the machine-wide signing lock, with the per-attempt close-all. That makes every session a host lists during the round part of the round.
  5. `BNZ_SERIAL_SIGN=1` keeps the old one-session-at-a-time path, for comparison.
- R30 2026-10-05 (head, **proven live**: scale-27, 28 spends + 28 outputs in one batch, raw tx 94,380 bytes, `docs/evidence/phase-6/scale-measure.md`): **`batch_cap` up to 28 (option B).** 13 was a conservative default, not a protocol limit. One Orchard/Ironwood action is ~884 bytes plus ~2,272 bytes of proof, so 28 outputs (≤ 29 actions) keeps a batch transaction under 100 KB, the conservative standard-transaction size. Signing cost no longer grows with spends (R29), so fewer, larger batches cut the per-batch build and approval overhead by about 2×. Changed: `auction create`/publish validation (`batch_cap` 1–28), the host `sign build` row bound and `benzo-pczt create` (1–28 recipients). Proof: `tools/repro/markets.ts scale-27` (27 bids + the seller = 28 outputs, 28 spends, one batch, fee reserve 200,000). The cap stays at 13 in every existing scenario.
- R32 2026-10-06 (head, answers STATUS-B run 31 Questions):
  1. **Verify bundle provenance.** `dist/benzo-verify.mjs` is only ever produced by `npm run build:verify` run from the root of the checkout that commits it, with that checkout's own `node_modules`. The head's B30 merge was built in a temporary worktree with a linked `node_modules`, which embedded the other checkout's paths. B's forward fix `973feac` is the accepted bundle. Any future merge resolves the bundle and hash by rebuilding in the real checkout after the merge.
  2. **e2e frostd port.** `e2e/lib/frost.ts startFrostd` binds the port from `BNZ_FROSTD_ADDR` (`-p`), never frostd's default :2744 (head fix on track-b, this commit).
- R34 2026-10-06 (head, answers STATUS-B run 32 Questions):
  1. **API-reference privacy wording: the narrower claim.** The doc states that no route returns bid plaintext before R and that no route returns any **Zcash** refund or payout destination. `GET /allocation` (launch) serves the delivery batch's **token-chain** destinations by design (DESIGN §9 asset delivery: fresh destinations, sealed in the envelope until R), and the doc names it as the one destination-bearing output.
  2. **Launch delivery row order: fix it (hardening; Track A, after A15).** `deliveryBatch` emits rows in winner leaf order, so `/allocation` row positions correlate each fresh delivery destination with a winning leaf, and hence with its public bid. The fix: rows sorted canonically by destination bytes (then amount), with the allocation root computed over that order, and `benzo verify` replaying the same sort. Builder A does it after A15. Builder B's API reference then documents the sorted order.
- R35 2026-10-06 (head, rules on B33's `docs/evidence/phase-6/test-audit.md` proposal). The audit is accepted: by AGENTS.md's literal definition the tree carries 54 tests against a ceiling of 8, and the fix is consolidation. Ruling:
  1. **KEEP: 14 named gate evidence drivers and harnesses**, the list in test-audit.md §(b) group 1. PHASE-6 §3's "scale and leak audit are evidence runs, not specs" now names them too. Each runs only as its named gate's evidence run, a spec's live harness, or a mutation replay. Its comparisons belong to the gate or spec it drives. **A new script joins this list only by Ruling.**
  2. **RETIRE now: the 8 superseded one-shots** in group 3. Builder B deletes them in B33, together with any `package.json` or doc reference to them. Their `.out` evidence, patches and the `fixtures/` corpus stay committed.
  3. **FOLD: the 25 scripts in group 2, in two steps.**
     - **(a) B33:** Builder B writes the folded assertions into the owning specs, `cli-auction.spec.ts` (read path: verify, envelope, claims) and `auction-core.spec.ts` (g7-network). Each new ID gets the four AGENTS.md answers in the file header, and its existing mutation `.patch` is re-pointed at the spec run. `batching-equal` folds into `npm run bench`. **B deletes nothing in group 2 yet.**
     - **(b) The final regression (gate RG, head/Track A, live):** each folded ID must pass, and then turn red under its re-pointed mutation. Only after that are the 25 scripts deleted, in one head commit that cites the RG evidence.
  4. After (3b): 8 tests (7 specs + the reserved browser-bid slot), 14 drivers, 2 ops tools (`sweep-vault.ts`, `republish.ts`), 1 wrapper (`xchain-demos.sh`), and 1 corpus.
- R36 2026-10-06 (head; **user instruction 2026-10-06 ~22:00Z, verbatim: "no public"**, asked which license the repo ships with): **the repository stays private.** No open-source license: B33's MIT `LICENSE` is removed and `package.json` says `"license": "UNLICENSED"` (it stays `"private": true`). PHASE-6's "public-repo hygiene" becomes **private-repo hygiene**: keep every secret, leak and absolute-path check (good practice, and the submission may still share code with judges), and drop only the license line. The recorded `npm run package` digests change with `package.json`, so Builder B refreshes them in `docs/reproducible-build.md` and the PK evidence in its next packaging step. Never make the repo or any part of it public without the user.
- R37 2026-10-06 (head, answers STATUS-B run 33 Questions 4–5; Q1 answered by R36, Q2 by R35, Q3 by `834e465`):
  4. **The live emit leg of `r7-5` (`publish` carries `reserve_opening` after R)** joins the markets harness's `drop` scenario, which already has a `sealed_reserve`, as an assertion in `e2e/markets.spec.ts`. Track A adds it, and it is proven at the final regression RG. The spec's own manifest stays as it is.
  5. **`cli/build.mjs` now cleans `cli/dist` before building** (head, `373a697`). Builder B rebuilds the npm package and bidder-bundle digests from a clean build in its next packaging refresh, together with R36's `package.json` change.
  - B33 merge note: A15 made the network a parameter of `sealEnvelope`/`openEnvelope`. The head passed `"test"` in `e2e/lib/readpath.ts` (`5de3495`), and B's scratch fold harness passes on the merged tree.

