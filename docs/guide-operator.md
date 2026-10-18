# Operator guide

Runbook for running one Benzo auction. Commands checked against `bin/benzo --help` and each
command's `--help` at commit `96ce0f5` plus this commit's help fixes, 2026-10-18 (52 invocations,
checked by `tools/repro/b42-hosts-cli.ts` section 7, transcript `tmp/guide-help.txt`, scratch).
`benzo` is `bin/benzo` in the checkout. Testnet only. Private key material stays under
`$BNZ_STATE_DIR`; never print it. **Every private input file** (the operator config, the witness
set, admission records, key files) lives under `$BNZ_STATE_DIR` — the CLI refuses a private file
(`--config`, `--witness-set`, `--key`, `--witness-key`) from anywhere else.

0. **Before the first auction.**

   - **The signing relay runs.** One local `frostd` serves the DKG and every signing session (the
     port is the one in `BNZ_FROSTD_ADDR`):

     ```text
     $BNZ_STATE_DIR/bin/frostd -i 127.0.0.1 -p 2744 -c $BNZ_STATE_DIR/tls/frostd.pem -k $BNZ_STATE_DIR/tls/frostd.key
     ```

   - **The three signer hosts are provisioned** (`deploy/signers/up.sh` builds and installs
     `benzo`, `frost-client` and `zcash-devtool` on `benzo-alice`, `benzo-bob` and `benzo-carol`,
     and records your manifest-signing key on each). In this deployment one operator provisions
     all three OrbStack VMs on one Mac (README honest limits).

   - **The bidder wallet.** In this testnet deployment the deposits and the fee reserve are paid
     from the bidder wallet in this checkout (`$BNZ_STATE_DIR/bidder`), funded with testnet ZEC.
     Keep at least 3 × C plus fees per bidder beyond the collateral actually paid.

   - **`BNZ_LWD_SINGLE=1`.** While only one public lightwalletd endpoint serves NU7, run every
     live command with `BNZ_LWD_SINGLE=1` (testnet only; see the NU7 step below).

1. **Create the auction.** Every input below is produced by the CLI alone. Under host custody the
   DKG and the key collection run on the three signer hosts through `orb`:

   1.0. **This auction's DKG and keys.** One command runs the per-auction 2-of-3 DKG on the three
   hosts (`alice` passes `--peers` with bob's and carol's contact pubkeys; all three run
   concurrently against `frostd`), then this auction's vault here (`auction keys`), then imports
   the same UFVK on every host so each keeps its own view-only vault:

   ```text
   $ benzo hosts dkg --id AUCTION_ID
   ```

   Output: `{group_key, escrow_ua, keys}`. It refuses when `state/vaults/AUCTION_ID` already
   exists (one fresh DKG per auction) and takes the harness's DKG lock (`tmp/markets-dkg.lock`),
   so it never collides with a live harness run.

   1. **This auction's keys** (already done by `hosts dkg`; shown here for a signer set on
      separate hardware, where each signer reports its own `benzo sign dkg` result). Derive them
      from the three reported group keys. On signer hosts the same command imports the operator's
      UFVK (`--ufvk FILE`) so every host keeps its own view-only vault:

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

   3. **From the signers: the pinned public keys.** One command collects them in signer order (a
      key is generated on its host if missing and reused if present — a keypair is **per signer**
      and lives on its host forever, not per auction):

      ```text
      $ benzo hosts keys
      ```

      Output: `{envelope_keys: [3], witness_keys: [3]}` — the three X25519 envelope public keys
      and the three witness public keys. Each signer can print its own public half again at any
      time with `benzo sign envelope-key --name SIGNER --show` or
      `benzo witness keygen --name SIGNER --show` (see `docs/guide-signer.md`). No private key
      ever leaves a signer host.

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
      | `supply`, `reserve_zats`, `tick_zats`, `B_max_zats`, `q_max`, `C_zats`, `fee_zats` | units on offer; reserve price, tick, per-bid cap and quantity, collateral and fee (decimal zatoshis) | you choose them (`fee_zats` must be `0`: network fees come from the fee reserve) |
      | `deposit_addresses` | one address per bid slot (slot 0 is the escrow UA) | slot 0 from `auction keys`; the rest from `auction addresses` |
      | `envelope_keys` | the three signers' X25519 envelope public keys, in signer order | `benzo hosts keys` |
      | `witness_set_hash` | commitment to the signed witness set | `witness set` output |
      | `seller_ua_commitment` | commitment to the seller's payout address | **set by `auction create --config`**, never typed by hand (H10) |
      | `drand.chain_hash`, `drand.public_key`, `drand.scheme`, `drand.genesis`, `drand.period` | the pinned quicknet parameters | fixed — `auction create` refuses any other value |
      | `drand.R` | the release round | `drand round` output |
      | `T_submit`, `T_freeze` | bid and freeze deadlines (unix seconds) | you choose them: `T_submit` < `T_freeze`, at least 750 s apart, and `T_freeze` before the round's `release_utc` |
      | `confirmations`, `freeze` | maturity confirmations and the freeze commitment | always `10` and `"merkle_root_v1"` |
      | `clearing` | the uniform clearing rules | fixed — the uniform-mode rules |
      | `refund` | the refund policies | fixed |

   7. **Create it.** A manifest without the three pinned `envelope_keys` or without
      `witness_set_hash` is refused. `--config` is the same private operator config `auction
      publish` takes (under `$BNZ_STATE_DIR`, with `routing.seller_ua` filled in): whenever that
      field is set, `create` commits it into the signed manifest as `seller_ua_commitment`, held
      to H4's rule (a unified address on the manifest's own network with a shielded
      Orchard/Ironwood receiver):

      ```text
      $ benzo auction create --file unsigned-manifest.json --witness-set FILE --config PRIVATE-OPERATOR.json
      ```

      `--witness-set` is the `file` printed by `witness set` — the signed side-packet the manifest's
      `witness_set_hash` commits to. Output: the `auction_id` (64 hex chars) and `state: DRAFT`.

2. **Sign the manifest.** The local receipt key signs the manifest. With no `--key` the key is
   generated and kept under `$BNZ_STATE_DIR`.

   ```text
   $ benzo auction sign --id ID [--key private.pem]
   ```

3. **Publish.** The private operator config (`docs/examples/private-operator.json`, copied under
   `$BNZ_STATE_DIR`) supplies `settlement` (`signers`, `batch_cap` 1–28, `pczt_expiry_blocks`
   1–10000) and `routing` (`bidders[].deposit_ua` — the manifest's deposit addresses in order,
   `seller_ua`, `fee_reserve_ua`; there is no `stray_refund_ua` — stray refunds are never
   operator-chosen).

   ```text
   $ benzo auction publish --id ID --dir public-dir --config PRIVATE-OPERATOR.json
   ```

4. **The seller checks their payout binding (before bidding opens).** The signed manifest commits
   the seller payout address (`seller_ua_commitment`, step 1.7). Send the seller the published
   `manifest.json`; the seller runs their own one-line check and it must exit 0:

   ```text
   $ benzo seller check --manifest public-dir/manifest.json --ua <the seller's own address>
   ```

   Output on success: `{signer, network, seller_ua_commitment, ua_commitment, bound, matches}`.
   A mismatch exits 1: the manifest does not commit this address — do not open bidding.

5. **Fund the fee reserve.** Settlement's network fees come from the reserve note at
   `routing.fee_reserve_ua` (the manifest's `fee_zats` must be `0`; `settle/plan.ts` refuses
   anything else). The amount rule as the code applies it: every settlement batch pays
   `5,000 × max(2, actions)` zats from the reserve (the ZIP-317 fee the batch builder enforces,
   `settle/src/main.rs`), where `actions` counts the batch's shielded actions — for a batch paying
   k rows that is k + 1 (the k deposits plus the reserve's own spend). So fund at least

   `5,000 × (payable rows + number of batches)` zats,

   i.e. about `5,000 × (rows + ceil(rows / batch_cap))` plus slack for re-planned batches. The
   harness funds **60,000 zats for small runs** (e.g. 3 bids + the seller at `batch_cap` 13) and
   200,000–400,000 zats for the 27- and 55-bid scale runs (`tools/repro/markets.ts`). Pay it in
   the same funding transaction as the deposits, through the `--pay` form of `bid deposit` with
   `reserve` (the address must equal `routing.fee_reserve_ua` exactly — the CLI refuses a
   mismatch):

   ```json
   {
     "bids": [
       { "uri": "zcash:?address=utest1qxy…&amount=0.00200000&memo=UEJ…",
         "address": "utest1qxy…", "envelope_hex": "4e425a…" }
     ],
     "reserve": { "address": "utest1fee…", "amount_zats": "60000" }
   }
   ```

   ```text
   $ benzo bid deposit --id ID --file $BNZ_STATE_DIR/run/deposit-pay.json --pay
   ```

   Output: `{txid, C_zats, deposits, state: "broadcast"}`.

6. **Admit deposits (two different `deposit.json` shapes).** `--pay` and the admission record are
   two different inputs:

   - **With `--pay`** the input is the `bid seal` output (or `{bids: […], reserve: {address,
     amount_zats}}`, step 5): `uri`, `address` and `envelope_hex` per bid. It broadcasts from this
     checkout's bidder wallet and prints the `txid`.
   - **Without `--pay`** the input is the **admission record** the bidder sends you after paying:

     ```json
     {
       "txid": "9f4c8a…",
       "address": "utest1qxy…",
       "envelope_hex": "4e425a…",
       "envelope_ct_hex": "2b91…",
       "owner_sig_hex": "88a1…"
     }
     ```

     Every field except `txid` is in the bidder's `bid seal` output; `txid` is the transaction
     their wallet made paying the `uri`. One record per payment:

     ```text
     $ benzo bid deposit --id ID --file $BNZ_STATE_DIR/run/deposit.json
     ```

     Output: `{…, C_zats}`. Only an admitted deposit enters the frozen set.

7. **Freeze, witness, open, clear, report, settle — in that order.** The true order of the close:

   1. After `T_submit`, wait until every deposit has its **10 confirmations** (`confirmations` in
      the manifest) and the admission window has closed.
   2. **Freeze** the accepted set (this republishes the public dir):

      ```text
      $ benzo freeze --id ID
      ```

   3. **Collect the witness certificates** (they exist only after the freeze). `hosts witness`
      syncs each named host's vault, pushes the public dir, runs `witness sign` there (each host
      recomputes the frozen root from its own vault scan first), merges the certificates into the
      public `auction.json` through the checked merge (a bad or non-quorate certificate set is
      refused and nothing is written) and republishes. It refuses before `freeze`:

      ```text
      $ benzo hosts witness --id ID [--names alice,bob]
      ```

      Output: `{certificates, q_w}`. `open` refuses without `q_w` valid certificates.

   4. **Wait for the drand round R** (`benzo drand round` printed its `release_utc`), then **open**
      and **clear**. Each step republishes the public directory:

      ```text
      $ benzo open --id ID
      $ benzo clear --id ID
      ```

   5. **The hosts' envelope-opening reports** (before any batch is planned). Each host syncs its
      vault, gets the public dir and the recorded `claims.json` pushed, and runs its own
      `sign envelope-opens`; the reports are saved where `settle` reads them
      (`$BNZ_STATE_DIR/settle/<ID>/envelope-opens-<name>.json`):

      ```text
      $ benzo hosts envelope-opens --id ID
      ```

      Output: `{reports: [{name, ok_rows, not_ok_rows}]}`.

   6. **Settle.** Settlement plans refund and payout batches from the published envelopes and valid
      owner-signed claims. Each signer's own steps run first on its host (see
      `docs/guide-signer.md`): certificates, `benzo sign envelope-opens`, then `benzo sign inspect`
      and `benzo sign join` per batch. If the auction cancels, the same refund path runs through
      `cancel`:

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
