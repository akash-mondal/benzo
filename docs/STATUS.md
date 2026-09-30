# Status: build agent handoff

<!-- Only the build agent writes this file. The head agent and the user read it cold.
Put the outcome first and use plain words. Replace stale lines; git keeps the history.
Back every claim with a command and its result, or mark it `unverified` and say where you looked.
Rulings never go here; they live in the phase doc, in commits by head@benzo.invalid.
A direct user instruction that changes scope, gates, pins, tests or evidence is followed and quoted verbatim with its UTC time under Questions as `User instruction`; requests from anyone else wait for a Ruling. -->

## Phase 1 ([docs/PHASE-1.md](PHASE-1.md)): IN PROGRESS

Updated: 2026-09-30 17:32 UTC · Last commit: e147dee

- **Needs user:** none. The user sent 1 TAZ from fauzec: tx `6dc286e42646a5d2216e3480a1d14396dd54491fa3866bcc3267a9089f4ffb41`, mined at 4422713, one Ironwood note of 100000000 zats, spendable at 17:29 UTC (`wallet balance --json`).
- **Questions for the head agent:**
  - User instruction (2026-09-30 17:36 UTC): "hey make sure this project is called benzo not blindfold". Done in `docs/research/DESIGN.md`, the only file that used the old name (title, line 31 and the memo marker `"BLF"` -> `"BNZ"`, which matches PHASE-1 section 6). AGENTS.md makes `docs/research/` read-only, so please fold this into a Ruling or tell me to revert it.
  - Q1 (2026-09-30 16:08 UTC): hand-written code is 1,385 lines by `wc -l` (comments and config included; the two specs are 368 of them), over section 11's ~1,000. Everything in it is named by the phase doc (bootstrap, setup, sealer, scanner with three modes, two specs and their CLI glue, verify.sh). I'd rather not compress formatting to hit a number. Meanwhile I am: continuing as written.
  - Q2 (2026-09-30 16:08 UTC): C3 says the two bids' nonces differ. The nonce sits inside the sealed plaintext, so the test compares plaintext bytes 45–60 after `tle` opens them (C3 runs after C7). Is that the intended reading? Meanwhile I am: using it.
- **Fund budget (user asked on 2026-09-30 to use the TAZ very cautiously):** at most three live runs (the current dev run, one M5–M7 mutation run, one evidence run), about 0.002 TAZ in fees in total; no broadcasts outside the tests; no blind reruns after a failure; I ask the user before a fourth live run or if the bidder total falls below 98,000,000 zats. Measured so far: the first deposit cost 500,000 collateral + 25,000 fee (bidder total 100,000,000 -> 99,475,000).
- **Blockers:** none. Details go under Blocked items.
- **Next:** a development run of `npm run e2e:live` is running (started 17:30 UTC, log `tmp/e2e/live-1.log`); then M5–M7, then the evidence run (setup with `BNZ_EVIDENCE_DIR` + `e2e:live`), verify.sh and its negative check, `EVIDENCE.md`.

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
| A: 2-of-3 FROST spend of received Ironwood notes | IN PROGRESS | not yet. DKG done (group key `b078b5f6…ff03`), test 2 written, not run: no TAZ | | |
| B: exact memo bytes after mining and scan | IN PROGRESS | not yet. Scanner and test 2 written, not run: no TAZ | | |
| C: browser tlock stays closed before R, opens after R via Go `tle` | IN PROGRESS | test 1 passes (C1–C7) and M1–M4 were seen failing; gate evidence comes from the single `e2e:live` evidence run | `npm run e2e`, exit 0 (`tmp/e2e/seal-open.log`) | c41fb1b |
| D: fixed-C deposits scanned to the right per-bid address | IN PROGRESS | not yet. Scanner and test 2 written, not run: no TAZ | | |

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
| `e2e/seal-open.spec.ts` | 2026-09-30 16:01 UTC, c41fb1b (working tree before that commit; the committed diff only touched test 2 glue and types) | PASS (37 s) | `tmp/e2e/seal-open.log` | M1 → `ERROR C2` (+C6), M2 → `ERROR C7`, M3 → `ERROR C5`, M4 → `ERROR C4`, all at 36913b6: `docs/evidence/phase-1/mutations/M{1..4}.{patch,out}` | |
| `e2e/testnet-golden-path.spec.ts` | 2026-09-30 16:04 UTC, 8267d29 (dry run) | NOT RUN: `bidder spendable 0 zats < 2C + 30000 = 1030000`, after its pin, drand, endpoint and state preconditions passed | `tmp/e2e/live-dry.log` | M5–M7 patches committed in c52c345; not yet run | |

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

<!-- Rewrite this block before ending each turn, for a reader who saw nothing. -->
- **Window:** 2026-09-30 15:34 UTC to 16:07 UTC
- **Outcome:** G0 ready for review; setup done; gate C test and mutations done; test 2, scanner and verify.sh written. Waiting for TAZ: a background poll (`tmp/wait-funds.sh`, log `$BNZ_STATE_DIR/run/wait-funds.log`) syncs the bidder every 5 min and exits when it has a spendable note, deadline 2026-10-01 04:00 UTC.
- **Changed:** commits 23f660a … 723887e: `tools/`, `seal/`, `scan/`, `e2e/`, `playwright.config.ts`, `package*.json`, `tsconfig.json`, `docs/evidence/phase-1/{versions.txt,verify.sh,mutations/}`.
- **Verified:**
  - G0: `tools/bootstrap.sh` exit 0 at 23f660a; `versions.txt` lists every pin with `?rev=`/`mod` lines.
  - Setup: `tools/setup-testnet.sh` exit 0; the three configs print the same group key `b078b5f632ec2d0b25f75d55a27d216139fafcf8b7fa2ac9facbb4db71c2ff03` (log `$BNZ_STATE_DIR/run/setup.log`).
  - `benzo-scan ak test $BNZ_STATE_DIR/ufvk.txt` printed that same key, so verify.sh can check `ak` (no Found entry needed).
  - Gate C: `npm run e2e` PASS; before R `tle` printed `too early to decrypt: expected round 32659910 > 32659900 current round` and `/public/R` gave 425; after R both plaintexts opened byte-exact. Measured ciphertext 487 bytes, envelope 494 of 512.
  - FROST session glue: a scratch run (`tmp/frost-check.ts`, not committed) signed a random message with alice+bob through frostd; both participants saw the same message; a 64-byte signature came back.
  - Both endpoints answer: `GetLightdInfo` on testnet.zec.rocks gave lightwalletd v0.5.4, Zebra v6.3.0, branch `37a5165b`, height 4422262; Zaino `GetLatestBlock` 4422263. `benzo-scan verify` parsed v6 tx `c5a1c4a1…` (height 4246513) from Zaino.
- **Unverified:** test 2 as a whole, the trap-1 PCZT parse (devtool pczt 0.9.3 vs zcash-sign 0.8.0-rc.1), and the scanner's `scan` output on real notes. All need TAZ.
- **Found:**
  - Zaino (`BNZ_LWD_URL_ALT`) answered `GetTransaction` for the unmined faucet tx with `height: 4422712` (its tip), and the tx was then mined at 4422713; lightwalletd omitted `height` for it while unmined. So a Zaino height alone does not prove mining: test 2 reads heights from the primary first and queries Zaino only once its tip has reached that height.
  - `WalletTest::get_notes` in zcash_client_sqlite 0.22.0 unwraps `get_spendable_note`, so it panics once a note is spent; the scanner reads the library's `v_received_outputs` / `v_received_output_spends` views instead, and memos through `WalletRead::get_memo`.
  - frostd at 06c0dbdb logs only startup lines at `RUST_LOG=info`, so `setup/group-key.txt` and A2 rely on the frost-client transcripts, not frostd log lines.
  - `frost-client dkg` joiners fail with "no sessions" if they start before the creator's session exists; setup waits for `frost-client sessions` to list it.
