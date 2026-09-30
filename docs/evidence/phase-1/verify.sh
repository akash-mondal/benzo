#!/usr/bin/env bash
# Re-checks Phase 1 evidence against both lightwalletd endpoints, drand (through Go tle) and the vault UFVK.
# Usage: docs/evidence/phase-1/verify.sh <evidence dir>. One line per check; exit 0 only if every check passes.
# The two UFVK checks read $BNZ_STATE_DIR, so they run only on the machine that holds it.
set -uo pipefail
EV="$(cd "${1:?usage: verify.sh <evidence dir>}" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
set -a; . ./.env; set +a
STATE="$ROOT/${BNZ_STATE_DIR#./}"
BIN="$STATE/bin"
SCAN="$ROOT/scan/target/release/benzo-scan"
mkdir -p "$ROOT/tmp"
cargo build --release --locked --quiet --manifest-path scan/Cargo.toml || { echo "ERROR run scanner build failed"; exit 1; }

FAILED=0
ok() { echo "OK $*"; }
err() { echo "ERROR $*"; FAILED=1; }
# gate state as EVIDENCE.md records it; a BLOCKED or FAILED gate is reported, not checked
state() { sed -n "s/^| *$1 *|[^|]*| *\(BLOCKED\|FAILED\).*/\1/p" "$EV/EVIDENCE.md" 2>/dev/null | head -1; }
need() { # <gate> <file>...: prints NOT CHECKED or ERROR missing and returns 1 unless every file exists and is non-empty
  local gate=$1 s; shift
  s="$(state "$gate")"
  if [ -n "$s" ]; then echo "NOT CHECKED $gate $s"; return 1; fi
  for f in "$@"; do [ -s "$EV/$f" ] || { err "$gate missing $f"; return 1; }; done
}
hexof() { tr -d ' \n' <"$EV/$1"; }
revhex() { printf '%s' "$1" | sed 's/../& /g' | awk '{for (i = NF; i > 0; i--) printf "%s", $i}'; }
gettx() { # <endpoint> <txid>: prints "<height> <raw hex>"
  local hash json
  hash="$(revhex "$2" | xxd -r -p | base64)"
  json="$("$BIN/grpcurl" -import-path "$STATE/proto" -proto service.proto -d "{\"hash\":\"$hash\"}" "$1" \
    cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction)" || return 1
  printf '%s %s\n' "$(jq -r '.height // "0"' <<<"$json")" "$(jq -r .data <<<"$json" | base64 -d | xxd -p | tr -d '\n')"
}

# Gate A: the refund, re-fetched from both endpoints.
if need A frost/refund.json frost/coordinator.txt; then
  txid="$(jq -r .txid "$EV/frost/refund.json")"
  for ep in "$BNZ_LWD_URL" "$BNZ_LWD_URL_ALT"; do
    read -r height raw < <(gettx "$ep" "$txid") || true
    want_h="$(jq -r --arg ep "$ep" '.height[$ep]' "$EV/frost/refund.json")"
    want_hdr="$(jq -r '.header_hex + .version_group_id_hex' "$EV/frost/refund.json")"
    branch="$(revhex "${raw:16:8}")"
    if [ "${height:-}" = "$want_h" ] && [ "${raw:0:16}" = "$want_hdr" ] && [ "${raw:0:8}" = "06000080" ] &&
       [ "$branch" = "$(jq -r .consensus_branch_id "$EV/frost/refund.json")" ]; then
      ok "A refund $txid at height $height on $ep, v6 header, branch $branch"
    else
      err "A refund $txid on $ep: height ${height:-none} (want $want_h), header ${raw:0:16} (want $want_hdr), branch ${branch:-none}"
    fi
  done
  sighash="$(sed -n 's/^sighash //p' "$EV/frost/coordinator.txt")"
  [ "$(revhex "$sighash")" = "$txid" ] && ok "A byte-reversed sighash equals the refund txid" \
    || err "A byte-reversed sighash $(revhex "$sighash") != refund txid $txid"
  read -r _ raw < <(gettx "$BNZ_LWD_URL" "$txid") || true
  n=0
  for sig in $(sed -n 's/.* signature \([0-9a-f]\{128\}\)$/\1/p' "$EV/frost/coordinator.txt"); do
    n=$((n + 1))
    if grep -qE "^(..)*$sig" <<<"${raw:-}"; then ok "A signature ${sig:0:16}... is in the raw refund tx"; else err "A signature ${sig:0:16}... not in the raw refund tx"; fi
  done
  [ "$n" -gt 0 ] || err "A no signatures in frost/coordinator.txt"
fi
if need A setup/group-key.txt; then
  group="$(sed -n 's/^alice: //p' "$EV/setup/group-key.txt")"
  ak="$("$SCAN" ak "$BNZ_NETWORK" "$STATE/ufvk.txt")"
  [ -n "$group" ] && [ "$ak" = "$group" ] && ok "A vault UFVK ak equals the group key $group" || err "A vault UFVK ak ${ak:-none} != group key ${group:-none}"
fi

# Gate B: deposits re-fetched from both endpoints; memos re-derived from the second endpoint with the vault UFVK.
if need B memo/deposits.json memo/bid1.sent.hex memo/bid2.sent.hex memo/bid1.scanned.hex memo/bid2.scanned.hex; then
  for i in 1 2; do
    txid="$(jq -r ".[$((i - 1))].txid" "$EV/memo/deposits.json")"
    want_h="$(jq -r ".[$((i - 1))].height" "$EV/memo/deposits.json")"
    read -r h1 raw1 < <(gettx "$BNZ_LWD_URL" "$txid") || true
    read -r h2 raw < <(gettx "$BNZ_LWD_URL_ALT" "$txid") || true
    [ "${h1:-}" = "$want_h" ] && [ "${h2:-}" = "$want_h" ] && ok "B deposit $i $txid at height $want_h on both endpoints" \
      || err "B deposit $i $txid heights ${h1:-none}/${h2:-none}, want $want_h"
    # Phase 1's pinned NU6.3 v6 header and branch, checked on each endpoint.
    for bytes in "${raw1:-}" "${raw:-}"; do
      if [ "${bytes:0:16}" = "0600008098b684d8" ] && [ "$(revhex "${bytes:16:8}")" = "37a5165b" ]; then
        ok "B deposit $i v6 header, branch 37a5165b"
      else
        err "B deposit $i header ${bytes:0:16}, branch $(revhex "${bytes:16:8}") differs from pinned NU6.3 v6"
      fi
    done
    memo="$("$SCAN" verify "$BNZ_NETWORK" "$STATE/ufvk.txt" "${h2:-0}" <<<"${raw:-}" | jq -r 'select(.pool == "ironwood") | .memo_hex')"
    if [ -n "$memo" ] && [ "$memo" = "$(hexof memo/bid$i.scanned.hex)" ] && [ "$memo" = "$(hexof memo/bid$i.sent.hex)" ]; then
      ok "B memo $i re-derived from $BNZ_LWD_URL_ALT equals bid$i.scanned.hex and bid$i.sent.hex"
    else
      err "B memo $i re-derived from $BNZ_LWD_URL_ALT (${memo:0:24}...) differs from bid$i.scanned.hex or bid$i.sent.hex"
    fi
  done
fi

# Gate C: Go tle re-opens the committed ciphertexts against drand.
if need C tlock/bid1.ct.hex tlock/bid2.ct.hex tlock/bid1.pt.hex tlock/bid2.pt.hex; then
  for i in 1 2; do
    pt="$(hexof tlock/bid$i.ct.hex | xxd -r -p | "$BIN/tle" -d -c "$BNZ_DRAND_CHAIN_HASH" 2>"$ROOT/tmp/verify-tle.err" | xxd -p | tr -d '\n')"
    [ "$pt" = "$(hexof tlock/bid$i.pt.hex)" ] && ok "C tle -d bid$i.ct.hex equals bid$i.pt.hex" \
      || err "C tle -d bid$i.ct.hex gave ${pt:0:32}..., not bid$i.pt.hex: $(tr '\n' ' ' <"$ROOT/tmp/verify-tle.err")"
  done
fi

# The run: file hashes and an unchanged tree since the run commit.
if need run run.json; then
  while read -r f want; do
    if [ ! -f "$EV/$f" ] && [ ! -f "$ROOT/$f" ]; then err "run missing $f"; continue; fi
    [ -f "$EV/$f" ] && p="$EV/$f" || p="$ROOT/$f"
    [ "$(shasum -a 256 "$p" | cut -d' ' -f1)" = "$want" ] && ok "run sha256 $f" || err "run sha256 $f differs from run.json"
  done < <(jq -r '.sha256 | to_entries[] | "\(.key) \(.value)"' "$EV/run.json")
  commit="$(jq -r .commit "$EV/run.json")"
  git diff --quiet "$commit" HEAD -- e2e seal scan tools package-lock.json playwright.config.ts \
    && ok "run no change since $commit in e2e seal scan tools package-lock.json playwright.config.ts" \
    || err "run e2e/seal/scan/tools/package-lock.json/playwright.config.ts changed since $commit"
fi

exit "$FAILED"
