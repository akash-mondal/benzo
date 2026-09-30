# Penumbra ZSwap — implemented batch swaps versus planned sealed flow

## 1. Facts and reality boundary

Static inspection 2026-09-30; no source executed. [penumbra-zone/penumbra](https://github.com/penumbra-zone/penumbra), commit `36a31c17974c23a7e84cc02c64f0062ae57e79b1`, clone `/tmp/zecathon-code/auc-doss-batch/penumbra`. Citations relative to this commit. Protocol implementation, not a hackathon placement. Saved research labels mainnet v2.1.1; this review pins current repository code rather than independently verifying running validator version.

**Implemented:** public input amounts, shielded funding, batched routing, output data, private claim proofs, deterministic output notes, prepaid claim fees. **Planned:** hiding each individual flow with additively homomorphic threshold encryption. `docs/protocol/src/crypto/flow.md:3–5` explicitly says flow contributions are in the clear and notes do not reflect current protocol. `docs/protocol/src/dex/swap.md:8`, `:136` similarly place sealed swaps in a future version. `crypto/flow/eddy.md` is only a heading and `flow-encryption/flow-consensus.md:3` promises future documentation. Do not count a specification sketch as shipped crypto. This is a per-block two-asset batch swap, not a ranked sealed-bid item auction or Penumbra's separate Dutch-auction component.

## 2. Lifecycle and exact flow

`funded notes → Swap commitment/included flow → end-of-block BatchSwapOutputData → claimable swap → nullified SwapClaim + two output commitments`.

1. Wallet selects shielded notes; Swap action consumes input assets and prepaid claim fee from transaction value balance. It commits pair, amounts, claim address and random seed/fee, and encrypts swap plaintext for wallet recovery (`docs/protocol/src/dex/swap.md:12–47`). Native encrypted payload protects claim address/record, **not public action input amounts**.
2. Action handler verifies distinct assets and Swap proof, checks DEX enabled, credits flow totals and inserts commitment into the state commitment tree (`crates/core/component/dex/src/component/action_handler/swap.rs:20–69`).
3. DEX end_block loops over per-pair flows and routes combined input (`crates/core/component/dex/src/component/dex.rs:116–122`). Block inclusion defines membership; no user-driven reveal or separate wall-clock auction deadline.
4. `handle_batch_swaps` clamps inputs, shares execution budget, routes asset1→asset2 then asset2→asset1, computes actual output and unfilled input, records height/pair and SCT position prefix (`crates/core/component/dex/src/component/router/route_and_fill.rs:29–111`).
5. Wallet retrieves output data and computes its pro-rata entitlements. Claim proves committed input, historical batch data and mandated claim address, reveals nullifier, outputs two note commitments. Handler checks historical output data equals chain state and nullifier unspent before inserting outputs/nullifying swap (`crates/core/component/dex/src/component/action_handler/swap_claim.rs:27–98`).
6. Prepaid fee funds claim; no spend-authorization signature is required to redirect funds because output destination was fixed in the original committed swap. Full viewing-key holder can auto-claim without spend key (`docs/protocol/src/dex/swap.md:78–106`). No inspected claim expiry or non-reveal obligation.

Planned flow encryption changes step 2 into consistency-proven ciphertext submission and step 3 into aggregate-only threshold decryption. Users submit noninteractively; decryptors need a common ledger/frozen flow set (`crypto/flow/ideal.md:32–39`, `:52–78`). It is not simply “send encrypted amount to an auctioneer.”

## 3. Structures and clearing algorithm

Implemented Swap Body: pair, **plaintext** delta_1_i/delta_2_i, fee commitment and encrypted payload (`crates/core/component/dex/src/swap/action.rs:82–108`). Swap commitment is domain-separated Poseidon over seed, fee, address keys and inner pair/input hash (`docs/protocol/src/dex/swap.md:26–44`). BatchSwapOutputData includes total inputs D1/D2, outputs L1/L2, unfilled U1/U2, height, pair and SCT prefix (`crates/core/component/dex/src/batch_swap_output_data.rs:23–41`). Claim public data includes fee, nullifier, output commitments and batch output data (`crates/core/component/dex/src/component/action_handler/swap_claim.rs:31–37`).

```text
D1,D2 = sum accepted Swap inputs for this pair/block
E12 = route_and_fill(min(D1,MAX_RESERVE), asset1->asset2, shared_budget)
E21 = route_and_fill(min(D2,MAX_RESERVE), asset2->asset1, shared_budget)
L2 = E12.output or 0; U1 = D1 - E12.input or D1
L1 = E21.output or 0; U2 = D2 - E21.input or D2
for user with x1,x2:
    r1 = x1/D1 if D1 != 0 else 0
    r2 = x2/D2 if D2 != 0 else 0
    output1 = floor(r1*U1 + r2*L1)
    output2 = floor(r1*L2 + r2*U2)
```

Exact implementation uses U128x128 fixed-point and rounds down (`batch_swap_output_data.rs:47–81`), so evaluate bit-exact arithmetic rather than assume rational precision. No last-user rounding remainder award. All users of one direction share an effective average output ratio inclusive of fees; the two directions are routed separately and need not have reciprocal clearing ratios. Routing is liquidity-position/path execution, not “sort bids and choose marginal bid.” No seller reserve or explicit bid price in Swap Body; liquidity positions provide exchange terms. No price tie among contributors; pro rata makes per-swap arrival order irrelevant within the fixed batch. Multi-asset outputs are protocol-specific.

## 4. Escrow, refunds, change, delivery and griefing

Contributions are value-balance burns accounted for by the DEX value circuit breaker (`crates/core/component/dex/src/component/swap_manager.rs:69–94`), not a custodian receiving plaintext ledger funds. Claim mints corresponding output/refund notes under proof and nullifier rules. No liquidity means full input returned through claim (`docs/protocol/src/dex/swap.md:60`). Partial routing returns unfilled input pro rata; both output assets can be nonzero. Deterministic notes from committed seed and claim address avoid a late recipient-substitution step. Fees are prepaid, separate from unfilled value.

No non-reveal slash needed because users never reveal to execute. Proof/transaction fees, funded inputs, clamp and execution budget constrain abuse. `swap_manager.rs:27–28` documents an unimplemented commitment-per-block budgeting concern; this is a TODO in code, not proof of a presently exploitable node failure. Claim availability still depends on chain/wallet synchronization, proof generation and correct fee estimation.

## 5. Privacy boundaries and leaks

Before/at execution all validators/public observers see pair and per-action input amounts (`swap/action.rs:85–87`), hence usually direction when one side is zero. Hidden funding-note linkage, ownership and claim address do not hide those public amounts. Encrypted swap payload is recoverable by wallet viewing keys; those key holders know own swap plaintext. Batch totals and outputs are public. Claim reveals pair and block height and reduces anonymity set (`docs/protocol/src/dex/swap.md:108–116`). CLI claims immediately to avoid linking later spending to a uniquely delayed claim.

Planned crypto: limb-based ElGamal under DKG key with correctness proof, ciphertext addition, valid share proofs, threshold robust reconstruction (`crypto/flow-encryption/threshold-encryption.md:61–106`; `crypto/flow/ideal.md:87–98`, `:111–168`). The sketch encrypts u64 as four u16 limbs and specifies **640 bytes per value with proof** (`threshold-encryption.md:103–106`), already larger than one Zcash memo before metadata. Two input amounts require more. Committee threshold collusion can violate individual confidentiality; aggregate decryption alone leaks singleton batches and known-contribution subtraction. Freeze membership, minimum anonymity set and no arbitrary subset queries are essential. Published plans do not establish implemented enforcement of these properties.

## 6. UI and UX

Reviewed UI surface is `pcli tx swap input --into denomination`, source account and fee tier. CLI explicitly explains two transactions and automatically creates the claim (`crates/bin/pcli/src/command/tx.rs:198–218`). After confirmation it loads swap record, prints both pro-rata outputs and “Claiming now” (`:536–564`). No auction bidder/seller browser screens in the inspected component. External Penumbra wallet UIs were not cloned/reviewed. Product lesson is one logical action with progress through submit → batch confirmed → refund/output claimed, without forcing the user to return for manual reveal.

## 7. Judgment and Zcash mapping

**STEAL:** prepaid settlement fee; committed refund/delivery destination; mandatory unfilled refund; self-contained batch result; one logical user action with automated completion; freeze first, compute once. **AVOID:** describing current inputs as sealed; assuming homomorphic totals rank price bids; singleton/differencing leaks; recreating an incomplete DKG/consensus design in a month; equating mint/burn/claims with transferable Zcash note scripts.

A Zcash auction can mimic receipt → frozen batch → deterministic payout, but cannot add a native SwapClaim action or mint non-ZEC assets. Shielded custody with FROST policy replaces proof-enforced transmutation; PCZT expresses ZEC refunds/proceeds. Native memo plaintext is visible to incoming/full viewing-key holders, so bid terms require additional delayed encryption. Fixed/cap deposits are necessary if viewing-key holders must not infer bid price from note value. Memo holds compact manifest/ciphertext hash and receipt ID, not these 640-byte flow proofs. tlock or Shutter-style release is a practical pre-close seal; FROST is not threshold decryption. Aggregate-only homomorphic clearing would require encrypted demand by price bucket plus input-validity/funding binding and allocation logic, an additional unbuilt protocol. NEAR Intents supplies external conversion but cannot privately mint auctioned assets on Zcash.

**Design priority:** borrow the lifecycle/accounting now; treat aggregate-only loser privacy as a later research direction, not a hackathon dependency.
