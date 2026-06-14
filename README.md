# Benzo — private-by-default shielded-USDC payments on Stellar

**Benzo** is a private-by-default, shielded-USDC payments protocol on Stellar
(Soroban), framed as a private cross-border remittance corridor. Everyday
stablecoin payments hide **both amount and counterparty** through zero-knowledge
shielded notes, while compliance — selective disclosure via hierarchical viewing
keys and Association-Set screening — is built into the regulated fiat edges.

This repository is the **backend / protocol** (no frontend yet): ZK circuits, a
headless proving SDK, the Soroban contracts, a self-hosted note-discovery
indexer, a gasless relayer, and a self-hosted SEP-24 anchor corridor — all
exercised against **Stellar testnet** with real Circle testnet USDC.

> Built for **Stellar Hacks: Real-World ZK**. ZK is load-bearing by
> construction: strip the proofs and there is no private payment — the pool
> verifies a zero-knowledge proof on Stellar's native BN254 host functions
> before it will move a cent.

ZK is proven **two independent ways, both verified on-chain on testnet**:

| Track | Scheme | Status |
|---|---|---|
| **A** | Groth16 / BN254 (CAP-0074 host fns) — the production join-split path | on-chain ✅ |
| **B** | Noir → UltraHonk (transparent, no trusted setup) | on-chain ✅ — contract `CBNKNOC45EEDNTBS2OWKXAVRKQRAKU4K3X6XTIMZ5BI5WISN7GDBZBBE`, valid proof accepted (tx `52959d1d…`), tampered proof rejected (`Contract Error #4`) |

Reproduce Track B with the pinned toolchain (`nargo 1.0.0-beta.9`, `bb v0.87.0`,
keccak oracle) against the vendored harness in `reference/code/rs-soroban-ultrahonk`.

### ZK capabilities (Stellar-Hacks idea coverage)

Beyond the core shielded transfer, the same primitives power several of the
hackathon's prompts — these are built and tested:

- **Shielded transfer / private payment** (🟡) — the core: 2-in/2-out join-split, amounts + counterparties hidden.
- **Compliant privacy pool with ASP** (🟠) — allow-membership at deposit + proof-of-innocence non-membership at withdraw.
- **Private cross-border remittance corridor** (🔴) — fiat-in → shield → private send → unshield → fiat-out (fiat leg simulated).
- **Compliant transfer with a view key** (🟡) — MVK→TVK scoped, expiring, revocable selective disclosure.
- **Proof-of-balance / proof-of-funds** (🟢) — prove you hold ≥ X USDC without revealing the exact balance (`benzo prove-balance --min N`).
- **Confidential payroll / invoicing** (🟡) — pay a team privately, prove the total to an auditor (`benzo payroll` + `benzo disclose-total`).
- **Verifiable off-chain computation** (🟢) — Track B verifies a Noir program's correct execution on-chain.
- **Private allowlist membership** (🟢) — the ASP allow-set Merkle membership proof.
- **UTXO-style private payments** (🔴) — the shielded-note model itself.

---

## What's real vs. simulated (read this first)

| Component | Status |
|---|---|
| Groth16 proving (shield / joinsplit / unshield) | **Real** — headless snarkjs in Node, verified on-chain by the BN254 verifier contract |
| BN254 Groth16 verification | **Real** — Soroban CAP-0074 host functions, on testnet |
| Noir → UltraHonk (Track B) | **Real** — fresh proof verified on-chain on testnet; tampered proof rejected |
| Poseidon2 commitments / nullifiers / Merkle | **Real** — CAP-0075 host function, byte-identical to circuit & SDK (asserted in tests) |
| USDC custody & settlement | **Real** — Circle testnet USDC (issuer `GBBD47IF…FLA5`) as a SAC, custodied by the pool |
| Shield / private transfer / unshield | **Real** — on testnet, with on-chain nullifiers, Merkle commitments, balance moves |
| MVK→TVK viewing-key disclosure | **Real** — HKDF derivation, X25519+AES-GCM, reconstructed from on-chain ciphertext |
| ASP membership / proof-of-innocence | **Real** — enforced in-circuit + on-chain registries |
| Gasless relayer | **Real** — non-custodial; submits proven transfers, paid in USDC out of the pool |
| Note-discovery indexer | **Real** — scans Soroban events, view-tag fast path, viewing-key scan API (self-hosted) |
| `BenzoClient` SDK facade | **Real** — drives create/shield/send/unshield/disclose end-to-end on testnet |
| send-by-`@handle`, claim-links | **Real** — on-chain `handle_registry`; claim-link funds a fresh account |
| SEP-1 / SEP-10 / SEP-24 anchor | **Real wire protocol** — self-hosted; real Ed25519 SEP-10; real on-chain USDC settlement at both edges |
| KYC / screening / on-ramp / CCTP | **Mock / sandbox** — see [Scope](#scope-sandbox-now-credentials-later) |
| **The fiat (bank/cash) ledger leg** | **SIMULATED** — the self-hosted anchor credits "fiat received"/"paid out" with no real bank, driven via `POST /sep24/sim/:id`. This is the only simulated protocol piece. |

No mainnet keys are used anywhere. `.env` and `reference/` are gitignored.

---

## Architecture

Three planes: a **client plane** that holds keys and proves (the headless
`@benzo/core`), an **on-chain plane** of Soroban contracts that verify proofs and
mutate state, and an **off-chain services plane** that indexes encrypted notes,
sponsors fees, and bridges fiat.

```
                       ┌──────────────────────── on-chain (Soroban, testnet) ───────────────────────┐
  @benzo/core          │   pool ──verify──► verifier_groth16  (BN254 / CAP-0074)                     │
  (headless prover) ──►│    │                                                                        │
   shield/transfer/    │    ├─ insert ─► merkle           (Poseidon2 incremental tree, CAP-0075)     │
   unshield + proof    │    ├─ spend  ─► nullifier_set     (persistent, idempotent)                  │
                       │    ├─ check  ─► asp_membership    (allow-set, deposit edge)                 │
                       │    ├─ check  ─► asp_non_membership (deny-SMT, proof-of-innocence)           │
                       │    └─ bind   ─► viewkey_anchor    (MVK→TVK disclosure registry)             │
                       └────────────────────────────────────────────────────────────────────────────┘
        ▲                         │ events (commitments, ciphertexts, nullifiers)
        │ gasless submit          ▼
  @benzo/relayer            @benzo/indexer ──viewing-key scan──► holders & auditors
        ▲
        │ fiat edges (SEP-10 JWT + SEP-24 deposit/withdraw; USDC settled on-chain, fiat SIMULATED)
  @benzo/anchor
```

### Canonical cryptographic invariants (normative)

- **Commitment** `= Poseidon2(amount, recipient_pk, blinding, asset_id)`
- **Nullifier** `= Poseidon2(spend_sk, leaf_index, NULLIFIER_DOMAIN)`
- **Merkle node** `= Poseidon2(left, right)`; tree `DEPTH = 32`, `ROOT_HISTORY = 128`
- **Proof** Groth16 over BN254, one constant-size multi-pairing check (Track A)
- **Poseidon2 byte-identical** across the circom circuit, the `@benzo/core` TS
  mirror, and the Soroban host function — pinned in
  [`circuits/poseidon_params/poseidon2_bn254.json`](circuits/poseidon_params/poseidon2_bn254.json)
  and asserted against the on-chain zero table in tests.
- **Nullifiers in persistent storage only**; idempotent "already spent = success".
- **Field-element encoding fails loud** — out-of-range values are rejected, never
  silently truncated, before any proof/VK byte hits the chain.

---

## Repository layout

A **pnpm + Turborepo monorepo** — one headless core, many surfaces.

```
packages/
  core/         @benzo/core — headless protocol SDK: notes, Poseidon2, incremental
                Merkle mirror, prover, viewkeys, scanner, contract clients, the
                BenzoClient facade, sponsored-reserves + login-seam helpers
  links/        @benzo/links — typed BenzoLink union (claim/request/handle)
  prover/       @benzo/prover — ProverPort: NodeProver (working) + Wasm/Native stubs
  platform/     @benzo/platform — IBenzoPlatform port (storage/keychain/prover/…)
  indexer/      @benzo/indexer — note-discovery indexer (view-tag fast path)
  relayer/      @benzo/relayer — gasless, non-custodial submitter (OZ/channel model)
  anchor/       @benzo/anchor — self-hosted SEP-1/10/24 corridor edges
  kyc/          @benzo/kyc — pluggable SEP-12 KYC (Mock default; Didit optional)
  integrations/ @benzo/integrations — corridor edges: screening, on-ramp, CCTP,
                anchor presets (Mock by default; commercial adapters labeled FUTURE)
apps/
  cli/          @benzo/cli — FULLY BUILT; every op as a command; the e2e harness
  web/ telegram/ merchant/ pos/ paylink/ extension/ — surface scaffolds, each
                implementing IBenzoPlatform over @benzo/core (ready to build)
contracts/      8 Soroban (Rust) contracts: pool, verifier_groth16, merkle,
                nullifier_set, asp_membership, asp_non_membership, viewkey_anchor,
                handle_registry
circuits/       Circom (Poseidon2 + circomlib + SMT): shield / joinsplit / unshield
ceremony/       Phase-2 trusted-setup driver + transcript (joinsplit)
deployments/    per-network contract ids (testnet.json)
.github/        CI: contracts (fmt/clippy/test/wasm), packages (build/test), security
reference/      vendored study repos (gitignored): stellar-private-payments,
                rs-soroban-ultrahonk, soroban-examples, …
```

### App surfaces

Every surface implements `IBenzoPlatform` and consumes `@benzo/core` + `@benzo/links`.

| Surface | Status | Prover | Does best |
|---|---|---|---|
| **CLI** | **built** | Node | scripting + the e2e harness |
| Web PWA | scaffold | Wasm | flagship consumer wallet |
| Telegram | scaffold | Wasm | chat-native `/send @handle` |
| Merchant | scaffold | Node | confidential payroll + auditor view-keys |
| PoS | scaffold | Wasm | private request-QR |
| Paylink | scaffold | Node | claim / request landing pages |
| Extension | scaffold | Wasm | pay-with-Benzo provider |

---

## Quickstart

### Prerequisites
- Rust (pinned via `rust-toolchain.toml`: 1.93.1 + `wasm32v1-none`), Stellar CLI 25+
- Node 20 + pnpm 10
- For circuits/Track B: `circom` 2.2+, `snarkjs`; `nargo 1.0.0-beta.9` + `bb v0.87.0`
- Funded testnet identities in `.env` (gitignored): `benzo-deployer`,
  `benzo-relayer`, `benzo-anchor-dist`, `benzo-anchor-sign`

### Build & test
```bash
cargo test --workspace        # 95 contract tests (8 contracts + zkhash mirror)
cargo clippy --workspace --all-targets -- -D warnings
stellar contract build        # all contracts -> wasm32v1-none

pnpm install
pnpm -r build                 # all @benzo/* packages + apps
pnpm -r test                  # TS: core 95 · kyc 6 · integrations 20 · links 12 · anchor 5
```
The heavy snarkjs proving tests self-skip when the gitignored `.zkey`/`.wasm`
artifacts are absent (e.g. CI); the committed VK/proof fixtures still enforce the
snarkjs→Soroban byte-identity invariant.

### Deploy & run against testnet
```bash
set -a; . ./.env; set +a
bash scripts/deploy-testnet.sh        # deploy contracts, wire operators, register VKs
cd tests
node e2e/m1-flow.mjs                   # shield → private transfer → unshield
node e2e/m2-compliance.mjs            # MVK/TVK disclosure + ASP both gates
node e2e/m3-corridor.mjs             # SEP-24 corridor: fiat-sim → … → fiat-sim
```

### The SDK a frontend calls
A frontend uses ONLY `BenzoClient` from `@benzo/core`. `send()` is non-blocking
(returns a `SendHandle` reporting `pending → proving → settled`) so a UI renders
optimistic state over the proving pipeline. Note keys derive from **one wallet
signature** (`loginWithSigner`) — no second seed phrase — and onboarding can be
**zero-XLM** via sponsored reserves (CAP-33). Full surface in
[`packages/core/src/client.ts`](packages/core/src/client.ts).

---

## Compliance model — "open by default, private when needed, compliant"

- **Privacy in the middle.** `transfer` is a 2-in/2-out join-split (two-note coin
  selection); amounts and the sender↔recipient link are hidden. No SAC movement.
- **Identity at the edges.** `shield` requires an **ASP allow-membership** proof
  (depositor bound in-circuit to a KYC'd allow-set leaf). `withdraw` requires an
  **ASP non-membership / proof-of-innocence** proof against the deny sparse-Merkle
  tree — mandatory at exit, checked against the live deny-root.
- **Guaranteed auditability.** Every note carries an MVK tag
  `Poseidon2(mvk_pub, blinding)`; a scoped **TVK** (one-way HKDF from the MVK)
  lets an auditor passively reconstruct exactly the in-scope notes from on-chain
  ciphertext — and nothing else. Viewing keys are decrypt-only; never spend.

### Auditor lifecycle & trust assumptions

- **In-circuit (trustless):** the MVK tag, ASP allow-membership at deposit, and
  ASP non-membership (proof-of-innocence) at withdraw are all proven in-circuit
  against live on-chain roots — no party is trusted for these.
- **Off-circuit (trusted):** the MVK-ciphertext payload integrity and the ASP
  curation (who is in the allow/deny sets) are operator responsibilities, not
  circuit-enforced.
- **TVK grants are scoped, expiring, and revocable.** `viewkey_anchor.scope_auditor`
  issues a grant for a scope label (e.g. `2026-Q2/corridor=ALL`) with an expiry;
  `revoke_grant` removes it early. Because a TVK is one-way-derived per scope, a
  leaked/offboarded auditor key only ever exposes its own in-scope notes — the
  residual that a single master viewing key (e.g. Sui contra's escrow) does *not*
  bound. (On-chain revocation cannot retract an already-decrypted TVK; the scope
  binding is what limits the blast radius.)
- **Honest users always exit.** The normal private `withdraw` *is* the
  always-exit path: the deny-SMT default-excludes everyone, so proof-of-innocence
  succeeds for any honest note — privately, recovering all notes, no special op
  (stronger than a public ragequit). **Trust caveat:** the deny-set admin
  (`asp_non_membership.insert_leaf`) is a trusted party — it can freeze a flagged
  commitment, reversible only via `delete_leaf` (both admin-gated and event-
  observable). This contract's admin **must** be a multisig/timelock in any real
  deployment.

### Security & threat model (summary)

- **Soundness:** the pool fails closed — a non-verifying proof returns
  `Err(InvalidProof)`; the verifier validates VK structure at registration and
  rejects tampered/cross-circuit/wrong-input proofs (negative-tested).
- **No double-spend:** per-entry persistent nullifiers; idempotent replays.
- **No duplicate leaves:** the Merkle contract rejects a replayed commitment,
  preserving scanner leaf→index injectivity.
- **Anti-malleability:** transfer/withdraw bind a relayer/fee/recipient
  `ext_data_hash` in-circuit, so a relayer cannot alter a proven transaction.
- **Governance is observable:** VK rotation and verifier swaps emit audit events;
  admin is intended to be a multisig/timelock.
- **State durability (CAP-0078):** long-lived persistent entries (VK, pool
  config, live merkle roots, spent nullifiers) proactively extend their TTL on
  the hot path, so active state is not archived out from under the protocol.
- **Negative-auth tested:** the operator/admin-gated entrypoints (spend,
  insert_leaf, set_vk, pause, set_verifier) have tests asserting they fail
  without the required signer.
- **Keys:** spend / master-viewing / note-discovery authorities are separated;
  viewing keys never carry spend authority; testnet-only, no mainnet keys.

Benzo forks Nethermind's **stellar-private-payments** (ASP contracts, Poseidon2
host wrappers, Groth16 verifier shape — Apache-2.0) and the canonical
`soroban-examples/groth16_verifier`; circuits build on the tornado-nova join-split
shape, re-expressed over Poseidon2 with Benzo's note model and compliance gates.
Trusted setup is a Phase-2 multi-contribution ceremony (driver + transcript in
`ceremony/`); Track B (UltraHonk) needs no ceremony.

---

## Scope (sandbox now, credentials later)

The hackathon corridor runs **100% on testnet with zero external accounts**:
Mock KYC (no real identity, no PII), the self-hosted anchor for cash in/out, and
Mock/keyless everything else. The commercial edges are real, env-keyed adapters
behind the same interfaces, kept as clearly-labeled **FUTURE** integration points
that require the provider's own account to activate — they are **not** used in the
demo and imply no partnership:

- **On-ramp:** Stripe Crypto in **sandbox/test mode** (USDC-on-Stellar verified
  against Stripe's docs); even sandbox requires an approved Stripe onramp
  application. `benzo onramp` exercises it (Mock until a `sk_test_…` key is set).
- **FUTURE (need accounts/partnerships):** Range / Human ID screening, Circle CCTP
  V2 mainnet, MoneyGram / Alfred SEP-24 anchors, Dynamic/Privy login. Flip the
  env key to go live — no protocol change. See `.env.example`.

**Status:** testnet, unaudited. Not for production or real funds.
