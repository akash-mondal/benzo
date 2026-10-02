# Design: Phase 6, Track B offline items

Head-owned design (2026-10-02). These are the Phase 6 gates PK, LA and SC (offline half) from PHASE-6.md, which is still a DRAFT, but these three items don't depend on any open decision. Implement as written; disagreements go under Questions.

## 1. Fully offline verify + standalone bundle (gate PK)

**Problem.**
- `benzo verify` finds `tle` through `git rev-parse` (R21 item 7), so it fails outside a checkout.
- Online mode re-derives openings by fetching drand over the network.

**Design.**
- Tlock decryption only needs the round's BLS signature. Re-derive openings **with tlock-js** (already a pinned dependency) using a local chain client that serves the **published beacon** from `auction.json`, plus the pinned quicknet chain info: `QUICKNET` in `manifest/schema.ts`, i.e. public key, period, genesis and chain hash.
  - Verify the beacon's BLS signature against the quicknet public key first. Reuse the check from `clear/serials.ts`.
- New default: `benzo verify --dir --signer` re-derives **offline** from the published beacon.
  - `--fetch-beacon` fetches it from drand instead and requires it to match the published one.
  - `--tle` cross-checks every opening against the Go `tle` binary when one is on PATH.
  - `--offline` is kept as a deprecated alias of the default.
- No `git rev-parse` anywhere in the verify path.
- **Bundle:** `npm run build:verify` uses esbuild (pinned) to produce `dist/benzo-verify.mjs`, a single file with all JS dependencies inlined, runnable as `node benzo-verify.mjs --dir PUBLIC --signer HEX`.
  - Record its sha256 in `docs/verify-bundle.sha256`.
  - Prove it's reproducible: two clean builds give the same hash.
- **Proof:**
  - Copy the bundle and a cold public dir to `/tmp/x` (outside any git repo) and verify with the network disabled (`sandbox-exec`, or just offline). It must reach the same verdict as the in-repo verify on the Phase 2, Phase 3, Mode B and CF corpora.
  - A tampered beacon signature is refused.

## 2. Leak-audit tool (gate LA)

`tools/leak-audit.ts`, run as `npm run leak-audit -- --sensitive FILE --paths P1 P2 … [--git]`:
- **Inputs:**
  - the paths to scan (public dirs, `docs/evidence/**`, logs);
  - `--git`, which also scans every blob in `git log -p --all` of the current repo;
  - a **sensitive-values file** (JSON: `{label, value}` list) that **Track A generates** from live state: refund UAs, the UFVK, seeds, owner private keys, envelope plaintexts, and bid plaintexts with their release time.
  - Track B never reads `.benzo/`. Test with synthetic fixtures only.
- **Checks:**
  1. **Exact-value matches** of every sensitive value: plain, hex-encoded and base64-encoded.
  2. **Bid plaintext before its release:** a 128-byte plaintext hex appearing in a file whose git commit time, or mtime for untracked files, is before the auction's R time.
  3. **Generic patterns:**
     - testnet and mainnet unified/Sapling/transparent addresses outside an allowlist of files where they're expected (deposit addresses in receipts, for example);
     - `uview`/`zxview` viewing keys;
     - 24-word mnemonic-like word runs;
     - PEM private keys;
     - `.age` armor.
- **Output:** a JSON findings list `{rule, label, file, line|commit, sha256(value)}`. **Never print the sensitive value itself.** Exit 1 on any finding.
- **Proof:** a fixture tree with one planted instance per rule, each plain, hex and base64 where relevant, plus one planted in git history. All are found, and a clean tree exits 0.

## 3. Offline scale benchmark, 17,000 bids (gate SC offline)

`tools/bench.ts`, run as `npm run bench -- --bids 17000`:
- **Generate:** 17,000 sealed bids with **real tlock encryption** to a **past** quicknet round, so they can be decrypted now with the published beacon. Each gets real owner keys, real 512-byte envelopes, random prices and quantities within caps, and a deterministic seed for reproducibility.
- **Pipeline, timed per stage, with peak RSS:**
  1. admission (memo parse + envelope intake checks);
  2. freeze (Merkle root + witnesses);
  3. open (tlock-js decrypt);
  4. clear (Mode A uniform through the registry);
  5. settlement batch planning at the measured cap of 13 outputs per batch (`settle/plan.ts`, read-only import);
  6. `benzo verify` on the result.
- **Output:** a table with the time and peak RSS for each stage, plus the number of settlement batches and their estimated total fee at ZIP-317 rates. Write it to `docs/evidence/phase-6/bench.json` and a markdown table in STATUS-B.
- Also run 1,000 and 5,000 bids, to show how each stage scales.

## Order and commits
Do item 1, then 2, then 3, each with its own commit and logged proof in STATUS-B. Then set READY FOR MERGE. Add no tests. Track B files only, plus new `tools/` files and `package.json` scripts. No funds, no keys, no `.benzo/` reads.
