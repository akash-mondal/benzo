set -e
exec > >(tee pk/04b-rebuild-bsdtar.out) 2>&1
echo "# step 4b — same rebuild with bsdtar (libarchive-tools) as tar, as docs/reproducible-build.md pins bsdtar"
mkdir -p ~/shim; ln -sf /usr/bin/bsdtar ~/shim/tar; export PATH=~/shim:$PATH
echo "tar: $(tar --version) gzip: $(gzip --version | head -1)"
cd /tmp/benzo-rebuild
set +e
npm run --silent package 2>&1 | tail -1
npm run --silent package:bidder 2>&1 | tail -1
(cd dist && sha256sum -c ~/in/SHA256SUMS)
echo "# uncompressed tar layer vs the macOS tarballs"
for t in benzo-0.1.0 benzo-bidder-0.1.0; do
  a=$(gzip -dc dist/$t.tgz | sha256sum | cut -c1-64); b=$(gzip -dc ~/in/$t.tgz | sha256sum | cut -c1-64)
  echo "$t.tar linux=$a mac=$b $([ "$a" = "$b" ] && echo SAME || echo DIFFERENT)"
done
