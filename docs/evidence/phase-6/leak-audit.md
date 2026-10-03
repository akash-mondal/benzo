# Gate LA — leak audit (R26 run 27)

`npm run leak-audit` (the Phase 6 Track B leak-audit tool, `tools/leak-audit.ts`) over
`docs/evidence/**`, the readable public directories left under `tmp/` by runs (see note), and the
`--git` blob history, with a sensitive-values file built only from Builder B's own `$BNZ_STATE_DIR`.
Commit at run time: `7c235d6` (final run) / `cb92118` (first run). Findings carry only rule, label,
file, line/commit and `sha256(value)` — never the values themselves. Runs executed with HEAD at `7c235d6` and the source
fixes + allowlist as working-tree changes (committed after the runs, no scanned file changed
between run 2 and the commit except the two tooling files noted under Fixes).

Command (one-command repro; the `find` lists the public dirs a run leaves under `tmp/`):

```
npm run leak-audit -- --sensitive .benzo/leak-sensitive.json \
  --allowlist docs/evidence/phase-6/leak-allowlist.json \
  --paths docs/evidence $(find tmp -maxdepth 3 -type d -name "public*" | sort | tr '\n' ' ') --git
```

Note on surfaces: `tmp/e2e/public` does not exist at run time (the live-run public dirs from earlier
runs are gone from `tmp/`); the scan covers the public directories runs left elsewhere under `tmp/`
(`tmp/{api-probe,cold,cold-p3,repro-r26-3,stealth-demo,stealth-live,xchain-demo}/public*`), which are
the readable public dirs of this checkout. `--git` uses `git log --all`, so it covers track-b **and**
the merged main history — every blob the public repo would ship.

## Sensitive values (never printed; file lives at `.benzo/leak-sensitive.json`, mode 0600)

Built only from `.benzo/` (Builder B's state): **52 entries** —

| Class | Entries | Source |
|---|---|---|
| deployer keys | 4 (EVM deployer key, `0x` and bare hex; Solana deployer keypair, JSON and base64) | `.benzo/evm/deployer.key`, `.benzo/solana/deployer.json` |
| envelope keys | 10 private keys (3 signer-side `signers/*/envelope-key.json`, 3 `xchain-live/envelope-key-*.key`, 4 `xchain-local/envelope-key-*.key`) | `.benzo/signers/`, `.benzo/xchain-live/`, `.benzo/xchain-local/` |
| test UAs | 38 (every `utest1…` string recorded anywhere under `.benzo/`, excluding `cargo-target/`) | `.benzo/product/`, `.benzo/settle/`, `.benzo/*-wallet/`, … |

Pattern rules additionally cover every Zcash address, viewing key/UFVK, 24-word mnemonic, PEM private
key and age-armor block in the scanned files, independent of the list. **Not covered, owed as a
follow-up (Questions):** bid-plaintext-before-release entries (the tool's `release_time` form, 128-byte
plaintext hex) — the specified scope named only deployer keys, envelope keys and test UAs.

## Runs

| Run | Commit | Findings | Exit | Record |
|---|---|---|---|---|
| 1 (before fixes) | `cb92118` | 878 | 1 | `leak-findings-run1.json` |
| 2 (after fixes + allowlist) | `7c235d6` | 268 | 1 | `leak-findings-final.json` |

## Fixes at their source (this run; evidence was never edited)

| Source | Finding | Fix |
|---|---|---|
| `tools/repro/routing-vs-envelope-repro.mjs` | printed the product routing's real `refund_ua` and the envelope-derived destination (they landed in `f3-before/after.out`, `5M2.out`) | prints abbreviate (`utest1…xxxx`); assertions keep the full values. Re-run green after the fix (exit 0, `F3 FIXED`); the same re-run also caught a stale error-wording assertion (the rule's message changed to `stray_refund_ua is dropped…`), now matched alongside the old wording — harness staleness, not a product regression (`settle init` refused correctly in both runs) |
| `tools/repro/r7-1-ledger-redirect-repro.mjs` | printed the decrypted destination and the paid attacker UA | same |
| `tools/repro/r7-4-claim-refund-repro.mjs` | printed the owner-named claim destination twice (`r7-4-live.out`) | same |
| `tools/repro/r16-1-cancel-claims-repro.mjs` | printed the plan's `destinations` map (`r16-1-after.out`) | same |
| `docs/STATUS-B.md` | quoted 2 full wallet UAs (vault + bidder) | abbreviated, with a pointer to the wallet |

(`r7-6-live.out`'s "stray claim destination" line was transcribed by hand from a run capture, not
printed by a committed script; future transcriptions abbreviate.)

## Allowlist (`leak-allowlist.json`, 28 exact paths; suppresses only the broad `address` rule)

Reviewed as **intended-public addresses**: the official `zcash_address` test vectors
(`tools/repro/fixtures/zcash-address-cases.json`, and the `R24-3i-*.out` mutation outputs quoting
them); per-bid **deposit** addresses in published manifests and their evidence
(`phase-1/scan/*`, `phase-2/auction/{deposits,frozen,clear-input,refund}.json`,
`phase-3/settle/main/frozen.json`, `phase-4/cli/{auction,frozen,api}.json`, the phase-1 `M5–M7`
mutation diffs); and fabricated fixture constants in repro/cross-chain source (`crosschain/*.mjs`
shared fixture UA, `tools/repro/{mr-envelope,r16-memo-bound,kc-key-commitment,g1-*,g2-*,r7-1-*,r5-fund-quote,routing-vs-envelope}.mjs`
fixture UAs / the public test vector). Deposit addresses are public by design (they are in the signed
manifest every bidder reads); none of these files carries a key or a refund/delivery destination.

## Final run: every remaining finding classified (268)

| # | Class | Rows | Disposition |
|---|---|---|---|
| A | Superseded `--git` blobs of `docs/STATUS-B.md` (its earlier revisions quoted addresses/UAs) | 148 | fixed at source this run; history is immutable (no rewrite — git rules), so superseded blobs keep matching |
| B | Pattern false positives: the `age-armor` regex matching its own literal marker strings in `tools/leak-audit.ts` and the bundled `dist/benzo-verify.mjs` (verified: zero matches contain a base64 payload; there is no age-armor blob in any scanned surface) | 22 | not a leak; unfixable without breaking the pattern |
| C | **Immutable historical evidence carrying real refund/delivery addresses** (the gate-LA class, predating T2/recipient rules) | 45 | disclosed here; never edited after the fact. Files: `phase-1/frost/pczt-inspect.txt` (3, the FROST refund output), `phase-2/auction/{cancel.json,pczt-inspect.txt}` (2+2, the cancel refund address + PCZT refund output), `phase-5/mutations/5M2.out` (8), `phase-5/repro/{r7-4-live.out,f3-after.out,f3-before.out,r7-1-before.out,r7-1-after.out,r7-6-live.out,r16-1-after.out}` (8+6+6+4+2+2+2, refund/delivery/claim destinations printed by the repros fixed above) |
| D | `docs/STATUS.md` (Track A's status file) | 3 | not mine to edit; referred to the head under Questions |
| E | `docs/research/organizer-forensics.{md,jsonl}` | 2 | read-only research on an external project's public chain data; not our values |
| F | Scratch `tmp/**/public*` dirs (copies of the reviewed classes: fixture manifests' deposit addresses, fabricated fixture UAs) | 48 | gitignored scratch; re-reviewed at each run |

## Gate-LA verdict on the questions the gate asks

- **Keys, mnemonics, UFVKs, PEM/age private key material:** none in any scanned surface or git blob —
  zero `exact-value`, `pem-private-key`, `viewing-key`, `mnemonic` or real `age-armor` findings against
  the 52 sensitive values or the patterns.
- **Bid plaintext before R:** not covered by this run's sensitive file (owed follow-up above).
- **Refund/delivery addresses:** none in the current working tree of any shipped or evidence surface
  after the source fixes; the residue is the immutable historical evidence in class C (disclosed,
  never edited) and superseded git blobs (class A).
- **Envelope plaintext:** none.

A literally zero-findings `--git` run is unreachable without rewriting git history (forbidden) or
editing committed evidence (forbidden); the residue above is the honest remainder of both rules.
