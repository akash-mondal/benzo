# Operator guide

Runbook for running one Benzo auction. Commands checked against `bin/benzo --help` and each
command's `--help` at commit `e28669b`, 2026-10-03. `benzo` is `bin/benzo` in the checkout. Testnet
only. Private key material stays under `$BNZ_STATE_DIR`; never print it.

1. **Create the auction.** Prepare the unsigned manifest (auction id, collateral C, deposit
   addresses, deadlines, the drand quicknet round R, `envelope_keys` from the three signers, and
   `witness_set_hash`), then create it. A manifest without the three pinned `envelope_keys` or
   without `witness_set_hash` is refused.

   ```text
   $ benzo auction create --file unsigned-manifest.json [--witness-set FILE]
   ```

   `--witness-set` is the signed witness-set side-packet the manifest's `witness_set_hash` commits
   to. Output: the `auction_id` (64 hex chars) and `state: DRAFT`.

2. **Sign the manifest.** The local receipt key signs the manifest. With no `--key` the key is
   generated and kept under `$BNZ_STATE_DIR`.

   ```text
   $ benzo auction sign --id ID [--key private.pem]
   ```

3. **Publish.** The private operator config supplies `settlement` (`batch_cap` 1–13,
   `pczt_expiry_blocks` 1–10000) and `routing` (`seller_ua`, `fee_reserve_ua`; there is no
   `stray_refund_ua` — stray refunds are never operator-chosen).

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

8. **Record and settle refund claims.** A request carries `party` (`leaf:N` or
   `deposit:TXID:DI`), `claim_envelope_ct` and `owner_sig`. Only the first claim whose owner
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
