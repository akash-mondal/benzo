# SealPad

Research owner: `auc-doss-fhe`. Read-only source review, 2026-09-30. Repository: https://github.com/YanYuanFE/sealpad; pinned commit `8a8343cb427ded65e32e6e734a9b6de5e3946b21`. All `path:line` references below are relative to that checkout, available under `/tmp/zecathon-code/auc-doss-fhe/YanYuanFE--sealpad/`. No repository code, build, tests or deployments were executed. Static findings are distinguished from runtime confirmation.

## Facts and implementation reality

Saved source: Zama Developer Program Mainnet Season 2, Special Bounty OpenBuild winner ([organizer source](https://www.zama.org/post/announcing-the-developer-program-mainnet-season-2-winners)). EVM/fhEVM sale contracts and Vite React UI. Code uses real FHE input conversion/signature checks, ordinary ERC20/native payment deposits and ordinary sale token; mocks include MockERC20. Deployment/award and live end-to-end operation were not independently exercised. This is encrypted contribution-size bidding with **public limit prices**, not fully sealed price bids, and its Dutch mode is a uniform-price batch auction rather than a descending clock.

## Lifecycle and bid flow

`contracts/contracts/SaleVault.sol` is abbreviated SV. Factory clones vault, initializes, and moves all sale inventory atomically (`SealPadFactory.sol:70-82`). Parameters: fixed/Dutch, floor/fixed price, soft/hard fundraising caps, max per-user contribution, start/end, whitelist root, cliff/vesting (`SV:43-81`). Active -> Finalizing -> Settled/Failed; Cancelled only creator with zero participants (`323-330`).

1. Add public independent ETH/ERC20 deposit within start/end (`337-353`). Deposit-only users may withdraw before finish; participating users must wait (`356-368`).
2. Encrypt contribution locally; whitelist proof required if configured. Fixed contribute clips amount to min(deposit,maxPerUser), replacing previous contribution and adjusting encrypted total (`375-405`). Dutch bid submits **public price** >= floor and encrypted money amount, clipped similarly; replaces previous price/amount (`412-441`). Max 50 distinct participants (`155`, `311-316`).
3. After deadline anyone requestFinalize; empty sale immediately fails/returns inventory, otherwise record block (`452-465`).
4. Wait 95 blocks; finalize marks all current per-user amounts publicly decryptable, and fixed total too (`471-489`). This guards close-finality before disclosure; not 95 blocks after disclosure.
5. Off-chain caller decrypts full vector, submits signed values to settleFixed or settleDutch (`498-511`, `573-612`). Settlement then runs **plaintext** allocation and ordinary payments. Users withdraw remaining deposits and claim vested sale tokens.

## Data, clearing, ties and rounding

Public deposits, participant list, public per-user prices, encrypted amounts; public allocations/claimed tokens (`132-149`). No commit/reveal salt, ciphertext handle retained per user.

```text
fixed: T = sum(contributions)
if T < softCap: fail
scale contribution by hardCap/T if oversubscribed
allocation = floor(effectiveContribution * tokenScale / fixedPrice)

dutch: q_i = floor(contribution_i * tokenScale / publicPrice_i)
walk distinct prices from high to low
capacity(price) = min(inventory, floor(hardCap*tokenScale/price))
sum demand at each price; stop at full/overflow price
all prices above clearing get full q_i
at clearing, if overflow: q_i = floor(q_i*remaining/levelDemand)
payment_i = floor(q_i*clearingPrice/tokenScale)
if sum(payment_i) < softCap: fail
```

Exact routines `SV:513-566`, `618-741`. Equal price level shares pro-rata; integer dust remains unsold/returned, with refunds retaining unpaid balances. Undersubscribed Dutch uses lowest processed nonzero level as clearing (not necessarily configured reserve), and `hardCap` changes capacity at each price. No encrypted sort remains after finalize.

## Escrow, change, delivery and griefing

Inventory is pre-funded. Public deposits remain held after participation until settled/failed/cancelled; deduct actual charge, send total to creator, return unsold inventory (`690-724`). Claims obey cliff then linear vesting (`747-775`); refund = residual deposit, independently pulled (`356-368`). Creator cannot cancel with participants. No non-reveal penalty since KMS supplies plaintexts, and no spam bond beyond positive deposit. Encrypted zero contributions still use scarce participant slots: clipping does not enforce positive value. Fifty Sybil addresses can exhaust capacity. No permissionless timeout escape from stuck Finalizing/KMS outage found.

## Privacy and leaks

Before close seller/operator can read every public bidder price, deposit upper bound and identity (`SV:132-145`, `171-174`, `438-441`); amount ciphertext ACL allows only contract and user (`430-432`). A deposit chosen equal to intended contribution reveals it by correlation. After finalize **every amount including losing bids** becomes public, not just clearing result (`482-487`); settlement calldata supplies complete plaintext vector (`573-612`). Allocations, token delivery and payments are transparent (`148-149`, `709`, `717`, `760-762`). The 95-block wait is a valuable example of irreversible disclosure versus reversible chain state (`157-163`), but does not solve deposit/price leaks.

## UI and UX

`frontend/src/pages/` has Landing, Home, CreateSale, SaleDetail, MyActivity, Docs. SaleDetail reads deposit, participation, allocations (`SaleDetail.tsx:70-94`) and supplies finalize request block (`350`). Separate components: DepositPanel, ContributePanel, RevealMyBidButton, FinalizeBanner, SettleBanner, ClaimPanel, WithdrawButton, VestingProgress, whitelist eligibility and scheduled-start banners. Bidder deposits then contributes/sets public price, can replace submission, privately views own effective amount, returns to claim/refund. Seller deposits inventory, waits through close and finality, then anyone can settle. Source-inspected, not browser-tested.

## Judgment and Zcash mapping

**STEAL:** independent collateral pool, clipping/solvency bounds, replacement UI, minimum raise, grouped-price pro-rata with explicit rounding, scheduled start, inventory custody, finality gate before disclosure.

**AVOID:** public prices/deposit upper bounds, decrypt-all settlement if losing privacy is promised, 50-address cap, no stuck-settlement escape, vesting feature scope for hackathon MVP.

Zcash memos should contain encrypted price **and** quantity, with auction-bound receipt and collateral reference. Fixed collateral tiers let an operator scan notes without learning bids; exact bid-sized deposits do not. Off-chain signed close snapshot precedes tlock/committee disclosure, with a confirmed-block policy; tlock naturally matches decrypt-all-after-close behavior but cannot offer permanent loser secrecy. For stronger privacy use off-chain FHE/MPC to output allocation/price only. FROST/PCZT implement residual ZEC refunds and seller payout with signer-enforced accounting; token sale inventory/vesting remains external because Zcash cannot issue these assets. NEAR Intents can fund ZEC, not import this vault contract.
