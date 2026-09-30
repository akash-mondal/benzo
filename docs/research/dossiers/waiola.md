# Waiola — design dossier

## 1. Facts and implementation status

Static inspection 2026-09-30, no execution. Clone `/tmp/zecathon-code/auc-doss-batch/Waiola`; [DavidZapataOh/Waiola](https://github.com/DavidZapataOh/Waiola), commit `2b52edd12b7365da09723fa2ddafc8ef8d003843`. All file citations are relative to that commit.

[HackMoney 2026 showcase](https://ethglobal.com/showcase/waiola-ug402) confirms **Uniswap v4 Privacy DeFi 3rd place** and **ENS Integrate ENS** prize. EVM/Uniswap v4 hook, maker HTTP service, ENS discovery, Noir circuit, generated verifier, registry and unit/integration tests are present. Maker defaults to Sepolia (`script/typescript/maker/server.ts:31–35`). No web UI source found. Generated proofs/verifier and tests exist; live settlement and advertised test counts were not replayed. This is bilateral RFQ authorization around AMM swaps, not a batch auction. Maker pricing is mocked: `script/typescript/maker/server.ts:150–164` returns the first configured pool for any hash and a constant ratio 2, while `:180` divides input×ratio by 1e18. That scale mismatch makes the nominal 1:2 quote economically incorrect.

## 2. Lifecycle and exact quote flow

1. Maker publishes ENS endpoint/policy records; taker resolves endpoint and policy hash with `script/typescript/utils/ens-resolver.ts` and requests a direct HTTP quote.
2. `/quote` takes **plaintext poolKeyHash, taker, amountIn, optional minOut**; server validates supported pool and amount bounds (`maker/server.ts:250–293`). It reads pool price, applies a spread, generates expiry/salt, signs an EIP-712 quote and returns all terms (`:295–343`). Direct HTTP hides the request from a broadcast order book, not from the maker.
3. Taker computes Poseidon2 commitment and produces a Noir proof; persists quote/proof files through the taker scripts. `circuits/rfq_quote/src/main.nr:27–63` proves opening consistency and quoted output ≥ requested minimum.
4. Anyone registers `(commitment,expiry,maker,poolKeyHash)` in `RFQRegistry.commitQuote` (`src/RFQRegistry.sol:92–109`). No signature is checked there; registration is not a funded order or auction acceptance.
5. Taker submits swap with hook data carrying quote, maker signature, proof and public inputs (`script/typescript/taker/execute-swap.ts:174–218`). Hook checks registry existence/unused state, pool, maker and signature (`src/RFQSettlementHook.sol:216–274`), strict expiry `now < quote.expiry`, proof and context (`:280–304`, `:393–444`).
6. Hook consumes the registry commitment and returns **zero swap delta modifications** (`:310–331`); PoolManager conducts the ordinary AMM swap. A later tx revert reverts the consumed flag too. Used commitments remain; expired commitments become unusable by time comparison, without a separate archival/refund transition.

States: off-chain negotiated → registered/unused → consumed; alternatively expired/unused. There is no close phase, common reveal time, seller reserve, or collective best-quote computation.

## 3. Data and clearing rules

`Quote = (poolKeyHash,taker,amountIn,quotedOut,expiry,salt)` (`src/libraries/QuoteCommitment.sol:19–26`). EIP-712 binds all fields (`:58–69`), domain binds chain/hook. Poseidon2 commitment hashes six field elements, reducing 256-bit inputs modulo BN254 scalar prime (`:84–99`). Registry stores expiry, maker, pool hash and used flag. Public proof inputs are commitment, pool, taker, amountIn, minOut, expiry; private witness is quotedOut/salt (`main.nr:27–38`).

```text
quote_out = maker_price(amount_in, configured_spread)
C = Poseidon2(pool, taker, amount_in, quote_out, expiry, salt)
prove opening(C) and quote_out >= min_out
at swap:
    require registered(C) and !used(C)
    require correct pool, maker signature and current time < expiry
    verify proof and public-input/context binding
    mark used(C)
    allow ordinary AMM swap, with zero custom accounting delta
```

No batch clearing, tie rule, multi-unit/pro-rata algorithm or reserve. Quote expiry and maker min/max amount policy are bilateral restrictions. A critical distinction: the inequality is about **the promised quote witness**, not the actual pool output. The hook has only beforeSwap validation and no afterSwap output check. `minOut` is not compared to an actual output delta (`RFQSettlementHook.sol:435–436`). An integrating router must enforce realized minimum output separately; the inspected taker script calls `PoolManager.swap` directly with price limit zero (`execute-swap.ts:201–218`), so it is not evidence of a complete valid unlock/settle routing flow. This is a source-derived integration concern, not a tested failing transaction.

## 4. Custody, refunds, delivery and griefing

Registry holds no tokens and requires no quote bond/deposit. Settlement liquidity is AMM liquidity rather than collateralized maker RFQ inventory. Token movement and swap debt settlement belong to PoolManager/router infrastructure. No item delivery or auction refunds. Expiry and consumed flag stop stale/replayed authorized swaps; the hook's context/signature checks stop simple term substitution. Permissionless registration (`RFQRegistry.sol:92–109`) accepts unauthenticated metadata and no freshness check: an observer who learns C can pre-register conflicting maker/pool metadata and prevent proper use because duplicates are rejected. Availability grief, not proof of a theft path. Registry owner can replace authorized hook (`:75–78`). No slashing for quote withdrawal or maker non-response.

## 5. Privacy boundaries and leaks

| Actor/time | Visibility |
|---|---|
| Maker before settlement | Full request and signed quote, identity/address, amount, pool; logs print taker, amount and quoted output (`maker/server.ts:295–307`). |
| Public before settlement | ENS maker endpoints/policy; registered commitment links maker, pool and expiry (`RFQRegistry.sol:102–109`); taker tx metadata. |
| Public pending settlement | **Full quote including quotedOut and salt in hookData calldata**, plus signature/proof (`execute-swap.ts:174–195`; hook decodes same struct at `RFQSettlementHook.sol:352–373`). |
| Public afterward | Same historic calldata, ordinary swap/token transfers, validated maker/taker/input event (`RFQSettlementHook.sol:319–324`). |

The Noir circuit can hide witness fields within a proof, but the surrounding transaction explicitly transmits those fields. Thus circuit privacy does not imply application privacy. API transport is direct HTTP logic, without an encrypted auction opening policy. The code exposes price before inclusion to any public mempool reader.

Additional correctness/privacy caution: full raw pool hash is context-checked while commitment input is reduced modulo field; client/proof generation must consistently encode this reduction. Do not equate a circuit artifact with a verified end-to-end adapter. Pricing and logging merit further production hardening; no runtime claim is made here.

## 6. UI and UX

CLI workflow: ENS discover → request quote JSON → generate proof → commit → execute. Maker runs `/policy`, `/status`, `/quote` and policy reload (`server.ts:193–250`, `:355–360`); no bidder/seller browser screens found. Taker console shows input, quoted output, maker, commitment confirmation, expiry/used status and tx receipt (`execute-swap.ts:131–169`). User must preserve local quote/salt/proof and check expiry before paying gas. Showcase's private RFQ wording is a product description, not a verified secret auction UI.

## 7. Judgment and Zcash mapping

**STEAL:** discoverable maker/seller policy with a hash; signatures bound to market, actor, amount and expiry; consume-once receipts; explicit expiry/status; a proof of acceptable terms *only when the application keeps its witness private*. **AVOID:** encoding secret witnesses in settlement calldata; signing a promised output without checking delivery; unauthenticated reservation of another user's commitment; bespoke proof stack for a simple deadline-sealed auction.

A Zcash seller manifest can publish diversified deposit addresses, seal/decryption schedule, reserve/quantity/tie rules, policy hash and signed auction ID. A bidder locally creates a signed salted bid and encrypts it for post-close opening; memo binds deposit to ciphertext hash. Operator viewing keys decrypt native memos, so put an additional tlock/threshold ciphertext layer around terms and avoid amount-equals-bid deposits. FROST signers enforce a reviewed settlement policy and PCZT builds the refund/proceeds transaction; these substitute organizational enforcement for v4 contract predicates. NEAR Intents may source ZEC but is a separate visibility boundary. No native Zcash custom asset/router can deliver Waiola's two-token atomic swap.

**Design priority:** policy discovery and typed quote binding are useful; the implementation is not an operator-blind sealing or clearing primitive.
