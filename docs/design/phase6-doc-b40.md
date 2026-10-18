# Gate DOC batch B40: an operator can create an auction with the CLI alone

Head design, 2026-10-18. Gate DOC asks that each guide be followed literally on a clean checkout. The head's walkthrough found that `docs/guide-operator.md` step 1 ("Prepare the unsigned manifest") cannot be followed: three inputs exist only inside the test harness (`tools/repro/markets.ts` `run()`, lines ~252–275). This batch adds the three missing read-only/operator commands and the templates, and rewrites step 1. No change to any manifest field, signature, clearing, settlement or verify rule.

## What is missing today (see `tools/repro/markets.ts` for how the harness does each)

1. **The witness set.** The harness signs `{version:1, auction_id, q_w:2, keys:[…]}` with `signRecord` (`manifest/schema.ts:155`) and the operator's manifest-signing key (`$BNZ_STATE_DIR/auction/manifest-signing.pem`), and the manifest pins `witnessSetHash(witnessSet)`. No CLI command does this.
2. **Deposit, fee-reserve and seller addresses.** The harness calls `fresh(vault)` = `settle/target/release/benzo-pczt address <state>/vaults/<id>/wallet --network <net>` once per address (`e2e/lib/zcash.ts` `generateAddress`). The first deposit address is the escrow UA from `auction keys`.
3. **Round R.** `R = 1 + ceil((release_unix - BNZ_DRAND_GENESIS) / 3)`. The guide never says how to compute it.

## New commands (one file each under `cli/commands/`, same style as the others, each with `help`)

1. `benzo witness set --id ID --q N --keys HEX,HEX,HEX [--key private.pem]`: builds and signs the witness-set record exactly as the harness does (same fields, same `signRecord`, the same default key as `auction sign`), writes it to `$BNZ_STATE_DIR/run/witness-set-<id>.json` (mode 0600 dir as today), and prints `{file, witness_set_hash}`. It refuses `q` outside `1..keys.length`, duplicate keys and malformed keys, with the same checks `auction create --witness-set` applies.
2. `benzo auction addresses --id ID --count N`: prints N fresh shielded addresses of the auction's own vault (the one `auction keys` created), using the same generator as the harness (`benzo-pczt address`). It refuses if the vault does not exist. Addresses are public deposit/escrow addresses (R78b class C), so printing them is allowed; it must call `markPublic`-equivalent registration if the evidence redactor needs it (read `e2e/lib/zcash.ts:42-48`).
3. `benzo drand round --at <ISO-8601 UTC>`: prints `{round, release_utc}` for the pinned quicknet (`manifest/schema.ts` `QUICKNET`), where `release_utc` is the exact instant of that round (genesis + 3 s × (R − 1)). No network.

## Templates

- `docs/examples/unsigned-manifest.json`: a complete uniform-auction manifest with placeholder values in angle brackets, matching exactly the object the harness passes to `auction create` (every field, in the same order). Add a short field table to the guide (name, meaning, where the value comes from).
- `docs/examples/private-operator.json`: `settlement` and `routing` as the harness writes them (`seller_ua`, `fee_reserve_ua`, `bidders[].deposit_ua`).

## Guide rewrite

Rewrite `docs/guide-operator.md` step 1 into numbered sub-steps a stranger can run in order: signer DKG (link to the signer guide) → `auction keys` → `auction addresses` → collect the three `envelope_keys` and witness keys from the signers → `witness set` → `drand round` → fill the template → `auction create --witness-set`. Keep the rest of the guide; fix any other command whose `--help` differs from the text. Update the commit/date line at the top.

## Proof (offline)

- `tools/repro/b40-operator-cli.ts`: in a scratch `BNZ_STATE_DIR` under `tmp/` (R43), with a fixture vault and fixture group keys (reuse what `e2e` or `tools/bench.ts` already uses for an offline auction), run the three commands and `auction create` → `auction sign` → `auction publish` using only CLI output, then `benzo verify`-level manifest checks pass. Show that the `witness_set_hash` and record bytes equal what the harness's code produces for the same inputs.
- `npm run typecheck`, `npm run check:structure`, `npm run e2e` (offline seal) pass.

## Rules

- Work in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b40 -b b40-operator-cli <HEAD>`; never edit the main checkout.
- Offline only: no main-checkout `.benzo/`, `.env`, OrbStack/`orb`, testnet, wallets or live Playwright runs.
- `check:bundle` cannot pass in a worktree (R32): commit with `--no-verify` and say so.
- Plain English comments; no mid-line `//` after code in scripted edits. One commit for the commands, one for templates + guide.
- Anything in this design that is wrong: write it under Questions in your `docs/STATUS-B.md` block; do not invent a different flow.
