# Live regression under R28 (NU7 testnet)

- 12 of 13 IDs PASS. The cleanup sweep now waits for maturity and succeeded.
- P1 FAIL: the tampered-manifest refusal said "Expected property name… in JSON" instead of "manifest byte hash". This regression came from cfd2f84: product moved onto the registry, whose `modeEntry` parsed the bytes before checking them.
- Fixed in e497c9d: `modeEntry` checks the byte hash first. Re-checked directly afterwards: `bid prepare` on a one-bit-flipped manifest gives `ERROR benzo refused: manifest byte hash`. A full rerun follows.
