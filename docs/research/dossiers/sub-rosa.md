# Sub-Rosa — design dossier

## 1. Facts

Repo https://github.com/karagozemin/Sub-Rosa; snapshot **f769a4550127e502558ffef06bd9a284065babd8**. Read-only checkout `/tmp/zecathon-code/auc-doss-timelock/sub-rosa`. Candidate source: Hack Privacy / IBW 2026; first-place status is a repository/search-source claim, not independently verified. Chain: Stellar Soroban, with drand Quicknet cryptography off-chain and a BLS reveal gate on-chain. The inspected HEAD is newer than the candidate's 04a4dc… snapshot: v1, Core v2 and protocol 3 opening policy coexist.

Real implementation: token custody/transfers, commitment/reveal/clear/settle/void, structured envelopes, SDK and funded keeper. Test files exist but were not executed. Hosted demo/dashboard includes fixture/trace data, while `apps/web/src/pages/PilotPage.tsx:324-358` actually encrypts and calls signed contract transactions. `docs/LIMITATIONS.md:8-18,35-43,58-65` distinguishes testnet traces, small mainnet smoke, offline receipt checks and unaudited custody; network transactions were not independently verified here.

## 2. Lifecycle and exact bid flow

`Open → Revealing → Cleared → Settled`; no-valid-bid clear or stale unopened round → `Voided` (`contracts/round/src/types.rs:48-57`). ReceiptOnly mode clears directly to Settled. Seller creates round, optionally escrowing tokenized lot. Commit cutoff < scheduled drand release < reveal deadline; Core v2 duration <=30 days and cohort <=25 (`lib.rs:25-42,72-105`).

1. Seller signs round creation with item/schema refs, payment and lot assets, lot amount, clearing rule, drand R, deadlines, auditor key and max cohort. Partner policy optionally fixes one public collateral amount and allowlist (`types.rs:82-99`; `lib.rs:107-137`).
2. Bidder locally constructs canonical payload with amount + random 32-byte nonce. Legacy preimage is be16(i128 amount)||nonce. SHA256 binds it. `packages/tlock/src/seal.ts:38-57` encrypts preimage using tlock-js to R; optional identity is separately encrypted to auditor.
3. Bidder signs commit with H, C, public escrow and auditor blob. Core v2 enforces fixed escrow for partner rounds (`lib.rs:743-756`). A replacement refunds old escrow then locks new escrow, preserving first registration position (`:762-788`). Commit accepts through timestamp == cutoff (`:735-737`).
4. Keeper/UI fetches R signature, verifies BLS via contract and opens reveal only after commit cutoff. `contracts/round/src/drand.rs:28-53` checks pairing over SHA256(be8(R)) with configured pubkey/DST/negative generator. These configuration inputs must be correctly pinned; deployer-chosen cryptographic parameters are a trust boundary.
5. Any party decrypts each ciphertext after R and submits opening; commitment mismatch rejects without poisoning state. Envelope must be valid, amount >0 and <=escrow in auction mode (`lib.rs:875-932`). No bidder cooperation required for correctly formed, available ciphertext.
6. After reveal deadline strictly passes, anyone clears; only valid recorded openings participate. Anyone settles atomically, or voids unopened round after deadline + **3600 seconds** (`lib.rs:936-1092`). Older records elsewhere claiming a 60-second grace do not describe this HEAD.

Protocol 3 OwnerTriggered opening requires owner until an immutable fallback, then becomes permissionless. Fallback must be after R and leave >=300 seconds until reveal deadline (`lib.rs:667-698,819-871`). This gates on-chain processing, not decryption: anyone can decrypt ciphertext at R before owner opens.

## 3. Structures and clearing

Round: operator, item/schema refs, mode/assets/lot, R, rule/deadlines, auditor key, participant cap/index, status/winner/price (`types.rs:169-190`). Submission: commitment, escrow, full revealed envelope, revealed amount, valid, settled (`:215-222`). Seal: ciphertext + auditor blob (`:228-233`). Durable settlement state is separate from expiring ciphertext.

Core envelope: 4-byte `SRP\0` magic, version/flags/reserved bytes, 16-byte amount at offset8, nonce at24, payload length at56, 60-byte header plus <=2048 app bytes. Parser strictly checks exact length and flags (`payload.rs:5-87`). Commitment covers all envelope bytes (`lib.rs:901-905`). It does not require auction/network/bidder context in interpreted header; applications should domain-bind them in committed payload.

```text
best = none
for bidder in first-registration order:
  skip unless state.valid and opening exists
  if best absent or amount strictly better under highest/lowest:
    best = bidder, amount
if none: void; refund all; return lot
else: record best; status = Cleared
```

`lib.rs:970-1017`. Equality keeps earliest registered bidder (replacement retains position); no reserve beyond positive amount, no second-price, no quantities/pro-rata or multi-unit allocation. LowestBid pays that bid from bidder to operator, so it is a selection primitive, not automatically a seller-funded procurement auction.

## 4. Escrow, refund, delivery, anti-griefing

V1 locks USDC-like configured token but only references item off-chain; v2 auctions escrow a lot token at creation (`lib.rs:131-137`). Settlement sends winning amount to operator, surplus to winner, full escrow to every other bidder (including missing/invalid reveal), then lot to winner in one Soroban transaction (`:1020-1071`). Void refunds collateral and returns lot (`:1200-1220`). ReceiptOnly disallows money/lot configuration and escrow.

Bounded ciphertext4096/auditor blob2048, bidder caps500 legacy and25 v2, 30-day lifetime, allowlists and fixed collateral reduce resource griefing. No non-reveal penalty or separate bond: a bidder can submit malformed, unrelated or wrong-round ciphertext, then get full refund if it never reveals. **Commit verifies sizes and hash storage, not encryption validity or that C opens to H at configured R** (`lib.rs:711-816`); cryptographic force-open is conditional on honest well-formed submissions. Keeper skips invalid/decrypt-failed submissions (`services/keeper/src/keeper.ts:70-75,233-260`). A proof of ciphertext/preimage/round consistency or narrowly specified invalid-bid penalty would be a stronger admission policy.

Clear uses only successfully submitted openings; it does not require every honest decryptable bid to be included before clearing. Multiple keepers and sufficient reveal interval matter. There is no truly simultaneous reveal-all transaction (`docs/LIMITATIONS.md:47-52`). Core v2's small cap explicitly reflects full-loop settlement limits. Temporary ciphertext expiry is not erasure from historical transactions or external archives.

## 5. Privacy: visibility and leaks

Before R, operator/public see bidder Stellar addresses, entry order/count, public escrow, C size and auditor blob size (`lib.rs:790-815`; `types.rs:187,215-233`). Variable collateral reveals a bid upper bound; exact collateral=bid would fully reveal it. Fixed cap removes that amount signal but not membership/address metadata. Auditor can open supplied identity at any time (`packages/tlock/src/auditor.ts:42-71`); identity claim is supplied bytes, not KYC proof.

After R, every ciphertext holder can recover all plaintext, including application data. The contract persists full envelope and publishes bidder/amount (`lib.rs:924-931`); keeper logs each revealed value (`keeper.ts:255`). Protocol 3 does not extend cryptographic privacy beyond R (`types.rs:101-108`; `docs/LIMITATIONS.md:48-52`). This offers operator-blind **pre-close** secrecy under drand threshold assumptions, not permanent losing-bid secrecy or anonymous participation.

Offline receipts verify exporter-provided records but cannot prove chain state or inclusion completeness (`docs/LIMITATIONS.md:41-43`). On-chain BLS verification is a release gate, not a proof that admission C correctly encoded the committed bid. Drand threshold collusion can open early; beacon outage and keeper censorship cause liveness/inclusion failures.

## 6. UI / UX

Landing/docs, trace demo, dashboard, pilot catalogue and live pilot, published receipt views. Source paths: `apps/web/src/pages/{DemoPage,DashboardPage,PilotPage,PublishedReceiptPage}.tsx`. Pilot: connect funded wallet → configure auction/receipt-only, lot and fixed escrow/deadlines → create → load round → enter private price (proposal can add timeline/approach) → local encryption → wallet commit → refresh → reveal/open/clear/settle/void controls. Creation signs transaction (`PilotPage.tsx:246-298`); bidding signs `commit_v2` (`:324-358`); view shows fixed escrow and resulting amount (`:628-633,729-744`). Trace demo is explicitly generated historical evidence, not a fresh auction.

Keeper UX deserves reuse: dry-run explains phase and next action; per-submission failures do not block everyone; state rereads skip duplicates. In-memory pending/submitted/terminal settlement guard (`services/keeper/src/settlement-guard.ts:3-16,77-82`) relies on contract finality across restart. On Zcash a durable payment outbox and tx reconciliation must replace that assumption.

## 7. Judgment and Zcash mapping

**STEAL:** fixed collateral unrelated to private price; canonical full-payload commitments; common drand deadline; permissionless keepers; fail-closed opening validation; separate confirmed settlement state and disposable seals; safe void/refund policy; clearly labelled trace versus wallet-backed pilot; bound cohort.

**AVOID:** public bid-wallet membership; auditor escape hatch without explaining scope; claiming force-open for arbitrary ciphertext; excluding unrevealed-but-decryptable bids without a completeness check; owner-opening UI implying prolonged secrecy; large atomic refund loops; assuming a public commodity token equals an NFT or physical delivery.

**Zcash proposal:** browser-local tlock-js encryption and drand verification port unchanged off-chain. Receive a fixed ZEC collateral tier into shielded diversified addresses; memo binds auction id/round/ciphertext digest/opaque receipt, with replicated payload storage. Bind bid, refund address and item delivery instructions to the same canonical envelope, but encrypt personal/refund data separately if public ciphertext is retained after close. Frozen signed receipt manifest fixes accepted set before drand R. Multiple keepers decrypt and independently recompute; FROST signers validate that exact manifest and conservation, PCZT builds shielded seller/loser/surplus outputs. These mechanisms introduce custody/signing-policy trust because Zcash cannot execute Soroban's BLS gate or atomic auction contract. No ZSA analogue for lot token: external asset custodian or another-chain delivery, optionally NEAR Intents with disclosed source-leg visibility. Recommended hackathon cap is a measured small cohort until payout batching/idempotency is implemented.
