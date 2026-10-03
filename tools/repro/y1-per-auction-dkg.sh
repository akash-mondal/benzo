#!/usr/bin/env bash
# Y1 (Phase 5 part 1 §2, gate Y): two auctions in one run produce two different group keys and two different escrow
# UAs, each from a fresh 2-of-3 DKG run ON the three OrbStack signer hosts (shares never leave their machine).
# Also proves the refusals: three disagreeing keys, the global Phase 1 key, and an earlier auction's key (5M5).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
set -a; . ./.env; set +a; S="$ROOT/${BNZ_STATE_DIR#./}"
OUT="${1:-tmp/y1}"; mkdir -p "$OUT"; LOG="$OUT/y1.out"; : > "$LOG"
say() { echo "$*" | tee -a "$LOG"; }
FROSTD="host.orb.internal:${BNZ_FROSTD_ADDR##*:}"
"$S/bin/frostd" -i 127.0.0.1 -p "${BNZ_FROSTD_ADDR##*:}" -c "$S/tls/frostd.pem" -k "$S/tls/frostd.key" > "$S/run/frostd-y1.log" 2>&1 & FP=$!
trap 'kill $FP 2>/dev/null' EXIT; sleep 2
host() { orb run -m "benzo-$1" -u benzo /home/benzo/.benzo/bin/benzo "${@:2}"; }
pk() { orb run -m "benzo-$1" -u benzo cat /home/benzo/.benzo/contacts/$1.pubkey; }
PKB=$(pk bob | tr -d '\n'); PKC=$(pk carol | tr -d '\n')
dkg() { # id -> prints the three reported group keys, comma separated
  local id=$1
  host alice sign dkg --id "$id" --name alice --server "$FROSTD" --peers "$PKB,$PKC" > "$OUT/$id-alice.json" 2> "$OUT/$id-alice.err" & local a=$!
  sleep 2
  host bob sign dkg --id "$id" --name bob --server "$FROSTD" > "$OUT/$id-bob.json" 2> "$OUT/$id-bob.err" & local b=$!
  host carol sign dkg --id "$id" --name carol --server "$FROSTD" > "$OUT/$id-carol.json" 2> "$OUT/$id-carol.err" & local c=$!
  wait $a && wait $b && wait $c || { say "ERROR dkg $id failed: $(cat $OUT/$id-*.err | tail -3)"; exit 1; }
  for n in alice bob carol; do python3 -c "import json;print(json.load(open('$OUT/$id-$n.json'))['group_key'])"; done | paste -sd, -
}
ID1=$(openssl rand -hex 32); ID2=$(openssl rand -hex 32)
K1=$(dkg "$ID1"); K2=$(dkg "$ID2")
say "auction1 $ID1 reported keys ${K1//,/ }"; say "auction2 $ID2 reported keys ${K2//,/ }"
R1=$(bin/benzo auction keys --id "$ID1" --group-keys "$K1"); R2=$(bin/benzo auction keys --id "$ID2" --group-keys "$K2")
G1=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['group_key'])" "$R1"); U1=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['escrow_ua'])" "$R1")
G2=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['group_key'])" "$R2"); U2=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['escrow_ua'])" "$R2")
GLOBAL=$(cat "$S/group-key.txt")
ok=1; check() { if [ "$2" = 1 ]; then say "PASS $1"; else say "ERROR $1"; ok=0; fi; }
check y1-three-signers-agree-1 "$([ "$(tr , '\n' <<<"$K1" | sort -u | wc -l | tr -d ' ')" = 1 ] && echo 1 || echo 0)"
check y1-three-signers-agree-2 "$([ "$(tr , '\n' <<<"$K2" | sort -u | wc -l | tr -d ' ')" = 1 ] && echo 1 || echo 0)"
check y1-group-keys-differ "$([ "$G1" != "$G2" ] && echo 1 || echo 0)"
check y1-escrow-uas-differ "$([ "$U1" != "$U2" ] && echo 1 || echo 0)"
check y1-not-global-key "$([ "$G1" != "$GLOBAL" ] && [ "$G2" != "$GLOBAL" ] && echo 1 || echo 0)"
check y1-shares-on-hosts-only "$([ ! -e "$S/auctions/$ID1" ] && [ ! -e "$S/auctions/$ID2" ] && echo 1 || echo 0)"
ID3=$(openssl rand -hex 32)
E1=$(bin/benzo auction keys --id "$ID3" --group-keys "$G1,$G1,$G1" 2>&1 || true)
check y1-5M5-reused-key-refused "$(grep -q 'reused from auction' <<<"$E1" && echo 1 || echo 0)"
E2=$(bin/benzo auction keys --id "$ID3" --group-keys "$G1,$G2,$G1" 2>&1 || true)
check y1-disagreeing-keys-refused "$(grep -q 'report different group keys' <<<"$E2" && echo 1 || echo 0)"
E3=$(bin/benzo auction keys --id "$ID3" --group-keys "$GLOBAL,$GLOBAL,$GLOBAL" 2>&1 || true)
check y1-global-key-refused "$(grep -q 'global Phase 1 key' <<<"$E3" && echo 1 || echo 0)"
say "escrow1 ${U1:0:20}… escrow2 ${U2:0:20}…"
[ $ok = 1 ] && say "RESULT PASS all Y1 assertions" || { say "RESULT FAIL"; exit 1; }
