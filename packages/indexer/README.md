# @benzo/indexer

The note-discovery indexer for the Benzo shielded pool. Wallets cannot scan the
whole chain on a phone, so the indexer turns the pool's on-chain events into a
fast feed a client filters locally with its view tag (BNZ1) and view key.

## What it indexes

The pool emits four typed `#[contractevent]`s (see `contracts/pool/src/pool.rs`):

| Event | Emitted on | Key fields | Used by the client to |
|-------|-----------|------------|------------------------|
| `NewCommitmentEvent` | shield, transfer | `commitment`, `index`, `encrypted_output`, `mvk_tag` | rebuild the Merkle tree + trial-decrypt incoming notes |
| `NewNullifierEvent` | transfer, unshield | `nullifier` | mark its own notes spent |
| `ShieldEvent` | shield | `from`, `amount`, `commitment` | show the public deposit leg |
| `WithdrawEvent` | unshield | `to`, `amount` | show the public withdrawal leg |

The discovery fast path: the client matches `mvk_tag` against its view tag
before attempting AEAD decryption, so it only does ECDH/AES work for notes that
are plausibly its own (Zcash/Umbra/ERC-5564 pattern).

## Primary backend (this package)

A dependency-light Soroban JSON-RPC poller: it follows `getEvents` for the pool
contract from a cursor, normalizes the four events above, and serves them over a
small HTTP API (`src/server.ts`). This is the default and needs no extra infra.

## Backup backend: SubQuery

For a managed, horizontally-scalable indexer, SubQuery supports Stellar/Soroban.
A SubQuery project would map the same four events to GraphQL entities:

```yaml
# project.yaml (sketch) — datasource over the Benzo pool contract
dataSources:
  - kind: stellar/Runtime
    mapping:
      handlers:
        - handler: handleNewCommitment   # filter topic: NewCommitmentEvent
          kind: soroban/EventHandler
        - handler: handleNewNullifier     # filter topic: NewNullifierEvent
          kind: soroban/EventHandler
```

```graphql
# schema.graphql (sketch)
type Commitment @entity { id: ID! index: Int! commitment: String! encryptedOutput: String! mvkTag: String! ledger: Int! }
type Nullifier  @entity { id: ID! nullifier: String! ledger: Int! }
```

The client API is identical, so swapping the primary poller for a SubQuery
endpoint is a config change. The backup is documented here rather than vendored
because the RPC poller already satisfies the corridor; SubQuery is the scale-out
path when the pool's event volume warrants a managed indexer.
