# Why drand timelock is safe enough here

Benzo hides every order until a published round R. The known objection, from the Starknet STRK20 sealed-bid RFP:
*“Timelock encryption — trusted timelock servers, approximate decryption time.”* Both halves deserve a real answer.

## Not a server: a threshold

There is no Benzo decryption server. Orders are sealed to the drand quicknet beacon, a threshold beacon run by
independent League of Entropy members. No single member holds the key for a future round; enough of them must cooperate
to produce the signature for R, and they publish it for everyone at once.

The honest limit, from `docs/research/DESIGN.md` §14: if the drand signing threshold itself colludes, they can produce
future-round signatures early and open orders before R. That is the assumption this design rests on, stated as a limit.

## The release time is exact

Round R maps to one exact UTC instant: `release = genesis + period × (R − 1)`. The constants are pinned in
`manifest/schema.ts` (`QUICKNET`): genesis `1692803367`, period `3` seconds, chain hash
`52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`. The same formula is at `manifest/schema.ts:104`,
which refuses any auction that does not freeze before that instant. A real example, the auction in
`docs/evidence/phase-4/cli` (round R = 32701714, from its `beacon.json`):

```text
$ node -e "const genesis=1692803367,period=3;for(const R of [32701714,32704232])console.log('R='+R,'->',new Date((genesis+(R-1)*period)*1000).toISOString())"
R=32701714 -> 2026-10-02T02:35:06.000Z
R=32704232 -> 2026-10-02T04:41:00.000Z
```

The live chain agrees with the formula. This run fetched quicknet's latest round and compared the formula's time with
the wall clock at the fetch (2026-10-02; re-run on 2026-10-18 with the same result shape, `docs/evidence/phase-6/doc/timelock-clock.out`):

```text
$ curl -s https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/latest | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const genesis=1692803367,period=3;console.log('latest round',j.round,'formula time',new Date((genesis+(j.round-1)*period)*1000).toISOString(),'wall clock',new Date().toISOString())})"
latest round 32707994 formula time 2026-10-02T07:49:06.000Z wall clock 2026-10-02T07:49:09.096Z
```

The release instant is exact to the second; only the network can delay the signature reaching you.

## Freeze before reveal

The set of orders is frozen and its root is witness-certified before R, and `manifest/schema.ts` refuses any manifest
whose freeze time is not strictly before the release instant. Nobody, including the operator, can add or swap an order
at a time when decryption is already possible.

## If the beacon never comes, nobody loses money

If round R is never released, no order can be opened — and none needs to be. The auction is cancelled and every deposit
C is refunded without decrypting anything (`docs/research/DESIGN.md` §6). A missing beacon costs bidders time, not money.

## Orders are backed by real deposits

An order is not a commitment that can be abandoned. It rides in the memo of a real shielded ZEC deposit of the fixed
amount C, mined on chain before the freeze (`docs/evidence/phase-1/EVIDENCE.md` shows the deposits, memos and scans).
Losing costs the fee; lying is not free.

## The beacon is checked before anything is decrypted

`benzo verify` does not take the round's signature on trust. It checks the published signature against the pinned
quicknet public key before decrypting anything. Change one hex digit of the signature and verification refuses
(the exact commands are in [`verify-it-yourself.md`](verify-it-yourself.md); output from
`docs/evidence/phase-6/doc/verify-walkthrough.out`):

```text
ERROR verify refused: beacon BLS signature invalid
exit=1
```
