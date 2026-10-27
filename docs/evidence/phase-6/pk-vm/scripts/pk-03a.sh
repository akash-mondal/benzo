set -e
exec > >(tee pk/03a-tools.out) 2>&1
echo "# step 3a — bidder tools: Go 1.25.6 (same as the build machine) + tle v1.2.0 (tools/pins.env), Playwright chromium-headless-shell from the package's own pinned playwright-core"
date -u
cd /tmp
curl -fsSL 'https://go.dev/dl/?mode=json&include=all' -o go.json
SHA=$(node -e 'const j=JSON.parse(require("fs").readFileSync("go.json"));const f=j.find(r=>r.version==="go1.25.6").files.find(f=>f.filename==="go1.25.6.linux-arm64.tar.gz");console.log(f.sha256)')
curl -fsSLO https://go.dev/dl/go1.25.6.linux-arm64.tar.gz
echo "$SHA  go1.25.6.linux-arm64.tar.gz" | sha256sum -c -
tar -xzf go1.25.6.linux-arm64.tar.gz -C ~
export GOPATH=~/gopath GOCACHE=/tmp/gocache GOFLAGS=-modcacherw
go version
go install github.com/drand/tlock/cmd/tle@v1.2.0
tle --version 2>&1 | head -1 || ls -la ~/gopath/bin
cd ~/run/benzo-0.1.0
node node_modules/playwright-core/cli.js --version
node node_modules/playwright-core/cli.js install chromium-headless-shell 2>&1 | tail -3
ls ~/.cache/ms-playwright
