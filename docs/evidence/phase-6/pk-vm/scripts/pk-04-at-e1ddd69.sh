set -e
exec > >(tee pk/04-rebuild.out) 2>&1
echo "# step 4 — rebuild the three artifacts from a fresh clone on Linux (docs/reproducible-build.md §3), compare to the macOS build"
date -u
npm install -g npm@12.0.2 >/dev/null 2>&1; echo "node $(node -v) npm $(npm -v) tar: $(tar --version | head -1) gzip: $(gzip --version | head -1)"
rm -rf /tmp/benzo-rebuild; git clone -q ~/in/benzo.bundle /tmp/benzo-rebuild; cd /tmp/benzo-rebuild
git checkout -q e1ddd696f192ed5c4b0d0e5fb5e46059f5f57f2e; git rev-parse --short HEAD
npm ci --no-audit --no-fund 2>&1 | tail -1
npm run --silent build:verify >/dev/null; sha256sum dist/benzo-verify.mjs; sha256sum -c docs/verify-bundle.sha256
set +e
npm run --silent package 2>&1 | tail -3
npm run --silent package:bidder 2>&1 | tail -1
echo "# expected (macOS build of e1ddd69):"; cat ~/in/SHA256SUMS
echo "# this Linux rebuild:"; (cd dist && sha256sum benzo-0.1.0.tgz benzo-bidder-0.1.0.tgz)
(cd dist && sha256sum -c ~/in/SHA256SUMS)
