// R35 folds (run 33), tranche 3 group A — verbatim ports of the named tools/repro scripts (they stay
// until gate RG proves the folded IDs pass and then deletes them). The bodies are the scripts' own;
// argv becomes the auction-id parameter and each script's outcome/verdict becomes one minted ID whose
// four AGENTS.md answers live in e2e/cli-auction.spec.ts's header. The live legs are unvalidated in
// this offline batch by design: R35.3(b) proves every folded ID pass/red at the final regression.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, statSync, writeFileSync } from "node:fs";
import { assertScratch } from "../../tools/repro/scratch.ts"; // R43/F17: only tmp/ or $TMPDIR targets may be deleted
import { createCipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
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
  const withBad = (doc: any) => ({ ...doc, envelopes: [bad, ...(doc.envelopes ?? []).filter((e: any) => e.ciphertext_hash !== leaf0.ciphertext_hash)] });
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
      console.log(`obligations: ${JSON.stringify(parsed.obligations.map((o: any) => o.party))}`);
      console.log(`exceptions: ${JSON.stringify(parsed.exceptions.map((o: any) => ({ party: o.party, reason: o.reason ?? null })))}`);
      const leaf0Exception = parsed.exceptions.find((e: any) => e.party === "leaf:0");
      const sellerOk = parsed.obligations.some((o: any) => o.party === "seller");
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
    return { ciphertext_hash: leaf.ciphertext_hash, envelope_ct: envmod.sealEnvelope("utest1nqaarlf8ehmtateefnysz3a6mxvtl39cgvtmj68ngj9266vtk7efr936qp67cz4aywuy4cqss3pfu870hxmkruhmrzgetw2jq7dle6lvzrgsrckh2ugw4fehsyd7j66sy67x84hylx5rjg47qnkzztwf9zvce9v6je7ngd6j8mjh44knm2kj7u6c67nv20dk6hkhsfugd5t7jqlkjfm", [wrongKey.public_hex], "test"), owner_sig: "ab".repeat(64) };
  });
  await run.check("g2-wrong-key-exception", "a record sealed to a key the signers do not hold goes to the exception queue, never an obligation", () => {
    need(caseB.out === "FIXED", `${caseB.out}: ${caseB.why}`);
  });
  const caseC = await drill((leaf: any) => {
    const key = envmod.generateEnvelopeKey();
    const tAddr = "tmEZPFPFmP3nJnMH1mzf5uTQWaUbVMdMYdV37wnM";
    const eph = generateKeyPairSync("x25519");
    const ephPub = Buffer.from(eph.publicKey.export({ type: "spki", format: "der" })).subarray(12).toString("hex");
    const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(key.public_hex, "hex")]), type: "spki", format: "der" }) });
    // R69: raw digests (the file's `sha256` helper returns hex; the cipher needs a 32-byte key and a 12-byte nonce).
    const sha256raw = (b: Buffer) => createHash("sha256").update(b).digest();
    const dk = sha256raw(Buffer.concat([Buffer.from("benzo-envelope-v1"), shared, Buffer.from(ephPub, "hex"), Buffer.from(key.public_hex, "hex")]));
    const nonceB = sha256raw(Buffer.concat([shared, Buffer.from(ephPub, "hex")])).subarray(0, 12);
    const payload = Buffer.alloc(512); payload.writeUInt16BE(tAddr.length, 0); Buffer.from(tAddr, "utf8").copy(payload, 2);
    const cipher = createCipheriv("chacha20-poly1305", dk, nonceB, { authTagLength: 16 });
    const body = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
    return { ciphertext_hash: leaf.ciphertext_hash, envelope_ct: Buffer.concat([Buffer.from(ephPub, "hex"), nonceB, body]).toString("hex"), owner_sig: "ab".repeat(64) };
  });
  // R71 (Reviewer R P1-2 on R70): this drill's record (a fresh key, the pre-v2 shape) is refused before the shielded-only
  // rule is reached, so the ID says exactly that, and the shielded-only rule itself is asserted on the shared validator
  // (requireShieldedDestination: sealEnvelope and openEnvelope both run it) with a real testnet t-address.
  let tRule = "";
  try { envmod.sealEnvelope("tmEZPFPFmP3nJnMH1mzf5uTQWaUbVMdMYdV37wnM", [envmod.generateEnvelopeKey().public_hex], "test"); tRule = "accepted"; } catch (e) { tRule = (e as Error).message; }
  await run.check("g2-taddr-exception", "a malformed record carrying a transparent destination goes to the exception queue, and the shared envelope validator refuses a non-shielded (t-address) destination", () => {
    need(caseC.out === "FIXED", `${caseC.out}: ${caseC.why}`);
    need(/transparent address \(t-addr\)|not a shielded destination/.test(tRule), `shared validator on a t-address: ${tRule}`);
  });
}

// ---------------------------------------------------------------------------
// foldReserve — tools/repro/reserve-opening-repro.mjs (Reviewer R F2; mutation U7). The signer-side
// binding refuses a forged published reserve opening before any signature.
// ---------------------------------------------------------------------------
export async function foldReserve(run: Run): Promise<void> {
  const TRACKB = ROOT;
  const hash = (b: any) => createHash("sha256").update(b).digest("hex");
  const canonical = (v: any): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
  };
  const jsonBytes = (v: any) => Buffer.from(canonical(v) + "\n");
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
  const signRecord = (value: any) => {
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
  const mkOrder = (i: any, price: any) => {
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
  const leafHash = (ctHash: any, deposit: any) => hash(Buffer.concat([Buffer.from([0]), Buffer.from(ctHash, "hex"), jsonBytes(deposit)]));
  const parent = (l: any, r: any) => hash(Buffer.concat([Buffer.from([1]), Buffer.from(l, "hex"), Buffer.from(r, "hex")]));
  const tree = (leaves: any) => {
    const levels = [leaves.map((l: any) => leafHash(l.ciphertext_hash, l.deposit))];
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
  const opening = (price: any) => {
    const pt = Buffer.alloc(40);
    pt.writeBigUInt64BE(BigInt(price), 0);
    Buffer.from(auction_id, "hex").copy(pt, 8); // readReserve binds only auction_id + tick divisibility
    return pt.toString("hex");
  };
  
  const clear = (reserve_opening: any) => {
    const r = spawnSync(process.execPath, [path.join(TRACKB, "clear/dist/cli.mjs")],
      { input: JSON.stringify({ manifest: packet, signer: kp.pub, frozen, opened, reserve_opening }), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`clear failed: ${(r.stderr || r.stdout).slice(-300)}`);
    return JSON.parse(r.stdout);
  };
  
  const trueResult = clear(opening(2000));    // what the sealed ciphertext actually decrypts to
  const forgedResult = clear(opening(5000));  // coordinator's substitute (would decrypt differently)
  
  const summary = (r: any) => r.allocations.map((a: any) => `leaf${a.leaf_index}:${a.outcome}:pay=${a.payment_zats}:refund=${a.refund_zats}`).join(" ") + ` clearing=${r.clearing_price_zats}`;
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
  try { requireReserveOpening(manifest, forgedOpening, trueOpening); } catch (e) { refused = (e as Error).message; }
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
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR ?? ".benzo");
// leak-audit (gate LA): printed outputs never carry a full destination UA; comparisons keep full values.
const ab = (a: any) => (typeof a === "string" && a.length > 20 ? a.slice(0, 8) + "…" + a.slice(-6) : a);
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
  // R63 (P2-7): never print the destination itself into evidence — only its hash and length.
  try { if (rec && ek.private_hex) { const d = openEnvelope(rec.envelope_ct, ek.private_hex, "test"); opened = `sha256 ${createHash("sha256").update(d).digest("hex")} (${d.length} chars)`; } } catch (e) { opened = `(open threw: ${(e as Error).message})`; }
  console.log(`F-1 CONFIRMED: operator state ${path.basename(operatorKeyFile)} holds the envelope private key; leaf 0's destination ${opened}`);
}
// Part B: self-consistent fabricated (opened, envelopes) pairs per leaf — the operator's own owner key,
// nonce and commitment over an envelope sealed to the auction envelope key and carrying the operator's
// destination. Everything verifies against itself; only the signer's own derivation can catch it.
const attacker = "utest1redacted";
const fabricated = published.frozen.leaves.map((leaf: any) => {
  const owner = generateOwnerKey(), nonce = randomBytes(16).toString("hex");
  const envelope_ct = sealEnvelope(attacker, [sealToPub], "test") /* R70: recipients are an array */;
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
  opened: (ledger.opened ?? []).map((o: any) => fabricated.find((f: any) => f.opening.leaf_index === o.leaf_index)?.opening ?? o),
  envelopes: (ledger.envelopes ?? []).map((e: any) => fabricated.find((f: any) => f.record.ciphertext_hash === e.ciphertext_hash)?.record ?? e),
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
  worker.stdout.on("data", (d) => { out += d; if (out.includes('"allocated"')) { try { if (worker.pid) process.kill(-worker.pid, "SIGKILL"); } catch {} } });
  worker.stderr.on("data", (d) => { err += d; });
  await Promise.race([done, new Promise((r) => setTimeout(r, 240000))]);
  const workerError = /private ledger|differ/.test(err);
  if (workerError) {
    outcome = "FIXED";
    console.log(`FIXED: the settlement worker refused the tampered private ledger (${err.trim().slice(-160)}).`);
  } else {
    const status = JSON.parse(spawnSync(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "status", id], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout);
    const rows = status.rows.filter((r: any) => r.batch === 1);
    console.log(`allocated batch 1 rows: ${rows.map((r: any) => `${r.party}=${r.amount_zats}`).join(" ") || "(none)"}`);
    const seller_ua = JSON.parse(readFileSync(path.join(STATE, "settle", id, `routing-${signerName}.json`), "utf8")).seller_ua;
    const dir = path.join(STATE, "run", `r7-1-${id}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const candidate = path.join(dir, "redirect.pczt");
    const payments = rows.map((r: any) => ({ recipient: r.party === "seller" ? seller_ua : attacker, amount_zats: r.amount_zats }));
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
// foldR74 — tools/repro/r7-4-claim-refund-repro.mjs (R7 item 4): benzo claim-refund completes
// exception-queue refunds and verify accepts correct exception states only. ID: r7-4-claim-refund.
// ---------------------------------------------------------------------------
// foldR76 — tools/repro/r7-6-stray-refunds-repro.mjs (R7 item 6): strays refund only through the
// stray's own envelope/claim or the exception queue — never operator routing. ID: r7-6-stray-refunds.
// ---------------------------------------------------------------------------
// foldR7Claims — tools/repro/r7-claims-repro.mjs (R10 item 3 + R11 + R13): signer-side envelope-key
// pin, claim-griefing fix, publicly verifiable claims (the forged published claim is refused).
// ID: r7-claims-envelopes.
// ---------------------------------------------------------------------------
// foldR102 — tools/repro/r10-2-envelope-pay-repro.mjs (R10 item 2): settlement pays through validated
// v2 envelopes (the ENVELOPE_INTERIM_REFUSAL removal). ID: r10-2-envelope-pays.
// ---------------------------------------------------------------------------
// foldR104 — tools/repro/r10-4-envelope-agreement-repro.mjs (R10 item 4 + R12 item 3 + R20):
// envelope-opens reports, the two-signer agreement gate, authenticated stray/cancelled envelopes.
// IDs: r10-4-envelope-agreement, r10-4-authenticated-strays.
// ---------------------------------------------------------------------------
// foldR153 — tools/repro/r15-3-claim-envelope-repro.mjs (R15 item 3): claims carry the destination
// sealed in a v2 envelope; only claim_envelope_sha256 is published. ID: r15-3-claim-envelope.
// ---------------------------------------------------------------------------
// foldR161 — tools/repro/r16-1-cancel-claims-repro.mjs (R16 item 1): a cancelled product auction
// refunds through its owner-signed claims and never wedges. ID: r16-1-cancel-claims.
// ---------------------------------------------------------------------------
// foldR164 — tools/repro/r16-4-stray-claim-opening-repro.mjs (R16 item 4): the verifier derives every
// stray claim's owner key from the published memo + beacon; claims[].opening is refused.
// ID: r16-4-stray-claim-opening.
