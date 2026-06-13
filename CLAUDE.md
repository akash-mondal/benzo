# Benzo — Claude Code project guide

Benzo is a private-by-default shielded-USDC payments protocol on Stellar
(Soroban). This file is the working guide for Claude Code sessions; **`README.md`
is the single source of truth** for architecture, layout, invariants, and status.

## Scope
Backend / protocol (no frontend yet). **Testnet only; sandbox.** The corridor
runs with zero external accounts (Mock KYC/screening/on-ramp, self-hosted
anchor). Commercial edges (Stripe live, MoneyGram, Range, Human ID, CCTP
mainnet, Dynamic login) are real but **env-keyed and labeled FUTURE** — never
assume an account/partnership exists. ZK is proven two ways on-chain: Track A
(Groth16/BN254 native host fns) and Track B (Noir→UltraHonk).

## Environment
Load once per shell: `set -a; . ./.env; set +a` → funded testnet keys, network,
USDC issuer. Identities already saved: `benzo-deployer`, `benzo-relayer`,
`benzo-anchor-dist`, `benzo-anchor-sign`. Deploy with
`--source benzo-deployer --network testnet`.

## Commands
- Contracts: `cargo test --workspace` · `cargo clippy --workspace --all-targets -- -D warnings` · `stellar contract build`
- Packages: `pnpm install` · `pnpm -r build` · `pnpm -r test`
- Track B (pinned): `nargo 1.0.0-beta.9` + `bb v0.87.0` (keccak oracle); harness in `reference/code/rs-soroban-ultrahonk`
- On-chain: `stellar contract invoke …` — always print the tx hash + an
  `https://stellar.expert/explorer/testnet/tx/<hash>` link into the conversation.

## Hard rules
- Never commit `.env` or use a mainnet key (`.env` and `reference/` are gitignored — keep it that way; never stage `*.zkey`/`*.ptau`).
- Poseidon2 parameterization **byte-identical** across circuit ↔ TS mirror ↔ host function (pinned + asserted in tests).
- Nullifiers in **persistent** storage only; field-element encoding fails loud (never silently truncate).
- Write tests as you go; if you mock anything (e.g. the fiat leg), say so in the README.
- Keep one clean README — don't reintroduce scattered docs.
