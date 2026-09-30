# Starlock — reusable tlock auction/receipt infrastructure dossier

## 1. Facts and implementation boundary

Source: [starlock-master/starlock](https://github.com/starlock-master/starlock/tree/e53ac8c8d568a1b9bbf4f5eb04c96dd9c6fc2b4a), commit `e53ac8c8d568a1b9bbf4f5eb04c96dd9c6fc2b4a`; clone `/tmp/zecathon-code/auc-doss-timelock/starlock/`. Candidate `gh-markets-068` describes an implementation/product, no independently verified event placement. Stellar Soroban + drand Quicknet. README links testnet/mainnet contracts and hosted app (`README.md:11`); deployment claims were not rechecked live. No code or tests executed.

Implemented: legacy and Core v2 rounds, BLS gate, canonical envelopes, token escrow/payment/refunds/lot delivery, partner templates, live signed pilot UI, queue/store/watch keeper and receipt tooling. Architecture is substantively similar to Sub-Rosa; inspected Starlock HEAD lacks Sub-Rosa HEAD's protocol-3 owner-trigger policy. This dossier does not treat shared architecture as independent cryptographic validation.

Abbreviations: **C** = `contracts/round/src/lib.rs`; **P** = `apps/web/src/pages/PilotPage.tsx`. Repository calls payload sealing deterministic (`README.md:22`), but tlock encryption and nonce generation are randomized; deterministic commitment encoding is a different property.

## 2. Lifecycle and exact bid flow

States Open → Revealing → Cleared → Settled; no valid winner → Voided; stale unopened round can void; ReceiptOnly finalizes without money (`contracts/round/src/types.rs:49–76`; `C:863–1018`). Core v2 cohort capped25, legacy500, ciphertext4096, auditor2048, round duration30days, unopened grace **3600 seconds** (`C:25–39`). The candidate's historical 60-second description does not match inspected HEAD.

1. Seller creates round with mode/schema/item, assets/lot, R, cutoffs and max participants. Optional partner policy fixes equal escrow and allowlist; auction creation locks lot tokens (`C:78–147`, `597–658`). Raw v2 creation without partner policy permits variable collateral; README's identical-escrow statement describes the partner path (`README.md:58`; `C:692–705`).
2. Browser constructs a structured bid with amount, nonce and app bytes; hashes every envelope byte and tlock-encrypts to R; identity optionally encrypted separately (`packages/tlock/src/payload.ts:155–189`).
3. Bidder signs commit; contract checks auth/status/cutoff, eligible participants/fixed escrow if policy exists, and size. Replacement returns old escrow and pulls new; first registration position remains (`C:660–762`). Equality at commit cutoff is accepted.
4. After commit cutoff, anyone opens by supplying a BLS signature which the contract verifies for R. Pairing uses configured key/DST and SHA256(be8(R)) (`C:768–798`; `contracts/round/src/drand.rs:28–53`).
5. Keeper or any party decrypts public seal and submits canonical envelope for bidder. Hash mismatch/invalid amount/schema reject. Auction amount must be positive and <=escrow (`C:804–857`). Bidder return is unnecessary for a valid published ciphertext.
6. After reveal cutoff strictly passes, clear chooses winner from successfully revealed valid records; settlement transfers payment/refunds/lot. Open-only void after cutoff+3600 refunds all and returns lot (`C:863–1018`, `1127` onward).

Timing qualification: configured `time_of_round` computes `genesis + period*R` (`contracts/round/src/drand.rs:60–64`), whereas inspected drand-client v1.2.5 convention is `genesis + period*(R-1)` (`drand-client/lib/util.ts:26–31` in its separate pinned checkout). If config uses unadjusted published genesis, schedule validation overestimates release by one period. An application-selected cutoff very near that boundary may not safely precede actual release. The example integration uses a much larger 60-second lead (`services/auction-template/core-v2-auction.ts:220–224`). Validate convention/config and retain an explicit acceptance margin.

## 3. Structures and clearing algorithm

RoundV2 = schema/mode/operator/item/assets/lot/R/rule/cutoffs/auditor/cap/bidder list/status/winner/value; policy = fixed escrow + participant list; Submission = H/escrow/full revealed envelope/amount/valid/settled; Seal = ciphertext/auditor bytes (`contracts/round/src/types.rs:91–106`, `143–206`).

Envelope is `SRP\0`, version/flags/reserved, be16 amount at8, nonce32 at24, be4 app length at56, total header60 plus app<=2048. Strict parser validates exact length, version, flags/reserved and absent-amount zeroing (`contracts/round/src/payload.rs:5–87`). Full hash includes app bytes but core header does not mandate auction/chain/bidder domain; embed that context explicitly.

```text
for bidder in stored first-registration list:
    skip if no valid recorded opening
    replace best only if strictly larger (HighestBid) or smaller (LowestBid)
if none: void + refund + lot return
else: winner pays own bid; Cleared
```

`C:897–944`. Equal amounts keep earliest registration, including after replacement. Single winner, no reserve beyond positive amount, no second price, multi-unit or pro-rata. ReceiptOnly marks submissions settled and records count, without selecting economic winner (`C:881–894`). LowestBid transfers winning bid from bidder to operator; it is not automatically a seller-funded procurement contract.

## 4. Escrow, change, delivery, and anti-griefing

Seller's lot asset enters contract at creation (`C:129–134`). Settlement pays operator winning amount, returns winner surplus, refunds every other escrow including missing/invalid openings, and transfers lot to winner atomically (`C:947–998`). Whole-round loops are bounded to25 v2 participants. No non-reveal slash/bond, and commit verifies neither ciphertext correctness nor configured-R encryption (`C:660–762`). Malformed or deliberately unopenable seals can occupy funded slots and receive refunds; cryptographic forced opening only applies to valid submissions.

ReceiptOnly rejects escrow and token lot configuration; it produces evidence for external decisions, not delivery enforcement (`C:92–103`, `687–690`, `881–894`). A SAC lot is a represented token; physical/NFT custody is not established by a human-readable itemRef alone.

KeeperStore persists watch metadata/last status/retries to JSON (`services/keeper/src/store.ts:4–17`, `89–99`, `130–135`). Save errors log and return; direct overwrite is not atomic/fsynced, and corrupt parsing can back up then start empty (`56–85`). SettlementGuard is explicitly in-memory and assumes restart is safe because contract state is reread (`services/keeper/src/settlement-guard.ts:3–16`, `77–82`). Watch loop updates confirmed statuses and retry errors (`services/keeper/src/watch-loop.ts:101–148`). These are operational aids, not a durable exactly-once payment journal.

## 5. Privacy and leaks

Before R, public observers/operator know wallet addresses, admission/order, escrow values, size and release metadata (`C:739–760`; `contracts/round/src/types.rs:143–206`). Fixed partner escrow removes price-valued collateral leakage; variable-cap raw rounds still reveal funding bounds. Auditor identity is separately encrypted, granting its recipient pre-close identity visibility without automatically revealing price (`packages/tlock/src/payload.ts:167–171`; `packages/tlock/src/auditor.ts:9–39`). On a public Stellar ledger, ordinary payer addresses are already visible.

After R every ciphertext holder can decrypt complete app bytes; reveal persists envelope and emits bidder/amount (`C:851–857`). Legacy keeper logs bidder/value (`services/keeper/src/keeper.ts:205`); v2 logs participant while plaintext envelope is still public (`326`). Expiring seals is not retroactive historical erasure. A keeper that skips failed openings plus clearing only recorded valid states can omit a legitimately openable accepted bid through liveness/censorship; multiple keepers and a completeness policy remain necessary (`keeper.ts:288–329`; `C:900–910`).

Configured key, negative generator, DST, genesis and period form a deployment trust boundary. BLS verifies the configured network, not automatically an independently approved network. Commit accepts arbitrary ciphertext within size limit, so presence does not prove it stays unreadable through cutoff.

## 6. UI / UX

Landing/Docs/Architecture/Demo/Dashboard, pilot catalogue and named integrations, live PilotPage, PublishedReceiptPage. Pilot creation signs round transaction (`P:255–268`); bidder signs actual locally sealed commit (`P:307–330`); displayed fixed policy collateral is distinct from private amount (`P:635`, `668`). Reveal opens BLS gate, loads each seal, decrypts, signs reveal, then clear/settle/void actions (`P:365–441`). Demo traces and published evidence coexist with live transactions; label them clearly.

Auction template uses seller and multiple bidder keys in the same script and preselected bids (`services/auction-template/core-v2-auction.ts:155–169`, `250–275`): that demonstration operator knows those sample bids beforehand. This is distinct from client-local sealing by independent bidder wallets. Captured transaction receipts/preflight improve evidence, but helper retries must reconcile already-submitted transactions before reissuing money movements (`85–123`).

## 7. Judgment and Zcash mapping

**Steal:** embeddable canonical schema/templates; fixed collateral/allowlist partner mode; explicit lot custody; small bounded cohort; live signed pilot; receipt inspection; queue/status observability and per-submission failure handling.

**Avoid:** unproven force-open for arbitrary ciphertext; permissive raw variable collateral; interpreting ReceiptOnly as financial settlement; template-controlled bidder keys as operator-blind demo evidence; one-period schedule confusion; in-memory suppression as Zcash payout idempotency.

**Recommended mapping:** a standalone bidder bundle seals locally to a strictly pinned drand schedule; fixed shielded deposits become auction-scoped opaque receipts; freeze complete admission before R and replicate ciphertexts. Keep open/clear services independently runnable. Replace Soroban settlement state with a durable output-obligation ledger, confirmed transaction reconciliation, and FROST signers independently checking PCZT outputs against the same accepted/result manifest. Store saves must fail closed for payout decisions. FROST does not implement a shielded on-chain timeout refund or token-lot transfer; external custody/delivery must be explicit. Keep refund/identity material separately encrypted if publicly available ciphertext becomes universally readable after close.
