// Public auction directory model shared by `benzo verify`, operator view, receipt show and the read-only API.
// Reads only public files; never loads BNZ_STATE_DIR secrets or bid-side keys.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { client, hash, jsonBytes, requireThat, verifyRecord, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen, member, receiptMember, type Frozen } from "../clear/merkle";
import { clear, type Opened } from "../clear/core";

export type SettlementReceipt = { auction_id: string; party: string; txid: string; pool: string; output_index: number; amount_zats: string };
export type SettlementSummary = {
  auction_id?: string;
  rows?: { party: string; amount_zats: string }[];
  receipts?: SettlementReceipt[];
};
export type PublicAuction = {
  dir: string;
  signer: string;
  manifestPacket: Signed;
  manifest: Manifest;
  manifest_hash: string;
  frozen: Frozen;
  opened: Opened[];
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

export function loadPublicAuction(dir: string): PublicAuction {
  const root = path.resolve(dir);
  const file = (name: string): Buffer => {
    const p = path.join(root, name);
    requireThat(existsSync(p), `missing ${name}`);
    return readFileSync(p);
  };
  const text = (name: string) => file(name).toString("utf8");
  const signer = String(JSON.parse(text("signer.json")).signer);
  const manifestPacket = JSON.parse(text("manifest.json")) as Signed;
  const { manifest, manifest_hash } = client(manifestPacket, signer);
  const frozen = JSON.parse(text("frozen.json")) as Frozen;
  const opened = JSON.parse(text("opened.json")) as Opened[];
  const resultBytes = file("result.json");
  const result = JSON.parse(resultBytes.toString("utf8")) as PublicAuction["result"];
  const receipts = existsSync(path.join(root, "receipts.json"))
    ? (JSON.parse(text("receipts.json")) as Signed[])
    : [];
  const settlement = existsSync(path.join(root, "summary.json"))
    ? (JSON.parse(text("summary.json")) as SettlementSummary)
    : null;
  return { dir: root, signer, manifestPacket, manifest, manifest_hash, frozen, opened, result, resultBytes, receipts, settlement };
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
  run("manifest", () => {
    const again = client(pub.manifestPacket, pub.signer);
    requireThat(again.manifest_hash === pub.manifest_hash, "manifest hash changed");
    requireThat(pub.result.auction_id === pub.manifest.auction_id && pub.result.manifest_hash === pub.manifest_hash, "result manifest binding");
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
  });
  run("receipts", () => {
    for (const [i, packet] of pub.receipts.entries()) {
      requireThat(receiptMember(packet, pub.frozen, pub.signer), `receipt ${i} not a member`);
    }
  });
  run("clear", () => {
    const fresh = clear({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen, opened: pub.opened });
    requireThat(jsonBytes(fresh).equals(pub.resultBytes), "canonical result differs");
  });
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
    if (pub.settlement?.receipts) {
      for (const [i, r] of pub.settlement.receipts.entries()) {
        requireThat(Object.keys(r).sort().join(",") === settlementKeys, `settlement receipt ${i} shape`);
      }
      const expected = obligations(pub.result);
      const parties = pub.settlement.receipts.map(r => r.party);
      const resultBound = parties.every(p => expected.has(p));
      if (resultBound) {
        for (const r of pub.settlement.receipts) {
          requireThat(expected.get(r.party) === r.amount_zats, `settlement ${r.party} amount`);
          expected.delete(r.party);
        }
        requireThat(expected.size === 0, "settlement missing obligations");
      }
      const rows = pub.settlement.rows ?? [];
      for (const row of rows) {
        requireThat(pub.settlement.receipts!.some(r => r.party === row.party && r.amount_zats === row.amount_zats), `row ${row.party} without receipt`);
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
