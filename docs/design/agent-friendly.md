# Making Benzo agent-friendly (head, 2026-10-16)

Goal: the next agent that touches this repo should do the right thing by default. Fix mistakes at the highest level
that works: architecture, then types, then a check whose error names the fix, then a test. Prose comes last.

## The data

- **Reviewer R:** 133 findings across 30 reports (9 P0, 43 P1, 81 P2), in `benzo-sol/reports/`.
- **Head rulings:** R47–R72 during gate RG alone, in `docs/PHASE-6.md`.
- **User corrections:** 56 corrective messages in the session transcripts.

Reading every P0/P1 finding gives six classes. A class counts once it has happened twice.

| Class | P0/P1 | What kept going wrong |
|---|---|---|
| A. Settlement wedges and double-backing | ~12 (4 P0) | a signed or pinned set compared with live chain state; a throw on a note a third party can add |
| B. Verify trusts an unattested field | ~8 | a published field the operator can fabricate is accepted |
| C. Test and evidence integrity | ~7, plus 9 harness bugs in R59–R70 | checks that pass for the wrong reason; `@ts-nocheck` code that never ran |
| D. Gate and provenance bypass | ~6 | pins, skip-worktree, stale bundle, dirty tree (closed in R49–R53) |
| E. Unbounded or single-oracle chain I/O | ~5, plus R48 | raw `spawnSync` of grpcurl/devtool/tle; NotFound read as absence |
| F. Privacy through published or evidence fields | ~5 (4 P0), plus B37 | a destination joinable to a bid; raw tool output in evidence |

## What each class gets, and the proof

Every check below was run against a real past mistake. All of it is on branch `agent-friendly`.

**A. Property test: `tools/checks/settlement-invariants.ts`.** It runs 3,000 random chain histories through the balance-settlement rule and checks four invariants:
- it never throws on valid chain state;
- a note backs at most one refund row;
- an unconfirmed note is invisible;
- value is conserved.

*Proof:* the current code passes. The code just before R46 fails about 480 times per seed on I3 and I4, which is Reviewer R's F23. That P1 took a review round; the test finds it in about a second.

**B. Trust registry: `SETTLEMENT_TRUST` in `api/public-auction.ts`.** Every published settlement field declares its trust source and the verify check that enforces it. A field with no entry is a type error, and verify refuses a field whose check did not run.

*Proof:*
- deleting the `bond_void` entry gives TS2741;
- over every committed settled document there were 0 false alarms;
- the registry found two fields the product publishes but verify never checks: `batches` and `offline_signer`. They are now marked informational.

**C. No untyped harness: `tools/check-structure.mjs`, rule `no-ts-nocheck`.** Three fold files carried `@ts-nocheck`.

*Proof:* typechecking the pre-R66 version flags R69 (`.subarray` on a hex string), R70's missing `spawn` import and its undefined `outcome`, and two latent wrong-arity calls nobody had found. The pre-R59 version flags R59's missing network argument. It misses three bugs where values were `any`, so the fix is to type the harness, not just remove the comment.

**E. Bounded chain I/O: rule `bounded-chain-io`.** A spawn of grpcurl, zcash-devtool or tle must go through `settle/bounded`.

*Proof:* at the commit before R48 it flags exactly the 9 sites fixed later. That includes `cli/host-chain.ts`, Reviewer R's R48 P1, so the check would have caught it before review. At HEAD it flags one real remaining miss: an unbounded `tle -d` in `e2e/cli-auction.spec.ts`.

**F. Redaction by construction.** `write()` in `e2e/lib/run.ts` redacts every address in any text. Writing raw needs `writeRaw(rel, content, reason)`.

*Proof:* B37's two leaking RG files go from 3 full addresses to 0.

**Also: `esm-no-require` and `evidence-through-write`** close R66 and keep evidence on the redacting path.

## The plan

| Step | When | Contents | Risk |
|---|---|---|---|
| 1 | right after RG is gold | merge the check script, the property test, redacting `write()` and the trust registry; add `npm run check` (typecheck, check:structure, the property test, check:bundle) and run it in the pre-commit hook; fix the one remaining unbounded `tle` | verify output gains a check, so the verify bundle is rebuilt |
| 2 | before mainnet | subtract first: delete the nine withdrawn folds' code, type what remains, delete the `@ts-nocheck` files | harness only |
| 3 | after submission (Destination: before mainnet) | architecture: one `ChainView` module owns all chain and beacon I/O (bounds, multi-endpoint agreement, NotFound typed as unknown), and the lint forbids any other route; an opaque `Destination` type whose `toJSON` throws, so a destination can never be serialized into a public document or log | product refactor, so a full RG re-run |

## The rule table (goes into `AGENTS.md`)

| Rule | Enforced by |
|---|---|
| Chain/beacon I/O is bounded | `check:structure` bounded-chain-io; step 3: `ChainView` is the only route |
| No `@ts-nocheck` | `check:structure` no-ts-nocheck |
| ES modules use `import` | `check:structure` esm-no-require |
| Evidence is redacted | `write()` by construction; `check:structure` evidence-through-write |
| Every published settlement field is verified | `SETTLEMENT_TRUST` (type and runtime) |
| Settlement is total and conserving | `tools/checks/settlement-invariants.ts` |
| Pinned binaries are provenance-checked | `e2e/lib/pins.ts` (R49–R53) |
| The head does live work; builders get offline, specified batches | prose (memory and AGENTS.md); judgment |

The last row is the user's own steering, read from the transcripts: the head thinks and does the risky work, MiMo gets routine work, and nothing ever uses the cloud. It stays prose because it's a judgment call.

## Measured since the plan was written

- **Step 2 is done on the branch.**
  - The nine withdrawn folds are deleted: `readpath-live.ts` went from 1,433 lines to 418.
  - All harness code is typed; `@ts-nocheck` is gone.
  - Typing found one more latent bug: `failed++` on an undefined name in `readpath-r261.ts` would have turned a real FAIL into NOT RUN.
  - The last unbounded harness `tle` is bounded.
  - The typed R23.2/R26.1 folds still pass all 10 IDs, and `check:structure` is green over 181 files.
- **The opaque `Destination` costs less than feared.** Destinations appear in 35 product files, but making `openDestination` return an opaque `Destination` (its `toJSON` throws; `reveal()` is explicit) gives only 5 type errors: 3 in `cli/host-derive.ts` and 1 each in `cli/product.ts` and `settle/cli.ts`. Each is a payment-construction point, exactly where `reveal()` belongs. Measured, then reverted. Being that cheap, it can land before mainnet, where a leak disqualifies.

## Reviewer R on this branch (`benzo-sol/reports/pr-agent-friendly.md`, REQUEST CHANGES), and what changed

- **R-AF-6, P1: a duplicated scan note double-backed rows.** The property test could never see it, because its generator never produced duplicates. The test now injects duplicates and covers the void path (R-AF-7); on the old rule it fails 408 times on I2 and 414 on I4. The product fix: `balanceMatured` dedupes by note identity, the one gate every balance rule passes. All four invariants pass now.
- **P1: a destination nested in `rows` passed the registry.** Verify gains a structural leak guard, `no-destinations`: no address string anywhere in a published settlement. It gives 0 false positives over 28 committed settled documents and refuses a planted `settlement.rows[0].note` destination.
- **R-AF-2, P2: rule bypasses.**
  - `bounded-chain-io` now covers async `spawn`/`execFile` and variable-held commands. A variable is flagged when it is assigned a chain-tool path.
  - On history it adds `cli/host-derive.ts`'s `devtool` (R48) and the harness `TLE` calls (R52): 15 flags before R48, 10 before R52, 0 at HEAD.
- **P2: redaction coverage.** Added t2/t3 (P2SH) and zc (Sprout).
- **P2: reproducible counts.** `python3 tools/af/mine-corpus.py ../benzo-sol/reports` re-derives them. Today: 31 reports, 152 findings (9 P0, 46 P1, 97 P2), 129 head rulings. The table above was written at 133 findings.
- **R-AF-3, P2: `tools/` is now typechecked.** It is in `tsconfig.json`, so `npm run check` covers it. The first run gave 21 errors in 8 drivers. Most were missing annotations, but two were real:
  - `tools/repro/r28-replay.ts` used `ROOT` without importing it. R43 added that line, so the driver has thrown a ReferenceError on start ever since. That is class C again.
  - `r41-f7-map-wedge.ts` passed a fourth argument that `agreedBatchMaps` no longer takes.
- **The r261 fixture's `as any` is gone.** It is typed as `PublicAuction` now. Typing it showed the fixture's `deliveryList: null` where the type says `undefined`. The folds still pass 10 of 10 offline.
- **R-AF-5, P2: "ran" is now "read".** While a check runs, verify watches which settlement fields it reads (a Proxy on `pub.settlement`). A field counts as verified only if one of its registered checks read it. Informational fields declare `verifiedBy: []`.
  - The stricter rule found two wrong entries in the first registry:
    - `receipts` named the check `receipts`, which reads the deposit receipts, not `settlement.receipts`;
    - `ignored` named `accounting`, but `accounting-strays` is the check that enforces it.
  - `approval_maps` is enforced by `defaults`, `balance-refs` or `claims`, depending on the mode.
  - `tools/af/registry-measure.ts` shows 0 false alarms over 26 settled committed documents. Restoring either wrong entry gives an error on 26 of 26 and 23 of 26 documents respectively.
  - A field whose own check already failed raises no second error.

## The opaque `Destination` (step 3's privacy half, prototyped on the branch)

- **What it is.** `settle/destination.ts`. `openDestination`, `envelopeRecipient`, `memoEnvelopeRecipient` and `memoBoundEnvelope` now return a `Destination`, not a string:
  - `JSON.stringify` throws;
  - template strings and `util.inspect` print `[Destination]`;
  - there is no enumerable field;
  - the address comes out only through `reveal()`.
- **Proof.** `tools/af/dest-proof.ts` checks all six properties, and all six hold.
- **Cost.** 6 reveal points, all at payment construction:
  - 3 in `settle/cli.ts`, which build the payment row and the agreed-hash cross-check;
  - 2 in `cli/host-derive.ts`, which build the expected payment rows (typing found a 6th, R46's balance-refund row, that came after the first measurement);
  - 1 in `cli/product.ts`, which only hashes it for the opening report.
- **Rule `opaque-destination` in `check:structure`.** Outside `envelope/` and `settle/envelopes`, product code may not name `openEnvelope`, and `.reveal()` may appear only in those three files.
  - A planted `console.log(d.reveal())` in `clear/core.ts` is flagged.
  - So is an aliased `import { openEnvelope as _oe }` in `settle/plan.ts`; a first version of the rule that matched only calls missed it.
- **A silent-pass trap it removed.** `tools/repro/r10-4-envelope-agreement-repro.mjs` compared the opened destination with `===`. Against a `Destination` it would have printed "some destination" and never CONFIRMED. It now compares the revealed value.
- **Not covered.** `openEnvelopePayload` in `cli/commands/xchain.ts` reads the cross-chain `deliver` only, and is allow-listed. The `crosschain/*.mjs` devnet demos are out of scope.
- **Before merge.** This changes host-side derivation, so it merges only with a full RG re-run.

## Rule `comment-swallowed-statement` (the same mistake twice: R57 and R71)

- **The mistake.** Twice, a head edit glued a marker comment in front of the rest of a line, which turned a statement into a comment:
  - R57 swallowed the markets `const run = new Run("markets");` (fixed in 665e447);
  - R71 swallowed auction-core's `write("auction/signatures.json", …)`. Reviewer R's P1-1 on R72 caught it after an RG re-run had already committed evidence without the file.
- **The rule.** It flags a `//` comment whose text ends in a call statement with a literal argument: `name("…");`.
- **Proof.**
  - At 665e447~1 it flags `e2e/markets.spec.ts:39`.
  - At c9f2fc7 it flags `e2e/auction-core.spec.ts:258`.
  - At the fix (edf3784) and at branch HEAD it is clean.
  - The only other candidate, a prose comment ending in `max(spends, outputs, 2);`, does not match because it has no literal argument.
- **The second layer (R73, on main).** `Run` now takes the evidence files each ID cites, and fails the ID when they were not written. An offline probe passes the ID that writes its file and FAILs the one whose write is commented out.
- **A third time, 2026-10-17 (4feaa86, head, R74).** A trailing comment swallowed `console.log(…); }` in `e2e/lib/run.ts`.
  - The rule's first form missed it because the swallowed text ended in `}`. It now allows trailing braces, and flags all three incidents on history (665e447~1, c9f2fc7, 4feaa86). HEAD stays clean.
  - Typecheck caught this one at once, as a syntax error. Main has no pre-commit gate, though, so it reached a commit. This branch's `.githooks/pre-commit` (`npm run check`) would have stopped it.
