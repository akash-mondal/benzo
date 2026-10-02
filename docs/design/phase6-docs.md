# Design: Phase 6 docs, first pass (Track B)

Head-owned brief (2026-10-02). Three files, written for a judge or a stranger who has never seen Benzo. Use plain English, short sentences and no hype. Every command shown must be one you ran and logged in STATUS-B, with its real output, trimmed. Do not invent numbers: take them from evidence files and cite the path.

## 1. `README.md` (replace the current one; about 150–200 lines)
1. **Headline:** use the Zecathon Private Markets track's own words, quoted: *"the price should be public and the participants should not."* Then one line: Benzo is a sealed-bid market engine on Zcash where nobody, including the operator, can read an order before the drand round R.
2. **How it works,** in 6 steps with one sentence each:
   1. identical shielded deposit C with a tlock-sealed order in the memo;
   2. the set is frozen and witness-certified before R;
   3. anyone opens it at R;
   4. a public deterministic clearing through the mode registry;
   5. a 2-of-3 FROST vault pays, and every signer recomputes first;
   6. private receipts, and `benzo verify`.
3. **Markets:** a table of the modes in the registry: uniform auction, Vickrey, collection drop (drand serial shuffle), launch (tranches + minimum raise), buyback (recurring windows + report), RFQ (reverse-Vickrey, two-quote minimum) and blind OTC. One line each. Mark each as **testnet-proven live** or **offline-proven**, from the actual evidence. Today only Mode A is live-proven; everything else is offline-proven on track-b.
4. **What's private, what's public:** a 2-column table. Before R, nothing about orders is visible. After R, prices and quantities are public but anonymized, and not linkable to any wallet. Refund destinations travel only inside envelopes.
5. **Honest limits:** copy DESIGN §14 and add these:
   - all orders open at R (losing bids are not secret forever);
   - signer collusion (2 of 3) can misbehave, and `benzo verify` shows it after the fact;
   - each signer can read every refund destination (needed to check outputs);
   - delivery of off-chain assets relies on the adapter;
   - testnet only so far.
6. **Quick start:** `npm ci`, the build commands, then `benzo verify` on the shipped evidence dir (link to the verify guide).
7. **Evidence:** links to `docs/evidence/phase-1…4/EVIDENCE.md` and the Phase 6 bench (`docs/evidence/phase-6/bench.json`, quoting the 17,000-bid open/clear/verify times from that file).
8. **Repo layout:** one line per top-level directory.

## 2. `docs/why-timelock.md` (about 60 lines)
Answer the known objection from the Starknet STRK20 sealed-bid RFP: *"Timelock encryption — trusted timelock servers, approximate decryption time"*:
- drand quicknet is a **threshold** beacon run by independent League of Entropy members; no single server releases rounds. State the threshold assumption plainly (an honest limit, from DESIGN §14).
- **Exact time:** round R maps to an exact UTC time, genesis + period × (R − 1). Take genesis, period and chain hash from `QUICKNET` in `manifest/schema.ts` and show the formula with the real numbers.
- **Freeze before reveal:** the frozen root is witness-certified before R, so nothing can be added after anyone could decrypt.
- **No beacon, no harm:** if R never arrives, every deposit C is refunded without decrypting anything (the cancel path).
- **Real money:** orders are backed by real shielded deposits, not commitments.
- **The beacon is checked:** verify checks the published beacon's BLS signature against the quicknet public key.

## 3. `docs/verify-it-yourself.md` (about 60 lines)
A stranger with only Node 24 and a copy of a public auction directory:
1. get `dist/benzo-verify.mjs` and check its sha256 against `docs/verify-bundle.sha256`;
2. `node benzo-verify.mjs --dir <dir> --signer <hex>`, with real output from a cold copy in /tmp;
3. what each check line means (`manifest`, `freeze`, `witness`, `receipts`, `clear`, `envelope`, `accounting`, `accounting-strays`, `missing-deposits`, `delivery`, `report`), one line each;
4. `--fetch-beacon` for older directories, and what the WARN lines mean;
5. a tampering demo: flip one byte, then show the ERROR it produces.

## Done when
All three files are committed, each command is reproduced in STATUS-B with its output, and every number cites its source file. Then set READY FOR MERGE.
