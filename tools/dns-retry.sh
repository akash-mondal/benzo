#!/bin/bash
# DNS retry wrapper (Oct 26): this Mac's resolver drops lookups of the lightwalletd host for a few seconds at a time,
# and the lightwalletd connection itself sometimes drops mid-sync.
# A call that failed only because the name did not resolve (or the host could not be dialled) never reached the
# server, so it is safe to run again. Every other result (success or any other error) passes through unchanged, with
# its exit code. Installed as .benzo/bin/<tool> in front of the real binary at .benzo/bin/.real/<tool>; the e2e pin
# check (e2e/lib/pins.ts) verifies the real binary and that this file is the one installed.
real="$(cd "$(dirname "$0")" && pwd)/.real/$(basename "$0")"
log="${BNZ_NET_LOG:-$(cd "$(dirname "$0")/../.." && pwd)/tmp/net.log}"
for i in 1 2 3 4 5 6 7 8 9 10; do
  out=$(mktemp); err=$(mktemp)
  # Run as a child and pass a kill on to it: a caller's timeout kills this wrapper, and an orphaned sync kept the
  # wallet locked for every later call. (`<&0`: a background child would otherwise read /dev/null, not our stdin.)
  # A SIGKILL cannot be trapped, so a watcher also stops the child once this wrapper is gone.
  "$real" "$@" <&0 >"$out" 2>"$err" & child=$!
  ( while kill -0 $$ 2>/dev/null; do sleep 5; done; kill -TERM $child 2>/dev/null ) </dev/null >/dev/null 2>&1 & watch=$!; disown $watch
  trap 'kill -TERM $child $watch 2>/dev/null; rm -f "$out" "$err"; exit 143' TERM INT HUP
  wait $child; rc=$?; trap - TERM INT HUP; kill $watch 2>/dev/null
  # A wallet sync only reads, so a dropped connection mid-sync is also safe to retry. Anything that may have reached
  # the server and changed something (a payment, a broadcast) is never retried on a dropped connection.
  pat="dns error|failed to lookup address|no such host|nodename nor servname|name resolution|Failed to dial target host"
  case " $* " in *" sync "*) pat="$pat|transport error|connection closed|operation was canceled|connection reset|broken pipe";; esac
  if [ $rc -ne 0 ] && [ $i -lt 10 ] && grep -qiE "$pat" "$out" "$err"; then
    echo "$(date -u +%FT%TZ) DNS-RETRY $(basename "$0") $1 $2 (try $i)" >> "$log" 2>/dev/null; rm -f "$out" "$err"; sleep $((i * 4)); continue
  fi
  cat "$out"; cat "$err" >&2; rm -f "$out" "$err"; exit $rc
done
