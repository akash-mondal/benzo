/**
 * Private event log primitives.
 *
 * Product truth lives as encrypted append-only events. Public/auditable state is
 * a commitment over ciphertext + non-sensitive metadata, never plaintext business
 * facts. Roots can be anchored on-chain, and scoped audit packets can disclose a
 * chosen subset later.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type PrivateEventType =
  | "invoice.created"
  | "invoice.imported"
  | "invoice.paid"
  | "payment.submitted"
  | "payment.settled"
  | "payroll.computed"
  | "approval.recorded"
  | "grant.created"
  | "grant.revoked";

export interface PrivateEventInput<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  orgId: string;
  type: PrivateEventType;
  /** A non-sensitive id such as inv_123 or po_123. Avoid names/amounts/handles. */
  subjectId: string;
  /** Schema or policy version for future migrations and audit replay. */
  schema: string;
  /** Non-sensitive routing metadata only. No amounts, names, descriptions, handles. */
  publicMeta?: Record<string, string | number | boolean | null>;
  payload: TPayload;
  occurredAt?: string;
}

export interface PrivateEventEnvelope {
  id: string;
  orgId: string;
  type: PrivateEventType;
  subjectId: string;
  schema: string;
  occurredAt: string;
  publicMeta: Record<string, string | number | boolean | null>;
  ciphertext: string;
  iv: string;
  tag: string;
  aadHash: string;
  payloadHash: string;
  prevHash: string;
  hash: string;
}

export interface PrivateEventAnchor {
  orgId: string;
  eventCount: number;
  headHash: string;
  merkleRoot: string;
  anchoredAt: string;
  txHash?: string;
}

export interface AuditPacket {
  orgId: string;
  scope: {
    label: string;
    from?: string;
    to?: string;
    eventTypes?: PrivateEventType[];
    subjectIds?: string[];
  };
  anchor: PrivateEventAnchor;
  envelopes: PrivateEventEnvelope[];
  inclusionProofs: Array<{ eventHash: string; siblings: string[]; index: number }>;
  issuedAt: string;
}

export interface DecryptedPrivateEvent<TPayload = unknown> {
  envelope: PrivateEventEnvelope;
  payload: TPayload;
}

export const GENESIS_HASH = "GENESIS";
const SENSITIVE_PUBLIC_META_KEY = /(amount|balance|counterparty|description|email|handle|memo|name|rate|recipient|salary|tax)/i;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
}

export function stableJson(value: unknown): string {
  return stable(value);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function deriveEventKey(secret: string | Uint8Array, context = "benzo/private-events/v1"): Buffer {
  const s = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
  return createHash("sha256").update(context).update(s).digest();
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function unb64(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function aadFor(e: Omit<PrivateEventEnvelope, "ciphertext" | "iv" | "tag" | "payloadHash" | "hash">): string {
  return stable({
    id: e.id,
    orgId: e.orgId,
    type: e.type,
    subjectId: e.subjectId,
    schema: e.schema,
    occurredAt: e.occurredAt,
    publicMeta: e.publicMeta,
    prevHash: e.prevHash,
  });
}

function eventHash(e: Omit<PrivateEventEnvelope, "hash">): string {
  return sha256Hex(stable(e));
}

function assertPublicMetaSafe(publicMeta: Record<string, string | number | boolean | null>): void {
  for (const [key, value] of Object.entries(publicMeta)) {
    if (SENSITIVE_PUBLIC_META_KEY.test(key)) {
      throw new Error(`private event publicMeta contains sensitive key: ${key}`);
    }
    if (typeof value === "string" && value.includes("@")) {
      throw new Error(`private event publicMeta appears to contain a handle/email: ${key}`);
    }
  }
}

export function createPrivateEvent<TPayload extends Record<string, unknown>>(
  input: PrivateEventInput<TPayload>,
  opts: { key: Uint8Array; prevHash?: string; id?: string },
): PrivateEventEnvelope {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const id = opts.id ?? `pe_${sha256Hex(`${input.orgId}:${input.type}:${input.subjectId}:${occurredAt}:${randomBytes(16).toString("hex")}`).slice(0, 28)}`;
  const publicMeta = input.publicMeta ?? {};
  assertPublicMetaSafe(publicMeta);
  const base = {
    id,
    orgId: input.orgId,
    type: input.type,
    subjectId: input.subjectId,
    schema: input.schema,
    occurredAt,
    publicMeta,
    aadHash: "",
    prevHash: opts.prevHash ?? GENESIS_HASH,
  };
  const aad = aadFor(base);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(opts.key), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const plaintext = Buffer.from(stable(input.payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const withoutHash = {
    ...base,
    ciphertext: b64(ciphertext),
    iv: b64(iv),
    tag: b64(cipher.getAuthTag()),
    aadHash: sha256Hex(aad),
    payloadHash: sha256Hex(plaintext),
  };
  return { ...withoutHash, hash: eventHash(withoutHash) };
}

export function decryptPrivateEvent<TPayload = unknown>(event: PrivateEventEnvelope, key: Uint8Array): DecryptedPrivateEvent<TPayload> {
  const { ciphertext: _c, iv: _i, tag: _t, payloadHash: _p, hash: _h, ...base } = event;
  const aad = aadFor(base);
  if (sha256Hex(aad) !== event.aadHash) throw new Error("private event AAD hash mismatch");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), unb64(event.iv));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(unb64(event.tag));
  const plaintext = Buffer.concat([decipher.update(unb64(event.ciphertext)), decipher.final()]);
  if (sha256Hex(plaintext) !== event.payloadHash) throw new Error("private event payload hash mismatch");
  return { envelope: event, payload: JSON.parse(plaintext.toString("utf8")) as TPayload };
}

export function verifyHashChain(events: PrivateEventEnvelope[]): { ok: boolean; headHash: string; brokenAt?: number } {
  let prev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const { hash: _h, ...withoutHash } = events[i];
    if (events[i].prevHash !== prev || eventHash(withoutHash) !== events[i].hash) {
      return { ok: false, headHash: prev, brokenAt: i };
    }
    prev = events[i].hash;
  }
  return { ok: true, headHash: prev };
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex("EMPTY");
  let level = leaves.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(sha256Hex(`${left}:${right}`));
    }
    level = next;
  }
  return level[0];
}

export function merkleProof(leaves: string[], index: number): { eventHash: string; siblings: string[]; index: number } {
  if (index < 0 || index >= leaves.length) throw new Error("leaf index out of range");
  const siblings: string[] = [];
  let idx = index;
  let level = leaves.slice();
  while (level.length > 1) {
    const sibling = idx % 2 === 0 ? level[idx + 1] ?? level[idx] : level[idx - 1];
    siblings.push(sibling);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256Hex(`${level[i]}:${level[i + 1] ?? level[i]}`));
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return { eventHash: leaves[index], siblings, index };
}

export function verifyMerkleProof(proof: { eventHash: string; siblings: string[]; index: number }, root: string): boolean {
  let h = proof.eventHash;
  let idx = proof.index;
  for (const sib of proof.siblings) {
    h = idx % 2 === 0 ? sha256Hex(`${h}:${sib}`) : sha256Hex(`${sib}:${h}`);
    idx = Math.floor(idx / 2);
  }
  return h === root;
}

export function verifyAuditPacket(packet: AuditPacket): boolean {
  return packet.inclusionProofs.every((proof) => verifyMerkleProof(proof, packet.anchor.merkleRoot));
}

export function auditPacketHash(packet: AuditPacket): string {
  const anchor = { ...packet.anchor, txHash: undefined };
  return sha256Hex(stable({ ...packet, anchor }));
}

export function buildAnchor(orgId: string, events: PrivateEventEnvelope[], txHash?: string): PrivateEventAnchor {
  const chain = verifyHashChain(events);
  if (!chain.ok) throw new Error(`private event hash chain broken at ${chain.brokenAt}`);
  return {
    orgId,
    eventCount: events.length,
    headHash: chain.headHash,
    merkleRoot: merkleRoot(events.map((e) => e.hash)),
    anchoredAt: new Date().toISOString(),
    txHash,
  };
}

export function buildAuditPacket(opts: {
  orgId: string;
  events: PrivateEventEnvelope[];
  anchor?: PrivateEventAnchor;
  scope: AuditPacket["scope"];
}): AuditPacket {
  const filtered = opts.events.filter((e) => {
    if (e.orgId !== opts.orgId) return false;
    if (opts.scope.eventTypes && !opts.scope.eventTypes.includes(e.type)) return false;
    if (opts.scope.subjectIds && !opts.scope.subjectIds.includes(e.subjectId)) return false;
    if (opts.scope.from && e.occurredAt < opts.scope.from) return false;
    if (opts.scope.to && e.occurredAt > opts.scope.to) return false;
    return true;
  });
  const allHashes = opts.events.map((e) => e.hash);
  const anchor = opts.anchor ?? buildAnchor(opts.orgId, opts.events);
  return {
    orgId: opts.orgId,
    scope: opts.scope,
    anchor,
    envelopes: filtered,
    inclusionProofs: filtered.map((e) => merkleProof(allHashes, allHashes.indexOf(e.hash))),
    issuedAt: new Date().toISOString(),
  };
}

export class MemoryPrivateEventStore {
  private readonly events: PrivateEventEnvelope[] = [];
  constructor(private readonly key: Uint8Array) {}

  append<TPayload extends Record<string, unknown>>(event: PrivateEventInput<TPayload>): PrivateEventEnvelope {
    const prevHash = this.events[this.events.length - 1]?.hash ?? GENESIS_HASH;
    const envelope = createPrivateEvent(event, { key: this.key, prevHash });
    this.events.push(envelope);
    return envelope;
  }

  list(): PrivateEventEnvelope[] {
    return this.events.slice();
  }

  decrypt<TPayload = unknown>(event: PrivateEventEnvelope): DecryptedPrivateEvent<TPayload> {
    return decryptPrivateEvent<TPayload>(event, this.key);
  }

  anchor(txHash?: string): PrivateEventAnchor {
    return buildAnchor(this.events[0]?.orgId ?? "", this.events, txHash);
  }
}
