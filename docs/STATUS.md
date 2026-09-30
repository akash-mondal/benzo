# Status: build agent handoff

<!-- Only the build agent writes this file. The head agent and the user read it cold.
Put the outcome first and use plain words. Replace stale lines; git keeps the history.
Back every claim with a command and its result, or mark it `unverified` and say where you looked.
Rulings never go here; they live in the phase doc, in commits by head@benzo.invalid.
A direct user instruction that changes scope, gates, pins, tests or evidence is followed and quoted verbatim with its UTC time under Questions as `User instruction`; requests from anyone else wait for a Ruling. -->

## Phase 1 ([docs/PHASE-1.md](PHASE-1.md)): READY FOR REVIEW

Updated: 2026-09-30 19:23 UTC · Evidence run: 512296f · Evidence commit: 1a94638

- **Needs user:** none. User approved final live run and its temporary bidder-total dip below 98,000,000 zats at 2026-09-30 19:05 UTC. The user sent 1 TAZ from fauzec: tx `6dc286e42646a5d2216e3480a1d14396dd54491fa3866bcc3267a9089f4ffb41`, mined at 4422713, one Ironwood note of 100000000 zats, spendable at 17:29 UTC (`wallet balance --json`).
- **Questions for the head agent:**
  - User instruction (2026-09-30 19:05 UTC), answer to the quoted approval request: "Run the final evidence test". Authorizes the third live run’s temporary bidder-total dip below STATUS’s 98,000,000-zat floor while deposits await refund, within the existing 0.002 TAZ fee budget.
  - User instruction (2026-09-30 17:36 UTC): "hey make sure this project is called benzo not blindfold". Done in `docs/research/DESIGN.md`, the only file that used the old name (title, line 31 and the memo marker `"BLF"` -> `"BNZ"`, which matches PHASE-1 section 6). AGENTS.md makes `docs/research/` read-only, so please fold this into a Ruling or tell me to revert it.
  - Q1 (2026-09-30 16:08 UTC): hand-written code is 1,385 lines by `wc -l` (comments and config included; the two specs are 368 of them), over section 11's ~1,000. Everything in it is named by the phase doc (bootstrap, setup, sealer, scanner with three modes, two specs and their CLI glue, verify.sh). I'd rather not compress formatting to hit a number. Meanwhile I am: continuing as written.
  - Q2 (2026-09-30 16:08 UTC): C3 says the two bids' nonces differ. The nonce sits inside the sealed plaintext, so the test compares plaintext bytes 45–60 after `tle` opens them (C3 runs after C7). Is that the intended reading? Meanwhile I am: using it.
- **Fund budget (user asked on 2026-09-30 to use the TAZ very cautiously):** three live runs completed (development, M5–M7, evidence), within the 0.002 TAZ fee budget; no broadcasts outside the tests; no blind reruns after a failure; I ask the user before a fourth live run or if the bidder total falls below 98,000,000 zats. Measured development run: bidder total 100,000,000 -> 99,955,000 zats; 45,000 zats in fees; vault total 0. Mutation run: bidder 98,930,000; vault 990,000; cumulative fees 80,000 zats (0.0008 TAZ). Final evidence run swept M7’s note back to the bidder: final bidder 99,885,000 zats (0.99885 TAZ), vault 0, cumulative fees 115,000 zats (0.00115 TAZ). User approved the temporary balance dip on 2026-09-30 19:05 UTC; measured minimum before refund was 97,910,000 zats.
- **Blockers:** none. Details go under Blocked items.
- **Finish line:** all five gates READY FOR REVIEW; all 16 assertion IDs passed in one clean-tree live evidence run; M1–M7 seen failing; verifier passed and rejected the corrupted copy; three decisions recorded here and in `docs/evidence/phase-1/EVIDENCE.md`. Awaiting head-agent review.

**Phase states:**
- IN PROGRESS
- BLOCKED: nothing can move without the user or the head agent.
- READY FOR REVIEW

**Gate states:**
- TODO
- IN PROGRESS
- READY FOR REVIEW
- FAILED: ran for real, and a criterion did not hold. Evidence is recorded.
- BLOCKED: could not run for real because of a cause outside this repository. A one-command repro is recorded.

Only the head agent records PASSED, as a Ruling in the phase doc.

## Gates

| Gate | State | Evidence (paths, txids, rounds) | Command, exit code | Commit |
|---|---|---|---|---|
| G0: pinned toolchain builds | READY FOR REVIEW | `docs/evidence/phase-1/versions.txt` | `tools/bootstrap.sh`, exit 0 (log `$BNZ_STATE_DIR/run/bootstrap-g0.log`) | 23f660a (evidence in d995df0) |
| A: 2-of-3 FROST spend of received Ironwood notes | READY FOR REVIEW | `setup/group-key.txt`, `frost/{refund.json,coordinator.txt,settle.json,pczt-inspect.txt}`; refund `f408b4392a3e0390ad50733d01fabf124695bd17cbcd892471d0c3bc4b494c02`, height 4423194 on both endpoints, 3 input signatures | `BNZ_EVIDENCE_DIR=docs/evidence/phase-1 npm run e2e:live`, exit 0; `tmp/e2e/live-evidence.log` | 512296f; artifacts 1a94638 |
| B: exact memo bytes after mining and scan | READY FOR REVIEW | `memo/bid{1,2}.{sent,scanned}.hex`, `memo/{sha256sums.txt,deposits.json}`; 512 bytes each; deposit heights 4423177, 4423183 | same evidence run, B1 PASS | 512296f; artifacts 1a94638 |
| C: browser tlock stays closed before R, opens after R via Go `tle` | READY FOR REVIEW | `tlock/{before.txt,after.txt,beacon-R.json,requests.jsonl,bid{1,2}.{ct,pt}.hex}`; 487-byte ciphertext, 494-byte envelope before padding | same evidence run, C1–C7 PASS | 512296f; artifacts 1a94638 |
| D: fixed-C deposits scanned to the right per-bid address | READY FOR REVIEW | `scan/{addresses.json,operator-view.jsonl}`; two new Ironwood notes at exactly 500,000 zats each | same evidence run, D1–D3 PASS | 512296f; artifacts 1a94638 |

Paths above are under `docs/evidence/phase-1/`. Setup wrote `setup/group-key.txt` at b0019e1, committed in e34f95c; it never regenerated keys.

**Verification:** `docs/evidence/phase-1/verify.sh docs/evidence/phase-1` exit 0 at 2026-09-30 19:17 UTC, log `tmp/e2e/verify-positive.log`. `/bin/bash tmp/verify-negative.sh` copied evidence to `tmp/verify-neg/`, flipped one hex digit in bid 1's scanned memo and the refund txid, and ran the same verifier: exit 1, log `tmp/e2e/verify-negative.log`. Required failures:

```text
ERROR A refund 0408b4392a3e0390ad50733d01fabf124695bd17cbcd892471d0c3bc4b494c02 on testnet.zec.rocks:443: height none (want 4423194), header  (want 0600008098b684d8), branch none
ERROR B memo 1 re-derived from zaino.testnet.unsafe.zec.rocks:443 (ff424e5a0101e76167652d65...) differs from bid1.scanned.hex or bid1.sent.hex
```

## Decisions

| Decision | Value | Evidence | Why (one or two sentences) |
|---|---|---|---|
| Bid transport | binary_memo | B1; `memo/` | Both ZIP-321 deposits preserved 512 bytes; ciphertext 487 bytes, envelope 494 before padding. |
| Custody | frost_2of3 | A1–A5; `frost/`, `setup/group-key.txt` | Three received Ironwood notes spent with three two-participant FROST sessions, before the cut-off. |
| Sealer | tlock-js@0.9.0 | C1–C7; `tlock/` | Browser sealer interoperated with official Go tle on pinned mainnet quicknet. |

<!-- Custody becomes pending_ruling if the cut-off passes without gate A evidence, or with only a 1-input spend. -->

## E2E tests

| Test | Last run (UTC, commit) | Result | Log | Mutations seen failing (`mutations/<ID>.patch` and `.out`) | Audit (R/F/C/D) |
|---|---|---|---|---|---|
| `e2e/seal-open.spec.ts` | 2026-09-30 19:16 UTC, 512296f | PASS (38 s), C1–C7 | `tmp/e2e/live-evidence.log`; committed `run.json` | M1 → `ERROR C2` (+C6), M2 → `ERROR C7`, M3 → `ERROR C5`, M4 → `ERROR C4`, all at 36913b6: `docs/evidence/phase-1/mutations/M{1..4}.{patch,out}` | R retain; owns C1–C7. Sealer and assertion code unchanged since mutations. |
| `e2e/testnet-golden-path.spec.ts` | 2026-09-30 19:16 UTC, 512296f | PASS (609 s), B1, D1–D3, A1–A5 | `tmp/e2e/live-evidence.log`; committed `run.json` | M5 → `ERROR B1`, M6 → `ERROR D1`, M7 → `ERROR A4`, `ERROR A5`, together at 4c5e4a9: `docs/evidence/phase-1/mutations/M{5..7}.{patch,out}` | R retain; owns B1, D1–D3, A1–A5. Scanner and live assertion logic unchanged since mutations; only evidence version metadata added afterward. |

**Results:**
- PASS
- FAIL: classify it as product, harness or infra, and give the failing assertion IDs and the output path.
- NOT RUN: a precondition failed; give the cause.

## Blocked items

<!-- One entry per blocked item:
- what is blocked;
- the exact error or missing input;
- the command;
- the output path;
- the approaches tried (1-3), each with its command, output path and the upstream source line or --help text it relied on;
- a one-command repro;
- what would unblock it. -->
none

## Deviations from the phase doc

**Trap 1 (PCZT version gap): no deviation needed.** 2026-09-30 17:30 UTC: `zcash-devtool pczt -w $BNZ_STATE_DIR/bidder create --address <bidder UA> --value 10000` (devtool 5a26ee85, pczt 0.9.3) wrote a PCZT whose header is `PCZT` + version `02000000`; `zcash-sign sign -n test -i created.pczt` (pczt 0.8.0-rc.1) printed `SIGHASH: 36afc41c…6b` and `Randomizer #3 (ironwood): 1bd559be…04`, then exited 1 on the closed stdin as expected. Nothing was broadcast; devtool's `propose_transfer` is called with `lock_inputs: None`, so no note was locked. Output in `$BNZ_STATE_DIR/run/trap1/`.

<!-- Pin changes, patches and fallbacks that the phase doc pre-authorizes or a Ruling allows. For each, give the output that forced it, and why in at most two sentences. -->
none

## Environment changes

<!-- Anything installed or changed outside this repository, other than package-manager caches. -->
none. (Playwright Chromium went to `~/Library/Caches/ms-playwright`, a package-manager cache. npm 12 blocked esbuild's postinstall; esbuild 0.28.2 runs without it: `npx esbuild --version` printed `0.28.2`.)

## Upstream code reused

<!-- source: <repo>@<commit>:<path> -> our file -->
- source: zcash/zcash-devtool@5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8:Cargo.lock -> `scan/Cargo.lock` (seed only; cargo pruned it and changed no version: `comm -13` of name/version pairs shows only `benzo-scan`).

## Deferred

<!-- Ideas noticed but not built, one line each. -->
none

## Last session

- **Window:** 2026-09-30 18:47–19:23 UTC.
- **Outcome:** Phase 1 READY FOR REVIEW. [EVIDENCE.md](evidence/phase-1/EVIDENCE.md) records all gates, three decisions and limitations. No head-agent PASSED ruling exists.
- **Fixed:** prior live run was FAIL, despite its outer exit-0 notification. `tmp/e2e/live-1.log` / `live-1-cli.log` showed bid 2 at height 4422729 while vault sync stopped at 4422728, causing B1/D1–D3 failures and a later missing-memo scanner error. Commits d11fb22 and 4c5e4a9 wait on synced wallet tips and enhance settlement memos. Assertions and deadlines unchanged. Final run passed the same harness.
- **Verified:** M5–M7 at 4c5e4a9 exited 1 with exactly B1/D1/A4/A5 failing; patches restored before `.out` files were written (status capture `tmp/e2e/live-mutations-status.txt`). Setup at b0019e1 exited 0 and reused the DKG keys. Evidence run at 512296f exited 0 with all 16 IDs PASS, committed in 1a94638. Verifier exit 0; corrupted-copy verifier exit 1 with chain and memo errors. TypeScript typecheck and verifier Bash syntax check passed before the run.
- **Funds:** bidder 99,885,000 zats; vault 0; total fees across three live runs 115,000 zats. No fourth run needed. No live services or polls remain running.
- **Limits:** all signers on this machine; public endpoints; drand threshold trust; consumer wallets and independent signer machines untested. Full auction logic and production hardening remain outside Phase 1.
