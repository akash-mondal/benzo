# Phase 6 private-repo hygiene (R36; written in B33 item 2, re-stated by B34 item 2)

Checklist with proof, run 2026-10-06 on `track-b`; line 4 re-run at `72204b2` (B34). Every check line below is
one command and its result in this checkout; FAILs found in B33 were fixed in its item-2 commits and the fix
is named. No secret values are printed anywhere in this file. **R36 (user instruction 2026-10-06, verbatim:
"no public"): the repository stays private and ships no open-source license** — so B33's LICENSE line is
dropped from this checklist (section 1 records the ruling state instead) and every secret, leak and
absolute-path check is kept.

## 1. Private repository, no license (R36) — ruling state, not a check

- `LICENSE` is deliberately absent (`ls LICENSE*` at the repo root is empty; the only tracked licenses are
  vendored `contracts/evm/lib/forge-std/LICENSE-{MIT,APACHE}`, `git ls-files | grep -i LICENSE`);
  B33's MIT `LICENSE` was removed by the head (`15209fc`). `package.json` carries `"license": "UNLICENSED"`
  next to `"private": true` (`node -e "console.log(require('./package.json').license, require('./package.json').private)`
  → `UNLICENSED true`). Never make the repo or any part of it public without the user.
- The B33 question about license choice and copyright holder is closed by R36. The B34 packaging refresh
  re-recorded the digests after `package.json` changed (`docs/reproducible-build.md`, `pk-*` evidence).

## 2. `.env.example` only; every variable documented; no real `.env` tracked — PASS (one comment fix)

- `git ls-files .env .env.example tools/pins.env` → `.env.example`, `tools/pins.env` only. The real `.env`
  exists on disk and is ignored (`git check-ignore .env` → `.env`; pattern `.env` + `.env.*` with `!.env.example`).
- Every variable is documented with its provider and required/optional marker (the file's own convention):
  `BNZ_NETWORK`, `BNZ_LWD_URL`, `BNZ_LWD_URL_ALT`, `BNZ_DRAND_URLS`, `BNZ_DRAND_CHAIN_HASH`,
  `BNZ_DRAND_PUBLIC_KEY`, `BNZ_DRAND_GENESIS`, `BNZ_DRAND_PERIOD`, `BNZ_COLLATERAL_ZATS`, `BNZ_STATE_DIR`,
  `BNZ_FROSTD_ADDR`, and the commented per-run switches `BNZ_LIVE`, `BNZ_EVIDENCE_DIR`, `SSL_CERT_FILE`,
  `NEAR_1CLICK_JWT`, `BNZ_ZEBRAD_RPC`. Nothing in the file is a secret (public chain constants only).
- Name-level diff of the real `.env` against `.env.example` (names only, values never printed):
  `diff <(grep -oE '^#? ?[A-Z_]+=' .env.example …) <(grep -oE '^[A-Z_]+=' .env …)` → no variable exists in
  `.env` that `.env.example` does not document (the only differences are the four commented switches).
- One hygiene fix (this batch): two absolute local paths in the file's setup comments
  (`… 20 GB free on /Users/akshmnd`, `cd "/Users/akshmnd/Dev Projects/benzo"`) replaced with
  `your home volume` / `"$HOME/Dev Projects/benzo"` — wording otherwise unchanged.

## 3. `.gitignore` covers `.benzo/`, `tmp/`, `vendor/nu7`, keys and wallets — PASS (one hardening block added)

- Present before: `.benzo/` (keys, UFVK, FROST key packages, wallet DBs, TLS CA, PCZTs), `tmp/`, `vendor/nu7/`,
  `*.sqlite` / `*.sqlite-*` (wallet databases), `.env` / `.env.*` with `!.env.example`, every `*/dist/` build
  output, `dist/*.tgz`, `dist/*.sha256`.
- Added (this batch) an explicit keys block so key material cannot land anywhere in the tree:
  `*.pem`, `*.key`, `*.agekey`, `*.mnemonic`, `ufvk.txt`.
- Proof: `git check-ignore .env .benzo tmp vendor/nu7 ufvk.txt test.pem` → all six ignored;
  `git ls-files -ci --exclude-standard` (tracked-but-ignored) → empty, so the new block hides nothing that is
  supposed to be committed; `git ls-files | grep -E '\.(pem|key|agekey)$|ufvk'` → empty (no key-shaped file has
  ever been tracked).

## 4. No secrets in history — PASS (re-run up to the current HEAD `72204b2`)

- Prior records (cite): leak audit over `7c235d6..5475c60`, 172 commits, full-blob history (`--git`) +
  working paths — 331 rows, every one classified A–G in `leak-audit.md`, record
  `leak-findings-2026-10-05.json`; then B33's re-run — 353 rows
  (`leak-findings-2026-10-06.json`), 22 new over `5475c60..1a4846f`, all classified (20 × class C public
  `leaves[].deposit.address` in the A14 buyback evidence; 2 × class G age-armor header/footer literals in
  the verify bundle).
- Re-run (B34, the run this file proves): the same tool with `--git` scans **every blob of every commit on
  every ref** (`git log --all` + `ls-tree`/`cat-file` in `tools/leak-audit.ts`), so this record covers the
  range **`7c235d6`..`72204b2` (the current HEAD at run time)** in full. Command (values suppressed
  throughout):

  ```sh
  npm run leak-audit -- --sensitive .benzo/leak-sensitive.json \
    --allowlist docs/evidence/phase-6/leak-allowlist.json \
    --paths docs/evidence $(find tmp -maxdepth 3 -type d -name "public*" | sort | tr '\n' ' ') --git
  ```

- Result: 379 rows (`docs/evidence/phase-6/leak-findings-2026-10-06-b34.json`, tool stdout unedited; rows
  carry rule/label/file/line-or-commit/sha256-of-value only). Compared row-for-row with the B33 record:
  **0 rows gone, 26 rows new**, every new row `rule: address`, every one classified:
  - 16 × class C (intended-public): `frozen.leaves[].deposit.address` / `leaves[].deposit.address` — the
    public escrow **deposit** addresses in the published A15 drop evidence
    `docs/evidence/phase-5/markets/drop-r33/drop-cold/{auction,frozen}.json` (committed `61b00bb`; each
    matched once as a working path and once per historical blob). The only matched field is
    `deposit.address`; no refund, delivery or payout destination is among them.
  - 10 × class G (code constant): address-shaped fixture literals in the Track A read-path harnesses
    `e2e/lib/readpath.ts` / `readpath-live.ts` / `readpath-r261.ts` — fixed shape-test UAs (`utest10c5k…`),
    the well-known all-zeros Sapling test address `ztestsapling1qqq…` (a public Zcash test vector), an
    `attacker` UA constant for a redirect negative test, and `utest1r261fixture…` placeholder strings that
    merely match the address pattern. Harness constants; no key material and no real party's destination.
- Verdict: no secret in any commit up to the current HEAD. Still owed (unchanged from run 31): the
  bid-plaintext `release_time` sensitive entries, and the gate-LA final pass over the final regression's
  output.

## 5. Pinned lockfiles — PASS

- Tracked lockfiles: `package-lock.json` (root), `settle/Cargo.lock`, `scan/Cargo.lock`,
  `contracts/solana/Cargo.lock`, `contracts/solana/test/proxy/Cargo.lock`, `contracts/evm/package-lock.json`;
  tool pins live in `tools/pins.env` (exact tags/revisions, checked by `tools/bootstrap.sh`/`versions.txt`).
- Exact versions everywhere: `node -e` over `{dependencies,devDependencies}` matching `/[\^~]|latest|git|branch/`
  → `unpinned: []`. `package-lock.json` is committed and `npm ci` installs from it (this session: clean install).
- `tools/nu7/lockdiff.py` refuses any lock change outside the patched sources' lines (R27/F8), so the NU7
  backport cannot silently unpin anything.

## 6. No absolute local paths (`/Users/…`) in shipped files outside evidence — 2 FIXED, 14 LISTED

`git grep -l '/Users/' -- ':!docs/evidence'` → 16 tracked files. Fixed the two in docs/tooling I own (this batch):

| File | Fix |
|---|---|
| `docs/STATUS-B.md` | `/Users/akshmnd/Dev Projects/` → `~/Dev Projects/` (14 occurrences: historical run records and quoted head prompts; wording otherwise unchanged) |
| `.env.example` | the two setup-comment paths (see line 2) |

Listed, not fixed (outside my lane or immutable record):

| File(s) | Why not fixed |
|---|---|
| `deploy/signers/up.sh` | the live deploy lane (OrbStack VM provisioning); this batch may not touch it |
| `contracts/logs/{f1-paid-pda-dust-fixed,f2-expiry-solana-fixed,f3-approval-dust-fixed,f3-approval-dust-old-code,g9-escrow-dust-old-code,layout-old-code,r14-cpi-fixed,step1-forge-test,step2-solana-tests}.out` | historical run logs of the contracts lane (9 files) |
| `docs/PHASE-5.md` | head-owned (Ruling text cites the reviewer report paths) |
| `docs/research/organizer-forensics.{jsonl,md}` | read-only research reference (nobody writes it) |
| `tools/repro/g-forged-claim.mjs` | Track A's file; its path is the `source:` provenance line the review record relies on — the head/Builder A should sanitize it (`/Users/akshmnd/Dev Projects/` → `~/Dev Projects/`) |

Note: 18 files under `docs/evidence/**` also contain `/Users/…`; the checklist line excludes evidence (it is the
immutable run record gate LA reviews). Nothing in `dist/`, `bin/`, `seal/dist`, `schemas/`, `api/` or any other
tracked non-evidence file contains one.
