// Phase 5 part 2 §2 (docs/design/phase5-part2-live.md §2): demo drivers for the three cross-chain demos, built and
// dry-run here against LOCAL chains; the head runs them live on main with the real signer hosts (host attest through
// e2e/lib/hosts.ts, `orb run ... benzo xchain attest`). Per demo the Zcash side is a markets.ts scenario (its engine
// and locks, spawned as a child with a pre-bound auction id — the escrow LOCKS BEFORE BIDDING, crosschain §2) and the
// target-chain side is the shipped `benzo xchain lock|attest|release` with the host-side attest.
//
//   demo1 sol-drop       a uniform multi-lot Zcash auction whose lots are locked in the Solana escrow; winners
//                        receive at FRESH addresses (Token-2022 CT where the asset is an SPL token, --ct: the
//                        standalone CT capability, R25 item 5/F6 — escrow-held SPL is future work).
//   demo2 buyback-stealth a Mode B buyback window paying sellers on Ethereum Sepolia through stealth delivery
//                        (Railgun stays deferred, R24).
//   demo3 otc-sol        a ZEC<->SOL blind OTC whose SOL leg settles through the Solana escrow.
//
// Nothing from Zcash lands on a target chain (crosschain §3 lesson 5): only the allocation root, the result hash and
// the fresh destinations — asserted per run by scanning every submitted target-chain transaction for the run's
// Zcash identifiers (deposit txids, shielded addresses).
//
// Test-audit answers:
// 1. Behaviour protected (part 2 §2 + crosschain §2/§3): the demos' target-chain half — escrow lock before bidding
//    with the hosts' own keys as the signer set, host-derived attestations, coordinator release, delivery at the
//    bidders' own fresh destinations, and the no-Zcash-material rule.
// 2. Credible regression: a driver step rebuilt from operator files (a coordinator-supplied destination), a wrong
//    payout multiple (lot_count x standard_lot), or Zcash identifiers flowing into target-chain payloads.
// 3. No existing test catches it: crosschain/local-demo.mjs and host-attest-demo.mjs prove the primitives on one
//    two-bid fixture; the demo flows (multi-lot, stealth-with-announce, OTC legs, live host attest) are new.
// 4. Production seam: none — every step drives the shipped `benzo` CLI (or the shipped markets scenario engine)
//    against real local chains / real networks; the local signer state dirs stand in for hosts at the same boundary
//    (BNZ_STATE_DIR).
//
// Build+run (local dry run of the target-chain half):
//   npx esbuild tools/repro/xchain-demos.ts --bundle --platform=node --format=esm \
//     --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' \
//     --outfile=tmp/xchain-demos.mjs && bash tools/repro/xchain-demos.sh demo1 demo2 demo3
// Live (the head, on main): node tmp/xchain-demos.mjs <demo1|demo2|demo3>   (BNZ_LWD_SINGLE=1)
import { execFileSync, spawnSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JsonRpcProvider, Wallet, SigningKey, parseEther } from "ethers";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { ROOT, STATE, env } from "../../e2e/lib/env";
import { jsonBytes, signRecord } from "../../manifest/schema";
import { freezeStatement, generateWitnessKey, signStatement, witnessSetHash } from "../../witness";
import { clearForMode, clientForMode } from "../../clear/registry";
import * as bid from "../../envelope/bid";
import { generateOwnerKey } from "../../envelope/index";
import * as schema from "../../manifest/schema";
import * as merkle from "../../clear/merkle";
import * as tlock from "tlock-js";
import * as armor from "tlock-js/age/armor";
import { deriveSettlementStealthAddress, CANONICAL_ERC5564_ANNOUNCER, prepareAnnouncement, generateStealthMetaAddress } from "../../crosschain/stealth";
import * as hosts from "../../e2e/lib/hosts";

const WORK = path.join(ROOT, "tmp/xchain-demos"); mkdirSync(WORK, { recursive: true });
const PUB = path.join(WORK, "public");
const HOSTROOT = assertScratch(path.join(WORK, "xchain-hosts")); // the dry run's stand-in hosts: BNZ_STATE_DIR per signer (R43: tmp/ only)
const HOSTS = ["alice", "bob", "carol"];
const UA = "utest1redacted"; // a real testnet UA (zcash-test-vectors)
const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const pass = (id: string) => console.log(`PASS ${id}`);
const fail = (id: string, why: string) => { failures++; console.log(`ERROR ${id} ${why}`); };
const check = (id: string, cond: boolean, why = "") => (cond ? pass(id) : fail(id, why));

// ---- shipped CLI drivers -------------------------------------------------------------
const benzoBin = path.join(ROOT, "cli/dist/benzo.mjs");
function benzo(args: string[], opts: { stateDir?: string; input?: any } = {}): any {
  const r = spawnSync("node", [benzoBin, ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, ...(opts.stateDir ? { BNZ_STATE_DIR: opts.stateDir } : {}) },
    input: opts.input === undefined ? undefined : JSON.stringify(opts.input),
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) throw new Error(`benzo ${args[0]} ${args[1] ?? ""} exited ${r.status}: ${out.trim().slice(-300)}`);
  return JSON.parse(out.trim().split("\n").filter((l) => l.startsWith("{")).at(-1)!);
}
function benzoRaw(args: string[], opts: { stateDir?: string } = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [benzoBin, ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, ...(opts.stateDir ? { BNZ_STATE_DIR: opts.stateDir } : {}) },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ---- the local stand-in hosts (item 1(d) boundary: BNZ_STATE_DIR per signer) ----------
const hostDir = (n: string) => path.join(HOSTROOT, n);
const xkey = (dir: string, chain: string, name: string) => path.join(dir, "xchain", `${chain}-${name}.key`);
function localHostKeys(chain: "evm" | "solana"): Record<string, { pub: string; signerKey: string; envelopeKey: string }> {
  const out: Record<string, { pub: string; signerKey: string; envelopeKey: string }> = {};
  for (const n of HOSTS) {
    const dir = hostDir(n);
    const sk = xkey(dir, chain, n);
    if (!existsSync(sk)) benzo(["xchain", "keygen", "--chain", chain, "--name", n], { stateDir: dir });
    const secret = readFileSync(sk, "utf8").trim();
    const envKeyFile = path.join(dir, "signers", n, "envelope-key.json");
    if (!existsSync(envKeyFile)) benzo(["sign", "envelope-key", "--name", n], { stateDir: dir });
    out[n] = {
      pub: chain === "evm" ? new Wallet("0x" + secret).address.toLowerCase() : new PublicKey((() => { const { ed25519 } = require("@noble/curves/ed25519.js"); return ed25519.getPublicKey(Uint8Array.from(secret.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))); })()).toBase58(),
      signerKey: xkey(dir, chain, n),
      envelopeKey: envKeyFile,
    };
  }
  return out;
}

// ---- the target-chain fixture: a REAL cleared result (tlock + drand + shipped clearing) -----------------------------
// The harness is the bidder side here: it seals the fresh deliver targets and remembers them (legitimate expected
// values — a bidder knows its own destinations; per R28 the ATTESTATION must never take them from anywhere else).
type Deliver = { chain: string; kind: string; to: string; elgamal?: string };
async function buildFixture(name: string, mode: "uniform" | "buyback" | "otc", deliverPlan: Deliver[], opts: { supply?: number; quantities?: number[]; prices?: number[]; buyback?: any; otc?: any; owners?: { private_hex: string; public_hex: string }[]; qMax?: number; C?: number } = {}) {
  const drandBase = env("BNZ_DRAND_URLS").split(",")[0];
  const chainHash = schema.QUICKNET.chain_hash;
  const latest = await fetch(`${drandBase}/${chainHash}/public/latest`);
  if (!latest.ok) throw new Error(`drand HTTP ${latest.status}`);
  const R = (await latest.json()).round - 5;
  const RT = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
  const id = randomBytes(32).toString("hex");
  const signerKey = generateKeyPairSync("ed25519");
  const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signerHex = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const witnessKeys = [generateWitnessKey(), generateWitnessKey(), generateWitnessKey()];
  const witnessSet = { version: 1, auction_id: id, q_w: 2, keys: witnessKeys.map((k) => k.public_hex) };
  const witnessPacket = signRecord(witnessSet, signerPem);
  const envelopeKeys = HOSTS.map((_, i) => {
    const k = JSON.parse(readFileSync(path.join(hostDir(HOSTS[i]), "signers", HOSTS[i], "envelope-key.json"), "utf8"));
    return k.public_hex as string;
  });
  const manifest: any = {
    version: 1, network: "test", auction_id: id,
    escrow_ua: "utest1" + randomBytes(20).toString("hex"), frost_group_key: randomBytes(32).toString("hex"),
    lot: `${name} fixture lot`, supply: opts.supply ?? deliverPlan.length,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: "500000", q_max: opts.qMax ?? 1,
    C_zats: String(opts.C ?? 500_000), fee_zats: "0", deposit_addresses: deliverPlan.map(() => "utest1" + randomBytes(20).toString("hex")),
    drand: { ...schema.QUICKNET, R },
    T_submit: RT - 850, T_freeze: RT - 100, confirmations: 10,
    clearing: { mode, band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    envelope_keys: envelopeKeys,
    witness_set_hash: witnessSetHash(witnessPacket),
    ...(opts.buyback ? { buyback: opts.buyback } : {}),
    ...(opts.otc ? { otc: opts.otc } : {}),
  };
  const packet = signRecord(manifest, signerPem);
  const client = clientForMode(packet, signerHex);
  const pinnedInfo = {
    public_key: schema.QUICKNET.public_key, period: schema.QUICKNET.period, genesis_time: schema.QUICKNET.genesis,
    hash: chainHash, groupHash: "", schemeID: schema.QUICKNET.scheme, metadata: { beaconID: "quicknet" },
  };
  // Only chain().info() is read by timelockEncrypt; the pinned info stands in for the network fetch.
  const pinnedClient = { chain: () => ({ info: async () => pinnedInfo }) } as unknown as Parameters<typeof tlock.timelockEncrypt>[2];
  const records: any[] = [], openPlaintexts: string[] = [];
  const prices = opts.prices ?? deliverPlan.map(() => 250_000);
  const quantities = opts.quantities ?? deliverPlan.map(() => 1);
  for (let i = 0; i < deliverPlan.length; i++) {
    const prep = bid.prepareBid({ auction_id: id, price_zats: BigInt(prices[i]), quantity: quantities[i], destination_ua: UA, deliver: deliverPlan[i], envelope_public_hexs: envelopeKeys, ...(opts.owners?.[i] ? { owner: opts.owners[i] } : {}) } as any);
    // The shipped browser sealer stamps the mode's plaintext layout version (cli/product.ts passes
    // `layout_version`; OTC orders are version 3, clear/otc.ts OTC_LAYOUT). The time-compressed fixture cannot
    // drive `bid seal` (it refuses to seal after T_submit, and a past drand round keeps R > T_submit), so the
    // fixture stamps the same byte itself; the clearing under test still verifies the layout end to end.
    const ptBuf = Buffer.from(prep.plaintext_hex, "hex");
    ptBuf[0] = mode === "otc" ? 3 : 0;
    const ptHex = ptBuf.toString("hex");
    const ctHex = Buffer.from(armor.decodeArmor(await tlock.timelockEncrypt(R, Buffer.from(ptHex, "hex"), pinnedClient)), "binary").toString("hex");
    const bound = bid.bindSealedBid({ ...prep, plaintext_hex: ptHex }, id, sha256(Buffer.from(ctHex, "hex")));
    records.push({ ciphertext_hash: bound.ciphertext_hash_hex, envelope_ct: bound.envelope_ct_hex, owner_sig: bound.owner_sig_hex, ct_hex: ctHex });
    openPlaintexts.push(ptHex);
  }
  const beaconRes = await fetch(`${drandBase}/${chainHash}/public/${R}`);
  if (!beaconRes.ok) throw new Error(`drand HTTP ${beaconRes.status} for round ${R}`);
  const beacon = await beaconRes.json();
  const leaves = records.map((r, i) => ({
    auction_id: id, manifest_hash: client.manifest_hash, ciphertext_hash: r.ciphertext_hash,
    deposit: { txid: randomBytes(32).toString("hex"), pool: "ironwood" as const, address: manifest.deposit_addresses[i], diversifier_index: String(i) },
    leaf_index: i, ciphertext_hex: r.ct_hex,
  }));
  const frozenTree = merkle.tree(leaves);
  const frozen = { auction_id: id, manifest_hash: client.manifest_hash, root: frozenTree.root, leaf_count: leaves.length, cutoff: R, published_at: RT - 500, leaves, paths: frozenTree.paths };
  const openedInput = openPlaintexts.map((p, i) => ({ leaf_index: i, plaintext_hex: p }));
  const result = clearForMode({ manifest: packet, signer: signerHex, frozen, opened: openedInput, reserve_opening: null, ...(opts.otc ? {} : {}) } as any);
  const statement = freezeStatement(client.manifest as any, frozen as any);
  const cert = { statement, signatures: witnessKeys.slice(0, 2).map((k) => signStatement(statement, k.private_hex)) };
  const doc = {
    version: 1, auction_id: id, signer: signerHex, manifest: packet, state: "OPENED", receipts: [],
    frozen, opened: openedInput,
    beacon: { round: R, signature: beacon.signature, chain_hash: chainHash },
    envelopes: records.map((r) => ({ ciphertext_hash: r.ciphertext_hash, envelope_ct: r.envelope_ct, owner_sig: r.owner_sig })),
    witness_set: witnessPacket, witness_cert: [cert],
    result,
  };
  rmSync(assertScratch(PUB), { recursive: true, force: true });
  mkdirSync(PUB, { recursive: true });
  writeFileSync(path.join(PUB, "auction.json"), JSON.stringify(doc, null, 2) + "\n");
  const resultBytes = jsonBytes(result);
  writeFileSync(path.join(PUB, "result.json"), resultBytes);
  return {
    id, signerHex, result, resultBytes, resultHash: "0x" + sha256(resultBytes),
    zcashIdentifiers: [
      ...manifest.deposit_addresses, manifest.escrow_ua, UA,
      ...leaves.map((l) => (l.deposit as any).txid),
    ],
  };
}

// ---- no-Zcash-material scan (crosschain §3 lesson 5) ---------------------------------
async function assertNoZcashOnChain(label: string, chains: { evm?: { rpc: string; txs: string[] }; solana?: { rpc: string; txs: string[] } }, identifiers: string[]) {
  let all = "";
  if (chains.evm) {
    const p = new JsonRpcProvider(chains.evm.rpc, undefined, { staticNetwork: true });
    for (const txid of chains.evm.txs) {
      const t = await p.send("eth_getTransactionByHash", [txid]);
      if (t) all += JSON.stringify(t) + "\n";
      const r = await p.send("eth_getTransactionReceipt", [txid]);
      if (r) all += JSON.stringify(r) + "\n";
    }
  }
  if (chains.solana) {
    const c = new Connection(chains.solana.rpc, "confirmed");
    for (const txid of chains.solana.txs) {
      const t = await c.getTransaction(txid, { maxSupportedTransactionVersion: 0 });
      if (t) all += JSON.stringify(t) + "\n";
    }
  }
  const leaked = identifiers.filter((s) => all.includes(s));
  check(`${label}-no-zcash-on-chain`, all.length > 0 && leaked.length === 0,
    `Zcash identifiers in target-chain payloads: ${leaked.map((s) => s.slice(0, 20)).join(",")}`);
}

// ---- the target-chain half (dry-run proven; also the live flow's step 4-6) ------------
type Chains = { evm: { rpc: string; escrow: string; key: string }; solana: { rpc: string; escrow: string; key: string } };
async function targetChainHalf(label: string, demo: { chain: "evm" | "solana"; stealth?: boolean; ct?: boolean }, chains: Chains, fixture: Awaited<ReturnType<typeof buildFixture>>, keys: Record<"evm" | "solana", Record<string, { pub: string; signerKey: string; envelopeKey: string }>>, local: boolean) {
  const chain = demo.chain;
  const c = chain === "evm" ? chains.evm : chains.solana;
  const lot = chain === "evm" ? parseEther("1") : BigInt(1 * LAMPORTS_PER_SOL);
  // the expected payouts come from the CLEARED RESULT (allocations[].fill) and the bidder-sealed delivers — the same
  // derivation the hosts did themselves (R21/R22); the coordinator never supplies any of it. The lock amount covers
  // every attested lot (the escrow's cap is paid + amount <= locked).
  const fills = (fixture.result.allocations as any[]).filter((a) => Number(a.fill) > 0).map((a) => ({ index: Number(a.leaf_index), fill: Number(a.fill) }));
  const totalLots = fills.reduce((s, f) => s + f.fill, 0);
  const amountLot = (lot * BigInt(totalLots)).toString();
  // 1. lock BEFORE bidding is the caller's order (live: lock, then the markets scenario). Here the fixture predates
  //    the lock only in harness time — the escrow state the attest reads is what a pre-bidding lock leaves.
  const signersFile = path.join(WORK, `signers-${chain}.json`);
  writeFileSync(signersFile, JSON.stringify(HOSTS.map((n) => keys[chain][n].pub), null, 2));
  const returnTo = chain === "evm" ? new Wallet(readFileSync(c.key, "utf8").trim()).address : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(c.key, "utf8")))).publicKey.toBase58();
  const now = Math.floor(Date.now() / 1000);
  const lock = benzo(["xchain", "lock", "--chain", chain, "--auction", "0x" + fixture.id,
    "--amount", amountLot, "--lot", lot.toString(), "--lock-until", String(now + 600), "--deadline", String(now + 3600),
    "--signers", signersFile, "--return", returnTo, "--key", c.key, "--escrow", c.escrow, "--rpc", c.rpc]);
  check(`${label}-lock`, typeof lock.tx === "string" && lock.tx.length > 0, JSON.stringify(lock).slice(0, 160));

  // 2. the host-side attest: ON each host with its own envelope key and xchain key (local stand-ins in the dry run;
  //    live: `orb run ... benzo xchain attest --host-record` through e2e/lib/hosts.ts)
  const records: Record<string, any> = {};
  for (const n of HOSTS) {
    const args = ["xchain", "attest", "--host-record", "--chain", chain, "--auction", "0x" + fixture.id,
      "--result", path.join(PUB, "result.json"), "--result-hash", fixture.resultHash,
      "--batch", "0", "--nonce", "0", "--expiry", String(now + 1800), "--asset", "0x0000000000000000000000000000000000000000",
      "--dir", PUB, "--envelope-key", keys[chain][n].envelopeKey, "--signer-key", keys[chain][n].signerKey,
      "--escrow", c.escrow, "--rpc", c.rpc, "--out", path.join(WORK, `${label}-record-${chain}-${n}.json`)];
    const rec = local
      ? JSON.parse(benzoRaw(args, { stateDir: hostDir(n) }).stdout)
      : hosts.hostXchainAttest(n, args.slice(1));
    records[n] = rec;
    check(`${label}-attest-${n}`, rec.signers?.length === 1
      && (chain === "evm" ? rec.signers[0] === keys[chain][n].pub.toLowerCase() : rec.signers[0] === keys[chain][n].pub)
      && rec.payouts?.length >= 1 && typeof rec.attestation_bytes === "string", `signers ${JSON.stringify(rec.signers)} own ${keys[chain][n].pub}`);
  }
  const rs = HOSTS.map((n) => records[n]);
  check(`${label}-attest-identical-bytes`, new Set(rs.map((r) => String(r.attestation_bytes).toLowerCase())).size === 1
    && new Set(rs.map((r) => JSON.stringify(r.payouts))).size === 1, "host records disagree");

  // the expected payouts come from the CLEARED RESULT (allocations[].fill) and the bidder-sealed delivers — the same
  // derivation the hosts did themselves (R21/R22); the coordinator never supplies any of it
  const payouts = rs[0].payouts as any[];
  check(`${label}-payouts-match-result`, payouts.length === fills.length
    && fills.every((f) => payouts.some((p) => p.index === f.index && p.lot_count === f.fill)),
    `payouts ${JSON.stringify(payouts.map((p: any) => [p.index, p.lot_count]))} fills ${JSON.stringify(fills)}`);
  if (label === "demo1") {
    check("demo1-multilot-shape", fills.some((f) => f.fill >= 2), JSON.stringify(fills));
  }

  // 3. the coordinator's release from two host records (it holds no signer key)
  const atts = [path.join(WORK, `${label}-record-${chain}-${HOSTS[0]}.json`), path.join(WORK, `${label}-record-${chain}-${HOSTS[1]}.json`)];
  const rel = benzoRaw(["xchain", "release", "--chain", chain, ...atts.flatMap((f) => ["--attestation", f]),
    "--key", c.key, "--rpc", c.rpc,
    ...(demo.stealth ? ["--stipend", "10000000000000", "--announcer", CANONICAL_ERC5564_ANNOUNCER] : [])]);
  const relOut = JSON.parse(rel.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1)!);
  check(`${label}-release`, rel.status === 0 && typeof relOut.tx === "string", `status ${rel.status} ${(rel.stderr || rel.stdout).slice(0, 160)}`);

  // 4. delivery at the bidders' own fresh destinations (balances = lot_count x standard_lot; a stealth destination
  //    also holds its tiny gas stipend — crosschain §4 lesson 6)
  const stipend = demo.stealth ? 10000000000000n : 0n;
  if (chain === "evm") {
    const p = new JsonRpcProvider(c.rpc, undefined, { staticNetwork: true });
    const bal = (a: string) => p.send("eth_getBalance", [a, "latest"]).then((h) => BigInt(h));
    for (const pay of payouts) {
      const dest = pay.destination as string;
      const want = BigInt(pay.lot_count) * lot + stipend;
      if (demo.stealth) {
        // stealth: the one-time address pays out, its derivation is signer-reproducible from the sealed meta-address
        check(`${label}-stealth-paid-${pay.index}`, (await bal(dest)) === want,
          `balance ${await bal(dest)} at ${dest.slice(0, 10)}… want ${want}`);
      } else {
        check(`${label}-paid-${pay.index}`, (await bal(dest)) === want,
          `balance at ${dest.slice(0, 10)}… want ${want}`);
      }
    }
  } else {
    const conn = new Connection(c.rpc, "confirmed");
    for (const pay of payouts) {
      const got = await conn.getBalance(new PublicKey(pay.destination));
      check(`${label}-paid-${pay.index}`, BigInt(got) === BigInt(pay.lot_count) * lot,
        `balance ${got} at ${String(pay.destination).slice(0, 10)}… want ${BigInt(pay.lot_count) * lot}`);
    }
  }

  // 5. the result hash IS the published result hash (xchain status --result ties the escrow's approval to the file)
  const st = benzoRaw(["xchain", "status", "--chain", chain, "--auction", "0x" + fixture.id, "--escrow", c.escrow,
    "--rpc", c.rpc, "--bundle", atts[0], "--result", path.join(PUB, "result.json")]);
  check(`${label}-result-hash`, st.status === 0 && JSON.parse(st.stdout).result_hash?.match === true,
    `status ${st.status} ${(st.stderr || "").slice(0, 120)}`);

  // 6. nothing from Zcash on the target chain
  const txs: string[] = [lock.tx, ...(Array.isArray(relOut.txs) ? relOut.txs : [relOut.tx]), ...(relOut.stipend_txs ?? []), ...(relOut.announce_txs ?? [])].filter(Boolean);
  await assertNoZcashOnChain(label, { [chain]: { rpc: c.rpc, txs } } as any, fixture.zcashIdentifiers);
  return { relOut, txs };
}

// ---- local dry run: local chains + stand-in hosts ------------------------------------
async function localDemo(name: string, chains: Chains) {
  const label = name;
  const keys = { evm: localHostKeys("evm"), solana: localHostKeys("solana") }; // the stand-in hosts' own keys, before any fixture seals to them
  if (name === "demo1") {
    const delivers: Deliver[] = [
      { chain: "solana", kind: "address", to: Keypair.generate().publicKey.toBase58() },
      { chain: "solana", kind: "address", to: Keypair.generate().publicKey.toBase58() },
      { chain: "solana", kind: "address", to: Keypair.generate().publicKey.toBase58() },
    ];
    const fixture = await buildFixture("demo1", "uniform", delivers, { supply: 4, quantities: [2, 1, 1], prices: [300_000, 250_000, 200_000], qMax: 2, C: 1_000_000 });
    await targetChainHalf(label, { chain: "solana" }, chains, fixture, keys, true);
  } else if (name === "demo2") {
    const metas = [generateStealthMetaAddress(), generateStealthMetaAddress()];
    const delivers: Deliver[] = metas.map((m) => ({ chain: "evm", kind: "stealth", to: m.stealthMetaAddress as string }));
    const fixture = await buildFixture("demo2", "buyback", delivers, {
      supply: 2, prices: [300_000, 250_000],
      buyback: { budget_zats: "600000", max_price_zats: "300000", treasury_ua: "utest1" + randomBytes(20).toString("hex"), funding_ua: "utest1" + randomBytes(20).toString("hex") },
    });
    await targetChainHalf(label, { chain: "evm", stealth: true }, chains, fixture, keys, true);
  } else {
    // the OTC counterparties bid with their own pinned keys (the signed otc block names them)
    const ownerKeys = [generateOwnerKey(), generateOwnerKey()];
    const delivers: Deliver[] = [
      { chain: "solana", kind: "address", to: Keypair.generate().publicKey.toBase58() },
      { chain: "solana", kind: "address", to: Keypair.generate().publicKey.toBase58() },
    ];
    const fixture = await buildFixture("demo3", "otc", delivers, {
      supply: 1, prices: [400_000, 200_000], owners: ownerKeys,
      otc: { buyer_key: ownerKeys[0].public_hex, seller_key: ownerKeys[1].public_hex },
    });
    await targetChainHalf(label, { chain: "solana" }, chains, fixture, keys, true);
  }
}

// ---- live flow (the head runs this on main with the real signer hosts) ----------------
async function liveDemo(name: string) {
  const label = name;
  const chain: "evm" | "solana" = name === "demo2" ? "evm" : "solana";
  // hosts generate their own keys; the Mac keeps only the public halves
  const evmPubs = hosts.hostXchainKeys("evm"), solPubs = hosts.hostXchainKeys("solana");
  const id = randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const chains: Chains = {
    evm: { rpc: env("BNZ_SEPOLIA_RPC_URL") || "https://ethereum-sepolia-rpc.publicnode.com", escrow: env("BNZ_XCHAIN_EVM_ESCROW") || "0x1dc207D5B04C8CFB043d4420054a2219a544dD85", key: path.join(STATE, "evm", "deployer.key") },
    solana: { rpc: env("BNZ_SOLANA_DEVNET_RPC") || "https://api.devnet.solana.com", escrow: env("BNZ_XCHAIN_SOL_PROGRAM") || "2h6tgr5Ay1WE3u6kmPZnKh9EyTu7dkgWFkkrjCA5QyPu", key: path.join(STATE, "solana", "deployer.json") },
  };
  const c = chains[chain];
  const signersFile = path.join(WORK, `signers-live-${chain}.json`);
  writeFileSync(signersFile, JSON.stringify((chain === "evm" ? evmPubs : solPubs), null, 2));
  // Live lots are testnet-faucet sized (head, 2026-10-06): the deployers hold ~0.08 Sepolia ETH and ~0.66 devnet SOL.
  const amountLot = chain === "evm" ? parseEther("0.002") : BigInt(0.02 * LAMPORTS_PER_SOL);
  const lockLots = name === "demo1" ? 4 : 2; // enough locked for every attested lot (the escrow's cap: paid + amount <= locked)
  const returnTo = chain === "evm" ? new Wallet(readFileSync(c.key, "utf8").trim()).address : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(c.key, "utf8")))).publicKey.toBase58();
  // the escrow lock BEFORE bidding (crosschain §2): the demo binds the auction id first
  const lock = benzo(["xchain", "lock", "--chain", chain, "--auction", "0x" + id,
    "--amount", (amountLot * BigInt(lockLots)).toString(), "--lot", amountLot.toString(), "--lock-until", String(now + 60 * 60), "--deadline", String(now + 6 * 3600),
    "--signers", signersFile, "--return", returnTo, "--key", c.key, "--escrow", c.escrow, "--rpc", c.rpc]);
  console.log(`[${label}] locked ${lock.tx}`);
  // the Zcash side: the markets.ts scenario engine (child; its locks) with the pre-bound id
  const scenario = name === "demo1" ? "xchain-drop" : name === "demo2" ? "xchain-buyback" : "xchain-otc";
  execFileSync("npx", ["esbuild", "tools/repro/markets.ts", "--bundle", "--packages=external", "--platform=node", "--format=esm", "--outfile=tmp/markets.mjs"], { cwd: ROOT, stdio: "inherit" });
  execFileSync("node", [path.join(ROOT, "tmp/markets.mjs"), scenario], { cwd: ROOT, stdio: "inherit", env: { ...process.env, BNZ_MARKETS_ID: id, BNZ_LWD_SINGLE: "1" } });
  const publicDir = path.join(ROOT, "tmp/markets/public", id);
  const fixtureResult = JSON.parse(readFileSync(path.join(publicDir, "result.json"), "utf8"));
  const resultHash = "0x" + sha256(readFileSync(path.join(publicDir, "result.json")));
  // host attest on the real hosts over the pushed public dir (e2e/lib/hosts.ts)
  const records: any[] = [];
  for (const n of HOSTS) {
    hosts.push(n, publicDir, `pub-${id.slice(0, 12)}`);
    const rec = hosts.hostXchainAttest(n, ["--chain", chain, "--auction", "0x" + id,
      "--result", `/home/benzo/pub-${id.slice(0, 12)}/result.json`, "--result-hash", resultHash,
      "--batch", "0", "--nonce", "0", "--expiry", String(now + 3 * 3600), "--asset", "0x0000000000000000000000000000000000000000",
      "--dir", `/home/benzo/pub-${id.slice(0, 12)}`,
      "--envelope-key", `${hosts.H}/signers/${n}/envelope-key.json`, "--signer-key", `${hosts.H}/xchain/${chain}-${n}.key`,
      "--escrow", c.escrow, "--rpc", c.rpc, "--out", `/home/benzo/${label}-record-${chain}.json`]);
    records.push(rec);
  }
  writeFileSync(path.join(WORK, `${label}-record-${chain}-live-a.json`), JSON.stringify(records[0], null, 2));
  writeFileSync(path.join(WORK, `${label}-record-${chain}-live-b.json`), JSON.stringify(records[1], null, 2));
  const rel = benzoRaw(["xchain", "release", "--chain", chain,
    "--attestation", path.join(WORK, `${label}-record-${chain}-live-a.json`),
    "--attestation", path.join(WORK, `${label}-record-${chain}-live-b.json`),
    "--key", c.key, "--rpc", c.rpc,
    ...(name === "demo2" ? ["--stipend", "10000000000000", "--announcer", CANONICAL_ERC5564_ANNOUNCER] : [])]);
  check(`${label}-release`, rel.status === 0, (rel.stderr || rel.stdout).slice(0, 200));
  const relOut = JSON.parse(rel.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1)!);
  const delivers = JSON.parse(readFileSync(path.join(STATE, "run", `markets-${id}`, "xchain-delivers.json"), "utf8")) as (Deliver | null)[];
  const zcashIds = JSON.parse(readFileSync(path.join(STATE, "run", `markets-${id}`, "refunds.json"), "utf8")) as string[];
  const txs: string[] = [lock.tx, ...(Array.isArray(relOut.txs) ? relOut.txs : [relOut.tx]), ...(relOut.stipend_txs ?? []), ...(relOut.announce_txs ?? [])].filter(Boolean);
  await assertNoZcashOnChain(label, { [chain]: { rpc: c.rpc, txs } } as any, zcashIds);
  console.log(`[${label}] result ${JSON.stringify(fixtureResult.allocations?.slice(0, 4))} delivers ${JSON.stringify(delivers)} — payments asserted at the host records' destinations by xchain status`);
}

// ---- entry --------------------------------------------------------------------------
const local = process.argv.includes("--local");
const which = process.argv.filter((a) => /^demo[123]$/.test(a));
const localChains: Chains = {
  evm: { rpc: process.env.BNZ_EVM_RPC ?? "http://127.0.0.1:8548", escrow: process.env.BNZ_EVM_ESCROW_LOCAL ?? "", key: path.join(WORK, "evm-crank.key") },
  solana: { rpc: `http://127.0.0.1:${process.env.BNZ_SOLANA_TEST_RPC_PORT ?? 8903}`, escrow: process.env.BNZ_SOLANA_PROGRAM ?? "", key: path.join(WORK, "sol-crank.json") },
};
try {
  if (local) {
    if (!localChains.solana.escrow) throw new Error("BNZ_SOLANA_PROGRAM must name the loaded local program");
    // fresh stand-in host state dirs per run
    rmSync(assertScratch(HOSTROOT), { recursive: true, force: true });
    for (const n of HOSTS) mkdirSync(hostDir(n), { recursive: true, mode: 0o700 });
    // crank keys + escrow deploy + canonical Announcer/Registry for the stealth demo
    const ANVIL_SK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    writeFileSync(localChains.evm.key, ANVIL_SK, { mode: 0o600 });
    writeFileSync(localChains.solana.key, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
    const solPayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(localChains.solana.key, "utf8"))));
    const sol = new Connection(localChains.solana.rpc, "confirmed");
    const airdrop = await sol.requestAirdrop(solPayer.publicKey, 10 * LAMPORTS_PER_SOL);
    await sol.confirmTransaction(airdrop);
    const escrowEvm = JSON.parse(execFileSync("forge", ["create", "src/BenzoEscrow.sol:BenzoEscrow", "--root", path.join(ROOT, "contracts/evm"),
      "--rpc-url", localChains.evm.rpc, "--private-key", ANVIL_SK, "--json", "--broadcast"], { cwd: ROOT, encoding: "utf8" })).deployedTo;
    localChains.evm.escrow = escrowEvm;
    if (which.includes("demo2")) {
      // the local chain runs the canonical ERC-5564 contracts AT their canonical addresses (stealth-demo pattern)
      const evm = new JsonRpcProvider(localChains.evm.rpc, undefined, { staticNetwork: true });
      const { ContractFactory, NonceManager } = await import("ethers");
      const wallet = new NonceManager(new Wallet(ANVIL_SK, evm)); // both deploys from one account, no nonce race
      const stealth = await import("../../crosschain/stealth");
      const ann = new ContractFactory(stealth.ANNOUNCER_ABI as any, stealth.CANONICAL_ERC5564_BYTECODE, wallet);
      const annC = await ann.deploy(); await annC.waitForDeployment();
      const reg = new ContractFactory(stealth.REGISTRY_ABI as any, stealth.CANONICAL_ERC6538_BYTECODE, wallet);
      const regC = await reg.deploy(); await regC.waitForDeployment();
      await evm.send("anvil_setCode", [stealth.CANONICAL_ERC5564_ANNOUNCER, await evm.getCode(await annC.getAddress())]);
      await evm.send("anvil_setCode", [stealth.CANONICAL_ERC6538_REGISTRY, await evm.getCode(await regC.getAddress())]);
    }
    for (const name of which.length ? which : ["demo1", "demo2", "demo3"]) await localDemo(name, localChains);
  } else {
    for (const name of which.length ? which : ["demo1"]) await liveDemo(name);
  }
  console.log(failures ? `RESULT FAIL ${failures} failing` : "RESULT PASS all xchain demo assertions");
  process.exit(failures ? 1 : 0);
} catch (e) {
  console.error(`ERROR xchain-demos ${(e as Error).stack ?? e}`);
  process.exit(1);
}
