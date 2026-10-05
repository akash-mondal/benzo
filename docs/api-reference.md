# Benzo JSON API reference (the contract the Phase 7 UI is built against)

Scope: the read-only HTTP JSON API over **one published auction directory**. Two entry points serve
exactly the same routes and bodies (`api/server.ts:18`):

```
benzo api serve --dir <public-auction-dir> [--host 127.0.0.1] [--port 8787] [--signer <ed25519-spki-der-hex>]
node api/dist/server.mjs --dir <public-auction-dir> [--host 127.0.0.1] [--port 8787] [--signer <ed25519-spki-der-hex>]
```

- `--dir` is required. `--signer` is 88 hex chars (the signer's Ed25519 SPKI DER, the same value as
  `benzo verify --signer`). A malformed `--signer` or missing `--dir` prints usage and exits 2; a signer
  that does not match the document refuses to serve, exit 1 (`cli/commands/api.ts:25-32`,
  `cli/commands/api.ts:33-36` and `api/server.ts:112-121` for the standalone entry).
- Every request **reloads and rechecks the directory** (`api/server.ts:25-31`): a UI never sees a cached
  document, and a document that stops loading answers 400 instead of stale data.
- GET only. Everything else answers 405. The server binds 127.0.0.1 by default (`api/server.ts:18-19`).
  There is no authentication and no write route: the API serves exactly the files of one published
  directory (`api/public-auction.ts:2`) and can change nothing.

## 1. Auction lifecycle states

The document's `state` (`api/public-auction.ts:83`) is one of:

`DRAFT` · `OPEN` · `SEALED-WAIT` · `OPENED` · `CLEARED` · `SETTLING` · `SETTLED` · `CANCELLED` · `REFUNDING`

The lifecycle is DESIGN §3: `DRAFT → OPEN → (freeze) SEALED-WAIT → (drand round R) OPENED → CLEARED →
SETTLING → SETTLED`, with `CANCELLED → REFUNDING` when the freeze fails.

## 2. Routes

| Route | Answers 200 | Answers otherwise |
|---|---|---|
| `GET /auction/:auction_id` | every state (once the document loads) | 404 if `:auction_id` is not this auction; 400 if the document or its manifest fails to load |
| `GET /operator` | every state | 400 if the document fails to load |
| `GET /freeze` | every state (a pre-freeze board is `frozen:false`) | 400 if the document fails to load |
| `GET /result` | when the document carries a result (`CLEARED`, `SETTLING`, `SETTLED`) | 409 `{"ready":false,"state":…}` in `DRAFT`/`OPEN`/`SEALED-WAIT`/`OPENED`/`CANCELLED`/`REFUNDING` |
| `GET /allocation` | only launch-mode auctions whose result carries `allocation_file_hash` (after the clear) | 409 `{"ready":false,"state":…}` otherwise — **including every non-launch mode, permanently** |
| `GET /receipt/:ciphertext_hash` | once the document is frozen (`SEALED-WAIT` onward) | 409 `{"ready":false,"state":…}` before the freeze; 400 for a malformed or unknown hash |

`:ciphertext_hash` is the 64-hex SHA-256 of a frozen bid's memo ciphertext (a `leaves[].ciphertext_hash`
from `GET /freeze`). The URL form is `/receipt/<64-hex>`.

Below, each response body's **key set** is given in a `<!-- shape: … -->` block. `tools/repro/api-reference-check.ts`
parses these blocks and asserts them against live responses from the shipped server over a committed
published auction directory, so this document cannot drift from the code silently. Field names ending in
`?` are present only in some modes/states (said so per field); every other field is always present.
A value of `"string|null"` may be JSON `null`; `{"$nullable": true, …}` marks an object that may be `null`.

### 2.1 `GET /auction/:auction_id`

The summary a UI polls. `valid` is `true` when every check that applies to the current state passes
(the same check ids as `benzo verify`'s `ERROR` lines, `api/server.ts:43-48`); `errors[]` lists the
failing ones. Pre-freeze this covers the manifest and receipts only — see §3.

<!-- shape: auction -->
```json
{
  "valid": "boolean",
  "errors": [{"id": "string", "error?": "string", "warn?": "string"}],
  "auction_id": "string",
  "manifest_hash": "string",
  "state": "string",
  "lot": "string|null",
  "lots": "array|null",
  "supply": "number",
  "C_zats": "string",
  "mode": "string|null",
  "clearing_price_zats": "string|null",
  "result_hash": "string|null",
  "freeze_root": "string|null",
  "leaf_count": "number|null",
  "T_submit": "number",
  "T_freeze": "number",
  "R": "number",
  "settled": "boolean"
}
```

| Field | Type | Meaning |
|---|---|---|
| `valid` | boolean | every state-applicable check passes (`api/server.ts:43-48`) |
| `errors` | array of `{"id","error"?,"warn"?}` | failing checks; `id` matches `benzo verify`'s check ids |
| `auction_id` | 64-hex | the auction's id, bound to the signed manifest (`api/public-auction.ts:121`) |
| `manifest_hash` | 64-hex | SHA-256 over the signed manifest packet's bytes |
| `state` | string | lifecycle state (§1) |
| `lot` | string \| null | the single-lot label from the manifest; `null` for multi-lot rounds (`lots`) |
| `lots` | string[] \| null | the lot ids of a multi-lot round; `null` otherwise |
| `supply` | number | units for sale (manifest `supply`) |
| `C_zats` | string | fixed collateral per bid, zatoshis (manifest `C_zats`) |
| `mode` | string \| null | clearing mode of the result (`uniform`, `vickrey`, `launch`, `otc`, `rfq`, …); `null` before the clear |
| `clearing_price_zats` | string \| null | clearing price from the result; `null` before the clear |
| `result_hash` | string \| null | SHA-256 over the canonical result bytes; `null` before the clear |
| `freeze_root` | string \| null | frozen Merkle root; `null` before the freeze |
| `leaf_count` | number \| null | frozen leaves (accepted bids); `null` before the freeze |
| `T_submit` | number | deposit deadline, Unix seconds (manifest) |
| `T_freeze` | number | freeze time, Unix seconds (manifest) |
| `R` | number | the drand quicknet round the bids are sealed to (manifest) |
| `settled` | boolean | the document carries a settlement (`api/server.ts:61`) |

### 2.2 `GET /operator`

The organizer's board: how many bids are accepted and their sealed memo ciphertexts. `count` is the
frozen `leaf_count`, or before the freeze the number of admitted deposit receipts (`api/public-auction.ts:603-620`).

<!-- shape: operator -->
```json
{
  "auction_id": "string",
  "C_zats": "string",
  "count": "number",
  "total_collateral_zats": "string",
  "blobs": [{"leaf_index": "number", "ciphertext_hash": "string", "ciphertext_hex": "string"}]
}
```

`blobs` is empty before the freeze. `ciphertext_hex` is the **sealed** memo as it appears on chain —
ciphertext only (§4). `total_collateral_zats = C_zats × count` as a decimal string.

### 2.3 `GET /freeze`

The frozen acceptance board: root, cutoff and per-bid inclusion paths, so a bidder can recheck their
own inclusion offline. Pre-freeze the board is present with `frozen:false` and empty lists
(`api/public-auction.ts:623-644`).

<!-- shape: freeze -->
```json
{
  "auction_id": "string",
  "manifest_hash": "string",
  "frozen": "boolean",
  "root": "string|null",
  "leaf_count": "number",
  "cutoff": "number|null",
  "published_at": "number|null",
  "leaves": [{"leaf_index": "number", "ciphertext_hash": "string"}],
  "paths": [[{"side": "string", "hash": "string"}]]
}
```

`paths[i]` is leaf `i`'s Merkle authentication path (`side` is `left` or `right`); `root`, `cutoff`
(block height after which nothing is admitted) and `published_at` (Unix seconds, always `< T_freeze`)
are `null` before the freeze.

### 2.4 `GET /result`

The clearing result, byte-identical to the published `result.json` (`api/server.ts:72-74`). Money is
decimal zatoshis in strings. See `clear/core.ts:11-22` for the types.

<!-- shape: result -->
```json
{
  "auction_id": "string",
  "manifest_hash": "string",
  "freeze_root": "string",
  "mode": "string",
  "clearing_price_zats": "string",
  "comparison": "object|null",
  "allocations": [{
    "leaf_index": "number",
    "price_zats": "string|null",
    "quantity": "number",
    "fill": "number",
    "payment_zats": "string",
    "refund_zats": "string",
    "outcome": "string",
    "lot?": "string",
    "balance_due_zats?": "string",
    "tranche?": "string",
    "side?": "string"
  }],
  "conservation": {
    "input_zats": "string",
    "payout_zats": "string",
    "refund_zats": "string",
    "fees_zats": "string",
    "treasury_zats?": "string",
    "balances_zats?": "string"
  },
  "cancelled?": "boolean",
  "holder_price_zats?": "string",
  "allocation_file_hash?": "string",
  "launch_supply?": "number",
  "rfq_delivery?": {"deadline_height": "number", "signers": ["string"]},
  "lots?": [{"lot_id": "string", "clearing_price_zats": "string"}],
  "serial_assignment?": [{"leaf_index": "number", "serials": ["number"]}],
  "serial_beacon_round?": "number"
}
```

| Field | Meaning |
|---|---|
| `auction_id`, `manifest_hash`, `freeze_root` | bindings to the signed manifest and the frozen root |
| `mode` | the clearing mode this result was computed under |
| `clearing_price_zats` | uniform clearing price (per lot for multi-lot rounds) |
| `comparison` | the same result shape recomputed under the other comparison rule (uniform rounds only; `null` otherwise). Its key set equals this body's `clear/core.ts:23` |
| `allocations[]` | one row per frozen leaf (bid), in leaf order |
| `allocations[].leaf_index` | the bid's index in the frozen set |
| `allocations[].price_zats` | the bid's price (opened after R); `null` in vickrey |
| `allocations[].quantity`, `fill` | units bid, units filled |
| `allocations[].payment_zats`, `refund_zats` | what the bid pays / is refunded |
| `allocations[].outcome` | `winner`, `unfilled`, `cancelled`, or a refusal reason (`over_cap`, `below_reserve`, `invalid_tranche`, …) |
| `allocations[].lot?` | the lot this bid is bound to (multi-lot rounds only) |
| `allocations[].balance_due_zats?` | the winner's unpaid balance (bond-then-pay rounds only) |
| `allocations[].tranche?` | `holder` / `main` (launch rounds only) |
| `allocations[].side?` | order side (OTC/RFQ rounds only) |
| `conservation` | money in = money out: `input_zats (+ balances_zats) = payout_zats + refund_zats + fees_zats (+ treasury_zats)` |
| `conservation.treasury_zats?` | buyback treasury spend (mode B only) |
| `conservation.balances_zats?` | incoming winner balances (bond-then-pay only) |
| `cancelled?` | the round cancelled (minimum missed) — present on modes that can cancel |
| `holder_price_zats?` | holder-tranche floor price (launch with holder tranche) |
| `allocation_file_hash?` | SHA-256 over the launch allocation file served by `GET /allocation` (launch only) |
| `launch_supply?` | the launch's total supply (launch only) |
| `rfq_delivery?` | the RFQ delivery window and signer keys (RFQ only) |
| `lots?` | per-lot clearing prices (multi-lot only) |
| `serial_assignment?`, `serial_beacon_round?` | serial shuffle assignment and its drand seed round (collection-drop rounds only) |

### 2.5 `GET /allocation`

The launch delivery batch: one fresh token-chain destination per standard lot won, exactly as the
clear committed to it (`allocation_file_hash`). 200 only when the result carries `allocation_file_hash`
(`api/server.ts:76-80`); every other mode answers 409 forever.

<!-- shape: allocation -->
```json
{
  "version": "number",
  "auction_id": "string",
  "delivery": "string",
  "rows": [{"destination": "string", "amount": "number"}]
}
```

`delivery` is `"project_on_token_chain"` (`clear/launch.ts:13`). `rows[].destination` is a winner-supplied
**token-chain** delivery destination, `rows[].amount` its size in standard lots (§4).

### 2.6 `GET /receipt/:ciphertext_hash`

A bidder's proof: is my bid's ciphertext in the frozen set, and did its refund land?

<!-- shape: receipt -->
```json
{
  "inclusion": {
    "auction_id": "string",
    "manifest_hash": "string",
    "ciphertext_hash": "string",
    "deposit": {"txid": "string", "pool": "string", "address": "string", "diversifier_index": "string"},
    "leaf_index": "number",
    "included": "boolean",
    "receipt_signed": "boolean"
  },
  "settlement": {"$nullable": true,
    "auction_id": "string",
    "party": "string",
    "txid": "string",
    "pool": "string",
    "output_index": "number",
    "amount_zats": "string"
  }
}
```

(`api/public-auction.ts:647-680`.) `deposit` is the bid's **deposit** as scanned: the txid/pool of the
collateral note and the escrow deposit address it paid to — public manifest data. `included` recomputes
the Merkle membership against `GET /freeze`'s root; `receipt_signed` is `true` only when a signer's
signed receipt packet was supplied (the CLI's `benzo receipt show --receipt` path; over HTTP it is
`false`). `settlement` is `null` until settlement; then it is exactly six fields (`party` is `leaf:<n>`)
— **no refund or payout destination of any kind** (§4). Unknown or malformed hash → 400.

### 2.7 Error and not-ready bodies

<!-- shape: not-ready -->
```json
{"ready": "boolean", "state": "string"}
```

409, from `GET /result`, `GET /allocation` and `GET /receipt/:ciphertext_hash` when the document's
state does not carry the data yet (`api/server.ts:73,77,83`). `ready` is always `false`; `state` is the
document's current lifecycle state. Poll `GET /auction/:id` and retry after the state advances.

<!-- shape: invalid-document -->
```json
{"valid": "boolean", "error": "string"}
```

400 when the directory does not load or its manifest fails verification: `valid` is `false`, `error`
is the refusal reason (`api/server.ts:27-30,44-46`). The document is untrustworthy in whole; a UI
should show the error and stop.

<!-- shape: error -->
```json
{"error": "string"}
```

400 for a route-level refusal — `GET /receipt/…` with a malformed hash (`ciphertext hash`) or one not
in the frozen set (`ciphertext not in frozen set`) (`api/server.ts:88`, `api/public-auction.ts:651-655`).

<!-- shape: not-found -->
```json
{"error": "string"}
```

404: `{"error":"unknown auction id"}` when `GET /auction/:auction_id` names a different auction
(`api/server.ts:33`), `{"error":"not found"}` for any other unknown path (`api/server.ts:86`).

<!-- shape: method-not-allowed -->
```json
{"error": "string"}
```

405 `{"error":"method not allowed"}` for every non-GET request (`api/server.ts:24`).

## 3. How a client verifies what it reads

The API is a **reader of one publisher's directory**. Trust comes from three layers:

1. **The signed manifest.** Every load verifies the manifest packet's Ed25519 signature and its
   internal binding (`api/public-auction.ts:21` `readClient` → `manifest/schema.ts`), and binds
   `auction_id` to it (`api/public-auction.ts:121`). The manifest pins everything a bidder signs over:
   escrow, collateral, the drand chain and round R, `T_submit`/`T_freeze`, the clearing rules.
2. **The `--signer` trust anchor (R20b).** The document's own `signer` field is self-declared; only
   `--signer <hex>` proves it is the key you already trusted out of band. Without `--signer` the server
   accepts the claim (`api/public-auction.ts:98-102`); with it, a mismatch refuses to serve. **A UI
   must always pass `--signer`** with the operator's published signer key.
3. **`benzo verify --dir <dir> --signer <hex>`** is the only complete check. In addition to everything
   the API checks, it **re-derives every bid opening from the ciphertext and the BLS-authenticated
   published beacon** and requires the document's `opened` to match (`cli/commands/verify.ts:61-76`),
   re-derives the sealed-reserve opening and stray-claim memo openings (`cli/commands/verify.ts:78-83`),
   and reproduces the clear and accounting.

**What a UI must never trust without `benzo verify` (or its own equivalent re-derivation):**

- `GET /result`, `GET /allocation` and `GET /receipt`'s `settlement` — all money. The API checks the
  document's self-consistency (`/auction`'s `valid` recomputes the clear from the document's own
  `opened`, `api/public-auction.ts:333-341`), but only `benzo verify` proves those openings come from
  the frozen ciphertexts and the drand beacon. A publisher could otherwise invent openings.
- `GET /auction/:id`'s `valid:true` before `CLEARED`: it covers only the checks that apply to the
  current state (R21 item 5) — the freeze root and receipts, not a clear that has not run.
- Anything from a server started without `--signer`.

Safe without `benzo verify` (given a pinned `--signer`): the manifest-derived fields, `state`,
`freeze`/`operator` boards and `receipt.inclusion` — each is recomputed from the signed manifest and
the frozen Merkle root on every request.

## 4. Privacy: what is public, and what no route ever returns

Everything a route returns is **public data**, served from the published directory that anyone can
mirror (`api/public-auction.ts:2` — "Reads only public files; never loads BNZ_STATE_DIR secrets or
bid-side keys"). The fields are listed in §2. In summary:

- **Bid-side secrets never leave the bidder's machine**: the 128-byte bid plaintext (price, quantity,
  nonce, owner key, settlement commitment) exists only in the browser and inside the tlock ciphertext
  (`seal/src/main.ts:1-5`).
- **No route returns a bid plaintext, before R or after.** The document's `opened` plaintexts and the
  stray-claim memos have no route at all: the complete route list is `api/server.ts:32-86`, and the
  only bid-derived values it serves are the aggregates of `GET /result` (post-clear, i.e. after R,
  anonymised per leaf) and the memo **ciphertexts** of `GET /operator`
  (`api/public-auction.ts:603-620`). Before R every result-bearing route answers 409
  (`api/server.ts:73,77,83`), and the clear cannot exist before the beacon opens the bids.
- **No route returns a Zcash refund or payout destination.** Settlement receipts carry exactly
  `auction_id, party, txid, pool, output_index, amount_zats` — no address field exists in the type or
  the checked key set (`api/public-auction.ts:26`, enforced at `api/public-auction.ts:225,502`).
  The refund destinations live only inside each bid's envelope ciphertext, sealed to the escrow
  signers' envelope keys; the envelope records (`envelopes[].envelope_ct`) and the owner-signed claims
  have no route (`api/server.ts:32-86`). `receipt.inclusion.deposit.address` is the **escrow deposit
  address the bid paid to** (manifest `deposit_addresses`, public), not anyone's refund target.
- **One documented exception, by design (R34 item 1):** `GET /allocation` (launch mode only) returns
  the delivery batch's **token-chain** destinations (`clear/launch.ts:13,36-53`). These are the
  winners' fresh per-round delivery claims for the launched asset (DESIGN §9; the batch is what the
  result's `allocation_file_hash` commits to), not Zcash addresses; the batch rows carry no
  `leaf_index`. Today `rows` are emitted in winner leaf order (`clear/launch.ts:40-51`), so row
  position can be correlated with a winning leaf from `GET /result` — R34 item 2 rules this fixed on
  Track A (after A15): rows sorted canonically by destination bytes, allocation root over that order,
  `benzo verify` replaying the sort. This section documents the sorted order once it lands.

A UI should state the DESIGN §1 claim and its limits verbatim (all bids open, anonymised, at R) and
must not display or export anything a route does not return.

## 5. Drift check

`tools/repro/api-reference-check.ts` serves the committed published auction directory
`docs/evidence/phase-5/markets/launch/cold-f1170469` with
the shipped `api/dist/server.mjs`, requests every documented route and case, and asserts each
response's key set against the `<!-- shape: … -->` blocks above. The 409 and 400 bodies are asserted
against pre-result and mid-flight-broken copies of the same committed document, derived in `tmp/`
(the server pre-loads at startup, so a broken document must break after start to reach the 400 body).
Run:

```
npx esbuild tools/repro/api-reference-check.ts --bundle --platform=node --format=esm --outfile=tmp/api-reference-check.mjs \
  && node tmp/api-reference-check.mjs
```

Last run: `docs/evidence/phase-6/repro/api-reference.out`. Mutation `docs/evidence/phase-6/mutations/B32-a.patch`
drops one documented field from a route's response and the check goes red
(`docs/evidence/phase-6/mutations/B32-a.out`).
