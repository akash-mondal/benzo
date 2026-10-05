// R7 item 6 repro — stray-deposit refunds never go to operator-chosen destinations (Reviewer G G6): a stray
// whose memo holds a valid sealed bid is refunded through its own envelope like any bid (interim: the
// exception queue + owner-signed claim), anything else goes to the exception queue claimable only when the
// memo holds an owner key; `stray_refund_ua` is dropped from routing.
//
// Checks:
//   S1 settle init routing shape flips: a product routing with stray_refund_ua is refused, one with plain
//      {deposit_ua} entries is accepted.
//   S2 (live plan on an auction with real stray deposits) the shipped signer plan never pays a stray to an
//      operator destination: memo-holding strays and garbage strays both land in the exception queue with
//      their reasons, and only owner-claimed strays are payable.
//
// Usage: node tools/repro/r7-6-stray-refunds-repro.mjs [auction-id-with-strays]
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const show = (label, r) => console.log(`${label}: ${r.code === 0 ? "accepted" : "refused"} ${r.out.trim().slice(-160).replace(/\n/g, " ")}`);

// S1: product routing shape, on a throwaway draft+publish (no chain).
const randomId = () => execFileSync("node", ["-e", "console.log(require('crypto').randomBytes(32).toString('hex'))"], { encoding: "utf8" }).trim();
const fresh = () => spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "vault"), "--network", "test"], { encoding: "utf8" }).stdout.trim();
const signerKeys = ["alice", "bob", "carol"].map((n) => JSON.parse(readFileSync(path.join(STATE, "signers", n, "envelope-key.json"), "utf8")).public_hex);
const deposit = [fresh(), fresh()];
const id = randomId();
const manifest = { version: 1, network: "test", auction_id: id, escrow_ua: deposit[0],
  frost_group_key: readFileSync(path.join(STATE, "group-key.txt"), "utf8").trim(), lot: "R7 stray repro", supply: 2,
  reserve_zats: "10", tick_zats: "10", B_max_zats: "3000", q_max: 1, C_zats: process.env.BNZ_COLLATERAL_ZATS, fee_zats: "0",
  deposit_addresses: deposit,
  drand: { chain_hash: process.env.BNZ_DRAND_CHAIN_HASH, public_key: process.env.BNZ_DRAND_PUBLIC_KEY, scheme: "bls-unchained-g1-rfc9380", genesis: Number(process.env.BNZ_DRAND_GENESIS), period: 3, R: 32725000 },
  T_submit: Math.floor(Date.now() / 1000) + 3600, T_freeze: Math.floor(Date.now() / 1000) + 5000, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1", envelope_keys: signerKeys };
show("S1 create", cli(["auction", "create"], manifest));
const packet = cli(["auction", "sign", "--id", id]);
const signer = JSON.parse(packet.out).signer;
const dir = path.join(ROOT, "tmp/e2e/r7/stray-repro-public");
rmSync(dir, { recursive: true, force: true });
const operatorFile = path.join(STATE, "run", "r7-6-operator.json");
writeFileSync(operatorFile, JSON.stringify({ settlement: { signers: ["bob", "carol"], batch_cap: 13, pczt_expiry_blocks: 364 },
  routing: { bidders: deposit.map((deposit_ua) => ({ deposit_ua, stray_refund_ua: fresh() })), seller_ua: fresh(), fee_reserve_ua: fresh() } }), { mode: 0o600 });
show("S1 publish with stray_refund_ua routing", cli(["auction", "publish", "--id", id, "--dir", dir, "--config", operatorFile]));
writeFileSync(operatorFile, JSON.stringify({ settlement: { signers: ["bob", "carol"], batch_cap: 13, pczt_expiry_blocks: 364 },
  routing: { bidders: deposit.map((deposit_ua) => ({ deposit_ua })), seller_ua: fresh(), fee_reserve_ua: fresh() } }), { mode: 0o600 });
const id2 = randomId();
show("S1 create (second)", cli(["auction", "create"], { ...manifest, auction_id: id2 }));
const packet2 = cli(["auction", "sign", "--id", id2]);
show("S1 publish with plain deposit routing", cli(["auction", "publish", "--id", id2, "--dir", dir, "--config", operatorFile]));

// S2: the shipped plan against real strays.
const live = process.argv[2];
if (live) {
  const plan = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), live], { encoding: "utf8", maxBuffer: 64 << 20 });
  console.log(`S2 plan exit ${plan.status}`);
  if (plan.status === 0) {
    const parsed = JSON.parse(plan.stdout);
    console.log(`S2 obligations: ${JSON.stringify(parsed.obligations.map((o) => o.party))}`);
    console.log(`S2 exceptions: ${JSON.stringify(parsed.exceptions.map((o) => ({ party: o.party.slice(0, 28), reason: o.reason ?? null })))}`);
    const strays = [...parsed.obligations, ...parsed.exceptions].filter((o) => o.party.startsWith("deposit:"));
    const paidToStrays = parsed.obligations.filter((o) => o.party.startsWith("deposit:") && !parsed.destinations?.[o.party]);
    console.log(paidToStrays.length === 0 && strays.some((o) => parsed.exceptions.includes(o))
      ? "FIXED: no stray is payable to an operator destination; unclaimed strays sit in the exception queue with reasons."
      : `CONFIRMED: ${paidToStrays.length} stray(s) resolved from operator routing (stray_refund_ua path).`);
  } else console.log(`S2 plan stderr ${plan.stderr.trim().slice(-200)}`);
}
