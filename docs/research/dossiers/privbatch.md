# PrivBatch — design dossier

## 1. Facts and implementation status

Static source inspection on 2026-09-30; no repository code, builds, tests, or agents executed. Clone: `/tmp/zecathon-code/auc-doss-batch/privbatch`; repository [Belloabraham121/privbatch](https://github.com/Belloabraham121/privbatch), pinned commit `d6363008ac86427c347d835dc5b098baf800b2e2`. File references below are relative to that clone and commit.

[ETHGlobal HackMoney 2026 showcase](https://ethglobal.com/showcase/privbatch-d3sge) confirms **Uniswap Foundation, Uniswap v4 Privacy DeFi, 1st place**. Its description claims aggregate-only trade visibility. The inspected source supports a Solidity hook, Circom commitment circuit, generated Groth16 verifier, TypeScript agent infrastructure, test files, and checked-in Base Sepolia deployment broadcasts under `contracts/broadcast/DeployPrivBatchHook.s.sol/84532`. Broadcast artifacts are not independent deployment verification. No React frontend source was located despite the showcase mentioning one. This is an AMM batch executor, not a sealed seller/item auction.

## 2. Lifecycle and exact intent flow

State is per pool: append-only `Commitment[]`, `BatchState(lastBatchTimestamp,batchNonce)`, per-user nonce consumption, and a separate reveal map (`contracts/PrivBatchHook.sol:81–138`). `revealed` means consumed by execution; submitting the reveal does not set it.

1. User/agent prepares `(user,tokenIn,tokenOut,amountIn,minAmountOut,recipient,nonce,deadline)` and approves ERC20 spending by the hook.
2. Plain route: submit a keccak commitment via `submitCommitment` (`:184–201`). It accepts arbitrary hashes, stores address zero, and requires neither collateral nor a proof.
3. ZK route: submit Poseidon commitment and Groth16 preimage proof; contract verifies the sole public signal equals the hash and records `verifiedCommitments[hash]` (`:215–258`). The circuit hashes eight private fields (`circuits/commitment-proof.circom:11–40`); it does not prove funding or execute matching.
4. Plain reveal submits the **full intent in calldata**, recomputes keccak, checks membership, deadline, and nonce, then writes `revealStorage` (`:286–331`). ZK reveal submits a hash and full intent, checks only that the hash was previously verified, deadline, and unused nonce, then overwrites that hash's reveal (`:350–370`).
5. Anyone selects at least two hashes and executes after five minutes since last successful batch (`:420–457`, `:574–620`). There is no globally frozen participant set or separate commit/reveal deadline. Initial timestamp zero makes the first interval already elapsed on ordinary chains. An intent is valid at exact equality with its deadline; later execution rechecks expiry.
6. Load reveals, validate commitment membership, consume nonce/commitment, pull tokens, swap, check eligible recipients' slippage, distribute, advance timestamp/nonce, delete live reveal storage. A revert rolls back the entire execution.

The executor chooses the subset. Dead commitments remain in storage; `checker` counts unconsumed entries rather than executable, funded reveals (`:381–399`). No seller close, winner announcement, or autonomous deadline opening exists.

## 3. Structures and actual clearing algorithm

`Commitment`: hash, optional committer (here zero), timestamp, consumed flag. `SwapIntent`: eight fields above. `UserContribution`: recipient, input amount/currency, output currency, minimum output. Result is AMM `BalanceDelta` plus `BatchExecuted` event (`:55–72`, `:88–120`). No item, auction reserve, bid ranking, or quantity offer curve.

Source-derived pseudocode (`:642–717`, `:752–888`, `:899–1061`):

```text
for each executor-selected intent:
    require deadline >= now and unused (pool,user,nonce)
    require hash exists and unconsumed
    if plain route: require keccak(intent) == hash
    mark hash/nonce consumed
    pull amountIn from user to hook
    if tokenIn == pool.currency0:
        d0 += amountIn; d1 -= minAmountOut
    else:
        d1 += amountIn; d0 -= minAmountOut
require d0,d1 have strictly opposite signs
swap abs(positive net delta) as exact input through PoolManager
eligible = intents in net swap direction AND matching output currency
for every eligible intent:
    require floor(totalAMMOutput * input / eligibleInputSum) >= minimum
pay eligible users pro rata; last eligible receives rounding remainder
```

This nets against **requested minimum outputs**, not a two-sided uniform-price supply/demand clearing calculation. Zero-net batches are rejected (`:760–761`). Only net-direction users are eligible for output/slippage checks (`:964–1000`, `:1019–1027`). Opposite-direction token inputs were already pulled, yet the inspected distribution path has no payment/refund branch for them: a material correctness concern for mixed-direction batches. No price ties; remainder depends on executor array order. Pro rata is input-weighted AMM output, not multi-unit auction allocation.

## 4. Custody, refunds, delivery, and griefing

No funds are locked on commitment or reveal. Inputs are transferred only during execution (`:713–717`), creating balance/allowance failure and batch-revert opportunities. Tokens go hook → PoolManager → hook → recipients in one transaction. No NFT/physical item delivery. There is no non-reveal slash, spam bond, expiry cleanup, bidder cancellation/refund claim, or mixed-direction change mechanism in this hook. Unbounded commitment scans increase execution cost (`:233–240`, `:729–738`). Any member whose balance, approval, deadline, or minimum fails can invalidate the chosen batch. Permissionless execution helps availability but does not impose fair inclusion.

## 5. Privacy and binding findings

| Boundary | What is visible |
|---|---|
| Before reveal | Public pool/hash/time, tx sender and proof; preimage hidden only if nonce/terms provide sufficient entropy. No dedicated random salt field in the hook intent. |
| Reveal pending/included | Everyone reading calldata sees user, direction, amount, minimum, recipient, nonce and deadline (`:286–309`, `:350–367`). There is no enforced wait until a batch close. |
| Execution/after | Public ERC20 transfers, batch deltas and size; output event includes amount/token and unsalted recipient hash (`:67–72`, `:1055–1060`). Deleting storage does not delete historic calldata. |
| Agent/coordinator | `agents/hooks/RevealManager.ts` processes complete intents; whoever receives/stores them can read them. It is not a threshold sealing service. |

**Binding defect, source inference:** `submitRevealForZK` neither recomputes Poseidon nor authenticates the caller as `intent.user` (`:350–367`). `_processReveals` skips the hash check when `zkVerified` is true (`:666–683`), while the batch proof only proves knowledge of *some* preimage (`:464–485`). A caller can associate another intent with a verified hash; preimage proof is not proof that stored intent equals that preimage. Token allowance may then become the operative spending boundary. This was established by static dataflow, not an executed exploit.

Solidity `private`, event address omission, a recipient hash, and separate transactions do not supply confidentiality. `_validateBatchPrivacy` verifies arithmetic signs/sums, not information hiding (`:752–785`).

## 6. UI and UX evidence

No bidder/seller browser screens located. CLI agents contain strategy generation, commit/reveal orchestration, batch execution and token-distribution handlers (`agents/AgentManager.ts`, `agents/hooks/{RevealManager,BatchExecutor,TokenDistributionHandler}.ts`). The user must fund/approve, keep intent data, pay separate commit/reveal transactions, and rely on an executor to include it. A successful demo should expose queued/committed/revealed/executed/expired states; these are suggested product states, not implemented React screens verified here.

## 7. Judgment and Zcash mapping

**STEAL:** input-weighted payout arithmetic with an explicit rounding policy; a minimal per-market state; agent automation for retries/status; atomic rollback semantics as a specification target. **AVOID:** public early reveal; unbound ZK witnesses; calling storage privacy; free unfunded commitments; subset-selecting executors; mixed-direction netting that has no opposite-side payout.

For our Zcash auction, use a canonical signed auction manifest, a domain-separated commitment binding auction ID, amount, quantity, refund/delivery destination, expiry and random salt, plus a time/threshold encrypted opening. Put only a compact ciphertext or content hash in the 512-byte encrypted memo. Commit/reveal memos readable by an operator's viewing key are not operator-blind. A fixed-size shielded deposit or separate custody service is required: if deposit equals bid, the recipient can learn bid size despite sealed memo data. FROST governs custody signatures, not secrecy or auction enforcement. PCZT can assemble reviewed shielded payouts after clearing; no Zcash contract provides EVM rollback or ERC20 allowance enforcement. Refund all losers and winner overpayment with deterministic fee/change accounting. NEAR Intents converts external funding, but its provider learns the conversion and can correlate timing; it cannot replace the bid seal.

**Design priority:** reject this as a sealing primitive; borrow only accounting and orchestration patterns after correcting the matching logic.
