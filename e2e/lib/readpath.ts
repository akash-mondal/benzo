// R35 folds (run 33): the read-path assertions folded from tools/repro/* into e2e/cli-auction.spec.ts.
// Each family is adapted from its named repro script (the script stays until gate RG proves the folded IDs
// pass and turn red under their re-pointed mutations, then deletes it). Ports drive the same boundaries the
// repros did — the shipped `bin/benzo`, the shipped verifier API (api/public-auction) and the envelope /
// settle modules — and their expected values come from the same independent sources (inputs the check chose,
// the pinned Go tle, the published beacon, committed evidence dirs), never from the code under test.
// Families land in tranches; each ID's four AGENTS.md answers live in e2e/cli-auction.spec.ts's header.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sodium from "libsodium-wrappers";
import { timelockEncrypt } from "tlock-js";
import { decodeArmor } from "tlock-js/age/armor.js";
import * as schema from "../../manifest/schema";
import * as merkle from "../../clear/merkle";
import * as core from "../../clear/core";
import * as env from "../../envelope";
import * as bid from "../../envelope/bid";
import * as api from "../../api/public-auction";
import * as settle from "../../settle/envelopes";
import * as witness from "../../witness";
import * as pb from "../../cli/published-beacon";
import { ROOT, STATE, bin } from "./env";
import type { Run } from "./run";
import { tleBound } from "../../settle/bounded"; // R52: drand spawns are bounded like the product's

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const rndHex = (n: number) => randomBytes(n).toString("hex");
const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };

// ---------------------------------------------------------------------------
// Shared corpus machinery (adapted from r15-verify-leaves-repro.mjs and
// r26-3-projection-repro.mjs, which share this shape).
// ---------------------------------------------------------------------------
type Corpus = { dir: string; signer: string; auction_id: string; result: any };
const drandRound = async (): Promise<{ R: number; release: number; beacon: any; chain: string }> => {
  const drandBase = (process.env.BNZ_DRAND_URLS ?? "").split(",")[0];
  const chain = schema.QUICKNET.chain_hash;
  const latest = await fetch(`${drandBase}/${chain}/public/latest`);
  need(latest.ok, `drand HTTP ${latest.status}`);
  const R = (await latest.json()).round - 50;
  const release = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
  const beaconRes = await fetch(`${drandBase}/${chain}/public/${R}`);
  need(beaconRes.ok, `drand HTTP ${beaconRes.status}`);
  return { R, release, beacon: await beaconRes.json(), chain };
};
const tleSeal = (plaintextHex: string, R: number, chain: string): Buffer => {
  const sealed = spawnSync(bin("tle"), ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(plaintextHex, "hex"), maxBuffer: 1 << 20, ...tleBound });
  need(sealed.status === 0, `tle seal: ${sealed.stderr?.toString().trim()}`);
  return sealed.stdout as Buffer;
};
const tleOpen = (ctHex: string, chain: string): string => {
  const r = spawnSync(bin("tle"), ["-d", "-c", chain], { input: Buffer.from(ctHex, "hex"), maxBuffer: 1 << 20, ...tleBound });
  need(r.status === 0, `tle open: ${r.stderr?.toString().trim()}`);
  return (r.stdout as Buffer).toString("hex");
};

// A fresh two-bid uniform corpus over real tlock ciphertexts (prices C and 1000: leaf 0 wins at price C
// with refund 0, leaf 1 loses with refund C). `pinned` adds manifest envelope_keys; `settlement` is the
// published summary; `withResult` publishes the clearing result (false = the REFUNDING/cancelled shape).
function buildCorpus(name: string, opts: { pinned: boolean; settlement?: any; withResult?: boolean }, ctx: { R: number; release: number; chain: string }): Corpus {
  const { R, release, chain } = ctx;
  const T_freeze = release - 100, T_submit = T_freeze - 800, published_at = T_freeze - 200;
  const C = 500000n;
  const signerKey = generateKeyPairSync("ed25519");
  const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const auction_id = rndHex(32);
  const manifest: any = {
    version: 1, network: "test", auction_id,
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r35 fold lot", supply: 1,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
    C_zats: C.toString(), fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  };
  if (opts.pinned) manifest.envelope_keys = [0, 1, 2].map(() => env.generateEnvelopeKey().public_hex);
  const packet = schema.signRecord(manifest, signerPem);
  const leaves: any[] = [];
  for (const [i, price] of [C, 1000n].entries()) {
    const nonce_hex = randomBytes(16).toString("hex");
    const owner = env.generateOwnerKey();
    const plaintext = bid.buildBidPlaintext({ auction_id, price_zats: price, quantity: 1, nonce_hex, owner_public_hex: owner.public_hex, settlement_commitment_hex: env.settlementCommitment(nonce_hex, "") }).toString("hex");
    const sealed = tleSeal(plaintext, R, chain);
    leaves.push({ auction_id, manifest_hash: packet.sha256, ciphertext_hash: sha256(sealed), deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[i], diversifier_index: String(i) }, leaf_index: i, ciphertext_hex: sealed.toString("hex") });
  }
  const { root, paths } = merkle.tree(leaves);
  const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: T_freeze, published_at, leaves, paths };
  const opened = leaves.map((l) => ({ leaf_index: l.leaf_index, plaintext_hex: tleOpen(l.ciphertext_hex, chain) }));
  const result = core.clear({ manifest: packet, signer, frozen, opened });
  const withResult = opts.withResult !== false;
  const settlement = typeof opts.settlement === "function" ? opts.settlement(auction_id) : opts.settlement;
  const beaconField = { round: (ctx as any).beacon.round, signature: (ctx as any).beacon.signature, chain_hash: chain };
  const doc: any = { version: 1, auction_id, signer, manifest: packet, state: withResult ? "CLEARED" : "REFUNDING", receipts: [], frozen, ...(withResult ? { result } : {}), opened, envelopes: [], beacon: beaconField, ...(settlement ? { settlement } : {}) };
  const dir = path.join(ROOT, "tmp", "r35-folds", name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const write = (n: string, v: unknown) => writeFileSync(path.join(dir, n), schema.jsonBytes(v));
  write("auction.json", doc); write("manifest.json", packet); write("frozen.json", frozen);
  if (withResult) write("result.json", result);
  if (settlement) write("summary.json", settlement);
  return { dir, signer, auction_id, result };
}
const verifyRun = (dir: string, signer: string, extra: string[] = []): { code: number; out: string } => {
  const r = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", dir, "--signer", signer, ...extra], { encoding: "utf8", cwd: ROOT, maxBuffer: 64 << 20 });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const errorLines = (out: string) => (out.match(/ERROR [^\n]*/g) ?? ["no ERROR line"]).join(" | ");

// ---------------------------------------------------------------------------
// foldR15 — tools/repro/r15-verify-leaves-repro.mjs (R15 items 1-2; mutations R15-F4a/F4b/F5, R16-F2a).
// ---------------------------------------------------------------------------
export async function foldR15(run: Run): Promise<void> {
  const ctx = await drandRound();
  const C = 500000n;
  const receipt = (auction_id: string, party: string, amount: string) => ({ auction_id, party, txid: rndHex(32), pool: "ironwood", output_index: 0, amount_zats: amount });
  await run.check("r15-machine-runs-without-records", "a frozen leaf's obligation 'satisfied' by a rowless receipt is refused even with zero envelope records", () => {
    const c = buildCorpus("rowless-receipt", { pinned: true, settlement: (id: string) => ({ rows: [{ party: "seller", amount_zats: C.toString(), state: "exception" }], receipts: [receipt(id, "leaf:1", C.toString())] }) }, ctx);
    const r = verifyRun(c.dir, c.signer);
    need(r.code === 1 && /ERROR envelope [^\n]*missing row/.test(r.out), `got exit ${r.code}: ${errorLines(r.out)}`);
  });
  await run.check("r15-zero-refund-needs-no-row", "a zero-refund leaf with no envelope record is correct; its row-free state passes with the exception-queue note", () => {
    const c = buildCorpus("zero-refund", { pinned: true, settlement: { rows: [{ party: "seller", amount_zats: C.toString(), state: "exception" }, { party: "leaf:1", amount_zats: C.toString(), state: "exception" }], receipts: [] } }, ctx);
    const r = verifyRun(c.dir, c.signer);
    need(r.code === 0 && r.out.includes("OK envelope") && !r.out.includes("ERROR envelope"), `got exit ${r.code}: ${r.out.slice(0, 300)}`);
    need(r.out.includes("missing envelope 1; in the exception queue"), `expected the exception-queue note for leaf 1: ${r.out.slice(0, 300)}`);
  });
  await run.check("r15-strangers-refused", "rows/receipts whose party is neither a result obligation nor a stray deposit are an accounting-strays ERROR on the read-API checker", () => {
    const c = buildCorpus("strangers", {
      pinned: false, withResult: false,
      settlement: {
        rows: [{ party: "leaf:9", amount_zats: C.toString() }, { party: "junk", amount_zats: "1" }],
        receipts: [{ auction_id: "f".repeat(64), party: "operator", txid: rndHex(32), pool: "ironwood", output_index: 0, amount_zats: "1" }],
      },
    }, ctx);
    const pub = api.loadPublicAuction(c.dir, { signer: c.signer });
    const checks = api.checkPublicAuction(pub);
    const stranger: any = checks.find((x: any) => x.error && x.error.includes("neither a result obligation nor a stray deposit"));
    need(stranger, `stranger parties accepted: ${JSON.stringify(checks.filter((x: any) => x.error))}`);
    need(stranger.id === "accounting-strays", `stranger error on wrong check ${stranger.id}`);
  });
  await run.check("r15-phase2-4", "the Phase 2, 3 and 4 evidence dirs (no envelope_keys) still verify OK envelope", () => {
    const signerOf = (file: string, field?: string) => { const j = JSON.parse(readFileSync(path.join(ROOT, file), "utf8")); return field ? j[field] : j.signer; };
    const phase2 = verifyRun(path.join(ROOT, "docs/evidence/phase-2/auction"), signerOf("docs/evidence/phase-2/auction/signer.json"), ["--fetch-beacon", "--legacy-unattested"]); // R78: pre-R42 evidence
    need(phase2.code === 0 && phase2.out.includes("OK envelope"), `phase-2 exit ${phase2.code}: ${phase2.out.slice(0, 300)}`);
    const p3 = path.join(ROOT, "tmp/r35-folds/phase3-public");
    rmSync(p3, { recursive: true, force: true }); mkdirSync(p3, { recursive: true });
    for (const f of ["manifest.json", "frozen.json", "result.json", "summary.json"]) copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/main", f), path.join(p3, f));
    copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/signer.json"), path.join(p3, "signer.json"));
    const phase3 = verifyRun(p3, signerOf("docs/evidence/phase-3/settle/signer.json"), ["--fetch-beacon", "--legacy-unattested"]);
    need(phase3.code === 0 && phase3.out.includes("OK envelope"), `phase-3 exit ${phase3.code}: ${phase3.out.slice(0, 300)}`);
    const phase4 = verifyRun(path.join(ROOT, "docs/evidence/phase-4/cli"), signerOf("docs/evidence/phase-4/cli/auction.json", "signer"), ["--legacy-unattested"]);
    need(phase4.code === 0 && phase4.out.includes("OK envelope"), `phase-4 exit ${phase4.code}: ${phase4.out.slice(0, 300)}`);
  });
}

// ---------------------------------------------------------------------------
// foldR263 — tools/repro/r26-3-projection-repro.mjs (R26 item 3; mutations R26-3a/R26-3b).
// ---------------------------------------------------------------------------
export async function foldR263(run: Run): Promise<void> {
  const ctx = await drandRound();
  const C = 500000n;
  const strayParty = `deposit:${rndHex(32)}:0`;
  const settlement = {
    rows: [
      { party: "seller", amount_zats: C.toString(), state: "exception" },
      { party: "leaf:1", amount_zats: C.toString(), state: "exception" },
    ],
    receipts: [],
  };
  const c = buildCorpus("r26-3", { pinned: true, settlement }, ctx);
  const doc = JSON.parse(readFileSync(path.join(c.dir, "auction.json"), "utf8"));
  const opened = doc.opened, beaconField = doc.beacon;
  const write = (n: string, v: unknown) => writeFileSync(path.join(c.dir, n), schema.jsonBytes(v));
  write("auction.json", doc); write("opened.json", opened); write("beacon.json", beaconField);
  write("receipts.json", doc.receipts); write("summary.json", doc.settlement);
  const restoreAll = () => { write("opened.json", opened); write("beacon.json", beaconField); write("receipts.json", doc.receipts); write("summary.json", doc.settlement); write("auction.json", doc); };
  await run.check("r26-3-projections-match", "byte-identical projections verify clean (OK projection)", () => {
    restoreAll();
    const r = verifyRun(c.dir, c.signer);
    need(r.code === 0 && r.out.includes("OK projection") && !r.out.includes("ERROR projection"), `got exit ${r.code}: ${errorLines(r.out)}`);
  });
  const diverge = (id: string, name: string, mutate: () => void) => run.check(id, `a diverging ${name} is refused naming the file`, () => {
    restoreAll(); mutate();
    const r = verifyRun(c.dir, c.signer);
    const expected = `ERROR projection refused: ${name} projection differs`;
    need(r.code === 1 && r.out.includes(expected), `got exit ${r.code}, expected \`${expected}\`: ${errorLines(r.out)}`);
    restoreAll();
  });
  await diverge("r26-3-opened-diverges", "opened.json", () => write("opened.json", [...opened, { leaf_index: 9, plaintext_hex: "00".repeat(128) }]));
  await diverge("r26-3-beacon-diverges", "beacon.json", () => write("beacon.json", { ...beaconField, signature: beaconField.signature.replace(/^./, (ch: string) => (ch === "a" ? "b" : "a")) }));
  await diverge("r26-3-receipts-diverges", "receipts.json", () => write("receipts.json", [{ auction_id: c.auction_id, party: strayParty, txid: rndHex(32), pool: "ironwood", output_index: 0, amount_zats: "250000" }]));
  await diverge("r26-3-summary-diverges", "summary.json", () => write("summary.json", { ...doc.settlement, rows: doc.settlement.rows.slice(0, 1) }));
  await run.check("r26-3-projection-without-field", "a projection whose field the document does not carry is refused", () => {
    restoreAll();
    const { settlement: _drop, ...withoutSettlement } = doc;
    write("auction.json", withoutSettlement);
    const r = verifyRun(c.dir, c.signer);
    const expected = "ERROR projection refused: summary.json projection without document field";
    need(r.code === 1 && r.out.includes(expected), `got exit ${r.code}, expected \`${expected}\`: ${errorLines(r.out)}`);
    restoreAll();
  });
}

// ---------------------------------------------------------------------------
// foldR233 — tools/repro/r23-3-api-claims-repro.mjs (R23 item 3; mutation R23-3a).
// ---------------------------------------------------------------------------
export async function foldR233(run: Run): Promise<void> {
  const drandBase = (process.env.BNZ_DRAND_URLS ?? "").split(",")[0];
  const chainHash = schema.QUICKNET.chain_hash;
  const latest = await fetch(`${drandBase}/${chainHash}/public/latest`);
  need(latest.ok, `drand HTTP ${latest.status}`);
  const R = (await latest.json()).round - 5;
  const RT = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
  const auctionId = rndHex(32);
  const signerKey = generateKeyPairSync("ed25519");
  const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signerHex = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const manifest: any = {
    version: 1, network: "test", auction_id: auctionId,
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r23-3 fold fixture", supply: 1,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: "500000", q_max: 1,
    C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R }, T_submit: RT - 850, T_freeze: RT - 100, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  };
  const w1 = witness.generateWitnessKey(), w2 = witness.generateWitnessKey(), w3 = witness.generateWitnessKey();
  const witnessSet = schema.signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: [w1.public_hex, w2.public_hex, w3.public_hex] }, signerPem);
  manifest.witness_set_hash = witness.witnessSetHash(witnessSet);
  const packet = schema.signRecord(manifest, signerPem);
  const owner = env.generateOwnerKey();
  const plaintext = bid.buildBidPlaintext({ auction_id: auctionId, price_zats: 250000n, quantity: 1, nonce_hex: randomBytes(16).toString("hex"), owner_public_hex: owner.public_hex, settlement_commitment_hex: randomBytes(32).toString("hex") });
  const pinnedInfo = { public_key: schema.QUICKNET.public_key, period: schema.QUICKNET.period, genesis_time: schema.QUICKNET.genesis, hash: chainHash, groupHash: "", schemeID: schema.QUICKNET.scheme, metadata: { beaconID: "quicknet" } };
  const armored = await timelockEncrypt(R, plaintext, { chain: () => ({ info: async () => pinnedInfo }) } as any);
  const ct = Buffer.from(decodeArmor(armored), "binary");
  const memo = Buffer.alloc(512);
  Buffer.from("ff424e5a01", "hex").copy(memo, 0);
  memo.writeUInt16BE(ct.length, 5);
  ct.copy(memo, 7);
  const party = `deposit:${rndHex(32)}:ironwood:0`;
  const claimBody = { kind: "claim-refund", auction_id: auctionId, party, claim_envelope_sha256: rndHex(32) };
  const claim = { party, claim_envelope_sha256: claimBody.claim_envelope_sha256, owner_sig: env.signStatement(owner as any, claimBody as any) as string, memo_hex: memo.toString("hex") };
  // Ruling R42 (F11): the stray claim's memo is bound to the chain by the paying batch's per-row
  // attestation (two agreeing host-signed maps carrying {party, memo_sha256}), never a closed statement.
  const r233tx = rndHex(32);
  const mapBody: any = { auction_id: auctionId, batch: 1, txid: r233tx, outputs: [{ party, output_index: 0 }], defaults: [], balance_refunds: [], strays: [{ party, memo_sha256: sha256(memo) }] };
  const settlement = {
    rows: [{ party, kind: "refund", amount_zats: "500000", state: "paid" }],
    receipts: [{ auction_id: auctionId, party, txid: r233tx, pool: "ironwood", output_index: 0, amount_zats: "500000" }],
    approval_maps: [witness.signApprovalMap(mapBody, w1.private_hex), witness.signApprovalMap(mapBody, w2.private_hex)],
  };
  const beaconRes = await fetch(`${drandBase}/${chainHash}/public/${R}`);
  need(beaconRes.ok, `drand HTTP ${beaconRes.status} for round ${R}`);
  const beaconJson = await beaconRes.json();
  const dir = path.join(ROOT, "tmp/r35-folds/r23-3-api");
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const writeDoc = (beacon: boolean) => writeFileSync(path.join(dir, "auction.json"), JSON.stringify({
    version: 1, auction_id: auctionId, signer: signerHex, manifest: packet, state: "REFUNDING", receipts: [],
    claims: [claim], witness_set: witnessSet, settlement,
    ...(beacon ? { beacon: { round: R, signature: beaconJson.signature, chain_hash: chainHash } } : {}),
  }, null, 2) + "\n");
  const { startServer } = await import("../../api/server");
  const server = startServer({ dir, host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const get = async () => {
    const res = await fetch(`${base}/auction/${auctionId}`);
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, body };
  };
  writeDoc(false);
  const noBeacon = await get();
  writeDoc(true);
  const withBeacon = await get();
  server.close();
  const claimsError = (r: any) => (r.body?.errors ?? []).find((e: any) => e.id === "claims") ?? null;
  await run.check("r23-3-api-claims-no-beacon", "the read API fails closed with the verify ERROR on claims without a beacon", () => {
    need(noBeacon.status === 200 && noBeacon.body?.valid === false && claimsError(noBeacon)?.error === "refused: claim 0 memo opening",
      `status ${noBeacon.status} valid ${noBeacon.body?.valid} claims ${JSON.stringify(claimsError(noBeacon))}`);
  });
  await run.check("r23-3-api-claims-with-beacon", "the same document with the beacon verifies clean", () => {
    need(withBeacon.status === 200 && withBeacon.body?.valid === true && (withBeacon.body?.errors ?? []).length === 0,
      `status ${withBeacon.status} valid ${withBeacon.body?.valid} errors ${JSON.stringify(withBeacon.body?.errors)}`);
  });
  await run.check("r23-3-api-never-500", "neither case answers a 500", () => {
    need(noBeacon.status !== 500 && withBeacon.status !== 500 && noBeacon.body !== null && withBeacon.body !== null, `statuses ${noBeacon.status}/${withBeacon.status}`);
  });
}

// ---------------------------------------------------------------------------
// foldGForged — tools/repro/g-forged-claim.mjs (R23 item 1; the r23-1-* IDs).
// ---------------------------------------------------------------------------
export async function foldGForged(run: Run): Promise<void> {
  const beacon = JSON.parse(readFileSync(path.join(ROOT, "docs/evidence/phase-4/cli/beacon.json"), "utf8"));
  const packet = JSON.parse(readFileSync(path.join(ROOT, "docs/evidence/phase-4/cli/manifest.json"), "utf8"));
  const manifest = JSON.parse(Buffer.from(packet.bytes, "base64").toString("utf8"));
  const auctionId = manifest.auction_id;
  const local = pb.publishedClient(beacon);
  const owner = env.generateOwnerKey();
  const pt = Buffer.alloc(128);
  pt[0] = 0;
  Buffer.from(auctionId, "hex").copy(pt, 1);
  Buffer.from(owner.public_hex, "hex").copy(pt, 61);
  const armored = await timelockEncrypt(beacon.round, pt, local as any);
  const b64 = armored.split("\n").filter((l: string) => l && !l.startsWith("-----")).join("");
  const ctHex = Buffer.from(b64, "base64").toString("hex");
  const memo = Buffer.alloc(512);
  Buffer.from("ff424e5a01", "hex").copy(memo, 0);
  memo.writeUInt16BE(ctHex.length / 2, 5);
  Buffer.from(ctHex, "hex").copy(memo, 7);
  const memo_hex = memo.toString("hex");
  const party = `deposit:${sha256("attacker-tx")}:ironwood:0`;
  const claimEnvelopeSha = sha256("attacker envelope ct");
  const body = { kind: "claim-refund", auction_id: auctionId, party, claim_envelope_sha256: claimEnvelopeSha };
  const owner_sig = env.signStatement(owner as any, body as any) as string;
  const settlement = {
    rows: [{ party, kind: "refund", amount_zats: "1000", state: "paid" }],
    receipts: [{ auction_id: auctionId, party, txid: sha256("attacker-tx"), pool: "orchard", output_index: 0, amount_zats: "1000" }], // R81: a real 64-hex txid (R77 field check)
  };
  const claims = [{ party, claim_envelope_sha256: claimEnvelopeSha, owner_sig, memo_hex }];
  // Ruling R42 (F11) controls: the paying batch's PER-ROW attestation binds every stray claim's memo to
  // the hosts' own scans (Ed25519 over "benzo-approval-map-v1" || canonical JSON, by the pinned witness
  // set). The verifier requires two agreeing attestations of the batch whose receipt pays the stray.
  const edRaw = (k: any) => ({ private_hex: k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"), public_hex: k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex") });
  const W = [edRaw(generateKeyPairSync("ed25519")), edRaw(generateKeyPairSync("ed25519"))];
  const manifestSigner = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const witnessSet = schema.signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: W.map((w) => w.public_hex) }, manifestSigner);
  const manifest2 = { ...manifest, witness_set_hash: schema.hash(schema.jsonBytes(witnessSet)) };
  const packet2 = schema.signRecord(manifest2, manifestSigner);
  const memo_sha256 = sha256(Buffer.from(memo_hex, "hex"));
  const attestationBody = (s: { party: string; memo_sha256: string }) => ({ auction_id: auctionId, batch: 1, txid: sha256("attacker-tx"), outputs: [{ party, output_index: 0 }], defaults: [], balance_refunds: [], strays: [s] });
  const attestedSettlement = (s: { party: string; memo_sha256: string }, signers: any[]) => ({ ...settlement, approval_maps: signers.map((w) => witness.signApprovalMap(attestationBody(s) as any, w.private_hex)) });
  const basePub: any = {
    dir: ROOT, signer: packet.signer, legacy: true, state: "REFUNDING",
    manifestPacket: packet, manifest, manifest_hash: schema.client(packet, packet.signer).manifest_hash,
    frozen: null, opened: [], beacon, serialBeacon: null, launchInput: undefined,
    result: null, resultBytes: null, receipts: [], envelopes: [], witnessSet: null, witnessCerts: [],
    settlement, claims,
  };
  const certified: any = {
    ...basePub, signer: packet2.signer, manifestPacket: packet2, manifest: manifest2, manifest_hash: schema.hash(Buffer.from(packet2.bytes, "base64")),
    witnessSet, settlement: attestedSettlement({ party, memo_sha256 }, W),
  };
  const openings = await pb.deriveClaimOpenings(certified.claims, beacon);
  const claimErrors = (p: any) => api.checkPublicAuction(p, { claimOpenings: openings }).filter((c: any) => c.error && c.id === "claims");
  await run.check("g-forged-claim-accepted", "the self-consistent claim verifies end to end: owner key anchored in the beacon-opened memo and the memo attested per row by the paying batch's two agreeing maps", () => {
    // R81: this fixture is an in-memory document (no published dir), so the published-format check `format` (legacy
    // projections only for a pre-Phase-5 manifest) is not what this control is about; every other check must pass.
    const e = api.checkPublicAuction(certified, { claimOpenings: openings }).filter((c: any) => c.error && c.id !== "format");
    need(e.length === 0, `errors with the forged claim: ${JSON.stringify(e.map((c: any) => `${c.id}: ${c.error}`))}`);
  });
  await run.check("g-forged-claim-control", "the same claim with a tampered owner_sig is refused exactly on the claims check", () => {
    // The tamper must always change the byte: S < L ~ 2^252 leaves sig[63] 0x00 in ~9% of real signatures
    // (26/300 measured), for which a plain "+\"00\"" is a no-op and the valid signature is rightly accepted.
    const bad = { ...certified, claims: [{ ...certified.claims[0], owner_sig: owner_sig.slice(0, 126) + (owner_sig.slice(126) === "00" ? "01" : "00") }] };
    const badErr = claimErrors(bad);
    need(badErr.length === 1 && /owner signature/.test(badErr[0].error ?? ""), `tampered sig not refused: ${JSON.stringify(badErr)}`);
  });
  await run.check("r23-1-attested-claim-accepted", "a claim bound to the paying batch's per-row attestations verifies", () => {
    const e = claimErrors(certified);
    need(e.length === 0, JSON.stringify(e));
  });
  await run.check("r23-1-wrong-party-refused", "maps attesting a different party are refused", () => {
    const p = { ...certified, settlement: attestedSettlement({ party: `deposit:${"ab".repeat(32)}:ironwood:0`, memo_sha256 }, W) };
    const e = claimErrors(p);
    need(e.length === 1 && /not attested by two agreeing host-signed approval maps/.test(e[0].error ?? ""), JSON.stringify(e));
  });
  await run.check("r23-1-quorum-refused", "one attesting map (below the two-map rule) is refused", () => {
    const p = { ...certified, settlement: attestedSettlement({ party, memo_sha256 }, [W[0]]) };
    const e = claimErrors(p);
    need(e.length === 1 && /not attested by two agreeing host-signed approval maps/.test(e[0].error ?? ""), JSON.stringify(e));
  });
  await run.check("r23-1-tampered-sig-attested", "a tampered owner_sig is refused even under valid per-row attestations", () => {
    const p = { ...certified, claims: [{ ...certified.claims[0], owner_sig: owner_sig.slice(0, 126) + (owner_sig.slice(126) === "00" ? "01" : "00") }] };
    const e = claimErrors(p);
    need(e.length === 1 && /owner signature/.test(e[0].error ?? ""), JSON.stringify(e));
  });
  await run.check("r23-1-forged-attestation-refused", "the hosts' signed per-row attestation is what the verifier accepts — a forged memo hash is refused while the honest one passes", () => {
    const fed = attestedSettlement({ party, memo_sha256: sha256("other memo") }, W);
    const e = claimErrors({ ...certified, settlement: fed });
    need(claimErrors(certified).length === 0 && e.length > 0, `fed ${JSON.stringify(e)} / attested ok`);
  });
}

// ---------------------------------------------------------------------------
// foldKC — tools/repro/kc-key-commitment-repro.mjs (R12 item 2 / R10 item 1; the kc-* IDs).
// ---------------------------------------------------------------------------
export async function foldKC(run: Run): Promise<void> {
  await sodium.ready;
  const UA = "utest1nqaarlf8ehmtateefnysz3a6mxvtl39cgvtmj68ngj9266vtk7efr936qp67cz4aywuy4cqss3pfu870hxmkruhmrzgetw2jq7dle6lvzrgsrckh2ugw4fehsyd7j66sy67x84hylx5rjg47qnkzztwf9zvce9v6je7ngd6j8mjh44knm2kj7u6c67nv20dk6hkhsfugd5t7jqlkjfm";
  const KC_LABEL = Buffer.from("benzo-envelope-v2-kc");
  const KC_KEY = Buffer.concat([KC_LABEL, Buffer.alloc(sodium.crypto_generichash_KEYBYTES - KC_LABEL.length)]);
  const MAGIC = Buffer.from("benzo-envelope-v2");
  const keyCommit = (contentKey: Uint8Array) => Buffer.from(sodium.crypto_generichash(32, contentKey, KC_KEY));
  const padPlaintext = (payload: Buffer) => { const pt = Buffer.alloc(512); pt.writeUInt16BE(payload.length, 0); payload.copy(pt, 2); return pt; };
  const buildEnvelope = (destination: string, recipients: string[], wrapKeys: Uint8Array[]) => {
    const pks = recipients.map((h) => Buffer.from(h, "hex"));
    const stanzas = Buffer.concat(pks.map((pk, i) => Buffer.concat([pk, sodium.crypto_box_seal(wrapKeys[i], pk)])));
    const header = Buffer.concat([MAGIC, Buffer.from([pks.length]), stanzas, keyCommit(wrapKeys[0])]);
    const nonce = sodium.randombytes_buf(12);
    const body = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(padPlaintext(Buffer.from(destination, "utf8")), header, null, nonce, wrapKeys[0]);
    return Buffer.concat([header, nonce, body]).toString("hex");
  };
  const keys = [env.generateEnvelopeKey(), env.generateEnvelopeKey(), env.generateEnvelopeKey()];
  const recipients = keys.map((k) => k.public_hex);
  const refused = (fn: () => unknown, want: string) => {
    try { fn(); } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes(want)) return;
      throw Error(`got "${m}", want "${want}"`);
    }
    throw Error(`accepted, want refusal "${want}"`);
  };
  await run.check("kc-api-exports", "envelopeRecipients and the fixed n = 3 byte length are exported", () => {
    need(typeof (env as any).envelopeRecipients === "function", "envelopeRecipients not exported");
    need((env as any).ENVELOPE_CT_BYTES_N3 === 926, `ENVELOPE_CT_BYTES_N3 = ${(env as any).ENVELOPE_CT_BYTES_N3}, want 926`);
  });
  let honest = "";
  await run.check("kc-key-32-interop", "an honestly built envelope under the specified 32-byte KC key opens with production openEnvelope", () => {
    need(KC_KEY.length === sodium.crypto_generichash_KEYBYTES, `spec KC key is ${KC_KEY.length} bytes`);
    const contentKey = sodium.randombytes_buf(32);
    honest = buildEnvelope(UA, recipients, [contentKey, contentKey, contentKey]);
    const got = keys.map((k) => env.openEnvelope(honest, k.private_hex, "test"));
    need(got.every((g) => g === UA), `opens ${JSON.stringify(got)} != destination`);
  });
  let env3 = "";
  await run.check("kc-recipients-order", "envelopeRecipients returns the stanza keys in order", () => {
    env3 = env.sealEnvelope(UA, recipients, "test");
    const got = (env as any).envelopeRecipients(env3);
    need(JSON.stringify(got) === JSON.stringify(recipients), `got ${JSON.stringify(got)}`);
  });
  let splitHex = "";
  await run.check("kc-split-key-recipient1-opens", "control: a hand-built split-key envelope opens for recipient 1", () => {
    const bodyKey = sodium.randombytes_buf(32), splitKey = sodium.randombytes_buf(32);
    splitHex = buildEnvelope(UA, recipients, [bodyKey, splitKey, bodyKey]);
    need(env.openEnvelope(splitHex, keys[0].private_hex, "test") === UA, "recipient 1 did not open");
  });
  await run.check("kc-split-key-recipient2-commitment", "recipient 2 is refused with `envelope key commitment`", () => {
    refused(() => env.openEnvelope(splitHex, keys[1].private_hex, "test"), "refused: envelope key commitment");
  });
  const signerKeyPair = generateKeyPairSync("ed25519");
  const signerPem = signerKeyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const auction_id = rndHex(32);
  const manifestObj: any = {
    version: 1, network: "test", auction_id, escrow_ua: "utest1" + rndHex(35),
    frost_group_key: rndHex(32), lot: "kc fold lot", supply: 5,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: "50000", q_max: 10,
    C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35), "utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R: 32760000 }, T_submit: 1790000000, T_freeze: 1790000800, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    envelope_keys: recipients,
  };
  const packet = schema.signRecord(manifestObj, signerPem);
  const docFor = (envelopeCt: string) => {
    const owner = env.generateOwnerKey(), nonce = randomBytes(16).toString("hex");
    const commitment = env.settlementCommitment(nonce, envelopeCt);
    const ciphertext_hash = sha256("kc-proof-ciphertext");
    const owner_sig = env.signEnvelope(owner as any, auction_id, ciphertext_hash, envelopeCt);
    const pt = Buffer.alloc(128);
    Buffer.from(nonce, "hex").copy(pt, 45);
    Buffer.from(owner.public_hex, "hex").copy(pt, 61);
    Buffer.from(commitment, "hex").copy(pt, 93);
    return {
      manifest: packet,
      frozen: { leaves: [{ leaf_index: 0, ciphertext_hash, deposit: { txid: rndHex(32), pool: "ironwood", address: "utest1" + rndHex(35), diversifier_index: "0" } }] },
      opened: [{ leaf_index: 0, plaintext_hex: pt.toString("hex") }],
      envelopes: [{ ciphertext_hash, envelope_ct: envelopeCt, owner_sig }],
    };
  };
  await run.check("kc-3of3-accepted", "control: validEnvelope accepts the record sealed to exactly the manifest's 3 keys, in order", () => {
    const got = settle.validEnvelope(docFor(env3), 0);
    need(!!got && got.envelope_ct === env3, `validEnvelope returned ${got === null ? "null" : "a record without the envelope"}`);
  });
  await run.check("kc-1of3-refused", "a record sealed to 1 of the 3 pinned keys is refused", () => {
    need(settle.validEnvelope(docFor(env.sealEnvelope(UA, [recipients[0]], "test")), 0) === null, "accepted a 1-of-3 envelope");
  });
  await run.check("kc-2of3-refused", "a record sealed to 2 of the 3 pinned keys is refused", () => {
    need(settle.validEnvelope(docFor(env.sealEnvelope(UA, [recipients[0], recipients[1]], "test")), 0) === null, "accepted a 2-of-3 envelope");
  });
  await run.check("kc-reorder-refused", "the 3 pinned keys out of manifest order are refused", () => {
    need(settle.validEnvelope(docFor(env.sealEnvelope(UA, [recipients[1], recipients[0], recipients[2]], "test")), 0) === null, "accepted reordered recipient keys");
  });
  await run.check("kc-wrongset-refused", "a third key the manifest does not pin is refused", () => {
    need(settle.validEnvelope(docFor(env.sealEnvelope(UA, [recipients[0], recipients[1], env.generateEnvelopeKey().public_hex], "test")), 0) === null, "accepted an unpinned third key");
  });
}

// ---------------------------------------------------------------------------
// foldMR — tools/repro/mr-envelope-repro.mjs (R12 item 1 / R10 item 1; the mr-* IDs).
// ---------------------------------------------------------------------------
export async function foldMR(run: Run): Promise<void> {
  const refused = (fn: () => unknown, want: string) => {
    try { fn(); } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes(want)) return;
      throw Error(`got "${m}", want "${want}"`);
    }
    throw Error(`accepted, want refusal "${want}"`);
  };
  // R81 (Reviewer R R-2 on R80): settlement pays Orchard/Ironwood only, so the two "good" destination shapes are two
  // Orchard-capable UAs of different receiver sets (Sapling+Orchard, and transparent+Sapling+Orchard — different
  // lengths, so the fixed-length envelope property is still exercised). The Sapling-only shapes are now refused.
  const SAPLING = "utest1redacted";
  const UA_SHIELDED = "utest1nqaarlf8ehmtateefnysz3a6mxvtl39cgvtmj68ngj9266vtk7efr936qp67cz4aywuy4cqss3pfu870hxmkruhmrzgetw2jq7dle6lvzrgsrckh2ugw4fehsyd7j66sy67x84hylx5rjg47qnkzztwf9zvce9v6je7ngd6j8mjh44knm2kj7u6c67nv20dk6hkhsfugd5t7jqlkjfm";
  const flip = (h: string, i = 3) => h.slice(0, i * 2) + (h[i * 2] === "0" ? "1" : "0") + h.slice(i * 2 + 1);
  const keys = [env.generateEnvelopeKey(), env.generateEnvelopeKey(), env.generateEnvelopeKey()];
  const recipients = keys.map((k) => k.public_hex);
  const attacker = env.generateEnvelopeKey();
  await run.check("mr-manifest-envelope-keys", "the signed manifest pins exactly 3 distinct envelope keys", () => {
    const base: any = {
      version: 1, network: "test", auction_id: rndHex(32), escrow_ua: "utest1" + rndHex(35),
      frost_group_key: rndHex(32), lot: "envelope fold lot", supply: 5,
      reserve_zats: "0", tick_zats: "1000", B_max_zats: "50000", q_max: 10,
      C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35), "utest1" + rndHex(35)],
      drand: { ...schema.QUICKNET, R: 32760000 }, T_submit: 1790000000, T_freeze: 1790000800, confirmations: 10,
      clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
      refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
      envelope_keys: recipients,
    };
    schema.validateManifest(base);
    refused(() => schema.validateManifest({ ...base, envelope_keys: [...recipients, rndHex(32)] }), "envelope_keys");
    refused(() => schema.validateManifest({ ...base, envelope_keys: [recipients[0], recipients[0], recipients[1]] }), "envelope_keys");
  });
  let envA = "", envB = "";
  await run.check("mr-3keys-open", "one envelope opens to the same destination with each of the 3 recipient keys", () => {
    envA = env.sealEnvelope(UA_SHIELDED, recipients, "test");
    const got = keys.map((k) => env.openEnvelope(envA, k.private_hex, "test"));
    need(got.every((g) => g === UA_SHIELDED), `opens ${JSON.stringify(got)} != destination`);
  });
  await run.check("mr-4th-key-refused", "a 4th key is refused (no stanza for it)", () => {
    refused(() => env.openEnvelope(envA, env.generateEnvelopeKey().private_hex, "test"), "refused: envelope recipient");
  });
  await run.check("mr-equal-lengths", "every n = 3 envelope ciphertext is 1852 hex (926 bytes)", () => {
    envB = env.sealEnvelope(SAPLING, recipients, "test");
    const lengths = [env.sealEnvelope(SAPLING, recipients, "test"), env.sealEnvelope(UA_SHIELDED, recipients, "test"), envA, envB].map((ct) => ct.length);
    need(lengths.every((l) => l === 1852), `lengths ${lengths.join(",")} (want all 1852 = 926 bytes)`);
  });
  await run.check("mr-stanza-swap-refused", "a whole stanza swapped between envelopes is refused for every recipient", () => {
    const a = Buffer.from(envA, "hex"), b = Buffer.from(envB, "hex"), off = 18, stanza = 32 + 80;
    const swapped = Buffer.concat([a.subarray(0, off), b.subarray(off, off + stanza), a.subarray(off + stanza)]).toString("hex");
    refused(() => env.openEnvelope(swapped, keys[0].private_hex, "test"), "refused: envelope key commitment");
    for (const k of keys.slice(1)) refused(() => env.openEnvelope(swapped, k.private_hex, "test"), "refused: envelope body");
  });
  await run.check("mr-shared-rule-export", "envelope/ exports envelopeRecordValid(record, envelope_keys)", () => {
    need(typeof (env as any).envelopeRecordValid === "function", "envelopeRecordValid not exported from envelope/");
  });

  const ctx = await drandRound();
  const { R, release, chain } = ctx;
  const T_freeze = release - 100, T_submit = T_freeze - 800, published_at = T_freeze - 200;
  const recordCt: Record<string, (d: string) => string> = {
    good: (d) => env.sealEnvelope(d, recipients, "test"),
    "foreign-key": (d) => env.sealEnvelope(d, [attacker.public_hex], "test"),
    "foreign-set": (d) => env.sealEnvelope(d, [attacker.public_hex, recipients[1], recipients[2]], "test"),
    "pre-v2": () => randomBytes(572).toString("hex"),
    "2of3": (d) => env.sealEnvelope(d, recipients.slice(0, 2), "test"),
  };
  type Bid = { kind: string; destination?: string };
  const buildMrCorpus = (name: string, { pinned, bids }: { pinned: boolean; bids: Bid[] }) => {
    const signerKey = generateKeyPairSync("ed25519");
    const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
    const auction_id = rndHex(32);
    const manifest: any = {
      version: 1, network: "test", auction_id,
      escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "envelope fold lot", supply: 5,
      reserve_zats: "0", tick_zats: "1000", B_max_zats: "50000", q_max: 10,
      C_zats: "500000", fee_zats: "0", deposit_addresses: bids.map(() => "utest1" + rndHex(35)),
      drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
      clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
      refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    };
    if (pinned) manifest.envelope_keys = recipients;
    const packet = schema.signRecord(manifest, signerPem);
    const leaves: any[] = [], envelopes: any[] = [], owners: any[] = [];
    for (const [i, b] of bids.entries()) {
      const ct = recordCt[b.kind](b.destination ?? UA_SHIELDED);
      const owner = env.generateOwnerKey(), nonce_hex = randomBytes(16).toString("hex");
      const commitment = env.settlementCommitment(nonce_hex, ct);
      const plaintext = bid.buildBidPlaintext({ auction_id, price_zats: 10000n + BigInt(i) * 5000n, quantity: 1, nonce_hex, owner_public_hex: owner.public_hex, settlement_commitment_hex: commitment }).toString("hex");
      const sealed = tleSeal(plaintext, R, chain);
      const ciphertext_hash = sha256(sealed);
      owners.push(owner);
      envelopes.push({ ciphertext_hash, envelope_ct: ct, owner_sig: env.signEnvelope(owner as any, auction_id, ciphertext_hash, ct) });
      leaves.push({ auction_id, manifest_hash: packet.sha256, ciphertext_hash, deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[i], diversifier_index: String(i) }, leaf_index: i, ciphertext_hex: sealed.toString("hex") });
    }
    const { root, paths } = merkle.tree(leaves);
    const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: T_freeze, published_at, leaves, paths };
    const opened = leaves.map((l) => ({ leaf_index: l.leaf_index, plaintext_hex: tleOpen(l.ciphertext_hex, chain) }));
    const result = core.clear({ manifest: packet, signer, frozen, opened });
    const dir = path.join(ROOT, "tmp/r35-folds/mr", name);
    const write = (envelopeList: any[]) => {
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      const doc = { version: 1, auction_id, signer, manifest: packet, state: "CLEARED", receipts: [], frozen, result, opened, envelopes: envelopeList, beacon: { round: ctx.beacon.round, signature: ctx.beacon.signature, chain_hash: chain } };
      for (const [file, value] of [["auction.json", doc], ["manifest.json", packet], ["frozen.json", frozen], ["result.json", result], ["envelope.json", envelopeList]] as [string, unknown][])
        writeFileSync(path.join(dir, file), schema.jsonBytes(value));
      return doc;
    };
    return { dir, signer, packet, envelopes, owners, write };
  };
  await run.check("mr-verify", "the shipped verifier accepts a fresh pinned corpus and routes owner-binding breaks to the exception queue", () => {
    const c = buildMrCorpus("good", { pinned: true, bids: [{ kind: "good", destination: SAPLING }, { kind: "good", destination: UA_SHIELDED }, { kind: "good", destination: SAPLING }] });
    c.write(c.envelopes);
    const ok = verifyRun(c.dir, c.signer);
    need(ok.code === 0 && ok.out.includes("OK envelope"), `verify exit ${ok.code}: ${ok.out.slice(0, 300)}`);
    c.write(c.envelopes.map((e, i) => (i === 0 ? { ...e, owner_sig: flip(e.owner_sig) } : e)));
    const sig = verifyRun(c.dir, c.signer);
    need(sig.code === 0 && sig.out.includes("WARN invalid envelope 0; refund goes to the exception queue"), `owner_sig flip: exit ${sig.code}: ${sig.out.slice(0, 300)}`);
    const swapped = c.envelopes.map((e) => ({ ...e }));
    const t = swapped[0].envelope_ct; swapped[0].envelope_ct = swapped[1].envelope_ct; swapped[1].envelope_ct = t;
    c.write(swapped);
    const sw = verifyRun(c.dir, c.signer);
    need(sw.code === 0 && sw.out.includes("WARN invalid envelope 0; refund goes to the exception queue; invalid envelope 1; refund goes to the exception queue"), `ct swap: exit ${sw.code}: ${sw.out.slice(0, 300)}`);
    c.write(c.envelopes);
  });
  const ruleProbe = (id: string, corpus: { name: string; pinned: boolean; kind: string; destination?: string }, want: "ERROR" | "OK") =>
    run.check(id, `a ${corpus.kind} record under ${corpus.pinned ? "pinned" : "unpinned"} keys gives ${want} envelope`, () => {
      const c = buildMrCorpus(corpus.name, { pinned: corpus.pinned, bids: [{ kind: corpus.kind, destination: corpus.destination }] });
      c.write(c.envelopes);
      const r = verifyRun(c.dir, c.signer);
      const line = (r.out.match(/OK envelope|ERROR envelope [^\n]*/) ?? ["no envelope line"])[0];
      if (want === "ERROR") need(r.code === 1 && r.out.includes("ERROR envelope"), `got exit ${r.code} ${line}`);
      else need(r.code === 0 && r.out.includes("OK envelope"), `got exit ${r.code} ${line}`);
    });
  await ruleProbe("mr-verify-foreign-key", { name: "foreign-key", pinned: true, kind: "foreign-key" }, "ERROR");
  await ruleProbe("mr-verify-foreign-set", { name: "foreign-set", pinned: true, kind: "foreign-set" }, "ERROR");
  await ruleProbe("mr-verify-pre-v2-pinned", { name: "pre-v2-pinned", pinned: true, kind: "pre-v2" }, "ERROR");
  await ruleProbe("mr-verify-2of3-pinned", { name: "2of3-pinned", pinned: true, kind: "2of3" }, "ERROR");
  await ruleProbe("mr-verify-pre-v2-unpinned", { name: "pre-v2-unpinned", pinned: false, kind: "pre-v2" }, "OK");
  await run.check("mr-verify-phase2-4", "the Phase 2, 3 and 4 evidence dirs (pre-v2 records / no envelope_keys) still verify OK", () => {
    const signerOf = (file: string, field?: string) => { const j = JSON.parse(readFileSync(path.join(ROOT, file), "utf8")); return field ? j[field] : j.signer; };
    const phase2 = verifyRun(path.join(ROOT, "docs/evidence/phase-2/auction"), signerOf("docs/evidence/phase-2/auction/signer.json"), ["--fetch-beacon", "--legacy-unattested"]); // R78: pre-R42 evidence
    need(phase2.code === 0 && phase2.out.includes("OK envelope"), `phase-2 exit ${phase2.code}: ${phase2.out.slice(0, 300)}`);
    const p3 = path.join(ROOT, "tmp/r35-folds/mr/phase3-public");
    rmSync(p3, { recursive: true, force: true }); mkdirSync(p3, { recursive: true });
    for (const f of ["manifest.json", "frozen.json", "result.json", "summary.json"]) copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/main", f), path.join(p3, f));
    copyFileSync(path.join(ROOT, "docs/evidence/phase-3/settle/signer.json"), path.join(p3, "signer.json"));
    const phase3 = verifyRun(p3, signerOf("docs/evidence/phase-3/settle/signer.json"), ["--fetch-beacon", "--legacy-unattested"]);
    need(phase3.code === 0 && phase3.out.includes("OK envelope"), `phase-3 exit ${phase3.code}: ${phase3.out.slice(0, 300)}`);
    const phase4 = verifyRun(path.join(ROOT, "docs/evidence/phase-4/cli"), signerOf("docs/evidence/phase-4/cli/auction.json", "signer"), ["--legacy-unattested"]);
    need(phase4.code === 0 && phase4.out.includes("OK envelope"), `phase-4 exit ${phase4.code}: ${phase4.out.slice(0, 300)}`);
  });
}
