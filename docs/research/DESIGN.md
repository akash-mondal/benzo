# Benzo — the auction house where the auctioneer is blindfolded

Zecathon · Private Markets. The threats it answers are in [`threat-model.md`](threat-model.md); section 13 says who each idea is
borrowed from.

## 1. The claim (say exactly this, nothing stronger)

> **Until the published opening time, no one — not the operator, not the escrow signers, not the chain — can read any bid's
> price or quantity, and no bid can be linked to a bidder.** After opening, anyone can recompute the result, and every loser is
> refunded automatically in shielded ZEC.

Assumptions, stated in the UI and the README:
- fewer than the drand threshold collude;
- the bidder uses the published, reproducible client;
- fewer than 2 of 3 escrow signers collude.

Post-close, bid prices become public, but anonymized (no addresses and no refund targets). "Nobody can ever see anything" is not
claimed; the threat model shows that claim would be false.

## 2. Why it matters

- **An open-bid auction tells everyone the price you'd pay,** and on a transparent chain anyone can read the bids and
  trade ahead of them before the auction closes.
- **A blind auction run by an operator hides bids from the public, not from the operator.** Zilkroad's zkSNARKs mint
  sold 8,000 pieces at one 1.5 ZEC clearing price ([results](https://x.com/zksnarks_/status/2100620785651941799)); bidders
  had to take the operator's count of every bid on trust.
- **A timelock needs no reveal step.** Commit-reveal auctions stall when a bidder never reveals; a bid sealed to a drand
  round opens by itself.
- **Shielded Zcash hides who paid,** so prices can be published after the opening without naming the bidders.

## 3. Lifecycle

```
DRAFT → OPEN ──T_submit──▶ FREEZE ──T_freeze──▶ SEALED-WAIT ──drand round R──▶ OPENED → CLEARED → SETTLING → SETTLED
                                  └─ freeze fails ───────────────▶ CANCELLED → REFUNDING (fixed C, no decryption needed)
```

Constraint: `T_submit < T_freeze < T_R`. There is a confirmation buffer (≥10 blocks ≈ 12.5 min pre-NU7, plus scanner lag)
between submit and freeze. The accepted set is frozen and published as a Merkle root *while bids are still sealed*. Nothing is
ever admitted after T_freeze, and the same auction is never reopened after the plaintext exists.

## 4. Bid (what the bidder's client does, locally)

1. The client reads the signed **auction manifest**. It pins:
   - network, auction ID and the escrow UA;
   - the FROST group key;
   - lot and supply, reserve, price tick, `B_max` and `q_max`;
   - the fixed collateral `C ≥ q_max·B_max` and a separate fee;
   - the clearing and tie rules;
   - the drand **quicknet** chain hash, key, scheme and the **exact round R**;
   - `T_submit` and `T_freeze`;
   - the refund and cancel policy.
2. The bidder enters a price and quantity. The client builds a **fixed 128-byte plaintext**:
   `version | auction_id | price_zats | quantity | nonce | one-time owner pubkey | salted settlement-commitment | padding`.
   There is no address in it.
3. The client tlock-encrypts that plaintext to round R (age/tlock, in the browser). This is the only place plaintext exists, and
   there are no network calls with bid data.
4. Memo = `0xFF "BNZ" 0x02 len ciphertext envelope_tag` (framing v2): the ciphertext and a tag binding the bid's
   settlement envelope, inside the 512-byte memo.
5. The refund destination is a **fresh diversified address from the bidder's own wallet**. It goes into a separate *settlement
   envelope* encrypted to the escrow signers and is never in the public tlock opening.
6. Pay **exactly C** in shielded ZEC to a per-bid diversified escrow address, via a ZIP-321 URI/QR (ZODL, Zingo, Zkool) or the
   embedded WebZjs wallet.
7. The bidder gets a signed **inclusion receipt** (ciphertext hash, note ID and leaf index). They can later prove the bid was
   included, or dispute an omission.

Every deposit is identical (C), every memo is the same size, and there is no bid-dependent metadata. The escrow's viewing key
reveals only "someone sent C with an opaque blob".

## 5. Opening and clearing (anyone can do it)

- At round R, anyone fetches the drand signature and verifies it against the pinned chain. They decrypt all ciphertexts in the
  frozen set (the official Go tlock is the reference; the browser runs it too) and run the open-source clearing.
- **Mode A: launch auction (multi-unit, uniform price).** This matches the organizer's format.
  - Sort by price. Fill the top bids up to supply. Everyone pays the lowest winning price.
  - The final price band is filled pro-rata, with integer zatoshi rounding. Dust follows a pre-declared rule.
  - Ties are broken by the committed leaf index, not by reveal order or confirmation order.
  - Reserve price and a minimum fill apply.
- **Single-lot mode.** Second-price (Vickrey), with the winner paying the second price. Minimal output: publish the winner's
  payment, not their maximum.
- Invalid, undecryptable, over-cap or duplicate ciphertexts get a pre-declared refund (C minus fee). Nothing is at the
  operator's discretion.
- Output: `result.json`. It holds the clearing price, anonymized (price, qty) per leaf, fills, the refund plan and the
  conservation check (Σin = Σpayout + Σrefund + fees).

## 6. Custody and settlement (2-of-3 FROST, per auction)

- **Signers: operator, organizer/seller, and an independent community signer.** Each runs on a separate machine.
  - Keys come from a dealerless DKG, made per auction.
  - The vault is emptied after settlement.
- Each signer **independently recomputes** `result.json` from the frozen root and the drand round. They check every PCZT output
  (recipient, amount, fee, change) before signing, and never sign a coordinator digest blindly.
- Refund and payout batches start at 50 recipients per tx. The settlement ledger is idempotent, with states
  `seen → confirmed → eligible → allocated → paid/refunded/exception`. Each raw tx is stored before broadcast, so nothing can
  be paid twice.
- Every bidder gets a **private settlement receipt** they can check in their own wallet.
- **drand unavailable?** The quorum refunds fixed C to every deposit without decrypting anything.
- Stack, per the feasibility study:
  - Cyze's Ironwood FROST/PCZT cohort as the reference implementation;
  - `frost-client`/`frostd` for signing sessions;
  - crash-safe nonce consumption.

## 7. Mode B: sealed treasury buybacks (the organizer hook)

This is a reverse auction on the same engine. A collection treasury posts a budget and price floor. Holders submit **sealed
asks** (price, quantity) under the same C/tlock/freeze rules. At R, the treasury buys the lowest asks up to budget at one
uniform price. Borrowed from Confidential Buybacks: rolling windows and encrypted floors.

This maps directly to zkSNARKs' royalty-funded buybacks (Sep 23): holders sell into the floor without revealing their ask
before close. Ship it only once mode A passes all gates.

## 8. Cross-chain (optional, off the strict privacy path)

The NEAR Intents 1Click flow funds **the bidder's own Zcash wallet** (EXACT_OUTPUT = C + fee). After a buffer, the bidder
makes the normal fixed-C shielded deposit. No bridge-to-escrow transfer, and no quote ID in any bid. The UI states plainly that
the source-chain leg is public.

## 9. Asset delivery

The seller delivers outside Zcash consensus (ZSAs don't exist), and the UI says so. The MVP ships **one adapter**. Candidates:
- Zilkroad serial registry with signed holder receipts;
- ZecBit allocation records;
- LASTWICK ownership.

The manifest binds the collection, serial range and metadata commitment. The winner's private receipt serves as the claim.
Keep a searchable exception queue for "paid but not delivered".

## 10. Screens (winners had real UI; this is where we out-execute)

1. **Auction page:** lot, rules, a countdown to *drand round R* (not block height), the sealed-bid counter, and a live
   **"Operator view" panel** showing exactly what the escrow wallet sees: N × C ZEC and opaque blobs.
2. **Bid:** price and quantity, then "Seal locally", then pay with a QR/URI or the embedded wallet, then a receipt with a
   "prove my bid was included" link.
3. **Freeze board:** frozen root, witnesses and deposit count, all while sealed.
4. **Opening theatre:** at R, the browser fetches the beacon, decrypts every bid live and animates the clearing.
5. **Results + my settlement:** the clearing price, my fill or refund status and the tx; a batch progress bar.
6. **Verifier:** re-run the clearing from the frozen root and the drand signature in one click, or via the CLI.
7. **Signer console:** result diff, per-output checks, then approve.
8. **Seller setup:** manifest builder with a "privacy lint" that refuses bid-dependent fields.

## 11. Two-minute demo

1. Open "Genesis Sealed Drop".
2. Three wallets bid (one funded via NEAR).
3. Cut to the operator view: identical deposits, unreadable memos.
4. Freeze.
5. drand round hits: the theatre decrypts and clears at a uniform price.
6. The FROST signers approve and refunds land in the losers' wallets.
7. The verifier recomputes the same result.
8. Closing line: *"The zkSNARKs sale had to trust its auctioneer. This one doesn't."*

## 12. Four-week plan (release gates from the feasibility study; fail a gate, then narrow the scope)

- **Week 1: gate.**
  - A real 2-of-3 FROST spend of an Ironwood note on testnet.
  - The scanner recovers exact memo bytes.
  - A browser tlock ciphertext fails before R and decrypts after R via Go.
  - Decide between binary memo and off-chain ciphertext.
- **Week 2:** manifest, receipt ledger, freeze and root witnesses, deterministic clearing (modes A and single-lot), and rules for
  malformed, late and replayed bids.
- **Week 3:** multi-output PCZT refund worker, signer console, crash, rebroadcast and double-pay tests, the drand-outage
  cancel drill, and the UI screens.
- **Week 4:** a small bounded-value **mainnet** auction, run end to end, plus the verifier, polish and video. Rehearse on the
  NU7 testnet (Oct 6+), but don't depend on NU7.
- **Stretch:** mode B buybacks, NEAR funding, a collection adapter, and a 17k-bid load rehearsal.

## 13. Borrowed from (winners and references)

| Idea | From |
|---|---|
| tlock sealing, fixed escrow cap, permissionless keeper/void | Sub-Rosa; drand/tlock; randa-mu demo |
| Automatic opening, no bidder reveal | Shutter; Tacet |
| Fixed price-independent collateral | Sub-Rosa; randa-mu; SealPad; Starlock |
| Complete accepted set, pro-rata marginal fill, reserve | OpenZeppelin Canton confidential-auction spec; datum (Canton winner) |
| Pro-rata rounding and dust rules | PrivBatch (1st); SealPad; Stelvin |
| Committed destination, prepaid claim fee, one-action claim UX | Penumbra ZSwap |
| Proof-before-open, consume-once nullifiers, explicit trust boundaries | Renegade |
| Minimal output (winner pays the second price, max hidden) | Arcium official sealed-bid example |
| Rolling windows, encrypted floors (mode B) | Confidential Buybacks (Zama 3rd) |
| Phase-appropriate action cards, three explicit windows | Nyxbid; Noctis staged fund/commit/claim UX |
| Idempotent settlement states, exception queue | Organizer forensics (ZecBit support load, Zilkroad refunds) |

**Avoided, because others got it wrong:**
- bid-sized deposits (shieldbid, organizer);
- server-side encryption (BlindDeal);
- voluntary reveals and placeholder penalties (Aztec sealed auction);
- reveal-order ties (Nyxbid);
- float money (datum);
- public bidder metadata (Fhenix PoC, Sub-Rosa);
- "flow encryption" claims for unshipped crypto (Penumbra);
- operator plaintext APIs (datum, Dark Pools).

## 14. Honest limits (put these in the README)

- drand threshold collusion can open bids early.
- A 2-of-3 signer collusion can steal or freeze the vault.
- A compromised client can leak its own bid.
- Post-close bid prices become public, anonymized.
- Network metadata (IP, timing) needs Tor or a VPN for strict anonymity.
- Seller delivery is off-chain.
- Fixed collateral C ties up capital above the bid.
- A single C per auction, no raises in the MVP. Old tlock ciphertexts stay openable, so bid revisions are unsafe.
