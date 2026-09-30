# Status: build agent handoff

## Phase 2 ([PHASE-2.md](PHASE-2.md)): IN PROGRESS

Updated: 2026-09-30 20:18 UTC · Contract: 44931b4 + R1 at 0ec8c02 + R2–R4 at cc2ced0 (head@benzo.invalid). Phase 3 contract d0fbe61 read in full; work starts only after Phase 2 READY FOR REVIEW.

- **Phase 1:** PASSED, R5–R10 at 04926a7. Closed; decisions stand: binary_memo, frost_2of3, tlock-js@0.9.0. Evidence remains under `docs/evidence/phase-1/` at run 512296f / artifact commit 1a94638.
- **Current:** signed manifest schema/client and pure uniform-price / Vickrey CLI implemented. `npm run build:core` and `npm run typecheck` PASS. Scratch CLI checks refused a changed round and returned fills 2/1 with reversed openings; these are development checks, not gate evidence (`tmp/phase2/manifest-check.log`, `tmp/phase2/clear-check.log`). Admission is next.
- **Verified baseline:** `npm run e2e` PASS at 0ec8c02, `tmp/e2e/phase2-baseline.log`. No prior pidfiles or services remained running.
- **Funds:** bidder total 99,885,000 zats, spendable 97,910,000 at the stored wallet tip (not resynced yet). New floor is 3C + 40,000 = 1,540,000 zats; ask before spending below it. No Phase 2 payments yet.
- **Needs user:** none.

## Questions

- Q1 resolved by R2 at cc2ced0: exact-C cancellation refund, separate fixed fee-reserve note, one live drill authorized.
- Q2 resolved by R3 at cc2ced0: auction-core project only, serialized live wallet/frostd access; both Phase 1 specs retained unchanged.
- Q3 resolved by R4 at cc2ced0: full five-note drill; floor remains 3C + 40,000 zats.
- Q4: N3 asks freeze to hash plaintext while freeze must occur before R and operator has no plaintext. May N3 instead hash the ciphertext's hex encoding rather than its raw bytes (same wrong-commitment regression, F2 fails against an independent raw-byte verifier)? No plaintext input or test-only production seam will be added; N3 awaits ruling while other work continues.
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
| F: admission, receipts, freeze | TODO | none yet |
| G: uniform-price and Vickrey recomputation | TODO | none yet |
| H: deterministic bad-bid handling | TODO | none yet |
| I: cancel without decrypt | TODO | none yet; R2 fee reserve |

## Decisions

Freeze commitment: pending F1–F2. Clearing spec: pending G1–G3. Receipt format: pending live inclusion verification.

## E2E tests

Exactly one Phase 2 spec will be added: `e2e/auction-core.spec.ts`, E1, E2, F1, F2, G1, G2, G3, H1, H2, H3, H4, I1. N1–N7 pending. Existing two Phase 1 tests retained; total will be 3 of 8.

## Blocked items

No outside dependency failure observed. N3 mutation definition awaits Q4 ruling; independent work continues.

## Deviations / Environment changes / Upstream code reused

None this phase. All pins unchanged.

## Deferred

Phase 3 batch settlement and signer review after Phase 2 finish line; Phase 4 UI/hosting excluded from this overnight session.

## Last session

- Resumed 2026-09-30 19:49 UTC. Clean tree at 0ec8c02; read committed Phase 1 pass rulings and Phase 2 contract/research; ran default E2E before new work.
- Baseline PASS: `tmp/e2e/phase2-baseline.log`. Core build/typecheck PASS 2026-09-30 20:17 UTC. No Phase 2 gate evidence or broadcasts yet. Next: admission/receipt/freeze CLI against the inherited scanner, then the one auction-core spec.
