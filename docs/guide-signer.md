# Signer guide

Runbook for one Benzo signer (alice, bob or carol) on its own host. Commands checked against
`bin/benzo --help` and each command's `--help` at commit `37ac903`, 2026-10-05 (34 invocations,
transcript `tmp/guide-help.txt`, scratch). Testnet only. Every
key lives under your state dir (`--state DIR`, else `BNZ_STATE_DIR`, else `~/.benzo-signer`); the
commands print public values only. Never print a private key.

1. **Generate your envelope keypair.** One X25519 keypair per auction, generated here, on your host.
   Only the public half leaves this machine; the operator pins it in the signed manifest at your
   index (alice 0, bob 1, carol 2).

   ```text
   $ benzo sign envelope-key --name SIGNER [--state DIR]
   ```

   If the manifest does not pin your key at your index, every signing command refuses with
   `manifest does not pin this signer's envelope key`. If your key file is missing, the plan refuses
   with `signer envelope key missing` — it is never skipped.

2. **Keep your witness key.** Your witness key is a member of the manifest's pinned witness set, in
   a file under the state dir. It signs the frozen-root certificate and the strays statement, and it
   signs your envelope-opening report.

   ```text
   $ benzo witness sign --dir PUBLIC --signer HEX --key FILE
   $ benzo witness strays --dir PUBLIC --signer HEX --key FILE --notes scanner-output.jsonl
   $ benzo witness verify --dir PUBLIC --signer HEX
   ```

   `witness strays` builds the strays statement from your own scanner output, so the public can tie
   every stray-deposit claim to the chain. Two witnesses' scans that disagree refuse loudly.

3. **Write your envelope-opening report before any batch is planned.** You open every refund
   envelope with your own key and record only `ok` and the destination hash — never the destination.
   An envelope you cannot open is `ok: false`, never an abort. The report is signed with your
   witness key; the plan counts only reports whose signature verifies, one per distinct witness key.

   ```text
   $ benzo sign envelope-opens --id ID --name SIGNER --witness-key FILE
   ```

   A refund is payable only when at least two signers report `ok` with the same destination hash.
   Otherwise the row goes to the exception queue.

4. **Inspect a batch before you approve it.** Recompute the batch from your own data: fresh tle
   openings, the sealed reserve, the published envelopes and claims, the two-signer agreement. A
   PCZT output that differs from your own opened destination is refused.

   ```text
   $ benzo sign inspect --id ID --batch N --candidate private.pczt --name SIGNER [--randomizer HEX --sighash HEX]
   ```

5. **Approve and sign.** Your approval binds `H(manifest ‖ frozen_root ‖ drand_sig ‖ result.json ‖
   batch-plan version)`; a changed plan voids earlier approvals. The CLI refuses before freeze and
   before the release round R.

   ```text
   $ benzo sign join --id ID [--batch N --candidate private.pczt --name SIGNER --randomizer HEX --sighash HEX]
   ```

   Two of the three signers are enough to pay a batch. One signer can stall a batch but never
   redirect it.

6. **Host custody: your own per-auction DKG share and vault.** Under host custody every auction runs
   its own DKG. Your share never leaves this host. The three group keys must agree; the operator's
   tooling then derives the escrow UFVK and imports the SAME one on every host so your own vault
   scan is independent of the coordinator.

   ```text
   $ benzo sign dkg --id AUCTION_ID --name SIGNER --server HOST:PORT [--peers PUBKEY,PUBKEY]
   $ benzo auction keys --id AUCTION_ID --group-keys KEY,KEY,KEY --ufvk FILE
   ```

   `sign dkg` prints the group public key and keeps the share under the state dir
   (`auctions/<id>/`). `auction keys` refuses disagreeing or reused group keys, and (run here with
   `--ufvk FILE`, the operator's UFVK) creates this host's own view-only vault. The manifest must
   pin that auction's `frost_group_key` and addresses of this vault — `benzo sign approve`/`sign
   build` refuse otherwise.

   **The operator-signer pin.** At provisioning you record the operator's manifest-signing key in
   `state/operator-signer.txt` (the launcher writes it). Every later approval refuses a manifest not
   signed by that pinned key, and the first manifest you see for an auction is pinned by hash: a
   different one is refused. A “cancelled” auction is one with **no result**, never a `state` field.

   **The approval ledger.** `sign approve` records `{batch, txid, expiry, sources}` (the txid is
   computed before signing). A deposit note already used in another candidate is approved again
   only when this host sees, on its own chain endpoint, that the earlier transaction never mined
   and is past expiry — so no source is ever paid twice across batches.

   ```text
   $ benzo sign approve --id AUCTION_ID --batch N --packet DIR --name SIGNER
   $ benzo sign build   --id AUCTION_ID --batch N --packet DIR --name SIGNER
   $ benzo sign join    --id ID [--batch N --candidate private.pczt --name SIGNER --randomizer HEX --sighash HEX]
   ```

   `sign build` derives each row's recipient from your own openings, envelope key and vault scan,
   creates and proves the candidate on your own vault, and returns only `{party, output_index}` to
   the coordinator. `sign join` answers the signing session only when the printed sighash matches
   your recorded approval. Change is only ever an internal vault address; a deposit or funding
   address is never change.

   **Claims.** A refund claim you attest comes from the owner's own signed request opened with your
   envelope key (`--claims FILE` alongside the pushed public dir):

   ```text
   $ benzo sign envelope-opens --id ID --name SIGNER --public DIR --witness-key FILE [--claims FILE]
   ```

7. **Cross-chain delivery (optional).** Generate your own cross-chain key on this host — the public
   part joins the escrow's pinned signer set, the private half never leaves this machine:

   ```text
   $ benzo xchain keygen --chain evm|solana --name SIGNER
   ```

   Your attestation runs with your OWN envelope key and cross-chain key over the pushed public dir
   (`--host-record`). You derive every leaf's opening and destination yourself: `--result` must
   equal the published `result.json`; `--dir` runs the full `benzo verify` checks and refuses on any
   `ERROR`; destinations come only from the winners' sealed envelopes. The output is your SIGNATURE
   record (attestation bytes, your signature, your derived payouts) and the only thing printed.

   ```text
   $ benzo xchain attest --host-record --chain evm|solana --auction HEX32 --result FILE --dir PUBLIC --envelope-key FILE --signer-key FILE --batch N --nonce N --expiry TS --escrow ADDR --rpc URL --out FILE --asset 0xADDR
   ```

   The coordinator collects two hosts' records over the IDENTICAL attestation bytes and submits the
   release; it never holds a signer key and never names a destination (`--signer-key` is refused on
   `release`). Two hosts that opened a different deliver cannot agree on the allocation root, so
   nothing is released. See `docs/AUDITS.md` for the signer procedure.

   ```text
   $ benzo xchain release --chain evm|solana --attestation FILE --attestation FILE --key CRANK.key --rpc URL [--only 0,2] [--submit-only] [--stipend WAD] [--announcer ADDR]
   $ benzo xchain status --chain evm|solana --auction HEX32 --rpc URL --escrow ADDR [--bundle FILE] [--result FILE]
   ```

   `status` with `--result` compares the published result's sha256 with the escrow's approved
   `resultHash` and exits 1 on mismatch.

8. **NU7 and `BNZ_LWD_SINGLE`.** Public testnet activated NU7 (consensus branch `0x77190AD9`) at
   height 4,465,026; the stack runs the pinned `tools/nu7` backport. While only one public
   lightwalletd endpoint serves NU7, run every live command with `BNZ_LWD_SINGLE=1` (testnet only).
   A batch staged under the old branch is unbroadcastable: its expiry passes and the worker re-plans
   it. `benzo-pczt` commands take `--network test|main` explicitly (the value comes from the signed
   manifest) and refuse without it.
