# Status: build agent handoff

## Phase 3 ([PHASE-3.md](PHASE-3.md)): IN PROGRESS

Contract d0fbe61 / R1. Started only after Phase 2 READY FOR REVIEW at 28ddd09: live run b834747, artifacts aa4676b, positive verifier 0 and corrupted-copy exit 1 with ERROR E/F. Read Phase 3 in full and DESIGN §6/§14. `npm run e2e` regression PASS before new work (`tmp/e2e/phase3-baseline.log`).

Gates J/K/L/M/N: IN PROGRESS. No Phase 3 live gate evidence yet. Implemented worker, durable SQLite obligations, separate signer checks with fresh Go tle, and pre-broadcast signed-PCZT staging; integration not verified. First step: pinned-SDK multi-output PCZT creation and an inspector for signer recipient/amount/fee checks. Existing devtool `pczt create --help` accepts one address/value; its pinned `src/commands/pczt/create.rs` uses a single Payment vector. SDK driver now compiles against exactly the versions/source identities in the pinned devtool Cargo.lock; inspector checks CV/nullifier/rk/note commitments, note-ciphertext recovery, actual recipients, owned change and ZIP-317 fee. `npm run build:settle` and strict TypeScript check pass; scratch inspection of an existing real PCZT passes, not gate evidence. One new spec, e2e/settle-crash.spec.ts (J1/J2/K1/L1/M1/N1), typechecks; first live development run pending. Phase 1 specs unchanged. Live selection moves to settle-crash only for this phase; wallet/frostd remain serialized.


## Phase 2 ([PHASE-2.md](PHASE-2.md)): READY FOR REVIEW

Updated: 2026-10-01T05:02:58.031222+00:00 · Contract: 44931b4 + R1 at 0ec8c02 + R2–R4 at cc2ced0 (head@benzo.invalid). Phase 3 contract d0fbe61 read in full; work starts only after Phase 2 READY FOR REVIEW.

- **Phase 1:** PASSED, R5–R10 at 04926a7. Closed; decisions stand: binary_memo, frost_2of3, tlock-js@0.9.0. Evidence remains under `docs/evidence/phase-1/` at run 512296f / artifact commit 1a94638.
- **Current:** Phase 2 remains READY FOR REVIEW, not PASSED. Phase 3 baseline regression passed; implementing J/K first. No UI or mainnet work.
- **Verified baseline:** `npm run e2e` PASS at 0ec8c02, `tmp/e2e/phase2-baseline.log`.
- **Funds (last verified before current drill):** Recovery tx `db1b7fce58fe0bc1a9585ba39fff4284e65d7865d111f92b870408e50a9d316b` mined at 4424057 on both endpoints. Bidder 99,780,000 zats; vault 0; exact 2,500,000 returned, reserve fee 30,000. `tmp/e2e/recovery.json`, `recovery-proof.json`, `recovery.log` are development output only. Floor remains 1,540,000 zats; only one live wallet/frostd worker is active.
- **Needs user:** none.

## Questions

- Q5 (Phase 3 routing): inherited bids have random owner/settlement fields and the signed manifest has no seller destination. Current fixture design pins private bidder/seller destination copies for each signer before funding and accepts no run-time recipient override; Gate K can check PCZT recipients against those copies, but this does not prove bidder-owned settlement-envelope authentication. Please rule whether this is sufficient for Phase 3 evidence or require the encrypted envelope/manifest extension now; no such privacy/authentication claim will be made.
- Q6 (Phase 3 mutations): P2 needs a wrong-amount real PCZT at the checker boundary, since deleting a guard on an honest proposal leaves all amounts unchanged. Proposed J1 negative candidate check protects DESIGN §6 output validation; omitted amount guard is the regression; previous tests never inspect settlement proposals; the checker CLI is used by real signer sessions, with no test seam. P1 premature paid state may cause missing refunds after a pre-broadcast crash, which L1's required final-total check will reject; do not mislabel that failure as observed double payment.
- Phase 3 line budget: production is currently 459 hand-written lines; the one E2E spec and evidence verifier will exceed +600. The overage is for actual multi-output SDK glue, encrypted-note/recipient verification, durable resume, independent signer processes and the six contracted assertion IDs, not new features or tests.

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

Phase 4 UI/hosting excluded from this overnight session. Full owner-key / settlement-envelope delivery remains unresolved under Q5; current routing fixture must be declared explicitly.

## Last session

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
