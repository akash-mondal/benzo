// Public auction directory model shared by `benzo verify`, operator view, receipt show and the read-only API.
// Reads only public files; never loads BNZ_STATE_DIR secrets or bid-side keys.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { client, hash, jsonBytes, requireThat, verifyRecord, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen, member, receiptMember, type Frozen } from "../clear/merkle";
import { clear, type Opened } from "../clear/core";
import { clearModeB, clientPhase5, isBuyback } from "../clear/mode-b";
import { settlementCommitment, verifyEnvelope } from "../envelope/index";
import { checkCertificates, freezeStatement, validateWitnessSet, type WitnessCert, type WitnessSet } from "../witness";

// Buyback manifests (clearing.mode "buyback" + `buyback` fields) validate through clear/mode-b.ts; Mode A keeps
// the unchanged client(). The witness set rides in a separate signed packet, not in the manifest.
function readClient(packet: Signed, signer: string): { manifest_hash: string; manifest: Manifest } {
  const peek = JSON.parse(Buffer.from(packet.bytes, "base64").toString("utf8"));
  // The buyback extra fields ride along in the untyped manifest value; callers read them only through clear/mode-b.
  return peek?.clearing?.mode === "buyback" ? (clientPhase5(packet, signer) as unknown as { manifest_hash: string; manifest: Manifest }) : client(packet, signer);
}
export type EnvelopeRecord = { ciphertext_hash: string; envelope_ct: string; owner_sig: string };

export type SettlementReceipt = { auction_id: string; party: string; txid: string; pool: string; output_index: number; amount_zats: string };
export type Beacon = { round: number; signature: string; chain_hash: string };
export type SettlementSummary = {
  auction_id?: string;
  rows?: { party: string; amount_zats: string; state?: string }[];
  receipts?: SettlementReceipt[];
};
export type PublicResult = {
  auction_id: string; manifest_hash: string; freeze_root: string; mode: string;
  clearing_price_zats: string;
  allocations: { leaf_index: number; price_zats: string | null; quantity: number; fill: number; payment_zats: string; refund_zats: string; outcome: string }[];
  conservation: { input_zats: string; payout_zats: string; refund_zats: string; fees_zats: string };
};
// Lifecycle-safe (R21 item 5): a DRAFT/OPEN/SEALED-WAIT canonical document carries no frozen/opened/result
// yet. Readers that must run past freeze (benzo verify) use loadCompletePublicAuction instead.
export type PublicAuction = {
  dir: string;
  signer: string;
  legacy: boolean;
  state: string;
  manifestPacket: Signed;
  manifest: Manifest;
  manifest_hash: string;
  frozen: Frozen | null;
  opened: Opened[];
  beacon: Beacon | null;
  result: PublicResult | null;
  resultBytes: Buffer | null;
  receipts: Signed[];
  envelopes: EnvelopeRecord[];
  witnessSet: Signed | null;
  witnessCerts: WitnessCert[];
  settlement: SettlementSummary | null;
};
export type CompletePublicAuction = PublicAuction & { frozen: Frozen; result: PublicResult; resultBytes: Buffer };
export type Check = { id: string; error?: string };

// Canonical document keys, per schemas/public-auction.schema.json (additionalProperties: false).
const canonicalKeys = new Set(["version", "auction_id", "signer", "manifest", "state", "receipts", "frozen", "result", "settlement", "opened", "beacon", "envelopes", "witness_set", "witness_cert"]);
const states = new Set(["DRAFT", "OPEN", "SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "SETTLED", "CANCELLED", "REFUNDING"]);
// The schema requires opened + beacon once the state reaches OPENED.
const openedStates = new Set(["OPENED", "CLEARED", "SETTLED"]);

// `signer`, when given, is the out-of-band trust anchor (R20): the document's own signer claim must match it.
export function loadPublicAuction(dir: string, opts: { signer?: string } = {}): PublicAuction {
  const root = path.resolve(dir);
  const file = (name: string): Buffer => {
    const p = path.join(root, name);
    requireThat(existsSync(p), `missing ${name}`);
    return readFileSync(p);
  };
  const text = (name: string) => file(name).toString("utf8");
  const anchor = (claimed: string): string => {
    requireThat(/^[0-9a-f]{88}$/.test(claimed), "signer");
    if (opts.signer) requireThat(claimed === opts.signer, "signer mismatch");
    return opts.signer ?? claimed;
  };
  const legacy = !existsSync(path.join(root, "auction.json"));
  let signer: string, manifestPacket: Signed, manifest: Manifest, manifest_hash: string, state: string;
  let frozen: Frozen | null, opened: Opened[], beacon: Beacon | null;
  let resultBytes: Buffer | null, result: PublicResult | null, receipts: Signed[], envelopes: EnvelopeRecord[], witnessSet: Signed | null, witnessCerts: WitnessCert[], settlement: SettlementSummary | null;
  if (!legacy) {
    // Canonical auction.json is the public document (R20/Q13); the per-file projections are not a source here.
    const doc = JSON.parse(text("auction.json"));
    requireThat(doc && typeof doc === "object" && !Array.isArray(doc), "auction.json");
    requireThat(Object.keys(doc).every(k => canonicalKeys.has(k)) && doc.version === 1, "auction.json schema");
    requireThat(/^[0-9a-f]{64}$/.test(String(doc.auction_id)), "auction id");
    requireThat(typeof doc.state === "string" && states.has(doc.state), "state");
    state = doc.state;
    signer = anchor(String(doc.signer));
    manifestPacket = doc.manifest as Signed;
    ({ manifest, manifest_hash } = readClient(manifestPacket, signer));
    requireThat(doc.auction_id === manifest.auction_id, "auction id binding");
    requireThat(Array.isArray(doc.receipts), "receipts");
    requireThat(doc.frozen === undefined || (doc.frozen && typeof doc.frozen === "object"), "frozen");
    requireThat(doc.result === undefined || (doc.result && typeof doc.result === "object"), "result");
    frozen = (doc.frozen ?? null) as Frozen | null;
    result = (doc.result ?? null) as PublicResult | null;
    if (openedStates.has(doc.state)) requireThat(Array.isArray(doc.opened) && doc.beacon, "opened/beacon required from OPENED");
    opened = Array.isArray(doc.opened) ? (doc.opened as Opened[]) : [];
    beacon = readBeacon(doc.beacon ?? null, manifest);
    resultBytes = result ? jsonBytes(doc.result) : null;
    receipts = doc.receipts as Signed[];
    requireThat(doc.envelopes === undefined || Array.isArray(doc.envelopes), "envelopes");
    envelopes = (doc.envelopes ?? []) as EnvelopeRecord[];
    requireThat(doc.witness_set === undefined || (doc.witness_set && typeof doc.witness_set === "object"), "witness_set");
    witnessSet = (doc.witness_set ?? null) as Signed | null;
    requireThat(doc.witness_cert === undefined || Array.isArray(doc.witness_cert), "witness_cert");
    witnessCerts = (doc.witness_cert ?? []) as WitnessCert[];
    settlement = (doc.settlement ?? null) as SettlementSummary | null;
  } else {
    // Legacy projections (signer.json, opened.json, summary.json, ...) — fallback only for the Phase 2/3 evidence dirs.
    signer = anchor(String(JSON.parse(text("signer.json")).signer));
    manifestPacket = JSON.parse(text("manifest.json")) as Signed;
    ({ manifest, manifest_hash } = readClient(manifestPacket, signer));
    frozen = JSON.parse(text("frozen.json")) as Frozen;
    opened = existsSync(path.join(root, "opened.json"))
      ? (JSON.parse(text("opened.json")) as Opened[])
      : [];
    beacon = readBeacon(
      existsSync(path.join(root, "beacon.json")) ? JSON.parse(text("beacon.json")) : null,
      manifest,
    );
    resultBytes = file("result.json");
    result = JSON.parse(resultBytes.toString("utf8")) as PublicResult;
    receipts = existsSync(path.join(root, "receipts.json"))
      ? (JSON.parse(text("receipts.json")) as Signed[])
      : [];
    envelopes = existsSync(path.join(root, "envelope.json"))
      ? (JSON.parse(text("envelope.json")) as EnvelopeRecord[])
      : [];
    witnessSet = existsSync(path.join(root, "witness-set.json"))
      ? (JSON.parse(text("witness-set.json")) as Signed)
      : null;
    witnessCerts = existsSync(path.join(root, "witness.json"))
      ? (JSON.parse(text("witness.json")) as WitnessCert[])
      : [];
    settlement = existsSync(path.join(root, "summary.json"))
      ? (JSON.parse(text("summary.json")) as SettlementSummary)
      : null;
    // Legacy evidence dirs carry no state field; derive it from the artifacts they do carry.
    state = settlement ? "SETTLED" : result ? "CLEARED" : frozen ? "SEALED-WAIT" : "OPEN";
  }
  return { dir: root, signer, legacy, state, manifestPacket, manifest, manifest_hash, frozen, opened, beacon, result, resultBytes, receipts, envelopes, witnessSet, witnessCerts, settlement };
}

// Gate R targets post-freeze dirs: verify keeps requiring frozen and result (R21 item 5).
export function loadCompletePublicAuction(dir: string, opts: { signer?: string } = {}): CompletePublicAuction {
  const pub = loadPublicAuction(dir, opts);
  requireThat(pub.frozen, "missing frozen");
  requireThat(pub.result, "missing result");
  return pub as CompletePublicAuction;
}

// The published drand beacon (R16) is a public input; bind it to the signed manifest before any use.
function readBeacon(raw: unknown, manifest: Manifest): Beacon | null {
  if (raw === null || raw === undefined) return null;
  const b = raw as Beacon;
  requireThat(
    b && typeof b.round === "number" && /^[0-9a-f]{96}$/.test(String(b.signature)) && /^[0-9a-f]{64}$/.test(String(b.chain_hash)),
    "beacon",
  );
  requireThat(b.round === manifest.drand.R && b.chain_hash === manifest.drand.chain_hash, "beacon binding");
  return b;
}

const settlementKeys = ["auction_id", "party", "txid", "pool", "output_index", "amount_zats"].sort().join(",");

function obligations(result: PublicResult, buyback: boolean): Map<string, string> {
  const map = new Map<string, string>();
  // Mode B refunds every leaf exact C and pays winners from the treasury leg; one obligation per leaf, no seller row.
  for (const a of result.allocations) {
    const owed = buyback ? BigInt(a.refund_zats) + BigInt(a.payment_zats) : BigInt(a.refund_zats);
    if (owed > 0n) map.set(`leaf:${a.leaf_index}`, owed.toString());
  }
  if (!buyback && BigInt(result.conservation.payout_zats) > 0n) map.set("seller", result.conservation.payout_zats);
  return map;
}

export function checkPublicAuction(pub: PublicAuction): Check[] {
  const checks: Check[] = [];
  const run = (id: string, fn: () => void) => {
    try { fn(); checks.push({ id }); }
    catch (e) { checks.push({ id, error: (e as Error).message }); }
  };
  // Canonical dirs carry byte-identical manifest.json, frozen.json and result.json projections (schema description).
  // A projection for a field the document does not carry is refused as loudly as a differing one.
  const projection = (name: string, value: unknown): void => {
    if (pub.legacy) return;
    const p = path.join(pub.dir, name);
    if (value === null || value === undefined) {
      requireThat(!existsSync(p), `${name} projection without document field`);
      return;
    }
    if (existsSync(p)) requireThat(jsonBytes(value).equals(readFileSync(p)), `${name} projection differs`);
  };
  // Checks apply to the fields the current state carries (R21 item 5): manifest always, freeze/receipts
  // once frozen, clear/accounting once result. A pre-freeze dir is valid when its manifest is.
  run("manifest", () => {
    const again = readClient(pub.manifestPacket, pub.signer);
    requireThat(again.manifest_hash === pub.manifest_hash, "manifest hash changed");
    if (pub.result) requireThat(pub.result.auction_id === pub.manifest.auction_id && pub.result.manifest_hash === pub.manifest_hash, "result manifest binding");
    projection("manifest.json", pub.manifestPacket);
  });
  run("freeze", () => {
    const frozen = pub.frozen;
    if (!frozen) return projection("frozen.json", null);
    checkFrozen(frozen, pub.manifest.auction_id, pub.manifest_hash);
    requireThat(frozen.published_at < pub.manifest.T_freeze, "freeze published too late");
    requireThat(frozen.published_at < releaseTime(pub.manifest), "freeze published after release");
    for (const [i, l] of frozen.leaves.entries()) {
      requireThat(l.leaf_index === i, `leaf order ${i}`);
      requireThat(
        member(l.ciphertext_hash, l.deposit, i, frozen.leaf_count, frozen.paths[i] ?? [], frozen.root),
        `witness ${i}`,
      );
    }
    if (pub.result) requireThat(frozen.root === pub.result.freeze_root, "result freeze root");
    projection("frozen.json", frozen);
  });
  // Gate X: the frozen root must carry a q_w-of-n_w witness certificate over the released statement, and one root
  // per auction — two certificates for different roots are refused (threat #5, #6). The set is a signed side-packet
  // from the manifest signer (the same --signer anchor).
  run("witness", () => {
    const frozen = pub.frozen;
    if (!frozen) {
      requireThat(pub.witnessCerts.length === 0 && pub.witnessSet === null, "witness material without frozen root");
      return projection("witness.json", null);
    }
    requireThat(pub.witnessSet, "missing witness set");
    const set = verifyRecord<WitnessSet>(pub.witnessSet!, pub.signer);
    checkCertificates(pub.witnessCerts, validateWitnessSet(set, pub.manifest.auction_id), freezeStatement(pub.manifest, frozen));
    projection("witness-set.json", pub.witnessSet);
    projection("witness.json", pub.witnessCerts);
  });
  run("receipts", () => {
    if (!pub.frozen) return;
    for (const [i, packet] of pub.receipts.entries()) {
      requireThat(receiptMember(packet, pub.frozen, pub.signer), `receipt ${i} not a member`);
    }
  });
  run("clear", () => {
    const result = pub.result, resultBytes = pub.resultBytes;
    if (!result || !resultBytes) return projection("result.json", null);
    requireThat(pub.frozen, "missing frozen");
    const fresh = isBuyback(pub.manifest)
      ? clearModeB({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen!, opened: pub.opened })
      : clear({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen!, opened: pub.opened });
    requireThat(jsonBytes(fresh).equals(resultBytes), "canonical result differs");
    projection("result.json", result);
  });
  // Gate W: published envelope records verify against the owner pubkey inside each opening, and the opening's
  // salted settlement commitment binds the same envelope ciphertext (threat #7, #32). Dirs without records are pre-W.
  run("envelope", () => {
    const records = pub.envelopes;
    if (!records.length) return projection("envelope.json", null);
    const frozen = pub.frozen;
    requireThat(frozen, "missing frozen");
    const byLeaf = new Map<number, EnvelopeRecord>();
    for (const rec of records) {
      requireThat(rec && typeof rec === "object" && Object.keys(rec).sort().join(",") === "ciphertext_hash,envelope_ct,owner_sig", "envelope record shape");
      const leaf = frozen!.leaves.find(l => l.ciphertext_hash === rec.ciphertext_hash);
      requireThat(leaf, "envelope for unknown ciphertext");
      requireThat(!byLeaf.has(leaf!.leaf_index), `duplicate envelope ${leaf!.leaf_index}`);
      byLeaf.set(leaf!.leaf_index, rec);
    }
    for (const l of frozen!.leaves) requireThat(byLeaf.has(l.leaf_index), `missing envelope ${l.leaf_index}`);
    if (pub.opened.length) {
      for (const [i, rec] of byLeaf) {
        const opening = pub.opened.find(o => o.leaf_index === i);
        requireThat(opening && /^[0-9a-f]{256}$/.test(opening!.plaintext_hex ?? ""), `opening ${i} for envelope`);
        const pt = Buffer.from(opening!.plaintext_hex!, "hex");
        requireThat(verifyEnvelope(pt.subarray(61, 93).toString("hex"), pub.manifest.auction_id, rec.ciphertext_hash, rec.envelope_ct, rec.owner_sig), `envelope ${i} signature`);
        requireThat(pt.subarray(93, 125).toString("hex") === settlementCommitment(pt.subarray(45, 61).toString("hex"), rec.envelope_ct), `envelope ${i} commitment`);
      }
    }
    projection("envelope.json", records);
  });
  // R20c: result obligations and stray-deposit obligations (T1) are checked in separate passes, so one
  // class can never mask the other. Strays never gate the result checks and vice versa.
  run("accounting", () => {
    const result = pub.result;
    if (!result) return;
    const c = result.conservation;
    requireThat(
      BigInt(c.input_zats) === BigInt(c.payout_zats) + BigInt(c.refund_zats) + BigInt(c.fees_zats),
      "conservation",
    );
    const fee = BigInt(pub.manifest.fee_zats), C = BigInt(pub.manifest.C_zats), price = BigInt(result.clearing_price_zats);
    for (const a of result.allocations) {
      if (isBuyback(pub.manifest)) {
        // Mode B: the refund is exact C and the treasury payment is the uniform price net of the fee taken from it.
        const gross = price * BigInt(a.fill), feeShare = a.fill ? (fee < gross ? fee : gross) : 0n;
        requireThat(BigInt(a.refund_zats) === C, `allocation ${a.leaf_index} refund is not exact C`);
        requireThat(BigInt(a.payment_zats) + feeShare === gross, `allocation ${a.leaf_index} payment`);
      } else {
        requireThat(BigInt(a.payment_zats) + BigInt(a.refund_zats) + fee === C, `allocation ${a.leaf_index} does not account C`);
      }
    }
    if (!pub.settlement) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    for (const [i, r] of receipts.entries()) {
      requireThat(Object.keys(r).sort().join(",") === settlementKeys, `settlement receipt ${i} shape`);
    }
    const expected = obligations(result, isBuyback(pub.manifest));
    for (const [party, amount] of expected) {
      const rs = receipts.filter(r => r.party === party);
      requireThat(rs.length > 0, `settlement missing obligation ${party}`);
      requireThat(rs.length === 1, `duplicate settlement ${party}`);
      requireThat(rs[0].amount_zats === amount, `settlement ${party} amount`);
    }
    for (const row of rows) {
      if (!expected.has(row.party)) continue;
      requireThat(row.amount_zats === expected.get(row.party), `row ${row.party} amount`);
      requireThat(receipts.some(r => r.party === row.party && r.amount_zats === row.amount_zats), `row ${row.party} without receipt`);
    }
  });
  run("accounting-strays", () => {
    if (!pub.settlement || !pub.result) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    const expected = obligations(pub.result, isBuyback(pub.manifest));
    const stray = (party: string): void => {
      requireThat(/^deposit:[0-9a-f]{64}:.+$/.test(party), `party ${party} is neither a result obligation nor a stray deposit`);
    };
    // T1: each stray note ends refunded at its received value, or as an explicit exception row. Nothing is silently stranded.
    for (const r of receipts) {
      if (expected.has(r.party)) continue;
      stray(r.party);
      const row = rows.find(x => x.party === r.party);
      requireThat(row, `stray receipt ${r.party} without row`);
      requireThat(row!.amount_zats === r.amount_zats, `stray ${r.party} amount`);
    }
    for (const row of rows) {
      if (expected.has(row.party)) continue;
      stray(row.party);
      const rs = receipts.filter(r => r.party === row.party);
      if (row.state === "exception") requireThat(rs.length === 0, `stray ${row.party} exception row with receipt`);
      else {
        requireThat(rs.length > 0, `stray ${row.party} not refunded or exception`);
        requireThat(rs.length === 1, `duplicate stray ${row.party}`);
        requireThat(rs[0].amount_zats === row.amount_zats, `stray ${row.party} amount`);
      }
    }
  });
  return checks;
}

function releaseTime(m: Manifest): number {
  return m.drand.genesis + (m.drand.R - 1) * m.drand.period;
}

export function operatorView(pub: PublicAuction): {
  auction_id: string; C_zats: string; count: number; total_collateral_zats: string;
  blobs: { leaf_index: number; ciphertext_hash: string; ciphertext_hex: string }[];
} {
  // Pre-freeze there is no frozen set to take blobs from; counts track admitted receipts instead (R21 item 5).
  const leaves = pub.frozen?.leaves ?? [];
  const count = pub.frozen ? pub.frozen.leaf_count : pub.receipts.length;
  return {
    auction_id: pub.manifest.auction_id,
    C_zats: pub.manifest.C_zats,
    count,
    total_collateral_zats: (BigInt(pub.manifest.C_zats) * BigInt(count)).toString(),
    blobs: leaves.map(l => ({
      leaf_index: l.leaf_index,
      ciphertext_hash: l.ciphertext_hash,
      ciphertext_hex: l.ciphertext_hex,
    })),
  };
}

export function freezeBoard(pub: PublicAuction): {
  auction_id: string; manifest_hash: string; frozen: boolean; root: string | null; leaf_count: number;
  cutoff: number | null; published_at: number | null;
  leaves: { leaf_index: number; ciphertext_hash: string }[];
  paths: { side: string; hash: string }[][];
} {
  const frozen = pub.frozen;
  if (!frozen) return {
    auction_id: pub.manifest.auction_id, manifest_hash: pub.manifest_hash, frozen: false,
    root: null, leaf_count: 0, cutoff: null, published_at: null, leaves: [], paths: [],
  };
  return {
    auction_id: frozen.auction_id,
    manifest_hash: frozen.manifest_hash,
    frozen: true,
    root: frozen.root,
    leaf_count: frozen.leaf_count,
    cutoff: frozen.cutoff,
    published_at: frozen.published_at,
    leaves: frozen.leaves.map(l => ({ leaf_index: l.leaf_index, ciphertext_hash: l.ciphertext_hash })),
    paths: frozen.paths,
  };
}

export function receiptShow(pub: PublicAuction, ciphertextHash: string, packet?: Signed): {
  inclusion: Record<string, unknown>;
  settlement: SettlementReceipt | null;
} {
  requireThat(pub.frozen, "missing frozen");
  const frozen = pub.frozen as Frozen;
  requireThat(/^[0-9a-f]{64}$/.test(ciphertextHash), "ciphertext hash");
  const leaf = frozen.leaves.find(l => l.ciphertext_hash === ciphertextHash);
  requireThat(leaf, "ciphertext not in frozen set");
  let signed: Record<string, unknown> | null = null;
  if (packet) {
    signed = verifyRecord<Record<string, unknown>>(packet, pub.signer);
    requireThat(signed.ciphertext_hash === ciphertextHash, "receipt ciphertext hash");
    requireThat(signed.leaf_index === leaf!.leaf_index, "receipt leaf index");
  }
  const included = member(leaf!.ciphertext_hash, leaf!.deposit, leaf!.leaf_index, frozen.leaf_count, frozen.paths[leaf!.leaf_index] ?? [], frozen.root);
  const inclusion: Record<string, unknown> = {
    auction_id: leaf!.auction_id,
    manifest_hash: leaf!.manifest_hash,
    ciphertext_hash: leaf!.ciphertext_hash,
    deposit: leaf!.deposit,
    leaf_index: leaf!.leaf_index,
    included,
    receipt_signed: Boolean(packet),
  };
  const party = `leaf:${leaf!.leaf_index}`;
  const settlement = pub.settlement?.receipts?.find(r => r.party === party) ?? null;
  return { inclusion, settlement };
}

export function resultHash(pub: PublicAuction): string | null {
  return pub.resultBytes ? hash(pub.resultBytes) : null;
}
