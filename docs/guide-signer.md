# Signer guide

Runbook for one Benzo signer (alice, bob or carol) on its own host. Commands checked against
`bin/benzo --help` and each command's `--help` at commit `e28669b`, 2026-10-03. Testnet only. Every
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

6. **Cross-chain delivery (optional).** Attest only from your own openings. `--result` must equal
   the published `result.json`; `--dir` runs the full `benzo verify` checks and refuses on any
   `ERROR`; destinations come from the winners' sealed envelopes and a leaf is attested only when
   at least two `--envelope-key` signers agree on `SHA-256(deliver)`. `--asset` is required and must
   match the escrow's asset on chain.

   ```text
   $ benzo xchain attest --chain evm|solana --auction HEX32 --result FILE --dir PUBLIC --envelope-key FILE [--envelope-key FILE ...] --batch N --nonce N --expiry TS --signer-key FILE [--signer-key FILE ...] --escrow ADDR --rpc URL --out FILE --asset 0xADDR
   $ benzo xchain release --chain evm|solana --bundle FILE --key FILE --rpc URL [--only 0,2] [--submit-only] [--stipend WAD] [--announcer ADDR]
   $ benzo xchain status --chain evm|solana --auction HEX32 --rpc URL --escrow ADDR [--bundle FILE] [--result FILE]
   ```

   `status` with `--result` compares the published result's sha256 with the escrow's approved
   `resultHash` and exits 1 on mismatch. The signer procedure is also recorded in `docs/AUDITS.md`.
