// Public auction directory model shared by `benzo verify`, operator view, receipt show and the read-only API.
// Reads only public files; never loads BNZ_STATE_DIR secrets or bid-side keys.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, requireThat, verifyRecord, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen, member, receiptMember, type Deposit, type Frozen, type Path } from "../clear/merkle";
import { type ClearBody, type Opened } from "../clear/core";
import { clientForMode, clearForMode, modeEntry } from "../clear/registry";
import { settlementCommitment, verifyEnvelope, verifyStatement } from "../envelope/index";
import { checkCertificates, freezeStatement, validateWitnessSet, witnessSetHash, type WitnessCert, type WitnessSet } from "../witness";

// Gate EN: manifest validation and clearing dispatch through the mode registry (one code path per mode).
// The witness set rides in a separate signed packet, not in the manifest.
function readClient(packet: Signed, signer: string): { manifest_hash: string; manifest: Manifest } {
  return clientForMode(packet, signer) as { manifest_hash: string; manifest: Manifest };
}
export type EnvelopeRecord = { ciphertext_hash: string; envelope_ct: string; owner_sig: string };

export type SettlementReceipt = { auction_id: string; party: string; txid: string; pool: string; output_index: number; amount_zats: string };
export type Beacon = { round: number; signature: string; chain_hash: string };
export type SettlementSummary = {
  auction_id?: string;
  rows?: { party: string; amount_zats: string; state?: string }[];
  receipts?: SettlementReceipt[];
  // Gate CF bond-then-pay: winner leaves that missed the balance window (forfeit to the seller net of fees).
  defaults?: number[];
};
export type PublicResult = {
  auction_id: string; manifest_hash: string; freeze_root: string; mode: string;
  clearing_price_zats: string;
  allocations: {
    leaf_index: number; price_zats: string | null; quantity: number; fill: number; payment_zats: string; refund_zats: string; outcome: string;
    lot?: string; balance_due_zats?: string;
  }[];
  conservation: { input_zats: string; payout_zats: string; refund_zats: string; fees_zats: string; treasury_zats?: string; balances_zats?: string };
  lots?: { lot_id: string; clearing_price_zats: string }[];
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
  // Gate CF: the published opening of the manifest's tlock-sealed price bound (plaintext hex), present iff the
  // manifest carries `sealed_reserve`; benzo verify re-derives it with tle like the bid openings.
  reserveOpening: string | null;
};
export type CompletePublicAuction = PublicAuction & { frozen: Frozen; result: PublicResult; resultBytes: Buffer };
export type Check = { id: string; error?: string; warn?: string };

// Canonical document keys, per schemas/public-auction.schema.json (additionalProperties: false).
const canonicalKeys = new Set(["version", "auction_id", "signer", "manifest", "state", "receipts", "frozen", "result", "settlement", "opened", "beacon", "envelopes", "witness_set", "witness_cert", "reserve_opening"]);
const states = new Set(["DRAFT", "OPEN", "SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "SETTLED", "CANCELLED", "REFUNDING"]);
// The schema requires opened + beacon once the state reaches OPENED.
const openedStates = new Set(["OPENED", "CLEARED", "SETTLED"]);
const frozenStates = new Set(["SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "SETTLED"]);
const resultStates = new Set(["CLEARED", "SETTLING", "SETTLED"]);

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
  let resultBytes: Buffer | null, result: PublicResult | null, receipts: Signed[], envelopes: EnvelopeRecord[], witnessSet: Signed | null, witnessCerts: WitnessCert[], settlement: SettlementSummary | null, reserveOpening: string | null;
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
    // A state past freeze/clear must carry what it claims, or readers would report a stripped document as valid.
    requireThat(!frozenStates.has(doc.state) || frozen, `state ${doc.state} requires frozen`);
    requireThat(!resultStates.has(doc.state) || result, `state ${doc.state} requires result`);
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
    requireThat(doc.reserve_opening === undefined || (doc.reserve_opening && typeof doc.reserve_opening === "object" &&
      Object.keys(doc.reserve_opening).sort().join(",") === "plaintext_hex" && typeof doc.reserve_opening.plaintext_hex === "string"), "reserve_opening");
    reserveOpening = doc.reserve_opening ? (doc.reserve_opening as { plaintext_hex: string }).plaintext_hex : null;
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
    reserveOpening = existsSync(path.join(root, "reserve.json"))
      ? String((JSON.parse(text("reserve.json")) as { plaintext_hex?: unknown }).plaintext_hex ?? "")
      : null;
  }
  return { dir: root, signer, legacy, state, manifestPacket, manifest, manifest_hash, frozen, opened, beacon, result, resultBytes, receipts, envelopes, witnessSet, witnessCerts, settlement, reserveOpening };
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

export function checkPublicAuction(pub: PublicAuction): Check[] {
  const checks: Check[] = [];
  const run = (id: string, fn: () => string | void) => {
    try {
      const warn = fn();
      checks.push(warn ? { id, warn } : { id });
    } catch (e) {
      checks.push({ id, error: (e as Error).message });
    }
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
  // from the manifest signer (the same --signer anchor). R4 item 2: when the signed manifest carries
  // `witness_set_hash`, the side-packet must hash exactly to it (a removed or substituted set is refused) and a
  // valid certificate is required; manifests without the field are pre-Phase-5 — warn and continue.
  run("witness", () => {
    const frozen = pub.frozen;
    if (!frozen) {
      requireThat(pub.witnessCerts.length === 0 && pub.witnessSet === null, "witness material without frozen root");
      return projection("witness.json", null);
    }
    const bound = pub.manifest.witness_set_hash;
    if (!bound) return "no witness set (pre-Phase-5 manifest)";
    requireThat(pub.witnessSet, "missing witness set");
    const set = verifyRecord<WitnessSet>(pub.witnessSet!, pub.signer);
    requireThat(witnessSetHash(pub.witnessSet!) === bound, "witness set hash mismatch");
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
    const fresh = clearForMode({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen!, opened: pub.opened, reserve_opening: pub.reserveOpening });
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
    // Bond-then-pay adds incoming winner balances to the deposits; without bond balances_zats is absent (= 0).
    requireThat(
      BigInt(c.input_zats) + BigInt(c.balances_zats ?? "0") === BigInt(c.payout_zats) + BigInt(c.refund_zats) + BigInt(c.fees_zats),
      "conservation",
    );
    // Per-mode money rules live with the mode (checkResultModeA / checkResultBuyback) and are reached through the
    // registry — Mode B adds treasury_zats = payout + fees and the budget/fill/ask invariants (R4 item 3).
    modeEntry(pub.manifestPacket).checkResult(pub.manifest, result as ClearBody);
    if (!pub.settlement) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    for (const [i, r] of receipts.entries()) {
      requireThat(Object.keys(r).sort().join(",") === settlementKeys, `settlement receipt ${i} shape`);
    }
    // Settlement obligations per mode live with the mode (obligationsModeA / obligationsModeB) via the registry;
    // gate CF bond-then-pay accounts balances and forfeits from the settlement's `defaults` list.
    const expected = modeEntry(pub.manifestPacket).obligations(result as ClearBody, pub.settlement);
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
    const expected = modeEntry(pub.manifestPacket).obligations(pub.result as ClearBody, pub.settlement);
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

// R3 item 6: the inclusion proof is a self-contained bundle — root, path, leaf — so anyone can recheck it offline.
export type InclusionProof = {
  auction_id: string; manifest_hash: string; root: string; leaf_count: number; leaf_index: number;
  ciphertext_hash: string; deposit: Deposit; path: Path; included: boolean;
};
export function inclusionProof(pub: PublicAuction, ciphertextHash: string): InclusionProof {
  requireThat(pub.frozen, "missing frozen");
  const frozen = pub.frozen as Frozen;
  requireThat(/^[0-9a-f]{64}$/.test(ciphertextHash), "ciphertext hash");
  const leaf = frozen.leaves.find(l => l.ciphertext_hash === ciphertextHash);
  requireThat(leaf, "ciphertext not in frozen set");
  const path = frozen.paths[leaf!.leaf_index] ?? [];
  return {
    auction_id: frozen.auction_id, manifest_hash: frozen.manifest_hash, root: frozen.root,
    leaf_count: frozen.leaf_count, leaf_index: leaf!.leaf_index, ciphertext_hash: leaf!.ciphertext_hash,
    deposit: leaf!.deposit, path,
    included: member(leaf!.ciphertext_hash, leaf!.deposit, leaf!.leaf_index, frozen.leaf_count, path, frozen.root),
  };
}
export function checkInclusionProof(proof: InclusionProof): boolean {
  return member(proof.ciphertext_hash, proof.deposit, proof.leaf_index, proof.leaf_count, proof.path, proof.root);
}

// R3 item 7: owner-key-signed settlement statement (auction, leaf, fill, price, payout/refund txid), checkable
// against result.json and the chain. payout_txid is set only when the mode owes this leaf a payment (via the
// registry's obligations); both txids name the leaf's settlement receipt and stay null until settlement.
export type SettlementStatement = {
  version: 1; auction_id: string; ciphertext_hash: string; leaf_index: number; fill: number;
  price_zats: string | null; clearing_price_zats: string; payment_zats: string; refund_zats: string;
  // Gate CF: the winner's unpaid balance is due within its window (bond-then-pay); "0" without bond.
  balance_due_zats: string;
  payout_txid: string | null; refund_txid: string | null; owner_pubkey: string; signature: string;
};
export type StatementBody = Omit<SettlementStatement, "signature">;
const statementFields = "auction_id,balance_due_zats,ciphertext_hash,clearing_price_zats,fill,leaf_index,owner_pubkey,payment_zats,payout_txid,price_zats,refund_txid,refund_zats,signature,version";
export function settlementStatementBody(pub: PublicAuction, ciphertextHash: string): StatementBody {
  requireThat(pub.frozen && pub.result, "missing frozen or result");
  const frozen = pub.frozen as Frozen, result = pub.result as PublicResult;
  const leaf = frozen.leaves.find(l => l.ciphertext_hash === ciphertextHash);
  requireThat(leaf, "ciphertext not in frozen set");
  const a = result.allocations.find(x => x.leaf_index === leaf!.leaf_index);
  requireThat(a, "allocation missing");
  const opening = pub.opened.find(o => o.leaf_index === leaf!.leaf_index);
  requireThat(opening && /^[0-9a-f]{256}$/.test(opening!.plaintext_hex ?? ""), "opening for statement");
  const owner_pubkey = Buffer.from(opening!.plaintext_hex!, "hex").subarray(61, 93).toString("hex");
  const owed = BigInt(modeEntry(pub.manifestPacket).obligations(result as ClearBody, pub.settlement).get(`leaf:${leaf!.leaf_index}`) ?? "0");
  const receipt = (pub.settlement?.receipts ?? []).find(r => r.party === `leaf:${leaf!.leaf_index}`);
  const clearing_price_zats = a!.lot === undefined
    ? result.clearing_price_zats
    : (result.lots ?? []).find(l => l.lot_id === a!.lot)?.clearing_price_zats ?? result.clearing_price_zats;
  return {
    version: 1, auction_id: frozen.auction_id, ciphertext_hash: ciphertextHash, leaf_index: leaf!.leaf_index,
    fill: a!.fill, price_zats: a!.price_zats, clearing_price_zats,
    payment_zats: a!.payment_zats, refund_zats: a!.refund_zats,
    // Gate CF: the winner's unpaid balance is due within its window (bond-then-pay); "0" without bond.
    balance_due_zats: a!.balance_due_zats ?? "0",
    payout_txid: receipt && owed > BigInt(a!.refund_zats) ? receipt.txid : null,
    refund_txid: receipt ? receipt.txid : null,
    owner_pubkey,
  };
}
export function checkSettlementStatement(pub: PublicAuction, ciphertextHash: string, statement: SettlementStatement): void {
  requireThat(statement && typeof statement === "object" && !Array.isArray(statement), "statement shape");
  requireThat(Object.keys(statement).sort().join(",") === statementFields, "statement field set");
  requireThat(/^[0-9a-f]{128}$/.test(String(statement.signature)), "statement signature");
  const { signature, ...body } = statement;
  const wanted = settlementStatementBody(pub, ciphertextHash);
  requireThat(jsonBytes(body).equals(jsonBytes(wanted)), "statement differs from result/settlement");
  requireThat(verifyStatement(wanted.owner_pubkey, body, signature), "statement signature");
}

export function resultHash(pub: PublicAuction): string | null {
  return pub.resultBytes ? hash(pub.resultBytes) : null;
}
