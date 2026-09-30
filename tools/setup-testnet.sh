#!/usr/bin/env bash
# One-time Phase 1 setup (docs/PHASE-1.md section 5, steps 1-5): pinned tools, local TLS for frostd, a 2-of-3 RedPallas
# FROST group from a dealerless DKG, the vault UFVK and view-only vault wallet, and the bidder wallet.
# Safe to re-run: it never regenerates keys once $BNZ_STATE_DIR/frost/ or the vault wallet exists.
# With BNZ_EVIDENCE_DIR set, it writes setup/group-key.txt there. Its full log goes to $BNZ_STATE_DIR/run/setup.log.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
set -a; . ./.env; set +a
STATE="$ROOT/${BNZ_STATE_DIR#./}"
BIN="$STATE/bin"
mkdir -p "$STATE/run"
LOG="$STATE/run/setup.log"
exec 3>&1 >>"$LOG" 2>&1
say() { echo "$*" >&3; echo "== $(date -u +%FT%TZ) $*"; }

say "1. bootstrap (log: \$BNZ_STATE_DIR/run/bootstrap-setup.log)"
tools/bootstrap.sh >"$STATE/run/bootstrap-setup.log" 2>&1

tip() {
  "$BIN/grpcurl" -import-path "$STATE/proto" -proto service.proto "$BNZ_LWD_URL" \
    cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock | jq -er '.height | tonumber'
}

TLS="$STATE/tls"
if [ ! -f "$TLS/frostd.pem" ]; then
  say "   local CA and frostd certificate (SANs localhost, 127.0.0.1)"
  mkdir -p "$TLS" && chmod 700 "$TLS"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 120 -subj "/CN=benzo local CA" \
    -keyout "$TLS/rootCA.key" -out "$TLS/rootCA.pem"
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=localhost" \
    -keyout "$TLS/frostd.key" -out "$TLS/frostd.csr"
  printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' >"$TLS/ext.cnf"
  openssl x509 -req -in "$TLS/frostd.csr" -CA "$TLS/rootCA.pem" -CAkey "$TLS/rootCA.key" -CAcreateserial -days 120 \
    -extfile "$TLS/ext.cnf" -out "$TLS/frostd.pem"
fi

FROST="$STATE/frost"
fc() { SSL_CERT_FILE="$TLS/rootCA.pem" "$BIN/frost-client" "$@"; }
if [ ! -d "$FROST" ] && [ ! -d "$STATE/vault" ]; then
  say "2. frostd and a dealerless 2-of-3 RedPallas DKG"
  PIDFILE="$STATE/run/frostd.pid"
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    say "   a frostd from \$BNZ_STATE_DIR/run/frostd.pid is already running; stop it first"; exit 1
  fi
  RUST_LOG=info nohup "$BIN/frostd" -i 127.0.0.1 -c "$TLS/frostd.pem" -k "$TLS/frostd.key" >"$STATE/run/frostd-dkg.log" 2>&1 &
  echo $! >"$PIDFILE"
  trap 'kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"' EXIT
  for _ in $(seq 1 50); do curl -s --cacert "$TLS/rootCA.pem" -o /dev/null "https://$BNZ_FROSTD_ADDR/" && break; sleep 0.2; done

  mkdir -p "$FROST" && chmod 700 "$FROST"
  for n in alice bob carol; do
    fc init -c "$FROST/$n.toml"
    fc export -n "$n" -c "$FROST/$n.toml" >"$FROST/$n.export" 2>&1
    grep -o 'zffrost1[a-z0-9]*' "$FROST/$n.export" >"$FROST/$n.contact"
    sed -n 's/^Public Key: //p' "$FROST/$n.export" >"$FROST/$n.pubkey"
  done
  for n in alice bob carol; do
    for m in alice bob carol; do [ "$n" = "$m" ] || fc import -c "$FROST/$n.toml" "$(cat "$FROST/$m.contact")"; done
  done
  PK_BOB="$(cat "$FROST/bob.pubkey")"; PK_CAROL="$(cat "$FROST/carol.pubkey")"

  DESC="benzo phase 1 vault"
  {
    echo "frost-client dkg -c \$BNZ_STATE_DIR/frost/alice.toml -d '$DESC' -s $BNZ_FROSTD_ADDR -C redpallas -t 2 -S $PK_BOB,$PK_CAROL"
    echo "frost-client dkg -c \$BNZ_STATE_DIR/frost/bob.toml -d '$DESC' -s $BNZ_FROSTD_ADDR -C redpallas -t 2"
    echo "frost-client dkg -c \$BNZ_STATE_DIR/frost/carol.toml -d '$DESC' -s $BNZ_FROSTD_ADDR -C redpallas -t 2"
  } >"$FROST/dkg-commands.txt"
  fc dkg -c "$FROST/alice.toml" -d "$DESC" -s "$BNZ_FROSTD_ADDR" -C redpallas -t 2 -S "$PK_BOB,$PK_CAROL" </dev/null &
  a=$!
  # bob and carol join the one session they are invited to, so wait until frostd lists it for them.
  for _ in $(seq 1 60); do
    fc sessions -c "$FROST/bob.toml" -s "$BNZ_FROSTD_ADDR" 2>&1 | grep -q '^Session with ID' && break; sleep 0.5
  done
  fc dkg -c "$FROST/bob.toml" -d "$DESC" -s "$BNZ_FROSTD_ADDR" -C redpallas -t 2 </dev/null &
  b=$!
  fc dkg -c "$FROST/carol.toml" -d "$DESC" -s "$BNZ_FROSTD_ADDR" -C redpallas -t 2 </dev/null &
  c=$!
  wait $a && wait $b && wait $c
  kill "$(cat "$PIDFILE")"; rm -f "$PIDFILE"; trap - EXIT

  keys="$(for n in alice bob carol; do fc groups -c "$FROST/$n.toml" 2>&1 | sed -n 's/^Public key //p'; done | sort -u)"
  [ "$(wc -l <<<"$keys")" -eq 1 ] || { say "   the three configs disagree on the group key"; exit 1; }
  echo "$keys" >"$STATE/group-key.txt"

  say "3. vault UFVK from the group key (zcash-sign generate)"
  "$BIN/zcash-sign" generate -n "$BNZ_NETWORK" --ak "$keys" >"$STATE/zcash-sign-generate.txt"
  sed -n 's/^Unified Full Viewing Key: "\(.*\)"$/\1/p' "$STATE/zcash-sign-generate.txt" >"$STATE/ufvk.txt"
  [ -s "$STATE/ufvk.txt" ] || { say "   zcash-sign generate printed no UFVK"; exit 1; }

  say "4. vault wallet (view-only, birthday = tip - 10)"
  birthday=$(( $(tip) - 10 ))
  echo "$birthday" >"$STATE/vault-birthday.txt"
  "$BIN/zcash-devtool" wallet -w "$STATE/vault" init-fvk --name vault --fvk "$(cat "$STATE/ufvk.txt")" \
    --birthday "$birthday" -s "$BNZ_LWD_URL"
elif [ ! -d "$FROST" ] || [ ! -d "$STATE/vault" ]; then
  say "   exactly one of \$BNZ_STATE_DIR/frost and \$BNZ_STATE_DIR/vault exists; refusing to generate keys"; exit 1
else
  say "2-4. FROST group and vault wallet exist; not regenerating keys"
fi

if [ ! -d "$STATE/bidder" ]; then
  say "5. bidder wallet"
  "$BIN/zcash-devtool" wallet -w "$STATE/bidder" init --name bidder -i "$STATE/bidder.age" -n "$BNZ_NETWORK" -s "$BNZ_LWD_URL"
fi
say "   bidder address: $("$BIN/zcash-devtool" wallet -w "$STATE/bidder" list-addresses | sed -n 's/^ *Default Address: //p')"
say "   group key: $(cat "$STATE/group-key.txt")"

if [ -n "${BNZ_EVIDENCE_DIR:-}" ]; then
  OUT="$ROOT/$BNZ_EVIDENCE_DIR/setup/group-key.txt"
  mkdir -p "$(dirname "$OUT")"
  {
    echo "# DKG command lines (dealerless, run concurrently through frostd at $BNZ_FROSTD_ADDR)"
    cat "$FROST/dkg-commands.txt"
    echo "# frostd log lines during the DKG"
    grep -v '^\s*$' "$STATE/run/frostd-dkg.log" | head -40 || echo "(frostd logged no lines)"
    echo "# group key as printed by each config (frost-client groups)"
    for n in alice bob carol; do echo "$n: $(fc groups -c "$FROST/$n.toml" 2>&1 | sed -n 's/^Public key //p')"; done
  } >"$OUT"
  say "wrote $BNZ_EVIDENCE_DIR/setup/group-key.txt"
fi
