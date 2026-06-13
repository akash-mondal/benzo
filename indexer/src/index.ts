/**
 * @benzo/indexer — self-hosted note-discovery indexer.
 *
 * Scans the pool's contract events from Soroban RPC, decodes the
 * NewCommitment / NewNullifier events, and maintains:
 *   - an ordered list of (leafIndex, commitment, ciphertext, mvkTag)
 *   - the set of spent nullifiers
 *   - an off-chain Merkle mirror for path construction
 *
 * It exposes a viewing-key scan API: given an X25519 viewing secret, return
 * the notes whose discovery ciphertext opens under it (trial decryption).
 * The indexer never sees plaintext — only opaque ciphertexts — exactly like
 * the Mercury/Zephyr design described in BENZO.md §4.5.
 *
 * This is a faithful, dependency-light reimplementation of that indexer role
 * (no Mercury API key required), suitable for testnet and local e2e.
 */

import { xdr, scValToNative } from "@stellar/stellar-sdk";
import {
  MerkleTreeMirror,
  decodeNotePlain,
  noteCommitment,
  noteNullifier,
  open,
  type NotePlain,
} from "@benzo/sdk";

export interface CommitmentRecord {
  leafIndex: number;
  commitment: bigint;
  ciphertext: Uint8Array;
  mvkTag: bigint;
  ledger: number;
  txHash: string;
}

export interface MvkBindingRecord {
  tag: bigint;
  mvkCt: Uint8Array;
  ledger: number;
}

export interface DiscoveredNote {
  leafIndex: number;
  commitment: bigint;
  plain: NotePlain;
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function nativeToBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v);
  if (typeof v === "string") return hexToBytes(v);
  throw new Error("expected bytes-like event field");
}

function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  throw new Error(`cannot coerce ${typeof v} to bigint`);
}

export class BenzoIndexer {
  readonly commitments: CommitmentRecord[] = [];
  readonly nullifiers = new Set<string>();
  readonly mvkBindings: MvkBindingRecord[] = [];
  readonly tree: MerkleTreeMirror;
  cursorLedger: number;

  constructor(
    readonly treeLevels: number,
    startLedger: number,
  ) {
    this.tree = new MerkleTreeMirror(treeLevels);
    this.cursorLedger = startLedger;
  }

  /** Ingest one decoded RPC event. */
  ingest(ev: {
    ledger: number;
    txHash: string;
    topicXdr: string[];
    valueXdr: string;
  }): void {
    const topics = ev.topicXdr.map((t) =>
      scValToNative(xdr.ScVal.fromXDR(t, "base64")),
    );
    const value = scValToNative(xdr.ScVal.fromXDR(ev.valueXdr, "base64"));
    const eventName = topics[0];

    // soroban_sdk #[contractevent] uses the snake_case struct name as topic[0],
    // followed by the #[topic] fields; remaining fields go in the value map.
    if (eventName === "new_commitment_event") {
      const commitment = toBig(topics[topics.length - 1]);
      const v = value as Record<string, unknown>;
      const rec: CommitmentRecord = {
        leafIndex: Number(v.index),
        commitment,
        ciphertext: nativeToBytes(v.encrypted_output),
        mvkTag: toBig(v.mvk_tag),
        ledger: ev.ledger,
        txHash: ev.txHash,
      };
      this.commitments[rec.leafIndex] = rec;
      this.tree.insert(commitment);
    } else if (eventName === "new_nullifier_event") {
      const nullifier = toBig(topics[topics.length - 1]);
      this.nullifiers.add(nullifier.toString());
    } else if (eventName === "mvk_bound_event") {
      const tag = toBig(topics[topics.length - 1]);
      const v = value as Record<string, unknown>;
      this.mvkBindings.push({
        tag,
        mvkCt: nativeToBytes(v.mvk_ct),
        ledger: ev.ledger,
      });
    }
    this.cursorLedger = Math.max(this.cursorLedger, ev.ledger);
  }

  isSpent(nullifier: bigint): boolean {
    return this.nullifiers.has(nullifier.toString());
  }

  /** Pool-tree leaves in leaf-index order (for rebuilding a mirror). */
  orderedLeaves(): bigint[] {
    const out: bigint[] = [];
    for (let i = 0; i < this.commitments.length; i++) {
      const rec = this.commitments[i];
      if (!rec) throw new Error(`commitment leaf ${i} missing from events`);
      out.push(rec.commitment);
    }
    return out;
  }

  /**
   * Viewing-key scan: trial-decrypt every commitment's discovery ciphertext
   * with `viewingSecret`. A note is "discovered" iff (a) AEAD opens AND (b)
   * the decrypted fields recompute to the on-chain commitment (binding).
   */
  scan(viewingSecret: Uint8Array): DiscoveredNote[] {
    const out: DiscoveredNote[] = [];
    for (const rec of this.commitments) {
      if (!rec) continue;
      const opened = open(rec.ciphertext, viewingSecret);
      if (!opened) continue;
      let plain: NotePlain;
      try {
        plain = decodeNotePlain(opened);
      } catch {
        continue;
      }
      if (noteCommitment(plain) !== rec.commitment) continue; // binding check
      out.push({ leafIndex: rec.leafIndex, commitment: rec.commitment, plain });
    }
    return out;
  }

  /**
   * Spendable notes for a holder: discovered notes whose nullifier is not yet
   * spent. `spendSk` derives the per-leaf nullifier to filter.
   */
  spendable(viewingSecret: Uint8Array, spendSk: bigint): DiscoveredNote[] {
    return this.scan(viewingSecret).filter(
      (n) => !this.isSpent(noteNullifier(spendSk, BigInt(n.leafIndex))),
    );
  }

  /**
   * Auditor disclosure: decrypt the MVK-scope ciphertexts in `mvkBindings`
   * with a scoped TVK secret. Returns the reconstructed note plaintexts whose
   * binding tag/commitment is consistent — the passive selective-disclosure
   * path (§7.1/§7.2).
   */
  auditorScan(tvkSecret: Uint8Array): NotePlain[] {
    const out: NotePlain[] = [];
    for (const b of this.mvkBindings) {
      const opened = open(b.mvkCt, tvkSecret);
      if (!opened) continue;
      try {
        out.push(decodeNotePlain(opened));
      } catch {
        /* out of scope */
      }
    }
    return out;
  }
}

export interface RpcEvent {
  ledger: number;
  txHash: string;
  topic: string[];
  value: string;
}

interface EventsPage {
  events: RpcEvent[];
  cursor?: string;
  latestLedger: number;
}

/** Decode the ledger sequence embedded in a Soroban event cursor toid. */
function cursorLedger(cursor: string | undefined): number {
  if (!cursor) return 0;
  const toid = BigInt(cursor.split("-")[0]);
  return Number(toid >> 32n);
}

/**
 * Collect ALL contract events across the RPC retention window.
 *
 * Soroban getEvents scans only a bounded ledger window per `startLedger`
 * query and its oldest retained ledger advances over time. We start from the
 * oldest valid ledger (recovered from the range error) and then page forward
 * by cursor until the cursor reaches the latest ledger — so no event in the
 * window is missed regardless of how far back it sits.
 */
export async function collectEvents(
  rpcUrl: string,
  contractIds: string[],
  startLedger: number,
): Promise<RpcEvent[]> {
  const post = (params: Record<string, unknown>) =>
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getEvents", params }),
    }).then((r) => r.json() as Promise<{ result?: EventsPage; error?: { message: string } }>);

  const filters = [{ type: "contract", contractIds }];

  // First page (recover the oldest valid ledger on a range error).
  let json = await post({ startLedger, filters, pagination: { limit: 10000 } });
  for (let attempt = 0; attempt < 6 && json.error; attempt++) {
    const m = /(\d+)\s*-\s*(\d+)/.exec(json.error.message);
    if (!m) break;
    json = await post({ startLedger: Number(m[1]) + 16, filters, pagination: { limit: 10000 } });
  }
  if (json.error) throw new Error(`getEvents: ${json.error.message}`);

  const all: RpcEvent[] = [];
  let page = json.result!;
  const latest = page.latestLedger;
  all.push(...page.events);

  // Page forward by cursor until we reach the latest ledger.
  for (let guard = 0; guard < 64; guard++) {
    if (!page.cursor || cursorLedger(page.cursor) >= latest) break;
    const next = await post({ filters, pagination: { cursor: page.cursor, limit: 10000 } });
    if (next.error) break;
    page = next.result!;
    all.push(...page.events);
  }
  return all;
}

/**
 * Reconstruct the ordered allow-set leaves of an ASP membership tree from its
 * on-chain `LeafAdded` events. The ASP curator maintains its tree off-chain;
 * this lets any party rebuild the exact tree (and thus Merkle paths) that
 * fold to the published on-chain root.
 */
export async function fetchAspLeaves(
  rpcUrl: string,
  aspContractId: string,
  startLedger: number,
): Promise<bigint[]> {
  const events = await collectEvents(rpcUrl, [aspContractId], startLedger);
  const byIndex = new Map<number, bigint>();
  for (const ev of events) {
    const name = scValToNative(xdr.ScVal.fromXDR(ev.topic[0], "base64"));
    if (name !== "LeafAdded") continue;
    const v = scValToNative(xdr.ScVal.fromXDR(ev.value, "base64")) as Record<string, unknown>;
    byIndex.set(Number(v.index), toBig(v.leaf));
  }
  const max = byIndex.size === 0 ? -1 : Math.max(...byIndex.keys());
  const leaves: bigint[] = [];
  for (let i = 0; i <= max; i++) {
    const leaf = byIndex.get(i);
    if (leaf === undefined) throw new Error(`ASP leaf index ${i} missing from events`);
    leaves.push(leaf);
  }
  return leaves;
}

/** Pull events for the given contract ids from Soroban RPC into the indexer. */
export async function syncFromRpc(
  indexer: BenzoIndexer,
  rpcUrl: string,
  contractIds: string[],
  startLedger: number,
): Promise<number> {
  const events = await collectEvents(rpcUrl, contractIds, startLedger);
  for (const ev of events) {
    indexer.ingest({
      ledger: ev.ledger,
      txHash: ev.txHash,
      topicXdr: ev.topic,
      valueXdr: ev.value,
    });
  }
  return events.length;
}
