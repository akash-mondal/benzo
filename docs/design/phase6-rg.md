# Phase 6 gate RG: the final regression (head design, 2026-10-07)

**Gate RG (PHASE-6 §1):** all specs pass at **one commit** on post-NU7 testnet, and every mutation set is re-shown red at least once on the final code. This doc fixes the order, the budget and the evidence layout. It runs after Reviewer R approves the A20 range.

## 1. Preconditions (checked first; any miss stops the run)
- One recorded commit, `RG_COMMIT`, with a clean tree (`git status --porcelain` empty), and `npm run typecheck` and `npm run check:bundle` green.
- `bash deploy/signers/up.sh` run at `RG_COMMIT` (isolation PROOF OK ×3). `deploy/signers/manifest.json` records `RG_COMMIT`.
- `npm run e2e` (the default project) passes offline.
- The bidder wallet's spendable balance is recorded. The budget below assumes ≥ 0.08 TAZ, and is **serial**.
- No other harness process is running, and `.benzo` is **not** under any R43-guarded deletion path.

## 2. Live specs: serial, one project at a time
Serial, because deposits are refunded to our own wallets but are locked while each run is in flight. One project at a time keeps the peak lock inside the budget.

| # | Playwright project | Approx. time | Peak locked TAZ |
|---|---|---|---|
| 1 | `testnet-golden-path` | 35 min | ~0.01 |
| 2 | `auction-core` | 40 min | ~0.01 |
| 3 | `settle-crash` | 45 min | ~0.01 |
| 4 | `cli-auction` (incl. the 84 R35 folded IDs) | 110 min | ~0.02 |
| 5 | `buyback-mode` | 60 min | ~0.02 |
| 6 | `markets` (all scenarios incl. `drop`), with `GROUPS` flattened to **one group**, i.e. serial | ~5 h | ~0.02 |

- Command per project: `BNZ_LWD_SINGLE=1 BNZ_EVIDENCE_DIR=docs/evidence/phase-6/rg/<project> npx playwright test --project=<project>`.
- The run is evidence only if **every** ID passes and none is NOT RUN (AGENTS.md).
- A red ID is classified (product, harness or infra), fixed at the cause, and the **whole project** is re-run at a new `RG_COMMIT`. A fix to product code restarts §2 from #1.
- Every funded run is recovered before the next project starts (`resume:<id>` or `x-cancel-claims`).

## 3. Mutations: every ID re-shown red at `RG_COMMIT`
- **Offline IDs:** B35 already re-showed them at `6802a2f`. Re-run each against `RG_COMMIT` with the same procedure (the RG table in `docs/evidence/phase-6/test-audit.md`).
- **Live-only IDs:** the cheapest mutation per spec, as listed in test-audit §(a): M5, N7, P3, U2, 5M5 and the 5M8 replay. Add the R33–R42 mutations (A17-*, A18-*, A19-*, A20-*) where they replay against the RG corpus.
- Output goes to `docs/evidence/phase-6/rg/mutations/<ID>.out` (last 30 lines, commit, UTC, and `ERROR <id>`).

## 4. Closing steps
1. **R35.3(b):** delete the 25 folded `tools/repro/` scripts in one head commit that cites the RG evidence for each folded ID. Then re-count against the 8-test ceiling.
2. **Leak audit (gate LA, final pass):** `tools/leak-audit.ts` over `docs/evidence/phase-6/rg/` and `git log -p` since `5475c60`.
3. **Packaging refresh (Builder B):** rebuild the npm package, the bidder bundle and `dist/benzo-verify.mjs` from a clean clone at `RG_COMMIT`, and re-record the digests (R36/R37).
4. `docs/evidence/phase-6/EVIDENCE.md`: the RG row goes from OPEN to READY FOR REVIEW with the commit, commands and paths. Then the final review (Reviewer G, final report only).

## 5. Who runs it
- The head drives §2, §3's live mutations and §4.1 (2026-10-08: live, stateful and funds-moving work stays with the head).
- Builder B runs §4.2's leak-audit pass and §4.3, offline only.
- Builder A takes offline items only (no OrbStack, no testnet).
- One live harness process at a time, machine-wide.
