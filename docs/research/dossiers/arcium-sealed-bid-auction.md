# arcium-sealed-bid-auction / Protocol 01 extract

Owner: `auc-doss-fhe`. Static read-only review, 2026-09-30. Repository https://github.com/IsSlashy/arcium-sealed-bid-auction, commit `2cc1cf9d0ca5343a2d6f7a3428521ade59e78a65`. Paths/lines relative to `/tmp/zecathon-code/auc-doss-fhe/IsSlashy--arcium-sealed-bid-auction/`. No repository execution or runtime verification.

## Facts and implementation reality

Solana Arcium MPC + custom Groth16 denominated shielded pool, repository-discovered, no independently verified prize. Real Arcis comparison circuit, Circom note/escrow relation, Anchor handlers and TS SDK/test fragments. **Repository is incomplete**: no Cargo.toml/Anchor.toml, root program lib.rs, definitions of crate::state/DenominatedPool/MerkleTreeState, or imported SDK `../client` are present. It is an extracted module, not a buildable standalone deployed auction. README claims trustless enforcement and devnet IDs (`README.md:5`, `87-90`); source alone cannot substantiate them.

Also inspected `ssgkgk1-sketch/arcium-sealed-bid-auction`: commit recorded in sources manifest; only `README.md:1-2` (title and one Vickrey sentence), no implementation/spec. Do not confuse same repository name with this extract or official example.

## Lifecycle and bid flow

Declared sequence: shield fixed-denomination note -> Groth16 escrow consumes note and stores pay/refund commitments -> encrypted bid/nullifier enters Arcium accumulator -> authority finalizes -> anyone writes outcome -> anyone releases chosen note. Source backs escrow/outcome/release logic but missing parent program prevents checking creation/deadline/bid inclusion/verified callback enforcement.

`programs/p01_auction/src/escrow_shield.rs` checks active pool/root, nullifier PDA uniqueness, maturity delay, verification-key owner/hash, verifies 7 public inputs and records conditional notes (`35-44`, `58-84`, `114-164`). No funds move from pool. `write_escrow_outcome.rs` parses external finalized Auction account, compares nullifier to winner and sets Pay/Refund (`45-98`). `escrow_release.rs` chooses commitment, inserts tree using caller-supplied new_root, updates pool counters and one-time release flag (`64-103`). Missing insert_with_root implementation prevents verifying root-transition integrity.

## Data and clearing

Escrow stores auction id, pool, old nullifier, pay/refund commitments, outcome byte, released flag/time/bump (`auction_escrow.rs:16-43`). Circuit note = Poseidon(nullifierPreimage,secret,epoch,mint), nullifier=Poseidon(preimage,secret). Escrow public inputs root/nullifier/minEpoch/mint/auctionId/pay/refund (`circuits/escrow_bid.circom:50-79`, `84-152`). **No bid amount, bid ciphertext, denomination, seller recipient or winning-price relation** is proven by this circuit.

Arcis `programs/p01_auction/encrypted-ixs/src/lib.rs` (subsequently abbreviated `encrypted-ixs/src/lib.rs`) input uint64 price + four nullifier chunks; accumulator price/winner chunks/count (`24-41`).

```text
higher=(bidAmount>highest)
highest=select(higher,bidAmount,highest)
winnerNullifier=select(higher,bidNullifier,winnerNullifier)
count++
finalize reveals highest + winning nullifier + count
release winner's whole denominated note to pay commitment;
release every other note to refund commitment
```

`48-83`. First-price, earliest strict maximum wins; no Vickrey despite similarly named bare repo, reserve, multi-unit or pro-rata. All-zero bids retain zero nullifier absent initialization policy (missing). Fixed-denomination note transfer does **not** implement arbitrary winning price/change. No demonstrated binding limits bid <= collateral or ensures pay note belongs to seller rather than bidder-chosen key.

## Settlement correctness and anti-griefing

Permissionless release is useful, but conditional escrow correctness requires parent program proof/result binding. Outcome bridge checks external owner and embedded auction id, not account discriminator/PDA or embedded pool equality (`write_escrow_outcome.rs:49-84`). It never uses winning_bid to size pay/change. Release guards escrow.pool match and one-time flag (`escrow_release.rs:55-57`), but parent Merkle insertion unavailable. Groth16 wrapper (`programs/p01_auction/src/verifier.rs`, subsequently `verifier.rs`) uses Solana BN254 precompiles on-chain (`verifier.rs:329–335`, `418–427`). **Host testing stubs are not cryptographic verification**: non-Solana G1 addition returns p1 (`316–320`), scalar multiplication returns p (`338–342`), and pairing check always returns true (`430–434`). A host test passing this path cannot validate an escrow proof.

Circuit “auction_id non-zero” comment is false as written: `auction_id_check <== auction_id*auction_id` has no nonzero assertion (`escrow_bid.circom:155-163`). Inclusion as a public input is intended proof binding, but compiled key must be checked; unused squared signal does not establish valid auction existence. SDK encrypts five values but only passes ciphertexts[0] and [1] (`sdk/src/auction/index.ts:143-159`), not all four nullifier limbs. Missing program ABI prevents establishing compatibility.

No refund timeout, bid spam bond, invalid/missing-MPC-result recovery or seller item delivery. Tests named Full Integration use a mock pool (`tests/sealed-bid-auction.test.ts:114-120`), random nullifiers and test PDA derivation rather than proving/funding escrow (`144-165`, `185-198`). No escrow-release integration test found. One-note nullifier uniqueness is anti-double-spend but not enough to prove one funded effective bid in MPC.

## Privacy and leaks

MPC can hide bid prices under its non-collusion assumptions; final circuit explicitly reveals winning amount/nullifier/count (`programs/p01_auction/encrypted-ixs/src/lib.rs:77-82`), contrary SDK header “only winning nullifier” (`sdk/src/auction/index.ts:8-9`). Public escrow event binds auction, source nullifier, both conditional commitments, time/maturity (`escrow_shield.rs:172-180`). Outcome/release publicly show which escrow won (`write_escrow_outcome.rs:93-98`, `escrow_release.rs:94-102`). Wallet submitter is visible unless relayer used; nullifier itself is pseudonymous but not magically anonymous against transaction linkage. Fixed-denomination pool/payer/timing remain correlatable; dynamic delay alone does not prove anonymity set.

## UI / UX

No application UI provided. SDK intends createAuction, submitSealedBid, finalizeAuction, writeEscrowOutcome and releaseEscrow; tests show x25519/Rescue encryption and callback waiting. Missing imports/program types make these snippets reviewable design material rather than usable frontend. Good bidder flow would expose collateral-note maturity, accepted escrow, encrypted bid inclusion, settlement crank and private recovered note, with payment/change disclosure policy stated.

## Judgment and Zcash mapping

**STEAL:** pre-authorized pay/refund branches, pseudonymous winner handle bound to escrow, one-time conditional release, maturity/relayer awareness, permissionless settlement crank concept.

**AVOID:** calling extracted code trustless or complete, unbound amount/collateral, secret-owned pay note with no seller binding, raw untyped external account parsing, root supplied without established verification, SDK/circuit mismatch.

Zcash does not let an application nullify a shielded note then conditionally insert one of custom output commitments. Approximate outcome branches with pre-negotiated off-chain entitlements/PCZT plans held by FROST signers, **not on-chain enforced scripts**. Deposit fixed collateral into custody, bind encrypted bid and refund key to receipt; settlement conserves collateral as seller price + winner change or loser full refund. Signer policy enforces auction/root/rule binding and timeout refunds. tlock unlocks only bid plaintext after close; it does not cause custody release. Arcium/NEAR external components remain extra trust/dependency. Anonymous result keys can be carried in 512-byte memo envelopes, with large ciphertext payloads authenticated off-chain.
