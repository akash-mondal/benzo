# Bidder guide

Runbook for bidding in one Benzo auction. Commands checked against `bin/benzo --help` and each
command's `--help` at commit `96ce0f5` plus this commit's help fixes, 2026-10-18 (checked by
`tools/repro/b42-hosts-cli.ts` section 7). Testnet only. Keep your owner key and bid file
private; the commands store owner material under `$BNZ_STATE_DIR` and print only public values.

1. **Fund your shielded wallet.** Get a real quote for funding your own shielded UA with a round
   amount you chose. The command is always dry: it prints the quote terms and never deposits or
   swaps. Wait for the funds before bidding.

   ```text
   $ benzo fund quote --from <1click asset id, e.g. nep141:wrap.near> --zec <whole ZEC count> --to <shielded UA> --refund-to <origin-chain address>
   ```

   Keep a balance of at least 3 × C plus fees: C is locked as collateral per bid.

2. **Check the manifest and prepare your bid.** `--signer HEX` is the auction's receipt key. The
   command checks the signed manifest and prepares your one-time owner key, nonce and salted
   settlement commitment.

   ```text
   $ benzo bid prepare --manifest manifest.json --signer HEX
   ```

3. **Seal your bid.** `private-bid.json` holds `price_zats`, `quantity`, one of the manifest's
   deposit `address`es, and your `refund_ua` (shielded only) or `deliver` (a cross-chain
   destination). The browser sealer tlock-encrypts the 128-byte bid to the release round R and
   seals your refund and delivery destinations into a settlement envelope encrypted to the three
   signer keys pinned by the manifest. The memo carries the sealed bid and an 18-byte envelope tag.

   ```text
   $ benzo bid seal --manifest manifest.json --signer HEX --file private-bid.json
   ```

   Output: `envelope_hex` (the memo), `uri` (the exact payment URI), `round`, `ciphertext_hash` and
   the owner material. Bad input fails here, for you, not silently at settlement: an unlisted
   address, a non-shielded refund, a malformed delivery address or `kind: railgun` is refused. Note
   the `round`: R opens your bid to everyone.

4. **Pay the collateral deposit.** Pay exactly C to the `uri` (address, amount and memo are bound
   together) from your own wallet before `T_submit`. In this checkout's testnet wallet the payment
   command is:

   ```text
   $ benzo bid deposit --id ID --file deposit.json --pay
   ```

   Its `deposit.json` is the **payment input**: your `bid seal` output (`uri`, `address`,
   `envelope_hex`), or `{bids: [ … ], reserve: {address, amount_zats}}` when one transaction also
   funds the auction's fee reserve (the operator's step 5). After paying, **send the operator the
   admission record** — without it your deposit is never admitted:

   ```json
   {
     "txid": "9f4c8a…",
     "address": "utest1qxy…",
     "envelope_hex": "4e425a…",
     "envelope_ct_hex": "2b91…",
     "owner_sig_hex": "88a1…"
   }
   ```

   Each field: `envelope_hex`, `envelope_ct_hex` and `owner_sig_hex` are printed by your `bid seal`
   run (step 3). `address` is the deposit address you chose in your `private-bid.json` (the seal
   output does not repeat it; it is also the address in the `uri`). `txid` is the transaction your
   wallet made paying the `uri` (shown by the payment or your wallet's history). The `--pay` input
   needs the same `address` next to the seal's `uri` and `envelope_hex`.

   **Send the record once your deposit has 10 confirmations.** Admission checks the deposit on
   chain and refuses it before then (`deposit not unique or absent` while unmined, `deposit
   confirmation/pool/spent` while it has fewer than 10 confirmations); simply send it again later.
   It must be admitted before the manifest's `T_freeze`. The operator admits it with
   `benzo bid deposit --id ID --file deposit.json` (no `--pay`).

   Exchange withdrawals can miss `T_submit`; give them time. A deposit mined before `T_submit` that
   is missing from the frozen set is owed a refund (see step 5).

5. **Prove your bid is in.** After `freeze`, check your `ciphertext_hash` against the frozen root
   and keep the proof. `--note-id` names your note as `txid:ironwood:index` when several deposits
   share a ciphertext hash.

   ```text
   $ benzo receipt prove --dir PUBLIC --ciphertext-hash HEX [--note-id <txid:ironwood:index>]
   $ benzo receipt prove --check <inclusion-proof.json>
   ```

   A deposit mined before the cutoff but absent from the root is owed a refund of exactly C. If the
   operator's published deposit list names it, `benzo verify` requires it in the exception queue.
   If the operator left it out (README "An operator can refuse a funded bid"), claim it yourself
   with your owner key as a stray (step 7): your funds stay yours, but your bid is not in the
   auction.

6. **Get your signed settlement statement.** After settlement, the statement names your leaf, fill,
   price and payout or refund txid, signed by your owner key. Check it against `result.json` and the
   chain.

   ```text
   $ benzo receipt statement --dir PUBLIC --ciphertext-hash HEX
   $ benzo receipt statement --dir PUBLIC --ciphertext-hash HEX --check <statement.json>
   ```

7. **Refunds after R.** Normally nothing to do: the signers open your envelope and refund to your
   sealed destination (two of three must agree on it). If your bid or deposit is in the exception
   queue, claim it. This builds and signs the request: your destination is sealed in an envelope to
   the signers' pinned keys and only its hash is published. Send the request to the operator, who
   records and settles it with `benzo claim-refund --id ID --file request.json`.

   ```text
   $ benzo claim-refund --id ID --party leaf:N|deposit:TXID:DI --destination SHIELDED_UA --owner-key-stdin
   ```

   On a cancelled auction the same claim path pays your C back after R.

8. **Delivery complaints.** If you were paid but did not receive what you bought, file the
   owner-signed offline delivery claim. `--check` verifies a claim without filing.

   ```text
   $ benzo claim --dir PUBLIC --ciphertext-hash HEX [--receipt FILE --statement FILE] [--owner-key-stdin | --check CLAIM]
   ```

9. **Check anything yourself.** The verifier needs only the published directory and the signer key
   you trust. It re-derives openings offline and reproduces the clearing and the accounting.

   ```text
   $ benzo verify --dir PUBLIC --signer HEX
   ```

   Remember the honest limit: all bids open at R, anonymised. Losing bids are not secret forever
   (`README.md` "Honest limits").
