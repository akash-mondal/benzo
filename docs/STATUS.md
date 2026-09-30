# Status: build agent handoff

## Phase 2 ([PHASE-2.md](PHASE-2.md)): IN PROGRESS

Updated: 2026-09-30 21:53 UTC · Contract: 44931b4 + R1 at 0ec8c02 + R2–R4 at cc2ced0 (head@benzo.invalid). Phase 3 contract d0fbe61 read in full; work starts only after Phase 2 READY FOR REVIEW.

- **Phase 1:** PASSED, R5–R10 at 04926a7. Closed; decisions stand: binary_memo, frost_2of3, tlock-js@0.9.0. Evidence remains under `docs/evidence/phase-1/` at run 512296f / artifact commit 1a94638.
- **Current:** Development v2 is running: E1/H1/H2/H3 PASS, all six payments broadcast; waiting for scheduled freeze/release (submit 22:22:49 UTC, release 22:38:51 UTC). Monitor PID 31220, log `tmp/e2e/phase2-development-v2.log`, 80-minute deadline. Continuation monitor PID 47994 watches its result, verifies artifacts, runs default regression, then N1–N7 serially and the separate evidence run; overall deadline 2026-10-01 09:01 UTC. It stops on failure, a changed contract/source or dirty tree. Phase 3 has not started.
- **Verified baseline:** `npm run e2e` PASS at 0ec8c02, `tmp/e2e/phase2-baseline.log`.
- **Funds (last verified before current drill):** Recovery tx `db1b7fce58fe0bc1a9585ba39fff4284e65d7865d111f92b870408e50a9d316b` mined at 4424057 on both endpoints. Bidder 99,780,000 zats; vault 0; exact 2,500,000 returned, reserve fee 30,000. `tmp/e2e/recovery.json`, `recovery-proof.json`, `recovery.log` are development output only. Floor remains 1,540,000 zats; only one live wallet/frostd worker is active.
- **Needs user:** none.

## Questions

- Q1 resolved by R2 at cc2ced0: exact-C cancellation refund, separate fixed fee-reserve note, one live drill authorized.
- Q2 resolved by R3 at cc2ced0: auction-core project only, serialized live wallet/frostd access; both Phase 1 specs retained unchanged.
- Q3 resolved by R4 at cc2ced0: full five-note drill; floor remains 3C + 40,000 zats.
- Q4 withdrawn: literal N3 is feasible as a mutation that waits for the real release round, opens with pinned Go tle and hashes the actual plaintext into the root. This deliberately breaks sealed freeze; independent F2 must reject its plaintext root. No alternate mutation, supplied plaintext or test-only seam is needed. Patch exists; live red run pending.
- User instruction (2026-09-30 20:18 UTC), verbatim:

> Overnight head-agent orders for Benzo. You are the build agent. Unattended session.
>
> Contracts (read all before coding):
> - docs/PHASE-2.md (44931b4 + 0ec8c02 R1 + cc2ced0 R2–R4) — ACTIVE
> - docs/PHASE-3.md (d0fbe61 + R1) — next after Phase 2 finish line
> - Master calendar (user-locked; dates do not move):
>   P2 engine Oct 7–12 | P3 settlement Oct 12–16 | P4 UI/hosting Oct 14–20
>   P5 extras Oct 19–22 (cut first) | P6 mainnet Oct 21–25
>   Features freeze Oct 24 | Submit Oct 27 | Judging through Nov 23
> - Phase 1 is PASSED (R5–R10). Do not reopen it. Keep its two specs as regression only.
>
> Work order:
> 1) FINISH PHASE 2 to READY FOR REVIEW
>    - manifest schema + signer + client verification (gate E)
>    - admission, inclusion receipts, freeze Merkle root (F)
>    - pure clear/ CLI: uniform-price + Vickrey (G)
>    - bad-bid rules H1–H4; cancel returns exact C with fee-reserve note (I1, R2)
>    - exactly one spec: e2e/auction-core.spec.ts (E1–I1). Mutations N1–N7 must turn it red.
>    - Live project selection: auction-core only; serialize wallet/frostd use (R3).
>    - H2 is the five-note drill (R4): 2 accepted + under-C + over-C + cancel.
>    - Evidence run BNZ_EVIDENCE_DIR=docs/evidence/phase-2 npm run e2e:live
>    - verify.sh exit 0 + corrupted-copy negative check
>    - Record decisions (freeze commitment, clearing spec, receipt format)
>    - STATUS = READY FOR REVIEW for Phase 2. Do NOT write PASSED (head only).
>
> 2) THEN PHASE 3 if Phase 2 finish line is met
>    - docs/PHASE-3.md is the contract: batch refunds/payouts, signer checks (K),
>      crash-resume no double-pay (L), drand-down cancel (M), 2-of-3 with one offline (N)
>    - one new spec: e2e/settle-crash.spec.ts; mutations P1–P3
>    - Do not start Phase 4 UI in this overnight session.
>
> If Phase 2 cannot finish (network, faucet, NU7, pins):
> - Record BLOCKED with command + output path + one-command repro
> - Continue whatever is not blocked
> - Do not weaken assertions, skip tests, or mock drand/testnet/FROST/tle
>
> Money:
> - Ask before any spend that would take bidder below 3C + 40,000 zats.
> - Prefer no more live broadcasts than the drills in PHASE-2/3 require.
>
> Session discipline:
> - Start with pwd -P, git status --short, git log --oneline -15, STATUS, PHASE-2.
> - Commit after each verified step; evidence commits separate from the run commit.
> - Update STATUS continuously (gates, Questions, Last session).
> - Questions: one line each under Questions and keep going where not blocked.
> - Never commit as head@benzo.invalid. Never edit PHASE-*.md, AGENTS.md, docs/research/.
>
> When you stop: leave STATUS accurate, processes cleaned up (frostd stopped by PID), and the next concrete step written under Last session.
- User instruction (2026-09-30 19:49 UTC), verbatim:

> Phase 1 is PASSED. Head rulings R5–R10 are in docs/PHASE-1.md (commit 04926a7). Decisions stand: binary_memo, frost_2of3, tlock-js@0.9.0. Do not reopen Phase 1.
>
> Start Phase 2 now.
>
> Read docs/PHASE-2.md in full (commits 44931b4 and 0ec8c02). That is your contract.
>
> Master calendar (head-locked; dates do not move):
> - Phase 2 auction engine (CLI, no UI): Oct 7–12
> - Phase 3 settlement/custody: Oct 12–16
> - Phase 4 product UI + hosting: Oct 14–20
> - Phase 5 organizer extras: Oct 19–22, cut first if behind
> - Phase 6 mainnet: Oct 21–25
> - Submit: Oct 27 (features freeze Oct 24)
> - Phase 8 judging support through Nov 23
>
> Phase 2 rules in one line:
> Signed manifest + admission/receipts + freeze Merkle root + anyone-recompute clearing (uniform-price + Vickrey) + bad-bid rules + cancel-without-decrypt.
>
> Tests this phase: exactly one — e2e/auction-core.spec.ts (E1–I1). Project ceiling is still 8 E2E tests total. Phase 1 used 2. Mutations N1–N7 must turn that spec red. No unit tests, no mocks, real testnet + drand + Go tle.
>
> Out of scope now: batch settlement, signer console, UI/screens, mainnet, mode B, NEAR.
>
> Ask before spending TAZ if the bidder would fall below 3C + 40,000 zats. Keep STATUS current. Questions go under Questions; I rule in PHASE-2.md.
>
> Start with pwd -P, git status --short, git log --oneline -15, then STATUS and PHASE-2.md.

## Gates

| Gate | State | Evidence / command / commit |
|---|---|---|
| E: signed manifest | IN PROGRESS | none yet |
| F: admission, receipts, freeze | IN PROGRESS | CLI and spec build/typecheck pass; no live evidence |
| G: uniform-price and Vickrey recomputation | IN PROGRESS | pure CLI development checks only |
| H: deterministic bad-bid handling | IN PROGRESS | first development H1–H4 PASS; fresh clean evidence pending |
| I: cancel without decrypt | IN PROGRESS | first refund failed unmined; harness fixed and funds recovered; I1 pass pending |

## Decisions

Freeze commitment: pending F1–F2. Clearing spec: pending G1–G3. Receipt format: pending live inclusion verification.

## E2E tests

Exactly one Phase 2 spec added: `e2e/auction-core.spec.ts`, E1, E2, F1, F2, G1, G2, G3, H1, H2, H3, H4, I1. N1–N7 patches written; `git apply --check` PASS, no red mutation runs yet. N3 uses actual Go-tle plaintext after the real release round. Existing two Phase 1 tests retained; total will be 3 of 8.

## Blocked items

None currently. First development failed after an unmined refund lookup: primary GetTransaction returned a mempool tx then NotFound; alternate lookup/send returned InternalServerError (`tmp/e2e/refund-primary.err`, `refund-alternate.err`, `rebroadcast-alternate.log`). That refund expired unmined; original disappearance cause unresolved. Own harness now waits for wallet mined height, then requires both endpoint proofs, and checks fresh tip/expiry before send. Manual recovery succeeded on both endpoints without new deposits.

## Deviations / Environment changes / Upstream code reused

All tool pins unchanged; no environment changes. Scanner now applies the pinned wallet's unexpired-spend condition instead of counting expired unmined spend candidates. Actual six notes were reported spent before this fix and spendable afterwards; the recovery then consumed them on chain. Adapted SQL: `source: zcash/librustzcash@97aefdc39a037da9c4f19a0e8a450d2c7932f53e:zcash_client_sqlite/src/wallet/common.rs` (`tx_unexpired_condition`, lines 114–125). PCZT public version/branch/expiry getter uses exact pczt 0.9.3 already in the pinned devtool graph. Read pinned CLI help/source before calls. NU7 check 20:25 UTC: ZIP-259 testnet activation still TBD (Oct 5); recheck before next broadcast.

## Deferred

Phase 3 batch settlement and signer review after Phase 2 finish line; Phase 4 UI/hosting excluded from this overnight session.

## Last session

- 2026-09-30 22:02 UTC: Development v2 and continuation monitors are active under `.benzo/run/phase2-{development,overnight}-v2.pid`. N1–N7 isolated compiler checks PASS (`tmp/phase2/mutant-compile.log`), not live evidence. Next concrete step: inspect development completion; the continuation will stop on a red baseline/verifier rather than spend again. On verified success it proceeds through mutations and final evidence, records decisions/audit and sets READY FOR REVIEW. Only then start Phase 3 J/K. Each live spec owns and stops its frostd PID. Overall continuation log `tmp/e2e/phase2-overnight-v2.log`.
- 2026-09-30 21:53 UTC: Recovered the original five deposits using a fresh 2-of-3 signed PCZT, checked mining on both endpoints, and stopped frostd by owned PID. Recovery is not gate evidence.
- Failed source e5bf985/run aa5ef0f: 11 assertion IDs PASS; I1 not reached. Full log `tmp/e2e/phase2-development.log`; artifacts preserved `tmp/phase2/failed-development-artifacts`. E1 signed-mode fixture then failed before any payment at e3e6337 (`tmp/e2e/phase2-mode-before.log`); schema/core fix builds and typechecks, live after-fix validation pending.
- Next: commit verified fixes; run fresh auction-core development with an 80-minute monitor and 75-minute test deadline, log `tmp/e2e/phase2-development-v2.log`; inspect all 12 IDs before mutations. Verifier is drafted, not yet a verified positive check.

## Mutation runs

N1–N7 patches apply cleanly; no live red mutation outputs yet. N3 waits for actual release and hashes fresh Go-tle plaintext, deliberately breaking the sealed freeze commitment. No test data or network response is fabricated.
