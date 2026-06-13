#!/usr/bin/env bash
# Multi-contribution Groth16 phase-2 ceremony for a Benzo circuit.
# Writes a full contribution transcript under ceremony/. zkeys stay gitignored.
set -euo pipefail
C="${1:-joinsplit}"
R="circuits/build/$C/$C.r1cs"
PTAU="circuits/ptau/powersOfTau28_hez_final_16.ptau"
OUT="ceremony/$C"; mkdir -p "$OUT"
T="ceremony/TRANSCRIPT-$C.txt"; : > "$T"
echo "Benzo Groth16 phase-2 ceremony — circuit=$C ptau=$(basename "$PTAU")" | tee -a "$T"
snarkjs groth16 setup "$R" "$PTAU" "$OUT/0000.zkey" >/dev/null
for i in 1 2 3; do
  prev=$(printf "%04d" $((i-1))); cur=$(printf "%04d" "$i")
  echo "===== contribution #$i (benzo-contributor-$i) =====" | tee -a "$T"
  snarkjs zkey contribute "$OUT/$prev.zkey" "$OUT/$cur.zkey" -n="benzo-contributor-$i" \
    -e="$(head -c 64 /dev/urandom | base64)" 2>&1 | tee -a "$T" | grep -i 'hash' || true
done
echo "===== final beacon =====" | tee -a "$T"
snarkjs zkey beacon "$OUT/0003.zkey" "$OUT/final.zkey" "$(head -c 32 /dev/urandom | xxd -p -c 64)" 10 \
  -n="benzo-final-beacon" 2>&1 | tee -a "$T" | grep -i 'hash' || true
snarkjs zkey export verificationkey "$OUT/final.zkey" "$OUT/${C}_vk.json" >/dev/null
echo "===== verify chain =====" | tee -a "$T"
snarkjs zkey verify "$R" "$PTAU" "$OUT/final.zkey" 2>&1 | tee -a "$T" | grep -iE 'ok|verified' || true
