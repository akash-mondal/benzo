# Status: Builder B (Track B) handoff

<!-- Only Builder B writes this file, on branch track-b. Same rules as docs/STATUS.md: outcome first, back every claim
with a command and its result or mark it `unverified`, replace stale lines. Rulings live in the phase doc only. -->

## Batch B51 (Builder B, branch `b51-review-fixes`, from `a107447`) — Reviewer R on B47/B48: the preflight re-run double-count, the reserve-address listing wall, four P3s

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb`, no testnet, no wallets, no
live Playwright; stubs and own tmp state/builds only). Spec:
`docs/design/phase7-b51-review-fixes.md`; source report `benzo-sol/reports/pr-p7-b47-b48.md`. Worktree
`../benzo-b51`, branch `b51-review-fixes`, base `a107447`. Commits `--no-verify` (R32): `1689b46` (item 1),
`a7297c9` (item 2), `1502bc4` (item 3), `52816b6` (item 4), `a9c6798` (item 5 + the rebuilt verify bundle and
its sha), `f41a3e9` (item 6), `a69030a` (the H22–H24 rows). B50's files untouched except the named narrow
regions: `settle/cli.ts` (preflight, broadcast catch, kept accounting — `hostBuild` untouched),
`api/public-auction.ts` (accounting-strays' reserve_return block only), `cli/commands/sign-derivable.ts`
(reserve branch only — the seller branch untouched). `tools/repro/b46-reserve-return.ts` gained the
`settlement.batches` fixture (the real product shape) and two verify cases.

### The six fixes, each red on base a107447 bundles and green after

1. **P2-2 — the H19 preflight double-counts an in-flight batch on a re-run** (`settle/cli.ts:347-350`, the
   `owned` rule mirrored from `settle/plan.ts:75-87`; comment `:336-339`). Rows whose batch carries a txid
   and is not an exception are no longer remaining obligations, and the notes that batch spent were already
   excluded from both the spendable value and the fee bound. Red (`b47-settle-e2e-b51-j-red.out`, case
   (g)-red, the reviewer's probe world seeded through the real `Ledger`): base reproduces the probe's exact
   line `ERROR settle fee reserve short: pay 4400440 zats to utest1b47feereserveaddress…` — demanding the
   total batch 1 ALREADY paid (4,000,400) plus the margin — and cannot even confirm the mined batch (no
   receipts, every row still allocated). Green (`b47-settle-e2e-b51-j-after.out`, case (g), 5 checks): no
   preflight line, batch 1 confirmed from its own mined height without ever re-sending (its txid broadcast
   exactly once), and the same `benzo settle` continues to the completed return; a further re-run is clean.
2. **P2-1b — a mismatched `reserve_return_ua` walled `sign derivable`** (`cli/commands/sign-derivable.ts:27-40,
   60`). R107's rule reaches the listing: a packet that declares NO return row lists every other row and
   leaves out only the reserve-return row, tagged `"refused_rows":["reserve-return"]` in the JSON output; a
   packet that DECLARES the row with the mismatched address stays refused (typed, exit 3). Red
   (`b48-p3s-b51-seller-before.out` `b51-mismatched-ua-without-row-lists`, `b46-reserve-return-b51-before.out`
   `sign-derivable-wrong-return-ua-lists-without-row`): base exits 3 and lists nothing — the wholesale wall.
   Green (`b48-p3s-b51-after.out`/`-seller-after.out`, `b46-reserve-return-b51-after.out`): the rowless
   packet lists the rows minus the return with the tag; the declaring packet is refused typedly
   (`b51-mismatched-ua-with-row-refused-typed`, green on base too — unchanged).
3. **P3 — the fee bound and R109's margin** (`settle/cli.ts:355-359`): the bound now counts one extra spend
   per remaining batch (each later batch re-spends the previous batch's change). Case (e) re-derives the
   R109 top-up `shortfall + max(ceil(shortfall/10), 5000)` (the pre-R109 formula gap is closed) and case
   (h) pins the margin: a 20,000-zat shortfall asks for exactly 25,000 and topping up exactly 25,000
   completes (`b47-settle-e2e-b51-h-after.out` `h-shortfall-20000-asks-25000`, `h-margin-floor-pinned`,
   `h-completes-after-exact-top-up`; reverting the +5,000 floor would ask 22,000 and fail the pin). Red
   (`b47-settle-e2e-b51-j-red.out` `h-red-undercounted-bound`): the base bound demands 20,000 where the
   pinned demand is 25,000.
4. **P3 — the broadcast catch never trusts the error string alone** (`settle/cli.ts:457-476`). On a send
   error the wallet's own `list-tx` must know the staged txid (the same read the mined-wait repeats when it
   finds the transaction): known counts as broadcast; an `already exists in mempool` claim with the txid
   unknown is treated as NOT broadcast and the send is retried once with the same bytes; any other error
   stays an immediate error. The vacuous pair the reviewer named (`sent = staged.txid` then
   `requireThat(sent === staged.txid)`) is gone — the txid check runs only on a send that returned one. Red
   (`b47-settle-e2e-b51-j-red.out` `i-red-*`, the stub answers the phrase while recording nothing): base
   prints `settlement broadcast <txid>` for the phantom transaction and sits in the 30-minute mined-wait
   (the driver kills it at 45 s; nothing recorded). Green (`b47-settle-e2e-b51-i-after.out` `i-*`): the lie
   is seen once and never accepted, the retry really broadcasts, the settlement completes.
5. **P3 — reserve_return self-consistency + no doc self-feed** (`api/public-auction.ts:864-874`,
   `settle/cli.ts:526-537`). verify requires `fee_zats` to be the ZIP-317 fee for the PUBLISHED source count
   (the number of inputs in the paying batch's published inspect, `settlement.batches`) — the reviewer's
   doctored pair (remaining and fee both +5,000: difference preserved, fee merely ZIP-317-shaped) no longer
   verifies — and an accounting with no published source count is refused (fail-closed). `remaining − fee =`
   the receipt's amount is unchanged. The kept accounting now comes only from the ledger's own record (the
   paid batch's inspect): the H20.2 fallback to the already-published doc is gone, so a doc can never feed
   its own accounting back. Red (`b46-reserve-return-b51-before.out`: base verifies BOTH the doctored and
   the source-count-less accounting — the two new checks red; `b47-settle-e2e-b51-j-red.out`
   `j-red-doc-feeds-itself`: with the paid batch's inspect record gone the base re-reads the accounting out
   of the published doc and exits 0). Green (`b46-reserve-return-b51-after.out`
   `verify-refuses-doctored-accounting` / `verify-refuses-return-without-source-count`;
   `b47-settle-e2e-b51-j-after.out` `j-refuses-without-ledger-record` (exit 1,
   `a paid reserve-return receipt without its accounting in the ledger`), `j-nothing-republished` — and the
   same seeded world refuses on this tree (`j-green-same-world-refuses`, red/green pair in one run).
   R32: the verify bundle changed and was rebuilt and committed with `docs/verify-bundle.sha256`
   (`9a7536a0…`); `check:bundle` PASSES in this worktree. See Question 5 for the base-tree hash drift.
6. **P3-5 — `seller check` without `--signer`** (`cli/commands/seller.ts:29-33`): exactly one
   `WARN no trust anchor: pass --signer HEX (the auction's published receipt key) to check who signed this
   manifest`, and the commitment check still runs (a mismatched UA is still refused at exit 1). Red
   (`b48-p3s-b51-seller-before.out` `b51-seller-check-no-signer-warns`): base prints no WARN (the check is
   red there; `b51-seller-check-no-signer-still-checks` green on base — unchanged). Green
   (`b48-p3s-b51-seller-after.out`): both checks pass.

Out of the batch, recorded as rows in `docs/design/phase7-hardening.md`: **H22** (the name-based rows-loop
skip), **H23** (the mixed-batch crash wedge — noting B50's H3 typed one-pool rule as the likely cover, to
verify at the B50 merge), **H24** (the lexical `--openings-cache` pin).

### Commands run (worktree `/Users/akshmnd/Dev Projects/benzo-b51`), each with result

- Setup: `node_modules` symlinked from the main checkout (identical `package-lock`), `vendor/nu7` copied
  (sha-pinned crates), own `.env` from `.env.example`, own `.benzo/bin` (tle v1.2.0 + grpcurl v1.9.3 via
  `go install` at `tools/pins.env` tags) and own `.benzo/proto` (fetched at `LWD_PROTO_REV`, both shas
  match `tools/pins.env`). No main-checkout `.benzo/` or `.env` used.
- Bundles: `npm run build:core && build:settle && build:cli` OK (incl. `cargo build --release --locked`);
  `npm run build:verify` → `dist/benzo-verify.mjs` sha256 `9a7536a012d2…`, committed together with
  `docs/verify-bundle.sha256` (item 5's commit).
- Gates: `npm run typecheck` 0 errors; `npm run check:structure` `OK check:structure (215 files)`;
  `npm run check:invariants` `{"fails":{"I1":0,"I2":0,"I3":0,"I4":0}}` ×2;
  `npm run check:dist-require` OK; `npm run check:bundle` `OK check:bundle 9a7536a0… dist/benzo-verify.mjs
  and docs/verify-bundle.sha256 match a fresh rebuild of this tree`; `npm run e2e` `PASSED default seal in
  the browser, open with tle after R (38 s)`.
- Per-item proofs (raw `docs/evidence/phase-7/repro/*b51*`): b47 case (g) red 2/0 + green 33/0; case (h)
  green 36/0; case (i) green 39/0; case (j) green 41/0 + red legs 7/0 (items 1/3/4/5's reds + the
  same-world pair, one `before51` run per item — the cumulative file is `b47-settle-e2e-b51-j-red.out`);
  b48 green 20/0 then 22/0 (item 6), red-on-base 19/1 then 20/2 (exactly the B51 changes red);
  b46 green 56/0, red-on-base 53/3 (exactly the three B51 behaviours).
- **Folds all green** (raw `docs/evidence/phase-7/repro/*-b51-fold*`, `h10-seller-binding-b51.out`):

| fold | result |
|---|---|
| b44-opener | before 25/0, after 29/0, RESULT PASS both |
| b46-reserve-return | before 8/0 (historical bases a81e826 + 7c4e661), after 56/0, RESULT PASS both |
| b47-settle-e2e | before 7/0 (8a9f638 legs unchanged), after 41/0 (cases (a)–(j)), before51 7/0, RESULT PASS all |
| b48-p3s | green 22/0, RESULT PASS (red legs above) |
| h10-seller-binding | 22/0, RESULT PASS |
| h13-host-scale | before 8/0, after 38/0, RESULT PASS both |
| h14-open-griefing | before 12/0, after 14/0, RESULT PASS both |

- Base trees built by each fold's own recipe (`git archive` + that recipe; no second worktree):
  `tmp/b51/base-src` (`a107447`), `tmp/b44/base` (`d646ceb`), `tmp/h13/src` + `tmp/b45/base` (`cd19905`),
  `tmp/h14/src` + `tmp/b43/base` (`5086be1`), `tmp/b46/base-src` (`a81e826`), `tmp/b46/base49-src`
  (`7c4e661`), `tmp/b47/base-src` (`8a9f638`).
- Harness notes: `tools/repro/b47-settle-e2e.ts` gained the `before51` part (B51's red legs on base
  a107447 bundles), the case-(g)/(h)/(i)/(j) worlds and a stub `inputs` field (the real `benzo-pczt
  inspect` publishes one input per spent note — the reserve_return source-count check reads it);
  `tools/repro/b47-republish.ts` documents the previously undocumented `tmp/b47-republish.mjs` seeded-world
  publish helper (built with the header's esbuild line).

## Questions (B51)

1. **Item 5's "published source count" is read from the paying batch's published inspect inputs**
   (`settlement.batches`, the only source count the published doc already carries — the exact
   `{remaining_zats, fee_zats}` keys and `cli/product.ts`'s two-key normalization stay untouched, and the
   h15-live doc verifies unchanged: 1 source, fee 10,000 = 5,000 × max(2, 1)). If the head meant a source
   count published INSIDE the `reserve_return` accounting (a third key), that needs a `cli/product.ts`
   change (B50's file) plus a migration rule for the h15 doc — say the word and I will reshape.
2. **The check is fail-closed on a missing source count** (a `reserve_return` accounting whose paying batch
   publishes no inspect inputs is refused). No existing evidence breaks (only h15-live carries a
   `reserve_return`, and its inspect publishes `inputs`), and the b46 fixture now publishes the honest
   `settlement.batches` shape. If some legacy dir must keep verifying without batch inspects, the
   alternative is a conditional check — which would let a doctored doc dodge the tie by omitting `batches`.
3. **The b46 case `sign-derivable-wrong-return-ua-refused` was re-aimed** (P2-1b changes the behaviour it
   pinned): the rowless packet now lists the rows minus the return with the refused tag
   (`sign-derivable-wrong-return-ua-lists-without-row`) and the new `…-refused` case is the packet that
   DECLARES the row (typed, exit 3). If the old wholesale-refusal assertion must literally survive, item
   2's rule needs revisiting.
4. **Item 4's reading of "or the next mined-wait finds it"**: the acceptance criterion is the wallet's own
   knowledge of the staged txid — checked at the catch (`list-tx` sees it, mempool or mined) and repeated
   by the mined-wait (the same read). With the txid unknown, an `already exists in mempool` claim is
   retried once and then REFUSED immediately (the next `benzo settle` re-sends the same bytes) rather than
   entering the 30-minute mined-wait — the reviewer's stall. If the head wants the mined-wait itself to be
   the final confirmation (accept-then-wait, retry only after the deadline), that is a small change but it
   reintroduces the 30-minute stall for a lying endpoint.
5. **Verify-bundle hash drift across environments (R32, observed again).** A fresh rebuild of the
   UNCHANGED tree in this worktree hashes `4799222f…` while the committed bundle at `a107447` is
   `c93f1e19…` (deterministic here — three identical rebuilds). Item 5's rebuilt bundle + sha
   (`9a7536a0…`) are committed together and `check:bundle` PASSES in this worktree; the head may want to
   rebuild from the combined tree at merge as in R112.
6. **The strict fee/source tie is still self-consistency** (the design's framing): a coordinator who
   doctors the fee AND the published inspect's input list together still passes verify (verify is offline
   and cannot recompute the sweep). The real binding is the reviewer's own suggestion — host-attested
   `input_zats`/`fee_zats` in the signed map or the reserve receipt — which needs a map format change
   (H2's territory). Not attempted here; flagged.
## Batch B50 (Builder B, branch `b50-p2-sweep`, from `503826b`) — the remaining verify/settle P2s (H1, H3, H5, H6, H7, H21)

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb`, no testnet, no wallets, no
live Playwright; the worktree carries its own `.env` (from `.env.example`), its own `.benzo/bin` tool dir
(the pinned `tle` v1.2.0 installed with `go install`, for `npm run e2e`), `node_modules`/`vendor` links, and
its own `settle/target` build). Spec: `docs/design/phase7-b50-p2-sweep.md`. Worktree `../benzo-b50`, branch
`b50-p2-sweep`, base `503826b`. Commits `--no-verify` (R32), one per item: `b07903e` (H1), `167550c` (H3),
`31ffe18` (H5), `c5b076f` (H6), `7f0bd72` (H7), `bd72c6f` (H21), then the sweep/status commit. The verify
bundle changed with H1/H5/H6/H7 and was rebuilt (`npm run build:verify`) and committed with
`docs/verify-bundle.sha256` each time.

### H1 — receipt-attestation requires the two maps to agree fully (`witness/index.ts`, `api/public-auction.ts`)

`mapPairAgrees` is exported and now also compares the maps' `batch` (it is in the signed body);
receipt-attestation requires the pair attesting each receipt to FULLY agree through that predicate
(`api/public-auction.ts` receipt-attestation), instead of only matching on the receipt's txid and outputs.
Proof (`tools/repro/b50-p2-sweep.ts` section `h1`; red `docs/evidence/phase-7/repro/b50-h1-before.out` on
pristine `503826b` code, green `docs/evidence/phase-7/repro/b50-h1-after.out`): two pinned maps that agree on
the receipt's txid and outputs but differ in `strays`, `defaults` or `batch` are ACCEPTED on the base tree
(the three red checks) and REFUSED by `receipt-attestation` after; the fully agreeing honest pair stays
ACCEPTED on both. The verify bundle changed with `api/public-auction.ts` and was rebuilt (`npm run
build:verify`) and committed with `docs/verify-bundle.sha256`.

- `npx tsc -p tsconfig.json` → exit 0.
- `node tmp/r77.mjs` (fold) → honest ACCEPTED; fabricated-txid / swapped-output-index / duplicate-output REFUSED.
- `node tmp/r78.mjs` (fold) → every case as designed (honest ACCEPTED, each tamper REFUSED).

### H3 — one pool per batch on every build path, as a typed set-aside

The shared decision is `onePoolRefusal` (`settle/build-outcome.ts`): a candidate whose payment outputs span
two pools names the MINORITY pool's rows (the kept pool is the one with the most payment outputs, ties to the
earliest output's pool) — those rows wait in the exception queue with their reason and the batch's other
rows settle next (an R46 set-aside; a one-row batch can never span two pools, so re-planning terminates).
Applied on every build path: `cli/commands/sign-build.ts` (exit 3, `refused-rows` with exactly the minority
rows — typed like H10's seller row), `cli/commands/sign-approve.ts` (the same typed refusal), custody
`hostBuild` (`settle/cli.ts` — the built outputs' pools re-checked coordinator-side, typed through the
R44/R45 `unbuildable/refusedRows` channel), and the local build (`settle/cli.ts` — the old untyped
`requireThat` that wedged the run is now the same typed set-aside, with its own reason on the rows).
Proof (`tools/repro/b50-p2-sweep.ts` section `h3`; red `docs/evidence/phase-7/repro/b50-h3-before.out` on
pristine `503826b`, green `docs/evidence/phase-7/repro/b50-h3-after.out`): real `sign build` and `sign
approve` refuse a two-pool candidate typed (`h3-build-two-pools-typed`, `h3-approve-two-pools-typed`: exit
3, `refused-rows ["leaf:2"]` — the minority row only — nothing built/recorded; base: exit 0, built and
approved), the one-pool controls build/approve on both legs. The real `bin/benzo settle` worker (the b47
stub harness, shared copy `tools/repro/b47-world.ts`; custody world through real `sign build`, and the
local build world) sets `leaf:2` aside and PAYS the batch's other rows (`h3-{custody,local}-other-rows-paid`,
`-minority-set-aside`: the published settlement shows `leaf:2` as its exception row with no receipt, and the
set-aside is reported with its reason and the named row). Base: the custody path PAYS the two-pool batch
(`row refunded, receipt PAID` — the ambiguous-attribution defect) and the local path wedges the run
(`ERROR settle refused: batch pays more than one pool; refusing before signing (R81)`, exit 1, nothing
paid). Controls green on both legs.

- `npx tsc -p tsconfig.json` → exit 0; `npm run build:settle` + `npm run build:cli` rebuilt (no api/ change,
  so the verify bundle is untouched by this item).

### H5 — exact shapes for batch `proofs`, `inspect` and `signing`

`api/public-auction.ts` (receipt-attestation's batch block) now holds the three worker-written objects to
their exact shapes — closed key sets and typed values, derived from what the workers actually write
(`settle/cli.ts` inspect/signing; the earlier workers' `proofs`) and matched against every committed
published variant (recipient_hash / matches_pinned_routing / redacted per output; actions/txid/randomizers
optional in inspect; duration_ms optional per signing session). Proof (`tools/repro/b50-p2-sweep.ts` section
`h5`; red `docs/evidence/phase-7/repro/b50-h5-before.out`, green `docs/evidence/phase-7/repro/b50-h5-after.out`):
on the committed `launch-r34/launch-cold` doc, a blob in place of `signing`/`inspect`/`proofs`, an extra key
in `signing`/`inspect`/an inspect output, a blob in place of `signing.sighash`, `inspect.fee_zats`,
`proofs[0].height`, and a string in place of `inspect.actions` are all ACCEPTED on the base tree (the ten
red checks — only the leak guard looked at them) and REFUSED with their own shape errors after. Controls
(the untouched committed doc; a batch carrying the exact `{height, raw_hash}` proofs shape) ACCEPTED on
both. Every committed published dir keeps its verdict (the `dirs` sweep, listed one by one in the batch
sweep below and in `docs/evidence/phase-7/repro/b50-dirs-after.out`; identical before/after B50).

- `npx tsc -p tsconfig.json` → exit 0. The verify bundle changed with `api/public-auction.ts` and was
  rebuilt (`npm run build:verify`) and committed with `docs/verify-bundle.sha256`.

### H6 — the receipt exact-key check runs on result-less (cancelled) settlements

The check (`Object.keys(receipt) === {auction_id, party, txid, pool, output_index, amount_zats}`) moved
from `accounting` (skipped without a result) into `receipt-attestation` (`api/public-auction.ts`), so it
runs on every settlement, cancelled ones included. Proof (`tools/repro/b50-p2-sweep.ts` section `h6`; red
`docs/evidence/phase-7/repro/b50-h6-before.out`, green `docs/evidence/phase-7/repro/b50-h6-after.out`): a
real honest cancelled fixture — a result-less settlement whose stray deposit rows carry an owner-signed
claim (the R42 per-row recipe: the fixture's own sealed-bid memo opens to the key that signed the claim,
and the paying batch's two agreeing maps attest its memo hash) — is ACCEPTED on both legs; the same
fixture's receipt carrying an extra key (`extra_key`), or a blob field (`memo_hex`), is ACCEPTED on the base
tree (the two red checks) and REFUSED as `settlement receipt 0 shape` after. The three committed cancelled
snapshots are listed with their standing (OBSERVE, identical before/after): each predates/omits the custody
maps, so `claims` refuses its unattested stray memo today exactly as before B50 (pre-existing — a Question
below).

- `npx tsc -p tsconfig.json` → exit 0. The verify bundle was rebuilt again (`npm run build:verify`) and
  committed with `docs/verify-bundle.sha256`.

### H7 — every batch set aside publishes a no-payment settlement carrying the set-aside reasons

`cli/product.ts` (the `pick === null` gate): when the defaults tie-break has no paying batch AND the
settlement has not one receipt, publish serves the plan's own defaults/bond_void instead of refusing — a
NO-PAYMENT settlement, every row its exception row with its set-aside reason. With any receipt at all, a
defaults list no two agreeing host-signed maps carry stays unpublishable (unchanged). `settle/cli.ts` joins
the set-aside reasons onto the summary's exception rows (and from there they publish); `api/public-auction.ts`
accepts an optional `reason` on exception rows only, and its `defaults` check exempts a zero-receipt
settlement from the map tie-break (nothing was paid under the list — the equal-balance swap needs paid rows
— and the next settle re-derives the unpaid rows). Proof (`tools/repro/b50-p2-sweep.ts` section `h7`; red
`docs/evidence/phase-7/repro/b50-h7-before.out`, green `docs/evidence/phase-7/repro/b50-h7-after.out`): the
real `publish()` serves the fixture where every batch is set aside (2 exception rows carrying their
reasons, 0 receipts, defaults published — base: `publish refused: settlement defaults need two agreeing
host-signed approval maps`), `benzo verify` accepts both the served and a directly written no-payment
settlement (exit 0 — base: refused with `defaults: ... not carried by two agreeing host-signed approval
maps`), the narrowness control (a settlement WITH a receipt and unattested defaults) stays refused on both,
and the real `bin/benzo settle` worker publishes its set-aside row WITH its reason (`h7-worker-row-carries-
reason` — base: the row is paid, no reason).

- `npx tsc -p tsconfig.json` → exit 0. The verify bundle was rebuilt again (`npm run build:verify`) and
  committed with `docs/verify-bundle.sha256`.

### H21 — `sign derivable` lists the refunds and tags only the seller row refused; approve is typed

`cli/commands/sign-derivable.ts`: a mismatched `seller_ua` on a cleared auction no longer refuses the
listing — the refund rows list and pay at settle while only the seller row is tagged refused (typed: the
named row carries `refused: true` and its reason). `settle/cli.ts` `hostDerivable` routes the tag: the
tagged rows do not derive and their reason rides to the exception queue. `cli/commands/sign-approve.ts`: a
mis-shaped seller output (an output paying the packet's `seller_ua` that is not the result's seller payout
paid at most once) is refused typed (exit 3, `["seller"]`), never the untyped exit 1. Proof (the design's
extension of `tools/repro/b48-p3s.ts`, red `docs/evidence/phase-7/repro/b48-p3s-b50-before.out` on pristine
`503826b`, green `docs/evidence/phase-7/repro/b48-p3s-b50-after.out`, 18 checks `RESULT PASS`):
`h21-derivable-mismatch-lists-refunds-tags-seller` (exit 0, `leaf:0, leaf:1, leaf:2, seller(refused)` —
base: the whole listing refused, exit 3 — the B48 Q2 stall), `h21-approve-mis-shaped-seller-typed` (a
seller_ua output at 15001 zats: exit 3 `refused-rows ["seller"]` — base: the untyped `output 3 … is not a
row this signer derived`, exit 1 — B48 Q3), and the worker-level claim through the b47 stub harness
(`tools/repro/b50-p2-sweep.ts` section `h21`, red `docs/evidence/phase-7/repro/b50-h21-before.out`, green
`docs/evidence/phase-7/repro/b50-h21-after.out`): `h21-refunds-paid` + `h21-seller-waits-with-reason` — the
real `bin/benzo settle` pays the three refund rows and leaves only the seller row as its exception row with
the H10 reason (base: the run wedges at `no signer host could list its derivable rows`, nothing paid).
All the unchanged b48 checks stay green on both legs.

- `npx tsc -p tsconfig.json` → exit 0; `npm run build:settle` + `npm run build:cli` rebuilt (no api/ change
  this item).

### Batch sweep — every command and result (worktree `/Users/akshmnd/Dev Projects/benzo-b50`)

- `npx tsc -p tsconfig.json` → exit 0. `npm run check:structure` → `OK check:structure (216 files)`.
  `npm run check:invariants` → both runs `{"fails":{"I1":0,"I2":0,"I3":0,"I4":0}}`. `npm run
  check:dist-require` → `OK`. (`docs/evidence/phase-7/repro/b50-checks.out`.) `check:bundle` cannot pass in a
  worktree (R32); every commit that touched `api/` rebuilt and committed the verify bundle with its sha file.
- `npm run e2e` (Playwright default project) → `PASSED default seal in the browser, open with tle after R
  (38 s)` (`docs/evidence/phase-7/repro/e2e-seal-open-b50.out`).
- **Folds all green** (raw outputs `docs/evidence/phase-7/repro/*-b50*`):

  | fold | result |
  |---|---|
  | b44-opener | before 25/0, after 29/0, `RESULT PASS` both (`b44-opener-b50-{before,after}.out`) |
  | b46-reserve-return (incl. the B49 red legs) | before 8/0, after 53/0, `RESULT PASS` both (`b46-reserve-return-b50-{before,after}.out`) |
  | b47-settle-e2e | before 7/0, after 28/0, `RESULT PASS` both (`b47-settle-e2e-b50-{before,after}.out`) |
  | b48-p3s (with the H21 extension) | after 18/0 `RESULT PASS`; the H21 red leg (base `503826b`) `RESULT FAIL (2)` = exactly the two H21 changes (`b48-p3s-b50-{before,after}.out`) |
  | h10-seller-binding | 22/0 `RESULT PASS` (`h10-seller-binding-b50.out`) |
  | h13-host-scale | before 8/0, after 38/0, `RESULT PASS` both (`h13-host-scale-b50-{before,after}.out`) |
  | h14-open-griefing | before 12/0, after 14/0, `RESULT PASS` both (`h14-open-griefing-b50-{before,after}.out`) |
  | replay folds r78, r82, r77, r77-serial, r81, r73 | each exit 0, every case as designed — honest ACCEPTED, each tamper REFUSED (`r{78,82,77,77-serial,81,73}-b50.out`) |

  Base trees, each a `git archive` extraction + the fold's own recipe: B50 red `tmp/b50/base-src` (`503826b`),
  b44 `tmp/b44/base-src` (`d646ceb`), h14 `tmp/h14/src` (`5086be1`), h13 `tmp/h13/src` (`cd19905`), b46
  `tmp/b46/base-src` (`a81e826`) + `tmp/b46/base49-src` (`7c4e661`), b47 `tmp/b47/base-src` (`8a9f638`).
- **Every committed published dir, listed one by one** (`docs/evidence/phase-7/repro/b50-dirs-after.out`):
  36 dirs; 24 ACCEPTED one by one (`phase-2/auction`, `phase-4/cli`, `phase-5/buyback-run3/cold`,
  `phase-5/buyback-run4/cold`, `phase-5/markets/buyback/{buyback-r1,buyback-r2}-cold`,
  `phase-5/markets/drop-a19/drop-cold`, `drop-a20`, `drop-a22`, `drop-a23`, `drop-a24`,
  `phase-5/markets/launch-a18/launch-cold`, `phase-5/markets/launch/cold-f1170469`,
  `phase-5/markets/otc/{otc-match,otc-nomatch}-cold`, `phase-5/markets/revision/revision-cold`,
  `phase-5/markets/rfq/rfq-cold`, `phase-5/y2/cold`, `y2-h7/cold`, `y2-r28/cold` (its documented
  `--legacy-unattested` re-verification), `phase-6/doc/walk/public`, `phase-6/markets/launch-r34/launch-cold`,
  `phase-6/rg/auction-core/auction`, `phase-7/h15-live/public`). The other 12 carry pre-existing
  standalone gaps and are byte-identical to the pristine `503826b` run (the per-dir verdict diff before/after
  is empty — B50 changed no committed dir's verdict): `phase-3/settle/{cancel,main}` and
  `phase-6/rg/settle-crash/settle/{cancel,main}` (legacy snapshots whose `signer.json` lives one level up;
  `settle-crash/main` is legacy-format under a Phase-5 manifest, refused by the R82 `format` gate), the three
  live-regression/cli + `phase-6/rg/cli-auction/cli` docs (stray claims whose per-row map attestation is not
  in their own docs — they publish no custody maps), `drop-a17`/`drop-a18` (balance-refund rows of the
  pre-R41 shape), `drop-r33` (its pre-floor bond block refuses at manifest read) and `drop/drop-cold`
  (pre-v5 auction.json schema at load).

### Disclosures (the degrees of freedom the design left open)

1. **H3's named rows are the minority pool's.** The typed refusal names the rows in the pool with FEWER
   payment outputs (kept pool: the most outputs, ties to the earliest output's pool,
   `settle/build-outcome.ts` `onePoolRefusal`) — those wait in the exception queue with their reason and
   "the batch's other rows" settle next, exactly the design's proof sentence. When two hosts' candidates
   split differently the refusals are disjoint, and the existing R46 machinery isolates the batch (one row
   per batch — a one-row batch can never span two pools — so every row still pays).
2. **H7's no-payment defaults/bond_void publish unattested.** With zero receipts nothing was paid under the
   list (the equal-balance swap needs paid rows and receipts), the map tie-break has no paying batch to bind
   to, and the next settle re-derives and re-pins the unpaid rows. Any settlement WITH a receipt still
   refuses an unattested list (`h7-paid-unattested-defaults-refused` green on both legs). Residual: the
   published no-payment record can mis-state which leaf defaulted until the next settle corrects it; money
   never moves under it.
3. **The b47 stub's `benzo-pczt inspect` did not model the real tool** (it omitted `consensus_branch_id`,
   `tx_version`, `actions`, `inputs`); H5's shapes caught it. The stubs (`b47-settle-e2e.ts`'s own, the B50
   shared copy `b47-world.ts`, and `h-fixtures.ts`) now emit exactly `settle/src/main.rs`'s inspect shape,
   and every fold was re-run green after (the b47 fold's own file changed only in its stub source).
4. **The h10 fold's `sign-derivable-substituted-refused` check was updated to H21's contract** (the tagged
   refusal replaces the exit-3 whole-listing refusal), the same intentional-contract update as one b48 check.

### Questions

1. **Twelve committed dirs do not verify standalone today (pre-existing, unchanged by B50).** The listing
   above names each and its refusal. None is a B50 regression (identical verdicts on pristine `503826b`),
   but if the head wants them to verify standalone I can give each the r82-style assembly (parent
   `signer.json`), republish the stale balance-refund/claims snapshots, or document them as historical
   snapshots the replay folds cover — say which.
2. **H3's naming rule is a reading.** "exit 3 with the named rows, and the rows wait in the exception queue" plus "the batch's other rows still pay" pins a SUBSET naming; I chose the minority pool's rows (disclosure 1).
   If the head meant "name every row and let the run's other batches pay", the worker would set the whole
   batch aside — but then the same rows re-derive into the same batch forever, so I read it the other way.
3. **H7's unattested no-payment defaults** (disclosure 2): acceptable as a disclosed residual, or should a
   no-payment settlement publish NO defaults at all (with `balances`/`accounting` relaxed to compute the
   exception rows against the plan's list instead)?


## Batch B48 (Builder B, branch `b48-p3s`, from `5535b74`) — H18: Reviewer R's three P3s

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb`, no testnet, no wallets, no
live Playwright; the worktree carries its own `.env` (from `.env.example`) and its own `.benzo/bin` tool dir;
the fixture beacons are the established one-time past-quicknet fetch). Spec:
`docs/design/phase7-b48-p3s.md`. Worktree `../benzo-b48`, branch `b48-p3s`, base `5535b74`. Commits
`--no-verify` (R32): `9293b20` (fix 1), `a4e86c4` (fix 2), `4b1a566` (fix 3 + the rebuilt verify bundle),
`2800e0e`/`2c638c2`/`8eefbda` (the proof repro and its red-before leg), then the evidence/status commit.
Product edits touch only `cli/host-derive.ts` (sellerBinding comment), the three `sign` callers,
`cli/commands/seller.ts` and the `--openings-cache` path check in `cli/commands/verify.ts` — nothing in
`settle/*`, `api/public-auction.ts`, the classify prefetch or the reserve-return gate (B49's files).

### The three fixes, each with its proof (`tools/repro/b48-p3s.ts`, red-before/green-after)

Red-before drives the PRISTINE `5535b74` bundles (built from a `git archive` extraction into
`tmp/b48-base-src`, the folds' recipe — no second worktree); green runs this tree. Green: 17 checks,
`RESULT PASS` (`docs/evidence/phase-7/repro/b48-p3s-after.out`). Red-before: `RESULT FAIL (5)` with exactly
the five behaviour changes red and every unchanged refusal green
(`docs/evidence/phase-7/repro/b48-p3s-before.out`).

1. **A seller-commitment mismatch refuses only the seller row, and only when the batch has one (P3-1).**
   The binding values (`bound`/`legacy`/`mismatch`) are unchanged (`cli/host-derive.ts:293-302`); the
   refusal is now gated on the batch actually carrying a seller row, in the caller that knows its batch:
   `cli/commands/sign-build.ts:51-54` (this batch's `rows.json` has a `seller` row),
   `cli/commands/sign-approve.ts:102-109` (the inspected candidate has the seller output — exactly the
   output the mapping below would accept as `seller`: the packet's `seller_ua` for the result's seller
   amount; the old whole-packet pre-check at :83-85 is folded into it),
   `cli/commands/sign-derivable.ts:38-42` (the row listing has one: `payout !== "0"` and a named
   `seller_ua`, the listing's own push condition at :45). Proof: a mismatched-`seller_ua` packet whose
   batch has NO seller row **builds and approves its refund rows** (`p31-build-refund-rows-built`: exit 0,
   the three leaf refunds built and paid to the derived refund address, nothing to the substitute;
   `p31-approve-refund-rows-approved`: exit 0, approval recorded) and `sign derivable`'s seller-less
   listing comes out (`p31-derivable-no-seller-row-lists-refunds`: exit 0, exactly the refund rows).
   The same packet with the seller row is refused for that row only, typed, `refused-rows ["seller"]`,
   exit 3, nothing built/recorded (`p31-build-seller-row-refused-typed`,
   `p31-approve-seller-row-refused-typed`, `p31-derivable-seller-row-refused-typed` — all three also
   green on the base tree, i.e. unchanged). Red-before: the first three were the P3's deadlock — the
   base refused the WHOLE packet (`refused-rows ["seller"]`, exit 3) on refund-only batches too.
2. **`seller check` requires the signed manifest (P3-2).** `cli/commands/seller.ts:22-28`: a raw manifest
   object is refused with exactly one ERROR line telling the seller to pass the published `manifest.json`;
   the signed packet passes and `--signer HEX` must be exactly the signing key (unchanged). Proof:
   `p32-raw-manifest-refused` (exit 1, 1 ERROR line naming manifest.json — red-before printed the false
   all-clear `{"signer":null,…}` at exit 0), `p32-signed-packet-passes`, `p32-right-signer-passes`,
   `p32-wrong-signer-refused` (`untrusted manifest/receipt signer`, exit 1).
3. **`verify --openings-cache` reads only the host's own cache file (P3-3).**
   `cli/commands/verify.ts:72-81`: the resolved path must be exactly
   `$BNZ_STATE_DIR/auctions/<the dir's auction id>/openings.json` (the B43 lexical check, unchanged) AND
   the file at it must BE the host's own plain file there — a link standing in for a cache copied
   elsewhere is refused (`cli/commands/verify.ts:81`). Proof: a cache copied elsewhere is refused — named
   directly (`p33-copied-cache-refused`, the B43 message) and as a link at the host's own name
   (`p33-link-standing-in-refused`, the new message — red-before READ the copied cache through the link
   and passed), while the host's own cache works as before (`p33-own-cache-works`,
   `p33-restored-own-cache-works`, exit 0).

### Commands run (worktree `/Users/akshmnd/Dev Projects/benzo-b48`), each with result

- Setup: `npm ci` OK (pinned lockfile); `cargo build --release --locked --manifest-path settle/Cargo.toml`
  OK; untracked `vendor/nu7` copied from the main checkout into the worktree (gitignored build input, the
  B45 practice) for that cargo build; `GOBIN=$PWD/.benzo/bin go install github.com/drand/tlock/cmd/tle@v1.2.0`
  OK (the e2e's tle, into the worktree's own `.benzo`).
- Green bundles `npm run build:core && npm run build:settle && npm run build:cli` OK;
  `npm run build:verify` rebuilt the shipped verifier bundle with the fix 3 check —
  `dist/benzo-verify.mjs` sha256 `7bde83849ddf…` and `docs/verify-bundle.sha256` updated and committed
  together in `4b1a566` (R32: the verify bundle changed, so it is rebuilt and committed with its sha file).
- `npm run typecheck` clean; `npm run check:structure` `OK check:structure (214 files)`;
  `npm run check:invariants` `{"fails":{"I1":0,"I2":0,"I3":0,"I4":0}}` ×2;
  `npm run check:dist-require` OK; `npm run check:bundle` `OK check:bundle 7bde8384… dist/benzo-verify.mjs
  and docs/verify-bundle.sha256 match a fresh rebuild of this tree` (observed PASS here despite R32's
  "cannot pass in a worktree" — reported as seen; all commits still `--no-verify`).
- `npm run e2e` — `PASSED default seal in the browser, open with tle after R (39 s)` —
  `docs/evidence/phase-7/repro/e2e-seal-open-b48.out`.
- `node tmp/b48.mjs` (the new proof) — `RESULT PASS`, 17 checks —
  `docs/evidence/phase-7/repro/b48-p3s-after.out`; the red-before leg on pristine `5535b74` bundles
  (`BNZ_B48_BENZO=tmp/b48-base-src/cli/dist/benzo.mjs`) — `RESULT FAIL (5)`, the five changes above —
  `docs/evidence/phase-7/repro/b48-p3s-before.out`.
- **Folds all green** (raw outputs `docs/evidence/phase-7/repro/*-b48*`, each `RESULT PASS`):
  `h10-seller-binding` 22/22 (`h10-seller-binding-b48.out` — its C1 substituted-address refusals are the
  seller-row-in-play cases, unchanged by fix 1), `h13-host-scale` both legs (base bundles from pristine
  `cd19905` via `git archive` → `tmp/b45/base-tree`, its own `build:core`+`build:cli`, `cli-dist` copied to
  `tmp/b45/base/cli-dist`; before 8 checks, after 38 checks — `h13-host-scale-b48-{before,after}.out`),
  the b47 settle e2e green leg `node tmp/b47.mjs after` 28/28, cases (a)–(f)
  (`b47-settle-e2e-b48.out`; the b47 red legs' base is `8a9f638`, untouched by this batch and not re-run —
  B47's evidence stands).

### Proof detail — what changed where (the five reds on the base tree)

| check | base `5535b74` | this tree |
|---|---|---|
| `p31-build-refund-rows-built` | exit 3 `refused-rows ["seller"]`, nothing built (the P3 deadlock) | exit 0, the 3 refund rows built and paid |
| `p31-approve-refund-rows-approved` | exit 3 `refused-rows ["seller"]`, no approval | exit 0, approval recorded |
| `p31-derivable-no-seller-row-lists-refunds` | exit 3 whole listing refused | exit 0, the 3 refund rows listed |
| `p32-raw-manifest-refused` | exit 0 `"matches":true`, `"signer":null` (false all-clear) | exit 1, one ERROR line naming manifest.json |
| `p33-link-standing-in-refused` | exit 0 — the linked copy was read as the host's cache | exit 1, `not a link to a cache copied elsewhere` |

## Questions (B48)

1. **P3-3's delta: the design sentence describes a check that already exists.** "Refuse unless the resolved
   path is exactly `$BNZ_STATE_DIR/auctions/<the dir's auction id>/openings.json`" is the B43 lexical check
   (`cli/commands/verify.ts:82`, unchanged message, still green in the h13 fold — a cache named at any
   other path was refused before this batch too). What B48 adds is the on-disk pin at `cli/commands/verify.ts:81`:
   the file at that path must BE the host's own plain file there, so "a cache copied elsewhere is refused"
   now holds in both senses — named directly, or as a link standing in for one at the host's own name
   (`p33-link-standing-in-refused`, red on the base tree). If the head meant a different delta — pinning the
   cache to the host identity (the review's alternative), or full `realpath` containment — say so and I will
   reshape it. Residuals kept deliberately: the flag and `BNZ_STATE_DIR` are both caller-controlled (a third
   party running the public `benzo verify` can still stage a file AT the host's own path — verdict-safe per
   the review's own analysis), and a hard link at the host's own name is indistinguishable from the host's
   own file by path + `lstat` alone.
2. **"The batch" for `sign derivable` is a reading decision.** The command has no batch; I read "a batch
   with/without a seller row" as its row listing with/without one (the listing's own push condition:
   `payout !== "0"` and a named `seller_ua`, `cli/commands/sign-derivable.ts:42,45`). So a MISMATCHED
   `seller_ua` with a live seller obligation is still refused whole (`exit 3`, `refused-rows ["seller"]`, as
   today) — and at settle time `hostDerivable` then answers nothing and the run stops at "no signer host
   could list its derivable rows" until the config is fixed. What is unblocked is exactly the P3's case:
   batches without a seller row (build/approve) and listings without one. If the head wants `derivable` to
   list the refund rows and refuse-tag only the seller row instead of exiting 3, that is a small change.
3. **`sign approve`'s "batch has a seller row" is detected on the candidate.** The batch has one exactly
   when the candidate carries the output the mapping would accept as `seller` (recipient = the packet's
   `seller_ua`, amount = the result's seller payout — `cli/commands/sign-approve.ts:106-107`). A candidate
   whose seller output deviates from that shape (e.g. it pays the COMMITTED address while the packet's
   config mismatches, or the wrong amount) is refused untyped (`output N is not a row this signer derived`,
   exit 1) rather than typed `refused-rows ["seller"]` — still a refusal, but the coordinator would retry
   rather than set the row aside. Say if the typed refusal is wanted there too (the detection would need
   the committed address surfaced from `deriveRows`).
## Batch B49 (Builder B, branch `b49-paid-mined`, from `7c4e661`) — "paid" means this host approved it and sees it mined (Reviewer R round 2: P0-1, P1-1, P2-a, P2-b)

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb`, no testnet, no wallets, no
live Playwright; stubs as b47, own tmp state and builds only). Spec:
`docs/design/phase7-b49-paid-means-mined.md`. Worktree `../benzo-b49`, branch `b49-paid-mined`, base
`7c4e661`. Commits `--no-verify` (R32): `cbf5e6b` (product + rebuilt verify bundle and its sha), `7d2778d`
(the (a)–(f) proof cases), plus the b47/folds/status commit. The verify bundle changed and was rebuilt and
committed with `docs/verify-bundle.sha256` (`edaefec7…`, was `f146a894…`); `check:bundle` PASSES in this
worktree (`OK check:bundle edaefec7… dist/benzo-verify.mjs and docs/verify-bundle.sha256 match a fresh
rebuild of this tree`).

### The "paid" predicate (design items 1–2)

One shared function, `settle/deposits.ts:165` `paidByOwnLedger(receipts, ownLedger, ownScan, tip)`
(`PAID_CONFIRMATIONS = 10` at `:164`). A published receipt counts ONLY when both hold:

1. **approved here:** our own ledger holds that `txid` with that row among its mapped outputs **at that
   amount** (a signer host's `approvals/<id>/ledger.json` `mapped`, or the plan's settle ledger's confirmed
   obligations); and
2. **mined here:** our own vault scan shows the txid mined and deep — a note with `spent_in_txid = txid`
   (the transaction spent one of this vault's notes) AND a note of that txid at a height ≤ our own tip and
   ≥ 10 confirmations deep (the transaction's own note in our scan is the scan's evidence of its mined
   height; see Question 1).

Packet receipts are only an index and are never trusted on their own. It is used by both gates:

- `settle/plan.ts:398` — the plan's reserve gate, over the coordinator's own settle ledger
  (`ownPaid` collected at `:82-86`) and its freshest scan;
- `cli/host-derive.ts:395` — `deriveReserveReturn`'s gate, over this host's own approval ledger and its own
  `ownScan`, with its own `chainTip`.

`reserveReturnOutstanding` is unchanged; both callers pass it the filtered list. P2-b falls out of the
rule: a transaction a reorg un-mines loses both scan traces, so its row is outstanding again (case (c)).

### Prefetch hardening (design item 4, P1-1)

`cli/host-derive.ts:159` — the classify prefetch passes the classifier only candidate strings that are
non-empty and carry no control character, and `:172` wraps the whole prefetch in a catch (it is an
optimization and decides nothing). Per-row verdicts are unchanged: `openDestination`'s null contract
refuses such a destination exactly as before, so the row is underivable/refused and the batch proceeds
(case (e) proves both halves). `classifyAddresses` itself is untouched (the reviewer's P3-1 alternative
would change the wrapper's contract — see Question 5).

### Ledger namespace change and migration (design item 5, P2-a)

`settle/deposits.ts:186` `canonicalSourceId` — every approval-ledger source is one canonical note identity
`<txid>:<pool>:<action_index>` (the settle ledger's refund-backing identity): `deposit:…` and
`balance-late:…` forms normalize to it, non-note sources (`seller`, `treasury`, `leaf-deposit:…`,
`balance-excess:…`) pass through. `cli/commands/sign-approve.ts` writes every source canonical (`:108,
:113, :119`) and **migrates old entries on read** (`:142-149`, normalized and rewritten once), so a
reserve-return candidate collision-checks against ordinary batches and vice versa. The same ledger entry
now records `mapped` — each mapped output at its amount (`:105`) — which is what the paid rule's ledger
half reads (the signed map stays `{party, output_index}` as before).

### Verify: change + disclosure (design item 3)

`benzo verify`'s rule is unchanged and **disclosed**: `api/public-auction.ts:74-79` — the receipts trust
label is now `host-attested` (was `chain-receipt`) with the disclosure that verify checks receipt
attestation, not on-chain inclusion; inclusion is checked by the signer hosts before any reserve return.
The same disclosure is in `docs/guide-operator.md`. Cheap check added (`:641-650`): when the published doc
carries the batch txids and their heights, every receipt's txid must be one of the published MINED batch
txids. Docs without `settlement.batches` (legacy summaries, the repro fixtures) skip it — see Question 4.

### Red/green per case (a)–(f) (`tools/repro/b46-reserve-return.ts`, `tools/repro/h-fixtures.ts`)

Red on the base `7c4e661` bundles (tmp/b46/base49-src), green after. Raw:
`docs/evidence/phase-7/repro/b46-reserve-return-b49-before.out` (8 checks) and
`…-b49-after.out` (53 checks), 0 FAIL each.

| case | red on `7c4e661` | green after |
|---|---|---|
| (a) cancelled auction, unclaimed strays, fabricated packet receipts | PASS `a-red-fabricated-receipts-build-the-sweep` — the hosts BUILD the 1,009,999-zat sweep on receipts with no rows, no maps, no chain reality | PASS `a-fabricated-receipts-refused` — typed refusal naming both strays (`still owes 2 outstanding`), no build.json |
| (b) receipts of an approved but never-broadcast batch | PASS `b-red-dead-batch-receipt-builds-the-sweep` + `b-red-dead-batch-receipt-plans-the-return` — hosts and plan proceed on the dead batch's receipt | PASS `b-dead-batch-receipt-refused` (host, stray named) + `b-dead-batch-plan-waits` (`reserve return waits: 1 outstanding`) |
| (c) receipt whose transaction was mined then reorged out | PASS `c-red-reorged-receipt-builds-the-sweep` — the base still treats the row as paid | PASS `c-reorged-receipt-refused` — the row is outstanding again, the return refused |
| (d) honest: approved, mined and 10 deep | (no hole to show) | PASS the F section (`sign-build/derivable/approve-honest-passes`, 37,000 = 57,000 − 20,000) + `d-nine-deep-refused` (9 deep does not count yet) |
| (e) the two crafted envelopes (empty refund; NUL and newline) | PASS `e-red-crafted-envelopes-freeze-derivable` — `sign derivable` exits 1 `refused: destination` for every host | PASS `e-crafted-envelopes-never-crash` + `e-crafted-rows-underivable-batch-proceeds` — completes like the clean packet, each crafted row underivable (its claim opens to a garbage refund), the batch proceeds |
| (f) cross-kind re-spend (the sweep vs a live ordinary batch's source note) | PASS `f-red-cross-kind-respend-approved` — both approved (two source namespaces) | PASS `f-cross-kind-respend-refused` — refused via the migrated pre-B49 entry (`<txid>:ironwood:0 is in batch 2, which can still mine until 100500`); this is the migrate-on-read proof too |

### `bin/benzo settle` end to end (`tools/repro/b47-settle-e2e.ts`) — every b47 case green

`docs/evidence/phase-7/repro/b47-settle-e2e-b49-after.out` (28 checks, 0 FAIL) and `…-b49-before.out`
(7 checks, 0 FAIL — the exact R107/R107b live signatures on pristine `8a9f638`, plus the same-world
red/green pair). Harness: the stub chain's change note now carries the transaction's own txid (the scan's
mined-height evidence) and the seeded world records each host's batch-1 approval as the real `sign
approve` does. **Case (a)'s wait moved one gate earlier** (Question 2): the return now waits at the shared
paid gate (`reserve return waits: 5 outstanding`, no return batch allocated) instead of reaching the live
`InsufficientFunds` build failure at 0-conf — the case's own headline ("ordinary batches pay every row
while the return waits") holds; cases (b)–(f) unchanged and green.

### Folds and checks

| command | result |
|---|---|
| `npx tsc -p tsconfig.json` | 0 errors |
| `npm run -s check:structure` | `OK check:structure (213 files)` |
| `npm run -s check:invariants` | `{"fails":{"I1":0,"I2":0,"I3":0,"I4":0}}` ×2 |
| `npm run -s check:dist-require` | OK |
| `npm run -s check:bundle` | OK `edaefec7…` (bundle + sha committed) |
| `npm run -s e2e` | `PASSED default seal in the browser, open with tle after R (41 s)` |
| b44-opener fold | before 25/0, after 29/0, RESULT PASS both (`*-b49-*.out`) |
| b45-classify fold | 14/0, RESULT PASS |
| b45-envelope-parity fold | 24/0, RESULT PASS |
| b46-reserve-return fold | before 8/0, after 53/0, RESULT PASS both |
| b47-settle-e2e fold | before 7/0, after 28/0, RESULT PASS both |
| h10-seller-binding fold | 22/0, RESULT PASS |
| h13-host-scale fold | before 8/0, after 38/0, RESULT PASS both |
| h14-open-griefing fold | before 12/0, after 14/0, RESULT PASS both |

### Commands run (worktree `/Users/akshmnd/Dev Projects/benzo-b49`)

- Setup: `node_modules` symlinked from the main checkout (identical `package-lock`), `vendor/nu7` copied
  (sha256-pinned crates), `npm run build:core && npm run build:settle && npm run build:cli` (includes
  `cargo build --release --locked`) and `npm run build:verify`; base trees `git archive` + each fold's own
  recipe: `tmp/b46/base-src` (`a81e826`), `tmp/b46/base49-src` (`7c4e661`), `tmp/b47/base-src` (`8a9f638`),
  `tmp/b44/base` (`d646ceb`), `tmp/b45/base` + `tmp/h13/src` (`cd19905`), `tmp/b43/base` + `tmp/h14/src`
  (`5086be1`). All OK.
- Repros: `node tmp/b46.mjs before|after`, `node tmp/b47.mjs before|after`, `node tmp/h10.mjs`,
  `node tmp/b45-classify.mjs`, `node tmp/b45-envelope-parity.mjs`, `node tmp/b44.mjs before|after`,
  `node tmp/h13.mjs before|after`, `node tmp/h14.mjs before|after` — every one `RESULT PASS` (counts
  above; raw outputs `docs/evidence/phase-7/repro/*b49*`).
- Gates: `typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `check:bundle`,
  `npm run e2e` (the worktree's own `.env` from `.env.example` and its own pinned `tle`/`grpcurl` built
  into its own `.benzo/bin` via `go install` at `tools/pins.env` tags) — all pass (table above).
- Offline only throughout: stubs and own tmp state/bundles; one drand beacon fetch per repro run (the
  established h-fixtures machinery, past quicknet round 32704232).

## Questions (B49)

1. **The scan carries no spend height, so the mined height is read from the transaction's own note (its
   change back to the vault).** The design says "a vault note with `spent_in_txid = txid` and a height";
   benzo-scan's rows carry only the NOTE's height, never the spend's, and a staged (unmined) spend still
   shows `spent_in_txid` (the wallet records proposals), so the literal reading would leave P0-1's
   scenario B open. I implemented the secure reading: `spent_in_txid = txid` on some vault note AND a
   vault note of `txid` itself at a height ≤ tip and ≥ 10 deep (`settle/deposits.ts:165-183`). One
   consequence: a refund batch that spends exact inputs and leaves NO change has no scan-visible mined
   height, so its receipt never counts and the return waits (the conservative direction — nothing is at
   risk, and the wallet nearly always makes change). If you want that case unblocked, the clean fixes are
   (a) benzo-scan emits the spending transaction's `mined_height` next to `spent_in_txid`, or (b) the gate
   also accepts this host's own `minedHeight()`/`GetTransaction` evidence; say which and I will make it.
2. **b47 case (a)'s manifestation changed by design.** The 10-confirmation rule means the return pass now
   waits at the paid gate at 0-conf (no batch 2 allocated, no `InsufficientFunds` line) instead of dying
   in the host build. The case's headline holds and its checks were re-aimed (`a-return-waits-at-the-paid-gate`,
   `a-no-return-attempt`, `a-no-return-batch`). The R107b red leg still seeds the exact old crash world.
   If the old assertions must literally survive, the only way is to weaken the depth rule — not recommended.
3. **Approval entries recorded before B49 carry no mapped amounts.** The ledger half of "paid" needs
   "that row at that amount"; an old entry attests only `{party, output_index}`, so a receipt whose only
   approvals predate B49 counts as unpaid and the return waits until the batches are re-approved or the
   rows re-paid. That is the conservative direction and no live funds are exposed; if a smoother upgrade
   matters, one option is to accept `{party, output_index}`-only entries for a bounded window.
4. **Verify's mined-batch check is conditional on the doc publishing `settlement.batches`.** The design's
   "if the published doc already carries the batch txids and their heights" reads as conditional, so docs
   without a `batches` array (legacy Phase 2/3 summaries, the repro fixtures) skip it. Making it
   unconditional would break the legacy folds unless their batch lists are backfilled. Say the word if
   you want it strict everywhere.
5. **P3-1 is deliberately not fixed inside `classifyAddresses`.** The reviewer's alternative (classify
   `""` exactly as the raw tool: `kind:"other"`) would change the wrapper's stated contract and the
   per-row path; the design said the prefetch must pass only clean strings and verdicts must be unchanged,
   so `classifyAddresses` still throws on `""` internally while every caller is now total around it
   (prefetch filters + catches; `openDestination` catches). If you want the wrapper made total with the
   raw tool's verdicts, that is a small follow-up in `envelope/destination.ts`.
6. **`settlement.batches` stays `informational` in the trust registry** although the new receipt check now
   reads it (the check constrains receipts; the batch heights themselves are still coordinator-published
   and unverified). Promoting it to `host-attested` would need the hosts to sign heights — not in this
   design. Noted, nothing blocked.

## Batch B47 (Builder B, branch `b47-settle-worker`, from `32101ec`) — H20 + H19: settle worker robustness + the first offline end-to-end proof of `benzo settle`

**DONE, offline only** (no main-checkout `.benzo/` or `.env` read or used — the worktree carries its own
`.env` copied from `.env.example` and its own `.benzo` tool dir for the e2e gate; no OrbStack/`orb`, no testnet,
no wallets, no live Playwright). Spec: `docs/design/phase7-b47-settle-worker.md`. Worktree
`../benzo-b47`, branch `b47-settle-worker`, base `32101ec`. Commits `--no-verify` (R32): `6e5b299` (the
three worker fixes), `0eb0639` (the offline end-to-end proof + evidence), plus the folds/status commit.
Only `settle/cli.ts` (product) changed; `tools/repro/b47-settle-e2e.ts` is new test machinery.

### The three fixes (all in `settle/cli.ts`, unmodified product code proven by the e2e)

1. **Broadcast idempotence (H20 item 1)** — `settle/cli.ts:440-453`. A send that answers
   `transaction already exists in mempool` — the resend after a lost response, or a resend on a re-run —
   counts as broadcast: the worker keeps the staged txid and continues to the mined-wait. So does a send
   whose transaction has already mined (checked against this worker's own wallet `list-tx`). Any other send
   error still throws.
2. **The kept reserve_return accounting (H20 item 2)** — `settle/cli.ts:498-521`. Once the `reserve-return`
   row has a receipt, the summary keeps the published accounting instead of re-deriving it from the emptied
   vault: the paid batch's own ledger record (`batch-N.inspect.json` — the candidate swept the whole unspent
   value, so `input_zats` is the recorded remaining and `fee_zats` the recorded fee; sanity-checked
   `remaining − fee = amount` against the paid receipt), falling back to the already-published doc's
   `settlement.reserve_return`. `benzo settle`'s republish then succeeds and produces the identical public
   dir; a re-run of a fully settled auction exits 0 and changes nothing.
3. **Fee-reserve preflight (H19)** — `settle/cli.ts:325-355`. Before the first batch of a run (after the
   pin, before any allocate/build/broadcast): spendable value (unspent positive notes with the manifest's
   confirmations — the wallet's rule) versus the remaining unpaid obligations plus the fee upper bound
   `5,000 × (spendable notes + remaining rows + remaining batches)`. Short: `ERROR settle fee reserve short:
   pay N zats to <fee_reserve_ua> and run benzo settle again` with N = shortfall + ceil(shortfall/10),
   before any broadcast and never inside a host build. The reserve-return row never counts as an obligation
   (it pays itself out of the sweep) but its row and batch count in the fee bound; with ONLY the
   self-funding return left the preflight is skipped, so the return pass keeps its own live failure mode
   (the change-not-spendable case, case (a) below).

**No new product test seam.** The driver's fake chain and its stub config are passed to the stubs through
`BNZ_TEST_CHAIN` and `BNZ_TEST_STUBS`, read ONLY by test stub code and refused by those stubs when
`BNZ_NETWORK=main`; shipped code never reads either. Everything product-side runs through existing seams:
`BNZ_STATE_DIR`, `BNZ_PCZT_BIN`, `BNZ_SCAN_BIN`, `BNZ_LWD_URL`/`BNZ_LWD_URL_ALT`, `BNZ_DRAND_URLS`,
`BNZ_FROSTD_HOST`, `PATH` (the orb/orbctl stubs).

### The offline end-to-end proof (`tools/repro/b47-settle-e2e.ts`)

The REAL `bin/benzo settle --id ID` worker — wrapper, plan, worker, publish, host commands, ledger — runs
unmodified end to end against stubs (fixture world per case, all under `tmp/`):

- **a small REAL auction fixture** (`tools/repro/h-fixtures.ts buildAuction`): 4 real tlock ciphertexts to a
  past quicknet round (the authentic beacon fetched once, as every h-fold does), a signed manifest with the
  H10 `seller_ua_commitment` and the B46 `reserve_return_ua_commitment`, the frozen set, envelope records
  and a cleared result `benzo verify` re-derives; plus the two agreeing signed `envelope-opens` reports the
  plan gates the leaf refunds on;
- **a stub chain/wallet** (one shared chain-state file the driver controls): stub `benzo-scan`,
  `zcash-devtool` (wallet sync/balance/list-tx, `pczt extract/prove/redact/send[-without-storing]`),
  `grpcurl` (GetLatestBlock/GetTransaction/GetBlock/GetBlockRange) and `benzo-pczt` (create/inspect/
  ufvk-ak/owns/address; `classify-address` delegates to the REAL audited binary). Every candidate is a
  small JSON body whose sha256 IS the txid everywhere (extract, inspect, maps), so the receipts, the two
  agreeing host maps and the chain agree exactly. The create stub refuses with the real wallet's
  `InsufficientFunds { available…, required… }` line when the rows plus the ZIP-317 fee exceed the MATURE
  spendable notes (the live change-needs-10-confirmations case), and `send_mode: "mempool"` makes the next
  send answer the live resend error while recording the transaction, which the next wallet sync mines —
  the stub records broadcasts, answers "already in mempool" and mines on command (list-tx);
- **a stub `orb`/`orbctl` on PATH**: push/pull map `/home/benzo/<x>` onto each host's own world dir and the
  three host `benzo sign build|approve|derivable` commands (and `sign join`) run the REAL shipped
  `cli/dist/benzo.mjs` locally against three per-host state dirs (each with its own envelope key, witness
  key, DKG group and stub toolchain, the `tools/repro/b42-hosts-cli.ts`/`h-fixtures.ts` machinery). The
  FROST layer is stubbed at the `frost-client`/`zcash-sign` boundary (the documented h-fixtures stub class):
  the coordinator prints the session signature once both participants joined and the participant prints the
  approved sighash on the prompts the REAL `benzo sign join` (approval check included) answers.

**Green — cases (a)–(f), each one `bin/benzo settle` invocation or a sequence**
(`docs/evidence/phase-7/repro/b47-settle-e2e.out`, `RESULT PASS`, 33 checks):

| case | result |
|---|---|
| (a) ordinary batches pay every row while the return waits | PASS — exit 0, all 5 rows receipted (4 leaf refunds + seller, 4,000,400 zats), one broadcast; the return pass fails in the host build with `InsufficientFunds { available: Zatoshis(0), required: Zatoshis(35000) }` and prints the live line `ERROR reserve-return pass exited 1; the reserve stays in the vault until the next benzo settle`; batch 2 is left allocated and unmined |
| (b) the return is planned after the last batch mines | PASS — after the change matures (one `settle` re-run): built, approved by both hosts, broadcast and mined (`25,000 = 35,000 − 10,000 fee` — the exact live amounts), the receipt recorded, the published accounting `{remaining_zats:35000, fee_zats:10000}`, the vault swept to zero |
| (c) the broadcast answers "already exists in mempool" | PASS — both armed sends (the ordinary batch and the return) error with the live `Send failed: (-1) transaction already exists in mempool`, the worker counts each as broadcast, continues to the mined-wait and records every receipt (6/6); both settles exit 0 |
| (d) a re-run after the return | PASS — exit 0, the published dir byte-identical (all 10 files, sha256-compared), the same 6 receipts |
| (e) an under-funded reserve | PASS — the preflight stops the run with exactly `ERROR settle fee reserve short: pay 55000 zats to <fee_reserve_ua> and run benzo settle again` (N computed independently in-test: shortfall 50,000 + 10%), nothing broadcast and no host build; topping the stub up with exactly 55,000 zats completes the settlement (return accounting published) |
| (f) a legacy manifest | PASS — settles (exit 0) with no return row/receipt/accounting and its one `WARN the reserve stays in the vault (legacy, H15)` line per plan run (2 lines for 2 plan runs), no waits line |

**Red on the base bundles built from pristine `8a9f638` (pre-R107), same driver**
(`docs/evidence/phase-7/repro/b47-settle-e2e-red.out`, `RESULT PASS`, 7 checks). The e2e would have caught
R107 and R107b had it existed:

- **(a)-red (R107):** the first `benzo settle` refuses before paying anything — the exact h15-live
  signature, three hosts × `sign derivable refused-rows ["reserve-return"]: the auction still owes 5
  outstanding (strays/balances/exceptions)…`, then `ERROR settle refused: no signer host could list its
  derivable rows`, exit 1, nothing broadcast, no receipt. (Same fixture as green (a).)
- **(b)-red (R107b):** the return pass on the exact world the live run was in at the crash — batch 1 paid
  and its settlement published (5 receipts), the return row allocated to batch 2 after its failed build
  attempt (seeded through the REAL `settle/ledger.ts` Ledger class, published through the REAL
  `publish()`), the change now spendable — crashes with the exact live line
  `ERROR settle Cannot read properties of null (reading 'amount_zats')`, exit 1. The identical seeded
  world settles green on this tree (the same-world red/green pair, `b-green-same-world` PASS).

### Commands run (worktree `/Users/akshmnd/Dev Projects/benzo-b47`)

- `tools/nu7/build.sh crates vendor/nu7 pczt-0.9.3 zcash_primitives-0.30.1 zcash_protocol-0.10.5` (the
  sha256-pinned crates materialize in every fresh worktree) and `npm ci`; green bundles
  `npm run build:core && npm run build:settle && npm run build:cli` (includes
  `cargo build --release --locked`); base bundles `git archive 8a9f638` + `cli/build.mjs` + the three
  esbuild bundles (the `before` leg) — all OK.
- `node tmp/b47.mjs after` → `RESULT PASS` (cases a–f, 33 checks, 0 FAIL);
  `node tmp/b47.mjs before` → `RESULT PASS` (2 red legs + the same-world pair, 7 checks, 0 FAIL).
- Gates: `npm run typecheck` PASS; `check:structure` `OK (213 files)`; `check:invariants`
  `{"fails":{"I1":0,"I2":0,"I3":0,"I4":0}}` ×2; `check:dist-require` OK; `npm run e2e` `PASSED default
  seal in the browser, open with tle after R (37 s)` (the worktree's own `.env` from `.env.example` and its
  own pinned `tle`/`grpcurl` built into its own `.benzo/bin` via `go install` at `tools/pins.env` tags).
- **Folds all green** (raw outputs `docs/evidence/phase-7/repro/*-b47*`, each `RESULT PASS`):
  `b46-reserve-return` both legs (base bundles from pristine `a81e826`), `h10-seller-binding` 22/22,
  `h13-host-scale` both legs (base bundles from pristine `cd19905`), `h14-open-griefing` both legs (base
  from `5086be1`), `b44-opener` both legs (base from `d646ceb`), `npm run e2e` above.
- `check:bundle` not run: this batch touches none of `api/`, `envelope/`, `settle/envelopes.ts`,
  `cli/commands/verify.ts`, `cli/published-beacon.ts` (the guard's trigger set).

## Questions (B47)

1. **The fee preflight's 10% margin can be one fee slot short after the top-up (H19's line).** The design
   fixes N at "the exact shortfall plus a 10% margin"; a top-up note itself adds one `5,000`-zat fee slot
   to the next run's bound, so a shortfall below ~50,000 can leave the follow-up run short by up to one
   slot (it then prints a second, smaller line). Case (e) is sized (shortfall 50,000) so exactly N
   completes; a real operator may see one extra tiny top-up line. Suggest a future ruling either keep this
   (two lines worst case, no funds at risk) or make N `shortfall + max(ceil(shortfall/10), 5,000)`.
2. **The preflight scope: obligation rows only.** The design's formula counts "the remaining unpaid
   obligations"; the reserve-return row is not an obligation (it pays itself out of the sweep — counting
   it would make the preflight permanently short). With ONLY the return left, the preflight is skipped so
   the return pass keeps its live failure mode (case (a): the change-not-spendable wait line, not a
   misleading top-up line). If the head wants the preflight to also guard the return pass's fee, say so —
   the current rule is in `settle/cli.ts:346` (`shortfall>0 && unpaid.some(non-return)`).
3. **The kept accounting's two sources are as designed ("from the ledger or from the already-published
   doc")**; I read "the ledger" as the settled batch's own ledger record (`batch-N.inspect.json`:
   `input_zats`/`fee_zats`, sanity-checked `remaining − fee = amount`), falling back to the published doc's
   `settlement.reserve_return`. If the head meant a new persisted field instead, it is a small change.
4. **Case (f)'s "one WARN line" is asserted per plan run** (the plan runs twice inside one `benzo settle`
   that finishes everything: the worker pass and the automatic reserve-return pass, so the log carries two
   lines for two plan runs). If the head wants exactly one line per `benzo settle` invocation, the plan
   would have to print it only on the first pass — a product change I did not make.
5. **The red legs' base code is exactly `8a9f638`** as the task states. Note that the live R107b crash
   happened on the R107-FIXED hosts (66d511a); on pure `8a9f638` it needs the post-batch-1 world (case
   (b)-red) because the R107 wall otherwise masks it (case (a)-red). Both legs therefore run on `8a9f638`
   bundles: (a)-red shows the wall, (b)-red shows the crash on the seeded live state — together exactly
   what the h15-live transcript recorded at each failure.

## Batch B45 (Builder B, branch `b45-classify`, from `cd19905`) — H16 P1 scale: bulk + cached address classification

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb`, no testnet, no wallets, no live
Playwright runs; the h13/h14/h11/h10 fixture beacons are the established one-time past-quicknet fetch). Spec:
`docs/design/phase7-b45-classify.md`. Worktree `../benzo-b45`, branch `b45-classify`, base `cd19905`. Four
commits, all `--no-verify` (R32): `b276703` (Rust bulk mode), `5fb59d6` (classifier module + prefetch + cache),
`c1a3af5` (b45-classify repro), `c6de1e2` (h13 re-run + spawn counts). `envelope/opening.ts` untouched (B44);
`cli/host-derive.ts` changes limited to the classify prefetch + cache.

**Outcome: the second batch now spawns `classify-address` ZERO times and host time per batch no longer grows
with N** (H16 closed pending head review):

| N | first batch before | first batch after | second batch before | second batch after | classify spawns before → after (1st / 2nd batch) |
|---|---|---|---|---|---|
| 55 | 8.4 s | 4.9 s | 4.0 s | 1.2 s | 110 → 1 / 110 → **0** |
| 1,000 | 113.1 s | 55.1 s | 61.0 s | 1.65 s | 2,000 → 1 / 2,000 → **0** |

(Second batch is flat in N: 1.2 s at 55 vs 1.65 s at 1,000 — the residual is O(N) pure row building, no
spawns. The first batch is still O(N) from the 1,000 real tlock decryptions (inherent cold cost) plus one
classifyAddresses call. Derived rows are byte-identical to the base commit's at both sizes. Sources:
`docs/evidence/phase-7/repro/h13-host-scale-b45-{before,after}.out`.)

**The bulk CLI contract.** `benzo-pczt classify-address --stdin` reads one address per line and prints one JSON
line per input, in order; each line is the exact object the single-address form prints (one shared classifier,
`classify_json`), and the bulk mode never stops on one bad line — an unparseable address prints its
`invalid_unified`/`other` object. The single-address form `classify-address <address>` is unchanged
(`b45-classify-oldnew.out`: the cd19905 binary and this binary print byte-identical single-form output on 640
inputs, `RESULT PASS`).

**The classifier module.** `envelope/destination.ts` `classifyAddresses(list)` answers from an in-process `Map`
memo keyed by the exact address string and sends only the misses to the tool — one bulk call per chunk of up to
2,000 addresses; `classifyAddress(one)` is a thin wrapper over it, so `classifyDestination`, `unifiedReceivers`,
`isUnifiedOn` and `isUnifiedOrchardOn` are answer-identical. An address whose bytes the line protocol cannot
carry (containing `\n` or `\r`) is classified through the single-address form, so its verdict is unchanged.

**Host prefetch and the cache.** In `cli/host-derive.ts`: before the per-row loop, every destination the host
derived — each published envelope record's and each claim's refund (opened with this signer's own key through
`envelope/index.ts openEnvelopeRefundUnchecked`, the same derivation `openDestination` runs per row), plus the
buyback treasury return address — is classified with ONE `classifyAddresses` call. Results persist in
`$BNZ_STATE_DIR/auctions/<id>/classify-cache.json` (mode 0600, atomic write) as
`{bin_sha256: <sha256 of the classifier binary>, entries: {"<sha256(address)>": {kind, network, receivers}}}`.
A different binary's sha256 discards the file whole; a missing or malformed file is a rebuild, never an error
(the openings-cache rule). The per-row verdicts are untouched — `openDestination` still runs the destination
rule on every row, now served by the memo — and the cache is a pure memo of the classifier's own output, so it
cannot change a verdict (proof below).

**Proofs** (all offline, raw outputs under `docs/evidence/phase-7/repro/`):

- `b45-classify.out` (**RESULT PASS**): bulk `--stdin` output is byte-identical to the single-address form on
  643 inputs (633 R24 item 3 (i) reference vectors — every kind and every network — plus 10 invalid shapes),
  in input order, never stopping on one bad line (re-checked reversed and with duplicates);
  `classifyAddresses` answers byte-identically on the same set (642; the module refuses an empty destination
  with `refused: destination` exactly as before); 2,500 unique misses → exactly 2 bulk calls (chunks of 2,000,
  5,500 inputs with duplicates classified once each); 3 newline/CR addresses → 3 single-form calls, unchanged
  verdicts. Cache purity (cold-memo child): 33 cache-served verdicts byte-identical to the classifier's own
  output for those exact addresses, zero classifier spawns, entries served only under their own
  `sha256(address)` key.
- `b45-classify-oldnew.out` (**RESULT PASS**): old (cd19905) binary == new binary, byte-identical single form,
  640 inputs.
- `h13-host-scale-b45-{before,after}.out` (both **RESULT PASS**): the table above; derived rows byte-identical
to the base commit's (canonical JSON, both N); classify-cache shape
  `{bin_sha256, entries keyed by sha256(address)}`, mode 0600, host-state only (never in the packet); and at
  N=55 a tampered `bin_sha256` discards the cache: 1 classify spawn re-derived the verdicts, the file was
  rewritten with the binary's sha256 and a byte-identical entry (`classify-cache-discarded-on-binary-change`).
- Verdict folds (byte-identical-to-main class, all PASS): `r81-destination-rule-b45.out` (seal + open +
  exception-queue verdicts), `r73-open-taddr-b45.out`, `h10-seller-binding-b45.out` (seller UA binding),
  `r40-f5-rows-b45.out`, `r78-verify-hardening-b45.out`, `r82-legacy-format-b45.out` (Phase-3 legacy dir
  replays), `r77-serial-beacon-b45.out`, `r77-receipt-b45.out`, `h11-open-offline-b45-{before,after}.out`
  (both legs; opened sets byte-identical to base), `h14-open-griefing-b45-{before,after}.out` (both legs;
  honest openings byte-identical to base). B44's own fold does not exist in this tree (B44 merges in parallel);
  nothing in this batch touches `envelope/opening.ts` or its call sites.
- `b45-envelope-parity.out` (**RESULT PASS**): the envelope-open half of item 4, base-commit bundle vs this
  tree side by side — v1 plain UA, v2 `{refund}`, v2 `{refund, deliver}`, a hostile t-addr refund, a junk
  deliver, a `{`-leading non-JSON plaintext, a bad-shape v2 doc and a foreign-key envelope: every
  `openEnvelopePayload`/`openEnvelope` result or thrown message is byte-identical (deliver included), and
  `openEnvelopeRefundUnchecked` yields exactly the parse's refund (the t-addr string included — the verdict
  path refuses it per row, unchanged) or null exactly when the key/shape layer would throw.
- Claims: the claim path is `openDestination` over an ordinary v2 claim envelope (unchanged code), so the
  parity proof above covers it; `r15-3-claim-envelope-repro.mjs` could NOT run here (`bidder UFVK unavailable`
  — it needs a prepared bidder wallet state, outside this batch's offline/no-wallet rules and absent from the
  B43 fold set): `r15-3-claim-envelope-b45.out` records the attempt.

**Commands run** (each with result):

- `cargo build --release --locked --manifest-path settle/Cargo.toml` — OK (also the bulk-mode smoke: 4 inputs →
  4 ordered JSON lines identical to the single form).
- `npm run typecheck` — OK. `npm run check:structure` — OK (209 files). `npm run check:invariants` — 0 fails
  (I1–I4). `npm run check:dist-require` — OK. `check:bundle` not run (worktree, R32).
- `npm run e2e` — PASSED `default seal in the browser, open with tle after R` (39 s; worktree-local
  `cp .env.example .env`, Go tle v1.2.0 in the worktree's own `.benzo/bin`) — `e2e-seal-open-b45.out`.
- `node tmp/b45-classify.mjs` — RESULT PASS. `node tmp/b45-envelope-parity.mjs` — RESULT PASS. `node
  tmp/h13.mjs before` / `after` — RESULT PASS both. `node
  tmp/h14.mjs before` / `after` — RESULT PASS both. `node tmp/h11.mjs before` / `after` — RESULT PASS both.
  `node tmp/h10.mjs` — RESULT PASS. `tmp/r81.mjs`, `tmp/r73/open.mjs`, `tmp/r78.mjs`, `tmp/r82.mjs`,
  `tmp/r40-f5-rows.mjs`, `tmp/r77-serial.mjs`, `tmp/r77-receipt.mjs` — all RESULT PASS (r78/r82: exit 0, no
  FAIL lines). `node tools/repro/r15-3-claim-envelope-repro.mjs` — exit 2, `bidder UFVK unavailable` (see
  the claims note above).
- Fold base bundles built from `git archive` extractions with each tree's own build recipe: `tmp/b45/base-tree`
  (cd19905, the h13 before leg + the old-new binary diff), `tmp/b43/base-tree` (e821ba0, the h14 red leg),
  `tmp/h11/base-tree` (aa0229e, the h11 red leg). Untracked `vendor/nu7` copied into the worktree and the
  cd19905 extraction for the two cargo builds (build input, like node_modules).
- Pre-existing red folds unchanged and not touched (R98 item 3, fold-repair item): `r42-f11-strays`,
  `r33-balance`.

## Questions (B45)

1. **The prefetch's "per-row loop" needed one reading decision.** Destinations only exist after each envelope
   is opened with the signer's key, and `openEnvelope` classifies the refund inside `openDestination` at open
   time — so "collect every destination the host derived" cannot precede the opens. Implemented as: before the
   per-row loops, the host opens every published envelope record and claim envelope (the same derivation
   `openDestination` runs, no verdicts — `openEnvelopeRefundUnchecked` is prefetch-only and decides nothing)
   and classifies the collected refunds with one `classifyAddresses` call; the per-row loops then run unchanged
   with memo-served classification. If the head instead meant deferring the classification out of
   `openEnvelope` (changing `openDestination`'s open-time null contract), say so — every verdict here is proven
   unchanged, so I kept the contract.
2. **"The cache can never change a verdict" holds for what the code writes.** Proven: a cache-served verdict is
   byte-identical to the classifier's output for that exact address (cold memo, zero spawns) and is served only
   under its own `sha256(address)` key; the file is written only from classifier output. A HAND-TAMPERED entry
   would be believed — same trust class as `openings.json` (host-owned 0600 state). If tamper-evidence is wanted
   (e.g. storing the verdict's own hash), that is a small follow-up.
3. **Line-protocol edges.** The bulk form is line-based: Rust `lines()` treats `\r\n` as the line ending, so a
   raw-binary input line cannot end in a bare `\r` and be distinguished from one (documented); the module never
   sends such strings — anything containing `\n` or `\r` goes through the single-address form with byte-equal
   verdicts (proven). Also `classify-address --stdin` on empty stdin prints nothing (zero inputs, zero lines).
4. **The first batch is still O(N)** — the tlock decryptions (openings) are inherent; only the classification
   cost is gone. At 17,000 bids the README limit is about the O(N²) classification plus per-batch derivation;
   with this batch the remaining per-batch cost is the O(N) cheap row building and one bulk classify. If the
   README's 17,000-bid note should now change wording, that is the head's call.
5. **B44's fold** (`tools/repro/b44-opener.ts` or the h14 extension) is not in this tree — it must be re-run at
   the merge. Nothing in B45 touches `envelope/opening.ts`, `openSealedBid` call sites, or the memo-opening
   code, so the merge should be clean; `cli/host-derive.ts` diff is confined to the prefetch block + cache
   load/save around the destination loops.

## Batch B46 (Builder B, branch `b46-reserve-return`, from `8e39c14`) — H15: the unused fee reserve returns (mainnet blocker)
## Batch B46 (Builder B, branch `b46-reserve-return`, from `a81e826`) — H15: the unused fee reserve returns (mainnet blocker), Revision R103

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb`, no testnet, no wallets, no live
Playwright). Spec: `docs/design/phase7-b46-reserve-return.md` **including the end section "Revision (head,
2026-10-19, R103)"** — this is ROUND 2 of the batch; round 1 (`8dad770`, `2f582ca`, `76ecdf8`) implemented the
superseded "eligible notes" rule and is NOT merged (its question 1 exposed the flaw: vault value is fungible, so
a source rule can return a bidder's unclaimed money once an ordinary batch swept their note into change). The
branch was rebased onto `a81e826` and the implementation reworked to the revision. Worktree
`/Users/akshmnd/Dev Projects/benzo-b46`. Commits `--no-verify` (R32): `c8bae1a` (the value-based rework),
`5db8212` (the proof), `1ccabb6` (the verify bundle `f146a894…` + the additive fixture machinery); this
bookkeeping block and the docs land next, and the evidence re-run at that clean tree follows them.

**The rule as implemented (nothing is owed, then the whole value minus the fee).** The one shared gate is
`settle/deposits.ts:100` `reserveReturnOutstanding(...)`: the return is planned and approved **only when the
auction owes nothing** — every owed row has a published receipt (party **and** amount), no published row is
unresolved (an exception row, or a row without its receipt), no published balance refund is unpaid (a `pending`
entry), and (the plan only) no batch is pending. The owed set is **our own derivation, run without requiring a
destination** — a row is owed whether or not anyone has claimed it: the money rules' obligations over the
published result (`clear/registry` `obligations`, with this signer's own `balanceSettlement`/`balanceDefaults`
rows and treasury return) **plus every stray deposit note and late/excess balance note of our own scan** (the
same `strayNotes`/`refundable`/balance rules `deriveRows` uses, over **all** scanned deposit notes — spent or
not, since a note a batch swept into change is still an unpaid stray until its receipt exists; that is exactly
the fungibility case R103 was written for). The gate returns the outstanding items, deduplicated; its length is
the waits line's N. `settle/plan.ts:388` runs it and prints exactly one line when anything is owed —
`reserve return waits: N outstanding (strays/balances/exceptions)` (`settle/plan.ts:393`) — or, on a manifest
without the commitment, the kept round-1 line `WARN the reserve stays in the vault (legacy, H15)` (plan.ts:391).
**An unclaimed stray therefore delays the return indefinitely** — the conservative choice, disclosed in
`docs/guide-operator.md` and `README.md`'s honest-limits list.

**The amount and the input checks (value-based).** `settle/deposits.ts:126` `reserveReturnAmount(notes)` pays the
vault's **whole unspent value minus the ZIP-317 fee** of the one-row transaction that spends **every** unspent
note (`5,000 × max(2, notes)`, `reserveReturnFee`, deposits.ts:143 — `settle/src/main.rs`'s standard_fee shape);
`amount_zats` is null while the value does not cover the fee, and `ids` names every note the transaction must
spend (the host approval ledger's source identities — Ruling R28 item 3 — never published). The plan's row is
`{party: "reserve-return", kind: "payout", amount_zats, remaining_zats, fee_zats}`; round 1's `sources`/
`eligible_zats` accounting is **gone**. The candidate must spend every unspent vault note: the hosts check
`inspect`'s `input_zats` against their own scanned unspent total — `cli/commands/sign-approve.ts:91` and
`cli/commands/sign-build.ts:90` refuse typedly when it differs (`… inspect input_zats 100 differs from this
signer's scanned unspent total 55000`), and the single output must be exactly that total minus the fee
(`sign-approve.ts:118`, typed; `sign-approve.ts:124` keeps the one-output rule).

**The host checks** (still ONE function `deriveReserveReturn`, `cli/host-derive.ts:293`, called from `sign
build`, `sign approve` and `sign derivable`; `deriveRows` untouched, so this merges cleanly with B45):
1) the packet's `reserve_return_ua` hashes to the manifest commitment (H10's shape; legacy refuses any packet
carrying the row); 2) the "nothing is owed" gate above, from **this host's own scan and derivation** plus the
packet's published accounting — a return while the stray is unpaid is refused typedly
(`… the auction still owes 2 outstanding (strays/balances/exceptions): …`); 3) the row pays the host's own
whole unspent total minus the fee (`cli/host-derive.ts:343`). All refusals are typed (`exit 3`,
`refused-rows ["reserve-return"]`), like H10's seller row.

**The verify accounting change** (`api/public-auction.ts` `accounting-strays`, lines 831-858, +
`SETTLEMENT_TRUST`): the published settlement may carry `reserve_return: {remaining_zats, fee_zats}` — the
vault's whole unspent value the return swept and the fee, amounts only (the destination itself is never
published, only the manifest commitment). Verify accepts **exactly one** `reserve-return` receipt, only together
with that accounting, only while the published accounting shows **nothing outstanding at that point** (no
unreceipted row, no published unpaid stray or balance, no open exception), and only at
`amount = remaining_zats − fee_zats` with a ZIP-317-shaped fee (`≥ 10,000`, multiple of 5,000). A forged second
receipt, a receipt without the accounting, or a return beside an outstanding row each fail with their own error.

**Everything else kept from round 1:** the manifest commitment (`reserve_return_ua_commitment`,
`reserveReturnUaCommitment` next to `sellerUaCommitment`, exact 64-lowercase-hex shape in `validateManifest`),
the `auction create --config` rule (H4's receiver rule; a Sapling-only UA refused) and the mainnet rule (a
manifest without the commitment is refused before the network lock), the typed refusals, the legacy line, the
one-row-alone batch rule in `settle/cli.ts`, the automatic second settle pass in `cli/product.ts`, the docs
(wording updated to the new rule), and the template/field-table entries.

**Fixture (proof):** a settled **bond-then-pay** auction (so the late-balance note is a REAL
`balance-late:` note the `clear/features.ts` rules derive — one bid, one deposit slot, one balance address, C =
the bond) whose vault holds the fee-reserve note (20,000), internal change (35,000), a stray deposit (500,000)
and an unclaimed late-balance note (499,999). The stray's claim publishes its own real tlock sealed-bid memo
(R13/R42: a paid stray row needs a published owner-signed claim whose memo hash the paying batch's two agreeing
maps attest). Settlement worlds: `outstanding` (stray + late unclaimed), `settled` (stray refunded, late paid —
both notes spent), `swept` (a prior batch spent the stray's note, its 500,000 now in internal change; the stray
row hidden and unpaid), `returned` (settled + the return row/receipt/accounting).

**Red/green per proof case** (`docs/evidence/phase-7/repro/b46-reserve-return-{before,after}.out`; red = base
bundles built from pristine `a81e826` sources BEFORE any edit under `tmp/b46/base-src/`; green = this tree):

- **red on base (nothing owed, yet no row; the value stranded)** — `red-plan-no-row-change-stranded`: the base
  plan settles everything and plans NO row; 55,000 zats of unspent vault value stay stranded.
  `red-plan-bound-manifest-unreadable`: the base schema cannot even represent `reserve_return_ua_commitment`.
  2/2 PASS.
- **green plan, nothing owed** — `plan-completes`, `plan-one-reserve-return-row`,
  `plan-amount-whole-value-minus-fee` (whole remaining value 55,000 − ZIP-317 fee 10,000 = 45,000 — every
  unspent note, whatever its address). `OBSERVE plan-reserve-return {"amount_zats":"45000","fee_zats":"10000",
  "kind":"payout","party":"reserve-return","remaining_zats":"55000"}`.
- **green plan, the stray + unclaimed late-balance fixture plans NO return** — `plan-waits-no-row` +
  `plan-waits-line` (`reserve return waits: 2 outstanding (strays/balances/exceptions)`, printed once).
- **green plan, the fungibility case (R103's)** — `plan-swept-stray-still-refused` + `plan-swept-waits-line`
  (`… 1 outstanding …`): a prior batch spent the stray's note and its value now sits in internal change, every
  published row is receipted and the coordinator hid the stray row — the return is still refused while the
  stray is unpaid (the own-scan stray rule, claimed or not).
- **green hosts approve** — `sign-build-honest-passes` (45,000 to the committed return UA; inspect input_zats =
  the scanned 55,000), `sign-derivable-honest-lists-row`, `sign-approve-honest-passes`.
- **green hosts refuse typedly** — wrong return UA: `sign-{build,approve,derivable}-wrong-return-ua-refused`;
  input_zats below the scanned total: `sign-approve-input-below-scanned-total-refused` (a candidate that leaves
  notes behind); output ≠ total − fee: `sign-approve-output-not-total-minus-fee-refused`; a return while the
  stray + late balance are outstanding: `sign-build-return-before-receipts-refused` (`the auction still owes 2
  outstanding (strays/balances/exceptions)`); a legacy packet: `sign-build-legacy-packet-refused`. All `exit 3`,
  `refused-rows ["reserve-return"]`.
- **green legacy** — `plan-legacy-no-row` + `plan-legacy-line` (printed exactly once).
- **green create** — `create-sets-commitment-from-routing`, `create-refuses-sapling-only-reserve-return-ua`
  (H4), `create-mainnet-requires-reserve-commitment` (H15), `create-mainnet-with-commitment-passes-h15-rule`
  (then refused by the network lock).
- **green verify** — `verify-accepts-settled`, `verify-accepts-returned` (19 OK lines),
  `verify-refuses-forged-second-receipt` (`duplicate reserve-return receipt`),
  `verify-refuses-return-with-outstanding` (`the reserve-return receipt while row deposit:… is still
  outstanding`), `verify-refuses-receipt-without-accounting`.
- **units/rule/gate** — the commitment known-answer + domain separation; five schema-shape cases;
  `rule-whole-unspent-value-minus-fee` (55,000 − 10,000 = 45,000; spent and zero-value notes are never swept),
  `rule-amount-inputs-are-every-unspent-note`, `rule-fee-formula`, `rule-no-row-below-the-fee`;
  `gate-clean-accounting-passes`, `gate-unclaimed-stray-blocks` (an unpaid stray blocks the return even when the
  published accounting is spotless), `gate-exception-row-blocks`, `gate-pending-balance-blocks`,
  `gate-unreceipted-row-blocks`, `gate-pending-batch-blocks`.

45/45 green, 2/2 red, 0 FAIL both sides.

**Commands run** (worktree `/Users/akshmnd/Dev Projects/benzo-b46`): `git rebase a81e826` (clean; round-1's three
commits reapplied, then reworked on top); base bundles from `git archive a81e826` BEFORE any edit
(`cli/build.mjs`, `settle/plan.mjs`, `clear/dist/cli.mjs`); green bundles `npm run build:core && npm run
build:settle && npm run build:cli`; `cargo build --release --locked --manifest-path settle/Cargo.toml` already
built (unchanged this batch). Gates: `npm run typecheck` PASS; `check:structure` `OK (210 files)`;
`check:invariants` `{"fails":{"I1":0,"I2":0,"I3":0,"I4":0}}` ×2; `check:dist-require` OK; `check:bundle` OK —
`dist/benzo-verify.mjs` + `docs/verify-bundle.sha256` rebuilt and committed as `f146a894…` (the verify code
changed this batch, so unlike round 1 the bundle IS committed here); `npm run e2e` `PASSED default seal in the
browser, open with tle after R (38 s)`. **Folds all green** (raw outputs
`docs/evidence/phase-7/repro/*-b46*`): `h10-seller-binding` 22/22, `h13-host-scale` both legs PASS,
`h14-open-griefing` both legs PASS, `b44-opener` both legs PASS.

**Deviation note (fold machinery):** `tools/repro/h-fixtures.ts` changes are additive only — `buildAuction`
gained optional `c_zats`/`bond` knobs (the bond fixture; every existing caller's default shape is unchanged),
the stubbed `grpcurl` answers `GetBlock` (a fixed header after any pinned round's release, for the bond window's
start header) and the stubbed `benzo-pczt inspect` reports `input_zats`/`output_zats`/`fee_zats` (computed from
the fixture's unspent notes unless a candidate pins its own); `ownerPrivate(tag)` joins `witnessPrivate`. No
existing fold case or expectation changed.

## Questions (B46, round 2)

1. **Round 1's questions 1-3 are resolved by R103 itself** (the value-based rule replaces the source rule; the
   `fee_reserve_ua`-as-deposit-address ambiguity is moot — sources no longer matter; the host-side receipt rule
   is now the shared gate over the host's own derivation). Round 1's Q4 (the h10 fold fixture carries both
   commitments) stands unchanged and re-confirmed: still 22/22. Round 1's Q5 (the settle worker's reserve-batch
   wiring has no offline end-to-end proof — the coordinator batch loop only runs live) stands unchanged: the
   planning, all host checks (incl. the input/output checks) and the verify accounting are proven offline; a
   live testnet walkthrough (guide step 7.6) is the head's run.
2. **The waits line's N counts owed items plus pending batches.** The literal line
   `reserve return waits: N outstanding (strays/balances/exceptions)` is printed verbatim per the revision;
   N is the gate's outstanding count (un-receipted owed parties + unresolved rows/entries, deduplicated, plus
   one per pending batch). When ONLY a batch is pending the parenthetical names no such item — kept literal
   rather than varying the text; say the word if the wording should change for that corner.
3. **A paid stray row needs its claim in the fixture's settled worlds** (R13: `benzo verify` requires a
   published owner-signed claim for every paid deposit/refund-class row). The proof therefore signs real claim
   bodies over real tlock sealed-bid memos (the stray's own memo, attested by the paying batch's two maps).
   This is product behaviour, not fixture sugar — noted because it makes "the stray is refunded" a heavier
   fixture state than round 1's never-paid stray.
4. **The plan's own fresh re-derivation may still park a paid row as an exception** (an unclaimed stray that was
   later refunded by a claim re-derives as an OBLIGATION — fine — but a refund that arrived without a claim
   record would re-park as an exception). The gate judges owedness by receipts over our own derivation, not by
   fresh payability (per "run without requiring a destination"), so this never blocks an honest return; the
   normal product path (rows pay only through envelope/claim derivations) keeps the two views aligned.
   committed here (R32) — the head rebuilds at merge.

## Batch B42 (Builder B, branch `b42-hosts-cli`, from `96ce0f5`) — gate DOC: `benzo hosts` commands, guides with every handoff written down

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb` — the repro replaces `orb`/`orbctl`
with a PATH stub that records calls, no testnet, no wallets, no live Playwright). Spec:
`docs/design/phase6-doc-b42.md` including "Added after B39 merged (R93)". Two commits, both `--no-verify`
(R32: `check:bundle` cannot pass in a worktree):

1. The module move + commands + harness `--config` wiring: `cli/hosts.ts` (the product module — the move of
   `e2e/lib/hosts.ts`, same orb/orbctl call sequences, timeouts and retries), `e2e/lib/hosts.ts` re-exports it,
   `cli/commands/hosts.ts` (`benzo hosts keys|dkg|witness|envelope-opens`), `--show` on
   `sign envelope-key`/`witness keygen`, `auction create --config` in its help, the H10 wiring in the five live
   create calls (list below), and `tools/repro/b42-hosts-cli.ts`.
2. The three guides + this status block.

**What each command prints** (one JSON object; no command ever prints key material):

- `benzo hosts keys` → `{envelope_keys: [3], witness_keys: [3]}` (in signer order; a missing key is generated on
  its host, an existing one reused).
- `benzo hosts dkg --id ID` → `{group_key, escrow_ua, keys}` (the three reported group keys). Refuses when
  `state/vaults/<id>` exists; takes the harness's DKG lock `tmp/markets-dkg.lock`.
- `benzo hosts witness --id ID [--names alice,bob]` → `{certificates, q_w}`. Refuses before `freeze`; merges the
  named hosts' certificates through `mergeWitnessCerts` (checkCertificates before writing), then republishes.
- `benzo hosts envelope-opens --id ID` → `{reports: [{name, ok_rows, not_ok_rows}]}` (each report saved where
  settle reads it, `state/settle/<id>/envelope-opens-<name>.json`).
- `benzo sign envelope-key --name N --show` → `{name, public_hex}`; `benzo witness keygen --name N --show` →
  `{name, public_hex, key_file}`. Both refuse when no key exists and never replace one.

**Proof (`node tmp/b42-hosts-cli.mjs`, transcript `tmp/b42-proof.out`): RESULT PASS, 87/87 checks (0 ERROR).**
The old `e2e/lib/hosts.ts` is extracted from git at `96ce0f5` and bundled beside the new module, so the
comparison is against the real pre-move code. `orb`/`orbctl` are a PATH stub recording every call; the local CLI
is the real shipped one (the address classifier is the real `benzo-pczt` from `build:settle`; the offline
stand-ins are zcash-sign/grpcurl/zcash-devtool/benzo-pczt ufvk-ak+address, the h-fixtures stub class). For the
same inputs:

- `hosts keys` = old `hostEnvelopeKeys`+`hostWitnessKeys`: identical call sequences (9 calls fresh / 6 reuse) and
  identical output; `hosts dkg` = old `dkgOnHosts`: identical 20-call multiset (the three `sign dkg` launches are
  concurrent, so the check is order-insensitive there) and identical `{group_key, escrow_ua, keys}`;
  `hosts witness` = old `hostWitnessCerts`: identical 10-call sequence; `hosts envelope-opens` = old
  `hostEnvelopeOpens`: identical 18-call sequence and byte-identical saved reports. The checked merge writes a
  document **byte-identical** to the old raw JSON edit's (`witness-merge-byte-identical`).
- Refusals: `hosts witness` before freeze (no host call, `witness certificates exist only after freeze`); a
  certificate with a wrong signature refused (`witness … signature`) with nothing written (the file is unchanged);
  `hosts dkg` a second time refused (`state/vaults/<id> already exists`) with no host call.
- `--show`: prints the existing public half (equal to the generation output), refuses when none exists, refuses to
  replace an existing key, and no captured output contains either stored private key (`show-no-private-key-material`).
- H10 offline: `auction create --file … --witness-set … --config <state>/run/operator.json` (the exact file shape
  `markets.ts` writes) sets `seller_ua_commitment` to `sellerUaCommitment(routing.seller_ua)` (the real classifier
  checks the seller UA); without `--config` the draft stays unbound; an unclassifiable seller_ua is refused (H4);
  `markets.ts`'s create call carries `--config` (source check).
- Guide help: all 58 `$ benzo …` commands in the three guides run `--help` clean and every quoted `--option`
  appears in its help (section 7 of the repro).

**Commands run** (worktree `/Users/akshmnd/Dev Projects/benzo-b42`): `git worktree add ../benzo-b42 -b
b42-hosts-cli 96ce0f5` OK; worktree `npm ci` OK (pinned lockfile); `tools/nu7/build.sh crates vendor/nu7 …` +
`cargo build --release --locked --manifest-path settle/Cargo.toml` OK (`Finished release`, the real classifier);
`GOBIN=.benzo/bin go install github.com/drand/tlock/cmd/tle@v1.2.0` OK (for e2e's tle); `npm run typecheck` clean;
`npm run check:structure` `OK (200 files)`; `npm run check:invariants` `{"fails":{"I1":0,"I2":0,"I3":0,"I4":0}}`
×2; `npm run e2e` `PASSED default seal in the browser, open with tle after R (39 s)`; the repro build+run
`RESULT PASS 87/87`. `npm run check:bundle` not run (R32).

**H10 live-driver wiring** (every live driver that creates a uniform/buyback/launch auction with a seller now
passes its own `operator.json` to `auction create`, so the signed manifest carries `seller_ua_commitment`):
`tools/repro/markets.ts` (all market scenarios), `tools/repro/y2-host-custody.ts`, `e2e/buyback-mode.spec.ts`,
`e2e/cli-auction.spec.ts` (both creates). Each writes its operator.json before create already, so the wiring is
the added `--config` flag. Offline check: the repro runs the scenario's manifest-build step (`auction create` with
the markets operator.json shape and manifest) without the network and asserts the commitment is set; a full live
run is the head's testnet walkthrough.

**Guide gaps G1–G8 and where each is now covered:**

- **G1** (per-signer keys described as per-auction): signer guide steps 1–2 now say one keypair per signer,
  reused, with `--show` to print the existing public half; operator step 1.3 collects them with `hosts keys` and
  notes the same.
- **G2** (the DKG choreography undocumented): operator step 1.0 documents `hosts dkg` (the peers on alice, the
  concurrent `sign dkg` runs, then `auction keys`, then the UFVK import on every host), and signer step 6 names
  the same two per-host commands the operator runs through `orb`.
- **G3** (witness before freeze; merge by raw JSON edit): operator step 7 now orders freeze → `hosts witness` →
  wait for R → open → clear and says certificates exist only after the freeze; the merge is the checked product
  function (`checkCertificates` before writing), `hosts witness` refuses before freeze and bad certificates never
  reach the document (proved).
- **G4** (envelope-opening report undocumented): operator step 7.5 documents `hosts envelope-opens` and the path
  `$BNZ_STATE_DIR/settle/<ID>/envelope-opens-<name>.json` where `settle/plan.ts` reads the reports; signer step 3
  names the same path.
- **G5** (two `deposit.json` shapes): operator step 6 writes both shapes with filled examples (the `--pay`
  payment input vs the admission record `{txid, address, envelope_hex, envelope_ct_hex, owner_sig_hex}`), and
  bidder step 4 says to send the operator the admission record after paying, with each field's source (the
  `bid seal` output and the wallet's txid).
- **G6** (fee reserve never mentioned): operator step 5 "Fund the fee reserve" gives the amount rule as the code
  applies it (manifest `fee_zats` must be 0; each batch pays ZIP-317 `5,000 × max(2, actions)` zats from the
  reserve, so fund at least `5,000 × (rows + batches)`) plus the harness values (60,000 zats small runs,
  200,000–400,000 for scale), and the exact `bid deposit --pay` input with `reserve`.
- **G7** (private files outside `$BNZ_STATE_DIR`): all three guides state the rule and the examples now use
  `$BNZ_STATE_DIR/run/…` paths.
- **G8** (host vault sync): signer step 2 documents the vault sync/enhance before the report steps (`witness sign`
  syncs its own vault internally; `sign envelope-opens` needs it done first) and operator step 7.5 says
  `hosts envelope-opens` syncs each host's vault.
- **H10 (R93):** operator step 1.7 is `auction create --file … --witness-set … --config PRIVATE-OPERATOR.json`
  with the rule; step 4 is the seller's `benzo seller check --manifest … --ua …` gate before bidding opens; the
  field table carries `seller_ua_commitment` ("set by `auction create --config`, never typed by hand"); the live
  drivers are wired (above).

**Questions for the head** (design nits found while implementing; nothing blocking):

1. **"Then it republishes" (step 3).** The checked merge writes the merged public `auction.json` (byte-identical
to the old raw edit), and `hosts witness` then runs the product's `publish(id)` as the republish. The harness's
`hostWitnessCerts` keeps its exact old write behaviour (the byte-for-byte constraint), so the republish is
command-level. If the head wants the shared function itself to republish, say so and the harness gains one local
`publish` call per run (no orb calls either way).
2. **Checked merge + quorum.** `checkCertificates` enforces the `q_w` quorum over the whole list, so it cannot
pass after merging only alice's certificate (1-of-2). The one product function (`mergeWitnessCerts`) therefore
takes the certificates gathered from all named hosts and checks the merged list before writing once (the old raw
edit wrote once per host; the final document is byte-identical — proved).
3. **G7's "bid deposit requires private files".** Only `privatePath`-wrapped options are enforced (publish
`--config`, create `--config`/`--witness-set`, `auction sign --key`, `sign envelope-opens --witness-key`,
`sign join`/`sign inspect --candidate`); `bid deposit --file` and `claim-refund --file` are read plainly. The
guides now keep every private file under `$BNZ_STATE_DIR` regardless; a hardening batch could extend `privatePath`
to those two options.
4. **G3's "syncs each named host's vault".** `witness sign` syncs the host's own vault internally (ownScan), so
`hosts witness` adds no extra sync call and the harness's orb sequence stays byte-for-byte (proved). An explicit
sync push would change that sequence; the design's sentence is satisfied behaviourally and documented in signer
step 2.
5. **DKG comparison is order-insensitive for the three concurrent `sign dkg` launches** (Promise.all + stagger;
bob/carol interleave nondeterministically). The call multiset is identical; every other sequence is compared in
order.

## Current run (44): B44 — the opener never throws on a leaf or memo (Reviewer R P1-1, P1-2 on B43)

**DONE, offline only** (no main-checkout `.benzo/`/`.env`, no OrbStack/`orb`, no testnet, no wallets, no live
Playwright; one past quicknet beacon fetched as `h-fixtures.ts` does). Spec:
`docs/design/phase7-b44-opener-fix.md`. Worktree `../benzo-b44`, branch `b44-opener-fix`, base `d646ceb`
(the design says `6a5c45a`; the head overrode to `d646ceb` — docs only). Three commits, all `--no-verify`
(R32): `e6bf031` opener + admission G2 check, `97d3487` repro + h-fixtures kinds, and the final
`B44: the opener never throws on a leaf or memo (R P1-1, P1-2)` (this bookkeeping).

**The exact opener contract now** (`envelope/opening.ts` `openSealedBid(ciphertextHex, client)`). Every caller
hands it a client built from this auction's verified beacon (`publishedClient` BLS-checks it at construction —
that is where a bad beacon throws), so everything about the ciphertext is the ciphertext's fault:
1. it reads the beacon round from the CLIENT (`client.latest()`), never `client.get` with a ciphertext round;
   a client that serves no beacon round THROWS `refused: opener: the beacon client serves no round` — the ONLY
   throw, checked first, never ciphertext-causable;
2. `sealedBidShape(ciphertextHex, beaconRound)` runs against the beacon's round and any failure (a wrong round
   included) returns **null**;
3. it decrypts and returns **null** for ANY exception out of the tlock/age/IBE layers (either MAC failure,
   `invalid G2 point`, `rP check failed`, parse errors) and for a plaintext that is not exactly 128 bytes;
4. otherwise it returns the plaintext hex.

`open`, `verify`, host `deriveRows`, `memoOwner`, `bidPlaintextFor`, `claim-refund`, the plan, `sign delivery`
and `xchain` all use it unchanged, so they classify identically by construction. `decryptPublished` keeps its
raw contract for the sealed-reserve path only (commented: a manifest's own `sealed_reserve` failing to open is
an operator fault and may still stop the open).

**The admission G2 check** (`sealedBidShape`, run at `bid seal`'s self-check and `bid deposit` admit): the
stanza body's first 96 bytes must decode as a valid compressed BLS12-381 G2 point
(`bls12_381.G2.ProjectivePoint.fromHex` — the IBE point U a real sealer always writes). A junk body is refused
`sealed bid structure: stanza body is not a valid G2 point: invalid G2 point: expected 96/192 bytes` where the
bidder sees it. The other 32 bytes (V, W) cannot be checked before R: a forgery there is still admitted and
freezes in (it costs the griefer C) but opens `undecryptable` on every path. Old evidence was sealed honestly
and keeps verifying — proven on the dirs the folds replay (`r82-legacy-format-b44.out`: "phase-3 legacy,
honest: ACCEPTED"; `r73`/`r77`/`r78`/`r81` green).

**Red/green per case** (`docs/evidence/phase-7/repro/b44-opener-{before,after}.out`; red = the base bundles
built from pristine `d646ceb` before any B44 edit — auditable: `grep -c ProjectivePoint
tmp/b44/base/opening.mjs` = 0; green = this tree):

- **(a) junk 128-byte stanza body.** Red: the base (B43) shape rule ACCEPTS it (length-only), the base admit
  command admits it, and the base opener THROWS `invalid G2 point: expected 96/192 bytes` — the base `open`
  dies (`ERROR auction invalid G2 point: …`), base `benzo verify` dies, base `sign derivable` dies
  (`ERROR sign derivable refused: public check failed: ERROR verify invalid G2 point: …`). Green: refused at
  admission (`sealed bid structure: stanza body is not a valid G2 point: …`); built directly into a frozen
  fixture it opens `{error:"undecryptable"}` with exactly the expected classification, `benzo verify` agrees
  (`OK no-destinations`), host `deriveRows` completes with rows `leaf:0, leaf:1, seller` and nothing for the
  griefed leaves.
- **(b) valid G2 point + junk V/W.** Red: shape ACCEPTS and the base opener THROWS `invalid proof: rP check
  failed`. Green: still passes admission (documented), opens `undecryptable` on every path (probe, open, verify,
  deriveRows) and nothing throws.
- **(c) stray memos: a genuine sealed bid of round R+1 and a junk-body sealed bid of R, in a cleared fixture
  and a cancelled fixture.** Red per variant per fixture (8 runs): the base plan dies (`ERROR settle refused:
  ciphertext beacon round` / `ERROR settle invalid G2 point: expected 96/192 bytes`) and the base deriveRows
  dies (`ERROR sign derivable refused: ciphertext beacon round` / `… invalid G2 point: …`) — with both strays
  present, one dust deposit stops settlement for everyone. Green: the plan completes in both fixtures and both
  stray rows land in `exceptions` with `deposit memo is not an openable sealed bid; no owner key claims it`
  (owner key null = claim-only, today's null path); deriveRows completes in both, derives no row for either
  stray, and the host memo-openings cache records both stray openings as `null`.
- **(d) `claim-refund` against such a memo.** Red: the raw opener error surfaces (`ERROR benzo refused:
  ciphertext beacon round` / `ERROR benzo invalid G2 point: expected 96/192 bytes`) — wrong classification
  (and in the plan/host loops it is a hard crash). Green: a normal ERROR line, refused as the claim's own
  fault: `ERROR benzo refused: claim owner signature`, exit 1, for both memos.
- **(e) honest leaves byte-identical to main.** The base opener's honest openings (saved at red time) equal the
  green `open` run's byte for byte (`case-e-honest-byte-identical`, sha `1a92114132fab8c3…` this run), and the
  probe's honest case opens `plaintext` on both sides.

**Commands run** (worktree `/Users/akshmnd/Dev Projects/benzo-b44`): `git worktree add ../benzo-b44 -b
b44-opener-fix d646ceb` OK (from the main checkout); worktree `npm ci` OK (pinned lockfile);
`tools/nu7/build.sh crates vendor/nu7 pczt-0.9.3 zcash_primitives-0.30.1 zcash_protocol-0.10.5` OK (sha256-
checked crates, extracted+patched); `cargo build --release --locked --manifest-path settle/Cargo.toml` OK
(`Finished release`, the real classifier); worktree-local `cp .env.example .env` + Go `tle` v1.2.0 copied from
the main checkout's `tmp/b39-tools/bin/tle` into the worktree's own `.benzo/bin` and `tmp/b39-tools/bin` (e2e
and the h11 fold; no main-checkout state touched); base bundles built from pristine `d646ceb` sources BEFORE
any edit (tmp/b44/base: opening, published-beacon, auction, plan, cli-dist + root/clear/dist/cli.mjs for the
base plan's clear spawn; plus tmp/b43/base from `e821ba0` and tmp/h11/base-auction.mjs from `aa0229e` for the
folds) with `git archive` extracts; green bundles `npm run build:core && npm run build:settle && npm run
build:cli`. Gates (`docs/evidence/phase-7/repro/b44-gates.out`): `npm run typecheck` PASS; `check:structure`
`OK (209 files)`; `check:invariants` `{"fails":{"I1":0,"I2":0,"I3":0,"I4":0}}` ×2; `check:dist-require` OK;
`npm run e2e` `PASSED default seal in the browser, open with tle after R (38 s)`. `check:bundle` not run
(worktree, R32). Repro: `node tmp/b44.mjs before` **RESULT PASS** (25 red checks) and `node tmp/b44.mjs after`
**RESULT PASS** (29 green checks); the head's r100 probe re-run on both sides
(`b44-probe-r100-{base,after}.out`): base `intact plaintext / junk body THROW invalid G2 point: expected
96/192 bytes / wrong round THROW refused: ciphertext beacon round`, after `plaintext / shape refuses the junk
body, open null / shape refuses the wrong round, open null`. **Folds all green** (raw outputs
`docs/evidence/phase-7/repro/*-b44*`): `h14-open-griefing` both legs PASS; `h13-host-scale` both legs PASS
(its base leg replays against the e821ba0 bundles); `h11-open-offline` both legs PASS (base open = `aa0229e`);
`r77-serial-beacon` forged/substituted serial beacon REFUSED; `r78-verify-hardening` 0 FAIL;
`r81-destination-rule` RESULT PASS; `r82-legacy-format` 0 FAIL ("phase-3 legacy, honest: ACCEPTED");
`r73-open-taddr` RESULT PASS; `r40-f5-rows` RESULT PASS.

## Questions (B44)

1. **The design says the G2 check is "Admission-only … never inside verify's old-dir path", but rule 2 of the
   same design runs `sealedBidShape` inside the one opener — which verify's re-derivation goes through (it has
   since B43).** Implemented as one rule in `sealedBidShape` (admission + the opener's shape gate), so the G2
   check is in verify's re-derivation too. Old evidence keeps verifying (the folds replay it green), so the
   operative requirement holds either way; and even if the check were admission-only, the opener's total
   decrypt catch (rule 3) would still map a junk body to `undecryptable` instead of throwing. If the intent was
   literally admission-only, say so and I will gate the G2 decode behind the admission call sites.
2. **`fromHex` accepts the point-at-infinity encoding** (`0xc0 00…`), which an honest IBE U never is. Such a
   body passes admission and opens `undecryptable` (harmless — the forger burns C), so the design's exact
   wording is implemented. A one-line admission hardening (`!point.is0()`) would refuse it at admission too;
   wanted?
3. **On base, `claim-refund` did not literally crash with a stack trace** — `bin/benzo`'s top-level catch
   printed `ERROR benzo <raw opener error>`. The P1-2 "uncaught throw" damage is in `settle/plan.ts`
   (`ERROR settle`, no batch ever planned) and `sign derivable` (exit 1 for every host), both proven red in
   case (c); the claim path's defect was the wrong classification, now `refused: claim owner signature`.
   Noted for the record, no action expected.

## Batch B43 — H14 open griefing + H13 settlement scale (one offline opener, host openings cache)

**DONE, offline only** (no main-checkout `.benzo/`/`.env`, no OrbStack/`orb`, no testnet, no wallets, no live
Playwright). Spec: `docs/design/phase7-h13-h14.md`. Worktree `../benzo-b43`, branch `b43-opener`, base `e821ba0`.
Two commits, both `--no-verify` (R32): `824739e` `B43: H14 …` and `B43: H13 …` (this bookkeeping
folded into the second). Round 1 of the batch died on a provider connection drop with uncommitted work; round 2
reviewed that work critically (kept it all, one comment fix), re-ran every proof and finished H13.

**The exact sealed-bid shape enforced** (`envelope/opening.ts` `sealedBidShape`, called at ADMISSION ONLY —
`bid seal`'s self-check and `bid deposit` admit, never in `memoTlockCiphertext` or any old-dir verify path):
version line `age-encryption.org/v1`; exactly ONE stanza `-> tlock <R> <quicknet chain-hash>` whose body is
exactly 128 bytes (3 base64 lines of 64/64/43 chars); a 32-byte header MAC (43 base64 chars after `--- `);
payload exactly 160 bytes (16 + 128 + 16 STREAM: chunk tag, the 128-byte plaintext, final tag) — a 487-byte
ciphertext. Both real implementations produce this byte-layout (measured: tlock-js 0.9.0 and Go `tle` v1.2.0
128-byte encryptions to quicknet round 32704232 are identical: `OBSERVE honest-layout` in
`h14-open-griefing-before.out`), so old Go-tle-sealed evidence keeps verifying. A breach is refused
`sealed bid structure: <reason>` at admission.

**H14 proof** — `docs/evidence/phase-7/repro/h14-open-griefing-{before,after}.out`, both **RESULT PASS**
(real tlock to past round 32704232; red = base commit bundles under `tmp/b43/base/`, green = this tree):
red — both griefs (stanza body line -> `!!!!`; payload cut to 3 bytes) pass the old admission header rule AND
the real admit command; the base `open` THROWS `Expected mac, but there were no more lines left!` on the first
and stops every bidder; the base `open` accepts the payload-cut leaf with plaintext `""`; base `sign derivable`
dies on the malformed leaf. Green — `bid seal` self-check and admit both refuse `sealed bid structure: …`;
a frozen fixture built with those leaves (bypassing admission, as h-fixtures does) opens both
`{error:"undecryptable"}`, `benzo verify` agrees, host `deriveRows` agrees (rows only for the 2 honest
leaves), the honest openings are byte-identical to the base commit's, the empty-plaintext quirk is closed,
and the open trace has no `tle -d`. One opener (`openSealedBid`) now serves `open`, verify re-derivation,
`deriveRows`, `memoOwner`, `authenticatedMemoEnvelope`, `settle/plan.ts`, `sign delivery`, `xchain` and
`deriveClaimOpenings`; it returns null only for the bid's own faults (bad shape, either MAC failure, non-128-byte
plaintext) and throws only for beacon-level faults. `fetchVerifiedBeacon` is the one shared failover+verify
beacon fetch. The sealed reserve keeps the raw `decryptPublished` (it is a price bound, not a sealed bid).

**H13 proof** — `docs/evidence/phase-7/repro/h13-host-scale-{before,after}.out`, both **RESULT PASS**
(tools/bench.ts fixture machinery: real tlock, N = 55 and N = 1,000 leaves + 2 stray notes each; the H13
repro's numbers, `sign derivable` wall time = deriveRows + its internal `benzo verify` + vault stubs):

| N | before first batch | before second batch | after first batch | after second batch | openSealedBid calls, 2nd batch after |
|---|---|---|---|---|---|
| 55 | 7.9 s | 6.7 s | 8.7 s | 4.1 s | **0** (own 0, verify 0) |
| 1,000 | 116.2 s | 116.2 s | 118.8 s | 63.3 s | **0** (own 0, verify 0) |

Call counts after: first batch own = N + 2 (each leaf once + 2 stray memos), internal verify = N; second batch
0/0 (the BNZ_OPENINGS_TRACE proof hook, inert unless set). `benzo verify` cold: 2.21 s (55) / 26.70 s (1,000);
warm with the host cache: 0.56 s / 0.90 s. **verify got `--openings-cache FILE`** because the measured
1,000-leaf verify is 26.7 s — over the design's 5 s threshold; it is host-only (refuses any path that is not
this host's own `$BNZ_STATE_DIR/auctions/<id>/openings.json`, help says so; the public verify never uses it) and
skips re-decrypting exactly the covered leaves. Cache: `openings.json` `{frozen_root, beacon_sha256 (= sha256 of
the beacon signature bytes), openings: {leaf_index: plaintext|null}}` + `memo-openings.json` keyed by
sha256(ciphertext), mode 0600, atomic writes (`cli/openings-cache.ts`), reused only when BOTH keys match —
proven: key mismatch rebuilds (112 opens at N=55) and a packet-supplied path is refused. Derived rows are
byte-identical to the base commit's (same answers). The cache is this host's own computation, written by
`deriveRows` after each successful open; memo openings flow through `authenticatedMemoEnvelope`'s optional
opener (defaults to the plain `openSealedBid`).

**Remaining 63 s at N=1,000 second batch is NOT re-decryption** (0 opens): CPU profile of the cached run shows
98% blocked in `spawnSync` — the pre-existing per-row `benzo-pczt classify-address` spawn
(`envelope/destination.ts`, ~60 ms × rows), identical in base (base 116.2 s = ~43 s tle spawns + 26.7 s verify
+ ~46 s classify). See Question 2.

**Gates:** `npm run typecheck` PASS; `check:structure` OK (204 files); `check:invariants` 0 fails (I1–I4);
`npm run e2e` PASS (default `seal-open`, 39 s; worktree-local `cp .env.example .env` + Go `tle` v1.2.0 copied
from `tmp/b39-tools/bin/tle` into the worktree's own `.benzo/bin`). `check:bundle` not run (worktree, R32).

**Folds re-run** (folds touching open, verify, host derive or plan; raw outputs under
`docs/evidence/phase-7/repro/*-b43*.out`): `h11-open-offline` **both legs PASS** (the B39 H11 repro stays
green; its base open bundle = `clear/auction-cli.ts` at `aa0229e` = the H11 fix reversed, extracted with
`git archive` into `tmp/h11/base-tree`); `h10-seller-binding` PASS; `h14` PASS (+ re-run after H13:
`h14-open-griefing-after-rerun.out`); `h13` PASS; `r78-verify-hardening` PASS;
`r82-legacy-format` PASS (replays the real Phase-3 legacy dir `docs/evidence/phase-3/settle`);
`r77-serial-beacon` PASS (replays `docs/evidence/phase-5/markets/drop-a17/drop-cold`);
`r81-destination-rule` PASS and `r73-open-taddr` PASS (both needed the createRequire banner in their build
command since `settle/envelopes` now pulls the pinned tlock-js graph — header lines updated; same banner
`build:core` uses); `r40-f5-rows` PASS. **Pre-existing failures, unchanged by B43** (identical output at base
`e821ba0`, proven by rebuilding each fold from a `git archive e821ba0` tree):
`r42-f11-strays` (its fixture sets `legacy: true` on a manifest with `witness_set_hash`, which R82's later
format gate refuses) and `r33-balance` (case1/case2 expect pre-R-ruling balance rows). Not run:
`r28-replay` (needs a settled live auction's id/recipient/amount), `r42-f13-f14-tamper` (needs a corpus dir),
`xchain-demos` (live Sepolia/Solana RPCs — offline rule). Old published evidence dirs replayed above keep
verifying unchanged.

## Questions (B43)

1. **`verify --tle` kept — is that within “no product path spawns tle”?** Every DEFAULT path (open, verify,
   deriveRows, memoOwner, authenticatedMemoEnvelope, plan, sign delivery, xchain) now opens through
   `openSealedBid` and spawns no `tle`. The only remaining spawn is R89's opt-in independent cross-check
   `benzo verify --tle` (default verify never spawns it; nothing in e2e/tools calls it), keeping
   `tleDecryptFailover`/`tleOpening` in `manifest/reserve.ts` alive for it. If the rule is literal, deleting the
   flag and those two functions is a small follow-up — say the word.
2. **The remaining per-batch cost at scale is `classify-address`, not decryption.** With zero re-decryption,
   N=1,000 second batch is still 63 s because `envelope/destination.ts` spawns `benzo-pczt classify-address`
   per derived row (~60 ms × rows; pre-existing). A tiny in-process cache keyed by address would cut it to
   ~verify-warm time (~1 s). Out of B43's design scope — worth a hardening row?
3. **Two folds are red at base (pre-existing).** `r42-f11-strays` (stale fixture vs R82's format gate) and
   `r33-balance` (stale expectations after a balance ruling) fail identically at `e821ba0` — evidence:
   `r42-f11-strays-base-e821ba0.out`, `r33-balance-base-e821ba0.out`. Want them repaired in a later batch?
4. **Cache write sites.** Item 4 says “after a successful open, the host writes”. Implemented where the host
   re-opens per batch: `deriveRows` (leaf cache + memo cache). The one-shot coordinator `open` and the plan
   still derive everything per call (now offline and cheap); `open`'s per-leaf map also carries `reorg`
   labels that must not enter the decrypt cache. If `open`/the plan should read/write the same cache too, it is
   a small follow-up.
5. **Plan `checks` label.** `settle/plan.ts`'s `checks`/`settle-tle.jsonl` operation name changed `tle -d` ->
   `tlock open` (there is no tle any more). e2e asserts only the entry count (`settle-crash.spec.ts:143`) and
   zero-`tle -d`-ops, both unaffected — but any external consumer of the old label should know.

## Batch B40 (Builder A, branch `b40-operator-cli`, from `9d09093`) — gate DOC: operator CLI, templates, guide step 1

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb`, no testnet, no wallets, no live
Playwright). Spec: `docs/design/phase6-doc-b40.md`. Three commits, all `--no-verify` (R32: `check:bundle` cannot
pass in a worktree — the bundle digest embeds the building checkout's paths):

1. `79004a7` — the three commands: `benzo witness set --id --q --keys [--key]` (the signed witness-set
   side-packet, byte-equal to the harness's `signRecord`, into `$BNZ_STATE_DIR/run/witness-set-<id>.json`,
   `{file, witness_set_hash}`), `benzo auction addresses --id --count` (N fresh vault addresses via the
   harness's generator `benzo-pczt address`, refusing a missing vault), `benzo drand round --at <ISO-8601
   UTC>` (`{round, release_utc}`, pinned quicknet, no network). Router fix in `cli/benzo.ts`: an exact verb
   match wins over a catch-all for the same noun (`witness set` vs the sign/verify command).
2. `272e780` — `docs/examples/unsigned-manifest.json` (the harness's manifest object, every field in its
   order — checked programmatically against `tools/repro/markets.ts`), `docs/examples/private-operator.json`,
   and `docs/guide-operator.md` step 1 rewritten into ordered sub-steps (DKG -> `auction keys` ->
   `auction addresses` -> collect envelope/witness keys -> `witness set` -> `drand round` -> fill the
   template -> `auction create --witness-set`) with the field table (name / meaning / where the value comes
   from), header commit line updated (40 `--help` invocations, `tmp/guide-help.txt`). Where the text differed
   from `--help`, the text was fixed (claim-refund party formats, `xchain release` flags, routing fields) and
   three helps were completed (`auction create --witness-set`; `sign envelope-opens --public/--claims`;
   `witness keygen`).
3. This commit — `tools/repro/b40-operator-cli.ts` + the offline fixture vault
   (`tools/repro/fixtures/b40-vault/`: view-only wallet DB + generator source + README recipe).

**Proof (`node tmp/b40-operator-cli.mjs`, full transcript `tmp/b40-operator-cli.out`): RESULT PASS.** In a
scratch `BNZ_STATE_DIR` under `tmp/b40` (R43), the guide's step 1 run with CLI output only:
`witness-set-q-refused` / `witness-set-duplicate-refused` / `witness-set-malformed-refused` PASS;
`witness-set-record-equal` + `witness-set-hash-equal` PASS (record sha256 `0bd50e29…`, `witness_set_hash`
`a3a817ff…` — identical to `signRecord({version:1, auction_id, q_w, keys}, manifest-signing.pem)` for the
same inputs, the harness's own call); `auction-addresses-shape/-fresh` PASS; `drand-round-formula/-release`
PASS (and round 33177973 ↔ `release_utc` self-consistent); `template-filled` PASS; `auction-create` /
`auction-sign` / `auction-publish` PASS (`state OPEN`); `verify-level-manifest-checks` PASS (19 checks, 0
errors through `loadPublicAuction` + `checkPublicAuction`, the `benzo verify` manifest layer) and
`verify-lifecycle-gate-only` PASS (`benzo verify` stops only at its documented pre-freeze gate
`ERROR verify refused: missing frozen`, R21 item 5).

**Gates:** `npm run typecheck` PASS; `npm run check:structure` OK (195 files); `npm run check:invariants`
clean (0 fails, I1–I4); `npm run e2e` PASS (seal-open 39 s, `tmp/e2e/report.json`). `check:bundle` not run
(worktree, R32). Local setup for the offline e2e inside THIS worktree only: `cp .env.example .env`
(gitignored; the main checkout's `.env` untouched) and `go install github.com/drand/tlock/cmd/tle@v1.2.0`
into the worktree's own `.benzo/bin` (module cache; `tools/bootstrap.sh`'s recipe).

## Questions (B40)

- **`witness set --key` is restricted to the local manifest key, like `auction sign`.** The record must
  verify against the manifest's signer (`verifyRecord(doc.witness_set, doc.signer)`), so a record signed by
  any other key would fail every later check. The command therefore refuses a `--key` that does not resolve
  to `$BNZ_STATE_DIR/auction/manifest-signing.pem`, and generates that key when missing (exactly
  `auction sign`'s behaviour). If the design's `[--key private.pem]` meant a real alternate key, say so —
  the downstream checks would need to change first.
- **`drand round` before quicknet genesis.** The design's formula gives R < 1 for t < genesis (undefined
  territory); the command clamps to round 1 (the first round, releasing at genesis) and prints its
  `release_utc`. Also (design silent): a `witness set` re-run with identical inputs is idempotent, while a
  DIFFERENT record for the same auction is refused rather than overwritten.
- **Fixture group key vs fixture vault ak (design wording).** "Fixture group keys (reuse what `e2e` or
  `tools/bench.ts` already uses)" — the proof uses bench's `bytes("group")` recipe for the group key and
  bench's deterministic keys for the manifest/witness keys. The fixture vault is scaffold only (created
  offline; `auction keys` itself needs lightwalletd) and its Orchard ak is its own fixture key, so F4
  (ak == group key) is not held in the fixture — nothing in this proof's CLI path checks it. If you want the
  fixture coherent, the one-line alternative is to use the fixture's recorded `ak_hex` as `frost_group_key`.
- **markPublic (R78b).** The CLI process holds no evidence redactor (`e2e/lib/redact.ts` is harness-side),
  so "registration" lives wherever evidence is written: the proof calls `markPublic` on the escrow UA and
  every printed `auction addresses` output, mirroring `e2e/lib/zcash.ts:42-48`. Any future harness capture
  of `auction addresses` output must register the addresses the same way.
- **`seller_ua` sourcing.** Design item 2 lists "Deposit, fee-reserve and seller addresses" under
  `fresh(vault)`; the harness actually draws `seller_ua` from the bidder wallet while deposits and the fee
  reserve come from the vault. Implemented as designed: the field table sources all three from
  `auction addresses`, and product-mode settle accepts any shielded `seller_ua`, so a seller-controlled
  address from elsewhere also works.
- **File ownership (FYI).** The header says only Builder B writes this file; the head's B40 task message
  asked Builder A for a block here — this one, clearly labelled. Fold or move it as you see fit.

## Current run (39): B39 — Phase 7 H10 + H11 (`docs/design/phase7-h10-h11.md`)

**DONE, offline only** (no main-checkout `.benzo/`/`.env`, no OrbStack/`orb`, no testnet, no wallets, no
live Playwright; all fixture state under `tmp/` of my worktree `../benzo-b39`, branch `b39-h10-h11` from
`83d9cde`). Two commits, one per item. Committed with `--no-verify` (R32: `check:bundle` cannot pass in a
worktree); `npm run typecheck`, `npm run check:structure` and `npm run check:invariants` pass in the worktree.
This batch touches `cli/published-beacon.ts`, so the head must rebuild the verify bundle
(`npm run build:verify`) after merge, as planned.

- **H10 (`06cb56b`)** — `seller_ua_commitment` in the signed manifest (`sha256("benzo-seller-ua-v1\0" ||
  utf8(seller_ua))`, one shared function `sellerUaCommitment` in `manifest/schema.ts`): `auction create`
  sets it from the operator routing and closes H4 (UA on the manifest's network with an Orchard/Ironwood
  receiver); mainnet create for a seller-paying mode requires it; `sign build`/`sign approve`/`sign derivable`
  refuse the seller row typedly (`refused-rows ["seller"]`, exit 3) when the packet's `seller_ua` does not
  hash to the commitment (legacy manifests keep the amount-only behaviour + one WARN line); `verify` checks
  the field shape only; new read-only `benzo seller check` + README line replaced.
- **H11 (second commit)** — `open` fetches the round-R beacon across every `BNZ_DRAND_URLS` endpoint
  (first BLS-verified answer wins) and decrypts every leaf OFFLINE with `decryptPublished` (no `tle`
  subprocess, no per-leaf network). Exact semantics kept: reorged leaf → `{error:"reorg"}`, only an
  authenticated-ciphertext failure → `{error:"undecryptable"}`, any other failure stops the open. Trace is
  now one `beacon fetch` + one `offline decrypt` instead of one `tle -d` per leaf.

Proof (all under `docs/evidence/phase-7/repro/`):

- `h10-seller-binding-before.out` / `-after.out` — red-before at the base commit shows the host ACCEPTING the
  substituted seller address (`OBSERVE legacy-packet-seller-accepted utest10c5k…`); green-after: all three
  host paths refuse it typedly, the honest address passes, a legacy manifest settles with exactly one WARN,
  22 PASS / RESULT PASS. Unit checks (known-answer, bad length, uppercase hex, extra field) and the create
  rules (H4 refusal, mainnet rule) are in the same run.
- `h11-open-offline-before.out` / `-after.out` — red-before: the base commit's open fails with a dead first
  relay (`ERROR auction fetch failed`); baseline: base open with a working relay (4 `tle -d` runs) saved.
  Green-after: fixed open succeeds offline with the dead first relay, opened set **byte-identical** to the
  base commit's (incl. one body-tampered `undecryptable` leaf and one bad-MAC leaf), trace = 1 beacon fetch +
  1 offline decrypt + 0 `tle -d`, `benzo verify` on the opened fixture passes, a forged beacon stops the open
  (`refused: drand opening beacon unavailable or unverified on every endpoint`), and a reorged leaf stays
  `{error:"reorg"}` byte-identically. RESULT PASS both parts.

Commands run in the worktree: `npm run typecheck`, `npm run check:structure` (194 files),
`npm run check:invariants`, `npm run e2e` (the offline seal suite, `BNZ_STATE_DIR=tmp/b39-e2e-state`;
PASSED), and the repro folds that touch `sign-*` or the manifest schema: r45-f20, r46-f23,
r78-verify-hardening, r82-legacy-format, r81-destination-rule, r73-open-taddr, r79-leak-guard (all PASS).
`r42-f11-strays` FAILS identically at the base commit (pre-existing: its legacy-dir fixture predates the R82
format gate `api/public-auction.ts:279`; not a B39 regression). Toolchain built locally: the audited
`benzo-pczt` (`tools/nu7/build.sh crates vendor/nu7 …` + `cargo build --release --locked`), and the pinned Go
`tle` v1.2.0 (`tools/pins.env`) at `tmp/b39-tools/bin/tle` for the base-commit baselines. One product build
fix rode along: `build:core` now gives `clear/dist/auction.mjs` the same `createRequire` banner `cli/build.mjs`
uses (H11's `@noble/*` import needs it in the ESM bundle; without it the bundle crashed at import).

### Questions (for the head)

1. **H10 red-before nuance.** The design's red fixture ("a packet carries a different seller_ua than the
   committed one") cannot run on the base commit: its manifest schema refuses `seller_ua_commitment` outright
   (`unknown or missing manifest field`), so a base host never reaches the seller row with a committed
   manifest. The red-before therefore shows the acceptance on the pre-H10 LEGACY manifest (what every pre-H10
   auction is) and also records that the base schema cannot represent the field. Same defect, same sentence
   (`the host accepts the substituted address`), on the only manifest the base can read.
2. **`auction create` plumbing.** The design says create "sets it from the operator's `routing.seller_ua`",
   but create's input is only the manifest — routing arrives at `auction publish`, too late to be signed.
   Implemented as an optional `--config` on `auction create` (the same private operator config publish takes).
   The live drivers (`tools/repro/markets.ts`, e2e) are untouched and keep the legacy/WARN path; wiring
   `--config` there is a head call (I cannot run live flows). A publish-time cross-check (draft commitment vs
   routing) was NOT added — the host refusal is the designed backstop; say the word if you want it.
3. **Refusal shape.** "The seller row is refused (a typed refusal like the others in sign-build.ts, never a
   silent pass)" is implemented as a command-level typed refusal on all three host paths
   (`ERROR sign <verb> refused-rows ["seller"]`, exit 3) whenever the manifest binds and the packet's
   seller_ua does not hash to it — sign-build through its own refusedRows channel. The row-level reading
   (set-aside just the seller row while other rows proceed, R46-style) is a one-line change if you prefer it.
4. **H11 `decryptPublished`.** It already tells an authentication failure (null: exactly tlock-js 0.9.0's two
   MAC checks — `age-encrypt-decrypt.js` header MAC, `stream-cipher.js` chunk MAC) from any other error
   (throw), so no typed change was needed; the contract is now documented at the function and any unknown
   failure message fails closed (it throws and stops the open). One boundary worth knowing: a
   STRUCTURALLY-corrupted ciphertext (e.g. a header byte that breaks base64) is a parse error in Go age and
   tlock-js alike — it stops the open in both worlds (never a bad bid); only MAC failures classify as
   `undecryptable`, which is exactly the pre-H11 behaviour.
5. **H11 trace.** One `beacon fetch` + one `offline decrypt` replaces both the per-leaf `tle -d` entries and
   the `tle -d reserve` entry (the sealed reserve now opens inside the same offline-decrypt phase). No
   separate reserve trace line remains; say if you want one.
## Current run (39): B41 — release tarballs reproducible on macOS and Linux (phase6-pk-b41.md)

**DONE, offline only** (no main-checkout `.benzo/` or `.env`, no OrbStack/`orb`, no testnet, no
wallets). Only code file changed: `tools/deterministic-tar.mjs`; docs: `docs/reproducible-build.md`
(§1 toolchain + cross-OS line, §2/§3 digests at this commit, §4 mechanics, §5 note) and this block.
Worked only in worktree `../benzo-b41`, branch `b41-pk-tar`, based on `9973d73`.

**New digests** (also recorded in `docs/reproducible-build.md` §2/§3):

| Artifact | New sha256 (this commit) | Pre-change on this Mac (matches pk-vm macOS values) |
|---|---|---|
| `dist/benzo-0.1.0.tgz` (npm package) | `39d53458b3c0e897b9e88ab41bf793284d7b0ce2a058c0c352612ab9751dc8f2` | `5a672f39…` = pk-vm macOS |
| `dist/benzo-bidder-0.1.0.tgz` (bidder bundle) | `f6afad1394f15d9ef4d787edffa25479b0c35b77b94cd21e9b7db51c9cd07c38` | `fa54df28…` = pk-vm macOS |
| `dist/benzo-verify.mjs` (verify bundle, untouched by B41) | `96886226676422890db98f87b30d4e65c25ba0b022b3e39c0353443dfb4e8913` (unchanged) | n/a |

**What the change does** (per `docs/design/phase6-pk-b41.md`, nothing else): picks bsdtar explicitly
(`bsdtar` on PATH, else `tar` whose `--version` starts with `bsdtar`, else one line
`ERROR packaging needs bsdtar (macOS: built in; Debian/Ubuntu: apt install libarchive-tools)` and
exit 1 — never GNU tar); adds `--uname root --gname root` to the tar call beside
`--format ustar --uid 0 --gid 0`; replaces the `gzip -n -9` shell call with Node's
`zlib.gzipSync(…, { level: 9 })`, pins gzip header byte 9 (OS) to 3, refuses any stream whose bytes
0–2 are not `1f 8b 08`, FLG not 0 or MTIME not 0; no `sh -c` remains.

**Commands run and results** (all in `/Users/akshmnd/Dev Projects/benzo-b41` unless noted):

1. `git worktree add ../benzo-b41 -b b41-pk-tar 9973d73` (in the main checkout) → OK.
2. `npm ci` → OK (real `node_modules`, no symlinks).
3. Pre-change baseline `npm run package` → `5a672f39…`, 18,323 entries;
   `npm run package:bidder` → `fa54df28…`, 2 entries. Both equal the macOS values measured in the
   pk-vm run — the tree and tool agree with the R90 record before touching anything.
4. `npm run typecheck` → exit 0. `npm run check:structure` → `OK check:structure (192 files)`, exit 0.
5. `npm run check:bundle` → `OK check:bundle 96886226…` (before and after the change; see Questions
   item 3 on worktrees).
6. Two clean `npm run package` runs (staging + old tgz removed before each) → both
   `39d53458b3c0e897b9e88ab41bf793284d7b0ce2a058c0c352612ab9751dc8f2`, `cmp` of the shasum lines
   identical. Two clean `npm run package:bidder` runs → both
   `f6afad1394f15d9ef4d787edffa25479b0c35b77b94cd21e9b7db51c9cd07c38`, identical.
7. Node header check on both new tgz files → `1f 8b 08 00 00 00 00 00 02 03` (`1f8b0800 00000000
   02 03`) on each.
8. `gzip -dc` of each tgz vs the tar layer rebuilt from the staging the run left behind (same
   bsdtar invocation): npm `886e8589c1fce5de26f348a07c71ea1eaf723f6d13d5988f3daa6a0a41db7cfd`
   == same; bidder `2ad6eae8a78eb84e28485ead92c2e862dd6d12bbe5c98d2e231848b980627392` == same —
   and `2ad6eae8…` is exactly the tar layer the pk-vm run measured byte-identical on macOS and
   Ubuntu with the names pinned. Standard tools read the streams (`gzip -dc`, `tar -tzf`).
9. `tar -tzf` counts 18,323 / 2, and the entry lists are `diff`-identical to the pre-change listings.
10. Clean extract in `/tmp` with empty HOME (`env -i`): shipped `dist/benzo-verify.mjs` in the
    extract = `96886226…`. `bin/benzo verify` on the shipped Phase 4 evidence
    (`docs/evidence/phase-4/cli`) → **exit 1** without `--legacy-unattested`, **exit 0** with it
    (19 OK, 2 WARN) — the design proof line says plain verify exits 0 there; see Questions item 1.
    `bin/benzo verify --offline` on the published auction
    (`docs/evidence/phase-6/markets/launch-r34/launch-cold`) from the same extract → **19 OK,
    exit 0** (the pk-vm step-02 result).
11. Commit with `--no-verify` per the batch rule (R32: `check:bundle` is not trusted from a
    worktree — although it passed here, see Questions item 3).

**Questions**

1. **The design proof line "the `pk-package-verify` extract still runs `bin/benzo verify` on the
   shipped Phase 4 evidence, exit 0" does not hold at `9973d73` as written.** R42/R78's receipt
   attestation (`cli/commands/verify.ts`) refuses the pre-R42 `docs/evidence/phase-4/cli` evidence:
   `ERROR receipt-attestation refused: receipts not host-attested: no approval maps published`,
   exit 1. This predates B41 (the extract content is entry-identical to the pre-change tarball and
   B41 changes only the tar/gzip layer). It exits 0 with `--legacy-unattested` (the error message's
   own documented escape for pre-R42 testnet evidence), and the shipped published auction
   `launch-r34/launch-cold` — what the VM steps 02/04 actually verify — exits 0 plain from the same
   extract. I ran all three and recorded them; if you want the run-36 form (plain verify on
   Phase-4/cli, exit 0) back in the proof table, the verify rule or the evidence needs a decision
   from you, not from me.
2. **`docs/reproducible-build.md` §2/§3's verify-bundle digest was already stale before B41**: it
   recorded `b122bf2b…` while `docs/verify-bundle.sha256` has carried `96886226…` since the R81/R83
   rebuilds. B41 touches no bundle input, so per "the new expected digests at your commit" I
   recorded the measured `96886226…`. `README.md` still quotes the stale `b122bf2b…`; that is a
   verify-bundle digest, not a tarball digest, so per the rule I did not edit it — flagging it
   because README ships in the tarball and the final PK record will want it right.
3. R32's "`check:bundle` cannot pass in a worktree" did not reproduce here: `npm ci` made a real
   `node_modules` and `check:bundle` passed (`OK check:bundle 96886226…`). R81's commit note says
   the earlier worktree failure came from symlinked `node_modules` paths in the bundle. Committed
   `--no-verify` anyway, per the hard rule.
4. The cross-OS claim rests on the R90 component measurements (byte-equal bsdtar layer with the
   names pinned; equal Node zlib deflate stream on macOS arm64 / Linux arm64 / Linux x86-64; only
   the OS byte differed and is now pinned). The whole-tarball digests above are macOS-measured
   (twice each); the Linux-side confirmation is your step-04 re-run on `benzo-pk`, which the design
   assigns to you. Nothing in the change should differ there.

## Current run (38): B38 — gate H closure table (phase6-h.md)

**DONE, offline only** (no `.benzo/`, no OrbStack/`orb`, no testnet, no wallets, no live Playwright,
no `.env`). Deliverable: `docs/evidence/phase-6/h-closure.md` — one row per P0 threat (34 rows,
`docs/research/threat-model.md` table lines 81–114), every `file:line` and evidence ID opened and
verified at HEAD (`6a26d33`). Only that file and this block changed.

- States: 19 closed, 7 closed + disclosed (README lines quoted), 7 closed + disclosed — README GAP,
  1 out of scope (MVP) (rank 11, the NEAR/bridge live-swap path — `docs/design/crosschain.md:72`,
  `fund quote` is dry-only), 0 plain GAP.
- §5a (rows #13/#15): signer binding = `sign approve`/`sign join` per PHASE-5 R3 item 8
  (`docs/PHASE-5.md:165`), Phase 5 drill `docs/evidence/phase-5/y2/y2.out`, live RG proof
  `rg/buyback-mode/run.json` W2/W4/W5/W6; kill drill `BNZ_DRILL_STOP` restored in
  `signParallelHost` (`settle/sign.ts:157-160`, PHASE-6 R55), live at `rg/buyback-mode/run.json` **Y1b**.
- README GAP rows: 6, 7, 9, 10, 16, 19, 32 — seven ready-to-paste honest-limits sentences at the
  end of h-closure.md (rank 7's is the B37 leak-audit evidence-leak line; head decides).
- Committed on worktree branch `t3/gate-h-closure-table` (branched from `6a26d33`); not pushed, not
  merged. Note: the assigned T3 worktree was bound to the wrong repo (localseafoodwork at
  `181f8c0`), so the batch ran in a new worktree `benzo-b38-h` of the Benzo repo at `6a26d33`.
- Pre-commit gate (`npm run check`): typecheck, check:structure and check:invariants pass in the
  worktree. `check:bundle` cannot pass from any worktree — the bundle digest embeds the building
  checkout's paths (R32) — and passes in the real checkout against the same committed artifacts
  (`OK check:bundle 9688622…` at `1b871d5`). The guard's own scope rule covers only commits
  touching `api/`, `envelope/`, `settle/envelopes.ts`, `cli/commands/verify.ts`,
  `cli/published-beacon.ts`; this commit touches only the two docs files. Committed with
  `--no-verify` for that reason.

## Current run (37): Phase 6 Track B — B37, gate LA final pass (phase6-rg §4.2)

Task (this session's head message): `track-b` fast-forwarded to main at `4991761` (gate RG's six live
projects green, evidence in `docs/evidence/phase-6/rg/`). `npm ci` + `npm run e2e` PASSED (seal-open
40 s, `tmp/e2e/report.json`) at session start. **Offline only**; no OrbStack/VM/`orb`/frostd/testnet
spends/live specs/`tools/repro/markets.ts`, no `.benzo/` reads beyond the leak tool's own 0600
sensitive file, no `.env`, no mainnet, no frontend, no product changes.

**Gate LA final pass: DONE (item 1 + item 2), evidence commit `4687c57`.** `tools/leak-audit.ts`
(the run-2/31 recipe) over `docs/evidence/phase-6/rg/` (all six projects), every evidence file added
since the B34 pass (368 paths since `72204b2`, incl. `repro/{r48-stall,r49-pins,r61-void,r70-folds}.out`
— zero rows on all four), and `git log -p 5475c60..HEAD` (subsumed by `--git`: every blob of every
commit on every ref). Run at `4991761`, record `docs/evidence/phase-6/leak-findings-rg.json` (tool
stdout unedited, **798 rows**, exit 1), section "RG final pass" in `leak-audit.md`.

- **Accounting:** 798 = 379 inherited (byte-identical to the B34 record `leak-findings-2026-10-06-b34.json`,
  0 rows gone; dispositions stand) + 419 new, **every row classified A–G**: 346 × class C intended-public
  per-bid **deposit** addresses (drop-a17–a24 / launch-a18 / launch-r34 cold docs, rg `clear-input`/
  `frozen`/`deposits`/`refund`/`auction`/`api` deposit fields, golden-path `scan/{addresses.json,
  operator-view.jsonl}` per-bid deposit notes), 16 × class B `age-armor` self-matches in rebuilt
  `dist/benzo-verify.mjs` (all 53 historical bundle versions checked: marker-literal spans, zero
  base64 payloads), 26 × class G fixture literals re-keyed under new blobs (22 `readpath*` fixture
  UAs + 4 anvil dev-key-0 rows in `xchain-demos.ts` — all 26 value digests already in the B34 record),
  and **31 REAL rows in 4 files** (below).
- **Real findings (reported under Questions, NOT fixed — the head decides):** full refund/delivery
  destinations in committed evidence, new since B34: `rg/testnet-golden-path/frost/pczt-inspect.txt:5,17`
  (FROST-signed PCZT output destinations), `rg/auction-core/auction/pczt-inspect.txt:4` (claim/refund
  PCZT outputs), `rg/auction-core/auction/cancel.json:1` (`response.refunds[].address`), and
  `phase-5/markets/drop-a20/recovery.out:13-16` (4 refund destinations). file:line + type only; no
  values printed anywhere.
- **Verdict:** no keys, mnemonics, UFVKs, PEM/age key material anywhere (zero `viewing-key`/`mnemonic`/
  `pem-private-key` rows; the only `exact-value` rows are the public anvil fixture); no envelope
  plaintext; residue classes A/C/D/E/F unchanged. Limits stated in the record: the exact-value list is
  frozen at the run-31 106 entries (batch forbids re-reading `.benzo/`; only `.benzo/bidder/*.sqlite`
  changed since — names inspected only), and the owed `release_time` bid-plaintext entries are still
  not covered.
- **Item 2 — EVIDENCE.md LA row: DONE.** Points at `leak-findings-rg.json` + the "RG final pass"
  section with the four real files under the open items. The RG row is untouched (the head owns it).

Commands that prove the batch: the one-command repro in `leak-audit.md` (run at `4991761`),
`npm run e2e` (PASSED at session start). Nothing owed for B37 but the Questions below.

### Questions (this run)
- **Real finding 1 — `docs/evidence/phase-6/rg/testnet-golden-path/frost/pczt-inspect.txt:5` (and `:17`), type: full FROST-signed PCZT output destination** (`Output: 990000 zatoshis to <UA>`; 9 rows / 7 distinct values, also in the 7 superseded RG re-run revisions of the file). Reported, not fixed.
- **Real finding 2 — `docs/evidence/phase-6/rg/auction-core/auction/pczt-inspect.txt:4`, type: full claim/refund PCZT output destination** (`Output: 2500000 zatoshis to <UA>`; 7 rows / 6 distinct values, 6 superseded revisions).
- **Real finding 3 — `docs/evidence/phase-6/rg/auction-core/auction/cancel.json:1`, type: full cancel refund address** (`response.refunds[].address`; 7 rows / 6 distinct values, 6 superseded revisions).
- **Real finding 4 — `docs/evidence/phase-5/markets/drop-a20/recovery.out:13-16`, type: full refund destinations** ("the refunds landed at each bid's own envelope destination"; 8 rows / 4 distinct values; committed by the head's A20 run, not mine).
  These four are the historical class-C shape (real refund/delivery destinations) but are **new** evidence committed after B34, so per this batch's rule they are reported here rather than only disclosed. Evidence was never edited; tell me if you want any handling (e.g. a Ruling that testnet-only self-owned destinations in gate evidence are accepted, or a re-run/abbreviation of the emitting captures).
- **Exact-value scope frozen (stated limit, not a finding):** this batch forbids reading anything under `.benzo/`, so the `test-ua-extra-*` refresh of runs 2/31 did not run; the list is the run-31 106 entries. Pattern rules still catch every address/viewing-key/mnemonic/PEM/age form; a raw key not in the list would be missed by `exact-value`. Say the word if you want a silent refresh ordered.

## Previous run (36): Phase 6 Track B — B36 packaging refresh (phase6-rg §4.3)

Task (this session's head message): `track-b` fast-forwarded to main at `638ae26` (product code final
since R65; R66–R68 harness-only). `npm ci` + `npm run build:*` green (seal/core/settle/cli/verify +
typecheck; `npm run check:bundle` PASS `b122bf2b…`). **Offline only**; no OrbStack/VM/`orb`/frostd
:2744/testnet spends/live specs/`tools/repro/markets.ts`, no `.benzo/` in either checkout, no mainnet,
no frontend, no product or pin changes. `npm run e2e` PASSED (seal-open 37 s) — run at the end of the
batch rather than at session start; the three offline items do not depend on it (AGENTS step 4, noted).

**Item 1 — fresh-clone rebuild of the three release artifacts at `638ae26`: DONE (commit `1c327e3`).**
`docs/evidence/phase-6/pk-rebuild-rg.out`: two independent fresh clones in `/tmp` (empty `HOME` each —
no `.npmrc`, no npm cache, npm registry defaults; `env -i`; own `node_modules`; nothing reads this
checkout's `node_modules`) run `docs/reproducible-build.md` §3 twice. All three artifacts
**byte-identical** across the two runs and equal to the in-tree build (`cmp`):
- `dist/benzo-verify.mjs` `b122bf2b3503ee319f5d638c32b968ffe2fd03bd08875b5dc4648cfcce1451ce` —
  equals `docs/verify-bundle.sha256` at `638ae26` (`shasum -c` OK) — the batch's named check;
- `dist/benzo-0.1.0.tgz` `5d36782f807d51cc886b62d10700e0538942acb06006f8218cc7755bd180853c`
  at `638ae26` (18,323 entries, 112 production packages);
- `dist/benzo-bidder-0.1.0.tgz` `fa54df28e87c507336897f88cf0f831d8df7599f48e54ebeada98dc77cae88f6`
  — unchanged since run 32 (`git log 3ca5c9f..HEAD -- seal/ package.json tools/package-bidder.mjs
  tools/deterministic-tar.mjs` is empty).
The transcript also records the finding that drove item 2: `README.md` and `docs/verify-it-yourself.md`
still showed the run-33 bundle digest `effd9853…` while `docs/verify-bundle.sha256` has been
`b122bf2b…` since R64.

**Item 2 — documented values refreshed: DONE (commit `a9752a4`).**
- `docs/reproducible-build.md`: expected bundle `b122bf2b…` (rebuilt by R42 `28f52e3`/`414bcbd`, R44
  `68fb2f7`, F21 `bd315fd`, R52 `42db1fe`, R61 `38e8d76`, R63 `03f4404`, R64 `0d50cdd`; R65 changed no
  bundle input — `npm run check:bundle` PASS at `638ae26`); expected npm
  `9693395b1b0020acc6020563516b8be0f55ed31383fbe1900065212d918f405a` (the same verify code plus the
  R34.2/R38/R40–R46/R48–R65 CLI/host changes and this commit's shipped-doc fix); bidder `fa54df28…`
  unchanged. The §5 "B36 refresh" note carries the citations and the `5d36782f…` → `9693395b…`
  explanation (README/verify-it-yourself are tarball inputs, `tools/package.mjs`).
- `README.md` + `docs/verify-it-yourself.md`: `effd9853…` → `b122bf2b…` (each ×2 recorded lines).
- Regenerated run records: `pk-package.out` (two clean `npm run package` builds identical at
  `9693395b…`), `pk-package.sha256`, `pk-package-verify.out` (clean `/tmp` extract with empty `HOME`,
  no `.env`, no state dir: `bin/benzo verify` on the shipped Phase 4 evidence offline — all OK incl.
  `delivery-list`/`balance-refs`/`defaults`, exit 0; `auction balance-addresses` absent, exit 2, 0 of
  18,323 entries).
- **Post-commit proof that the recorded npm digest is what a fresh clone of the recording commit
  produces** (clone of `a9752a4`, porcelain=0, empty `HOME`, `env -i`): `npm ci && npm run package` →
  `{"sha256":"9693395b1b0020acc6020563516b8be0f55ed31383fbe1900065212d918f405a","bytes":29831721,"files":18323,"production_packages":112}`;
  `shasum -a 256 -c docs/verify-bundle.sha256` → `dist/benzo-verify.mjs: OK`; `npm run package:bidder`
  → `fa54df28…`. Nothing the batch commits after item 2 is a tarball input, so the expected values
  hold at the commit that records them and after.

**Item 3 — EVIDENCE.md PK row: DONE (commit `ecbc38e`).** The PK row points at `pk-rebuild-rg.out` as
the current fresh-clone record, carries the run-36 digests and the `effd9853…` correction with its
`5d36782f…` → `9693395b…` consequence, and cites the `a9752a4` re-proof (this file). The RG row is
untouched (the head owns it). The gate's OPEN item — a stranger's clean-machine run end to end — is
unchanged.

Commands that prove the batch: `bash tmp/rebuild-rg.sh` (the item-1 transcript; kept with
`tmp/pk-package-rg.sh` in gitignored `tmp/` as the runnable drivers), `npm run check:bundle` (PASS
`b122bf2b…` at `638ae26` and at `ecbc38e`), `npm run e2e` (PASSED seal-open 37 s at the `ecbc38e`
tree, `tmp/e2e/report.json`).

### Questions (this run)
- **The batch's citation range ("R48–R65") is narrower than the measured change set.** The documented
digests were last recorded at run 34 (`3ca5c9f`, R37). Since then the shipped artifacts also changed
under R34.2, R38 and R40–R46 (Track A hardening F1–F25; `git log 3ca5c9f..638ae26` over the shipped
inputs), and the bundle was rebuilt before R48 at `28f52e3`/`414bcbd`/`68fb2f7`/`bd315fd`. I cited the
full set in `docs/reproducible-build.md` §5. Nothing blocked; fold into a Ruling if you want the
narrower range recorded instead.
- **Transcript vs expected npm digest — explained, not a discrepancy.** `pk-rebuild-rg.out` is the
literal "fresh clone of this commit" (`638ae26`) and measures the npm tarball `5d36782f…` there; the
expected `9693395b…` is measured at the item-2 tree, because fixing the two shipped docs (tarball
inputs) moves the digest. Both records and the explanation are committed, and the `a9752a4`
fresh-clone re-proof closes the loop. If you prefer `pk-rebuild-rg.out` regenerated at the final batch
commit so the transcript alone shows the expected values, say so and I re-run it.

## Previous run (35, batch B35 — gate RG offline half): complete

Task (this session's head message): `track-b` fast-forwarded to main at `6802a2f` (B34 merged). `npm ci` +
`npm run build:*` green (`build:seal/core/settle/cli/verify`, typecheck; `npm run check:bundle` PASS
`a7914c79…` = the committed bundle). R35/R37 read; `docs/evidence/phase-6/test-audit.md` read. Session-start
`npm run e2e` PASSED (seal-open 36 s). **Offline only except drand quicknet reads**; no OrbStack/VM/`orb`/
frostd :2744/testnet spends/`tools/repro/markets.ts` live runs/live specs, no mainnet, no frontend, no pin
changes, no Track A files (`clear/`, `e2e/markets.spec.ts`, `tools/repro/markets.ts` untouched).

**Item 1 — every offline-capable mutation re-shown red then green at `6802a2f`: DONE with proof.**
AGENTS.md procedure per ID: clean tree, `git apply`, run, `git apply -R`, `git status --porcelain` clean;
red (with `ERROR <id>`/the harness's own convention) and green after `-R`, each recorded in
`docs/evidence/phase-6/mutations/<ID>-rg.out` (commit, UTC, command, the red's ERROR lines + last 30 lines,
the green). **23 IDs** (commit `ba7b4da`, harness fix `77d401f` first):

- **seal-open** (`npm run e2e`, ~40 s each): M1 `ERROR C2` (+C6), M2 `ERROR C7`, M3 `ERROR C5`, M4 `ERROR C4`.
- **replays on the committed published data**: 5M1 `FAIL V1b` / 5M3 `FAIL X1b` (`tools/repro/mut-replay.ts`
  on `phase-5/buyback-run4/cold/auction.json`); 5M6 `ERROR drop-defaults-window`, 5M7 `ERROR drop-forfeit`,
  5M8 `ERROR revision`, 5M9/5M10 `ERROR rfq`, 5M11 `ERROR drop-swapped-defaults-refused`
  (`mut-replay-markets.ts` on `revision-cold`/`rfq-cold`/`drop-r33/drop-cold`; 5M11 rebuilds `cli` so
  `bin/benzo verify` carries the mutation).
- **B31-a** (`npm run bench -- --stage batch-plan tmp/bench-100 100`): `ERROR batching-equal-cap13`, green
  `PASS batching-equal cap=13/cap28`. **B32-a** (`api-reference-check`): `ERROR shape.auction … missing key
  leaf_count`, green `PASS api-reference 11 documented shapes`.
- **the 9 offline folded IDs' re-pointed patches** through the scratch fold harness (`npx playwright test
  --config=tmp/folds.config.ts`, red + green each): R15-F4a (`ERROR r15-machine-runs-without-records`),
  R15-F4b (`ERROR r15-strangers-refused`; patch re-cut), R15-F5, R16-F2a (`ERROR r15-phase2-4` +
  `mr-verify-phase2-4` collateral), R23-3a (single clean red), R26-3a (4 divergence IDs), R26-3b (single
  clean red), R23-2-revert (all four r23-2 IDs; patch re-cut), U7 (`ERROR U7` — with `npm run build:core`,
  see below). Every green is `1 passed, no ERROR` on the harness that runs all 55 folded IDs.

Scope call (one line under Questions): the batch's bullet list names 5M1/5M3/5M8–5M10, B31-a, B32-a, the
offline folded patches and M2, while item 1's sentence says "every mutation whose red can be shown offline";
I kept the enumeration's families and ran the whole of them — the same harnesses also cover **5M6/5M7/5M11**
(committed drop data) and seal-open's **M1/M3/M4** (same `npm run e2e`) — 23 IDs where the bullets name 16.

Three incident records (all in the `-rg.out` files and the RG table):
1. **Fold harness tamper flake (fixed, `77d401f`).** `g-forged-claim-control`/`r23-1-tampered-sig-certified`
   tamper the signature with `owner_sig.slice(0,126)+"00"`, a no-op for the ~9% of Ed25519 signatures whose
   byte 63 is already `0x00` (S < L; **26/300 measured** from node's signer this session). It hit twice in
   the red runs (R16-F2a, R26-3b first pairs — recorded as "collateral" there) and once in a GREEN run
   (R23-2-revert's first pair). Classified **harness**; the fix makes the tamper always change the byte
   (same assertion: a tampered owner_sig is refused with the claims `owner signature` error). Deterministic
   re-run pairs after the fix are the recorded ones (R16-F2a `ERROR r15-phase2-4`, R26-3b single red,
   R23-2-revert as expected). `tools/repro/g-forged-claim.mjs` has the same tamper but is deleted at RG
   (R35.3b) and is left as is.
2. **U7 needs `build:core`, not `build:cli`.** `foldReserve` drives `manifest/dist/reserve.mjs` +
   `clear/dist/cli.mjs`; the first pair (05:41Z) rebuilt only `cli/dist`, so the mutation never reached the
   fold and its "red run" was green — not evidence, not recorded. The recorded pair (05:44Z) rebuilds
   `npm run build:core` after apply and after `-R`.
3. **`mut-replay-markets.ts`'s optional launch leg is not passable on the committed corpus.** With the A16
   `launch-cold-f1170469` dir its `launch-meet-allocation-order` line FAILs **even unmutated**
   (`canonical=true decorrelated=false` — the corpus's canonical rows coincide with winner-leaf order).
   My runs pass no launch dir (exactly the original 5M8–5M10 records' shape). Track A's leg/corpus —
   Question 2 below.

Patch hygiene: M1–M4 (phase-1), R15-F4b and R23-2-revert (phase-5) patches were **re-cut** at this HEAD with
the same semantic mutations (headers record why: source drifted since their runs); 28 other patches fail
`git apply --check` at `6802a2f` and are marked ⚠re-cut in the RG table for the live half.

**Item 2 — RG table in `test-audit.md` §(c): DONE.** Every mutation ID in the project (**87**): last red
(record file @ run commit), re-shown-at-`6802a2f` flag (23), and the one command for the live half (spec
rows: `git apply … && BNZ_LIVE=1 npx playwright test --project=<p>`; local rows: the demo commands; live
host rows: the signer-host deployment commands for 5M2-host/5M4/5M5). Counts: 23 re-shown, 29 live-only,
30 local-validator, 5 retired-driver (R16-2a/2b, S5-a, R24-3i-a/b — R35.2 one-shots, evidence stands).
Notes in the section: the replay harness's `FAIL` convention vs `ERROR`, the launch-leg finding, the U7
first-pair note, the tamper fix.

**Item 3 — `EVIDENCE.md` RG row: DONE.** RG stays **OPEN** (the live half runs at the final regression);
the row now records the offline half (23 `*-rg.out` at `6802a2f` + the RG table) and what the live half
owes: all Phase 1–5 specs green at one commit on post-NU7 testnet, then the table's 29 live-only +
30 local-validator rows re-shown red at that commit (28 patches need re-cutting first), then R35.3(b)'s
deletion of the 25 folded scripts in one head commit citing the RG evidence. Header notes run 35.

**Batch B35 complete: three items, four commits (harness fix `77d401f`, evidence `ba7b4da`, and this
docs commit), each with its proof above.** The RG live half is the head's/Track A's lane.

### Questions (run 35)

1. **Item 1's scope sentence vs its bullet list (done as written + the two families the sentence covers).**
   "every mutation whose red can be shown offline" would also name M1/M3/M4 and 5M6/5M7/5M11; the bullets
   name only M2 and 5M1/5M3/5M8–5M10. I ran the superset (both extras are the bullets' own commands/harnesses
   over the same committed data) — say the word if the narrower list was intended and I will drop the six
   extra `-rg.out` records from the evidence index wording (the runs themselves stand).
2. **`mut-replay-markets.ts`'s A16 launch leg cannot go green on the committed corpus (Track A's leg).**
   `launch-meet-allocation-order`'s `decorrelated` check fails **unmutated** on `markets/launch/cold-f1170469`
   (`canonical=true decorrelated=false`: its canonical rows coincide with winner-leaf order, so the
   decorrelated leg is unsatisfiable for this data). My B35 runs pass no launch dir (the original
   5M8–5M10 shape). Should the leg re-point at a fresh A16-era launch run when one exists (the live RG),
   or should the `decorrelated` condition be relaxed for corpora where the two orders coincide?
3. **The B35 tamper fix (`77d401f`, `e2e/lib/readpath.ts`) changes a folded assertion's input** (not its
   expectation): the `owner_sig` tamper now always changes the signature instead of writing a `00` byte
   that ~9% of real signatures already have (26/300 measured; three pre-fix flaky reds/greens this batch).
   Classified harness per "a red test is a defect report". Flagging because AGENTS.md guards assertion
   changes; if you want the original tamper restored, the nondeterministic flake returns (~1/12 runs).
4. **Run-33 Q6 (group-B fold shape) stands unchanged** — the ports assert the repros' own verdict
   booleans/outcome values; re-shaping rides the live RG when the live legs can run.

## Previous run (34): Phase 6 Track B offline batch B34 — packaging refresh (R36+R37.5), private-repo hygiene, EVIDENCE PK row

Task (this session's head message): `track-b` fast-forwarded to main at `3ca5c9f` (B33 merged; the head's
`5de3495` network fix — readpath folds pass the network to `seal`/`openEnvelope` — makes B's fold harness
pass on the merged tree). `npm ci` + `npm run build:*` green (`build:seal/core/settle/cli/verify` all exit 0;
`build:verify` reproduces the committed bundle byte-identically; `npm run check:bundle` PASS).
`npm run e2e` PASSED (seal-open 38 s, `tmp/e2e/report.json`, 2026-10-06). Rulings R36 + R37 read: repo stays
private (no license, `package.json` `UNLICENSED`; packaging digests refresh owed), `cli/build.mjs` cleans
`cli/dist` (R37.5; packaging refresh owed together with R36). **Offline only** (drand quicknet reads only);
no OrbStack/VM/`orb`/frostd :2744/testnet spends/`tools/repro/markets.ts`/live specs, no mainnet, no frontend
(`seal/` source untouched), no pin changes, no Track A files. Run-33 questions are all closed (R36/Q1,
R35/Q2, `834e465`/Q3, R37/Q4–Q5).

**Item 1 — packaging refresh (R36 + R37.5): DONE with proof.** New digests from a clean tree at `3ca5c9f`
(two builds each, plus a fresh-clone rebuild; the item's commit adds only `docs/` text + evidence, none of
which `tools/package.mjs` copies into the tarballs, so the digests hold at the recorded commit):

- **verify bundle `80754445…`** (`807544459ea3f467dcd5c6e4312105e0ea2de68f7e1cccd03e3e3d9cbd1a9371`,
  also `docs/verify-bundle.sha256`) — **correction of run-33's table entry**: `effd9853…` was track-b's
  pre-merge bundle (`50ee067`); the B33 merge resolved `dist/benzo-verify.mjs` to Track A's rebuilt bundle
  (`9634882`, A15 envelope/verify changes are bundle inputs). `npm run check:bundle` and the fresh-clone
  rebuild both confirm `80754445…` is byte-equal to a rebuild of the merged tree.
- **npm package `dist/benzo-0.1.0.tgz` `ab18336f…`**
  (`ab18336fd4d52889ebde12925a3e47195bca09c2db395709917c21a1bc4753f9`, 29,695,928 bytes, 18,321
  entries, 112 production packages) — two clean `npm run package` builds identical
  (`docs/evidence/phase-6/pk-package.out`, `pk-package.sha256`).
- **bidder bundle `dist/benzo-bidder-0.1.0.tgz` `fa54df28…` unchanged** (it ships only `seal/` output) —
  two clean `npm run package:bidder` builds identical + the clean-machine seal/open proof PASS
  (`pk-bidder.out`): extracted in a fresh `/tmp` dir with empty `HOME` and no checkout `node_modules`,
  sealed headless to quicknet round 32818939 against the committed launch manifest, `tle` refuses before R
  and opens after R, plaintext byte-equal to the inputs.
- **fresh-clone rebuild PASS, all three digests** (`pk-rebuild.out`: clone HEAD `3ca5c9f`, `npm ci --offline`,
  `build:verify` matches `docs/verify-bundle.sha256`, `package`, `package:bidder`).
- **clean-extract `bin/benzo verify` PASS + `auction balance-addresses` absent** (`pk-package-verify.out`):
  extract in `/tmp` with no `.env`/state dir, shipped Phase 4 evidence as the auction dir, offline —
  all checks OK (`defaults` included), exit 0; the R33-removed command is refused by the packaged router
  (`ERROR usage unknown command`, exit 2) and no tarball entry carries it (0 of 18,321).
- `docs/reproducible-build.md` re-recorded: §2 digest table, §3 transcripts, §5 B34 note (R36/R37.5 changes,
  the verify-bundle correction, what re-proves what).

**Item 2 — `repo-hygiene.md` → private-repo hygiene (R36): DONE with proof.**
`docs/evidence/phase-6/repo-hygiene.md` re-stated (this commit):

- The license **check is dropped** (R36); section 1 is now ruling state, not a check: no `LICENSE` at the
  root (only vendored `forge-std` licenses), `package.json` `UNLICENSED` + `private:true`, never public
  without the user; B33's license-choice question closed by R36. Every other check kept verbatim (sections
  2–6: `.env.example` only, `.gitignore` keys block, no secrets in history, pinned lockfiles, absolute paths).
- **Leak-audit range re-stated up to the current HEAD (`72204b2`)** with a fresh run backing it: same
  command with `--git` (every blob of every commit on every ref), **379 rows**
  (`docs/evidence/phase-6/leak-findings-2026-10-06-b34.json`, tool stdout unedited) vs the B33 record's 353:
  **0 gone, 26 new, all `rule: address`, all classified** — 16 × class C `leaves[].deposit.address` in the
  published A15 drop evidence (`drop-r33/drop-cold/{auction,frozen}.json`, `61b00bb`; only the deposit
  field matches, no refund/delivery destination), 10 × class G fixture literals in Track A's
  `e2e/lib/readpath{,-live,-r261}.ts` (shape-test UAs, the all-zeros Sapling test vector, an `attacker` UA,
  `utest1r261fixture…` placeholders). No secret in any commit up to `72204b2`.

**Item 3 — EVIDENCE.md PK row: DONE with proof.** `docs/evidence/phase-6/EVIDENCE.md` PK row re-recorded
from this batch's committed evidence (new digests `80754445…`/`ab18336f…`/`fa54df28…`, the two-builds and
fresh-clone proofs, the balance-addresses absence, the verify-bundle correction), with the run-34 note in the
file header. The one OPEN item is unchanged: a stranger's clean-machine run recorded end to end.

**Batch B34 complete: three items, three commits (`72204b2`, `6f5c517`, and this one), each with its proof.**
Nothing owed but the OPEN items the gates name (the stranger's run, head's walkthrough, gate LA's final pass)
and the Questions below.

## Previous run (33): Phase 6 Track B offline batch B33 — test/repro audit (RG prep), repo hygiene, README refresh

Task (this session's head message): `track-b` fast-forwarded to main at `1a4846f` (B32 merged, Q3/Q4
accepted); `npm ci` + `npm run build:*` green; then three items in order, one commit per item with proof.
**Offline only**: no OrbStack/VM/orb/frostd :2744/testnet spends/`tools/repro/markets.ts`/live specs, no
mainnet, no frontend, no pin changes, no Track A files (Builder A is mid-batch in `clear/`, `cli/`,
`witness/`, `api/`, `settle/`). Session-start checks: clean tree at `1a4846f`; `npm run e2e` **PASSED**
(seal-open 37 s, `tmp/e2e/report.json`, 2026-10-06). Builds: `build:seal/core/cli/verify` all exit 0
(`build:settle` unchanged this batch — its outputs not needed for docs work).

**Item 1 — test and repro audit (READY-FOR-REVIEW prep): DONE with proof.**
`docs/evidence/phase-6/test-audit.md` (commit `39ba6c0`), written from committed evidence only; nothing
deleted or moved (the head rules on the marks first).

1. **(a) one row per `e2e/*.spec.ts`** (7 specs; all mark **R**): assertion IDs each owns (C1–C7 /
   A1–A5+B1+D1–D3 / E,F,G,H,I / J,K,L,M,N / O,P,Q,R,S,T / Y,V,W,X / M-*); last mutation `.out` and base
   commit per spec (M1–M4 `36913b6`; M5–M7 `4c5e4a9`; N1-regression `3174c60`; P1-expiry `47b665f`;
   R7M1 `8a37993`; buyback 5M1/5M3 replays `cfd2f84` + live 5M5/5M2-host/5M4; markets 5M8–5M10 `7dcaeda`);
   **every spec's covered code changed since** (file counts 6/75/60/10/52/30/26 in the cited ranges) — so
   each owes its cheapest-mutation re-run at gate RG: M2 (seal-open, offline), M5, N7, P3, U2 (live lane),
   5M1 replay (buyback, offline), 5M8 replay (markets, offline).
2. **(b) one row per `tools/repro/` file** (50 + the `fixtures/` corpus): what it proves, its sanction
   (Ruling ID / STATUS entry / head commit), the evidence that cites it (or "none" where true), and a mark —
   17 KEEP, 25 FOLD, 8 RETIRE, corpus KEEP.
3. **Test count and consolidation proposal:** 47 of the 50 files are tests by the AGENTS.md definition
   (only `sweep-vault.ts`, `republish.ts` (ops) and `xchain-demos.sh` (wrapper) are not) — 54 committed
   tests against the ceiling of 8. Proposal (head rules first): (1) a Ruling names the 14 gate evidence
   drivers/harnesses as "evidence runs, not specs" (extending PHASE-6 §3's bench/leak-audit wording);
   (2) fold 25 scripts into their owners (`batching-equal.ts` → the bench batch-plan stage; 24 one-shot
   fix repros → `cli-auction.spec.ts`/`auction-core.spec.ts` as Ruling-added assertion IDs, mutation
   `.patch`es re-pointed as red proofs); (3) RETIRE 8 superseded/covered one-shots with evidence staying
   committed. End state: 8 tests + 14 named evidence drivers + 2 ops tools + 1 corpus.

**Item 2 — public-repo hygiene (Phase 6 Track B item 5): DONE with proof.**
`docs/evidence/phase-6/repo-hygiene.md` (`9f24a41`) — checklist, one command + result per line:

1. **LICENSE — was FAIL, fixed** (`9f24a41`): no LICENSE existed and `package.json` had no `license`
   field. Added `LICENSE` (MIT, `Copyright (c) 2026 Akash Mondal` from the repo's git identity) + `"license":
   "MIT"`. **Question below: license choice + holder need head/user confirmation.** The shipped tarball does
   not include LICENSE yet (adding it changes the recorded digests) — noted for the next packaging refresh.
2. **`.env.example` only, all documented — PASS** (one comment fix): tracked `.env` files = `.env.example`
   alone; every variable carries its provider | required/optional comment; name-level diff vs the real `.env`
   shows no undocumented variable (values never printed). Two `/Users/…` setup-comment paths neutralized
   (`your home volume`, `"$HOME/Dev Projects/benzo"`).
3. **`.gitignore` — PASS + hardening**: `.benzo/`, `tmp/`, `vendor/nu7/`, `*.sqlite*`, `.env*` were already
   covered; added an explicit keys block (`*.pem *.key *.agekey *.mnemonic ufvk.txt`).
   `git ls-files -ci --exclude-standard` empty (nothing tracked becomes ignored).
4. **No secrets in history — PASS (re-run)**: run-31 range `7c235d6..5475c60` (331 rows classified) cited;
   `npm run leak-audit --git` re-run covers every blob of every commit (subsumes the 38 commits since
   `5475c60`): **353 rows, 0 gone, 22 new — all classified** (20 × public `leaves[].deposit.address` in the
   A14 buyback evidence at `05f97b8`, class C; 2 × age-armor = the bundled age codec's header/footer string
   literals in `dist/benzo-verify.mjs` at `9634882`/`a1f9d90`, class G code constant). Record:
   `docs/evidence/phase-6/leak-findings-2026-10-06.json` (`096c62e`, tool stdout unedited; sha256-of-value
   rows only).
5. **Pinned lockfiles — PASS**: root `package-lock.json` + `settle/`/`scan/`/`contracts/solana(+test/proxy)`
   `Cargo.lock` + `contracts/evm/package-lock.json` + `tools/pins.env`; dependency scan `unpinned: []`;
   `npm ci` clean this session.
6. **Absolute local paths outside evidence — 2 fixed, 14 listed** (`git grep -l '/Users/' -- ':!docs/evidence'`
   = 16 files): fixed mine — `docs/STATUS-B.md` (14 × `~/Dev Projects/`) and `.env.example`; listed
   untouched: `deploy/signers/up.sh`, 9 × `contracts/logs/*.out`, `docs/PHASE-5.md` (head),
   `docs/research/organizer-forensics.{jsonl,md}` (read-only), `tools/repro/g-forged-claim.mjs` (Track A's
   `source:` provenance line — head/A should sanitize).

Commits: `9f24a41` (fixes + checklist), `096c62e` (leak-run evidence).

**Item 3 — README refresh (gate DOC): DONE with proof.** `README.md` (`9f94e1f`): host custody
(R28) in Settle; 2-of-3 host attestations (R31) in Cross-chain; settlement scale numbers (R29/R30:
608 batches at cap 28, 88,040,000 zats, 20.9 h projection / 24.1 h at cap 13, 94,380-byte 28-output
batch, FROST flat 8.2 s) each pointing at `bench.json`/`scale-measure.md`; the market-mode Proof
column refreshed (all but Vickrey testnet-proven live, pointer to EVIDENCE.md LP-0004); the Quick
start transcript re-run fresh (`bin/benzo verify` on the Phase 4 evidence at 2026-10-06, exit 0) and
the bundle digest updated to `effd9853…` (= `docs/verify-bundle.sha256`, `npm run check:bundle` OK);
links to `docs/api-reference.md` and `docs/reproducible-build.md`. **Track headline and honest-limits
kept verbatim — no Ruling changed a fact there** (gate H owns the honest-limits update).
- Item 3 follow-up (`50ee067`, evidence `00c8412`): the README/LICENSE change moves the shipped npm
  tarball's digest, and A's bundle rebuild (`9634882`/`a1f9d90`) had already moved the verify-bundle
  digest — `docs/reproducible-build.md`'s table and `docs/verify-it-yourself.md` §1 were re-recorded
  (verify `effd9853…`, npm `f123cdde…`, bidder `fa54df28…` unchanged), `pk-package.{out,sha256}` +
  `pk-package-verify.out` regenerated at `50ee067` with a **fresh-clone re-proof PASS** (clone →
  `npm ci --offline` → `npm run package` reproduces `f123cdde…` byte-for-byte) and a clean-extract
  verify exit 0. The rebuild found a staleness bug (recorded in reproducible-build.md §5):
  `cli/build.mjs` never prunes `cli/dist/commands/`, so the **removed** `auction balance-addresses`
  command stayed live in build output and in the first regenerated tarball until `cli/dist` was
  deleted and rebuilt — the recorded digests come from the cleaned tree. **Question below (Q5).**

**R35 execution (head ruling `3f71fd8`, mid-batch) — items 4-6:**

**Item 4 (R35.2 RETIRE 8): DONE.** Deleted `g3-reserve-opening-unpublished.mjs`,
`obligations-equal.ts`, `r10-5-signer-state-repro.mjs`, `r16-memo-bound-repro.mjs`,
`r24-3i-classify-address-repro.mjs`, `r5-fund-quote-repro.mjs`, `r7-witness-repro.mjs`,
`routing-vs-envelope-repro.mjs` (`834e465`-era tree; commit after the head's two head: commits).
`.out` evidence, mutation patches and `fixtures/` stay. No `package.json` or operational doc
reference existed to remove (docs cite the evidence files, not the scripts). Head's `834e465` fixed
g-forged-claim's path itself (Q3 closed).

**Item 5 (R35.3a FOLD step a): tranches 1-2 DONE and scratch-validated; tranche 3 next.**
- **batching-equal → bench** (`cb4bcab`): the planBatches==allocate equivalence now runs inside the
  `npm run bench` batch-plan stage. Green: `npm run bench -- --bids 100` all 7 stages PASS
  (`PASS batching-equal cap=13 batches=77 / cap=28 batches=36`, same counts as the standalone
  repro). Red: **B31-a re-run** `ERROR batching-equal-cap13` at `cb4bcab`
  (`mutations/B31-a-rerun-r33.out`); `B31-a.patch` re-pointed at the bench run.
- **g7-network → auction-core.spec.ts** (`5886882`): 11 `g7-*` IDs + four-answer header. `X3-a.patch`
  re-cut (it no longer applied) + re-pointed (`BNZ_LIVE=1 npx playwright test --project=auction-core`
  → `ERROR g7-mainnet-ua-refused-on-test`). Compiles/lists green (`--list` shows the test).
- **tranche 1 → cli-auction.spec.ts via `e2e/lib/readpath.ts`** (`979f34e`): 30 IDs (r15-* x4,
  r26-3-* x6, r23-3-* x3, g-forged-claim-*/r23-1-* x7, kc-* x10) + four-answer header. Mutation
  patches **re-cut** (5 were stale against current `api/` sources) + re-pointed at the spec run:
  R15-F4a/F4b/F5, R16-F2a, R23-3a (re-cut), R26-3a/R26-3b (headers).
- **tranche 2 → cli-auction.spec.ts** (`b04a9cb`): 23 IDs (mr-* x13 in `readpath.ts`; r26-1-* x5 and
  r23-2-* x5 as **verbatim ports** of the repro bodies in `e2e/lib/readpath-r261.ts` /
  `readpath-r232.ts`, their `check(id, ok, reason)` calls replayed through `Run.check` so IDs and
  expected values are byte-identical). `R23-2-revert.patch` re-pointed.
- **Scratch validation (tmp/, not evidence):** a throwaway Playwright config runs the fold families
  with the real `Run` outside the live spec — `npx playwright test --config=tmp/folds.config.ts`:
  **ALL 53 PASS** (30 + 13 mr + 5 r26-1 + 5 r23-2) in ~1 min. This caught and fixed four real port
  bugs before commit (r26-3 summary tamper no-op; two corpora invalid under the tightened claims
  rule; missing `edSign`/`edVerify` imports in the r23-2 port). Two contract findings recorded in
  the fold headers: today's verifier requires a certified strays statement for any claim (the
  g-forged-claim script's own pre-R23.1 corpus would fail today), and the r26-3 corpus's refunded
  stray row now needs claim proof.
- **Tranche 3 DONE (all 15 remaining scripts folded).** `e2e/lib/readpath-live.ts` +
  `cli-auction.spec.ts`: group A — the r7-3/g2 exception-queue drills (`r7-3-exception-queue`,
  `g2-envelope-crash-not-exception`, `g2-wrong-key-exception`, `g2-taddr-exception`; live, injected
  into the spec's cleared auction's ledger+public copy with backup/restore) and the sealed-reserve
  binding (`U7`, `r7-5-reserve-opening`; offline, over the reserve-opening repro's own corpus —
  scratch-validated in the 55/55 run). `U7.patch` re-pointed at the FOLD3 block. Group B — 12 IDs as
  **verbatim ports** of `r7-1`(incl. the g1 row), `r7-2`, `r7-4`, `r7-6`, `r7-claims`, `r10-2`,
  `r10-4` (2 IDs), `r15-3`, `r16-1`, `r16-4`, placed **after** the spec's own settlement/cancel flow
  so their state drills (each restores what it mutates) cannot affect the assertions above.
  `playwright --list` loads all 7 spec files green (9 tests in 7 files).
- **Fold totals:** 10 mutation patches re-pointed at the spec/bench runs (B31-a; X3-a, R15-F4a/F4b/F5,
  R16-F2a, R23-3a re-cut because they no longer applied; R26-3a/b, R23-2-revert, U7 re-pointed);
  folded IDs: 30 (tranche 1) + 23 (tranche 2) + 6 (group A) + 12 (group B) + 11 g7 + the bench's
  `batching-equal-cap{13,28}` = 84. Nothing in group 2 deleted (R35.3(b): deletion rides the head's
  RG commit). Scratch validation (offline legs only): **ALL 55 PASS** at the final tree.
- **Unvalidated by design until RG (R35.3(b)):** the live legs (group A drills, all of group B). Two
  shape notes for the RG pass: group B's ports assert the scripts' own verdict booleans/outcome values
  (their exact semantics), and `r7-5`'s live emit leg (publish() carries `reserve_opening` after R)
  is not folded — the spec's manifest carries no `sealed_reserve` (Q4 below).

**Item 6: STATUS updates — this entry. Batch B33 + the R35 execution are complete; every commit has
its proof above.**

### Questions (run 33)

1. **LICENSE choice needs confirmation (item 2).** The phase doc's hygiene line requires a license; no Ruling
   names one. I chose **MIT**, `Copyright (c) 2026 Akash Mondal` (the repo's git identity) and made
   `package.json` say `"license": "MIT"`. Confirm, or rule a different license/holder and I will swap both.
   Separately: `npm run package`'s tarball does not ship `LICENSE` yet (adding it changes the recorded
   digests) — fold into the next packaging refresh?
2. **Repro consolidation proposal (item 1) awaits your ruling before anything is deleted or moved.**
   `docs/evidence/phase-6/test-audit.md` §(b): 47 of 50 `tools/repro/` files are tests by the AGENTS.md
   definition (54 committed tests vs the ceiling of 8). Proposal: (1) a Ruling names 14 gate evidence
   drivers/harnesses as "evidence runs, not specs" (extending PHASE-6 §3's bench/leak-audit wording);
   (2) fold 25 scripts into their owners (`batching-equal.ts` → the bench batch-plan stage; 24 one-shot
   fix repros → `cli-auction.spec.ts`/`auction-core.spec.ts` as Ruling-added assertion IDs);
   (3) RETIRE 8 superseded/covered one-shots, evidence staying committed.
3. **CLOSED by the head (`834e465`):** the `/Users/…` path in `g-forged-claim.mjs` is gone.
4. **`r7-5`'s live emit leg is not folded (R35.3a).** `publish()` carrying `reserve_opening` after R
   needs a sealed-reserve product auction; the spec's manifest has no `sealed_reserve`, and adding one
   (even a non-binding bound) changes the live fixture I cannot validate offline. Its binding legs are
   folded (`U7`, `r7-5-reserve-opening` in the FOLD3 block). Where should the emit leg go — a
   `sealed_reserve` added to the spec's manifest (head/Track A validates live), or a separate scenario
   in the markets harness (Track A's live lane)?
5. **`cli/build.mjs` never prunes `cli/dist/commands/` (found by the item-3 packaging run).** A removed
   command stays live in build output and in any tarball built without a clean — the R33-removed
   `auction balance-addresses` shipped in my first regenerated tarball until I deleted `cli/dist`. The
   fix is one line in `cli/build.mjs` (rm the output dir first) — a Track A file, so head/Builder A
   should land it; my recorded digests come from a clean build either way.
6. **Group-B fold shape (R35.3a).** The verbatim ports assert the repros' own verdict booleans and
   `outcome` values (their exact assertion semantics, byte-faithful), not freshly-worded semantic
   assertions. If the head wants them re-shaped, that is best done in the RG pass when the live legs
   can actually run.

## Previous run (32): Phase 6 Track B offline batch B32 — API reference (DOC), bidder bundle + repro notes (PK), evidence rows

Task (this session's head message): `track-b` fast-forwarded to main at `1bbb849` (B31 merged); `npm ci` +
all `npm run build:*` green (`build:seal/core/settle/cli/verify`; `npm run check:bundle` OK, bundle
`fc735f3c…`); then four items in order, one commit per item with proof. **Offline only except drand
quicknet reads for item 2.** No OrbStack/VM/orb/frostd :2744/testnet spends/`tools/repro/markets.ts`/live
specs, no mainnet, no frontend (`seal/src`, `seal/index.html` untouched), no pin changes. Track A files
untouched: `settle/{ledger,plan,cli,sign}.ts`, `cli/{product,host-derive}.ts`, `tools/repro/markets.ts`.

**Item 1 — API reference for the UI (gate DOC): DONE with proof.**

- `docs/api-reference.md` (`f5a022a`): every route of `benzo api serve` and `node api/dist/server.mjs`
  (`/auction/:auction_id`, `/operator`, `/freeze`, `/result`, `/allocation`, `/receipt/:ciphertext_hash`),
  the states each answers in and its 409/400/404/405 bodies, every response field typed and explained
  from the code with `file:line`, the trust layers (signed manifest, `--signer` anchor R20b,
  `benzo verify`'s opening re-derivation), what a UI must never trust without `benzo verify`, and the
  privacy section: no route returns bid plaintext (ever — `opened`/`claims`/`envelopes` have no route,
  `api/server.ts:32-86`); no route returns any Zcash refund/payout destination (settlement receipts are
  exactly the six T2 fields, `api/public-auction.ts:26,225,502`; `receipt.inclusion.deposit.address` is
  the public escrow deposit address); the launch `/allocation` token-chain delivery rows are documented
  as the one destination-bearing output by design (R34 item 1). Each response's key set is a
  `<!-- shape: … -->` block — the machine-checked contract.
- `tools/repro/api-reference-check.ts` (`f5a022a`): builds `api/dist/server.mjs` from the working tree
  (`node cli/build.mjs`), serves the committed published auction dir
  `docs/evidence/phase-5/markets/launch/cold-f1170469` (plus pre-result and mid-flight-broken copies of
  the same document in `tmp/` for the 409/400 bodies), requests every documented route and case, and
  asserts each response's key set against the doc's shape blocks; also the startup contract
  (`--signer` mismatch → exit 1; missing `--dir` → exit 2).
- Proof: `docs/evidence/phase-6/repro/api-reference.out` — **PASS api-reference 11 documented shapes**
  (16 requests + 2 startup cases), run at `f5a022a`, 2026-10-05T20:12Z, exit 0. **Mutation B32-a**
  (`mutations/B32-a.patch`: drop `leaf_count` from the `/auction/:auction_id` response) →
  `ERROR shape.auction … missing key leaf_count`, exit 1, tree clean after `git apply -R`
  (`mutations/B32-a.out`).
- Command: `npx esbuild tools/repro/api-reference-check.ts --bundle --platform=node --format=esm
  --outfile=tmp/api-reference-check.mjs && node tmp/api-reference-check.mjs`.
- Commits: `f5a022a` (doc + check tool), `7d06f55` (evidence). `npm run typecheck` green at `f5a022a`.

**Item 2 — bidder bundle (gate PK): DONE with proof.**

- `npm run package:bidder` (`tools/package-bidder.mjs`, `979ca65`): builds `seal/dist` from the tree and
  writes `dist/benzo-bidder-0.1.0.tgz` + its sha256 sidecar — **packaging only**, `seal/src` and
  `seal/index.html` untouched. Byte-for-byte reproducible via `tools/deterministic-tar.mjs` (ustar,
  sorted file list, fixed mtime 2026-01-01, modes normalized 644/755, uid/gid 0, `gzip -n`; pax was
  rejected after a test showed its atime records break determinism). Contents: `index.html` +
  `main.js`, 80,859 bytes.
- **Two builds identical:** sha256 `fa54df28e87c507336897f88cf0f831d8df7599f48e54ebeada98dc77cae88f6`
  from both builds, recorded in `docs/evidence/phase-6/pk-bidder.out` (`OK build-1`, `OK build-2`,
  `OK build-identical`; sidecar re-checked against the tarball bytes).
- **Clean-machine proof** (`tools/repro/bidder-bundle-proof.ts` + `bidder-bundle-driver.mjs`, run at
  `979ca65`, 2026-10-05T20:26Z, exit 0): in `/tmp/benzo-bidder-proof` with `HOME` pointed at an empty
  dir and the driver environment cut to `PATH` + `BR_*` (no `NODE_PATH`, no checkout `node_modules` —
  the driver is node builtins only), it (1) extracted the tarball (2 entries), (2) served it with the
  e2e's own `node:http` static-server pattern (see Questions for the "pinned static server" wording),
  (3) drove the page headless with the same Playwright Chromium the e2e uses (pinned
  `@playwright/test 1.63.0` → `chromium_headless_shell-1243`, resolved via `playwright-core`'s
  `launchServer().process().spawnfile`) over the DevTools protocol — filling the form with values from
  the committed signed manifest `docs/evidence/phase-5/markets/launch/cold-f1170469/manifest.json`
  (auction id, C, escrow deposit address) plus chosen price/quantity/nonce/owner/commitment — and
  (4) after quicknet round 32809545 (5 rounds ahead, waited by polling `…/public/<R>`), opened the
  ciphertext with pinned `$BNZ_STATE_DIR/bin/tle` and asserted the 128-byte plaintext equals the
  inputs chosen, byte for byte. Also asserted: page sealed to exactly round R; the tlock stanza is
  `-> tlock 32809545 <quicknet chain>`; only 2 requests, both to the static origin (no network while
  sealing); `tle` refuses before R (`too early to decrypt`).
- Command: `npx esbuild tools/repro/bidder-bundle-proof.ts --bundle --packages=external --platform=node
  --format=esm --outfile=tmp/bidder-bundle-proof.mjs && node tmp/bidder-bundle-proof.mjs`.
- Commits: `979ca65` (packaging + proof drivers), `ee5022b` (evidence `pk-bidder.out`).

**Item 3 — reproducible-build notes (gate PK): DONE with proof.**

- `docs/reproducible-build.md` (`1159c80`, digest updates `64546a1`/`9aee17e`): the exact pinned
  toolchain (Node v24.15.0 / npm 12.0.2 / bsdtar 3.5.3 / Apple gzip 475 / esbuild 0.28.2 /
  typescript 5.9.3 / `@playwright/test` 1.63.0 → `chromium_headless_shell-1243` / tlock-js 0.9.0,
  everything else from `package-lock.json`, plus the `tools/pins.env` table), the commands that
  rebuild `dist/benzo-verify.mjs`, the npm package and the bidder bundle **byte-for-byte**, and the
  expected sha256 values: `fc735f3c…` / `7f3e08aef6a6e2f8f1c47eefe6b54d1c1a2a0a50fd591c27ec5ae3948b4d38e6` /
  `fa54df28…`. The fresh-clone transcript is `docs/evidence/phase-6/pk-rebuild.out` — **PASS, all
  three digests match** (clone of `track-b` at `9aee17e` into `/tmp/benzo-rebuild`, `npm ci --offline`,
  then the three build commands).
- Making "the npm package byte-for-byte" true required two packager fixes and one startup fix, each
  found by the fresh-clone run and each recorded in `docs/reproducible-build.md` §4–5:
  1. `tools/package.mjs` now packs through `tools/deterministic-tar.mjs` (ustar — pax records atime
     and is not byte-stable; sorted file list; fixed mtime incl. symlinks via `lutimesSync`; modes
     normalized 644/755; uid/gid 0; `gzip -n`).
  2. `node_modules/**/.bin/*` symlinks: one (`rpc-websockets/node_modules/.bin/uuid`) was an
     **absolute** link into the builder's checkout — it broke byte-for-byte rebuilds and would dangle
     for any stranger. `tarGz({linkRoot})` rewrites such links to archive-relative targets.
  3. `npm run package` must `build:seal` first (`seal/dist` is gitignored; the extract needs it).
  4. **Packaged-CLI startup:** the router imports every command at startup and
     `cli/commands/auction-keys.ts` eagerly imported `settle/io`, which resolves `BNZ_STATE_DIR` at
     import time (`settle/io.ts:8`) — so `bin/benzo --help` and every read path died in any extract
     or checkout without `.env` (`ERROR benzo The "paths[1]" argument must be of type string`).
     Fixed by importing `settle/io` inside `run()` (the `bid-seal.ts` pattern). **Flagged under
     Questions — one line in a Track-A-flavoured file (`cli/commands/auction-keys.ts`), not on the
     batch's banned list.**
- Regenerated (old values superseded, still in git history): `pk-package.out` / `pk-package.sha256`
  (tarball was `856fae26…` under the old `tar czf`) and `pk-package-verify.out` — the clean `/tmp`
  extract at `9aee17e` now starts with no `.env`, runs `bin/benzo verify` on the shipped Phase 4
  evidence **offline**, all checks OK, exit 0.
- Command: `bash tmp/rebuild-proof.sh > docs/evidence/phase-6/pk-rebuild.out` (scratch driver in
  `tmp/`, gitignored); package evidence captured with `npm run package` + `tar -tzf` + the clean
  extract transcript.
- Commits: `1159c80` (deterministic packager + notes), `4f9c442` (build:seal fix), `64546a1`
  (absolute-symlink rewrite), `9aee17e` (auction-keys startup fix + final digests), `7bb5021`
  (evidence).

**Item 4 — EVIDENCE.md PK/DOC rows: DONE.** `docs/evidence/phase-6/EVIDENCE.md` (`9954f5e`):
**PK → READY FOR REVIEW except one OPEN item** (a stranger's clean-machine run recorded end to end);
evidence cells cite `pk-package.{out,sha256}` (`7f3e08ae…`), `pk-package-verify.out`, `pk-bidder.out`
(`fa54df28…` + clean-machine seal-open), `pk-rebuild.out` (all three digests from a fresh clone),
`docs/reproducible-build.md`. **DOC → partial, API reference done** (`docs/api-reference.md` +
`repro/api-reference.out` + `mutations/B32-a.*`); OPEN items stay OPEN: the head's literal
clean-checkout walkthrough of each guide, and gate H's honest-limits update.

**Batch B32 complete.** All four items delivered with proof, offline except the drand quicknet reads
item 2 needs. No OrbStack/VM/orb/frostd/testnet-spend/market-spec activity, no mainnet, no frontend
(`seal/src`, `seal/index.html` untouched), no pin changes, no Track A banned file edited (one
non-banned `cli/commands/auction-keys.ts` line moved — see Questions). Regression: `npm run e2e`
**PASSED** (seal-open, 40 s, `tmp/e2e/report.json` at 2026-10-05T20:54Z) and `npm run typecheck` green at `9aee17e`; the later
commits touch only `docs/`. Commit map (run 32): `f5a022a` doc+check · `7d06f55` evidence ·
`eb6400f` STATUS · `979ca65` package:bidder+proof · `ee5022b` evidence · `830aa18` STATUS ·
`1159c80` deterministic packager+notes · `4f9c442` build:seal fix · `64546a1` symlink fix ·
`9aee17e` auction-keys fix · `7bb5021` evidence · `9954f5e` evidence (EVIDENCE.md).

### Questions (run 32)

- **Q1–Q2 CLOSED by R34 (head, `c4caa11`, in PHASE-6.md).** (1) The API-reference privacy wording
  keeps the narrower claim — no route returns bid plaintext before R, no route returns any **Zcash**
  refund or payout destination — and names `GET /allocation`'s token-chain rows as the one
  destination-bearing output by design; `docs/api-reference.md` §4 updated accordingly. (2) The
  launch delivery row order is fixed on Track A after A15 (rows sorted canonically by destination
  bytes, allocation root over that order, `benzo verify` replaying the sort); my reference then
  documents the sorted order (noted in §4 meanwhile).
- **`cli/commands/auction-keys.ts` edit (item 3) — please confirm.** The clean-extract proof showed
  its eager `settle/io` import (which resolves `BNZ_STATE_DIR` at import time) killed the whole
  packaged CLI outside a checkout. I deferred the import into `run()` (the `bid-seal.ts` pattern) —
  a two-line change in a file that is not on the batch's banned list but reads like Track A's launch
  lane. Revert or re-home it if Track A wants it done differently; without it gate PK's "stranger
  runs `benzo verify` from outside any checkout" claim fails.
- **"A static file server you already have pinned" (item 2) — what I used.** No static file server is
  pinned in `tools/pins.env` or the lockfile (esbuild's `--servedir` would be one, but its binary lives
  in `node_modules`, which the proof environment is denied). I served the extracted bundle with the
  project's own static-server pattern (`e2e/lib/sealer.ts`, `node:http`, zero dependencies) inside the
  driver. Say the word if you meant a specific tool and I'll switch the proof to it.

## Previous run (31): Phase 6 Track B offline batch — bench batch-plan + projection (SC offline), leak re-run (LA), evidence index (DOC/RG prep)

Task (this session's head message): `track-b` fast-forwarded to main at `6e5cc7b` (B30 batch merged);
`npm ci` + all `npm run build:*` + `npm run check:bundle` green there before new work; then three items in
order, one commit per item with proof. **Offline only**: no OrbStack VMs/orb/frostd :2744/testnet spends/
`tools/repro/markets.ts`/live specs, no mainnet, no frontend, no pin changes. Track A files untouched:
`settle/{ledger,plan,cli,sign}.ts`, `cli/{product,host-derive}.ts`, `tools/repro/markets.ts`.

**Item 1 — bench batch-plan stage + projection (gate SC offline half): DONE with proof.**

1. **(a) `settle/batching.ts`** — side-effect-free `planBatches(obligations, cap)` (imports only
   `manifest/schema`; no `.env`, no wallet, no `io.ts`): eligible rows ordered by party in SQLite's
   BINARY order (UTF-8 bytes, `Buffer.compare` — not `localeCompare`, not JS `<`), cut into batches of
   `cap`, ids from 1. It must equal `settle/ledger.ts allocate()` exactly (Track A's file, unedited).
2. **(b) `tools/repro/batching-equal.ts`** — pins 1,000 synthetic rows (mixed-case ASCII groups + one
   non-BMP/BMP pair where UTF-16 order disagrees with UTF-8) into a real `Ledger` in a temp state dir,
   drives `pin/eligible/allocate/stage/confirm` until exhausted (every batch marked mined through the
   ledger's own methods), and compares batch-for-batch with `planBatches` for cap 13 and cap 28.
   **PASS batching-equal cap=13 batches=77 / cap=28 batches=36**
   (`docs/evidence/phase-6/repro/batching-equal.out`, run at `973feac`).
3. **(c) bench stage `batch-plan`** — `tools/bench.ts` runs it as a real stage via `planBatches` at
   **`batch_cap: 28`** (R30). Per batch: spends = the batch's deposit notes + 1 fee-reserve spend
   (each synthetic bid backs one deposit note; the seller backs none — this reproduces the measured
   scale-27 batch exactly: 28 spends / 28 outputs / fee 140,000), outputs = the batch's rows,
   actions = max(spends, outputs, 2), ZIP-317 fee = 5000 × actions.
4. **(d) projection block** in the run record — linear fit through the scale-8 and scale-27 points for
   host build (23.026 s → 65.144 s) and parallel host approvals (19.961 s → 50.243 s), FROST flat
   8.2 s per batch (R29), mining overlapped/excluded; every constant cites its raw evidence file
   (`scale/scale-8-r29b-timing.jsonl`, `scale/scale-27-timing.jsonl`, `scale-measure.md`).
   **17,000 bids: 24.13 h at cap 13 (1,308 batches), 20.85 h at cap 28 (608 batches).**
5. **(e) proof** — `npm run bench -- --bids 17000` at `3bfde30` (2026-10-05T18:30–18:54Z): all 7 stages
   PASS (generate 538 s, admission 3 s, freeze 0.4 s, open 451 s, clear 0.7 s, batch-plan 0.07 s,
   verify 455 s; peak RSS ≤ 1,058 MiB), the shipped verifier all-checks-OK with network disabled,
   `settlement_batches=608`, `estimated_fee_zats=88040000`, `status: "PASS"`
   (`docs/evidence/phase-6/bench.json`). **Mutation B31-a**
   (`mutations/B31-a.patch`: `planBatches` sorted with `localeCompare`) turns (b) red at both caps:
   `ERROR batching-equal-cap13` / `ERROR batching-equal-cap28`, exit 1, tree clean after `git apply -R`
   (`mutations/B31-a.out`).

Harness fix found by the first full run (product rule working, bench stale): the synthetic manifest did
not pin `envelope_keys`, so the shipped verifier's envelope-record check refused its v2 N-3 records
(`ERROR envelope refused: envelope record format`); fixed in `3bfde30`, stage chain green at 100 bids
before the evidence run.

Commits so far: `ed0b323` (item 1 a–d code), `973feac` (verify-bundle rebuild; accepted by R32),
`3bfde30` (bench harness fix), `1f4258b` (item 1 evidence), `826170e` (item 2 evidence),
`d826521` (STATUS after item 2), `2824944` (item 3 evidence). R32 (`617c9f2`) answered the run-31
Questions (below). `npm run typecheck` and `npm run check:bundle` green at `3bfde30`; no code changed
after that, so both still hold. Batch complete: all three items delivered with proof, offline only,
no Track A file touched, no VM/frostd/testnet-spend activity, no mainnet.

**Item 2 — leak-audit re-run (gate LA): DONE with proof.** `npm run leak-audit` (as shipped) over
`docs/evidence/**` (incl. `phase-5/markets/`, `phase-5/repro/` B30 evidence, `phase-6/scale/`,
mutations, repro), the `tmp/**/public*` dirs, and `--git` full-blob history (subsumes `git log -p`
since `7c235d6`); sensitive list rebuilt only from this checkout's `.benzo/` (52 kept + 54 added =
106 entries — added the xchain host/chain keys, witness/TLS/program keys, manifest-signing PEM; values
never printed). Range `7c235d6` → `5475c60`, 172 commits. 560 rows first pass; the 303 new-context
rows reviewed one by one: 229 intended-public deposit/balance/fixture/test-vector addresses (+34
reviewed allowlist paths, 28 → 62), 32 tmp scratch, 42 = the publicly known **anvil dev key 0**
fixture constant hardcoded as `ANVIL_SK` in `crosschain/*.mjs` + `tools/repro/xchain-demos.ts` (new
class G, disclosed, not custody). Final **331 rows, every one classified A–G** in
`docs/evidence/phase-6/leak-audit.md`; record `leak-findings-2026-10-05.json`.
**No real finding**: no keys/mnemonics/UFVKs/envelope plaintext in any surface or blob, no
refund/delivery addresses outside the immutable disclosed class C. Still owed (as at run 2):
bid-plaintext-before-release `release_time` entries.

**Item 3 — Phase 6 evidence index (DOC/RG prep): DONE with proof.** `docs/evidence/phase-6/EVIDENCE.md`
(`2824944`): (a) gate table — one row per gate (H, SC, LA, PK, DOC, RG) with status, committed
evidence paths, the one-command repro and exactly what is missing; nothing marked done without
evidence (SC offline half READY FOR REVIEW; LA ready for its range with the post-RG pass owed;
H/SC-live/RG OPEN on Track A; PK/DOC partial with named gaps). (b) LP-0004 table — one row per
completed live testnet auction in the committed evidence: 8 phase-5 markets scenario runs, 3
recoveries, the head's 7-auction live spec run (`spec-run/`, `b698770`), and scale-8 ×3 + scale-27 —
auction id, mode, bidders, frozen root, drand round, settlement txids, `benzo verify` verdict, fees,
every cell read from committed files ("not recorded" where absent; the drop rows read from `main`'s
`2acbeb6` evidence, noted in-table). `lp-0004.md` now points at it (22 added cycles, same
single-wallet caveat).

### Questions (run 31)

- **Both run-31 questions are CLOSED by R32 (head, `617c9f2`) — no action left.** (1) Verify-bundle
  provenance: the head confirms the merged bundle was built in a temporary worktree with a linked
  `node_modules`; `973feac` is the accepted bundle, and any future merge rebuilds it in the real
  checkout after the merge. (2) `e2e/lib/frost.ts startFrostd` now binds `BNZ_FROSTD_ADDR`'s port
  (fixed by the head in `617c9f2`).

## Previous run (30): head batch — cross-chain on the signer hosts, xchain demo drivers, mainnet readiness, guides

Task (this session's head message): merge main, then four items in order, one commit per item with proof.
Tree after `git merge main` (`970ce70`; main's R28/R29/R30 + part-2 work): `npm ci`, all `npm run build:*`
green (`vendor/nu7` materialized via `tools/nu7/build.sh crates`), `npm run typecheck` clean, `npm run
e2e` **PASS 36 s** before new work. Rules in force: no VM/orb/frostd-2744/testnet-spend/live-spec
activity, no mainnet, no frontend, no pin changes, never weaken R28.

**Item 1 — cross-chain on the signer hosts (part 2 §2 (a)–(d)): DONE with proof** — code
`b74a28a`, evidence `d969dc0`.

1. **(a)** `benzo xchain keygen --chain evm|solana --name SIGNER` (runs ON a host like `witness
   keygen`): writes `state/xchain/<chain>-<name>.key` mode 0600, refuses to replace it, prints only
   the public part (EVM address / Solana pubkey).
2. **(b)** `benzo xchain attest --host-record`: one signer host's own single envelope key + xchain key
   over the pushed public dir; every leaf's opening and destination still derived by the host itself
   (R21/R22/R19 unchanged); output is the host's SIGNATURE record (attestation bytes — EIP-712 digest
   / Solana 200-byte message —, its own signature, its own derived payouts) and the only thing printed.
   `--envelope-key` also accepts the shipped `sign envelope-key` JSON. **Without `--host-record` the R25
   item 2 ≥2-agreement rule stands unchanged** (a single/duplicated key can never attest a leaf); the
   2-of-3 rule in host mode is enforced at release (below).
3. **(c)** `benzo xchain release --attestation FILE --attestation FILE ...`: the coordinator collects
   host records over the **identical attestation bytes and payout sets**, re-derives the bytes from the
   record fields + chain inputs, verifies every signature against **the escrow's own pinned signer set
   read from chain**, requires ≥ 2 distinct pinned signers, and never holds a signer key
   (`--signer-key` refused outright; `--key` is the crank/payer key only). R28 holds: every
   destination comes from the host-derived records; the coordinator supplies none.
4. **(d) Proof on local anvil + solana-test-validator with three local signer state dirs standing in
   for the hosts** (`BNZ_STATE_DIR` per signer, `$BNZ_STATE_DIR/xchain-hosts/{alice,bob,carol}` + eve as
   third party): `bash crosschain/host-attest-demo.sh` → **34/34 PASS**
   (`docs/evidence/phase-5/repro/host-attest-demo.out`). Real fixture (tlock-sealed bids, real drand
   quicknet beacon, shipped clearing result, gate-X certificates). Lock signer set = the three hosts'
   keys. Includes the named refusal (a third party's attestation) and four more: forged signer,
   coordinator-swapped destination, single record, `--signer-key` on release. Payment asserted as
   balances at the fresh sealed destinations (both chains).
   **Mutation reds:** `mutations/X1-a.out` (pinned-set check disabled → `ERROR
   host-release-third-party-refused`), `mutations/X1-b.out` (payout-identity check disabled → `ERROR
   host-release-swapped-destination-refused`; the swapped pair then released rc=0). Tree clean after
   `git apply -R` but the mutation files.

**Merge regression found and fixed first (`f2e24e2`, evidence `1245f77`):** main's 91d9182 made
`benzo witness sign` recompute the frozen root from the witness's own vault scan, so
`crosschain/local-demo.sh` aborted at `ERROR witness refused: leaf 0: deposit not in this witness's
own scan` (`repro/local-demo-cert-before.out`) — its synthetic fixture has no chain to scan, and faking
the scan would mock a pinned tool. The fixture now signs the same statement with the shipped witness
primitive (`witness/index.ts`, what the command itself signs); every signature is still verified by the
attest/checkPublicAuction code under test. Fail-before/pass-after at the same harness: **39/39 PASS**
(`repro/local-demo-cert-after.out`). The shipped `witness sign` runs on the hosts over their own vault
scans in live runs (`e2e/lib/hosts.ts` hostWitnessCerts) — unchanged. **Main carries the same
breakage** (head: fold `f2e24e2` in at the merge).

Commits so far: `f2e24e2` (local-demo cert fix) + `1245f77` (its evidence), `b74a28a` (item 1 code +
`crosschain/host-attest-demo.{sh,mjs}`), `d969dc0` (item 1 evidence + mutations).

**Item 2 — demo drivers for the three demos (part 2 §2): BUILT + target-chain half DRY-RUN PROVEN** —
product prerequisite `bafbd7e`, drivers `ec5cb8a`, evidence `2a1303c` + `docs/evidence/phase-5/repro/xchain-escrows-deployed.out`.

1. **`tools/repro/xchain-demos.ts`** (`demo1|demo2|demo3`, `--local` for the dry run):
   - **demo1 sol-drop**: uniform multi-lot Zcash auction, lots locked in the Solana escrow, winners paid at
     fresh addresses (fill × lot). SPL-asset variant: Token-2022 CT is the standalone capability
     (`crosschain/ct-live.sh`, R25 item 5/F6 — the escrow pays native SOL only, escrow-held SPL is future
     work); the driver's escrow leg is the native-asset escrow.
   - **demo2 buyback-stealth**: Mode B buyback window, sellers paid on Sepolia through stealth delivery
     (stipend + canonical ERC-5564 announcement; Railgun stays deferred, R24).
   - **demo3 otc-sol**: ZEC↔SOL blind OTC whose SOL leg settles through the Solana escrow.
   Zcash side = the markets.ts scenario engine (child process, its DKG/funding locks) with the auction id
   pre-bound (`BNZ_MARKETS_ID`) so the escrow **locks before bidding** (crosschain §2). Target-chain side =
   the shipped `xchain lock/attest/release`; the host attest runs through `e2e/lib/hosts.ts`
   (`orb run … benzo xchain attest --host-record`, `hostXchainKeys`/`hostXchainAttest`) in live mode.
2. **Dry run of the target-chain half (local anvil + solana-test-validator, three local signer state dirs
   standing in for the hosts): 35/35 PASS** — `bash tools/repro/xchain-demos.sh demo1 demo2 demo3`
   (`repro/xchain-demos-local.out`): demo1 13/13 (incl. `demo1-multilot-shape`, the fill-2 winner paid 2 lots),
   demo2 11/11 (stealth payouts + stipend + announcement), demo3 11/11. Each demo asserts host records over
   identical attestation bytes, payouts equal to the result's own `allocations[].fill`, `xchain status
   --result` tying the escrow's approved result hash to the published `result.json`, and **no Zcash material
   on the target chain** (every submitted tx fetched and scanned for the run's deposit txids + shielded
   addresses). **Mutations:** `X2-a` (inflated lot_count → `ERROR demo1-payouts-match-result`), `X2-b` (a
   deposit txid in the stealth announcement → `ERROR demo2-no-zcash-on-chain`).
3. **Escrows: already deployed, byte-matching the current builds — no redeploy**
   (`repro/xchain-escrows-deployed.out`): Sepolia `0x1dc207D5B04C8CFB043d4420054a2219a544dD85`
   (runtime code == the build, sha efe492f3…); devnet program **`2h6tgr5Ay1WE3u6kmPZnKh9EyTu7dkgWFkkrjCA5QyPu`**
   (ELF == the build, sha 84fd87b7…). Record correction: run 23 wrote `EYPDHi…` as the devnet program id —
   that is the **ProgramData address**; the Program Id is `2h6tgr5A…` (the r14 cycle's program-v3-keypair).
4. **Product fixes the dry run forced** (in `bafbd7e`/item-1 lineage): `xchain attest` now parses the opened
   order under the **manifest mode's own layout** (gate EN; OTC orders are version 3) instead of a hardcoded
   version-0 shape — without it demo3's SOL leg could not attest. Regressions at `ec5cb8a`: local-demo
   **39/39**, host-attest **34/34**, `npm run e2e` **PASS**, typecheck clean.
5. **markets.ts additive changes only** (Track A's live scenario engine — visible to A at the merge): bids
   may seal a cross-chain deliver, `BNZ_MARKETS_ID` pre-binds the id, the run keeps `xchain-delivers.json`
   (harness bidder state beside `refunds.json`), and three `xchain-*` scenarios. No existing scenario
   changed.

Next: item 3 (mainnet readiness — `settle --network`, classify-address, fixtures), then item 4 (guides).

**Item 3 — mainnet readiness (Reviewer G's G-7): DONE with proof** — code `37ac903`, evidence `e051a70`.

1. **`settle/src/main.rs` takes `--network test|main`** (required, **no default** — a mainnet caller can
   never silently get testnet behaviour) on every network-dependent command (`create`, `address`,
   `inspect`, `ufvk-ak`, `owns`), threading `Network::MainNetwork/TestNetwork` through the wallet,
   UFVK and address decodes. The NU7-expiry straddle guard is testnet-only until the mainnet height is
   set (R27 item 2). `classify-address` is unchanged (it reports networks itself).
2. **Every caller passes the network from the signed manifest**: settle worker (`plan` output carries
   `network`; `settle/cli.ts`/`io.ts`/`sign.ts` thread it), host derive/build/approve (`pub.manifest.network`),
   witness/ownScan (`benzo-scan` gets the manifest network — the `scan test` literal is gone). Pre-manifest
   commands (`auction keys`, zcash-sign sessions) use the established `BNZ_NETWORK` source; harness/repro
   callers pass `test` explicitly (they are testnet fixtures — mechanical arg additions only in A's
   `e2e/buyback-mode.spec.ts`, see Questions).
3. **TS `utest1` regexes are network-aware checks**: pure `manifest/schema.ts` `uaShape` (per network:
   `utest1…`/`u1…`) for escrow/deposit/treasury/funding UAs (also used by `clear/rfq.ts`/`clear/mode-b.ts`),
   and the Node boundaries check through the audited `benzo-pczt classify-address`
   (`envelope/destination.ts` `isUnifiedOn` — sign-build's seller routing, auction-keys' derived escrow
   UA). The pure matcher keeps the offline verify bundle binary-free.
4. **The manifest schema's `network: "test"` lock stays** — proven still refusing a `network:"main"` manifest.
5. **Fixtures for mainnet-format addresses**: `tools/repro/g7-network-repro.mjs` **11/11 PASS**
   (`repro/g7-network.out`) over the official zcash-test-vectors rows — 117 mainnet `u1…` UAs accepted on
   `main` exactly per the vectors' own `shielded` labels and refused on `test` (and the testnet mirror),
   the classifier's own network labels, real `uview1…`/`uviewtest1…` UFVKs (pinned zcash-sign) decoded
   only under their own network (`UFVK is for network Main but we expected Test`), and the
   missing-`--network` refusals. **Mutation:** `X3-a` (network-blind matcher → `ERROR
   g7-mainnet-ua-refused-on-test` + the mirror).
6. **`dist/benzo-verify.mjs` + `docs/verify-bundle.sha256` rebuilt** (`check:bundle` OK `a1a6ea57…` —
   `envelope/destination.ts` is in the bundle closure). Regressions at `37ac903`: `npm run e2e` PASS 40 s,
   local-demo **39/39**, xchain-demos **35/35** (the first xchain-demos attempt failed only on chain-boot
   contention — I had booted two local-chain harnesses in parallel; re-run alone green).

Next: item 4 (guides).

**Item 4 — guides: DONE** — `docs/guide-signer.md` + `docs/guide-operator.md` updated for host
 custody (per-auction DKG (`benzo sign dkg`), `benzo auction keys --id --group-keys [--ufvk]`, the
 operator-signer pin (`state/operator-signer.txt`) + first-manifest pin, the approval ledger
 (txid-keyed, no double pay across batches) and `sign build`/`sign approve`/`sign join`, claims via
 `sign envelope-opens … --claims` + `benzo claim-refund`), NU7 + `BNZ_LWD_SINGLE` (R27), and the
 cross-chain host keys (`benzo xchain keygen` per host, `xchain attest --host-record`, coordinator
 `xchain release --attestation`/`lock`/`refund`/`status`). Every command is shipped with real flags:
 34 invocations checked against the router/command `--help` at `37ac903` (`tmp/guide-help.txt`,
 scratch), 0 missing.

**Batch state: all four items DONE with proof.** Closing checks: `npm run typecheck` clean,
 `npm run check:bundle` OK (`a1a6ea57…` after the item-3 bundle rebuild), `npm run e2e` PASS 40 s,
 `crosschain/local-demo.sh` 39/39, `crosschain/host-attest-demo.sh` 34/34,
 `tools/repro/xchain-demos.sh demo1 demo2 demo3` 35/35, `node tools/repro/g7-network-repro.mjs` 11/11.
 No mainnet; no VM/orb/frostd-2744/testnet-spend/live-spec activity; no pin changes; no merge/rebase/
 cherry-pick/push beyond the head-ordered `git merge main` at session start (`970ce70`).

### Test audit (run 30)

No `e2e/` spec added (ceiling 8, 5 used). Checks outside the ceiling (R retain):

| Check | Owns (assertion IDs) | Mutation red |
|---|---|---|
| `crosschain/host-attest-demo.mjs` | the 34 `host-*` IDs (keygen/records/release/refusals) | `X1-a` (`host-release-third-party-refused`), `X1-b` (`host-release-swapped-destination-refused`) |
| `tools/repro/xchain-demos.ts --local` | `demo1-*`/`demo2-*`/`demo3-*` (35 IDs) | `X2-a` (`demo1-payouts-match-result`), `X2-b` (`demo2-no-zcash-on-chain`) |
| `tools/repro/g7-network-repro.mjs` | the 11 `g7-*` IDs | `X3-a` (`g7-mainnet-ua-refused-on-test` + mirror) |
| `crosschain/local-demo.mjs` (unchanged assertions) | the 39 `demo-*` IDs | re-green 39/39 after the gate-X cert fix + the item-3 schema change; cheapest mutation `R22-a` covered earlier (`mutations/R22-a-rerun-r28.out`), code touched since = `xchain.ts` attest (mutations X1/X2 exercise that path) |

`e2e/buyback-mode.spec.ts` (head's) got mechanical `--network test` additions at its three
 benzo-pczt call sites (no assertion changed) — see Questions.

### Questions (run 30)

1. **`--host-record` design note (item 1 (b)):** a host attests with its own single envelope key, so
   the per-leaf ≥2-agreement moves to the coordinator's release (two host records over the identical
   attestation bytes from 2 distinct pinned signers — two hosts that opened a different deliver cannot
   agree on the allocation root). The old rule stands unchanged without the flag. If you want a
   different shape (e.g. records always carry 2 keys), say so under a Ruling and I will change it.
2. **local-demo fixture certs are signed in-process now** (see above) because `witness sign` requires
   an own vault scan post-91d9182. If you prefer the fixture drive the command against a real scanned
   vault, that needs the live testnet lane (not mine per this run's rules).
3. **item 2 live flow is written but deliberately not run here** (no orb/VM/testnet-spend per this run's
   rules): `node tmp/xchain-demos.mjs demo1|demo2|demo3` on main drives the real hosts via hosts.ts.
   The dry run proves the target-chain half; the Zcash scenarios reuse markets.ts unchanged.
4. **`xchain attest` order layout**: it now honours the mode's layout (OTC v3) — the old hardcoded
   version-0 check made demo3 impossible. Confirm under a Ruling if you want the check narrowed again.
5. **I touched two files outside the Track-B lane, mechanically, because item 3 says “passed by every
   caller”:** `e2e/buyback-mode.spec.ts` (three benzo-pczt call sites got `--network test`; no
   assertion changed) and `e2e/lib/zcash.ts` (`generateAddress`). Say the word if you want them
   handled differently.
6. **`settle/sign.ts`'s in-flight `inspect`** takes the network from `BNZ_NETWORK` — the same source
   its own zcash-sign call two lines above uses; every manifest-driven product call site passes the
   manifest's network. `benzo-pczt` has NO default network (it refuses without `--network`), so a
   forgotten caller fails loudly.

## Previous run (28): Phase 6 Track B documentation and closure — **READY FOR MERGE**

State: **READY FOR MERGE** (updated 2026-10-03T16:5xZ). All four head-message items are DONE with
proof, plus one merge-regression fix the packaging proof exposed. Closing checks at the fix commit
`e0ecb63`: `npm run typecheck` clean, `npm run check:bundle` OK (`63d50137…`), `npm run e2e` **PASS
38 s**, mutation re-runs all red at their expected IDs and green after (table below). No mainnet;
no other-checkout writes; no merge/rebase/cherry-pick/push; no pin changes.

1. **P0/P1 closure table (item 1): DONE** — `eb02e52`, `docs/evidence/phase-6/closure.md`.
   Every P0 and P1 named in PHASE-5 Rulings R6–R26 and in the reviewer reports those rulings cite
   (34 rows in three sections: settlement core, envelopes/claims, cross-chain), each with its
   ruling, fixing commit(s), the repro or evidence path that proves the fix, and its state.
   R16 F6 is the accepted limit. Two open items name their owners (cross-chain re-review: head
   agent; Solana mainnet program form: head agent at Phase 7).
2. **Mainnet risks list (item 2): DONE** — `e28669b`, `docs/mainnet-risks.md`. The nine required
   risks, each with why it matters, mitigation and status: cross-chain escrows unreviewed since the
   reviewer freeze (open, head), Railgun deferred (accepted deferral), Solana upgrade authority
   (open at mainnet, head), stealth SDK beta (accepted, mitigated), drand/lightwalletd (failover
   across every `BNZ_DRAND_URLS` endpoint 3 rounds — `7071c42`; lightwalletd retries 4x with
   backoff — `bb5414e`), signer collusion 2-of-3 (accepted limit, disclosed), settlement scale
   (`docs/design/phase6-scale.md`, open, gate SC), envelope-key handling on signer hosts (mitigated,
   disclosed), `zcash_address` swap (closed 2026-10-03).
3. **Operator, signer and bidder guides (item 3): DONE** — `8d83d67`, `docs/guide-operator.md`,
   `docs/guide-signer.md`, `docs/guide-bidder.md`. Numbered runbooks; every command line is a
   shipped `benzo` command with its real flags, checked against `bin/benzo --help` and each
   command's `--help` at `e28669b` (34 checked invocations; the transcript run is `tmp/guide-help.txt`,
   scratch). The signer guide covers envelope keys, witness keys and approval; the bidder guide
   covers sealing, the deposit, `receipt prove`/`receipt statement` and `claim-refund`.
4. **Packaging, gate PK (item 4): DONE** — code `280edef`, evidence `9d7d185`.
   `npm run package` → `dist/benzo-0.1.0.tgz` (31,700,092 bytes, 19,656 entries, 112 pinned
   production packages) with `bin/benzo`, the CLI bundles (`cli/dist`), the browser sealer
   (`seal/dist`), the verify bundle `dist/benzo-verify.mjs`, `docs/verify-it-yourself.md`,
   `docs/verify-bundle.sha256`, `README.md` and `package.json`. **sha256
   `856fae26c44b7466db2690567c5e794f22551c93ffc6da86c7dc25b47f7098df`**
   (`docs/evidence/phase-6/pk-package.sha256`, `pk-package.out`). A clean extract in /tmp runs
   `bin/benzo verify --dir auction --signer 302a…` on the shipped Phase 4 evidence **offline**:
   all 13 checks OK + the expected pre-Phase-5 WARN, `exit=0`
   (`docs/evidence/phase-6/pk-package-verify.out`). `docs/verify-it-yourself.md`'s hash transcript
   is refreshed to the shipped bundle (the `pr-a-r10-r20` F7 class-5 finding: the old transcript
   never matched any shipped bytes).

**Merge regression found and fixed by the PK proof (`e0ecb63`).** At the merged tree (`8d83d67`)
`benzo verify` on the shipped Phase 4 evidence failed `ERROR accounting-strays refused: party
deposit:<txid>:<di> is neither a result obligation nor a stray deposit` — A's R26.1 strict
deposit-party shape rejects the historical identity the immutable Phase 2–5 evidence rows carry
(`docs/evidence/phase-6/repro/pk-historical-parties-before.out`; after:
`pk-historical-parties-after.out`, exit 0). Fix: verifier-side acceptance of the historical
`deposit:<txid>:<di>` identity (`isAnyDepositParty` in `settle/deposits.ts`; writers stay strict at
`isDepositParty`), so evidence that can never be regenerated keeps verifying. The same rerun
exposed a second product contradiction: a cancelled-before-freeze auction could never verify a
stray claim, because R23.1's strays certification requires the witness set while the witness check
forbade any witness material without a frozen root. Fixed in the same commit: root certificates
still require a root; the manifest-pinned witness SET may be published without one (it must hash to
the pin). With those two fixes the `r23-3` fixture (stale after the merge: it predates R23.1's
strays-statement rule) carries the full witness flow and its three assertions pass **unchanged**;
`g-forged-claim.mjs`'s memo round-trip line was updated for the v1+v2 parser's object return (one
line, harness only). Fail-before/pass-after pair at the same harness (`bin/benzo verify` on
`docs/evidence/phase-4/cli`): `docs/evidence/phase-6/repro/pk-historical-parties-{before,after}.out`.

### Test audit (READY FOR MERGE)

No `e2e/` spec changed (ceiling 8, 5 used; run-25 marks stand). Checks outside the ceiling whose
covered code changed in `e0ecb63` got their cheapest mutation re-run (rule: a code change re-runs
the cheapest mutation; run-27 precedent):

| Check | Mark | Owns (assertion IDs) | Code changed since its last mutation run? |
|---|---|---|---|
| `tools/repro/r23-3-api-claims-repro.mjs` | R | `r23-3-api-claims-no-beacon`, `r23-3-api-claims-with-beacon`, `r23-3-api-never-500` | yes (`api/public-auction.ts`; fixture repaired, assertions unchanged) — **R23-3a** re-run red at `ERROR r23-3-api-claims-no-beacon` (`docs/evidence/phase-6/mutations/R23-3a-rerun-r28.out`), green 3/3 at the same tree |
| `tools/repro/r26-3-projection-repro.mjs` | R | the six `r26-3-*` IDs | yes — **R26-3a** re-run red (all four `r26-3-*-diverges`), green 6/6 (`mutations/R26-3a-rerun-r28.out`) |
| `tools/repro/r15-verify-leaves-repro.mjs` | R | `r15-machine-runs-without-records`, `r15-zero-refund-needs-no-row`, `r15-strangers-refused`, `r15-phase2-4` | yes — **R15-F5** re-run red at `ERROR r15-zero-refund-needs-no-row`, green 4/4 (`mutations/R15-F5-rerun-r28.out`) |
| `crosschain/local-demo.mjs` | R | the 39 demo IDs (run-25 table) | yes — **R22-a** re-run red at `ERROR demo-attest-swapped-leaf-refused` (38 PASS + the 1 expected failure), green 39/39 (`mutations/R22-a-rerun-r28.out`, `R22-a-rerun-r28-green.out`) |
| `tools/repro/r26-1-deposit-party-repro.mjs` | R | `r26-1-*` (5 IDs) | yes (`settle/deposits.ts` gained an additive export) — no committed mutation patch (its fail-before is the stashed-fix pair `repro/r26-1-{before,after}.out`); green re-run at the final tree; the asserted writer rules are untouched |
| `tools/repro/g-forged-claim.mjs` | R | `r23-1-*`, `RESULT FORGED-CLAIM-REFUSED` | yes (claims acceptance widened) — no committed mutation patch (its fail-before is `repro/g-forged-claim-before.out`); green re-run at the final tree after the one-line harness repair |
| live-state repros `r15-3`, `r16-1`, `r16-4`, `r7-4`, `r7-claims` | R (marks stand) | their `r15-3-*`/`C4`/`F-1`/`C1` IDs | **not re-run**: they need a live dev-auction ledger under `$BNZ_STATE_DIR` (the `3bbfa501…` fixture is gone after the dev-recovery sweeps); their recorded red/green stands at their commits; re-greening needs a fresh live dev auction (Track A's live lane) |
| `npm run e2e` (default, 5 specs) | run-25 marks stand | — | no spec changed; PASS 38 s at `e0ecb63` |

### Deviations (run 28)

1. `package.json` gained `"version": "0.1.0"` (no Ruling names a version; the tarball name needs
   one). Say the word and I rename.
2. The tarball is a build artifact and is **not** committed (31.7 MB): its sha256 is recorded in
   `docs/evidence/phase-6/pk-package.sha256`, `dist/*.tgz` is gitignored, and `npm run package`
   rebuilds it from the tree.
3. The tarball ships the `@playwright/test`/`playwright`/`playwright-core` packages beside the
   production closure: the CLI bundles import `@playwright/test` at load (the `bid seal` browser
   sealer) and the router loads every command module. Playwright's browser binaries are **not**
   shipped: `bid seal` from the extract needs a Playwright browser install; `benzo verify` and
   every read path run offline as proven.
4. `tools/repro/g-forged-claim.mjs` (A's file, merged): one harness line repaired for the v1+v2
   parser's object return (`memoSealedBid(…)?.ciphertext_hex`). No assertion changed.

## Previous run (27): R24 item 3 (iii), R26 item 3, R26 item 2 guard half, gate LA — READY FOR MERGE

State: **READY FOR MERGE** (updated 2026-10-03T14:2xZ). All four head-message items are DONE with
red/green proof. Closing checks at `ba9753a`: `npm run typecheck` clean, `npm run check:bundle` OK
(`1485092a…`), `npm run e2e` **PASS 39 s**, `crosschain/local-demo.sh` **39/39 PASS**. Baseline at
session start (`890211c`): typecheck clean, e2e PASS 38 s. No mainnet; no other-checkout access or
writes; no merge/rebase/cherry-pick/push; no pin changes.

1. **R24 item 3 (iii), the Logos LP-0004 checklist: DONE** — `f64d398`.
   `docs/evidence/phase-6/lp-0004.md`: every criterion cell filled only from existing committed
   evidence paths (5 auction cycles tabulated from the artifacts: frozen roots, drand rounds, bid
   counts, txids, verify verdicts, fees); statuses are honest (criterion 1 partial on “distinct
   bidders” — one wallet plays all bidders —, criteria 2–5 partial, narrated video + Phase 7 mainnet
   cycle pending).
2. **R26 item 3 (P2, F5), projection divergence: DONE** — code+fixture `82b3590`, evidence
   `cb92118`. `benzo verify` (and the read API) ERROR on any divergence of the
   `opened`/`beacon`/`receipts`/`summary` projections from the canonical `auction.json`, and on a
   projection without its document field (same byte-identity rule as the existing projections).
   Fixture `tools/repro/r26-3-projection-repro.mjs` builds a fresh real corpus (pinned Go `tle`, real
   drand beacon, shipped clear) and drives `bin/benzo verify`: **6/6 PASS**. Mutations at `82b3590`:
   **R26-3a** (comparison disabled) → all four `r26-3-*-diverges` red; **R26-3b** (without-field rule
   disabled) → `r26-3-projection-without-field` red. Regressions green: r15 4/4 (incl. the Phase
   2/3/4 evidence dirs), r23-3 3/3. The verify bundle was rebuilt into `dist/` +
   `docs/verify-bundle.sha256` with this commit — it was stale since the R24-3i/R23-3 changes (F2's
   finding on track-b too); B owns the bundle.
3. **R26 item 2 guard half (`npm run check:bundle`): DONE** — code `16fd609`, evidence `7c235d6`.
   Rebuilds the bundle into tmp via the one `tools/build-verify.mjs` config and exits 1 when
   `dist/benzo-verify.mjs` or `docs/verify-bundle.sha256` mismatches (`r26-2-check-bundle.out`: green
   exit 0 twice, both mismatch modes exit 1 with `ERROR check:bundle`). The rule is recorded in
   AGENTS.md as the head-sanctioned line (User instruction verbatim under Questions); I placed it
   under “Two builders” + the Commands table because AGENTS.md has no “Track B notes” section — say
   so if it belongs elsewhere.
4. **Gate LA leak audit: DONE** — fixes `8e5631b`, record `ded3595`
   (`docs/evidence/phase-6/leak-audit.md`, findings JSONs, `leak-allowlist.json`). Sensitive file:
   52 values from my `.benzo/` only (4 deployer-key forms, 10 envelope private keys, 38 test UAs;
   values never printed). Run 1: 878 findings. Fixed at source (never editing evidence): four repro
   scripts that printed full refund/delivery UAs now abbreviate at the print sites (assertions keep
   full values; `routing-vs-envelope-repro.mjs` re-run green), STATUS-B abbreviates its two wallet
   UAs. Run 2: 268 findings, **every row classified** — 148 superseded `--git` blobs of the fixed
   STATUS-B, 22 `age-armor` pattern self-matches (verified: no armored payload anywhere), **45
   immutable historical evidence rows carrying real refund/delivery addresses (disclosed, never
   edited)**, 3 in Track A's `docs/STATUS.md` (Questions), 2 in read-only research, 48 in `tmp/`
   scratch. **No key material (deployer/envelope keys, mnemonics, UFVKs, PEM, real age armor) in any
   scanned surface or git blob.** A literally-zero `--git` run needs a history rewrite (forbidden) or
   evidence edits (forbidden) — the residue is the honest remainder.

### Test audit (READY FOR MERGE)

No `e2e/` spec changed (project ceiling 8, 5 used — reserved slots are A's). Checks outside the
ceiling touched this run (R retain; the run-25 table's marks otherwise stand):

| Check | Mark | Owns (assertion IDs) | Code changed since its last mutation run? |
|---|---|---|---|
| `tools/repro/r26-3-projection-repro.mjs` (new) | R | `r26-3-{projections-match,opened-diverges,beacon-diverges,receipts-diverges,summary-diverges,projection-without-field}` | no — mutations R26-3a/b ran at `82b3590`, the code commit |
| `tools/check-bundle.mjs` (new; a check, not a test) | R | — | red/green at `cb92118` (`r26-2-check-bundle.out`) |
| `crosschain/local-demo.mjs` | R | the 39 demo IDs (run-25 table) | yes — `api/public-auction.ts` (R26-3); cheapest mutation **R22-a re-run** red at `ERROR demo-attest-swapped-leaf-refused`, green 39/39 (`docs/evidence/phase-5/mutations/R22-a-rerun-r27.out`, `ba9753a`) |
| `tools/repro/routing-vs-envelope-repro.mjs` | R | `F3`, `W2`, `5M2` | print-only leak fix + stale-wording assertion update (harness staleness, not a product regression); re-run green at `8e5631b` (exit 0, `F3 FIXED`) |
| `tools/repro/r7-1-*`, `r7-4-*`, `r16-1-*` | R | their `F-1`/`C4`/`C1` IDs | print-only leak fix (`node --check` clean); historical red/green records unchanged |
| `tools/repro/r15-verify-leaves-repro.mjs`, `r23-3-api-claims-repro.mjs` | R | `r15-*`, `r23-3-*` | re-run green this run as regressions over the R26-3 change |

## Previous run (26): R22 + Q6(a), then R25 items 1–6, R23 item 3, R24 item 3 (i)–(ii)

State: all **DONE with red/green proof**. The record below was written mid-run; the items landed
afterwards at these commits (all verified in `git log` this session, evidence files present):

1. **R25 item 1 (P0, R F1: mandatory secret salt in deliver): DONE** — code `be91c62`, evidence
   `13a7cfc` (`r25-1-link-before.out` links before, `r25-1-link-after.out` 12/12 PASS; mutations
   R25-1a/1b red).
2. **R25 item 2 (P1, R F3: `--envelope-key` dedup + manifest membership): DONE** — code `c8d82cd`,
   evidence `36187b7` (before/after + mutations R25-2a/2b red).
3. **R25 item 3 (P1, R F4: per-chain payable-kind gating; unpayable kinds to exception): DONE** —
   code `45baa16`, evidence `f007dd6` (before/after + mutations R25-3a/3b/3c red).
4. **R25 item 4 (P1, R F5: EVM address normalisation (ethers `getAddress`), checksum enforced at
   bid seal): DONE** — code `493e84e`, evidence `264ff8b` (before/after + mutations R25-4a/4b red).
5. **R25 item 5 (P1, R F6: CT relabelled — standalone Token-2022 capability demo, not an escrow
   delivery): DONE** — `6154583` (labels + AUDITS; a relabel, no new assertions).
6. **R25 item 6 (P2, R F7: `--announcer` must be the canonical ERC-5564 Announcer; numeric CLI args
   validated; AUDITS KDF disclosure + signer procedure refreshed): DONE** — code `2659f3d`, evidence
   `793a2a6` (before/after + mutations R25-6a/6b red).
7. **R23 item 3 (P3, G4: read API fails closed with the verify ERROR, never a 500): DONE** — fixture
   `0244150`, code `e0151bb`, evidence `0ab4819` (mutation R23-3a red; green = the fixture's 3/3 PASS
   at `e0151bb`).
8. **R24 item 3 (i) (`zcash_address` swap via `benzo-pczt classify-address`): DONE** — code
   `9f50fcf`, harness `6b0d24c`, evidence `cb649b5` (`r24-3i-classify-address.out`: 637 inputs,
   verdicts identical to the pre-swap parser + official labels + fresh real testnet addresses;
   mutations R24-3i-a/b red).
9. **R24 item 3 (ii) (README cross-chain section + honest limits refresh): DONE** — `01bb2d6`
   (every claim cites an evidence file).

### R22 + Q6(a) (record written when it landed)

1. **R22 + Q6(a) (head P2 + result-shape ruling): DONE** — code `97567fa`, evidence `4e19e5f`.
   - `xchain attest` now runs the same public checks as `benzo verify` on `--dir` (openings
     re-derived from the frozen ciphertexts, claim openings from the published memos, sealed
     reserve + serial beacon authenticated, then `checkPublicAuction`) and refuses on any ERROR
     before any key is read or chain contacted; `--result` must equal the published `--dir/result.json`
     bytes exactly; leaf derivation is `allocations[].fill` only — the `winners[]` branch is removed
     (Q6 (a)).
   - Demo fixture is now a **real product result**: the shipped clearing (`clearForMode`) recomputed
     over the six real openings (all fill 1 at 250000 zats, C 500000), a gate-X witness set whose
     hash the signed manifest pins (R4 item 2) and q_w=2-of-3 certificates written through the
     shipped `benzo witness sign`; `PUBDIR/result.json` is the literal `--dir/result.json`.
   - Named repro (frozen leaf set swapped after witness certification, self-consistent
     root/paths/result as an attacker could rewrite, certificates unforgeable):
     `docs/evidence/phase-5/repro/r22-before.out` (commit `97567fa` tree, `xchain.ts` at `882b51d`
     pre-fix) shows it **ATTESTED** (`ERROR demo-attest-swapped-leaf-refused rc=0 …`) together with
     the other two reds (a `winners[]` result accepted; non-identical result bytes attested);
     `docs/evidence/phase-5/repro/r22-attest-dir.out` (clean `97567fa`) is **33/33 PASS** with the
     swapped dir refused as `ERROR witness certificate statement differs`.
   - Mutations at `97567fa`: **R22-a** (checkPublicAuction refusal disabled) → `ERROR
     demo-attest-swapped-leaf-refused`; **R22-b** (byte-equality disabled) → `ERROR
     demo-attest-result-bytes-mismatch-refused` (full logs tmp/e2e/r22-{a,b}.log).
   - Demo assertion IDs (33) are listed in the run-25 test-audit table below plus the new
     `demo-product-result`, `demo-attest-crosschain-result-refused`,
     `demo-attest-result-bytes-mismatch-refused`, `demo-attest-swapped-leaf-refused` (R retain).

The five items above landed as the nine commits recorded in the run-26 record; the R22-a mutation
re-run owed to item 3's demo rework is folded into the run-27 test audit.

## Previous run (25): head task — R19 (P1), R21 (P1), then EVM stealth delivery / Token-2022 CT / Railgun / `benzo fund quote`

State: **R19 DONE with red/green proof** (code `9cfc159`, evidence `e86f35e`); **R21 DONE with
before/after + red/green proof** (code `38bf7e1` + harness `9910f85`, evidence `9e871d0`);
**item 2 — EVM stealth delivery DONE** (local code `2fdeaf6`, live code `2132dd5`, evidence
`docs/evidence/phase-5/repro/stealth-{local,live}.out` + mutations `S2-a`/`S2-b`); **item 3 —
Token-2022 CT delivery DONE** (code `8a52106`, evidence `docs/evidence/phase-5/repro/ct-live.out` +
mutations `S3-a`/`S3-b`, live on Solana devnet).
**item 5 — `benzo fund quote` DONE** (code `6606298`, evidence
`docs/evidence/phase-5/repro/r5-fund-quote.out` + mutation `S5-a`); **item 4 — Railgun `shield()`
BLOCKED** (contracts + SDK pin + signer procedure; evidence
`docs/evidence/phase-5/repro/railgun-blocked.out`; stealth stays the EVM path per the head).
**R22 (head P2, landed mid-run at `4254c7a`) OPEN — not started; plan + one question below.**
**State: READY FOR MERGE for the head task's five items; R22 is the one open head item.** Updated
2026-10-03T08:0xZ. Head messages this run: implement R19 (P1) first, then the three private-delivery paths
and the fund quote; headless, one commit per item with red/green proof in this file. No mainnet; no
other-checkout access or writes; no merge/rebase/cherry-pick/push; no pin changes (three pins ADDED,
see below).

### This run's work

1. **R19 (P1): envelope payload v2 + destinations from the bidder's sealed envelope. DONE** —
   code `9cfc159`, evidence `e86f35e`.

   - **Payload v2** (`envelope/index.ts`): canonical JSON `{"v":2,"refund","deliver"}` inside the
     unchanged fixed 512-byte padded plaintext; a plain-UA plaintext (v1) still reads as `{refund}`
     (`openEnvelopePayload`; `openEnvelope` keeps its string API so `settle/` and Track A are
     untouched). `envelope/deliver.ts` checks `deliver` per chain: Solana base58 32-byte key
     (`kind:"ct"` additionally requires `elgamal`, 32-byte hex), EIP-55 checksummed EVM address,
     Railgun `0zk` (bech32m, 73-byte payload — the exact encoding the Railgun engine uses), ERC-5564
     stealth meta-address (`0x` or `st:eth:0x`, two compressed keys). `SHA-256(deliver)` covers its
     canonical JSON (manifest `canonical`, sorted keys). `prepareBid` carries `deliver`; `bid seal`
     passes it through the shipped sealer (`cli/product.ts`, the R4-allowed block).
   - **`xchain attest` takes no destinations from the operator** (R19 item 2): `--allocation` is
     removed and refused; each `--envelope-key` signer opens the winner's v2 envelope itself and a
     leaf is attested only when **at least 2 signers agree on `SHA-256(deliver)`**; winners without
     an attestable deliver go to the bundle's `exceptions` (reasons: `no envelope record`, `no valid
     owner-signed settlement envelope`, `no deliver`, `malformed deliver: …`, `signers could not
     agree on the envelope deliver`). Leaf mapping: solana `address`/`ct` → destination kind 2
     (the `to` key); evm `address` → kind 1; evm `stealth` → kind 1 = ONE signer-reproducible fresh
     stealth address per (settlement, leaf) (see AUDITS.md: custom SHA-256 KDF seeds the ephemeral
     key of the pinned ScopeLift SDK's scheme-1 derivation — all signers derive the same address, so
     the root is signable); evm `railgun` → kind 3 (the 0zk's 73-byte payload; released through the
     Railgun adapter when item 4 lands). `standard_lot` is read from the locked escrow on chain.
   - **R19 item 3 proof** (`crosschain/local-demo.sh`, local anvil + solana-test-validator):
     `docs/evidence/phase-5/repro/r19-attest-deliver.out` at `9cfc159` — 24 demo checks PASS,
     including the operator's old allocation file naming an attacker address (flag removed and
     refused, and the attest output ignores it entirely), a malformed `deliver.to` landing in the
     exception queue on both chains, a split-key hostile envelope only one signer opens never being
     attested, and a substituted envelope not riding a leaf. Payload-format matrix (36 checks,
     tmp/proof-logs/r19-payload.out): all four `to` formats + ct accepted, and the exact refusals
     (lowercase/bad-checksum EVM address, 31-byte key, missing/short elgamal, elgamal on non-ct,
     bad `0zk` checksum/short/wrong version, uncompressed meta-address, wrong chain/kind pairs,
     extra fields, v1 read as `{refund}`, extra-key v2 payload refused at open). Mutations at
     `9cfc159`: **R19-a** quorum `>= 2` disabled → `ERROR demo-attest-no-agreement-exception`;
     **R19-b** exception queue disabled → `ERROR demo-attest-malformed-deliver-exception`;
     **R19-c** envelope-to-bid binding disabled → `ERROR demo-attest-substituted-envelope-exception`.

2. **R21 (P1): attest derives winner openings itself. DONE** — code `38bf7e1` (harness `9910f85`),
   evidence `9e871d0`. `--envelopes` (operator-supplied `opened_bid_hex`) is removed and refused;
   `attest --dir PUBLIC` loads the published directory (`api/public-auction` `loadPublicAuction`) and
   for every winner leaf: decrypts the frozen leaf's **own ciphertext** with the published,
   BLS-verified beacon (`cli/published-beacon` `decryptPublished`, the same derivation verify uses),
   checks `SHA-256(ciphertext)` against the root-committed `ciphertext_hash`, verifies the published
   record's owner signature + settlement commitment against **that** opening (`settle/envelopes`
   `validEnvelope`), and only then opens `deliver` (R19 rules unchanged). `docs/AUDITS.md`'s signer
   procedure matches. The demo fixture is now a **real published auction directory**: six bids with
   real tlock ciphertexts to one live drand quicknet round + its published beacon (BLS-verified at
   every use), a signed manifest, frozen leaves; the four honest winners seal `deliver` payload v2
   through the shipped bidder library, the two hostile-sealer winners wrap tampered envelopes around
   real tlock. `docs/evidence/phase-5/repro/r21-attest-dir.out` at `9910f85`: **29 demo checks PASS**,
   including `demo-bid-seal-deliver` (the shipped `benzo bid seal` carries deliver through the real
   browser sealer) and `demo-attest-fabricated-opening-exception`. **Before/after on the same
   harness**: `r21-fabricated-before.out` (fix stashed — `cli/commands/xchain.ts` at `9cfc159`) shows
   the operator's fabricated `opened_bid_hex` + attacker envelope **ATTESTED** (the exploit R21
   closes); `r21-attest-dir.out` shows it in the exception queue with the attacker address nowhere
   in the bundle. Mutations at `9910f85`: **R21-a** quorum disabled → `ERROR
   demo-attest-no-agreement-exception`; **R21-b** exception queue disabled → `ERROR
   demo-attest-malformed-deliver-exception`; **R21-c** owner-signature + settlement-commitment
   authentication disabled → `ERROR demo-attest-fabricated-opening-exception`.

   Harness note (honest limit): the demo drives whichever attest interface the shipped CLI speaks
   (probed via `benzo xchain --help`, `records-*.json` fixtures for the pre-R21 input shape), so one
   demo run is the before/after proof. The demo's fixture uses the shipped tlock-js for sealing
   (the same library the browser sealer runs) against a **past** round whose beacon already exists —
   the real post-R situation attest operates in — while `bid seal`'s future-round path is proven by
   `demo-bid-seal-deliver` and the default e2e (seal in the browser, open with Go `tle`).

3. **Item 2 — EVM stealth delivery (ERC-5564, deliver.kind = "stealth"): DONE** — local code
   `2fdeaf6`, live code `2132dd5`, evidence `docs/evidence/phase-5/repro/stealth-local.out` (11/11
   PASS on local anvil) + `stealth-live.out` (11/11 PASS, **live on Ethereum Sepolia**), mutations
   `S2-a`/`S2-b`.
   - `xchain release` gains `--stipend WAD` (the tiny native gas stipend sent with each fresh
     stealth payout — design §4 lesson 6) and `--announcer ADDR` (publishes the ERC-5564
     announcement whose bytes were fixed at attest time and carried in the bundle leaf) — the
     release flow completes the delivery.
   - **Local (anvil):** canonical Announcer + Registry from the pinned SDK's canonical bytecode,
     winner meta-address + ERC-6538 registration, the deliver sealed in the envelope payload v2,
     real published directory (real tlock + BLS-verified beacon), lock/attest/release through the
     shipped CLI, stipend + announcement, then the winner's **viewing key alone** finds the
     payment, `checkStealthAddress` verifies it, the recovered key spends the lot.
   - **Live (Ethereum Sepolia)** at `2132dd5` (`stealth-live.out`): canonical Announcer
     `0x55649E01B5Df198D18D95b5cc5051630cfD45564` + Registry `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538`
     used as-is; fresh escrow `0x1dc207D5B04C8CFB043d4420054a2219a544dD85` (deploy
     `0x85129a3e92dcbc3761de431bb27b750a15783270a108a0187bba42022c65c2f8`); lock
     `0xdfd04616411e4a888b84ca0368b85afccd9a0745ba81d711a51bbc4022e437bf`; derived one-time
     address `0x47ffE1Fbaf9631216fe25c817BE518BAf08fD6b8` (reproducible across derivations);
     release `0x90e872e1…9924`, **stipend** `0x82ff58c1…592c`, **announce** `0x3c0ad833…b578` — the
     fresh address received exactly **0.0101 ETH** (lot 0.01 + stipend 0.0001); the winner's
     viewing key found the announcement (tx `0x3c0ad833…b578`), recovered the key and spent the
     lot back (`0xc7532ce1…1a17`). The deployer key never reaches a command line.
   - **Red/green** (local anvil): `S2-a` (release sends no stipend → `ERROR
     stealth-release-pays-with-stipend`, delta 1.0 not 1.001); `S2-b` (the ephemeral-key KDF is no
     longer settlement-reproducible → `ERROR stealth-derive-reproducible`).
   - **Beta-SDK defect recorded in `docs/AUDITS.md` + Questions:** the pinned
     `@scopelift/stealth-address-sdk` 1.0.0-beta.5 `getAnnouncements` filters logs through viem's
     positional-array `args`, which matches nothing on pinned viem 2.57.1 (the named-object form
     matches the same events); `scanDeliveries` fetches the logs itself (named args + chunked
     ranges — public Sepolia endpoints refuse >50k-block queries) and keeps every crypto step in
     the SDK.
   - **Q2 resolved as declared:** `BenzoEscrow` was redeployed fresh for the live run (R9 item 1 —
     R14 item 4 changed the storage layout); `0x8d08…` is marked **SUPERSEDED** in `docs/AUDITS.md`.

4. **Item 3 — Token-2022 Confidential Transfers (`deliver.kind = "ct"`): DONE** — code `8a52106`,
   evidence `docs/evidence/phase-5/repro/ct-live.out` (**live on Solana devnet**, 12/12 PASS),
   mutations `S3-a`/`S3-b` (live devnet runs).
   - A **fresh token account configured from the bidder's `deliver.elgamal`** (`crosschain/ct.ts`
     `deliverMatchesAccount`: the account must be configured with exactly `deliver.elgamal` at
     `deliver.to`, else the delivery refuses), funded with a **confidential transfer whose amount is
     hidden on chain**, then the bidder (account owner) applies the pending balance and withdraws —
     full control proven (winner plaintext balance 100 after withdraw).
   - The Token-2022 machinery is driven through the **official `spl-token` CLI 5.6.1** (the
     token-2022 repo's own client — audited-first rule); `crosschain/ct.ts` holds the checks no tool
     performs: the deliver ↔ account-configuration binding and the amount-hidden assertion over the
     raw submitted transaction (`amountLeaks`: the delivered amount appears in neither encoding; a
     public-mint probe proves the assertion works). The deliver rides the shipped envelope payload v2.
   - Recorded run (`ct-live.out` at `8a52106`): fresh account
     `DDpH4shfH6uwNQ9RvnEeGg99nBR81J43v7cwRZErx5Ww` configured from `deliver.elgamal 86ae9172…`;
     confidential transfer tx `37EFvospxPSRB7rHfn9ZwhHANDhQyKwtRfdWnw8Vzqoz5zAyJzrsx8eygfzky58muaC1CoroU2vcVJMuVDcpoNzc`
     (no amount anywhere in the raw tx; the destination's pending balance is a non-zero ciphertext);
     winner withdraw tx `64dTLY54tYs14jtAFSzNSaADjdAAK6pgDYxDMkrqYaGtzqPRYFQrdxWSFrTdqT8BTW1gzyZsxwXW73kxFAWSpvi9`.
   - **Red/green** (live devnet runs): `S3-a` (the deliver ↔ configuration binding disabled → `ERROR
     ct-deliver-elgamal-matches`); `S3-b` (the amount-hidden assertion disabled → `ERROR
     ct-amount-hidden-probe`).
   - Note: the local `solana-test-validator`'s genesis token-2022 predates the current
     confidential-balances encodings (`spl-token` 5.6.1 `Deposit`/`ApplyPendingBalance` get
     `InvalidInstructionData` against it — recorded honestly); devnet's deployment matches the CLI
     and is what item 3 targets, so there is no local CT run.

5. **Item 5 — `benzo fund quote` (crosschain §5, NEAR Intents 1Click quote only): DONE** — code
   `6606298`, evidence `docs/evidence/phase-5/repro/r5-fund-quote.out`, mutation `S5-a`.
   `benzo fund quote --from <1click asset id> --zec <whole ZEC count> --to <shielded UA>
   --refund-to <origin address>` calls `POST /v0/quote` with **`dry: true` always** (real quotes, no
   deposit address, no swap — Benzo never deposits), targeting the bidder's own shielded UA in a
   round amount the USER chose (never C plus a fee; a fractional/zero `--zec` is refused), prints
   the verbatim quote and the guidance to wait for the funds before bidding. Credentials only via
   `BNZ_ONECLICK_API_KEY`. Proof (live API, 3/3): `r5-quote-dry` (HTTP 201; 1 ZEC ≈ 282.75 wNEAR at
   the run; no `depositAddress` in the response), `r5-round-amount-refused`, `r5-shielded-only-refused`.
   Mutation `S5-a` (the round-amount rule disabled) → `ERROR r5-round-amount-refused`.

6. **Item 4 — Railgun `shield()` on Ethereum Sepolia: BLOCKED (bounded investigation, 3 attempts;
   evidence `docs/evidence/phase-5/repro/railgun-blocked.out`).** Per the head's instruction, stealth
   (item 2, `deliver.kind = "stealth"`) remains the delivered EVM path. Exact blockers:
   (a) **contracts:** crosschain §4 says the *escrow* calls `shield`; `contracts/evm/src/BenzoEscrow.sol`
   has no shield adapter (`release` pays `DEST_EVM_ADDRESS`, 20 bytes, only — line 251) and the
   adapter is custody-touching contract code which per AGENTS "audit hard when custom" merges only
   after Reviewer R's hard review — that review cannot complete inside one run;
   (b) **SDK pin conflict:** `@railgun-community/shared-models@8.2.1` hard-pins peer `ethers@6.14.3`
   against our exact `ethers@6.17.0` (npm ERESOLVE recorded verbatim in the evidence; the only
   workaround is `--legacy-peer-deps`, which npm itself calls "an incorrect (and potentially broken)
   dependency resolution", or a pin change — a Ruling);
   (c) **signer procedure:** the §4 "signers build the shield requests off-chain; 2 of 3 rebuild and
   compare byte for byte; a fresh shield key per settlement" needs the signer-host integration
   (Track A, part 1 §3). The SDK itself is feasible (`Ethereum_Sepolia` is in its `NETWORK_CONFIG`;
   imports and engine start work — evidence) so the item is unblocked the moment (a) is reviewed.
   Consequence already noted in Q2: `deliver.kind = "railgun"` leaves are attested (leaf kind 3) but
   not releasable until the adapter lands — a README-honest-limit line is owed with the adapter.

7. **Pins added** (exact, `package-lock.json`): `@scure/base` `1.2.6` (base58 + bech32m — the same
   bech32m the Railgun engine uses; audited), `@scopelift/stealth-address-sdk` `1.0.0-beta.5`
   (beta, **unaudited client tool** — stated plainly in `docs/AUDITS.md`, with the canonical
   Announcer/Registry addresses and bytecode it carries), `viem` `2.57.1` (SDK's client). `cli/build.mjs`
   inlines `@scopelift` (its dist uses bundler-only directory imports Node ESM refuses); all other
   pins stay external.

**Checks at `9910f85`:** `npm run typecheck` clean; `build:core`/`build:cli` clean; `npm run e2e`
(seal-open) **PASS 38 s**; `crosschain/local-demo.sh` 29/29 PASS. Full logs under `tmp/e2e/`;
mutation outputs under `docs/evidence/phase-5/mutations/`; green runs under `docs/evidence/phase-5/repro/`.

### Test audit (READY FOR MERGE)

No new specs; `e2e/` untouched (project ceiling 8, 5 used — the reserved slots are A's). Checks
outside the ceiling, each with its audit mark (R retain, F fix, C consolidate, D delete):

| Check | Mark | Owns (assertion IDs) | Code changed since its mutation run? |
|---|---|---|---|
| `crosschain/local-demo.mjs` | R | `demo-bid-seal-deliver`, `demo-envelope-opens-to-deliver`, `demo-drand-beacon`, `demo-attest-{both-chains,allocation-refused,envelopes-refused,destinations-from-envelope,malformed-deliver-exception,malformed-deliver-exception-both-chains,no-agreement-exception,fabricated-opening-exception,substituted-envelope-exception,result-hash-mismatch-refused,expiry-past-deadline-refused,asset-missing-refused,asset-mismatch-refused}`, `demo-release-{evm,solana}-delivers`, `demo-status-*`, `demo-replay-refused`, `demo-cancel-lock-both`, `demo-refund-*` | no — the R19 rules' mutations (`R19-a/b/c` at `9cfc159`) were re-cut as `R21-a/b/c` and re-run green/red at `9910f85` after the R21 rework |
| `crosschain/stealth-demo.mjs` | R | `stealth-{canonical-deploy,meta-address-registered,escrow-deployed,escrow-lock,attest-from-envelope,derive-reproducible,release-pays-with-stipend,scan-finds-delivery,recover-spends,recovered-key-controls-funds,privacy}` | no — `S2-a`/`S2-b` reds run at `2132dd5` |
| `crosschain/stealth-live.mjs` | R | `live-*` (the live Sepolia delivery) | no |
| `crosschain/ct-delivery.mjs` | R | `ct-{winner-funded,mint-created,source-funded-confidential,fresh-account-configured,envelope-deliver-roundtrip,deliver-elgamal-matches,amount-hidden-probe,delivery-tx,amount-hidden,pending-encrypted,winner-withdraws,winner-balance}` | no — `S3-a`/`S3-b` reds run at `8a52106` |
| `tools/repro/r5-fund-quote-repro.mjs` | R | `r5-{quote-dry,round-amount-refused,shielded-only-refused}` | no — `S5-a` red ran at `6606298` |
| `tmp/proof-r19-payload.mjs` (scratch, not committed) | R (scratch) | the payload-format matrix (36 checks) | n/a — scratch, cited as manual-run proof only |

The 5 committed E2E specs (`e2e/seal-open.spec.ts`, `e2e/cli-auction.spec.ts`, …) are Track A's and
untouched this run.

### R22 (head P2 at `4254c7a`) — OPEN, next package for Track B

`xchain attest` must run the same checks as `benzo verify` on `--dir` (`checkPublicAuction`: frozen
root, gate-X witness certificates, the clearing recomputed through the registry) and refuse on any
ERROR, and require `--result` bytes to equal `--dir/result.json`; repro = a directory whose frozen
leaf set was swapped after the witnesses certified it (attested today, refused after).

Plan (not started when this run ended): (1) `attest` loads `loadCompletePublicAuction` +
`checkPublicAuction` (+ `deriveClaimOpenings`) and refuses on any check with `error`; (2) compare
`--result` bytes with `pub.resultBytes` exactly; (3) rework the demo fixture into a verify-green
directory and add the swapped-leaf-after-witness repro. **Fixture finding for the head (see Q6):**
`checkPublicAuction` requires the result to carry `manifest_hash` and `freeze_root`, `published_at <
T_freeze`, and the `clear` check recomputes the PRODUCT clearing through the registry — which the
cross-chain `winners[].leaf` result shape cannot satisfy. So either the cross-chain result shape
needs a ruling (extend `checkPublicAuction` to accept it) or the xchain fixture/result must be a
full product result and the `winners[]` branch of the leaf derivation drops.

### Questions (run 27)

1. **User instruction (verbatim, received 2026-10-03T13:2xZ, this session):** “**R26 item 2, the
   guard half (you own the verify bundle):** add `npm run check:bundle`. It rebuilds the verify bundle
   into tmp and compares it with the committed `dist/benzo-verify.mjs` and
   `docs/verify-bundle.sha256`, exiting 1 on mismatch. Run it before every commit that touches `api/`,
   `envelope/`, `settle/envelopes.ts`, `cli/commands/verify.ts` or `cli/published-beacon.ts`. Record
   the rule in AGENTS.md's "Track B" notes as a head-sanctioned line.” — AGENTS.md is otherwise
   head-owned/read-only for me; the head should fold this line into a Ruling. With it, “you own the
   verify bundle” also takes R26 item 2's rebuild half (F2's stale-bundle fix) as mine — done: the
   bundle is rebuilt and `check:bundle` is green at `7c235d6`.
2. **Gate LA residuals needing head disposition (full record in
   `docs/evidence/phase-6/leak-audit.md`):** (a) 45 rows of immutable historical evidence carry real
   refund/delivery addresses (`phase-1/frost/pczt-inspect.txt`,
   `phase-2/auction/{cancel.json,pczt-inspect.txt}`, `phase-5` repro/mutation `.out` files) — never
   edited after the fact; consider a README honest-limits disclosure or leave as historical testnet
   artifacts. (b) `docs/STATUS.md` (Track A's file) has 3 broad-rule address rows — A should fix at
   source / decide allowlisting. (c) the sensitive file does not cover bid-plaintext-before-release
   (the tool's `release_time` form) because the instruction named only deployer keys, envelope keys
   and test UAs — order a follow-up run if wanted. (d) the leak-audit `--git` mode scans
   `git log --all` (track-b **and** merged main), not track-b alone.
3. **AGENTS.md placement:** the head-sanctioned `check:bundle` line is under “Two builders” + the
   Commands table (there is no “Track B notes” section); relocate if the head prefers.

### Questions (run 26)

1. **R25 ordering (RESOLVED):** this run's head message confirms the order used — R25 items 1–6,
   then R23.3, then R24 (i)–(iii). Nothing was dropped.

### Questions (run 25)

1. **Sepolia EVM redeploy (RESOLVED, done as declared):** R14 item 4 changed `BenzoEscrow.sol`'s
   storage layout; per R9 item 1 there is no in-place upgrade. The live stealth delivery deployed a
   fresh escrow (`0x1dc207D5…dD85`, the recorded run) and `0x8d08…` is marked SUPERSEDED in
   `docs/AUDITS.md`. Say so if you wanted a different disposition.
2. **R19 leaf mapping (implemented as ruled; two refinements noted):** (a) `deliver.kind:"ct"` maps
   to destination kind 2 (`to` = the account owner key) until item 3 defines the Token-2022 delivery —
   if the fresh confidential account must be committed in the leaf instead, item 3 changes the
   mapping; (b) `deliver.kind:"railgun"` maps to new destination kind 3 (the 0zk's 73-byte payload)
   which `BenzoEscrow.release` does not pay — released through the Railgun adapter in item 4 (if that
   item ends BLOCKED, kind-3 leaves are attested but not releasable and I will say so in README
   limits).
3. **Stealth ephemeral KDF is custom** (`crosschain/stealth.ts` `stealthEphemeralPrivateKey`,
   listed in `docs/AUDITS.md`): every signer must derive the *same* one-time stealth address (the
   root is 2-of-3 signed), which ERC-5564's random ephemeral key does not give; the KDF seeds the
   pinned SDK's own scheme-1 derivation. A leaked seed would link a winner's deliveries (disclosure
   owed in README honest limits), never spend them. Reviewer R should look at this one.
4. **(Q6) Cross-chain result shape vs the `clear` check: RESOLVED by R24 item 2 (a)** — the xchain
   leaf derivation reads the PRODUCT result only (`allocations[].fill`) and the `winners[]` branch is
   gone; implemented with the R22 proof at `97567fa`/`4e19e5f` (the fixture is a verify-green
   product-result directory).
5. **`xchain attest` boundary (documented, not a gap):** the winner-leaf ↔ envelope pairing is now
   anchored where R21 put it — the frozen leaf's own ciphertext and the published beacon — so no
   operator file supplies an opening or a record. The `--result` file remains the signer's own
   validated result per the AUDITS.md procedure (R17 item 4).
## Previous run (23): head task — R14 item 3 finish, R15 items 1–2, R16 item 2 (item 2 landed in run 24 per R18)

State: **READY FOR MERGE for the landed work; R16 item 2 BLOCKED on a one-line Ruling correction** (run 23,
updated 2026-10-03T02:1xZ). Head task items: (1) R15 item 1 **DONE** with red/green proof, (2) R15 item 2
**DONE** with red/green proof, (3) R16 item 2 **BLOCKED (spec defect — Questions #1)**: the ruling's memo
framing v2 cannot fit a tlock ciphertext of the fixed 128-byte bid into the 512-byte Zcash memo (14 bytes
over; both pinned encoders measured) — the drafted implementation is saved as `tmp/r16-item2-wip.patch`
and lands within one run of the correction, (4) rebuild + typecheck + builds + `npm run e2e` **DONE**.
R14 item 3 was finished first per the head unblock (record under the run-22 record below). R14 items 1–5
and R15 items 1–2 are ready for Reviewer R. No mainnet; no other-checkout access or writes; no
merge/rebase/cherry-pick/push; no pin changes.

### Run 23 work (head task items)

1. **R15 item 1 (P2), verify runs the leaf state machine with zero envelope records; stranger parties
   ERROR: DONE** (`09777ef`, prerequisite fix `548b16d`). `api/public-auction.ts`: (a) the envelope run's
   state machine covers every frozen leaf whenever the manifest pins `envelope_keys`, even with zero
   published records — recordless bids are admitted legally, so a lying settlement could hide behind an
   omitted `envelope.json` (R F4); pre-Phase-5 dirs (no pinned keys, no records) keep the old reading.
   (b) `accounting-strays` checks every settlement row/receipt party against the recomputed obligations or
   the stray-deposit rule whenever a settlement is published, not only when a result exists (the CANCELLED
   path refunds deposits only). Prerequisite `548b16d`: the merged R13 claims check misclassified pre-W
   rows as claim-paid and broke Phase 3 evidence (`ERROR claims refused: claim-paid row leaf:0 without a
   published claim`); the claim requirement now applies only where the manifest pins `envelope_keys` — R13
   proves *claim-paid* rows, and pre-W dirs have no claim path. **Note for the head:** this loop is R16 F2's
   area (Track A item 3); my gate is the pre-W half, A's seller/fee half is still owed.

   **Red/green** — `tools/repro/r15-verify-leaves-repro.mjs` (fresh two-leaf corpora over real tlock
   ciphertexts from the pinned Go `tle`, fresh keys, a real authenticated quicknet beacon; the leaf-0-wins-
   at-price-C clearing gives the exact F5 split: leaf 0 refund 0, leaf 1 refund C):

   | output | run at | result |
   |---|---|---|
   | `docs/evidence/phase-5/repro/r15-verify-leaves.out` | clean tree at `e1b55da` (2026-10-03T01:34Z) | exit 0 — PASS r15-machine-runs-without-records, r15-zero-refund-needs-no-row, r15-strangers-refused, r15-phase2-4 |
   | `docs/evidence/phase-5/mutations/R15-F4a.out` | clean `e1b55da` + `R15-F4a.patch` (restores `if (!records.length) return`) | exit 1 — `ERROR r15-machine-runs-without-records got exit 0: no ERROR line` (the expected assertion ID; the rowless receipt was accepted) |
   | `docs/evidence/phase-5/mutations/R15-F4b.out` | clean `e1b55da` + `R15-F4b.patch` (restores the `!pub.result` skip) | exit 1 — `ERROR r15-strangers-refused stranger parties accepted` (the expected assertion ID) |
   | `docs/evidence/phase-5/mutations/R16-F2a.out` | clean `e1b55da` + `R16-F2a.patch` (removes the pre-W claims gate) | exit 1 — `ERROR r15-phase2-4 phase-3 exit 1 … claim-paid row leaf:0 without a published claim` (the expected assertion ID) |

   The machine's unique catch (why clause (a) is not redundant with `accounting`): a receipt-backed
   obligation with **no row at all** passes accounting's obligation pass (it takes a receipt without a row)
   and the claims pass (which walks rows only) — only the leaf state machine demands the row. The
   `r15-machine-runs-without-records` corpus is exactly that lying record. `git apply` → run → `git apply -R`
   leaves `git status --porcelain` showing only the mutation files.

2. **R15 item 2 (P2), a zero-refund leaf with no envelope record needs no row: DONE** (`46cb705`).
   `settleable()` no-ops for a leaf the recomputed result owes nothing — the clear omits zero-refund leaves
   from the obligations map (`clear/core.ts` `owed > 0n`) and `settle/ledger.ts` refuses zero-amount rows,
   so the row-free state is correct and "missing row" for it was a false error (R F5). Without a result
   there are no result obligations at all, so the machine demands no row there either. Unsettled dirs keep
   the exception-queue warning for obligated leaves.
   **Red** — `docs/evidence/phase-5/mutations/R15-F5.out`: clean `e1b55da` + `R15-F5.patch` (removes the
   no-op guard) → exit 1 `ERROR r15-zero-refund-needs-no-row … ERROR envelope refused: missing envelope 0:
   missing row` (the expected assertion ID — exactly R's false-error probe). **Green** — the same check PASS
   in `docs/evidence/phase-5/repro/r15-verify-leaves.out` (with the exact expected warn `missing envelope 1;
   in the exception queue` asserted).

3. **R16 item 2 (memo-bound envelope): BLOCKED on a Ruling correction (spec defect), not on code.** The
   ruling's framing v2 `ff424e5a02 || u16be ct_len || tlock_ct || envelope_sha256 (32) || zero pad` leaves
   `ct_len ≤ 473` (512 − 5 − 2 − 32), but the fixed 128-byte bid tlocks to **487 bytes** with both pinned
   encoders — tlock-js 0.9.0 (the sealer's `decodeArmor` output; enforcing the v2 budget the page reports
   `ciphertext too long: 487 bytes`; Phase 1 R8 recorded “487-byte ciphertext (494-byte envelope before
   pad)”) and the pinned Go `tle` v1.2.0 (`head -c 128 | tle -e … | wc -c` → 487). 7 + 487 + 32 = 526 > 512:
   the format as written is 14 bytes over the Zcash memo field, so `bid seal` can never produce it. Choosing
   a binding width is a crypto-format decision and not mine (“do not design”); the request with options is
   Questions #1. The whole item (writer, parser, intake, verify, cancel seam, proofs) is defined in terms of
   this framing, so all of it waits on the correction. The implementation drafted against the written
   framing — `memoSealedBid` returning ct + hash for v1/v2, the shared `memoBindsEnvelope` rule (one rule for
   intake + verify + signer), the `memoBoundEnvelope` cancel seam (authenticate from the scanned memo hash,
   no tlock opening), the intake and verify checks, the sealer v2 writer + `bid seal`'s `envelope_hash`, the
   scanner-fixture updates — is saved as `tmp/r16-item2-wip.patch` (333 lines over 11 files; re-apply with
   `git apply tmp/r16-item2-wip.patch` once the corrected framing is ruled, then adjust the two length
   constants). **None of it is in the shipped tree** — tree clean, `npm run e2e` PASS — so no item-3 progress
   is claimed beyond this record and the patch.

4. **Item 4 (rebuild + checks): DONE** (`acd49a4`). `npm run build:verify` → `dist/benzo-verify.mjs` +
   `docs/verify-bundle.sha256` (now carrying the R15 leaf state machine, the stranger-party rule and the
   pre-W claims gate); `npm run typecheck` PASS; `build:seal`, `build:core`, `build:settle`, `build:cli`
   clean; `npm run e2e` (default seal-open) **PASS 42 s** at `acd49a4` (`tmp/e2e/report.json`).

### Test audit (run 23)

Shipped tree: no test files changed (the R16 fixture edits live only in the WIP patch). Project E2E suite
(8-test ceiling; 5 used) **R retain** — `e2e/seal-open.spec.ts` PASS 42 s at `acd49a4`; the four
live-project specs untouched (covered live code untouched). `tools/repro/r15-verify-leaves-repro.mjs` is a
check outside the ceiling (**R**; owns `r15-*`, mutation-proven this run). Contract suites untouched.

### Questions (run 23; standing ones listed first)

1. **(answered by R18 in `601845d`; landed in run 24 — see Current run) R16 item 2 needs a one-line Ruling correction (blocks my next work).** Memo framing v2 as written is
   14 bytes over the 512-byte Zcash memo: `5 + 2 + 487 + 32 = 526 > 512` (the fixed 128-byte bid tlocks to
   487 bytes — measured with both pinned encoders, and recorded in Phase 1 R8). The binding tag must fit in
   the 18 bytes that remain after the ct: e.g. **(a)** `envelope_sha256` truncated to **16 bytes**
   (`ff424e5a02 || u16be ct_len || tlock_ct || tag16 || zero pad`, 5+2+487+16 = 510), **(b)** an exact-fit
   **18-byte** tag (512 exactly, no pad), or **(c)** your own fix (a smaller tlock plaintext would break the
   fixed 128-byte layout). One ruling line and I implement the full item — writer, parser, intake, verify,
   cancel-before-R fixture and the mismatch refusals — from `tmp/r16-item2-wip.patch`.
2. **Sepolia EVM redeploy (carried, run 22):** R14 item 4 changed `BenzoEscrow.sol` (storage-layout change).
   Redeploy and mark `0x8d08…` SUPERSEDED, or leave for Phase 6? Sepolia gas is not mine to faucet.
3. **R16 F2 split note (heads-up, no action needed unless you disagree):** the merged R13 claims check
   misclassified pre-W rows as claim-paid (every correct pre-Phase-5 settlement failed verify); my `548b16d`
   gates the claim requirement on the manifest's `envelope_keys` (the pre-W half). Track A's R16 item 3
   (seller/fee rows) is still owed and composes with it.
4. **Cancel-row parties (one line for A's R16.1 wiring):** verify's R15 stranger rule (as the head wrote it)
   accepts `deposit:`-shaped rows for the CANCELLED path and ERRORs `leaf:N` rows in a result-less
   settlement; the current plan cancel branch emits `deposit:`-shaped rows, which fits. If A's wiring emits
   `leaf:N` rows for frozen deposits instead, rule it and I'll extend `settleable`/the stranger rule to
   match the leaf's own deposit party.
Run 23 base: clean tree at `92ac035` (head: Merge branch 'main' into track-b, bringing R15/R16 and A's
R7 batch; R15/R16 in `docs/PHASE-5.md`, head commits `c1f7d2e` + `c4584c7`). No mainnet; no
other-checkout access or writes; no merge/rebase/cherry-pick/push; no pin changes.

### Run 22 record (R14 items 1–5)
Base: clean tree at `a623139` (head: merge main into track-b; R14 in `docs/PHASE-5.md` R14, head commit
`0da383e`). Reviewer R's report read-only at `~/Dev Projects/benzo-sol/reports/pr-b-r9-contracts.md`;
lab PoC copied from `~/Dev Projects/benzo-sol/lab/pr-b-r9/lab-only/` (read-only). Baseline `npm run
e2e` PASS 38 s at `a623139` (`tmp/proof-logs/r14-baseline-e2e.out`). R12 run 21 is complete (nothing open; its
two Questions stand). No mainnet; no other-checkout access or writes; no merge/rebase/cherry-pick/push; no pin
changes. At run start `contracts/solana` was byte-identical to `4d9c0e6` (`git diff 4d9c0e6 -- contracts/solana`
empty), so the red run below ran literally on the 4d9c0e6 program.

1. **R14 item 1 (P0), submit_attestation refuses CPI and binds the message to its own attestation bytes: DONE**
   (`bd48e7e`). `contracts/solana/src/lib.rs`: two independent refusals, one new error each — **`ViaCpi` (custom
   0x15)**: `get_stack_height() != TRANSACTION_LEVEL_STACK_HEIGHT` refuses any CPI entry (the instruction runs only
   as a top-level transaction instruction); **`MessageNotSelf` (custom 0x16)**: the instruction at `current` must be
   this program's own submit instruction with `data.len() == 2 + ATT_LEN` and `data[2..2+ATT_LEN] == att` (the exact
   bytes parsed), so the message the precompile verified and the attestation processed can never differ.
   **Sysvar-trust audit of every other instruction (ruling item 1's sweep): none found.** The instructions sysvar is
   read only in `submit_attestation` (account key checked against `sysvar::instructions::ID`, the spoofed-sysvar
   refusal); `lock`/`refund`/`release_approved` take time/rent from `Clock::get()`/`Rent::get()` — the
   `sol_get_sysvar` syscall, never a caller-supplied account — and their state reads are program-owned PDAs
   (`grep -n 'Clock::get\|Rent::get\|load_.*_checked' contracts/solana/src/lib.rs`).

2. **R14 item 2, CPI-forgery regression fixture: DONE** (`c7c417c`). Reviewer R's lab PoC is copied into
   `contracts/solana/test/` as a permanent fixture — `test/proxy/` (the attacker program, verbatim) and
   `test/cpi-forge.mjs` (source `benzo-sol lab/pr-b-r9/lab-only/{proxy,cpi-forge.mjs}`; assertions inverted to the
   regression contract: the forged CPI submit must be **refused**). `test/run.sh` builds the proxy with the pinned
   `cargo build-sbf`, loads both programs on `solana-test-validator` and runs the fixture after the full driver.
   Checks: `cpi-distinct-messages`, `cpi-control-direct-forge-refused` (the same sigs used directly fail at the
   Ed25519 precompile, ix 0, custom 0x2 — the program is never reached), `cpi-forged-submit-refused` (ViaCpi 0x15),
   `cpi-forged-root-not-approved` (nothing written for the forged batch), `cpi-honest-submit-lands`,
   `cpi-honest-root-approved`, `cpi-honest-release-pays` (honest direct submit + release pay exactly +2e9/+3e9
   lamports, escrow −5e9).

   | output | run at | result |
   |---|---|---|
   | `contracts/logs/r14-cpi-old-code.out` | `a623139` tree = the 4d9c0e6 program (2026-10-02T23:33Z) | exit 1 — `ERROR cpi-forged-submit-refused forged CPI submit LANDED (the R14 F1 bypass is back)` + `ERROR cpi-forged-root-not-approved approval PDA for the forged batch exists`; driver 43/43 PASS |
   | `contracts/logs/r14-cpi-fixed.out` | `bd48e7e` + fixture (2026-10-02T23:38Z) | exit 0 — ALL PASS (driver 43/43 + fixture 8/8) |
   | `docs/evidence/phase-5/mutations/R14-F1.out` | clean tree at `c7c417c` + `R14-F1.patch` (2026-10-02T23:44Z) | exit 1 — same two `ERROR` lines: `ERROR cpi-forged-submit-refused` (the expected assertion ID) |

   `docs/evidence/phase-5/mutations/R14-F1.patch` removes both refusals (exactly the 4d9c0e6 code path);
   `git apply` → run → `git apply -R` leaves `git status --porcelain` clean but for the two mutation files.
   Honest note: `MessageNotSelf` cannot fail on its own once `ViaCpi` is in place — in any non-CPI execution the
   instruction at `current` *is* the invocation's own — so no fixture can show it failing independently; the
   mutation removes both checks together (the exact red the ruling asks for: landed on 4d9c0e6, refused after).
   (b) is nevertheless enforced at runtime and would alone refuse the PoC path with 0x16 (`self_ix.program_id !=
   *program_id` for the proxy instruction).

3. **R14 item 3, new devnet program ID + one live cycle: DONE** (this run). The head unblocked funding
   without a faucet: the deployer is the upgrade authority of the three SUPERSEDED programs, closed
   2026-10-03T00:2xZ (~1.62 SOL reclaimed; deployer balance after closes: 1.64698668 SOL):

   | closed program | close txid | reclaimed |
   |---|---|---|
   | `AE1LQwTyvPmjoTNdX2b7krH2yBejUgjnBdmGYpB9yna4` (carried the R14 CPI-forgery P0) | `5CiZmsXFgph3qG7FJUVFmye17tjFbtLyAPyLqLYeMtJWzdyPW7C1VMfjWjtqC4Giz7ySuFPhLCob6MFLDVoCXho` | 0.52033932 SOL |
   | `58SsWZaW2eBq1z1bnH1xPNXXMGbnrXm9YMvGeRdJL14G` | `5XUS9BkcprYAdL5FKSLs9iYNsM3u6DMi9iSEk7hgqxCpWsu3yPJoRJ2GkFh8KsPwyVSFYmYz2ArCuBfT5QkAyhBw` | 0.53265324 SOL |
   | `2Wh8X6dfqwYu45GAxYHW95VJEKjDxbhbANxTy9F7Lrt4` | `4uckQB5BcZraQ8UGiDMSMGK2LW9spt8oaC1arV3KDuCSnBpcPdyxnVKvmTnTwX1f5LY4edmHQYnUMQVn7XSz92Nu` | 0.56540908 SOL |

   Each close verified `Status: Ok` with `Closed Program <id>` via `solana confirm -v <txid> -u devnet`;
   `docs/AUDITS.md` marks all three **closed**. The R14 P0 program is no longer live on devnet.

   **Redeploy + live cycle** — `bash tools/repro/r14-devnet-deploy-cycle.sh` (run 2026-10-03T00:31Z and
   00:34Z; transcript `$BNZ_STATE_DIR/xchain-live/r14-cycle.out`): the R14-fixed build (so sha256
   `84fd87b726baa0ea007774cb9588f81f9ec077c58809323ce70b3072094e8bc6`, 102,840 bytes) deployed under
   the **new program ID** `2h6tgr5Ay1WE3u6kmPZnKh9EyTu7dkgWFkkrjCA5QyPu` (ProgramData
   `EYPDHi1uJU8ksJEWzt1SbJyEjpzYdBAkpWyemeeRNbsV`, deploy tx
   `5KPMPtffZPCmUAmg5eJYSDrH73yjpw3BPFjWj5sECDibLYGR7pdSEKvdTJeKM1avMSLNLP4Q4LCaRAEtopdbfBQV`,
   upgrade authority the deployer; no in-place upgrade). One live devnet cycle through the shipped
   `benzo xchain` CLI on auction `0x03829a0a344340eb0713eedd333840c35b5a205dbca0e949ff99d847ff896d2f`:
   lock tx `gJYMM6xCoSJgBUnv8EEV2WnrXhcm7GBEYycuxTLA7c8ERM9Yg2EhUVsSdV76bSYHbaFYtCAQkGnTYES6VvTKTwF`
   → attest 2-of-3 (allocation root `0xab0c4b45…bfeda1`) → release paying leaf 0 one lot
   (txs `43Rby5Z2…`, `2dHynoCz…`, `zSWCVi39…`, `4vwnkszb…`, lookup table `4uHxak9m…`) →
   `xchain status --result`: published `abf56844…8072` = chain `0xabf56844…8072`, **match: true** (the
   item-4 tie) → refund after the deadline tx `5E3vqnTuDAkqxhuigoNXeDQnbeodZkeYLTqBRmgo5rgPir2aLCbRM4aqAj8yGCHLT1anx9Meargm4cNigUkqD3yB`
   → final status `refunded: true`. Transcript ends `RESULT PASS r14 devnet deploy + one live cycle on
   2h6tgr5Ay1WE3u6kmPZnKh9EyTu7dkgWFkkrjCA5QyPu`. `docs/AUDITS.md` records the new **current** row.

   Script fixes forced by the first run (Deviations): `solana program show` needed `--keypair
   "$DEPLOYER"` (the CLI otherwise wants a default signer and the script died at `set -e` after a
   successful deploy); reruns now skip the deploy when the program exists (never an in-place upgrade);
   deploy output goes to `$BNZ_STATE_DIR/xchain-live/r14-deploy.log` and only `Signature:`/`Program Id:`
   lines reach the transcript — the pinned solana CLI printed an ephemeral deploy-buffer recovery seed
   phrase banner on the first run (the buffer account `6GTQJtFz…` does **not** exist on chain — checked
   `solana account`: AccountNotFound — no lamports leaked; no custody or wallet key was involved or
   printed elsewhere).

   History of this item (the BLOCKED record stands as the earlier outcome): three distinct approaches
   had failed before the head unblock (own-key sweep; CLI faucet, 4 attempts; two alternative RPCs —
   exact errors in run 22's record below), so the item was BLOCKED on faucet funds, not on code.

4. **R14 item 4 (P2), EVM `approval()` view + `xchain status` result-hash tie: DONE** (`319a09c`, evidence
   `517d4bf`). `contracts/evm/src/BenzoEscrow.sol`: `approval(auctionId, batchIndex)` returns
   `(allocationRoot, resultHash, expiry, exists)`; the write-only `nonce` is dropped from the `Approval`
   struct and documented on `Release` (it stays signed and digest-committed; replay is the one-shot
   approval). `benzo xchain status [--result FILE]` prints the escrow's approved resultHash (EVM via the
   view; Solana from the Approval PDA layout) beside the **published result hash — the product's
   `resultHash`: sha256 over the raw result.json bytes (`manifest/schema` `hash`, what `benzo verify` and
   the API report)** — with `match`, and exits 1 `ERROR xchain result hash mismatch: …` on mismatch or a
   missing approval. The demo attests that published hash (was a demo-local keccak choice — Deviations)
   and adds `demo-status-result-hash-matches-published` + `demo-status-result-hash-mismatch-refused`.
   **Red/green** — `docs/evidence/phase-5/mutations/R14-F3.patch` (the getter swaps root into the
   resultHash slot) at clean `319a09c`: forge red `test_approval_exposes_stored_fields` FAIL with the exact
   field mismatch (`mutations/R14-F3.out`, `contracts/logs/r14-3-getter-mutant.out`; forge prints `FAIL:`
   lines, its format, not `ERROR <id>`), and `R14-F3b.patch` (comparison hard-coded `match: true`) → demo
   red `ERROR demo-status-result-hash-mismatch-refused evm rc=0 sol rc=0` (`mutations/R14-F3b.out`, the
   expected assertion ID in the last 30 lines). **Green after** — `contracts/logs/r14-3-getter-fixed.out`
   (forge 30/30 = 28 prior + `test_approval_absent_batch_is_empty` + `test_approval_exposes_stored_fields`)
   and `contracts/logs/r14-3-demo-fixed.out` (17/17, `RESULT PASS one cleared drop delivered end to end
   locally on both chains`). `npm run typecheck` PASS.

5. **R14 item 5 (P2), `local-demo.sh` `.env` guard: DONE** (`c3ad712`).
   `if [ -f .env ]; then set -a; . ./.env; set +a; fi` replaces `set -a; . ./.env 2>/dev/null || true;
   set +a` (bash 3.2 exits the shell when sourcing a missing file — the `|| true` never ran).
   **Red on the old line** (2026-10-03T00:07Z, `.env` moved aside, `/bin/bash` = 3.2.57):
   `contracts/logs/r14-5-demo-no-env-old-code.out` — `crosschain/local-demo.sh` exit 1, **0 bytes of
   output** (R's F2 silent death). **Green after** (00:12Z, still no `.env`):
   `contracts/logs/r14-5-demo-no-env-fixed.out` — exit 0, 17/17 demo checks, `RESULT PASS …` — the
   documented §7 step 3 is reproducible on a clean checkout.

R12 (run 21) sweep: **nothing open** — items 1–4 landed before this run; its two Questions stand for the
head (the unpinned-manifest v2-record interpretation; Track A's `r7-3-exception-queue-repro.mjs` lines).
Final tree checks: `npm run e2e` PASS 38 s and `npm run typecheck` PASS at the final tree;
`bash contracts/solana/test/run.sh` green at `bd48e7e` (43/43 driver + 8/8 fixture).

### Test audit (READY FOR MERGE)

Project E2E suite (the 8-test ceiling; 5 used) — untouched this run, **R retain**: `e2e/seal-open.spec.ts`
(default project) PASS 38 s at base `a623139` and at the final tree; the four live-project specs unchanged
(covered `seal/`, `clear/`, `settle/` code untouched this run).

Contract-level proofs outside the ceiling (contracts/ + the crosschain harness), with mutation status:

| suite | audit | assertion IDs | covered code changed since its last mutation run? |
|---|---|---|---|
| `contracts/solana/test/run.sh` → `driver.mjs` (43 checks) | R | the driver's IDs (lock/release/refund/dust/layout/SIZE) | yes (`submit_attestation`, item 1) — behavior-neutral for the new lines: all 43 stay green with the fix removed (R14-F1 run); no assertion added, loosened or removed |
| `contracts/solana/test/cpi-forge.mjs` (new, item 2) | R | `cpi-*` (8) | owns item 1's lines — mutation R14-F1 run and red (`ERROR cpi-forged-submit-refused`) |
| `contracts/evm/test/ApprovalGetter.t.sol` (new, item 4) | R | `test_approval_absent_batch_is_empty`, `test_approval_exposes_stored_fields` | owns the getter — mutation R14-F3 red (`test_approval_exposes_stored_fields` FAIL) |
| `contracts/evm/test/*` (28 prior) | R | unchanged IDs | yes (`BenzoEscrow.sol` Approval struct) — all 28 green at `319a09c`. Honest note: earlier runs proved those reds by old-code runs, no committed mutation patches exist to re-run cheaply; only the green re-run is claimed |
| `crosschain/local-demo.sh` → `local-demo.mjs` (17 checks) | R | `demo-*` | yes (item 4) — mutation R14-F3b red (`ERROR demo-status-result-hash-mismatch-refused`); item 5's guard red/green above |

`tools/repro/r14-devnet-deploy-cycle.sh` is an ops repro (balance-gated deploy+cycle, no assertions), not a
test — outside the ceiling.

### Deviations (this run)

- **Demo result-hash derivation (item 4):** `crosschain/local-demo.mjs` attested a demo-local
  `keccak256(result.json bytes)` as `result_hash`; it now attests the product's published result hash
  (sha256 over the raw result.json bytes — `manifest/schema` `hash`, the value `resultHash(pub)` in
  `api/public-auction.ts` and the series link). Forced by the item-4 tie: "compare `resultHash` with the
  published `result.json` hash" is only meaningful against the product's published hash. The signed
  message format, both escrows and every other caller are unchanged (the field was always caller-chosen).

### Needs user

- None. The devnet airdrop ask is withdrawn — the head unblocked item 3 by authorizing closing the three
  SUPERSEDED programs (done, txids in item 3); the redeploy runs on the reclaimed SOL.

### R22 (head P2 at `4254c7a`) — OPEN, next package for Track B

`xchain attest` must run the same checks as `benzo verify` on `--dir` (`checkPublicAuction`: frozen
root, gate-X witness certificates, the clearing recomputed through the registry) and refuse on any
ERROR, and require `--result` bytes to equal `--dir/result.json`; repro = a directory whose frozen
leaf set was swapped after the witnesses certified it (attested today, refused after).

Plan (not started when this run ended): (1) `attest` loads `loadCompletePublicAuction` +
`checkPublicAuction` (+ `deriveClaimOpenings`) and refuses on any check with `error`; (2) compare
`--result` bytes with `pub.resultBytes` exactly; (3) rework the demo fixture into a verify-green
directory and add the swapped-leaf-after-witness repro. **Fixture finding for the head (see Q6):**
`checkPublicAuction` requires the result to carry `manifest_hash` and `freeze_root`, `published_at <
T_freeze`, and the `clear` check recomputes the PRODUCT clearing through the registry — which the
cross-chain `winners[].leaf` result shape cannot satisfy. So either the cross-chain result shape
needs a ruling (extend `checkPublicAuction` to accept it) or the xchain fixture/result must be a
full product result and the `winners[]` branch of the leaf derivation drops.

### Questions (this run)

- **Sepolia EVM redeploy?** Item 4 changed `BenzoEscrow.sol` (getter + dropped write-only `nonce` from the
  `Approval` struct — a storage-layout change). `docs/AUDITS.md` says EVM escrows are redeployed per
  change, but R14's item 3 covers only the Solana devnet deploy and Sepolia gas is not mine to faucet. The
  live Sepolia escrow `0x8d08…` therefore predates item 4 (its R9 cycle evidence stands). Redeploy and mark
  `0x8d08…` SUPERSEDED as part of item 3's completion, or leave for Phase 6?

## Previous run: head task — R12 items 1–3 (shared envelope rule, committed red/green repros, KC_KEY fix)

State: **READY FOR MERGE** (items 1–4 all landed with red/green proof; updated 2026-10-02T23:02Z).
Commits: `a82f865` (item 1), `c8c622e` (item 2), `0c1404a` + `2ea170e` (item 3 + its rerun), and the final
commit (item 4: rebuilt bundle + hash, doc hash refresh, this STATUS).
Base: clean tree at `266c2e6` (head: merge main into track-b; R12 in `docs/PHASE-5.md`). Baseline `npm run e2e`
PASS 37 s at `266c2e6` (`tmp/proof-logs/r12-baseline-e2e.out`). Reviewer R's report read-only at
`~/Dev Projects/benzo-sol/reports/pr-b-envelopes-v2.md`. No mainnet; no other-checkout access or
writes; no merge/rebase/cherry-pick/push; no pin changes; nothing outside the repo. R10/R9 open-item sweep:
none open for Track B (R10 item 1 and R9 items 1–4 landed in the previous run; R10 items 2–5 and R12 item 3/R13
are Track A's).

1. **R12 item 1 (P1), one shared published-record rule: DONE** (`a82f865`).
   `envelope/index.ts` exports `envelopeRecordValid(record, envelope_keys)` (total, never throws): when the
   signed manifest pins `envelope_keys` a record is valid only as the exact v2 shape for n = 3 — 926 bytes
   (`ENVELOPE_CT_BYTES_N3`), the `benzo-envelope-v2` magic, and stanza recipients equal to `envelope_keys` in
   order (read by `envelopeRecipients`); when the manifest pins no keys only the pre-v2 572-byte box is accepted
   (`ENVELOPE_CT_BYTES_PRE_V2`) — the only place pre-v2 records are accepted. Wired into all three consumers:
   intake (`clear/auction-cli.ts admit`, the sanctioned one-line Track A change) refuses anything else when the
   manifest pins keys; `settle/envelopes.ts validEnvelope` returns null for anything else (its divergent
   `envelopeRecordShape`/`ENVELOPE_CT_BYTES` are removed); `benzo verify` (`api/public-auction.ts` envelope
   check) reports `ERROR envelope envelope record format` for any published record that breaks it.
   **Red at `266c2e6` / green after** — `docs/evidence/phase-5/repro/mr-envelope-before.out` (exit 1) and
   `mr-envelope-after.out` (13/13 PASS, exit 0). The red lines are the R12 probe list exactly:
   `ERROR mr-verify-foreign-key got exit 0 OK envelope, want ERROR envelope` (R's attacker-key probe — `OK
   envelope` before, ERROR after), and the same flip for `mr-verify-foreign-set` (record sealed to
   [attacker, key2, key3]), `mr-verify-pre-v2-pinned` (572-byte record under a pinned manifest) and
   `mr-verify-2of3-pinned` (record sealed to 2 of the 3 keys); `mr-shared-rule-export` red before / green after.
   Controls green before and after: `mr-verify-pre-v2-unpinned` (572-byte record under a manifest with no
   `envelope_keys` → `OK envelope`) and `mr-verify-phase2-4` — `bin/benzo verify` on
   `docs/evidence/phase-2/auction` (`--fetch-beacon`), a Phase 3 public dir rebuilt from
   `docs/evidence/phase-3/settle/` (the R16 corpus shape), and `docs/evidence/phase-4/cli` — all exit 0 with
   `OK envelope`. The corpora are built afresh per run: real tlock seal/open with pinned Go `tle` at a past
   quicknet round, a real fetched beacon, owner-signed records, `bin/benzo verify` as the entry point.
   `npm run typecheck` + `build:core`/`build:settle`/`build:cli` PASS at `a82f865`.

2. **R12 item 2 (P2), the envelope red/green checks committed as `tools/repro/` scripts: DONE** (this commit).
   `tools/repro/mr-envelope-repro.mjs` (the `mr-*` checks + the R12 rule probes above) and
   `tools/repro/kc-key-commitment-repro.mjs` (the `kc-*` key-commitment checks), each run as
   `node tools/repro/<name>.mjs`, outputs committed under `docs/evidence/phase-5/repro/`:

   | output | commit at run time | result |
   |---|---|---|
   | `mr-envelope-before.out` | `266c2e6` (clean) | exit 1 — 5 red: `mr-shared-rule-export`, `mr-verify-foreign-key`, `-foreign-set`, `-pre-v2-pinned`, `-2of3-pinned` |
   | `mr-envelope-after.out` | `a82f865` (clean) | exit 0 — 13/13 PASS |
   | `kc-key-commitment-before.out` | `266c2e6` (clean) | exit 1 — `kc-key-32-interop` + `kc-split-key-recipient1-opens` red (the KC_KEY bug, item 3) |
   | `kc-key-commitment-after.out` | `0c1404a` (clean; committed path) | exit 0 — 10/10 PASS |

   Provenance: the first three runs executed `node tmp/<name>.mjs` with content byte-identical to the committed
   scripts before the scripts were committed (sha256 `813c824592d88f37b2845586092db394bf028b9d0a326af271a2a5c29386bfc4`
   and `3f6f239c27b9a960e31875000b054419711ebbff6fa36dda4b2d89834f4f5715`, `cmp` clean against the copies);
   each output's first lines record `commit`, `utc` and the `git status --porcelain` tree state from git at run
   time and are unedited. The `kc-…-after.out` run executes the committed script itself.
   Honest notes: (a) `mr-verify`'s owner-binding mutations (owner_sig flip, envelope_ct swap) assert R7.4's
   current, post-merge semantics — the merged main changed a bad owner_sig/commitment from `ERROR envelope N
   signature` (79aed9e's tree) to `WARN invalid envelope N; refund goes to the exception queue` + exit 0 — so
   the committed check asserts that specific WARN text, not the pre-merge ERROR. The R12 rule probes are what
   flip `OK envelope` → `ERROR envelope`. (b) `settle/envelopes.ts` no longer exports `envelopeRecordShape`, so
   Track A's `tools/repro/r7-3-exception-queue-repro.mjs` informational block now prints its "shipped helper
   absent" line on rerun (its try/catch covers it; no behavior change; the file is A's and was not touched —
   see Questions). (c) The `kc-*` checks hand-build envelopes under the specified key-commitment derivation
   (the `"benzo-envelope-v2-kc"` label zero-padded to libsodium's `crypto_generichash_KEYBYTES`), which is
   exactly why they are red at `266c2e6` and stay red through this commit (item 3 is the fix).

3. **Head finding on 79aed9e (P3), KC_KEY exactly `crypto_generichash_KEYBYTES`: DONE** (`0c1404a`).
   `envelope/index.ts`: the label `"benzo-envelope-v2-kc"` is 20 bytes and the padding was computed as
   `32 - 19`, so `KC_KEY` was 33 bytes. Now padded with `32 - label.length` (= 12 zero bytes),
   `requireThat(KC_KEY.length === sodium.crypto_generichash_KEYBYTES, "envelope kc key")` at module load,
   and the comment states the 20-byte label and the exact padding. No live envelope had been sealed under the
   wrong key. **Red before / green after with the committed repro** (item 2's `kc-*` checks hand-build their
   key_commit under the specified derivation, which is why they caught it): `kc-key-32-interop` and
   `kc-split-key-recipient1-opens` refused `envelope key commitment` at `c8c622e` (the same red recorded at
   `266c2e6` in `docs/evidence/phase-5/repro/kc-key-commitment-before.out`), and
   `docs/evidence/phase-5/repro/kc-key-commitment-after.out` is 10/10 PASS at `0c1404a`, run as
   `node tools/repro/kc-key-commitment-repro.mjs`. `npm run typecheck` + builds PASS.

4. **Rebuild + full checks (item 4): DONE.** `npm run build:verify` rebuilt `dist/benzo-verify.mjs` and
   `docs/verify-bundle.sha256` (sha256 `37aa7dd68178f3545dc9f35d28e0a48ffdb44ca3dafcff0cefc8ffe82c593d0e`
   in both; the old committed bundle was stale — the merge and items 1/3 changed its sources — and
   `docs/verify-it-yourself.md`'s example hash was already stale at `f9ac5562…`, refreshed to the new one).
   The shipped standalone bundle carries the new rule (`tmp/proof-logs/r12-bundle-smoke.out`, corpora from the
   repro run): `node dist/benzo-verify.mjs` gives `ERROR envelope refused: envelope record format` exit 1 on
   the foreign-key/pre-v2-pinned/2of3-pinned corpora and `OK envelope` exit 0 on the good and pre-v2-unpinned
   ones. `npm run typecheck`, `build:core`, `build:settle`, `build:cli` and `npm run e2e` all PASS
   (`PASSED default seal in the browser, open with tle after R (40 s)`, `tmp/proof-logs/r12-final-e2e.out`;
   baseline PASS 37 s at `266c2e6`, `r12-baseline-e2e.out`).

Test audit (READY FOR MERGE, this run): project E2E suite (the 8-test ceiling; 5 used), each **R retain** (no
assertion added, removed or loosened; `e2e/` untouched this run):
| test | audit | assertion IDs | covered code changed since its last mutation run? |
|---|---|---|---|
| `e2e/seal-open.spec.ts` (default project) | R | C1–C7 (browser seal → `tle` open after R) | no (`seal/` untouched) — PASS 40 s at `2ea170e` + the item-4 tree (bundle/doc/STATUS only) |
| `e2e/cli-auction.spec.ts` (live project) | R | P1… (admit/freeze/open/clear/claim rows) | yes — `clear/auction-cli.ts` admit's record rule (item 1). The cheapest mutation of that line is the R12 red/green itself: the intake rule + verify rule flip proven before/after in `docs/evidence/phase-5/repro/mr-envelope-*.out` and by the bundle smoke; the live spec remains Track A's to run (`npm run e2e:live`) |
| `e2e/testnet-golden-path.spec.ts` (live) | R | golden-path IDs | no |
| `e2e/auction-core.spec.ts` | R | core IDs | no |
| `e2e/settle-crash.spec.ts` | R | crash/fault IDs | no (its `settle/envelopes.ts` surface — `validEnvelope`/`envelopeRecipient`/`openDestination` — is total and signature-unchanged; item 1's rule change is covered by the `kc-1of3/2of3/reorder/wrongset-refused` checks) |
The `tools/repro/*.mjs` checks are repro scripts of the `r7-*` class (outside the ceiling; not Playwright specs,
no assertions added to `e2e/`); they run the shipped entry points (`bin/benzo verify`, `dist/benzo-verify.mjs`,
pinned Go `tle`) against real drand quicknet, and their red/green is the before/after pair above.

Deviations: none. Env: none new. Upstream code: none copied (the two scripts adapt my own earlier scratch
proofs `tmp/proof-mr.ts`/`tmp/proof-kc.ts`, not upstream). Key material: none created or read beyond ephemeral
proof keys generated inside the repro runs (never persisted, never printed).

### R22 (head P2 at `4254c7a`) — OPEN, next package for Track B

`xchain attest` must run the same checks as `benzo verify` on `--dir` (`checkPublicAuction`: frozen
root, gate-X witness certificates, the clearing recomputed through the registry) and refuse on any
ERROR, and require `--result` bytes to equal `--dir/result.json`; repro = a directory whose frozen
leaf set was swapped after the witnesses certified it (attested today, refused after).

Plan (not started when this run ended): (1) `attest` loads `loadCompletePublicAuction` +
`checkPublicAuction` (+ `deriveClaimOpenings`) and refuses on any check with `error`; (2) compare
`--result` bytes with `pub.resultBytes` exactly; (3) rework the demo fixture into a verify-green
directory and add the swapped-leaf-after-witness repro. **Fixture finding for the head (see Q6):**
`checkPublicAuction` requires the result to carry `manifest_hash` and `freeze_root`, `published_at <
T_freeze`, and the `clear` check recomputes the PRODUCT clearing through the registry — which the
cross-chain `winners[].leaf` result shape cannot satisfy. So either the cross-chain result shape
needs a ruling (extend `checkPublicAuction` to accept it) or the xchain fixture/result must be a
full product result and the `winners[]` branch of the leaf derivation drops.

### Questions (this run)

- **R12 rule, one interpretation to confirm:** the ruling makes pre-v2 acceptance conditional ("accepted only
  in directories whose manifest has no `envelope_keys`") and pins the v2 case. I implemented the unpinned case
  as *strictly* the pre-v2 572-byte shape: a v2 record under a manifest with no `envelope_keys` breaks the rule
  and is refused at intake / `ERROR envelope` at verify. If you meant unpinned dirs to accept either shape,
  redirect and I'll widen the unpinned branch (one line in `envelopeRecordValid`).
- **Track A's `r7-3-exception-queue-repro.mjs`:** its informational "intake shape check" lines call
  `envelopeRecordShape`, which item 1 removed; a rerun prints `intake shape check: shipped helper absent`. Want
  me to retarget those two lines at `envelopeRecordValid` (A's file — I left it alone), or is that A's?

## Previous run: head task — R10 item 1 + R9 items 1–4 + live cycles (the head's 6-item list)

State: **READY FOR MERGE** (items 1–6 all landed with red/green proof; updated 2026-10-02T22:10Z).
Base: clean tree at `dc5ea63` (head: merge main into track-b; R9/R10 in `docs/PHASE-5.md`).
One commit per item, each with a red log on the pre-change code and a green log after: `79aed9e`
(item 1, R10 envelope key commitment + exact recipient set), `aff0c6b` (item 2, R9 Solana
`layout_version` + new program ID), `88c1772` (item 3, R9 `xchain attest` asset from chain),
`e26de7f` (item 4, R9 EVM attest-once/release-many), `4d9c0e6` (item 5, R9 `lock` nonReentrant +
effects-before-transfer), and this commit (item 6, Sepolia redeploy + one live cycle per chain).
Scope: the head's list in order — (1) R10 item 1 envelope
key commitment; (2) R9 item 1 Solana layout version + fresh devnet program ID; (3) R9 item 2
`benzo xchain attest` asset from chain; (4) R9 item 3 EVM attest-once/release-many + forge
red/green; (5) R9 item 4 EVM `lock` nonReentrant + effects-before-transfer + forge proof;
(6) Sepolia redeploy + one live cycle per chain (lock → attest → release, plus one refund).
Baseline `npm run e2e` PASS 38–41 s at `dc5ea63`. No mainnet; no other-checkout writes; no
merge/rebase/cherry-pick/push.

1. **R10 item 1 (P2), envelope key commitment + exact recipient set: DONE** (`79aed9e`).
   `envelope/index.ts`: the `benzo-envelope-v2` header gains `key_commit = crypto_generichash(32,
   content_key, key = "benzo-envelope-v2-kc" zero-padded to libsodium's crypto_generichash_KEYBYTES
   (32))`, inside the AEAD associated data; `openEnvelope` recomputes it after unwrapping and
   refuses a mismatch (`refused: envelope key commitment`) before the body is tried. Wire format:
   `magic(17) ‖ n(1) ‖ n×(pk32‖sealed80) ‖ key_commit(32) ‖ nonce(12) ‖ body(528+16)` — 926 bytes
   (1852 hex) for n = 3. Exports: `envelopeRecipients(ct)` (stanza keys in order) and
   `ENVELOPE_CT_BYTES_N3 = 926`. `settle/envelopes.ts` (R10's sanctioned Track A one-liner):
   `ENVELOPE_CT_BYTES` is the exported n = 3 length, and `validEnvelope` returns null unless the
   stanza public keys are exactly the manifest's `envelope_keys` in order (a record that fails is
   "no valid owner-signed settlement envelope" → exception queue). `docs/AUDITS.md` libsodium row
   now says plainly the 2017 assessment covered **1.0.12/1.0.13 only** and the build bundled in
   `libsodium-wrappers` 0.8.4 is **libsodium 1.0.22** (`sodium_version_string()` at the pin).
   `tools/bench.ts` intake checks the exported length; `dist/benzo-verify.mjs` +
   `docs/verify-bundle.sha256` rebuilt.
   **Red on the pre-change module** — `tmp/proof-logs/kc-red.out` (exit 1) + `mr-red.out` (exit 1):
   `ERROR kc-api-exports envelopeRecipients not exported`,
   `ERROR kc-split-key-recipient2-commitment got "refused: envelope length", want "refused:
   envelope key commitment"` (the hand-built split-key envelope — stanza 2 wraps a different key
   under stanza 1's commitment), `ERROR kc-3of3-accepted validEnvelope returned null` (the
   positive control, showing the old validEnvelope (572-byte shape) can accept no product
   record). **Green after** — `tmp/proof-logs/kc-green.out` (9/9) + `mr-green.out` (6/6):
   `kc-split-key-recipient1-opens` + `kc-split-key-recipient2-commitment` (opens for recipient 1,
   refused `envelope key commitment` for recipient 2); `kc-1of3-refused`, `kc-2of3-refused`,
   `kc-reorder-refused`, `kc-wrongset-refused` (validEnvelope) with the `kc-3of3-accepted` control;
   all earlier envelope proofs pass (`mr-manifest-envelope-keys`, `mr-3keys-open`,
   `mr-4th-key-refused`, `mr-equal-lengths`, `mr-stanza-swap-refused`, `mr-verify` on a fresh
   tlock corpus with `bin/benzo verify` + two mutations). `npm run e2e` PASS (38–39 s),
   `npm run typecheck` PASS, bench generate+admission smoke PASS on the new length.
   Honesty notes: (a) two scratch-harness literals changed with the ruled format (mr-equal-lengths
   1852 hex; the stanza-swap's swapped-stanza owner is now refused at the commitment check and
   the other two at the body — each asserted with its specific error). (b) The R6 repro
   `routing-vs-envelope-repro.mjs` fixture was modernized to the pinned 3-key product shape (its
   1-key box is no longer a valid product record); its signer-boundary half passes (envelope
   destination wins over the coordinator substitute; missing envelope → null; init refuses
   unauthenticated routing) but its bundle-grep half ("settlement bundles containing
   envelope-opening code") **fails — provably pre-existing**: at the pre-change tree the three
   bundles contain 0 `openEnvelope` hits too (stash → rebuild → grep), because R7.2's interim
   removed the opening from the shipped path; A's R10 item 2 re-wires it and the grep will hit
   again. (c) `tools/repro/g1-tampered-ledger-redirect.mjs` and
   `g2-envelope-crash-not-exception.mjs` crash at `sealEnvelope`'s array check — stale old-API
   calls (`sealEnvelope(dest, pk)`) left behind by `b000cb1`, failing identically before my
   change; Track A's R6/R7 artifacts, not touched (see Questions).

2. **R9 item 1 (P1), no in-place upgrades across account-layout changes: DONE** (this commit).
   `contracts/solana/src/lib.rs`: `STATE_LEN` 235 → 236 with a `layout_version` byte at offset
   235 (`LAYOUT_VERSION = 2`; the pre-R9 235-byte layout is v1 and has no such byte), written by
   `store_state` and **checked on every instruction** before any field is interpreted:
   `load_state` (submit_attestation, release_approved, refund) refuses `BadLayout` (custom 0x14)
   on a mismatch, and `lock` checks it before "already locked". `crosschain/solana.ts`
   `parseAuctionState` refuses any other layout. Per the rule, the layout change ships under a
   **new program ID** on devnet — **`AE1LQwTyvPmjoTNdX2b7krH2yBejUgjnBdmGYpB9yna4`** (deploy tx
   `2op2hhMp8wDBtBzRRNoeEzS39uKzAgdCMPcn1VnDY8XJUx75yyASykdV7NH3JbHJ1jrYsRnFLmXC1c7cWzHEQqU7`,
   ProgramData `HxCEzNaJmjDn3oA9pMjshoctkr32iywgNAKdVMC1tFQm`, upgrade authority
   `3EM3LMNYrs2iUfC9FkoutJcErmuPd8zUtRBMCkhLkpdu`, Data Length 102,256, .so sha256
   `48870cc916a14af74995a56a82ac3520a58108fc4a95dca84dc86b7ea60c2673`; a forced
   `touch src/lib.rs && cargo build-sbf` rebuild reproduces that hash). **The old IDs
   `2Wh8X6dfqwYu45GAxYHW95VJEKjDxbhbANxTy9F7Lrt4` and `58SsWZaW2eBq1z1bnH1xPNXXMGbnrXm9YMvGeRdJL14G`
   are SUPERSEDED** — recorded here and in `docs/AUDITS.md` (new "Deployed escrow programs" table).
   Tests (`bash contracts/solana/test/run.sh`, driver):
   `layout-version-recorded-in-state` (the locked state is 236 bytes recording layout version 2)
   and `layout-v1-state-{lock,submit,release,refund}-refused` — a pre-R9 layout-v1 state account
   (written by the new `test/old-layout-account.mjs`, loaded at genesis with
   `solana-test-validator --account`, the only way to hand the program an account layout it did
   not write) is refused by **every** instruction with `BadLayout` 0x14.
   **Red on the pre-change program** — `contracts/logs/layout-old-code.out` (exit 1, 7 ERROR):
   `ERROR layout-version-recorded-in-state state len 235 layout byte undefined (want
   program-owned 236 with layout version 2)`,
   `ERROR layout-v1-state-lock-refused expected custom error 0x14, got 0x0`,
   `ERROR layout-v1-state-submit-refused expected custom error 0x14, got 0x6` (likewise release
   and refund): the old code reads a layout mismatch as "unknown auction" — or a raw allocate
   failure on lock — and cannot tell the two apart. **Green after** —
   `contracts/logs/layout-fixed.out` (exit 0): `RESULT PASS all Solana escrow assertions`,
   43 PASS / 0 ERROR (38 prior + the 5 new). `npm run typecheck` PASS.
   Harness defects found by these runs and fixed before the recorded green (both in the test
   driver, no product defect): (a) `send`/`sendV0` swallowed landed transaction errors —
   web3.js `confirmTransaction` resolves even when `value.err` is set — so a race lost
   `submit(11)` silently in 2 of 3 runs; they now throw on any landed error (fail loudly).
   (b) the fixture window `deadline = t0 + 40` put that submit's `expiry == deadline` (the F-2
   rule the tests exercise) on the clock boundary; widened to `t0 + 120` so the auction window
   outlives the sequence that runs before the refund section. The debug runs that located the
   race were scratch and are deleted; the recorded green is the rerun after both fixes.

3. **R9 item 2 (P2), `benzo xchain attest` takes the asset from the escrow state on chain:
   DONE** (this commit). The attest flow now reads the locked auction once (`evmStatus` /
   `solStatus`) for both the deadline (F-2) and the asset, binds every leaf to the **on-chain**
   asset, and refuses `--asset` that is missing or does not match it — no silent default:
   `--asset is required: the escrow's asset is <A> (read from chain); there is no default` and
   `--asset <X> does not match the escrow's asset <A> on chain`. On Solana the chain asset is
   the program's fixed native-SOL asset (ASSET_SOL = zero bytes). The help line marks `--asset`
   required on attest (lock's optional `--asset` is untouched — that is a lock parameter).
   Tests (`bash crosschain/local-demo.sh`, the shipped CLI on both local chains):
   `demo-attest-asset-missing-refused` and `demo-attest-asset-mismatch-refused` (missing and
   `0x1111…` mismatching `--asset` refused on both chains before any signing, specific messages
   asserted), with the real attestations now passing `--asset 0x000…0` and the rest of the demo
   unchanged (release delivers, status matches, replay refused, refund path).
   **Red on the pre-change CLI** — `contracts/logs/r9-2-asset-old-code.out` (exit 1):
   `ERROR demo-attest-asset-missing-refused evm rc=0 sol rc=0` and
   `ERROR demo-attest-asset-mismatch-refused evm rc=0 sol rc=0` — the old CLI silently minted
   wrong-root attestation bundles for both cases (exactly R9's finding). **Green after** —
   `contracts/logs/r9-2-asset-fixed.out` (exit 0): `RESULT PASS one cleared drop delivered end
   to end locally on both chains`, 15/15 demo assertions. `npm run typecheck` PASS.

4. **R9 item 3 (P2), EVM gets Solana's model: DONE** (this commit). `BenzoEscrow.sol`: the
   one-shot `release` is replaced by `submitAttestation(att, sigs)` — which verifies the 2-of-3
   EIP-712 attestations **once** per (auction, batch) with `expiry <= deadline` and stores the
   approved root (a second submit for the same batch is `BatchReplayed`) — and
   `releaseApproved(auctionId, batchIndex, payouts[])`, which pays against the stored approval,
   carries no signatures, and can be cranked any number of times: a partial or failed release
   never consumes the approval (per-recipient paid flags unchanged). `isBatchUsed` → `isApproved`;
   new `NoApproval` error and `AttestationApproved` event. Client + CLI mirror the Solana flow
   (`submit-if-needed`, `--submit-only` on both chains); `--only` is **labelled** in the help as
   the crank aid it now is ("the stored approval is never consumed and the rest stays payable") —
   kept because the crank needs subset releases (the Solana path always had it).
   Test (`contracts/evm/test/PartialRelease.t.sol`, the head's named forge test):
   `test_partial_release_then_remainder` — partial release of leaf 0, then the remainder (leaf 1)
   from the same batch: both recipients paid exactly once, both leaves flagged, escrow empty.
   The file drives the release step through raw calls so the same test compiles and runs against
   both contract generations.
   **Red on the pre-R9 contract** — `contracts/logs/r9-3-partial-old-code.out` (exit 1):
   `FAIL: remainder refused after a partial release (the batch must stay payable)` — the one-shot
   release consumed the batch at the partial call and stranded the remainder (R9's finding).
   **Green after** — `contracts/logs/r9-3-partial-fixed.out` (exit 0): 26/26 forge tests pass
   (20 BenzoEscrow + 1 PartialRelease + 2 FeeTokenDrain + 3 ReentrancyRepro — the whole suite was
   rewritten to the new API: quorum/expiry/replay refusals now assert on `submitAttestation`,
   leaf/root refusals on `releaseApproved`, and the P0 re-entrancy attack arms
   `releaseApproved` of an approved second batch). Integration: `crosschain/local-demo.sh` 15/15
   PASS (`contracts/logs/r9-3-demo.out`) — the shipped CLI locks, attests, releases (partial
   `--only 0` on EVM, `--only 1,2` on Solana), reports status, refuses a resubmitted batch on
   both chains (`demo-replay-refused`, now via `--submit-only`) and refunds. `npm run typecheck`
   PASS.

5. **R9 item 4 (P2), `lock` is `nonReentrant` with effects before the external call: DONE**
   (this commit). `BenzoEscrow.sol` `lock`: marked `nonReentrant` (OpenZeppelin `ReentrancyGuard`)
   and the whole auction state (`returnTo` first) is written **before** the fee-token calls the
   delta check requires; the delta check still measures around `safeTransferFrom` and reverts —
   rolling the writes back — unless the received balance grew by exactly `amount`, so the F5
   protection is unchanged (wherever the delta check allows, per the Ruling).
   Tests (`contracts/evm/test/LockReentry.t.sol`, a token whose hooks are the probes):
   `test_lock_effects_before_transfer` — the token's `balanceOf` (the escrow's first external
   call in `lock`) refuses unless the auction state is already written, so the lock landing at
   all proves effects-before-interactions; `test_lock_reentrancy_refused` — during `transferFrom`
   the escrow is called to lock a second (native, self-funded) auction and the inner lock must
   never land.
   **Red on the pre-fix contract** — `contracts/logs/r9-4-lock-old-code.out` (exit 1):
   `FAIL: StateNotWritten()` (a token callback observed an unwritten auction — the writes were
   after the calls) and `FAIL: re-entrant lock must be refused` (the re-entrant lock landed).
   **Green after** — `contracts/logs/r9-4-lock-fixed.out` (exit 0): 28/28 forge tests (26 prior
   + the 2 new). `npm run typecheck` PASS.

6. **Redeploy + one live cycle per chain (lock → attest → release, plus one refund): DONE**
   (this commit). Both cycles ran through the shipped `benzo xchain` CLI with my own keys
   (`$BNZ_STATE_DIR/{evm,solana,xchain-live}/`, never printed). Full transcript (public values
   only): `$BNZ_STATE_DIR/xchain-live/r9-cycle.out`.

   **Ethereum Sepolia** — escrow **`0x8d085193Cf762dD4F946BE48f609AaA2405bbe65`** (deploy tx
   `0xf48b8c7946a5a822cc94e2fab5b9fb5702e79ba5c4d644f9a7c2ef9e6d35379b`; the prior escrow
   `0x19887941cf9BbD967f3739034127924f937D48ad` is **SUPERSEDED**, recorded here and in
   `docs/AUDITS.md`). Auction `0x020b768d9156b4579133fae2c73577bb8d02463f74cb7309928db1e2861ea85a`
   (TestToken BNT `0xC64d247Db515870B12b0d1D1EFeC7C153a0371e6`, 2e18 locked, lot 1e18; dest
   `0xef450203B8D60AE5b87D51C3E5c98B99b3E43dff`, return `0x1A28Aa96dBE4610436206D5e4Be664B1CeDB8b31`):

   | what | value |
   |---|---|
   | mint 2 BNT / approve escrow | tx `0x8de243f732fa03dfe544f08cb61b8e09529cfc854136ec0a29026b0db78c89de` / `0x2bcdaeef64df0c97be20720b0c7c5bcb38076551080c3c40c7b8740774cd7d6e` |
   | lock 2e18 (lot 1e18) | tx `0x85c0c4958e60b7f3f4c0fabbaf1947c415eeca80455021308200531b31e19242` |
   | attest 2-of-3 (submitAttestation in the release tx) | root `0x5edec6bd2fbfe7c3c312167a24c498b55b2a9c74192918f2be883e32a9924a9c`, signers `0x7dc2aC34…f0dd` + `0x4A40a5CA…ce40`, expiry == deadline |
   | release (leaf 0: 1e18 to dest; submit-if-needed then `releaseApproved`) | tx `0x891af964cf160997c3366eb4423cf375819c4adfed9fb3f0ceefaca25293e749` |
   | refund remainder (1e18 to return, after the deadline) | tx `0x9e31d9f9b01e88e821bfc5b6b7178b951373c00852c65c5b0ac4b7117bbcfc5a` |

   Final read-back: `status` `paid 1000000000000000000, refunded true, locked 2000000000000000000`;
   escrow BNT balance **0**.

   **Solana devnet** — program **`AE1LQwTyvPmjoTNdX2b7krH2yBejUgjnBdmGYpB9yna4`** (the item-2
   layout-v2 deployment). Auction
   `0x20bb416be7bac351ac3c81f1de022457c6b133bbb6364297da90b460d51ee576` (escrow PDA
   `37J8LGjBoZUzvuupZ8aeLozxNQLnSeyLyyoTKFBjJg2M`; 0.02 SOL locked, lot 0.01 — small because the
   deployer holds 0.054 SOL, see Questions; dest `Gbp126vzNbCFdRCh3zgnEiHDGVkU9pamhg4kbvdwaZvJ`,
   return `5LiXLJbRuT5Lhc7YkqYHjgfotEabi9BbbabjymyYTRcX`):

   | what | value |
   |---|---|
   | lock 20000000 (lot 10000000) | tx `41943uAMojMdMuBxePNx4xNxxvL93f7rUN4QFzSxTWYARnHgiydknbk5xUFoKTimkewb36DwixJGcktoMJY3ViPa` |
   | attest 2-of-3 | root `0xbc991776f8bcff429f5337c04998afb07b7a2769f45af78f680d45c5f6850b1f`, signers `HHW9bhUG…Pqt` + `6QsPjH64…iFTD` |
   | submit_attestation | tx `4r3s1g1RgzuHFVmKUT3ThsDFEVQ7xDFkEpmpSSNpEC22PiirawKnHtaKHprUekHN8a5GFCqfHT87PRvTAU5GRySE` |
   | release_approved (leaf 0: 0.01 SOL to dest) | tx `31TJ8rg6JVKmBUnxmfkUWWt8eKWUF4ZqX1nw6dqLcvbBFVh2JbLQy6rrKbeZAmj41Cbhqw7SJGzQhF1UEQd6GBYo` (LUT create `5LDoFDG9…7ijK` / extend `4mjH9FT5…xscN`) |
   | refund remainder (0.01 SOL to return, after the deadline) | tx `31CwjJRecy3BZYbHHzwc7cT1v93y4AgeTnNYNpYhKiwkhxZrAJcXpJMPLs9r8G6WwTzMKqqQrDs7gL9JxqAupEa7` |

   Final read-back: `status` `paid 10000000, refunded true`; dest 10000000 lamports, return
   10000000 lamports.

   **Honesty notes (this run):** (a) First live attempt: the shared window (`lockUntil = start+90`)
   expired while the EVM half ran, and the Solana `lock` was correctly refused `LockClosed` 0x4
   (the recorded EVM half is that attempt — its lock → attest → release all landed and its refund
   is in the table). The window is now computed per chain. (b) Before that, the first EVM
   `submitAttestation` was refused `Quorum()` 0xc251aaa2: `xchain-live/evm-signers.json` was from
   an older run and did not match the key files (one attesting key was not in the locked set).
   The signer sets are now derived from the key files before locking; that attempt's auction
   `0xec6c723340e42385e583cba3b9ae80a91bacf43383bf5c62007afbd6f20e2a40` (2 BNT on the aborted
   escrow `0x33fCaEF5Ed40fc4E5f3833fDd50F34FBcB8A362d`) never paid anything and was refunded in
   full (tx `0x043a62f085e2fa0e7fcbf3f10ffc77432ed8f603d42920e32dc2360c853318fe`); that escrow
   is empty and unused. (c) The devnet public RPC rate-limited once mid-run (429s, retried and
   recovered). (d) Scratch drivers `tmp/live-cycle*.mjs` deleted at run end (key material stayed
   in `$BNZ_STATE_DIR`).

### Test audit (READY FOR MERGE)

Project E2E suite (the 8-test ceiling; 5 used) — untouched in this run, **R retain**:
`e2e/default` (seal in the browser, open with `tle` after R; assertion IDs unchanged; covered
seal/ code unchanged here — PASS 38–41 s at base `dc5ea63` and after item 1). Contract-level
proofs outside the ceiling, each red/green in this run where its covered code changed: the forge
suites (28 tests — PartialRelease + LockReentry own items 4–5 and were re-proven red/green;
BenzoEscrow/FeeTokenDrain/ReentrancyRepro **R retain**, rewritten to the new release API and
re-run green), the Solana driver suite (43 assertions — the 5 `layout-*` ones own item 2 and were
re-proven red/green; the rest **R retain** and green), the local two-chain demo (15 assertions —
`demo-attest-asset-*` own item 3, re-proven red/green; the rest **R retain** and green), and the
scratch envelope proofs (tmp/, not committed — item 1, red/green cited above).

### R22 (head P2 at `4254c7a`) — OPEN, next package for Track B

`xchain attest` must run the same checks as `benzo verify` on `--dir` (`checkPublicAuction`: frozen
root, gate-X witness certificates, the clearing recomputed through the registry) and refuse on any
ERROR, and require `--result` bytes to equal `--dir/result.json`; repro = a directory whose frozen
leaf set was swapped after the witnesses certified it (attested today, refused after).

Plan (not started when this run ended): (1) `attest` loads `loadCompletePublicAuction` +
`checkPublicAuction` (+ `deriveClaimOpenings`) and refuses on any check with `error`; (2) compare
`--result` bytes with `pub.resultBytes` exactly; (3) rework the demo fixture into a verify-green
directory and add the swapped-leaf-after-witness repro. **Fixture finding for the head (see Q6):**
`checkPublicAuction` requires the result to carry `manifest_hash` and `freeze_root`, `published_at <
T_freeze`, and the `clear` check recomputes the PRODUCT clearing through the registry — which the
cross-chain `winners[].leaf` result shape cannot satisfy. So either the cross-chain result shape
needs a ruling (extend `checkPublicAuction` to accept it) or the xchain fixture/result must be a
full product result and the `winners[]` branch of the leaf derivation drops.

### Questions (this run)

- **R6 repro residual (item 1 honesty note b):** `tools/repro/routing-vs-envelope-repro.mjs`'s
  bundle-grep half asserts that the shipped settlement bundles contain envelope-opening code;
  R7.2's interim (ENVELOPE_INTERIM_REFUSAL) deliberately removed it, so the assertion can only
  pass again after A's R10 item 2. I did not reshape it. Redirect if you want the assertion
  scoped to the interim.
- **Stale reviewer repros (item 1 honesty note c):** `g1-tampered-ledger-redirect.mjs` and
  `g2-envelope-crash-not-exception.mjs` call the old one-key `sealEnvelope(dest, pk)` API and
  crash since `b000cb1` (before my change; verified by their stack traces at the array check).
  They are Track A/R6 artifacts — want me to modernize their fixtures (same 3-key shape as the
  R6 repro), or is that A's?
- **Devnet funds are tight:** the deployer `3EM3LMN…` had 0.5756 SOL (swept from my own spent
  cycle keys) against ~0.568 SOL needed for the fresh ProgramData — the deploy landed, leaving
  0.0539 SOL. The devnet faucet is rate-limited (4 attempts failed across this run; same as the
  previous run). The item-6 live cycle will use a small auction that fits the remainder unless
  the faucet unblocks; a user airdrop to `3EM3LMNYrs2iUfC9FkoutJcErmuPd8zUtRBMCkhLkpdu` would
  restore comfortable margin (faucets are user-only per AGENTS).
- **Envelope key-commit padding:** R10's `key = "benzo-envelope-v2-kc" padded per libsodium` is
  implemented as the 19-byte ASCII label zero-padded to libsodium's `crypto_generichash_KEYBYTES`
  (32 bytes), documented in the code comment. Confirm or redirect.
  **CLOSED by the head's finding on 79aed9e (this run's item 3):** the label is 20 bytes and the code
  padded with `32 - 19`, so `KC_KEY` was 33 bytes; item 3 fixes it to `32 - label.length` with an
  assertion that the key is exactly `crypto_generichash_KEYBYTES`.

## Previous run: head task — R8 item 1 (G9 Solana state-PDA dust) + multi-recipient settlement envelopes (G9 accepted as `aaa0000`; envelopes `b000cb1` accepted in principle, its R10 item 1 follow-up is item 1 above)

State: **READY FOR MERGE** (both items landed with red/green proof; updated 2026-10-02T19:15Z).
Base: clean tree at `a732669` (head: merge main into track-b, R7/R8). One commit per item:
`e1b401b` (item 1, G9 + redeploy + live cycle) and this commit (item 2, multi-recipient
envelopes). Scope:
(1) PHASE-5 R8 item 1 — `contracts/solana/src/lib.rs` `lock` must stop treating "non-empty ⇒
locked" for the escrow state PDA (G9: 1 lamport to `["escrow", auction_id]` before lock blocked
the auction forever); add a dust-before-lock test (red on old code, green after); redeploy to
devnet and rerun the live cycle. (2) Multi-recipient settlement envelopes per
`docs/design/phase5-part1-live.md` §4 [B] (libsodium), the proofs the head listed, then READY
FOR MERGE. Read-only: the G probe
`~/Dev Projects/benzo-sol-g/tests/g4-solana-residuals.mjs` (its on-chain probe A).
No mainnet; no other-checkout writes; no merge/rebase/cherry-pick.

1. **R8 item 1 (P1 G9), a dusted escrow state PDA blocking the auction: FIXED** (this commit).
   `contracts/solana/src/lib.rs` `lock`: **locked means the program owns the account with
   `STATE_LEN` data** (`owner == program_id && data_len == STATE_LEN`), never lamports/empty
   data; the state PDA is now created **pre-funding-safe** exactly like `create_flag` —
   `create_account` for a fresh PDA, otherwise top up to rent-exempt + amount then `allocate` +
   `assign` via `invoke_signed` with the PDA seeds. A dusted PDA can neither block a lock nor
   fake one (a second lock is still `AlreadyLocked` 0x3).
   Test (`bash contracts/solana/test/run.sh`, driver): dust `auctionPda(dustId)` with 1,000,000
   lamports from an unrelated key, then lock — `escrow-pda-dusted-lock-succeeds` (lock lands and
   the PDA is program-owned 235 bytes recording the locked amount) and
   `escrow-pda-dusted-lock-twice-refused` (custom error 0x3).
   **Red on the unfixed program** — `contracts/logs/g9-escrow-dust-old-code.out` (exit 1):
   `ERROR escrow-pda-dusted-lock-succeeds lock after 1,000,000-lamport dust refused (0x3); state
   PDA owner 11111111111111111111111111111111 len 0 (want program-owned 235 recording the
   locked amount)` — exactly reviewer G's live probe. **Green after the fix** —
   `contracts/logs/g9-escrow-dust-fixed.out` (exit 0): `RESULT PASS all Solana escrow
   assertions`, 38 PASS / 0 ERROR (the same harness in both runs: the red was re-recorded after
   the test's amount was settled at 1 lot). `npm run typecheck` PASS (the typecheck scope does
   not cover `contracts/`; the Rust build is `cargo build-sbf` in the run).
   Harness note: `contracts/solana/test/run.sh` now pins `--gossip-port`/`--dynamic-port-range`
   off the RPC port — the co-located reviewer-lab validator holds default gossip :8000
   (`gossip_addr bind_to port 8000: Address already in use`), and the reviewer's process is not
   mine to touch. No product code affected.

   **Redeploy + live cycle on Solana devnet: DONE** (public values only; transcripts and keys in
   `$BNZ_STATE_DIR/xchain-live/`, never printed). Fresh program id per the head's "record the new
   program id": **`2Wh8X6dfqwYu45GAxYHW95VJEKjDxbhbANxTy9F7Lrt4`** (deploy tx
   `5wDqVt3ru7hRrPCZqtUxkExTKYG8Gp96kasRkeGEiqf4nYXuFD4eiW2Jbz658u8y4qncak4icfEnjjhr1bAvaYr1`,
   ProgramData `5ytcSLgwDQbH8BcPms2pRTEqx3fA2T2VUyVfrJ7Wu1Ld`, upgrade authority
   `3EM3LMNYrs2iUfC9FkoutJcErmuPd8zUtRBMCkhLkpdu`, 100,888 bytes, sha256
   `5caf323f…f86dc69a`). **The old deployment `58SsWZaW2eBq1z1bnH1xPNXXMGbnrXm9YMvGeRdJL14G`
   and all its cycle txids (run of 1e55df5) are SUPERSEDED.** Window: lockUntil 1790966630 /
   deadline 1790966990, attest `expiry == deadline` (F-2 rule).

   **G9 live (the finding itself):** dust tx
   `ijQr5qgQyc4vAxzHPxoUhgAzV45q252gPjUPGUHNxMzRPKGTjicGDTMQKHRK4bYpysacbyEzwp5afWgNQK8KPUS`
   sent 1,000,000 lamports from unrelated key `8maExbMMg6BhQxytoPZN8FzktNptPftvEQQqEk4CkNxo` to
   `GwyvHEhMF5U5ESwwkCbBPDWSxJzF3YkywXDY943U5HQn` (verified system-owned, 0.001 SOL before
   lock); auction `aad3016edf6879d6aabfa188dfe050678d2ad49cf0ebd96933318830736ca277` then
   **locked normally** — tx
   `5jLLhnT7kgW87WnvsbgNujpCXP5vxzRaGZKNCjkVMK5kZA4Y1q1bzueh9jMCwxEmQdChqb7CrnSj1cqAnrY5j8mg`,
   state recorded (`amount 300000000` in `xchain status`). On the pre-fix build the same probe
   was refused `0x3` (live repro below).

   **Live cycle (auction `5135574eef8e35a13c93ab52d642682ce2646ebca248c6bdd7d69767b9693747`,
   escrow PDA `4SYrBbkQLG6jw72q2eU9mso3njD4uGX4TF1uPkz6UMWU`, payout dest
   `GW3GB4dcCx66ZeVwGGX7WLtuVDsJxxQPT1bC4wFvg6BV`, return
   `22XRrnnVqdn1tgsbDS87PRLQ4QviEjn8hVYj5HPB9hng`; 0.4 SOL locked, lot 0.2):**

   | what | value |
   |---|---|
   | lock 400000000 (lot 200000000) | tx `rEkmqP1DURaAo1JkCkK1QHT3gZyjdwg9TMVnFFSdX6pDze7DvnakM62wW97NznAWWaUEmN4YKMH24EKB9XwrVwQ` |
   | attest 2-of-3 (root `0xfb63b2e13fd6bd7efd7bf0842c840f0f164edb5172e7b875d2a234661fe9a4e6`) | signers `Fkb3RZRvFbtkpGPYUtfdRtKg2e6jJoRgN9S74yriiFTD` + `6QsPjH64dn63S9ha6D1pFbkjzhmYTUKh2ndo2avX1zLS`, expiry == deadline |
   | `submit_attestation` | tx `5doH1yMxG3RRgQ9FTFEWSxaUhi21NuYWaoFzzh3z4TdJLGcRtYjG7ULsW8VPgEhYgi11YkQdxajHgVQQ7XSN5DwC` |
   | `release_approved` (leaf 0: 0.2 to dest) | tx `5dW4BoATjKg9yetdDL2iBXrCqDYVpfjiE6L5ybpFnRWtSnCDAMGs1e5uj3kLBiN4C11yA8baP1hwUoNyN9XBsAci` (lookup table `62VMtL2drB6qPtWfhFvSSj9NxQxSyNxEkU3A2aZaFBhB`) |
   | refund remainder (0.2 to return; chain time 1790967004 > deadline 1790966990 checked first) | tx `4abd9nTV63nE6iHUj4guk37jHWNsvQ3zS22PjQ11fJx67BGGrwf5k53DWXFYcuWVKj3QcpLvHPfxkEEwXAo8QGq7` |

   Final balances read back from the chain: dest 0.2, return 0.2, escrow PDA rent only (0.4
   principal = 0.2 paid + 0.2 refunded); `xchain status`: `refunded: true`, `paid: 200000000`,
   leaf `0x56984dc3…` true.

   **Honesty notes (this run):** (a) The first devnet deploy (tx `5wDqVt3r…`) carried a **stale
   `.so`** — it was built during the red re-record with `lib.rs` stashed — and the live probe
   caught it (dusted-PDA lock refused `0x3` at the new program id; log
   `$BNZ_STATE_DIR/xchain-live/g9-live.out`), which doubles as a **live G9 repro on the pre-fix
   build**. The fixed build was then redeployed in place (upgrade tx
   `Q1nfZLc5u2kJgFCRNm6VooUVxJ7B61zVUXR6LC7VkkGs26wWm4vXsc3s8rVXPHc7PdgsqJZmPsgx6KD8YAhHi7G`,
   same program id, sha256 `5caf323f…`) and the demo rerun on a fresh auction (above). (b) An
   earlier dust attempt **silently did not land** (`solana transfer` without
   `--allow-unfunded-recipient` skips an unfunded recipient; my grep swallowed it) — that
   attempt's "lock succeeded" proves nothing and is void; every dust above was verified on chain
   (`solana account`) before the lock. (c) A first attest used orphan key `sol-signer-0.key`
   (not in the locked signer set) and was correctly refused `Quorum` 0xc; re-attested with set
   members. (d) Amounts shrunk to 0.3/0.4 SOL (the fresh program's rent cost ~1.9 SOL of the
   deployer's 2.45; the devnet faucet rate-limited all airdrop attempts across ~10 tries, 2 SOL
   down to 0.25). (e) A dusted PDA's lamports are absorbed into the `rent + amount` top-up
   target (the dust subsidises the lock; it can never block it or inflate `amount`). (f) The
   fresh program id answers this run's open question (in-place at `58Ss…` last time).

2. **Multi-recipient settlement envelopes (§4 [B]): DONE** (this commit). `envelope/index.ts`
   replaces the single-key sealed box with the §4 format: a random 32-byte **content key**
   (`sodium.randombytes_buf`) encrypts the fixed 512-byte length-prefixed padded plaintext
   (ChaCha20-Poly1305 IETF); the content key is wrapped to **each recipient's X25519 public key
   in its own stanza** (`crypto_box_seal`, 32-byte pk ‖ 80-byte sealed key); `owner_sig` and the
   salted `settlement_commitment` cover the whole envelope (unchanged binding code — it hashes
   the entire `envelope_ct`); `openEnvelope(env, privateKey)` opens with any one recipient key.
   Bytes: `"benzo-envelope-v2" (17) ‖ n (1..3) ‖ n × (pk 32 ‖ sealed 80) ‖ nonce 12 ‖ body 528` —
   894 bytes (1788 hex) for the production 3-key set, every envelope the same length. The header
   (magic ‖ n ‖ stanzas) is the AEAD **associated data**, so a stanza splice breaks every
   recipient's open (the same binding age applies to its header MAC). The recipient set is the
   signed manifest's `envelope_keys: [hex, hex, hex]` — accepted as an optional field by
   `manifest/schema.ts` (exactly 3 distinct 64-hex keys, minimal change) and taken by
   `prepareBid({envelope_public_hexs})`. **Audited-first (user rule):** all cryptography is
   **libsodium** (`libsodium-wrappers` pinned `0.8.4`, `crypto_box_seal` per stanza,
   `crypto_aead_chacha20poly1305_ietf` body, `crypto_box_keypair`/`crypto_scalarmult_base`
   keygen — the wrapper's positional `(ct, pk, sk)` API inspected at the pin); no hand-written
   key derivation. Recorded in `docs/AUDITS.md` (audit: "Libsodium v1.0.12 and v1.0.13 Security
   Assessment", Dr. Matthew Green, Cryptography Engineering LLC, 2017, funded by PIA) together
   with custom-code rows for `envelope/index.ts` (framing only) and `envelope/destination.ts`
   (still the known mainnet blocker). Key files (`tools/bench.ts` intake shape, the R6
   `tools/repro/routing-vs-envelope-repro.mjs` one-key call) updated to the new API.

   **Red on the old single-key module** — `tmp/proof-logs/mr-old-code.out` (exit 1, same proof
   harness as the green, rebuilt from the stashed old tree):
   `ERROR mr-manifest-envelope-keys refused: unknown or missing manifest field`,
   `ERROR mr-3keys-open refused: key/signature hex`,
   `ERROR mr-4th-key-refused got "refused: envelope length", want "refused: envelope recipient"`,
   `ERROR mr-equal-lengths refused: key/signature hex`,
   `ERROR mr-stanza-swap-refused got "refused: envelope length", want "refused: envelope body"`,
   `ERROR mr-verify refused: envelope public key` — the old format cannot produce or verify a
   multi-recipient envelope at all. **Green after** — `tmp/proof-logs/mr-fixed.out` (exit 0):
   `PASS mr-manifest-envelope-keys` (signed manifest accepts `envelope_keys`, refuses 4 keys and
   duplicates), `PASS mr-3keys-open` (one envelope opens to the same destination with each of the
   3 keys), `PASS mr-4th-key-refused` (a 4th key: `refused: envelope recipient`),
   `PASS mr-equal-lengths` (Sapling 88-char vs UA 110-char destinations: all ciphertexts 1788
   hex), `PASS mr-stanza-swap-refused` (recipient 0's whole stanza swapped from another envelope
   to the same key set: `refused: envelope body` for **all three** keys), `PASS mr-verify`
   (fresh `tmp/canon-mr` corpus — real tlock at quicknet round via the pinned `tle`, 3-recipient
   envelopes from `prepareBid`, manifest with `envelope_keys` — `bin/benzo verify` exit 0 with
   `envelope` OK; flipped `owner_sig` → exit 1 `envelope 0 signature`; `envelope_ct` swapped
   between records → exit 1 `envelope 0 signature`). Signer-side open with each key recovers all
   destinations and none appear in the public artifacts.
   Cross-checks at the final tree: `npm run typecheck` PASS, `npm run build:core|cli|verify|settle`
   clean (the shipped `dist/benzo-verify.mjs` + `docs/verify-bundle.sha256` rebuilt and committed
   here), `npm run e2e` PASS (39 s), and the R6 repro `node tools/repro/routing-vs-envelope-repro.mjs`
   still ends `F3 FIXED … signers derive destinations only from owner-signed envelopes` on the new
   format. `npm run e2e:live` (cli-auction) was **not run in this run** — outside the head's proof
   list; its `bid seal` call site is behavior-identical through the transition (below) and A's
   R8-style regression covers it.
   Honesty notes: (a) the first red attempt had a harness defect (`execFileSync` unimported —
   `mr-verify` errored on the script, not on old code) and the second forgot to re-bundle the
   proof inside the stash window (checks 1–4 ran against bundled new code); both were discarded
   and the recorded red is the final-harness rerun. (b) The first green run's `mr-equal-lengths`
   literal was my own arithmetic slip (798 vs the real 894 bytes — stanza is pk 32 + sealed 80),
   and the first swap mutation swapped only 80 of 112 stanza bytes / swapped whole records
   instead of `envelope_ct` fields; the checks were fixed before the recorded runs — the format
   code never changed to make a check pass. (c) `sealEnvelope` accepts 1–3 distinct recipients
   (the production set is exactly the manifest's 3; constant length holds per recipient set).

**Test audit (READY FOR MERGE):** project E2E suite untouched — default seal-open **R retain**
(`npm run e2e` PASS 39 s at the final tree). `contracts/` forge + Solana driver suites are the
design §7 step-1/step-2 contract-level proofs (outside the 8-test E2E ceiling); item 1's two
driver assertions (`escrow-pda-dusted-lock-succeeds`, `escrow-pda-dusted-lock-twice-refused`)
own the G9 behaviour and were re-proven red/green in this run (the covered code changed since any
prior mutation run — this IS its first). Item 2 adds no specs (R11 convention); its proofs are
scratch `tmp/` scripts cited above. Env: no new env vars. Upstream code: none copied (pinned
libsodium API inspected at the installed 0.8.4).

### R22 (head P2 at `4254c7a`) — OPEN, next package for Track B

`xchain attest` must run the same checks as `benzo verify` on `--dir` (`checkPublicAuction`: frozen
root, gate-X witness certificates, the clearing recomputed through the registry) and refuse on any
ERROR, and require `--result` bytes to equal `--dir/result.json`; repro = a directory whose frozen
leaf set was swapped after the witnesses certified it (attested today, refused after).

Plan (not started when this run ended): (1) `attest` loads `loadCompletePublicAuction` +
`checkPublicAuction` (+ `deriveClaimOpenings`) and refuses on any check with `error`; (2) compare
`--result` bytes with `pub.resultBytes` exactly; (3) rework the demo fixture into a verify-green
directory and add the swapped-leaf-after-witness repro. **Fixture finding for the head (see Q6):**
`checkPublicAuction` requires the result to carry `manifest_hash` and `freeze_root`, `published_at <
T_freeze`, and the `clear` check recomputes the PRODUCT clearing through the registry — which the
cross-chain `winners[].leaf` result shape cannot satisfy. So either the cross-chain result shape
needs a ruling (extend `checkPublicAuction` to accept it) or the xchain fixture/result must be a
full product result and the `winners[]` branch of the leaf derivation drops.

### Questions (this run)

- **`bid seal` call site (Track A's R7 item 2 wiring):** per design §8 step 4 A wires
  `bid seal --refund` to the pinned keys. The shipped call site (`cli/product.ts` bid-seal
  block) still passes `[bid.envelope_pubkey]` — behavior-preserving through the new format
  (1-stanza envelopes open with the product key as before). Switching to `m.envelope_keys` is
  one line there once the signers' key ceremony exists; `prepareBid`/`sealEnvelope` already take
  that set and the manifest field is in. Redirect if you want that line moved in this run.
- **Envelope format choice:** the stanza region is bound as AEAD associated data (age's header
  binding), so ANY stanza splice is refused for every recipient (`refused: envelope body`), not
  just for the spliced stanza's owner. Stricter than the sketch; confirm or redirect.
- **AUDITS.md gap (pre-existing):** the custom-code table had no rows for `settle/`, `clear/`,
  `api/`, `manifest/`, `witness/` (all custom, all touching settlement/encodings under the
  audited-first rule). I added the `envelope/` rows my work touches; want the rest listed too?

## Previous run: head task — crosschain §10 fixes for Reviewer R's BLOCK (F-1…F-5) + redeploy

State: **READY FOR MERGE** (updated 2026-10-02T18:20Z). Base: clean tree at `e1851c5` (head: merge
main into track-b, crosschain §10). One commit per item: `d9a81c7` (item 1, F-1), `4a1e835`
(item 2, F-2), `ef5922e` (item 3, F-3), `56f2cbc` (item 4, F-4), `158ea08` (item 5, F-5), and
this STATUS commit (redeploy + live cycle). Every fix has a red log on the pre-fix code and a
green log on the fix (below). Scope: `docs/design/crosschain.md` §10 items 1–5 in order, then
redeploy both escrows and rerun lock → attest → release → refund on each. Reviewer report
(read-only): `~/Dev Projects/benzo-sol/reports/pr-b-f5-solana9.md`; its lab probes in
`~/Dev Projects/benzo-sol/tests/`. No other-checkout access beyond those read-only
files, no merges/rebase/cherry-pick/push, no mainnet. Baseline `npm run e2e` PASS 37 s at `e1851c5`;
final rerun PASS 38 s at the READY-FOR-MERGE tree.

1. **§10 item 1 (P0 F-1), a dusted `paid` PDA read as "already paid": FIXED** (this commit).
   `contracts/solana/src/lib.rs`: a paid flag counts only if the account is **program-owned with
   the `PAID_V1` marker** (`flag_is_set`); flag accounts are created **pre-funding-safe**
   (`create_flag`): `create_account` for a fresh PDA, otherwise top up to rent-exempt then
   `allocate` + `assign` via `invoke_signed` with the PDA seeds. `crosschain/solana.ts`
   `solStatus` now applies the same rule (a dusted PDA is never "paid").
   Test (`bash contracts/solana/test/run.sh`, driver): dust `paidPda(leafA)` with 900,000 lamports
   from an unrelated key, then crank — `paid-pda-dusted-payout-still-made-once` (rA and rB each
   paid exactly 1 lot despite the dust; flag program-owned `PAID_V1`),
   `paid-pda-dusted-paid-exactly-once` (re-presenting both leaves pays nothing again), then after
   the deadline `paid-pda-dusted-refund-omits-paid-lot` (3 lots locked, 2 paid: the refund returns
   exactly the 1 unpaid lot, never the attested lots).
   **Red on the unfixed program** — `contracts/logs/f1-paid-pda-dust-old-code.out` (exit 1):
   `ERROR paid-pda-dusted-payout-still-made-once rA +0 (want 1000000000 despite the dust), rB
   +1000000000 …, flag owner 11111111111111111111111111111111 data  (want program-owned
   PAID_V1)` and `ERROR paid-pda-dusted-refund-omits-paid-lot refund returned 2000000000, want
   the 1 unpaid lot …` — exactly reviewer F-1 (silent skip, then the refund pays rA's lot to the
   locker). **Green after the fix** — `contracts/logs/f1-paid-pda-dust-fixed.out` (exit 0):
   `RESULT PASS all Solana escrow assertions`, 28 PASS / 0 ERROR. `npm run typecheck` PASS.
   Note: the runtime refuses any dust below the 0-byte rent-exempt minimum (890,880 lamports —
   seen once as `insufficient funds for rent` before the amount was corrected), so a real dust is
   ≥ that; 900,000 also sits below the 7-byte flag's rent need, exercising the top-up path.

2. **§10 item 2 (P0 F-2), refund racing attested payouts: FIXED** (this commit). `att.expiry <=
   auction.deadline` is now enforced where an attestation is accepted — Solana
   `submit_attestation` (`BadParameters` 5) and EVM `release` (`BadParameters`) — and
   `benzo xchain attest` refuses `--expiry` past the auction's deadline read from chain before any
   signing ("signers must attest expiry <= deadline"). With `refund` requiring `now > deadline`,
   the release and refund windows are disjoint by construction.
   Tests. Solana (`contracts/logs/f2-expiry-solana-*.out`): `submit-expiry-after-deadline-refused`
   (error 5), plus the by-construction assertions `approval-expiry-not-after-deadline` (the stored
   approval's expiry ≤ the auction's deadline, read from chain),
   `approved-unreleased-refund-premature-refused` (error 16 before the deadline),
   `approved-unreleased-release-expired-when-refund-opens` (error 8 once `now > deadline >=
   expiry`) and `refund-only-after-approval-expired` (the refund returns the whole unpaid lot only
   after the expiry has passed). EVM (`contracts/logs/f2-expiry-evm-*.out`):
   `test_release_expiry_after_deadline_refused` (BadParameters) and
   `test_refund_only_after_attested_window_closed` (an attested but unreleased batch: refund
   refused before the deadline, release Expired after it, then the refund returns the unspent
   amount). Signer tool: `contracts/logs/f2-cli-attest-refusal.out` — the local demo's new
   `demo-attest-expiry-past-deadline-refused` shows both chains' `attest` refusing
   `--expiry deadline+10` with `must be <= the auction deadline` before signing (13/13 demo PASS).
   **Red on the current code** — `f2-expiry-solana-old-code.out`:
   `ERROR submit-expiry-after-deadline-refused expected custom error 0x5, transaction succeeded`
   (1 failed / 32 passed) and `f2-expiry-evm-old-code.out`:
   `[FAIL: next call did not revert as expected] test_release_expiry_after_deadline_refused()`
   (23 passed / 1 failed). **Green after the fix** — `f2-expiry-solana-fixed.out` (exit 0, 33 PASS
   / 0 ERROR) and `f2-expiry-evm-fixed.out` (24 passed / 0 failed). `npm run typecheck` PASS.
   Note: a first draft of the EVM window test tripped Foundry's `expectRevert` (the test helper's
   `signRelease` externally calls `domainSeparator()`, consuming the expectation) — a harness
   defect in my test, fixed before the red was recorded; no product defect hidden.

3. **§10 item 3 (P1 F-3), a dusted `Approval` PDA blocking a batch: FIXED** (this commit). The
   `Approval` PDA now carries the `APPROVAL_V1` marker (11-byte prefix; `APPROVAL_LEN` 153 → 164,
   §9 field offsets +11) and is created pre-funding-safe (`create_flag`: top up to rent-exempt +
   `allocate` + `assign` via `invoke_signed` when the PDA is dusted, `create_account` otherwise).
   `BatchReplayed` (9) is returned only when the account is program-owned with the marker
   (`flag_is_set`); a dusted PDA neither blocks nor fakes a batch. Client: `crosschain/solana.ts`
   exports `approvalExists` (same rule) and `benzo xchain release` uses it for submit-if-needed —
   a dusted PDA no longer makes the CLI skip the submit step.
   Test (driver): dust `approvalPda(batch 13)` with 1,000,000 lamports from an unrelated key,
   then `approval-pda-dusted-submit-works-once` (submit lands; the PDA is program-owned 164 bytes
   with `APPROVAL_V1` and the exact §9 fields) and
   `approval-pda-dusted-second-submit-refused` (error 9); `submit-2of3-records-approval` now
   asserts the marker + shifted offsets.
   **Red on the current code** — `contracts/logs/f3-approval-dust-old-code.out` (exit 1):
   `ERROR approval-pda-dusted-submit-works-once submit refused (0x9); dusted Approval PDA owner
   11111111111111111111111111111111 len 0 …` — exactly reviewer F-3 — plus the three
   layout-reading assertions (`submit-2of3-records-approval`, `approval-expiry-not-after-deadline`,
   `refund-only-after-approval-expired`) failing against the old 153-byte layout, as expected.
   **Green after the fix** — `contracts/logs/f3-approval-dust-fixed.out` (exit 0): 35 PASS /
   0 ERROR; `contracts/logs/f3-xchain-client.out`: local demo 13/13 PASS with the marker-aware
   client (release submit-if-needed, status, replay refused). `npm run typecheck` PASS.
   Notes: two mid-fix defects in my own new code were caught by these runs and fixed before any
   green was credited — `create_flag` first allocated `marker.len()` bytes (BadAccount 0x2 at
   `store_approval` for the 164-byte Approval), then `flag_is_set` compared the whole data to the
   marker (false for `marker + fields`, which made a second submit slip through to a system
   `allocate` and fail 0x0 instead of `BatchReplayed` 9). The final green is the rerun after both.

4. **§10 item 4 (P1 F-4), TS client + CLI seed/wire encodings: CONFIRMED matching + proved
   end-to-end.** No fix was needed in this run: the client was already ported to the §9
   instructions in `f72a792` (which post-dates the reviewer's range `7e3ac29..3a23f15`, so probe D
   measured the pre-port client). Confirmation against the program source, byte for byte:

   | encoding | client | program |
   |---|---|---|
   | auction PDA `["escrow", auction_id]` | `crosschain/solana.ts:34-36` | `lib.rs:464-465` |
   | approval PDA `["approval", auction_id, batch_index u64 le]` | `solana.ts:38-40` (`le64(batch)`) | `lib.rs:600-601` (submit), `:726-727` (release self-binding) |
   | paid PDA `["paid", auction_id, leaf]` | `solana.ts:53-55` | `lib.rs:768-769` |
   | submit wire `TAG 2 ‖ att(200)` | `solana.ts:113-125` | `lib.rs:411`, `:553-554` (`r.take(ATT_LEN)` then `r.end()`) |
   | release wire `TAG 4 ‖ be16(n) ‖ per payout: be64 index, be64 lots, u8 kind, dest32, be64 leafCount, be16 proofLen, proof×32` | `solana.ts:130-153` | `lib.rs:413`, `:678`, `:706` |
   | account order submit: crank, auction, instructions-sysvar, approval, system | `solana.ts:116-122` | `lib.rs` `submit_attestation` |
   | account order release: crank, auction, approval, system, then (dest, paid) per payout | `solana.ts:143-151` | `lib.rs` `release_approved` |
   | attestation 200 bytes (prefix ‖ genesis ‖ program ‖ auction ‖ result ‖ root ‖ be64 batch ‖ be64 nonce ‖ i64be expiry) | `crosschain/attestation.ts` `solanaAttestationBytes` | `lib.rs:553-567` (batch parsed be at `:567`, then seeded le at `:601`) |
   | ed25519 message ref (ix 1, offset 2, size 200) | `solana.ts:92` | `lib.rs:864` |

   The reviewer's exact F-4 point — the old client seeded `batch_index` be in the PDA while the
   program derives it le — is now `le64` on the client side, matching `to_le_bytes()`.
   Proof. **Red (pre-fix wire format)** — `contracts/logs/f4-wire-layout-refused.out`:
   `PASS legacy-client-release-refused` — the exact `3a23f15` client serialization
   (`TAG(2) ‖ att ‖ be16(n) ‖ payouts…`, be64 `batch` PDA) is refused with custom error 0x1
   (BadInstruction), reproducing probe D's `PASS D … (error 1)` on this program build (36 PASS /
   0 ERROR overall). **Green (shipped client)** — `contracts/logs/f4-cli-e2e-release.out`:
   `crosschain/local-demo.sh` 13/13 PASS — end-to-end through the shipped `benzo xchain` CLI on
   the local validator (lock, attest, `release` with real payouts and exact balance deltas,
   `status` matches the attested root, replay refused), incl. `demo-release-solana-delivers`.
   The pre-fix failure of the shipped entry point is also recorded in the review itself (probe D
   in `benzo-sol/reports/pr-b-f5-solana9.md`); the post-port client was additionally proven live
   on devnet in the prior run (release tx `5TWQxz2C…`).

5. **§10 item 5 (P2 F-5), the real two-auction drain test + AUDITS wording: DONE** (this commit).
   `contracts/evm/test/FeeTokenDrain.t.sol` rewritten to exercise the pooled-drain scenario its
   header names: two auctions share one holder-tax fee token (the STA class — 10% on transfers
   from taxed holders); the victim's funding behaves plainly (1000 nominal = 1000 real), the
   attacker is taxed (1000 nominal = 900 real — the r-02 scenario), and the attacker chooses
   their own signer set at lock and self-signs a 1000-nominal leaf to themselves. The gate is the
   victim staying whole: their recipient is paid in full from the pooled balance, with the
   measured drain (attacker recipient / escrow pool) printed on failure. The lock-revert check is
   kept as `test_lock_refuses_fee_on_transfer_token`.
   **Red at the drain (the F5 check mutated out — pre-`d566d0c` behavior)** —
   `contracts/logs/f5-drain-old-code.out`: `[FAIL: victim's recipient must be paid in full from
   the pool (measured: attacker recipient 1000, escrow pool 900): 0 != 1000]
   test_fee_on_transfer_token_drains_victim_auction()` — the attacker's nominal payout consumed
   the victim's funding and the victim's payout could not complete (23 passed / 2 failed; the
   second failure is the revert check, correctly red without the check). Mutation: the
   `balanceBefore/balanceAfter` measurement in `BenzoEscrow.sol` `lock` was replaced by a bare
   `safeTransferFrom` (exactly `d566d0c^` behavior), then restored byte-identical (`git diff` on
   the file is empty). **Green on the fixed contract** — `contracts/logs/f5-drain-fixed.out`:
   25 passed / 0 failed. `docs/AUDITS.md` no longer overclaims: the delta check stops
   fee-on-transfer **at lock**; tokens that behave plainly at lock and deflate later
   (rebase-down / fee-on-out) are excluded by the manifest asset allowlist, not by the check
   (the two mechanisms are now listed separately, with their blind spots named).

6. **Redeploy + live cycle (head task): DONE.** Both escrows redeployed from the deployer keys
   (`.benzo/evm/deployer.key` = `0xb6c51a0C7DF1fdcd64adf4eAEa37E1C51eb8Afc1`,
   `.benzo/solana/deployer.json` = `3EM3LMNYrs2iUfC9FkoutJcErmuPd8zUtRBMCkhLkpdu`; keys used by
   the deploy/cycle commands only, never printed) and **lock → attest → release → refund** rerun
   once on each testnet at the fixed code. All values below are public; scratch deploy scripts
   were deleted at run end (the deploy is reproducible from the forge artifacts with an ethers
   `ContractFactory` over the key file, or verified from the txids). Window on both chains:
   lockUntil 1790960797 / deadline 1790960977, attest `expiry == deadline` (the new F-2 rule).

   **Ethereum Sepolia** (auction `0x1a74d880f23c44b2a31d26b0c0ce2358f22aeb975b0da841ee1f7847354f36ce`,
   allocation root `0x3aef41b7001fc294e30b87ae93ae00592e16300e7f820a555fb572b7b0524617`,
   payout dest `0x4C53f540ba635BA7211E073E9a08960Bc4f25953`, return
   `0x3372A2C711f5aD17BB68b60188b4e68a12920184`):

   | what | value |
   |---|---|
   | `TestToken` BNT (constructor mints 1000e18) | `0xC64d247Db515870B12b0d1D1EFeC7C153a0371e6` (deploy tx `0xa3d31a64daf324061f264d46d122ff07ed6267227714e0e3ed9120e6d0e81553`, block 11830344) |
   | `BenzoEscrow` (fixed code) | `0x19887941cf9BbD967f3739034127924f937D48ad` (deploy tx `0xd0d8b3c285df848fb520726d79264c17f4ffd8022ec10b78d2d65fde0a106cd5`, block 11830345) |
   | approve escrow 2e18 | tx `0xc62c60799597fb8c9dc129c317f38ad68bc540b29e84c2fdd8d64d5fb5932f24` |
   | lock 2e18 (lot 1e18) | tx `0xade01dc8387db878f8823ee2e79a4ddf9e351412232a64dde58755337ef05302` |
   | attest 2-of-3 (bundle `tmp/xchain-live/bundle-evm.json`) | root `0x3aef41b7…` |
   | release (leaf 0: 1e18 to the dest) | tx `0xfec1464c5e7f6c6091454a2393cacec8dd015db210da3e755817773e175715bc` |
   | refund remainder (1e18 to returnTo) | tx `0xab00357e69773d1c0899369334cc25c600f7847c9cb28e0b1e544451fd853d83` |

   `xchain status` after release: `locked 2000000000000000000, paid 1000000000000000000`, paidLeaves
   1/2. Final balances read back from the chain: dest 1e18, returnTo 1e18, escrow 0.

   **Solana devnet** (program `58SsWZaW2eBq1z1bnH1xPNXXMGbnrXm9YMvGeRdJL14G`, auction
   `0x059a9d681e584c902cc4973e1b44db072745dc052ae2fb419676385cba63bb16`, escrow PDA
   `2Yv5ac9KxhA5N3mzGTQ9cktPCLu9s5Fg41spBTAui1zP`, approval PDA
   `CvDwE4sT814VZSy19BXSoECrjHnS14xC7PhWktXmirjC`, payout dest `EN4dQuJjDZisc1Y2uxde9JwdMaFXsrDiYGkeQquSH4qh`,
   return `7yApc8X4vEbR841Y7AMGodKdf9ybGoTFTkVXdqtaaTxo`):

   | what | value |
   |---|---|
   | program redeploy (fixed code; see note a) | tx `5goExevMeEbJaV4kBdb4tBVJ3wQNbRf62UEycKVUBawdVNXn21Dsp8wwNpzfoL4oRCHTAEoscoJJmhB8TgCPVoYr` (`solana program show`: Authority `3EM3LMN…`, Last Deployed In Slot 506705023) |
   | lock 2 SOL (lot 1 SOL) | tx `dW18NB2AZxTewoCkSrdNfdA3yFcLo9Quvg5eFEAgjKwW8GomqmyEbkaTiqFaBdwspFwyD2jL32LLRYHtKrukEot` |
   | `submit_attestation` (Approval created) | tx `2eqzoYkPjbkei5e3scEcyyGHbGALzLSzav3tYCLHUq2jNR5jTTSGKEebYvBS48LiDGsgywPebbGCmX1psKYGQgvb` |
   | `release_approved` (leaf 0: 1 SOL to the dest) | tx `1weyiLBNKd5w9WncC2CzpoMHHHjg3d8nxeYsFTdY6KR6w4iwJDjHRyV7K4pGX8BfPMa4M6TbAo9a1HqzYvYY4Zz` (lookup table `86M84CKbNf9Yh17dUrekwx5AsBEaBsqFBvbCbCJmiL61`, create `EnmwN9bAZgCn27hoLCzzF775aUCEqrFm1ZmeVdJp8AkG1ppE4EwhML477mjXncvejytTmqWRAeLNMawcWEbfeXH`, extend `2FnBocHU3g71W3oEiiVrbUJL7Kgz4mt897JnLqTkPB59JG62UVPfzwC87YV8Xb91RfNrG1a1uRkgtLdQvwU6ShKz`) |
   | refund remainder (1 SOL to return) | tx `38uhMgjLPyLexLcisbeGHgRdGYyVKtcoHQgrZ99mHfNbMP7pkfn5K9Xio6CW6pWCneeaNdpXg8WJXvox6shqJn1G` |

   `xchain status` after release: `amount 2000000000, paid 1000000000`, paidLeaves 1/2
   (marker-aware). Final balances read back from the chain: dest 1 SOL, return 1 SOL, escrow PDA
   rent only (the 2-SOL principal = 1 paid + 1 refunded).

   **F-1 client rule checked live on devnet:** dust tx
   `5LU7QyxpAXy6Yeiq1RBvnZHL5h6wyGzuxav1QCgXCvrKgxDHNDcoi5xVG8x3C35vgkTKZs2qb6WaNtXvcAgbJcKc`
   sent 2,000,000 lamports to `Gj2KzjQtwgjcYGU8yyJSZpGjvjEq1snJvVzwfgw2ehPf` =
   `paidPda(leaf 1)` (the unpaid leaf); the account is system-owned with empty data and
   `benzo xchain status` still reports that leaf **false** — a dusted PDA is never `PAID_V1`
   (the pre-fix client rule would have reported it paid).

   **Honesty notes (this run):** (a) the Solana redeploy landed as an **in-place upgrade** of the
   same program id `58Ss…` — `solana program deploy` without `--program-id` reuses the `.so`'s
   sibling keypair, and the deployer `3EM3LMN…` is the upgrade authority (verified via
   `solana program show`), so no old program build remains at that address; the **old run's
   deployment state is superseded** (its auction/escrow PDA `2ChFfike…` / approval `85Tf51q…` vs
   this run's `2Yv5ac9K…` / `CvDwE4sT…`). Say the word if a fresh program id was wanted instead.
   (b) The bounded deadline poll hit its cap because of a scratch bug (it queried `getBlockTime`
   for slot 0 — a 2020 timestamp); before the refunds were sent, both deadlines were explicitly
   re-checked (EVM latest-block timestamp and Solana tip blockTime 1790961868 > 1790960977) and
   only then did the refund transactions run. (c) The `--expiry` is `== deadline` on both chains,
   exercising the new F-2 signer-tool rule. (d) The 2,000,000-lamport dust stays on devnet at
   `Gj2KzjQ…` (public artifact of the F-1 check).

**Test audit (READY FOR MERGE):** project E2E suite untouched — default seal-open **R retain**
(browser/tle assertion IDs unchanged; PASS 37 s at base `e1851c5`, PASS 38 s at the final tree).
The `contracts/` forge + Solana driver suites are the design §7 step-1/step-2 contract-level
proofs (outside the 8-test E2E ceiling); each named red/green pair above is its mutation-style
proof, all rerun in this run since the covered code changed. `npm run typecheck` PASS. Env: no
new env vars. Upstream code: none copied (pinned APIs inspected in installed sources).

### R22 (head P2 at `4254c7a`) — OPEN, next package for Track B

`xchain attest` must run the same checks as `benzo verify` on `--dir` (`checkPublicAuction`: frozen
root, gate-X witness certificates, the clearing recomputed through the registry) and refuse on any
ERROR, and require `--result` bytes to equal `--dir/result.json`; repro = a directory whose frozen
leaf set was swapped after the witnesses certified it (attested today, refused after).

Plan (not started when this run ended): (1) `attest` loads `loadCompletePublicAuction` +
`checkPublicAuction` (+ `deriveClaimOpenings`) and refuses on any check with `error`; (2) compare
`--result` bytes with `pub.resultBytes` exactly; (3) rework the demo fixture into a verify-green
directory and add the swapped-leaf-after-witness repro. **Fixture finding for the head (see Q6):**
`checkPublicAuction` requires the result to carry `manifest_hash` and `freeze_root`, `published_at <
T_freeze`, and the `clear` check recomputes the PRODUCT clearing through the registry — which the
cross-chain `winners[].leaf` result shape cannot satisfy. So either the cross-chain result shape
needs a ruling (extend `checkPublicAuction` to accept it) or the xchain fixture/result must be a
full product result and the `winners[]` branch of the leaf derivation drops.

### Questions (this run)

- **F-4 needed no code fix** — it was already fixed in `f72a792`, which post-dates the reviewer's
  range `7e3ac29..3a23f15` (item 4 confirms the encodings and proves the e2e release instead of
  re-porting). If the re-review wants a from-scratch port commit for the trail, say so.
- **Solana redeploy = in-place upgrade at `58Ss…`** (honesty note a), not a fresh program id
  (the tool reused the `.so`'s sibling keypair and the deployer is the upgrade authority, so the
  old vulnerable build no longer exists at that address). Redirect if Reviewer R expects a new
  program address.
- **§10 item 2 implemented exactly as written**: `expiry <= deadline` at acceptance (Solana
  `submit_attestation`, EVM `release`); the reviewer's optional extra `now <= state.deadline` in
  `release_approved` was not added because it is implied (`now <= approval.expiry <= deadline`).
  Confirm or redirect.

## Previous run: head task list (P1 F5, Solana §9 attest-once/release-many, step-5 deployments): READY FOR MERGE — its testnet deployments are SUPERSEDED by this run's §10 redeploy (see Current run, item 6)

State: **READY FOR MERGE** (updated 2026-10-02T15:30Z). Started clean at `305d565` (head: merge main into
track-b, crosschain §9). Head message received this run; implemented as written, one commit per item. Commits:
`d566d0c` (P1), `3a23f15` (Solana §9 program + tests), `f72a792` (client/CLI §9 flow), `71bb069` (live-run fixes)
and this STATUS commit. No other-checkout access (`benzo-sol/trackb` read only for the reviewer's test file),
no merges/rebase/cherry-pick/push, no mainnet, no Base. Deployer keys read only by the deploy/cycle commands,
never printed.

1. **P1, EVM fee-on-transfer drain (F5): DONE, commit `d566d0c`.** `contracts/evm/src/BenzoEscrow.sol`
   `lock` now measures `balanceOf(this)` around `safeTransferFrom` and reverts `BadParameters` unless the
   delta equals `amount`. Reviewer's `FeeTokenDrain.t.sol` copied byte-identical from
   `~/Dev Projects/benzo-sol/trackb/contracts/evm/test/FeeTokenDrain.t.sol` (diff: identical)
   into `contracts/evm/test/`. Both runs shown: **red on old code** — `forge test --match-contract
   FeeTokenDrainTest` → `[FAIL: next call did not revert as expected] test_fee_on_transfer_token_drains_victim_auction`
   (`contracts/logs/p1-feetoken-old-code.out`, exit 1); **green after the fix** — `forge test` → `22 tests passed,
   0 failed` incl. the reviewer's test (`contracts/logs/p1-feetoken-fixed.out`, exit 0).
   `docs/AUDITS.md` created (canonical per AGENTS.md): every dependency pin + audit status (carried over from
   `contracts/AUDITS.md`, now a pointer), every custom security-relevant file with its reason, and the
   `assets` allowlist note (plain ERC-20/721 only; no fee or rebasing tokens; lock's delta check enforces it).
   `TestToken.sol` (step-5 fixture) is listed there too.

2. **Solana attest-once / release-many (`docs/design/crosschain.md` §9): DONE, commits `3a23f15` + `f72a792`.**
   Program: `Approval` PDA seeds `["approval", auction_id, batch_index u64 le]`, 153 bytes with exactly the
   §9 fields (`auction_id, batch_index, allocation_root, result_hash, nonce, expiry, genesis_hash, bump`);
   `submit_attestation` carries the old release path's checks (checked instructions sysvar, strict Ed25519
   offsets, 2-of-3 distinct pinned signers, exact attestation bytes, genesis pinned at lock, `now<=expiry`,
   not refunded) and creates the Approval exactly once (second submit → `BatchReplayed` 0x9); the
   signature-carrying `release` is **removed** (single code path). `release_approved(payouts[])` takes the
   Approval + auction with **no signatures**: `now<=approval.expiry`, not refunded, per payout leaf bound +
   Merkle membership vs `approval.allocation_root`, paid-flag PDA unset, cap `paid+amount<=locked`, flag set
   before the lamport move, per-recipient failures skip and stay claimable. `crosschain/solana.ts` /
   `benzo xchain release`: submit-if-needed then repeatable release_approved, payouts chunked by real
   serialized size, sent as versioned transactions with the destination + paid-flag accounts in an address
   lookup table; `--submit-only` runs the submit step unconditionally (replay = on-chain `BatchReplayed`).

   **Tests (local validator, `bash contracts/solana/test/run.sh`, `contracts/logs/solana-attest-once.out`):
   25 PASS, 0 FAIL**, incl. every §9 item: `submit-twice-refused`, `release-no-approval-refused` (NoApproval
   19), `approval-expired-release-refused`, `release-after-refund-refused`, `release-leaf-not-in-root-refused`,
   `every-leaf-paid-exactly-once` (8 leaves paid 3+3+2 across crank calls as v0 txs over a real lookup table,
   then two full re-crank rounds paid nothing twice; exact per-destination balances and `paid == 8 × lot`
   asserted), `spoofed-sysvar-on-submit-refused`, plus lock/flag/binding/refusal behaviours and the
   `size-table-measured` record. `crosschain/local-demo.sh` 12/12 PASS (`contracts/logs/step3-xchain-e2e.out`),
   `npm run typecheck` and `npm run e2e` PASS (37 s).

   **Before/after payouts per transaction at proof depths 0–6** (measured from real serialized transactions
   against the 1232-byte packet limit; `SIZE depth=…` lines in the test log): before = the removed
   signature-carrying release (Ed25519 verify ix + attestation in the same tx); after = release_approved.
   `after_legacy` is a plain transaction; `after_alt` is the shipped v0 + lookup-table form. The ALT is
   required by the design's rule: `after_legacy` at depth 4 is 3, below 4.

   | proof depth | before | after_legacy | after_alt (shipped) |
   |---:|---:|---:|---:|
   | 0 | 1 | 1 | 1 |
   | 1 | 2 | 2 | 2 |
   | 2 | 2 | 4 | 4 |
   | 3 | 2 | 4 | 6 |
   | 4 | 1 | 3 | 4 |
   | 5 | 1 | 3 | 4 |
   | 6 | 1 | 3 | 3 |

3. **Deploy step 5 (design §7 step 5): DONE.** Both escrows deployed and the full
   **lock → attest → release → refund** cycle run once on each testnet. All values below are public
   (addresses, txids); nothing from the key files is printed. Scratch deploy/approve scripts lived in `tmp/`
   and were deleted at run end (the deploy is reproducible from the forge artifacts with an ethers
   `ContractFactory` over the key file, or verified directly from the txids).

   **Ethereum Sepolia** (auction `0x15341db9fc2f16174f7d025d118f8862f0861e2a1fc71047ff34bcab6f9e8aa8`,
   allocation root `0xf5646bf44723b7420e77fab6cdb29961b25d2ed544a589812e0920bc9ece275f`, payout dest
   `0xE985C5448e8FA32b30DDA7Bf28405255b891b981`, window lockUntil 1790953748 / deadline 1790954168):

   | what | value |
   |---|---|
   | `BenzoEscrow` | `0x41f8424d1cF73E5d77805DC2E324a63c4710F50c` (deploy tx `0x319f896e9e1a16a6f1e8f0185811786815203bffb1f89b255d16436abbfb996a`, block 11829751) |
   | `TestToken` BNT (minted 1000e18) | `0xA6F881Fc182E7b68d6bd44Fd69A2DD4AE717BC49` (deploy tx `0x69d563f1924d2f8d7656e25f2daa8e00ac1ccbed7e3bc5060c9802fdc9871913`) |
   | approve escrow 2e18 | tx `0x3bbcb3754a839a68cf44dbad0d9c004ea9be39f712461c6145873dffc278c8e0` |
   | lock 2e18 (lot 1e18) | tx `0x3a6e3dfa694f4223a68a1f4a8fed554589d1b88dba09bd9a82bad6425cfcf343` |
   | attest 2-of-3 (bundle in `tmp/xchain-live/`) | root `0xf5646bf4…` |
   | release (1e18 to the dest) | tx `0x5d93306d74bb0ca4c99259ac091715b01511923a52284c70ace56d3df88edc29` |
   | refund remainder (1e18 to returnTo) | tx `0x4653d24b4b332c91146e20d5e2937894be42f45f578ec50c5c18644e647e5ddc` |

   `xchain status` after release: `locked 2000000000000000000, paid 1000000000000000000`, paidLeaves 1/1.

   **Solana devnet** (program `58SsWZaW2eBq1z1bnH1xPNXXMGbnrXm9YMvGeRdJL14G`, auction
   `0x0cccf4820aadcb2480b42d38121ac5ff6768240e3c20cf9222476dbd2856a551`, escrow PDA
   `2ChFfikeTY38AgdiecQV2Y18ACgGMWXTE2u6VoWE3MWx`, approval PDA `85Tf51qYYeY3kMtUm5UnPwSiSvwpt8K8MZKgaZPGuFLz`,
   payout dest/return `DV9nJknUZjfVHJVz2Pj9eb5dV8j2AN5CceqTPDzgHxSc`, same window):

   | what | value |
   |---|---|
   | program deploy | tx `4VBQ4aWvrsBgaDaSEtunGJWFRFEZoY6dbMGSN9vTK9dHHETk6KyigMY3CRj94a24CdQs69YUkKjfNYWc6cUKw1BE` |
   | lock 2 SOL (lot 1 SOL) | tx `LV856ytFstyAHgjayzRaS9CN8axu1QxwgSWXyR6zCh8bCnHVikrsWp4KT56A5mrYx2S9uaaaL3kvvKwLjs5XkWt` |
   | `submit_attestation` (Approval created) | tx `2Wbn5d9J4xFSmXVxTrjuRJV5T9pNfViKaGXZFWCNTnZLuWVn7Qxncv8UiHuPoGE1PmKJREzJW9ziuQuTBZ9wAHP4` |
   | `release_approved` (1 SOL to the dest) | tx `5TWQxz2CBnAEQgcySbT1FEdDVV1P8Tn2rQnqKKmmyZg2U7d6XwyKurAt963TFxGRBa1V5ZYWQHHJDQs8shNcU5T6` (lookup table `8C5yNHggaT3QCovpsUr1VMC9cn6HRJeoMSfUtU7etnFb`, create `3N7Y8gNzupMJvqdawGK35FhY6rsuUYTqFsPbHyE9vqrafZwsXbVqLYLeYCP1RuiC2feNq7cmJzN9HywrYb39emrq`, extend `3o4CvCGMwNMWoBuzHQxxznAaxtRQHu8enDrH7pxXVqDYMmyxSNA3CQJkZqypxTZaVkuLr43R4wjqDTtpDfzSLbCM`) |
   | refund remainder (1 SOL) | tx `28hi6rwUexyM2GBLdHEuYZJe2noTqw3vZLDjgNVLCzVRXsDLQ5a5on6C3dYicg2X8xQmKKYNodwq2dXJZ4efo87z` |

   `xchain status` after release: `amount 2000000000, paid 1000000000`, paidLeaves 1/1.

   **Honesty notes / deviations (this run):**
   - (a) "a test token you mint" = a minted ERC-20 on Sepolia (done, see above). On Solana the §9 escrow
     holds and pays **native SOL** (lamports; SPL/Token-2022 delivery is design §7 step 4, deferred), so the
     devnet cycle ran with devnet SOL; see Questions.
   - (b) Two product bugs were found **by the live run** and fixed in `71bb069`, each with its refused-before
     output and passing-after txid: (1) EVM leaves did not bind the auction's asset (design §3) — the first
     Sepolia release was refused `NotInRoot` (0x52e382c6) once the asset was a minted token (the local demo
     uses native ETH = the zero asset id and could not see this); `attest --asset` now binds it and the
     bundle records it. (2) `CreateLookupTable` requires a slot in `SlotHashes` — devnet refused both the
     finalized and the tip slot ("is not a recent slot"); the client now walks back from the tip (bounded).
   - (c) The first live Solana release attempt failed at lookup-table creation **after** `submit_attestation`
     had landed (tx `2Wbn5d9J…`); the rerun skipped the submit (Approval existed) and cranked — exactly the
     §9 attest-once/release-many semantics. No failed attempt is credited as evidence.
   - (d) One local test run went red (`Attempt to load a program that does not exist`): a stale
     `solana-test-validator` from the previously stopped session (old program id `5AAgFCpRUe…`) held :8901
     so the driver ran against the wrong chain. Not credited; the stale process exited; the rerun is the
     25-PASS log above.
   - (e) The §9 "expect ≥ 6 at depth 4" is **not reachable** at the 1232-byte packet limit: one depth-4
     payout is 59 + 4×32 = 187 bytes of instruction data, so 6 payouts alone are 1122 bytes before
     signatures, blockhash and account indexes (the measured depth-4 v0+ALT tx for 4 payouts is 1042 bytes,
     for 5 is 1233 — one byte over). Measured maximum is 4 at depth 4 and 6 at depth 3 (1232 exactly). The
     design's ALT remedy is implemented and its trigger condition (below 4 without the table) holds. See
     Questions.
   - (f) The lookup table is created per `benzo xchain release` run (~0.002 SOL rent on devnet); a persistent
     crank-owned table would save that, recorded under Deferred.

**Test audit:** project E2E suite untouched — default seal-open R retain (browser/tle assertion IDs unchanged,
PASS 37 s at `71bb069`); `contracts/`/`crosschain/` drivers are contract-level proofs, not E2E specs. No
assertion added/loosened in the E2E suite; live specs remain Track A's. Env: no new env vars. Upstream code:
none copied (pinned APIs inspected in installed sources; the lookup-table slot rules read from the pinned
crate/agave source).

### R22 (head P2 at `4254c7a`) — OPEN, next package for Track B

`xchain attest` must run the same checks as `benzo verify` on `--dir` (`checkPublicAuction`: frozen
root, gate-X witness certificates, the clearing recomputed through the registry) and refuse on any
ERROR, and require `--result` bytes to equal `--dir/result.json`; repro = a directory whose frozen
leaf set was swapped after the witnesses certified it (attested today, refused after).

Plan (not started when this run ended): (1) `attest` loads `loadCompletePublicAuction` +
`checkPublicAuction` (+ `deriveClaimOpenings`) and refuses on any check with `error`; (2) compare
`--result` bytes with `pub.resultBytes` exactly; (3) rework the demo fixture into a verify-green
directory and add the swapped-leaf-after-witness repro. **Fixture finding for the head (see Q6):**
`checkPublicAuction` requires the result to carry `manifest_hash` and `freeze_root`, `published_at <
T_freeze`, and the `clear` check recomputes the PRODUCT clearing through the registry — which the
cross-chain `winners[].leaf` result shape cannot satisfy. So either the cross-chain result shape
needs a ruling (extend `checkPublicAuction` to accept it) or the xchain fixture/result must be a
full product result and the `winners[]` branch of the leaf derivation drops.

### Questions (this run)

- **§9 size target:** the measured table above; ≥6 at depth 4 is arithmetically impossible inside a 1232-byte
  packet with the design's payout shape (see honesty note e). Recorded as measured; confirm or redirect
  (e.g. hoisting `leaf_count`/`proof_len` per instruction would buy ~1 payout per depth, but deviates from
  the §9 payout list).
- **"test token you mint" on Solana:** ran the devnet cycle with native SOL because the §9 program moves
  lamports; locking a minted SPL token needs the step-4 token delivery path. Say the word if the devnet leg
  should instead mint SPL and extend the program.
- **Asset binding in leaves** (fix b.1) changed `benzo xchain attest` (`--asset`) and the bundle shape
  (`asset` field). Backward note: old bundles default to the zero asset id (native). Confirm.
- `TestToken.sol` is a test-only fixture with an open mint (listed in `docs/AUDITS.md`); Reviewer R should
  see it flagged as non-custody in the hard review.

Deferred: persistent crank lookup table (note f); `benzo xchain status` could also print the approval state.


## Track B testnet lane

State: **READY (funded)**. Set up 2026-10-02T10:01Z at commit `b30e826`, clean tree; funding landed 2026-10-02T10:07Z (first sync after setup) — no 90-minute wait needed. My lane only: `$BNZ_STATE_DIR=./.benzo`, frostd `localhost:2745`; nothing read or used from `benzo/.benzo`, its `.env`, or A's processes (A's frostd on 127.0.0.1:2744 was only observed via `lsof`, never contacted).

**Public values (this lane):**

- FROST group key (2-of-3 RedPallas, dealerless DKG; identical in alice/bob/carol per the setup's own `sort -u` check): `ba0272e65a40d44de12531785f8921d52038723ba218797a6f6bbd7f1f26d62f`
- Vault UA (view-only wallet `.benzo/vault`, birthday = tip − 10): `utest1743u…pev5fh` (abbreviated per gate LA — the full UA is in the wallet)
- Bidder Default Address (`.benzo/bidder`) — **send the ~0.1 TAZ here**: `utest1yevm…rw43h8` (abbreviated per gate LA — read the full UA from the `.benzo/bidder` wallet)

No mnemonic or `.age` content is printed here or anywhere outside `$BNZ_STATE_DIR`; full transcripts live in `$BNZ_STATE_DIR/run/` (`setup.log`, `bootstrap-setup.log`, `bootstrap-force.log`, `frostd-dkg.log`, `funding-poll.log`).

**Commands and trimmed real output:**

| Command | Real output (trimmed) |
|---|---|
| `set -a; . ./.env; set +a && bash tools/setup-testnet.sh` (at `b30e826`) | `1. bootstrap` → `local CA and frostd certificate (SANs localhost, 127.0.0.1)` → `2. frostd and a dealerless 2-of-3 RedPallas DKG` → `3. vault UFVK from the group key (zcash-sign generate)` → `4. vault wallet (view-only, birthday = tip - 10)` → `5. bidder wallet` → `bidder address: utest1yev…43h8`, `group key: ba02…d62f`; rc=0 |
| `.benzo/run/frostd-dkg.log` (frostd's log during the DKG) | `starting HTTPS server at 127.0.0.1:2745` — **:2745, not :2744** (the port fix in `b30e826`; A's frostd held 127.0.0.1:2744 throughout) |
| `zcash-devtool wallet -w .benzo/vault list-addresses` | `Account AccountUuid(944434da-…)`, `Default Address: utest1743…f5fh` |
| `zcash-devtool wallet -w .benzo/bidder list-addresses` | `Default Address: utest1yev…43h8` (same as the setup line) |
| `npm run e2e` (default project, seal-open; first B baseline that can use `$BNZ_STATE_DIR/bin`) | `PASSED default seal in the browser, open with tle after R (40 s)`, rc=0 |

DKG command lines (public, from `.benzo/frost/dkg-commands.txt`): three `frost-client dkg -c $BNZ_STATE_DIR/frost/{alice,bob,carol}.toml -d 'benzo phase 1 vault' -s localhost:2745 -C redpallas -t 2` invocations (alice carries `-S f769aa…f4d,205ca6…b17`), run concurrently through frostd. Setup re-run safety note: this was a first-time run (`frost/`, `vault`, `bidder` all created now).

**Funding: ARRIVED, mined.** `zcash-devtool wallet -w .benzo/bidder sync` + `balance` at 2026-10-02T10:07Z: `Latest block height is 4432740`, `Scan complete … progress is 2/2`, then `Balance:   0.10000000 TAZ` — 10,000,000 zatoshis in the **Ironwood** pool (`ironwood_balance.value_pending_spendability: Zatoshis(10000000)`; every `Spendable` line still 0.00000000 TAZ at that height, i.e. mined and scanned but not yet past its spendability wait). The note was received at the bidder address above within 6 minutes of the wallet's creation; the 90-minute poll was not needed. Later runs should expect it in `Spendable` after confirmations.

## Phase 5 part 3, cross-chain (design §7 steps 1–3): READY FOR MERGE

Updated: 2026-10-02T11:32:19Z. Start clean at `8e114fa`; work landed in three commits — `c255084` (step 1, EVM escrow), `0ac8b59` (step 2, Solana escrow), `cc5a719` (step 3, crosschain TS + `benzo xchain` + local demo). Head commits seen mid-run and built on: `5ebf4c8`/`ee792ea` (no-Base design update — affects only §4 delivery and steps 4–5 targets, not steps 1–3). Scope: `docs/design/crosschain.md` §7 steps 1–3 exactly; steps 4–5 (Railgun on Ethereum Sepolia, Token-2022 CT on Solana devnet, deployments) deferred to a later run pending funded deployer keys. No mainnet; deployer keys `.benzo/evm/deployer.key` / `.benzo/solana/deployer.json` untouched (steps 4–5 only). No other-checkout access, no merges/rebase/cherry-pick/push.

**What is implemented (design §1–§3):** canonical keccak leaf/root (`benzo-leaf-v1`/`benzo-root-v1` layouts, sorted-pair tree matching OZ `MerkleProof`, leaf count committed in the root, strict index bound, amounts always `lot_count × standard_lot`, nothing from Zcash/funding in any leaf) shared byte-for-byte across `crosschain/leaf.ts`, `contracts/evm/src/BenzoEscrow.sol`, `contracts/solana/src/lib.rs`. Attestation domain separation per chain: EVM EIP-712 (`benzo-release-v1` domain name, `chainId` + `verifyingContract`, OZ `ECDSA`+`MessageHashUtils`, high-`s` rejected by OZ); Solana a 200-byte fixed layout (genesis hash + program ID + auction id + result hash + allocation root + batch/nonce/expiry) checked against the preceding native Ed25519 verification instruction through the **checked** instructions sysvar (explicit `sysvar::instructions::ID` compare = the spoofed-sysvar refusal) with strict offsets. Replay refusal: release-once per `(auction_id, batch_index)` (EVM stored flag, Solana batch PDA). Per-recipient paid flags (EVM keyed by canonical leaf hash; Solana paid PDAs): a failing/already-paid recipient is skipped, never a batch revert, and failed items stay claimable by a later release. Lock refused after `T_submit`; refund after `deadline` by anyone to the pinned return address.

**Logged proofs (committed, from runs at `cc5a719` working tree; commands reproduce them):**

| Step | Command | Real output (trimmed) | Log |
|---|---|---|---|
| 1 | `cd contracts/evm && forge test` (foundry 1.5.1, solc 0.8.30, via_ir; OZ 5.6.0 + vendored forge-std 1.9.7) | `Ran 1 test suite ... 17 tests passed, 0 failed` — lock (state/token/after-T_submit/twice), release 2-of-3 EIP-712 + quorum/expiry/leaf-bound/not-in-root refusals, replay refusal, refund (after deadline/remainder/before refused), per-recipient flags (failure skipped, claimable later, no double pay, cap) | `contracts/logs/step1-forge-test.out` |
| 2 | `bash contracts/solana/test/run.sh` (cargo build-sbf 4.4.0, solana-test-validator 4.3.0) | `RESULT PASS all Solana escrow assertions` — 20/20: `lock-records-state`, `lock-twice-refused`, `lock-after-submit-refused`, `release-2of3-pays`, `replay-refused`, `recipient-flag-failure-skipped-not-reverted`, `recipient-flag-claimable-later-no-double-pay`, `release-1sig/outsider/one-signer-twice-refused`, `release-wrong-genesis-refused`, `release-expired-refused`, `spoofed-sysvar-refused`, `release-leaf-index-bound/not-in-root-refused`, `refund-before-deadline-refused`, `refund-after-deadline-returns-remainder`, `refund-sets-closed-flag`, `release-after-refund-refused`, `refund-twice-refused` (every refusal asserts its specific custom-program error code) | `contracts/logs/step2-solana-tests.out` |
| 3 | `bash crosschain/local-demo.sh` (anvil + solana-test-validator; drives only the shipped `bin/benzo` → `benzo xchain` verbs) | `RESULT PASS one cleared drop delivered end to end locally on both chains` — 12/12: escrow deployed from the forge artifact, locks on both chains, one shared allocation root attested 2-of-3 per chain, release delivers 1 ETH + 2 SOL to fresh addresses (exact deltas asserted from raw `eth_getBalance`/lamport balances and the escrow's `PayoutPaid` event), `status` shows each chain paid exactly its leaves and the escrow state matches the attested root, replay refused with each chain's `BatchReplayed` error, refund refused before the deadline and the full remainder returned after it on a cancelled auction | `contracts/logs/step3-xchain-e2e.out` |
| base | `npm run typecheck`; `npm run e2e` | both PASS (`PASSED default seal in the browser, open with tle after R (39 s)`) | `tmp/e2e/` |

`contracts/AUDITS.md` lists every dependency, pin and audit status (OZ Contracts 5.6.0 audited Feb 2026 OZ commit `68e4095` incl. SafeERC20/ECDSA; forge-std 1.9.7 vendored test-only `foundry-rs/forge-std@77041d2:src`; solana-program `=2.3.0` + solana-keccak-hasher `=2.2.1` with Cargo.lock committed; ethers 6.17.0 / @solana/web3.js 1.99.0 exact client pins; native Ed25519 program + instructions sysvar; no serialization library). New root deps are those two client libraries only (lockfile diff = additions).

Honesty notes. (a) The step-3 demo starts from a **cleared allocation file** (winners + lot counts, as the Zcash clearing pipeline produces) and one chosen `result_hash`; it proves the delivery leg of §7 step 3 — the Zcash-side clearing and the live testnet end-to-end remain the existing pipeline and steps 4–5/Track A (design §6). No Zcash txid/address/amount enters any leaf or chain call. (b) Harness bugs found and fixed during the runs (no product defect hidden; final logs are the passing reruns): Foundry `vm.expectRevert` was shadowed by an internal helper's external call; the Solana release CPI lacked the system-program account; releases exceeded the 1232-byte tx limit until the Ed25519 message was referenced into the release instruction (still strictly checked: `message_instruction_index == current`, offset 2, size 200, sig/pubkey slices inside the verify instruction); the demo re-used stale key files while deriving identities from fresh randomness (signers disagreed → quorum errors, correctly refused); ethers v6 briefly caches the resolved "latest" block number so `getBalance` saw the pre-tx block (demo now reads raw `eth_getBalance`). (c) The step-1 forge tests and the step-2/step-3 drivers live under `contracts/`/`crosschain/` as the design's contract-level proofs; they are not project E2E specs and none of them touches `npm run e2e`'s suite.

Test audit: default E2E seal-open unchanged (R retain; browser/tle assertion IDs untouched; default PASS 39s at `cc5a719`). No live-spec changes; live runs remain Track A's. Key material: demo keys are fresh local dev keys under `$BNZ_STATE_DIR/xchain-local/` (gitignored, never printed; anvil dev account 0 is the local seller/crank); `.benzo/` testnet lane material and both deployer keys were not read or used.

### Questions (cross-chain steps 1–3)

- **Solana cluster binding (design §1):** there is no genesis-hash sysvar on-chain (checked the `solana-sysvar` 5.0.0 module list and the Agave v4.3.0 tree). Implemented as designed: the 200-byte signed message carries the cluster genesis hash + program ID; additionally the program requires the message's genesis hash to equal the value pinned into the auction at `lock` (the locker's client supplies `getGenesisHash`) and its program ID to be this deployment (error 18 `BadBinding`; `release-wrong-genesis-refused` in the step-2 log). This is the tightest on-chain binding Solana allows; confirm or redirect.
- **Refund semantics:** design §2.3 says refund after `deadline` "with no release", while §2.4 keeps failed items claimable by a later release. Implemented: releases stay available until a refund happens; `refund` (anyone, strictly after `deadline`) returns the unspent remainder (`locked − paid`) to the pinned return address and closes the auction. Confirm.
- **EIP-712 shape:** domain `{name: "benzo-release-v1", version: "1", chainId, verifyingContract}`, struct `BenzoRelease(bytes32 auctionId,bytes32 resultHash,bytes32 allocationRoot,uint64 batchIndex,uint64 nonce,uint64 expiry)` — the §1 message's prefix/fields as typed data. Confirm.
- **Escrow cap:** payouts that would exceed the locked amount are skipped (never a batch revert) and the excess stays refundable to the seller, so no attestation set can pay more than locked. Confirm this matches the intent.
- Step 5 note: with `no Base` (5ebf4c8) the deployment targets are Ethereum Sepolia + Solana devnet only; step 4's stealth fallback is on Ethereum Sepolia. Noted for the later run.

## Phase 6, Track B: READY FOR MERGE

Updated run 13: 2026-10-02T08:01:57Z, base `7e06e2a` (head: merge main into track-b, docs brief) + working tree; commits `8725750` (README.md), `1416988` (docs/why-timelock.md), `4d5f756` (docs/verify-it-yourself.md) and this STATUS commit. Scope: the three Phase 6 docs exactly as briefed in `docs/design/phase6-docs.md`, nothing else. No tests, no source changes, no pins, no other-checkout access, no `.benzo/`, funds, keys, merge/rebase/cherry-pick or push. Only network use: one read-only quicknet beacon fetch. SC batch-plan stays BLOCKED pending Track A's side-effect-free `settle/batching.ts` (unchanged since run 12).

Every command shown in the three docs was run first and logged under `tmp/proof-logs/run13-*.out`; trimmed real output:

| Doc section | Command | Real output (trimmed) | Log |
|---|---|---|---|
| README quick start | `npm ci` | exit 0 | run13-npm-ci.out |
| README quick start | `npm run typecheck`; `npm run build:verify`; `npm run build:cli` | each exit 0 | run13-build.out |
| README, verify §1 | `shasum -a 256 dist/benzo-verify.mjs`; `cat docs/verify-bundle.sha256` | `89d90c5370b9c42fb5e29f8d99f9672303d8c0546b1d4970aaaac175690355c4` both; `git status --short` empty, so `npm run build:verify` reproduced the committed bundle byte-for-byte | run13-sha.out |
| README quick start | `bin/benzo verify --dir docs/evidence/phase-4/cli --signer 302a…7891` | OK ×11 (`missing-deposits delivery report manifest freeze witness receipts clear envelope accounting accounting-strays`) + `WARN no witness set (pre-Phase-5 manifest)`, exit 0 | run13-cli.out |
| verify §2 | cold copies of `docs/evidence/phase-4/cli` and the bundle into `/tmp/benzo-docs`, then `node benzo-verify.mjs --dir auction --signer 302a…7891` | same 11 OK + WARN, exit 0 | run13-verify-main.out |
| verify §4 | `node benzo-verify.mjs --dir auction-old --signer …` (cold copy of `docs/evidence/phase-2/auction`) | `WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs`, `ERROR verify refused: no published beacon; rerun with --fetch-beacon`, exit 1 | run13-verify-old.out |
| verify §4 | same + `--fetch-beacon` | `WARN legacy projections…`, `WARN beacon fetched (not published)`, 11 OK, exit 0 | run13-verify-old.out |
| verify §5 | node one-liner flipping one hex digit of leaf-0 plaintext in `tampered2/auction.json`, then verify | `flipped one hex digit of leaf 0 plaintext at offset 22916 0 -> 1`; `ERROR verify refused: opening 0 published differs from re-derived`, exit 1 | run13-tamper-doc.out |
| why-timelock | node one-liner, `release = genesis + period × (R − 1)` | `R=32701714 -> 2026-10-02T02:35:06.000Z`; `R=32704232 -> 2026-10-02T04:41:00.000Z` | run13-time.out |
| why-timelock | `curl -s https://api.drand.sh/52db9b…/public/latest \| node -e …` | `latest round 32707994 formula time 2026-10-02T07:49:06.000Z wall clock 2026-10-02T07:49:09.096Z` (formula matches the live chain within one 3-s period) | run13-time.out |
| why-timelock | node one-liner flipping one hex digit of the beacon signature in `tampered3/auction.json`, then verify | `ERROR verify refused: beacon BLS signature invalid`, exit 1 | run13-tamper-beacon.out |

Numbers in the docs cite their sources: genesis `1692803367`, period `3`, quicknet chain hash and the release formula → `manifest/schema.ts:4–8` and `:104`; R = 32701714 → `docs/evidence/phase-4/cli/beacon.json`; 17,000-bid open 431.6 s / clear 0.9 s / verify 443.1 s → `docs/evidence/phase-6/bench.json`; 17,000 = the organizer's 48-hour volume → `docs/PHASE-6.md` §1; claim and limits → `docs/research/DESIGN.md` §1/§6/§14; mode proof marks → `docs/evidence/phase-1…4/EVIDENCE.md` (live) and this file (offline). No hype language added; nothing is claimed beyond DESIGN §1.

Honesty notes: a first tamper attempt flipping `opened.json` in the canonical copy exited 0 (`run13-tamper-open.out`) — canonical dirs take `opened`/`beacon` from `auction.json` (`api/public-auction.ts:110–112`; sidecars are legacy-only, `:133–143`) — no pass credited; the shipped demo flips a byte in `auction.json` and the guide states that fact. The `--fetch-beacon` runs fetched the real quicknet round and BLS-checked it before use. Doc lengths: README 156 lines (brief 150–200), why-timelock 66 (brief ~60), verify-it-yourself 102 (brief ~60; the full check list and real outputs make ~60 impossible without cutting evidence).

Baseline: `BNZ_STATE_DIR=tmp/run13-no-state npm run e2e` exits 1, `NOT RUN tle missing at …/tmp/run13-no-state/bin/tle` (`run13-baseline.out`) — the user's prohibition on `.benzo/` keeps the pinned tle out of reach, as in run 12; no baseline pass claimed. Docs-only run: no tests added or changed (R11), no source covered by any test touched, no mutation rerun due; audit marks unchanged (R retain default seal-open). READY FOR MERGE.

Run 12 record, updated: 2026-10-02T06:05:41Z, base `0a6b6cc` + working tree. Clean start; no head commits since run 11. Legacy dirs without a beacon now refuse by default with `ERROR verify refused: no published beacon; rerun with --fetch-beacon`; `--fetch-beacon` fetches signed-manifest R from real quicknet, BLS-authenticates it before decryption, and emits `WARN beacon fetched (not published)`. Published beacons remain offline by default and must equal the fetched beacon when requested. BLS verification catches malformed-point exceptions and false returns as `ERROR verify refused: beacon BLS signature invalid`.

Proof: `npm run typecheck`, `npm run build:verify`, `npm run build:cli` PASS (`tmp/proof-logs/run12-build.out`). Scratch `python3 tmp/run12-proof.py` PASS (`run12-proof.out`): old committed bundle fails both Phase2 legacy paths and emits raw point error; rebuilt standalone bundle from `/tmp/benzo-run12-verifier-final` passes cold `docs/evidence/phase-2/auction` with real `--fetch-beacon`, gives exact default/signature refusals, and retains identical stdout/stderr/exit0 for intact Phase3/ModeB/CF/CF-bond corpora with fetch disabled by Node preload. Published Phase3 `--fetch-beacon` also passes. `python3 tmp/run12-extra.py` PASS (`run12-extra.out`): published/fetched mismatch refused specifically; second malformed point refused clearly. First scratch run failed because run11's old `/tmp` Phase3 copy retained a deliberately substituted signature; both bundles refused it, and the final run cold-copied intact repository corpora (`run12-proof-stale-corpus.out`, no pass credited). Two builds starting without the bundle reproduce SHA256 `89d90c5370b9c42fb5e29f8d99f9672303d8c0546b1d4970aaaac175690355c4` (`run12-repro.out`); rebuilt bundle/hash committed. `git diff --check` PASS. All named logs are under `tmp/proof-logs/`; scratch scripts removed after completion, cold copies/logs retained.

Baseline: `BNZ_STATE_DIR=tmp/run12-no-state npm run e2e` exits1, NOT RUN missing pinned tle (`run12-baseline.out`). Explicit user prohibition on touching `.benzo/` prevents this harness's usual state-bin access; no baseline pass claimed. Test audit: R retain default seal-open C1–C7; covered sealer source/assertions unchanged, no new mutation due. No tests added, no owned services or pending jobs, no `.benzo/`, funds, keys, live network custody, other-checkout access, or upstream/pin changes. Standalone proofs use only public data and drand. SC batch-plan remains BLOCKED with existing partial metrics; user accepted that item pending Track A's side-effect-free `settle/batching.ts`. Rerun stage5 after it arrives. READY FOR MERGE per the direct instruction below, without claiming complete SC gate evidence.

Run 11 record, updated: 2026-10-02T05:48:09Z. Start clean at e3399c5; head-authored design 4adbb6b inspected. No owned services, live wallet/key-material access or other-checkout commands. The AGENTS-required baseline harness loads .env and invokes the existing pinned tle through BNZ_STATE_DIR (e2e/lib/env.ts); no further state/tool access used for Phase6 implementation or proofs. Default E2E PASS38s (`tmp/proof-logs/phase6-baseline.out`). No tests added.

1. PK complete at base e3399c5 + working tree: verify now re-derives bids and CF reserve offline with pinned tlock-js from the published, BLS-authenticated quicknet beacon; stanza chain/round bound before decrypt. Published openings are compared. Serial beacon defaults offline too. `--fetch-beacon` requires network beacon equality; `--tle` resolves the optional Go cross-check through PATH; `--offline` aliases the default. No git/state lookup in verify. `npm run build:verify` inlines dependencies into committed `dist/benzo-verify.mjs`; hash in `docs/verify-bundle.sha256`.

Proof: `npm run typecheck`, `npm run build:verify`, `npm run build:cli` PASS (`phase6-pk-build.out`). `python3 tmp/pk-proof.py` PASS (`phase6-pk-proof.out`): bundle + cold public copies under `/tmp/benzo-phase6-b-offline` outside git, Node preload makes fetch throw; in-repo/standalone both exit0 with identical OK checks for Phase2, Phase3, ModeB, CF and CF bond corpora. Phase2's missing public beacon was fetched once to prepare the cold input; the verification itself made no fetch. Tampered zero signature exits1 at point validation; a valid Phase2 signature substituted at Phase3 R exits1 specifically `beacon BLS signature` (`phase6-pk-signature.out`). `node tmp/pk-options.mjs` PASS for deprecated alias and fetch-equality CF reserve path (`phase6-pk-options.out`). Two builds each starting with absent bundle yield SHA256 `450bc39920b96559378c5cf56d7aa1ed3f449bef9177cd45aa8fe0a3a695c2d8` (`phase6-pk-repro.out`). `node tmp/phase6-compat.mjs` also PASS for drop/launch/RFQ/OTC/recurring buybacks and CF --previous link (`phase6-pk-compat.out`). All logs under `tmp/proof-logs/`; no live-chain/custody evidence claim. Optional --tle not run: B does not access protected state binaries and no tle on PATH was required for PK.

2. LA complete at base5d83153 + working tree: `npm run leak-audit -- --sensitive FILE --paths P1 P2 … [--git] [--allowlist FILE]`. Sensitive JSON is `{label,value,release_time?}[]`; release_time is UTC ISO text or epoch seconds and applies only to 128-byte bid hex. Bid matches are findings before release; afterward plaintext is intentionally public. Other sensitive values match plain/hex/base64 (also decoded-hex byte base64). Generic addresses, viewing keys, 24 lowercase word runs, PEM private keys and AGE armor checked. Optional allowlist JSON lists exact address-bearing file paths only. History scans full blobs across all commits/branches (earliest commit timestamp per blob/path), avoiding multiline diff-fragment misses. Tracked working files use last commit timestamp; untracked use mtime. Working-path symlinks refused; historical symlink blobs scanned as text. Final audit corrected their initial exclusion (same synthetic harness now14 findings). Output only rule/label/file/line-or-commit/value SHA256; scan errors suppress input values and fail exit2.

Proof: standalone source typecheck PASS (`phase6-la-build.out`); `python3 tmp/la-proof.py` PASS (`phase6-la-proof.out`): 14 synthetic findings cover all7 rules, each relevant encoding, removed historical secret and symlink target, address allowlist, no values in output; clean fixture exits0; post-release bid exits0, same bytes with prerelease mtime exits1. Findings retained in `tmp/proof-logs/phase6-la-findings.json`. Tool built through the shipped npm script. Only scratch synthetic repo/history scanned; no live sensitive file/state read. PK commit5d83153; LA commit22d812f plus historical-symlink audit correction included in the third item commit. No new tests.

3. SC offline partial complete; overall BLOCKED at base22d812f + working tree: `tools/bench.ts` / `npm run bench -- --bids N` generates fresh real tlock ciphertexts at quicknet R32704232, deterministic seeded price/quantity/one-time owner inputs, real fixed512-byte settlement-envelope plaintexts, 512-byte BNZ memos and owner signatures. Per-stage child processes measure wall time including public input load/output serialization and process maxRSS (fresh high-water mark). Generation fetches/authenticates the past mainnet quicknet beacon once; open/verify use the local published client. Synthetic deposit references/public manifest addresses are not chain evidence. Witness certificates are real in-memory signatures; no keys persisted. Admission follows shipped memo/stanza checks and validates envelope signatures/size; freeze/open/registry clear and complete shipped verify run. Stage5 is explicitly BLOCKED, never imports live plan, outputs null batch/fee estimates and exits1 after independent stages.

`npm run bench -- --bids 1000` ran all independent stages PASS, then overall exit1 solely for protected stage5 (`tmp/proof-logs/phase6-sc-1000.out`). 5000/17000-bid independent stages also PASS (`phase6-sc-5000.out`, `phase6-sc-17000.out`); each overall exit1 solely for the same stage5 blocker. All jobs finished and polled to exit. Tool source typecheck PASS (`phase6-sc-build.out`). First launch failed before generation because externalized armor import needed `.js`; fixed then reran. No failed launch credited. `docs/evidence/phase-6/bench.json` is generated partial benchmark data, not complete SC gate evidence. Source SHA256/base/UTC are recorded by each run.

| Bids | Stage | Seconds | Peak RSS MiB | Status |
|---:|---|---:|---:|---|
| 1000 | generate | 18.504 | 267.5 | PASS |
| 1000 | admission | 0.144 | 105.8 | PASS |
| 1000 | freeze | 0.019 | 106.4 | PASS |
| 1000 | open | 25.254 | 274.0 | PASS |
| 1000 | clear | 0.033 | 94.5 | PASS |
| 1000 | batch-plan | — | — | BLOCKED |
| 1000 | verify | 25.512 | 341.7 | PASS |
| 5000 | generate | 88.726 | 390.8 | PASS |
| 5000 | admission | 0.731 | 267.7 | PASS |
| 5000 | freeze | 0.092 | 300.6 | PASS |
| 5000 | open | 127.507 | 411.4 | PASS |
| 5000 | clear | 0.221 | 207.6 | PASS |
| 5000 | batch-plan | — | — | BLOCKED |
| 5000 | verify | 128.424 | 705.0 | PASS |
| 17000 | generate | 300.260 | 515.3 | PASS |
| 17000 | admission | 2.426 | 611.0 | PASS |
| 17000 | freeze | 0.307 | 722.2 | PASS |
| 17000 | open | 431.564 | 578.3 | PASS |
| 17000 | clear | 0.934 | 484.8 | PASS |
| 17000 | batch-plan | — | — | BLOCKED |
| 17000 | verify | 443.060 | 1411.4 | PASS |

Benchmark provenance: all3 runs used base22d812f + identical working-tree `tools/bench.ts` SHA256 `97ebdb14a86601a1fd383131f870122d999eeea774ffad487d230f50930f96b9`, recorded UTCs in generated bench.json. These are partial measured offline results, not a complete SC gate claim at a committed source revision. No estimated fees/batch counts fabricated. Exact rerun: `npm run bench -- --bids 17000` (currently exit1 after all independent stages). Complete immutable public corpora/metrics remain under `tmp/bench-{1000,5000,17000}` for head review; generated aggregate committed with this item per user's one-commit instruction. Final source typechecks and `git diff --check` PASS (`phase6-final-checks.out`). Run11 PK/LA implementation and manual proofs complete; READY FOR MERGE was withheld until stage5 matches the head-owned design (superseded by run12 user instruction accepting the blocker). No ongoing work/services, tests added, pin changes, live wallet/key reads, broadcasts, funds, other-checkout access, merge/rebase/cherry-pick or push. No copied upstream code; APIs/flags inspected in pinned installed sources (tlock-js0.9.0, noble1.9.7), existing witness/envelope/registry modules and settle/plan.ts. Scratch proof scripts removed after completion; logs/corpora retained.

Test audit: R retain default seal-open; unchanged source/assertion IDs and baseline PASS38s. No source it covers changed; no new mutation needed. Live tests and signers remain A-owned/unrun.

### Questions (Phase 6)

- Run 13 doc marks (for the head): per the brief only Mode A (uniform) is marked **testnet-proven live** in the README. Phase 2's live run also computed a Vickrey comparison on live inputs, but its sample prices tied (`docs/evidence/phase-2/EVIDENCE.md` limitation), so README marks Vickrey **offline-proven** with that footnote; say the word if it should read live.
- Run 13 doc lengths: `docs/verify-it-yourself.md` is 102 lines against the brief's ~60 — the eleven check lines and the real command outputs make ~60 impossible without cutting evidence. Compress on request.

User instruction (2026-10-02T06:03:30Z recorded UTC), verbatim:
> You are Builder B (Codex) on ~/Dev Projects/benzo-b, branch track-b. AGENTS.md is your operating manual. Continue from STATUS-B and `git log --oneline -15`.
>
> The head reviewed run 11 (5d83153, 22d812f, 0a6b6cc) and tested `dist/benzo-verify.mjs` from /tmp with network denied: the Phase 3 corpus verifies offline and the bundle hash matches. Your batch-plan BLOCKED item is accepted: Track A will extract a side-effect-free `settle/batching.ts` after its live regression; you rerun bench stage 5 then. Small fixes now (one commit, proof in STATUS-B):
>
> 1. **Legacy dirs without a published beacon** (e.g. a cold copy of `docs/evidence/phase-2/auction`) are now unverifiable: the default says "missing published beacon" and `--fetch-beacon` refuses too. Rule: with a published beacon, verify offline (and `--fetch-beacon` must match it). Without one, `--fetch-beacon` fetches the round from drand, BLS-checks it against quicknet, and proceeds with `WARN beacon fetched (not published)`. The default error must say `no published beacon; rerun with --fetch-beacon`.
> 2. **Tampered beacon signature** currently fails with "Cannot find square root" (point decode). Catch it: `ERROR verify refused: beacon BLS signature invalid`.
> Prove from /tmp with the standalone bundle: Phase 2 cold copy OK with `--fetch-beacon`; the default gives the new message; a tampered beacon gives the clear error; Phase 3 / Mode B / CF corpora unchanged. Rebuild the bundle and update `docs/verify-bundle.sha256`. Then set READY FOR MERGE.
>
> Add no tests. Track B files only. Never touch ~/Dev Projects/benzo, funds, keys or `.benzo/`. No merge/rebase/cherry-pick.

- SC stage5 protected-file BLOCKER: `settle/plan.ts:10–14` performs git/.env/state initialization at import; lines21–29 run live wallet/scan work, and the file exports no offline batch planner (`rg -n export settle/plan.ts` finds none). Design §3 requires a read-only import from this Track A-owned file, while user/AGENTS forbid B from live state/wallet access or changing A files. Need A/head to expose a side-effect-free offline batch planner at cap13 with a documented ZIP-317 fee estimator, or authorize a specific pure planner import. B finished all independent stages at1000/5000/17000, but batch counts/fees stay null and stage5/run exit1; no substitute pass. No import attempted.

User instruction (2026-10-02T05:10:55Z recorded UTC), verbatim:
> You are Builder B (Codex) on ~/Dev Projects/benzo-b, branch track-b. AGENTS.md is your operating manual. Continue from STATUS-B and `git log --oneline -20`.
>
> The head reviewed your run-10 commits (9abf320, bee8e41, c1dcc3a, 95c50b7); Track B Phase 5 is complete and stays on track-b until Phase 4 is PASSED.
>
> Next: **Phase 6 Track B offline items, exactly as designed in `docs/design/phase6-b-offline.md`** (head-owned; implement as written, disagreements under Questions): (1) fully offline verify from the published beacon + standalone reproducible `dist/benzo-verify.mjs`; (2) `tools/leak-audit.ts`; (3) `tools/bench.ts` 17,000-bid offline benchmark. One commit per item with its logged proof in a new "Phase 6, Track B" section of STATUS-B, then READY FOR MERGE.
>
> Add no tests. Touch only Track B files, new `tools/` files and `package.json` scripts. Never touch ~/Dev Projects/benzo, funds, keys or `.benzo/`. Do not merge, rebase or cherry-pick.

## Phase 5, Track B run 10: READY FOR MERGE

Updated: 2026-10-02T05:03:59Z. Start clean at f8ac208; head merge/corrections inspected, PHASE-5 R3/R4 author-checked. No owned services; protected state files not read. Default E2E PASS39s (`tmp/proof-logs/run10-baseline.out`). No new tests.

1. Dependencies: exact direct noble curves1.9.7/hashes1.8.0 declarations; typecheck PASS (`run10-deps.out`); Node manual lock comparison PASS (`run10-deps-manual.out`), all lock data except root declarations byte-structure unchanged. Source base f8ac208.

2. Recurring buyback report: `adapters/buyback-report.ts` derives window index, prices (per-lot prices for multi-lot), units, payout+fees in zats/exact 8-decimal ZEC, result hash and serial intake from public data. `serial-intake.json` array binds auction/ciphertext/serials with the opened seller's owner signature; each winner supplies exactly fill serials, no duplicates. `benzo report --dir PUBLIC [--previous PUBLIC]` prints canonical values; public/API verifier requires matching `report.json` for recurring buybacks. Old nonseries corpora need no report.

Proof at base9abf320 + working tree: `node tmp/run10-report.mjs` fresh real tle/quicknet R32704232 creates two independently sealed, linked windows with one in-memory signer, fresh auction IDs/ciphertexts; 5 units, lot prices10000/20000, payout69800 + fees200 = spent70000zats /0.00070000ZEC, serials100/101/102/110/111. `python3 tmp/run10-report-check.py` PASS CLI report equals file, online/offline verify both windows, --previous link; wrong spend, swapped report serials, changed intake signature and reverse link refused specifically. Logs `tmp/proof-logs/run10-report-{corpus,check,build,harness-build}.out`; typecheck/build:cli PASS. Scratch extension initially omitted async on its window function; fixed before the two-window run (no product defect or stale run credited). No live chain settlement claim; deposit references are generated fixtures, owner/witness keys remain in memory, only pinned tle executable used under state.

3. Gate Z adapter complete at basebee8e41 + working tree: `marketplace.json` has `{version:1,adapter:zilkroad,collection,serial_range:{first,count},metadata_commitment}`. Signed manifest `lot` is `zilkroad:` + SHA256(canonical marketplace); multi-lot IDs are `5a494c4b` + first56 hex of SHA256({marketplace_hash,lot_index}), so even removing the file refuses. This uses existing manifest fields, keeps Track A schema untouched, and binds all collection/range/metadata bytes. Drop range must match `serials`; buyback intake also checks range when pinned.

`benzo claim --dir PUBLIC --ciphertext-hash HEX` loads saved private `.receipt.json`/`.statement.json` siblings of the bidder owner key; optional `--receipt FILE --statement FILE` and `--owner-key-stdin` support offline imports without secret argv/files. `--check CLAIM` checks the public binding. Only paid auction winners qualify; statement verifies against result/opened owner, receipt must match a public settlement output (seller payout if winner refund=0). Claim owner-signs auction/manifest/result hashes, collection/metadata, serials, statement/receipt hashes and settlement txid. Serial assignment is the published drand shuffle for drops, otherwise consecutive committed inventory by leaf order. `delivery-exceptions.json` is an array of `{claim,receipt,statement,status:paid_not_delivered,signature}`; owner separately signs `{auction_id,claim_hash,status}`. Verify checks claims, status signatures, uniqueness, range/commitment; a complaint is unresolved, not a token-chain proof or a second-payment authorization. No Zilkroad network calls.

Manual proof: `node tmp/run10-adapter.mjs` freshly seals/opens 3 corpora with real tle/quicknet (single lot, shuffled multi-lot, zero-refund winner); in-memory owners, only public fixture settlement references, no key files/state access. Shipped claim signs via stdin, equals library output, valid private statement/receipt and exception queue. `python3 tmp/run10-adapter-check.py` PASS online/offline verify + shipped claim --check on all3; metadata substitution, removed marketplace file, changed serial, bad complaint signature and duplicate complaint specifically refuse. Library also refuses substituted receipt/statement and claim signature. Logs `tmp/proof-logs/run10-adapter-{corpus,check,build,harness}.out`; typecheck/build:cli PASS. Scratch rerun first retained a prior queue against fresh ciphertexts (correct refusal; `run10-adapter-stale-queue.out`), fixed scratch to initialize queue. Zero-refund scratch originally tied both bids, causing pro-rata fill2; corrected input to distinct prices, then PASS fill3/refund0 via seller payout (`run10-adapter-zero-fixture-failed.out`, downstream missing-claim refusal `run10-adapter-zero-check-not-run.out`). No failed run credited. No new tests or live delivery/chain settlement claim.

4. Missing-bid pure path complete at basec1dcc3a + working tree: `mined-deposits.json` is `{version:1,auction_id,block_times:[{height,time}],deposits:[{height,ciphertext_hash,note_id}]}`. `note_id` is `txid:ironwood:output_index`; each deposit height must have exactly one public timestamp, no unused timestamps, duplicate notes or malformed fields. This list represents scanner-observed exact-C BNZ deposits, not stray-value notes. Membership matches ciphertext + txid/pool against the recomputed frozen root. Notes whose block timestamp is strictly below signed `T_submit` and which are absent derive `refund-exceptions.json` rows `{auction_id,height,ciphertext_hash,note_id,status:refund_owed,refund_zats:C}`. Verify errors if the queue is missing/different and flags valid obligations with a warning; it does not broadcast/refund. At/after deadline notes do not become these exceptions.

`benzo receipt prove --dir PUBLIC --ciphertext-hash HEX` emits `included:false`, `message:"not included; refund owed"`, exact-C exception and a self-contained manifest/full frozen-set/mined-observation bundle for an observed omission. `--check` replays it offline. Optional `--note-id` selects a distinct omitted note when its ciphertext also appears in another admitted deposit. Existing included Merkle proof behavior stays intact. Phase4's committed Deposit lacks output_index, so a list containing two same-tx/same-ciphertext notes matching one leaf is refused as `ambiguous frozen note identity` rather than silently counted once.

Proof: `python3 tmp/run10-missing.py` chooses fresh random mined note IDs/hashes and early/at/late timestamps against this session's freshly tle-generated marketplace corpus (R32704481). Offline verification first errors on absent refund queue, then online/offline PASS with exact120100-zat C; omitted proof prints/refuses as specified and included proof still verifies. At/after deadline omissions excluded; refund120000, absent timestamp, duplicate note, ambiguous frozen identity, changed proof root/refund/height all specifically refuse; same hash/different tx omission is selected by --note-id. `tmp/proof-logs/run10-missing-{build,check}.out`. These are pure public-input fixtures, not scanner/network evidence; chain authentication/payment stays A's job.

Final compatibility audit fixed one gate-Z defect: the statement retains the original balance_due_zats after successful settlement, so a paid bond winner was incorrectly refused. Same fresh-bond harness `PROOF_BOND_ONLY=1 node tmp/run10-adapter.mjs` FAIL before (`claim paid auction winner`, `run10-claim-bond-before.out`) and PASS after (`run10-claim-bond-after.out`, R recorded there). Claims now require SETTLED and a nondefaulted winner; full public accounting requires the seller payout including paid balances. The owner-signed statement still binds the original obligation. The harness also refuses a defaulted winner. This necessary compatibility fix is included with item4; no extra test or mode.

Final verification: typecheck/core/CLI builds PASS (`run10-final-build.out`), default E2E PASS37s (`run10-final-e2e.out`; sealer/test source untouched). Latest claim/missing source typecheck/CLI PASS (`run10-claim-bond-build.out`). Logged manual suites all PASS: `run10-final-report.out` (two linked windows), `run10-final-adapter.out` (single lot, shuffled drop, zero refund, paid bond; online/offline and queue/claim corruptions), `run10-final-missing.out` (early/at/late/included/omitted/proof corruptions). Inherited drop/launch/RFQ/OTC/nonseries buyback all online verify PASS (`run10-final-compat.out`). Commands and corpus values are in these logs; paths relative to `tmp/proof-logs/`. Final source SHA256s/base commit/UTC recorded in `run10-source-hashes.out`. No gate evidence, live custody, actual delivery or actual refund claim. Four requested items are complete for Track B; commits9abf320/bee8e41/c1dcc3a and this item4 commit (git log) stay on track-b.

Test audit: R retain default seal-open (browser/tle assertion IDs unchanged, default37s PASS); no E2E source/assertion changes or new tests. Live specs and their mutation reruns remain Track A-owned and were not run by B. No dependency resolution/pin changes beyond the requested direct declarations, upstream code copies, environment installations, wallet/key access, testnet spends, other-checkout commands, merges/rebases/cherry-picks or pushes. No owned services/work running. New scratch scripts removed after completion; public corpora/proofs and full logs retained in tmp for review. READY FOR MERGE is pure/manual readiness, not Phase5 PASSED/live evidence.

### Questions (run 10)

- Budget accounting: this run adds net268 handwritten source lines (git diff f8ac208 plus new70-line missing module); Zilkroad/claim is part1, report/missing are R3's remaining pure part2 items. The prior ~832 estimate plus this work needs reconciliation across the two phase budgets; all work was explicitly ordered by the user above.
- A integration for omissions: authenticate block timestamps and mined notes from real chain data; publish only exact-C BNZ notes, preserve stable `txid:ironwood:output_index`, write the derived queue and wire exact-C refunds. `scan/src/main.rs:66` reads output_index but line76 onward does not currently emit it; the frozen Deposit also lacks it. A/head must retain that identity in the live path. B refuses ambiguous identity inputs, and does not claim the publisher's timestamp list authenticates itself. This is the requested pure boundary, not a live refund implementation.
- A integration: publisher must write the marketplace packet using the lot commitment encoding above, preserve serial-range binding, persist bidder receipt/statement siblings for bare claim, and publish signed delivery complaints. JSON schema changes, actual token delivery/observations and live settlement remain A's lane.

User instruction (2026-10-02T04:40:00Z), verbatim:
> You are Builder B (Codex) on ~/Dev Projects/benzo-b, branch track-b. AGENTS.md is your operating manual. Continue from STATUS-B and `git log --oneline -20`.
> 
> The head reviewed your run-9 commits (collection drop e70d8d8..e33ba95, launch 14061a4, RFQ ff6b2ea, OTC d67b6f6, 20ce790) and found the money rules correct. Your Phase 5 work stays on track-b until Phase 4 is PASSED.
> 
> Remaining Track B items for Phase 5 (each proven in STATUS-B with logged manual runs, one commit each):
> 1. **Dependencies:** `clear/serials.ts` and `envelope/destination.ts` import `@noble/curves` / `@noble/hashes`, which today arrive only transitively via tlock-js. Declare both in package.json `dependencies` at the exact locked versions (1.9.7 / 1.8.0, no ^ or ~); the lockfile must not change otherwise.
> 2. **Recurring buyback report (PHASE-5 R3 item 4):** for a buyback series (CF recurring rounds over Mode B), a public per-window report derived only from public data: window index, units bought, clearing price, ZEC spent (payout + fees), serials taken in. `benzo report --dir PUBLIC [--previous …]` prints it; verify checks the report matches the result.
> 3. **Marketplace adapter, gate Z (PHASE-5 part 1):** complete the Zilkroad adapter: manifest binds collection, serial range and metadata commitment; `benzo claim --dir PUBLIC --ciphertext-hash HEX` turns the winner's private settlement receipt + statement into a delivery claim signed by the owner key; an exception-queue file format for paid-but-not-delivered, checked by verify. Read-only adapters only — no network calls to Zilkroad.
> 4. **Missing-bid exceptions (R3 item 6, pure part):** given a published list of mined deposits (height + ciphertext hash + note id, as the scanner reports them), verify flags any deposit mined before `T_submit` that is absent from the frozen root as an exception owed an exact-C refund, and `benzo receipt prove` explains "not included; refund owed" for it.
> Then set READY FOR MERGE. Add no tests. Touch only Track B files (plus package.json for item 1). Never touch ~/Dev Projects/benzo, funds or keys. Do not merge, rebase or cherry-pick.

## Phase 5, Track B run 8: READY FOR MERGE

Updated: 2026-10-02T04:29:04Z. Takeover at d8ed113 on track-b; clean initial tree. PHASE-5 R3/R4 author-checked (b709abd/71ec6eb). No owned services from this session; protected state/service files not read (Track B has no wallet/key access). Default E2E PASS (38s), `tmp/proof-logs/run8-baseline.out`. No added tests.

1. Manifest serial block: `npm run typecheck` PASS, `tmp/proof-logs/drop-schema.out`; optional strict `{first,count,seed_round_offset}`, positive offset, multi-lot uniform only, safe range/round.

2. `clear/serials.ts`: typecheck PASS; `node tmp/proof-serials.mjs` + independent Python hashlib/u64be reproduction PASS (3 winners, 10 serials, real quicknet round in `tmp/serial-input.json`), overflow refused specifically. Output `tmp/proof-logs/drop-shuffle.out`. Step 1 commit e70d8d8.

3. Registry uniform entry decorates clearing with serial assignment from `ClearInput.serial_beacon`; `node tmp/proof-markets.mjs` fresh tlock corpus + shipped `node clear/dist/cli.mjs < tmp/drop-input.json` PASS (fills 2/3/5 unchanged; 10 unique serials; round R+1). Logs `tmp/proof-logs/drop-result.out`, `drop-result-build.out`, typecheck PASS. Step 2 facb65a.

4. Shared verifier/API loader accepts published `serial_beacon {round,signature}` and replays through uniform registry entry. CLI online fetches the configured R16 quicknet path; online and offline both verify BLS with installed lockfile-pinned drand-client. `bin/benzo verify --dir tmp/canon-drop --signer HEX [--offline]` both exit 0, OK x8 (`tmp/proof-logs/drop-online.out`, `drop-offline.out`); typecheck/build:cli PASS (`drop-verify-build.out`). Step 3 e06ed08. No live-chain evidence claimed: these are fresh manual pure-mode corpora with real tle/drand, fixture deposit references.

5. Collection proof complete at base 650b998 + working-tree registry BLS check: real quicknet R=32703286, seed=32703287, 3 winners with fills 2/3/5, range 100–109. Online/offline verify both exit 0 OK x8 (`drop-final-online.out`, `drop-final-offline.out`). `python3 tmp/drop-neg.py` refuses swap (`ERROR clear refused: canonical result differs`) and wrong round (`ERROR verify refused: serial beacon round`) online/offline; a real signature from R substituted for R+1 fails BLS offline and published-beacon equality online (`drop-neg.out`). `node tmp/proof-markets.mjs 9` freshly seals/opens 10 winning units with a signed count=9, exit 1 `refused: serial units exceed count` (`drop-overflow.out`). Build/typecheck PASS (`drop-final-build.out`). BLS replay also enforced at the pure registry/API boundary using installed lockfile-pinned noble `verifyShortSignature` (API/source inspected before use); no copied upstream code. A malformed zero signature was refused by drand-client's point parser (scratch expectation initially wanted a generic BLS error); changed the manual corruption to another real signature to exercise the wrong-round BLS check. All logs under `tmp/proof-logs/`. Steps 1–4 e70d8d8/facb65a/e06ed08/650b998.

Schema follow-up for A: public `serial_beacon {round,signature}` and result `serial_assignment` / `serial_beacon_round`; propagate `ClearInput.serial_beacon` to live clear/signers. Drop stays `clearing.mode="uniform"` with `lots[]`, not a separate pipeline.

6. Launch mode pure/verify/API complete. New `clear/launch.ts` registry entry (layout v1: byte125=0 main / 1 holder), `clear/market.ts` shared signed-manifest/order/accounting boundary, `adapters/zilkroad.ts` signed holder receipts pinned to collection/auction/owner/unique serial. Launch manifest block `{standard_lot_size,minimum_raise_zats,holder?:{supply,collection,receipt_signer},follow_on?:{previous_result_hash,price_zats}}`. No new schema edit: its client validates the shared base through the existing schema. Main fills uniform in standard-lot increments, marginal pro-rata and leaf-index dust; holder tranche fills at floor by committed index, unused holder supply goes to main. A failed minimum raise/min-fill cancels all fills and refunds exact C including the fee.

Proof at base e33ba95 + working tree: `node tmp/proof-launch.mjs` fresh tle/quicknet round **32703489** → `tmp/proof-logs/launch-corpus.out`: floor 10000 holder pays 20000 for 2; main price 20000, fills 2/2, raise 100000; minimum 100001 cancels all with 400100 exact-C refunds despite manifest fee=100. Marginal band (two main q4 at 20000, room6) fills 4/2 in lots of2; holder2; raise140000. Linked follow-on remaining supply2 goes to earlier mined-height leaf1, at prior20000, leaf0 unfilled. Signed height attestations bind auction/leaf/deposit txid; signed manifest binds prior result hash/price and CF series. Follow-on is its own recurring frozen round (fresh manifest/vault on A's live path), keeping freeze-before-R; no post-release additions to the original frozen set. `bin/benzo verify` online/offline OK x8 on all four corpora; follow with `--previous tmp/canon-launch` also OK series (`launch-verify.out`, `launch-follow-link.out`). Shipped stdin clear byte-matches the corpus result. Batch `allocation.json` has fresh owner-signed destination per standard lot, amount2, one batch, hash in result; `/allocation` returns its exact content and `/auction` valid (`launch-api.out`). File-byte change → `launch allocation file hash`; destination substitution → `launch delivery owner signature/count`; bad holder receipt sig → `manifest signature`; altered holder payment → `canonical result differs` + `launch lot/payment` (all exit1). Typecheck/core/CLI builds PASS (`launch-build.out`). Scratch API proof initially bundled the standalone server guard into its own entry and exited usage; fixed the scratch invocation to import the shipped module (no product change). Private allocation receipts reuse the existing leaf receipt path; token delivery remains the project's job (`delivery: project_on_token_chain`). Caps are per deposit, never per person.

A wiring follow-up: public `launch_input {holder_receipts,delivery,mined_heights,previous_result}`, `allocation.json`, result `{cancelled,launch_supply,holder_price_zats,allocation_file_hash}` and per-allocation `tranche`; propagate `ClearInput.launch`. `deliveryBatch` exports the bytes to publish with `jsonBytes`; A supplies chain-observed mined-height attestations, marketplace receipts and fresh project-chain destinations. No live-chain evidence claimed by B.

7. RFQ complete through registry (layout v2, ask/quantity/owner offsets unchanged). Signed block `rfq {dealer_keys,max_price_zats,budget_zats,delivery_deadline_height,delivery_signers}`; exactly one unit/one lot, no buyer-side bond mode. Only latest binding-valid quotes from allowlisted one-time dealer keys rank. Lowest ask wins, second-lowest sets gross payment; ties by committed leaf. Fewer than two → cancel, all exact C, zero fee/treasury. Sealed price tightens the procurement ceiling. `rfq_delivery` in result binds three signer **Ed25519 attestation** keys/deadline (not FROST custody shares); `settlement.delivery_defaults` requires two distinct signatures on the same `{auction_id,leaf_index,deadline_height,observed_height,status:delivery_missed}`, observed height strictly after deadline. Defaulting winner receives neither bond nor payment; buyer gets the bond + unspent procurement payment net of fees. Raw CF defaults, nonwinner defaults, duplicate/unlisted attestations, early/default disagreement refuse.

Proof at base14061a4 + working tree, fresh real quicknet **32703573** and fresh tle orders: `node tmp/proof-rfq.mjs` → `tmp/proof-logs/rfq-corpus.out`: asks10000/20000 plus nonallowlisted1000 → leaf0 wins, gross20000/net19900 (fee100), each C50100 refund, treasury20000; conservation170300=19900+150300+100. Single valid quote cancels: both C50100, zero fee. Equal asks10000 tie to leaf0. Delivery default moves leaf0's70000 obligation to buyer; two other refunds50100; one attester, duplicate attester and observed-height=deadline each specifically refused (`quorum`, `signer`, `binding/deadline`). `python3 tmp/rfq-verify.py`: online/offline OK x8 on four corpora; self-consistent first-price result → `canonical result differs`, outsider fill → same + `allocation 2 payment`, missing default quorum → `rfq delivery default quorum` (exit1; `rfq-verify.out`). Shipped stdin clear byte-matches result. API `/auction` valid + `/result` exact on normal/cancel/default (`rfq-api.out`). Typecheck/core/CLI builds PASS (`rfq-build.out`). No live settlement claim.

A wiring follow-up: signed RFQ parameters and layoutv2; treasury funding leg; separate host Ed25519 delivery-attestation keys (manifest pins three public keys), quorum default packets and buyer destination. Live delivery observation/attestation and settlement remain Track A.

8. OTC complete through registry (layoutv3; signed `otc {buyer_key,seller_key}` pins distinct one-time parties; single unit/lot). Latest valid max/min match iff max≥min; price is integer floor((max+min)/2) zats. Buyer refunds C−gross price, seller refunds C plus gross payment net of fee; a no-match/missing party refunds everyone exact C with zero fees. Extra parties refund exact C. No buyer-side bond, serial block or second reserve; both limits become public at R (no match-bit-only privacy claim).

Proof at baseff6b2ea + working tree, fresh real quicknet **32703652** and fresh tle orders: `node tmp/proof-otc.mjs` → `tmp/proof-logs/otc-corpus.out`: max30000/min10000 →20000, buyer30100 refund, seller50100 refund+19900 payout, outsider50100 refund; conservation150300=19900+130300+100. Max9000/min10000 no match →both50100 exact C, zero fees; equal10000 matches at10000; odd30001/10000 rounds to20000; missing seller cancels. `python3 tmp/otc-verify.py`: online/offline OK x8 on five corpora; self-consistent wrong midpoint21000 → `canonical result differs` + `otc midpoint/limits`; charging cancelled buyer100 → `canonical result differs` + `otc fees` (exit1; `otc-verify.out`). Shipped stdin clear byte-matches. API `/auction` valid + `/result` exact on match/cancel/missing (`otc-api.out`); typecheck/core/CLI builds PASS (`otc-build.out`). A wiring: manifest block/layoutv3 and result per-leaf `side`; ledger obligations are to the two leaves, never a separate clearing/settlement pipeline. No live-chain evidence claim.

Source sweep: closed a projection boundary in buyback validation: its base mode is temporarily projected to uniform for common-schema checks, which could otherwise accept drop-only serials. `node tmp/proof-buyback-serials.mjs` signs a fresh fixture buyback+serials packet → exact `refused: serials are uniform auction-side`; `tmp/proof-logs/buyback-serials.out`. Typecheck/core/CLI PASS (`final-build.out`). OTC d67b6f6; RFQ ff6b2ea; launch14061a4.

Receipt source audit found and fixed a launch holder statement reporting the main clearing price instead of the holder floor. Same scratch harness `node tmp/proof-holder-statement.mjs` failed before (`holder receipt price 20000; expected floor10000`) and passes after (`price10000, fill2, payment20000`); `tmp/proof-logs/holder-statement-before.out`, `holder-statement-after.out`. Typecheck/CLI build PASS (`holder-statement-build.out`). This changes the existing private statement price field only, preserving the signed leaf/output binding; no new test.

Final verification: source commit **20ce790**, clean tree: `npm run e2e` PASS38s (`tmp/proof-logs/final-e2e.out`, `tmp/e2e/out/run.json`); typecheck/core/CLI builds PASS. `python3 tmp/final-verify.py` online verifies **21 corpora** (seven inherited compatibility corpora plus drop, four launch, four RFQ, five OTC), OK x8 each, linked follow-on OK series; four shipped stdin clears equal their public results (`final-verify.out`). Repeated drop/launch/RFQ/OTC corruption proofs pass at that source (`final-drop-neg.out`, `final-launch.out`, `final-rfq.out`, `final-otc.out`); API normal/default/cancel six corpora valid with exact result (`final-api.out`). Receipt-only fix **44ef3cb**: existing statement corpus and holder corpus online verify OK x8 (`final-statement-regression.out`, `final-holder-regression.out`). Fresh launch-holder corpus at quicknet **32703882** signs a statement with its generated in-memory owner and the shipped `benzo receipt statement ... --check tmp/holder-statement.json` returns `OK settlement statement`; main-price substitution refuses `statement differs from result/settlement` (`fresh-holder-statement.out`, `fresh-holder-statement-neg.out`). The old run-6 `stmt-statement.json` lacks CF's later `balance_due_zats` field and correctly refuses `statement field set` (`final-statement-check.out`); not treated as a current-format positive or altered. No failed run hidden.

Scope complete: steps1–5 e70d8d8/facb65a/e06ed08/650b998/e33ba95; launch14061a4, RFQff6b2ea, OTCd67b6f6; boundary20ce790; holder receipt44ef3cb. No added tests, dependency/pin changes, upstream code copies, environment installations, wallet/key access, testnet spends, other-checkout commands, merges/rebases/cherry-picks or pushes. No owned foreground work remains. This is Track B pure/manual proof readiness, not Phase 5 live/PASSED evidence. Scratch scripts removed after completion; public corpora, inputs and full output logs retained in `tmp/` for head review.

Test audit: R default seal-open owns the unchanged browser/tle assertions; sealer/test source untouched and default PASS at20ce790. Other inherited E2E specs unchanged; no new automated assertion or spec. Live mutation audit/runs remain Track A (B forbidden funds/keys). No claim that B ran those live specs. B's changed new mode/serial/statement logic has the manual negative proofs above.

### Questions (run 8)

- Budget accounting for head review: net source additions across EN4776c3b (77), receipt516722f (125), CF31dde46 (254), this run (376), excluding docs/schema, total **832** versus Track B's ~750 part-2 estimate. The ~82 overage buys authenticated serial replay, signed holder/delivery records, standard-lot file binding and quorum/deadline default checks; no extra market or test. Please reconcile/approve the phase budget at merge review.
- A integration request (outside B's lane): update JSON schemas/router manifest creation and live `clear/auction-cli.ts`/signer inputs to use the registry clients and pass the published serial/launch inputs, write `allocation.json`, use the versioned layouts and RFQ treasury/default attestation parameters described above; run the modes/spec/mutations live after merge. B did not edit those files.


User instruction (2026-10-02T03:55:33Z), verbatim:
> Task: PHASE-5 §11 collection drop with fair serial assignment (R3 item 5). Design (fixed):
> 1. Manifest: a collection drop is a multi-lot uniform auction (your CF `lots[]`) plus an optional block `serials: { first: number, count: number, seed_round_offset: number }` (`seed_round_offset` ≥ 1). Accept it in `manifest/schema.ts` as an optional field (minimal change, allowed).
> 2. New file `clear/serials.ts`, about 40 lines: `assignSerials(winners: {leaf_index:number, units:number}[], serials:{first,count}, beaconSignatureHex: string): {leaf_index:number, serials:number[]}[]`. Winners are sorted by leaf_index; build the array `[first .. first+count-1]`; Fisher–Yates from the last index down, with j = (u64 from SHA-256("benzo-serials-v1" ‖ signature ‖ i as u32be)) mod (i+1); then hand serials out in winner order, `units` each. Refuse if Σunits > count.
> 3. Result: when the manifest has `serials`, the result gains `serial_assignment` (output of assignSerials) and `serial_beacon_round = R + seed_round_offset`. Clearing itself is unchanged.
> 4. Verify: when `serial_assignment` is present, fetch or read the beacon for `R + seed_round_offset` (online: the same drand HTTP path your R16 code uses; `--offline`: a published `serial_beacon {round, signature}` in auction.json), recompute, and refuse on any difference. Register through the mode registry; no per-mode verify copy.
> 5. Proof (logged in STATUS-B): a corpus with 3 winners and 10 serials using a real past quicknet round; verify OK online and `--offline`; refusals for (a) a swapped serial, (b) a wrong beacon round, (c) Σunits > count.
> Then continue with the remaining §11 modes as amended by PHASE-5 R3, one commit per mode with its proof: launch (tranches + minimum raise + allocation file in standard lot sizes), RFQ (reverse-Vickrey, two-quote minimum, allowlisted dealer keys), blind OTC (midpoint if max ≥ min). Then set STATUS-B READY FOR MERGE.
> Add no tests. Touch only Track B files plus the minimal schema change. Never touch ~/Dev Projects/benzo, funds or keys. No merge/rebase/cherry-pick.

## Phase 5, Track B run 7: READY FOR MERGE

Updated: 2026-10-02 · scope: the head's ordered work for this run — housekeeping (R21 item 3 relabel), (1) cross-check `envelope/destination.ts` against the official Zcash vectors, (2) PHASE-5 §11 gate CF core features a–e as amended by R3 (pure logic + verify/API, through the mode registry) — then READY FOR MERGE. Run 6's items (rows below) were reviewed by the head and stay on track-b until Phase 4 is PASSED (R4 item 5). No tests (R11). No testnet, funds or keys; scratch only in `tmp/` (gitignored).

Commits this run: 4359f35 (housekeeping), fa4eb36 (item 1), 31dde46 (item 2, gate CF).

| Item | State | Evidence (command, output) | Commit |
|---|---|---|---|
| 0. Housekeeping (R21 item 3) | DONE | The head-prompt quote in Questions is relabeled out of the `User instruction` label (only the user's own words get that label; the user's verbatim scope words live in PHASE-5 R1/R2). | 4359f35 |
| 1. `envelope/destination.ts` vs official vectors | DONE | Vectors fetched read-only into `tmp/vectors/zcash-test-vectors` at **78321beacb0e0477e33cd002b56585a107c2708c** (zcash-hackworks/zcash-test-vectors, commit 2026-07-01). Cases built by `tmp/vectors/cases.py` using that repo's own reference encoders (`bech32m.py`, `unified_encoding.py`, `f4jumble.py`) and stdlib base58check — never the TS under test; expectations come from the vector rows. Proof `tmp/proof-dest-vectors.ts` → `tmp/proof-logs/dest-vectors.out`: **1089 ok, 0 fail** — 10 F4Jumble checks (8 official `f4jumble.json` pairs + the 2 `f4jumble_long` vectors at 3,246,395 and 4,194,368 bytes: reference forward pinned to the official blake2b hash, shipped inverse recovers the counter-pattern plaintext); 195 unified addresses × (kind/network/shielded + exact receiver set) = 390 checks (60 official `unified_address.json` rows incl. typecode 65532 unknowns, the same items re-encoded for `utest`/`uregtest` by the reference encoder, 15 transparent-only UAs); 81 Sapling (official `sapling_raw_addr` under reference bech32 for `zs`/`ztestsapling`/`zregtestsapling`); 30 TEX + 30 t-addr (official `zip_0320.json` rows + `textest`/testnet Base58Check forms); 117 corrupted-checksum strings → `refused: not a shielded destination`; 120 HRP-mismatch UAs (body re-encoded under the other network's HRP with a recomputed checksum) → `refused: invalid unified address`; mainnet/regtest UA and Sapling → `refused: wrong-network address`; transparent-only UA → `UA without a shielded receiver`; TEX → `TEX address`; t-addr → `transparent address (t-addr)`. Disagreements found and fixed in `envelope/destination.ts`: (a) the bech32 string cap (200 chars) rejected official UA vectors up to 509 chars — raised to the f4jumble-derived bound; (b) `parseUnified` accepted out-of-order typecodes, duplicate receivers and P2PKH+P2SH together, which the reference decoder rejects — strict canonical container checks added; (c) no network check existed, so a mainnet shielded destination passed the envelope validator in a testnet auction — `classifyDestination` now returns `network` and `requireShieldedDestination` refuses wrong-network with `wrong-network address` (testnet-only until Phase 7). `unified_address_r2.json` (HRPs `zu`/`tu`, Revision-2 expiry metadata) is outside the pinned zcash_address 0.13.0 address set: classified `other` and refused as a destination; recorded, see Questions. | fa4eb36 |
| 2a. Bond-then-pay (CF a) | DONE | `manifest/schema.ts` optional `bond {bond_bps, balance_window_blocks}` with `C * 10000 == bond_bps * B_max` exactly (without bond the covering rule `C >= q_max * B_max + fee` stays); `clear/features.ts` `balanceDue`/`refundAfter` (`payment + refund + fee = C + balance_due_zats`, refund and balance never both nonzero); `clear/core.ts` per-allocation `balance_due_zats`, `conservation.balances_zats` and the identity `input + balances == payout + refunds + fees`; `obligationsModeA(result, settlement)` reads the settlement's `defaults: number[]` — a missed balance window is forfeited to the seller net of fees (`seller += refund - balance_due` on top of the payout, i.e. `payment + refund - balance = C - fee` per defaulter), the lot stays unfilled for the defaulter, and their deposit is never refunded (verify refuses a stray refund receipt for it: `party leaf:N is neither a result obligation nor a stray deposit`). `benzo verify` re-derives it all from the openings; settlement-side extras ride the registry signature `obligations(result, settlement?)`. Corpus `tmp/canon-cf` (fresh 128-byte orders tlock-sealed with pinned `tle -e` at quicknet round 32699958, C = 5000 = 1000bps × 50000 cap, fee 100, `tmp/proof-cf.ts` → `tmp/proof-logs/cf-build.out`): leaf1 wins at the uniform 20000 with `balance_due_zats 15100`, leaf3 at 30000 with 25100, leaf5 at 20000 with 15100 then defaults; conservation `30000 + 55300 = 70000 + 14700 + 600`; obligations `{leaf:0 4900, leaf:2 4900, leaf:4 4900, seller 54900}` (seller = 20000 + 30000 + 4900 forfeit). Corruptions (`tmp/cf-neg.py` → `tmp/proof-logs/cf-neg.out`, each exit 1): balance 15100→15000 → `ERROR accounting refused: allocation 1 balance due`; seller 54900→54000 → `ERROR accounting refused: settlement seller amount`; self-consistent payment+balance 19000/14100 → `ERROR accounting refused: allocation 1 payment`; `defaults [5,5]` → `ERROR accounting refused: duplicate default`; `defaults [2]` (unfilled) → `ERROR accounting refused: default for leaf 2 that owes no balance`; a refund receipt for defaulter leaf5 → `ERROR accounting-strays refused: party leaf:5 is neither a result obligation nor a stray deposit`. | 31dde46 |
| 2b. Sealed reserve/max price (CF b, R3 item 4) | DONE | Manifest `sealed_reserve` (hex): a tlock ciphertext whose 40-byte plaintext is `u64be price_zats ‖ auction_id`, opened at R with the bids and re-derived by `benzo verify` with the pinned `tle` exactly like the bid openings (`ERROR verify refused: reserve opening published differs from re-derived`; `--offline` requires the published opening and WARNs). `clear/features.ts` `readReserve`/`sealedReserve`/`effectiveReserve`/`effectiveMaxPrice` tighten the bound only: max() with the public reserve floor (Mode A), min() with the buyback max price (Mode B). The public dir publishes `reserve_opening: {plaintext_hex}` (legacy `reserve.json`); `clear/auction-cli.ts` opens it in `open` and passes it to `clearForMode`. In `tmp/canon-cf` the sealed reserve 12000 refuses leaf4's 10000 (`below_reserve`) while the public floor is 0; in `tmp/canon-cfb` (Mode B, sealed max 25000 vs public max 40000) leaf2's 30000 is refused `above_max_price` although it is below the public max (`tmp/proof-logs/cfb-build.out`, all 8 checks OK). Corruptions: tampered opening price 12000→9000 → `ERROR verify refused: reserve opening published differs from re-derived`; key dropped → `ERROR verify refused: missing reserve opening`; a self-consistent result filling leaf2 in cfb → `ERROR accounting refused: allocation 2 ask above clearing price` (`tmp/proof-logs/cfb-neg.out`). | 31dde46 |
| 2c. Bid revision (CF c) | DONE | `clear/features.ts` `readOrders`: among binding-valid orders with the same (owner key, lot), only the highest committed leaf index ranks; earlier ones are marked `superseded` and refunded exactly once (C − fee, never re-clearable — the `clear` check re-clears and refuses any result that counts one). Admission before T_submit is the operator's admit boundary (Track A live path); verify-side enforcement is the supersede rule plus the exactly-once refunds below. In `tmp/canon-cf` leaf0 (owner A, lot 1, 15000×2) is superseded by leaf1 (same owner+lot, 20000×1): leaf0 `outcome "superseded"`, refund 4900 exactly once, never ranked; leaf1 wins. Corruptions: a result with leaf0 winning → `ERROR clear refused: canonical result differs`; two receipts for one leaf would fail `duplicate settlement leaf:0` (the exactly-once receipt rule, same check). | 31dde46 |
| 2d. Multi-lot rounds (CF d) | DONE | Manifest `lots` (≥2 distinct 64-hex lot ids, replaces the single `lot` label); each order binds one lot id in the layout's binding slot (offset 1, the PHASE-1 §6 auction_id slot carries the lot id in multi-lot rounds); one deposit per (bidder, lot) — a second order for the same pair is a revision (2c). `clear/features.ts` attributes lots and both mode calculates clear each lot independently (`lots[]` with per-lot `clearing_price_zats`; per-allocation `lot`; single-lot results keep the pre-CF byte shape and all pre-CF corpora still verify byte-identical). In `tmp/canon-cf`: lot1 clears 20000 (leaf5 25000×1 and leaf1 20000×1 fill at the uniform 20000, leaf2 18000 unfilled) and lot2 clears 30000 (leaf3 fills); owner B holds one deposit in each lot and both are live. In `tmp/canon-cfb` (Mode B): per-lot budgets, lots 10000/20000. Corruptions: `lots[]` reordered → `ERROR accounting refused: lots`; lot clearing price 20000→18000 → `ERROR accounting refused: allocation 1 payment` (`tmp/proof-logs/cf-neg.out`). | 31dde46 |
| 2e. Recurring rounds (CF e) | DONE | Manifest `series {series_id, round_index, previous_result_hash}` with `validateManifest` enforcing the chain rule (round 1 ⇔ null hash; later rounds ⇔ 64-hex); `clear/features.ts` `checkSeriesLink` (series id equal, round index +1, previous_result_hash equals the previous round's canonical result hash). `benzo verify --previous <dir-or-json>` loads the previous round's manifest and result and checks the link (`OK series`); without `--previous` a series manifest verifies with `WARN series linkage not checked`. Corpora `tmp/canon-cf-prev` (round 1) and `tmp/canon-cf` (round 2, `previous_result_hash` = SHA-256 of round 1's result): `bin/benzo verify --dir tmp/canon-cf --signer HEX --previous tmp/canon-cf-prev` → `OK series` + OK x8, exit 0 (`tmp/proof-logs/cf-verify.out`). Corruptions: `--previous tmp/canon-cf` (wrong previous) → `ERROR series refused: series round index`; a previous dir whose result hash no longer matches → `ERROR series refused: series previous result hash` (exit 1 each, `tmp/proof-logs/cf-neg.out`). | 31dde46 |

Final sweep at 31dde46 (`tmp/proof-logs/cf-sweep-builds.out`, `cf-sweep-verify.out`): `npm run typecheck`, `npm run build:core`, `npm run build:cli` clean; `npm run e2e` PASSED (`PASSED default seal in the browser, open with tle after R (40 s)`); `bin/benzo verify` OK x8, exit 0 on seven corpora — the four pre-CF ones unchanged (`tmp/canon-modeb`, `tmp/canon-p3`, `tmp/canon-env`, `tmp/canon-stmt`) and the three new ones (`tmp/canon-cf`, `tmp/canon-cf-prev`, `tmp/canon-cfb`) — plus `OK series` with `--previous`; the run-6 mutations `canon-modeb-budget`/`canon-modeb-ask` still fail with their recorded errors (`budget exceeded`, `allocation 0 ask above clearing price`). Item 1 regression through the shipped envelope path (`tmp/proof-cf-env.ts` → `tmp/proof-logs/cf-env.out`): `sealEnvelope`/`openEnvelope` round trip with an official testnet UA from the vectors and `wrong-network address` for the mainnet one. Full logs under `tmp/proof-logs/` (gitignored scratch). Test audit (R11): Track B added no specs; `e2e/` untouched.

### Questions (run 7)

- `unified_address_r2.json` (Revision-2 unified encoding, HRPs `zu`/`tu`, expiry metadata 0xE0/0xE1) postdates the pinned zcash_address 0.13.0; `classifyDestination` treats those strings as `other` (refused as envelope destinations). If wallets start emitting `zu`/`tu`, the pin and the classifier must move together — please confirm that is the intent.
- Envelope destinations are now required to be **testnet** (`wrong-network address` otherwise), matching `validateManifest`'s `network: "test"`. When Phase 7 starts mainnet, this takes the manifest's network alongside the escrow/deposit address rules.
- **Gate CF schema/manifest additions for Track A** (I touched only `manifest/schema.ts`, the one allowed schema-side change; the JSON schemas and docs are Track A's to fold in): (1) manifest optional `bond {bond_bps, balance_window_blocks}`, `sealed_reserve` (hex tlock ciphertext), `lots` (≥2 distinct 64-hex ids, replaces the single `lot` label when present), `series {series_id, round_index, previous_result_hash}` (round 1 ⇔ null); (2) `schemas/public-auction.schema.json` gains the canonical key `reserve_opening` = `{plaintext_hex}` (legacy projection `reserve.json`), settlement summary `defaults: number[]` (leaf indices whose balance window was missed), and result fields `lots[]`, per-allocation `lot`/`balance_due_zats`, `conservation.balances_zats`; (3) the settlement statement body (domain `benzo-settlement-statement-v1`) gained `balance_due_zats` (R3 item 7) — `statementFields` and `SettlementStatement` updated together; where the head's three cases live: the loser's refund receipt is the leaf statement's `refund_zats`/`refund_txid` (proven on superseded leaf0 in `cf-build.out`), the winner's balance is the leaf statement's `balance_due_zats` before it is paid (leaf1/leaf5 show 15100), and the seller's receipt with the forfeited bond is the settlement summary's `seller` row (`54900` = 20000 + 30000 + 4900 forfeit in `cf-build.out`, refused when wrong by `ERROR accounting refused: settlement seller amount`) — the per-leaf statement cannot name the seller since it is keyed by ciphertext; say the word if the seller needs its own signed statement too; (4) `GET /auction/:id` reports `lots` alongside `lot`. Also note the order-layout binding: in multi-lot rounds the PHASE-1 §6 binding slot (offset 1, 32 bytes) carries the **lot id**, not the auction id, so the bidder tooling must write the lot id there.
- One boundary note (not blocking): "one deposit per (bidder, lot)" and "revision admitted before T_submit" are enforced at the operator's admit step in the live path (Track A's `benzo auction` wiring); verify-side enforcement is the supersede rule (latest committed order per (owner key, lot)) plus exactly-once refunds. The CF corpora freeze everything before T_submit by construction.

## Phase 5 Track B run 6 (reviewed by the head; stays on track-b until Phase 4 is PASSED)

Updated: 2026-10-01T23:11:55Z · scope: head review fixes (R4: envelope fixed-length padding + shielded-only destination validator, witness binding, Mode B real invariants + `max_price_zats` rename per R4 item 3 / R3 item 4), gate EN mode registry, then `benzo receipt prove` / `benzo receipt statement` (R3 items 6–7 pure parts) — plus the earlier items 1–3 (Mode B clearing, settlement envelopes, witness certificates). NEAR funding removed per the head message below; items 4–5 (fund/claim, marketplace adapter) are not in the ordered work. No tests (R11). No testnet, funds or keys; scratch only in `tmp/` (gitignored).

Commits: dbc4bf0 (Mode B), c38d85d (envelopes), 82dce10 (witness certificates) · this run: 322a190 (envelope padding + destination validator), 5e34a54 (witness binding), a5e4ac8 (Mode B invariants + rename), 4776c3b (gate EN registry), 516722f (receipt prove + statement).

| Item | State | Evidence (command, output) | Commit |
|---|---|---|---|
| 1. Mode B clearing (`clear/mode-b.ts`) | DONE | Pure `clearModeB` + `clientBuyback` next to Mode A (core.ts untouched): buyback manifest = Mode A manifest + `buyback {budget_zats, floor_zats}` (`floor_zats` renamed `max_price_zats` in a5e4ac8) + `clearing.mode "buyback"`, every other signed field held to the unchanged Mode A rules. Mirrored rules: asks rank ascending, tie by committed leaf index, budget caps spend at the uniform price (= highest accepted ask), marginal band pro-rata `floor(room·q/demand)` with dust by ascending leaf index, `price > floor → above_floor` (now `price > max_price → above_max_price`), exact C refunds and fees only from winner payments (PHASE-3 R2). Same result.json shape, `mode:"buyback"`, `comparison:null`. Corpus `tmp/canon-modeb` (tmp/proof-modeb.ts: fresh 128-byte ask plaintexts tlock-sealed with pinned `tle -e` to real quicknet round 32694698, opened with `tle -d`, real beacon; fresh Ed25519 fixture signer): `bin/benzo verify --dir tmp/canon-modeb --signer HEX` → `OK manifest/freeze/receipts/clear/accounting/accounting-strays`, exit 0 (default mode re-derives every opening with tle and reproduces the Mode B result byte-for-byte). Clearing: price 20000; winners leaf0 10000×2→2, leaf1 10000×3→3, leaf2 20000×3→1, leaf3 20000×5→1 (budget 150000: 10k band full, 20k band pro-rata F=2 units, dust to leaf2 by ascending index), leaf4 45000 `above_floor` (now `above_max_price`), leaf5 60000 `over_cap`, leaf6 qty 0 `over_cap`, leaf above 30k-budget unfilled. Conservation `input 3640000 = payout 140000 + refunds 3500000 + fees 0` (7·C + treasury leg; refunds exact C each). Corrupted copies (`tmp/proof-modeb-neg.mjs`, logs `tmp/proof-logs/modeb-*`): inflated winner payment in result+projection → `ERROR clear refused: canonical result differs` + `ERROR accounting refused: allocation 0 payment`, exit 1; tampered published opening → `ERROR verify refused: opening 0 published differs from re-derived`, exit 1. | dbc4bf0 |
| 2. Settlement envelopes (`envelope/`) | DONE | `envelope/index.ts` + `envelope/bid.ts`: X25519+ChaCha20-Poly1305 sealed box to the per-auction envelope key, one-time Ed25519 owner key, owner signature over (auction_id, ciphertext_hash, envelope_ct), salted `settlement_commitment = SHA256(nonce‖envelope_ct)`, and the unchanged 128-byte layout with real owner material. Library proof (`tmp/proof-envelope-lib.ts` → `tmp/proof-logs/envelope-lib.out`): seal/open round trip (foreign key refused), layout offsets, commitment binding, owner sig verifies; wrong auction, wrong ct hash, substituted envelope, wrong owner, tampered sig all refused. `benzo bid seal` real owner keys (product.ts + seal/src material fields): `tmp/proof-bidseal.ts` runs the shipped command through headless Chromium (`tmp/proof-logs/bidseal.out`): binding OK, ciphertext_hash matches the memo ct, destination absent from output. `benzo verify` envelope check on `tmp/canon-env` (fresh real owner keys + sealed destinations + tlock at quicknet round 32695194; signer-side `openEnvelope` recovers all destinations, none appear in public artifacts) → `OK … envelope …`, exit 0. Corruptions (`tmp/proof-envelope-neg.mjs`, logs `tmp/proof-logs/envelope-canon-*`): flipped owner sig → `ERROR envelope refused: envelope 0 signature`; swapped envelope_ct → same; dropped record → `ERROR envelope refused: missing envelope 2`; smuggled record → `ERROR envelope refused: envelope for unknown ciphertext` (all exit 1). After drand round 32695480 opened (`tmp/proof-logs/bidseal-open.out`): `tle -d` of the sealed bid → 128 bytes, real owner pubkey at 61–93, nonce at 45–61, salted commitment at 93–125 = `SHA256(nonce‖envelope_ct)`, zero pad; `openEnvelope` recovers the destination signer-side; destination absent from plaintext and outputs. | c38d85d |
| 3. Witness certificates (`witness/`) | DONE | `witness/index.ts` + `benzo witness sign\|verify`: certificate over (auction_id, frozen_root, leaf_count, T_freeze, chain anchor = manifest drand chain_hash) signed by board-witness Ed25519 keys (n_w = set size, q_w from the set); the witness set is a **separate signed side-packet** (`witness_set`, signed by the manifest signer, anchored by the same `--signer`), so the manifest shape and Mode A clearing stay untouched. `benzo witness sign --dir tmp/canon-modeb --signer HEX --key $BNZ_STATE_DIR/witness-fix/w2.key` → cert JSON (`tmp/proof-logs/witness-sign.out`); `benzo witness verify` on the clean corpora → `OK witness`, exit 0. `bin/benzo verify` gained a `witness` check (frozen present → set + q_w-of-n_w certificate required; both clean corpora show `OK witness`, exit 0). Refusals (`tmp/proof-witness-neg.mjs`, logs `tmp/proof-logs/witness-*`/`verify-*`): one certificate only → `ERROR witness refused: witness quorum 1-of-3`; the same witness signing twice → `ERROR witness refused: witness quorum 1-of-3` (one witness never counts twice — 5M3's failure mode); two certificates for different roots → `ERROR witness refused: two certificates for different roots` (exit 1 on both `witness verify` and `benzo verify`). | 82dce10 |
| 4. Envelope fixed-length padding + shielded-only destination validator (R4 item 1, R3 item 5) | DONE | `envelope/index.ts`: fixed 512-byte length-prefixed envelope plaintext (u16be length ‖ payload ‖ zero pad) in `sealEnvelope`, stripped and length-checked in `openEnvelope` (exact ciphertext length 32+12+512+16); `envelope/destination.ts` classifies Zcash addresses (bech32/bech32m checksums, ZIP-316 UA container under F4Jumble⁻¹ with 16-byte HRP padding and canonical receiver lengths P2PKH/P2SH 20, Sapling/Orchard 43, Sapling bech32, TEX bech32m, Base58Check transparent) and `requireShieldedDestination` refuses `transparent address (t-addr)`, `TEX address`, `UA without a shielded receiver`, `not a shielded destination` — enforced at seal and again at open (tampered-sealer path). Proof `tmp/proof-dest.ts` (`tmp/proof-logs/dest.out`, 16 checks): scratch encoders cross-checked against f4jumble 0.1.1 vector 1 and the zcash_address 0.13.0 UA vector; 88- vs 110-char destinations → equal 1144-hex (572-byte) ciphertexts; all 4 seal refusals + 2 open-side refusals fire with those exact errors. | 322a190 |
| 5. Witness binding (R4 item 2) | DONE | Signed manifest may carry `witness_set_hash` = SHA-256 of the canonical JSON of the `witness_set` side-packet (`witness/index.ts: witnessSetHash`); `manifest/schema.ts` validates the optional hex64 field. `benzo verify` and `benzo witness verify` enforce it when present (`ERROR witness refused: missing witness set` / `witness set hash mismatch`) and print `WARN no witness set (pre-Phase-5 manifest)` + `OK witness` for pre-Phase-5 dirs. Proofs `tmp/proof-logs/wbind-*` (bound corpus at real quicknet round 32696761): clean → `OK witness` exit 0; set removed → `ERROR witness refused: missing witness set` exit 1; substituted same-signer set → `ERROR witness refused: witness set hash mismatch` exit 1; Phase 2 (`tmp/cold-p2`) and Phase 3 (`tmp/p3-public`) evidence dirs verify again with the WARN + `OK witness`, exit 0. Re-proven at HEAD in the final sweep. | 5e34a54 |
| 6. Mode B real invariants + `max_price_zats` rename (R4 item 3, R3 item 4) | DONE | `clear/mode-b.ts`: `floor_zats` → `max_price_zats` (outcome `above_max_price`); the vacuous conservation line replaced by real invariants enforced in `calculate` and exported `checkResultBuyback` (also treasury leg + exact-C refunds + fees-from-winner-payments): `clearingPrice × Σfill ≤ budget`, `fill ≤ quantity`, winner `ask ≤ clearingPrice`, conservation gains `treasury_zats = payout + fees` (budget copy refused `budget exceeded`); `api/public-auction.ts` calls `checkResultBuyback` for buyback. Rebuilt `tmp/canon-modeb` (round 32696873) → `bin/benzo verify` OK x8 with `treasury_zats 140000`. Corrupted self-consistent results (`tmp/proof-modeb-inv.mjs`, logs `tmp/proof-logs/modeb-inv-*`): budget 260000 > 150000 → `ERROR accounting refused: budget exceeded`; `allocation 2 fill exceeds quantity`; `allocation 0 ask above clearing price` — each exit 1 (re-proven at HEAD, see the final sweep). | a5e4ac8 |
| 7. Gate EN mode registry | DONE | One dispatch per mode, no per-mode verify copies: `clear/layout.ts` (`LAYOUT_V0`, 128-byte versioned order layout + `readOrder`), `clear/registry.ts` (`ModeEntry {layout, client, clear, checkResult, obligations}` for `uniform`/`vickrey`/`buyback`; `modeEntry`/`clientForMode`/`clearForMode`), and `clear/cli.ts`, `clear/auction-cli.ts`, `api/public-auction.ts` all dispatch through it (the per-mode verify copies and the `obligations()` helper in the API are gone; money rules sit next to their modes: `checkResultModeA`/`obligationsModeA` in `clear/core.ts`, `checkResultBuyback`/`obligationsModeB` in `clear/mode-b.ts`). Proofs `tmp/proof-logs/en-*`: `tmp/canon-p3` (Mode A) and `tmp/canon-modeb` (Mode B) verify through the registry (OK x8 each) exit 0; `clear/dist/cli.mjs` reproduces both `result.json` byte-for-byte (signer recomputation boundary); `benzo api serve` `/auction/:id` on Mode B → `valid:true, mode:"buyback"`; unregistered mode `call` → `ERROR clear refused: unknown clearing mode call` exit 1. | 4776c3b |
| 8. `benzo receipt prove` + `benzo receipt statement` (R3 items 6–7 pure parts) | DONE | `api/public-auction.ts`: `inclusionProof`/`checkInclusionProof` — self-contained bundle (auction, manifest_hash, root, leaf_count, leaf_index, ciphertext_hash, deposit, Merkle path, `included`) checkable offline with no network and no directory; `settlementStatementBody`/`checkSettlementStatement` — owner-key-signed JSON `{auction, leaf, fill, price_zats, clearing_price_zats, payment_zats, refund_zats, payout_txid, refund_txid, owner_pubkey, signature}` over domain tag `benzo-settlement-statement-v1` (`envelope/index.ts: statementBinding/signStatement/verifyStatement`), txids taken from the leaf's settlement receipt (Mode B one obligation per leaf = refund + payment, so a paid winner leaf gets `payout_txid = refund_txid`; an unfilled leaf gets `payout_txid: null`), `--check` re-verifies the body against result.json + the opened owner key + the Ed25519 signature. `cli/commands/receipt.ts`: `benzo receipt prove --dir PUBLIC --ciphertext-hash HEX`, `benzo receipt prove --check <proof.json>` (offline), `benzo receipt statement --dir PUBLIC --ciphertext-hash HEX`, `… --check <statement.json>`; emit signs only with the owner key saved under `$BNZ_STATE_DIR/bids/<auction>/<hash>.json` whose pubkey matches the opened plaintext (the `cli/product.ts` bid-seal block saves it there); `receipt show` keeps its R20b interface. Proofs `tmp/proof-logs/stmt-*` (fresh Mode B corpus `tmp/canon-stmt` with real owner keys + settlement receipts, round 32697249): verify OK x8; prove exit 0 (`included:true`, path+root+deposit); prove --check `OK inclusion proof` exit 0, corrupted path hash `ERROR receipt refused: inclusion proof does not verify` exit 1; statement for the winner leaf shows fill 2, price 10000, payment 20000, refund 500000 with both txids set; unfilled leaf `payout_txid: null`; statement --check `OK settlement statement` exit 0; fill 2→3 `ERROR receipt refused: statement differs from result/settlement` exit 1; flipped signature `ERROR receipt refused: statement signature` exit 1; `receipt show` exit 0 unchanged. | 516722f |

Final sweep at 516722f: `npm run typecheck`, `npm run build:core`, `npm run build:cli` clean; `npm run e2e` PASSED (`PASSED default seal in the browser, open with tle after R (38 s)`, log `tmp/proof-logs/sweep-e2e.out`); `bin/benzo verify` OK x8, exit 0 on all six corpora at HEAD: `tmp/canon-modeb`, `tmp/canon-env` (rebuilt under the new rules at round 32697424 — 572-byte padded envelopes, real crate-vector shielded destinations, opens recover them, none appear in public artifacts), `tmp/canon-stmt`, `tmp/canon-p3`, `tmp/cold-p2` and `tmp/p3-public` (last two with `WARN legacy projections` + `WARN no witness set (pre-Phase-5 manifest)` + `OK witness`). Refusals re-proven at HEAD (logs `tmp/proof-logs/sweep-*`, each exit 1 with the named ERROR): missing witness set (`canon-wbind-nowset`), witness set hash mismatch (`canon-wbind-wrongset`), `budget exceeded` (`canon-modeb-budget`, also `canonical result differs`), `allocation 2 fill exceeds quantity` (`canon-modeb-fillqty`), `allocation 0 ask above clearing price` (`canon-modeb-ask`), `unknown clearing mode call` (stdin `tmp/clear-input-unknown.json` → `clear/dist/cli.mjs`), `inclusion proof does not verify`, `statement differs from result/settlement`, `statement signature`. Full logs under `tmp/proof-logs/` (gitignored scratch). Test audit (R11): Track B added no specs; `e2e/` untouched.

### Questions (Phase 5)

- **Head message (2026-10-02, this session; recorded 2026-10-01T20:49Z UTC), relabeled per R21 item 3 (it quotes a head prompt, not the user's own words — the user's verbatim scope words live in PHASE-5 R1/R2):** “the user locked scope on 2026-10-02 — NEAR funding is removed from Phase 5 (Ruling R1 on main; it reaches you at the next merge). Do not build `benzo fund` or any NEAR code.” The ordered work is items 1–3 of PHASE-5 §3 Track B, then READY FOR MERGE; “Add no tests. Touch only Track B files.” PHASE-5.md on track-b still lists NEAR (item 4) and the marketplace adapter (item 5) — both left unbuilt pending the merge of R1 and a Ruling on item 5.
- **Closed by R4 item 1** (71ec6eb): the proposed manifest shape (`buyback {budget_zats, max_price_zats}` + `clearing.mode "buyback"`), the envelope publication record `{ciphertext_hash, envelope_ct, owner_sig}` with the `envelope.json` projection, and the `cli/product.ts` bid-seal block + `seal/` hidden-input wiring are all accepted as built (rows 1–2).
- **Closed by R3 item 4:** `floor_zats` renamed `max_price_zats`, outcome `above_max_price` (row 6, a5e4ac8).
- **Closed by R4 item 2:** witness binding is required via signed-manifest `witness_set_hash` over the `witness_set` side-packet (row 5, 5e34a54); pre-Phase-5 dirs pass with `WARN no witness set (pre-Phase-5 manifest)` — no schema fork.
- **Closed by R4 item 3:** Mode B settlement obligations = one obligation per leaf for `refund + payment`, no `seller` payout row (treasury is the funding leg) — implemented as `obligationsModeB` in the registry (rows 6–7); the R20c receipt/row cross-checks accept `leaf:N` totals accordingly.
- **One note for the head (not blocking):** with one obligation per leaf, `benzo receipt statement` maps the single settlement receipt to `refund_txid`, and sets `payout_txid` to that same receipt only when the leaf is owed a payment (null when unfilled). Separate payout/refund txids would need `settle/` (Track A) to emit separate receipts first.


## Phase 4, Track B (R16, R18, R20, R21 item 5): READY FOR MERGE

Updated: 2026-10-01T19:12:41Z · Last commit: cad928d · Commits: 971da62 (R16+R18), 4258f54 (R20a), 53a7355 (R20b), 2e6b650 (R20c), cad928d (R21 item 5)

- **Questions for the head agent:** none open (prior Q1 dropped per R21 item 3; Q2–Q4 answered by R21 items 4–6).
- **Blockers:** none
- **Scope delivered:** R16 verify re-derives openings with pinned tle + published beacon (`--offline` skips it), R18 `benzo api serve`, R20a canonical `auction.json` per `schemas/public-auction.schema.json` (legacy projections fallback-only), R20b flag interface, R20c separate result/stray obligation checks, R21 item 5 lifecycle-safe read API + `--signer` on `api serve` and the standalone server. No tests (R11). No testnet, wallets, funds, keys or broadcasts.

| Item | State | Evidence (command, output) | Commit |
|---|---|---|---|
| R16 re-derive openings | READY FOR MERGE | Corpus `tmp/p3-public` rebuilt from `docs/evidence/phase-3/settle/` + fresh tle openings + real drand beacon round 32684947 (`tmp/proof-p3.mjs`). `bin/benzo verify tmp/p3-public` → `OK manifest/freeze/receipts/clear/accounting`, exit 0 — the fresh clear equals the **recorded** Phase 3 `result.json`, so the re-derivation matches the original openings. Derive-only copy without `opened.json` → same OK. Flipped published opening → `ERROR verify refused: opening 0 published differs from re-derived`, exit 1. Logs `tmp/proof-logs/r16-*`. | 971da62 |
| R16 `--offline` | READY FOR MERGE | `bin/benzo verify tmp/canon-p3 --signer HEX --offline` → `WARN openings not re-derived` + OK x5, exit 0. Without published openings → `ERROR verify refused: --offline needs one published opening per leaf`, exit 1. No network fetches in this mode. | 971da62 |
| R18 `benzo api serve` | READY FOR MERGE | `bin/benzo api serve --dir tmp/p3-public --port 8791` (through `cli/benzo.ts`, listed in `bin/benzo --help`) → `api listening http://127.0.0.1:8791 …`; all five R11 routes served (`/auction/:id` valid:true, `/operator` blobs only, `/freeze`, `/result`, `/receipt/:ciphertext_hash` inclusion+T2 settlement). Bad dir → `ERROR api refused: missing signer.json` exit 1; missing `--dir` → usage exit 2. Standalone `node api/dist/server.mjs --dir … --port …` (the e2e S1 spawn form) also serves. Logs `tmp/proof-logs/r18-*`. | 971da62 |
| R20a canonical `auction.json` | READY FOR MERGE | `tmp/canon-p3` assembled from real Phase 3 artifacts in `publish()` shape (`tmp/proof-canon.mjs`): `bin/benzo verify --dir tmp/canon-p3 --signer HEX` → OK x5, exit 0. Refusals: `version:2` and a `recipient_hash` key → `ERROR verify refused: auction.json schema`; flipped `manifest.json`/`frozen.json`/`result.json` projections → `ERROR manifest/freeze/clear … projection differs` (each in its own check) and API `GET /auction/:id` → HTTP 400 `{"valid":false,"error":"manifest refused: manifest.json projection differs"}`; clean dir → `valid:true`. Logs `tmp/proof-logs/r20a-*`. | 4258f54 |
| R20a legacy fallback | READY FOR MERGE | `bin/benzo verify --dir tmp/p3-public --signer HEX` and a cold copy of `docs/evidence/phase-2/auction` (`tmp/cold-p2`) → `WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs` + OK x5, exit 0. | 4258f54 |
| R20b flag interface | READY FOR MERGE | `bin/benzo verify --dir PUBLIC --signer HEX [--offline]` and `bin/benzo receipt show --dir PUBLIC --ciphertext-hash HEX [--receipt signed.json]` exactly as R20/Q13 lists them (also `benzo operator view --dir PUBLIC`, see Questions). Wrong `--signer` → `ERROR verify refused: signer mismatch` exit 1; missing `--signer` → usage exit 2. `receipt show` on `tmp/canon-p3` → inclusion + T2 settlement (Phase 3 receipt); with `--receipt tmp/receipt0.json` on the cold Phase 2 copy → `receipt_signed:true`, `settlement:null`. Logs `tmp/proof-logs/r20b-*`. | 53a7355 |
| R20c accounting classes | READY FOR MERGE | Mutations of `tmp/canon-p3` (`tmp/proof-strays.mjs`, logs `tmp/proof-logs/r20c-*`): stray present + seller receipt dropped → `ERROR accounting refused: settlement missing obligation seller` (the pre-fix `resultBound` gate skipped this) while `OK accounting-strays` still runs — neither class masks the other. Stranded stray row → `ERROR accounting-strays … not refunded or exception`; exception row without receipt → OK (T1 defined end); exception row with receipt → ERROR; stray receipt without row → ERROR; smuggled `leaf:9` → `ERROR … neither a result obligation nor a stray deposit`. Rows[0]-amount bump (stray first, real ledger order) → `ERROR accounting-strays refused: stray deposit:…:4608182819 amount`; `leaf:0` bump → `ERROR accounting refused: row leaf:0 amount` — both match cli-auction R1's `/ERROR.*(amount|total|ledger)/`. Clean stray-ok and a cold copy → OK accounting + OK accounting-strays, exit 0 (default tle mode too). | 2e6b650 |
| R21 item 5 lifecycle API + `--signer` | READY FOR MERGE | Fixtures from real Phase 3 artifacts in `publish()` shape (`tmp/proof-r21.mjs`, `tmp/proof-r21-cli.sh`; logs `tmp/proof-logs/r21-api.out`, `tmp/proof-logs/r21-cli.out`): 21 route checks across `tmp/canon-open` (state OPEN, no frozen/opened/result: `/auction/:id` valid:true + state + null result/freeze fields, `/operator` count 0 + C + blobs [], `/freeze` `frozen:false` empty board, `/result` and `/receipt/:h` → HTTP 409 `{"ready":false,"state":"OPEN"}`, unknown id 404), `tmp/canon-counts` (3 published receipts → `/operator` count 3), `tmp/canon-wait` (SEALED-WAIT: full freeze board, `/result` 409 state SEALED-WAIT, `/receipt` inclusion + settlement null), `tmp/canon-open-flip` (flipped manifest.json projection → HTTP 400 `valid:false` manifest error) and settled `tmp/canon-p3` (all routes as before; `/result` equals `result.json`, `/receipt` inclusion + T2 settlement). `bin/benzo verify` still requires frozen (`ERROR verify refused: missing frozen`) and result (`… missing result`) and passes settled `--offline` (OK x6). `--signer HEX` mismatch refuses to serve on `bin/benzo api serve` and `node api/dist/server.mjs` (`ERROR api refused: signer mismatch`, exit 1); malformed `--signer` → usage exit 2; matching signer serves (`api listening` + `/auction/:id` valid:true + `/operator` 200). | cad928d |

Final sweep at 2e6b650 (all exit 0 / HTTP 200): verify canonical, verify `--offline`, verify legacy p3, verify legacy p2 cold copy, operator view, receipt show, `benzo api serve` `/auction` + `/operator`. `npm run build:cli` and `npm run typecheck` pass at every commit. Full logs under `tmp/proof-logs/` (gitignored scratch).

`docs/evidence/phase-4` holds only Track A's `verify.sh` — **no Track A public dir exists yet to cold-copy** (checked `find docs/evidence/phase-4` at 2e6b650). The exact `verify.sh` R invocation shape (`bin/benzo verify --dir <ev>/cli --signer <doc.signer>`) was proven against `tmp/canon-p3`. Ready for Track A's evidence run after merge.

States: TODO · IN PROGRESS · READY FOR MERGE · BLOCKED (outside cause, with repro).

### Public auction directory contract (canonical, per schemas/public-auction.schema.json)

- **Source of truth is `auction.json`** (version, auction_id, signer, manifest packet, state, receipts; optional frozen, result, settlement, opened, beacon). Read per the schema: key set, version 1, state enum, signed-manifest binding, `opened`+`beacon` required from OPENED onward. `signer.json`, `opened.json`, `summary.json` etc. load **only when `auction.json` is absent** (legacy fallback for the Phase 2/3 evidence dirs and their cold copies) and `benzo verify` prints a WARN.
- Canonical dirs must carry `manifest.json`, `frozen.json`, `result.json` **byte-identical** to the document (schema description); each is cross-checked in its own check (`manifest`/`freeze`/`clear`). Other projection files are ignored in canonical mode.
- The trust anchor is the `--signer HEX` flag (R20b); the document's own signer claim must match it. `benzo api serve` / the standalone server accept an optional `--signer HEX` and refuse to serve on mismatch (R21 item 5).
- **Lifecycle-safe reading (R21 item 5):** `frozen`/`opened`/`result` are optional in the document (schema), and the read API serves DRAFT/OPEN/SEALED-WAIT dirs without them: `/auction/:id` reports `state` and `valid` from the checks that apply (manifest always; freeze/receipts once frozen; clear/accounting once result), `/operator` counts admitted `receipts` and returns empty blobs until freeze, `/freeze` serves an empty board (`frozen:false`), and `/result` + `/receipt/:ciphertext_hash` answer 409 `{"ready":false,"state":…}` until the state carries them. `benzo verify` still requires `frozen` and `result` (`ERROR verify refused: missing frozen|missing result`). A canonical projection file whose document field is absent is refused (`… projection without document field`).
- Settlement receipts stay the six T2 fields. Ledger rows use `party` = `leaf:N`, `seller`, or `deposit:<txid>:<diversifier-index>` (settle/plan.ts shapes); anything else is refused.

### Commands (Track B)

Each module in `cli/commands/` exports `{ noun, verb, help, run }`; `run(argv)` returns a number (R17 contract; router `cli/benzo.ts`).

```
benzo verify --dir PUBLIC --signer HEX [--offline]        # exit 0 ok, 1 ERROR lines on stderr, 2 usage
benzo receipt show --dir PUBLIC --ciphertext-hash HEX [--receipt signed.json]
benzo operator view --dir PUBLIC
benzo api serve --dir PUBLIC [--host 127.0.0.1] [--port 8787] [--signer HEX]
node api/dist/server.mjs --dir PUBLIC [--host 127.0.0.1] [--port 8787] [--signer HEX]   # same server, e2e S1 spawn form
```

Default verify re-derives every opening with `$BNZ_STATE_DIR/bin/tle -d` against drand quicknet (chain hash from the published beacon, bound to the manifest `R`/`chain_hash`; bad-MAC decrypts classify `undecryptable` exactly like `clear/auction-cli.ts`), then reproduces `clear/`. ERROR lines carry check ids `manifest`, `freeze`, `receipts`, `clear`, `accounting`, `accounting-strays` — `ERROR freeze …` for anything root/witness/projection-frozen, `… amount …` wording for amount corruptions, matching cli-auction R1's regexes.

## Deviations
- None open. (`benzo operator view --dir PUBLIC` was flagged last run; accepted, R21 item 6.)

## Environment changes
- 2026-10-02 (testnet lane bring-up): the pinned binaries staged in `.benzo/bin` had no cargo install metadata (`.crates.toml`/`.crates2.json` empty), so `tools/bootstrap.sh` aborted at `cargo install zcash-devtool` with `error: binary `zcash-devtool` already exists in destination` (`.benzo/run/bootstrap-setup.log`, first setup attempt). I rebuilt all four pinned Rust tools from `tools/pins.env` with `cargo install --locked --force` into `$BNZ_STATE_DIR` (no code change; log `.benzo/run/bootstrap-force.log`, e.g. `Replacing …/.benzo/bin/zcash-sign` → `Replaced package `unknown` with zcash-sign v0.1.0 (…frost-tools?rev=06c0dbd…)`). `tools/setup-testnet.sh` then passed, and `docs/evidence/phase-1/versions.txt` reproduced byte-identical (`git status` clean after the setup run).

- Carried from earlier runs: `npm ci`; pinned `tle` v1.2.0 in `$BNZ_STATE_DIR/bin/tle`; Playwright Chromium. Run 13 added none. The Phase 3 beacon was fetched read-only from `BNZ_DRAND_URLS` (public drand API) for the proof corpus.

## Deferred
- Full JSON-Schema validation of `auction.json` (hand checks cover the schema's key set and every field the checks consume; no validator dependency in budget).

## Questions

- **Verify-bundle provenance after the B33 merge (informational, nothing blocked).** Run 33 recorded the
  verify bundle as `effd9853…` (track-b's tree at `50ee067`), but the merge resolved
  `dist/benzo-verify.mjs` to Track A's rebuild at `9634882` (`80754445…`). The committed state is
  self-consistent — `npm run check:bundle` PASS at `3ca5c9f` and the fresh-clone rebuild reproduces
  `80754445…` — so B34 recorded that digest everywhere (item 1). If R32's "rebuild in the real checkout
  after the merge" step is supposed to produce a commit of its own at merges, it did not happen here;
  say the word if you want the bundle re-committed from this checkout (bytes would be identical).

- **Head task message (2026-10-02, this session): two instructions conflict; one-line resolution, please fold into a Ruling or tell me to revert.** Verbatim: “Run `tools/setup-testnet.sh` from the benzo-b root with your `.env` loaded … Make sure frostd listens on :2745, not :2744.” and “Add no tests. Do not change code in this run.” `tools/setup-testnet.sh` started frostd **without `-p`** (frostd's default is :2744, Builder A's port) while its DKG clients connect to `$BNZ_FROSTD_ADDR` (`localhost:2745` here), so the mandated run could not succeed as written and its bind would have targeted A's port. I made the minimal one-line change — `b30e826`, `-p "${BNZ_FROSTD_ADDR##*:}"` on the frostd line, `bash -n` clean — and nothing else. **Same bug in `e2e/lib/frost.ts`** (`startFrostd` passes no `-p`; clients use `BNZ_FROSTD_ADDR`): any project that calls it would bind :2744 in this lane. Left untouched (out of this run's scope); needs a ruling before I fix it. `npm run e2e`'s default project (`seal-open`) does not call `startFrostd`, so its baseline above is unaffected.

None open otherwise. The prior entries are closed by R21: **Q1** dropped (item 3 — only the user's own words are recorded as user instructions; the entry had quoted a head prompt), **Q2** budget ~626 lines accepted (item 4), **Q3** load shapes ruled (item 5: `verify` keeps requiring `frozen`/`result`; the read API is lifecycle-safe — done in cad928d), **Q4** `operator view --dir PUBLIC` accepted (item 6).

Open questions live in the current run's section (run 32: the `/allocation` privacy wording and the
launch delivery row order).

## Test audit (R11: Track B adds none)
No new specs. Proof is the logged manual runs above (scratch only in `tmp/`, never committed). The R20c corpus shows the pre-fix masking failure mode explicitly: with any `deposit:` receipt present, the old `resultBound` gate skipped every result obligation; `tmp/proof-logs/r20c-stray-missing-obligation.out` shows it now refused.

## Last session (run 33, batch B33 — complete)
- **Outcome:** items 1–4 DONE with proof (commits `39ba6c0`..`50ee067`): `test-audit.md` (54 tests vs the
  ceiling of 8; **R35** ruled: keep 14 drivers, retire 8, fold 25 into specs, red/green at RG); private-repo
  hygiene checklist + leak re-run (353 rows, 22 new all classified); README refresh (gate DOC); the R35.2
  retire-8 deletion run; package digests regenerated (`f123cdde…`, superseded by run 34). Its questions were
  all closed (R36/Q1 — repo stays private, no license; R35/Q2; `834e465`/Q3; R37/Q4–Q5, incl. `cli/build.mjs`
  cleaning `cli/dist`).

## Previous session (run 31)
- **Window:** 2026-10-05T17:45Z–20:05Z (run 31, items 1–3, batch complete).
- **Outcome:** All three offline items delivered with proof. (1) `settle/batching.ts` (`planBatches`,
  SQLite byte order) + `tools/repro/batching-equal.ts` equivalence against a real `Ledger` (PASS
  77/36 batches at cap 13/28), mutation B31-a red at both caps, bench stage `batch-plan` at cap 28 +
  projection, and `npm run bench -- --bids 17000` **PASS** end to end (608 batches,
  estimated_fee_zats 88040000; 24.13 h at cap 13 / 20.85 h at cap 28 — `bench.json`); harness fix:
  the bench manifest pins `envelope_keys` (`3bfde30`). (2) leak-audit re-run over `7c235d6..5475c60`:
  106 sensitive entries from own `.benzo/`, 331 final findings all classified A–G, no real finding
  (`leak-findings-2026-10-05.json`, `leak-audit.md`). (3) `EVIDENCE.md`: gate table + LP-0004
  per-auction rows (22 cycles), `lp-0004.md` pointing at it. R32 closed both run-31 questions and
  accepted the rebuilt verify bundle (`973feac`).
