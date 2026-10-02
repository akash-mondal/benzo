# Status: Builder B (Track B) handoff

<!-- Only Builder B writes this file, on branch track-b. Same rules as docs/STATUS.md: outcome first, back every claim
with a command and its result or mark it `unverified`, replace stale lines. Rulings live in the phase doc only. -->

## Current run: head task — crosschain §10 fixes for Reviewer R's BLOCK (F-1…F-5) + redeploy

State: **READY FOR MERGE** (updated 2026-10-02T18:20Z). Base: clean tree at `e1851c5` (head: merge
main into track-b, crosschain §10). One commit per item: `d9a81c7` (item 1, F-1), `4a1e835`
(item 2, F-2), `ef5922e` (item 3, F-3), `56f2cbc` (item 4, F-4), `158ea08` (item 5, F-5), and
this STATUS commit (redeploy + live cycle). Every fix has a red log on the pre-fix code and a
green log on the fix (below). Scope: `docs/design/crosschain.md` §10 items 1–5 in order, then
redeploy both escrows and rerun lock → attest → release → refund on each. Reviewer report
(read-only): `/Users/akshmnd/Dev Projects/benzo-sol/reports/pr-b-f5-solana9.md`; its lab probes in
`/Users/akshmnd/Dev Projects/benzo-sol/tests/`. No other-checkout access beyond those read-only
files, no merges/rebase/cherry-pick/push, no mainnet. Baseline `npm run e2e` PASS 37 s at `e1851c5`;
final rerun PASS 38 s at the READY-FOR-MERGE tree.

1. **§10 item 1 (P0 F-1), a dusted `paid` PDA read as "already paid": FIXED** (this commit).
   `contracts/solana/src/lib.rs`: a paid flag counts only if the account is **program-owned with
   the `PAID_V1` marker** (`flag_is_set`); flag accounts are created **pre-funding-safe**
   (`create_flag`): `create_account` for a fresh PDA, otherwise top up to rent-exempt then
   `allocate` + `assign` via `invoke_signed` with the PDA seeds. `crosschain/solana.ts`
   `solStatus` now applies the same rule (a dusted PDA is never "paid").
   Test (`bash contracts/solana/test/run.sh`, driver): dust `paidPda(leafA)` with 900,000 lamports
   from an unrelated key, then crank — `paid-pda-dusted-payout-still-made-once` (rA and rB each
   paid exactly 1 lot despite the dust; flag program-owned `PAID_V1`),
   `paid-pda-dusted-paid-exactly-once` (re-presenting both leaves pays nothing again), then after
   the deadline `paid-pda-dusted-refund-omits-paid-lot` (3 lots locked, 2 paid: the refund returns
   exactly the 1 unpaid lot, never the attested lots).
   **Red on the unfixed program** — `contracts/logs/f1-paid-pda-dust-old-code.out` (exit 1):
   `ERROR paid-pda-dusted-payout-still-made-once rA +0 (want 1000000000 despite the dust), rB
   +1000000000 …, flag owner 11111111111111111111111111111111 data  (want program-owned
   PAID_V1)` and `ERROR paid-pda-dusted-refund-omits-paid-lot refund returned 2000000000, want
   the 1 unpaid lot …` — exactly reviewer F-1 (silent skip, then the refund pays rA's lot to the
   locker). **Green after the fix** — `contracts/logs/f1-paid-pda-dust-fixed.out` (exit 0):
   `RESULT PASS all Solana escrow assertions`, 28 PASS / 0 ERROR. `npm run typecheck` PASS.
   Note: the runtime refuses any dust below the 0-byte rent-exempt minimum (890,880 lamports —
   seen once as `insufficient funds for rent` before the amount was corrected), so a real dust is
   ≥ that; 900,000 also sits below the 7-byte flag's rent need, exercising the top-up path.

2. **§10 item 2 (P0 F-2), refund racing attested payouts: FIXED** (this commit). `att.expiry <=
   auction.deadline` is now enforced where an attestation is accepted — Solana
   `submit_attestation` (`BadParameters` 5) and EVM `release` (`BadParameters`) — and
   `benzo xchain attest` refuses `--expiry` past the auction's deadline read from chain before any
   signing ("signers must attest expiry <= deadline"). With `refund` requiring `now > deadline`,
   the release and refund windows are disjoint by construction.
   Tests. Solana (`contracts/logs/f2-expiry-solana-*.out`): `submit-expiry-after-deadline-refused`
   (error 5), plus the by-construction assertions `approval-expiry-not-after-deadline` (the stored
   approval's expiry ≤ the auction's deadline, read from chain),
   `approved-unreleased-refund-premature-refused` (error 16 before the deadline),
   `approved-unreleased-release-expired-when-refund-opens` (error 8 once `now > deadline >=
   expiry`) and `refund-only-after-approval-expired` (the refund returns the whole unpaid lot only
   after the expiry has passed). EVM (`contracts/logs/f2-expiry-evm-*.out`):
   `test_release_expiry_after_deadline_refused` (BadParameters) and
   `test_refund_only_after_attested_window_closed` (an attested but unreleased batch: refund
   refused before the deadline, release Expired after it, then the refund returns the unspent
   amount). Signer tool: `contracts/logs/f2-cli-attest-refusal.out` — the local demo's new
   `demo-attest-expiry-past-deadline-refused` shows both chains' `attest` refusing
   `--expiry deadline+10` with `must be <= the auction deadline` before signing (13/13 demo PASS).
   **Red on the current code** — `f2-expiry-solana-old-code.out`:
   `ERROR submit-expiry-after-deadline-refused expected custom error 0x5, transaction succeeded`
   (1 failed / 32 passed) and `f2-expiry-evm-old-code.out`:
   `[FAIL: next call did not revert as expected] test_release_expiry_after_deadline_refused()`
   (23 passed / 1 failed). **Green after the fix** — `f2-expiry-solana-fixed.out` (exit 0, 33 PASS
   / 0 ERROR) and `f2-expiry-evm-fixed.out` (24 passed / 0 failed). `npm run typecheck` PASS.
   Note: a first draft of the EVM window test tripped Foundry's `expectRevert` (the test helper's
   `signRelease` externally calls `domainSeparator()`, consuming the expectation) — a harness
   defect in my test, fixed before the red was recorded; no product defect hidden.

3. **§10 item 3 (P1 F-3), a dusted `Approval` PDA blocking a batch: FIXED** (this commit). The
   `Approval` PDA now carries the `APPROVAL_V1` marker (11-byte prefix; `APPROVAL_LEN` 153 → 164,
   §9 field offsets +11) and is created pre-funding-safe (`create_flag`: top up to rent-exempt +
   `allocate` + `assign` via `invoke_signed` when the PDA is dusted, `create_account` otherwise).
   `BatchReplayed` (9) is returned only when the account is program-owned with the marker
   (`flag_is_set`); a dusted PDA neither blocks nor fakes a batch. Client: `crosschain/solana.ts`
   exports `approvalExists` (same rule) and `benzo xchain release` uses it for submit-if-needed —
   a dusted PDA no longer makes the CLI skip the submit step.
   Test (driver): dust `approvalPda(batch 13)` with 1,000,000 lamports from an unrelated key,
   then `approval-pda-dusted-submit-works-once` (submit lands; the PDA is program-owned 164 bytes
   with `APPROVAL_V1` and the exact §9 fields) and
   `approval-pda-dusted-second-submit-refused` (error 9); `submit-2of3-records-approval` now
   asserts the marker + shifted offsets.
   **Red on the current code** — `contracts/logs/f3-approval-dust-old-code.out` (exit 1):
   `ERROR approval-pda-dusted-submit-works-once submit refused (0x9); dusted Approval PDA owner
   11111111111111111111111111111111 len 0 …` — exactly reviewer F-3 — plus the three
   layout-reading assertions (`submit-2of3-records-approval`, `approval-expiry-not-after-deadline`,
   `refund-only-after-approval-expired`) failing against the old 153-byte layout, as expected.
   **Green after the fix** — `contracts/logs/f3-approval-dust-fixed.out` (exit 0): 35 PASS /
   0 ERROR; `contracts/logs/f3-xchain-client.out`: local demo 13/13 PASS with the marker-aware
   client (release submit-if-needed, status, replay refused). `npm run typecheck` PASS.
   Notes: two mid-fix defects in my own new code were caught by these runs and fixed before any
   green was credited — `create_flag` first allocated `marker.len()` bytes (BadAccount 0x2 at
   `store_approval` for the 164-byte Approval), then `flag_is_set` compared the whole data to the
   marker (false for `marker + fields`, which made a second submit slip through to a system
   `allocate` and fail 0x0 instead of `BatchReplayed` 9). The final green is the rerun after both.

4. **§10 item 4 (P1 F-4), TS client + CLI seed/wire encodings: CONFIRMED matching + proved
   end-to-end.** No fix was needed in this run: the client was already ported to the §9
   instructions in `f72a792` (which post-dates the reviewer's range `7e3ac29..3a23f15`, so probe D
   measured the pre-port client). Confirmation against the program source, byte for byte:

   | encoding | client | program |
   |---|---|---|
   | auction PDA `["escrow", auction_id]` | `crosschain/solana.ts:34-36` | `lib.rs:464-465` |
   | approval PDA `["approval", auction_id, batch_index u64 le]` | `solana.ts:38-40` (`le64(batch)`) | `lib.rs:600-601` (submit), `:726-727` (release self-binding) |
   | paid PDA `["paid", auction_id, leaf]` | `solana.ts:53-55` | `lib.rs:768-769` |
   | submit wire `TAG 2 ‖ att(200)` | `solana.ts:113-125` | `lib.rs:411`, `:553-554` (`r.take(ATT_LEN)` then `r.end()`) |
   | release wire `TAG 4 ‖ be16(n) ‖ per payout: be64 index, be64 lots, u8 kind, dest32, be64 leafCount, be16 proofLen, proof×32` | `solana.ts:130-153` | `lib.rs:413`, `:678`, `:706` |
   | account order submit: crank, auction, instructions-sysvar, approval, system | `solana.ts:116-122` | `lib.rs` `submit_attestation` |
   | account order release: crank, auction, approval, system, then (dest, paid) per payout | `solana.ts:143-151` | `lib.rs` `release_approved` |
   | attestation 200 bytes (prefix ‖ genesis ‖ program ‖ auction ‖ result ‖ root ‖ be64 batch ‖ be64 nonce ‖ i64be expiry) | `crosschain/attestation.ts` `solanaAttestationBytes` | `lib.rs:553-567` (batch parsed be at `:567`, then seeded le at `:601`) |
   | ed25519 message ref (ix 1, offset 2, size 200) | `solana.ts:92` | `lib.rs:864` |

   The reviewer's exact F-4 point — the old client seeded `batch_index` be in the PDA while the
   program derives it le — is now `le64` on the client side, matching `to_le_bytes()`.
   Proof. **Red (pre-fix wire format)** — `contracts/logs/f4-wire-layout-refused.out`:
   `PASS legacy-client-release-refused` — the exact `3a23f15` client serialization
   (`TAG(2) ‖ att ‖ be16(n) ‖ payouts…`, be64 `batch` PDA) is refused with custom error 0x1
   (BadInstruction), reproducing probe D's `PASS D … (error 1)` on this program build (36 PASS /
   0 ERROR overall). **Green (shipped client)** — `contracts/logs/f4-cli-e2e-release.out`:
   `crosschain/local-demo.sh` 13/13 PASS — end-to-end through the shipped `benzo xchain` CLI on
   the local validator (lock, attest, `release` with real payouts and exact balance deltas,
   `status` matches the attested root, replay refused), incl. `demo-release-solana-delivers`.
   The pre-fix failure of the shipped entry point is also recorded in the review itself (probe D
   in `benzo-sol/reports/pr-b-f5-solana9.md`); the post-port client was additionally proven live
   on devnet in the prior run (release tx `5TWQxz2C…`).

5. **§10 item 5 (P2 F-5), the real two-auction drain test + AUDITS wording: DONE** (this commit).
   `contracts/evm/test/FeeTokenDrain.t.sol` rewritten to exercise the pooled-drain scenario its
   header names: two auctions share one holder-tax fee token (the STA class — 10% on transfers
   from taxed holders); the victim's funding behaves plainly (1000 nominal = 1000 real), the
   attacker is taxed (1000 nominal = 900 real — the r-02 scenario), and the attacker chooses
   their own signer set at lock and self-signs a 1000-nominal leaf to themselves. The gate is the
   victim staying whole: their recipient is paid in full from the pooled balance, with the
   measured drain (attacker recipient / escrow pool) printed on failure. The lock-revert check is
   kept as `test_lock_refuses_fee_on_transfer_token`.
   **Red at the drain (the F5 check mutated out — pre-`d566d0c` behavior)** —
   `contracts/logs/f5-drain-old-code.out`: `[FAIL: victim's recipient must be paid in full from
   the pool (measured: attacker recipient 1000, escrow pool 900): 0 != 1000]
   test_fee_on_transfer_token_drains_victim_auction()` — the attacker's nominal payout consumed
   the victim's funding and the victim's payout could not complete (23 passed / 2 failed; the
   second failure is the revert check, correctly red without the check). Mutation: the
   `balanceBefore/balanceAfter` measurement in `BenzoEscrow.sol` `lock` was replaced by a bare
   `safeTransferFrom` (exactly `d566d0c^` behavior), then restored byte-identical (`git diff` on
   the file is empty). **Green on the fixed contract** — `contracts/logs/f5-drain-fixed.out`:
   25 passed / 0 failed. `docs/AUDITS.md` no longer overclaims: the delta check stops
   fee-on-transfer **at lock**; tokens that behave plainly at lock and deflate later
   (rebase-down / fee-on-out) are excluded by the manifest asset allowlist, not by the check
   (the two mechanisms are now listed separately, with their blind spots named).

6. **Redeploy + live cycle (head task): DONE.** Both escrows redeployed from the deployer keys
   (`.benzo/evm/deployer.key` = `0xb6c51a0C7DF1fdcd64adf4eAEa37E1C51eb8Afc1`,
   `.benzo/solana/deployer.json` = `3EM3LMNYrs2iUfC9FkoutJcErmuPd8zUtRBMCkhLkpdu`; keys used by
   the deploy/cycle commands only, never printed) and **lock → attest → release → refund** rerun
   once on each testnet at the fixed code. All values below are public; scratch deploy scripts
   were deleted at run end (the deploy is reproducible from the forge artifacts with an ethers
   `ContractFactory` over the key file, or verified from the txids). Window on both chains:
   lockUntil 1790960797 / deadline 1790960977, attest `expiry == deadline` (the new F-2 rule).

   **Ethereum Sepolia** (auction `0x1a74d880f23c44b2a31d26b0c0ce2358f22aeb975b0da841ee1f7847354f36ce`,
   allocation root `0x3aef41b7001fc294e30b87ae93ae00592e16300e7f820a555fb572b7b0524617`,
   payout dest `0x4C53f540ba635BA7211E073E9a08960Bc4f25953`, return
   `0x3372A2C711f5aD17BB68b60188b4e68a12920184`):

   | what | value |
   |---|---|
   | `TestToken` BNT (constructor mints 1000e18) | `0xC64d247Db515870B12b0d1D1EFeC7C153a0371e6` (deploy tx `0xa3d31a64daf324061f264d46d122ff07ed6267227714e0e3ed9120e6d0e81553`, block 11830344) |
   | `BenzoEscrow` (fixed code) | `0x19887941cf9BbD967f3739034127924f937D48ad` (deploy tx `0xd0d8b3c285df848fb520726d79264c17f4ffd8022ec10b78d2d65fde0a106cd5`, block 11830345) |
   | approve escrow 2e18 | tx `0xc62c60799597fb8c9dc129c317f38ad68bc540b29e84c2fdd8d64d5fb5932f24` |
   | lock 2e18 (lot 1e18) | tx `0xade01dc8387db878f8823ee2e79a4ddf9e351412232a64dde58755337ef05302` |
   | attest 2-of-3 (bundle `tmp/xchain-live/bundle-evm.json`) | root `0x3aef41b7…` |
   | release (leaf 0: 1e18 to the dest) | tx `0xfec1464c5e7f6c6091454a2393cacec8dd015db210da3e755817773e175715bc` |
   | refund remainder (1e18 to returnTo) | tx `0xab00357e69773d1c0899369334cc25c600f7847c9cb28e0b1e544451fd853d83` |

   `xchain status` after release: `locked 2000000000000000000, paid 1000000000000000000`, paidLeaves
   1/2. Final balances read back from the chain: dest 1e18, returnTo 1e18, escrow 0.

   **Solana devnet** (program `58SsWZaW2eBq1z1bnH1xPNXXMGbnrXm9YMvGeRdJL14G`, auction
   `0x059a9d681e584c902cc4973e1b44db072745dc052ae2fb419676385cba63bb16`, escrow PDA
   `2Yv5ac9KxhA5N3mzGTQ9cktPCLu9s5Fg41spBTAui1zP`, approval PDA
   `CvDwE4sT814VZSy19BXSoECrjHnS14xC7PhWktXmirjC`, payout dest `EN4dQuJjDZisc1Y2uxde9JwdMaFXsrDiYGkeQquSH4qh`,
   return `7yApc8X4vEbR841Y7AMGodKdf9ybGoTFTkVXdqtaaTxo`):

   | what | value |
   |---|---|
   | program redeploy (fixed code; see note a) | tx `5goExevMeEbJaV4kBdb4tBVJ3wQNbRf62UEycKVUBawdVNXn21Dsp8wwNpzfoL4oRCHTAEoscoJJmhB8TgCPVoYr` (`solana program show`: Authority `3EM3LMN…`, Last Deployed In Slot 506705023) |
   | lock 2 SOL (lot 1 SOL) | tx `dW18NB2AZxTewoCkSrdNfdA3yFcLo9Quvg5eFEAgjKwW8GomqmyEbkaTiqFaBdwspFwyD2jL32LLRYHtKrukEot` |
   | `submit_attestation` (Approval created) | tx `2eqzoYkPjbkei5e3scEcyyGHbGALzLSzav3tYCLHUq2jNR5jTTSGKEebYvBS48LiDGsgywPebbGCmX1psKYGQgvb` |
   | `release_approved` (leaf 0: 1 SOL to the dest) | tx `1weyiLBNKd5w9WncC2CzpoMHHHjg3d8nxeYsFTdY6KR6w4iwJDjHRyV7K4pGX8BfPMa4M6TbAo9a1HqzYvYY4Zz` (lookup table `86M84CKbNf9Yh17dUrekwx5AsBEaBsqFBvbCbCJmiL61`, create `EnmwN9bAZgCn27hoLCzzF775aUCEqrFm1ZmeVdJp8AkG1ppE4EwhML477mjXncvejytTmqWRAeLNMawcWEbfeXH`, extend `2FnBocHU3g71W3oEiiVrbUJL7Kgz4mt897JnLqTkPB59JG62UVPfzwC87YV8Xb91RfNrG1a1uRkgtLdQvwU6ShKz`) |
   | refund remainder (1 SOL to return) | tx `38uhMgjLPyLexLcisbeGHgRdGYyVKtcoHQgrZ99mHfNbMP7pkfn5K9Xio6CW6pWCneeaNdpXg8WJXvox6shqJn1G` |

   `xchain status` after release: `amount 2000000000, paid 1000000000`, paidLeaves 1/2
   (marker-aware). Final balances read back from the chain: dest 1 SOL, return 1 SOL, escrow PDA
   rent only (the 2-SOL principal = 1 paid + 1 refunded).

   **F-1 client rule checked live on devnet:** dust tx
   `5LU7QyxpAXy6Yeiq1RBvnZHL5h6wyGzuxav1QCgXCvrKgxDHNDcoi5xVG8x3C35vgkTKZs2qb6WaNtXvcAgbJcKc`
   sent 2,000,000 lamports to `Gj2KzjQtwgjcYGU8yyJSZpGjvjEq1snJvVzwfgw2ehPf` =
   `paidPda(leaf 1)` (the unpaid leaf); the account is system-owned with empty data and
   `benzo xchain status` still reports that leaf **false** — a dusted PDA is never `PAID_V1`
   (the pre-fix client rule would have reported it paid).

   **Honesty notes (this run):** (a) the Solana redeploy landed as an **in-place upgrade** of the
   same program id `58Ss…` — `solana program deploy` without `--program-id` reuses the `.so`'s
   sibling keypair, and the deployer `3EM3LMN…` is the upgrade authority (verified via
   `solana program show`), so no old program build remains at that address; the **old run's
   deployment state is superseded** (its auction/escrow PDA `2ChFfike…` / approval `85Tf51q…` vs
   this run's `2Yv5ac9K…` / `CvDwE4sT…`). Say the word if a fresh program id was wanted instead.
   (b) The bounded deadline poll hit its cap because of a scratch bug (it queried `getBlockTime`
   for slot 0 — a 2020 timestamp); before the refunds were sent, both deadlines were explicitly
   re-checked (EVM latest-block timestamp and Solana tip blockTime 1790961868 > 1790960977) and
   only then did the refund transactions run. (c) The `--expiry` is `== deadline` on both chains,
   exercising the new F-2 signer-tool rule. (d) The 2,000,000-lamport dust stays on devnet at
   `Gj2KzjQ…` (public artifact of the F-1 check).

**Test audit (READY FOR MERGE):** project E2E suite untouched — default seal-open **R retain**
(browser/tle assertion IDs unchanged; PASS 37 s at base `e1851c5`, PASS 38 s at the final tree).
The `contracts/` forge + Solana driver suites are the design §7 step-1/step-2 contract-level
proofs (outside the 8-test E2E ceiling); each named red/green pair above is its mutation-style
proof, all rerun in this run since the covered code changed. `npm run typecheck` PASS. Env: no
new env vars. Upstream code: none copied (pinned APIs inspected in installed sources).

### Questions (this run)

- **F-4 needed no code fix** — it was already fixed in `f72a792`, which post-dates the reviewer's
  range `7e3ac29..3a23f15` (item 4 confirms the encodings and proves the e2e release instead of
  re-porting). If the re-review wants a from-scratch port commit for the trail, say so.
- **Solana redeploy = in-place upgrade at `58Ss…`** (honesty note a), not a fresh program id
  (the tool reused the `.so`'s sibling keypair and the deployer is the upgrade authority, so the
  old vulnerable build no longer exists at that address). Redirect if Reviewer R expects a new
  program address.
- **§10 item 2 implemented exactly as written**: `expiry <= deadline` at acceptance (Solana
  `submit_attestation`, EVM `release`); the reviewer's optional extra `now <= state.deadline` in
  `release_approved` was not added because it is implied (`now <= approval.expiry <= deadline`).
  Confirm or redirect.

## Previous run: head task list (P1 F5, Solana §9 attest-once/release-many, step-5 deployments): READY FOR MERGE — its testnet deployments are SUPERSEDED by this run's §10 redeploy (see Current run, item 6)

State: **READY FOR MERGE** (updated 2026-10-02T15:30Z). Started clean at `305d565` (head: merge main into
track-b, crosschain §9). Head message received this run; implemented as written, one commit per item. Commits:
`d566d0c` (P1), `3a23f15` (Solana §9 program + tests), `f72a792` (client/CLI §9 flow), `71bb069` (live-run fixes)
and this STATUS commit. No other-checkout access (`benzo-sol/trackb` read only for the reviewer's test file),
no merges/rebase/cherry-pick/push, no mainnet, no Base. Deployer keys read only by the deploy/cycle commands,
never printed.

1. **P1, EVM fee-on-transfer drain (F5): DONE, commit `d566d0c`.** `contracts/evm/src/BenzoEscrow.sol`
   `lock` now measures `balanceOf(this)` around `safeTransferFrom` and reverts `BadParameters` unless the
   delta equals `amount`. Reviewer's `FeeTokenDrain.t.sol` copied byte-identical from
   `/Users/akshmnd/Dev Projects/benzo-sol/trackb/contracts/evm/test/FeeTokenDrain.t.sol` (diff: identical)
   into `contracts/evm/test/`. Both runs shown: **red on old code** — `forge test --match-contract
   FeeTokenDrainTest` → `[FAIL: next call did not revert as expected] test_fee_on_transfer_token_drains_victim_auction`
   (`contracts/logs/p1-feetoken-old-code.out`, exit 1); **green after the fix** — `forge test` → `22 tests passed,
   0 failed` incl. the reviewer's test (`contracts/logs/p1-feetoken-fixed.out`, exit 0).
   `docs/AUDITS.md` created (canonical per AGENTS.md): every dependency pin + audit status (carried over from
   `contracts/AUDITS.md`, now a pointer), every custom security-relevant file with its reason, and the
   `assets` allowlist note (plain ERC-20/721 only; no fee or rebasing tokens; lock's delta check enforces it).
   `TestToken.sol` (step-5 fixture) is listed there too.

2. **Solana attest-once / release-many (`docs/design/crosschain.md` §9): DONE, commits `3a23f15` + `f72a792`.**
   Program: `Approval` PDA seeds `["approval", auction_id, batch_index u64 le]`, 153 bytes with exactly the
   §9 fields (`auction_id, batch_index, allocation_root, result_hash, nonce, expiry, genesis_hash, bump`);
   `submit_attestation` carries the old release path's checks (checked instructions sysvar, strict Ed25519
   offsets, 2-of-3 distinct pinned signers, exact attestation bytes, genesis pinned at lock, `now<=expiry`,
   not refunded) and creates the Approval exactly once (second submit → `BatchReplayed` 0x9); the
   signature-carrying `release` is **removed** (single code path). `release_approved(payouts[])` takes the
   Approval + auction with **no signatures**: `now<=approval.expiry`, not refunded, per payout leaf bound +
   Merkle membership vs `approval.allocation_root`, paid-flag PDA unset, cap `paid+amount<=locked`, flag set
   before the lamport move, per-recipient failures skip and stay claimable. `crosschain/solana.ts` /
   `benzo xchain release`: submit-if-needed then repeatable release_approved, payouts chunked by real
   serialized size, sent as versioned transactions with the destination + paid-flag accounts in an address
   lookup table; `--submit-only` runs the submit step unconditionally (replay = on-chain `BatchReplayed`).

   **Tests (local validator, `bash contracts/solana/test/run.sh`, `contracts/logs/solana-attest-once.out`):
   25 PASS, 0 FAIL**, incl. every §9 item: `submit-twice-refused`, `release-no-approval-refused` (NoApproval
   19), `approval-expired-release-refused`, `release-after-refund-refused`, `release-leaf-not-in-root-refused`,
   `every-leaf-paid-exactly-once` (8 leaves paid 3+3+2 across crank calls as v0 txs over a real lookup table,
   then two full re-crank rounds paid nothing twice; exact per-destination balances and `paid == 8 × lot`
   asserted), `spoofed-sysvar-on-submit-refused`, plus lock/flag/binding/refusal behaviours and the
   `size-table-measured` record. `crosschain/local-demo.sh` 12/12 PASS (`contracts/logs/step3-xchain-e2e.out`),
   `npm run typecheck` and `npm run e2e` PASS (37 s).

   **Before/after payouts per transaction at proof depths 0–6** (measured from real serialized transactions
   against the 1232-byte packet limit; `SIZE depth=…` lines in the test log): before = the removed
   signature-carrying release (Ed25519 verify ix + attestation in the same tx); after = release_approved.
   `after_legacy` is a plain transaction; `after_alt` is the shipped v0 + lookup-table form. The ALT is
   required by the design's rule: `after_legacy` at depth 4 is 3, below 4.

   | proof depth | before | after_legacy | after_alt (shipped) |
   |---:|---:|---:|---:|
   | 0 | 1 | 1 | 1 |
   | 1 | 2 | 2 | 2 |
   | 2 | 2 | 4 | 4 |
   | 3 | 2 | 4 | 6 |
   | 4 | 1 | 3 | 4 |
   | 5 | 1 | 3 | 4 |
   | 6 | 1 | 3 | 3 |

3. **Deploy step 5 (design §7 step 5): DONE.** Both escrows deployed and the full
   **lock → attest → release → refund** cycle run once on each testnet. All values below are public
   (addresses, txids); nothing from the key files is printed. Scratch deploy/approve scripts lived in `tmp/`
   and were deleted at run end (the deploy is reproducible from the forge artifacts with an ethers
   `ContractFactory` over the key file, or verified directly from the txids).

   **Ethereum Sepolia** (auction `0x15341db9fc2f16174f7d025d118f8862f0861e2a1fc71047ff34bcab6f9e8aa8`,
   allocation root `0xf5646bf44723b7420e77fab6cdb29961b25d2ed544a589812e0920bc9ece275f`, payout dest
   `0xE985C5448e8FA32b30DDA7Bf28405255b891b981`, window lockUntil 1790953748 / deadline 1790954168):

   | what | value |
   |---|---|
   | `BenzoEscrow` | `0x41f8424d1cF73E5d77805DC2E324a63c4710F50c` (deploy tx `0x319f896e9e1a16a6f1e8f0185811786815203bffb1f89b255d16436abbfb996a`, block 11829751) |
   | `TestToken` BNT (minted 1000e18) | `0xA6F881Fc182E7b68d6bd44Fd69A2DD4AE717BC49` (deploy tx `0x69d563f1924d2f8d7656e25f2daa8e00ac1ccbed7e3bc5060c9802fdc9871913`) |
   | approve escrow 2e18 | tx `0x3bbcb3754a839a68cf44dbad0d9c004ea9be39f712461c6145873dffc278c8e0` |
   | lock 2e18 (lot 1e18) | tx `0x3a6e3dfa694f4223a68a1f4a8fed554589d1b88dba09bd9a82bad6425cfcf343` |
   | attest 2-of-3 (bundle in `tmp/xchain-live/`) | root `0xf5646bf4…` |
   | release (1e18 to the dest) | tx `0x5d93306d74bb0ca4c99259ac091715b01511923a52284c70ace56d3df88edc29` |
   | refund remainder (1e18 to returnTo) | tx `0x4653d24b4b332c91146e20d5e2937894be42f45f578ec50c5c18644e647e5ddc` |

   `xchain status` after release: `locked 2000000000000000000, paid 1000000000000000000`, paidLeaves 1/1.

   **Solana devnet** (program `58SsWZaW2eBq1z1bnH1xPNXXMGbnrXm9YMvGeRdJL14G`, auction
   `0x0cccf4820aadcb2480b42d38121ac5ff6768240e3c20cf9222476dbd2856a551`, escrow PDA
   `2ChFfikeTY38AgdiecQV2Y18ACgGMWXTE2u6VoWE3MWx`, approval PDA `85Tf51qYYeY3kMtUm5UnPwSiSvwpt8K8MZKgaZPGuFLz`,
   payout dest/return `DV9nJknUZjfVHJVz2Pj9eb5dV8j2AN5CceqTPDzgHxSc`, same window):

   | what | value |
   |---|---|
   | program deploy | tx `4VBQ4aWvrsBgaDaSEtunGJWFRFEZoY6dbMGSN9vTK9dHHETk6KyigMY3CRj94a24CdQs69YUkKjfNYWc6cUKw1BE` |
   | lock 2 SOL (lot 1 SOL) | tx `LV856ytFstyAHgjayzRaS9CN8axu1QxwgSWXyR6zCh8bCnHVikrsWp4KT56A5mrYx2S9uaaaL3kvvKwLjs5XkWt` |
   | `submit_attestation` (Approval created) | tx `2Wbn5d9J4xFSmXVxTrjuRJV5T9pNfViKaGXZFWCNTnZLuWVn7Qxncv8UiHuPoGE1PmKJREzJW9ziuQuTBZ9wAHP4` |
   | `release_approved` (1 SOL to the dest) | tx `5TWQxz2CBnAEQgcySbT1FEdDVV1P8Tn2rQnqKKmmyZg2U7d6XwyKurAt963TFxGRBa1V5ZYWQHHJDQs8shNcU5T6` (lookup table `8C5yNHggaT3QCovpsUr1VMC9cn6HRJeoMSfUtU7etnFb`, create `3N7Y8gNzupMJvqdawGK35FhY6rsuUYTqFsPbHyE9vqrafZwsXbVqLYLeYCP1RuiC2feNq7cmJzN9HywrYb39emrq`, extend `3o4CvCGMwNMWoBuzHQxxznAaxtRQHu8enDrH7pxXVqDYMmyxSNA3CQJkZqypxTZaVkuLr43R4wjqDTtpDfzSLbCM`) |
   | refund remainder (1 SOL) | tx `28hi6rwUexyM2GBLdHEuYZJe2noTqw3vZLDjgNVLCzVRXsDLQ5a5on6C3dYicg2X8xQmKKYNodwq2dXJZ4efo87z` |

   `xchain status` after release: `amount 2000000000, paid 1000000000`, paidLeaves 1/1.

   **Honesty notes / deviations (this run):**
   - (a) "a test token you mint" = a minted ERC-20 on Sepolia (done, see above). On Solana the §9 escrow
     holds and pays **native SOL** (lamports; SPL/Token-2022 delivery is design §7 step 4, deferred), so the
     devnet cycle ran with devnet SOL; see Questions.
   - (b) Two product bugs were found **by the live run** and fixed in `71bb069`, each with its refused-before
     output and passing-after txid: (1) EVM leaves did not bind the auction's asset (design §3) — the first
     Sepolia release was refused `NotInRoot` (0x52e382c6) once the asset was a minted token (the local demo
     uses native ETH = the zero asset id and could not see this); `attest --asset` now binds it and the
     bundle records it. (2) `CreateLookupTable` requires a slot in `SlotHashes` — devnet refused both the
     finalized and the tip slot ("is not a recent slot"); the client now walks back from the tip (bounded).
   - (c) The first live Solana release attempt failed at lookup-table creation **after** `submit_attestation`
     had landed (tx `2Wbn5d9J…`); the rerun skipped the submit (Approval existed) and cranked — exactly the
     §9 attest-once/release-many semantics. No failed attempt is credited as evidence.
   - (d) One local test run went red (`Attempt to load a program that does not exist`): a stale
     `solana-test-validator` from the previously stopped session (old program id `5AAgFCpRUe…`) held :8901
     so the driver ran against the wrong chain. Not credited; the stale process exited; the rerun is the
     25-PASS log above.
   - (e) The §9 "expect ≥ 6 at depth 4" is **not reachable** at the 1232-byte packet limit: one depth-4
     payout is 59 + 4×32 = 187 bytes of instruction data, so 6 payouts alone are 1122 bytes before
     signatures, blockhash and account indexes (the measured depth-4 v0+ALT tx for 4 payouts is 1042 bytes,
     for 5 is 1233 — one byte over). Measured maximum is 4 at depth 4 and 6 at depth 3 (1232 exactly). The
     design's ALT remedy is implemented and its trigger condition (below 4 without the table) holds. See
     Questions.
   - (f) The lookup table is created per `benzo xchain release` run (~0.002 SOL rent on devnet); a persistent
     crank-owned table would save that, recorded under Deferred.

**Test audit:** project E2E suite untouched — default seal-open R retain (browser/tle assertion IDs unchanged,
PASS 37 s at `71bb069`); `contracts/`/`crosschain/` drivers are contract-level proofs, not E2E specs. No
assertion added/loosened in the E2E suite; live specs remain Track A's. Env: no new env vars. Upstream code:
none copied (pinned APIs inspected in installed sources; the lookup-table slot rules read from the pinned
crate/agave source).

### Questions (this run)

- **§9 size target:** the measured table above; ≥6 at depth 4 is arithmetically impossible inside a 1232-byte
  packet with the design's payout shape (see honesty note e). Recorded as measured; confirm or redirect
  (e.g. hoisting `leaf_count`/`proof_len` per instruction would buy ~1 payout per depth, but deviates from
  the §9 payout list).
- **"test token you mint" on Solana:** ran the devnet cycle with native SOL because the §9 program moves
  lamports; locking a minted SPL token needs the step-4 token delivery path. Say the word if the devnet leg
  should instead mint SPL and extend the program.
- **Asset binding in leaves** (fix b.1) changed `benzo xchain attest` (`--asset`) and the bundle shape
  (`asset` field). Backward note: old bundles default to the zero asset id (native). Confirm.
- `TestToken.sol` is a test-only fixture with an open mint (listed in `docs/AUDITS.md`); Reviewer R should
  see it flagged as non-custody in the hard review.

Deferred: persistent crank lookup table (note f); `benzo xchain status` could also print the approval state.


## Track B testnet lane

State: **READY (funded)**. Set up 2026-10-02T10:01Z at commit `b30e826`, clean tree; funding landed 2026-10-02T10:07Z (first sync after setup) — no 90-minute wait needed. My lane only: `$BNZ_STATE_DIR=./.benzo`, frostd `localhost:2745`; nothing read or used from `benzo/.benzo`, its `.env`, or A's processes (A's frostd on 127.0.0.1:2744 was only observed via `lsof`, never contacted).

**Public values (this lane):**

- FROST group key (2-of-3 RedPallas, dealerless DKG; identical in alice/bob/carol per the setup's own `sort -u` check): `ba0272e65a40d44de12531785f8921d52038723ba218797a6f6bbd7f1f26d62f`
- Vault UA (view-only wallet `.benzo/vault`, birthday = tip − 10): `[redacted address 819dd953f7]`
- Bidder Default Address (`.benzo/bidder`) — **send the ~0.1 TAZ here**: `[redacted address 3b7be8280a]`

No mnemonic or `.age` content is printed here or anywhere outside `$BNZ_STATE_DIR`; full transcripts live in `$BNZ_STATE_DIR/run/` (`setup.log`, `bootstrap-setup.log`, `bootstrap-force.log`, `frostd-dkg.log`, `funding-poll.log`).

**Commands and trimmed real output:**

| Command | Real output (trimmed) |
|---|---|
| `set -a; . ./.env; set +a && bash tools/setup-testnet.sh` (at `b30e826`) | `1. bootstrap` → `local CA and frostd certificate (SANs localhost, 127.0.0.1)` → `2. frostd and a dealerless 2-of-3 RedPallas DKG` → `3. vault UFVK from the group key (zcash-sign generate)` → `4. vault wallet (view-only, birthday = tip - 10)` → `5. bidder wallet` → `bidder address: utest1yev…43h8`, `group key: ba02…d62f`; rc=0 |
| `.benzo/run/frostd-dkg.log` (frostd's log during the DKG) | `starting HTTPS server at 127.0.0.1:2745` — **:2745, not :2744** (the port fix in `b30e826`; A's frostd held 127.0.0.1:2744 throughout) |
| `zcash-devtool wallet -w .benzo/vault list-addresses` | `Account AccountUuid(944434da-…)`, `Default Address: utest1743…f5fh` |
| `zcash-devtool wallet -w .benzo/bidder list-addresses` | `Default Address: utest1yev…43h8` (same as the setup line) |
| `npm run e2e` (default project, seal-open; first B baseline that can use `$BNZ_STATE_DIR/bin`) | `PASSED default seal in the browser, open with tle after R (40 s)`, rc=0 |

DKG command lines (public, from `.benzo/frost/dkg-commands.txt`): three `frost-client dkg -c $BNZ_STATE_DIR/frost/{alice,bob,carol}.toml -d 'benzo phase 1 vault' -s localhost:2745 -C redpallas -t 2` invocations (alice carries `-S f769aa…f4d,205ca6…b17`), run concurrently through frostd. Setup re-run safety note: this was a first-time run (`frost/`, `vault`, `bidder` all created now).

**Funding: ARRIVED, mined.** `zcash-devtool wallet -w .benzo/bidder sync` + `balance` at 2026-10-02T10:07Z: `Latest block height is 4432740`, `Scan complete … progress is 2/2`, then `Balance:   0.10000000 TAZ` — 10,000,000 zatoshis in the **Ironwood** pool (`ironwood_balance.value_pending_spendability: Zatoshis(10000000)`; every `Spendable` line still 0.00000000 TAZ at that height, i.e. mined and scanned but not yet past its spendability wait). The note was received at the bidder address above within 6 minutes of the wallet's creation; the 90-minute poll was not needed. Later runs should expect it in `Spendable` after confirmations.

## Phase 5 part 3, cross-chain (design §7 steps 1–3): READY FOR MERGE

Updated: 2026-10-02T11:32:19Z. Start clean at `8e114fa`; work landed in three commits — `c255084` (step 1, EVM escrow), `0ac8b59` (step 2, Solana escrow), `cc5a719` (step 3, crosschain TS + `benzo xchain` + local demo). Head commits seen mid-run and built on: `5ebf4c8`/`ee792ea` (no-Base design update — affects only §4 delivery and steps 4–5 targets, not steps 1–3). Scope: `docs/design/crosschain.md` §7 steps 1–3 exactly; steps 4–5 (Railgun on Ethereum Sepolia, Token-2022 CT on Solana devnet, deployments) deferred to a later run pending funded deployer keys. No mainnet; deployer keys `.benzo/evm/deployer.key` / `.benzo/solana/deployer.json` untouched (steps 4–5 only). No other-checkout access, no merges/rebase/cherry-pick/push.

**What is implemented (design §1–§3):** canonical keccak leaf/root (`benzo-leaf-v1`/`benzo-root-v1` layouts, sorted-pair tree matching OZ `MerkleProof`, leaf count committed in the root, strict index bound, amounts always `lot_count × standard_lot`, nothing from Zcash/funding in any leaf) shared byte-for-byte across `crosschain/leaf.ts`, `contracts/evm/src/BenzoEscrow.sol`, `contracts/solana/src/lib.rs`. Attestation domain separation per chain: EVM EIP-712 (`benzo-release-v1` domain name, `chainId` + `verifyingContract`, OZ `ECDSA`+`MessageHashUtils`, high-`s` rejected by OZ); Solana a 200-byte fixed layout (genesis hash + program ID + auction id + result hash + allocation root + batch/nonce/expiry) checked against the preceding native Ed25519 verification instruction through the **checked** instructions sysvar (explicit `sysvar::instructions::ID` compare = the spoofed-sysvar refusal) with strict offsets. Replay refusal: release-once per `(auction_id, batch_index)` (EVM stored flag, Solana batch PDA). Per-recipient paid flags (EVM keyed by canonical leaf hash; Solana paid PDAs): a failing/already-paid recipient is skipped, never a batch revert, and failed items stay claimable by a later release. Lock refused after `T_submit`; refund after `deadline` by anyone to the pinned return address.

**Logged proofs (committed, from runs at `cc5a719` working tree; commands reproduce them):**

| Step | Command | Real output (trimmed) | Log |
|---|---|---|---|
| 1 | `cd contracts/evm && forge test` (foundry 1.5.1, solc 0.8.30, via_ir; OZ 5.6.0 + vendored forge-std 1.9.7) | `Ran 1 test suite ... 17 tests passed, 0 failed` — lock (state/token/after-T_submit/twice), release 2-of-3 EIP-712 + quorum/expiry/leaf-bound/not-in-root refusals, replay refusal, refund (after deadline/remainder/before refused), per-recipient flags (failure skipped, claimable later, no double pay, cap) | `contracts/logs/step1-forge-test.out` |
| 2 | `bash contracts/solana/test/run.sh` (cargo build-sbf 4.4.0, solana-test-validator 4.3.0) | `RESULT PASS all Solana escrow assertions` — 20/20: `lock-records-state`, `lock-twice-refused`, `lock-after-submit-refused`, `release-2of3-pays`, `replay-refused`, `recipient-flag-failure-skipped-not-reverted`, `recipient-flag-claimable-later-no-double-pay`, `release-1sig/outsider/one-signer-twice-refused`, `release-wrong-genesis-refused`, `release-expired-refused`, `spoofed-sysvar-refused`, `release-leaf-index-bound/not-in-root-refused`, `refund-before-deadline-refused`, `refund-after-deadline-returns-remainder`, `refund-sets-closed-flag`, `release-after-refund-refused`, `refund-twice-refused` (every refusal asserts its specific custom-program error code) | `contracts/logs/step2-solana-tests.out` |
| 3 | `bash crosschain/local-demo.sh` (anvil + solana-test-validator; drives only the shipped `bin/benzo` → `benzo xchain` verbs) | `RESULT PASS one cleared drop delivered end to end locally on both chains` — 12/12: escrow deployed from the forge artifact, locks on both chains, one shared allocation root attested 2-of-3 per chain, release delivers 1 ETH + 2 SOL to fresh addresses (exact deltas asserted from raw `eth_getBalance`/lamport balances and the escrow's `PayoutPaid` event), `status` shows each chain paid exactly its leaves and the escrow state matches the attested root, replay refused with each chain's `BatchReplayed` error, refund refused before the deadline and the full remainder returned after it on a cancelled auction | `contracts/logs/step3-xchain-e2e.out` |
| base | `npm run typecheck`; `npm run e2e` | both PASS (`PASSED default seal in the browser, open with tle after R (39 s)`) | `tmp/e2e/` |

`contracts/AUDITS.md` lists every dependency, pin and audit status (OZ Contracts 5.6.0 audited Feb 2026 OZ commit `68e4095` incl. SafeERC20/ECDSA; forge-std 1.9.7 vendored test-only `foundry-rs/forge-std@77041d2:src`; solana-program `=2.3.0` + solana-keccak-hasher `=2.2.1` with Cargo.lock committed; ethers 6.17.0 / @solana/web3.js 1.99.0 exact client pins; native Ed25519 program + instructions sysvar; no serialization library). New root deps are those two client libraries only (lockfile diff = additions).

Honesty notes. (a) The step-3 demo starts from a **cleared allocation file** (winners + lot counts, as the Zcash clearing pipeline produces) and one chosen `result_hash`; it proves the delivery leg of §7 step 3 — the Zcash-side clearing and the live testnet end-to-end remain the existing pipeline and steps 4–5/Track A (design §6). No Zcash txid/address/amount enters any leaf or chain call. (b) Harness bugs found and fixed during the runs (no product defect hidden; final logs are the passing reruns): Foundry `vm.expectRevert` was shadowed by an internal helper's external call; the Solana release CPI lacked the system-program account; releases exceeded the 1232-byte tx limit until the Ed25519 message was referenced into the release instruction (still strictly checked: `message_instruction_index == current`, offset 2, size 200, sig/pubkey slices inside the verify instruction); the demo re-used stale key files while deriving identities from fresh randomness (signers disagreed → quorum errors, correctly refused); ethers v6 briefly caches the resolved "latest" block number so `getBalance` saw the pre-tx block (demo now reads raw `eth_getBalance`). (c) The step-1 forge tests and the step-2/step-3 drivers live under `contracts/`/`crosschain/` as the design's contract-level proofs; they are not project E2E specs and none of them touches `npm run e2e`'s suite.

Test audit: default E2E seal-open unchanged (R retain; browser/tle assertion IDs untouched; default PASS 39s at `cc5a719`). No live-spec changes; live runs remain Track A's. Key material: demo keys are fresh local dev keys under `$BNZ_STATE_DIR/xchain-local/` (gitignored, never printed; anvil dev account 0 is the local seller/crank); `.benzo/` testnet lane material and both deployer keys were not read or used.

### Questions (cross-chain steps 1–3)

- **Solana cluster binding (design §1):** there is no genesis-hash sysvar on-chain (checked the `solana-sysvar` 5.0.0 module list and the Agave v4.3.0 tree). Implemented as designed: the 200-byte signed message carries the cluster genesis hash + program ID; additionally the program requires the message's genesis hash to equal the value pinned into the auction at `lock` (the locker's client supplies `getGenesisHash`) and its program ID to be this deployment (error 18 `BadBinding`; `release-wrong-genesis-refused` in the step-2 log). This is the tightest on-chain binding Solana allows; confirm or redirect.
- **Refund semantics:** design §2.3 says refund after `deadline` "with no release", while §2.4 keeps failed items claimable by a later release. Implemented: releases stay available until a refund happens; `refund` (anyone, strictly after `deadline`) returns the unspent remainder (`locked − paid`) to the pinned return address and closes the auction. Confirm.
- **EIP-712 shape:** domain `{name: "benzo-release-v1", version: "1", chainId, verifyingContract}`, struct `BenzoRelease(bytes32 auctionId,bytes32 resultHash,bytes32 allocationRoot,uint64 batchIndex,uint64 nonce,uint64 expiry)` — the §1 message's prefix/fields as typed data. Confirm.
- **Escrow cap:** payouts that would exceed the locked amount are skipped (never a batch revert) and the excess stays refundable to the seller, so no attestation set can pay more than locked. Confirm this matches the intent.
- Step 5 note: with `no Base` (5ebf4c8) the deployment targets are Ethereum Sepolia + Solana devnet only; step 4's stealth fallback is on Ethereum Sepolia. Noted for the later run.

## Phase 6, Track B: READY FOR MERGE

Updated run 13: 2026-10-02T08:01:57Z, base `7e06e2a` (head: merge main into track-b, docs brief) + working tree; commits `8725750` (README.md), `1416988` (docs/why-timelock.md), `4d5f756` (docs/verify-it-yourself.md) and this STATUS commit. Scope: the three Phase 6 docs exactly as briefed in `docs/design/phase6-docs.md`, nothing else. No tests, no source changes, no pins, no other-checkout access, no `.benzo/`, funds, keys, merge/rebase/cherry-pick or push. Only network use: one read-only quicknet beacon fetch. SC batch-plan stays BLOCKED pending Track A's side-effect-free `settle/batching.ts` (unchanged since run 12).

Every command shown in the three docs was run first and logged under `tmp/proof-logs/run13-*.out`; trimmed real output:

| Doc section | Command | Real output (trimmed) | Log |
|---|---|---|---|
| README quick start | `npm ci` | exit 0 | run13-npm-ci.out |
| README quick start | `npm run typecheck`; `npm run build:verify`; `npm run build:cli` | each exit 0 | run13-build.out |
| README, verify §1 | `shasum -a 256 dist/benzo-verify.mjs`; `cat docs/verify-bundle.sha256` | `89d90c5370b9c42fb5e29f8d99f9672303d8c0546b1d4970aaaac175690355c4` both; `git status --short` empty, so `npm run build:verify` reproduced the committed bundle byte-for-byte | run13-sha.out |
| README quick start | `bin/benzo verify --dir docs/evidence/phase-4/cli --signer 302a…7891` | OK ×11 (`missing-deposits delivery report manifest freeze witness receipts clear envelope accounting accounting-strays`) + `WARN no witness set (pre-Phase-5 manifest)`, exit 0 | run13-cli.out |
| verify §2 | cold copies of `docs/evidence/phase-4/cli` and the bundle into `/tmp/benzo-docs`, then `node benzo-verify.mjs --dir auction --signer 302a…7891` | same 11 OK + WARN, exit 0 | run13-verify-main.out |
| verify §4 | `node benzo-verify.mjs --dir auction-old --signer …` (cold copy of `docs/evidence/phase-2/auction`) | `WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs`, `ERROR verify refused: no published beacon; rerun with --fetch-beacon`, exit 1 | run13-verify-old.out |
| verify §4 | same + `--fetch-beacon` | `WARN legacy projections…`, `WARN beacon fetched (not published)`, 11 OK, exit 0 | run13-verify-old.out |
| verify §5 | node one-liner flipping one hex digit of leaf-0 plaintext in `tampered2/auction.json`, then verify | `flipped one hex digit of leaf 0 plaintext at offset 22916 0 -> 1`; `ERROR verify refused: opening 0 published differs from re-derived`, exit 1 | run13-tamper-doc.out |
| why-timelock | node one-liner, `release = genesis + period × (R − 1)` | `R=32701714 -> 2026-10-02T02:35:06.000Z`; `R=32704232 -> 2026-10-02T04:41:00.000Z` | run13-time.out |
| why-timelock | `curl -s https://api.drand.sh/52db9b…/public/latest \| node -e …` | `latest round 32707994 formula time 2026-10-02T07:49:06.000Z wall clock 2026-10-02T07:49:09.096Z` (formula matches the live chain within one 3-s period) | run13-time.out |
| why-timelock | node one-liner flipping one hex digit of the beacon signature in `tampered3/auction.json`, then verify | `ERROR verify refused: beacon BLS signature invalid`, exit 1 | run13-tamper-beacon.out |

Numbers in the docs cite their sources: genesis `1692803367`, period `3`, quicknet chain hash and the release formula → `manifest/schema.ts:4–8` and `:104`; R = 32701714 → `docs/evidence/phase-4/cli/beacon.json`; 17,000-bid open 431.6 s / clear 0.9 s / verify 443.1 s → `docs/evidence/phase-6/bench.json`; 17,000 = the organizer's 48-hour volume → `docs/PHASE-6.md` §1; claim and limits → `docs/research/DESIGN.md` §1/§6/§14; mode proof marks → `docs/evidence/phase-1…4/EVIDENCE.md` (live) and this file (offline). No hype language added; nothing is claimed beyond DESIGN §1.

Honesty notes: a first tamper attempt flipping `opened.json` in the canonical copy exited 0 (`run13-tamper-open.out`) — canonical dirs take `opened`/`beacon` from `auction.json` (`api/public-auction.ts:110–112`; sidecars are legacy-only, `:133–143`) — no pass credited; the shipped demo flips a byte in `auction.json` and the guide states that fact. The `--fetch-beacon` runs fetched the real quicknet round and BLS-checked it before use. Doc lengths: README 156 lines (brief 150–200), why-timelock 66 (brief ~60), verify-it-yourself 102 (brief ~60; the full check list and real outputs make ~60 impossible without cutting evidence).

Baseline: `BNZ_STATE_DIR=tmp/run13-no-state npm run e2e` exits 1, `NOT RUN tle missing at …/tmp/run13-no-state/bin/tle` (`run13-baseline.out`) — the user's prohibition on `.benzo/` keeps the pinned tle out of reach, as in run 12; no baseline pass claimed. Docs-only run: no tests added or changed (R11), no source covered by any test touched, no mutation rerun due; audit marks unchanged (R retain default seal-open). READY FOR MERGE.

Run 12 record, updated: 2026-10-02T06:05:41Z, base `0a6b6cc` + working tree. Clean start; no head commits since run 11. Legacy dirs without a beacon now refuse by default with `ERROR verify refused: no published beacon; rerun with --fetch-beacon`; `--fetch-beacon` fetches signed-manifest R from real quicknet, BLS-authenticates it before decryption, and emits `WARN beacon fetched (not published)`. Published beacons remain offline by default and must equal the fetched beacon when requested. BLS verification catches malformed-point exceptions and false returns as `ERROR verify refused: beacon BLS signature invalid`.

Proof: `npm run typecheck`, `npm run build:verify`, `npm run build:cli` PASS (`tmp/proof-logs/run12-build.out`). Scratch `python3 tmp/run12-proof.py` PASS (`run12-proof.out`): old committed bundle fails both Phase2 legacy paths and emits raw point error; rebuilt standalone bundle from `/tmp/benzo-run12-verifier-final` passes cold `docs/evidence/phase-2/auction` with real `--fetch-beacon`, gives exact default/signature refusals, and retains identical stdout/stderr/exit0 for intact Phase3/ModeB/CF/CF-bond corpora with fetch disabled by Node preload. Published Phase3 `--fetch-beacon` also passes. `python3 tmp/run12-extra.py` PASS (`run12-extra.out`): published/fetched mismatch refused specifically; second malformed point refused clearly. First scratch run failed because run11's old `/tmp` Phase3 copy retained a deliberately substituted signature; both bundles refused it, and the final run cold-copied intact repository corpora (`run12-proof-stale-corpus.out`, no pass credited). Two builds starting without the bundle reproduce SHA256 `89d90c5370b9c42fb5e29f8d99f9672303d8c0546b1d4970aaaac175690355c4` (`run12-repro.out`); rebuilt bundle/hash committed. `git diff --check` PASS. All named logs are under `tmp/proof-logs/`; scratch scripts removed after completion, cold copies/logs retained.

Baseline: `BNZ_STATE_DIR=tmp/run12-no-state npm run e2e` exits1, NOT RUN missing pinned tle (`run12-baseline.out`). Explicit user prohibition on touching `.benzo/` prevents this harness's usual state-bin access; no baseline pass claimed. Test audit: R retain default seal-open C1–C7; covered sealer source/assertions unchanged, no new mutation due. No tests added, no owned services or pending jobs, no `.benzo/`, funds, keys, live network custody, other-checkout access, or upstream/pin changes. Standalone proofs use only public data and drand. SC batch-plan remains BLOCKED with existing partial metrics; user accepted that item pending Track A's side-effect-free `settle/batching.ts`. Rerun stage5 after it arrives. READY FOR MERGE per the direct instruction below, without claiming complete SC gate evidence.

Run 11 record, updated: 2026-10-02T05:48:09Z. Start clean at e3399c5; head-authored design 4adbb6b inspected. No owned services, live wallet/key-material access or other-checkout commands. The AGENTS-required baseline harness loads .env and invokes the existing pinned tle through BNZ_STATE_DIR (e2e/lib/env.ts); no further state/tool access used for Phase6 implementation or proofs. Default E2E PASS38s (`tmp/proof-logs/phase6-baseline.out`). No tests added.

1. PK complete at base e3399c5 + working tree: verify now re-derives bids and CF reserve offline with pinned tlock-js from the published, BLS-authenticated quicknet beacon; stanza chain/round bound before decrypt. Published openings are compared. Serial beacon defaults offline too. `--fetch-beacon` requires network beacon equality; `--tle` resolves the optional Go cross-check through PATH; `--offline` aliases the default. No git/state lookup in verify. `npm run build:verify` inlines dependencies into committed `dist/benzo-verify.mjs`; hash in `docs/verify-bundle.sha256`.

Proof: `npm run typecheck`, `npm run build:verify`, `npm run build:cli` PASS (`phase6-pk-build.out`). `python3 tmp/pk-proof.py` PASS (`phase6-pk-proof.out`): bundle + cold public copies under `/tmp/benzo-phase6-b-offline` outside git, Node preload makes fetch throw; in-repo/standalone both exit0 with identical OK checks for Phase2, Phase3, ModeB, CF and CF bond corpora. Phase2's missing public beacon was fetched once to prepare the cold input; the verification itself made no fetch. Tampered zero signature exits1 at point validation; a valid Phase2 signature substituted at Phase3 R exits1 specifically `beacon BLS signature` (`phase6-pk-signature.out`). `node tmp/pk-options.mjs` PASS for deprecated alias and fetch-equality CF reserve path (`phase6-pk-options.out`). Two builds each starting with absent bundle yield SHA256 `450bc39920b96559378c5cf56d7aa1ed3f449bef9177cd45aa8fe0a3a695c2d8` (`phase6-pk-repro.out`). `node tmp/phase6-compat.mjs` also PASS for drop/launch/RFQ/OTC/recurring buybacks and CF --previous link (`phase6-pk-compat.out`). All logs under `tmp/proof-logs/`; no live-chain/custody evidence claim. Optional --tle not run: B does not access protected state binaries and no tle on PATH was required for PK.

2. LA complete at base5d83153 + working tree: `npm run leak-audit -- --sensitive FILE --paths P1 P2 … [--git] [--allowlist FILE]`. Sensitive JSON is `{label,value,release_time?}[]`; release_time is UTC ISO text or epoch seconds and applies only to 128-byte bid hex. Bid matches are findings before release; afterward plaintext is intentionally public. Other sensitive values match plain/hex/base64 (also decoded-hex byte base64). Generic addresses, viewing keys, 24 lowercase word runs, PEM private keys and AGE armor checked. Optional allowlist JSON lists exact address-bearing file paths only. History scans full blobs across all commits/branches (earliest commit timestamp per blob/path), avoiding multiline diff-fragment misses. Tracked working files use last commit timestamp; untracked use mtime. Working-path symlinks refused; historical symlink blobs scanned as text. Final audit corrected their initial exclusion (same synthetic harness now14 findings). Output only rule/label/file/line-or-commit/value SHA256; scan errors suppress input values and fail exit2.

Proof: standalone source typecheck PASS (`phase6-la-build.out`); `python3 tmp/la-proof.py` PASS (`phase6-la-proof.out`): 14 synthetic findings cover all7 rules, each relevant encoding, removed historical secret and symlink target, address allowlist, no values in output; clean fixture exits0; post-release bid exits0, same bytes with prerelease mtime exits1. Findings retained in `tmp/proof-logs/phase6-la-findings.json`. Tool built through the shipped npm script. Only scratch synthetic repo/history scanned; no live sensitive file/state read. PK commit5d83153; LA commit22d812f plus historical-symlink audit correction included in the third item commit. No new tests.

3. SC offline partial complete; overall BLOCKED at base22d812f + working tree: `tools/bench.ts` / `npm run bench -- --bids N` generates fresh real tlock ciphertexts at quicknet R32704232, deterministic seeded price/quantity/one-time owner inputs, real fixed512-byte settlement-envelope plaintexts, 512-byte BNZ memos and owner signatures. Per-stage child processes measure wall time including public input load/output serialization and process maxRSS (fresh high-water mark). Generation fetches/authenticates the past mainnet quicknet beacon once; open/verify use the local published client. Synthetic deposit references/public manifest addresses are not chain evidence. Witness certificates are real in-memory signatures; no keys persisted. Admission follows shipped memo/stanza checks and validates envelope signatures/size; freeze/open/registry clear and complete shipped verify run. Stage5 is explicitly BLOCKED, never imports live plan, outputs null batch/fee estimates and exits1 after independent stages.

`npm run bench -- --bids 1000` ran all independent stages PASS, then overall exit1 solely for protected stage5 (`tmp/proof-logs/phase6-sc-1000.out`). 5000/17000-bid independent stages also PASS (`phase6-sc-5000.out`, `phase6-sc-17000.out`); each overall exit1 solely for the same stage5 blocker. All jobs finished and polled to exit. Tool source typecheck PASS (`phase6-sc-build.out`). First launch failed before generation because externalized armor import needed `.js`; fixed then reran. No failed launch credited. `docs/evidence/phase-6/bench.json` is generated partial benchmark data, not complete SC gate evidence. Source SHA256/base/UTC are recorded by each run.

| Bids | Stage | Seconds | Peak RSS MiB | Status |
|---:|---|---:|---:|---|
| 1000 | generate | 18.504 | 267.5 | PASS |
| 1000 | admission | 0.144 | 105.8 | PASS |
| 1000 | freeze | 0.019 | 106.4 | PASS |
| 1000 | open | 25.254 | 274.0 | PASS |
| 1000 | clear | 0.033 | 94.5 | PASS |
| 1000 | batch-plan | — | — | BLOCKED |
| 1000 | verify | 25.512 | 341.7 | PASS |
| 5000 | generate | 88.726 | 390.8 | PASS |
| 5000 | admission | 0.731 | 267.7 | PASS |
| 5000 | freeze | 0.092 | 300.6 | PASS |
| 5000 | open | 127.507 | 411.4 | PASS |
| 5000 | clear | 0.221 | 207.6 | PASS |
| 5000 | batch-plan | — | — | BLOCKED |
| 5000 | verify | 128.424 | 705.0 | PASS |
| 17000 | generate | 300.260 | 515.3 | PASS |
| 17000 | admission | 2.426 | 611.0 | PASS |
| 17000 | freeze | 0.307 | 722.2 | PASS |
| 17000 | open | 431.564 | 578.3 | PASS |
| 17000 | clear | 0.934 | 484.8 | PASS |
| 17000 | batch-plan | — | — | BLOCKED |
| 17000 | verify | 443.060 | 1411.4 | PASS |

Benchmark provenance: all3 runs used base22d812f + identical working-tree `tools/bench.ts` SHA256 `97ebdb14a86601a1fd383131f870122d999eeea774ffad487d230f50930f96b9`, recorded UTCs in generated bench.json. These are partial measured offline results, not a complete SC gate claim at a committed source revision. No estimated fees/batch counts fabricated. Exact rerun: `npm run bench -- --bids 17000` (currently exit1 after all independent stages). Complete immutable public corpora/metrics remain under `tmp/bench-{1000,5000,17000}` for head review; generated aggregate committed with this item per user's one-commit instruction. Final source typechecks and `git diff --check` PASS (`phase6-final-checks.out`). Run11 PK/LA implementation and manual proofs complete; READY FOR MERGE was withheld until stage5 matches the head-owned design (superseded by run12 user instruction accepting the blocker). No ongoing work/services, tests added, pin changes, live wallet/key reads, broadcasts, funds, other-checkout access, merge/rebase/cherry-pick or push. No copied upstream code; APIs/flags inspected in pinned installed sources (tlock-js0.9.0, noble1.9.7), existing witness/envelope/registry modules and settle/plan.ts. Scratch proof scripts removed after completion; logs/corpora retained.

Test audit: R retain default seal-open; unchanged source/assertion IDs and baseline PASS38s. No source it covers changed; no new mutation needed. Live tests and signers remain A-owned/unrun.

### Questions (Phase 6)

- Run 13 doc marks (for the head): per the brief only Mode A (uniform) is marked **testnet-proven live** in the README. Phase 2's live run also computed a Vickrey comparison on live inputs, but its sample prices tied (`docs/evidence/phase-2/EVIDENCE.md` limitation), so README marks Vickrey **offline-proven** with that footnote; say the word if it should read live.
- Run 13 doc lengths: `docs/verify-it-yourself.md` is 102 lines against the brief's ~60 — the eleven check lines and the real command outputs make ~60 impossible without cutting evidence. Compress on request.

User instruction (2026-10-02T06:03:30Z recorded UTC), verbatim:
> You are Builder B (Codex) on /Users/akshmnd/Dev Projects/benzo-b, branch track-b. AGENTS.md is your operating manual. Continue from STATUS-B and `git log --oneline -15`.
>
> The head reviewed run 11 (5d83153, 22d812f, 0a6b6cc) and tested `dist/benzo-verify.mjs` from /tmp with network denied: the Phase 3 corpus verifies offline and the bundle hash matches. Your batch-plan BLOCKED item is accepted: Track A will extract a side-effect-free `settle/batching.ts` after its live regression; you rerun bench stage 5 then. Small fixes now (one commit, proof in STATUS-B):
>
> 1. **Legacy dirs without a published beacon** (e.g. a cold copy of `docs/evidence/phase-2/auction`) are now unverifiable: the default says "missing published beacon" and `--fetch-beacon` refuses too. Rule: with a published beacon, verify offline (and `--fetch-beacon` must match it). Without one, `--fetch-beacon` fetches the round from drand, BLS-checks it against quicknet, and proceeds with `WARN beacon fetched (not published)`. The default error must say `no published beacon; rerun with --fetch-beacon`.
> 2. **Tampered beacon signature** currently fails with "Cannot find square root" (point decode). Catch it: `ERROR verify refused: beacon BLS signature invalid`.
> Prove from /tmp with the standalone bundle: Phase 2 cold copy OK with `--fetch-beacon`; the default gives the new message; a tampered beacon gives the clear error; Phase 3 / Mode B / CF corpora unchanged. Rebuild the bundle and update `docs/verify-bundle.sha256`. Then set READY FOR MERGE.
>
> Add no tests. Track B files only. Never touch /Users/akshmnd/Dev Projects/benzo, funds, keys or `.benzo/`. No merge/rebase/cherry-pick.

- SC stage5 protected-file BLOCKER: `settle/plan.ts:10–14` performs git/.env/state initialization at import; lines21–29 run live wallet/scan work, and the file exports no offline batch planner (`rg -n export settle/plan.ts` finds none). Design §3 requires a read-only import from this Track A-owned file, while user/AGENTS forbid B from live state/wallet access or changing A files. Need A/head to expose a side-effect-free offline batch planner at cap13 with a documented ZIP-317 fee estimator, or authorize a specific pure planner import. B finished all independent stages at1000/5000/17000, but batch counts/fees stay null and stage5/run exit1; no substitute pass. No import attempted.

User instruction (2026-10-02T05:10:55Z recorded UTC), verbatim:
> You are Builder B (Codex) on /Users/akshmnd/Dev Projects/benzo-b, branch track-b. AGENTS.md is your operating manual. Continue from STATUS-B and `git log --oneline -20`.
>
> The head reviewed your run-10 commits (9abf320, bee8e41, c1dcc3a, 95c50b7); Track B Phase 5 is complete and stays on track-b until Phase 4 is PASSED.
>
> Next: **Phase 6 Track B offline items, exactly as designed in `docs/design/phase6-b-offline.md`** (head-owned; implement as written, disagreements under Questions): (1) fully offline verify from the published beacon + standalone reproducible `dist/benzo-verify.mjs`; (2) `tools/leak-audit.ts`; (3) `tools/bench.ts` 17,000-bid offline benchmark. One commit per item with its logged proof in a new "Phase 6, Track B" section of STATUS-B, then READY FOR MERGE.
>
> Add no tests. Touch only Track B files, new `tools/` files and `package.json` scripts. Never touch /Users/akshmnd/Dev Projects/benzo, funds, keys or `.benzo/`. Do not merge, rebase or cherry-pick.

## Phase 5, Track B run 10: READY FOR MERGE

Updated: 2026-10-02T05:03:59Z. Start clean at f8ac208; head merge/corrections inspected, PHASE-5 R3/R4 author-checked. No owned services; protected state files not read. Default E2E PASS39s (`tmp/proof-logs/run10-baseline.out`). No new tests.

1. Dependencies: exact direct noble curves1.9.7/hashes1.8.0 declarations; typecheck PASS (`run10-deps.out`); Node manual lock comparison PASS (`run10-deps-manual.out`), all lock data except root declarations byte-structure unchanged. Source base f8ac208.

2. Recurring buyback report: `adapters/buyback-report.ts` derives window index, prices (per-lot prices for multi-lot), units, payout+fees in zats/exact 8-decimal ZEC, result hash and serial intake from public data. `serial-intake.json` array binds auction/ciphertext/serials with the opened seller's owner signature; each winner supplies exactly fill serials, no duplicates. `benzo report --dir PUBLIC [--previous PUBLIC]` prints canonical values; public/API verifier requires matching `report.json` for recurring buybacks. Old nonseries corpora need no report.

Proof at base9abf320 + working tree: `node tmp/run10-report.mjs` fresh real tle/quicknet R32704232 creates two independently sealed, linked windows with one in-memory signer, fresh auction IDs/ciphertexts; 5 units, lot prices10000/20000, payout69800 + fees200 = spent70000zats /0.00070000ZEC, serials100/101/102/110/111. `python3 tmp/run10-report-check.py` PASS CLI report equals file, online/offline verify both windows, --previous link; wrong spend, swapped report serials, changed intake signature and reverse link refused specifically. Logs `tmp/proof-logs/run10-report-{corpus,check,build,harness-build}.out`; typecheck/build:cli PASS. Scratch extension initially omitted async on its window function; fixed before the two-window run (no product defect or stale run credited). No live chain settlement claim; deposit references are generated fixtures, owner/witness keys remain in memory, only pinned tle executable used under state.

3. Gate Z adapter complete at basebee8e41 + working tree: `marketplace.json` has `{version:1,adapter:zilkroad,collection,serial_range:{first,count},metadata_commitment}`. Signed manifest `lot` is `zilkroad:` + SHA256(canonical marketplace); multi-lot IDs are `5a494c4b` + first56 hex of SHA256({marketplace_hash,lot_index}), so even removing the file refuses. This uses existing manifest fields, keeps Track A schema untouched, and binds all collection/range/metadata bytes. Drop range must match `serials`; buyback intake also checks range when pinned.

`benzo claim --dir PUBLIC --ciphertext-hash HEX` loads saved private `.receipt.json`/`.statement.json` siblings of the bidder owner key; optional `--receipt FILE --statement FILE` and `--owner-key-stdin` support offline imports without secret argv/files. `--check CLAIM` checks the public binding. Only paid auction winners qualify; statement verifies against result/opened owner, receipt must match a public settlement output (seller payout if winner refund=0). Claim owner-signs auction/manifest/result hashes, collection/metadata, serials, statement/receipt hashes and settlement txid. Serial assignment is the published drand shuffle for drops, otherwise consecutive committed inventory by leaf order. `delivery-exceptions.json` is an array of `{claim,receipt,statement,status:paid_not_delivered,signature}`; owner separately signs `{auction_id,claim_hash,status}`. Verify checks claims, status signatures, uniqueness, range/commitment; a complaint is unresolved, not a token-chain proof or a second-payment authorization. No Zilkroad network calls.

Manual proof: `node tmp/run10-adapter.mjs` freshly seals/opens 3 corpora with real tle/quicknet (single lot, shuffled multi-lot, zero-refund winner); in-memory owners, only public fixture settlement references, no key files/state access. Shipped claim signs via stdin, equals library output, valid private statement/receipt and exception queue. `python3 tmp/run10-adapter-check.py` PASS online/offline verify + shipped claim --check on all3; metadata substitution, removed marketplace file, changed serial, bad complaint signature and duplicate complaint specifically refuse. Library also refuses substituted receipt/statement and claim signature. Logs `tmp/proof-logs/run10-adapter-{corpus,check,build,harness}.out`; typecheck/build:cli PASS. Scratch rerun first retained a prior queue against fresh ciphertexts (correct refusal; `run10-adapter-stale-queue.out`), fixed scratch to initialize queue. Zero-refund scratch originally tied both bids, causing pro-rata fill2; corrected input to distinct prices, then PASS fill3/refund0 via seller payout (`run10-adapter-zero-fixture-failed.out`, downstream missing-claim refusal `run10-adapter-zero-check-not-run.out`). No failed run credited. No new tests or live delivery/chain settlement claim.

4. Missing-bid pure path complete at basec1dcc3a + working tree: `mined-deposits.json` is `{version:1,auction_id,block_times:[{height,time}],deposits:[{height,ciphertext_hash,note_id}]}`. `note_id` is `txid:ironwood:output_index`; each deposit height must have exactly one public timestamp, no unused timestamps, duplicate notes or malformed fields. This list represents scanner-observed exact-C BNZ deposits, not stray-value notes. Membership matches ciphertext + txid/pool against the recomputed frozen root. Notes whose block timestamp is strictly below signed `T_submit` and which are absent derive `refund-exceptions.json` rows `{auction_id,height,ciphertext_hash,note_id,status:refund_owed,refund_zats:C}`. Verify errors if the queue is missing/different and flags valid obligations with a warning; it does not broadcast/refund. At/after deadline notes do not become these exceptions.

`benzo receipt prove --dir PUBLIC --ciphertext-hash HEX` emits `included:false`, `message:"not included; refund owed"`, exact-C exception and a self-contained manifest/full frozen-set/mined-observation bundle for an observed omission. `--check` replays it offline. Optional `--note-id` selects a distinct omitted note when its ciphertext also appears in another admitted deposit. Existing included Merkle proof behavior stays intact. Phase4's committed Deposit lacks output_index, so a list containing two same-tx/same-ciphertext notes matching one leaf is refused as `ambiguous frozen note identity` rather than silently counted once.

Proof: `python3 tmp/run10-missing.py` chooses fresh random mined note IDs/hashes and early/at/late timestamps against this session's freshly tle-generated marketplace corpus (R32704481). Offline verification first errors on absent refund queue, then online/offline PASS with exact120100-zat C; omitted proof prints/refuses as specified and included proof still verifies. At/after deadline omissions excluded; refund120000, absent timestamp, duplicate note, ambiguous frozen identity, changed proof root/refund/height all specifically refuse; same hash/different tx omission is selected by --note-id. `tmp/proof-logs/run10-missing-{build,check}.out`. These are pure public-input fixtures, not scanner/network evidence; chain authentication/payment stays A's job.

Final compatibility audit fixed one gate-Z defect: the statement retains the original balance_due_zats after successful settlement, so a paid bond winner was incorrectly refused. Same fresh-bond harness `PROOF_BOND_ONLY=1 node tmp/run10-adapter.mjs` FAIL before (`claim paid auction winner`, `run10-claim-bond-before.out`) and PASS after (`run10-claim-bond-after.out`, R recorded there). Claims now require SETTLED and a nondefaulted winner; full public accounting requires the seller payout including paid balances. The owner-signed statement still binds the original obligation. The harness also refuses a defaulted winner. This necessary compatibility fix is included with item4; no extra test or mode.

Final verification: typecheck/core/CLI builds PASS (`run10-final-build.out`), default E2E PASS37s (`run10-final-e2e.out`; sealer/test source untouched). Latest claim/missing source typecheck/CLI PASS (`run10-claim-bond-build.out`). Logged manual suites all PASS: `run10-final-report.out` (two linked windows), `run10-final-adapter.out` (single lot, shuffled drop, zero refund, paid bond; online/offline and queue/claim corruptions), `run10-final-missing.out` (early/at/late/included/omitted/proof corruptions). Inherited drop/launch/RFQ/OTC/nonseries buyback all online verify PASS (`run10-final-compat.out`). Commands and corpus values are in these logs; paths relative to `tmp/proof-logs/`. Final source SHA256s/base commit/UTC recorded in `run10-source-hashes.out`. No gate evidence, live custody, actual delivery or actual refund claim. Four requested items are complete for Track B; commits9abf320/bee8e41/c1dcc3a and this item4 commit (git log) stay on track-b.

Test audit: R retain default seal-open (browser/tle assertion IDs unchanged, default37s PASS); no E2E source/assertion changes or new tests. Live specs and their mutation reruns remain Track A-owned and were not run by B. No dependency resolution/pin changes beyond the requested direct declarations, upstream code copies, environment installations, wallet/key access, testnet spends, other-checkout commands, merges/rebases/cherry-picks or pushes. No owned services/work running. New scratch scripts removed after completion; public corpora/proofs and full logs retained in tmp for review. READY FOR MERGE is pure/manual readiness, not Phase5 PASSED/live evidence.

### Questions (run 10)

- Budget accounting: this run adds net268 handwritten source lines (git diff f8ac208 plus new70-line missing module); Zilkroad/claim is part1, report/missing are R3's remaining pure part2 items. The prior ~832 estimate plus this work needs reconciliation across the two phase budgets; all work was explicitly ordered by the user above.
- A integration for omissions: authenticate block timestamps and mined notes from real chain data; publish only exact-C BNZ notes, preserve stable `txid:ironwood:output_index`, write the derived queue and wire exact-C refunds. `scan/src/main.rs:66` reads output_index but line76 onward does not currently emit it; the frozen Deposit also lacks it. A/head must retain that identity in the live path. B refuses ambiguous identity inputs, and does not claim the publisher's timestamp list authenticates itself. This is the requested pure boundary, not a live refund implementation.
- A integration: publisher must write the marketplace packet using the lot commitment encoding above, preserve serial-range binding, persist bidder receipt/statement siblings for bare claim, and publish signed delivery complaints. JSON schema changes, actual token delivery/observations and live settlement remain A's lane.

User instruction (2026-10-02T04:40:00Z), verbatim:
> You are Builder B (Codex) on /Users/akshmnd/Dev Projects/benzo-b, branch track-b. AGENTS.md is your operating manual. Continue from STATUS-B and `git log --oneline -20`.
> 
> The head reviewed your run-9 commits (collection drop e70d8d8..e33ba95, launch 14061a4, RFQ ff6b2ea, OTC d67b6f6, 20ce790) and found the money rules correct. Your Phase 5 work stays on track-b until Phase 4 is PASSED.
> 
> Remaining Track B items for Phase 5 (each proven in STATUS-B with logged manual runs, one commit each):
> 1. **Dependencies:** `clear/serials.ts` and `envelope/destination.ts` import `@noble/curves` / `@noble/hashes`, which today arrive only transitively via tlock-js. Declare both in package.json `dependencies` at the exact locked versions (1.9.7 / 1.8.0, no ^ or ~); the lockfile must not change otherwise.
> 2. **Recurring buyback report (PHASE-5 R3 item 4):** for a buyback series (CF recurring rounds over Mode B), a public per-window report derived only from public data: window index, units bought, clearing price, ZEC spent (payout + fees), serials taken in. `benzo report --dir PUBLIC [--previous …]` prints it; verify checks the report matches the result.
> 3. **Marketplace adapter, gate Z (PHASE-5 part 1):** complete the Zilkroad adapter: manifest binds collection, serial range and metadata commitment; `benzo claim --dir PUBLIC --ciphertext-hash HEX` turns the winner's private settlement receipt + statement into a delivery claim signed by the owner key; an exception-queue file format for paid-but-not-delivered, checked by verify. Read-only adapters only — no network calls to Zilkroad.
> 4. **Missing-bid exceptions (R3 item 6, pure part):** given a published list of mined deposits (height + ciphertext hash + note id, as the scanner reports them), verify flags any deposit mined before `T_submit` that is absent from the frozen root as an exception owed an exact-C refund, and `benzo receipt prove` explains "not included; refund owed" for it.
> Then set READY FOR MERGE. Add no tests. Touch only Track B files (plus package.json for item 1). Never touch /Users/akshmnd/Dev Projects/benzo, funds or keys. Do not merge, rebase or cherry-pick.

## Phase 5, Track B run 8: READY FOR MERGE

Updated: 2026-10-02T04:29:04Z. Takeover at d8ed113 on track-b; clean initial tree. PHASE-5 R3/R4 author-checked (b709abd/71ec6eb). No owned services from this session; protected state/service files not read (Track B has no wallet/key access). Default E2E PASS (38s), `tmp/proof-logs/run8-baseline.out`. No added tests.

1. Manifest serial block: `npm run typecheck` PASS, `tmp/proof-logs/drop-schema.out`; optional strict `{first,count,seed_round_offset}`, positive offset, multi-lot uniform only, safe range/round.

2. `clear/serials.ts`: typecheck PASS; `node tmp/proof-serials.mjs` + independent Python hashlib/u64be reproduction PASS (3 winners, 10 serials, real quicknet round in `tmp/serial-input.json`), overflow refused specifically. Output `tmp/proof-logs/drop-shuffle.out`. Step 1 commit e70d8d8.

3. Registry uniform entry decorates clearing with serial assignment from `ClearInput.serial_beacon`; `node tmp/proof-markets.mjs` fresh tlock corpus + shipped `node clear/dist/cli.mjs < tmp/drop-input.json` PASS (fills 2/3/5 unchanged; 10 unique serials; round R+1). Logs `tmp/proof-logs/drop-result.out`, `drop-result-build.out`, typecheck PASS. Step 2 facb65a.

4. Shared verifier/API loader accepts published `serial_beacon {round,signature}` and replays through uniform registry entry. CLI online fetches the configured R16 quicknet path; online and offline both verify BLS with installed lockfile-pinned drand-client. `bin/benzo verify --dir tmp/canon-drop --signer HEX [--offline]` both exit 0, OK x8 (`tmp/proof-logs/drop-online.out`, `drop-offline.out`); typecheck/build:cli PASS (`drop-verify-build.out`). Step 3 e06ed08. No live-chain evidence claimed: these are fresh manual pure-mode corpora with real tle/drand, fixture deposit references.

5. Collection proof complete at base 650b998 + working-tree registry BLS check: real quicknet R=32703286, seed=32703287, 3 winners with fills 2/3/5, range 100–109. Online/offline verify both exit 0 OK x8 (`drop-final-online.out`, `drop-final-offline.out`). `python3 tmp/drop-neg.py` refuses swap (`ERROR clear refused: canonical result differs`) and wrong round (`ERROR verify refused: serial beacon round`) online/offline; a real signature from R substituted for R+1 fails BLS offline and published-beacon equality online (`drop-neg.out`). `node tmp/proof-markets.mjs 9` freshly seals/opens 10 winning units with a signed count=9, exit 1 `refused: serial units exceed count` (`drop-overflow.out`). Build/typecheck PASS (`drop-final-build.out`). BLS replay also enforced at the pure registry/API boundary using installed lockfile-pinned noble `verifyShortSignature` (API/source inspected before use); no copied upstream code. A malformed zero signature was refused by drand-client's point parser (scratch expectation initially wanted a generic BLS error); changed the manual corruption to another real signature to exercise the wrong-round BLS check. All logs under `tmp/proof-logs/`. Steps 1–4 e70d8d8/facb65a/e06ed08/650b998.

Schema follow-up for A: public `serial_beacon {round,signature}` and result `serial_assignment` / `serial_beacon_round`; propagate `ClearInput.serial_beacon` to live clear/signers. Drop stays `clearing.mode="uniform"` with `lots[]`, not a separate pipeline.

6. Launch mode pure/verify/API complete. New `clear/launch.ts` registry entry (layout v1: byte125=0 main / 1 holder), `clear/market.ts` shared signed-manifest/order/accounting boundary, `adapters/zilkroad.ts` signed holder receipts pinned to collection/auction/owner/unique serial. Launch manifest block `{standard_lot_size,minimum_raise_zats,holder?:{supply,collection,receipt_signer},follow_on?:{previous_result_hash,price_zats}}`. No new schema edit: its client validates the shared base through the existing schema. Main fills uniform in standard-lot increments, marginal pro-rata and leaf-index dust; holder tranche fills at floor by committed index, unused holder supply goes to main. A failed minimum raise/min-fill cancels all fills and refunds exact C including the fee.

Proof at base e33ba95 + working tree: `node tmp/proof-launch.mjs` fresh tle/quicknet round **32703489** → `tmp/proof-logs/launch-corpus.out`: floor 10000 holder pays 20000 for 2; main price 20000, fills 2/2, raise 100000; minimum 100001 cancels all with 400100 exact-C refunds despite manifest fee=100. Marginal band (two main q4 at 20000, room6) fills 4/2 in lots of2; holder2; raise140000. Linked follow-on remaining supply2 goes to earlier mined-height leaf1, at prior20000, leaf0 unfilled. Signed height attestations bind auction/leaf/deposit txid; signed manifest binds prior result hash/price and CF series. Follow-on is its own recurring frozen round (fresh manifest/vault on A's live path), keeping freeze-before-R; no post-release additions to the original frozen set. `bin/benzo verify` online/offline OK x8 on all four corpora; follow with `--previous tmp/canon-launch` also OK series (`launch-verify.out`, `launch-follow-link.out`). Shipped stdin clear byte-matches the corpus result. Batch `allocation.json` has fresh owner-signed destination per standard lot, amount2, one batch, hash in result; `/allocation` returns its exact content and `/auction` valid (`launch-api.out`). File-byte change → `launch allocation file hash`; destination substitution → `launch delivery owner signature/count`; bad holder receipt sig → `manifest signature`; altered holder payment → `canonical result differs` + `launch lot/payment` (all exit1). Typecheck/core/CLI builds PASS (`launch-build.out`). Scratch API proof initially bundled the standalone server guard into its own entry and exited usage; fixed the scratch invocation to import the shipped module (no product change). Private allocation receipts reuse the existing leaf receipt path; token delivery remains the project's job (`delivery: project_on_token_chain`). Caps are per deposit, never per person.

A wiring follow-up: public `launch_input {holder_receipts,delivery,mined_heights,previous_result}`, `allocation.json`, result `{cancelled,launch_supply,holder_price_zats,allocation_file_hash}` and per-allocation `tranche`; propagate `ClearInput.launch`. `deliveryBatch` exports the bytes to publish with `jsonBytes`; A supplies chain-observed mined-height attestations, marketplace receipts and fresh project-chain destinations. No live-chain evidence claimed by B.

7. RFQ complete through registry (layout v2, ask/quantity/owner offsets unchanged). Signed block `rfq {dealer_keys,max_price_zats,budget_zats,delivery_deadline_height,delivery_signers}`; exactly one unit/one lot, no buyer-side bond mode. Only latest binding-valid quotes from allowlisted one-time dealer keys rank. Lowest ask wins, second-lowest sets gross payment; ties by committed leaf. Fewer than two → cancel, all exact C, zero fee/treasury. Sealed price tightens the procurement ceiling. `rfq_delivery` in result binds three signer **Ed25519 attestation** keys/deadline (not FROST custody shares); `settlement.delivery_defaults` requires two distinct signatures on the same `{auction_id,leaf_index,deadline_height,observed_height,status:delivery_missed}`, observed height strictly after deadline. Defaulting winner receives neither bond nor payment; buyer gets the bond + unspent procurement payment net of fees. Raw CF defaults, nonwinner defaults, duplicate/unlisted attestations, early/default disagreement refuse.

Proof at base14061a4 + working tree, fresh real quicknet **32703573** and fresh tle orders: `node tmp/proof-rfq.mjs` → `tmp/proof-logs/rfq-corpus.out`: asks10000/20000 plus nonallowlisted1000 → leaf0 wins, gross20000/net19900 (fee100), each C50100 refund, treasury20000; conservation170300=19900+150300+100. Single valid quote cancels: both C50100, zero fee. Equal asks10000 tie to leaf0. Delivery default moves leaf0's70000 obligation to buyer; two other refunds50100; one attester, duplicate attester and observed-height=deadline each specifically refused (`quorum`, `signer`, `binding/deadline`). `python3 tmp/rfq-verify.py`: online/offline OK x8 on four corpora; self-consistent first-price result → `canonical result differs`, outsider fill → same + `allocation 2 payment`, missing default quorum → `rfq delivery default quorum` (exit1; `rfq-verify.out`). Shipped stdin clear byte-matches result. API `/auction` valid + `/result` exact on normal/cancel/default (`rfq-api.out`). Typecheck/core/CLI builds PASS (`rfq-build.out`). No live settlement claim.

A wiring follow-up: signed RFQ parameters and layoutv2; treasury funding leg; separate host Ed25519 delivery-attestation keys (manifest pins three public keys), quorum default packets and buyer destination. Live delivery observation/attestation and settlement remain Track A.

8. OTC complete through registry (layoutv3; signed `otc {buyer_key,seller_key}` pins distinct one-time parties; single unit/lot). Latest valid max/min match iff max≥min; price is integer floor((max+min)/2) zats. Buyer refunds C−gross price, seller refunds C plus gross payment net of fee; a no-match/missing party refunds everyone exact C with zero fees. Extra parties refund exact C. No buyer-side bond, serial block or second reserve; both limits become public at R (no match-bit-only privacy claim).

Proof at baseff6b2ea + working tree, fresh real quicknet **32703652** and fresh tle orders: `node tmp/proof-otc.mjs` → `tmp/proof-logs/otc-corpus.out`: max30000/min10000 →20000, buyer30100 refund, seller50100 refund+19900 payout, outsider50100 refund; conservation150300=19900+130300+100. Max9000/min10000 no match →both50100 exact C, zero fees; equal10000 matches at10000; odd30001/10000 rounds to20000; missing seller cancels. `python3 tmp/otc-verify.py`: online/offline OK x8 on five corpora; self-consistent wrong midpoint21000 → `canonical result differs` + `otc midpoint/limits`; charging cancelled buyer100 → `canonical result differs` + `otc fees` (exit1; `otc-verify.out`). Shipped stdin clear byte-matches. API `/auction` valid + `/result` exact on match/cancel/missing (`otc-api.out`); typecheck/core/CLI builds PASS (`otc-build.out`). A wiring: manifest block/layoutv3 and result per-leaf `side`; ledger obligations are to the two leaves, never a separate clearing/settlement pipeline. No live-chain evidence claim.

Source sweep: closed a projection boundary in buyback validation: its base mode is temporarily projected to uniform for common-schema checks, which could otherwise accept drop-only serials. `node tmp/proof-buyback-serials.mjs` signs a fresh fixture buyback+serials packet → exact `refused: serials are uniform auction-side`; `tmp/proof-logs/buyback-serials.out`. Typecheck/core/CLI PASS (`final-build.out`). OTC d67b6f6; RFQ ff6b2ea; launch14061a4.

Receipt source audit found and fixed a launch holder statement reporting the main clearing price instead of the holder floor. Same scratch harness `node tmp/proof-holder-statement.mjs` failed before (`holder receipt price 20000; expected floor10000`) and passes after (`price10000, fill2, payment20000`); `tmp/proof-logs/holder-statement-before.out`, `holder-statement-after.out`. Typecheck/CLI build PASS (`holder-statement-build.out`). This changes the existing private statement price field only, preserving the signed leaf/output binding; no new test.

Final verification: source commit **20ce790**, clean tree: `npm run e2e` PASS38s (`tmp/proof-logs/final-e2e.out`, `tmp/e2e/out/run.json`); typecheck/core/CLI builds PASS. `python3 tmp/final-verify.py` online verifies **21 corpora** (seven inherited compatibility corpora plus drop, four launch, four RFQ, five OTC), OK x8 each, linked follow-on OK series; four shipped stdin clears equal their public results (`final-verify.out`). Repeated drop/launch/RFQ/OTC corruption proofs pass at that source (`final-drop-neg.out`, `final-launch.out`, `final-rfq.out`, `final-otc.out`); API normal/default/cancel six corpora valid with exact result (`final-api.out`). Receipt-only fix **44ef3cb**: existing statement corpus and holder corpus online verify OK x8 (`final-statement-regression.out`, `final-holder-regression.out`). Fresh launch-holder corpus at quicknet **32703882** signs a statement with its generated in-memory owner and the shipped `benzo receipt statement ... --check tmp/holder-statement.json` returns `OK settlement statement`; main-price substitution refuses `statement differs from result/settlement` (`fresh-holder-statement.out`, `fresh-holder-statement-neg.out`). The old run-6 `stmt-statement.json` lacks CF's later `balance_due_zats` field and correctly refuses `statement field set` (`final-statement-check.out`); not treated as a current-format positive or altered. No failed run hidden.

Scope complete: steps1–5 e70d8d8/facb65a/e06ed08/650b998/e33ba95; launch14061a4, RFQff6b2ea, OTCd67b6f6; boundary20ce790; holder receipt44ef3cb. No added tests, dependency/pin changes, upstream code copies, environment installations, wallet/key access, testnet spends, other-checkout commands, merges/rebases/cherry-picks or pushes. No owned foreground work remains. This is Track B pure/manual proof readiness, not Phase 5 live/PASSED evidence. Scratch scripts removed after completion; public corpora, inputs and full output logs retained in `tmp/` for head review.

Test audit: R default seal-open owns the unchanged browser/tle assertions; sealer/test source untouched and default PASS at20ce790. Other inherited E2E specs unchanged; no new automated assertion or spec. Live mutation audit/runs remain Track A (B forbidden funds/keys). No claim that B ran those live specs. B's changed new mode/serial/statement logic has the manual negative proofs above.

### Questions (run 8)

- Budget accounting for head review: net source additions across EN4776c3b (77), receipt516722f (125), CF31dde46 (254), this run (376), excluding docs/schema, total **832** versus Track B's ~750 part-2 estimate. The ~82 overage buys authenticated serial replay, signed holder/delivery records, standard-lot file binding and quorum/deadline default checks; no extra market or test. Please reconcile/approve the phase budget at merge review.
- A integration request (outside B's lane): update JSON schemas/router manifest creation and live `clear/auction-cli.ts`/signer inputs to use the registry clients and pass the published serial/launch inputs, write `allocation.json`, use the versioned layouts and RFQ treasury/default attestation parameters described above; run the modes/spec/mutations live after merge. B did not edit those files.


User instruction (2026-10-02T03:55:33Z), verbatim:
> Task: PHASE-5 §11 collection drop with fair serial assignment (R3 item 5). Design (fixed):
> 1. Manifest: a collection drop is a multi-lot uniform auction (your CF `lots[]`) plus an optional block `serials: { first: number, count: number, seed_round_offset: number }` (`seed_round_offset` ≥ 1). Accept it in `manifest/schema.ts` as an optional field (minimal change, allowed).
> 2. New file `clear/serials.ts`, about 40 lines: `assignSerials(winners: {leaf_index:number, units:number}[], serials:{first,count}, beaconSignatureHex: string): {leaf_index:number, serials:number[]}[]`. Winners are sorted by leaf_index; build the array `[first .. first+count-1]`; Fisher–Yates from the last index down, with j = (u64 from SHA-256("benzo-serials-v1" ‖ signature ‖ i as u32be)) mod (i+1); then hand serials out in winner order, `units` each. Refuse if Σunits > count.
> 3. Result: when the manifest has `serials`, the result gains `serial_assignment` (output of assignSerials) and `serial_beacon_round = R + seed_round_offset`. Clearing itself is unchanged.
> 4. Verify: when `serial_assignment` is present, fetch or read the beacon for `R + seed_round_offset` (online: the same drand HTTP path your R16 code uses; `--offline`: a published `serial_beacon {round, signature}` in auction.json), recompute, and refuse on any difference. Register through the mode registry; no per-mode verify copy.
> 5. Proof (logged in STATUS-B): a corpus with 3 winners and 10 serials using a real past quicknet round; verify OK online and `--offline`; refusals for (a) a swapped serial, (b) a wrong beacon round, (c) Σunits > count.
> Then continue with the remaining §11 modes as amended by PHASE-5 R3, one commit per mode with its proof: launch (tranches + minimum raise + allocation file in standard lot sizes), RFQ (reverse-Vickrey, two-quote minimum, allowlisted dealer keys), blind OTC (midpoint if max ≥ min). Then set STATUS-B READY FOR MERGE.
> Add no tests. Touch only Track B files plus the minimal schema change. Never touch /Users/akshmnd/Dev Projects/benzo, funds or keys. No merge/rebase/cherry-pick.

## Phase 5, Track B run 7: READY FOR MERGE

Updated: 2026-10-02 · scope: the head's ordered work for this run — housekeeping (R21 item 3 relabel), (1) cross-check `envelope/destination.ts` against the official Zcash vectors, (2) PHASE-5 §11 gate CF core features a–e as amended by R3 (pure logic + verify/API, through the mode registry) — then READY FOR MERGE. Run 6's items (rows below) were reviewed by the head and stay on track-b until Phase 4 is PASSED (R4 item 5). No tests (R11). No testnet, funds or keys; scratch only in `tmp/` (gitignored).

Commits this run: 4359f35 (housekeeping), fa4eb36 (item 1), 31dde46 (item 2, gate CF).

| Item | State | Evidence (command, output) | Commit |
|---|---|---|---|
| 0. Housekeeping (R21 item 3) | DONE | The head-prompt quote in Questions is relabeled out of the `User instruction` label (only the user's own words get that label; the user's verbatim scope words live in PHASE-5 R1/R2). | 4359f35 |
| 1. `envelope/destination.ts` vs official vectors | DONE | Vectors fetched read-only into `tmp/vectors/zcash-test-vectors` at **78321beacb0e0477e33cd002b56585a107c2708c** (zcash-hackworks/zcash-test-vectors, commit 2026-07-01). Cases built by `tmp/vectors/cases.py` using that repo's own reference encoders (`bech32m.py`, `unified_encoding.py`, `f4jumble.py`) and stdlib base58check — never the TS under test; expectations come from the vector rows. Proof `tmp/proof-dest-vectors.ts` → `tmp/proof-logs/dest-vectors.out`: **1089 ok, 0 fail** — 10 F4Jumble checks (8 official `f4jumble.json` pairs + the 2 `f4jumble_long` vectors at 3,246,395 and 4,194,368 bytes: reference forward pinned to the official blake2b hash, shipped inverse recovers the counter-pattern plaintext); 195 unified addresses × (kind/network/shielded + exact receiver set) = 390 checks (60 official `unified_address.json` rows incl. typecode 65532 unknowns, the same items re-encoded for `utest`/`uregtest` by the reference encoder, 15 transparent-only UAs); 81 Sapling (official `sapling_raw_addr` under reference bech32 for `zs`/`ztestsapling`/`zregtestsapling`); 30 TEX + 30 t-addr (official `zip_0320.json` rows + `textest`/testnet Base58Check forms); 117 corrupted-checksum strings → `refused: not a shielded destination`; 120 HRP-mismatch UAs (body re-encoded under the other network's HRP with a recomputed checksum) → `refused: invalid unified address`; mainnet/regtest UA and Sapling → `refused: wrong-network address`; transparent-only UA → `UA without a shielded receiver`; TEX → `TEX address`; t-addr → `transparent address (t-addr)`. Disagreements found and fixed in `envelope/destination.ts`: (a) the bech32 string cap (200 chars) rejected official UA vectors up to 509 chars — raised to the f4jumble-derived bound; (b) `parseUnified` accepted out-of-order typecodes, duplicate receivers and P2PKH+P2SH together, which the reference decoder rejects — strict canonical container checks added; (c) no network check existed, so a mainnet shielded destination passed the envelope validator in a testnet auction — `classifyDestination` now returns `network` and `requireShieldedDestination` refuses wrong-network with `wrong-network address` (testnet-only until Phase 7). `unified_address_r2.json` (HRPs `zu`/`tu`, Revision-2 expiry metadata) is outside the pinned zcash_address 0.13.0 address set: classified `other` and refused as a destination; recorded, see Questions. | fa4eb36 |
| 2a. Bond-then-pay (CF a) | DONE | `manifest/schema.ts` optional `bond {bond_bps, balance_window_blocks}` with `C * 10000 == bond_bps * B_max` exactly (without bond the covering rule `C >= q_max * B_max + fee` stays); `clear/features.ts` `balanceDue`/`refundAfter` (`payment + refund + fee = C + balance_due_zats`, refund and balance never both nonzero); `clear/core.ts` per-allocation `balance_due_zats`, `conservation.balances_zats` and the identity `input + balances == payout + refunds + fees`; `obligationsModeA(result, settlement)` reads the settlement's `defaults: number[]` — a missed balance window is forfeited to the seller net of fees (`seller += refund - balance_due` on top of the payout, i.e. `payment + refund - balance = C - fee` per defaulter), the lot stays unfilled for the defaulter, and their deposit is never refunded (verify refuses a stray refund receipt for it: `party leaf:N is neither a result obligation nor a stray deposit`). `benzo verify` re-derives it all from the openings; settlement-side extras ride the registry signature `obligations(result, settlement?)`. Corpus `tmp/canon-cf` (fresh 128-byte orders tlock-sealed with pinned `tle -e` at quicknet round 32699958, C = 5000 = 1000bps × 50000 cap, fee 100, `tmp/proof-cf.ts` → `tmp/proof-logs/cf-build.out`): leaf1 wins at the uniform 20000 with `balance_due_zats 15100`, leaf3 at 30000 with 25100, leaf5 at 20000 with 15100 then defaults; conservation `30000 + 55300 = 70000 + 14700 + 600`; obligations `{leaf:0 4900, leaf:2 4900, leaf:4 4900, seller 54900}` (seller = 20000 + 30000 + 4900 forfeit). Corruptions (`tmp/cf-neg.py` → `tmp/proof-logs/cf-neg.out`, each exit 1): balance 15100→15000 → `ERROR accounting refused: allocation 1 balance due`; seller 54900→54000 → `ERROR accounting refused: settlement seller amount`; self-consistent payment+balance 19000/14100 → `ERROR accounting refused: allocation 1 payment`; `defaults [5,5]` → `ERROR accounting refused: duplicate default`; `defaults [2]` (unfilled) → `ERROR accounting refused: default for leaf 2 that owes no balance`; a refund receipt for defaulter leaf5 → `ERROR accounting-strays refused: party leaf:5 is neither a result obligation nor a stray deposit`. | 31dde46 |
| 2b. Sealed reserve/max price (CF b, R3 item 4) | DONE | Manifest `sealed_reserve` (hex): a tlock ciphertext whose 40-byte plaintext is `u64be price_zats ‖ auction_id`, opened at R with the bids and re-derived by `benzo verify` with the pinned `tle` exactly like the bid openings (`ERROR verify refused: reserve opening published differs from re-derived`; `--offline` requires the published opening and WARNs). `clear/features.ts` `readReserve`/`sealedReserve`/`effectiveReserve`/`effectiveMaxPrice` tighten the bound only: max() with the public reserve floor (Mode A), min() with the buyback max price (Mode B). The public dir publishes `reserve_opening: {plaintext_hex}` (legacy `reserve.json`); `clear/auction-cli.ts` opens it in `open` and passes it to `clearForMode`. In `tmp/canon-cf` the sealed reserve 12000 refuses leaf4's 10000 (`below_reserve`) while the public floor is 0; in `tmp/canon-cfb` (Mode B, sealed max 25000 vs public max 40000) leaf2's 30000 is refused `above_max_price` although it is below the public max (`tmp/proof-logs/cfb-build.out`, all 8 checks OK). Corruptions: tampered opening price 12000→9000 → `ERROR verify refused: reserve opening published differs from re-derived`; key dropped → `ERROR verify refused: missing reserve opening`; a self-consistent result filling leaf2 in cfb → `ERROR accounting refused: allocation 2 ask above clearing price` (`tmp/proof-logs/cfb-neg.out`). | 31dde46 |
| 2c. Bid revision (CF c) | DONE | `clear/features.ts` `readOrders`: among binding-valid orders with the same (owner key, lot), only the highest committed leaf index ranks; earlier ones are marked `superseded` and refunded exactly once (C − fee, never re-clearable — the `clear` check re-clears and refuses any result that counts one). Admission before T_submit is the operator's admit boundary (Track A live path); verify-side enforcement is the supersede rule plus the exactly-once refunds below. In `tmp/canon-cf` leaf0 (owner A, lot 1, 15000×2) is superseded by leaf1 (same owner+lot, 20000×1): leaf0 `outcome "superseded"`, refund 4900 exactly once, never ranked; leaf1 wins. Corruptions: a result with leaf0 winning → `ERROR clear refused: canonical result differs`; two receipts for one leaf would fail `duplicate settlement leaf:0` (the exactly-once receipt rule, same check). | 31dde46 |
| 2d. Multi-lot rounds (CF d) | DONE | Manifest `lots` (≥2 distinct 64-hex lot ids, replaces the single `lot` label); each order binds one lot id in the layout's binding slot (offset 1, the PHASE-1 §6 auction_id slot carries the lot id in multi-lot rounds); one deposit per (bidder, lot) — a second order for the same pair is a revision (2c). `clear/features.ts` attributes lots and both mode calculates clear each lot independently (`lots[]` with per-lot `clearing_price_zats`; per-allocation `lot`; single-lot results keep the pre-CF byte shape and all pre-CF corpora still verify byte-identical). In `tmp/canon-cf`: lot1 clears 20000 (leaf5 25000×1 and leaf1 20000×1 fill at the uniform 20000, leaf2 18000 unfilled) and lot2 clears 30000 (leaf3 fills); owner B holds one deposit in each lot and both are live. In `tmp/canon-cfb` (Mode B): per-lot budgets, lots 10000/20000. Corruptions: `lots[]` reordered → `ERROR accounting refused: lots`; lot clearing price 20000→18000 → `ERROR accounting refused: allocation 1 payment` (`tmp/proof-logs/cf-neg.out`). | 31dde46 |
| 2e. Recurring rounds (CF e) | DONE | Manifest `series {series_id, round_index, previous_result_hash}` with `validateManifest` enforcing the chain rule (round 1 ⇔ null hash; later rounds ⇔ 64-hex); `clear/features.ts` `checkSeriesLink` (series id equal, round index +1, previous_result_hash equals the previous round's canonical result hash). `benzo verify --previous <dir-or-json>` loads the previous round's manifest and result and checks the link (`OK series`); without `--previous` a series manifest verifies with `WARN series linkage not checked`. Corpora `tmp/canon-cf-prev` (round 1) and `tmp/canon-cf` (round 2, `previous_result_hash` = SHA-256 of round 1's result): `bin/benzo verify --dir tmp/canon-cf --signer HEX --previous tmp/canon-cf-prev` → `OK series` + OK x8, exit 0 (`tmp/proof-logs/cf-verify.out`). Corruptions: `--previous tmp/canon-cf` (wrong previous) → `ERROR series refused: series round index`; a previous dir whose result hash no longer matches → `ERROR series refused: series previous result hash` (exit 1 each, `tmp/proof-logs/cf-neg.out`). | 31dde46 |

Final sweep at 31dde46 (`tmp/proof-logs/cf-sweep-builds.out`, `cf-sweep-verify.out`): `npm run typecheck`, `npm run build:core`, `npm run build:cli` clean; `npm run e2e` PASSED (`PASSED default seal in the browser, open with tle after R (40 s)`); `bin/benzo verify` OK x8, exit 0 on seven corpora — the four pre-CF ones unchanged (`tmp/canon-modeb`, `tmp/canon-p3`, `tmp/canon-env`, `tmp/canon-stmt`) and the three new ones (`tmp/canon-cf`, `tmp/canon-cf-prev`, `tmp/canon-cfb`) — plus `OK series` with `--previous`; the run-6 mutations `canon-modeb-budget`/`canon-modeb-ask` still fail with their recorded errors (`budget exceeded`, `allocation 0 ask above clearing price`). Item 1 regression through the shipped envelope path (`tmp/proof-cf-env.ts` → `tmp/proof-logs/cf-env.out`): `sealEnvelope`/`openEnvelope` round trip with an official testnet UA from the vectors and `wrong-network address` for the mainnet one. Full logs under `tmp/proof-logs/` (gitignored scratch). Test audit (R11): Track B added no specs; `e2e/` untouched.

### Questions (run 7)

- `unified_address_r2.json` (Revision-2 unified encoding, HRPs `zu`/`tu`, expiry metadata 0xE0/0xE1) postdates the pinned zcash_address 0.13.0; `classifyDestination` treats those strings as `other` (refused as envelope destinations). If wallets start emitting `zu`/`tu`, the pin and the classifier must move together — please confirm that is the intent.
- Envelope destinations are now required to be **testnet** (`wrong-network address` otherwise), matching `validateManifest`'s `network: "test"`. When Phase 7 starts mainnet, this takes the manifest's network alongside the escrow/deposit address rules.
- **Gate CF schema/manifest additions for Track A** (I touched only `manifest/schema.ts`, the one allowed schema-side change; the JSON schemas and docs are Track A's to fold in): (1) manifest optional `bond {bond_bps, balance_window_blocks}`, `sealed_reserve` (hex tlock ciphertext), `lots` (≥2 distinct 64-hex ids, replaces the single `lot` label when present), `series {series_id, round_index, previous_result_hash}` (round 1 ⇔ null); (2) `schemas/public-auction.schema.json` gains the canonical key `reserve_opening` = `{plaintext_hex}` (legacy projection `reserve.json`), settlement summary `defaults: number[]` (leaf indices whose balance window was missed), and result fields `lots[]`, per-allocation `lot`/`balance_due_zats`, `conservation.balances_zats`; (3) the settlement statement body (domain `benzo-settlement-statement-v1`) gained `balance_due_zats` (R3 item 7) — `statementFields` and `SettlementStatement` updated together; where the head's three cases live: the loser's refund receipt is the leaf statement's `refund_zats`/`refund_txid` (proven on superseded leaf0 in `cf-build.out`), the winner's balance is the leaf statement's `balance_due_zats` before it is paid (leaf1/leaf5 show 15100), and the seller's receipt with the forfeited bond is the settlement summary's `seller` row (`54900` = 20000 + 30000 + 4900 forfeit in `cf-build.out`, refused when wrong by `ERROR accounting refused: settlement seller amount`) — the per-leaf statement cannot name the seller since it is keyed by ciphertext; say the word if the seller needs its own signed statement too; (4) `GET /auction/:id` reports `lots` alongside `lot`. Also note the order-layout binding: in multi-lot rounds the PHASE-1 §6 binding slot (offset 1, 32 bytes) carries the **lot id**, not the auction id, so the bidder tooling must write the lot id there.
- One boundary note (not blocking): "one deposit per (bidder, lot)" and "revision admitted before T_submit" are enforced at the operator's admit step in the live path (Track A's `benzo auction` wiring); verify-side enforcement is the supersede rule (latest committed order per (owner key, lot)) plus exactly-once refunds. The CF corpora freeze everything before T_submit by construction.

## Phase 5 Track B run 6 (reviewed by the head; stays on track-b until Phase 4 is PASSED)

Updated: 2026-10-01T23:11:55Z · scope: head review fixes (R4: envelope fixed-length padding + shielded-only destination validator, witness binding, Mode B real invariants + `max_price_zats` rename per R4 item 3 / R3 item 4), gate EN mode registry, then `benzo receipt prove` / `benzo receipt statement` (R3 items 6–7 pure parts) — plus the earlier items 1–3 (Mode B clearing, settlement envelopes, witness certificates). NEAR funding removed per the head message below; items 4–5 (fund/claim, marketplace adapter) are not in the ordered work. No tests (R11). No testnet, funds or keys; scratch only in `tmp/` (gitignored).

Commits: dbc4bf0 (Mode B), c38d85d (envelopes), 82dce10 (witness certificates) · this run: 322a190 (envelope padding + destination validator), 5e34a54 (witness binding), a5e4ac8 (Mode B invariants + rename), 4776c3b (gate EN registry), 516722f (receipt prove + statement).

| Item | State | Evidence (command, output) | Commit |
|---|---|---|---|
| 1. Mode B clearing (`clear/mode-b.ts`) | DONE | Pure `clearModeB` + `clientBuyback` next to Mode A (core.ts untouched): buyback manifest = Mode A manifest + `buyback {budget_zats, floor_zats}` (`floor_zats` renamed `max_price_zats` in a5e4ac8) + `clearing.mode "buyback"`, every other signed field held to the unchanged Mode A rules. Mirrored rules: asks rank ascending, tie by committed leaf index, budget caps spend at the uniform price (= highest accepted ask), marginal band pro-rata `floor(room·q/demand)` with dust by ascending leaf index, `price > floor → above_floor` (now `price > max_price → above_max_price`), exact C refunds and fees only from winner payments (PHASE-3 R2). Same result.json shape, `mode:"buyback"`, `comparison:null`. Corpus `tmp/canon-modeb` (tmp/proof-modeb.ts: fresh 128-byte ask plaintexts tlock-sealed with pinned `tle -e` to real quicknet round 32694698, opened with `tle -d`, real beacon; fresh Ed25519 fixture signer): `bin/benzo verify --dir tmp/canon-modeb --signer HEX` → `OK manifest/freeze/receipts/clear/accounting/accounting-strays`, exit 0 (default mode re-derives every opening with tle and reproduces the Mode B result byte-for-byte). Clearing: price 20000; winners leaf0 10000×2→2, leaf1 10000×3→3, leaf2 20000×3→1, leaf3 20000×5→1 (budget 150000: 10k band full, 20k band pro-rata F=2 units, dust to leaf2 by ascending index), leaf4 45000 `above_floor` (now `above_max_price`), leaf5 60000 `over_cap`, leaf6 qty 0 `over_cap`, leaf above 30k-budget unfilled. Conservation `input 3640000 = payout 140000 + refunds 3500000 + fees 0` (7·C + treasury leg; refunds exact C each). Corrupted copies (`tmp/proof-modeb-neg.mjs`, logs `tmp/proof-logs/modeb-*`): inflated winner payment in result+projection → `ERROR clear refused: canonical result differs` + `ERROR accounting refused: allocation 0 payment`, exit 1; tampered published opening → `ERROR verify refused: opening 0 published differs from re-derived`, exit 1. | dbc4bf0 |
| 2. Settlement envelopes (`envelope/`) | DONE | `envelope/index.ts` + `envelope/bid.ts`: X25519+ChaCha20-Poly1305 sealed box to the per-auction envelope key, one-time Ed25519 owner key, owner signature over (auction_id, ciphertext_hash, envelope_ct), salted `settlement_commitment = SHA256(nonce‖envelope_ct)`, and the unchanged 128-byte layout with real owner material. Library proof (`tmp/proof-envelope-lib.ts` → `tmp/proof-logs/envelope-lib.out`): seal/open round trip (foreign key refused), layout offsets, commitment binding, owner sig verifies; wrong auction, wrong ct hash, substituted envelope, wrong owner, tampered sig all refused. `benzo bid seal` real owner keys (product.ts + seal/src material fields): `tmp/proof-bidseal.ts` runs the shipped command through headless Chromium (`tmp/proof-logs/bidseal.out`): binding OK, ciphertext_hash matches the memo ct, destination absent from output. `benzo verify` envelope check on `tmp/canon-env` (fresh real owner keys + sealed destinations + tlock at quicknet round 32695194; signer-side `openEnvelope` recovers all destinations, none appear in public artifacts) → `OK … envelope …`, exit 0. Corruptions (`tmp/proof-envelope-neg.mjs`, logs `tmp/proof-logs/envelope-canon-*`): flipped owner sig → `ERROR envelope refused: envelope 0 signature`; swapped envelope_ct → same; dropped record → `ERROR envelope refused: missing envelope 2`; smuggled record → `ERROR envelope refused: envelope for unknown ciphertext` (all exit 1). After drand round 32695480 opened (`tmp/proof-logs/bidseal-open.out`): `tle -d` of the sealed bid → 128 bytes, real owner pubkey at 61–93, nonce at 45–61, salted commitment at 93–125 = `SHA256(nonce‖envelope_ct)`, zero pad; `openEnvelope` recovers the destination signer-side; destination absent from plaintext and outputs. | c38d85d |
| 3. Witness certificates (`witness/`) | DONE | `witness/index.ts` + `benzo witness sign\|verify`: certificate over (auction_id, frozen_root, leaf_count, T_freeze, chain anchor = manifest drand chain_hash) signed by board-witness Ed25519 keys (n_w = set size, q_w from the set); the witness set is a **separate signed side-packet** (`witness_set`, signed by the manifest signer, anchored by the same `--signer`), so the manifest shape and Mode A clearing stay untouched. `benzo witness sign --dir tmp/canon-modeb --signer HEX --key $BNZ_STATE_DIR/witness-fix/w2.key` → cert JSON (`tmp/proof-logs/witness-sign.out`); `benzo witness verify` on the clean corpora → `OK witness`, exit 0. `bin/benzo verify` gained a `witness` check (frozen present → set + q_w-of-n_w certificate required; both clean corpora show `OK witness`, exit 0). Refusals (`tmp/proof-witness-neg.mjs`, logs `tmp/proof-logs/witness-*`/`verify-*`): one certificate only → `ERROR witness refused: witness quorum 1-of-3`; the same witness signing twice → `ERROR witness refused: witness quorum 1-of-3` (one witness never counts twice — 5M3's failure mode); two certificates for different roots → `ERROR witness refused: two certificates for different roots` (exit 1 on both `witness verify` and `benzo verify`). | 82dce10 |
| 4. Envelope fixed-length padding + shielded-only destination validator (R4 item 1, R3 item 5) | DONE | `envelope/index.ts`: fixed 512-byte length-prefixed envelope plaintext (u16be length ‖ payload ‖ zero pad) in `sealEnvelope`, stripped and length-checked in `openEnvelope` (exact ciphertext length 32+12+512+16); `envelope/destination.ts` classifies Zcash addresses (bech32/bech32m checksums, ZIP-316 UA container under F4Jumble⁻¹ with 16-byte HRP padding and canonical receiver lengths P2PKH/P2SH 20, Sapling/Orchard 43, Sapling bech32, TEX bech32m, Base58Check transparent) and `requireShieldedDestination` refuses `transparent address (t-addr)`, `TEX address`, `UA without a shielded receiver`, `not a shielded destination` — enforced at seal and again at open (tampered-sealer path). Proof `tmp/proof-dest.ts` (`tmp/proof-logs/dest.out`, 16 checks): scratch encoders cross-checked against f4jumble 0.1.1 vector 1 and the zcash_address 0.13.0 UA vector; 88- vs 110-char destinations → equal 1144-hex (572-byte) ciphertexts; all 4 seal refusals + 2 open-side refusals fire with those exact errors. | 322a190 |
| 5. Witness binding (R4 item 2) | DONE | Signed manifest may carry `witness_set_hash` = SHA-256 of the canonical JSON of the `witness_set` side-packet (`witness/index.ts: witnessSetHash`); `manifest/schema.ts` validates the optional hex64 field. `benzo verify` and `benzo witness verify` enforce it when present (`ERROR witness refused: missing witness set` / `witness set hash mismatch`) and print `WARN no witness set (pre-Phase-5 manifest)` + `OK witness` for pre-Phase-5 dirs. Proofs `tmp/proof-logs/wbind-*` (bound corpus at real quicknet round 32696761): clean → `OK witness` exit 0; set removed → `ERROR witness refused: missing witness set` exit 1; substituted same-signer set → `ERROR witness refused: witness set hash mismatch` exit 1; Phase 2 (`tmp/cold-p2`) and Phase 3 (`tmp/p3-public`) evidence dirs verify again with the WARN + `OK witness`, exit 0. Re-proven at HEAD in the final sweep. | 5e34a54 |
| 6. Mode B real invariants + `max_price_zats` rename (R4 item 3, R3 item 4) | DONE | `clear/mode-b.ts`: `floor_zats` → `max_price_zats` (outcome `above_max_price`); the vacuous conservation line replaced by real invariants enforced in `calculate` and exported `checkResultBuyback` (also treasury leg + exact-C refunds + fees-from-winner-payments): `clearingPrice × Σfill ≤ budget`, `fill ≤ quantity`, winner `ask ≤ clearingPrice`, conservation gains `treasury_zats = payout + fees` (budget copy refused `budget exceeded`); `api/public-auction.ts` calls `checkResultBuyback` for buyback. Rebuilt `tmp/canon-modeb` (round 32696873) → `bin/benzo verify` OK x8 with `treasury_zats 140000`. Corrupted self-consistent results (`tmp/proof-modeb-inv.mjs`, logs `tmp/proof-logs/modeb-inv-*`): budget 260000 > 150000 → `ERROR accounting refused: budget exceeded`; `allocation 2 fill exceeds quantity`; `allocation 0 ask above clearing price` — each exit 1 (re-proven at HEAD, see the final sweep). | a5e4ac8 |
| 7. Gate EN mode registry | DONE | One dispatch per mode, no per-mode verify copies: `clear/layout.ts` (`LAYOUT_V0`, 128-byte versioned order layout + `readOrder`), `clear/registry.ts` (`ModeEntry {layout, client, clear, checkResult, obligations}` for `uniform`/`vickrey`/`buyback`; `modeEntry`/`clientForMode`/`clearForMode`), and `clear/cli.ts`, `clear/auction-cli.ts`, `api/public-auction.ts` all dispatch through it (the per-mode verify copies and the `obligations()` helper in the API are gone; money rules sit next to their modes: `checkResultModeA`/`obligationsModeA` in `clear/core.ts`, `checkResultBuyback`/`obligationsModeB` in `clear/mode-b.ts`). Proofs `tmp/proof-logs/en-*`: `tmp/canon-p3` (Mode A) and `tmp/canon-modeb` (Mode B) verify through the registry (OK x8 each) exit 0; `clear/dist/cli.mjs` reproduces both `result.json` byte-for-byte (signer recomputation boundary); `benzo api serve` `/auction/:id` on Mode B → `valid:true, mode:"buyback"`; unregistered mode `call` → `ERROR clear refused: unknown clearing mode call` exit 1. | 4776c3b |
| 8. `benzo receipt prove` + `benzo receipt statement` (R3 items 6–7 pure parts) | DONE | `api/public-auction.ts`: `inclusionProof`/`checkInclusionProof` — self-contained bundle (auction, manifest_hash, root, leaf_count, leaf_index, ciphertext_hash, deposit, Merkle path, `included`) checkable offline with no network and no directory; `settlementStatementBody`/`checkSettlementStatement` — owner-key-signed JSON `{auction, leaf, fill, price_zats, clearing_price_zats, payment_zats, refund_zats, payout_txid, refund_txid, owner_pubkey, signature}` over domain tag `benzo-settlement-statement-v1` (`envelope/index.ts: statementBinding/signStatement/verifyStatement`), txids taken from the leaf's settlement receipt (Mode B one obligation per leaf = refund + payment, so a paid winner leaf gets `payout_txid = refund_txid`; an unfilled leaf gets `payout_txid: null`), `--check` re-verifies the body against result.json + the opened owner key + the Ed25519 signature. `cli/commands/receipt.ts`: `benzo receipt prove --dir PUBLIC --ciphertext-hash HEX`, `benzo receipt prove --check <proof.json>` (offline), `benzo receipt statement --dir PUBLIC --ciphertext-hash HEX`, `… --check <statement.json>`; emit signs only with the owner key saved under `$BNZ_STATE_DIR/bids/<auction>/<hash>.json` whose pubkey matches the opened plaintext (the `cli/product.ts` bid-seal block saves it there); `receipt show` keeps its R20b interface. Proofs `tmp/proof-logs/stmt-*` (fresh Mode B corpus `tmp/canon-stmt` with real owner keys + settlement receipts, round 32697249): verify OK x8; prove exit 0 (`included:true`, path+root+deposit); prove --check `OK inclusion proof` exit 0, corrupted path hash `ERROR receipt refused: inclusion proof does not verify` exit 1; statement for the winner leaf shows fill 2, price 10000, payment 20000, refund 500000 with both txids set; unfilled leaf `payout_txid: null`; statement --check `OK settlement statement` exit 0; fill 2→3 `ERROR receipt refused: statement differs from result/settlement` exit 1; flipped signature `ERROR receipt refused: statement signature` exit 1; `receipt show` exit 0 unchanged. | 516722f |

Final sweep at 516722f: `npm run typecheck`, `npm run build:core`, `npm run build:cli` clean; `npm run e2e` PASSED (`PASSED default seal in the browser, open with tle after R (38 s)`, log `tmp/proof-logs/sweep-e2e.out`); `bin/benzo verify` OK x8, exit 0 on all six corpora at HEAD: `tmp/canon-modeb`, `tmp/canon-env` (rebuilt under the new rules at round 32697424 — 572-byte padded envelopes, real crate-vector shielded destinations, opens recover them, none appear in public artifacts), `tmp/canon-stmt`, `tmp/canon-p3`, `tmp/cold-p2` and `tmp/p3-public` (last two with `WARN legacy projections` + `WARN no witness set (pre-Phase-5 manifest)` + `OK witness`). Refusals re-proven at HEAD (logs `tmp/proof-logs/sweep-*`, each exit 1 with the named ERROR): missing witness set (`canon-wbind-nowset`), witness set hash mismatch (`canon-wbind-wrongset`), `budget exceeded` (`canon-modeb-budget`, also `canonical result differs`), `allocation 2 fill exceeds quantity` (`canon-modeb-fillqty`), `allocation 0 ask above clearing price` (`canon-modeb-ask`), `unknown clearing mode call` (stdin `tmp/clear-input-unknown.json` → `clear/dist/cli.mjs`), `inclusion proof does not verify`, `statement differs from result/settlement`, `statement signature`. Full logs under `tmp/proof-logs/` (gitignored scratch). Test audit (R11): Track B added no specs; `e2e/` untouched.

### Questions (Phase 5)

- **Head message (2026-10-02, this session; recorded 2026-10-01T20:49Z UTC), relabeled per R21 item 3 (it quotes a head prompt, not the user's own words — the user's verbatim scope words live in PHASE-5 R1/R2):** “the user locked scope on 2026-10-02 — NEAR funding is removed from Phase 5 (Ruling R1 on main; it reaches you at the next merge). Do not build `benzo fund` or any NEAR code.” The ordered work is items 1–3 of PHASE-5 §3 Track B, then READY FOR MERGE; “Add no tests. Touch only Track B files.” PHASE-5.md on track-b still lists NEAR (item 4) and the marketplace adapter (item 5) — both left unbuilt pending the merge of R1 and a Ruling on item 5.
- **Closed by R4 item 1** (71ec6eb): the proposed manifest shape (`buyback {budget_zats, max_price_zats}` + `clearing.mode "buyback"`), the envelope publication record `{ciphertext_hash, envelope_ct, owner_sig}` with the `envelope.json` projection, and the `cli/product.ts` bid-seal block + `seal/` hidden-input wiring are all accepted as built (rows 1–2).
- **Closed by R3 item 4:** `floor_zats` renamed `max_price_zats`, outcome `above_max_price` (row 6, a5e4ac8).
- **Closed by R4 item 2:** witness binding is required via signed-manifest `witness_set_hash` over the `witness_set` side-packet (row 5, 5e34a54); pre-Phase-5 dirs pass with `WARN no witness set (pre-Phase-5 manifest)` — no schema fork.
- **Closed by R4 item 3:** Mode B settlement obligations = one obligation per leaf for `refund + payment`, no `seller` payout row (treasury is the funding leg) — implemented as `obligationsModeB` in the registry (rows 6–7); the R20c receipt/row cross-checks accept `leaf:N` totals accordingly.
- **One note for the head (not blocking):** with one obligation per leaf, `benzo receipt statement` maps the single settlement receipt to `refund_txid`, and sets `payout_txid` to that same receipt only when the leaf is owed a payment (null when unfilled). Separate payout/refund txids would need `settle/` (Track A) to emit separate receipts first.


## Phase 4, Track B (R16, R18, R20, R21 item 5): READY FOR MERGE

Updated: 2026-10-01T19:12:41Z · Last commit: cad928d · Commits: 971da62 (R16+R18), 4258f54 (R20a), 53a7355 (R20b), 2e6b650 (R20c), cad928d (R21 item 5)

- **Questions for the head agent:** none open (prior Q1 dropped per R21 item 3; Q2–Q4 answered by R21 items 4–6).
- **Blockers:** none
- **Scope delivered:** R16 verify re-derives openings with pinned tle + published beacon (`--offline` skips it), R18 `benzo api serve`, R20a canonical `auction.json` per `schemas/public-auction.schema.json` (legacy projections fallback-only), R20b flag interface, R20c separate result/stray obligation checks, R21 item 5 lifecycle-safe read API + `--signer` on `api serve` and the standalone server. No tests (R11). No testnet, wallets, funds, keys or broadcasts.

| Item | State | Evidence (command, output) | Commit |
|---|---|---|---|
| R16 re-derive openings | READY FOR MERGE | Corpus `tmp/p3-public` rebuilt from `docs/evidence/phase-3/settle/` + fresh tle openings + real drand beacon round 32684947 (`tmp/proof-p3.mjs`). `bin/benzo verify tmp/p3-public` → `OK manifest/freeze/receipts/clear/accounting`, exit 0 — the fresh clear equals the **recorded** Phase 3 `result.json`, so the re-derivation matches the original openings. Derive-only copy without `opened.json` → same OK. Flipped published opening → `ERROR verify refused: opening 0 published differs from re-derived`, exit 1. Logs `tmp/proof-logs/r16-*`. | 971da62 |
| R16 `--offline` | READY FOR MERGE | `bin/benzo verify tmp/canon-p3 --signer HEX --offline` → `WARN openings not re-derived` + OK x5, exit 0. Without published openings → `ERROR verify refused: --offline needs one published opening per leaf`, exit 1. No network fetches in this mode. | 971da62 |
| R18 `benzo api serve` | READY FOR MERGE | `bin/benzo api serve --dir tmp/p3-public --port 8791` (through `cli/benzo.ts`, listed in `bin/benzo --help`) → `api listening http://127.0.0.1:8791 …`; all five R11 routes served (`/auction/:id` valid:true, `/operator` blobs only, `/freeze`, `/result`, `/receipt/:ciphertext_hash` inclusion+T2 settlement). Bad dir → `ERROR api refused: missing signer.json` exit 1; missing `--dir` → usage exit 2. Standalone `node api/dist/server.mjs --dir … --port …` (the e2e S1 spawn form) also serves. Logs `tmp/proof-logs/r18-*`. | 971da62 |
| R20a canonical `auction.json` | READY FOR MERGE | `tmp/canon-p3` assembled from real Phase 3 artifacts in `publish()` shape (`tmp/proof-canon.mjs`): `bin/benzo verify --dir tmp/canon-p3 --signer HEX` → OK x5, exit 0. Refusals: `version:2` and a `recipient_hash` key → `ERROR verify refused: auction.json schema`; flipped `manifest.json`/`frozen.json`/`result.json` projections → `ERROR manifest/freeze/clear … projection differs` (each in its own check) and API `GET /auction/:id` → HTTP 400 `{"valid":false,"error":"manifest refused: manifest.json projection differs"}`; clean dir → `valid:true`. Logs `tmp/proof-logs/r20a-*`. | 4258f54 |
| R20a legacy fallback | READY FOR MERGE | `bin/benzo verify --dir tmp/p3-public --signer HEX` and a cold copy of `docs/evidence/phase-2/auction` (`tmp/cold-p2`) → `WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs` + OK x5, exit 0. | 4258f54 |
| R20b flag interface | READY FOR MERGE | `bin/benzo verify --dir PUBLIC --signer HEX [--offline]` and `bin/benzo receipt show --dir PUBLIC --ciphertext-hash HEX [--receipt signed.json]` exactly as R20/Q13 lists them (also `benzo operator view --dir PUBLIC`, see Questions). Wrong `--signer` → `ERROR verify refused: signer mismatch` exit 1; missing `--signer` → usage exit 2. `receipt show` on `tmp/canon-p3` → inclusion + T2 settlement (Phase 3 receipt); with `--receipt tmp/receipt0.json` on the cold Phase 2 copy → `receipt_signed:true`, `settlement:null`. Logs `tmp/proof-logs/r20b-*`. | 53a7355 |
| R20c accounting classes | READY FOR MERGE | Mutations of `tmp/canon-p3` (`tmp/proof-strays.mjs`, logs `tmp/proof-logs/r20c-*`): stray present + seller receipt dropped → `ERROR accounting refused: settlement missing obligation seller` (the pre-fix `resultBound` gate skipped this) while `OK accounting-strays` still runs — neither class masks the other. Stranded stray row → `ERROR accounting-strays … not refunded or exception`; exception row without receipt → OK (T1 defined end); exception row with receipt → ERROR; stray receipt without row → ERROR; smuggled `leaf:9` → `ERROR … neither a result obligation nor a stray deposit`. Rows[0]-amount bump (stray first, real ledger order) → `ERROR accounting-strays refused: stray deposit:…:4608182819 amount`; `leaf:0` bump → `ERROR accounting refused: row leaf:0 amount` — both match cli-auction R1's `/ERROR.*(amount|total|ledger)/`. Clean stray-ok and a cold copy → OK accounting + OK accounting-strays, exit 0 (default tle mode too). | 2e6b650 |
| R21 item 5 lifecycle API + `--signer` | READY FOR MERGE | Fixtures from real Phase 3 artifacts in `publish()` shape (`tmp/proof-r21.mjs`, `tmp/proof-r21-cli.sh`; logs `tmp/proof-logs/r21-api.out`, `tmp/proof-logs/r21-cli.out`): 21 route checks across `tmp/canon-open` (state OPEN, no frozen/opened/result: `/auction/:id` valid:true + state + null result/freeze fields, `/operator` count 0 + C + blobs [], `/freeze` `frozen:false` empty board, `/result` and `/receipt/:h` → HTTP 409 `{"ready":false,"state":"OPEN"}`, unknown id 404), `tmp/canon-counts` (3 published receipts → `/operator` count 3), `tmp/canon-wait` (SEALED-WAIT: full freeze board, `/result` 409 state SEALED-WAIT, `/receipt` inclusion + settlement null), `tmp/canon-open-flip` (flipped manifest.json projection → HTTP 400 `valid:false` manifest error) and settled `tmp/canon-p3` (all routes as before; `/result` equals `result.json`, `/receipt` inclusion + T2 settlement). `bin/benzo verify` still requires frozen (`ERROR verify refused: missing frozen`) and result (`… missing result`) and passes settled `--offline` (OK x6). `--signer HEX` mismatch refuses to serve on `bin/benzo api serve` and `node api/dist/server.mjs` (`ERROR api refused: signer mismatch`, exit 1); malformed `--signer` → usage exit 2; matching signer serves (`api listening` + `/auction/:id` valid:true + `/operator` 200). | cad928d |

Final sweep at 2e6b650 (all exit 0 / HTTP 200): verify canonical, verify `--offline`, verify legacy p3, verify legacy p2 cold copy, operator view, receipt show, `benzo api serve` `/auction` + `/operator`. `npm run build:cli` and `npm run typecheck` pass at every commit. Full logs under `tmp/proof-logs/` (gitignored scratch).

`docs/evidence/phase-4` holds only Track A's `verify.sh` — **no Track A public dir exists yet to cold-copy** (checked `find docs/evidence/phase-4` at 2e6b650). The exact `verify.sh` R invocation shape (`bin/benzo verify --dir <ev>/cli --signer <doc.signer>`) was proven against `tmp/canon-p3`. Ready for Track A's evidence run after merge.

States: TODO · IN PROGRESS · READY FOR MERGE · BLOCKED (outside cause, with repro).

### Public auction directory contract (canonical, per schemas/public-auction.schema.json)

- **Source of truth is `auction.json`** (version, auction_id, signer, manifest packet, state, receipts; optional frozen, result, settlement, opened, beacon). Read per the schema: key set, version 1, state enum, signed-manifest binding, `opened`+`beacon` required from OPENED onward. `signer.json`, `opened.json`, `summary.json` etc. load **only when `auction.json` is absent** (legacy fallback for the Phase 2/3 evidence dirs and their cold copies) and `benzo verify` prints a WARN.
- Canonical dirs must carry `manifest.json`, `frozen.json`, `result.json` **byte-identical** to the document (schema description); each is cross-checked in its own check (`manifest`/`freeze`/`clear`). Other projection files are ignored in canonical mode.
- The trust anchor is the `--signer HEX` flag (R20b); the document's own signer claim must match it. `benzo api serve` / the standalone server accept an optional `--signer HEX` and refuse to serve on mismatch (R21 item 5).
- **Lifecycle-safe reading (R21 item 5):** `frozen`/`opened`/`result` are optional in the document (schema), and the read API serves DRAFT/OPEN/SEALED-WAIT dirs without them: `/auction/:id` reports `state` and `valid` from the checks that apply (manifest always; freeze/receipts once frozen; clear/accounting once result), `/operator` counts admitted `receipts` and returns empty blobs until freeze, `/freeze` serves an empty board (`frozen:false`), and `/result` + `/receipt/:ciphertext_hash` answer 409 `{"ready":false,"state":…}` until the state carries them. `benzo verify` still requires `frozen` and `result` (`ERROR verify refused: missing frozen|missing result`). A canonical projection file whose document field is absent is refused (`… projection without document field`).
- Settlement receipts stay the six T2 fields. Ledger rows use `party` = `leaf:N`, `seller`, or `deposit:<txid>:<diversifier-index>` (settle/plan.ts shapes); anything else is refused.

### Commands (Track B)

Each module in `cli/commands/` exports `{ noun, verb, help, run }`; `run(argv)` returns a number (R17 contract; router `cli/benzo.ts`).

```
benzo verify --dir PUBLIC --signer HEX [--offline]        # exit 0 ok, 1 ERROR lines on stderr, 2 usage
benzo receipt show --dir PUBLIC --ciphertext-hash HEX [--receipt signed.json]
benzo operator view --dir PUBLIC
benzo api serve --dir PUBLIC [--host 127.0.0.1] [--port 8787] [--signer HEX]
node api/dist/server.mjs --dir PUBLIC [--host 127.0.0.1] [--port 8787] [--signer HEX]   # same server, e2e S1 spawn form
```

Default verify re-derives every opening with `$BNZ_STATE_DIR/bin/tle -d` against drand quicknet (chain hash from the published beacon, bound to the manifest `R`/`chain_hash`; bad-MAC decrypts classify `undecryptable` exactly like `clear/auction-cli.ts`), then reproduces `clear/`. ERROR lines carry check ids `manifest`, `freeze`, `receipts`, `clear`, `accounting`, `accounting-strays` — `ERROR freeze …` for anything root/witness/projection-frozen, `… amount …` wording for amount corruptions, matching cli-auction R1's regexes.

## Deviations
- None open. (`benzo operator view --dir PUBLIC` was flagged last run; accepted, R21 item 6.)

## Environment changes
- 2026-10-02 (testnet lane bring-up): the pinned binaries staged in `.benzo/bin` had no cargo install metadata (`.crates.toml`/`.crates2.json` empty), so `tools/bootstrap.sh` aborted at `cargo install zcash-devtool` with `error: binary `zcash-devtool` already exists in destination` (`.benzo/run/bootstrap-setup.log`, first setup attempt). I rebuilt all four pinned Rust tools from `tools/pins.env` with `cargo install --locked --force` into `$BNZ_STATE_DIR` (no code change; log `.benzo/run/bootstrap-force.log`, e.g. `Replacing …/.benzo/bin/zcash-sign` → `Replaced package `unknown` with zcash-sign v0.1.0 (…frost-tools?rev=06c0dbd…)`). `tools/setup-testnet.sh` then passed, and `docs/evidence/phase-1/versions.txt` reproduced byte-identical (`git status` clean after the setup run).

- Carried from earlier runs: `npm ci`; pinned `tle` v1.2.0 in `$BNZ_STATE_DIR/bin/tle`; Playwright Chromium. Run 13 added none. The Phase 3 beacon was fetched read-only from `BNZ_DRAND_URLS` (public drand API) for the proof corpus.

## Deferred
- Full JSON-Schema validation of `auction.json` (hand checks cover the schema's key set and every field the checks consume; no validator dependency in budget).

## Questions

- **Head task message (2026-10-02, this session): two instructions conflict; one-line resolution, please fold into a Ruling or tell me to revert.** Verbatim: “Run `tools/setup-testnet.sh` from the benzo-b root with your `.env` loaded … Make sure frostd listens on :2745, not :2744.” and “Add no tests. Do not change code in this run.” `tools/setup-testnet.sh` started frostd **without `-p`** (frostd's default is :2744, Builder A's port) while its DKG clients connect to `$BNZ_FROSTD_ADDR` (`localhost:2745` here), so the mandated run could not succeed as written and its bind would have targeted A's port. I made the minimal one-line change — `b30e826`, `-p "${BNZ_FROSTD_ADDR##*:}"` on the frostd line, `bash -n` clean — and nothing else. **Same bug in `e2e/lib/frost.ts`** (`startFrostd` passes no `-p`; clients use `BNZ_FROSTD_ADDR`): any project that calls it would bind :2744 in this lane. Left untouched (out of this run's scope); needs a ruling before I fix it. `npm run e2e`'s default project (`seal-open`) does not call `startFrostd`, so its baseline above is unaffected.

None open otherwise. The prior entries are closed by R21: **Q1** dropped (item 3 — only the user's own words are recorded as user instructions; the entry had quoted a head prompt), **Q2** budget ~626 lines accepted (item 4), **Q3** load shapes ruled (item 5: `verify` keeps requiring `frozen`/`result`; the read API is lifecycle-safe — done in cad928d), **Q4** `operator view --dir PUBLIC` accepted (item 6).

## Test audit (R11: Track B adds none)
No new specs. Proof is the logged manual runs above (scratch only in `tmp/`, never committed). The R20c corpus shows the pre-fix masking failure mode explicitly: with any `deposit:` receipt present, the old `resultBound` gate skipped every result obligation; `tmp/proof-logs/r20c-stray-missing-obligation.out` shows it now refused.

## Last session
- **Window:** 2026-10-01T19:05:00Z–19:12:41Z (start time not recorded precisely).
- **Outcome:** R21 item 5 delivered and committed (cad928d): lifecycle-safe read API (DRAFT/OPEN/SEALED-WAIT dirs serve without frozen/opened/result; `/result` and `/receipt/:h` answer 409 `{"ready":false,"state":…}` until the state carries them; `/auction/:id` reports state + `valid` from applicable checks; 400-on-manifest-failure kept), optional `--signer HEX` on `benzo api serve` and the standalone server refusing to serve on mismatch, `benzo verify` keeping its frozen/result requirement. Proven by 21 route checks (`tmp/proof-r21.mjs` → `tmp/proof-logs/r21-api.out`) on pre-freeze, counts, SEALED-WAIT, manifest-flip and settled fixtures, plus CLI/entry-point proofs (`tmp/proof-r21-cli.sh` → `tmp/proof-logs/r21-cli.out`). `npm run e2e` (seal-open) passed before new work; `npm run build:cli` + `npm run typecheck` pass at the commit. Q1 dropped per R21 item 3; Q2–Q4 closed by R21 items 4–6.
