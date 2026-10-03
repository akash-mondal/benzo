# Design: Phase 5 part 2, live markets (Track A)

Head-owned design (2026-10-03, draft for after part 1 PASSED). It consolidates PHASE-5 §11 as amended by R3 (call market dropped, reverse-Vickrey RFQ, launch tranches, recurring buybacks, drand serial shuffle, receipt prove/statement) with the cross-chain demos. Track B's pure logic for every mode is already merged (`clear/registry.ts`). Builders implement this as written; disagreements go under Questions.

## 1. Live runs, one per mode (testnet, signer hosts from part 1)

Each run uses the shipped CLI only (`benzo auction create --mode <mode>` … `benzo verify`), keeps C small (`C_zats` = 200,000 unless the mode needs more) and recovers the vault afterwards. One run per row, evidence under `docs/evidence/phase-5/markets/<mode>/`.

| Mode | What the run must show |
|---|---|
| **Collection drop** | Multi-lot preset with a sealed reserve and bond-then-pay. One winner pays the balance in the window, one defaults (bond forfeited to the seller sink). The drand serial shuffle from the later round in the manifest is replayed by verify. |
| **Launch** | Holder tranche at the floor, main sealed auction, and a capped follow-on at the clearing price. One run meets the minimum raise and publishes the allocation file; one run misses it and refunds everyone exact C. |
| **RFQ (reverse-Vickrey)** | Three quotes, one from a non-allowlisted dealer (refused). The lowest valid ask wins and is paid the second-lowest. A second RFQ with only 1 valid quote cancels and refunds exact C. |
| **Blind OTC** | One match (crossing sealed bid and ask, settled at the midpoint per the registry) and one no-match (both refunded). The ZEC leg only; say so in the evidence. |
| **Recurring buyback** | `benzo market run --rounds 2` with a sealed `max_price_zats`, and a public per-window report (units bought, clearing price, ZEC spent, serials burned). The treasury budget is funded before `T_submit` (part 1 §6). |
| **Bid revision** | One bidder revises inside the window; only the superseding order counts and the superseded deposit is refunded. |
| **Receipts** | `benzo receipt prove` (inclusion proof from the receipt) and `benzo receipt statement` (owner-signed fill/price/txid statement) on one leaf of any run above; verify accepts both. |

## 2. Cross-chain demos (Track A with Track B's escrows; after part 1 §3 networked signing)

The signer hosts generate their own secp256k1 and Ed25519 keys and co-sign attestations (`benzo xchain attest --result`, R17 item 4). Three demos, each a full live cycle with txids:
1. **Sell a Solana asset:** a collection drop whose lots are locked in the Solana escrow; winners receive at fresh addresses (Token-2022 CT where the asset is an SPL token).
2. **EVM buyback:** a recurring-buyback window that pays sellers on Ethereum Sepolia through the private delivery path (Railgun or stealth).
3. **ZEC↔SOL blind OTC:** an OTC match whose SOL leg settles through the Solana escrow.
Nothing from Zcash lands on a target chain: only the allocation root, the result hash and fresh destinations.

## 3. The spec: `e2e/markets.spec.ts` (slot 7 of 8)

One live run covers a drop (sealed reserve, bond-then-pay, one default, serial shuffle), an RFQ with one non-allowlisted quote, one OTC match and one no-match, one launch with its allocation file, and one bid revision. Per mode, assert that the CLI result equals the registry's pure clear, that conservation holds, and that `benzo verify` passes on a cold copy. The cross-chain demos stay evidence runs, not spec steps.

**Mutations** (each turns a named assertion red, then is reverted):
- 5M6: the registry dispatches the wrong mode for one lot.
- 5M7: the defaulter's bond is refunded instead of forfeited.
- 5M8: a superseded order is counted.
- 5M9: RFQ ignores the allowlist.
- 5M10 (replaces the dropped call-market mutation): RFQ pays the lowest ask instead of the second-lowest.

## 4. Order

Part 1 PASSED → §1 rows in table order → §3 spec green and its mutations → §2 demos → READY FOR REVIEW. If TAZ runs short, ask the user before the spec run; never drop a mode silently.
