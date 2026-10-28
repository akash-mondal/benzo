# Design: cross-chain clearing

Zcash stays the private core. Target chains are Ethereum (Sepolia on testnet) and Solana (devnet). Delivery is pushed
to the winners, the target chain stays private too, and audited code is used wherever it exists.

## 0. The primitive

**Escrows on other chains that release only on what the Benzo signers attest Zcash cleared.** Any market leg can live
on any chain under one privacy rule: **the side that must stay hidden pays and gets paid on Zcash.** A public-chain
escrow holds only a side that is public anyway, or that is posted from a fresh address.

| Market | Cross-chain use | Private side |
|---|---|---|
| Auction / drop / launch | sell a Solana or EVM asset for ZEC | the buyers |
| Buyback | a treasury buys back its Solana or EVM token for ZEC; payouts land in shielded ZEC | the sellers' payouts, the treasury's maximum price |
| RFQ / OTC | a block of SOL, ETH or USDC against ZEC: a private swap with no bridge | the requester, the ZEC side |

Shown on testnet ([`docs/evidence/crosschain`](../evidence/crosschain/)): a Solana-asset drop, an EVM-token buyback,
a ZEC↔SOL OTC, a live ERC-5564 stealth delivery on Sepolia and a Token-2022 confidential transfer on Solana devnet.

## 1. Trust model and signatures

- The same three signers as the ZEC vault (alice, bob, carol), each on its own host.
- **EVM:** each signer holds its own secp256k1 key, generated on its host. The escrow checks 2-of-3 ECDSA signatures
  with OpenZeppelin `ECDSA` + `MessageHashUtils` (EIP-712 typed data). There is no FROST-secp256k1 verifier because
  none is audited.
- **Solana:** each signer holds its own Ed25519 key. The program checks 2-of-3 signatures through the native Ed25519
  program, reading the preceding instruction through the instructions sysvar with strict offset checks: the sysvar
  account must be the real one (`load_instruction_at_checked`), which closes the spoofed-sysvar class of bugs.
- **The attestation is domain-separated:** `benzo-release-v1 ‖ chain_id ‖ escrow_address ‖ auction_id ‖ result_hash ‖
  allocation_root ‖ batch_index ‖ nonce ‖ expiry`. EVM uses EIP-712 with `chainId` and `verifyingContract`; Solana uses
  a fixed byte layout with the cluster genesis hash and program ID. Each `(auction_id, batch_index)` is approved once,
  so an attestation can't be replayed.
- The signer keys are named in the signed manifest's `crosschain` block.

## 2. Escrow lifecycle

1. **Lock before bidding.** The seller deposits the asset into the escrow, keyed to `auction_id`, before `T_submit`.
   The signed manifest pins chain, escrow, asset, amount and deadline, and `benzo xchain status` shows the lock on
   chain.
2. **Release.** After clearing and Zcash settlement the signers attest the allocation root. Anyone can submit it.
3. **Refund.** After the deadline with no release, anyone can return the asset to the seller's pinned address.
4. **Per-recipient paid flags.** One failing recipient never reverts a batch; it stays claimable by a later release.

## 3. Allocation leaves

- One canonical leaf: `H(benzo-leaf-v1 ‖ auction_id ‖ index ‖ asset ‖ lot_count ‖ destination_kind ‖ destination_bytes)`.
- Amounts are always `lot_count × standard_lot`.
- The Merkle tree uses sorted pairs, a strict index bound, and commits the leaf count in the root.
- **Nothing from Zcash or the funding path ever enters a leaf:** no txids, no Zcash addresses, no amounts paid.
- Destinations come from the winner's sealed settlement envelope.

## 4. Private delivery per chain

| Asset | Delivery | Public on chain |
|---|---|---|
| SOL | a fresh address sealed in the bid, plus a small SOL stipend | the escrow and fresh addresses, standard lots |
| SPL tokens | Token-2022 confidential transfer to a fresh account Benzo configures from the bidder's sealed ElGamal key (shown on devnet; the escrow itself pays native SOL today) | the escrow, accounts and mint; amounts hidden |
| EVM tokens | an ERC-5564 stealth address derived from the bidder's sealed meta-address, through the canonical Announcer and Registry | the amount and a one-time address |

Each release includes a small native-token stipend per fresh or stealth destination, so a winner never funds it from a
known wallet. Railgun shielding is the stronger EVM option and is not built: it needs custom shield code in the
escrow.

## 5. Funding helper

`benzo fund quote --from <chain:asset> --zec <round amount>` asks the NEAR Intents 1Click quote API only. It always
targets the bidder's own shielded address, in a round amount the bidder chooses, and Benzo makes no deposits.

## 6. Release in two steps

A release used to carry the signatures and every payout in one transaction, and only one or two Solana payouts fit.
Release is now two steps on both chains:

- **Submit the attestation** once per `(auction, batch)`. The program checks the 2-of-3 signatures and stores the
  approved allocation root and its expiry. A second submit is refused. The attestation's expiry must not be after the
  escrow's deadline, so an approved batch can't race a refund.
- **Release approved payouts**, with no signatures, as many times as needed: each payout is checked against the
  approved root, its paid flag is set before the transfer, and the total can't exceed what was locked.

On Solana the paid flags and the approval account count only when they're owned by the program and carry a versioned
marker, so someone pre-funding those addresses with lamports can't fake a "paid" state or block a batch.

## 7. Traps

- Never put a Zcash txid, address, amount paid or funding identifier on a target chain.
- Solana: verify the instructions sysvar account and the exact Ed25519 instruction offsets.
- EVM: EIP-712 domain with `chainId` and `verifyingContract`; reject `s` in the upper half (OpenZeppelin `ECDSA` does).
- Per-batch approve-once flags, deadlines, anyone-can-refund.
- Pin every dependency and record its audit status in [`docs/AUDITS.md`](../AUDITS.md).
