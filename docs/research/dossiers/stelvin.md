# Stelvin — drand-sealed Stellar batch DEX dossier

## 1. Facts and implementation boundary

Discovered with GitHub repository searches for `tlock auction` and `drand "sealed bid"`. Source: [mericcintosun/stelvin](https://github.com/mericcintosun/stelvin/tree/fe1d68577788122deab6bc218f17ba8e16b39293), commit `fe1d68577788122deab6bc218f17ba8e16b39293`; clone `/tmp/zecathon-code/auc-doss-timelock/stelvin/`. README describes Build on Stellar / IBW 2026 Main + Privacy submission; no award independently verified (`README.md:16–18`). Stellar Soroban testnet, public test asset SACs, drand Quicknet, external Drand-Relay, display-only Noether oracle. README lists deployment addresses and test counts; those are repository claims, not independently checked network/test results (`README.md:36–41`, `178–179`). No untrusted code run.

Real implementation: standing-balance token custody, opaque order storage, deadline gate, relay signature-hash check, on-chain integer clearing/accounting, browser-local tlock wallet submission, demonstration backend, auditor utility. **Mock/trusted boundary:** settlement does not prove supplied plaintext is the stored ciphertext's opening (`contracts/batch-gate/src/lib.rs:658–660`). It also does not require every accepted order in the reveal list. Scripted demo actors' plaintext is constructed by the operator/backend before sealing; the independent wallet path seals locally.

Abbreviations: **C** = `contracts/batch-gate/src/lib.rs`; **S** = `settler/src/server.ts`; **W** = `web/src/lib/wallet.ts`.

## 2. Lifecycle and exact order flow

Batch states Open → optionally Locked → Settled (`C:123–136`). Funds are reusable standing balances, not per-batch reservations.

1. Trader authenticates a base/quote token deposit into the contract; internal account balance increases (`C:427–438`). KYC optional, administered centrally.
2. Admin creates a batch for R at least 12 rounds beyond the estimated current round. Estimate is `(ledger_time - genesis)/3 + 1` (`C:368–372`, `519–545`).
3. Wallet requests `/api/open-batch` from backend, which creates a new batch per request (`S:75–82`; `web/src/components/WalletPanel.tsx:104–110`). Locally encodes JSON `{side, amount, limit_price}`, encrypts to supplied R with `tlock-js.mainnetClient()`, and submits ciphertext signed by Freighter (`W:161–181`). Signed build/simulate/assemble/submit/confirmation code is real (`W:100–138`).
4. Submit requires auth, KYC if enabled, Open status, estimated current round<R, fewer than 16 orders, positive balance in either asset, and one order per trader per batch (`C:554–609`). No amount/side-specific funds are reserved and ciphertext is stored verbatim.
5. Anyone can lock once relay has R. Anyone can settle Open/Locked once supplied 48-byte sigma hashes to `relay.get(R)` (`C:613–653`). Settlement does not call the separately implemented BLS verification view.
6. Caller supplies revealed order IDs and plaintext fields; contract matches, applies all balance changes, records result, and marks Settled (`C:658–688`). Trader can withdraw available balances at any time, including after submission but before settlement (`C:441–455`). No reveal deadline, non-reveal penalty, cancellation, or stale-batch terminal recovery state; withdrawals remain possible.

Demo backend repeats a fresh batch when a relay feeder skips exact R (`S:161–181`). That avoids a stage error but abandons the original batch; it is not same-batch settlement recovery. It uses backend-admin/alice/bob keys and predefined orders (`S:1–11`, `136–150`).

## 3. Structures and exact clearing algorithm

Order = ID/trader/batchID/ciphertext; no hash commitment to plaintext. Revealed = orderID/side/base amount/limit price; trader comes from stored order. Clearing = batchID/price/matched volume/time (`C:131–166`). Balances keyed by trader+asset; prices scaled by 10^7; amounts/price capped; batch capped16 (`C:47–87`).

```text
for each supplied revealed entry:
    reject duplicate orderID, wrong batch, nonpositive/capped fields
    load stored trader; append buy or sell
for p in supplied limit prices:
    D = sum(amount for buys with limit>=p)
    S = sum(amount for sells with limit<=p)
    select p by max min(D,S), then min abs(D-S), then lower p
if no positive cross: return price0, volume0
eligible = priced-in orders funded >=1% of their OWN amount at selected p
m = min(sum eligible buys, sum eligible sells)
raw_i = floor(amount_i*m / own_side_total)
r = min(1, each funded_capacity_i/raw_i), in 10^9 fixed scale
fill_i = floor(raw_i*r/10^9)
traded = min(sum buy fills, sum sell fills)
trim larger side from leading entries until exact base equality
buyer quote debit = ceil(fill*p / 10^7)
seller quote credit = floor(floor(fill*p/10^7)*(1-fee_bps/10000))
protocol quote fee = total buyer debit - total seller credit
```

Exact implementation `C:778–1027`; trimming `C:375–389`. No time/price priority inside eligible sides: all eligible orders are pro-rata across their side, not just marginal-price ties. Integer dust trimming penalizes earlier entries in the **caller-supplied reveal order**, so fill allocation is not order-independent. No reserve/NFT supply; this is a two-sided multi-unit call auction. Price selected before underfunded exclusion and is not recomputed afterward (`C:820–891`); underfunded/withdrawn or fabricated orders can influence the price scan even if later excluded. Global feasibility scaling lets a partially funded participant reduce everyone's execution; 1% eligibility restricts but does not remove that effect.

## 4. Escrow, refunds, asset delivery, griefing

Contract holds real SAC tokens and updates internal balances; realized base/quote delivery is within the ledger settlement transaction, then users withdraw tokens. Unused balances stay available—there is no per-order refund transaction or reserved bid change (`C:427–455`, `975–1007`). Base conserves exactly; quote debit equals seller credits plus accrued protocol fee/rounding dust (`C:965–1027`). Admin may set fee up to 10% and withdraw accrued fees (`C:489–513`); fee config is read at settle, not snapshotted in Batch.

Critical static execution findings:

- `settle` is permissionless and trusts side/amount/price. A caller can rewrite stored traders' intended orders and move their deposited balances at fabricated terms, subject only to arithmetic/funding bounds (`C:637–664`, `789–810`). Authenticating sigma proves release, not owner agreement to fabricated plaintext.
- Membership and duplicate checks exist, but no equality to `batch.order_ids`. `revealed=[]` can close a funded batch with zero trade, omitting all accepted orders (`C:789–850`, `666–681`). A first malicious settlement is terminal.
- Standing funds may be withdrawn after R once market contents are known (`C:441–455`), reintroducing a strategic funding-withholding choice. One order per wallet is not one economic participant.
- Submission needs positive balance in **either** asset, not the asset required by hidden side; small deposits can occupy the 16 slots. No bond penalty, malformed ciphertext proof, or per-ciphertext size bound is in `submit_order` (`C:554–609`).
- Admin fees can change between submission and execution (`C:492–497`, `972`), and backend KYC/faucet/open-batch mutations are unauthenticated demo GET routes (`S:61–98`). These are demo infrastructure, not production permissioning.

Native `verify_round_signature` genuinely performs a BLS pairing view over SHA256(be8(R)) (`C:747–766`), but the settlement function relies on the external relay/hash gate and never invokes that view. Do not claim settlement is relay-independent merely because the view exists.

## 5. Privacy, leaked metadata, and verification limits

The independent wallet locally encrypts before RPC submission (`W:173–180`); before R, public observers learn trader, batch membership, timing, ciphertext size, deposit asset/value and standing balances (`C:142–146`, `603–607`, `712–713`). Depositing only base/quote often suggests side; matching exact deposit value to planned order still leaks economically relevant bounds. KYC administration also sees identity relationships. After R, all ciphertext holders decrypt all JSON orders; reveal parameters and resulting balances become public.

Scripted demonstration is different: the backend defines Alice/Bob's prices and quantities before encrypting (`S:136–150`), so it already knows those demo orders. A pre-R decryption attempt failing on local-time checks does not establish adversarial operator blindness, and the backend-generated flow cannot demonstrate hiding bids from that backend. No actual early break of tlock was found.

The “independent auditor” decrypts all ciphertexts but prints that users should compare them to settlement; it does not itself retrieve/compare executed revealed fields, complete set, price/fills, or custody balances (`settler/src/verify.ts:38–61`). HTTP verify similarly returns decrypted orders and a sigma boolean, then `ok:true`; any decryption exception is labelled placeholder (`S:35–53`). Invalid ciphertext, wrong round, network outage, and real placeholders are therefore conflated. This establishes inspectability, not verified executed correctness. No challenge/rollback/slashing mechanism was found for optimistic misreporting.

## 6. UI screens and UX

Landing, Docs, and Demo pages; side-by-side simulated AMM sandwich and testnet-sealed batch timeline; beacon countdown, ciphertext snippet, decryption event, clearing result, fee/NAV display, verify button, recorded fallback. The AMM half is numerical simulation (`S:109–121`); sealed half invokes real backend-held testnet keys (`S:139–210`). Freighter WalletPanel additionally offers onboarding/trustlines/faucet, KYC status, balances, deposit/withdraw and self-sealed Buy/Sell amount/limit inputs (`web/src/components/WalletPanel.tsx:122–235`; `W:141–197`).

Wallet amounts use JavaScript Number before BigInt conversion and JSON serialization (`W:142–161`, `175`); safe-integer limits need explicit validation. Its per-click open-batch route creates an isolated batch rather than joining a shared market, and the traced endpoint/settler does not establish automatic clearing of those newly created wallet batches. CLI settler demonstrates fixed scripted orders, not a durable general service (`settler/src/settler.ts:1–7`, `30–78`).

## 7. Judgment and Zcash mapping

**Steal:** locally encrypted wallet flow; simple on-chain/off-chain boundary; full integer arithmetic, bounded cohort, conservation invariants, transparent dust/fee attribution, independent ciphertext availability, explicit simulated-vs-live demonstration framing.

**Avoid:** permissionless unproven plaintext settlement, missing complete-set checks, withdrawable collateral through disclosure, feasibility scaling that lets one desk suppress all volume, reveal-order dust allocation, mutable fee terms, and a decrypt-only verifier labelled settlement verification.

**Recommended mapping:** borrow the integer accounting, not its trust claim. For the Zcash auction, accepted fixed collateral is locked under an explicit FROST custody policy until a predeclared settlement/refund outcome; prices are sealed in-browser to pinned R. Before R, publish a signed complete receipt/ciphertext manifest. After R, each independent signer verifies beacon, domain/schema/hash, all accepted openings, deterministic tie/dust policy and fee snapshot, then constructs/reviews PCZT. Every malformed/excluded entry has a receipt and declared refund outcome. All payouts conserve ZEC; a base asset on another chain or a physical lot requires separate custody/delivery. NEAR Intents funding should transfer fixed collateral independently of hidden order terms, and cannot supply Soroban's atomic base/quote settlement on Zcash.
