# Verify it yourself

You need Node 24 and two things: the verification bundle and a copy of a public auction directory. The bundle is one
file, `dist/benzo-verify.mjs`; it has no dependencies, reads only the directory you give it, and touches the network
only with `--fetch-beacon`. The trust anchor is the `--signer` key you pass — the key *you* decided to trust; the
directory's own `signer.json` only says what it claims.

## 1. Check the bundle

```text
$ shasum -a 256 dist/benzo-verify.mjs
b122bf2b3503ee319f5d638c32b968ffe2fd03bd08875b5dc4648cfcce1451ce  dist/benzo-verify.mjs
$ cat docs/verify-bundle.sha256
b122bf2b3503ee319f5d638c32b968ffe2fd03bd08875b5dc4648cfcce1451ce  dist/benzo-verify.mjs
```

They must match. The build is reproducible: `npm run build:verify` regenerates the same bytes.

## 2. Run it on a cold copy

Exact commands and the check lines of one run (2026-10-03, full transcript recorded in
`docs/evidence/phase-6/pk-package-verify.out`), from `/tmp`, using the packaged tarball
(`npm run package` builds it; the same checks print whether you drive the bundle through the CLI
or run it directly):

```text
$ tar -xzf benzo-0.1.0.tgz
$ cp -R docs/evidence/phase-4/cli benzo-0.1.0/auction
$ cd benzo-0.1.0
$ ./bin/benzo verify --dir auction --signer 302a300506032b65700321000ad232b8429de606bf4c437c476fff5b233023d1037e0c908adaf149badb7891
OK projection
OK missing-deposits
OK delivery
OK report
OK manifest
OK freeze
OK witness
OK receipts
OK clear
OK envelope
OK claims
OK accounting
OK accounting-strays
WARN no witness set (pre-Phase-5 manifest)
exit=0
```

(The `WARN` prints with the witness check; its position among the `OK` lines varies between runs.
A `WARN` is a disclosure, not a failure.) Exit 0 means every check passed. That signer key is the
one this auction was signed with (`auction/signer.json`). Without the package, copy
`dist/benzo-verify.mjs` out and run `node dist/benzo-verify.mjs --dir auction --signer …` — the
output is the same.

## 3. What each check line means

- `projection` — the loose projection files beside `auction.json` (`opened.json`, `beacon.json`,
  `receipts.json`, `summary.json`, …) agree byte-for-byte with the canonical document, and no
  projection exists without its document field.
- `missing-deposits` — if the directory lists mined deposits, any pre-deadline deposit missing from the frozen set is flagged as owed a refund.
- `delivery` — paid-but-not-delivered complaints are signed, unique and within the promised serial range.
- `report` — for recurring buybacks, the published per-window report matches the round results.
- `manifest` — the manifest is valid and signed by the signer you named, and the result is bound to it.
- `freeze` — the frozen set matches the directory, and the Merkle root covers every admitted ciphertext and deposit.
- `witness` — the frozen root carries the witness board's certificate from before the release round.
- `receipts` — every admission receipt is a valid signature over its ciphertext and deposit, in order.
- `clear` — the published result equals the clearing recomputed from the opened orders.
- `envelope` — every settlement envelope is intact, signed by its bidder and bound to its ciphertext; destinations are never printed.
- `claims` — every published claim carries an owner signature that verifies against the owner key in the re-derived opening, and every stray claim's note identity and memo hash are attested per row by two agreeing host-signed approval maps of the batch that paid it.
- `accounting` — payouts + refunds + fees + balances equal the deposits taken in; receipts match obligations.
- `accounting-strays` — every deposit outside the result is refunded or listed as a signed exception, exactly once.

In canonical directories the single `auction.json` document is the source of truth; loose sidecar files such as
`opened.json` are read only for older (legacy) directories.

## 4. Older directories and `--fetch-beacon`

Older directories published no beacon, so the default refuses and says what to do (`run13-verify-old.out`):

```text
$ SIGNER=302a300506032b65700321000ad232b8429de606bf4c437c476fff5b233023d1037e0c908adaf149badb7891
$ node benzo-verify.mjs --dir auction-old --signer $SIGNER
WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs
ERROR verify refused: no published beacon; rerun with --fetch-beacon
exit=1
$ node benzo-verify.mjs --dir auction-old --signer $SIGNER --fetch-beacon
WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs
WARN beacon fetched (not published)
OK missing-deposits
… the same thirteen OK lines as step 2 …
exit=0
```

With `--fetch-beacon` the bundle fetches round R from drand and BLS-checks its signature against the pinned quicknet key
before verifying. The WARN lines mean:

- `legacy projections (no auction.json)` — the directory uses the older file layout; the checker reads it and says so.
- `beacon fetched (not published)` — the directory carried no beacon; the signature was fetched from drand and checked first. A directory that does publish a beacon verifies fully offline, and with `--fetch-beacon` the fetched signature must equal the published one or verification refuses.
- `no witness set (pre-Phase-5 manifest)` — the auction predates witness certificates, so no witness quorum exists to check.

## 5. Tampering demo

Flip one byte of an opened bid, then verify again (`run13-tamper-doc.out`):

```text
$ node -e "const fs=require('fs');const p='tampered2/auction.json';const s=fs.readFileSync(p,'utf8');const k='plaintext_hex\":\"';const j=s.indexOf(k)+k.length;const c=s[j];fs.writeFileSync(p,s.slice(0,j)+(c==='0'?'1':'0')+s.slice(j+1));console.log('flipped one hex digit of leaf 0 plaintext at offset',j,c,'->',c==='0'?'1':'0')"
flipped one hex digit of leaf 0 plaintext at offset 22916 0 -> 1
$ node benzo-verify.mjs --dir tampered2 --signer $SIGNER
ERROR verify refused: opening 0 published differs from re-derived
exit=1
```

The checker re-derives every opening from the sealed ciphertext and the beacon, so a doctored public file cannot hide.
The beacon itself is checked the same way: flip one hex digit of its signature and you get
`ERROR verify refused: beacon BLS signature invalid` (`run13-tamper-beacon.out`, see [`why-timelock.md`](why-timelock.md)).
Any single changed byte shows up as an `ERROR` line and exit 1.
