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
