# Status: build agent handoff

## Phase 3 ([PHASE-3.md](PHASE-3.md)): IN PROGRESS

Contract d0fbe61 / R1 plus R2–R5 at 5afd2b2, R6 at e1225dc and R7–R8 at dc28c08 (head@benzo.invalid). Started only after Phase 2 READY FOR REVIEW at 28ddd09: live run b834747, artifacts aa4676b, positive verifier 0 and corrupted-copy exit 1 with ERROR E/F. Read Phase 3 in full and DESIGN §6/§14. `npm run e2e` regression PASS before new work (`tmp/e2e/phase3-baseline.log`).

Gates J/K/L/M/N: IN PROGRESS. No Phase 3 live gate evidence yet. Implemented worker, durable SQLite obligations, separate signer checks with fresh Go tle, and pre-broadcast signed-PCZT staging; integration not verified. First step: pinned-SDK multi-output PCZT creation and an inspector for signer recipient/amount/fee checks. Existing devtool `pczt create --help` accepts one address/value; its pinned `src/commands/pczt/create.rs` uses a single Payment vector. SDK driver now compiles against exactly the versions/source identities in the pinned devtool Cargo.lock; inspector checks CV/nullifier/rk/note commitments, note-ciphertext recovery, actual recipients, owned change and ZIP-317 fee. `npm run build:settle` and strict TypeScript check pass; scratch inspection of an existing real PCZT passes, not gate evidence. One new spec, e2e/settle-crash.spec.ts (J1/J2/K1/L1/M1/N1), typechecks; live development v6 passed all six IDs; mutations and final clean evidence remain pending. Prior failures and recovery commands are recorded below. Phase 1 specs unchanged. Live selection moves to settle-crash only for this phase; wallet/frostd remain serialized.


## Phase 2 ([PHASE-2.md](PHASE-2.md)): head approved at 5afd2b2

Updated: 2026-10-01T05:02:58.031222+00:00 · Contract: 44931b4 + R1 at 0ec8c02 + R2–R4 at cc2ced0 (head@benzo.invalid). Phase 3 contract d0fbe61 read in full; work starts only after Phase 2 READY FOR REVIEW.

- **Phase 1:** PASSED, R5–R10 at 04926a7. Closed; decisions stand: binary_memo, frost_2of3, tlock-js@0.9.0. Evidence remains under `docs/evidence/phase-1/` at run 512296f / artifact commit 1a94638.
- **Current:** Head recorded Phase 2 PASSED in R5–R6 at 5afd2b2. Phase 3 baseline regression passed; implementing J/K first. No UI or mainnet work.
- **Verified baseline:** `npm run e2e` PASS at 0ec8c02, `tmp/e2e/phase2-baseline.log`.
- **Funds (last verified before current drill):** Recovery tx `db1b7fce58fe0bc1a9585ba39fff4284e65d7865d111f92b870408e50a9d316b` mined at 4424057 on both endpoints. Bidder 99,780,000 zats; vault 0; exact 2,500,000 returned, reserve fee 30,000. `tmp/e2e/recovery.json`, `recovery-proof.json`, `recovery.log` are development output only. Floor remains 1,540,000 zats; only one live wallet/frostd worker is active.
- **Needs user:** none.

## Questions

- Q9: explicit finite PCZT expiry is now proposal target + 200 blocks via the pinned SDK API, keeping expiry/NU7 refusal and all assertions. Actual clean-run chain advanced 60 blocks during signing, beyond the SDK default 40; no pins, test timeout, assertion or line-count change. Cheapest Phase 3 mutation and clean evidence will be rerun before readiness.

- Q8 resolved by R7 at dc28c08: 744 lines accepted. Original question (after R5): the balance-definition fix and local PCZT digest binding added seven essential lines, total 744 (483 production + 158 spec + 103 verifier) versus the accepted ~737. This repairs the observed uneconomic-note accounting error and binds the coordinator digest to every signer check; no extra test, assertion or feature.
- Q7 resolved by R2 at 5afd2b2: exact C for losers/invalid/cancel, network reserve pays fees; nonzero auction fees must come from winner payments/reserve. Zero-fee drills explicitly continue. Original question: Phase 2 clearing subtracts signed fee_zats from refunds, while Phase 3 requires exact C for losers/invalid. Current worker rejects nonzero auction fees and uses only separate network reserves; please rule on nonzero auction-fee settlement rather than silently changing the pinned clearing result. Zero-fee drills continue.
- Q5 resolved by R3 at 5afd2b2: pre-funded private destination copies are sufficient for Phase 3 K evidence; encrypted settlement-envelope authentication is not claimed or required now. Original question: inherited bids have random owner/settlement fields and the signed manifest has no seller destination. Current fixture design pins private bidder/seller destination copies for each signer before funding and accepts no run-time recipient override; Gate K can check PCZT recipients against those copies, but this does not prove bidder-owned settlement-envelope authentication. Please rule whether this is sufficient for Phase 3 evidence or require the encrypted envelope/manifest extension now; no such privacy/authentication claim will be made.
- Q6 resolved by R4 at 5afd2b2: faulted real PCZT is authorized for J1; P1 missing-refund failure satisfies L1 final-total contract and must be labeled accurately. Original question: P2 needs a wrong-amount real PCZT at the checker boundary, since deleting a guard on an honest proposal leaves all amounts unchanged. Proposed J1 negative candidate check protects DESIGN §6 output validation; omitted amount guard is the regression; previous tests never inspect settlement proposals; the checker CLI is used by real signer sessions, with no test seam. P1 premature paid state may cause missing refunds after a pre-broadcast crash, which L1's required final-total check will reject; do not mislabel that failure as observed double payment.
- Phase 3 line budget: production is currently 483 hand-written lines; the one E2E spec (158) and evidence verifier (103) bring the total to 744, 144 above +600. The overage is for actual multi-output SDK glue, encrypted-note/recipient verification, durable resume, independent signer processes and the six contracted assertion IDs, not new features or tests.

- User instruction (2026-10-01T04:35:38.725868+00:00), verbatim: “but I hadn’t arranged for this agent to resume automatically for Phase 3 . make sure you never repeat this msitake when waiting next time”
- Session discipline: stay active during waits unless a confirmed mechanism resumes this agent, including its dependent phase work; background-command completion alone does not do that.
- Q1 resolved by R2 at cc2ced0: exact-C cancellation refund, separate fixed fee-reserve note, one live drill authorized.
- Q2 resolved by R3 at cc2ced0: auction-core project only, serialized live wallet/frostd access; both Phase 1 specs retained unchanged.
- Q3 resolved by R4 at cc2ced0: full five-note drill; floor remains 3C + 40,000 zats.
- Q4 withdrawn: literal N3 is feasible as a mutation that waits for the real release round, opens with pinned Go tle and hashes the actual plaintext into the root. This deliberately breaks sealed freeze; independent F2 must reject its plaintext root. No alternate mutation, supplied plaintext or test-only seam is needed. N3 live red at F2 is recorded in mutations/N3.out.
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

| Gate | State | Command / commit / evidence |
|---|---|---|
| E | READY FOR REVIEW | `BNZ_EVIDENCE_DIR=docs/evidence/phase-2 npm run e2e:live`, b834747bd297ba9708f2eec89789be0512f8f9cc; `docs/evidence/phase-2/auction/` |
| F | READY FOR REVIEW | `BNZ_EVIDENCE_DIR=docs/evidence/phase-2 npm run e2e:live`, b834747bd297ba9708f2eec89789be0512f8f9cc; `docs/evidence/phase-2/auction/` |
| G | READY FOR REVIEW | `BNZ_EVIDENCE_DIR=docs/evidence/phase-2 npm run e2e:live`, b834747bd297ba9708f2eec89789be0512f8f9cc; `docs/evidence/phase-2/auction/` |
| H | READY FOR REVIEW | `BNZ_EVIDENCE_DIR=docs/evidence/phase-2 npm run e2e:live`, b834747bd297ba9708f2eec89789be0512f8f9cc; `docs/evidence/phase-2/auction/` |
| I | READY FOR REVIEW | `BNZ_EVIDENCE_DIR=docs/evidence/phase-2 npm run e2e:live`, b834747bd297ba9708f2eec89789be0512f8f9cc; `docs/evidence/phase-2/auction/` |

Generated artifact commit: aa4676b2e0fddee20e63d2bb00fb9b724555b234. Positive verifier exit 0; corrupted-copy verifier exit 1 with ERROR E and F/G. Logs `tmp/e2e/phase2-verify-{positive,negative}-v2.log`.

## Decisions

- **Freeze:** `merkle_root_v1`, SHA-256(00 || ciphertext SHA-256 bytes || canonical deposit JSON plus newline); parent SHA-256(01 || left || right), duplicate odd sibling, empty SHA-256(02). Ordered leaves commit to ciphertext and deposit; F1/F2 verified receipts and independent paths/non-members.
- **Clearing:** signed mode selects settlement. Uniform-price sorts price descending and leaf index ascending; fully fills upper bands; marginal units floor(supply × quantity / band demand), residual units by ascending leaf index; minimum-fill failure clears all fills; reserve filters low bids. Winners pay the lowest winning price, integer zatoshis. Vickrey pays second price (reserve for a sole bidder), hides maximum-price fields, and is also a deterministic comparison on the same envelopes. G1/G2/G3 verified the live inputs.
- **Receipt:** Ed25519 signature and SHA-256 over canonical newline-terminated JSON fields `auction_id`, `manifest_hash`, `ciphertext_hash`, `deposit` (`txid`, Ironwood pool, address, diversifier index), `leaf_index`. Independent verification uses trusted manifest signer, published root and sibling path; F2 and verify.sh exercised that boundary.

## E2E audit

- R `e2e/seal-open.spec.ts`: C1–C7, unchanged Phase 1 regression; default rerun PASS in `tmp/e2e/phase2-default-regression.log`. Sealer behavior unchanged since its mutation run.
- R `e2e/testnet-golden-path.spec.ts`: A1–A5/B1–B3/D1, unchanged Phase 1 regression, not reopened per R3. Scanner expired-unmined-spend filtering changed; recorded Phase 1 mined-spend behavior remains the same. Phase 2 real scanner path exercised by N5/H2 and I1; no new Phase 1 mutation claim.
- R `e2e/auction-core.spec.ts`: E1/E2/F1/F2/G1/G2/G3/H1/H2/H3/H4/I1. N1–N7 red; production source unchanged from their runs to final evidence. Exactly three tests total of ceiling eight.

## Blocked items

None currently. First development failed after an unmined refund lookup: primary GetTransaction returned a mempool tx then NotFound; alternate lookup/send returned InternalServerError (`tmp/e2e/refund-primary.err`, `refund-alternate.err`, `rebroadcast-alternate.log`). That refund expired unmined; original disappearance cause unresolved. Own harness now waits for wallet mined height, then requires both endpoint proofs, and checks fresh tip/expiry before send. Manual recovery succeeded on both endpoints without new deposits.

## Deviations / Environment changes / Upstream code reused

All tool pins unchanged; no environment changes. Note reconstruction follows source: zcash/orchard@ae3511076ec8ecb39ffc02d9cdaf19c441c5b53d:src/pczt/verify.rs; encrypted recovery uses public zcash_note_encryption 0.4.2 APIs. Multi-output SDK create and shielded address generation adapted from `source: zcash/zcash-devtool@5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8:src/commands/pczt/create.rs` and `src/commands/wallet/gen_addr.rs`; exact dependency identities remain its lockfile versions. Scanner now applies the pinned wallet's unexpired-spend condition instead of counting expired unmined spend candidates. Actual six notes were reported spent before this fix and spendable afterwards; the recovery then consumed them on chain. Adapted SQL: `source: zcash/librustzcash@97aefdc39a037da9c4f19a0e8a450d2c7932f53e:zcash_client_sqlite/src/wallet/common.rs` (`tx_unexpired_condition`, lines 114–125). PCZT public version/branch/expiry getter uses exact pczt 0.9.3 already in the pinned devtool graph. Read pinned CLI help/source before calls. NU7 check 20:25 UTC: ZIP-259 testnet activation still TBD (Oct 5); recheck before next broadcast.

## Deferred

All frontend implementation, styling and hosting UI are user-owned per Phase 3 R6 at e1225dc; build-agent scope remains backend/CLI/verifier/settlement. Full owner-key / settlement-envelope delivery remains unresolved under Q5; current routing fixture must be declared explicitly.

## Last session

- 2026-10-01T12:14:35Z: Cheapest P1 rerun after finite-expiry repair complete: ERROR L1, actual 0 / 2,000,000 refund before cleanup; honest cancel M1 PASS (1,000,000 refunded, zero openings). Recovery 0d1e58b910a637d21f1ec72fc9d682a3a2defa0e1bc91f780a33ecf7bbca9e01 mined. Patch reversed; docs/evidence/phase-3/mutations/P1.out updated from tmp/e2e/phase3-P1-expiry.log at clean base 311f1d2; artifacts tmp/e2e/phase3-P1-expiry-artifacts/. Next concrete step: fresh clean evidence with finite expiry, then both verifier checks and READY FOR REVIEW.

- 2026-10-01T11:49:33Z: Cheapest P1 rerun active on expiry repair 311f1d2a8a5ab438e59bb1c267e2ffc39f484bc5; start 11:42:09 UTC, funding 8061387111e55205da70ca3ce4e98780f03d3c9623dacbbf3d375da23617d5b6 confirmed/frozen, release 12:04:18 UTC. Log tmp/e2e/phase3-P1-expiry.log. Exact line count remains accepted 744. Next: record L1 missing-refund red and cleanup, reverse ledger patch, then clean evidence with finite 200-block expiry.

- 2026-10-01T11:41:06Z: Clean evidence attempt at 847ffb5 FAILED: J1/J2/K1/L1 fail after safe expired-PCZT refusal, M1/N1 PASS. PCZT expiry 4427593; construction tip 4427552, broadcast check tip 4427613; ten real signer checks from 11:32:23–11:34:00 UTC. Output tmp/e2e/phase3-final-evidence.log and timing tmp/e2e/phase3-expiry-observations.json; artifacts preserved tmp/e2e/phase3-final-failed-expiry-artifacts/. Recovery 4857145b9288ba834390824acb7dad284b5b4f6012d0423338362264b05b9186 mined; cancel returned exact C with zero openings. Own SDK driver now requests finite target+200 expiry (supported API; no assertion/pin/line-count change); npm run build:settle and npx tsc --noEmit PASS. Live after-fix validation remains pending. Next: verified fix commit, fresh cheapest P1 mutation on changed code, then clean evidence.

- 2026-10-01T11:23:35Z: Clean Phase 3 evidence run active from 847ffb56b93e5c686f1dd181bef795ba896a1718, start 11:09:27 UTC; main funding 387ff32206b49145e6ab6d5957b4b04810a6848341ae6100ef141f341ba4536b confirmed/frozen. Real release 11:31:36 UTC; output tmp/e2e/phase3-final-evidence.log, staging tmp/e2e/out then copying to docs/evidence/phase-3 on completion. Main and cancel assertions, positive/corrupted-copy verifier remain pending. Stay active through all waits; no source changes.

- 2026-10-01T11:08:56Z: P3 complete red at M1 (one real Go tle opening attempt, worker exit 1, zero refund before cleanup); all five main IDs PASS. Recovery 489235ddb527a2700569c1dadb53fce205a3adc01080ffcd5cb11401ccfb8ca1 mined; patch reversed, tree clean before writing P3.out. Log tmp/e2e/phase3-P3.log, preserved artifacts tmp/e2e/phase3-P3-artifacts/. P1/P2/P3 now all recorded red; no production changes since their runs. Next concrete step: one clean Phase 3 evidence run and verify.sh positive/corrupted-copy negative.

- 2026-10-01T11:02:23Z: P3 main J1/J2/K1/L1/N1 PASS; batch e14b388ad84f3f26772bdbedd2730c320477038e1b5095267f04c8bd027caeb0 mined at 4427391. Cancel funding 67fd60b85b8b3daa41f9dd6644a134bb8dfee5ead518be1456f6805f3d10ef1d awaits confirmations; M1 pending. This is mutation-run progress, not clean gate evidence. Continue to expected opening-attempt failure and cleanup before reversing P3.

- 2026-10-01T10:43:06Z: P3 active from clean da560d55a48ea8ac1b347c9aed2bdc8796c66313 + literal cancel opening-attempt patch. Main funding cfb6cdb176cc51d832cdb0baa4c3f3fbe4b2d4191a28607be8cefe13de6ca7f8 confirmed/frozen; release 2026-10-01T10:52:45+00:00. Log tmp/e2e/phase3-P3.log; 80-minute spec deadline from 10:30:30 UTC. Stay active through main settlement, expected M1 rejection and real cleanup; then restore plan.ts and run clean final evidence.

- 2026-10-01T10:30:11Z: P2 finished (1706s), ERROR J1; J2/K1/L1/M1/N1 PASS. Saved docs/evidence/phase-3/mutations/P2.out from tmp/e2e/phase3-P2.log, labeled “intentional incorrect-amount sample at the signer amount checker; expected J1 fail; cleanup/recovery only.” Guard restored with git apply -R; artifacts preserved tmp/e2e/phase3-P2-artifacts/. R7 accepts Q8, R8 accepts this real regression. Next concrete step: P3 cancel opening-attempt mutation, then one clean Phase 3 evidence run and both verifier checks.

- 2026-10-01T09:36:16Z: P2 active from clean 5bcb5ec6fd6a7ac0db64dfc7174ed671912ea4c3 + literal omitted amount guard; start 09:24:38 UTC, 80-minute spec deadline. Funding 17f1dfbdaf0dd90d55715255601b7bad3467d0a1884e4e02590218798e43718f confirmed/frozen, release 09:46:48 UTC. Output tmp/e2e/phase3-P2.log. No mutation result yet; keep run active through real settlement/cancel and cleanup, then reverse patch and record J1 at the faulted real PCZT.

- 2026-10-01T09:24:38Z: P2 clean-start preflight initially stopped on the head’s concurrent protected PHASE-3.md edit, before mutation/spend. Head committed e1225dc (R6); read-only file untouched and tree now clean. R6 prohibits frontend implementation/styling/hosting UI by build agent; current backend/CLI settlement work continues. Next: P2 fresh real faulted-PCZT amount-check run.

- 2026-10-01T09:20:36Z: P1 completed red at L1 from clean d6864f5 + P1.patch. Observed missing refunds (0 / 2,000,000 zats before cleanup), not literal double-pay, recorded in docs/evidence/phase-3/mutations/P1.out. M1 PASS; development recovery c7c001a8565963b0dc6159080b9d5df691880dc3c819408fe1da038c5793916a mined. Patch reversed; git status showed only new P1.out. Full log tmp/e2e/phase3-P1.log; artifacts phase3-P1-artifacts/. Next concrete step: clean P2 amount-guard mutation at the real faulted-PCZT checker, then P3 and final clean evidence.

- 2026-10-01T08:58:56Z: P1 active from clean d6864f5b5c776798642c6530b07270f31050b68d + literal ledger mutation; start 08:38:27 UTC, 80-minute spec deadline. Full log tmp/e2e/phase3-P1.log. Funding a3bfa979b932d06e6fa268ceba83b311f51d36b41fff7a1d4fea6063b750edd1 confirmed/frozen; release 09:00:39 UTC. No observed mutation result yet. Next: inspect L1 and actual totals, allow real fund cleanup to finish, reverse patch, then generate P1.out from recorded output.

- 2026-10-01T08:36:06Z: Development v6 PASS all J1/J2/K1/L1/M1/N1, run 71ec4cd245ccf24c6248dde23cad433e24ed2bf9, 07:55:05–08:28:11 UTC. Positive verifier exit 0 (tmp/e2e/phase3-development-v6-verify.log); one corrupted summary amount gives exit 1 with ERROR J/L (phase3-development-v6-verify-negative.log). Artifacts preserved tmp/e2e/phase3-development-v6-artifacts/. Owned processes stopped. Removed unnecessary private pczt_path from public summary generation, no assertion change. Next concrete step: P1 on a clean committed tree, observe actual missing-refund L1 failure, reverse patch and record output; then P2/P3 and clean final evidence.

- 2026-10-01T08:26:44Z: V6 J1/L1/J2/K1/N1 PASS (tmp/e2e/results/settle-crash.json); main 66bd0eb193c68904f057d9cafb5ddd7c1eef8b26572cd115fb6d705ab0e4d364 mined. M1 pending on fresh cancel funding b5e7d547cdd6fac9d6c0b9cbefdefb4e5acb5cd29070a6e474b8d22e3b97508d. All-source checkpoint remains 8f6cc7d. Next: inspect complete run, positive/corrupted-copy verifier, then serial P1–P3 and final clean evidence.

- 2026-10-01T08:08:47Z: Read committed head rulings 5afd2b2: Phase 2 R5–R6 PASSED/complete; Phase 3 R2–R5 resolve fees, routing and mutations and accept named overage. V6 remains active on unchanged source 8f6cc7d; main is confirmed/frozen SEALED-WAIT, release 08:17:15 UTC. Continue to all six IDs, positive/corrupted-copy verifier, then real serial mutations and clean final evidence.

- 2026-10-01T07:57:12Z: Fresh development v6 active at source 8f6cc7d, tmp/e2e/phase3-development-v6.log; funding 055ef8f051409a4c99c6301641cf3f8b370b4afd28e9954e5d911fc74b5d7c61. All-note accounting and independent local PCZT digest checks await fresh full validation. Primary raw-chain recovery of the previous main batch independently finds five positive outputs totaling 2,000,000 plus one zero padding output (scratch output only, not gate evidence). No concurrent wallet/frostd run.

- 2026-10-01T07:55:04Z: Development v5 FAILED (harness balance definition), run commit 5d38ab6: J2/K1/M1/N1 PASS; J1/L1 compared economic-only CLI total and omitted the actual 2,140-zat seller note. Both real settlements mined: main 15d83101f5515287a8a6cf60e7dd9f2589a7105e12aaf1f5c79b03647cc8f263, cancel 7b1b7738dbf8d1ee00fe5f230ff7fcdc79a8c46e7274cbebd0592789884db3ec. Failed artifacts preserved tmp/e2e/phase3-failed-v5/; full log tmp/e2e/phase3-development-v5.log. Same wallet historical mined-note delta is exactly 2,000,000; current all-note minus economic total is 2,140. Spec now measures all mined unspent notes through the existing shipped scanner after enhance; expected totals unchanged. SDK independently computes the v6 signature hash, each real checker requires it equal the coordinator digest before FROST, and sign-offs record it. Actual mined-PCZT local digest matches coordinator; build/typecheck PASS, no new E2E assertion or test. Fresh full validation remains next; no Phase 3 gate claim.

- 2026-10-01T07:23:09Z: Fresh development v5 is active at f4bb2e4, tmp/e2e/phase3-development-v5.log. Main funding ab77f87566bc9bc542e165b6b939692fb81ad1f778abc38969e8aff64cebb892; auction 64f116fcbb8c3f319a493b7ae45475f41b76e7d9e9a78775d4869f668605361a, release 07:42 UTC. No Phase 3 gate result yet; exact next step is inspect six IDs, then verify and serial real mutations if green. Owned live worker remains serialized and this turn stays active.

- 2026-10-01T07:19:26Z: Development v4 FAILED (product inspector): optional outgoing recovery key was incorrectly mandatory; main/cancel workers refused real PCZTs (tmp/e2e/phase3-development-v4.log). Recovery txs 4463b37eab5e0cb693703f47d34b8cc5f652e9a49e3d86ed1f6f83fed4e4e55e and a88c09298daeae93a4f4609fdf146464e2a13fbf6e8ac4a8b0569db2d7ffeccd mined in wallet. Fixed inspection through official recipient/seed note-ciphertext recovery; CV/nullifier/rk/commitment checks retained, optional outgoing ciphertext still checked. Same failed PCZT now inspects 2,030,000 input / 2,000,000 output / 30,000 fee (tmp/e2e/phase3-inspector-fixed.json); build/typecheck PASS. No gate evidence. Next: fresh serialized v5 live drill; remain active through waits.

- 2026-10-01T06:33:56.160010+00:00: Development v3 FAILED (harness): pinned SDK proposal required 2,030,000 zats for five recipients versus funded 2,025,000. Exact output: tmp/e2e/report.json; full run tmp/e2e/phase3-development-v3.log. Real kill after five allocations occurred; amount-fault candidate could not be constructed, so no gate claim. Recovery 88503b9f89df6539c65cc4f825c1a55d98aa99a8591ec9b5962ba1cecc0dd755 mined in wallet. Fee reserve fixture now 30,000 from the observed requirement; bidder guard conservatively budgets 100,000 per funding transaction. K1 binds recorded result hash to the published result bytes. Fresh v4 is active at ebd8fe5: tmp/e2e/phase3-development-v4.log, deposit 77ff7662a949272758f0b3a09ff9cf7ae9fb9af210433725afd6bbe26add065b. Confirmed/frozen; release 2026-10-01T06:57:03Z, round 32678153. Turn remains active.

- 2026-10-01T06:03:23.772325+00:00: Development v2 FAILED (harness): confirmed deposits reached freeze before T_submit, and the real auction CLI refused “freeze outside confirmation buffer”. Recovery tx 0c29f52f6b3978ce32335123339bd79253324e09996368d4f1109f2a988ecf40 mined in the wallet; no gate evidence. Added required drand-round polling to T_submit; no gate assertion weakened. Full v3 is active at d3f5799 (source unchanged): tmp/e2e/phase3-development-v3.log, funding 9511c37a979bd5a0226f055ab48493921d8177e9bc38e37f93dc075c6af742b9. Frozen set exists; release 2026-10-01T06:26:12Z, round 32677536. Evidence verifier and three literal patches syntax/apply-check successfully, not live validation.

- 2026-10-01T05:58:04.235603+00:00: First development at 28585e0 failed before funding on devtool transparent-address reservation index 40 (tmp/e2e/phase3-development.log and report.json). Harness cause: all-receiver address requests. Pinned CLI has no receiver option; same pinned SDK exposes UnifiedAddressRequest::ORCHARD. Added shielded-only address generation to our SDK driver, without patching/upgrading upstream. Build/typecheck and actual bidder address generation pass; retry running at d34c78b in tmp/e2e/phase3-development-v2.log. Main funding tx 3b7966ac4b3d58aa1c54ebde7a00151ffce9e019873c72039aedf953a99d3472 broadcast; waiting for ten real confirmations before admission/settlement.

- 2026-10-01T05:55:00.310286+00:00: Added the single Phase 3 spec and live selection; build/typecheck PASS. Default regression PASS (`tmp/e2e/phase3-resume-regression.log`). Next is fresh real development run, output `tmp/e2e/phase3-development.log`, spec deadline 80 minutes; each worker has a 30-minute deadline. No evidence claim before its six IDs pass.

- 2026-10-01T05:46:27.062970+00:00: Resumed after interruption; no active owned pidfile processes. Phase 3 SDK/worker compile and typecheck; no broadcasts. Next concrete step: one settle-crash live spec, strict signer amount fault at the real checker boundary, actual crash/resume, cancel and offline drills. Keep turn active through every wait.

- 2026-10-01T05:02:58.031222+00:00: Read Phase 3 and its committed R1 after Phase 2 READY; baseline regression PASS. Pinned tool help/source shows single-recipient PCZT create; next is the minimal multi-recipient SDK driver and strict inspection, then the worker and signer checks. NU7 height now 4,465,026 (ZIP-259); primary/alternate tips 4,425,675/676 at 04:12 UTC, safely outside the 40-block window. Raw observations `tmp/phase2/nu7-tip-{primary,alternate}.json`. Waiting instruction recorded verbatim; this turn stays active.
- 2026-10-01T04:58:36.867192+00:00: Phase 2 READY FOR REVIEW. Run b834747bd297ba9708f2eec89789be0512f8f9cc; artifacts aa4676b2e0fddee20e63d2bb00fb9b724555b234; all gates, mutations and verification complete. Owned frostd stopped. Next concrete step: read Phase 3 Rulings and DESIGN §6/§14, then implement settlement J/K before crash/cancel/offline drills. Do not start UI.
- 2026-10-01T04:11:26.083256+00:00: All seven live mutation runs completed and patches reversed. Next: one clean Phase 2 evidence run, positive verification and corrupted-copy rejection.
- 2026-10-01T04:11:25.885212+00:00: N7 turned the full auction-core spec red at I1; mined refund completed, patch reversed, source unchanged. docs/evidence/phase-2/mutations/N7.patch and docs/evidence/phase-2/mutations/N7.out; full output tmp/e2e/N7-v2.log.
- 2026-10-01T03:24:41.598263+00:00: Running N7 on auction-core only, with fresh real deposits and an 80-minute monitor / 75-minute spec deadline. Output tmp/e2e/N7-v2.log. Wallet/frostd use is serialized.
- 2026-10-01T03:24:41.412402+00:00: N6 turned the full auction-core spec red at H3; mined refund completed, patch reversed, source unchanged. docs/evidence/phase-2/mutations/N6.patch and docs/evidence/phase-2/mutations/N6.out; full output tmp/e2e/N6-v2.log.
- 2026-10-01T02:37:44.249986+00:00: Running N6 on auction-core only, with fresh real deposits and an 80-minute monitor / 75-minute spec deadline. Output tmp/e2e/N6-v2.log. Wallet/frostd use is serialized.
- 2026-10-01T02:37:44.065885+00:00: N5 turned the full auction-core spec red at H2; mined refund completed, patch reversed, source unchanged. docs/evidence/phase-2/mutations/N5.patch and docs/evidence/phase-2/mutations/N5.out; full output tmp/e2e/N5-v2.log.
- 2026-10-01T01:50:54.287405+00:00: Running N5 on auction-core only, with fresh real deposits and an 80-minute monitor / 75-minute spec deadline. Output tmp/e2e/N5-v2.log. Wallet/frostd use is serialized.
- 2026-10-01T01:50:54.101720+00:00: N4 turned the full auction-core spec red at G2; mined refund completed, patch reversed, source unchanged. docs/evidence/phase-2/mutations/N4.patch and docs/evidence/phase-2/mutations/N4.out; full output tmp/e2e/N4-v2.log.
- 2026-10-01T01:04:12.042286+00:00: Running N4 on auction-core only, with fresh real deposits and an 80-minute monitor / 75-minute spec deadline. Output tmp/e2e/N4-v2.log. Wallet/frostd use is serialized.
- 2026-10-01T01:04:11.857919+00:00: N3 turned the full auction-core spec red at F2; mined refund completed, patch reversed, source unchanged. docs/evidence/phase-2/mutations/N3.patch and docs/evidence/phase-2/mutations/N3.out; full output tmp/e2e/N3-v2.log.
- 2026-10-01T00:16:51.334768+00:00: Running N3 on auction-core only, with fresh real deposits and an 80-minute monitor / 75-minute spec deadline. Output tmp/e2e/N3-v2.log. Wallet/frostd use is serialized.
- 2026-10-01T00:16:51.151901+00:00: N2 turned the full auction-core spec red at E2; mined refund completed, patch reversed, source unchanged. docs/evidence/phase-2/mutations/N2.patch and docs/evidence/phase-2/mutations/N2.out; full output tmp/e2e/N2-v2.log.
- 2026-09-30T23:29:19.156856+00:00: Running N2 on auction-core only, with fresh real deposits and an 80-minute monitor / 75-minute spec deadline. Output tmp/e2e/N2-v2.log. Wallet/frostd use is serialized.
- 2026-09-30T23:29:18.974055+00:00: N1 turned the full auction-core spec red at E1; mined refund completed, patch reversed, source unchanged. docs/evidence/phase-2/mutations/N1.patch and docs/evidence/phase-2/mutations/N1.out; full output tmp/e2e/N1-v2.log.
- 2026-09-30T22:41:46.427863+00:00: Running N1 on auction-core only, with fresh real deposits and an 80-minute monitor / 75-minute spec deadline. Output tmp/e2e/N1-v2.log. Wallet/frostd use is serialized.
- 2026-09-30T22:41:06.118447+00:00: Development v2 E1–I1 PASS and artifact verifier exit 0. Funds recovered. Running the unchanged default regression before serial live mutations; logs tmp/e2e/phase2-development-v2.log and phase2-development-v2-verify.log.
- 2026-09-30 22:02 UTC: Development v2 and continuation monitors are active under `.benzo/run/phase2-{development,overnight}-v2.pid`. N1–N7 isolated compiler checks PASS (`tmp/phase2/mutant-compile.log`), not live evidence. Next concrete step: inspect development completion; the continuation will stop on a red baseline/verifier rather than spend again. On verified success it proceeds through mutations and final evidence, records decisions/audit and sets READY FOR REVIEW. Only then start Phase 3 J/K. Each live spec owns and stops its frostd PID. Overall continuation log `tmp/e2e/phase2-overnight-v2.log`.
- 2026-09-30 21:53 UTC: Recovered the original five deposits using a fresh 2-of-3 signed PCZT, checked mining on both endpoints, and stopped frostd by owned PID. Recovery is not gate evidence.
- Failed source e5bf985/run aa5ef0f: 11 assertion IDs PASS; I1 not reached. Full log `tmp/e2e/phase2-development.log`; artifacts preserved `tmp/phase2/failed-development-artifacts`. E1 signed-mode fixture then failed before any payment at e3e6337 (`tmp/e2e/phase2-mode-before.log`); schema/core fix builds and typechecks, live after-fix validation pending.
- Next: commit verified fixes; run fresh auction-core development with an 80-minute monitor and 75-minute test deadline, log `tmp/e2e/phase2-development-v2.log`; inspect all 12 IDs before mutations. Verifier is drafted, not yet a verified positive check.

## Mutation runs

N1–N7 live mutation outputs and reversed patches are recorded under docs/evidence/phase-2/mutations/; Phase 2 production source unchanged through the final evidence run. N3 waits for actual release and hashes fresh Go-tle plaintext, deliberately breaking the sealed freeze commitment. No test data or network response is fabricated.
