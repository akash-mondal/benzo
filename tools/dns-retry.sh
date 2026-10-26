#!/bin/bash
# DNS retry wrapper (Oct 26): this Mac's resolver drops lookups of the lightwalletd host for a few seconds at a time.
# A call that failed only because the name did not resolve (or the host could not be dialled) never reached the
# server, so it is safe to run again. Every other result (success or any other error) passes through unchanged, with
# its exit code. Installed as .benzo/bin/<tool> in front of the real binary at .benzo/bin/.real/<tool>; the e2e pin
# check (e2e/lib/pins.ts) verifies the real binary and that this file is the one installed.
real="$(cd "$(dirname "$0")" && pwd)/.real/$(basename "$0")"
log="${BNZ_NET_LOG:-$(cd "$(dirname "$0")/../.." && pwd)/tmp/net.log}"
for i in 1 2 3 4 5 6 7 8 9 10; do
  out=$(mktemp); err=$(mktemp)
  "$real" "$@" >"$out" 2>"$err"; rc=$?
  if [ $rc -ne 0 ] && [ $i -lt 10 ] && grep -qiE "dns error|failed to lookup address|no such host|nodename nor servname|name resolution|Failed to dial target host" "$out" "$err"; then
    echo "$(date -u +%FT%TZ) DNS-RETRY $(basename "$0") $1 $2 (try $i)" >> "$log" 2>/dev/null; rm -f "$out" "$err"; sleep $((i * 4)); continue
  fi
  cat "$out"; cat "$err" >&2; rm -f "$out" "$err"; exit $rc
done
