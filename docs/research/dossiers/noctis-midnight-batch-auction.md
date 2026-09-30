# Noctis — Midnight sealed-bid batch auction DEX

## 1. Facts and evidence boundary

Source: [submission](https://devpost.com/software/noctis-sealed-bid-batch-auction-dex), [repository](https://github.com/nishu0/midnight_hack), commit `dc059d0315d66096c447aee51d38a6897c8a0926`. Saved candidate records identify a hackathon submission; no prize placement independently established. Chain: Midnight, Compact circuits with Midnight.js and Lace integration. This is a double-sided batch DEX, not a seller's single-item auction.

Read-only checkout: `/tmp/zecathon-code/auc-doss-fhe/nishu0--midnight_hack/`. All line references below are relative to that checkout. Static review only: no build, compiler, wallet transaction or project code executed. Actual public network operation is unverified.

Real source: commitments, nullifiers, note membership checks, phase transitions, clearing scan, division witness verification, generated circuit artifacts, wallet adapters, React UI and PostgreSQL pool registry. Mocked/incomplete economics: pool `deposit` creates an accounting note without receiving a coin; `claim` recreates an accounting balance rather than exchanging base and quote assets. The README's final scope section explicitly excludes real Zswap coin transfers and two-token settlement, contradicting its earlier “real escrow” language. The compiled cryptographic logic does not establish asset backing.

Name collision: [NoctisZone/Noctis](https://github.com/NoctisZone/Noctis), commit `169f474277e28af44b13e347a499dfe9dd0d80aa`, is a separate token launchpad. Its README:5,45–58 describes DarkVeil purchases/Cardano migration and a blocked Midnight integration. It is not evidence for this sealed batch auction.

## 2. Lifecycle and exact order flow

`contract/src/nightpool.compact` is abbreviated **N**. States: COMMIT, REVEAL, SETTLED (N:17–21). Batch ID starts at 1; the demo uses 16 price ticks and a batch size of 2 (N:86–87,142–156). There are no block deadlines.

1. User connects Lace, joins or deploys a pool plus separate oracle. A local private-state provider stages witnesses; a configurable HTTP proof provider creates proofs (`frontend/src/api/providers.ts`:82–95).
2. `deposit(public amount)` obtains a secret key and fresh salt, inserts `H(prefix,sk,amount,salt)` and increments public `totalDeposited` (N:129–136,160–168). No native asset receive call appears in this circuit.
3. UI chooses one local note with amount at least the order size, stages side, size, tick, order salt, funding note and change salt. `commitOrder` checks COMMIT, tick bounds, note commitment membership, unused note nullifier and sufficient note size. It spends the note, creates change, inserts the salted order commitment and increments count (N:175–203). Commitment binds secret key, current batch, side, amount, limit tick and salt (N:100–109). Buy-side quote cost is not funded; both sides use the same size-denominated note model.
4. The second commitment automatically switches to REVEAL. Alternatively **any caller** can call `forceReveal` with count > 0, immediately (N:222–225). There is no promised bidding interval to wait out.
5. `revealOrder` verifies commitment, cancellation and reveal nullifiers; then explicitly discloses tick, amount and side (N:230–272, especially 246–248). A buy adds its size to demand at every tick <= its limit; a sell adds size to supply at every tick >= its limit (N:260–268).
6. **Any caller** can settle during REVEAL, without waiting for all commitments to reveal or a timeout (N:276–301). SETTLED stores selected tick, matched volume and spread.
7. `claim` verifies a revealed current-batch order, unused claim nullifier and eligibility. It computes informational fills/quote leg and mints a replacement accounting note (N:305–367).
8. **Any caller** can advance SETTLED to a new COMMIT batch (N:371–381). Claim does not accept a historical batch ID or historical clearing snapshot. Advancing can strand old unclaimed orders.

Cancellation is COMMIT-only. It inserts a cancellation nullifier and decrements count, but creates neither refund note nor escrow release (N:207–218). The source note was already consumed at commit. Non-reveal orders also have no claim route because claim requires the reveal nullifier. These are locked accounting balances, not a specified non-reveal penalty scheme.

## 3. Data and clearing algorithm

Order `{side:0 buy/1 sell, amount:u64, limitTick:u8, salt:Bytes32}` (N:24–29). Note `{amount:u64,salt:Bytes32}` plus private secret-key witness (N:34–37,78–84). Public ledgers contain commitments and reveal/cancel/claim nullifiers; per-tick demand/supply; clearing tick/volume; fee; aggregate totals; per-claim base/quote fills; note commitments and spent-note nullifiers (N:40–75). Reveal, claim and cancel use distinct domain prefixes (N:111–120).

Actual clearing (N:276–301):

```text
bestVolume = 0; bestSpread = max; bestTick = 0
for tick in 0..15 ascending:
    D = demand[tick]; S = supply[tick]
    V = min(D,S); spread = abs(D-S)
    if V > bestVolume or (V == bestVolume and spread < bestSpread):
        best = (tick,V,spread)
```

Equal volume and equal spread preserve the lowest tick encountered. No cross means volume 0, not inherently tick 0: tick 0 is a valid 0.5 price. Tick price is `500000 + tick*100000` in millionths.

For each eligible order, filled base is `floor(amount * clearedVolume / eligibleSideTotal)` (N:329–341). **Every eligible order is prorated**, not just orders at the marginal tick. Division witness is constrained by `q*d <= numerator < (q+1)*d`. Quote output is another verified floor division (N:346–354). Fee is at most one base unit when gross fill permits it (N:343–345). Multiple integer floors can leave dust; no remainder allocation ensures both sides' individual fills sum exactly to clearing volume. There is no reserve or item inventory, just two limit curves.

Actual payout note is original order amount minus fee if filled, else original amount (N:362–366). It is not the computed base/quote trade settlement. Therefore fill math and note balance accounting must not be mistaken for an implemented DEX.

## 4. Escrow, change, refunds, delivery and griefing

Change-note creation and nullifier checks are useful proof patterns (N:183–193). However, freely minted unbacked deposit notes cannot secure real bids. Standalone `contract/src/vault.compact`:55–88 similarly adds/removes accounting notes and totals without transferring an asset; `splitNote`:93–112 is a commitment split, not a funded bridge into a pool.

No delivered NFT or physical-item escrow exists. Pair names are registry/UI labels; no base/quote asset IDs govern funding or payout. No bidder bond, reveal deadline, seller bond or spam economics exists. A participant can submit both orders or force reveal after one. Early settle excludes unrevealed orders; early next-batch can prevent legitimate old claims. Cancellation loses access to the consumed funding allocation. No historical refund sweep repairs these paths.

The oracle is also not authenticated to the pool: `contract/src/oracle.compact`:36–55 accepts caller-provided next batch ID, tick and volume, checking sequence/range only. The UI best-effort records the real pool snapshot (`frontend/src/hooks/useNightPool.ts`:299–314), but another caller can publish invented values first. Registry deletion has no route-level authentication (`backend/src/index.ts`:39–48); this is discoverability griefing, not an on-chain asset attack.

## 5. Privacy: visibility and concrete leaks

| Boundary | What an observer/operator can see |
|---|---|
| Funding | Public deposit amount and transaction timing; aggregate deposited total (N:160–168). A fresh note hides its preimage, not the public deposit amount. |
| Commit | Order and funding-note commitments/nullifiers, batch phase and count. Order contents are private witnesses; funding timing/size can provide linkage. |
| Reveal | **Individual side, size and tick disclosed** (N:246–248), then public cumulative bucket changes. Each reveal's difference reconstructs the order even without explicit disclosure. |
| Claim | Side, limit and amount disclosed again (N:321–323), with public base/quote fill maps (N:359–360); fresh payout commitment does not erase the public order/fill transcript. |
| Browser | Secret key is base64 plaintext in localStorage (`frontend/src/api/secret.ts`:10–15). Notes' plaintext amounts and salts are JSON localStorage (`frontend/src/api/note-store.ts`:9–20,40–44). Site-origin script compromise exposes them. |
| Prover | Configurable HTTP prover selected from wallet service or config (`providers.ts`:86–93). Witness confidentiality against that service was not established by this repository review; “ZK on chain” alone does not prove operator-blind outsourced proving. |

README's assertion that reveal/oracle never exposes an individual order is contradicted by source. The order form itself is more honest: “side, size and price never hit the chain until you reveal” (`frontend/src/components/OrderForm.tsx`:31). These sources support pre-reveal content privacy, not losing-bid secrecy after close.

Operational recovery is also incomplete. Orders are held in React state (`frontend/src/hooks/useNightPool.ts`:273–274); closing the pool clears them (:248). Notes persist but private provider state is memory-only. API deploy/join creates a random private-state key (:72,82) distinct from its separately loaded secret key (:60); staged operations preserve the existing key (:92–96). Rejoin/reload note-key continuity requires verification before describing the wallet flow as durable.

## 6. Screens and UX

Landing and onboarding explain batches; WalletBar connects Lace; pool list/create screens choose pair metadata and deploy contracts. Pool page has a funding card, private note balance, buy/sell order form with size presets and tick slider, local orders/claim panel, phase controls, public depth chart, oracle price series and a guide (`frontend/src/components/PoolPage.tsx`:51–81; `OrderForm.tsx`:29–75). Reveal-all and claim-all issue one transaction per local order (`useNightPool.ts`:280–285,324–329). Fee/DUST status and busy strings help users see proving/submission progress.

Seller role is absent: liquidity providers submit sell orders in the same batch as buyers. Useful UX pattern is explicit numbered fund/commit/reveal/claim steps plus visible private balance. Harmful behavior is presenting an accounting deposit as escrowed real funds and enabling batch advancement without protecting outstanding claims.

## 7. Judgment and Zcash mapping

**STEAL:** salted, domain-separated commitments/nullifiers; verified floor-division witness constraints; deterministic tick tie rule; local private balance and sequential transaction status UX; persistent per-auction outcome snapshots as a requirement learned from the missing historical claim path.

**AVOID:** individual reveal transactions, public incremental depth, fabricated funded escrow, two-order batch triggers, cancellation without refund, permissionless premature phase changes, unauthenticated oracle, claiming full original principal as if a trade executed, browser plaintext secrets without durable recovery.

**Zcash mapping:** an actual shielded ZEC note must fund escrow; an application hash is only a receipt. Use a versioned 512-byte memo envelope carrying auction ID, encrypted bid reference/commitment, receipt nonce and encrypted refund instructions where they fit. The receiving viewing key still reveals note amount: use predetermined collateral tiers if the operator scans deposits. Bind an off-chain MPC/FHE result to frozen accepted receipts and auction rules; disclose only authorized result fields. Use FROST policy signers for governed ZEC settlement and PCZT for construction, while acknowledging neither provides native covenant enforcement. Keep per-auction claim/refund obligations after any new auction starts. NEAR Intents ingress needs its own refund/funding-status screen and an explicit information boundary. No Midnight note or custom token primitive ports directly into Zcash. tlock can remove a manual reveal step but exposes all decrypted bids after its release time; it cannot deliver forever-private losers by itself.
