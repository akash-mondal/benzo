# Phase 7 batch B56: an unpaid reserve-return row is never published (ruling on B54-Q4)

Head design, 2026-10-19. Source: B54's Q4 in `docs/STATUS-B.md`. Base: main HEAD after the B54 merge (R120).

## The finding

The plan can derive the `reserve-return` row while nothing pays it. On base this happens through the dust or H25 walls; after B54 it narrows to plan/host scan skew, for example a host wallet one note behind at approve time. When it happens:
- the row pins as an exception;
- the settlement publishes a bare `reserve-return` row;
- the product's own verify refuses that doc (`api/public-auction.ts:954`, "a reserve-return row or receipt without the published reserve_return accounting");
- every later `benzo settle` dies before pinning (`no signer host could list its derivable rows`, exit 1).

That is a permanent wall from a transient skew.

## Ruling (R121)

Never publish an unpaid `reserve-return` row. Verify stays strict: a published return row still needs its receipt and its accounting.

1. **Publish.** Leave out every `reserve-return` row whose state is not `paid` from the published settlement rows. Find every place that writes published or summary rows: `cli/product.ts` publish around :100-125 and any summary writer in `settle/cli.ts`. The private ledger keeps the row, its state and its reason. The run still prints the typed waits line.
2. **Hosts.** The listing and derive paths that read the published doc (`sign derivable`, the public check the hosts run) never see the bare row, so the wall cannot form. If a host-side check also reads the row from somewhere else, name it in the status block.
3. **Recovery.** A directory that already published a bare row (pre-B56 state) heals on the next `benzo settle`: the republish drops it, verify accepts, and the run proceeds. Do not edit published evidence dirs in git.
4. **Docs.** Add one line to the operator guide: a reserve return that is waiting does not appear in the public directory until it is paid; `benzo settle` prints why it waits.

## Proof (offline)

Write a new fold `tools/repro/b56-unpaid-return.ts`, reusing the b54 and b47 worlds. Each case is red on base and green after.
- (a) Plan/host skew: the plan derives the return, and the host refuses it (one note behind). After the fix, the doc publishes without the row, verify accepts, and a second run exits 0 with the waits line.
- (b) A pre-B56 published dir with a bare row: the next run heals it, and verify accepts.
- (c) The normal path is unchanged: when the return is paid, the row, receipt and accounting are published and verify accepts. The b46, b47 and b54 folds stay green.

## Rules

- Work only in your own worktree: `git worktree add ../benzo-b56 -b b56-unpaid-return <main HEAD>`. Copy `vendor/` with `cp -R ../benzo/vendor .`; do not symlink it. Never `git add` `node_modules` or `vendor`, and before each commit `git diff --cached --summary | grep 120000` must print nothing.
- Offline only. Do not override the git identity. Commit `--no-verify` (R32). If the verify bundle changes, rebuild it and commit it with its sha file. Commit after each item.
- B55 is editing in parallel:
  - the cancelled-deposit loop in `settle/plan.ts` (about :303-320);
  - the cancelled paths in `cli/host-derive.ts` (the frozen-leaf loop and the cancelled-deposit loop, about :100-290);
  - `e2e/*.spec.ts` and `e2e/lib`.

  Keep your edits away from those regions.
- No mid-line `//` after code.
- Build `tmp/b47-republish.mjs` before the b47 fold (R118). Run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, the b44, b46, b47, b48, h10, h13, h14, b53 and b54 folds, and the r77, r78 and r82 replays. `npm run e2e` needs the main checkout's `tle`; say if it is blocked.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block and Questions in `docs/STATUS-B.md`.
