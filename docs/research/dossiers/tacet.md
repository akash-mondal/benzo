# Tacet — timed commit-reveal with real UI and ERC-20 escrow

## 1. Facts and implementation boundary

Source: [karagozemin/Tacet](https://github.com/karagozemin/Tacet/tree/dbc2b8a5baec662e2c2a93efd9017df0959b1895), commit `dbc2b8a5baec662e2c2a93efd9017df0959b1895`; clone `/tmp/zecathon-code/auc-doss-timelock/tacet/`. Candidate `platform-sweep-020` records a HackQuest Arbitrum Open House London submission; no award independently verified. Chain: Arbitrum Sepolia with drand Quicknet. README supplies deployment/transaction evidence (`README.md:58–72`); this static review did not query those live transactions.

Real: Solidity round contract, token movement, SHA-256 commitment checking, tlock-js sealing, wallet create/commit/reveal/settle UI, keeper, SDK, and agent code. Demo token minting and a simulated-agent UI stage also exist. Important implementation boundary: the contract explicitly does not verify drand BLS signatures (`contracts/src/TacetRound.sol:8–11`). The supplied web UI's public escrow equals its bid, breaking its claimed pre-close value secrecy despite real tlock code.

Citation abbreviations: **C** = `contracts/src/TacetRound.sol`; **U** = `apps/web/src/hooks/useRoundSession.ts`; **K** = `services/keeper/src/keeper.ts`. Tests exist in `contracts/test/TacetRound.t.sol` and packages; none run here.

## 2. Lifecycle and exact bid flow

States: Open → Revealing → Cleared → Settled; Open can void after reveal deadline+3600 seconds; clearing with no valid opening also voids/refunds (`C:23–34`, `206–253`, `286–297`).

1. Operator creates round with item reference, drand R, HighestBid/LowestBid, commit cutoff and reveal deadline. Contract requires a future commit deadline and commit<reveal, but does not validate R's scheduled time (`C:109–133`). UI computes deadlines from a fetched schedule (`U:398–414`).
2. Bidder generates nonce, hashes the preimage, age/tlock-encrypts value+nonce in-browser, optionally encrypts auditor identity separately (`packages/tlock/src/seal.ts:37–57`).
3. Bidder approves ERC-20 then commits hash, ciphertext, auditor blob, escrow. The UI computes `escrow = toTokenUnits(bidAmount)` and seals `value: escrow`, then commits that same public escrow (`U:471–521`).
4. Contract pulls escrow. Replacement before cutoff refunds the old escrow and replaces seal/commitment without duplicating the address in bidder list (`C:135–171`). Commit at exact cutoff is allowed; reveal opens strictly after it (`C:174–184`).
5. Anyone can call `openReveal` after commit cutoff. It is just a timestamp/status gate, not proof R has arrived. Anyone possessing a valid preimage can reveal for a bidder during Revealing through the reveal deadline (`C:186–204`).
6. Keeper waits/probes tlock, decrypts each stored seal, and submits reveal; clear waits strictly after reveal deadline, then settle pays/refunds (`K:45–147`, `150–180`). Bidder need not return if the published seal is valid.

Keeper bug/fragility: before opening it probes only the first bidder's ciphertext and returns on its failure (`K:82–92`); a malformed first submission can block this keeper even when other bids open. Other independent callers can bypass that off-chain dependency. Invalid individual openings are skipped (`K:121–140`), so successful decryption of all accepted bids is not guaranteed.

## 3. Structures and clearing

Round stores operator/itemRef/R/rule/cutoffs/status/winner/winningBid (`C:36–49`). BidState stores commitment, escrow, revealed value and flags; Seal stores ciphertext/auditor blob (`C:51–60`). Public getters expose all these plus bidder lists (`C:300–347`). Commitment is `SHA256(be16(value) || nonce32)` without auction, chain, contract, or bidder domain (`C:350–356`).

```text
best = none
for each registered bidder:
    if !revealed or !valid: continue
    if highest rule: prefer larger value
    if lowest rule:  prefer smaller value
    on equal value: prefer numerically lower wallet address
if best is none: refund all; Voided
else: record best address/value; Cleared
```

`valid = value > 0 && value <= escrow`; a hash-matching invalid value is marked revealed but excluded (`C:186–204`). Clearing tie comparison is explicit wallet-address ordering (`C:206–253`), unlike Sub-Rosa's first registration. Address grinding/Sybil strategies can target this tie rule. Single winner, first-price or lowest-price procurement; no reserve, multi-unit, second-price, or pro-rata.

## 4. Escrow, refunds, delivery, and griefing

ERC-20 is pulled at commit. On settle, winning amount goes to operator, winner surplus returns, all other escrow returns; settled flags and ReentrancyGuard prevent ordinary repeated settlement (`C:255–283`). Void refunds all (`C:286–297`, `359–365`). Missing/malformed reveals have no penalty and are refunded with losers. ItemRef is metadata only; no lot token custody or atomic item transfer appears in this contract.

Ciphertext/auditor lengths are capped 4096/2048 but no proof binds ciphertext contents or R to commitment (`C:15–19`, `135–171`). There is no fixed collateral requirement and no bounded bidder count. Linear registration scans and whole-batch settlement/refund loops can hit resource limits (`C:264–279`, `291–294`, `368–373`). With the current keeper, malformed first ciphertext is an additional opening liveness hazard. Refunds do not constitute funded item delivery.

## 5. Privacy and actual leaks

The commitment/ciphertext alone hides price under drand assumptions and a secret nonce. However public BidState escrow and token transfer are visible before close (`C:64–67`, `334–341`). **The actual UI publishes the exact bid through collateral**: `U:471`, `484–489`, `514` set escrow equal to value. An observer/operator does not need to decrypt it. README's “nobody can read” claim (`README.md:43–44`) is therefore too broad for this flow. General callers can overcollateralize but amounts still expose a bound.

Wallet identity, participation, timing, and auditor-blob size are public. After R, anyone with ciphertext decrypts value+nonce. Reveals publish prices; keeper logs bidder/value (`K:138`) and UI says revealed values are public (`U:594`). Optional auditor identity encryption permits auditor access separately; it does not hide public ERC-20 payer identity. Browser history stores round/account metadata (`U:50–59`, `146–173`), while the value is also locally visible in the UI log (`U:521`).

Operator can configure an already-released R relative to commit cutoff because the contract does not validate the linkage (`C:109–133`). Client-selected timing helps honest flows but does not enforce policy. A served malicious bundle can leak local input; tlock does not fix that trust boundary.

## 6. UI screens and UX

Real wallet workflow: connect/switch Arbitrum Sepolia → mint demo tokens → create/join round → approve and seal → countdown/progress → reveal → clear/settle. Hook checks confirmations instead of declaring success immediately (`U:355–427`, `435–522`, `535–628`). Round history survives reload; each action has errors/progress. DemoPage/LandingPage, evidence panels and simulated agent stage coexist, so do not confuse a visual simulated stage with the signed transaction path.

Useful UX: allowance/time checks warn that approval plus confirmation can miss cutoff (`U:471–511`); complete transaction confirmation is distinguished from local encryption. Creation derives a scheduled release with setup/reveal buffers. An unsafe off-by-one schedule approximation uses `genesis + period*R` (`U:404`); canonical `roundTime` convention uses `(R-1)` (see drand-client dossier evidence). With the configured 3-second commit lead (`apps/web/src/config/chain.ts:23`), that extra period cancels the intended safety gap: the computed commit cutoff equals the canonical scheduled time of R. Since commit accepts equality, the UI does not establish a strict pre-release admission margin. An available R signature may therefore overlap the final admissible timestamp; this is a static boundary finding, not a reproduced adaptive-bid attack.

## 7. Judgment and Zcash mapping

**Steal:** client-local seal+commit, bidder-offline keeper opening, confirmed-state UX, winner surplus/loser refunds, bounded ciphertext storage, and a visible lifecycle.

**Avoid:** exact bid-valued deposits; address-ranked ties; item metadata mistaken for delivery; contract timestamps mistaken for verified drand release; the first-bid probe dependency; unbounded whole-round loops; commitments without domain binding.

**Recommended mapping:** fixed, bid-independent shielded collateral; strict canonical memo envelope and auction/domain-bound commitment; drand R safely after acceptance/funding cutoff; signed immutable accepted-set manifest replicated before R. Opening/reveal is off-chain, independently recomputable, and retries process all accepted entries with explicit invalid statuses. FROST signers authorize a PCZT only after reconciling collateral = seller payment + refunds/surplus + disclosed fees. Item custody/delivery needs a separate explicit mechanism. Agents and NEAR Intents must receive a fixed funding cap, not the sealed price in public transaction/quote amounts.
