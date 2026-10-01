// Public auction directory model shared by `benzo verify`, operator view, receipt show and the read-only API.
// Reads only public files; never loads BNZ_STATE_DIR secrets or bid-side keys.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { client, hash, jsonBytes, requireThat, verifyRecord, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen, member, receiptMember, type Frozen } from "../clear/merkle";
import { clear, type Opened } from "../clear/core";

export type SettlementReceipt = { auction_id: string; party: string; txid: string; pool: string; output_index: number; amount_zats: string };
export type Beacon = { round: number; signature: string; chain_hash: string };
export type SettlementSummary = {
  auction_id?: string;
  rows?: { party: string; amount_zats: string; state?: string }[];
  receipts?: SettlementReceipt[];
};
export type PublicAuction = {
  dir: string;
  signer: string;
  legacy: boolean;
  manifestPacket: Signed;
  manifest: Manifest;
  manifest_hash: string;
  frozen: Frozen;
  opened: Opened[];
  beacon: Beacon | null;
  result: {
    auction_id: string; manifest_hash: string; freeze_root: string; mode: string;
    clearing_price_zats: string;
    allocations: { leaf_index: number; price_zats: string | null; quantity: number; fill: number; payment_zats: string; refund_zats: string; outcome: string }[];
    conservation: { input_zats: string; payout_zats: string; refund_zats: string; fees_zats: string };
  };
  resultBytes: Buffer;
  receipts: Signed[];
  settlement: SettlementSummary | null;
};
export type Check = { id: string; error?: string };

// Canonical document keys, per schemas/public-auction.schema.json (additionalProperties: false).
const canonicalKeys = new Set(["version", "auction_id", "signer", "manifest", "state", "receipts", "frozen", "result", "settlement", "opened", "beacon"]);
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
  let signer: string, manifestPacket: Signed, manifest: Manifest, manifest_hash: string;
  let frozen: Frozen, opened: Opened[], beacon: Beacon | null;
  let resultBytes: Buffer, result: PublicAuction["result"], receipts: Signed[], settlement: SettlementSummary | null;
  if (!legacy) {
    // Canonical auction.json is the public document (R20/Q13); the per-file projections are not a source here.
    const doc = JSON.parse(text("auction.json"));
    requireThat(doc && typeof doc === "object" && !Array.isArray(doc), "auction.json");
    requireThat(Object.keys(doc).every(k => canonicalKeys.has(k)) && doc.version === 1, "auction.json schema");
    requireThat(/^[0-9a-f]{64}$/.test(String(doc.auction_id)), "auction id");
    requireThat(typeof doc.state === "string" && states.has(doc.state), "state");
    signer = anchor(String(doc.signer));
    manifestPacket = doc.manifest as Signed;
    ({ manifest, manifest_hash } = client(manifestPacket, signer));
    requireThat(doc.auction_id === manifest.auction_id, "auction id binding");
    requireThat(Array.isArray(doc.receipts), "receipts");
    frozen = doc.frozen as Frozen;
    result = doc.result as PublicAuction["result"];
    requireThat(frozen && typeof frozen === "object", "missing frozen");
    requireThat(result && typeof result === "object", "missing result");
    if (openedStates.has(doc.state)) requireThat(Array.isArray(doc.opened) && doc.beacon, "opened/beacon required from OPENED");
    opened = Array.isArray(doc.opened) ? (doc.opened as Opened[]) : [];
    beacon = readBeacon(doc.beacon ?? null, manifest);
    resultBytes = jsonBytes(doc.result);
    receipts = doc.receipts as Signed[];
    settlement = (doc.settlement ?? null) as SettlementSummary | null;
  } else {
    // Legacy projections (signer.json, opened.json, summary.json, ...) — fallback only for the Phase 2/3 evidence dirs.
    signer = anchor(String(JSON.parse(text("signer.json")).signer));
    manifestPacket = JSON.parse(text("manifest.json")) as Signed;
    ({ manifest, manifest_hash } = client(manifestPacket, signer));
    frozen = JSON.parse(text("frozen.json")) as Frozen;
    opened = existsSync(path.join(root, "opened.json"))
      ? (JSON.parse(text("opened.json")) as Opened[])
      : [];
    beacon = readBeacon(
      existsSync(path.join(root, "beacon.json")) ? JSON.parse(text("beacon.json")) : null,
      manifest,
    );
    resultBytes = file("result.json");
    result = JSON.parse(resultBytes.toString("utf8")) as PublicAuction["result"];
    receipts = existsSync(path.join(root, "receipts.json"))
      ? (JSON.parse(text("receipts.json")) as Signed[])
      : [];
    settlement = existsSync(path.join(root, "summary.json"))
      ? (JSON.parse(text("summary.json")) as SettlementSummary)
      : null;
  }
  return { dir: root, signer, legacy, manifestPacket, manifest, manifest_hash, frozen, opened, beacon, result, resultBytes, receipts, settlement };
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

function obligations(result: PublicAuction["result"]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of result.allocations) if (BigInt(a.refund_zats) > 0n) map.set(`leaf:${a.leaf_index}`, a.refund_zats);
  if (BigInt(result.conservation.payout_zats) > 0n) map.set("seller", result.conservation.payout_zats);
  return map;
}

export function checkPublicAuction(pub: PublicAuction): Check[] {
  const checks: Check[] = [];
  const run = (id: string, fn: () => void) => {
    try { fn(); checks.push({ id }); }
    catch (e) { checks.push({ id, error: (e as Error).message }); }
  };
  // Canonical dirs carry byte-identical manifest.json, frozen.json and result.json projections (schema description).
  const projection = (name: string, value: unknown): void => {
    if (pub.legacy) return;
    const p = path.join(pub.dir, name);
    if (existsSync(p)) requireThat(jsonBytes(value).equals(readFileSync(p)), `${name} projection differs`);
  };
  run("manifest", () => {
    const again = client(pub.manifestPacket, pub.signer);
    requireThat(again.manifest_hash === pub.manifest_hash, "manifest hash changed");
    requireThat(pub.result.auction_id === pub.manifest.auction_id && pub.result.manifest_hash === pub.manifest_hash, "result manifest binding");
    projection("manifest.json", pub.manifestPacket);
  });
  run("freeze", () => {
    checkFrozen(pub.frozen, pub.manifest.auction_id, pub.manifest_hash);
    requireThat(pub.frozen.published_at < pub.manifest.T_freeze, "freeze published too late");
    requireThat(pub.frozen.published_at < releaseTime(pub.manifest), "freeze published after release");
    for (const [i, l] of pub.frozen.leaves.entries()) {
      requireThat(l.leaf_index === i, `leaf order ${i}`);
      requireThat(
        member(l.ciphertext_hash, l.deposit, i, pub.frozen.leaf_count, pub.frozen.paths[i] ?? [], pub.frozen.root),
        `witness ${i}`,
      );
    }
    requireThat(pub.frozen.root === pub.result.freeze_root, "result freeze root");
    projection("frozen.json", pub.frozen);
  });
  run("receipts", () => {
    for (const [i, packet] of pub.receipts.entries()) {
      requireThat(receiptMember(packet, pub.frozen, pub.signer), `receipt ${i} not a member`);
    }
  });
  run("clear", () => {
    const fresh = clear({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen, opened: pub.opened });
    requireThat(jsonBytes(fresh).equals(pub.resultBytes), "canonical result differs");
    projection("result.json", pub.result);
  });
  // R20c: result obligations and stray-deposit obligations (T1) are checked in separate passes, so one
  // class can never mask the other. Strays never gate the result checks and vice versa.
  run("accounting", () => {
    const c = pub.result.conservation;
    requireThat(
      BigInt(c.input_zats) === BigInt(c.payout_zats) + BigInt(c.refund_zats) + BigInt(c.fees_zats),
      "conservation",
    );
    const fee = BigInt(pub.manifest.fee_zats), C = BigInt(pub.manifest.C_zats);
    for (const a of pub.result.allocations) {
      requireThat(BigInt(a.payment_zats) + BigInt(a.refund_zats) + fee === C, `allocation ${a.leaf_index} does not account C`);
    }
    if (!pub.settlement) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    for (const [i, r] of receipts.entries()) {
      requireThat(Object.keys(r).sort().join(",") === settlementKeys, `settlement receipt ${i} shape`);
    }
    const expected = obligations(pub.result);
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
    if (!pub.settlement) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    const expected = obligations(pub.result);
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
  return {
    auction_id: pub.manifest.auction_id,
    C_zats: pub.manifest.C_zats,
    count: pub.frozen.leaf_count,
    total_collateral_zats: (BigInt(pub.manifest.C_zats) * BigInt(pub.frozen.leaf_count)).toString(),
    blobs: pub.frozen.leaves.map(l => ({
      leaf_index: l.leaf_index,
      ciphertext_hash: l.ciphertext_hash,
      ciphertext_hex: l.ciphertext_hex,
    })),
  };
}

export function freezeBoard(pub: PublicAuction): {
  auction_id: string; manifest_hash: string; root: string; leaf_count: number;
  cutoff: number; published_at: number;
  leaves: { leaf_index: number; ciphertext_hash: string }[];
  paths: { side: string; hash: string }[][];
} {
  return {
    auction_id: pub.frozen.auction_id,
    manifest_hash: pub.frozen.manifest_hash,
    root: pub.frozen.root,
    leaf_count: pub.frozen.leaf_count,
    cutoff: pub.frozen.cutoff,
    published_at: pub.frozen.published_at,
    leaves: pub.frozen.leaves.map(l => ({ leaf_index: l.leaf_index, ciphertext_hash: l.ciphertext_hash })),
    paths: pub.frozen.paths,
  };
}

export function receiptShow(pub: PublicAuction, ciphertextHash: string, packet?: Signed): {
  inclusion: Record<string, unknown>;
  settlement: SettlementReceipt | null;
} {
  requireThat(/^[0-9a-f]{64}$/.test(ciphertextHash), "ciphertext hash");
  const leaf = pub.frozen.leaves.find(l => l.ciphertext_hash === ciphertextHash);
  requireThat(leaf, "ciphertext not in frozen set");
  let signed: Record<string, unknown> | null = null;
  if (packet) {
    signed = verifyRecord<Record<string, unknown>>(packet, pub.signer);
    requireThat(signed.ciphertext_hash === ciphertextHash, "receipt ciphertext hash");
    requireThat(signed.leaf_index === leaf!.leaf_index, "receipt leaf index");
  }
  const included = member(leaf!.ciphertext_hash, leaf!.deposit, leaf!.leaf_index, pub.frozen.leaf_count, pub.frozen.paths[leaf!.leaf_index] ?? [], pub.frozen.root);
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

export function resultHash(pub: PublicAuction): string {
  return hash(pub.resultBytes);
}
