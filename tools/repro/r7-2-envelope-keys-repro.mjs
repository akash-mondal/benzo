// R7 item 2 repro — per-signer envelope keys pinned in the signed manifest; the operator never holds a
// private envelope key; product-mode settlement refuses with a clear error instead of falling back to an
// operator-held key (Reviewer R F-1/F-2 = Reviewer G G4, and R7.2's interim rule while Track B's
// multi-recipient envelope format (design §4 [B]) is unmerged).
//
// Checks (observations printed; the before/after outputs show the flip):
//   K1 product create: can a manifest pin `envelope_keys` at all?
//   K2 product create: is the pin mandatory (a manifest without it refused)?
//   K3 publish: does any operator-held envelope private key exist afterwards?
//   K4 bid seal: is a substituted (unpinned) envelope key refused?
//   K5 signer keygen: does each signer generate and hold its own keypair in its own dir (no operator copy)?
//   K6 live (optional --id): does the signer plan refuse every envelope destination with the clear
//      interim error and keep those refunds in the exception queue (no operator-held-key payment)?
//
// Usage: node tools/repro/r7-2-envelope-keys-repro.mjs [cleared-auction-id]
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const cli = (args, input) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), args, { input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") };
};
const fresh = () => spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "vault")], { encoding: "utf8" }).stdout.trim();
const randomId = () => execFileSync("node", ["-e", "console.log(require('crypto').randomBytes(32).toString('hex'))"], { encoding: "utf8" }).trim();
const show = (name, r) => console.log(`${name}: ${r.code === 0 ? "accepted" : "refused"} ${r.out.trim().slice(-200).replace(/\n/g, " ")}`);

// K5 signer-side key generation first, so the manifest can pin the produced keys.
const signerKeys = {};
for (const name of ["alice", "bob", "carol"]) {
  const r = cli(["sign", "envelope-key", "--name", name]);
  signerKeys[name] = r.code === 0 ? JSON.parse(r.out).public_hex : null;
  console.log(`K5 signer ${name} keygen: ${r.code === 0 ? "ok" : "refused " + r.out.trim().slice(-120)}`);
}
const keyFile = (name) => path.join(STATE, "signers", name, "envelope-key.json");
for (const name of ["alice", "bob", "carol"]) {
  const f = keyFile(name);
  console.log(`K5 signer ${name} private key file ${existsSync(f) ? `present mode ${(statSync(f).mode & 0o777).toString(8)}` : "absent"}`);
}
const pinned = Object.values(signerKeys).every(Boolean) ? signerKeys : { alice: "11".repeat(32), bob: "22".repeat(32), carol: "33".repeat(32) };
const deposit = [fresh(), fresh(), fresh()];
const manifestFor = (id, withKeys) => {
  const m = { version: 1, network: "test", auction_id: id, escrow_ua: deposit[0],
    frost_group_key: readFileSync(path.join(STATE, "group-key.txt"), "utf8").trim(), lot: "R7 keys repro", supply: 2,
    reserve_zats: "10", tick_zats: "10", B_max_zats: "3000", q_max: 1, C_zats: process.env.BNZ_COLLATERAL_ZATS, fee_zats: "0",
    deposit_addresses: deposit,
    drand: { chain_hash: process.env.BNZ_DRAND_CHAIN_HASH, public_key: process.env.BNZ_DRAND_PUBLIC_KEY, scheme: "bls-unchained-g1-rfc9380", genesis: Number(process.env.BNZ_DRAND_GENESIS), period: 3, R: 32725000 },
    T_submit: Math.floor(Date.now() / 1000) + 3600, T_freeze: Math.floor(Date.now() / 1000) + 5000, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1" };
  if (withKeys) m.envelope_keys = [pinned.alice, pinned.bob, pinned.carol];
  return m;
};
const idWith = randomId(), idWithout = randomId();
show("K1 product create with envelope_keys pinned", cli(["auction", "create"], manifestFor(idWith, true)));
show("K2 product create without envelope_keys", cli(["auction", "create"], manifestFor(idWithout, false)));
// The K3/K4 flow runs on whichever manifest the product accepts at this code state (that is part of the
// observation: can the envelope keys even be pinned?).
for (const id of [idWith, idWithout]) {
  if (!existsSync(path.join(STATE, "product", id + ".draft.json"))) continue;
  const packet = cli(["auction", "sign", "--id", id]);
  const signer = JSON.parse(packet.out).signer;
  console.log(`K3/K4 flow uses auction ${id}`);
  const dir = path.join(ROOT, "tmp/e2e/r7/keys-repro-public");
  rmSync(dir, { recursive: true, force: true });
  const operator = { settlement: { signers: ["bob", "carol"], batch_cap: 13, pczt_expiry_blocks: 364 },
    routing: { bidders: deposit.map((deposit_ua) => ({ deposit_ua, stray_refund_ua: fresh() })), seller_ua: fresh(), fee_reserve_ua: fresh() } };
  const operatorFile = path.join(STATE, "run", "r7-2-operator.json"); writeFileSync(operatorFile, JSON.stringify(operator), { mode: 0o600 });
  const published = cli(["auction", "publish", "--id", id, "--dir", dir, "--config", operatorFile]);
  show("K3 publish", published);
  console.log(`K3 operator envelope private key file ${existsSync(path.join(STATE, "product", id + ".envelope.json")) ? "PRESENT (leak)" : "absent"}`);
  console.log(`K3 signer envelope key copies in settle dir ${["alice", "bob", "carol"].filter((n) => existsSync(path.join(STATE, "settle", id, `envelope-${n}.json`))).length} of 3`);
  console.log(`K3 publish output carries envelope_pubkey ${JSON.stringify(published.out).includes("envelope_pubkey") ? "PRESENT (unauthenticated distribution)" : "no"}`);
  const packetFile = path.join(STATE, "run", "r7-2-packet.json"); writeFileSync(packetFile, JSON.stringify(JSON.parse(packet.out)), { mode: 0o600 });
  const bid = { price_zats: "1500", quantity: 1, address: operator.routing.bidders[0].deposit_ua, refund_ua: fresh() };
  show("K4 bid seal with a substituted (unpinned) key", cli(["bid", "seal", "--manifest", packetFile, "--signer", signer], { ...bid, envelope_pubkey: "44".repeat(32) }));
  if (pinned.alice) show("K4 bid seal with a pinned key", cli(["bid", "seal", "--manifest", packetFile, "--signer", signer], { ...bid, envelope_pubkey: pinned.alice }));
  break;
}
// K6 live: the signer plan on a cleared product auction whose leaves carry envelope records.
const live = process.argv[2];
if (live) {
  const plan = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), live], { encoding: "utf8", maxBuffer: 64 << 20 });
  console.log(`K6 plan exit ${plan.status}`);
  console.log((plan.stderr ?? "").trim().slice(-400).replace(/\n/g, " | "));
  const parsed = plan.status === 0 ? JSON.parse(plan.stdout) : null;
  if (parsed) {
    console.log(`K6 obligations: ${JSON.stringify(parsed.obligations.map((o) => o.party))}`);
    console.log(`K6 exceptions: ${JSON.stringify(parsed.exceptions.map((o) => ({ party: o.party, reason: o.reason ?? null })))}`);
  }
}
