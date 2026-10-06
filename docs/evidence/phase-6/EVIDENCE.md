# Phase 6 evidence index (Builder B, run 31 item 3 — gates DOC/RG prep)

Written 2026-10-05 from **committed evidence files only**; a field with no committed source says
"not recorded". Nothing here is re-run, re-measured or extrapolated. Each row names the file it was
read from. Statuses never claim more than the evidence shows. **Updated 2026-10-05 (run 32):** the
PK and DOC rows refreshed from run-32's committed evidence (`pk-bidder.out`, `pk-rebuild.out`,
regenerated `pk-package.*`, `repro/api-reference.out`, `mutations/B32-a.*`, `docs/api-reference.md`,
`docs/reproducible-build.md`); still-missing items stay marked OPEN. **Updated 2026-10-06 (run 33):** the PK
row's npm-package digest was regenerated after the README/LICENSE refresh (`pk-package.out`,
`pk-package.sha256`, `pk-package-verify.out` rewritten; `f123cdde…`, 18,321 entries — run-32's
`7f3e08ae…` is in git history) and `docs/reproducible-build.md`'s digest table re-recorded (verify
bundle `effd9853…`, the run-33 rebuild of Track A's `9634882`/`a1f9d90` bundle). `pk-rebuild.out` and
`pk-bidder.out` stay run-32 records (`fa54df28…` re-checked unchanged in run 33). **Updated 2026-10-06 (run
34, batch B34):** the whole PK row re-recorded after R36 (`package.json` `UNLICENSED`, no `LICENSE`) and
R37.5 (`cli/build.mjs` cleans `cli/dist`): new digests verify bundle `80754445…` (correction — the B33 merge
resolved the bundle to Track A's `9634882` rebuild; run-33's `effd9853…` was track-b's pre-merge tree), npm
package `ab18336f…`, bidder `fa54df28…` unchanged; `pk-rebuild.out` regenerated with all three digests and
`pk-package-verify.out` now also proves the removed `auction balance-addresses` is absent from the packaged
CLI. **Updated 2026-10-06 (run 35, batch B35):** the RG row's **offline half is done** — 23
`mutations/<ID>-rg.out` records at `6802a2f` (red then green, AGENTS procedure) and the RG table
(`test-audit.md` §(c): every mutation ID in the project, its last red, whether it was re-shown at this HEAD,
and the one command for the live half); RG stays **OPEN** until the live half runs.

## (a) Gate table

| Gate | Status | Evidence (committed paths) | One-command repro | What is missing |
|---|---|---|---|---|
| H | **OPEN** (Track A) | `docs/evidence/phase-6/closure.md` (the R6–R26 P0/P1 closure, 34 rows, `eb02e52`) is supporting material only | — | the walk of all 34 P0 rows of `docs/research/threat-model.md` with code + live-path evidence pointers (or README disclosures); §5a's signer-binding + mid-batch signer-kill evidence for #13/#15; README honest limits updated from DESIGN §14. Track A owns |
| SC | **offline half READY FOR REVIEW; live half OPEN** | offline: `bench.json` (17,000-bid run at `3bfde30`, `status: PASS`, `settlement_batches=608`, `estimated_fee_zats=88040000`, projection 24.13 h @ cap 13 / 20.85 h @ cap 28), `repro/batching-equal.out`, `mutations/B31-a.{patch,out}`; live: `scale/scale-8*.jsonl`, `scale/scale-27*`, `scale-measure.md` | `npm run bench -- --bids 17000` (offline); `npx esbuild tools/repro/batching-equal.ts --bundle --platform=node --format=esm --outfile=tmp/batching-equal.mjs && node tmp/batching-equal.mjs` | live: the largest testnet auction TAZ allows at the gate's target (≥ 50 bids, ≥ 4 settlement batches) settling cleanly — largest on record is 27 bids / 1 batch (scale-27). Track A owns |
| LA | **READY FOR REVIEW for `7c235d6..5475c60`; final pass owed after RG** | `leak-findings-2026-10-05.json` (331 rows, all classified A–G), `leak-audit.md` (run-3 record + dispositions), `leak-allowlist.json` (62 reviewed paths) | `npm run leak-audit -- --sensitive .benzo/leak-sensitive.json --allowlist docs/evidence/phase-6/leak-allowlist.json --paths docs/evidence $(find tmp -maxdepth 3 -type d -name "public*" \| sort \| tr '\n' ' ') --git` | the gate's own wording: the scan on the **final regression's full output** (re-run after RG); the bid-plaintext-before-release (`release_time`) sensitive entries (owed since run 2) |
| PK | **READY FOR REVIEW except one OPEN item** | `pk-package.out` / `pk-package.sha256` (reproducible tarball `benzo-0.1.0.tgz`, sha256 `ab18336fd4d52889ebde12925a3e47195bca09c2db395709917c21a1bc4753f9`, 18,321 entries, 112 production packages; **two clean `npm run package` builds identical** at tree `3ca5c9f`, run 34 after R36+R37.5), `pk-package-verify.out` (clean /tmp extract — no `.env`, no state dir, no checkout — starts and runs `bin/benzo verify` on the shipped Phase 4 evidence **offline**, all checks OK incl. `defaults`, exit 0; **and** the R33-removed `auction balance-addresses` is absent from the packaged CLI: router `ERROR usage unknown command` exit 2, 0 of 18,321 tarball entries carry it), `pk-bidder.out` (bidder bundle `benzo-bidder-0.1.0.tgz` sha256 `fa54df28e87c507336897f88cf0f831d8df7599f48e54ebeada98dc77cae88f6` **unchanged** — it ships only `seal/` output — from **two identical builds**; then the clean-machine seal-open proof: extracted in a fresh `/tmp` dir with an empty `HOME` and no access to this checkout's `node_modules`, served statically, driven headless with the pinned Playwright Chromium, sealed to quicknet round 32818939 against the committed launch manifest, opened after R with the pinned Go `tle`, plaintext byte-equal to the inputs chosen), `pk-rebuild.out` (a fresh clone in `/tmp` rebuilds **all three artifacts byte-for-byte at the run-34 digests** `80754445…`/`ab18336f…`/`fa54df28…` — PASS; replaces the run-32 mixed record, which is in git history), `docs/reproducible-build.md` (pinned toolchain + the rebuild commands + expected digests, re-recorded run 34 incl. the verify-bundle correction `effd9853…` → `80754445…`), `docs/verify-it-yourself.md`, `check:bundle` (`973feac`, accepted by R32; PASS at `3ca5c9f`) | `bash tmp/rebuild-proof.sh` (rebuild all three from a fresh clone); `npx esbuild tools/repro/bidder-bundle-proof.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/bidder-bundle-proof.mjs && node tmp/bidder-bundle-proof.mjs` (bidder bundle); the extract+verify transcript in `pk-package-verify.out` | **OPEN: a stranger's clean-machine run recorded end to end.** Everything else the gate asks is proven from this checkout on this machine (and nothing in either artifact depends on the checkout); the run by someone who is not Builder B remains |
| DOC | **partial — the API reference is done** | `README.md` (§5a track words verbatim), `docs/guide-{operator,signer,bidder}.md`, `docs/verify-it-yourself.md`, `docs/why-timelock.md`, `docs/mainnet-risks.md` (run 28), **`docs/api-reference.md`** (run 32: every route of `benzo api serve` + the standalone server, the states each answers in and its 409/400/404/405 bodies, every response field typed from the code with `file:line`, the signed-manifest/`--signer`/`benzo verify` trust layers and what a UI must never trust without verify, and the privacy section; kept from drifting by `repro/api-reference.out` — PASS 11 documented shapes at `f5a022a` — and `mutations/B32-a.{patch,out}`) | `npx esbuild tools/repro/api-reference-check.ts --bundle --platform=node --format=esm --outfile=tmp/api-reference-check.mjs && node tmp/api-reference-check.mjs` | **OPEN: the head's literal clean-checkout walkthrough of each guide** (and the README's honest-limits update that gate H owns) |
| RG | **OPEN — offline half DONE at `6802a2f` (B35), live half owed at the final regression** | offline half: `mutations/<ID>-rg.out` × 23 at `6802a2f` — every mutation whose red can be shown offline, red then green: seal-open M1–M4 (`npm run e2e`), replays 5M1/5M3 (`mut-replay.ts`) + 5M6–5M11 (`mut-replay-markets.ts`), B31-a (bench), B32-a (api-reference), the 9 offline folded IDs (R15-F4a/F4b/F5, R16-F2a, R23-3a, R23-2-revert, R26-3a/b, U7 through `tmp/folds.config.ts`); RG table `test-audit.md` §(c) (all 87 IDs); earlier mutation sets under `docs/evidence/phase-{1..6}/mutations/`; run 28's re-run table (`docs/STATUS-B.md` run 28) | — | the **live half**: all Phase 1–5 specs green at **one commit** on post-NU7 testnet (final regression), then the table's 29 live-only + 30 local-validator rows re-shown red at that commit (one command each, §(c); 28 patches need re-cutting first, marked ⚠), and R35.3(b)'s deletion of the 25 folded scripts in one head commit citing the RG evidence |

## (b) LP-0004 — one row per completed live testnet auction in the committed evidence

Phase-5 markets runs (`docs/evidence/phase-5/markets/`) and the phase-6 scale runs
(`docs/evidence/phase-6/scale/`, `scale-measure.md`). "Bidders" = sealed bids (frozen leaves).
The `benzo verify` column records the committed verdict lines exactly.

### Phase-5 markets — scenario runs (NU7 testnet, host custody, `tools/repro/markets.ts`)

| Auction | Mode | Bidders | Frozen root | Drand round | Settlement txids | `benzo verify` | Fees | Source |
|---|---|---|---|---|---|---|---|---|
| OTC match `299e1010865f8827c515479f2e41be158ad06be0a1ddbd7e97baebce1c1538a0` | otc | 2 | `e7139c0b3e07c0efe02945c2e520756b7919a994237e84b0e25b9ebacd3eb88e` | 32793856 | `d6e983fe2b10fb27572f24716fb94bb9286eb8cf130efa87de8ebf43300c8d57` @4466791 | `PASS otc-match-cold-verify`, `RESULT PASS otc-match` | network fee 15,000 | `markets/otc/otc-match-cold/{manifest,frozen,beacon,summary}.json`, `markets/otc/otc-match.out` |
| OTC no-match `1f02476faa2b9f2dc4cc5c94a896c259bba7a65dd3c65f0cd51ce15785dc4da1` | otc | 2 | `41eff778a480811d8c6d399da330f2fb5fe838aaca17c71ddbd0d456ff2b9690` | 32794044 | `f40e5ee2b9417056d4539b24e0bea248484db70f33c6ee4acc78c36fc86b2a1a` @4466814 | `PASS otc-nomatch-cold-verify`, `RESULT PASS otc-nomatch` | network fee 15,000 | `markets/otc/otc-nomatch-cold/*`, `markets/otc/otc-nomatch.out` |
| Launch, minimum missed `269ad3b08c3a4469b3b5723a47638c64f19775776951b13c17cc922a3dcf6415` | launch | 3 | `c1d72958abd46278e39ae2624425acd626f30af03d98d129fae73e82b91692ee` | 32793168 | `4f40b245d1a8af6e9d88da38c31e8c454ee0b18bf6ba540aa49374495473459f` @4466706 | first attempt `ERROR clear refused: launch allocation file hash` (publisher fixed `c4bd9fa`); `[resume 269ad3b0] RESULT PASS (verify exit 0)` | network fee 20,000 | `markets/launch/cold-269ad3b0/*`, `markets/launch/launch-miss.out`, `markets/README.md` |
| Launch, minimum met `f11704696a430712b52e5c728d397dd0fdb9efb30b3fec2a61698af423f4b542` | launch | 3 | `ca822fddb64bd739d5d3767fbd1f4c6a603b914aa6a3353f77daec16de87ea56` | 32793956 | `6a3b30988f2418d48520056a7929f96ffeec2ba3ff4aa84836652a578ded2475` @4466802 | `[resume f1170469] RESULT PASS (verify exit 0)` | network fee 25,000 | `markets/launch/cold-f1170469/*`, `markets/launch/launch-meet.out` |
| RFQ `d19f28914b6932890d4248671c935772ab585e7cf39d6336f9ecfc5f4c8a356f` | rfq | 3 | `a99230d5903f213473678c3d29ed3e415f7ec162517d5daa24291f20397a82e9` | 32794788 | `e185545243bb13b2fcc285d314001a414114d087d7b82abd651b82ee35c6b68c` @4466906 | `PASS rfq-cold-verify`, `RESULT PASS rfq` | network fee 25,000; 100 of the 500 budget returned to `treasury_ua` | `markets/rfq/rfq-cold/*`, `markets/rfq/rfq.out` |
| RFQ, cancelled `2c4ff3a3644884af1b6fa9157aff3d52f74540649fde843bc1ce81cf229422d8` | rfq | 2 | not recorded | not recorded | not recorded (`settle exit 0`; receipts `leaf:0` 200,000, `leaf:1` 200,000, `treasury` 500) | `PASS rfq-cancel-cold-verify`; `[resume 2c4ff3a3] RESULT PASS (verify exit 0)` — the file's later `RESULT FAIL rfq-cancel` is the stale scenario expectation after the resume had settled it (`markets/README.md`) | not recorded | `markets/rfq/rfq-cancel.out`, `markets/README.md` |
| Bid revision `dc7bd8aeb26c3cb1afa7484f0ef89915637881fb34edb088487e7d3d20812a77` | uniform | 3 | `de22b894a5c9f068cb754dcd6205d50a041f1dcfb3e60c0b13398f32cd72742e` | 32794879 | `8fa2d963d1c00a8c26849f4a074713eca8912d05ea17fa221d9c6096ba8503c3` @4466916 | `PASS revision-cold-verify`, `RESULT PASS revision` | network fee 25,000 | `markets/revision/revision-cold/*`, `markets/revision/revision.out` |
| Collection drop `39c995e586a2b95973650a9bc7379c38236ed10be48d21bdc29b09fbe8d7b2d7` | uniform (bond-then-pay + serial shuffle) | 4 | `2096d844e0bc822d8739ef70f60804c28ffb27fc10ddd967a0389a2068bda292` | 32806537 | `3af739352beaecb22c5c916d6456c4ecffe7870ac60e166e5cd6af9c56b9ba4c` @4468197; balance payment `2648d6a8e0d3b8a30087ec7d69f81b9155cf001aa9322bb14c68a32fccdeceb6` (leaf 0, 300,000; window closed 4468193) | `PASS drop-cold-verify`, `PASS drop-defaults [2]`, `RESULT PASS drop` | network fee 30,000 | `markets/drop/drop-cold/*` + `markets/drop/drop.out` **(committed on `main` in `2acbeb6`, not yet merged into `track-b` when this table was written)** |

### Phase-5 markets — recovery runs (funding-side failures completed through refunds)

| Auction | Mode | Bidders | Frozen root | Drand round | Settlement txids | `benzo verify` | Fees | Source |
|---|---|---|---|---|---|---|---|---|
| OTC recovery `fa22c8acadada56184e5ce01f381151fe47bb99ed1ea63675ec8dd37fbd83a94` | otc | 2 (exception rows) | not recorded (cancelled before freeze) | not recorded | not recorded (both deposits refunded via owner claims) | `SKIP xc-verify (cancelled before freeze: no frozen root to verify against)`; `RESULT PASS all cancelled-auction claim assertions` | not recorded | `markets/recoveries/otc-fa22-claims.out` |
| RFQ recovery `c4c3dbf5bd17a215cc22fc93d351b69a7629fd0cd11f70ed16f9c40b6365192e` | rfq | 3 (deposits) + treasury funding | not recorded (cancelled before freeze) | not recorded | not recorded (3 deposits + the 500 treasury funding returned via claims) | `SKIP xc-verify (…)`; `RESULT PASS all cancelled-auction claim assertions` (after one transient-TLS retry) | not recorded | `markets/recoveries/rfq-c4c3-claims.out`, `markets/README.md` |
| Drop recovery `a66c87d2f79be62773134790e10ea0375da01b04ae3a4b2b32cd013fd226675b` | uniform (drop) | 4 (receipts name leaves 1, 3; defaults `[0,2]`) | not recorded | not recorded | not recorded (`settle exit 0`; balance payment `c8087328dd724388cf445dc96de2ff7a3dfe8d5951f6cde2fba4c7b9904738b8`, window closed 4468074) | `[resume a66c87d2] … verify exit 0`; the file's `RESULT FAIL` line is the stale scenario expectation `[2]` against the host-derived defaults `[0,2]` (`markets/README.md`) | not recorded | `markets/recoveries/drop-a66c-late-recovery.out`, `markets/drop/drop-first-run.out` **(on `main`, `2acbeb6`)** |

### Phase-5 markets — the head's live spec run (`e2e/markets.spec.ts`, `spec-run/`, commit `b698770`)

Seven fresh live auctions, one per scenario; the committed artifacts are the run logs (no cold
corpora), so roots/rounds/txids/fees are not recorded in them.

| Auction | Mode | Bidders | Frozen root | Drand round | Settlement txids | `benzo verify` | Fees | Source |
|---|---|---|---|---|---|---|---|---|
| spec otc-match `05843262be5ff7c8d00768d3804e6772b6db8a0acbdae8b3de8a2aae23d4fa3d` | otc | 2 | not recorded | not recorded | not recorded | `PASS otc-match-cold-verify`, `RESULT PASS` | not recorded | `markets/spec-run/group-0.out` |
| spec launch-meet `91d731a2050e4e3d93c1c3f3445dcba3fe355baaa3fc104de332220d0673abbc` | launch | 3 | not recorded | not recorded | not recorded | `PASS launch-meet-cold-verify`, `RESULT PASS` | not recorded | `markets/spec-run/group-0.out` |
| spec rfq `ed1b681b675f6a7a93e270cc59bcaef59c4996082ef4140f9179b961f482f7fd` | rfq | 3 | not recorded | not recorded | not recorded | `PASS rfq-cold-verify`, `RESULT PASS` | not recorded | `markets/spec-run/group-0.out` |
| spec otc-nomatch `c91705c48629977f2fee01bb9aa4075e54fcd47c0252e7e258cecd8d705a79b9` | otc | 2 | not recorded | not recorded | not recorded | `PASS otc-nomatch-cold-verify`, `RESULT PASS` | not recorded | `markets/spec-run/group-1.out` |
| spec launch-miss `42ff9ea13c9e78219d90fafad444739b169d7559e8f93b78855b17ca8f365216` | launch | 3 | not recorded | not recorded | not recorded | `PASS launch-miss-cold-verify`, `RESULT PASS` | not recorded | `markets/spec-run/group-1.out` |
| spec rfq-cancel `d7f3ed62499dc5fbcf1789893d73fef94c8c19d992562ccd7a315a4713f05326` | rfq | 2 | not recorded | not recorded | not recorded | `PASS rfq-cancel-cold-verify`, `RESULT PASS` | not recorded | `markets/spec-run/group-1.out` |
| spec revision `294c31864231b36b033f3c2102005764fe78314c0cfd4b0a1c15a30c756c6746` | uniform | 3 | not recorded | not recorded | not recorded | `PASS revision-cold-verify`, `RESULT PASS` | not recorded | `markets/spec-run/group-1.out` |

### Phase-6 scale runs (live NU7 testnet, host custody; `tools/repro/markets.ts scale-8|scale-27`)

| Auction | Mode | Bidders | Frozen root | Drand round | Settlement txids | `benzo verify` | Fees | Source |
|---|---|---|---|---|---|---|---|---|
| scale-8 (R28 serial signing) `094e68c942413642ba38c4472d2e901e68a585f8b244c0129019b74e0304c38c` | uniform | 8 | not recorded | not recorded | not recorded | not recorded (only the timing capture was kept) | network fee 50,000 (10 actions) | `scale/scale-8-timing.jsonl`, `scale-measure.md` |
| scale-8 (R29 parallel sessions) `95cdfb4148015d6eacc21ecdada462dff6806a62d41e53c8dcd08a2ed4d3b40e` | uniform | 8 | not recorded | not recorded | not recorded (mined height 4467414) | `PASS scale-8-cold-verify`, `RESULT PASS scale-8` | not recorded | `scale/scale-8-r29-timing.jsonl`, `scale/scale-8-r29.log` |
| scale-8 (R29 + parallel approvals) `6efcd40f98f27ded09f40d5d2b8ec160db154c5f9f81f21a27efe457e34e3f12` | uniform | 8 | not recorded | not recorded | not recorded (mined height 4467601) | `[resume 6efcd40f] RESULT PASS (verify exit 0)` (first attempt FATAL: a local DNS outage broke `benzo open`, resumed) | not recorded | `scale/scale-8-r29b-timing.jsonl`, `scale/scale-8-r29b.log`, `scale-measure.md` |
| scale-27 (R30, one 28-output batch) `5e2091c957252c884760ae7931fd687574f64f0cc08d60982250a70d0c42d5f2` | uniform | 27 | not recorded | not recorded | `09a0f834…32e8` @4467722 (abbreviated in `scale-measure.md`; raw tx 94,380 bytes) | `PASS scale-27-cold-verify`; `[resume 5e2091c9] RESULT PASS (verify exit 0)` (first settle refused by the old 13-recipient bound, fixed `41ef5a4`) | network fee 140,000 (28 actions) | `scale/scale-27-timing.jsonl`, `scale/scale-27.log`, `scale-measure.md` |

### What this table does not cover

- Phase 2–4 auction cycles are already rowed in `lp-0004.md`'s cycle table (read there).
- Other committed live-auction evidence outside this table's named scope (phase-5 markets runs +
  phase-6 scale): `buyback-run3/`, `buyback-run4/`, `buyback-run2-recovery/`, `y2*/`,
  `live-regression-*/`, `r28-live/`, `cancel-claims/` and the cross-chain delivery runs. The head
  can extend the table from those directories the same way.
- The phase-7 mainnet cycle is pending (its phase).
- The narrated demo video criterion is pending (Phase 6/7 work).
