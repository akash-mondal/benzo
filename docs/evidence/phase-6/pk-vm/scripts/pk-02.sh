set -e
exec > >(tee pk/02-verify.out) 2>&1
echo "# step 2 — install the npm package outside any checkout and verify a published auction OFFLINE"
echo "# (network namespace with loopback only; host mounts hidden; empty HOME; user stranger)"
date -u
cd ~
ls -a ~ | tr '\n' ' '; echo
echo '$ cd in && sha256sum -c SHA256SUMS'
(cd in && sha256sum -c SHA256SUMS)
echo '$ curl -m 5 https://api.drand.sh   # proves there is no network'
curl -sS -m 5 https://api.drand.sh 2>&1 | head -1 || true
mkdir -p ~/run && cd ~/run
echo '$ tar -xzf ~/in/benzo-0.1.0.tgz'
tar -xzf ~/in/benzo-0.1.0.tgz
echo '$ cp -R ~/in/auction benzo-0.1.0/auction && cd benzo-0.1.0'
cp -R ~/in/auction benzo-0.1.0/auction && cd benzo-0.1.0
echo '$ git rev-parse --show-toplevel   # not a checkout'
git rev-parse --show-toplevel 2>&1 || true
echo '$ sha256sum dist/benzo-verify.mjs; cat docs/verify-bundle.sha256'
sha256sum dist/benzo-verify.mjs; cat docs/verify-bundle.sha256
SIGNER=302a300506032b65700321000ad232b8429de606bf4c437c476fff5b233023d1037e0c908adaf149badb7891
echo "\$ ./bin/benzo verify --dir auction --signer $SIGNER"
set +e
./bin/benzo verify --dir auction --signer $SIGNER; echo "exit=$?"
echo '$ node dist/benzo-verify.mjs --dir auction --signer …   # the bundle alone'
node dist/benzo-verify.mjs --dir auction --signer $SIGNER >/tmp/direct.out 2>&1; echo "exit=$? ($(grep -c '^OK' /tmp/direct.out) OK lines)"
echo "# negative 1: a tampered copy (one clearing price changed in result.json) must be refused"
cp -R auction tampered
node -e 'const f="tampered/result.json",j=JSON.parse(require("fs").readFileSync(f));const s=JSON.stringify(j);const t=s.replace(/"(clearing_price|price)[a-z_]*":"?(\d+)/,(m,k,v)=>m.replace(v,String(BigInt(v)+1n)));if(t===s)throw new Error("no price field");require("fs").writeFileSync(f,t);console.log("changed:",s.length===t.length?"1 digit field":"field")'
./bin/benzo verify --dir tampered --signer $SIGNER 2>&1 | grep -v '^OK' | head -5; echo "exit=${PIPESTATUS[0]}"
echo "# negative 2: the right directory with a different trust anchor (--signer) must be refused"
./bin/benzo verify --dir auction --signer 302a300506032b6570032100$(printf '%064d' 0) 2>&1 | grep -v '^OK' | head -3; echo "exit=${PIPESTATUS[0]}"
