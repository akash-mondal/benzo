# Status: build agent handoff

## Phase 2 ([PHASE-2.md](PHASE-2.md)): IN PROGRESS

Updated: 2026-09-30 19:52 UTC · Contract: 44931b4 + R1 at 0ec8c02 (head@benzo.invalid).

- **Phase 1:** PASSED, R5–R10 at 04926a7. Closed; decisions stand: binary_memo, frost_2of3, tlock-js@0.9.0. Evidence remains under `docs/evidence/phase-1/` at run 512296f / artifact commit 1a94638.
- **Current:** manifest schema/signing/client verification and deterministic clearing CLI. No Phase 2 code existed at session start (`rg --files manifest clear`). Read Phase 2 in full and its listed research sections.
- **Verified baseline:** `npm run e2e` at 0ec8c02; result in `tmp/e2e/phase2-baseline.log` (see Last session). No prior pidfiles or services remained running.
- **Funds:** bidder total 99,885,000 zats, spendable 97,910,000 at the stored wallet tip (not resynced yet). New floor is 3C + 40,000 = 1,540,000 zats; ask before spending below it. No Phase 2 payments yet.
- **Needs user:** none.

## Questions

- Q1: I1 requires every cancelled deposit to be refunded at C, but inherited single `create-max` deducts the transaction fee from the swept notes. Proposed resolution: a separately funded, fixed fee-reserve note pays the fee; exact C returns to cancellation deposit(s). Confirm the allowed real-chain drill and fee funding before I1 broadcasts. Until ruled, implement the manifest, admission, freeze and pure clearing; do not weaken I1.
- Q2: `live` currently runs the Phase 1 specs. Adding auction-core creates two specs that spend from the same wallets and start frostd; serialize live workers to prevent races. For N1–N7, propose a Playwright `auction-core` project selecting only the new spec (no skip/reorder/test-only production seam). Does “do not reopen Phase 1” mean leave its specimens intact but exclude its live golden path from Phase 2 runs? Await selection ruling before live runs; no assertion changes proposed.
- Q3: H2 names both under- and over-C deposits. Testing both against the real chain adds two payments beyond the two accepted bids and a cancellation deposit (five notes, about 5C). Preconditions remain exactly 3C + 40,000 as contracted; this wallet has enough. Confirm whether the full five-note drill is intended; no fabricated note values will be used.
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
| I: cancel without decrypt | TODO | none yet; Q1 |

## Decisions

Freeze commitment: pending F1–F2. Clearing spec: pending G1–G3. Receipt format: pending live inclusion verification.

## E2E tests

Exactly one Phase 2 spec will be added: `e2e/auction-core.spec.ts`, E1, E2, F1, F2, G1, G2, G3, H1, H2, H3, H4, I1. N1–N7 pending. Existing two Phase 1 tests retained; total will be 3 of 8.

## Blocked items

No outside dependency failure observed. I1 fee policy and live selection await Questions rulings; independent work continues.

## Deviations / Environment changes / Upstream code reused

None this phase. All pins unchanged.

## Deferred

Phase 3 batch settlement and signer review; Phase 4 UI/hosting; no work on either this phase.

## Last session

- Resumed 2026-09-30 19:49 UTC. Clean tree at 0ec8c02; read committed Phase 1 pass rulings and Phase 2 contract/research; ran default E2E before new work.
- Baseline output: `tmp/e2e/phase2-baseline.log`. Phase 2 implementation and evidence unverified.
