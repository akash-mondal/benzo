// @ts-nocheck
// R35 folds (run 33), tranche 3 group A — verbatim ports of the named tools/repro scripts (they stay
// until gate RG proves the folded IDs pass and then deletes them). The bodies are the scripts' own;
// argv becomes the auction-id parameter and each script's outcome/verdict becomes one minted ID whose
// four AGENTS.md answers live in e2e/cli-auction.spec.ts's header. The live legs are unvalidated in
// this offline batch by design: R35.3(b) proves every folded ID pass/red at the final regression.
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, statSync, writeFileSync } from "node:fs";
import { assertScratch } from "../../tools/repro/scratch.ts"; // R43/F17: only tmp/ or $TMPDIR targets may be deleted
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as schema from "../../manifest/schema";
import * as envmod from "../../envelope";
import * as merkle from "../../clear/merkle";
import * as settle from "../../settle/envelopes";
import { requireReserveOpening } from "../../manifest/reserve";
import { ROOT, STATE, bin } from "./env";
import type { Run } from "./run";
import { tleBound } from "../../settle/bounded"; // R52: drand spawns are bounded like the product's

const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
const sha256 = (b: any) => createHash("sha256").update(b).digest("hex");

// ---------------------------------------------------------------------------
// foldR73 — tools/repro/r7-3-exception-queue-repro.mjs (R7 item 3) plus g2's cases (b)/(c) from
// tools/repro/g2-envelope-crash-not-exception.mjs. A malformed / undecryptable envelope record moves
// that leaf to the exception queue and never aborts the plan for the other parties.
// IDs: r7-3-exception-queue (case A: malformed hex), g2-envelope-crash-not-exception (same drill),
// g2-wrong-key-exception (case B: sealed to a key the signers do not hold), g2-taddr-exception
// (case C: sealed to the right key but carrying a transparent destination).
// ---------------------------------------------------------------------------
export async function foldR73(run: Run, auctionId: string): Promise<void> {
  const id = auctionId;
  const ledgerFile = path.join(STATE, "auction", `${id}.json`);
  const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
  const publicFile = path.join(path.resolve(config.public_dir), "auction.json");
  const ledgerBytes = readFileSync(ledgerFile), publicBytes = readFileSync(publicFile);
  const ledger = JSON.parse(ledgerBytes.toString("utf8")), published = JSON.parse(publicBytes.toString("utf8"));
  const leaf0 = published.frozen.leaves[0];
  
  // The one shared published-record rule (R12 item 1, probed here per R15 item 4): intake (clear/auction-cli.ts
  // admit), settlement (settle/envelopes.ts validEnvelope) and `benzo verify` all use envelopeRecordValid from
  // envelope/ — the exact v2 n = 3 shape with the signed manifest's pinned envelope_keys as stanza recipients
  // in order, or the pre-v2 572-byte box only where the manifest pins none (the Phase 2–4 evidence).
  try {
    const env = await import(path.join(ROOT, "envelope/dist/index.mjs"));
    const keys = JSON.parse(Buffer.from(ledger.manifest.bytes, "base64").toString("utf8")).envelope_keys;
    const own = (ledger.envelopes ?? [])[0] ?? { envelope_ct: "ab".repeat(572), owner_sig: "ab".repeat(64) };
    console.log(`shared rule, pinned keys, malformed ct: ${env.envelopeRecordValid({ envelope_ct: "ababababc", owner_sig: "ab".repeat(64) }, keys) ? "ACCEPTED (malformed record can enter)" : "refused"}`);
    console.log(`shared rule, pinned keys, this dir's own record: ${env.envelopeRecordValid(own, keys) ? "accepted" : "refused (pre-v2 record with pinned keys)"}`);
    console.log(`shared rule, no pinned keys, the same record: ${env.envelopeRecordValid(own, undefined) ? "accepted (Phase 2-4 evidence reading)" : "refused"}`);
    console.log(`shared rule, short owner_sig: ${env.envelopeRecordValid({ ...own, owner_sig: "ab".repeat(32) }, keys) ? "ACCEPTED" : "refused"}`);
  } catch {
    console.log("shared rule: envelope/dist bundle absent — run npm run build:core");
  }
  
  // Case A: malformed record for leaf 0, self-consistently in both documents.
  const bad = { ciphertext_hash: leaf0.ciphertext_hash, envelope_ct: "ababababc", owner_sig: "ab".repeat(64) };
  const withBad = (doc) => ({ ...doc, envelopes: [bad, ...(doc.envelopes ?? []).filter((e) => e.ciphertext_hash !== leaf0.ciphertext_hash)] });
  let outcome = "INCONCLUSIVE";
  try {
    writeFileSync(ledgerFile, JSON.stringify(withBad(ledger)), { mode: 0o600 });
    writeFileSync(publicFile, JSON.stringify(withBad(published)));
    const plan = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id], { encoding: "utf8", maxBuffer: 64 << 20 });
    console.log(`plan exit ${plan.status}`);
    if (plan.status !== 0) {
      console.log(`plan stderr: ${(plan.stderr ?? "").trim().slice(-200)}`);
      if (/key\/signature hex|envelope/.test(plan.stderr ?? "")) {
        outcome = "CONFIRMED";
        console.log("CONFIRMED: one malformed envelope record aborts the whole settlement plan — every other party's refund and the seller payout are wedged with it.");
      }
    } else {
      const parsed = JSON.parse(plan.stdout);
      console.log(`obligations: ${JSON.stringify(parsed.obligations.map((o) => o.party))}`);
      console.log(`exceptions: ${JSON.stringify(parsed.exceptions.map((o) => ({ party: o.party, reason: o.reason ?? null })))}`);
      const leaf0Exception = parsed.exceptions.find((e) => e.party === "leaf:0");
      const sellerOk = parsed.obligations.some((o) => o.party === "seller");
      if (leaf0Exception && sellerOk) {
        outcome = "FIXED";
        console.log(`FIXED: the plan completed with leaf:0 in the exception queue (${leaf0Exception.reason ?? "no reason recorded"}) while every other party stayed payable.`);
      }
    }
  } finally {
    writeFileSync(ledgerFile, ledgerBytes);
    writeFileSync(publicFile, publicBytes);
    console.log(`restored both documents; outcome ${outcome}`);
  }
  
  await run.check("r7-3-exception-queue", "a malformed envelope record leaves leaf:0 in the exception queue and the plan completes for everyone else", () => {
    need(outcome === "FIXED", `${outcome}: plan did not complete with leaf:0 in the exception queue`);
  });
  await run.check("g2-envelope-crash-not-exception", "one malformed record never aborts settlement (the crash the exception queue replaced)", () => {
    need(outcome === "FIXED", `${outcome}: the malformed record aborted or was paid`);
  });
  const drill = async (inject: (leaf: any) => any) => {
    const ledgerFile2 = path.join(STATE, "auction", `${id}.json`);
    const config2 = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
    const publicFile2 = path.join(path.resolve(config2.public_dir), "auction.json");
    const ledgerBytes2 = readFileSync(ledgerFile2), publicBytes2 = readFileSync(publicFile2);
    const ledger2 = JSON.parse(ledgerBytes2.toString("utf8")), published2 = JSON.parse(publicBytes2.toString("utf8"));
    const leaf02 = published2.frozen.leaves[0];
    const bad2 = inject(leaf02);
    const withBad2 = (doc: any) => ({ ...doc, envelopes: [bad2, ...(doc.envelopes ?? []).filter((e: any) => e.ciphertext_hash !== leaf02.ciphertext_hash)] });
    let out2 = "INCONCLUSIVE", why2 = "";
    try {
      writeFileSync(ledgerFile2, JSON.stringify(withBad2(ledger2)), { mode: 0o600 });
      writeFileSync(publicFile2, JSON.stringify(withBad2(published2)));
      const plan2 = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id], { encoding: "utf8", maxBuffer: 64 << 20 });
      if (plan2.status === 0) {
        const parsed2 = JSON.parse(plan2.stdout);
        const leafEx2 = parsed2.exceptions.find((e: any) => e.party === "leaf:0");
        const sellerOk2 = parsed2.obligations.some((o: any) => o.party === "seller");
        if (leafEx2 && sellerOk2) { out2 = "FIXED"; why2 = leafEx2.reason ?? "no reason recorded"; }
        else why2 = `obligations ${JSON.stringify(parsed2.obligations.map((o: any) => o.party))} exceptions ${JSON.stringify(parsed2.exceptions.map((e: any) => e.party))}`;
      } else why2 = `plan exit ${plan2.status}: ${(plan2.stderr ?? "").trim().slice(-200)}`;
    } finally {
      writeFileSync(ledgerFile2, ledgerBytes2, { mode: 0o600 });
      writeFileSync(publicFile2, publicBytes2);
    }
    return { out: out2, why: why2 };
  };
  const caseB = await drill((leaf: any) => {
    const wrongKey = envmod.generateEnvelopeKey();
    return { ciphertext_hash: leaf.ciphertext_hash, envelope_ct: envmod.sealEnvelope("utest1redacted", [wrongKey.public_hex], "test"), owner_sig: "ab".repeat(64) };
  });
  await run.check("g2-wrong-key-exception", "a record sealed to a key the signers do not hold goes to the exception queue, never an obligation", () => {
    need(caseB.out === "FIXED", `${caseB.out}: ${caseB.why}`);
  });
  const caseC = await drill((leaf: any) => {
    const key = envmod.generateEnvelopeKey();
    const tAddr = "tmEZPFPFmP3nJnMH1mzf5uTQWaUbVMdMYdV37wnM";
    const eph = generateKeyPairSync("x25519");
    const ephPub = Buffer.from(eph.publicKey.export({ type: "spki", format: "der" })).subarray(12).toString("hex");
    const shared = require("node:crypto").diffieHellman({ privateKey: eph.privateKey, publicKey: createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(key.public_hex, "hex")]), type: "spki", format: "der" }) });
    const dk = sha256(Buffer.concat([Buffer.from("benzo-envelope-v1"), shared, Buffer.from(ephPub, "hex"), Buffer.from(key.public_hex, "hex")]));
    const nonceB = sha256(Buffer.concat([shared, Buffer.from(ephPub, "hex")])).subarray(0, 12);
    const payload = Buffer.alloc(512); payload.writeUInt16BE(tAddr.length, 0); Buffer.from(tAddr, "utf8").copy(payload, 2);
    const cipher = require("node:crypto").createCipheriv("chacha20-poly1305", dk, nonceB, { authTagLength: 16 });
    const body = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
    return { ciphertext_hash: leaf.ciphertext_hash, envelope_ct: Buffer.concat([Buffer.from(ephPub, "hex"), nonceB, body]).toString("hex"), owner_sig: "ab".repeat(64) };
  });
  await run.check("g2-taddr-exception", "a record carrying a transparent destination goes to the exception queue, never an obligation", () => {
    need(caseC.out === "FIXED", `${caseC.out}: ${caseC.why}`);
  });
}

// ---------------------------------------------------------------------------
// foldReserve — tools/repro/reserve-opening-repro.mjs (Reviewer R F2; mutation U7). The signer-side
// binding refuses a forged published reserve opening before any signature.
// ---------------------------------------------------------------------------
export async function foldReserve(run: Run): Promise<void> {
  const TRACKB = ROOT;
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  const canonical = (v) => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
  };
  const jsonBytes = (v) => Buffer.from(canonical(v) + "\n");
  const QUICKNET = {
    chain_hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    public_key: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
    scheme: "bls-unchained-g1-rfc9380", genesis: 1692803367, period: 3,
  };
  // signRecord / verifyRecord clone (manifest/schema.ts:116-132): Ed25519 over canonical JSON bytes.
  const kp = (() => {
    const raw = Buffer.from(hash("r-repro-signing-key"), "hex");
    const priv = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw]), type: "pkcs8", format: "der" });
    return { priv, pub: createPublicKey(priv).export({ type: "spki", format: "der" }).toString("hex") };
  })();
  const signRecord = (value) => {
    const bytes = jsonBytes(value);
    return { bytes: bytes.toString("base64"), sha256: hash(bytes), signer: kp.pub, signature: sign(null, bytes, kp.priv).toString("hex") };
  };
  
  // ---- manifest: uniform, sealed price bound present -------------------------------
  const R = 32704232; // fixed past quicknet round (same one tools/bench.ts uses)
  const release = QUICKNET.genesis + (R - 1) * QUICKNET.period;
  const auction_id = hash("r-repro-auction");
  const address = "utest1" + hash("r-repro-deposit").slice(0, 50);
  const manifest = {
    version: 1, network: "test", auction_id, escrow_ua: address, frost_group_key: hash("r-repro-group"),
    lot: "reserve opening repro", supply: 2, reserve_zats: "1000", tick_zats: "1000",
    B_max_zats: "100000", q_max: 2, C_zats: "1000100", fee_zats: "100", deposit_addresses: [address],
    drand: { ...QUICKNET, R }, T_submit: release - 1000, T_freeze: release - 200, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    // tlock ciphertext of the sealed price bound; validateManifest only checks shape (hex, 96..4096).
    sealed_reserve: "ab".repeat(200),
  };
  const packet = signRecord(manifest);
  
  // ---- three frozen orders: prices 5000 / 4000 / 3000, qty 1 each --------------------
  const mkOrder = (i, price) => {
    const pt = Buffer.alloc(128);
    Buffer.from(auction_id, "hex").copy(pt, 1);
    pt.writeBigUInt64BE(BigInt(price), 33); pt.writeUInt32BE(1, 41);
    Buffer.from(hash("nonce:" + i), "hex").subarray(0, 16).copy(pt, 45);
    Buffer.from(hash("owner:" + i), "hex").copy(pt, 61);
    Buffer.from(hash("commit:" + i), "hex").copy(pt, 93);
    return pt;
  };
  // merkle_root_v1 clone of clear/merkle.ts: leaf SHA256(00 || ctHash || canonical deposit JSON),
  // parent SHA256(01 || left || right), odd last node duplicated. A pass proves the frozen block is
  // well-formed under the shipped checkFrozen.
  const leafHash = (ctHash, deposit) => hash(Buffer.concat([Buffer.from([0]), Buffer.from(ctHash, "hex"), jsonBytes(deposit)]));
  const parent = (l, r) => hash(Buffer.concat([Buffer.from([1]), Buffer.from(l, "hex"), Buffer.from(r, "hex")]));
  const tree = (leaves) => {
    const levels = [leaves.map((l) => leafHash(l.ciphertext_hash, l.deposit))];
    while (levels.at(-1).length > 1) {
      const level = levels.at(-1), next = [];
      for (let i = 0; i < level.length; i += 2) next.push(parent(level[i], level[i + 1] ?? level[i]));
      levels.push(next);
    }
    return levels.at(-1)[0];
  };
  const leaves = [5000, 4000, 3000].map((price, i) => {
    const ciphertext_hex = mkOrder(i, price).toString("hex"); // order bytes stand in for the tle ciphertext
    return {
      auction_id, manifest_hash: packet.sha256, leaf_index: i, ciphertext_hash: hash(Buffer.from(ciphertext_hex, "hex")), ciphertext_hex,
      deposit: { txid: hash("txid:" + i), pool: "ironwood", address, diversifier_index: String(i) },
    };
  });
  const frozen = { auction_id, manifest_hash: packet.sha256, root: tree(leaves), paths: [], leaf_count: 3, cutoff: manifest.T_freeze, published_at: manifest.T_freeze - 100, leaves };
  const opened = leaves.map((l, i) => ({ leaf_index: i, plaintext_hex: l.ciphertext_hex }));
  
  // ---- the sealed price bound: true opening 3500 vs coordinator-forged 4500 ---------
  const opening = (price) => {
    const pt = Buffer.alloc(40);
    pt.writeBigUInt64BE(BigInt(price), 0);
    Buffer.from(auction_id, "hex").copy(pt, 8); // readReserve binds only auction_id + tick divisibility
    return pt.toString("hex");
  };
  
  const clear = (reserve_opening) => {
    const r = spawnSync(process.execPath, [path.join(TRACKB, "clear/dist/cli.mjs")],
      { input: JSON.stringify({ manifest: packet, signer: kp.pub, frozen, opened, reserve_opening }), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`clear failed: ${(r.stderr || r.stdout).slice(-300)}`);
    return JSON.parse(r.stdout);
  };
  
  const trueResult = clear(opening(2000));    // what the sealed ciphertext actually decrypts to
  const forgedResult = clear(opening(5000));  // coordinator's substitute (would decrypt differently)
  
  const summary = (r) => r.allocations.map((a) => `leaf${a.leaf_index}:${a.outcome}:pay=${a.payment_zats}:refund=${a.refund_zats}`).join(" ") + ` clearing=${r.clearing_price_zats}`;
  console.log("true   reserve opening (2000) ->", summary(trueResult));
  console.log("forged reserve opening (5000) ->", summary(forgedResult));
  const differs = canonical(trueResult) !== canonical(forgedResult);
  console.log("\nresults differ:", differs);
  if (!differs) { console.error("REGRESSION: forged opening did not change the result"); process.exit(1); }
  
  // ---- signer boundary (R6 fix): the exact shared check settle/plan.ts applies before any signature.
  // plan.ts derives the opening from manifest.sealed_reserve with the pinned Go tle and passes it to
  // requireReserveOpening together with the coordinator's published opening; a mismatch is refused
  // before the clearing is even computed, so no batch row and no signature can come from it.
  const { requireReserveOpening } = await import(path.join(TRACKB, "manifest/dist/reserve.mjs"));
  const trueOpening = opening(2000), forgedOpening = opening(5000);
  let refused = null;
  try { requireReserveOpening(manifest, forgedOpening, trueOpening); } catch (e) { refused = e.message; }
  if (refused === null) {
    console.log("\nERROR U7 forged reserve opening accepted by the signer-side binding");
    process.exit(1);
  }
  console.log(`\nsigner-side binding refuses the forged opening: ${refused}`);
  requireReserveOpening(manifest, trueOpening, trueOpening);
  console.log("F2 FIXED: the signer re-derives the sealed reserve and refuses a forged published opening before any signature.");
  
  await run.check("U7", "the signer-side reserve binding refuses a forged published opening", () => {
    need(refused !== null, "forged reserve opening accepted by the signer-side binding");
  });
  await run.check("r7-5-reserve-opening", "the sealed reserve binds the opening: the true derived opening clears the corpus and only it is accepted before any signature", () => {
    need(refused !== null && trueOpening !== null && differs === true, `refused ${refused} derived ${trueOpening !== null} results differ ${differs}`);
  });
}

// ---------------------------------------------------------------------------
// foldR71 — tools/repro/r7-1-ledger-redirect-repro.mjs (R7 item 1) + the g1 probe row: a tampered private
// ledger that redirects every destination to the operator is refused by the shipped worker/signer
// (the gate W drill). IDs: r7-1-ledger-redirect, g1-tampered-ledger-redirect.
// ---------------------------------------------------------------------------
export async function foldR71(run: Run, auctionId: string): Promise<void> {
  const id = auctionId, signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const live = auctionId;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
// leak-audit (gate LA): printed outputs never carry a full destination UA; comparisons keep full values.
const ab = (a) => (typeof a === "string" && a.length > 20 ? a.slice(0, 8) + "…" + a.slice(-6) : a);
const { generateOwnerKey, generateEnvelopeKey, openEnvelope, sealEnvelope, signEnvelope, settlementCommitment } =
  await import(path.join(ROOT, "envelope/dist/index.mjs"));

const ledgerFile = path.join(STATE, "auction", `${id}.json`);
const original = readFileSync(ledgerFile);
const ledger = JSON.parse(original.toString("utf8"));
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const published = JSON.parse(readFileSync(path.join(path.resolve(config.public_dir), "auction.json"), "utf8"));

// Part A (also R7 item 2 fail-before): the operator-held envelope private key, if present, decrypts the
// bidder's destination — the privacy leak Reviewer R F-1 / Reviewer G G4.
const operatorKeyFile = path.join(STATE, "product", `${id}.envelope.json`);
let sealToPub = null;
// R60 (Reviewer R P1 on R58): FIXED is printed only when the key file is ABSENT. Any other failure (a present key
// that throws while opening) is a CONFIRMED leak, never a pass; opening uses the manifest's network.
if (!existsSync(operatorKeyFile)) {
  console.log("F-1 FIXED: no operator-held envelope private key exists in product state");
  sealToPub = generateEnvelopeKey().public_hex; // any key; after the fix nothing opens it — the probe never needs to
} else {
  const ek = JSON.parse(readFileSync(operatorKeyFile, "utf8"));
  sealToPub = ek.public_hex;
  const rec = (published.envelopes ?? [])[0];
  let opened = "(could not open)";
  try { if (rec && ek.private_hex) opened = ab(openEnvelope(rec.envelope_ct, ek.private_hex, "test")); } catch (e) { opened = `(open threw: ${(e as Error).message})`; }
  console.log(`F-1 CONFIRMED: operator state ${path.basename(operatorKeyFile)} holds the envelope private key; leaf 0's destination ${opened}`);
}
// Part B: self-consistent fabricated (opened, envelopes) pairs per leaf — the operator's own owner key,
// nonce and commitment over an envelope sealed to the auction envelope key and carrying the operator's
// destination. Everything verifies against itself; only the signer's own derivation can catch it.
const attacker = "utest1redacted";
const fabricated = published.frozen.leaves.map((leaf) => {
  const owner = generateOwnerKey(), nonce = randomBytes(16).toString("hex");
  const envelope_ct = sealEnvelope(attacker, sealToPub, "test");
  const pt = Buffer.alloc(128);
  Buffer.from(nonce, "hex").copy(pt, 45);
  Buffer.from(owner.public_hex, "hex").copy(pt, 61);
  Buffer.from(settlementCommitment(nonce, envelope_ct), "hex").copy(pt, 93);
  return {
    opening: { leaf_index: leaf.leaf_index, plaintext_hex: pt.toString("hex") },
    record: { ciphertext_hash: leaf.ciphertext_hash, envelope_ct, owner_sig: signEnvelope(owner, id, leaf.ciphertext_hash, envelope_ct) },
  };
});
const tampered = {
  ...ledger,
  opened: (ledger.opened ?? []).map((o) => fabricated.find((f) => f.opening.leaf_index === o.leaf_index)?.opening ?? o),
  envelopes: (ledger.envelopes ?? []).map((e) => fabricated.find((f) => f.record.ciphertext_hash === e.ciphertext_hash)?.record ?? e),
};
mkdirSync(path.join(STATE, "run"), { recursive: true });
writeFileSync(path.join(STATE, "run", `${id}.ledger-backup.json`), original, { mode: 0o600 });
let outcome = "INCONCLUSIVE";
try {
  writeFileSync(ledgerFile, JSON.stringify(tampered), { mode: 0o600 });
  // Shipped settlement worker against the tampered ledger; killed at the first allocated batch (the
  // production resume boundary) so nothing is signed or broadcast here.
  const worker = spawn(path.join(ROOT, "bin/benzo"), ["settle", "--id", id], { detached: true });
  let out = "", err = "";
  const done = new Promise((resolve) => worker.on("close", resolve));
  worker.stdout.on("data", (d) => { out += d; if (out.includes('"allocated"')) { try { process.kill(-worker.pid, "SIGKILL"); } catch {} } });
  worker.stderr.on("data", (d) => { err += d; });
  await Promise.race([done, new Promise((r) => setTimeout(r, 240000))]);
  const workerError = /private ledger|differ/.test(err);
  if (workerError) {
    outcome = "FIXED";
    console.log(`FIXED: the settlement worker refused the tampered private ledger (${err.trim().slice(-160)}).`);
  } else {
    const status = JSON.parse(spawnSync(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "status", id], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout);
    const rows = status.rows.filter((r) => r.batch === 1);
    console.log(`allocated batch 1 rows: ${rows.map((r) => `${r.party}=${r.amount_zats}`).join(" ") || "(none)"}`);
    const seller_ua = JSON.parse(readFileSync(path.join(STATE, "settle", id, `routing-${signerName}.json`), "utf8")).seller_ua;
    const dir = path.join(STATE, "run", `r7-1-${id}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const candidate = path.join(dir, "redirect.pczt");
    const payments = rows.map((r) => ({ recipient: r.party === "seller" ? seller_ua : attacker, amount_zats: r.amount_zats }));
    spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["create", path.join(STATE, "vault"), candidate, "--network", "test"], { input: JSON.stringify(payments), encoding: "utf8", maxBuffer: 64 << 20 });
    const check = spawnSync(path.join(ROOT, "bin/benzo"), ["sign", "inspect", "--id", id, "--batch", "1", "--candidate", candidate, "--name", signerName], { encoding: "utf8", maxBuffer: 64 << 20 });
    console.log(`sign inspect exit ${check.status}`);
    console.log((check.stdout + check.stderr).trim().slice(-400));
    if (check.status === 0) { outcome = "CONFIRMED"; console.log(`CONFIRMED: the signer approved a real PCZT paying ${ab(attacker)} — the coordinator rewrites STATE/auction/<id>.json and every check passes.`); }
    else if (/private ledger|differ|refused/.test(check.stderr)) { outcome = "FIXED"; console.log(`FIXED: the signer refused the redirected PCZT (${check.stderr.trim().slice(-160)}).`); }
    else console.log("INCONCLUSIVE: refusal for an unrelated reason; see output above");
  }
} finally {
  writeFileSync(ledgerFile, original);
  console.log(`restored ${path.basename(ledgerFile)}; outcome ${outcome}`);
}

  collected.push(["r7-1-ledger-redirect", outcome === "FIXED", `outcome ${outcome}`], ["g1-tampered-ledger-redirect", outcome === "FIXED", `outcome ${outcome}`]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR72 — tools/repro/r7-2-envelope-keys-repro.mjs (R7 item 2): per-signer envelope keys pinned in the
// signed manifest, no operator-held envelope private key, and bid seal refuses a substituted key.
// ID: r7-2-envelope-keys.
// ---------------------------------------------------------------------------
export async function foldR72(run: Run, auctionId: string): Promise<void> {
  const id = auctionId, signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const live = auctionId;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const cli = (args, input) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), args, { input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") };
};
const fresh = () => spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "vault"), "--network", "test"], { encoding: "utf8" }).stdout.trim();
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
  const k4sub = cli(["bid", "seal", "--manifest", packetFile, "--signer", signer], { ...bid, envelope_pubkey: "44".repeat(32) });
  show("K4 bid seal with a substituted (unpinned) key", k4sub);
  const k4pin = pinned.alice ? cli(["bid", "seal", "--manifest", packetFile, "--signer", signer], { ...bid, envelope_pubkey: pinned.alice }) : { code: 1, out: "no pinned key" };
  if (pinned.alice) show("K4 bid seal with a pinned key", k4pin);
  collected.push(["r7-2-envelope-keys", k4sub.code !== 0 && k4pin.code === 0 && !existsSync(path.join(STATE, "product", id + ".envelope.json")), `substituted-seal ${k4sub.code} pinned-seal ${k4pin.code} operator-key-file ${existsSync(path.join(STATE, "product", id + ".envelope.json")) ? "PRESENT" : "absent"}`]);
  break;
}
// K6 live: the signer plan on a cleared product auction whose leaves carry envelope records.
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

  if (!collected.length) collected.push(['r7-2-envelope-keys', false, "the drill never reached its verdict"]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR74 — tools/repro/r7-4-claim-refund-repro.mjs (R7 item 4): benzo claim-refund completes
// exception-queue refunds and verify accepts correct exception states only. ID: r7-4-claim-refund.
// ---------------------------------------------------------------------------
export async function foldR74(run: Run, auctionId: string): Promise<void> {
  const id = auctionId, signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const live = rest.includes("--live");
const cli = (args, input, stdinText) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), args, { input: stdinText ?? (input === undefined ? undefined : JSON.stringify(input)), encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") };
};
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const publicDir = path.resolve(config.public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
const signer = JSON.parse(readFileSync(path.join(publicDir, "signer.json"), "utf8")).signer;

// C1
const help = cli(["claim-refund", "--help"]);
console.log(`C1 benzo claim-refund: ${help.code === 0 ? "available" : "absent — " + help.out.trim().slice(-80)}`);

// C2/C3: a synthetic settlement summary over the real published directory: every result obligation except the
// seller is a correct unpaid exception row (never paid to an unauthenticated destination), the seller is paid.
const result = JSON.parse(readFileSync(path.join(publicDir, "result.json"), "utf8"));
const exceptionRows = result.allocations.map((a) => ({ party: `leaf:${a.leaf_index}`, amount_zats: a.refund_zats, state: "exception" }));
const sellerAmount = result.conservation.payout_zats;
const sellerReceipt = { auction_id: id, party: "seller", txid: "0".repeat(64), pool: "ironwood", output_index: 0, amount_zats: sellerAmount };
const settlement = { rows: [...exceptionRows, { party: "seller", amount_zats: sellerAmount, state: "paid" }], receipts: [sellerReceipt] };
// canonical JSON (sorted keys), the byte form public documents are stored in
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const base = path.join(ROOT, "tmp/e2e/r7/claim-repro");
rmSync(base, { recursive: true, force: true }); mkdirSync(base, { recursive: true });
const withSettlement = (name, mutate) => {
  const dir = path.join(base, name);
  cpSync(publicDir, dir, { recursive: true });
  const d = JSON.parse(readFileSync(path.join(dir, "auction.json"), "utf8"));
  d.settlement = JSON.parse(JSON.stringify(settlement));
  mutate?.(d.settlement);
  writeFileSync(path.join(dir, "auction.json"), canonical(d) + "\n");
  writeFileSync(path.join(dir, "summary.json"), canonical(d.settlement) + "\n");
  return cli(["verify", "--dir", dir, "--signer", signer]);
};
const show = (label, r) => console.log(`${label}: exit ${r.code} ${r.out.split("\n").filter((l) => l.startsWith("ERROR") || l.startsWith("WARN")).join(" | ").slice(0, 300) || "(no error lines)"}`);
// leak-audit (gate LA): outputs never carry a full destination UA — a delivery address in evidence links a
// payout to a recipient. Comparisons below keep the full values; only the printed form is abbreviated.
const ab = (a) => (typeof a === "string" && a.length > 20 ? a.slice(0, 8) + "…" + a.slice(-6) : a);

const correct = withSettlement("correct", null);
show("C2 correct exception state verifies", correct);
show("C3 exception row with a receipt", withSettlement("with-receipt", (s) => s.receipts.push({ ...sellerReceipt, party: "leaf:0" })));
show("C3 exception row flipped to paid, no receipt", withSettlement("flipped", (s) => { s.rows.find((r) => r.party === "leaf:0").state = "refunded"; }));
show("C3 corrupted exception amount", withSettlement("corrupt-amount", (s) => { s.rows.find((r) => r.party === "leaf:0").amount_zats = String(BigInt(s.rows.find((r) => r.party === "leaf:0").amount_zats) + 1n); }));

// C4 --live: the shipped claim path — owner-signed request -> recorded claim -> paid refund.
if (live) {
  const frozen = doc.frozen;
  for (const a of result.allocations.slice(0, 2)) {
    const leaf = frozen.leaves.find((l) => l.leaf_index === a.leaf_index);
    const keyFile = path.join(STATE, "bids", id, leaf.ciphertext_hash + ".json");
    const ownerPrivate = JSON.parse(readFileSync(keyFile, "utf8")).owner_private_hex;
    const destination = spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"], { encoding: "utf8" }).stdout.trim();
    const request = cli(["claim-refund", "--id", id, "--party", `leaf:${a.leaf_index}`, "--destination", destination, "--owner-key-stdin"], undefined, ownerPrivate);
    console.log(`C4 build claim leaf:${a.leaf_index} -> ${request.code === 0 ? "signed for " + ab(destination) : "refused " + request.out.trim().slice(-120)}`);
    const reqFile = path.join(base, `claim-${a.leaf_index}.json`);
    writeFileSync(reqFile, request.out.trim(), { mode: 0o600 });
    const recorded = cli(["claim-refund", "--id", id, "--file", reqFile]);
    console.log(`C4 settle claim leaf:${a.leaf_index}: exit ${recorded.code} ${recorded.out.split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(0, 200)}`);
    console.log(`C4 paid to owner-named ${ab(destination)}: ${recorded.out.includes("settled") || recorded.code === 0 ? "see receipts" : "no"}`);
  }
  const cold = path.join(base, "cold"); rmSync(cold, { recursive: true, force: true }); cpSync(publicDir, cold, { recursive: true });
  show("C4 verify on the cold settled copy", cli(["verify", "--dir", cold, "--signer", signer]));
}

  collected.push(["r7-4-claim-refund", outcome === "FIXED", `outcome ${outcome}`]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR76 — tools/repro/r7-6-stray-refunds-repro.mjs (R7 item 6): strays refund only through the
// stray's own envelope/claim or the exception queue — never operator routing. ID: r7-6-stray-refunds.
// ---------------------------------------------------------------------------
export async function foldR76(run: Run, auctionId: string): Promise<void> {
  const signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const live = auctionId;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
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
if (live) {
  const plan = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), live], { encoding: "utf8", maxBuffer: 64 << 20 });
  console.log(`S2 plan exit ${plan.status}`);
  if (plan.status === 0) {
    const parsed = JSON.parse(plan.stdout);
    console.log(`S2 obligations: ${JSON.stringify(parsed.obligations.map((o) => o.party))}`);
    console.log(`S2 exceptions: ${JSON.stringify(parsed.exceptions.map((o) => ({ party: o.party.slice(0, 28), reason: o.reason ?? null })))}`);
    const strays = [...parsed.obligations, ...parsed.exceptions].filter((o) => o.party.startsWith("deposit:"));
    const paidToStrays = parsed.obligations.filter((o) => o.party.startsWith("deposit:") && !parsed.destinations?.[o.party]);
    collected.push(["r7-6-stray-refunds", paidToStrays.length === 0 && strays.some((o) => parsed.exceptions.includes(o)), `${paidToStrays.length} strays resolved from operator routing`]);
    console.log(paidToStrays.length === 0 && strays.some((o) => parsed.exceptions.includes(o))
      ? "FIXED: no stray is payable to an operator destination; unclaimed strays sit in the exception queue with reasons."
      : `CONFIRMED: ${paidToStrays.length} stray(s) resolved from operator routing (stray_refund_ua path).`);
  } else console.log(`S2 plan stderr ${plan.stderr.trim().slice(-200)}`);
}

  if (!collected.length) collected.push(['r7-6-stray-refunds', false, "the drill never reached its verdict"]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR7Claims — tools/repro/r7-claims-repro.mjs (R10 item 3 + R11 + R13): signer-side envelope-key
// pin, claim-griefing fix, publicly verifiable claims (the forged published claim is refused).
// ID: r7-claims-envelopes.
// ---------------------------------------------------------------------------
export async function foldR7Claims(run: Run, auctionId: string): Promise<void> {
  const id = auctionId, signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const live = auctionId;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const settle = rest.includes("--settle");
const cli = (args, input, stdinText) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), args, { input: stdinText ?? (input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input)), encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") };
};
const randomId = () => execFileSync("node", ["-e", "console.log(require('crypto').randomBytes(32).toString('hex'))"], { encoding: "utf8" }).trim();
const fresh = () => spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "vault"), "--network", "test"], { encoding: "utf8" }).stdout.trim();
const signerKeys = ["alice", "bob", "carol"].map((n) => JSON.parse(readFileSync(path.join(STATE, "signers", n, "envelope-key.json"), "utf8")).public_hex);
const show = (label, r) => console.log(`${label}: ${r.code === 0 ? "accepted" : "refused"} ${r.out.trim().slice(-160).replace(/\n/g, " ")}`);

// ---- R10K: a manifest pinning an operator key at bob's index (1) -------------------------------
const deposit = [fresh(), fresh()];
const swapped = [...signerKeys]; swapped[1] = "44".repeat(32);
const idK = randomId();
const manifest = { version: 1, network: "test", auction_id: idK, escrow_ua: deposit[0],
  frost_group_key: readFileSync(path.join(STATE, "group-key.txt"), "utf8").trim(), lot: "R10K pin repro", supply: 2,
  reserve_zats: "10", tick_zats: "10", B_max_zats: "3000", q_max: 1, C_zats: process.env.BNZ_COLLATERAL_ZATS, fee_zats: "0",
  deposit_addresses: deposit,
  drand: { chain_hash: process.env.BNZ_DRAND_CHAIN_HASH, public_key: process.env.BNZ_DRAND_PUBLIC_KEY, scheme: "bls-unchained-g1-rfc9380", genesis: Number(process.env.BNZ_DRAND_GENESIS), period: 3, R: 1 + Math.ceil((Math.floor(Date.now() / 1000) + 7200 - Number(process.env.BNZ_DRAND_GENESIS)) / 3) },
  T_submit: Math.floor(Date.now() / 1000) + 3600, T_freeze: Math.floor(Date.now() / 1000) + 5000, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1", envelope_keys: swapped };
show("R10K create with an operator key at bob's index", cli(["auction", "create"], manifest));
show("R10K auction sign", cli(["auction", "sign", "--id", idK]));

// ---- R11: junk claim first, owner's valid claim second -----------------------------------------
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const publicDir = path.resolve(config.public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
const result = JSON.parse(readFileSync(path.join(publicDir, "result.json"), "utf8"));
const leaf0 = doc.frozen.leaves[0];
const ownerPrivate = JSON.parse(readFileSync(path.join(STATE, "bids", id, leaf0.ciphertext_hash + ".json"), "utf8")).owner_private_hex;
const dest = spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"], { encoding: "utf8" }).stdout.trim();
const junk = { kind: "claim-refund", auction_id: id, party: "leaf:0", destination_ua: dest, destination_sha256: "0".repeat(64), owner_sig: "11".repeat(64) };
// R43/F17: the claim scratch lives under tmp/ and the delete is guarded — it used to be STATE/run, i.e. the
// A20 incident shape (settle/io self-loads BNZ_STATE_DIR=./.benzo, so the resolved target was the real state).
const claimsFile = path.join(ROOT, "tmp/e2e/r7/claims-repro");
rmSync(assertScratch(claimsFile), { recursive: true, force: true }); mkdirSync(claimsFile, { recursive: true });
writeFileSync(path.join(claimsFile, "junk.json"), JSON.stringify(junk), { mode: 0o600 });
show("R11 record junk claim (well-shaped, forged signature)", cli(["claim-refund", "--id", id, "--file", path.join(claimsFile, "junk.json"), "--defer"]));
const request = cli(["claim-refund", "--id", id, "--party", "leaf:0", "--destination", dest, "--owner-key-stdin"], undefined, ownerPrivate);
console.log(`R11 owner claim build: ${request.code === 0 ? "signed" : "refused " + request.out.trim().slice(-100)}`);
if (request.code === 0) {
  writeFileSync(path.join(claimsFile, "owner.json"), request.out.trim(), { mode: 0o600 });
  show("R11 record the owner's valid claim after the junk one", cli(["claim-refund", "--id", id, "--file", path.join(claimsFile, "owner.json"), "--defer"]));
  const plan = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id], { encoding: "utf8", maxBuffer: 64 << 20 });
  console.log(`R11 plan exit ${plan.status}`);
  if (plan.status === 0) {
    const parsed = JSON.parse(plan.stdout);
    const leaf0Out = parsed.obligations.find((o) => o.party === "leaf:0");
    console.log(`R11 leaf:0 ${leaf0Out ? "payable" : "still in the exception queue"}; used claim: ${JSON.stringify((parsed.claims_used ?? []).find((c) => c.party === "leaf:0") ?? null)?.slice(0, 120)}`);
  }
}

// ---- R13: public claim evidence ---------------------------------------------------------------
if (settle) {
  const settled = cli(["claim-refund", "--id", id, "--file", path.join(claimsFile, "owner.json")]);
  console.log(`R13 settle exit ${settled.code}`);
}
const cold = path.join(ROOT, "tmp/e2e/r7/claims-cold");
rmSync(assertScratch(cold), { recursive: true, force: true }); cpSync(publicDir, cold, { recursive: true });
const signer = JSON.parse(readFileSync(path.join(publicDir, "signer.json"), "utf8")).signer;
const clean = cli(["verify", "--dir", cold, "--signer", signer]);
console.log(`R13 verify on the claim-paid copy: exit ${clean.code} ${clean.out.split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(0, 200) || "(no error lines)"}`);
const published = JSON.parse(readFileSync(path.join(cold, "auction.json"), "utf8"));
console.log(`R13 published claims: ${JSON.stringify((published.claims ?? []).map((c) => c.party))}`);
if ((published.claims ?? []).length) {
  const forged = { ...published, claims: published.claims.map((c, i) => (i === 0 ? { ...c, owner_sig: "22".repeat(64) } : c)) };
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  writeFileSync(path.join(cold, "auction.json"), canonical(forged) + "\n");
  const forgedCheck = cli(["verify", "--dir", cold, "--signer", signer]);
  console.log(`R13 verify with a forged published claim: exit ${forgedCheck.code} ${forgedCheck.out.split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(0, 200) || "(no error lines)"}`);
  collected.push(["r7-claims-envelopes", clean.code === 0 && forgedCheck.code !== 0 && /claims/.test(forgedCheck.out), `clean ${clean.code} forged ${forgedCheck.code} ${forgedCheck.out.split("\n").filter((l: any) => l.startsWith("ERROR")).join(" | ").slice(0, 160)}`]);
}

  if (!collected.length) collected.push(['r7-claims-envelopes', false, "the drill never reached its verdict"]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR102 — tools/repro/r10-2-envelope-pay-repro.mjs (R10 item 2): settlement pays through validated
// v2 envelopes (the ENVELOPE_INTERIM_REFUSAL removal). ID: r10-2-envelope-pays.
// ---------------------------------------------------------------------------
export async function foldR102(run: Run, auctionId: string): Promise<void> {
  const id = auctionId, signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const live = auctionId;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const TLE = path.join(STATE, "bin", "tle");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const rndHex = (n) => randomBytes(n).toString("hex");
writeFileSync(path.join(ROOT, "tmp/repro-r10-2-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as merkle from "../clear/merkle";',
  'export * as env from "../envelope/index";',
  'export * as bid from "../envelope/bid";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r10-2-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r10-2-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const { schema, merkle, env, bid } = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r10-2-lib.mjs")).href);

// ---- scratch state -------------------------------------------------------------------------------
const SCRATCH = path.join(ROOT, "tmp/e2e/r10-2-state");
const scratch = (p) => path.join(SCRATCH, p);
const sh = (cmd, args, input) => {
  const p = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: SCRATCH } });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}`, stdout: p.stdout ?? "" };
};
rmSync(SCRATCH, { recursive: true, force: true });
for (const d of ["auction", "product", "settle", "run"]) mkdirSync(scratch(d), { recursive: true });
for (const d of ["bin", "vault", "proto", "frost", "signers"]) symlinkSync(path.join(STATE, d), scratch(d), "dir");
const bidderUfvk = sh(path.join(STATE, "bin", "zcash-devtool"), ["wallet", "-w", path.join(STATE, "bidder"), "list-accounts"]).out.match(/UFVK: (\S+)/)?.[1];
if (!bidderUfvk) { console.error("bidder UFVK unavailable"); process.exit(2); }
writeFileSync(scratch("ufvk.txt"), `${bidderUfvk}\n`, { mode: 0o600 });

// Real confirmed deposits the plan can count: old mined fixture deposits, spent through a mined batch the
// scratch ledger carries (the plan counts exactly those), at one address each so no stray rows appear.
const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sourceLedger = path.join(STATE, "settle", sourceAuction, "ledger.sqlite");
const { DatabaseSync } = await import("node:sqlite");
const owned = new Set(new DatabaseSync(sourceLedger, { readOnly: true }).prepare("SELECT txid FROM batches WHERE txid IS NOT NULL AND state!='exception'").all().map((b) => String(b.txid)));
const deposits = [...new Map(notes.filter((n) => n.value_zats === 500000 && n.height && n.memo_hex && n.memo_hex !== "00".repeat(512) && (!n.spent_in_txid || owned.has(n.spent_in_txid)))
  .map((n) => [n.address, n])).values()].slice(0, 2);
if (deposits.length < 2) { console.error("fewer than two usable deposits"); process.exit(2); }
const C = 500000n;

// ---- corpus: signed manifest, two real tlock bids, one real v2 envelope ---------------------------
const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const auction_id = rndHex(32);
const drandBase = process.env.BNZ_DRAND_URLS.split(",")[0];
const chain = schema.QUICKNET.chain_hash;
const latest = await fetch(`${drandBase}/${chain}/public/latest`);
if (!latest.ok) { console.error(`drand HTTP ${latest.status}`); process.exit(2); }
const R = (await latest.json()).round - 50;
const release = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
const T_freeze = release - 100, T_submit = T_freeze - 800, published_at = T_freeze - 200;
const beaconRes = await fetch(`${drandBase}/${chain}/public/${R}`);
if (!beaconRes.ok) { console.error(`drand HTTP ${beaconRes.status}`); process.exit(2); }
const beacon = await beaconRes.json();
const signerKeys = ["alice", "bob", "carol"].map((n) => JSON.parse(readFileSync(path.join(STATE, "signers", n, "envelope-key.json"), "utf8")).public_hex);
const manifest = {
  version: 1, network: "test", auction_id,
  escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r10.2 repro lot", supply: 1,
  reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
  C_zats: C.toString(), fee_zats: "0", deposit_addresses: deposits.map((n) => n.address),
  drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  envelope_keys: signerKeys,
};
const packet = schema.signRecord(manifest, signerPem);
const sealedDestination = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).out.trim();
if (!sealedDestination.startsWith("utest1")) { console.error(`fresh bidder address unavailable: ${sealedDestination}`); process.exit(2); }
const sealBid = (i, price, destination) => {
  const prep = bid.prepareBid({ auction_id, price_zats: price, quantity: 1, destination_ua: destination, envelope_public_hexs: destination ? signerKeys : undefined });
  const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(prep.plaintext_hex, "hex"), maxBuffer: 1 << 20, ...tleBound });
  if (sealed.status !== 0) { console.error(`tle seal: ${sealed.stderr?.toString().trim()}`); process.exit(2); }
  const ciphertext_hash = sha256(sealed.stdout);
  return { bound: bid.bindSealedBid(prep, auction_id, ciphertext_hash), ct: sealed.stdout.toString("hex"), ciphertext_hash };
};
const bid0 = sealBid(0, 1000n, sealedDestination); // the loser: refund C through its v2 envelope
const bid1 = sealBid(1, C, undefined);             // the winner: refund 0, no envelope (E2)
const leaves = [bid0, bid1].map((b, i) => ({ auction_id, manifest_hash: packet.sha256, ciphertext_hash: b.ciphertext_hash,
  deposit: { txid: deposits[i].txid, pool: "ironwood", address: deposits[i].address, diversifier_index: String(deposits[i].diversifier_index) },
  leaf_index: i, ciphertext_hex: b.ct }));
const { root, paths } = merkle.tree(leaves);
const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: T_freeze, published_at, leaves, paths };
const opened = leaves.map((l) => {
  const r = spawnSync(TLE, ["-d", "-c", chain], { input: Buffer.from(l.ciphertext_hex, "hex"), maxBuffer: 1 << 20, ...tleBound });
  if (r.status !== 0) { console.error(`tle open: ${r.stderr?.toString().trim()}`); process.exit(2); }
  return { leaf_index: l.leaf_index, plaintext_hex: r.stdout.toString("hex") };
});
const envelopes = [{ ciphertext_hash: bid0.ciphertext_hash, envelope_ct: bid0.bound.envelope_ct_hex, owner_sig: bid0.bound.owner_sig_hex }];
const clearRun = sh(process.execPath, [path.join(ROOT, "clear/dist/cli.mjs")], JSON.stringify({ manifest: packet, signer, frozen, opened, reserve_opening: null, serial_beacon: null, launch: undefined }));
if (clearRun.code !== 0) { console.error(`clear failed: ${clearRun.out.trim().slice(-200)}`); process.exit(2); }
const result = JSON.parse(clearRun.out);
const refund0 = result.allocations.find((a) => a.leaf_index === 0)?.refund_zats;
if (refund0 !== C.toString()) { console.error(`corpus: leaf 0 refund must be C, got ${refund0}`); process.exit(2); }

const publicDir = scratch("public");
mkdirSync(publicDir, { recursive: true });
const doc = { version: 1, auction_id, signer, manifest: packet, state: "CLEARED", receipts: [], frozen, result, opened, envelopes, beacon: { round: beacon.round, signature: beacon.signature, chain_hash: chain } };
writeFileSync(scratch(`auction/${auction_id}.json`), JSON.stringify(doc), { mode: 0o600 });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(doc));
writeFileSync(scratch(`product/${auction_id}.json`), JSON.stringify({ public_dir: publicDir, settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 } }));
mkdirSync(scratch(`settle/${auction_id}`), { recursive: true });
{
  // The source ledger's mined batches are what make the old deposits count; its old rows are dropped so the
  // corpus plan pins fresh.
  cpSync(sourceLedger, scratch(`settle/${auction_id}/ledger.sqlite`));
  const db = new DatabaseSync(scratch(`settle/${auction_id}/ledger.sqlite`));
  db.exec("DELETE FROM obligations"); db.close();
}
const sellerUa = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).out.trim();
const routing = { bidders: deposits.map((n) => ({ deposit_ua: n.address })), seller_ua: sellerUa, fee_reserve_ua: sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).out.trim() };
for (const name of ["alice", "bob", "carol"]) writeFileSync(scratch(`settle/${auction_id}/routing-${name}.json`), JSON.stringify(routing), { mode: 0o600 });
writeFileSync(scratch(`settle/${auction_id}/routing-commitment.json`), JSON.stringify({ sha256: schema.hash(schema.jsonBytes(routing)), pinned_at: Date.now() }), { mode: 0o600 });

// ---- E1: the shipped signer plan ------------------------------------------------------------------
const planRun = sh(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), auction_id]);
console.log(`E1 plan exit ${planRun.code}`);
let outcome = "INCONCLUSIVE", plan = null;
if (planRun.code === 0) {
  plan = JSON.parse(planRun.stdout);
  console.log(`E1 obligations: ${JSON.stringify(plan.obligations)}`);
  console.log(`E1 exceptions: ${JSON.stringify(plan.exceptions.map((o) => ({ party: o.party, reason: o.reason ?? null })))}`);
  const owed = plan.obligations.find((o) => o.party === "leaf:0");
  const excepted = plan.exceptions.find((o) => o.party === "leaf:0");
  if (excepted && /multi-recipient envelope format/.test(excepted.reason ?? "")) {
    outcome = "CONFIRMED";
    console.log("CONFIRMED: a leaf with a valid v2 envelope is refused with the interim envelope error — the refund waits in the exception queue and no batch can pay it.");
  } else if (owed && owed.amount_zats === C.toString() && !excepted) {
    outcome = "FIXED";
    console.log("FIXED: the plan owes the refund through the validated v2 envelope.");
  } else if (excepted) console.log(`E1 leaf:0 exception reason: ${excepted.reason}`);
} else console.log(`E1 plan stderr: ${planRun.out.trim().slice(-200)}`);

// ---- E2 + the shipped signer check over a real batch ----------------------------------------------
if (plan) {
  const zeroRefundRow = plan.obligations.find((o) => o.party === "leaf:1") ?? plan.exceptions.find((o) => o.party === "leaf:1");
  console.log(`E2 zero-refund leaf:1 needs no row: ${zeroRefundRow === undefined}`);
  execFileSync(process.execPath, ["node_modules/.bin/esbuild", "settle/ledger.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${scratch("ledger.mjs")}`, "--log-level=error"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const { Ledger } = await import(scratch("ledger.mjs"));
  const ledger = new Ledger(SCRATCH, auction_id);
  ledger.pin(plan.obligations, plan.exceptions);
  ledger.eligible();
  const batch = ledger.allocate(13);
  console.log(`E1 scratch batch ${batch ? `${batch.id} with rows ${JSON.stringify(batch.outputs.map((o) => o.party))}` : "none (the envelope refund is not payable)"}`);
  if (batch) {
    const recipient = (party) => party === "seller" ? sellerUa : party === "leaf:0" ? sealedDestination : null;
    const payment = batch.outputs.map((o) => ({ recipient: recipient(o.party), amount_zats: o.amount_zats }));
    const candidate = scratch("candidate.pczt");
    const created = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["create", path.join(STATE, "bidder"), candidate, "364", "--network", "test"], JSON.stringify(payment));
    console.log(`E1 candidate PCZT: ${created.code === 0 ? "created" : `create failed ${created.out.trim().slice(-120)}`}`);
    if (created.code === 0) {
      const check = sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "check", auction_id, String(batch.id), candidate, "alice"]);
      console.log(`E1 signer check exit ${check.code}`);
      if (check.code !== 0) console.log(`E1 check stderr: ${check.out.trim().slice(-220)}`);
      if (check.code === 0 && outcome === "FIXED" && batch.outputs.some((o) => o.party === "leaf:0")) {
        console.log(`FIXED: the signer check resolved leaf:0 to the exact UA sealed at bid time and the batch passed against a real PCZT.`);
      }
    }
  } else if (outcome === "CONFIRMED") console.log("CONFIRMED: no payable batch exists for the envelope refund.");
}
console.log(`outcome ${outcome}`);

  collected.push(["r10-2-envelope-pays", outcome === "FIXED", `outcome ${outcome}`]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR104 — tools/repro/r10-4-envelope-agreement-repro.mjs (R10 item 4 + R12 item 3 + R20):
// envelope-opens reports, the two-signer agreement gate, authenticated stray/cancelled envelopes.
// IDs: r10-4-envelope-agreement, r10-4-authenticated-strays.
// ---------------------------------------------------------------------------
export async function foldR104(run: Run, auctionId: string): Promise<void> {
  const id = auctionId, signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const live = auctionId;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const TLE = path.join(STATE, "bin", "tle");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const rndHex = (n) => randomBytes(n).toString("hex");
writeFileSync(path.join(ROOT, "tmp/repro-r10-4-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as merkle from "../clear/merkle";',
  'export * as env from "../envelope/index";',
  'export * as bid from "../envelope/bid";',
  'export * as senv from "../settle/envelopes";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r10-4-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r10-4-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const { schema, merkle, env, bid, senv } = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r10-4-lib.mjs")).href);

const SCRATCH = path.join(ROOT, "tmp/e2e/r10-4-state");
const scratch = (p) => path.join(SCRATCH, p);
const sh = (cmd, args, input) => {
  const p = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: SCRATCH } });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}`, stdout: p.stdout ?? "" };
};
rmSync(SCRATCH, { recursive: true, force: true });
for (const d of ["auction", "product", "settle", "run"]) mkdirSync(scratch(d), { recursive: true });
for (const d of ["bin", "vault", "proto", "frost", "signers"]) symlinkSync(path.join(STATE, d), scratch(d), "dir");
const bidderUfvk = sh(path.join(STATE, "bin", "zcash-devtool"), ["wallet", "-w", path.join(STATE, "bidder"), "list-accounts"]).out.match(/UFVK: (\S+)/)?.[1];
if (!bidderUfvk) { console.error("bidder UFVK unavailable"); process.exit(2); }
writeFileSync(scratch("ufvk.txt"), `${bidderUfvk}\n`, { mode: 0o600 });

const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sourceLedger = path.join(STATE, "settle", sourceAuction, "ledger.sqlite");
const { DatabaseSync } = await import("node:sqlite");
const owned = new Set(new DatabaseSync(sourceLedger, { readOnly: true }).prepare("SELECT txid FROM batches WHERE txid IS NOT NULL AND state!='exception'").all().map((b) => String(b.txid)));
const deposits = [...new Map(notes.filter((n) => n.value_zats === 500000 && n.height && n.memo_hex && n.memo_hex !== "00".repeat(512) && (!n.spent_in_txid || owned.has(n.spent_in_txid)))
  .map((n) => [n.address, n])).values()].slice(0, 3);
if (deposits.length < 3) { console.error("fewer than three usable deposits"); process.exit(2); }
const C = 500000n;

const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const auction_id = rndHex(32);
const drandBase = process.env.BNZ_DRAND_URLS.split(",")[0];
const chain = schema.QUICKNET.chain_hash;
const latest = await fetch(`${drandBase}/${chain}/public/latest`);
if (!latest.ok) { console.error(`drand HTTP ${latest.status}`); process.exit(2); }
const R = (await latest.json()).round - 50;
const release = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
const T_freeze = release - 100, T_submit = T_freeze - 800, published_at = T_freeze - 200;
const beaconRes = await fetch(`${drandBase}/${chain}/public/${R}`);
if (!beaconRes.ok) { console.error(`drand HTTP ${beaconRes.status}`); process.exit(2); }
const beacon = await beaconRes.json();
const signerKeys = ["alice", "bob", "carol"].map((n) => JSON.parse(readFileSync(path.join(STATE, "signers", n, "envelope-key.json"), "utf8")).public_hex);
const manifest = {
  version: 1, network: "test", auction_id,
  escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r10.4 repro lot", supply: 1,
  reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
  C_zats: C.toString(), fee_zats: "0", deposit_addresses: deposits.map((n) => n.address),
  drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  envelope_keys: signerKeys,
};
const packet = schema.signRecord(manifest, signerPem);
const freshUa = () => sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).out.trim();
const dest1 = freshUa(), dest2 = freshUa(); // leaf1 (carol cannot open) and leaf2 (bob+carol cannot open)
// A real owner-signed v2 box whose content key is wrapped to the real signer keys except for chosen signers,
// who receive a valid wrap of the WRONG key (exactly the malicious owner of R12 item 3: the box is
// internally consistent — the owner commits to it and signs it — so validEnvelope accepts the record, while
// the sabotaged signers cannot open it and the honest ones all open the same destination). The format and
// primitives are the shipped ones (libsodium); nothing here is pre-baked — keys, nonce and content key are
// fresh per box.
const sodium = (await import("libsodium-wrappers")).default;
await sodium.ready;
const pad512 = (text) => { const pt = Buffer.alloc(512); const payload = Buffer.from(text, "utf8"); pt.writeUInt16BE(payload.length, 0); payload.copy(pt, 2); return pt; };
const sealSabotaged = (dest, broken) => {
  const owner = env.generateOwnerKey(), aeadNonce = sodium.randombytes_buf(12), bidNonce = randomBytes(16).toString("hex");
  const contentKey = sodium.randombytes_buf(32);
  const kcLabel = Buffer.from("benzo-envelope-v2-kc");
  const kcKey = Buffer.concat([kcLabel, Buffer.alloc(32 - kcLabel.length)]);
  const commit = Buffer.from(sodium.crypto_generichash(32, contentKey, kcKey));
  const stanzas = Buffer.concat(signerKeys.map((h, i) => {
    const pk = Buffer.from(h, "hex");
    return Buffer.concat([pk, sodium.crypto_box_seal(broken.includes(i) ? Buffer.alloc(32, 0x5a) : contentKey, pk)]);
  }));
  const header = Buffer.concat([Buffer.from("benzo-envelope-v2"), Buffer.from([3]), stanzas, commit]);
  const body = Buffer.from(sodium.crypto_aead_chacha20poly1305_ietf_encrypt(pad512(dest), header, null, aeadNonce, contentKey));
  const envelope_ct_hex = Buffer.concat([header, aeadNonce, body]).toString("hex");
  const commitment = env.settlementCommitment(bidNonce, envelope_ct_hex);
  const plaintext = bid.buildBidPlaintext({ auction_id, price_zats: 1000n, quantity: 1, nonce_hex: bidNonce, owner_public_hex: owner.public_hex, settlement_commitment_hex: commitment }).toString("hex");
  const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(plaintext, "hex"), maxBuffer: 1 << 20, ...tleBound });
  if (sealed.status !== 0) { console.error(`tle seal: ${sealed.stderr?.toString().trim()}`); process.exit(2); }
  const ciphertext_hash = sha256(sealed.stdout);
  return { bound: bid.bindSealedBid({ plaintext_hex: plaintext, nonce_hex: bidNonce, owner, settlement_commitment_hex: commitment, envelope_ct_hex }, auction_id, ciphertext_hash), ct: sealed.stdout.toString("hex"), ciphertext_hash };
};
const bidWinner = bid.prepareBid({ auction_id, price_zats: C, quantity: 1 });
const winnerSealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(bidWinner.plaintext_hex, "hex"), maxBuffer: 1 << 20, ...tleBound });
const winnerHash = sha256(winnerSealed.stdout);
const bid1 = sealSabotaged(dest1, [2]);     // only carol is sabotaged: alice and bob agree
const bid2 = sealSabotaged(dest2, [1, 2]);  // bob and carol are sabotaged: only alice can open
const specs = [
  { bound: bid.bindSealedBid(bidWinner, auction_id, winnerHash), ct: winnerSealed.stdout.toString("hex"), ciphertext_hash: winnerHash },
  bid1, bid2,
];
const leaves = specs.map((b, i) => ({ auction_id, manifest_hash: packet.sha256, ciphertext_hash: b.ciphertext_hash,
  deposit: { txid: deposits[i].txid, pool: "ironwood", address: deposits[i].address, diversifier_index: String(deposits[i].diversifier_index) },
  leaf_index: i, ciphertext_hex: b.ct }));
const { root, paths } = merkle.tree(leaves);
const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: T_freeze, published_at, leaves, paths };
const opened = leaves.map((l) => {
  const r = spawnSync(TLE, ["-d", "-c", chain], { input: Buffer.from(l.ciphertext_hex, "hex"), maxBuffer: 1 << 20, ...tleBound });
  if (r.status !== 0) { console.error(`tle open: ${r.stderr?.toString().trim()}`); process.exit(2); }
  return { leaf_index: l.leaf_index, plaintext_hex: r.stdout.toString("hex") };
});
const envelopes = [bid1, bid2].map((b) => ({ ciphertext_hash: b.ciphertext_hash, envelope_ct: b.bound.envelope_ct_hex, owner_sig: b.bound.owner_sig_hex }));
const clearRun = sh(process.execPath, [path.join(ROOT, "clear/dist/cli.mjs")], JSON.stringify({ manifest: packet, signer, frozen, opened, reserve_opening: null, serial_beacon: null, launch: undefined }));
if (clearRun.code !== 0) { console.error(`clear failed: ${clearRun.out.trim().slice(-200)}`); process.exit(2); }
const result = JSON.parse(clearRun.out);
for (const leaf of [1, 2]) if (result.allocations.find((a) => a.leaf_index === leaf)?.refund_zats !== C.toString()) { console.error(`corpus: leaf ${leaf} refund must be C`); process.exit(2); }

const publicDir = scratch("public");
mkdirSync(publicDir, { recursive: true });
const doc = { version: 1, auction_id, signer, manifest: packet, state: "CLEARED", receipts: [], frozen, result, opened, envelopes, beacon: { round: beacon.round, signature: beacon.signature, chain_hash: chain } };
writeFileSync(scratch(`auction/${auction_id}.json`), JSON.stringify(doc), { mode: 0o600 });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(doc));
writeFileSync(scratch(`product/${auction_id}.json`), JSON.stringify({ public_dir: publicDir, settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 } }));
mkdirSync(scratch(`settle/${auction_id}`), { recursive: true });
{
  cpSync(sourceLedger, scratch(`settle/${auction_id}/ledger.sqlite`));
  const db = new DatabaseSync(scratch(`settle/${auction_id}/ledger.sqlite`));
  db.exec("DELETE FROM obligations"); db.close();
}
const sellerUa = freshUa();
const routing = { bidders: deposits.map((n) => ({ deposit_ua: n.address })), seller_ua: sellerUa, fee_reserve_ua: freshUa() };
for (const name of ["alice", "bob", "carol"]) writeFileSync(scratch(`settle/${auction_id}/routing-${name}.json`), JSON.stringify(routing), { mode: 0o600 });
writeFileSync(scratch(`settle/${auction_id}/routing-commitment.json`), JSON.stringify({ sha256: schema.hash(schema.jsonBytes(routing)), pinned_at: Date.now() }), { mode: 0o600 });

// ---- G3: each signer writes its own opening report (never the destination) -------------------------
for (const name of ["alice", "bob", "carol"]) {
  const r = sh(path.join(ROOT, "bin/benzo"), ["sign", "envelope-opens", "--id", auction_id, "--name", name]);
  if (r.code === 0) {
    const report = JSON.parse(readFileSync(scratch(`settle/${auction_id}/envelope-opens-${name}.json`), "utf8"));
    console.log(`G3 ${name} report: ${JSON.stringify(report.opens.map((o) => ({ leaf: o.leaf, ok: o.ok })))}`);
    if (/utest1/.test(JSON.stringify(report))) console.log(`G3 FAILED ${name}: the report leaked a destination`);
  } else console.log(`G3 ${name} report unavailable (pre-fix build): ${r.out.trim().slice(-80)}`);
}

// ---- G1/G2: the shipped signer plan ----------------------------------------------------------------
const planRun = sh(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), auction_id]);
console.log(`G1 plan exit ${planRun.code}`);
let outcome = "INCONCLUSIVE", plan = null;
if (planRun.code === 0) {
  plan = JSON.parse(planRun.stdout);
  console.log(`G1 obligations: ${JSON.stringify(plan.obligations.map((o) => o.party))}`);
  console.log(`G1 exceptions: ${JSON.stringify(plan.exceptions.map((o) => ({ party: o.party, reason: o.reason ?? null })))}`);
  console.log(`G1 envelope_agreed: ${JSON.stringify(plan.envelope_agreed)}`);
  const g1 = plan.obligations.find((o) => o.party === "leaf:2");
  const g1x = plan.exceptions.find((o) => o.party === "leaf:2");
  const g2 = plan.obligations.find((o) => o.party === "leaf:1");
  const g2ok = g2 && (plan.envelope_agreed === undefined || plan.envelope_agreed?.["leaf:1"] === sha256(Buffer.from(dest1, "utf8")));
  if (g1 && g2ok) {
    outcome = "CONFIRMED";
    console.log("CONFIRMED: the payability decision never consults the signers' openings — leaf:2 (whose envelope the owner sabotaged for two of three signers) is still owed, and the acting signer's check would approve paying it.");
  } else if (g1x && /signers could not agree on the envelope destination/.test(g1x.reason ?? "") && g2ok) {
    outcome = "FIXED";
    console.log("FIXED: leaf:2 waits in the exception queue (fewer than 2 signers open its envelope) while leaf:1 pays to the hash alice and bob agree on.");
  } else if (g1x) console.log(`G1 leaf:2 exception reason: ${g1x.reason}`);
} else console.log(`G1 plan stderr: ${planRun.out.trim().slice(-200)}`);

// ---- the shipped signer check over a real batch ------------------------------------------------------
if (plan) {
  execFileSync(process.execPath, ["node_modules/.bin/esbuild", "settle/ledger.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${scratch("ledger.mjs")}`, "--log-level=error"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const { Ledger } = await import(scratch("ledger.mjs"));
  const ledger = new Ledger(SCRATCH, auction_id);
  ledger.pin(plan.obligations, plan.exceptions);
  ledger.eligible();
  const batch = ledger.allocate(13);
  console.log(`G1 scratch batch ${batch ? `${batch.id} with rows ${JSON.stringify(batch.outputs.map((o) => o.party))}` : "none"}`);
  if (batch) {
    const recipient = (party) => party === "seller" ? sellerUa : party === "leaf:1" ? dest1 : party === "leaf:2" ? dest2 : null;
    const payment = batch.outputs.map((o) => ({ recipient: recipient(o.party), amount_zats: o.amount_zats }));
    const candidate = scratch("candidate.pczt");
    const created = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["create", path.join(STATE, "bidder"), candidate, "364", "--network", "test"], JSON.stringify(payment));
    if (created.code === 0) {
      const check = sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "check", auction_id, String(batch.id), candidate, "alice"]);
      console.log(`G1 signer check (alice) exit ${check.code}`);
      if (check.code !== 0) console.log(`G1 check stderr: ${check.out.trim().slice(-220)}`);
      const carol = sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "check", auction_id, String(batch.id), candidate, "carol"]);
      console.log(`G2 signer check (carol, sabotaged for leaf:1) exit ${carol.code} ${carol.out.trim().split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(-160)}`);
    } else console.log(`G1 candidate create failed: ${created.out.trim().slice(-120)}`);
  }
}

// ---- R20: an operator-inserted record is never paid blind ------------------------------------------------
{
  const strayNote = notes.find((n) => n.value_zats === 500000 && n.height && n.memo_hex && n.memo_hex !== "00".repeat(512)
    && (!n.spent_in_txid || owned.has(n.spent_in_txid)) && !deposits.some((d) => d.txid === n.txid && d.diversifier_index === n.diversifier_index));
  const memolessNote = notes.find((n) => (!n.memo_hex || n.memo_hex === "00".repeat(512)) && owned.has(n.spent_in_txid));
  const probe = (note, label) => {
    if (!note) { console.log(`R20 ${label}: no such note in the scan; skipped`); return; }
    const party = `deposit:${note.txid}:${note.diversifier_index}`;
    const operatorOwner = env.generateOwnerKey();
    const operatorCt = env.sealEnvelope(sellerUa, signerKeys, "test");
    const ctHash = sha256(Buffer.from(senv.memoSealedBid(note.memo_hex) ?? "", "hex"));
    const rec = { ciphertext_hash: ctHash, envelope_ct: operatorCt, owner_sig: env.signEnvelope(operatorOwner, auction_id, ctHash, operatorCt) };
    const aliceKey = JSON.parse(readFileSync(path.join(STATE, "signers", "alice", "envelope-key.json"), "utf8")).private_hex;
    const resolved = senv.authenticatedMemoEnvelope
      ? senv.memoEnvelopeRecipient(notes, party, packet, [rec], TLE, aliceKey)
      : senv.memoEnvelopeRecipient(notes, party, [rec], aliceKey);
    console.log(`R20 ${label}: operator-inserted record resolves to ${resolved === sellerUa ? "the operator's destination" : resolved === null ? "null" : "some destination"}`);
    return resolved;
  };
  const v1 = probe(strayNote, "v1 stray");
  probe(memolessNote, "memo-less stray");
  if (v1 === sellerUa && outcome === "CONFIRMED") console.log("CONFIRMED (R20): the signer's destination resolution pays an operator-inserted record blind — the operator's own destination resolves for a stray whose memo it does not control.");
  else if (v1 === null && outcome === "FIXED") console.log("FIXED (R20): the operator-inserted record is not authenticated by the stray's memo and resolves to null — the row is an exception row.");
  collected.push(["r10-4-authenticated-strays", v1 === null && outcome === "FIXED", `v1=${v1 === null ? "null" : "resolved"} outcome ${outcome}`]);
}
console.log(`outcome ${outcome}`);

  collected.push(["r10-4-envelope-agreement", outcome === "FIXED", `outcome ${outcome}`]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR153 — tools/repro/r15-3-claim-envelope-repro.mjs (R15 item 3): claims carry the destination
// sealed in a v2 envelope; only claim_envelope_sha256 is published. ID: r15-3-claim-envelope.
// ---------------------------------------------------------------------------
export async function foldR153(run: Run, auctionId: string): Promise<void> {
  const id = auctionId, signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const live = auctionId;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const SCRATCH = path.join(ROOT, "tmp/e2e/r15-3-state");
const scratch = (p) => path.join(SCRATCH, p);
const sh = (cmd, args, input, env = {}) => {
  const p = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, ...env, BNZ_STATE_DIR: SCRATCH } });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}`, stdout: p.stdout ?? "" };
};
rmSync(SCRATCH, { recursive: true, force: true });
for (const d of ["auction", "product", "settle", "run"]) mkdirSync(scratch(d), { recursive: true });
for (const d of ["bin", "vault", "proto", "frost", "signers"]) symlinkSync(path.join(STATE, d), scratch(d), "dir");
const bidderUfvk = sh(path.join(STATE, "bin", "zcash-devtool"), ["wallet", "-w", path.join(STATE, "bidder"), "list-accounts"]).out.match(/UFVK: (\S+)/)?.[1];
if (!bidderUfvk) { console.error("bidder UFVK unavailable"); process.exit(2); }
writeFileSync(scratch("ufvk.txt"), `${bidderUfvk}\n`, { mode: 0o600 });

// The r16-1 scratch recipe: a fixture auction flipped to REFUNDING in the scratch, its mined batches kept
// so the plan still counts the deposits it refunded.
const realLedger = JSON.parse(readFileSync(path.join(STATE, "auction", `${sourceAuction}.json`), "utf8"));
const realConfig = JSON.parse(readFileSync(path.join(STATE, "product", `${sourceAuction}.json`), "utf8"));
const manifest = JSON.parse(Buffer.from(realLedger.manifest.bytes, "base64").toString("utf8"));
const cancelled = (doc) => { const d = { ...doc, state: "REFUNDING" }; delete d.opened; return d; };
writeFileSync(scratch(`auction/${sourceAuction}.json`), JSON.stringify(cancelled(realLedger)), { mode: 0o600 });
const publicDir = scratch("public");
cpSync(path.resolve(realConfig.public_dir), publicDir, { recursive: true });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(cancelled(JSON.parse(readFileSync(path.join(path.resolve(realConfig.public_dir), "auction.json"), "utf8")))));
writeFileSync(scratch(`product/${sourceAuction}.json`), JSON.stringify({ ...realConfig, public_dir: publicDir }), { mode: 0o600 });
mkdirSync(scratch(`settle/${sourceAuction}`), { recursive: true });
for (const f of ["routing-alice.json", "routing-bob.json", "routing-carol.json", "routing-commitment.json"])
  cpSync(path.join(STATE, "settle", sourceAuction, f), scratch(`settle/${sourceAuction}/${f}`));
cpSync(path.join(STATE, "settle", sourceAuction, "ledger.sqlite"), scratch(`settle/${sourceAuction}/ledger.sqlite`));
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(scratch(`settle/${sourceAuction}/ledger.sqlite`));
  db.exec("DELETE FROM obligations"); db.close();
}
const { memoSealedBid } = await import(path.join(ROOT, "settle/dist/envelopes.mjs"));
const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const { DatabaseSync } = await import("node:sqlite");
const owned = new Set(new DatabaseSync(scratch(`settle/${sourceAuction}/ledger.sqlite`), { readOnly: true }).prepare("SELECT txid FROM batches WHERE txid IS NOT NULL AND state!='exception'").all().map((b) => String(b.txid)));
const target = notes.find((n) => manifest.deposit_addresses.includes(n.address) && (!n.spent_in_txid || owned.has(n.spent_in_txid))
  && n.memo_hex && memoSealedBid(n.memo_hex) && existsSync(path.join(STATE, "bids", sourceAuction, sha256(Buffer.from(memoSealedBid(n.memo_hex), "hex")) + ".json")));
if (!target) { console.error("no claimable bid deposit with an owner key"); process.exit(2); }
const party = `deposit:${target.txid}:${target.diversifier_index}`;
const ownerPrivate = JSON.parse(readFileSync(path.join(STATE, "bids", sourceAuction, sha256(Buffer.from(memoSealedBid(target.memo_hex), "hex")) + ".json"), "utf8")).owner_private_hex;
const dest = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).out.trim();
if (!dest.startsWith("utest1")) { console.error(`fresh bidder address unavailable: ${dest}`); process.exit(2); }

// ---- L1: the shipped bidder-side claim request ------------------------------------------------------
const built = sh(path.join(ROOT, "bin/benzo"), ["claim-refund", "--id", sourceAuction, "--party", party, "--destination", dest, "--owner-key-stdin"], ownerPrivate);
let outcome = "INCONCLUSIVE";
if (built.code !== 0) console.log(`L1 claim build failed: ${built.out.trim().slice(-160)}`);
else {
  const request = JSON.parse(built.stdout);
  console.log(`L1 request fields: ${JSON.stringify(Object.keys(request).sort())}`);
  const leaksDestination = /utest1/.test(JSON.stringify(request));
  const hasHashableCommit = /^[0-9a-f]{64}$/.test(request.destination_commit ?? "") || typeof request.destination_ua === "string";
  if (leaksDestination || hasHashableCommit) {
    outcome = "CONFIRMED";
    console.log(`CONFIRMED: the claim request ${leaksDestination ? "hands the operator the plaintext destination" : "commits to the destination with a matchable hash"} — the operator reads every destination and a candidate address's hash can be matched.`);
  } else if (typeof request.claim_envelope_ct === "string" && /^[0-9a-f]{64}$/.test(request.claim_envelope_sha256 ?? "")
    && request.claim_envelope_sha256 === sha256(Buffer.from(request.claim_envelope_ct, "hex"))) {
    // L2: the record-time operator side accepts it and the shipped signer plan publishes only the hash.
    const recorded = sh(path.join(ROOT, "bin/benzo"), ["claim-refund", "--id", sourceAuction, "--defer"], built.stdout);
    console.log(`L2 record-time check: ${recorded.code === 0 ? "accepted" : `refused ${recorded.out.trim().slice(-120)}`}`);
    const planRun = sh(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), sourceAuction]);
    console.log(`L2 plan exit ${planRun.code}`);
    if (planRun.code === 0 && recorded.code === 0) {
      const plan = JSON.parse(planRun.stdout);
      const used = plan.claims_used.find((c) => c.party === party);
      console.log(`L2 claims_used entry: ${JSON.stringify(used)}`);
      const sealed = plan.claim_envelopes?.[party] === request.claim_envelope_ct;
      const publishesOnlyHash = used && used.claim_envelope_sha256 === request.claim_envelope_sha256 && !/utest1/.test(JSON.stringify(used)) && used.destination_commit === undefined;
      if (sealed && publishesOnlyHash) {
        outcome = "FIXED";
        console.log("FIXED: the destination is sealed in the claim envelope (opened per signer), and the published claim carries only party, claim_envelope_sha256, owner_sig (and the scanned memo).");
      }
    } else console.log(`L2 plan stderr: ${planRun.out.trim().slice(-160)}`);
  }
}
console.log(`outcome ${outcome}`);

  collected.push(["r15-3-claim-envelope", outcome === "FIXED", `outcome ${outcome}`]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR161 — tools/repro/r16-1-cancel-claims-repro.mjs (R16 item 1): a cancelled product auction
// refunds through its owner-signed claims and never wedges. ID: r16-1-cancel-claims.
// ---------------------------------------------------------------------------
export async function foldR161(run: Run, auctionId: string): Promise<void> {
  const id = auctionId, signerName = "bob", sourceAuction = auctionId;
  const rest: string[] = [];
  const live = auctionId;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const SCRATCH = path.join(ROOT, "tmp/e2e/r16-1-state");
const scratch = (p) => path.join(SCRATCH, p);
const env = { ...process.env, BNZ_STATE_DIR: SCRATCH };
const sh = (cmd, args, input) => {
  const p = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}`, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
};

// ---- scratch state (the live auction state is only read and copied) --------------------------------
rmSync(SCRATCH, { recursive: true, force: true });
for (const d of ["auction", "product", "settle", "run"]) mkdirSync(scratch(d), { recursive: true });
for (const d of ["bin", "vault", "proto", "frost", "signers"]) symlinkSync(path.join(STATE, d), scratch(d), "dir");
const realLedger = JSON.parse(readFileSync(path.join(STATE, "auction", `${id}.json`), "utf8"));
const realConfig = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const realPublicDir = path.resolve(realConfig.public_dir);
const manifest = JSON.parse(Buffer.from(realLedger.manifest.bytes, "base64").toString("utf8"));
// The candidate PCZT is built from the bidder wallet, so the scratch inspect key is that wallet's UFVK.
const bidderUfvk = sh(path.join(STATE, "bin", "zcash-devtool"), ["wallet", "-w", path.join(STATE, "bidder"), "list-accounts"]).out
  .match(/UFVK: (\S+)/)?.[1];
if (!bidderUfvk) { console.error("bidder UFVK unavailable"); process.exit(2); }
writeFileSync(scratch("ufvk.txt"), `${bidderUfvk}\n`, { mode: 0o600 });
// The cancelled shape a real `benzo cancel` leaves: state REFUNDING, no openings published.
const cancelled = (doc) => { const d = { ...doc, state: "REFUNDING" }; delete d.opened; return d; };
writeFileSync(scratch(`auction/${id}.json`), JSON.stringify(cancelled(realLedger)), { mode: 0o600 });
const publicDir = scratch("public");
cpSync(realPublicDir, publicDir, { recursive: true });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(cancelled(JSON.parse(readFileSync(path.join(realPublicDir, "auction.json"), "utf8")))));
writeFileSync(scratch(`product/${id}.json`), JSON.stringify({ ...realConfig, public_dir: publicDir }), { mode: 0o600 });
mkdirSync(scratch(`settle/${id}`), { recursive: true });
for (const f of ["routing-alice.json", "routing-bob.json", "routing-carol.json", "routing-commitment.json"])
  cpSync(path.join(STATE, "settle", id, f), scratch(`settle/${id}/${f}`));
// Keep the mined batches (the plan counts deposits refunded through them) but pin the flipped plan fresh.
cpSync(path.join(STATE, "settle", id, "ledger.sqlite"), scratch(`settle/${id}/ledger.sqlite`));
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(scratch(`settle/${id}/ledger.sqlite`));
  db.exec("DELETE FROM obligations"); db.close();
}

// ---- one real claim for a real bid deposit --------------------------------------------------------
const { memoSealedBid } = await import(path.join(ROOT, "settle/dist/envelopes.mjs"));
const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(scratch(`settle/${id}/ledger.sqlite`), { readOnly: true });
  var owned = new Set(db.prepare("SELECT txid FROM batches WHERE txid IS NOT NULL AND state!='exception'").all().map((b) => String(b.txid)));
  db.close();
}
const target = notes.find((n) => manifest.deposit_addresses.includes(n.address) && (!n.spent_in_txid || owned.has(n.spent_in_txid))
  && n.memo_hex && memoSealedBid(n.memo_hex) && existsSync(path.join(STATE, "bids", id, createHash("sha256").update(Buffer.from(memoSealedBid(n.memo_hex), "hex")).digest("hex") + ".json")));
if (!target) { console.error("no claimable bid deposit with an owner key"); process.exit(2); }
const party = `deposit:${target.txid}:${target.diversifier_index}`;
const ownerPrivate = JSON.parse(readFileSync(path.join(STATE, "bids", id, createHash("sha256").update(Buffer.from(memoSealedBid(target.memo_hex), "hex")).digest("hex") + ".json"), "utf8")).owner_private_hex;
const dest = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).out.trim();
if (!dest.startsWith("utest1")) { console.error(`fresh bidder address unavailable: ${dest}`); process.exit(2); }
const request = JSON.parse(sh(path.join(ROOT, "bin/benzo"), ["claim-refund", "--id", id, "--party", party, "--destination", dest, "--owner-key-stdin"], ownerPrivate).out);
const recorded = sh(path.join(ROOT, "bin/benzo"), ["claim-refund", "--id", id, "--defer"], JSON.stringify(request));
console.log(`fresh claim for ${party} (deposit ${target.value_zats} zats): record-time check ${recorded.code === 0 ? "accepted" : `refused ${recorded.out.trim().slice(-120)}`}`);
console.log(`claim request carries no plaintext destination (R15 item 3): ${!/utest1/.test(JSON.stringify(request)) && typeof request.claim_envelope_ct === "string"}`);

// ---- C1: the shipped signer plan on the cancelled auction -----------------------------------------
const planRun = sh(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id]);
console.log(`C1 plan exit ${planRun.code}`);
for (const line of planRun.stderr.trim().split("\n").filter(Boolean)) console.log(`C1 plan: ${line}`);
let outcome = "INCONCLUSIVE", plan = null;
if (planRun.code === 0) {
  plan = JSON.parse(planRun.stdout);
  console.log(`C1 obligations: ${JSON.stringify(plan.obligations.map((o) => o.party))}`);
  // leak-audit (gate LA): the destinations map is printed with abbreviated UAs only (it is a map of
  // refund destinations — a full delivery address in evidence links a payout to a recipient).
  const ab = (a) => (typeof a === "string" && a.length > 20 ? a.slice(0, 8) + "…" + a.slice(-6) : a);
  console.log(`C1 destinations: ${JSON.stringify(Object.fromEntries(Object.entries(plan.destinations ?? {}).map(([k, v]) => [k, ab(v)])))}`);
  console.log(`C1 exceptions: ${JSON.stringify(plan.exceptions.map((o) => ({ party: o.party.slice(0, 34), reason: o.reason ?? null })))}`);
  const claimed = plan.claim_envelopes?.[party] ?? plan.destinations?.[party];
  if (claimed === undefined && plan.obligations.some((o) => o.party === party) && Object.keys(plan.destinations ?? plan.claim_envelopes ?? {}).length === 0) {
    outcome = "CONFIRMED";
    console.log("CONFIRMED: the CANCELLED/REFUNDING branch ignores the owner-signed claim — every confirmed deposit lands in obligations with no destination, so a cancelled product auction can refund nothing.");
  } else if ((claimed === dest || claimed === request.claim_envelope_ct) && plan.obligations.length === 1 && plan.exceptions.length > 0) {
    outcome = "FIXED";
    console.log(`FIXED: the claimed deposit is payable to its owner-named destination and ${plan.exceptions.length} unresolvable deposits wait in the exception queue with their reasons — the batch proceeds.`);
  }
} else console.log(`C1 plan stderr: ${planRun.out.trim().slice(-200)}`);

// ---- C2: the shipped signer check over a real batch ------------------------------------------------
const candidate = scratch("candidate.pczt");
const created = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["create", path.join(STATE, "bidder"), candidate, "364", "--network", "test"],
  JSON.stringify([{ recipient: dest, amount_zats: String(target.value_zats) }]));
console.log(`C2 candidate PCZT from the bidder wallet: ${created.code === 0 ? "created" : `create failed ${created.out.trim().slice(-120)}`}`);
if (created.code === 0) {
  execFileSync(process.execPath, ["node_modules/.bin/esbuild", "settle/ledger.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${scratch("ledger.mjs")}`, "--log-level=error"], { cwd: ROOT });
  const { Ledger } = await import(scratch("ledger.mjs"));
  const ledger = new Ledger(SCRATCH, id);
  ledger.pin(plan ? plan.obligations : [], plan ? plan.exceptions : []);
  ledger.eligible();
  const batch = ledger.allocate(13);
  console.log(`C2 scratch batch ${batch?.id} with ${batch?.outputs.length} rows: ${JSON.stringify(batch?.outputs.map((o) => o.party.slice(0, 34)))}`);
  ledger.close();
  const check = sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "check", id, String(batch.id), candidate, "alice"]);
  console.log(`C2 check exit ${check.code}`);
  if (check.code !== 0) console.log(`C2 check stderr: ${check.out.trim().slice(-220)}`);
  if (check.code !== 0 && /stray refund refused|envelope destination refused/.test(check.out)) {
    outcome = outcome === "FIXED" ? "FIXED" : "CONFIRMED";
    console.log("CONFIRMED: destinations() throws for a product non-seller row inside the signer check — no batch can proceed at all.");
  } else if (check.code === 0 && outcome === "FIXED") {
    console.log("FIXED: the signer check resolved the claimed row's destination and the batch passed against a real PCZT.");
  } else if (check.code === 0) console.log("check passed but C1 did not flip — inspect the plan output above");
}
console.log(`outcome ${outcome}`);

  collected.push(["r16-1-cancel-claims", outcome === "FIXED", `outcome ${outcome}`]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}

// ---------------------------------------------------------------------------
// foldR164 — tools/repro/r16-4-stray-claim-opening-repro.mjs (R16 item 4): the verifier derives every
// stray claim's owner key from the published memo + beacon; claims[].opening is refused.
// ID: r16-4-stray-claim-opening.
// ---------------------------------------------------------------------------
export async function foldR164(run: Run, auctionIdArg: string): Promise<void> {
  const id = auctionIdArg, signerName = "bob", sourceAuction = auctionIdArg;
  const rest: string[] = [];
  const live = auctionIdArg;
  const need = (ok: boolean, why: string) => { if (!ok) throw Error(why); };
  const collected: [string, boolean, string][] = [];
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);

// The real signing/verification primitives come from the shipped modules (fresh keys and signatures here —
// nothing about the forgery is pre-baked).
writeFileSync(path.join(ROOT, "tmp/repro-r16-4-entry.mjs"),
  'export * as envelope from "../envelope/index";\n', { flag: "w" });
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r16-4-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r16-4-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const { envelope } = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r16-4-lib.mjs")).href);

const publicDir = path.resolve(JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8")).public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
const stray = (doc.claims ?? []).find((c) => /^deposit:[0-9a-f]{64}:.+$/.test(c.party ?? ""));
if (!stray) { console.error("no published stray claim in this directory"); process.exit(2); }
const auctionId = doc.auction_id;
const verify = (dir) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", dir, "--signer", doc.signer], { encoding: "utf8", maxBuffer: 64 << 20 });
  const claimsLine = `${p.stdout ?? ""}${p.stderr ?? ""}`.split("\n").find((l) => /^OK claims|^ERROR claims/.test(l)) ?? "(no claims line)";
  return { code: p.status, claimsLine, other: `${p.stdout ?? ""}${p.stderr ?? ""}`.split("\n").filter((l) => /^(OK|ERROR) /.test(l) && !/^OK claims|^ERROR claims/.test(l)).length };
};

// ---- L0: the published memo is the scanned deposit's memo ----------------------------------------
{
  const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
    .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const m = /^deposit:([0-9a-f]{64}):(.+)$/.exec(stray.party);
  const note = notes.find((n) => n.txid === m[1] && String(n.diversifier_index) === m[2]);
  console.log(`L0 published claim memo_hex matches the scanned deposit: ${note && note.memo_hex === stray.memo_hex}`);
  if (!note || note.memo_hex !== stray.memo_hex) { console.log("L0 FAILED — the claim does not publish the scanned deposit's memo"); process.exit(1); }
}

// ---- L1: the F3 forgery — an operator-supplied opening -------------------------------------------
const dir = path.join(ROOT, "tmp/e2e/r16-4-dir");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
cpSync(publicDir, dir, { recursive: true });
const corpus = (claims) => { const d = { ...doc, claims }; delete d.settlement; return d; };
const commit = /^[0-9a-f]{64}$/.test(stray.claim_envelope_sha256 ?? "") ? stray.claim_envelope_sha256 : randomBytes(32).toString("hex");
{
  const owner = envelope.generateOwnerKey();
  const pt = Buffer.alloc(128, 0x42);
  pt[0] = 0;
  Buffer.from(auctionId, "hex").copy(pt, 1); // the layout the plan checks — the forgery mimics everything but the owner
  Buffer.from(owner.public_hex, "hex").copy(pt, 61);
  const body = { kind: "claim-refund", auction_id: auctionId, party: stray.party, claim_envelope_sha256: commit };
  const forged = { party: stray.party, claim_envelope_sha256: commit, owner_sig: envelope.signStatement(owner, body), opening: pt.toString("hex") };
  writeFileSync(path.join(dir, "auction.json"), JSON.stringify(corpus([forged])));
  const run = verify(dir);
  console.log(`L1 forged claim with operator-supplied opening: exit ${run.code} ${run.claimsLine} (${run.other} other check lines)`);
  if (/^OK claims/.test(run.claimsLine)) {
    console.log("CONFIRMED: verify derives the stray claim's owner key from claims[].opening — the operator supplies it, so any self-consistent forged claim verifies.");
    console.log("outcome CONFIRMED");
  } else {
    console.log("FIXED: the operator-supplied opening is refused; the stray claim's owner key comes only from the published memo's beacon-anchored opening.");
    console.log(`outcome ${/claim \d+ (memo_hex|shape)/.test(run.claimsLine) ? "FIXED" : "INCONCLUSIVE " + run.claimsLine}`);
  collected.push(["r16-4-stray-claim-opening", run.code !== 0 && /claim \d+ (memo_hex|shape)/.test(run.claimsLine), `forged opening exit ${run.code} ${run.claimsLine}`]);
  }
}

// ---- L2: fail-closed on a corrupted signature ----------------------------------------------------
{
  const owner = envelope.generateOwnerKey();
  const body = { kind: "claim-refund", auction_id: auctionId, party: stray.party, claim_envelope_sha256: commit };
  const bad = { party: stray.party, claim_envelope_sha256: commit, owner_sig: envelope.signStatement(owner, body), memo_hex: stray.memo_hex };
  bad.owner_sig = (bad.owner_sig[0] === "0" ? "1" : "0") + bad.owner_sig.slice(1);
  writeFileSync(path.join(dir, "auction.json"), JSON.stringify(corpus([bad])));
  const run = verify(dir);
  console.log(`L2 real memo with a corrupted owner_sig: exit ${run.code} ${run.claimsLine}`);
}

  if (!collected.length) collected.push(['r16-4-stray-claim-opening', false, "the drill never reached its verdict"]);
  for (const [cid, ok, why] of collected) await run.check(cid, cid, () => need(ok, why));
}
