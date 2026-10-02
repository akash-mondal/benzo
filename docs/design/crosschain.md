# Design: cross-chain clearing (Phase 5 part 3)

Head-owned design (2026-10-02). User decisions:
- Zcash stays the private core.
- Target chains are **EVM = Ethereum only (Ethereum Sepolia now, Ethereum mainnet later; no Base — user, 2026-10-02)** and **Solana devnet**.
- Delivery is **push**, and the target chain stays private too.
- **Audited code wherever possible.**

Research inputs: `zcash/research/benzo-ideas/{TARGET-CHAIN-PRIVACY,CROSSCHAIN-PRIOR-ART,UMBRA-RAILGUN-VERIFY}.md`. Implement as written; disagreements go under Questions.

## 0. The primitive

**Escrows on other chains that release only on what the Benzo signers attest Zcash cleared.** That lets any market leg live on any chain, under one privacy rule: **the side that must stay hidden pays and gets paid on Zcash.** A public-chain escrow holds only a side that is public anyway, or that is posted from a fresh address.

What it unlocks:

| Mode | Cross-chain use | Private side |
|---|---|---|
| Auction / drop / launch | sell any Solana/EVM asset for ZEC | buyers |
| Buyback | a treasury buys back its Solana/EVM token for ZEC; payouts land in shielded ZEC | sellers' payouts, the treasury's max price |
| RFQ / OTC | a block of SOL/ETH/USDC against ZEC; a bridge-less private swap | the requester / the ZEC side |

**Proven in this phase:**
1. a Solana-asset drop;
2. an EVM-token buyback;
3. a blind ZEC↔SOL (or ZEC↔USDC) OTC.

## 1. Trust model and signatures (audited first)

- The same three signers as the ZEC vault (alice, bob, carol), on separate hosts per the Phase 5 part 1 design.
- **EVM:** each signer holds its own **secp256k1** key, generated on its host. The escrow checks **2-of-3 ECDSA signatures with OpenZeppelin `ECDSA` + `MessageHashUtils` (EIP-712 typed data)**. Use OpenZeppelin Contracts at a pinned audited release. **No FROST-secp256k1 verifier:** none is audited.
- **Solana:** each signer holds its own **Ed25519** key. The program checks 2-of-3 signatures through the **native Ed25519 signature-verification program**, by reading the preceding instruction through the instructions sysvar, with strict offset checks. Avoid the 2022 Wormhole spoofed-sysvar class: verify that the sysvar account is the real one, and use `load_instruction_at_checked`. Pin Anchor at an audited version, or use native `solana-program`, whichever B can pin.
- **Attestation message, domain-separated (lesson 1):** `benzo-release-v1 ‖ chain_id ‖ escrow_address ‖ auction_id ‖ result_hash ‖ allocation_root ‖ batch_index ‖ nonce ‖ expiry`.
  - EVM uses EIP-712 with `chainId` + `verifyingContract`.
  - Solana uses a fixed byte layout with the cluster genesis hash and program ID.
  - Each `(auction_id, batch_index)` can be released once (a stored flag), so attestations can't be replayed (lessons 1, 3).
- Signer keys rotate per auction (the keys are named in the signed manifest's `crosschain` block).

## 2. Escrow lifecycle (lesson 8)

1. **Lock before bidding:**
   - The seller (project, treasury or OTC counterparty) deposits the asset into the escrow, keyed to `auction_id`, **before `T_submit`**. Deposits after that are refused.
   - The signed manifest pins `{chain, escrow_address/program_id, asset, amount, deadline}`.
   - `open` refuses unless the head-chain observer (run by each signer) confirms the locked amount.
2. **Release:** after clearing and Zcash settlement, the signers attest the allocation root; anyone can submit the release (crank) with the 2-of-3 signatures.
3. **Refund:** after `deadline` with no release (cancel, minimum not met, or signers unavailable), **anyone** can trigger the return of the asset to the seller's pinned return address. The ZEC side refunds as today.
4. **Per-recipient paid flags:** one failing recipient never reverts the batch (lesson 3). Failed items stay claimable by a later release.

## 3. Allocation leaves (lesson 4)

- One canonical leaf: `H(benzo-leaf-v1 ‖ auction_id ‖ index ‖ asset ‖ lot_count ‖ destination_kind ‖ destination_bytes)`.
- Amounts are always `lot_count × standard_lot` (lesson 6).
- Merkle tree: sorted pairs, a strict index bound, and the leaf count committed in the root (the Hyperbridge out-of-bounds lesson).
- **Nothing from Zcash or the funding path ever enters a leaf** (lesson 5): no txids, no Zcash addresses, no amounts paid.
- Destinations come from the bidder's **settlement envelope** (Phase 5 R3), extended with a `crosschain` field: `{kind, bytes}`.

## 4. Private delivery per chain (best audited option)

| Asset | Testnet now | Mainnet later | Public on chain |
|---|---|---|---|
| **SOL** | a fresh address sealed in the bid, plus a small SOL stipend | same (Umbra only if it gets a published audit) | the escrow and fresh addresses, standard lots |
| **SPL tokens** | **Token-2022 Confidential Transfers** to a fresh account that Benzo configures from the bidder's ElGamal pubkey (in the envelope); proofs pre-verified in setup transactions, then one release | same | the escrow, accounts and mint; **amounts hidden** |
| **Solana NFTs** | a fresh owner address | same | the owner address |
| **EVM ERC-20 / NFT** | **Railgun `shield()` on Ethereum Sepolia** to the bidder's 0zk address (escrow calls `shield`; the signers build the shield requests off-chain; 2 of 3 rebuild and compare each request byte for byte; a fresh shield key per settlement, destroyed after); **fallback: ERC-5564 stealth addresses on Ethereum Sepolia** (canonical Announcer and Registry) | **Railgun on Ethereum mainnet** | Railgun: the escrow and that a shield happened, with the recipient and later moves hidden. Stealth: the amount and a one-time address. |

- **Gas stipend (lesson 6):** each release includes a tiny native-token stipend per fresh/stealth destination, so winners never fund it from a known wallet.
- **Railgun PPOI:** the submitter address is screened, so use a clean, dedicated submitter. Refund policy: a shield stuck in the waiting window returns to Benzo's submitter, which forwards it back to that recipient's next envelope destination, or else the exception queue.
- **Railgun anonymity set:** Ethereum's pool is the largest; still use fixed lots and one batch time.

## 5. Funding helper (inbound)

`benzo fund quote --from <chain:asset> --zec <round amount>` calls the NEAR Intents 1Click **quote** API only (testnet: dry run, real quotes). It always targets the bidder's **own shielded UA**, in a **round amount the user chooses** (never C plus a fee), and prints guidance to wait before bidding. No deposits are made by Benzo. The live swap happens on mainnet later.

## 6. Code layout and ownership

- **Track B (offline, then its own testnet lane):**
  - `contracts/evm/` (Foundry; OpenZeppelin pinned; `BenzoEscrow.sol` with lock, release(2-of-3 EIP-712), refund, a Railgun adapter, a stealth adapter);
  - `contracts/solana/` (escrow program: lock, release(2-of-3 Ed25519 via instructions sysvar), refund, confidential-transfer delivery);
  - `crosschain/` TS: leaf/tree builder, attestation builder, Railgun shield-request builder, stealth derivation (ScopeLift SDK, pinned), Token-2022 CT account config;
  - `benzo xchain lock|attest|release|refund|status`, and verify extensions (the escrow state must match the attested root).
- **Track A** (after Phase 5 part 1): signer-host integration (each signer machine generates its EVM/Solana keys, observes locks and co-signs attestations), the live end-to-end runs, the spec.

## 7. Order of work for Track B (one commit per step, each with logged proof)

1. **EVM escrow on local anvil:** lock, release with 2-of-3 EIP-712, replay refusal, refund after deadline, per-recipient flags. Foundry tests are fine **inside `contracts/` only**; they don't count toward the project E2E ceiling, which is about live specs. Prove with `forge test` output.
2. **Solana escrow on `solana-test-validator`:** the same five behaviours, with Ed25519 instruction checks and spoofed-sysvar refusal. Prove with logged runs.
3. Leaf/tree/attestation TS + `benzo xchain` CLI against both local chains: one cleared drop delivered end to end locally.
4. **Private delivery adapters:** EVM stealth (local anvil, ScopeLift contracts deployed locally), then Railgun on **Ethereum Sepolia** (needs ETH); Token-2022 CT on **Solana devnet** (needs SOL).
5. Deploy both escrows to **Ethereum Sepolia and Solana devnet** from Track B's deployer keys (`benzo-b/.benzo/evm/deployer.key`, `benzo-b/.benzo/solana/deployer.json`; never print the private key). Record addresses in STATUS-B.

## 8. Traps
- Never put a Zcash txid, address, amount paid or funding identifier on a target chain.
- Shield requests must be rebuilt and compared by 2 signers before submission (Railgun doesn't validate notes).
- Solana: verify the instructions sysvar account and the exact Ed25519 instruction offsets.
- EVM: EIP-712 domain with `chainId` + `verifyingContract`; reject `s` in the upper half (OpenZeppelin `ECDSA` already does).
- Per-auction release-once flags; deadlines; anyone-can-refund.
- Pin every dependency; record audit status per dependency in `contracts/AUDITS.md`.

## 9. Addendum (2026-10-02): Solana "attest once, release many" (Reviewer R F4: only 1–2 payouts fit per transaction)

Head-owned design; implement as written.
- **New PDA `Approval`:** seeds `["approval", auction_id(32), batch_index(u64 le)]`. Fields: `auction_id`, `batch_index`, `allocation_root(32)`, `result_hash(32)`, `nonce(u64)`, `expiry(i64)`, `genesis_hash(32)`, `bump`. Created exactly once (`init`, so a second submit fails: replay refusal).
- **`submit_attestation(att)` instruction:**
  - Same checks as today's `release`: the preceding native Ed25519 instruction is read through the checked instructions sysvar (account key == `sysvar::instructions::ID`, `load_instruction_at_checked`, strict offsets); 2-of-3 distinct signers from the auction's pinned set; the message is exactly the attestation bytes; the genesis hash matches the one pinned at lock; `now <= expiry`; the auction isn't refunded.
  - On success, write the `Approval` PDA. No transfers in this instruction.
- **`release_approved(payouts[])` instruction:**
  - Takes the `Approval` PDA and the auction account, with **no signatures**.
  - Requires `now <= approval.expiry` and the auction not refunded.
  - For each payout: check the leaf bound and Merkle membership against `approval.allocation_root` (the same leaf/root encoding), check the paid-flag PDA is unset, set the paid flag **before** the transfer CPI, check the cap (`paid + amount <= locked`), then transfer.
  - Anyone can call it repeatedly (the crank) until every leaf is paid. Per-recipient failures skip and stay claimable.
- **Remove the signature-carrying `release` path,** or keep it only for tiny batches. Single code path preferred.
- **Size target:** with no Ed25519 instruction and no attestation in the release transaction, measure payouts per transaction at proof depths 0–6. Expect ≥ 6 at depth 4. Use a versioned transaction plus an address lookup table for the paid-flag and destination accounts if that's still below 4.
- **Tests (local validator):**
  - submit twice → refused;
  - release with no `Approval` → refused;
  - an expired approval → refused;
  - a release after refund → refused;
  - a leaf not in the root → refused;
  - every leaf paid exactly once across several crank calls;
  - a spoofed sysvar on `submit_attestation` → refused;
  - record the before/after payouts-per-transaction table.
