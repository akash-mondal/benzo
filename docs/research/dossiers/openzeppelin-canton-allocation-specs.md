# OpenZeppelin Canton — allocation and recovery dossier

## 1. Facts, source, and scope inventory

Source: [OpenZeppelin/canton-specs](https://github.com/OpenZeppelin/canton-specs/tree/fcbe972fe98c6ea8f6d0d98f9b3376682f1e048c), commit `fcbe972fe98c6ea8f6d0d98f9b3376682f1e048c`; clone `/tmp/zecathon-code/auc-doss-timelock/canton-specs/`. No hackathon placement. Companion to [the confidential-auction dossier](openzeppelin-canton-confidential-auction.md).

Inventory of reference architectures: confidential auction, constant-product DEX, cross-chain stablecoin, and CDP lending (`docs/reference-architectures/README.md:9–19`). No second auction engine was identified in that inventory. DEX, stablecoin, and lending use allocation/settlement concepts but are different products. The source distinguishes target specifications from bounded experiments; the settlement experiment is an implemented local toy-holding model, not a production token-standard implementation (`experiments/settlement/ARCHITECTURE.md:3–14`, `158–182`). No code was executed.

Citation abbreviations below: **C** = `experiments/settlement/cip-0112/daml/OpenZeppelin/Experimental/Settlement/Cip112.daml`; **A** = `experiments/settlement/ARCHITECTURE.md`; **D** = `docs/reference-architectures/dex.md`; **B** = `docs/reference-architectures/cross-chain-stablecoin.md`; **L** = `docs/reference-architectures/lending.md`. All refer to this pinned commit. The fixture `experiments/settlement/fixtures/token-standard-v2/daml/OpenZeppelin/Experimental/TokenStandardFixture/V2/Allocation.daml:1–97` is compatibility-shaped and explicitly not upstream implementation. The dependency decision requires an accepted immutable upstream artifact closure before promotion (`docs/decisions/cip-0112-dependency-source.md:19–49`). Import evidence dated 2026-08-03 distinguishes preview source, package IDs, artifact digests, provenance and license obligations from a released dependency (`docs/decisions/cip-0112-import-evidence.md:9–48`, `89–93`); these are that dated decision's claims, not a fresh assessment of upstream publication. The promotion decision puts complete applications in separate repositories and says experimental behavior establishes no conformance/audit/release claim (`docs/decisions/cip-0112-promotion-boundary.md:21–47`).

## 2. Lifecycle and exact funded-allocation flow

The transferable lifecycle is request → instruction → accepted locked allocation → batch settlement / cancellation / withdrawal / controlled seizure (`A:47–80`). It is not commit→reveal and supplies no operator-blind encryption.

1. Application proposes settlement info and transfer-leg sides. Account authorizers approve an instruction.
2. Instruction acceptance checks actor equality and valid side amounts, fetches each toy holding, checks account/admin/instrument, archives it, and creates a locked successor holding plus an Allocation (`C:319–335`, `832–848`).
3. The allocation records immutable intended settlement and local sides. Admin and account parties sign; executors observe (`C:403–405`).
4. Batch settlement checks exact executor list, positive nonempty legs, both sender and receiver authorization, and each allocation's own sides, then exercises all allocation settlements in one ledger transaction (`C:195–244`, `457–475`, `1121–1200`).
5. Settlement is permitted at `now <= settlementDeadline`; a committed allocation can be withdrawn by its authorizer or cancelled by executors only at `now > deadline` (`C:1226–1231`, `1286–1307`). A committed allocation with no deadline cannot use those timeout exits. Uncommitted allocations have freer cancellation/withdrawal; active D2 restrictions also gate release (`C:477–500`).
6. Optional typed D1 settlement consumes an attestation rooted in the factory admin's registry and matching settlement reference, exact leg-ID set, and validity time (`C:218–244`, `692–736`). Optional seizure mark/sweep has a bounded capability-based path (`A:144–156`; `C:502–587`).

DEX adaptation: final `Pool_Swap` atomicity sits after asynchronous funding/allocation preparation. The backend tracks unsettled states from ledger data and returns funds after expiry (`D:515–588`). The DEX permits retrying a swap batch excluding a trader who cannot confirm (`D:541–554`); an auction must preserve its already-accepted clearing set instead of importing that exclusion rule.

## 3. Structures, algorithms, and authority binding

Settlement info carries executor list, settlement reference, deadline, metadata. Transfer legs carry unique intended identifier, sender, receiver, amount, instrument, metadata; local sides specify SenderSide/ReceiverSide and the opposite account. Equality checks include full side data, not merely a hash label (`C:1155–1183`). Allocations add authorizer, committed flag, locked holding CIDs, and optional control hooks. Receipts and scoped holding-change events permit recovery/indexing (`C:588–637`, `880–901`). Iteration fields pass through as inert metadata; the experiment has no iterated-settlement semantics (`C:813–818`; `A:109–124`).

```text
batch_settle(settlement, legs, allocations):
    require exact authorized executors and nonempty positive legs
    require every leg has a signed SenderSide and ReceiverSide
    for each allocation in the same transaction:
        require exact settlement, permitted deadline, and local leg equality
        archive locked inputs; tally by instrument
        require locked_value[instrument] >= local_sender_obligation[instrument]
        return surplus as unlocked change to authorizer
        credit local ReceiverSides
        emit local holding-change event and settlement receipt
```

Coverage and change are explicit (`C:856–901`, `946–969`). Only batch composition consumes all sides atomically. Direct `Allocation_Settle` fetches peer allocations/receipts as authorization evidence but consumes its own allocation alone (`C:407–440`; `A:109–124`). `Allocation_SettleInBatch` itself has admin+executor authority and local checks; source comments explicitly warn it must be driven by the factory to achieve both-sided DvP (`C:442–475`). Do not infer global conservation from a local receiver-credit helper.

There is no clearing price, tie policy, reserve, multi-unit supply, or pro-rata algorithm in this allocation experiment. The related DEX uses `x*y=k`, not auction uncrossing (`D:11–13`). Lending is fixed-rate open-term CDP logic with direct liquidation transfers, a target architecture rather than implementation report (`L:3–7`, `11–47`).

## 4. Escrow, refunds, change, delivery, and griefing

The experiment locks holding successors, consumes locked inputs at settlement, returns unused value, and provides cancellation/timeout recovery. It can atomically exchange two represented on-ledger asset legs; it cannot deliver an external physical item merely by recording a reference. Sender funding must cover exact obligations, and leftover value must appear as explicit change (`C:832–848`, `946–969`).

Typed D1 verification's implemented binding is registry admin, trusted attester, `settlementRef.id`, exact leg-ID set, and time (`C:724–735`). It does not by itself bind every amount, party, CID-text, and metadata field. The confidential-auction target's stronger result/approval binding should govern any auction adaptation.

Cross-chain bridge architecture acknowledges that burn plus external release cannot be atomic and that irreversible steps need replay protection/reconciliation (`B:578–606`). Its failure table distinguishes refunds before consumption from reconciling an already-consumed operation (`B:951–960`). These are directly useful for NEAR Intents funding and off-chain delivery: a retry is not proof the first side effect failed.

No auction spam, non-reveal penalty, or bid bond exists. All such behavior belongs to the auction application, not allocation mechanics.

## 5. Privacy and leaks

Allocation contents are visible to their signatories and executor observers (`C:403–405`). The batch driver deliberately passes each allocation only legs involving its own account; sending full batch arguments to each party would reveal everyone else's transfers (`C:1185–1200`). This is an actionable disclosure lesson, not operator-blindness.

DEX operator/admin/venue executor visibility is broad, while trader-facing disclosure is narrower (`D:653–687`). The local experiment does not establish production hosting/indexer privacy guarantees (`A:99–107`). Threshold hosting distributes transaction confirmation; each relevant host still sees disclosed contract data. No tlock, threshold encryption, or sealed-bid confidentiality exists here.

Bridge admin and relayer see relevant allocations; compatibility metadata may expose more than party-scoped result summaries if developers reuse a shared global payload (`B:152–159`, `192–209`). Scope receipts and logs as carefully as the transfer code.

## 6. UI and UX

These are specifications and local Daml scenarios, not a deployed bidder UI. The exemplar constructs allocations, toy-funded settlement, pause/recovery, and capability-controlled scenarios (`experiments/settlement/exemplar/daml/OpenZeppelin/Experimental/Settlement/Exemplar.daml:38–211`). DEX wallet requirements specify signed input/min-output bounds, deadline, pending status, and withdrawal visibility (`D:718–734`).

For a Zcash auction, show a funding receipt before bid acceptance, exact refund entitlement, settlement transaction ID, retry/recovery state, and external-delivery status separately. A seller's “settled” label must mean confirmed payouts, not merely a calculated winner or a submitted transaction.

## 7. Judgment and Zcash mapping

**Steal:** exact signed settlement bounds; every input accounted for as payment, refund, change, or fee; distinct funding/acceptance/settlement states; per-party receipt payloads; timeout recovery; durable reconciliation around irreversible external legs.

**Avoid:** claiming the toy fixture is production TSv2, importing swap-batch exclusion into an accepted auction, treating a local credit function as atomic DvP, granting signers a free-form result body, and conflating multi-host confirmation with hidden plaintext.

**Recommended mapping:** a shielded note is a custody receipt, not a programmable Allocation. A FROST committee can implement policy checks off-chain but Zcash cannot enforce these Daml choices or timeout withdrawals on shielded funds. Freeze accepted deposit/ciphertext receipts before R, then have each signer independently bind its PCZT approval to exact inputs, seller/loser/surplus outputs, fee cap, auction ID, and clearing-manifest hash. Keep recovery obligations alive during any pause. Non-ZEC item delivery needs a custodian, external chain, or explicit delivery agreement; NEAR Intents does not turn that into native atomic shielded DvP.
