# Status: build agent handoff

<!-- Only the build agent writes this file. The head agent and the user read it cold.
Put the outcome first and use plain words. Replace stale lines; git keeps the history.
Back every claim with a command and its result, or mark it `unverified` and say where you looked.
Rulings never go here; they live in the phase doc, in commits by head@benzo.invalid.
A direct user instruction that changes scope, gates, pins, tests or evidence is followed and quoted verbatim with its UTC time under Questions as `User instruction`; requests from anyone else wait for a Ruling. -->

## Phase 1 ([docs/PHASE-1.md](PHASE-1.md)): IN PROGRESS

Updated: 2026-09-30 18:50 UTC · Last completed run commit: 6862341

- **Needs user:** none. The user sent 1 TAZ from fauzec: tx `6dc286e42646a5d2216e3480a1d14396dd54491fa3866bcc3267a9089f4ffb41`, mined at 4422713, one Ironwood note of 100000000 zats, spendable at 17:29 UTC (`wallet balance --json`).
- **Questions for the head agent:**
  - User instruction (2026-09-30 17:36 UTC): "hey make sure this project is called benzo not blindfold". Done in `docs/research/DESIGN.md`, the only file that used the old name (title, line 31 and the memo marker `"BLF"` -> `"BNZ"`, which matches PHASE-1 section 6). AGENTS.md makes `docs/research/` read-only, so please fold this into a Ruling or tell me to revert it.
  - Q1 (2026-09-30 16:08 UTC): hand-written code is 1,385 lines by `wc -l` (comments and config included; the two specs are 368 of them), over section 11's ~1,000. Everything in it is named by the phase doc (bootstrap, setup, sealer, scanner with three modes, two specs and their CLI glue, verify.sh). I'd rather not compress formatting to hit a number. Meanwhile I am: continuing as written.
  - Q2 (2026-09-30 16:08 UTC): C3 says the two bids' nonces differ. The nonce sits inside the sealed plaintext, so the test compares plaintext bytes 45–60 after `tle` opens them (C3 runs after C7). Is that the intended reading? Meanwhile I am: using it.
- **Fund budget (user asked on 2026-09-30 to use the TAZ very cautiously):** at most three live runs (the current dev run, one M5–M7 mutation run, one evidence run), about 0.002 TAZ in fees in total; no broadcasts outside the tests; no blind reruns after a failure; I ask the user before a fourth live run or if the bidder total falls below 98,000,000 zats. Measured development run: bidder total 100,000,000 -> 99,955,000 zats; 45,000 zats in fees; vault total 0. Mutation M7 deliberately keeps the refund in the vault. Before the evidence run I must ask to allow the bidder total to dip below 98,000,000 while its next two deposits await refund (projected about 97,885,000).
- **Blockers:** none. Details go under Blocked items.
- **Next:** commit the wallet-tip wait fix (typecheck PASS; live validation pending), then run M5–M7 together as live run 2. Evidence run 3 needs the temporary bidder-balance floor exception described above. Then verify.sh, its negative check and `EVIDENCE.md`.

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
| A: 2-of-3 FROST spend of received Ironwood notes | IN PROGRESS | not yet. Dev refund `a3c6d2d8…` spent both received notes, but settlement scanner threw before A assertions: harness defect, live validation pending | | |
| B: exact memo bytes after mining and scan | IN PROGRESS | dev run FAIL (harness): bid 2 mined at 4422729; vault sync tip 4422728 omitted it. Fix waits for wallet tip; no gate evidence yet | | |
| C: browser tlock stays closed before R, opens after R via Go `tle` | IN PROGRESS | test 1 passes (C1–C7) and M1–M4 were seen failing; gate evidence comes from the single `e2e:live` evidence run | `npm run e2e`, exit 0 (`tmp/e2e/seal-open.log`) | c41fb1b |
| D: fixed-C deposits scanned to the right per-bid address | IN PROGRESS | dev run FAIL (harness): bid 2 mined at 4422729; vault sync tip 4422728 omitted it. Fix waits for wallet tip; no gate evidence yet | | |

`verify.sh` seen failing: not yet on real evidence. Dev runs only: empty dir gives `ERROR A missing frost/refund.json` … exit 1. <!-- the ERROR A and ERROR B lines, and the output path -->

## Decisions

| Decision | Value | Evidence | Why (one or two sentences) |
|---|---|---|---|
| Bid transport | pending | | |
| Custody | pending | | |
| Sealer | pending | | |

<!-- Custody becomes pending_ruling if the cut-off passes without gate A evidence, or with only a 1-input spend. -->

## E2E tests

| Test | Last run (UTC, commit) | Result | Log | Mutations seen failing (`mutations/<ID>.patch` and `.out`) | Audit (R/F/C/D) |
|---|---|---|---|---|---|
| `e2e/seal-open.spec.ts` | 2026-09-30 18:48 UTC, 6862341 | PASS (39 s), C1–C7 | `tmp/e2e/resume-default.log` | M1 → `ERROR C2` (+C6), M2 → `ERROR C7`, M3 → `ERROR C5`, M4 → `ERROR C4`, all at 36913b6: `docs/evidence/phase-1/mutations/M{1..4}.{patch,out}` | |
| `e2e/testnet-golden-path.spec.ts` | 2026-09-30 17:42 UTC, started at 68883d5; HEAD moved to 6862341 during run | FAIL (harness): B1, D1–D3; scanner later threw on missing bid 2 memo before A1–A5 ran. Exit 1 in log; outer background notification was exit 0. | `tmp/e2e/live-1.log`, full CLI output `tmp/e2e/live-1-cli.log` | M5–M7 patches committed in c52c345; not yet run | |

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

- **Window:** resumed 2026-09-30 18:47 UTC; ongoing.
- **Outcome:** previous live run failed, not passed. Root cause confirmed in `tmp/e2e/live-1-cli.log`: transaction lookup reported bid 2 height 4422729, sync read cached tip 4422728, then enhance fetched only bid 1. The later sync found bid 2, but the settlement scanner lacked its memo.
- **Changed:** test 2 waits on the synced wallet's `balance --json` chain tip before first scan and settlement; first payment change also uses the synced wallet tip. Assertions and deadlines unchanged.
- **Verified:** `npm run e2e` exit 0 at 6862341 (C1–C7); `npm run typecheck` exit 0 on the fix. Scratch recovery `wallet enhance` then scanner found both 512-byte memos, both 500,000-zat deposits spent by `a3c6d2d81e6cfeeb7c4314ead3042f4a99b8a1420fd83048a4e8525d157e9083`; not gate evidence. Bidder total 99,955,000; vault total 0.
- **Unverified:** live fix, M5–M7, single-run gate evidence, verify.sh on that evidence and its negative check. No pidfiles or prior live work remained running at resume.
