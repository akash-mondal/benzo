# Phase 7 batch B55: a cancel before R never touches drand; the RG specs catch up with H19

Head design, 2026-10-19. Source: the head's canary RG at main `b2b35b6`, logs in `tmp/canary-b2b35b6/`.
- testnet-golden-path and auction-core passed.
- settle-crash failed J1, L1, J2, K1, N1 and M1.

Base: main `b2b35b6`.

## 1. A product bug: a cancelled-before-R settle exits 1 (M1)

Since B43 (`ee9c5d7`), `settle/plan.ts:313` runs `await strayEnvelope(party)` for every confirmed deposit of a CANCELLED/REFUNDING auction. `strayEnvelope` passes `await beacon()`, and `beacon()` calls `fetchVerifiedBeacon(m.drand.R)`. Before R that round does not exist on any drand endpoint, so the fetch always throws `refused: drand opening beacon unavailable or unverified on every endpoint`. The run exits 1 instead of parking each deposit with `cancelled before release; refund is claimable after R`. The live log is `ERROR settle node exited 1: ERROR settle refused: drand opening beacon unavailable or unverified on every endpoint`. The comment at `plan.ts:110-114` says this path must never touch the network.

The host side has the same shape. `cli/host-derive.ts` (the derive at about :95-290) calls `opener()`/`cacheKeys()`, and both fetch the beacon:
- in the frozen-leaf loop, which a cancel after freeze reaches;
- in the cancelled-deposit loop (`authenticatedMemoEnvelope(..., await opener(), openMemo)`, `memoOwner`).

A cancelled-before-R packet therefore throws on every host as well.

**Rule.** Before R (`released` false, the same predicate as `plan.ts:108`), no path may fetch the beacon:
- The coordinator plan parks every cancelled deposit with the existing reason and exits 0.
- The host derive returns no payable deposit row (each one waits, with its reason in `refused_rows`) and does not throw.
- A claim submitted before R fails per request, with its reason inside the existing try/catch; it must not stop the run.

After R, nothing changes: the beacon is fetched, the claim and envelope paths work, and the `x-cancel-claims` behaviour is unchanged.

Look for any other caller of `fetchVerifiedBeacon` or `opener()` that a pre-R cancelled auction reaches (`settle/cli.ts` `memoBeacon` is per-row inside a try, so check it parks rather than throws). List each one in the status block.

**Proof (offline).** Write a new fold `tools/repro/b55-cancel-before-r.ts`. Set `BNZ_DRAND_URLS` to a closed local port and put R in the future.
- (a) The coordinator plan for a CANCELLED auction with 2 confirmed deposits gives 2 exception rows with the exact reason, exit 0, and no beacon fetch (count the fetches with a stub or trace).
- (b) The same with a frozen set (cancel after freeze).
- (c) The host derive for that packet does not throw, returns no payable deposit rows, and gives reasons.
- (d) The same world after R with a stub-verified beacon behaves exactly as before.

(a) to (c) must be red on base `b2b35b6` and green after. Reuse the h-fixtures/b47-world helpers.

## 2. The RG specs fund the fee reserve the H19 preflight asks for

B47's H19 preflight (`settle/cli.ts:375-405`, with B51's extra spend per batch) refuses a run when
`obligations + 5000·(spendable notes + unpaid rows + 2·remaining batches) > spendable value`.
It prints `fee reserve short: pay N zats … and run benzo settle again`.

That bound is a deliberate worst case: every output in a pool other than the spends. It is about twice the real ZIP-317 fee for a same-pool batch.

The live specs were written before H19 and fund the exact real fee. settle-crash pays a 30,000-zat reserve for 4 deposits plus a 5-row batch; the bound needs 60,000, so it asked for a 35,000 top-up. The first worker therefore exited before allocating: there was no SIGKILL, so L1, J2, K1 and N1 cascade, and J1's wrong-amount PCZT was checked against no batch (`PCZT recipient count differs`).

The last green RG (`910a531`, Oct 18) predates H19 and H15.

For each live spec that settles, do the following: `settle-crash`, `cli-auction` (reserve 70,000 for 10 deposits, and its second auction), `buyback-mode` and `markets` (each market leg). auction-core and testnet-golden-path already pass; touch them only if they share a helper you change.
- Add one helper in `e2e/lib` that computes the H19 bound from the same inputs: notes, rows, batch cap and remaining batches. Fund `max(old reserve, bound + 5000)`, and keep the bidder-floor guards consistent with the new amount.
- Replace exact-fee assertions that assumed no change with inspect-based ones:
  - `fee_zats === 5000·max(2, actions)`;
  - `input_zats === output_zats + fee_zats` (state whether output_zats includes change; read `benzo-pczt inspect`);
  - the non-change outputs equal the expected rows;
  - the vault keeps exactly `reserve − fee` after the batch, before recovery.
- Where a spec configures `reserve_return_ua`, or the plan now adds a `reserve-return` row (H15/B46/B52: it waits for the 10-deep paid gate), the row and receipt counts must exclude that row, or assert its state explicitly. Read `settle/plan.ts` to see when the row exists without `reserve_return_ua`.
- Every changed expectation names its reason in a short comment (H19, H15).

You cannot run these specs (they are live). Prove what you can offline:
- `npx tsc --noEmit -p .` covers the specs;
- unit-check the helper against the preflight with a few worlds: the helper's amount makes the preflight pass, and the old amount reproduces the 35,000 top-up for settle-crash's world.

The head runs the live specs.

## Rules

- Work only in your own worktree: `git worktree add ../benzo-b55 -b b55-cancel-rg b2b35b6`. Copy `vendor/` with `cp -R ../benzo/vendor .`; do not symlink it. Never `git add` `node_modules` or `vendor`, and before each commit `git diff --cached --summary | grep 120000` must print nothing.
- Offline only. Do not override the git identity. Commit `--no-verify` (R32). If the verify bundle changes, rebuild it and commit it with its sha file. Commit after each item.
- B54 is editing in parallel:
  - `cli/host-derive.ts` `backfillMapped` and `reserveCandidateVerdict`;
  - `cli/commands/sign-approve.ts`;
  - `settle/deposits.ts` (spendable rule);
  - `settle/cli.ts` `check()` (:97-117) and the H23 branch;
  - `cli/host-chain.ts`;
  - the stubs in `tools/repro/h-fixtures.ts` and the b47 worlds.

  Keep your edits away from those regions. Add any new stub in a new function.
- No mid-line `//` after code.
- Build `tmp/b47-republish.mjs` before the b47 fold (R118). Run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, the b44, b46, b47, b48, h10, h13, h14 and b53 folds, and the r77, r78 and r82 replays.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
