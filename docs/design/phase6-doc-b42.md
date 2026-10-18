# Gate DOC batch B42: operator custody commands, and guides with every handoff written down

Head design, 2026-10-18. After B40, the head did a paper walkthrough: each guide step was mapped to what the live harness does (`tools/repro/markets.ts` `run()`, `e2e/lib/hosts.ts`). The operator, signer and bidder guides still cannot be followed literally. In three places the harness does work that has no CLI command, and in several places a guide leaves out a file handoff, an input format or the order of steps. This batch adds the missing commands, moves the harness's host logic into the product (one copy, shared), and fixes the guides. Signing rules, manifest fields, clearing, settlement and verify do not change.

## Context: what host custody is in this deployment

In this testnet deployment the three signer hosts are OrbStack VMs `benzo-alice`, `benzo-bob` and `benzo-carol` on the operator's Mac. `benzo settle` already reaches them through `orb`/`orbctl` (`settle/cli.ts:127-182`); README honest limits line ~145 discloses that one operator provisions all three. The new commands use the same transport, with the same bounded `orb` calls (`e2e/lib/hosts.ts` `sh`: 2-minute timeout, 3 attempts, SIGKILL bound as in `settle/cli.ts`).

## Gaps found (each one is fixed below)

| # | Guide step | What the guide says | What actually happens |
|---|---|---|---|
| G1 | signer 1, operator 1.3 | "One X25519 keypair per auction" | The key is per signer and reused. `sign envelope-key` refuses when the key exists (`cli/commands/sign-envelope-key.ts:33`), and `witness keygen` likewise (`witness.ts:44`). There is no way to print an existing public half again |
| G2 | operator 1, signer 6 | "run `benzo sign dkg` on each" | The operator picks the id first. Stale frost sessions are closed. alice passes `--peers` with bob's and carol's contact pubkeys and the others do not. All three run concurrently against frostd at `host.orb.internal:<port>` (`hosts.ts` `dkgOnHosts`). Then come the operator's `auction keys` and each host's UFVK import (`vaults/<id>/ufvk.txt` pushed, `auction keys --ufvk`). None of this is written down |
| G3 | operator 5–6 | witness step 5 comes before freeze in step 6 | Certificates exist only after `freeze`. Each host needs the public dir pushed, and its `witness_cert` is merged into the operator's `auction.json` **by the harness editing JSON** (`hostWitnessCerts`). There is no command |
| G4 | operator 7, signer 3 | "write your envelope-opening report" | Each host syncs its vault, gets the public dir and `claims.json` pushed, and runs `sign envelope-opens --public --claims`. The harness then saves the report to `$BNZ_STATE_DIR/settle/<id>/envelope-opens-<name>.json` (`hostEnvelopeOpens`), where `settle/plan.ts:255` reads it. There is no command, and the path is not documented |
| G5 | operator 4, bidder 4 | `bid deposit --file deposit.json [--pay]` | Two different inputs. `--pay` takes the `bid seal` output (or `{bids:[…], reserve:{address, amount_zats}}`) and broadcasts. Without `--pay`, the input is the admission record `{txid, address, envelope_hex, envelope_ct_hex, owner_sig_hex}` (`cli/product.ts:282-310`). The bidder must send that to the operator. Undocumented |
| G6 | operator 1–4 | nothing | The **fee reserve** must be funded at `routing.fee_reserve_ua`: settlement fees come from it (`settle/plan.ts:66`). No guide says so or gives the amount |
| G7 | operator 3 | `--config private-operator.json` | `publish` and `bid deposit` require private files under `$BNZ_STATE_DIR` (`privatePath`, `product.ts:38`). The guide's example path is refused |
| G8 | signer 2–4 | nothing | A host must sync its own vault before `witness sign` and `envelope-opens` (`hosts.ts:89`) |

## New commands: noun `hosts` (operator side, OrbStack testnet deployment)

Move the logic of `e2e/lib/hosts.ts` into a product module (for example `cli/hosts.ts`) and make `e2e/lib/hosts.ts` re-export it. Then the harness and the product run the same code. **Behaviour must stay byte-for-byte the same for the harness.** Each command prints one JSON object and never prints key material.

1. `benzo hosts keys`: each host's envelope public key and witness public key, in signer order. A key is generated on its host if missing and reused if present, as `hostEnvelopeKeys`/`hostWitnessKeys` do. Prints `{envelope_keys:[3], witness_keys:[3]}`.
2. `benzo hosts dkg --id ID`: `dkgOnHosts`, i.e. the per-auction DKG on the three hosts, then the operator's `auction keys`, then the UFVK import on every host. Prints `{group_key, escrow_ua, keys}`. It refuses if `vaults/<id>` exists already, and keeps the harness's DKG lock (`tmp/markets-dkg.lock`) so it never collides with a harness run.
3. `benzo hosts witness --id ID [--names alice,bob]`: after `freeze`. It syncs each named host's vault, pushes the public dir, and runs `witness sign` there. Each host's certificate is merged through **one product function** that checks it (`checkCertificates`) before writing; this replaces the harness's raw JSON edit. Then it republishes. It refuses before freeze. Prints `{certificates, q_w}`.
4. `benzo hosts envelope-opens --id ID`: `hostEnvelopeOpens`, saving each report where `settle` reads it. Prints `{reports:[{name, ok_rows, not_ok_rows}]}`.
5. Signer side, for G1: `sign envelope-key --name N --show` and `witness keygen --name N --show` print the existing public half (refuse if none). Never replace a key.

## Guide changes

- **Operator guide.** Add step 0, "Before the first auction". It covers: frostd running (the exact command from `tools/repro/markets.ts:694`), the hosts provisioned (`deploy/signers/up.sh`), the bidder wallet, and `BNZ_LWD_SINGLE=1`. Step 1.0: `hosts dkg`. Step 1.3: `hosts keys`.
- After publish, add a **fund the fee reserve** step. Give the amount rule as the code applies it (read `settle/plan.ts` and the batch builder; state it as a formula over bids/batches, and also the value the harness uses, 60,000 zats for small runs). Give the exact `bid deposit --pay` input with `reserve`.
- Steps 4–6 in the true order: admit deposits → wait for 10 confirmations and `T_submit` → `freeze` → `hosts witness` → wait for R → `open` → `clear` → `hosts envelope-opens` → `settle`. Write the two `deposit.json` shapes (G5) with a filled example of each. State that private files go under `$BNZ_STATE_DIR` (G7), and fix the examples.
- **Signer guide.** The key is per signer and reused (`--show`, G1); the vault sync before witness/report (G8); in this deployment the operator runs these commands on your VM through `orb` (the `hosts` commands), and a signer on separate hardware would run the same `benzo` commands by hand. Update its stale commit/date line.
- **Bidder guide** step 4: after paying, send the operator the admission record (G5 shape), and say how to get each field from your `bid seal` output and your wallet's txid.
- Every command in the three guides must match its `--help`.

## Added after B39 merged (R93)

- **H10 plumbing in the guides.**
  - Operator step 1.7 becomes `benzo auction create --file unsigned-manifest.json --witness-set FILE --config PRIVATE-OPERATOR.json` (the `--config` file is under `$BNZ_STATE_DIR`, with `routing.seller_ua` filled in). That puts `seller_ua_commitment` into the signed manifest.
  - Add a seller step: before bidding opens, the seller runs `benzo seller check --manifest public-dir/manifest.json --ua <their address>`, which must exit 0.
  - Add `seller_ua_commitment` to the field table: it is set by `auction create --config`, never typed by hand.
- **The live harness wires it too.** `tools/repro/markets.ts` writes `operator.json` before `auction create` (line ~269). Pass `--config <that file>` to its `auction create` call, so every live run carries the commitment and exercises H10's bound path. Do the same in any other live driver that creates a uniform/vickrey/launch auction with a seller (list them in your status block). Offline-check it by running the scenario's manifest build without the network, or explain why that is not possible.

## Proof

- **Offline:** `npm run typecheck`, `check:structure`, `check:invariants`, `npm run e2e`.
- A repro `tools/repro/b42-hosts-cli.ts` that runs with `orb` replaced by a stub on PATH that records calls. It shows that each `hosts` command issues the same `orb`/`orbctl` call sequence as the old `e2e/lib/hosts.ts` functions, for the same inputs. It also shows `hosts witness` refusing a certificate whose signature is wrong and refusing before freeze, and `--show` printing the existing public key and refusing when none exists.
- **No live runs.** The head runs the live walkthrough on testnet.

## Rules

- Work only in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b42 -b b42-hosts-cli <HEAD>`.
- Offline only: no `.benzo/` of the main checkout, `.env`, real `orb`/OrbStack, testnet or wallets.
- `check:bundle` cannot pass in a worktree (R32): commit with `--no-verify`.
- No mid-line `//` after code in scripted edits. Plain English comments.
- Commits: one for the module move plus commands, one for the guides. Add a status block to `docs/STATUS-B.md`, and put Questions there if anything here is wrong.
