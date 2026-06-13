# Trusted Setup Ceremony

Benzo's Groth16 circuits use a **public Phase-1** (Hermez `powersOfTau28_hez_final_16`)
plus a **Phase-2 contribution chain per circuit**. `scripts/ceremony.sh <circuit>`
runs a multi-contribution Phase-2 (≥3 contributors + a final randomness beacon) and
writes a full transcript.

## Reproduce
```bash
bash scripts/ceremony.sh joinsplit   # or shield / unshield
```

## Checked in
- `scripts/ceremony.sh` — reproducible ceremony driver.
- `ceremony/TRANSCRIPT-<circuit>.txt` — every contribution + beacon hash, and the
  `snarkjs zkey verify` result (chain validity).
- `ceremony/<circuit>/<circuit>_vk.json` — the resulting verification key.
- `.zkey` files are large and **gitignored** — regenerate with the script.

## Sample run (joinsplit)
3 contributions (`benzo-contributor-1..3`) + a `benzo-final-beacon`, then
`snarkjs zkey verify` → **`ZKey Ok!`** (the full contribution chain validates).

## Production requirement (stated honestly)
A production deployment **MUST** run this with **independent external contributors**
so no single party holds all the toxic waste. This checked-in transcript demonstrates
the tooling and a verified chain — it is **not** a substitute for a real multi-party
ceremony, and the currently-deployed **testnet** verification keys were produced by a
single-contributor Phase-2 (see `docs/THREAT_MODEL.md`). Re-running a production
ceremony regenerates the VKs, which must then be re-registered on-chain via the
verifier's governed `rotate_vk` / the pool's `set_verifier`.
