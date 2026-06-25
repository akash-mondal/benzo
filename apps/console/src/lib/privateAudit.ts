import type { PrivateAuditPacketResponse } from "./api";

type PublicMeta = Record<string, string | number | boolean | null>;

export type ConsolePrivateEventType =
  | "invoice.created"
  | "invoice.imported"
  | "invoice.paid"
  | "payment.submitted"
  | "payment.settled"
  | "payroll.computed"
  | "approval.recorded"
  | "grant.created"
  | "grant.revoked";

type Envelope = PrivateAuditPacketResponse["packet"]["envelopes"][number];

const EVENTS_KEY = "benzo.console.privateEvents.v1";
const SECRET_KEY = "benzo.console.privateEvents.secret.v1";
const GENESIS_HASH = "GENESIS";
const SENSITIVE_PUBLIC_META_KEY = /(amount|balance|counterparty|description|email|handle|memo|name|rate|recipient|salary|tax)/i;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0));
}

function bufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bufferSource(bytes))));
}

async function key(): Promise<CryptoKey> {
  let raw = localStorage.getItem(SECRET_KEY);
  if (!raw) {
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    raw = b64(secret);
    localStorage.setItem(SECRET_KEY, raw);
  }
  return crypto.subtle.importKey("raw", bufferSource(unb64(raw)), "AES-GCM", false, ["encrypt"]);
}

function readEvents(): Envelope[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]") as Envelope[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEvents(events: Envelope[]): void {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

function aadFor(e: Omit<Envelope, "ciphertext" | "iv" | "tag" | "payloadHash" | "hash">): string {
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

async function envelopeHash(e: Omit<Envelope, "hash">): Promise<string> {
  return sha256Hex(stable(e));
}

function assertPublicMetaSafe(publicMeta: PublicMeta): void {
  for (const [k, v] of Object.entries(publicMeta)) {
    if (SENSITIVE_PUBLIC_META_KEY.test(k)) throw new Error(`private event publicMeta contains sensitive key: ${k}`);
    if (typeof v === "string" && v.includes("@")) throw new Error(`private event publicMeta appears to contain a handle/email: ${k}`);
  }
}

export async function recordConsolePrivateEvent(input: {
  orgId: string;
  type: ConsolePrivateEventType;
  subjectId: string;
  schema: string;
  payload: Record<string, unknown>;
  publicMeta?: PublicMeta;
}): Promise<Envelope> {
  const events = readEvents();
  const occurredAt = new Date().toISOString();
  const idSeed = new Uint8Array(16);
  crypto.getRandomValues(idSeed);
  const id = `pe_${(await sha256Hex(`${input.orgId}:${input.type}:${input.subjectId}:${occurredAt}:${bytesToHex(idSeed)}`)).slice(0, 28)}`;
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
    prevHash: events[events.length - 1]?.hash ?? GENESIS_HASH,
  };
  const aad = aadFor(base);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(stable(input.payload));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv), additionalData: bufferSource(new TextEncoder().encode(aad)) },
    await key(),
    bufferSource(plaintext),
  ));
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);
  const withoutHash = {
    ...base,
    ciphertext: b64(ciphertext),
    iv: b64(iv),
    tag: b64(tag),
    aadHash: await sha256Hex(aad),
    payloadHash: await sha256Hex(plaintext),
  };
  const envelope = { ...withoutHash, hash: await envelopeHash(withoutHash) };
  writeEvents([...events, envelope]);
  return envelope;
}

export async function verifyClientHashChain(events = readEvents()): Promise<{ ok: boolean; headHash: string; brokenAt?: number }> {
  let prev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const { hash: _hash, ...withoutHash } = events[i];
    if (events[i].prevHash !== prev || (await envelopeHash(withoutHash)) !== events[i].hash) {
      return { ok: false, headHash: prev, brokenAt: i };
    }
    prev = events[i].hash;
  }
  return { ok: true, headHash: prev };
}

async function merkleRoot(leaves: string[]): Promise<string> {
  if (leaves.length === 0) return sha256Hex("EMPTY");
  let level = leaves.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(await sha256Hex(`${level[i]}:${level[i + 1] ?? level[i]}`));
    level = next;
  }
  return level[0];
}

async function merkleProof(leaves: string[], index: number): Promise<{ eventHash: string; siblings: string[]; index: number }> {
  const siblings: string[] = [];
  let idx = index;
  let level = leaves.slice();
  while (level.length > 1) {
    siblings.push(idx % 2 === 0 ? level[idx + 1] ?? level[idx] : level[idx - 1]);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(await sha256Hex(`${level[i]}:${level[i + 1] ?? level[i]}`));
    idx = Math.floor(idx / 2);
    level = next;
  }
  return { eventHash: leaves[index], siblings, index };
}

export async function clientAuditPacket(orgId: string, label = "console-private-events"): Promise<PrivateAuditPacketResponse> {
  const events = readEvents().filter((e) => e.orgId === orgId);
  const integrity = await verifyClientHashChain(events);
  const hashes = events.map((e) => e.hash);
  const packet: PrivateAuditPacketResponse["packet"] = {
    orgId,
    scope: { label },
    anchor: {
      orgId,
      eventCount: events.length,
      headHash: integrity.headHash,
      merkleRoot: await merkleRoot(hashes),
      anchoredAt: new Date().toISOString(),
    },
    envelopes: events,
    inclusionProofs: await Promise.all(events.map((e) => merkleProof(hashes, hashes.indexOf(e.hash)))),
    issuedAt: new Date().toISOString(),
  };
  return {
    packet,
    integrity,
    disclosure: "ciphertext-only; records are encrypted in this browser and roots can be anchored on-chain",
  };
}

export async function clientAuditPacketHash(packet: PrivateAuditPacketResponse["packet"]): Promise<string> {
  const anchor = { ...packet.anchor, txHash: undefined };
  return sha256Hex(stable({ ...packet, anchor }));
}

export async function clientAuditOrgHash(orgId: string): Promise<string> {
  return sha256Hex(`benzo:audit-org:v1:${orgId}`);
}
