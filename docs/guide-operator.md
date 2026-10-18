# Operator guide

Runbook for running one Benzo auction. Commands checked against `bin/benzo --help` and each
command's `--help` at commit `79004a7` plus this commit's help fixes, 2026-10-18 (40 invocations,
transcript `tmp/guide-help.txt`, scratch). `benzo` is `bin/benzo` in the checkout. Testnet
only. Private key material stays under `$BNZ_STATE_DIR`; never print it.

1. **Create the auction.** Every input below is produced by the CLI alone. Under host custody, first
   run the auction's own DKG on the three signer hosts (`benzo sign dkg` on each — see
   `docs/guide-signer.md`). Then, in order:

   1. **This auction's keys.** Derive them from the three reported group keys. On signer hosts the
      same command imports the operator's UFVK (`--ufvk FILE`) so every host keeps its own view-only
      vault:

      ```text
      $ benzo auction keys --id AUCTION_ID --group-keys KEY,KEY,KEY [--ufvk FILE]
      ```

      It refuses disagreeing, reused or global group keys and prints `{group_key, escrow_ua}`.

   2. **The public addresses.** Deposit slot 0 is the escrow UA from the previous step; every other
      deposit slot and the fee-reserve deposit address is a fresh address of the same vault. These
      are public deposit/escrow addresses — the signed manifest publishes them:

      ```text
      $ benzo auction addresses --id AUCTION_ID --count N
      ```

      Output: `{auction_id, addresses}` — N fresh shielded addresses. Count what you still need:
      one per deposit slot beyond slot 0, plus the fee reserve.

      The **seller address is not a vault address.** It is the seller's own shielded unified
      address, from the seller's wallet: the sale proceeds leave the vault to it. A vault address
      here would leave the proceeds inside the auction vault.

   3. **From the signers:** the three `envelope_keys` (each signer runs `benzo sign envelope-key
      --name SIGNER`, which prints its public half) and the three witness keys (each signer runs
      `benzo witness keygen --name SIGNER`, which prints `public_hex`).

   4. **The witness set.** Pin the q-of-n witness board in a signed side-packet:

      ```text
      $ benzo witness set --id AUCTION_ID --q N --keys HEX,HEX,HEX [--key private.pem]
      ```

      It builds and signs `{version: 1, auction_id, q_w, keys}` with the manifest-signing key (the
      same key `auction sign` uses), writes the record to
      `$BNZ_STATE_DIR/run/witness-set-<AUCTION_ID>.json` and prints `{file, witness_set_hash}`. It
      refuses a `q` outside `1..keys.length`, duplicate keys and malformed keys.

   5. **The drand round R.** Pick the release instant and ask for its quicknet round:

      ```text
      $ benzo drand round --at <ISO-8601 UTC>
      ```

      Output: `{round, release_utc}` — the first pinned-quicknet round releasing at or after that
      instant (R = 1 + ceil((release − genesis) / 3)); `release_utc` is that round's exact release
      instant. Put `round` into the manifest's `drand.R`, and place `T_submit`/`T_freeze` before it.

   6. **Fill the template.** `docs/examples/unsigned-manifest.json` is exactly the object
      `auction create` takes — every field, in the harness's order — with the per-auction values in
      angle brackets:

      | field | meaning | value comes from |
      |---|---|---|
      | `version` | manifest format | always `1` |
      | `network` | chain family | always `"test"` (testnet) |
      | `auction_id` | this auction's id | you choose 64 hex chars; it is the `--id` everywhere |
      | `escrow_ua` | the auction vault's escrow address | `auction keys` output |
      | `frost_group_key` | the 2-of-3 FROST group key | `auction keys` output |
      | `lot` | round label (free text) | you choose it |
      | `supply`, `reserve_zats`, `tick_zats`, `B_max_zats`, `q_max`, `C_zats`, `fee_zats` | units on offer; reserve price, tick, per-bid cap and quantity, collateral and fee (decimal zatoshis) | you choose them |
      | `deposit_addresses` | one address per bid slot (slot 0 is the escrow UA) | slot 0 from `auction keys`; the rest from `auction addresses` |
      | `envelope_keys` | the three signers' X25519 envelope public keys, in signer order | each signer's `benzo sign envelope-key` |
      | `witness_set_hash` | commitment to the signed witness set | `witness set` output |
      | `drand.chain_hash`, `drand.public_key`, `drand.scheme`, `drand.genesis`, `drand.period` | the pinned quicknet parameters | fixed — `auction create` refuses any other value |
      | `drand.R` | the release round | `drand round` output |
      | `T_submit`, `T_freeze` | bid and freeze deadlines (unix seconds) | you choose them: `T_submit` < `T_freeze`, at least 750 s apart, and `T_freeze` before the round's `release_utc` |
      | `confirmations`, `freeze` | maturity confirmations and the freeze commitment | always `10` and `"merkle_root_v1"` |
      | `clearing` | the uniform clearing rules | fixed — the uniform-mode rules |
      | `refund` | the refund policies | fixed |

   7. **Create it.** A manifest without the three pinned `envelope_keys` or without
      `witness_set_hash` is refused:

      ```text
      $ benzo auction create --file unsigned-manifest.json [--witness-set FILE]
      ```

      `--witness-set` is the `file` printed by `witness set` — the signed side-packet the manifest's
      `witness_set_hash` commits to. Output: the `auction_id` (64 hex chars) and `state: DRAFT`.

2. **Sign the manifest.** The local receipt key signs the manifest. With no `--key` the key is
   generated and kept under `$BNZ_STATE_DIR`.

   ```text
   $ benzo auction sign --id ID [--key private.pem]
   ```

3. **Publish.** The private operator config (`docs/examples/private-operator.json`) supplies
   `settlement` (`signers`, `batch_cap` 1–28, `pczt_expiry_blocks` 1–10000) and `routing`
   (`bidders[].deposit_ua` — the manifest's deposit addresses in order, `seller_ua`,
   `fee_reserve_ua`; there is no `stray_refund_ua` — stray refunds are never operator-chosen).

   ```text
   $ benzo auction publish --id ID --dir public-dir --config private-operator.json
   ```

4. **Watch the auction.** Status reports the state, accepted bids, chain tip and current drand
   round. Admit deposits as they arrive (one `deposit.json` per payment; `--pay` pays from the
   testnet bidder wallet in this checkout).

   ```text
   $ benzo auction status --id ID
   $ benzo bid deposit --id ID --file deposit.json [--pay]
   ```

5. **Witness the frozen root.** Before `open`, collect `q_w` frozen-root certificates from the
   witness board. `open` refuses without them.

   ```text
   $ benzo witness sign --dir public-dir --signer HEX --key FILE
   ```

6. **Freeze when the admission window closes, open at R, clear.** `open` runs after the drand round
   R is published. Each step republishes the public directory.

   ```text
   $ benzo freeze --id ID
   $ benzo open --id ID
   $ benzo clear --id ID
   ```

7. **Settle.** Settlement plans refund and payout batches from the published envelopes and valid
   owner-signed claims. Each signer runs its own steps first (see `docs/guide-signer.md`): witness
   certificates, `benzo sign envelope-opens`, then `benzo sign inspect` and `benzo sign join` per
   batch. If the auction cancels, the same refund path runs through `cancel`:

   ```text
   $ benzo settle --id ID
   $ benzo cancel --id ID
   ```

8. **Record and settle refund claims.** A request carries `party` (`leaf:N`,
   `deposit:TXID:POOL:INDEX`, `balance-late:TXID:POOL:INDEX` or `balance-excess:LEAF`),
   `claim_envelope_ct` and `owner_sig`. Only the first claim whose owner
   signature verifies is paid; anything unresolvable becomes an exception row and the batch
   proceeds. `--defer` records without settling.

   ```text
   $ benzo claim-refund --id ID --file request.json
   ```

9. **Publish the public view and serve it.** The read API serves one public directory and returns
   the verifier's own ERROR lines on a bad document. The report is the per-window buyback report.

   ```text
   $ benzo operator view --dir public-dir
   $ benzo api serve --dir public-dir [--host 127.0.0.1] [--port 8787] [--signer HEX]
   $ benzo report --dir public-dir [--previous public-dir]
   ```

10. **Verify before you announce.** The same command anyone can run. It re-derives every opening
    offline from the published beacon and reproduces the clearing and the accounting. Exit 0 and no
    `ERROR` lines is the bar.

    ```text
    $ benzo verify --dir public-dir --signer HEX
    ```

11. **Receipts and statements for bidders.** Hand bidders their proof material (they can also run
    these themselves against the published directory):

    ```text
    $ benzo receipt show --dir public-dir --ciphertext-hash HEX [--receipt FILE]
    ```

12. **What host custody changes for you.** The signer hosts pin YOUR manifest-signing key at
    provisioning (`state/operator-signer.txt` on each host) and pin the first manifest they see per
    auction — a second, different manifest for the same auction is refused everywhere. Per batch
    you deliver a packet (the published dir, `claims.json`, the proven candidate); each host runs
    `benzo sign build`/`benzo sign approve` and derives every payable row from its OWN data — fresh
    openings from the published beacon, its own envelope key, its own vault scan. You never see a
    refund destination. Each host keeps an approval ledger keyed by txid, so no deposit note is
    paid twice across batches. A host refuses change that is not an internal vault address, a
    cleared buyback whose budget × lots is not confirmed at `funding_ua`, and a candidate whose
    expiry lies outside (tip, tip + 10000]. “Cancelled” means the auction has **no result**.
    Claims are owner-signed requests the hosts attest (`benzo claim-refund --id ID --file
    request.json`; a signer-side view is `benzo sign envelope-opens … --claims FILE`).

13. **NU7 and `BNZ_LWD_SINGLE`.** Public testnet activated NU7 (branch `0x77190AD9`) at height
    4,465,026 and the stack runs the pinned `tools/nu7` backport (Ruling R27). While only one
    public lightwalletd endpoint serves NU7, run every live command with `BNZ_LWD_SINGLE=1`
    (testnet only). Mainnet keeps the as-pinned Ironwood stack until its NU7 height is set
    (`docs/mainnet-risks.md`).

14. **Cross-chain lots (optional).** The seller locks the asset in the target-chain escrow BEFORE
    bidding (`xchain lock` pins the signer set, amount, lot and deadline). The signer hosts hold
    their own cross-chain keys (`benzo xchain keygen` on each host; you keep only the public
    halves for the lock's signer file). After clearing and Zcash settlement each host attests over
    the pushed public dir (`benzo xchain attest --host-record` with its own envelope key and
    cross-chain key); you collect two hosts' signature records over the identical attestation
    bytes and submit — you never hold a signer key and never name a destination:

    ```text
    $ benzo xchain lock --chain evm|solana --auction HEX32 --amount WAD --lot WAD --lock-until TS --deadline TS --signers FILE --return ADDR --key FILE --rpc URL --escrow ADDR [--asset 0xADDR]
    $ benzo xchain release --chain evm|solana (--bundle FILE | --attestation FILE --attestation FILE ...) --key FILE --rpc URL [--only 0,2] [--submit-only] [--stipend WAD] [--announcer ADDR]
    $ benzo xchain refund --chain evm|solana --auction HEX32 --key FILE --rpc URL --escrow ADDR
    $ benzo xchain status --chain evm|solana --auction HEX32 --rpc URL --escrow ADDR [--bundle FILE] [--result FILE]
    ```

    After the deadline with no release, anyone can `refund` back to the pinned return address.
    The demo drivers are `tools/repro/xchain-demos.ts` (part 2 §2); the escrow deployments are
    recorded in `docs/STATUS-B.md`. Only the allocation root, the result hash and the bidders'
    fresh destinations ever reach a target chain.
