# Design: Phase 5 part 1, live path (Track A)

Head-owned design (2026-10-02). Implements PHASE-5 gates V, W, X, Y and R3 item 8 on testnet. Builders implement this as written; disagreements go under Questions with a concrete reason, not a redesign. Track B items it depends on are marked **[B]**.

## 0. What changes, in one picture

```
            this Mac (operator + coordinator + frostd + lightwalletd client)
            ├── benzo operator: auction state, scanner, freeze, open, clear, settle coordinator
            ├── frostd (TLS, SAN includes host.orb.internal)
            ├── benzo api serve (public read API) + intake route [B]
            └── bidder wallet (testnet funds)
                       ▲ HTTPS (frostd) / HTTP (api)            no shared filesystem
   ┌───────────────────┼───────────────────┬───────────────────┐
 benzo-alice (OrbStack)     benzo-bob (OrbStack)       benzo-carol (OrbStack)
 key share + envelope key   key share + envelope key   key share + envelope key
 witness key                witness key                witness key
 benzo signer CLI, frost-client, benzo-pczt, tle, benzo-scan (linux-arm64)
```

Today all three key shares live in one `.benzo/frost/` directory and every auction reuses the Phase 1 group key. After this phase: **three OrbStack Linux machines, one per signer, each holding only its own secrets, and a fresh dealerless DKG per auction.**

## 1. Signer hosts (gate Y)

- `deploy/signers/up.sh` (idempotent; no secrets committed):
  - `orb create ubuntu:24.04 benzo-{alice,bob,carol}`.
  - Install pinned Node 24, Go (for `tle`) and Rust (for `frost-client`, `benzo-pczt`, `benzo-scan`) at the same pins as the Mac.
  - Build each tool **inside** each machine from the pinned sources. Copy only the `cli/dist` bundle in.
  - Record the binary sha256s in `deploy/signers/manifest.json`.
- Each machine gets its own state dir `/home/benzo/.benzo` and its own frost-client config and contact.
- **No shared mount:** run `orb` with the machine's default isolation and **unmount `/Users`** (OrbStack mounts the Mac home by default). `up.sh` must disable that mount and prove it.
- Reachability:
  - Machines reach the Mac via `host.orb.internal`.
  - Regenerate the frostd TLS cert with SANs `localhost, 127.0.0.1, host.orb.internal`, from the existing root CA.
  - Each machine trusts only `rootCA.pem`.
- **Isolation proof** (EVIDENCE): for each machine, `ls /Users` fails, `ls ~/.benzo/frost` shows exactly one `<name>.toml`, the other two shares are absent, and `ss -tlnp` shows nothing listening except sshd.

## 2. Per-auction DKG (gate Y)

- New command: `benzo sign dkg --id ID --name SIGNER --server host.orb.internal:2744`, run **on each signer machine**. It wraps `frost-client dkg -c <name>.toml -d "benzo <auction_id>" -s … -C redpallas -t 2 -S <all three pubkeys>`.
  - Each machine keeps its new share under `~/.benzo/auctions/<id>/frost.toml`, never the global one.
- Coordinator step `benzo auction keys --id ID` (on the Mac):
  - collects the resulting group public key from frostd (all three must report the same key; refuse otherwise);
  - derives the escrow UFVK and UA with `zcash-sign generate`;
  - creates a **view-only** vault wallet `.benzo/vaults/<id>/` from the UFVK.
- **Ordering:** DKG → keys → `benzo auction create` (the manifest pins `frost_group_key` and `escrow_ua`) → sign → publish. A manifest whose group key isn't the one this auction's DKG produced must be refused by `auction sign`.
- Refactor the scanner and settle paths that assume `.benzo/vault` so they take the per-auction vault path.
- Recovery/cancel keeps working per auction. A development recovery uses that auction's DKG shares.
- **Y1 proof:** two auctions in one run produce two different group keys and two different escrow UAs. **5M5** (reuse the previous group key) must turn Y1 red.

## 3. Signing over the network (gate Y, R3 item 8)

- Signers no longer read the coordinator's files. For each batch, the coordinator serves a **batch packet** over HTTP from the intake/settlement route:

  `GET /settle/<id>/batch/<n>` → `{ plan_version, candidate_pczt_b64, randomizer, sighash, obligations[], result_hash, frozen_root, drand_round, drand_signature }`

  This is a new Track A route in the settle coordinator; it's not part of the read-only public API.
- Each signer machine runs `benzo sign inspect --from http://host.orb.internal:<port> --id ID --batch N --name <me>`, which:
  1. fetches the **public auction dir** through `benzo api` and the batch packet;
  2. recomputes `result.json` from public data **through the mode registry** (it must match `result_hash`);
  3. opens every envelope for the batch's outputs with **its own envelope key** and checks each PCZT output's recipient and amount against the owner-signed envelope (**W2**);
  4. writes an **approval record** `{auction_id, batch, plan_version, H(manifest ‖ frozen_root ‖ drand_sig ‖ result.json ‖ batch_plan)}` signed with the signer's approval key (the FROST contact key is fine).
- `benzo sign join` signs **only** if a matching approval record exists for exactly that plan version. A changed plan version voids earlier approvals.
- **Refusals:** before `T_freeze`, before round R, if `result_hash` doesn't match, or if any output lacks a matching envelope.
- The coordinator picks any two reachable signers (T5 logic).
- **Mid-batch kill drill** (EVIDENCE + video):
  1. Start a batch with alice + bob.
  2. `orb stop benzo-bob` after bob has sent commitments but before signature shares are aggregated.
  3. The coordinator abandons that session (no nonce reuse; it's recorded), re-plans **the same batch** with carol, and settlement completes with alice + carol.
  4. The ledger shows no duplicate outputs.

## 4. Envelopes live (gate W)

- **[B] Multi-recipient envelopes.** Replace the single shared envelope key with one X25519 key **per signer**:
  - A random 32-byte content key encrypts the padded 512-byte plaintext (ChaCha20-Poly1305).
  - The content key is wrapped to each signer's X25519 public key (age-style stanzas).
  - The owner signature and settlement commitment cover the whole envelope.
  - This removes the "shared key" README caveat: **each signer holds only its own key**, though each can still read every destination (needed to check outputs). State that plainly.
- Each signer generates its envelope keypair on its machine during `benzo sign dkg`. The signed manifest pins the three envelope public keys (`envelope_keys: [hex, hex, hex]`).
- **[B] Intake route:** `POST /intake/envelope` on the operator's intake service (separate from the read-only API), body `{ciphertext_hash, envelope_ct, owner_sig}`.
  - **Before R** intake checks shape, size (fixed) and that `ciphertext_hash` is an admitted deposit.
  - **After R** (owner pubkey and settlement commitment are now readable from the opening), verify and signers check `owner_sig` and `SHA256(nonce ‖ envelope_ct) = settlement_commitment`.
  - **Rule:** the envelope must be submitted before `T_freeze`. A bid with no valid matching envelope is still cleared normally, but its refund or payout goes to the **exception queue**, claimable later by a request signed with the bid's owner key. Funds are never paid to an unauthenticated destination.
  - Track B owns the pure validation; Track A wires the route.
- `benzo bid seal` takes `--refund <shielded UA>`. It fetches `envelope_keys` from the manifest, builds the envelope, and submits it with `benzo bid deposit`.
- **W1 proof:** grep the public dir, the API responses and every log for every refund UA: zero hits outside the bidder's own wallet output.

## 5. Witnesses live (gate X)

- **Witness keys are distinct from FROST and envelope keys,** generated on each signer machine. `n_w = 3`, `q_w = 2`. The signed manifest carries `witness_set_hash` (R4).
- After freeze, each witness machine **independently** computes the root and only then signs the certificate. It does this by scanning the chain itself with `benzo-scan`, the escrow UFVK and its own lightwalletd connection, recomputing the accepted set by the published admission rules. A witness that computes a different root refuses and publishes its mismatch.
- `open` refuses without a `q_w` certificate. **X1:** a two-certificate equivocation fixture is refused by verify (already proven offline on track-b; here it runs live once).

## 6. Mode B live (gate V)

- `benzo auction create --mode buyback` with the treasury's `budget_zats` and `max_price_zats`.
- **The treasury funds the budget into the auction vault before `T_submit`.** `open` refuses if the vault's confirmed non-deposit balance is below `budget + fees`. Track A adds this as the `treasury` ledger obligation (`treasury_zats` in conservation).
- Sellers deposit C with sealed asks and bind a serial through the marketplace adapter's holder receipt. Asks without a valid serial binding are refunded exact C before freeze.
- Clearing goes through the registry, `mode: "buyback"`. Payouts go to the sellers' envelope destinations, and any unspent budget returns to the treasury destination pinned in the manifest.
- **V1/V2** per PHASE-5 §6.

### 6.1 Addendum (2026-10-04, head): Mode B live, as it will be built

The pure Mode B clear (`clear/mode-b.ts`), its verify-side money rules and its registry entry exist. What is missing is the product path and the treasury leg. Decisions:

1. **Product path accepts every registry mode.** `clear/auction-cli.ts`, `cli/product.ts`, `settle/plan.ts` and `settle/cli.ts` read the signed manifest through `clientForMode` (the registry) instead of the Mode A `client`, wherever they only need the common fields. `auction create --mode buyback --budget Z --max-price Z --treasury-ua UA` writes `clearing.mode = "buyback"` and the `buyback` block.
2. **The buyback block pins the treasury return.** Field set becomes `budget_zats, max_price_zats, treasury_ua`. `treasury_ua` must pass the shielded-only destination rule (`envelope/destination.ts`). It is public and signed; a treasury is a known party, so this leaks nothing about sellers.
3. **Treasury funding is a vault note at a pinned non-deposit address.** The manifest's `buyback` block gains no address. Instead the operator's routing names `treasury_funding_ua`, a fresh vault address that is not in `deposit_addresses`. That keeps it out of the bid set and the strays statement, the same way the fee reserve is kept out. The treasury sends exactly `budget_zats × lots` (lots = `m.lots.length` or 1) before `T_submit`. Network fees stay on the fee reserve, as in Mode A.
4. **`open` refuses an unfunded buyback.** Before opening, the operator sums confirmed, unspent vault notes at `treasury_funding_ua` (10 confirmations, like deposits). If the sum is below `budget × lots`, `open` refuses and the auction cancels: every ask refunds exact C, and whatever the treasury did send returns to `treasury_ua`. Each signer host checks the same sum from its own vault scan in `sign approve` before approving any buyback batch.
5. **Settlement rows.** `obligationsModeB` keeps one row per leaf (refund C + payment). The plan adds one `treasury` row of `funded − treasury_zats` to `treasury_ua` when it is positive. `funded` is the sum observed in (4), not the manifest number, so over-funding also returns. Hosts derive the same row from their own scan (`deriveRows`): the treasury row's recipient is the signed manifest's `treasury_ua`, never operator input.
6. **Serial binding through the marketplace adapter is not in part 1.** Asks are sealed asks with exact-C deposits; buying back a specific serial moves to part 2 with the marketplace adapter. PHASE-5 §6 V1/V2 do not depend on it.
7. **Order of work:** (1)+(2) with a unit check that a buyback manifest round-trips through create/sign/publish and the registry clear equals `clearModeB`, then (3)+(4)+(5) with the open-refusal mutation, then the live spec `e2e/buyback-mode.spec.ts` (V1, V2, W1, W2, X1, Y1 on host custody) and mutations 5M1–5M5.

## 7. Spec: `e2e/buyback-mode.spec.ts`

One live run of about 60–75 minutes:
1. three OrbStack signers up;
2. DKG;
3. a Mode B buyback with 6 sellers, one of whom also submits an envelope to a mainnet UA (refused at intake), plus 2 treasury-funded budget units;
4. witnesses;
5. open;
6. clear;
7. settle with the mid-batch kill drill.

The assertions are exactly PHASE-5 §6: V1 V2 W1 W2 X1 Y1. Mutations 5M1–5M5 are exactly as listed there. Phase 4's `cli-auction` must still pass on the new signer hosting (R8-style regression, all specs at one commit).

## 8. Order of work (each step committed with a logged proof)

1. TLS SANs + `deploy/signers/up.sh` + isolation proof.
2. `benzo sign dkg` + `benzo auction keys` + per-auction vault refactor, then a **cheap live check**: DKG, then a 1-bid Mode A auction settled from the machines.
3. Batch packet route + remote `sign inspect`/`join` + approval binding + refusals.
4. **[B]** multi-recipient envelopes + intake validation (B delivers first), then A wires intake + `bid seal --refund`.
5. Witness signing from the machines.
6. Treasury funding + Mode B live.
7. The kill drill.
8. Spec, mutations, regression, evidence, READY FOR REVIEW.

## 9. Traps

- OrbStack's default `/Users` mount defeats isolation; it must be off and proven off.
- Never copy a key share between machines, not even for "recovery". Recovery uses the 2 remaining shares.
- Nonce safety: an abandoned FROST session's nonces must never be reused. Each new session gets new commitments, and the ledger records abandoned sessions.
- Per-auction vaults mean the bidder pays a different UA each auction. The manifest's `escrow_ua` is the only source.
- NU7 is on testnet from about Oct 5–6. Re-check the activation height and the R7 expiry guard before every broadcast.

## 10. Addendum (2026-10-02): R7 items 1–2, exact wiring (head-owned)

**Item 1: gate W from signer-derived data only.**
- `settle/plan.ts` already runs fresh `tle -d` per frozen leaf for the signer check. Make it return `fresh_opened: Opened[]` alongside the plan, and write it into the signer's own `settle/<id>/signer-<name>/fresh-opened.json`. The signer computes this; it is never copied from the coordinator.
- `settle/envelopes.ts validEnvelope(...)` takes explicit inputs: `{manifestPacket, frozen, fresh_opened, published_envelopes}`. It must never receive `auction()`.
  - `frozen` and `published_envelopes` come from the **published** `auction.json` (the path pinned in the product config at intake). Check `frozen.root` against the manifest-bound frozen root the signer already verified.
  - The owner key, nonce and commitment come from `fresh_opened`.
- `settle/cli.ts destinations()`:
  - Remove `a=auction()` from the bid path.
  - For each `leaf:N` row, resolve the destination with `validEnvelope` on those inputs, then `openDestination` with the signer's key.
  - Before that, require that the coordinator's private ledger has the same `frozen.root`, the same `opened[N].plaintext_hex` as `fresh_opened[N]`, and the same envelope record bytes as published. Any difference → refuse the whole batch with `coordinator ledger differs from signer-derived data`.
- **Test:** a fixture where the coordinator ledger's `opened[0]` owner key and envelope are swapped to the operator's (published untouched). Before the fix the redirect is signed; after, it's refused. Copy the reviewers' F-3/G1 probes into `tools/repro/` and show CONFIRMED → FIXED.

**Item 2: signer-held envelope keys, pinned.**
- `benzo sign keys --id ID --name SIGNER` creates `envelope-<name>.json` (X25519, via libsodium once Track B lands it) in **that signer's** state dir and prints only the public key. `auction create` takes `--envelope-keys hex,hex,hex` and writes `envelope_keys` into the signed manifest; `auction sign` refuses a manifest whose keys don't match the three signer public keys on file.
- `bid seal` reads `envelope_keys` from the verified manifest only. It encrypts to all three once B's multi-recipient format is merged; until then, product mode refuses with `multi-recipient envelopes required (Track B)`.
- Remove every operator-side creation or distribution of an envelope private key. `grep -n "private_hex" cli/ settle/` must show only signer-side reads of the signer's own file.

## 11. Addendum (2026-10-04, head): host custody, as built and as remaining

**Built (8ad081f, Y1 PASS):** `benzo sign dkg` runs on each OrbStack host. It copies the host's own contact config to `~/.benzo/auctions/<id>/frost.toml` and the share stays there. `benzo auction keys --group-keys k,k,k` refuses disagreeing keys, the global key and any earlier auction's key, derives the UFVK and creates the view-only `state/vaults/<id>/wallet`. `auction sign` refuses a manifest not pinning that key and UA. Host CLI fixes: `repoRoot()`, optional `.env`, `BNZ_PCZT_BIN`, `up.sh` clearing the stage before `orbctl push`.

**Host custody mode** is on for an auction iff `state/vaults/<id>/keys.json` exists. Remaining, in order:
- **H1. Per-auction vault everywhere.** `settle/io` exposes `vaultDir()`: `state/vaults/<BNZ_AUCTION_ID>/wallet` when that exists, else `state/vault`. Every vault use goes through it (wallet, pczt, notes/scan, create, prove, extract, sweep). Each `benzo` command scoped to `--id` sets `process.env.BNZ_AUCTION_ID` before spawning children. The e2e harness keeps the global vault.
- **H2. Hosts as independent verifiers** (`up.sh`): zcash-devtool, zcash-sign, grpcurl and the protos built on each host at the Mac's pins. The launcher exports the non-secret network config. Each host runs `benzo auction keys` itself and so keeps its **own** view-only vault and chain view.
- **H3. Batch packet and host approval.** Per batch attempt the coordinator writes a packet: the published public dir (a copy), `claims.json`, the proven candidate PCZT, and `plan_version = SHA-256(candidate)`. It delivers the packet to the chosen hosts (transport: `orbctl push`; an HTTPS route later). Each host runs `benzo sign approve --id --batch --packet DIR --name n`, which:
  1. runs the full public check on the packet's dir and refuses on any ERROR;
  2. derives the expected payable rows itself: leaves from the recomputed result and its own fresh openings (published beacon), destinations from **its own** envelope key (bid envelopes, then claim envelopes), strays from **its own** vault scan, the seller payout amount from the result;
  3. inspects the candidate (`benzo-pczt inspect`), so every non-change output matches one expected (recipient, amount) and change returns to the vault;
  4. computes the sighash itself (`zcash-sign` reads it from the candidate);
  5. writes `approvals/<id>/<batch>.json {plan_version, sighash}` on the host.

  `benzo sign join` (host mode) signs only when its approval holds this exact sighash: it compares frost-client's printed message with the approved sighash before answering `y`.
- **H4. Coordinator on a host and the kill drill.** In host mode the FROST coordinator runs on `pair[0]`'s host (its auction config holds the group), driven over `orb run` with the sighash and randomizer on stdin. If a session fails mid-batch (the drill: `orb stop benzo-bob` after bob joined), the worker records the abandoned session (no nonce reuse; it's a new session), swaps in the next signer that approves, and re-signs **the same batch**. The ledger shows no duplicate outputs.
- **H5. Signer-side reports from hosts.** Envelope keys (`benzo sign envelope-key` on each host, pinned in the manifest), `sign envelope-opens --public DIR --claims FILE` and the witness certificate and strays statement run **on the hosts** against the pushed public dir and each host's own vault scan. Their outputs return to the coordinator (stdout or `orbctl pull`).
- **Limit to state:** the seller payout destination is operator routing, so hosts check its amount, not its address. Pinning the seller UA in the signed manifest closes this (future item).
- **Proof:** one live product auction with host custody (fresh DKG, three bids, a refund paid through envelopes) settled entirely by host approvals and host-held shares, plus the kill drill completing with alice + carol.

### 11.1 Live findings from Y2 (2026-10-04, head)
- **Proven live:** per-auction DKG on the hosts (Y1, and again in Y2 for auction 7885a5af…), per-host vaults from the operator's UFVK, host witness certificates, **host approvals of batch 1 computed from each host's own data**, and the kill drill aborting the alice + bob session when bob's host is stopped.
- **Fixed:**
  - a failed participant ends the whole session, so survivors are stopped (27494b5);
  - lingering frostd sessions are closed on surviving hosts before re-planning (`frost-client sessions --close-all`);
  - `freeze` must run after `T_submit` and before `T_freeze`; missing the cutoff cancels the auction.
- **Design gap: the candidate PCZT must be built on a signer host.** Under host custody the coordinator holds no envelope key, so it can't name the refund recipients; the Mac-built candidate sent every envelope refund to the exception queue. Remaining work (H6):
  - a host command `benzo sign build --id --batch --packet DIR --name n` takes the packet plus `rows.json` (the ledger's allocated rows: party, kind, amount) and `seller_ua` (operator routing);
  - it derives each row's recipient exactly as `sign approve` does (share one `deriveRows()`), creates the PCZT with `benzo-pczt create` on its own vault, proves it, and returns the proven candidate plus `{party, output_index}`;
  - the coordinator pulls it (`orbctl pull`), and every approving host, including the builder, runs `sign approve` on it;
  - receipts map outputs to parties by that index list, never by recipient.
- **H6 done and proven live (e593a23…cb4b3eb):** host-built candidate, host approvals, kill drill, re-plan with alice + carol, settlement `7e1ee059…` mined with 4 receipts, cold verify (evidence `docs/evidence/phase-5/y2/`). Broadcast under custody uses `pczt send-without-storing` (the operator vault does not know the building host's account id).
- **H7: the operator never sees refund destinations (de6d167).** The H6 build still handed the coordinator the full proven PCZT, whose output fields (`recipient`, `rseed`, `user_address`) name every refund destination in plain text, and the outputs carried an OVK the vault UFVK could open on-chain. Now:
  - `benzo-pczt create` uses `OvkPolicy::Discard`, so no holder of the vault UFVK can recover outgoing recipients;
  - the building host redacts every non-change output's `recipient`, `rseed`, `ock`, `user_address` and `zip32_derivation` (`zcash-devtool pczt redact`, deterministic) and the coordinator receives only that copy. Its `plan_version` is the SHA-256 of the redacted bytes;
  - the full candidate goes to each signer sealed (`crypto_box_seal`, libsodium) to the envelope key the verified manifest pins for it. The coordinator relays blobs it cannot open;
  - each approving host opens its copy, checks it strictly (note commitment, encryption, recipients against its own derived rows), and requires its own redaction to equal the coordinator's `plan_version`. A coordinator-forged sealed copy still fails the derived-row check;
  - the coordinator inspects with `benzo-pczt inspect --allow-redacted` (amounts and change only). Redaction leaves the sighash and the extracted txid unchanged (checked on Y2 batch 1: sighash `2a099314…`, txid `7e1ee059…`);
  - stated remainder: amounts stay visible to the coordinator (they are in the public result anyway), and the seller payout UA is operator routing.
- **Funds parked:** auction 7885a5af… settled (above). Auction ea0d5761… was auto-cancelled before any host published envelope-open reports, so `benzo cancel` sent its three refunds to the exception queue (state REFUNDING). The bidders recover them through `claim-refund` after R; host-built cancel refunds (the cancel path under custody needs a host derivation without a cleared result) are remaining work.
