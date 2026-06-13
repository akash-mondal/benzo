# Benzo Threat Model

Scope: the backend/protocol (circuits, Soroban contracts, SDK, indexer,
relayer, anchor). Testnet, unaudited. Notation follows the canonical invariants
in `BENZO.md`.

## Assets to protect
- **Funds**: USDC custodied by the pool contract (SAC balance).
- **Soundness**: no inflation, no double-spend, no forged membership.
- **Privacy**: amounts and the sender↔recipient link of a `transfer`.
- **Selective disclosure**: only scoped TVK holders read in-scope notes.

## Trust boundaries
- **On-chain (trusted to enforce)**: proof verification, nullifier durability,
  Merkle root history, ASP root pinning. A valid state transition requires a
  valid Groth16 proof — the contract fails closed otherwise.
- **Client (trusted with its own secrets)**: spend keys, blindings, MVK. Proving
  is local; secrets never leave the device/process.
- **Relayer & indexer (untrusted for safety)**: liveness/availability only.

## Threats & mitigations

| Threat | Mitigation | Where enforced |
|---|---|---|
| **Double-spend** | Nullifier `Poseidon2(spend_sk, leaf_index, DOMAIN)` written to **persistent** storage (never temporary → no TTL reaping). Idempotent: a replayed nullifier returns success, never a second debit. The pool rejects *partial* replays (one fresh + one spent nullifier). | `nullifier_set`, `pool::transfer/withdraw` |
| **Value inflation** | In-circuit `Σ in == Σ out + fee`; 64-bit range checks on every amount. | `joinsplit.circom`, `unshield_impl.circom` |
| **Forged membership / spend** | Merkle inclusion of each input folds to a known historical root; `pk` derived from the private spend key; nullifier derivation constrained. | `joinsplit`, `unshield`, `merkle::is_known_root` |
| **Stale / replayed root** | Spends verify against any of the last 128 roots (ring buffer); a root outside the window is rejected. | `merkle`, `pool` |
| **Circuit ↔ host hash drift** | Poseidon2 parameters pinned once and asserted byte-identical across circom, the SDK TS mirror, and the CAP-0075 host function (test reproduces the on-chain zero table). | `poseidon_params`, tests |
| **Forged ASP screening** | The pool pins the proof's ASP roots to the registries' current roots; membership/non-membership are proven in-circuit. Allow-membership binds the *authorized depositor* address; proof-of-innocence proves the spent commitment ∉ deny-SMT. | `pool`, `asp_*` |
| **Unauditable note** | Every note's MVK tag `Poseidon2(mvk_pub, blinding)` is constrained in-circuit and bound on-chain via `viewkey_anchor`; there is no path to mint a note not bound to a registered MVK. | circuits, `viewkey_anchor` |
| **Relayer tampering** | The relayer submits a self-authorizing proof tx; it cannot change amounts, recipients, or the fee (all are public inputs bound by the proof, with relayer + ciphertexts bound via the ext-data hash). Worst case is censorship → mitigated by direct submit. | `pool::transfer`, ext-data hash |
| **Viewing-key compromise** | TVKs are one-way HKDF derivations of the MVK; a leaked TVK exposes only its scope (read-only), never the MVK or any spend authority. | `viewkeys` |
| **Note-discovery linkage** | Discovery ciphertext is X25519+AES-GCM; non-holders see opaque blobs. Out-of-scope ciphertext fails AEAD auth and is skipped. | `viewkeys`, `indexer` |
| **Admin-key compromise** | Pool is non-custodial: no admin path seizes or freezes individual notes. Admin controls are limited to pause, deposit cap, and ASP/VK rotation. Production: multisig + governance. | `pool` admin surface |
| **Re-entrancy / SAC** | Custody touches only the SAC `transfer`; state mutations (nullifier, tree) precede external transfers within one atomic invocation. | `pool` |
| **Field-overflow input amounts** | Hardening: every TRANSFER input amount is 64-bit range-checked in-circuit (not just outputs), closing the field-wrap value-conservation vector. A self-consistent witness with a 2^64+ input now fails to prove. | `joinsplit.circom` |
| **Verifier-key / verifier swap** | `set_vk` is one-time-immutable; governed rotation goes through `rotate_vk` (verifier) and `set_verifier` (pool), both admin-gated (multisig in production), so a hardened circuit's key rolls without touching custody/tree/nullifier state. | verifier, pool |
| **Handle hijack** | `handle_registry` is owner-authorized and first-come: a handle's record can be updated only by the address that registered it; a different caller claiming the same handle is rejected. A handle resolves to PUBLIC payment material only — no spend authority. | `handle_registry` |
| **Claim-link theft** | A claim link's funds are spendable by anyone holding the secret (bearer semantics, by design). The link secret is carried in the URL fragment (never sent to a server); first claim spends the note, so a second claim of the same link fails (nullifier already spent). | `account.accountFromClaimSecret`, pool nullifier |
| **Anchor SEP-10 spoof** | The anchor verifies the challenge's source is its SIGNING_KEY and cryptographically checks both the server (against SIGNING_KEY) and client (against the client account) Ed25519 signatures over the tx hash before issuing a JWT; a forged or missing signature is rejected. | `anchor/sep10.ts` |

## Known limitations (testnet)
- **Trusted setup**: Groth16 keys use a public Phase-1 (Hermez) plus a single
  dev Phase-2 contribution. Production requires a real multi-party ceremony
  with published transcripts (sound if ≥1 contributor is honest).
- **Fiat leg simulated**: the anchor's bank/cash ledger is simulated; the
  on-chain USDC settlement at the edges is real. Disclosed in the README.
- **ASP governance**: allow/deny roots are admin-rotated; decentralizing the
  curation feed is future work.
- **Unaudited**: no third-party circuit or contract audit yet.

## Transaction malleability (recipient / relayer / fee)
The `transfer` and `unshield` circuits bind the recipient, relayer, and fee into a
public `extDataHash` the proof commits to; changing any of them changes `extDataHash`
and invalidates the proof. A relayer or network MITM therefore cannot rewrite the
recipient/fee of a submitted shielded tx. (Same guarantee as Tornado-Nova's
"square the public signal" trick, achieved via the hashed ext-data input.) The pool
additionally checks `publicAmount` against the actual SAC payout.

## Note-discovery scalability (view tag)
v1 discovery ciphertexts ("BNZ1") carry a 1-byte view tag derived from the ECDH
shared secret; a scanner skips the AES-GCM open for non-matching notes (~255/256),
bounding per-note scan cost. Legacy (v0) boxes are still trial-decrypted.

## Test rigor (current)
- `cargo test --workspace`: 90 passing / 0 ignored. `clippy`: 0 warnings.
- Coverage (`cargo llvm-cov`): ~94.8% region / ~97.1% line across contracts.
- Circuits: witness-level negative tests (conservation, nullifier, membership, 64-bit
  range on inputs+outputs); Poseidon2 byte-identity fuzz vs the host fn; a
  verifier-parity oracle (snarkjs↔Soroban G2 reorder + byte shapes).
- Trusted setup: `scripts/ceremony.sh` — multi-contribution Phase-2 + checked-in
  transcript (`ceremony/`); production requires independent external contributors.
