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
- R39 2026-10-06 (head, answers STATUS-B run 35 Questions):
  1. **The superset is accepted.** B35 re-showed red every mutation that can be shown offline, including M1/M3/M4 and 5M6/5M7/5M11 beyond the listed bullets. The extra `-rg.out` records stay.
  2. **A16's `decorrelated` launch check is wrong and is replaced (Track A).** R34.2 requires delivery rows in **canonical order**, not in an order that differs from winner-leaf order: with few rows the two coincide by chance (`markets/launch/cold-f1170469`, 50% for two rows), so the check fails on correct data. The assertion becomes "rows are in canonical order (destination bytes, then amount), and the allocation root is over that order". Mutation A16-a is shown red on a corpus where leaf order differs from canonical order, or by sorting rows in reverse. `mut-replay-markets.ts`'s launch leg then runs on the committed corpus.

- R47 2026-10-08 (head, gate RG precondition):
  1. **The pinned-binary check accepts R27's NU7 path builds.** Since R27 and the A20 state rebuild, `tools/nu7/build.sh` installs `zcash-devtool` and `zcash-sign` with `cargo install --path` from the pinned rev's verified source (`<state>/src/zcash-devtool-<DEVTOOL_REV>`, `<state>/src/frost-tools-<FROST_TOOLS_REV>/zcash-sign`). `cargo install --list` then records that path, not `?rev=<rev>#`. The first RG launch at `7cad087` reported both live projects NOT RUN for this reason. `e2e/testnet-golden-path.spec.ts` and `e2e/auction-core.spec.ts` now accept either form, as `e2e/cli-auction.spec.ts` already did. This is a harness fix: no product or host code changed.
  2. **The hosts stay provisioned at `ec5b997`.** The RG run is valid at a later `RG_COMMIT` if `git diff --stat ec5b997 RG_COMMIT` touches only `e2e/`, `docs/` and `deploy/signers/manifest.json`. The head records that diff in the RG evidence. Any change to host code means running `deploy/signers/up.sh` again.
  3. **The live specs follow R27's single-endpoint rule.** The second launch at `29d8c99` reported `testnet-golden-path` NOT RUN: `zaino.testnet.unsafe.zec.rocks` answers `Unavailable`, and `testnet.zec.rocks` is the only public NU7 testnet endpoint (R27). The earlier `settle-crash` failure was the same endpoint. `settle/io.ts` `lwdEndpoints()` already settles on the primary endpoint alone under `BNZ_LWD_SINGLE=1` (testnet only, R28 item 10), and `e2e/cli-auction.spec.ts` already followed it. `testnet-golden-path`, `auction-core` and `settle-crash` now do the same through `e2e/lib/env.ts` `LWD`/`LWD_ALT`. Without the flag, every second-endpoint check runs as before. With it, the checks that compare heights or transactions across the two endpoints (A1, I1, the settle-crash `proofs` pair) are not run, and the evidence records `none (BNZ_LWD_SINGLE=1, R27/R47)` where the second height used to be. This is a narrower claim, not a passing check. The second-endpoint agreement is proven again on mainnet, where `BNZ_LWD_SINGLE` is refused.
  4. The serial run restarts from project #1 at the new `RG_COMMIT`.
  5. **Evidence is committed between projects.** `e2e/lib/global-setup.ts` refuses an evidence run on a dirty tree, and one project's new evidence would block the next project. The runner commits `docs/evidence/phase-6/rg/<project>` (`evidence:` prefix) after each project. `RG_COMMIT` (`f8e1ac2`) is the code commit. Each later project's `run.json` names an evidence commit, and `git diff --stat f8e1ac2 <that commit>` touches only `docs/evidence/phase-6/rg/`. The head records those diffs in the RG row.
  6. **`settle-crash` is a stale harness, not a product fault.** Its last live pass was Phase 3 (`cd62d45`). Its hand-built manifest never gained R10/R16.5's pinned signer envelope keys, so `settle/plan.ts` refused with "signer envelope key missing" and all six IDs went red at `b18d7a5`. Both fundings were recovered by the spec's own fund recovery (`b8fc2201…`, `c621f147…`). The spec now creates the keys with `benzo sign envelope-key` and pins `envelope_keys`, as `cli-auction` does. Only `settle-crash` re-runs (phase6-rg §2: a harness fix re-runs its project). No product code changed.
- R48 2026-10-08 (head, gate RG product fix): **every lightwalletd call is time-bounded.**
  1. **The finding.** In RG attempt 3 (`266fd0f`), `cli-auction` hung on a `zcash-devtool wallet sync` inside `auction admit` for 51 min. The process was at 0 CPU with its TCP connection to `testnet.zec.rocks` still open: a stalled server stream. Nothing in the product bounded it, so a real coordinator would have hung forever. The head killed the process, the spec went red, and the spec's cleanup swept the vault (`540ccbc5…`; the vault total is 0).
  2. **The fix.** `settle/bounded.ts` bounds every child process that talks to a lightwalletd server (grpcurl, or zcash-devtool given `-s`). The default is 600 s (`BNZ_LWD_TIMEOUT_MS`), killed with SIGKILL. A timeout throws `… stalled lightwalletd stream`, which the transient-retry patterns treat like `Unavailable`. Wallet sync is incremental, so a retry resumes from the last scanned block. The fix applies in `settle/io.ts` (`run`; `wallet` now retries `enhance` as well as `sync`), `settle/plan.ts`, `clear/auction-cli.ts` (sync and enhance retried up to 3×), `cli/host-derive.ts` (`ownScan`, host code) and the harness `e2e/lib/zcash.ts`. Other calls are not bounded: proving and signing can legitimately take long.
  3. **Proof:** `docs/evidence/phase-6/repro/r48-stall.out`. With stub binaries that never answer, grpcurl is bounded at the limit; a stalled sync is bounded, retried four times, then refused; a call that does not talk to lightwalletd runs unbounded.
  4. **Consequences.** This is product and host code, so the hosts are provisioned again (`deploy/signers/up.sh`), and gate RG restarts from project #1 at the new `RG_COMMIT` (phase6-rg §2). Reviewer R reviews R47–R48 before the RG row is marked READY FOR REVIEW.
- R49 2026-10-08 (head, answers Reviewer R `benzo-sol/reports/pr-rg-r47-r48.md`, FIX-FIRST: 2 P1, 7 P2). Both P1s are accepted, and so are the P2s worth fixing before RG. RG attempt 4 (`c0256cd`) is stopped after `auction-core`, and the run restarts from project #1 (host code changed).
  1. **P1-1, the pin check trusted a path string.** R47.1 accepted any path install whose path contained `-<rev>`. The reviewer showed that a spoofed line passes. Binary digests in `tools/pins.env` (the reviewer's fix) do not work, because these builds are not reproducible across machines. Instead, `tools/nu7/build.sh tool` writes `<state>/nu7-provenance/<bin>.json` after each install: the rev, the checkout's HEAD, the source path, the sha256 of each NU7 patch, and the sha256 of the built binary. The shared precondition `e2e/lib/pins.ts` (used by golden-path, auction-core and cli-auction) requires:
     - the exact `<state>/src/<repo>-<rev>` install path;
     - a provenance record;
     - checkout HEAD = record = pinned rev;
     - no checkout edits beyond build.sh's own (`Cargo.toml`, `Cargo.lock`, `Cargo.lock.pinned`);
     - patch digests equal to the committed `tools/nu7/*.patch`;
     - the binary's digest equal to the recorded one.

     frostd and frost-client keep cargo's `?rev=<rev>#` git form. The local NU7 tools are rebuilt once so that they carry the record.
  2. **P1-2, `cli/host-chain.ts` grpcurl was unbounded** (signer hosts: `sign build/approve/witness/derivable`). It now uses `lwdBound`/`lwdTimedOut`, and a stall is treated as transient. R48's "every lightwalletd call" now holds. Proof: the `chainTip` leg in `docs/evidence/phase-6/repro/r48-stall.out`.
  3. **P2s fixed:**
     - the harness `e2e/lib/hosts.ts` `sh` bounds lightwalletd calls (P2-2, the markets `blockTime`);
     - the proof asserts `/stalled/` and counts the attempts on every leg (P2-3);
     - `Run.narrowed()` records `PASS (narrowed: …)` in `run.json` for A1, I1, J1 and M1 under `BNZ_LWD_SINGLE=1` (P2-4);
     - `tle -d` is bounded at 120 s (`BNZ_DRAND_TIMEOUT_MS`) in `clear/auction-cli.ts` (both openings) and `cli/product.ts` (P2-5).
  4. **P2s that go to the README honest limits:** the retry ceilings end in refusal, not completion; power loss during a sync. Also listed there: the single testnet endpoint. **P2-7** (the manifest commit) is closed by `c0256cd` and its successor; the RG row cites the hosts' manifest commit.
- R50 2026-10-08 (head, RG attempt 5): **D3 no longer compares the shuffled action position.** `testnet-golden-path` D3 went red at `70601ed`: the two deposits' operator views differed in `action_index` (1 against 0). The Orchard builder shuffles a bundle's actions (`orchard::builder`), so a note's action position is uniformly random per transaction, like its txid. It is not a property of the bidder, and D3 had passed only when the two shuffles agreed (attempts 3 and 4). D3 now excludes `action_index` with the other per-transaction fields. This is a harness fix: only `testnet-golden-path` re-runs, after the serial run (phase6-rg §2).
- R51 2026-10-08 (head, RG attempt 5 after `auction-core` went red at `3c1feda`):
  1. **The finding.** At the chain tip, a vault `wallet sync` failed once with `Wallet(NonSequentialBlocks)` (`tmp/e2e/cli.log`, 16:20:01Z). That is a lightwalletd tip race of the same kind as "newer than the latest block", and the next three syncs were clean. No retry list counted it as transient, so `auction-core` threw after funding, and it has no recovery path. Its six deposits (2,530,000 zats) stayed in the vault. `settle-crash` and `cli-auction` then refused with "vault not empty", as designed.
  2. **The fix.** `NonSequentialBlocks` is transient in `settle/io.ts`, `cli/host-derive.ts` (host code), `clear/auction-cli.ts` (which now also retries the existing tip-race messages) and `e2e/lib/zcash.ts`. `auction-core` now sweeps the vault back to the bidder in its `finally` when a run throws after funding, as `cli-auction` and `settle-crash` already do.
  3. **Recovery.** The head swept the vault (`c3505d4f…`).
     - The runner stopped. When the head killed the queued `buyback-mode` (`playwright test` and its node worker), an already-spawned `benzo bid deposit` still broadcast one stray deposit (`049296e3…`) to auction `347372d9…`. That auction is recovered by cancel plus `tools/repro/x-cancel-claims.ts`.
     - Head rule from this: stop a live spec by killing its whole process group, and only between steps that move funds. Better still, let it finish.
  4. Product and host code changed: the hosts are provisioned again and RG restarts from project #1.
- R52 2026-10-08 (head, answers Reviewer R `benzo-sol/reports/pr-rg-r49.md`, FIX-FIRST: 3 P1, 3 P2). All accepted.
  1. **The pin gate checks the committed facts, not the record's** (`e2e/lib/pins.ts`):
     - **S6:** the required NU7 patch set per tool is fixed in the gate (as `tools/bootstrap.sh` builds it). The record must list exactly that set, each at the committed digest.
     - **S7:** `Cargo.lock.pinned` must equal the checkout's committed `Cargo.lock`. `tools/nu7/lockdiff.py` runs at gate time, as at build time. The `Cargo.toml` diff may contain only the NU7 `[patch.crates-io]` path lines into `<state>/nu7-crates`.
     - **S9:** every tracked file must be plain in `git ls-files -v`, so no skip-worktree or assume-unchanged file can hide an edit.
     - **S8 is closed by chain of custody, not prevention.** The record is attested by the machine under test, and without reproducible builds nothing on that machine can prove it independently. Each evidence `run.json` now pins `nu7_provenance` (the record's digest and the binary's), so a later swap is detectable against committed evidence.
     - **The honest guarantee:** "built from the pinned source by `tools/nu7/build.sh`, as attested by the machine under test".
     - Proof: `docs/evidence/phase-6/repro/r49-pins.out` (real tools OK; S2, S4, S6, S7 and S9 refused; restored OK).
  2. **`tle -d` is bounded everywhere it runs.** `manifest/reserve.ts` `tleDecryptFailover` (signer plan, host derive, delivery, envelopes, `benzo verify`) now bounds each relay at `DRAND_TIMEOUT_MS`, and a timeout fails over to the next endpoint like any network error. With R49's three sites, no product `tle` spawn is unbounded, and the README's claim now holds. The harness drand spawns are bounded too (`e2e/lib/readpath.ts`, `tools.ts`, `readpath-live.ts`, `tools/repro/markets.ts`). The verify bundle is rebuilt (`docs/verify-bundle.sha256`).
  3. P2: `Run.narrowed()` throws on an unknown id. The RG row cites the hosts' manifest commit of the final attempt.
- R53 2026-10-08 (head, answers Reviewer R `benzo-sol/reports/pr-rg-r52.md`, FIX-FIRST: 1 P1, 4 P2):
  1. **P1 (S6b) accepted.** `e2e/lib/pins.ts` read the "committed" patch digest from the working tree, so a skip-worktree-hidden patch edit, rebuilt honestly, passed both the gate and the dirty-tree check. The digest now comes from `git show HEAD:tools/nu7/<cv>.patch`, and the gate refuses any file in this checkout that is hidden from `git status` (`git ls-files -v`). This is harness-only. Attempt 6 continues: at its start this checkout had **0** hidden files, and every `tools/nu7/*.patch` equalled `HEAD` (checked by the head at 17:1xZ, recorded in the RG row). Projects after this commit run the stricter gate. The spoof battery gains S6b after RG, because it briefly tampers with live binaries.
  2. **P2-2 accepted:** `run.json` records `nu7_provenance: "MISSING"` instead of silently omitting the anchor.
  3. **P2s that go to the README honest limits:**
     - P2-3: a MAC failure from the first relay returns "undecryptable" without asking the others. A MAC failure is a property of the ciphertext under a beacon whose signature tle has already checked against the pinned chain key, so another relay cannot change it.
     - P2-4: `auction-core`'s recovery sweeps every mature vault note. That is safe only under the one-live-harness-at-a-time rule (phase6-rg §5).
  4. **P2-5** is closed: the hosts were provisioned at `42db1fe` (manifest commit `3125fd3`), and attempt 6 runs at `3125fd3`.
- R54 2026-10-08 (head, RG attempt 6): **`settle-crash` NOT RUN on a dropped drand read.** After funding, `waitFor` polls `latestRound()` every second, and one `fetch failed: read ETIMEDOUT` threw the spec. Its own fund recovery returned the deposits (`f4a234a4…`), and no evidence was written. `e2e/lib/run.ts` `latestRound()` now bounds each request at 15 s and retries a network error or HTTP 5xx 5× with backoff. An HTTP 4xx or a malformed answer still throws. This is harness-only: `settle-crash` re-runs after the serial run (phase6-rg §2), and the other projects are unaffected. The error came from Playwright's `tmp/e2e/report.json`, kept at `tmp/rg/attempt5/settle-crash-a6-report.json`.
  - R54 addendum: `cli-auction` then reported NOT RUN with "fold setup: fetch failed". Measured at 18:17Z: api.drand.sh answered in 7–11 s, api2 in 7–9 s, api3 in 2–5 s, and drand.cloudflare.com in 0.2–1.8 s. The head put `drand.cloudflare.com` first in the local `.env` `BNZ_DRAND_URLS`. Every relay is authenticated against the pinned chain key (tle and tlock-js verify each beacon), so the order changes latency, not trust. `.env.example` is unchanged. `cli-auction` re-runs with `settle-crash` after the serial run.
- R55 2026-10-09 (head, RG attempt 6 `buyback-mode`: Y1b and W6 red; the other IDs green, including V2's exact receipts):
  1. **Y1b, the head's own R29 regression.** The test-only kill drill (`BNZ_DRILL_STOP=bob`) lived only in `signOnce`. R29 moved host custody to `signParallelHost`, which had no hook, so bob was never stopped, and batch 1 was signed by alice and bob (`batch-1.custody.json` pair `["alice","bob"]`, no abandoned session). Nothing had run this drill live since R29. The hook is restored in `signParallelHost`: once that signer's join has printed "Joining signing session...", its host is stopped, once. It is gated on the env var, so production signing is unchanged when the variable is unset (it is a single `if` on `BNZ_DRILL_STOP`).
  2. **W6 is a consequence of item 1, not a double-pay.** W6 attacks alice and carol, assuming carol signed batch 1 (the drill's alice+carol pair). Carol never saw batch 1, so its own approval ledger had no prior source and it approved; alice, a batch-1 signer, refused. Under R28 item 3 each host checks only its own ledger. 2-of-3 safety holds because any two hosts include a signer of every mined batch, and here alice and bob would both refuse. With the drill restored, W6 again attacks a batch-1 signer pair.
  3. `settle/sign.ts` is coordinator code, but the change is inert unless `BNZ_DRILL_STOP` is set. The head therefore re-runs only `buyback-mode` (with the queued `settle-crash` and `cli-auction`), not all of §2. Reviewer R confirms this classification before the RG row is marked READY.
- R56 2026-10-09 (head, RG attempt 6 re-run of `settle-crash` at `92402bb`: J1, L1, J2, K1 and N1 green; M1 red). **M1 is restated to the R16 design.** M1 still expected a cancel under a drand outage to pay each deposit back at once. Since R16 item 1, a cancelled-before-R deposit refunds only through its owner's claim, or through an envelope that two signers' envelope-opens reports agree on (R23). This low-level drill (`clear/dist/auction.mjs`, no witness set) has neither before R. So the product correctly left both deposits at exact C in the claim queue: worker exit 0, zero `tle` calls, "cancelled before release; refund is claimable after R" ×2, and no receipts. M1 now asserts exactly that: no opening, no wedge, nothing paid anywhere, and the vault holds 2C + reserve until the spec's recovery. The paid claim path is proven live elsewhere, by `cli-auction`'s envelope-opens legs and `tools/repro/x-cancel-claims.ts` (most recently auction `347372d9…`: 3 × 500,000 paid and landed). This is harness-only: `settle-crash` re-runs.
- R57 2026-10-09 (head, RG attempt 6 `markets`: TIMEDOUT at 420 min, no evidence). **Testnet slowed, not the product.** Between 18:55Z and 03:04Z the tip advanced about 365 blocks, about 90 s a block against the earlier 25 s. The first scenario (`drop`, auction `9ddb4e5a…`) cleared, and then waited, as designed, for its bond window (start 4,479,474, 40 blocks, plus 10 confirmations). That window had not closed when the 420-min test timeout killed the run. Because the child's output was buffered until exit, nothing was logged. Fixes, harness-only:
  - `e2e/markets.spec.ts` streams each scenario's output to `tmp/markets-spec-<i>.log` as it runs;
  - the serial timeout is 960 min.

  The parked drop (vault 1,380,000 zats, state CLEARED) is finished with `tools/repro/markets.ts resume:9ddb4e5a…` once the current live run ends. Then `settle-crash` and `markets` re-run.
- R58 2026-10-09 (head, answers Reviewer R `benzo-sol/reports/pr-rg-r57.md`, FIX-FIRST: 2 P1, 4 P2):
  1. **F2, P1, accepted: a host re-pay needs positive proof of absence.** `sign approve` let a source already in an earlier approved batch be approved again when this host's `minedHeight` was 0. That value also means "the endpoint answered NotFound", and every host uses the same testnet endpoint, so one lagging or pruned answer could mislead two hosts at once and approve a 2-of-3 re-pay of a mined row. Now:
     - the earlier batch must be past its expiry, and `minedHeight` must be 0;
     - **and** `cli/host-chain.ts` `provenAbsent` must fetch every block in (approval tip, expiry] contiguously and find the txid in none of them. A missing range refuses.
     - New ledger entries record `approved_tip`. An entry from before R58 uses expiry − 10,000, the R28 item 9 bound.

     This is host code: the hosts are provisioned again, and gate RG restarts from project #1.
  2. **F1, P1, accepted:** `e2e/lib/global-setup.ts` now refuses an evidence run when any tracked file is hidden from `git status` (`git ls-files -v`). That covers every project, not only the specs that call `pins.ts`.
  3. **P2s:**
     - F6, accepted: a `git show` failure in `pins.ts` is now a NOT RUN string.
     - F3, accepted: the W6 title stays, but R55 item 2's explanation is the record. With R58, any two hosts can no longer both be wrong about a mined batch.
     - F4 goes to the README honest limits: losing a host's `approvals/` ledger while keeping its keys weakens that host's own check, so the ledger is backed up with the keys.
     - F5 goes to the residuals: the settle-crash "no wedge" leg covers the low-level shape only.
- R59 2026-10-09 (head, RG attempt 6 re-runs):
  1. **`cli-auction` NOT RUN, "wrong-network address".** `foldR73` case B, `foldR71` and `foldR104` in `e2e/lib/readpath-live.ts` called `sealEnvelope` without a network. A15 made the network a parameter that defaults to main. The head had fixed `e2e/lib/readpath.ts` (`5de3495`) but missed this file. All three now pass `"test"`. Harness-only.
  2. **`markets` drop: "batch 1 was never signed by two hosts".** The late-dust flow waited 40 min for batch 1's maps file, then threw **before** saving settle's output, so the cause was lost. It now stops waiting as soon as settle exits, saves settle's output to `tmp/markets/drop-settle.log`, and puts settle's last ERROR lines into the failure. The drop auction `75d1ab9d…` is finished with `resume:` before the restart. The cause is diagnosed from the next run.
  3. **`buyback-mode`** passed every ID, but the run reported failure with no evidence: the global teardown never printed. The runner now keeps each project's Playwright `report.json`, so the next run shows the cause.
- R60 2026-10-09 (head, answers Reviewer R `benzo-sol/reports/pr-rg-r58.md`, FIX-FIRST: 1 P1, 3 P2; plus RG attempt 6 `markets` launch-miss):
  1. **P1, accepted: the F-1 leak probe could report a real leak as fixed.** `e2e/lib/readpath-live.ts` opened the published envelope with the operator-held key without a network. That threw "wrong-network address" after decrypting, and the `catch` printed "F-1 FIXED". The probe now prints FIXED **only when the key file is absent**. Otherwise it prints CONFIRMED and opens with `"test"`, and an open that throws is still reported as CONFIRMED.
  2. **P2s:**
     - Late approval, fixed: `sign approve` refuses a candidate that has already mined, and the absence scan starts 100 blocks below the recorded approval tip, allowing for endpoint lag. The host's grpc buffer is 256 MiB for block ranges.
     - The absence proof trusts one shared endpoint's compact `vtx`, with no positive control or hash linkage. This goes to the residuals: our batches are always shielded spends, so they always appear in compact blocks. The coordinator's absence check keeps its known-txid positive control.
     - The remaining main-default envelope calls in `tools/repro/` are in folded scripts that R35.3(b) deletes, and `benzo-b` is an old branch.
  3. **`markets` launch-miss FATAL "sign delivery refused: delivery records".** A launch that misses its minimum raise has no winners and so no sealed delivery records. The hosts rightly refuse an empty list (R40), and settlement never needs one (`cli/product.ts` publishes the list only when present). `tools/repro/markets.ts` now signs a delivery list only when there are records. Harness-only.
  4. `cli/commands/sign-approve.ts` and `cli/host-chain.ts` are host code, so attempt 7 is provisioned after this commit (the queued `up.sh` picks it up).
- R61 2026-10-09 (head, a fund-lock found by RG attempt 6): **a bond window that starts before R voids the bond instead of locking every deposit.**
  1. **The finding.** The `drop` auction `75d1ab9d…` cleared with a manifest-fixed window (4,480,906, 4,480,946]. The harness had picked that start from a 90 s block estimate, but testnet then ran at about 14 s, so the start block's header time came before R's release time. R33 made every host **refuse** such a window (winners must know they won before it opens). Every host refused, so nothing could settle, not even refunds: 1,380,000 zats were locked under host custody for good. A manifest timing error, or simply a faster chain, must never lock funds.
  2. **The rule.** The bond is void when the start block's header time is before R's release (`clear/features.ts` `bondVoidAt`, from the manifest's pinned drand genesis and period).
     - Nobody defaults (`defaults` is `[]`).
     - Every leaf refunds exactly what its deposit vaulted: payment + refund − balance_due, which is C at zero fee.
     - Every balance note refunds on its own row: in-window notes through `balance-excess:<leaf>` in full, the others through `balance-late:` as before.
     - The seller is paid nothing (`obligationsModeA` with `bond_void`).

     The operator's mistake costs the seller, never a bidder.
  3. **Binding.** Each host decides the void from its own chain view (`cli/host-derive.ts`, no longer a refusal) and signs `bond_void: true` into its approval map. The field joins the signed bytes only when true, so every earlier map keeps its exact signature. Two maps agree only when their `bond_void` matches, and the coordinator's plan decides the same from its own lightwalletd. Publishing carries `settlement.bond_void` only from two agreeing maps (`witness/index.ts` `earliestAgreedBond`, the R44 tie-break over the pair {defaults, bond_void}). `benzo verify` requires the published value to equal the attested one, in both directions. The verify bundle is rebuilt.
  4. **Harness.** `tools/repro/markets.ts` `balanceStart` measures cadence over 50 blocks and assumes blocks at least 3× faster than measured and never slower than 10 s.
  5. **Proof:** `docs/evidence/phase-6/repro/r61-void.out`. It covers the normal and void obligations, refusal of defaults with a void bond, the void boundary, normal and void balance settlement, back-compatible map bytes, a flipped flag breaking the signature in either direction, the agreed pair, and refusal of a disagreeing pair.
  6. **Consequences.** This is product and host code (`clear/`, `settle/plan.ts`, `cli/host-derive.ts`, `cli/commands/sign-approve.ts`, `cli/product.ts`, `api/public-auction.ts`, `witness/`). The hosts are provisioned again, and the locked drop `75d1ab9d…` is settled under R61 (void, full refunds) before RG attempt 7 restarts from project #1. Reviewer R reviews R61 first.
- R62 2026-10-09 (head): **`deploy/signers/up.sh` provisioned stale host code.** It only checked that `cli/dist/benzo.mjs` existed. Nothing had rebuilt the bundles since the markets run's global setup at `665e447`, so the R58, R60 and R61 host changes were never on the hosts: the drop resume still met the pre-R61 refusal. `up.sh` now runs `build:core`, `build:settle` and `build:cli` from the tree before it ships anything. The host provisioning recorded at `cd3d98b` is superseded and is done again. Also, the markets resume sent "pre-window" balance dust after the window had already started (twice on `75d1ab9d…`; harmless, since each note refunds to leaf 0 on its own row). It now sends dust only while the tip is below the start.
  - R54 addendum 2 (2026-10-09): api.drand.sh answers in about 1 s again, so the local `.env` relay order is back to `.env.example`'s. Cloudflare first had changed seal-open C6: Cloudflare answers HTTP 404 for a future round, where api.drand.sh answers 425. The offline e2e is green again with the restored order.
- R63 2026-10-09 (head, answers Reviewer R `benzo-sol/reports/pr-rg-r61.md`, BLOCK: 2 P1, 6 P2):
  1. **P1-1, accepted: a bonded launch would deliver tokens through a void or a default.** The schema accepted a bond on any mode, but only mode A's obligations read it; launch delivery never did. `clear/registry.ts` now wraps the launch, OTC, RFQ and buyback clients so they refuse a manifest that carries `bond`. A bond is a uniform/vickrey feature only.
  2. **P1-2, accepted: one lightwalletd's header time decided the void.**
     - `cli/host-chain.ts` `blockHeader` reads the start block's {height, hash, time} from **every** configured endpoint (`BNZ_LWD_URL` and `BNZ_LWD_URL_ALT`) and refuses unless they all agree. Under `BNZ_LWD_SINGLE=1` it reads one endpoint, testnet only; `up.sh` now passes that flag to the hosts only when the operator sets it.
     - Each host signs the header into its approval map as `bond_start`; the field joins the bytes only when present.
     - Two maps agree only on the identical header, and the R44 tie-break keys on {defaults, bond_void, bond_start}.
     - `benzo verify` requires the signed header to be the manifest's start height, and recomputes `bond_void` with `bondVoidAt` from the signed time. A void with no signed header is refused.
  3. **P2s:**
     - Fixed:
       - P2-5: verify refuses a `bond_void` outside a settled bond auction.
       - P2-6: `auction create` refuses a window start that is already mined.
       - P2-7: the F-1 probe prints only a hash and length of any opened destination.
       - P2-3, wording: a void refunds C − fee, which is exactly C because settlement requires a zero auction fee.
       - P2-4: the proof now verifies committed **pre-R61** maps (`phase-5/markets/launch-a18`) byte for byte under the new code.
     - Residual: P2-8 (the late-approval NotFound signal) stays with the R60 absence-proof residual.
  4. **Proof:** `docs/evidence/phase-6/repro/r61-void.out` (RESULT r61-r63 PASS). New legs: pre-R61 map bytes, refusal of different headers, a tampered signed header, and bond limited to mode A. The last leg inspects the wrapped clients rather than driving a bonded launch end to end.
  5. **Consequences.** The drop `75d1ab9d…` settled under R61 maps that carry no `bond_start`, so its published settlement now fails verify ("a void bond needs the signed start header"). That is the recovery record of an auction settled before R63; its funds were all refunded. Product and host code changed: the hosts are provisioned again, and RG restarts from project #1 (attempt 8). Attempt 7's runner is stopped after `auction-core`.
- R64 2026-10-09 (head, answers Reviewer R `benzo-sol/reports/pr-rg-r63.md`, BLOCK: 1 P1, 8 P2):
  1. **P1: one endpoint configured twice defeated the header cross-check. Accepted, with its limit stated.**
     - Fixed: hosts (`cli/host-chain.ts` `blockHeader`), the coordinator (`settle/io.ts` `lwdEndpoints`) and the plan (`settle/plan.ts`) all refuse a `BNZ_LWD_URL_ALT` equal to `BNZ_LWD_URL`.
     - Stated as a limit: both endpoints come from each host's own launcher config. That is the R28 trust model: a host already reads notes and mined heights from those endpoints. In this testnet deployment one operator provisions all three hosts with the same pair. On mainnet each signer's operator chooses its own independent endpoints; the README honest limits say so.
  2. **P2s fixed:**
     - P2-2: `clientLaunch` itself refuses a bond, not only the registry wrapper.
     - P2-3: the plan reads the start header from every configured endpoint and requires agreement, exactly like the hosts.
     - P2-4: the R44 tie-break *selection* now includes `bond_start`.
     - P2-6: the proof **drives** the launch client on a committed launch-a18 manifest, re-signed with a throwaway key. Unbonded it is accepted; with a schema-valid bond it is refused by both the wrapper and `clientLaunch`.
     - P2-8: `up.sh` counts dirtiness after building and refuses a dirty tree, unless `BNZ_UP_ALLOW_DIRTY=1` for a lab run.
  3. **P2s that go to the residuals:**
     - P2-5: the r61 obligations fixture is arithmetic-only, not a reachable clear.
     - P2-7: the markets resume can double-send dust while an earlier dust tx is still unmined (harness only).
     - P2-9: the pre-existing `drop-r33` evidence fails today's schema (`balance_window_blocks` 12 < 40). It is a superseded record from before the 40-block minimum, which R35.3(b)'s evidence pass annotates.
  4. Product, host and verify code changed (the verify bundle is rebuilt). Attempt 8 continues for signal, and the gate's final run is attempt 9, after Reviewer R confirms R64.
- R65 2026-10-09 (head, Reviewer R `benzo-sol/reports/pr-rg-r64.md`: **APPROVE**, 5 P2):
  - Fixed:
    - P2-1: endpoints compare as normalized `host:port` (`settle/bounded.ts` `endpointKey`: lowercase, no scheme, no trailing dot, default 443) at all three sites, with a proof leg.
    - P2-2: the plan's start header must be the start height's, carry a hash and a time, and agree across endpoints.
    - P2-5: the load-bearing `?? null` in the tie-break key is commented.
    - P2-4: the proof result is renamed `r61-r65`.
  - Residual: P2-3. Launch's balance arithmetic stays: deleting it gains nothing now that bond is refused in launch, and it risks committed launch evidence. P2-2's "compare the plan to the attested header before obligations" is covered by the hosts refusing any candidate whose rows they derive differently.
  - Attempt 8 stops after `settle-crash` (a safe point), and **attempt 9 is the gate's run** at this commit, on hosts provisioned from it.
- R66 2026-10-09 (head, RG attempt 9 `cli-auction` NOT RUN: "fold setup: require is not defined"). `foldR73` case C in `e2e/lib/readpath-live.ts` called `require("node:crypto")` inside an ES module. It had never run before, because case B threw first until R59. It now uses the imported `diffieHellman` and `createCipheriv`. The spec's cleanup swept the funding (`5115eda4…`). This is harness-only: `cli-auction` re-runs after the serial run (phase6-rg §2).
- R67 2026-10-09 (head, RG attempt 9 `buyback-mode`; harness-only):
  1. **The "passed but run failed, no evidence" mystery (R59 item 3) is solved.** `buyback-mode` writes no evidence subdirectory, so `docs/evidence/phase-6/rg/buyback-mode/` never existed, and the global teardown's final `run.json` write threw ENOENT. The Playwright report kept since R59 shows it: `global errors: ENOENT … buyback-mode/run.json`. The teardown now creates the directory first.
  2. **W6 refused the re-pay with the other rule.** Since R58 the host checks "the earlier batch can still mine (inside its expiry)" before "already paid by mined batch". Batch 1 had mined but its 364-block expiry was still ahead, so the host refused with "which can still mine until …". The re-pay is refused either way, so W6 accepts both messages.
  3. `buyback-mode` re-runs after the serial run, together with `cli-auction` (R66).
- R68 2026-10-12 (head, RG attempt 9 `markets` launch-miss FATAL "ENOENT … allocation.json"; harness-only). After R60, a launch with no winners publishes no delivery list and so no `allocation.json`, but the harness still checked that file's row order for every launch scenario. With no deliveries it now asserts instead that there is no allocation file, no delivery list, and every fill is 0. The launch-miss auction `7ec805eb…` is finished with `resume:`, and `markets` re-runs as a whole after this serial pass (phase6-rg §2).
- R69 2026-10-16 (head, RG attempt 9 `cli-auction` NOT RUN: "sha256(...).subarray is not a function"; harness-only). `foldR73` case C, which never ran before R66, used the file's `sha256` helper. That helper returns hex, so the envelope cipher got a string where it needed a 32-byte key and a 12-byte nonce. Case C now takes raw digests. The head ran case C's construction in isolation before re-queuing it (`tmp/r69/caseC.ts`: it builds a 1,144-hex envelope). The spec's cleanup swept the funding (`435d8afc…`). `cli-auction` re-runs after `buyback-mode`.
- R70 2026-10-16 (head, RG attempt 9 `cli-auction`; harness-only):
  1. **P2 and R1 run under the R42 local-signing limit, recorded as narrowed.** This drill signs with the coordinator-local FROST signers (dev mode). They publish no host-signed approval maps, so R42's per-row attestation of a paid stray claim's memo cannot be met: cold verify reports exactly one ERROR ("claim 0 memo is not attested…"). P2 and R1 now require that every other verify check passes and that this is the only error, and each records `PASS (narrowed: …)`. The attested stray claim is proven under host custody by `markets` drop (A20 F11), with cold verify passing. Local signing is dev-only; the README says so.
  2. **The tranche-3 group B folds are withdrawn from RG, except `foldR71`.** `foldR71` failed on `sealEnvelope(…, sealToPub)` (a string, not a recipients array). The head then drove all ten group-B folds directly against the settled auction, outside Playwright (`tmp/r70/folds.ts`, `docs/evidence/phase-6/repro/r70-folds.out`). They had never run live since the R35 port: missing imports, `memoSealedBid()` used as hex, a pass rule (`outcome`) that was never ported, fixture preconditions this auction does not meet, a pre-A15 main-network default, and the local-signing limit above. After the mechanical fixes `foldR71` passes both IDs. The other nine (`r7-2`, `r7-4`, `r7-6`, `r7-claims`, `r10-2`, `r10-4`×2, `r15-3`, `r16-1`, `r16-4`) are withdrawn from cli-auction. Their original `tools/repro/` scripts and Phase-5 evidence stay the record and are **not** deleted under R35.3(b); RG does not re-prove them at current code. This is a stated narrowing of the 84 folded IDs, and the RG row lists it. The behaviours they targeted (claims, envelope agreement, stray refunds) are only **partly** exercised live at current code, by `markets` (claims, strays, launch delivery) and `buyback-mode` (W-attacks, host refusals) under host custody. Their negative cases (forged claims, stray-claim openings, envelope-agreement sabotage) are not re-proven live in RG (R71 P2-4).
  3. `cli-auction` re-runs.
- R71 2026-10-16 (head, answers B37 `docs/STATUS-B.md` run 37, 4 real leak findings, and Reviewer R `benzo-sol/reports/pr-rg-r70.md`, FIX-FIRST: 2 P1, 4 P2):
  1. **Leaks, all accepted and fixed at the source.** Three RG evidence writers still captured raw tool output with full destinations: `testnet-golden-path` `frost/pczt-inspect.txt`, and `auction-core` `auction/pczt-inspect.txt` and `auction/cancel.json` (refund addresses). They were old specs that predate the T2 recipient rule. `e2e/lib/run.ts` `redactAddresses` now abbreviates every shielded and transparent address (first 10…last 6) in those writes, and both projects re-run so their committed RG evidence is replaced. Finding 4 (`phase-5/markets/drop-a20/recovery.out`, a hand-written head recovery note) is abbreviated in place with a trailing note; no `run.json` records its hash. These were our own testnet lab wallets, but evidence must never link a payout to its recipient.
  2. **P1-1, not accepted, with the reason.** Coordinator-local signing (`settle/cli.ts`'s non-custody path, `benzo sign inspect`) holds all three FROST shares on one machine. A "host-signed" approval map produced there would be the operator attesting to itself. R42 requires two **independent** host attestations of a paid stray claim, and local mode cannot honestly produce them. Verify's refusal is therefore correct, and P2/R1 stay narrowed to that one error (R70). The README lists local signing as dev-only.
  3. **P1-2, accepted.** `g2-taddr-exception`'s drill record (a fresh key, the pre-v2 shape) is refused before the shielded-only rule is reached. The ID now says exactly that, and it also asserts the shielded-only rule on the shared validator (`requireShieldedDestination`, run by both `sealEnvelope` and `openEnvelope`) with a t-address.
  4. **P2s:**
     - P2-4: R70's coverage sentence is narrowed to read "partly exercised". The withdrawal is noted in the spec header, and the RG row lists the withdrawn IDs.
     - P2-5 (R73 correction: the cause is head testimony — that run.json kept bare FAILs, no logs; and the ids are: the all-FAIL run was code `7b148b6`, recorded in commit `43be172`): the `markets` all-FAIL run (two minutes) was the 2026-10-15 11:06Z network outage. Every scenario failed at `benzo auction keys` (the hosts' DKG could not reach the network) before funding. The passing run `638ae26` is at identical code.
     - Residuals: P2-3 (since R58 the expiry check runs first, so W6 does not reach the mined-batch rule live) and P2-6 (the claims check stops at the first failing claim, so under the narrowing later claim rows are unchecked).
- R72 2026-10-16 (head, phase6-rg §4.1, R35.3(b)): **16 folded `tools/repro/` scripts deleted.** Each one's folded IDs passed live in gate RG, and the evidence is cited:
  - `g-forged-claim`, `kc-key-commitment-repro`, `r15-verify-leaves-repro`, `r26-3-projection-repro` → `cli-auction` FOLD1 (`g-forged-claim-*`, `kc-*`, `r15-*`, `r26-3-*`);
  - `mr-envelope-repro`, `r23-2-signed-opens-repro`, `r26-1-deposit-party-repro` → FOLD2 (`mr-*`, `r23-2-*`, `r26-1-*`);
  - `r7-5-reserve-opening-repro`, `reserve-opening-repro` → FOLD3 (`U7`, `r7-5-reserve-opening`);
  - `r7-3-exception-queue-repro`, `g2-envelope-crash-not-exception` → `foldR73` (`r7-3-exception-queue`, `g2-*`);
  - `r7-1-ledger-redirect-repro`, `g1-tampered-ledger-redirect` → `foldR71`;
  - `r23-3-api-claims-repro` → S1 / `r23-3-api-*`.

  All of the above are PASS in `docs/evidence/phase-6/rg/cli-auction/run.json` (74 IDs; run.json pins commit `1145b4a`, code `975b4b1`, recorded in `6c45e3a` — R73 corrected this from "`a24a3a8`", which was true when written and went stale with the R71 re-run). `g7-network-repro` → `auction-core` `g7-*` (11 IDs, PASS, `docs/evidence/phase-6/rg/auction-core/run.json`). `batching-equal.ts` → the `npm run bench` batch-plan stage (gate SC evidence). **Kept** (R70): the nine withdrawn group-B originals `r7-2`, `r7-4`, `r7-6`, `r7-claims`, `r10-2`, `r10-4`, `r15-3`, `r16-1` and `r16-4`. Their committed Phase-5 evidence remains the record. Comments that name a deleted script are provenance only; no code imports them.

### R73 — Reviewer R on R72 (`pr-rg-r72.md`, FIX-FIRST): two P1s, five P2s

1. **P1-1 (auction-core lost `auction/signatures.json`): FIXED, with an enforced guard.**
   - **Cause:** R71's marker comment swallowed the `write()` call.
   - **Fix:** the write is restored on its own line (edf3784). `Run` now takes the evidence files each ID cites and FAILs an ID whose files were not written. auction-core declares its manifest (E1, G1, G3, H2, H3, I1).
   - **Proof:** an offline probe gives the writing ID PASS and the ID whose write is commented out FAIL ("evidence … was not written").
   - **Re-run:** auction-core re-ran live at edf3784 (product code unchanged since R65). `signatures.json` was written again, but E1 and H3 FAILed only on the new guard: the head's first manifest named files written just after those IDs close (deposits/receipts after E1, frozen after H3). The manifest was re-attributed to H1/F1 and auction-core re-runs at the R73 commit. The R73 attempt-1 evidence stays in history (`9c1eb98`).
   - **Branch rule:** `agent-friendly` adds `comment-swallowed-statement`, which flags both the R57 and R71 incidents on history.
2. **P1-2 (unredacted lab destinations remain in history): RULED. Accepted for the testnet gate; fixed before anything is public.**
   - The four REAL leak findings are fixed at HEAD only. Superseded revisions on `main` still carry the full destinations.
   - These are the head's own testnet lab wallets, in a repo that is private by standing rule. That exposure is accepted for gate RG, and the LA row now says exactly that.
   - **Binding:** nothing from this history is ever made public. A public or submission repo is published from a fresh, history-free export, re-audited with `leak-audit --git` (which must exit 0) before it is pushed. Rewriting the private history is the user's call.
3. **P2s:**
   - (3) The open-time rule is now proven offline by `tools/repro/r73-open-taddr.ts`. A hostile sealer builds a well-formed n = 3 v2 (and v1) envelope with a t-addr refund. `openEnvelope` refuses it with "transparent address (t-addr)", and `openDestination` gives null, which sends it to the exception queue. After the fix, 6/6 PASS (`repro/r73-open-taddr-after.out`). With both `requireShieldedDestination` calls removed from `parseEnvelopePayload`, 4 FAIL (`repro/r73-open-taddr-mutation.out`). Residual: the exception reason is the generic "envelope destination refused" (`openDestination` is total by R7.3), not the rule's name.
   - (4) The 2026-10-15 outage claim is reworded as head testimony (run.json kept bare FAILs). The commit/tree ids are separated: the all-FAIL run was code 7b148b6, recorded in 43be172.
   - (5) The SC row's repro now points at `tools/bench.ts` stage `batch-plan`; the R72 citation names the pinned run (1145b4a, code 975b4b1).
   - (6) `redactAddresses` covers t2/t3/zc.
   - (7) The cli-auction header marks the withdrawn group-B IDs.

### R74 — Reviewer R on R73 (`pr-rg-r73.md`, FIX-FIRST): one P1, six P2s

1. **P1 (R73's public binding cannot be satisfied): RESTATED. No public export is approved.**
   - `leak-audit` exits 0 only on zero rows.
   - Its allowlist suppresses only `address` rows, and the anvil dev-key `exact-value` rows cannot be suppressed.
   - A history-free export of HEAD still carries 45 class-C rows in phase-1–5 evidence.
   - **The release scrub, a Phase 7 item that is the only path to a public repo:**
     - (a) The export omits or redacts every evidence file holding a real refund, output or delivery destination: the class-C/G rows in `leak-audit.md`, re-derived on the export.
     - (b) The demos read the anvil key from the environment; no key literal is in the tree.
     - (c) Any `exact-value` allowlist entry needs a written justification per value. **No allowlist entry may cover a file that holds a real destination.**
     - (d) The owed `release_time` (bid plaintext before R) sensitive entries are added first.
     - (e) One recorded dry run of `leak-audit --git` over the export exits 0, before any push.
   - Until (a)–(e) are done, nothing is published.
   - The GitHub remote `akash-mondal/benzo-zcash` was checked on 2026-10-17 with `gh repo view`: `PRIVATE`. That answers R's UNCONFIRMED premise.
2. **P2s:**
   - **P2-2.** auction-core's manifest now also guards E1's `manifest.json`/`cancel-manifest.json`/`signer.json` and the five `bid*.memo.hex` (under H1). `run.ts` describes the manifest truthfully, as a temporal bucket. The other five specs have no manifest yet: a residual. The `comment-swallowed-statement` rule on `agent-friendly` covers the mechanism in every spec.
   - **P2-3.** The mutation is committed as `mutations/R73-open-taddr.patch`. Folding the repro into a gate-run spec ID is owed at the next cli-auction run: a residual.
   - **P2-4.** The LA row's "missing" cell now records the decision. The `release_time` entries are owed (R74 1(d)).
   - **P2-5.** The RG row names the all-FAIL markets run by its code `7b148b6`, and the tail is current.
   - **P2-6.** `run.json` gains `fail_reasons`: the first assertion message of each FAIL. The offline probe records "B evidence r73/b.txt was not written".
   - **P2-7.** The RG row discloses the six pins and states the rule as applied: one product-code tree, checked by equal built-artifact digests and the earliest-to-latest pin diff. The harness differs per run.

### R75 — Reviewer R on R74 (`pr-rg-r74.md`, FIX-FIRST/BLOCK): one P1, four P2s

1. **P1 (the release audit could not see EVM, Solana, TEX or Sprout destinations): FIXED.**
   - `tools/leak-audit.ts` gains `evm-address` (`0x` + 40 hex) and `solana-address` (a 32–44-char base58 token mixing upper case, lower case and digits). `address` adds `tex1`/`textest1` and Sprout `zc`/`zt`. The file allowlist applies to every address rule.
   - **Proof** (`repro/r75-leak-rules.out`): planted files carry an EIP-55 address, a Solana address and a TEX address, plus a clean file with a 64-hex hash and a plain word. The old tool (@`48741cd`) gives rc 0 with 0 rows. The new tool gives rc 1 with exactly three rows (one per planted destination) and none for the clean file.
   - On the current tree the new rules surface about 770 more rows (about 190 distinct values) in `contracts/`, `crosschain/`, docs and evidence. The release scrub (R74 §1(a)) must classify them; they are never ignored.
2. **P2s:**
   - **`fail_reasons`.** Redaction now also covers `textest1`, unified/Sapling viewing keys and EVM addresses.
   - **R74 §1(c) amended.** Each allowlist entry, path or value, carries a written justification. §1(e) amended: the sha256 of the audited export archive is recorded, and the pushed tree must be byte-identical to it.
   - **Third comment-swallow (`4feaa86`).** Acknowledged. The detecting rule and the pre-commit `npm run check` reach main with the agent-friendly merge right after gold. The repair is evidenced by typecheck (0 errors at `48741cd`) and the offline guard probe (`ERROR B … was not written`, reason recorded).
   - **Owed items (unchanged):** the t-addr repro fold, five spec manifests, and the `release_time` entries.

### R76 — Reviewer R on R75 (`pr-rg-r75.md`, BLOCK on one P1): one P1, three P2s

1. **P1 (the Solana rule missed real keys that have no digit): FIXED.**
   - `solana-address` is now ANY 32–44-char base58 token that decodes to exactly 32 bytes, using `@scure/base` (audited, already a direct dependency). There are no case or digit heuristics.
   - The EVM rule accepts `0X` and uses "not alphanumeric" boundaries, so `_` neighbours no longer hide a match.
   - **Proof** (`repro/r76-leak-rules.out`):
     - The planted digitless Solana key, Solana key between underscores, uppercase `0X` EVM address and EVM address between underscores are all found, as are the three R75 plants (7 rows).
     - The R75 tool missed three of them.
     - The clean file (a 64-hex hash, a plain word, a CamelCase sentence) gives no row.
     - Over `contracts/`, `crosschain/` and `docs/` at HEAD: 338 evm, 337 solana and 329 address rows for the release scrub to classify.
2. **P2s:**
   - **`redactAddresses` (`fail_reasons`, evidence writers).** It now also abbreviates Solana keys (the same 32-byte decode) and replaces 24-word mnemonics. Probe: a digitless key, a `0X` EVM address and a mnemonic are redacted; a 64-hex hash is kept.
   - **Split-across-lines and other renderings.** A residual: the release scrub's human classification (R74 §1(a)) reviews the export's text files, and the audit alone is not claimed to be complete.
   - **(c)/(e) consolidated.** The release scrub is R74 §1 as amended by R75 and here.
     - (c) The allowlist holds exact file paths only. Each path needs a written justification in a sibling `leak-allowlist.md`, and no allowed path may hold a real destination.
     - (e) The sha256 of the audited export archive is recorded, and the push is done from that archive only. A re-check at push time is part of the scrub's script.

### R77 — Reviewer G's final RG review (`benzo-sol-g/reports/rg-final.md`, REQUEST CHANGES) and Reviewer R on R76 (`pr-rg-r76.md`, APPROVE)

G confirmed every claim of the gate itself: one product tree since R65, six pins disclosed, the five live mutations red, and evidence destination-free at HEAD. It raised one P1 against the product.

1. **G-1 (P1): verify accepted settlement receipts that no host attested.** Fixed where maps are published; R78 closes the no-maps downgrade.
   - The new verify check `receipt-attestation` (`api/public-auction.ts`):
     - every receipt has well-formed fields (64-hex txid, non-negative output_index, positive amount);
     - no two receipts name the same output;
     - wherever approval maps are published, each receipt `{party, txid, output_index}` is in two agreeing maps signed by distinct pinned witnesses for that txid;
     - a mainnet settlement without maps is refused. The manifest's network is signed, and mainnet is host-custody only.
   - Testnet documents with no maps (pre-R42 evidence, local signing) carry a printed WARN, "receipts not host-attested".
   - `verifyApprovalMap` also verifies maps signed before A18 (fd068fb) over their original bytes `{auction_id, batch, txid, outputs, defaults}`. That needs a pinned host key, so nothing an operator can produce.
   - **Proof** (`repro/r77-receipt-attestation.out`, `tools/repro/r77-receipt-attestation.ts`), on launch-r34, which has two host maps:
     - a fabricated txid, two swapped output indexes and a duplicated output were all ACCEPTED before and are all REFUSED now; the honest document is still accepted;
     - G's `/tmp/g-verify/launch` fixture is now refused.
   - Over all 26 committed settled documents, no honest document changes verdict. drop-a17 (already refused by five checks) loses its `defaults` error, because its pre-A18 maps now verify.
2. **G-2 (P2, REFUTED with proof).** `settle/plan.ts` recomputes through `clear/dist/cli.mjs`: `clearForMode` → `attachSerials`, which BLS-verifies the serial beacon against the pinned quicknet key. On drop-a17 (`repro/r77-serial-beacon.out`):
   - the published beacon is ACCEPTED;
   - a one-digit forgery is REFUSED (not a curve point);
   - a real drand signature of another round is REFUSED ("serial beacon BLS signature").
3. **G-3 (P3, FIXED by the agent-friendly merge `df2ca4d`).** `balanceMatured` dedupes notes by `{txid, pool, action_index}`, and the settlement property test injects duplicates.
4. **G's observations.** The M5 header lists A4|A5|B1|D1 while the run stops at the first failure, so only B1 is red. The U2 id list carries a stray `benzo` token. Both are cosmetic and are recorded here; the committed outputs stay unedited.
5. **R's P2s on R76, FIXED** (`repro/r77-leak-p2s.out`):
   - The redactor and `leak-audit`'s Zcash rule use "not alphanumeric" boundaries, so `refund_utest1…` is caught.
   - BIP39 seeds of 12/15/18/21/24 words are detected by wordlist plus checksum, using `@scure/bip39`, now a direct dependency. 12- and 18-word seeds are caught, 14 words of prose are not, and the tree has 0 such rows.
   - Residuals, unchanged: over-redaction of 43–44-char base58 tokens; a key with one stray base58 character appended; the scrub script does not exist yet (Phase 7).
6. **The agent-friendly work is merged** (`df2ca4d`): check:structure, the property test, redact-by-construction `write()`, the read-tracked trust registry, the no-destinations guard, note dedupe, the typed harness and tools, and the opaque `Destination`. `core.hooksPath=.githooks`, so `npm run check` runs on every head commit.
7. **The gate.** G-1 and the merge change product code (verify, settlement derivation, host derive), so RG's "product unchanged since R65" no longer holds. **Gate RG re-runs all six projects at ONE commit** (this R77 commit plus the host re-provision), which also clears R's six-pin P2.

### R78 — Reviewer R on R77 (`pr-rg-r77.md`, BLOCK): two P1s, five P2s

All proofs are offline, in `repro/r78-verify-hardening.out` (`tools/repro/r78-verify-hardening.ts`), before and after.

1. **F-1 (P1, FIXED): the operator could downgrade G-1 by omitting the maps.**
   - `receipt-attestation` is now strict for every caller: a settlement with receipts and no host maps is REFUSED. The publisher chooses whether maps appear, so their absence is never a pass.
   - Only `benzo verify --legacy-unattested`, which exists to re-verify pre-R42 testnet evidence, downgrades it to a printed WARN. It never applies on mainnet.
   - G's scenario A (a fabricated txid and output on y2-r28, no maps) was ACCEPTED before; it is REFUSED now and ACCEPTED only with the flag.
   - The live specs adapt:
     - `r15-phase2-4` re-verifies the Phase 2–4 evidence with the flag;
     - cli-auction's P2/R1 (local signing, no host maps) accept exactly the host-attestation class, the claims memo and the receipts, and nothing else.
   - Over the 26 committed settled documents (`tmp/r77` measurement): strict mode adds only this ERROR, on the 18 documents without maps; legacy mode only the WARN. drop-a17 still fails five checks.
2. **F-2 (P1): verify's leak guard had a narrower pattern than the redactor and the audit.** Consolidated here; R79 closes the case and key gaps.
   - `envelope/leak-patterns.ts` is now the ONE definition, used by verify's `no-destinations`, the evidence redactor and `leak-audit`. It covers:
     - Zcash unified, Sapling, TEX, regtest, P2PKH/P2SH and Sprout addresses;
     - viewing keys;
     - EVM addresses;
     - Solana keys (a 32-byte base58 decode);
     - BIP39 seeds (wordlist and checksum).

     It uses "not alphanumeric" boundaries throughout, and its decoders are audited (`@scure/base`, `@scure/bip39`).
   - Rows and batches must carry exactly their documented keys.
   - `rows[0]` gaining `d_t2`, `d_zc`, `refund_utest1…`, `textest1…` or `refund_uviewtest1…` was ACCEPTED before and is REFUSED now.
   - The widened guard and the key checks raise no error on any committed settled document.
3. **P2s:**
   - **F-3 FIXED.** A receipt's `pool` must be sapling, orchard or ironwood; `"banana"` is REFUSED.
   - **F-4 FIXED by the shared module.** The audit's viewing-key and seed rules use the same boundaries.
   - **F-5 FIXED.** `r77-serial-beacon.ts` pins the other-round signature (quicknet round 32856451) in the script.
   - **F-6 FIXED.** `treasuryFunded` dedupes funding notes by `{txid, pool, action_index}`: a duplicated line gave 2000 before and gives 1000 now.
   - **F-7 FIXED.** `Destination[Symbol.toPrimitive]` throws for the default and number hints. `destA + ""`, `destA == "x"` and `+destA` all throw; template strings still print `[Destination]`.
4. **The gate.** RG attempt 10 (code `73cf582`) was stopped after `testnet-golden-path` (9/9) and the in-flight `auction-core`, because R78 changes verify and the harness. Attempt 11 re-provisions the hosts and runs all six projects at the R78 commit.

### R79 — Reviewer R on R78 (`pr-rg-r78.md`, BLOCK: N-1, N-2) and the attempt-11 auction-core failure

R confirmed F-1, F-3, F-4, F-5, F-6 and F-7 closed. All proofs are offline, in `repro/r79-leak-guard.out` (`tools/repro/r79-leak-guard.ts`), before and after.

1. **N-1 (P1, FIXED): the shared definition was case-sensitive.** bech32/bech32m is case-insensitive by spec, so `UTEST1…` is the same address.
   - The Zcash address and viewing-key patterns in `envelope/leak-patterns.ts` now match any case. Solana stays exact: base58 is case-sensitive, and a candidate must decode to a key.
   - Seeds are detected case-insensitively too.
   - An uppercase UA or viewing key in `rows[0].state` was ACCEPTED before and is REFUSED now. The redactor redacts it, where before it kept it.
2. **N-2 (P1, FIXED): verify's walk tested string values only.** It now tests every object key at any depth. `batches[0].inspect = {"<address>": "paid"}` and a nested uppercase key were ACCEPTED before and are REFUSED now.
3. **Residuals, FIXED:**
   - Row values are shape-checked: kind is refund or payout; pool is sapling, orchard, ironwood or null; txid is hex64 or null; batch and output_index are naturals or null; state is a lowercase word.
   - Batch values are shape-checked: id, a hex64 `pczt_hash`, txid, height, and a word for state.
   - `pool: "banana"`, `txid: "zz"`, `kind: "junk"` and `pczt_hash: "zz"` are all REFUSED now.
   - `treasuryFunded` collapses identity-less lines by their content, so it no longer fails open: 2000 before, 1000 now.
   - **Carried:** `String(destA) === String(destB)`, encoding renderings (base64, split strings, zero-width characters), and the `verifiedLocal` `code === 0` arm.
4. **No false alarms.** Over the 26 committed settled documents (strict verify), there are 0 verdict changes from R78.
5. **The attempt-11 auction-core FAIL was not a code fault.** It failed at deposit 6/6: the bidder wallet had 0 spendable, because attempt 10's auction-core refunds and change had not matured yet. The spec's finally-block recovery returned the five deposits. Attempt 11 was stopped after its in-flight settle-crash. The next attempt runs only once Reviewer R has approved R79 and the wallet's notes are mature.
6. **A fourth comment-swallow (head, R79 edit, `clear/mode-b.ts`).** Typecheck caught it before commit, but `comment-swallowed-statement` did not, because the text ended in `})`. The rule now also flags a comment carrying a statement keyword after `;` that ends in code: it flags a probe of this shape plus the three earlier incidents, and HEAD is clean.

### R80 — Reviewer R on R79 (`pr-rg-r79.md`, BLOCK: N-3)

R confirmed N-1 (case), N-2 (keys at any depth), the row/batch value shapes and the treasury dedupe FIXED.

1. **N-3 (P1, FIXED): the new batch value check demanded a `pczt_hash`.** The product publishes `pczt_hash: null` for a batch set aside before staging (R46, `ledger.expire`), so verify would have refused an honest settlement. `pczt_hash` may now be null or hex64. The proof (`repro/r79-leak-guard.out`) adds the honest set-aside batch (pczt_hash, txid and height null; state `exception`): ACCEPTED, while every R79 tamper stays REFUSED.
2. **N-4 (P2, carried).** `markPublic` keys on the vault wallet, not on the address's role. The specs also use vault addresses as `fee_reserve_ua`. That is the escrow's own reserve address, not a bidder destination, so linking it reveals no bidder, and it stays unredacted. Buyback's host-derived deposits are not registered, but buyback writes no evidence files, so nothing is redacted there.
3. **N-5 (P2, carried).** The widened swallow-rule arm can false-flag English comments of the shape `…; for details see …]`, and still misses literal-free swallowed calls. HEAD is clean; the typecheck and pre-commit gate are the backstop.
4. **The gate.** Attempt 12 re-provisions the hosts at R80 and runs all six projects with the R79 preflight: the vault empty and every bidder note spendable before each project.

### R81 — Reviewer R on R80 (`pr-rg-r80.md`, BLOCK: R-1, R-2), plus three regressions the head found by running the folds offline

R confirmed N-3 FIXED.

1. **R-2 (P1, FIXED): the destination rule admitted Sapling, which settlement cannot pay.**
   - `requireShieldedDestination` (`envelope/destination.ts`) now also requires a unified address with an Orchard receiver (typecode 0x03).
     - At seal time, a bidder cannot seal a Sapling or Sapling-only-UA refund.
     - At open time on a host, such a destination is refused, so `openDestination` gives null and the row is a claimable exception, never a batch that can never be built.
   - `isUnifiedOn` (escrow and seller UAs, which are operator-configured) is unchanged. A Sapling-only seller UA remains a P2 residual.
   - **Proof** (`repro/r81-destination-rule.out`): Sapling and Sapling-only-UA destinations were sealed and opened before; they are refused at seal and at open, and give null, now. A Sapling+Orchard UA still seals.
2. **R-1 (P1, FIXED by construction): receipts and maps are keyed by a per-bundle action index without the pool.**
   - The settlement worker refuses a batch whose payments span more than one pool, before any signature, so no funds move (`settle/cli.ts`, after `inspect(created)`). R-2 makes every payable destination Orchard-capable, so mixed batches are not expected.
   - Verify's uniqueness key carries the pool.
   - Carrying `pool` in the signed map body is deferred to Phase 7; it changes the signed format.
3. **Found by the head, FIXED.** Running every cli-auction offline fold through Playwright on this tree surfaced three regressions from the agent-friendly merge and R77–R79, each of which would have failed cli-auction live:
   - **Phase 2/3 legacy evidence** (`r15-phase2-4`, `mr-verify-phase2-4`). The R79 row/batch shape checks and the trust registry refused the pre-Phase-5 settlement shape. They now apply to every current document; the pre-Phase-5 legacy format is decided by SIGNED data (no `envelope_keys`, no witness set). A new `format` check refuses legacy projections for any later manifest, so an operator cannot choose the old format.
   - **The trust registry** named only `accounting` for `rows`. On a settlement with no result, only `accounting-strays` reads rows (`r23-3-api-claims-with-beacon`). Both are now named.
   - **The `g-forged-claim` control fixture** used `txid: "attacker-tx"`, which R77's field check rightly refuses. It now uses a 64-hex txid, and the in-memory fixture excludes only the new `format` check.
   - All 53 offline fold IDs PASS. The 26 committed settled documents show 0 verdict changes against R79.
4. **Fixture updates.** The Sapling-only UA literal used as a "good" destination in the folds and the cross-chain demos (`e2e/lib/readpath*.ts`, `crosschain/*.mjs`, `tools/repro/xchain-demos.ts`) is replaced by Orchard-capable fixture UAs from `zcash-address-cases.json`. The envelope length test still compares two receiver sets of different lengths.
5. **The gate.** Attempt 12 was stopped after golden-path (9/9) and the in-flight auction-core. Attempt 13 re-provisions the hosts at R81 and runs all six projects with the preflight.
6. **Residual (P2).** An esbuild single-file bundle of the e2e folds deadlocks, because the envelope's top-level await meets the existing `api/public-auction` ↔ `adapters` cycle. The shipped bundles and Playwright are unaffected; the folds run under Playwright.

### R82 — Reviewer R on R81 (`pr-rg-r81.md`, BLOCK: R-3)

R confirmed R-1 (local), R-2 and the registry `rows` change.

1. **R-3 (P1, FIXED): R81's legacy downgrade was keyed on optional, operator-signed manifest fields.** A manifest with Phase-5+ features that omitted `envelope_keys` and the witness set skipped the row/batch guards and the trust registry.
   - **There is no downgrade any more.** Every settlement guard runs on every document, legacy or not:
     - the key and value shapes;
     - the trust registry;
     - the leak guard;
     - receipt attestation.
   - **One shape set fits both the current and the worker-summary shapes.** Batches may carry `proofs`, and a Phase 3 batch may have no `state`. The worker summary's `plan` and `signoffs` are registered as informational, and the leak guard still scans them.
   - **New:** `settlement.auction_id`, when present, must equal the manifest's.
   - **The `format` gate is defense in depth only.** Legacy projections are readable only for a manifest with no Phase-5+ feature: no envelope_keys, witness set, bond, lots, series, serials, sealed_reserve, or non-uniform clearing.
   - **Proof** (`repro/r82-legacy-format.out`, on the real Phase 3 evidence):
     - a smuggled `rows[0].note` and a foreign `auction_id` were ACCEPTED before and are REFUSED now;
     - a legacy dir whose manifest carries a bond is refused by `format`;
     - the honest Phase 3 document is ACCEPTED.
   - The 53 offline folds PASS, and the 26 committed settled documents show 0 verdict changes.
2. **R-6 (P2, FIXED).** The `g-forged-claim` control now uses a current-format fixture (its own dir with a minimal `auction.json`) and excludes no check.
3. **Carried (P2, Phase 7):**
   - **R-4:** custody builds (`hostBuild`, `sign build`, `sign approve`) have no one-pool refusal; maps and receipts stay pool-blind; a local trip is untyped rather than a set-aside. R-2 makes every bidder destination Orchard-capable, so a mixed batch needs a non-Orchard seller UA.
   - **R-5:** the seller UA is operator-configured and not checked for payability. Phase 7 checks it at manifest creation.

### R83 — Reviewer R on R82 (`pr-rg-r82.md`, BLOCK: R82-1), and the gate's scope from here

1. **R82-1 (P1, FIXED): R82's shape set missed `lwd_endpoints`.** Every current worker `summary.json` carries it (`settle/cli.ts`), so the registry, which now runs on every document, refused an honest settlement. It is registered as informational: the worker's public lightwalletd hosts, still scanned by the leak guard. **Proof** (`repro/r82-legacy-format.out`, R83 lines): Phase 3 plus `lwd_endpoints` is ACCEPTED.
2. **R82-3 (P2, FIXED).** Every settlement receipt's `auction_id` must equal the manifest's. A receipt naming another auction is REFUSED.
3. **R82-2 (P2, carried).** Batch `proofs`/`inspect`/`signing` values are not shape-checked, so an encoded blob is seen only by the pattern leak guard. That is the standing encoding residual.
4. **Regression.** The 53 offline fold IDs PASS, and the 26 committed settled documents show 0 verdict changes.
5. **Scope freeze for gate RG (head ruling).**
   - From attempt 13 on, a finding blocks gate RG only if it is a REGRESSION: behavior that worked at R65 or in an earlier green project and is broken now, or a defect in a change made during RG (R73–R83).
   - A real but pre-existing product defect goes to the Phase 7 hardening list, with its fix and proof before mainnet.
   - Reasons:
     - R72–R82 converged on smaller and older edge cases (each real, each fixed);
     - the gate is a regression gate;
     - mainnet needs its own release regression (RG-M) anyway, at the release commit.
6. **R83 review: APPROVE** (`benzo-sol/reports/pr-rg-r83.md`). Both fixes hold in the shipped bundle, and there is no regression in range. Its two Phase 7 items and every earlier carried P2 are in `docs/design/phase7-hardening.md` (H1–H7, the release scrub, the accepted residuals). The Codex `gpt-6.1-sol` smoke test (2026-10-17: 29 reproduced tests) added H1.

### R84 — Gate RG attempt 13 complete (head, 2026-10-18)

1. **Result.** All six live projects pass and all five §3 live mutations are red as expected, on one product commit, `910a531`. The full record is the RG row in `docs/evidence/phase-6/EVIDENCE.md`.
2. **Why `910a531`, not `22d4424`.** The ALT lightwalletd endpoint (`zaino.testnet.unsafe.zec.rocks`) answered 503, so the hosts' window-start header read failed with an empty `lightwalletd GetBlock:` error. The hosts were re-provisioned with `BNZ_LWD_SINGLE=1`, which rewrote the signer manifest (`910a531`). Markets ran there, so the other five projects were re-run there too (user, 2026-10-18: "yes everything should be updated").
3. **Not verdicts.** U2 commits `3658282` (the bidder-funds floor: NOT RUN until the user funded the bidder from the faucet) and `e7f6814` (a local DNS outage mid-settle) are superseded by `c6f2dd0`.
4. **Harness fixes.** `tmp/rg/mut2.sh` now checks out the manifest before its host revert, so a mutation's own `up.sh` rewrite cannot block the revert. `settle/cli.ts` `hostDerivable()` keeps only the last 200 chars of host stderr; this hid the 503 and is added to the Phase 7 list as H9.
5. **Next.** Reviewer R on attempt 13. Then gates H and SC (live half) and the DOC walkthrough, while H1–H9 land.
6. **Review and verdict.** Reviewer R: **APPROVE** (`benzo-sol/reports/pr-rg-r84.md`). It confirmed one product commit (`910a531`), all six run records, all five mutations and the superseded U2 records, and found no leak. Its two P3s: the RG row's commit-field wording (fixed), and the mutation runner's `ERROR ids:` line mixing check IDs with console tokens (harness only; the RED verdict cannot false-match; the runner will intersect with the run's ID set next time). **Gate RG is PASSED.**

### R86 — Gate H closure table (head, 2026-10-18)

1. **B38 (Builder B, MiMo) delivered `docs/evidence/phase-6/h-closure.md`** against `docs/design/phase6-h.md`: 34 P0 rows, 0 gaps. The head spot-checked the rows most likely to be over-claimed (2, 7, 11, 14, 16, 22, 23) against the code.
2. **Head changes.** Rank 7's proposed README line (committed evidence files with past testnet destinations) is repo history, not a product limit: the release scrub (R74–R76) removes it before any public export, so it is dropped and the row is **closed**. The other six README lines are added to `## Honest limits`. A stray sentence fragment in the lightwalletd-endpoints bullet is removed.
3. **H10 (Phase 7).** Rank 16: the seller payout address comes from the coordinator's packet, and hosts check only its amount (R28 item 8, already a stated limit). Fix before mainnet: bind `seller_ua` in the signed manifest.
4. **Infra note.** T3's worktree isolation for this thread checks out the wrong repository (the `Dev Projects` root), so the builder made its own Benzo worktree (`../benzo-b38-h`, branch `t3/gate-h-closure-table`). Its commit was cherry-picked onto main. Future builder batches name the worktree explicitly.
5. **Next.** Reviewer R on h-closure.md and the README patch.

### R87 — Reviewer R on gate H (`pr-h-r86.md`, FIX-FIRST: 2 P2, 4 P3), all fixed

1. **F1 (P2), rank 22 censorship over-claimed.** `benzo verify` checks omissions only against the operator's own `mined-deposits.json` (a withheld list passes, `api/missing-deposits.ts:41`), and witnesses check leaf validity, not completeness (`witness/recompute.ts:5`). Row 22 is now **closed + disclosed**; README gains "An operator can refuse a funded bid"; Phase 7 **H12** (witnesses publish their own deposit lists).
2. **F2 (P2), seller payout understated.** One malicious coordinator can redirect the seller's proceeds and the published settlement cannot show it. **H10 is now P1, fix before mainnet**, and the README bullet says so plainly.
3. **F3–F6 (P3).** Row 14 no longer claims backup rollback is safe (never restore a signer host from a snapshot); row 1 states the bond-then-pay C; row 13 cites who runs each share (README:143-147); line ranges and the six "README GAP" State cells are corrected.
4. **Next.** Reviewer R round 2.

### R85 — Gate SC live half: scale-55 (head, 2026-10-18)

1. **Run.** `tools/repro/markets.ts scale-55` (new scenario, `1b871d5`): 55 bids + the seller, `batch_cap` 14, funded in 3 transactions of at most 19 deposits (one 55-output funding transaction would be about 190 KB). The first `open` failed on a drand relay timeout; `resume` finished it: **RESULT PASS, verify exit 0, 4 batches mined** (`f5512693…`, `4ee0bb05…`, `ed82b349…`, `d1680726…`; 50,194 bytes and 75,000 zats each).
2. **Measured.** About 5 minutes per batch, sequentially: host build about 100 s, two host approvals about 90 s, FROST 8.1 s (flat), mining 80–115 s. Table: `docs/evidence/phase-6/scale-measure.md`.
3. **Finding (P1 for scale).** Host build and approval time grows with the auction's size, not the batch's: each host re-decrypts every frozen leaf per batch (`cli/host-derive.ts`). The offline projection of 20.9 h for 17,000 bids does not hold. README corrected; Phase 7 **H13** (decrypt once per host per auction, offline from the verified beacon, cache the openings). **H11** (one drand relay per leaf at `open`) recorded from the same run.
4. **Gate SC** is READY FOR REVIEW: the live target (≥ 50 bids, ≥ 4 batches) is met, and the projection is honestly corrected.

### R88 — Gate H PASSED (head, 2026-10-18)

Reviewer R round 2 (`benzo-sol/reports/pr-h-r87.md`): **APPROVE**. F1–F5 fixed; it confirmed the refused-bid claim path (memo stray → owner-signed `claim-refund`). F6 and two new P3s (stale "README GAP" cells and provenance labels in `h-closure.md`) are fixed here. **Gate H is PASSED.** Its Phase 7 items: H10 (P1), H12.

### R89 — Gate SC PASSED (head, 2026-10-18)

Reviewer R (`benzo-sol/reports/pr-sc-r85.md`): **APPROVE**. It confirmed the chunked-funding harness, the run record (all 24 timing values, receipts for all 56 rows reconcile to the uniform clear at 340), the H13 scale finding and H11. Its three P3s are fixed: the chain-level numbers now have a raw file (`scale/scale-55-txs.json`); the harness retries a funding chunk only on a pre-broadcast refusal and writes `funding.json` after every chunk; H13's fix names its cache key (auction id + pinned frozen root) and the stray decrypts. **Gate SC is PASSED**, with the 17,000-bid limit stated in the README until H13 lands.

### R90 — Gate PK: the clean-machine run is a fresh VM (head, 2026-10-18)

User, 2026-10-18, verbatim: "you can do it on a virtual clean machine if you want to or you can even use aws cli that i have run it all and then shut down everything clean". The head used a local OrbStack VM (`benzo-pk`), not AWS (no cloud resources). The run is `docs/evidence/phase-6/pk-vm/` at `9d09093`, and replaces the "stranger's run" OPEN item. The install, the offline `benzo verify`, the tamper refusals and the bidder seal all **PASS** on that machine. The verify bundle rebuilds byte-identical on Linux. The two tarballs reproduce only on macOS: GNU tar lacks `--uid`, macOS writes gid name `wheel`, and Apple gzip ≠ GNU gzip. Batch B41 (`docs/design/phase6-pk-b41.md`) fixes that. PK is recorded after B39 and B41 merge, by re-running steps 02–04 on the VM.

### R91 — Gate DOC: B40 merged; seller address is the seller's own wallet (head, 2026-10-18)

B40 (`ae7219d`, `bbeaf19`, `a02de11`) adds `benzo witness set`, `auction addresses` and `drand round`, the two templates, and a rewritten operator guide step 1. Its proof passes again on main. The head reviewed the code and accepts B40's choices on questions 1–4:
1. `--key` must resolve to the manifest-signing key.
2. `drand round` clamps a pre-genesis time to round 1. `witness set` refuses to replace a different record.
3. The fixture group key is fine for an offline proof.
4. Addresses are registered as public by the capture, not the CLI.

**Question 5 found a head design error.** `phase6-doc-b40.md` said the seller address is a fresh vault address. The harness uses an external wallet (`markets.ts:262`, `sellerUa = bidder()`), which is correct: a vault address would leave the proceeds inside the auction vault. The guide step 1.2, `private-operator.json` and the proof's comment now say the seller UA is the seller's own shielded wallet address. B39 (H10) will commit it in the manifest. Next for DOC: the live walkthrough of the operator, signer and bidder guides on testnet.

### R92 — Gate DOC: paper walkthrough → batch B42 (head, 2026-10-18)

The head mapped every operator, signer and bidder guide step to what the live harness does. It found eight gaps (G1–G8, `docs/design/phase6-doc-b42.md`). The worst is that two custody steps exist only in the harness, which edits JSON directly: merging the hosts' witness certificates and filing the hosts' envelope-opening reports. The others are a wrong step order (witness before freeze), the undocumented fee-reserve funding, the two `deposit.json` shapes, private files that must live under `$BNZ_STATE_DIR`, per-signer keys described as per-auction, and the host vault sync. B42 moves `e2e/lib/hosts.ts` into a `benzo hosts …` command group that the harness also uses, and fixes the guides. The live walkthrough runs after B39 and B42 merge. The hosts are provisioned again at that commit, because B39 changes host code.

### R93 — Phase 7 B39 merged: H10 and H11 closed; H14 found (head, 2026-10-18)

B39 is on main (`aa0229e` H10, `787fab6` H11). The verify bundle was rebuilt: `7eda2871…`. On main, the head re-ran the H10 repro (RESULT PASS), the H11 repro before and after (both RESULT PASS, including the byte-identical opened set), `npm run check` and `npm run e2e`. The verify guide's example still prints 19 OK lines. Head rulings on B39's questions:
1. Accepted.
2. `auction create --config` is the plumbing. The live harness and the operator guide wire it in B42, and the live proof runs after that.
3. Exit 3 with named rows is accepted.
4. and 5. Accepted.

**H14 (P1, new; it predates B39):** a bidder can stop any open with a malformed-but-admitted ciphertext (`phase7-hardening.md` H14). It goes to the next builder batch after B42.

### R94 — B41 merged; the last cross-OS difference was symlink modes (head, 2026-10-18)

B41 is on main (`abfea23`). It uses bsdtar with the owner names pinned, and Node zlib with the OS byte pinned. On the clean VM the bidder bundle then rebuilt identical to macOS (`f6afad13…`). The npm package still differed in one tar header: macOS keeps a symlink's own mode (0755 for `node_modules/rpc-websockets/node_modules/.bin/uuid`), while Linux symlinks are always 0777. Both builder slots were busy and this blocked PK, so the head fixed it in `tools/deterministic-tar.mjs`: every symlink header is pinned to 0777 and its checksum recomputed. After the fix the macOS build equals the earlier Linux build exactly (`d5f8fa10…` at `abfea23`).

Also fixed: the README's stale verify-bundle digest (`b122bf2b…` → `7eda2871…`, flagged by B41) and `reproducible-build.md`. Digests at this commit:
- verify `7eda2871…`;
- npm `1aa2b077…` (two macOS builds identical);
- bidder `f6afad13…`.

B41 questions:
1. The Phase 4 example needs `--legacy-unattested`; the PK proof uses `launch-cold`.
2. Fixed here.
3. Noted.
4. The VM rebuild at this commit is the record.

### R95 — Gate PK PASSED at `e1ddd69` (head, 2026-10-18)

On the clean VM (R90), at `e1ddd69` (`pk-vm/at-e1ddd69/`):
- install, offline verify, tamper refusals and the bidder seal all pass;
- a fresh Linux clone rebuilds the verify bundle, the npm package and the bidder bundle byte-identical to the macOS build.

The stranger requirement is met by the clean VM (R90). Batches merged after this move the digests, so the release commit gets one more run of steps 02–04 on `benzo-pk` (about 10 minutes), recorded the same way.

### R96 — Gate DOC: B42 merged (head, 2026-10-18)

B42 is on main (`27e35db`, `b793614`):
- the `benzo hosts keys|dkg|witness|envelope-opens` commands, running the moved `cli/hosts.ts`, which the harness now re-exports;
- a checked witness-certificate merge;
- `--show` for both signer public keys;
- H10's `--config` wired into the five live `auction create` calls;
- the three guides, with G1–G8 covered.

On main its stub-orb proof passes again (RESULT PASS, 58 guide commands match `--help`), and so does `npm run check`. Head rulings on its questions:
1. and 2. Accepted.
3. `bid deposit` does not enforce `privatePath` on `--file`. That is fine: a deposit file holds the bidder's own sealed bid, not operator secrets. The guides still keep it under `$BNZ_STATE_DIR`.
4. and 5. Accepted.

Next: provision the hosts again at this commit (`deploy/signers/up.sh`; B39 and B42 changed host code), then walk the three guides live on testnet.

### R97 — Gate DOC PASSED: the three guides walked live on testnet (head, 2026-10-18)

The hosts were provisioned at `5d4f91a`. `tools/doc-walk.sh` ran one uniform auction using only guide commands (EVIDENCE DOC row). Attempts 1–3 stopped before any payment:
1. a driver bug (`node -e` argv);
2. G10, `bid seal` does not print `address`;
3. a transient lightwalletd dial timeout on bob during `hosts dkg`. `hosts dkg` cannot resume after a partial failure (the vault exists), so the retry used a fresh id. That is acceptable, because a failed DKG has nothing funded.

Attempt 4 passed end to end: settle, cold verify and the on-chain landing of every row. That includes the seller payout at the committed address, which is **H10 proven live**. The run found and the guides now fix:
- **G9:** admission refuses until 10 confirmations, so leave about 10 blocks before `T_freeze`.
- **G10:** `address` comes from `private-bid.json`.
- **G11:** `benzo report` is buyback-only.

Leftover: the auction vault keeps the fee-reserve change, 35,000 testnet zats in one note. No command returns a host-custody vault's leftover after settlement, and the shared-vault sweep cannot sign for it. That is **H15** (`phase7-hardening.md`); the testnet note stays put.

### R98 — Phase 7 B43 merged: H14 and H13 closed offline (head, 2026-10-18)

B43 is on main (`ee9c5d7` H14, `0c5e018` H13; round 2 after a provider drop). It brings one sealed-bid shape rule at admission (`envelope/opening.ts`) and one offline opener everywhere. A host's openings cache is keyed by frozen root and beacon. `verify --openings-cache` is host-only: verify on 1,000 leaves took 26.7 s, over the 5 s design threshold.

The head re-ran on main:
- `npm run check`, e2e;
- the H14 repro, red before (bundles built from `e821ba0`) and green after;
- the H11 repro.

The old dirs `launch-cold` and the gate DOC run still verify, 19 OK each. The verify bundle is now `598395fd…`, the npm package `835f053c…`, and the bidder `f6afad13…` is unchanged. Head rulings on its questions:
1. Keep `verify --tle` (an opt-in cross-check that nothing calls).
2. Yes: the remaining per-batch cost is `benzo-pczt classify-address` (about 60 ms per row). That is H16 (P3); `phase7-hardening.md` gets the row.
3. The two folds that were already red at the base (r42-f11-strays, r33-balance) go to the fold-repair item.
4. No: `open` runs once per auction and the plan is offline now.
5. Noted.

Next: provision the hosts at this commit and re-run SC scale-55 live.

### R99 — Live `auction publish` broken by B43's bundle imports; fixed with a load check (head, 2026-10-18)

The first scale-55 run after B43 stopped at `auction publish`, before any funding: `settle/dist/cli.mjs` threw `Dynamic require of "node:crypto" is not supported`. B43 made `settle/envelopes` import the tlock opener (tlock-js, `@noble/curves`, which are CommonJS). B39 had given the createRequire banner only to `clear/dist/auction.mjs`, and the offline suites never load `settle/dist/cli.mjs`, so nothing caught it.

Fix (head; the build script only): every ESM bundle in `build:core` and `build:settle` now gets the banner, and the new `npm run check:dist-require` (part of `npm run check`) refuses a build line or a built bundle without it. Main was broken for live publish from `ee9c5d7` to this commit; no live run happened in that window except this one. The scale-55 re-run follows.

### R100 — Reviewer R on B39–B43: REQUEST CHANGES (two P1s in B43's opener) → B44 (head, 2026-10-19)

Report: `benzo-sol/reports/pr-p7-b39-b43.md`. It confirms H10 is solid on every host path. It also confirms the H13 cache cannot redirect funds, B42's checked merge is correct, and the B41/R94 tar rewrite matches bsdtar byte for byte.

**P1-1 and P1-2, reproduced by the head** (`tmp/r100/probe.ts`):
- an admitted bid with a junk 128-byte stanza body makes `openSealedBid` throw (`invalid G2 point`);
- a stray memo naming another round throws (`ciphertext beacon round`).

Each one stops open, verify or settlement for everyone. B43 did not meet its own contract ("throws only for problems that are not the leaf's"). The fix is batch B44 (`docs/design/phase7-b44-opener-fix.md`): the opener never throws on a leaf or memo, and admission checks the G2 point.

The P2 (verify cannot reproduce a reorg row; pre-existing) is H17. The P3s are H18. **H14 is reopened until B44 merges.**

### R101 — Gate SC re-measure after B43: per-batch host work about 7× faster and flat; H16 upgraded to P1 (head, 2026-10-19)

Live scale-55 at `6a5c45a`, with the hosts provisioned at `f703a28`: **RESULT PASS** (`scale/scale-55-b43.log`, timings `scale/scale-55-b43-timing.jsonl`, auction `b3c1f541…`). That covers clearing equal to the pure clear, 55 receipts, every refund landed, and the cold verify. The first attempt stopped at publish (R99).

| Per batch | R85 (before H13) | after B43 |
|---|---|---|
| host build | ~100 s | ~14 s |
| each host approve | ~89 s | ~4–7 s |
| sign | ~98 s | ~14 s |
| total settle compute, 4 batches | 1,949 s | 645 s, most of it mined-wait |

Each figure is flat across batches 1–4. At N = 1,000, B43's offline profile still puts 63 s in the second batch (`classify-address` once per row of the whole auction), so per-batch cost is still O(N) and **H16 is P1 (scale)**: batch B45 (`docs/design/phase7-b45-classify.md`). The README's 17,000-bid limit stays until B45 lands.

### R102 — B44 merged: the opener never throws on a leaf or memo; H14 closed again (head, 2026-10-19)

B44 is on main (`0bd5130`, `6e2398b`, `90e6861`). `openSealedBid` now reads the round from the verified beacon client, never from the ciphertext. Any shape failure, wrong round included, and any tlock/age/IBE exception now return `null` (`undecryptable`). The only throw left is a client that serves no round, which no ciphertext can cause. Admission also requires the stanza's 96-byte U to be a valid compressed G2 point.

The head re-ran the R100 probe on main:
- the junk body is refused at admission and opens `null`;
- the wrong-round memo opens `null`;
- the honest bid opens.

`npm run check` and e2e pass. The old dirs verify (19 OK each). The verify bundle is now `ac5d68e9…`. Rulings on B44's questions:
1. Accepted: one shape rule in admission and the opener. Old evidence verifies, as the folds prove.
2. Not needed: a point-at-infinity U passes admission and opens undecryptable, refunded like any invalid bid.
3. Noted.

**H14 is closed.** Reviewer R's P1-1 and P1-2 are fixed. Reviewer R round 2 runs on B44 with B45.

### R103 — B46 round 1 not merged: vault value is fungible, so the reserve return must be value-based (head, 2026-10-19)

B46 round 1 (`8dad770`, `2f582ca`, `76ecdf8`) implemented the design's "eligible notes" rule. Its question 1 shows the rule is wrong: the wallet picks the inputs of every batch, so a stray's value can sit in internal change, and an internal-change-is-the-operator's rule could return a bidder's unclaimed money to the operator. The head revised `phase7-b46-reserve-return.md`: return only when nothing is owed, the vault's whole value minus the fee, inputs equal to the scanned total. Round 2 goes to the same builder on the same branch.

### R104 — B45 merged: classification in bulk and cached; per-batch host work flat in N (head, 2026-10-19)

B45 is on main (`3b64ec0`…`4c2a227`). It adds `benzo-pczt classify-address --stdin` (the same audited `zcash_address` calls), `classifyAddresses` with an in-process memo, and a host prefetch with `auctions/<id>/classify-cache.json`, which is keyed by sha256(address) and discarded when the classifier binary changes. The equivalence proof covers 643 R24 vectors plus invalid inputs, bulk equal to single byte for byte, and the old and new binaries are identical on 640 inputs.

Offline h13: the second batch takes 1.2 s at N = 55 and 1.65 s at N = 1,000 (it was 4.0 / 61.0 s), with **zero** classifier spawns. The first batch keeps one decrypt per leaf, once per host per auction. On main the head re-ran:
- `npm run check`, e2e;
- the B45 repro;
- the R100 probe, which still opens both griefs as `null`.

The verify bundle is unchanged at `ac5d68e9…`. Rulings on B45's questions:
1. Accepted: the prefetch opens the envelopes first.
2. Same trust class as `openings.json`, the host's own state; no tamper evidence needed.
3. Noted.
4. **The README's scale wording is re-measured live first:** hosts provisioned again, then scale-55. The 17,000-bid line changes only on measured numbers.
5. The B44 probe was re-run on main: green.

### R105 — scale-55 after B45: settled after one fee-reserve top-up; per-batch flat; README scale line rewritten; H19 (head, 2026-10-19)

The hosts were provisioned at `24638e4`. Auction `58d60e90…` paid 3 of 4 batches, then stopped at batch 4: `InsufficientFunds {available 2,657,140, required 2,677,480}` from every host, before any broadcast. Fees are `5,000 × max(2, actions)` and the wallet chooses the spends, so batches 1–3 paid about 350,000 zats against the 225,000 expected. The head topped up the fee reserve (200,000 zats, `51c9c554…`) and re-ran `benzo settle`. Batch 4 broadcast (`1805fc1e…`), 56/56 rows settled, every batch-4 output landed (14 notes, 2,607,480 zats), and the cold verify printed 19 OK.

Per-batch timing is flat (`scale-measure.md`). The README's scale paragraph now states the measured flat cost, settlement bounded by block inclusion, and a 17,000-bid projection marked as not measured. **H19** (fee reserve sizing and the settle preflight) is added. The operator guide's step 5 now has the doubled formula and the top-up recovery, which this run proved.

### R106 — B46 merged: the unused fee reserve returns when nothing is owed (H15 closed offline) (head, 2026-10-19)

B46 rounds 1 and 2 are on main (`5b0d97b`…`27962cf`; one import-line conflict with B45 in `cli/host-derive.ts`, resolved as the union). How it works:
- The manifest commits `reserve_return_ua_commitment` (set by `auction create --config`; mainnet requires it).
- The return is planned and approved only when nothing is owed (`settle/deposits.ts` `reserveReturnOutstanding`). That means every owed row receipted, and no stray or balance note unpaid, spent or not.
- It pays the vault's whole unspent value minus the ZIP-317 fee. Hosts require `input_zats` equal to their own scanned total and that exact output.
- Verify accepts exactly one return, only with nothing outstanding.

On main the head re-ran:
- `npm run check` and e2e;
- the B46 green leg (RESULT PASS);
- the R100 probe (B44 still holds).

Three published dirs still verify, 19 OK each (launch-cold, the DOC run, scale-55 after B45). The verify bundle is now `f146a894…`. Rulings on its questions: Q2 is fine as is. Q3 and Q4 are noted. **Q5, the settle worker's reserve-return batch, has no offline end-to-end proof, so the head proves it live next**: provision the hosts and run one small auction through settle and the return.

### R107 — B46 blocked all settlement on a committed manifest; fixed (head, 2026-10-19)

The live H15 walkthrough (auction `426b8585…`, hosts at `8a9f638`) stopped at `benzo settle`: every host's `sign derivable` exited 3 with `refused-rows ["reserve-return"]: the auction still owes 4 outstanding`, so **no** row could be listed and nothing paid. Every settlement packet carries `routing.reserve_return_ua`, so `deriveReserveReturn` bound the address on ordinary batches and refused while anything was owed. B46's offline proof never built an ordinary-batch packet with the address set; this is exactly its open question 5.

Fix (head, `cli/host-derive.ts`, one line): while something is owed, only a packet that **declares** the return row is refused; any other packet gets "no return row yet". The B46 repro still passes green and `npm run check` passes. Hosts are provisioned again, and the walkthrough resumes at `benzo settle` for the same auction. Deposits are safe in the vault meanwhile.

### R107b — The reserve-return gate counted the return itself as outstanding; fixed (head, 2026-10-19)

After R107, batch 1 of `426b8585…` paid all four rows (SETTLED). The return then needed batch 1's change to be spendable, so it was a second `benzo settle` (logged cleanly: "the reserve stays in the vault until the next benzo settle"). That second settle allocated the return as batch 2 and then crashed with `Cannot read properties of null (reading 'amount_zats')`. Two causes:
1. The plan counted the return's own allocated batch as a pending batch, so `plan.reserve_return` went null.
2. `reserveReturnOutstanding` would count the published return row (no receipt yet) as unresolved, on the hosts too.

Fix (head):
- the pending-batch count excludes the batch holding the `reserve-return` obligation (`settle/plan.ts`);
- the shared outstanding rule skips the `reserve-return` row itself (`settle/deposits.ts`);
- the worker takes the amount from the allocated batch (`settle/cli.ts`).

The B46 repro still passes green and `npm run check` passes (verify bundle unchanged). This is the third live-only wiring gap in this path (R99, R107, R107b), so **an offline end-to-end proof of the settle worker's reserve-return pass** goes to the next builder batch.

### R108 — H15 proven live: the unused fee reserve returned to the committed address (head, 2026-10-19)

Evidence `docs/evidence/phase-7/h15-live/`. After R107b, the hosts signed the return and it mined: `46b5a8ac…` at 4,516,884 paid **25,000 zats to the committed return address**, from 35,000 remaining minus the 10,000 fee, leaving the vault at 0 value. The published receipt and accounting are present, and the cold verify printed 19 OK. Two settle re-run gaps remain (a mempool resend exits 1; a re-run after the return refuses to republish). They are cosmetic for the outcome and recorded as **H20**, together with the missing offline end-to-end proof of the settle worker. **H15 is closed.** The operator guide gains one line: the return may need a second `benzo settle` once the last batch has confirmed.

### R109 — B47 merged: settle worker idempotence, fee preflight, and the first offline end-to-end proof of `benzo settle` (head, 2026-10-19)

B47 is on main (`a8513ab`, `c05f885`, `b80a23c`):
- a mempool resend or an already-mined txid counts as broadcast (H20.1);
- once the return is receipted, its accounting is kept from the paid batch's inspect record or the published doc (H20.2);
- a fee-reserve preflight stops before any broadcast with the exact top-up line (H19).

`tools/repro/b47-settle-e2e.ts` runs the **real** `bin/benzo settle` against stub chain, wallet and orb tools, with the real host `sign` commands in three state dirs. Cases (a)–(f) are green, 33 checks. On pristine `8a9f638` it reproduces the exact live R107 refusal wall and the R107b crash, so this test layer would have caught both.

Head change at merge (Q1): the top-up is `shortfall + max(ceil(shortfall/10), 5,000)`. The head re-ran B47's e2e on main (RESULT PASS) and `npm run check` (verify bundle unchanged, `f146a894…`). Rulings on Q2–Q5: accepted. **H19 and H20 are closed.** No host code changed, so no host provisioning is needed.

### R110 — Reviewer R round 2 on B44–B46: REQUEST CHANGES (P0 in the reserve-return gate) → B49 (head, 2026-10-19)

Report `benzo-sol/reports/pr-p7-b44-b46.md`. **B44 is confirmed closed**: zero throws across every mutation, the honest sealer still opens, and all 10 call sites share one opener.

**P0-1:** the reserve-return gate trusts packet receipts. On a cancelled auction (no verify subprocess) a coordinator could fabricate receipts for unclaimed strays and get the hosts to sweep them. Unbroadcast-batch receipts do the same on cleared auctions.

**P1-1:** the classify prefetch throws on a crafted refund string (empty, or NUL/newline) and freezes every host.

**P2s:** the approval-ledger namespace split; a stale receipt after a reorg.

Batch B49 (`docs/design/phase7-b49-paid-means-mined.md`): "paid" means this host approved the txid and its own scan shows it mined 10 deep. That one rule is used by hosts and plan. The prefetch can never throw, and the ledger gets one source namespace. **The reserve return (H15) is reopened** until B49 merges. No live funds are exposed, because these are testnet auctions with no outstanding strays.

### R111 — B48 merged: Reviewer R's three P3s (H18 closed; H21 follow-up) (head, 2026-10-19)

B48 is on main (`e364ad4`…`ef396a8`; round 2 after a provider drop):
1. A seller mismatch refuses only the seller row, in a batch that has one.
2. `seller check` requires the signed `manifest.json`.
3. `verify --openings-cache` reads only the host's own file at its own path.

The head re-ran on main: `npm run check`, e2e, the B48 repro (RESULT PASS) and B47's settle e2e (RESULT PASS). The verify bundle is now `7bde8384…`. B48's Q2 and Q3 (derivable still refuses whole when a seller row exists; approve's untyped refusal) are **H21** (P3). Q1 is accepted as is.

### R112 — B49 merged: "paid" means this host approved it and sees it mined 10 deep; H15 closed again (head, 2026-10-19)

B49 is on main (`299907b`…`a6d46d2`; round 2 after a provider drop):
- `settle/deposits.ts` `paidByOwnLedger`, used by both the plan's and the hosts' reserve-return gate: a receipt counts only if one's own ledger approved that txid with that row at that amount, and one's own scan shows it mined at least 10 deep. Packet receipts are an index only.
- The classify prefetch never throws.
- One canonical approval-ledger source namespace, with migrate-on-read.
- Verify labels receipts `host-attested` and requires published mined batch txids when `settlement.batches` is present.

Merge conflicts were only the bundle hash and the status file. The head rebuilt the verify bundle from the combined tree: `c93f1e19…`. On main the head re-ran:
- `npm run check`, e2e;
- the b46 (now holding B49's cases a–f), b47 and b48 repros, all RESULT PASS;
- the R100 probe.

Four published dirs still verify, 19 OK each, including the H15 live run.

Rulings: Q1 (a zero-change batch cannot prove its own height, so its row stays outstanding) is accepted as conservative and noted in H15. Q2–Q6 are accepted. **Reviewer R round 2's P0-1, P1-1 and the P2s are fixed; H15 is closed.** The hosts need provisioning before the next live run.
