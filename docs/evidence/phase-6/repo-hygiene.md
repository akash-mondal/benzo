# Phase 6 public-repo hygiene (B33 item 2)

Checklist with proof, run 2026-10-06 on `track-b` (tree `1a4846f` + B33 item 1). Every line below is one command
and its result in this checkout; FAILs are fixed in this batch's item-2 commits and the fix is named. No secret
values are printed anywhere in this file.

## 1. LICENSE present and consistent with `package.json` — FAIL → FIXED

- Before: no `LICENSE*` at the repo root (`ls LICENSE*` empty; the only licenses tracked are vendored
  `contracts/evm/lib/forge-std/LICENSE-{MIT,APACHE}`), and `package.json` had no `"license"` field
  (`node -e "require('./package.json').license"` → `undefined`; `git log --all -- LICENSE` empty).
- Fix (this batch): `LICENSE` added (MIT, `Copyright (c) 2026 Akash Mondal` from the repo's git identity) and
  `package.json` gained `"license": "MIT"` (next to the run-28 `"version": "0.1.0"`; `"private": true` is
  unchanged — distribution is the `npm run package` tarball, not `npm publish`).
- Proof after: `node -e "console.log(require('./package.json').license)"` → `MIT`; `head -1 LICENSE` → `MIT License`.
- **Flagged under Questions:** the license *choice* (MIT) and the copyright holder are a judgment call, not a
  Ruling; the head or the user should confirm or replace before the public release. The shipped npm tarball
  (`tools/package.mjs`) does not include `LICENSE` yet — adding it changes the recorded digests
  (`pk-package.sha256`, `docs/reproducible-build.md`), so it waits for the next packaging refresh.

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

## 4. No secrets in history — PASS (re-run over everything since `5475c60`)

- Prior record (cite): leak audit over `7c235d6..5475c60`, 172 commits, full-blob history
  (`--git`) + working paths — 331 rows, every one classified A–G in `leak-audit.md`,
  record `leak-findings-2026-10-05.json`; no keys, mnemonics, UFVKs, envelope plaintext or bid plaintext
  before its release time.
- Re-run (this batch, the run this file proves): the same tool with `--git` scans **every blob of every commit**
  (`git log --all` + `ls-tree`/`cat-file`, `tools/leak-audit.ts:88`), so it subsumes the 38 commits in
  `5475c60..1a4846f` and everything after. Command (values suppressed throughout):

  ```sh
  npm run leak-audit -- --sensitive .benzo/leak-sensitive.json \
    --allowlist docs/evidence/phase-6/leak-allowlist.json \
    --paths docs/evidence $(find tmp -maxdepth 3 -type d -name "public*" | sort | tr '\n' ' ') --git
  ```

- Result: 353 rows (`docs/evidence/phase-6/leak-findings-2026-10-06.json`, tool stdout unedited; rows carry
  rule/label/file/line-or-commit/sha256-of-value only). Compared row-for-row with the run-31 record: **0 rows
  gone, 22 rows new**, every new row inside `5475c60..HEAD`:
  - 20 × `rule: address` — the public escrow deposit addresses `leaves[].deposit.address` in the published
    buyback evidence `docs/evidence/phase-5/markets/buyback/buyback-r{1,2}-cold/{auction,frozen}.json`
    (committed at `05f97b8`, the A14 recurring-buyback series). Intended-public class C (they appear in the
    published public-auction document by design; no refund or delivery address is among them — the only
    address-bearing fields matched are the deposit leaves).
  - 2 × `rule: age-armor` — one 87-character match, sha256 `e6930baf…`, in `dist/benzo-verify.mjs` at the two
    bundle rebuilds (`9634882`, `a1f9d90`). It is the age-armor codec's own **header/footer string literals**
    bundled into the verify bundle (`var header = "-----BEGIN AGE ENCRYPTED FILE-----" … "-----END AGE
    ENCRYPTED FILE-----"`, `encodeArmor`); a code constant, class G, not an encrypted payload.
- Verdict: no secret in any commit the public repo would ship. Still owed (unchanged from run 31): the
  bid-plaintext `release_time` sensitive entries, and the gate-LA final pass over the final regression's output.

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
