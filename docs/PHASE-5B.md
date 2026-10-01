# Phase 5b: two more private markets on the same engine (testnet complete)

- **Window:** Track B may start once its Phase 5 work is merged; Track A after Phase 5 PASSED. Target **2026-10-16**. Feature freeze **Oct 24**.
- **Networks:** Zcash testnet + drand mainnet quicknet. **No mainnet transaction.**
- **Ownership:** head agent owns this file. Track A in `docs/STATUS.md`, Track B in `docs/STATUS-B.md`. Artifacts in `docs/evidence/phase-5b/`.
- **User instruction (2026-10-02), verbatim:** “i want benzo to be more , we had the whole research and multi agent workflow done we had some top selections , which things do you think we can built on top of this” and “lerts stick to private markets”.
- **Still locked:** R6 — **no frontend**. Mainnet is Phase 7.

## 1. Goal and finish line

Benzo becomes **the blind market house for Zcash**: one operator-blind engine (fixed C, client-side tlock seal, freeze before R, public clearing, 2-of-3 FROST settlement, private receipts) running three market types. Phases 4–5 deliver sealed auctions (Mode A) and sealed buybacks (Mode B). This phase adds two more, both research-proven (`research/PICKS.md`: winners elsewhere, nothing operator-blind on Zcash). **No engine rewrite:** new clearing modes plus manifest fields, everything else reused.

| Gate | Question |
|---|---|
| RQ | **Sealed RFQ / block desk.** A requester signs an RFQ manifest (side, lot/size, reserve, quote deadline, an allowlist of dealer quote keys). Invited dealers submit sealed quotes under the same C/tlock/freeze rules, each quote signed by an allowlisted key inside the tlock plaintext. After R, anyone reproduces the selection (best price meeting the reserve; ties by committed leaf index; non-allowlisted or malformed quotes refunded exact C). Winner settles and losers are refunded through the existing 2-of-3 path. Does it run end to end from the CLI on testnet, and does `benzo verify` reproduce it? |
| CM | **Recurring sealed call market.** For one collection, rounds repeat on a fixed schedule (round k has its own `T_submit_k < T_freeze_k < R_k`). Buyers submit sealed bids (fixed C); sellers submit sealed asks bound to a serial they hold (marketplace adapter receipt from Phase 5). At `R_k` the round uncrosses at **one clearing price** where demand meets supply (two-sided uniform price, pro-rata at the marginal price, integer zatoshi rounding, ties by leaf index); matched buyers pay, sellers are paid, unmatched sides refunded exact C, deliveries go to the adapter's claim queue. Do two consecutive rounds run end to end on testnet, with round 2 unaffected by round 1's openings, and does `benzo verify` reproduce each round? |

| Decision | Options |
|---|---|
| RFQ dealer identity | Allowlisted Ed25519 quote keys in the signed manifest; the quote signature sits inside the tlock plaintext's owner-key field (reuses Phase 5 envelopes) (default) |
| Call market assets | NFT serials of one collection via the Phase 5 adapter (default). ZEC↔stablecoin dark pool is **out**: its NEAR leg is mainnet-only |
| Round schedule | Fixed round length in the manifest (default 30 min on testnet: dictated by the confirmation buffer, not a choice) |
| Seller collateral | Sellers also post fixed C (uniform deposits keep the operator blind to side) (default) |

**Finish line.** RQ and CM READY FOR REVIEW with evidence and one-command repros; `verify.sh` positive + corrupted copy; the one new test seen red under each mutation; Mode A/B specs still green at the same commit; STATUS READY FOR REVIEW / STATUS-B READY FOR MERGE. **No frontend. No mainnet.**

## 2. Work split

### Track B (offline) — starts first
1. `clear/rfq.ts`: pure RFQ selection (allowlist check, quote-signature check, reserve, ties) with `result.json` `mode: "rfq"`.
2. `clear/call-market.ts`: pure two-sided uniform-price uncrossing with `mode: "call"`, pro-rata at the margin, dust rule mirrored from Mode A, conservation check.
3. `benzo verify` reproduces both modes; `GET /auction/:id` and `/result` serve them; a call-market round directory layout (one public dir per round, linked by collection + round index).
4. Schema additions proposed under Questions (Track A applies them).

Track B files: `clear/rfq.ts`, `clear/call-market.ts`, plus the Phase 5 Track B list.

### Track A (live)
1. Manifest/schema fields: RFQ (side, allowlist, reserve) and call market (collection, round length, round index, serial binding).
2. `benzo auction create --mode rfq|call`, a round scheduler for the call market (`benzo market run --rounds N`), seller-ask deposits and serial-receipt binding.
3. Live runs, spec, mutations, evidence.

## 3. Tests this phase adds: exactly one

Ceiling 8. After Phase 5: 6 used, 1 reserved for the user's browser bid flow. This phase takes the **last free slot**.

**7. `e2e/markets.spec.ts`** (live; Track A). One RFQ, then two call-market rounds.
- **RQ1** A quote signed by a non-allowlisted key is refunded exact C and never wins; the best allowlisted quote meeting the reserve wins; CLI result equals B's pure selection.
- **RQ2** Winner settles and losers are refunded via 2-of-3; `benzo verify` on a cold copy exits 0.
- **CM1** Round 1 clears at a single price where demand meets supply; CLI result equals B's pure uncrossing; conservation holds.
- **CM2** Round 2's bids submitted after round 1's openings clear independently (different R, own freeze); no round-1 deposit appears in round 2.
- **CM3** Matched seller payouts and buyer refunds settle via 2-of-3; delivery claims appear in the adapter queue; `benzo verify` reproduces both rounds.

Mutations: **5bM1** RFQ ignores the allowlist (RQ1); **5bM2** call market clears at the highest bid instead of the uncrossing price (CM1); **5bM3** round 2 admits a round-1 deposit (CM2).

## 4. Traps

1. Do not fork settlement: both modes use the existing ledger and 2-of-3 flow.
2. Sellers and buyers must be indistinguishable to the operator before R: same C, same memo size, side only inside the tlock plaintext.
3. A seller's serial binding must be checked before freeze; a seller who cannot deliver is refunded, never paid.
4. Each call-market round is a fresh auction (own manifest hash, R, freeze); never reuse a round's vault for the next without a new DKG if Phase 5's per-auction DKG applies.
5. Testnet TAZ: ask before any spend that would drop the bidder below 3C + 40,000 zats.

## 5. Budget

+600 hand-written lines (Track B ~350, Track A ~250). Schema and docs excluded.

## 6. Rulings

(none yet)
