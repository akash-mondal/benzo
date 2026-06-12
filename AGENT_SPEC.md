# Benzo — Build Spec (Agent Pickup)

**Benzo** is a private-by-default shielded-USDC payments protocol on Stellar (Soroban), delivered as a private
cross-border remittance corridor. Full design lives in **`BENZO.md`** (read it first — the *Canonical Invariants*
box and *Section 10* roadmap are authoritative). This file is the **operational spec**: environment, infra,
wallets, and build order. **Scope: backend / protocol only — no frontend.**

---

## ⚡ Quick start
1. Read `BENZO.md` (design) + this file (ops).
2. Load env: `set -a; . ./.env; set +a` — funded testnet keys, network, USDC issuer.
3. Container runtime is **OrbStack** (Docker-compatible) — use `docker` / `docker compose` as normal.
4. Install the ZK toolchain (missing by default — commands below).
5. Start at **M0**: prove one circuit on-chain on testnet, then M1→M5.

## Scope
Backend/protocol only: circuits, Soroban contracts, headless `@benzo/sdk`, self-hosted indexer, relayer wiring,
self-hosted SEP-24 corridor, tests. **No UI** — Section 3 of `BENZO.md` and the `app/` directory are deferred.
Contracts stay **auth-agnostic** (Ed25519 CLI key, no passkeys). Proving is **headless** (Node/CLI).
**Self-host Mercury + Anchor. No MoneyGram.**

## Hackathon context & deliverables
Built for **Stellar Hacks: Real-World ZK** (Stellar Development Foundation, on DoraHacks; single open innovation
track, $10,000 prize pool). Tags: Blockchain · ZK · Rust · Noir · RISC Zero · Soroban · Circom. Three eligibility
requirements — bake them into the build:
1. **Open-source repo** with a clear `README.md`. If anything is mocked (e.g. the simulated fiat leg), say so.
2. **A 2–3 min demo video** clearly showing the project working and what the ZK is doing.
3. **ZK is load-bearing** — it powers a real part of how it works (proofs verified in a Soroban contract), not just
   namechecked. Benzo satisfies this by construction: strip the proofs and there is no private payment.

## AI skills (install into the session first)
Give the agent Stellar context before building — it materially improves the code:
- Stellar dev skill (Claude Code): `/plugin marketplace add stellar/stellar-dev-skill` then `/plugin install stellar-dev@stellar-dev`
- OpenZeppelin skills (secure Soroban): `/plugin marketplace add OpenZeppelin/openzeppelin-skills` then `/plugin install openzeppelin-skills`
- Offline copies live in `reference/skills/`; feed `reference/docs/llms.txt` to the agent.

## Local reference material (downloaded — work offline)
Already on disk under `reference/` (gitignored, ~46 MB) — clone, study, and fork rather than just linking out.
**Treat `stellar-private-payments` as the primary starter code.**
```
reference/
├── skills/
│   ├── stellar-dev-skill/         # Soroban, SDKs, RPC, wallets, passkeys, security patterns
│   ├── openzeppelin-skills/       # secure Stellar contract development
│   ├── stellar-build/             # 42 skills: idea → mainnet → SCF grant
│   └── zk-proofs-SKILL.md         # verify Groth16 proofs (BLS12-381 / BN254 / Poseidon)
├── code/
│   ├── stellar-private-payments/  # ★ Nethermind Privacy Pools PoC — closest starter (Circom + Groth16 + ASP)
│   ├── soroban-examples/          # contains groth16_verifier (fork this verifier)
│   ├── soroban-p25-preview/       # jayz22 P25 preview examples (BN254 + Poseidon)
│   ├── rs-soroban-ultrahonk/      # Noir/UltraHonk verifier
│   ├── ultrahonk_soroban_contract/# UltraHonk Soroban contract pattern
│   └── stellar-risc0-verifier/    # RISC Zero (Groth16) verifier
└── docs/
    ├── zk-proofs-on-stellar.md            # offline copy of the ZK docs
    ├── privacy-on-stellar.md              # offline copy of the privacy-stack docs
    ├── protocol-25-26-xray-yardstick.md   # the CAPs that matter (BN254/Poseidon/TTL/SAC/freeze)
    └── llms.txt                           # machine-readable digest of the Stellar docs
```

## Environment (`.env`)
Present, gitignored, `chmod 600`. Load with `set -a; . ./.env; set +a`. Regenerate keys: `scripts/setup-keys.sh --force`.
- `STELLAR_NETWORK=testnet`, `SOROBAN_RPC_URL`, `HORIZON_URL`, `FRIENDBOT_URL`, `NETWORK_PASSPHRASE`
- `USDC_CODE=USDC`, `USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (real Circle testnet USDC), `USE_TEST_TOKEN=false`
- `DEPLOYER_*`, `RELAYER_*`, `ANCHOR_DISTRIBUTION_*`, `ANCHOR_SIGNING_*` (public + secret)
- `MERCURY_API_KEY=` (empty — self-hosting), `CIRCLE_API_KEY=`, `GITHUB_TOKEN=` (optional)

The CLI testnet network is registered (`stellar network ... testnet`) and the keys are saved as stellar identities:
`benzo-deployer`, `benzo-relayer`, `benzo-anchor-dist`, `benzo-anchor-sign` — use e.g. `--source benzo-deployer`.

## Wallets — XLM + USDC

| Identity | Address | XLM | USDC trustline | Role |
|---|---|---|---|---|
| **deployer** | `GBRMUZELYDNXSBYF5KOLLSV4XLQYNZJQNLXQ3HTFCWNRIBS3I6EUBCMP` | 10,000 | ✅ open | deploy contracts, pool admin, primary test account |
| relayer | `GD2U26BTLNEKRLM7AMXPO5T64I7SPRPUF26T44RHSJBLFI5YGRKLZMT7` | 10,000 | — | gasless fee payer |
| anchor-dist | `GCRKIL3YM4WCCWSXBZ7BTJEAZKFSIWTDNNZQ2HYBRNPFHMMBJBIJKRBQ` | 10,000 | ✅ open | SEP-24 anchor USDC custody |
| anchor-sign | `GAKHTWPVA7LFXKW4Y6VR4W36Z42FYEVZV2G7X454CF5ILEP6YRTNB2RF` | 10,000 | — | SEP-10 auth signer |

**➡️ Send testnet USDC to (deployer):** `GBRMUZELYDNXSBYF5KOLLSV4XLQYNZJQNLXQ3HTFCWNRIBS3I6EUBCMP`
Optionally also fund the corridor account (anchor-dist): `GCRKIL3YM4WCCWSXBZ7BTJEAZKFSIWTDNNZQ2HYBRNPFHMMBJBIJKRBQ`

- **XLM:** funded via Friendbot (transaction fees).
- **USDC:** real **Circle testnet USDC** (issuer `GBBD47…`). Trustlines are **already open**, so payments land. Get
  testnet USDC from `faucet.circle.com` and send to the deployer address above.
- **Agent fallback:** if the USDC balance is still `0` at M1, set `USE_TEST_TOKEN=true` and deploy a self-issued
  SAC test token minted from the deployer — the build proceeds with no external funding.

## Infrastructure (OrbStack / Docker)
OrbStack provides the Docker daemon; all `docker` / `docker compose` commands work unchanged.
- **Local network (e2e tests):** official `stellar/quickstart` image, or `stellar container start`.
- **Mercury indexer (self-host, no API key):** run the Zephyr/Mercury indexer in Docker; it scans commitments,
  on-chain note ciphertexts, and nullifiers and exposes a viewing-key scan API for the SDK.
- **Anchor Platform (self-host):** clone `stellar/anchor-platform`, run its docker compose; configure SEP-1/10/24
  with `ANCHOR_SIGNING_*` (TOML / web-auth signer) and `ANCHOR_DISTRIBUTION_*` (USDC distribution), and pin
  `assets.yaml` to `USDC_ISSUER`. The fiat leg is simulated by the reference anchor — disclose honestly in the README.
- **Relayer (self-host):** OpenZeppelin Relayer or a minimal channel-account submitter funded by `RELAYER_*`.

## Toolchain
Present: Stellar CLI 25, Rust/cargo, Node 20/pnpm, Docker (OrbStack), git, jq, python3, openssl.
Install at build:
```bash
npm i -g snarkjs
cargo install --locked circom          # or the circom2 release binary
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && noirup && bbup
```

## Build order (start at M0 — full detail in `BENZO.md` §10.3)
- **M0 — Foundation.** Scaffold the monorepo (§10.1), install ZK tools, write a trivial circuit (`a*b==c`), prove it
  headlessly, deploy a BN254 verifier, and **verify the proof on-chain on testnet.** Mirror the
  [Nethermind PoC](https://github.com/NethermindEth/stellar-private-payments) and the
  [Groth16 verifier example](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier).
- **M1 — Shielded core.** `shield` / `joinsplit` / `unshield` circuits + `pool`/`merkle`/`nullifier_set`, custody USDC.
  Exit: a dollar is shielded, privately transferred note→note, and unshielded by a different key.
- **M2 — Compliance.** MVK→TVK viewing keys + ASP membership / non-membership (proof-of-innocence).
- **M3 — Corridor.** Self-hosted Anchor Platform SEP-24 edges; fiat→shield→transfer→unshield→fiat.
- **M4 — Backend product surface.** Relayer wiring, self-hosted Mercury indexer, published headless `@benzo/sdk`.
- **M5 — Hardening.** Full test suite, trusted-setup ceremony, threat model, audit-readiness.

## Rules
- Never commit `.env` or any secret. Testnet keys only — never a mainnet key here.
- Keep Poseidon2 parameterization **byte-identical** between circuits and the host function (pin once).
- Nullifiers use **persistent** storage only.
- Write tests as you go (circuit negative tests, contract fuzz, e2e). This is a maintained protocol, not a demo.
- If you mock anything (e.g. the simulated fiat leg), say so in the README.

## Resources (full hackathon reference list)
★ = an offline copy lives under `reference/` (see "Local reference material" above).

**Start here — ZK & Privacy on Stellar**
- ZK Proofs (docs): https://developers.stellar.org/docs/build/apps/zk ★ `reference/docs/zk-proofs-on-stellar.md`
- Privacy on Stellar (docs): https://developers.stellar.org/docs/build/apps/privacy ★ `reference/docs/privacy-on-stellar.md`
- Announcing X-Ray (P25): https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25 ★ `reference/docs/protocol-25-26-xray-yardstick.md`
- Yardstick (P26) upgrade guide: https://stellar.org/blog/foundation-news/stellar-yardstick-protocol-26-upgrade-guide ★ (same file)

**AI development assistance**
- Stellar Skills https://skills.stellar.org/ · ZK Proofs skill https://skills.stellar.org/skills/zk-proofs/SKILL.md ★ `reference/skills/zk-proofs-SKILL.md`
- Stellar Dev Skill https://github.com/stellar/stellar-dev-skill ★ `reference/skills/stellar-dev-skill`
- stellar-build (42 skills) https://github.com/kaankacar/stellar-build ★ `reference/skills/stellar-build`
- OpenZeppelin Skills https://github.com/OpenZeppelin/openzeppelin-skills ★ `reference/skills/openzeppelin-skills`
- Building with AI https://developers.stellar.org/docs/build/building-with-ai · llms.txt https://developers.stellar.org/llms.txt ★ `reference/docs/llms.txt`

**On-chain ZK verifiers (starter code)**
- Stellar Private Payments (Privacy Pools PoC) ★ `reference/code/stellar-private-payments` — https://github.com/NethermindEth/stellar-private-payments · docs https://nethermindeth.github.io/stellar-private-payments/ *(prototype, unaudited)*
- Groth16 verifier (in soroban-examples) ★ `reference/code/soroban-examples` — https://github.com/stellar/soroban-examples/tree/main/groth16_verifier
- RISC Zero verifier ★ `reference/code/stellar-risc0-verifier` — https://github.com/NethermindEth/stellar-risc0-verifier · article https://stellar.org/blog/developers/risc-zero-verifier
- UltraHonk verifiers ★ `reference/code/rs-soroban-ultrahonk`, `reference/code/ultrahonk_soroban_contract` — https://github.com/yugocabrio/rs-soroban-ultrahonk · https://github.com/indextree/ultrahonk_soroban_contract
- P25 preview examples ★ `reference/code/soroban-p25-preview` — https://github.com/jayz22/soroban-examples/tree/p25-preview/p25-preview

**ZK circuit tooling**
- Noir https://noir-lang.org/docs/ · RISC Zero https://dev.risczero.com/ · Circom https://docs.circom.io/
- Soroban SDK BN254 https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_bn254/index.html · Poseidon https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_poseidon/index.html
- CAPs: BN254 CAP-0074 · Poseidon CAP-0075 · BLS12-381 CAP-0059 · (P26) BN254+ CAP-0080 · TTL CAP-0078 · SAC CAP-0073 · freeze CAP-0077
- Tutorials (Bachini): https://jamesbachini.com/circom-on-stellar/ · /noir-on-stellar/ · /stellar-risc-zero-games/

**Further privacy context**
- Confidential Token Association https://www.confidentialtoken.org/ (SDF, Nethermind, OpenZeppelin, Zama) · demo https://www.youtube.com/watch?v=6NnDqVQYOHM
- Privacy Pools whitepaper (Buterin et al.) https://privacypools.com/whitepaper.pdf

**Core Stellar dev tools**
- Docs https://developers.stellar.org/ · SDKs https://developers.stellar.org/docs/tools/sdks · CLI https://developers.stellar.org/docs/tools/cli · Lab https://developers.stellar.org/docs/tools/lab · Quickstart https://developers.stellar.org/docs/tools/quickstart · Scaffold Stellar https://scaffoldstellar.org · Wallets Kit https://stellarwalletskit.dev/ · OpenZeppelin on Stellar https://www.openzeppelin.com/networks/stellar

**Smart-contract building blocks**
- Getting Started https://developers.stellar.org/docs/build/smart-contracts/getting-started · Auth https://developers.stellar.org/docs/build/guides/auth · Storage https://developers.stellar.org/docs/build/guides/storage · Testing https://developers.stellar.org/docs/build/guides/testing

**Community & infra**
- Ecosystem Resources https://github.com/stellar/ecosystem-resources/ · Hackathon FAQ https://github.com/briwylde08/stellar-hackathon-faq · Ecosystem DB (find existing work first) https://github.com/lumenloop/stellar-ecosystem-db · Anchor Platform https://github.com/stellar/anchor-platform
