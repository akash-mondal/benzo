// @ts-nocheck
// R35 folds (run 33), tranche 3 group A — verbatim ports of the named tools/repro scripts (they stay
// until gate RG proves the folded IDs pass and then deletes them). The bodies are the scripts' own;
// argv becomes the auction-id parameter and each script's outcome/verdict becomes one minted ID whose
// four AGENTS.md answers live in e2e/cli-auction.spec.ts's header. The live legs are unvalidated in
// this offline batch by design: R35.3(b) proves every folded ID pass/red at the final regression.
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, statSync, writeFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import path from "node:path";
import * as schema from "../../manifest/schema";
import * as envmod from "../../envelope";
import * as merkle from "../../clear/merkle";
import * as settle from "../../settle/envelopes";
import { requireReserveOpening } from "../../manifest/reserve";
import { ROOT, STATE, bin } from "./env";
import type { Run } from "./run";

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
    return { ciphertext_hash: leaf.ciphertext_hash, envelope_ct: envmod.sealEnvelope("utest1redacted", [wrongKey.public_hex]), owner_sig: "ab".repeat(64) };
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
