set -e
exec > >(tee pk/03b-seal.out) 2>&1
echo "# step 3b — seal a bid with the bidder bundle in a fresh /tmp dir (empty HOME, host mounts hidden), open it after round R with tle"
date -u
F=/tmp/benzo-bidder-proof; rm -rf $F; mkdir -p $F; cd $F
echo '$ tar -xzf ~/in/benzo-bidder-0.1.0.tgz'; tar -xzf ~/in/benzo-bidder-0.1.0.tgz; tar -tzf ~/in/benzo-bidder-0.1.0.tgz | tr '\n' ' '; echo
cp ~/in/bidder-bundle-driver.mjs run-proof.mjs; cp ~/pk/seal.mjs seal.mjs
node seal.mjs; echo "exit=$?"
