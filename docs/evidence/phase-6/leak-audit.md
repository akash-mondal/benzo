# Gate LA — leak audit (R26 run 27; re-run 2026-10-05 below — `leak-findings-2026-10-05.json`)

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
| 3 (re-run over everything since run 2) | `5475c60` | 560 first pass / **331 final** | 1 | `leak-findings-2026-10-05.json` |

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

---

## Re-run (run 31 item 2, gate LA, 2026-10-05) — range `7c235d6` → `5475c60`

172 commits since the run-2 HEAD (including the merged main history). The tree advanced to `617c9f2`
(R32) after the run; its two files (`docs/PHASE-6.md`, `e2e/lib/frost.ts`) carry no addresses or key
material. Surfaces: `docs/evidence/**` — now covering `phase-5/markets/`, `phase-5/repro/` incl. the
B30 evidence (`host-attest-demo`, xchain demos, `g7-*`), `phase-6/scale/`, `phase-6/mutations/`,
`phase-6/repro/` — plus the `tmp/**/public*` dirs (same `find` recipe) and `--git` full-blob history.
The tool scans complete blobs of `git log --all`, which **subsumes `git log -p` since `7c235d6`**:
every added line lives in a blob, and every removed line remains in its old blob (classed at run 2).
Known limit (unchanged): pattern rules see plaintext only; the signed packets' base64 interiors are
covered only through the exact-value variants of the sensitive list.

Command (the run-2 recipe; only the allowlist grew):

```
npm run leak-audit -- --sensitive .benzo/leak-sensitive.json \
  --allowlist docs/evidence/phase-6/leak-allowlist.json \
  --paths docs/evidence $(find tmp -maxdepth 3 -type d -name "public*" | sort | tr '\n' ' ') --git
```

### Sensitive values this run (never printed; `.benzo/leak-sensitive.json`, mode 0600) — 106 entries

The run-2 52 entries kept byte-for-byte (labels stable); **54 appended** from this checkout's own
`.benzo/` only (builder scratch in `tmp/`; values were written solely to the 0600 file):

| Class | Entries | Source |
|---|---|---|
| deployer keys | 4 (unchanged) | `.benzo/evm/deployer.key`, `.benzo/solana/deployer.json` |
| envelope keys | 10 (unchanged) + 3 new `xchain-hosts/*/signers/*/envelope-key.json` private halves (+ raw `xchain-{live,local}` key-file forms re-added by value) | `.benzo/signers/`, `.benzo/xchain-*/` |
| chain/witness/TLS/program keys — **new** (run 2's narrow scope left these out; gate LA says "no keys") | 13 `xchain-hosts/*/xchain/*`, 12 `xchain-live/` + `xchain-local/` EVM/Solana keys, 3 `witness-fix/w*.key`, 2 TLS keys, 2 Solana program keypairs (JSON + base64 secret), 1 manifest-signing PEM | the named files under `.benzo/` |
| test UAs | 38 (unchanged) + `test-ua-extra-*` for any UA recorded since | anywhere under `.benzo/` |

Pattern rules (unchanged): Zcash addresses, viewing keys/UFVKs, 24-word mnemonics, PEM private keys,
age-armor blocks. **Still owed (same as run 2):** bid-plaintext-before-release (`release_time`) entries.

### Allowlist: 28 → 62 exact paths (+34 reviewed, suppress only the `address` rule)

Per-bid **deposit** addresses in published auction documents — `frozen.leaves[].deposit.address`,
`receipt.inclusion.deposit.address`, `manifest` projections — in the new evidence sets
(`phase-5/buyback-run{3,4}/cold/`, `phase-5/live-regression-*/cli/`, `phase-5/markets/{drop,launch,otc,revision,rfq}/*-cold/`,
`phase-5/markets/receipts/inclusion-proof.json`, `phase-5/y2*/cold/`): intended-public by design (they
are in the signed manifest and the frozen leaves every bidder reads), same rationale as run 2's
entries. The drop-mode `balance_addresses[].ua` values (in `markets/drop/drop-cold/auction.json`) are
the **operator's own fresh vault receive addresses**, published by design (`clear/features.ts`: the
operator publishes one fresh vault address per bonded winner and the winner pays `balance_due_zats`
there) — neither refund nor delivery addresses. Plus three fixture sources: `crosschain/host-attest-demo.mjs`
and `tools/repro/xchain-demos.ts` (the official zcash-address **test-vector** UA) and
`tools/repro/r26-1-deposit-party-repro.mjs` (fabricated `utest1r261fixture…` UAs).

### New-context review — every one of the 303 pre-allowlist rows disposed

First pass at `5475c60` (before the allowlist additions): **560 rows**; 257 inherit a run-2
disposition (matched on rule + file + value `sha256`; 11 run-2 rows no longer reproduce — that run's
scratch `tmp/` dirs are gone). The 303 to-review rows:

| Group | Rows | Disposition |
|---|---|---|
| `address` in the new evidence/fixture files named above | 229 | intended-public deposit / balance / fixture / test-vector addresses → allowlist |
| `address` in `tmp/**/public*` scratch dirs | 32 | class F (gitignored scratch, fixture manifests) — re-reviewed, never allowlisted |
| `exact-value` = the publicly known **anvil dev account 0** private key, hardcoded as `ANVIL_SK` in `crosschain/{local-demo,stealth-demo,host-attest-demo}.mjs` + `tools/repro/xchain-demos.ts` (the same value persists to `.benzo/xchain-local/evm-seller.key` for the local anvil demos) | 42 | **class G, disclosed, not a leak**: Foundry's documented public test key (the sources label it "anvil dev account 0 (public)"), used only as local-fixture custody — never a live, funded or production key. Not suppressible (the allowlist covers only the `address` rule), so the rows stay in the record |

### Final run (331 rows) — every finding classified

| # | Class | Rows | Disposition |
|---|---|---|---|
| A | Superseded `--git` blobs of `docs/STATUS-B.md` (earlier revisions quoted addresses/UAs) | 148 | fixed at source in run 2; history immutable (no rewrite), superseded blobs keep matching |
| B | `age-armor` regex self-matches (`tools/leak-audit.ts`, `dist/benzo-verify.mjs`; zero matches carry a base64 payload) | 35 | not a leak; +13 vs run 2 are the same literals re-keyed under the rebuilt bundle's blob (`973feac`) |
| C | Immutable historical evidence carrying real refund/delivery addresses (pre-T2/recipient rules) | 45 | disclosed at run 2, never edited; **no new rows since run 2** |
| D | `docs/STATUS.md` (Track A's status file) | 3 | not mine to edit; referred to the head at run 2 |
| E | `docs/research/organizer-forensics.{md,jsonl}` | 2 | read-only research on an external project's public chain data |
| F | Scratch `tmp/**/public*` dirs | 56 | gitignored scratch; re-reviewed at each run |
| G | the anvil dev key 0 fixture constant (new, see above) | 42 | disclosed fixture; not custody |

### Gate-LA verdict on this range

- **Keys, mnemonics, UFVKs, PEM/age private key material:** none in any scanned surface or blob
  beyond class G (a publicly documented fixture constant): zero `exact-value` hits for the 106
  sensitive values in `docs/evidence/**`, no `pem-private-key`, `viewing-key` or `mnemonic` findings,
  and no real `age-armor` block anywhere.
- **Bid plaintext before R:** still not covered by the sensitive list (owed above).
- **Refund/delivery addresses:** none in any shipped or evidence surface of this range; residue is
  class C (immutable, disclosed) and class A superseded blobs only.
- **Envelope plaintext:** none.

**No real finding in this range.** Nothing under Questions.

---

## RG final pass (gate LA, batch B37, 2026-10-16) — record `leak-findings-rg.json`

The phase6-rg §4.2 closing pass: `tools/leak-audit.ts` over `docs/evidence/phase-6/rg/` (all six
projects), every evidence file added since the B34 pass (record `leak-findings-2026-10-06-b34.json`
at `72204b2`), and `git log -p 5475c60..HEAD`. Run at `4991761`, clean tree, 2026-10-16T13:2xZ.
Record: `leak-findings-rg.json` (tool stdout unedited, **798 rows**, exit 1).

Command (the run-2/31 recipe, unchanged):

```
npm run leak-audit -- --sensitive .benzo/leak-sensitive.json \
  --allowlist docs/evidence/phase-6/leak-allowlist.json \
  --paths docs/evidence $(find tmp -maxdepth 3 -type d -name "public*" | sort | tr '\n' ' ') --git
```

Surfaces, as the batch names them:

1. `docs/evidence/phase-6/rg/` — scanned as working files and as blobs (six projects; the per-file
   result is below). `run.json`, `memo/*`, `manifest.json`, `opened.json`, `receipts.json`,
   `result.json`, `signer.json`, `signatures.json`, `summary.json`, `vickrey.json`, `beacon.json`,
   `cancelled.json`, `clear-reference.json`, `drill.json`, `bad-amounts.json`, `cancel-manifest.json`,
   `frost/{coordinator.txt,refund.json,settle.json}`, `settle/cancel/*`, `settle/main/{balances,crash,
   manifest,result,routing-commitment,summary}.json` — **zero rows**.
2. Every evidence file added since the last pass (368 added/modified paths under `docs/evidence`
   since `72204b2`), including the four named repro outputs `repro/{r48-stall,r49-pins,r61-void,
   r70-folds}.out` — **zero rows on all four** and on all of `phase-6/repro/`, `phase-5/mutations/`,
   `phase-5/repro/`, `phase-5/xchain-live/`: the abbreviation rules (T2/recipient) held in every
   evidence run since B34 except the four files reported under Questions.
3. `git log -p 5475c60..HEAD` — **subsumed** by `--git`, which scans complete blobs of every commit
   on every ref: every added line lives in a blob and every removed line in its old blob (classed at
   runs 2/31/B33/B34).

Sensitive values: the run-31 list, **106 entries, unchanged**. This batch forbids reading anything
under `.benzo/` beyond the tool's own 0600 sensitive file, so the `test-ua-extra-*` refresh of runs
2/31 was **not** re-run; only two state files changed since the list was built (`.benzo/bidder/
{blockmeta,data}.sqlite`, names inspected only), and any address they carry is still caught by the
`address` pattern. A raw key not in the list would not be caught by `exact-value` — stated limit,
same category as the owed `release_time` entries below. Allowlist unchanged at 62 reviewed paths.

### Accounting: 798 rows = 379 inherited + 419 new (0 rows gone since B34)

The 379 inherited rows are byte-identical to the B34 record (rule + label + file + line/commit +
value digest); their B33/B34/run-31/run-2 dispositions stand unchanged (classes A–G below).

New rows (419) — every one classified:

| Class | Rows | What |
|---|---|---|
| C — intended-public per-bid **deposit** addresses in published evidence | 346 | `leaves[].deposit.address` / `frozen.leaves[].deposit.address` / `notes[].address` / `deposits[].address` / `receipt.inclusion.deposit.address` in `phase-5/markets/drop-a{17,18,19,20,22,23,24}/drop-cold/`, `phase-5/markets/launch-a18/launch-cold/`, `phase-6/markets/launch-r34/launch-cold/`, `rg/auction-core/auction/{clear-input,frozen,deposits,refund}.json`, `rg/cli-auction/cli/{auction,frozen,api}.json`, `rg/settle-crash/settle/main/frozen.json`, and the per-bid deposit addresses of `rg/testnet-golden-path/scan/{addresses.json,operator-view.jsonl}` (`{bid,address}`, the scanned deposit notes) — same rationale as runs 2/31/B33/B34: they are in the signed manifest every bidder reads |
| **REAL — full refund/delivery destinations in committed files (reported under Questions, not fixed)** | 31 | the four files below |
| B — `age-armor` regex self-matches | 16 | `dist/benzo-verify.mjs`, one per new bundle blob since B34 (53 historical bundle versions checked in total): every match is the codec's marker-literal pair (87-char span, `var footer = "-----END AGE…`), **zero base64 payloads** |
| G — fixture literals, re-keyed under new blobs | 26 | `e2e/lib/readpath{,-live}.ts` shape-test UAs / all-zeros Sapling vector / `attacker` UA (22 rows) and `tools/repro/xchain-demos.ts` anvil dev account 0 (4 `exact-value` rows) — **all 26 value digests already present in the B34 record** (the files changed; the literals did not) |

### The real findings (4 files, 31 rows; full destinations, per this batch's rule — head decides)

| file:line (HEAD) | Type | Rows / distinct values | Also in history |
|---|---|---|---|
| `docs/evidence/phase-6/rg/testnet-golden-path/frost/pczt-inspect.txt:5` (and `:17`) | full output destination of the FROST-signed refund/payout PCZT (`Output: 990000 zatoshis to <UA>`) | 9 rows / 7 values | 7 superseded revisions of the file (the RG re-runs) |
| `docs/evidence/phase-6/rg/auction-core/auction/pczt-inspect.txt:4` | full output destination of the claim/refund PCZT (`Output: 2500000 zatoshis to <UA>`) | 7 rows / 6 values | 6 superseded revisions |
| `docs/evidence/phase-6/rg/auction-core/auction/cancel.json:1` (`response.refunds[].address`) | full cancel refund addresses | 7 rows / 6 values | 6 superseded revisions |
| `docs/evidence/phase-5/markets/drop-a20/recovery.out:13–16` | 4 full refund destinations ("the refunds landed at each bid's own envelope destination") | 8 rows / 4 values | 1 superseded revision (`3f4f44f`) |

Shape-wise these are the historical class-C material (real refund/delivery destinations, as
`phase-1/frost/pczt-inspect.txt` etc. at run 2); unlike that residue they are **new** evidence,
committed after B34. Per this batch's rule they are reported under Questions with `file:line` and
**not fixed**. The values themselves are not printed here or in any output of this pass.

### Gate-LA verdict on this range

- **Keys, mnemonics, UFVKs, PEM/age private key material:** none anywhere — zero `viewing-key`,
  `mnemonic` or `pem-private-key` rows in the whole run; the only `exact-value` rows are the
  publicly documented anvil dev-account-0 fixture constant (class G, re-keyed), and no sensitive
  value of the 106 matched any evidence or blob outside that fixture.
- **Refund/delivery addresses:** the 31 real rows above — otherwise none; residue classes A
  (superseded `docs/STATUS-B.md` blobs), C (immutable pre-T2 evidence), D (`docs/STATUS.md`), E
  (research), F (tmp scratch) unchanged from the B34 record.
- **Bid plaintext before R:** still not covered (the owed `release_time` entries).
- **Envelope plaintext:** none.

A literally zero-findings `--git` run remains unreachable without rewriting history or editing
committed evidence; the residue is the classified remainder plus the four reported files.
