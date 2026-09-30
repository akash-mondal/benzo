# Status: build agent handoff

<!-- Only the build agent writes this file. The head agent and the user read it cold.
Put the outcome first and use plain words. Replace stale lines; git keeps the history.
Back every claim with a command and its result, or mark it `unverified` and say where you looked.
Rulings never go here; they live in the phase doc, in commits by head@benzo.invalid.
A direct user instruction that changes scope, gates, pins, tests or evidence is followed and quoted verbatim with its UTC time under Questions as `User instruction`; requests from anyone else wait for a Ruling. -->

## Phase 1 ([docs/PHASE-1.md](PHASE-1.md)): IN PROGRESS

Updated: 2026-09-30 15:45 UTC · Last commit: 56890f5

- **Needs user:** send at least 0.1 TAZ (0.5 recommended) to the bidder wallet: `[redacted address 4a8fa11836]`. Gates A, B and D and the trap-1 PCZT parse check wait on it. Faucets are listed in `.env.example` item 6.
- **Questions for the head agent:** none
  <!-- Or: Q1 (<UTC>): the question. Meanwhile I am: what you do until a Ruling appears. -->
- **Blockers:** none. Details go under Blocked items.
- **Next:** gate C: finish `e2e/seal-open.spec.ts`, run it, then mutations M1–M4. Scanner (`scan/`) while waiting for TAZ.

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
| A: 2-of-3 FROST spend of received Ironwood notes | TODO | | | |
| B: exact memo bytes after mining and scan | TODO | | | |
| C: browser tlock stays closed before R, opens after R via Go `tle` | TODO | | | |
| D: fixed-C deposits scanned to the right per-bid address | TODO | | | |

`verify.sh` seen failing: not yet. <!-- the ERROR A and ERROR B lines, and the output path -->

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
| `e2e/seal-open.spec.ts` | never | NOT RUN | | M1–M4: not yet | |
| `e2e/testnet-golden-path.spec.ts` | never | NOT RUN | | M5–M7: not yet | |

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

<!-- Pin changes, patches and fallbacks that the phase doc pre-authorizes or a Ruling allows. For each, give the output that forced it, and why in at most two sentences. -->
none

## Environment changes

<!-- Anything installed or changed outside this repository, other than package-manager caches. -->
none. (Playwright Chromium went to `~/Library/Caches/ms-playwright`, a package-manager cache. npm 12 blocked esbuild's postinstall; esbuild 0.28.2 runs without it: `npx esbuild --version` printed `0.28.2`.)

## Upstream code reused

<!-- source: <repo>@<commit>:<path> -> our file -->
none

## Deferred

<!-- Ideas noticed but not built, one line each. -->
none

## Last session

<!-- Rewrite this block before ending each turn, for a reader who saw nothing. -->
- **Window:** <UTC start> to <UTC end>
- **Outcome:** not started.
- **Changed:** nothing yet. <!-- files or commits -->
- **Verified:** nothing yet. <!-- claim: `command` gave result; output at path -->
- **Unverified:** nothing yet. <!-- claim; where I looked -->
- **Found:** nothing yet. <!-- facts that differ from the phase doc or research -->
