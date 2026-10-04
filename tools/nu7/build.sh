#!/usr/bin/env bash
# NU7 backport (Ruling R27). Testnet activated NU7 (consensus branch 0x77190AD9) at height 4,465,026 on 2026-10-04;
# the pinned, audited librustzcash crates only carry NU7 behind `zcash_unstable = "nu7"` with a placeholder branch id
# and no height. This applies exactly upstream's NU7 parameters (zcash_protocol 0.11.0-pre.0 / zcash_primitives
# 0.31.0-pre.0: testnet height 4,465,026, branch id 0x77190AD9, V6 suggested and V5/V6 valid under NU7) to the pinned
# versions, as reviewable patches in this directory, and nothing else. Mainnet NU7 stays None, so mainnet behaviour is
# unchanged.
#
#   tools/nu7/build.sh crates <dir>                  fetch the pinned .crate files (sha256-checked), extract, patch
#   tools/nu7/build.sh patch-toml <Cargo.toml> <dir> <crate-ver>...   add [patch.crates-io] path entries
#   tools/nu7/build.sh tool <git> <rev> <state> <target> <dir> <crate-ver>... -- <cargo install args>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# name-version -> sha256 of the .crate (the Cargo.lock checksums of the pinned tools).
sum() { case "$1" in
  zcash_protocol-0.10.5) echo 314329b91ec4bbb517441840e47d0b2029bf0b946f086980c96c889c2d92dc5d;;
  zcash_protocol-0.10.0) echo 2973d210e74ebd81adc50828fbbb284ab6aaa099308097c42c47dc63cf3420fc;;
  zcash_primitives-0.30.1) echo 403d5be1e96339534be098e3377fb8a78d68ca7585b1780133d884b810277418;;
  zcash_primitives-0.29.0) echo bdbeccc05bfe63b6dee9e989c6ff5027421741562a4853c36504dd621f6a81b1;;
  pczt-0.9.3) echo a5592f4f3eba7f9344cc423f45b6e65911e0630c9b89968d5a20792aadd5a0eb;;
  pczt-0.8.0-rc.1) echo e8fb3f5ea64b891d40cff8182aca0bd7d063c9460920546fe7066860b781de91;;
  *) echo "unknown crate $1" >&2; return 1;; esac; }
crates() { # <dir> <crate-ver>...
  local dir=$1; shift; mkdir -p "$dir"
  for cv in "$@"; do
    [ -f "$dir/$cv/.nu7-applied" ] && continue
    local name=${cv%-*} ver=${cv##*-}; [[ $cv == pczt-0.8.0-rc.1 ]] && { name=pczt; ver=0.8.0-rc.1; }
    local f="$dir/$cv.crate"
    curl -fsSL -A benzo-nu7 "https://static.crates.io/crates/$name/$name-$ver.crate" -o "$f"
    [ "$(shasum -a 256 "$f" 2>/dev/null | cut -d' ' -f1 || sha256sum "$f" | cut -d' ' -f1)" = "$(sum "$cv")" ] || { echo "ERROR checksum $cv" >&2; exit 1; }
    rm -rf "${dir:?}/$cv"; tar xzf "$f" -C "$dir"; rm -f "$f"
    (cd "$dir/$cv" && patch -s -p1 < "$HERE/$cv.patch"); touch "$dir/$cv/.nu7-applied"
  done
}
patch_toml() { # <Cargo.toml> <dir> <crate-ver>...
  local toml=$1 dir=$2; shift 2
  python3 - "$toml" "$dir" "$@" <<'PY'
import sys,re
toml,d,*cvs=sys.argv[1:]
s=open(toml).read()
lines=[]
for cv in cvs:
    name='pczt' if cv.startswith('pczt-') else cv.rsplit('-',1)[0]
    if re.search(rf'^{name}\s*=\s*\{{\s*path\s*=\s*"{re.escape(d)}',s,re.M): continue
    lines.append(f'{name} = {{ path = "{d}/{cv}" }} # NU7 backport, tools/nu7 (Ruling R27)')
if lines:
    if re.search(r'^\[patch\.crates-io\]\s*$',s,re.M): s=re.sub(r'^(\[patch\.crates-io\]\s*\n)',lambda m:m.group(1)+'\n'.join(lines)+'\n',s,count=1,flags=re.M)
    else: s=s.rstrip('\n')+'\n\n[patch.crates-io]\n'+'\n'.join(lines)+'\n'
    open(toml,'w').write(s)
PY
}
case "${1:-}" in
  crates) shift; crates "$@";;
  patch-toml) shift; patch_toml "$@";;
  tool) shift
    git=$1 rev=$2 state=$3 target=$4 dir=$5; shift 5; cvs=(); while [ "$1" != "--" ]; do cvs+=("$1"); shift; done; shift
    crates "$dir" "${cvs[@]}"
    src="$state/src/$(basename "$git")-$rev"
    [ -d "$src/.git" ] || { rm -rf "$src"; git clone -q "$git" "$src"; }
    (cd "$src" && git checkout -q --force "$rev" && git clean -qfd)
    cp "$src/Cargo.lock" "$src/Cargo.lock.pinned"
    patch_toml "$src/Cargo.toml" "$dir" "${cvs[@]}"
    (cd "$src" && cargo update -q --offline -w 2>/dev/null || cargo update -q -w)
    # The lock may differ from the pin ONLY in the patched packages' source/checksum lines.
    extra=$(diff <(grep -vE '^(source|checksum) = ' "$src/Cargo.lock.pinned") <(grep -vE '^(source|checksum) = ' "$src/Cargo.lock") || true)
    [ -z "$extra" ] || { echo "ERROR $src: lock changed beyond the patched packages:" >&2; echo "$extra" | head -20 >&2; exit 1; }
    cargo install --locked --path "$src/$1" --root "$state" --target-dir "$target" --force "${@:2}"
    ;;
  *) echo "usage: see header" >&2; exit 2;;
esac
