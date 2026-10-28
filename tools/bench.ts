// Offline scale run: synthetic public deposits, real tlock/owner/envelope/witness cryptography.
// Each stage runs in a fresh process so maxRSS is that stage's process high-water mark.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { timelockEncrypt } from "tlock-js";
import { decodeArmor } from "tlock-js/age/armor.js";
import { QUICKNET, hash, jsonBytes, signRecord, requireThat, type Manifest } from "../manifest/schema";
import { tree, type Leaf, type Frozen } from "../clear/merkle";
import { clearForMode, modeEntry } from "../clear/registry";
import { planBatches, type PlanRow } from "../settle/batching";
import { Ledger, type Obligation } from "../settle/ledger";
import { ownerPublic, generateEnvelopeKey, sealEnvelope, signEnvelope, verifyEnvelope, settlementCommitment, ENVELOPE_CT_BYTES_N3 } from "../envelope";
import { freezeStatement, signStatement, witnessSetHash, checkCertificates } from "../witness";
import { publishedClient, decryptPublished } from "../cli/published-beacon";
import { run as verify } from "../cli/commands/verify";

type Stage = { stage: string; seconds: number | null; peak_rss_mib: number | null; status: string; error?: string };
const seed = "benzo-phase6-offline-v1";
const BATCH_CAP = 28; // batch_cap up to 28
const bytes = (tag: string) => Buffer.from(hash(seed + ":" + tag), "hex");
const ed = (tag: string) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), bytes(tag)]), type: "pkcs8", format: "der" });
const pem = (tag: string) => ed(tag).export({ type: "pkcs8", format: "pem" }).toString();
const publicHex = (tag: string) => createPublicKey(ed(tag)).export({ type: "spki", format: "der" }).toString("hex");
const rawPublic = (tag: string) => publicHex(tag).slice(24);
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const write = (file: string, value: unknown) => writeFileSync(file, jsonBytes(value));
// Settlement pays Orchard/Ironwood only, so the synthetic destination is the fixtures' Orchard-capable testnet UA
// (Sapling+Orchard receivers). No wallet or funds.
const BENCH_UA = "utest1nqaarlf8ehmtateefnysz3a6mxvtl39cgvtmj68ngj9266vtk7efr936qp67cz4aywuy4cqss3pfu870hxmkruhmrzgetw2jq7dle6lvzrgsrckh2ugw4fehsyd7j66sy67x84hylx5rjg47qnkzztwf9zvce9v6je7ngd6j8mjh44knm2kj7u6c67nv20dk6hkhsfugd5t7jqlkjfm";
function destination(): string { return BENCH_UA; }

async function stage(name: string, dir: string, count: number) {
  const input = name === "generate" ? null : read(resolve(dir, "input.json"));
  const auction_id = bytes("auction:" + count).toString("hex"), signer = publicHex("manifest");
  if (name === "generate") {
    // Fixed past round; freshly fetched authentic beacon, never a recorded response.
    const R = 32704232;
    const response = await fetch(`https://api.drand.sh/${QUICKNET.chain_hash}/public/${R}`, { signal: AbortSignal.timeout(15000) });
    requireThat(response.ok, `drand HTTP ${response.status}`);
    const beacon = { ...await response.json() as { round: number; signature: string }, chain_hash: QUICKNET.chain_hash };
    requireThat(beacon.round === R, "drand round");
    const client = publishedClient(beacon), release = QUICKNET.genesis + (R - 1) * QUICKNET.period;
    requireThat(release < Date.now() / 1000, "benchmark round must be past");
    const witness_set = signRecord({ version: 1, auction_id, q_w: 2, keys: [0, 1, 2].map(i => rawPublic("witness:" + i)) }, pem("manifest"));
    const address = "utest1" + bytes("public-deposit-address").toString("hex");
    const envelopeKeys = [generateEnvelopeKey(), generateEnvelopeKey(), generateEnvelopeKey()];
    const manifest: Manifest = { version: 1, network: "test", auction_id, escrow_ua: address, frost_group_key: bytes("group").toString("hex"), lot: "offline scale",
      supply: count, reserve_zats: "1000", tick_zats: "1000", B_max_zats: "100000", q_max: 10, C_zats: "1000100", fee_zats: "100",
      deposit_addresses: [address], drand: { ...QUICKNET, R }, T_submit: release - 1000, T_freeze: release - 200, confirmations: 10,
      clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
      refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
      // The product rule: the signed manifest pins the three envelope keys the bids are sealed to,
      // in the exact stanza order sealEnvelope uses; verify's envelope record check enforces it (a bench run
      // without this field is refused `envelope record format`, which is the rule working, not a product bug).
      envelope_keys: envelopeKeys.map(k => k.public_hex), witness_set_hash: witnessSetHash(witness_set) };
    const packet = signRecord(manifest, pem("manifest"));
    const bids: any[] = [];
    for (let i = 0; i < count; i++) {
      const owner = { private_hex: bytes("owner:" + i).toString("hex"), public_hex: ownerPublic(bytes("owner:" + i).toString("hex")) };
      const envelope_ct = sealEnvelope(destination(), envelopeKeys.map(k => k.public_hex), "test"); // bench fixtures are testnet-format (destination above)
      const nonce = bytes("nonce:" + i).subarray(0, 16).toString("hex"), pt = Buffer.alloc(128);
      Buffer.from(auction_id, "hex").copy(pt, 1); pt.writeBigUInt64BE(BigInt(1 + bytes("price:" + i).readUInt32BE(0) % 100) * 1000n, 33);
      pt.writeUInt32BE(1 + bytes("quantity:" + i).readUInt32BE(0) % 10, 41); Buffer.from(nonce, "hex").copy(pt, 45);
      Buffer.from(owner.public_hex, "hex").copy(pt, 61); Buffer.from(settlementCommitment(nonce, envelope_ct), "hex").copy(pt, 93);
      const armored = await timelockEncrypt(R, pt, client), ct = Buffer.from(decodeArmor(armored), "binary");
      requireThat(ct.length <= 505, "ciphertext memo cap");
      const memo = Buffer.alloc(512); Buffer.from("ff424e5a01", "hex").copy(memo); memo.writeUInt16BE(ct.length, 5); ct.copy(memo, 7);
      const ciphertext_hash = hash(ct);
      bids.push({ memo_hex: memo.toString("hex"), owner: owner.public_hex, envelope_ct, owner_sig: signEnvelope(owner, auction_id, ciphertext_hash, envelope_ct),
        deposit: { txid: bytes("txid:" + i).toString("hex"), pool: "ironwood", address, diversifier_index: String(i) } });
      if ((i + 1) % 1000 === 0) process.stderr.write(`generate ${i + 1}/${count}\n`);
    }
    write(resolve(dir, "input.json"), { packet, signer, manifest, beacon: { round: R, signature: beacon.signature, chain_hash: QUICKNET.chain_hash }, witness_set, bids });
  } else if (name === "admission") {
    const leaves: Leaf[] = [], envelopes: any[] = [], receipts: any[] = [];
    for (const [i, bid] of input.bids.entries()) {
      requireThat(/^[0-9a-f]{1024}$/.test(bid.memo_hex), "memo length");
      const memo = Buffer.from(bid.memo_hex, "hex"), length = memo.readUInt16BE(5), ct = memo.subarray(7, 7 + length);
      requireThat(memo.subarray(0, 5).equals(Buffer.from("ff424e5a01", "hex")) && length > 0 && length <= 505 && memo.subarray(7 + length).equals(Buffer.alloc(505 - length)), "memo header/padding");
      const header = ct.toString("binary").split("--- ")[0];
      requireThat(header.startsWith("age-encryption.org/v1\n") && header.includes(`-> tlock ${input.manifest.drand.R} ${QUICKNET.chain_hash}\n`) && (header.match(/-> /g) ?? []).length === 1, "tlock stanza");
      const ciphertext_hash = hash(ct);
      requireThat(/^[0-9a-f]+$/.test(bid.envelope_ct) && bid.envelope_ct.length === ENVELOPE_CT_BYTES_N3 * 2 && verifyEnvelope(bid.owner, auction_id, ciphertext_hash, bid.envelope_ct, bid.owner_sig), "envelope intake");
      const receipt = { auction_id, manifest_hash: input.packet.sha256, ciphertext_hash, deposit: bid.deposit, leaf_index: i };
      leaves.push({ ...receipt, ciphertext_hex: ct.toString("hex") }); receipts.push(signRecord(receipt, pem("manifest")));
      envelopes.push({ ciphertext_hash, envelope_ct: bid.envelope_ct, owner_sig: bid.owner_sig });
    }
    write(resolve(dir, "admitted.json"), { leaves, envelopes, receipts });
  } else if (name === "freeze") {
    const admitted = read(resolve(dir, "admitted.json"));
    const frozen: Frozen = { auction_id, manifest_hash: input.packet.sha256, ...tree(admitted.leaves), leaf_count: count,
      cutoff: input.manifest.T_freeze, published_at: input.manifest.T_freeze - 100, leaves: admitted.leaves };
    const statement = freezeStatement(input.manifest, frozen), witness_cert = [{ statement, signatures: [0, 1].map(i => signStatement(statement, bytes("witness:" + i).toString("hex"))) }];
    checkCertificates(witness_cert, { q_w: 2, keys: [0, 1, 2].map(i => rawPublic("witness:" + i)) }, statement);
    write(resolve(dir, "frozen.json"), frozen); write(resolve(dir, "witness-cert.json"), witness_cert);
  } else if (name === "open") {
    const local = publishedClient(input.beacon), frozen = read(resolve(dir, "frozen.json")), opened = [];
    for (const leaf of frozen.leaves) { const pt = await decryptPublished(leaf.ciphertext_hex, local); requireThat(pt !== null, "benchmark decrypt"); opened.push({ leaf_index: leaf.leaf_index, plaintext_hex: pt }); }
    write(resolve(dir, "opened.json"), opened);
  } else if (name === "batch-plan") {
    // The settlement batch plan over the cleared obligations, via the pure batching module. The fee
    // model: each synthetic bid backs one deposit note (the seller payout backs none), plus one
    // fee-reserve spend per batch; outputs are the batch's rows; actions = max(spends, outputs, 2);
    // ZIP-317 fee = 5,000 zats per action. This reproduces the measured scale-27 batch exactly
    // (27 deposits + fee reserve = 28 spends, 28 outputs, fee 140,000).
    const result = read(resolve(dir, "result.json"));
    const obligations = [...modeEntry(input.packet).obligations(result, null)].map(([party, amount_zats]) => ({ party, amount_zats }));
    const batches = planBatches(obligations, BATCH_CAP);
    let fee_zats = 0n;
    for (const b of batches) {
      const deposits = b.parties.filter(p => p !== "seller").length;
      const spends = deposits + 1, outputs = b.parties.length;
      fee_zats += 5000n * BigInt(Math.max(spends, outputs, 2));
    }
    write(resolve(dir, "batch-plan.json"), { batch_cap: BATCH_CAP, rows: obligations.length,
      settlement_batches: batches.length, estimated_fee_zats: fee_zats.toString() });
    // check: planBatches
    // must equal the real settlement Ledger's allocate batch-for-batch — same ids, same parties in the
    // same order — at caps 13 and 28. The reference is a real Ledger over real SQLite driven through its
    // own pin/eligible/allocate/stage/confirm methods; expected values come from that ledger, never from
    // the code under test. Failure prints one grep-able `ERROR batching-equal-cap{13,28}` line.
    mkdirSync("tmp", { recursive: true });
    const eqRows: PlanRow[] = [];
    for (let i = 0; i < 1000; i++) {
      // "B…" sorts before "a…" in byte order and after it under localeCompare; the last two rows are
      // non-BMP vs BMP, where UTF-16 code-unit order disagrees with UTF-8 byte order (SQLite BINARY).
      const party = i < 998 ? (i % 2 === 0 ? "B" : "a") + i.toString(16).padStart(4, "0") + "-row" : i === 998 ? "u-\u{1F600}-x" : "u-\uFFFD-x";
      eqRows.push({ party, amount_zats: String(1000 + i) });
    }
    const eqInput = [...eqRows].reverse(); // input order must not matter
    for (const cap of [13, 28]) {
      const state = mkdtempSync(resolve("tmp", "batching-equal-"));
      try {
        const ledger = new Ledger(state, hash("bench:batching-equal:" + cap));
        ledger.pin(eqInput.map(r => ({ ...r, kind: "refund" }) as Obligation));
        ledger.eligible();
        const fromLedger: { id: number; parties: string[] }[] = [];
        for (;;) {
          const alloc = ledger.allocate(cap);
          if (!alloc) break;
          const file = resolve(state, `batch-${alloc.id}.bin`);
          writeFileSync(file, Buffer.alloc(64, alloc.id));
          const txid = hash("bench:batching-equal:" + cap + ":" + alloc.id);
          ledger.stage(alloc.id, file, txid);
          ledger.confirm(alloc.id, txid, 1000 + alloc.id,
            alloc.outputs.map((o, index) => ({ party: o.party, amount_zats: o.amount_zats, index, pool: "ironwood" })));
          fromLedger.push({ id: alloc.id, parties: alloc.outputs.map(o => o.party) });
        }
        ledger.close();
        const planned = planBatches(eqInput, cap);
        const at = fromLedger.length === planned.length ? fromLedger.findIndex((b, i) => JSON.stringify(b) !== JSON.stringify(planned[i])) : -2;
        if (at !== -1) {
          const i = at === -2 ? Math.min(fromLedger.length, planned.length) : at;
          throw Error(`ERROR batching-equal-cap${cap} batch ${i + 1}: ledger ${JSON.stringify(fromLedger[i] ?? null)} vs planBatches ${JSON.stringify(planned[i] ?? null)}`);
        }
        process.stdout.write(`PASS batching-equal cap=${cap} batches=${planned.length} rows=${eqRows.length}\n`);
      } finally { rmSync(state, { recursive: true, force: true }); }
    }
  } else if (name === "clear") {
    const result = clearForMode({ manifest: input.packet, signer, frozen: read(resolve(dir, "frozen.json")), opened: read(resolve(dir, "opened.json")) });
    write(resolve(dir, "result.json"), result);
  } else if (name === "verify") {
    const admitted = read(resolve(dir, "admitted.json")), frozen = read(resolve(dir, "frozen.json")), result = read(resolve(dir, "result.json"));
    const doc = { version: 1, auction_id, signer, manifest: input.packet, state: "CLEARED", receipts: admitted.receipts, frozen, result,
      opened: read(resolve(dir, "opened.json")), beacon: input.beacon, witness_set: input.witness_set, witness_cert: read(resolve(dir, "witness-cert.json")), envelopes: admitted.envelopes };
    write(resolve(dir, "auction.json"), doc); write(resolve(dir, "manifest.json"), input.packet);
    // Disable network at the JS boundary for the complete shipped verifier.
    globalThis.fetch = async () => { throw Error("offline benchmark network disabled"); };
    requireThat(await verify(["--dir", dir, "--signer", signer]) === 0, "benchmark verify verdict");
  } else throw Error("unknown benchmark stage");
}

try {
  const args = process.argv.slice(2);
  if (args[0] === "--stage") {
    const start = performance.now(); await stage(args[1], args[2], Number(args[3]));
    write(resolve(args[2], args[1] + "-metrics.json"), { stage: args[1], seconds: (performance.now() - start) / 1000,
      peak_rss_mib: process.resourceUsage().maxRSS / 1024, status: "PASS" });
  } else {
    requireThat(args.length === 2 && args[0] === "--bids" && /^[1-9][0-9]*$/.test(args[1]), "usage: bench --bids 17000");
    const count = Number(args[1]); requireThat(Number.isSafeInteger(count) && count <= 17000, "bid count 1..17000");
    const dir = resolve("tmp", "bench-" + count); mkdirSync(dir, { recursive: true });
    const commit = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(), stages: Stage[] = [];
    for (const name of ["generate", "admission", "freeze", "open", "clear", "batch-plan", "verify"]) {
      process.stdout.write(`START ${name} bids=${count}\n`);
      const child = spawnSync(process.execPath, [process.argv[1], "--stage", name, dir, String(count)], { stdio: "inherit" });
      if (child.error) throw child.error; requireThat(child.status === 0, `benchmark stage ${name} exit ${child.status}`);
      stages.push(read(resolve(dir, name + "-metrics.json")));
    }
    const evidence = "docs/evidence/phase-6"; mkdirSync(evidence, { recursive: true });
    const plan = read(resolve(dir, "batch-plan.json"));
    // Projection for the organizer's 48-hour volume: 17,000 bids, every constant measured in
    // the recorded timings and cited below; nothing here is invented.
    const fit = (y8: number, y27: number) => (x: number) => y8 + ((y27 - y8) * (x - 9)) / 19; // linear through the two measured points
    const build = fit(23.026, 65.144), approvals = fit(19.961, 50.243), frost = 8.2;
    const projectionRows = [...Array.from({ length: 17000 }, (_, i) => ({ party: `leaf:${i}`, amount_zats: "1" })), { party: "seller", amount_zats: "1" }];
    const totals: Record<string, unknown> = {};
    for (const cap of [13, 28]) {
      const batches = planBatches(projectionRows, cap);
      const seconds = batches.reduce((t, b) => t + build(b.parties.length) + approvals(b.parties.length) + frost, 0);
      totals[cap] = { bids: 17000, rows: projectionRows.length, settlement_batches: batches.length, total_hours: Number((seconds / 3600).toFixed(2)) };
    }
    const projection = {
      model: "per-batch seconds = host_build(rows) + host_approvals(rows) + 8.2 s FROST (flat per batch, R29); mining is overlapped with the next batch and excluded; host build and approvals are linear in rows through the scale-8 and scale-27 points",
      constants: {
        rows_at_measured_points: { scale_8: 9, scale_27: 28, source: "docs/evidence/scale/scale-8-round.out and the scale-27 timings (scale-8: 8 bids + seller; scale-27: 27 bids + seller)" },
        host_build_s: { scale_8: 23.026, scale_27: 65.144, source: "docs/evidence/scale/scale-8-r29b-timing.jsonl (host-build 23026 ms) + docs/evidence/scale/scale-27-timing.jsonl (host-build 65144 ms)" },
        host_approvals_s: { scale_8: 19.961, scale_27: 50.243, source: "docs/evidence/scale/scale-8-r29b-timing.jsonl (host-approve 17082||19961 ms, parallel wall 19.961 s) + docs/evidence/scale/scale-27-timing.jsonl (50012||50243 ms, 50.243 s)" },
        frost_s_per_batch: { value: frost, source: "docs/evidence/scale/scale-8-r29b-timing.jsonl + docs/evidence/scale/scale-27-timing.jsonl (measured frost-parallel 8103 / 8201 ms)" },
      },
      totals_17000_bids: totals,
    };
    const file = resolve(evidence, "bench.json"), previous = (() => { try { return read(file).runs; } catch (e: any) { if (e.code === "ENOENT") return []; throw e; } })();
    const run = { bids: count, seed, round: read(resolve(dir, "input.json")).beacon.round, commit,
      source_sha256: hash(readFileSync("tools/bench.ts")), recorded_at: new Date().toISOString(), synthetic_deposits: true,
      stages, batch_cap: BATCH_CAP, settlement_batches: plan.settlement_batches, estimated_fee_zats: plan.estimated_fee_zats,
      projection, status: "PASS" };
    write(file, { runs: [...previous.filter((r: any) => r.bids !== count), run].sort((a: any, b: any) => a.bids - b.bids) });
    process.stdout.write("| Stage | Seconds | Peak RSS MiB | Status |\n|---|---:|---:|---|\n");
    for (const s of stages) process.stdout.write(`| ${s.stage} | ${s.seconds?.toFixed(3) ?? "—"} | ${s.peak_rss_mib?.toFixed(1) ?? "—"} | ${s.status} |\n`);
    process.stdout.write(`SETTLEMENT batches=${plan.settlement_batches} batch_cap=${BATCH_CAP} estimated_fee_zats=${plan.estimated_fee_zats}\n`);
    for (const [cap, t] of Object.entries(totals)) {
      const v = t as { settlement_batches: number; total_hours: number };
      process.stdout.write(`PROJECTION 17000 bids cap=${cap} batches=${v.settlement_batches} total_hours=${v.total_hours}\n`);
    }
  }
} catch (e) { process.stderr.write(`ERROR bench ${(e as Error).message}\n`); process.exitCode = 1; }
