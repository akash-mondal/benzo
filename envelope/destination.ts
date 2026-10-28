// Settlement-envelope destinations: an envelope may carry only a shielded destination.
// Transparent addresses (t-addrs), TEX addresses and unified addresses without a shielded receiver are refused
// at seal and again at open, so no refund/delivery can be directed into the transparent pool (threat #7, #32).
//
// The classification itself is librustzcash's audited `zcash_address` 0.13.0 (pinned in
// `settle/Cargo.toml`, the zcash-devtool lock) — exposed as `benzo-pczt classify-address <address>`,
// which returns `{kind, network, receivers[]}` and is called from here. This module keeps only the
// product's shielded-only rule and its verdict strings; the hand-written bech32/F4Jumble/Base58Check
// parser that preceded it is gone (docs/AUDITS.md row closed).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { requireThat } from "../manifest/schema";
import { repoRoot } from "../manifest/root";

export type DestinationKind = "sapling" | "unified" | "transparent" | "tex" | "other";
export type DestinationNetwork = "main" | "test" | "regtest";
export type Destination = { kind: DestinationKind; shielded: boolean; network: DestinationNetwork | null };
export type Classified = {
  kind: "unified" | "sapling" | "transparent" | "tex" | "sprout" | "other" | "invalid_unified";
  network: DestinationNetwork | null;
  receivers: { typecode: number; data_hex: string }[];
};

// The pinned tool lives in the working tree (built by `npm run build:settle`); BNZ_PCZT_BIN overrides
// it for packaged installs. Failure is loud — never a default or a guess.
function pcztBin(): string {
  if (process.env.BNZ_PCZT_BIN) return process.env.BNZ_PCZT_BIN;
  const root = repoRoot();
  return path.join(root, "settle", "target", "release", "benzo-pczt");
}

// One classifier entry point with an in-process memo
// keyed by the EXACT address string. classifyAddresses(list) answers every entry from the memo, and
// sends only the misses to the tool — one bulk `classify-address --stdin` call per chunk of up to 2,000
// addresses. classifyAddress(one) is a thin wrapper over it, so every caller (classifyDestination,
// unifiedReceivers, isUnifiedOn, isUnifiedOrchardOn) gets identical answers.
//
// Under the memo a signer host can install its own disk cache (cli/host-derive.ts, classify-cache.json):
// both are pure memos — a verdict is only ever the classifier's own output for that exact address string,
// so serving one from a memo or cache can never change an answer.
const memo = new Map<string, Classified>();
export type ClassifyCache = {
  get(address: string): Classified | undefined;
  set(address: string, classified: Classified): void;
};
let classifyCache: ClassifyCache | null = null;
export function useClassifyCache(cache: ClassifyCache | null): void {
  classifyCache = cache;
}

// Addresses whose bytes the line protocol cannot carry (a newline or carriage return) are classified
// through the single-address form, exactly as before this batch — the bulk input is line-based, so a
// multi-line string would split into the wrong inputs and change its verdict.
const BULK_CHUNK = 2000;
export function classifyAddresses(list: string[]): Classified[] {
  const out: (Classified | undefined)[] = new Array(list.length);
  const misses = new Map<string, number[]>();
  for (const [i, destination] of list.entries()) {
    requireThat(typeof destination === "string" && destination.length > 0, "destination");
    const known = memo.get(destination) ?? classifyCache?.get(destination);
    if (known) { memo.set(destination, known); out[i] = known; continue; }
    const at = misses.get(destination);
    if (at) at.push(i);
    else misses.set(destination, [i]);
  }
  const record = (destination: string, c: Classified): void => {
    requireThat(c && typeof c === "object" && typeof c.kind === "string" && Array.isArray(c.receivers), "classify-address output");
    memo.set(destination, c);
    classifyCache?.set(destination, c);
    for (const i of misses.get(destination) ?? []) out[i] = c;
  };
  const bulk: string[] = [], single: string[] = [];
  for (const destination of misses.keys()) (/\r|\n/.test(destination) ? single : bulk).push(destination);
  for (const destination of single) {
    const text = execFileSync(pcztBin(), ["classify-address", destination], { encoding: "utf8" });
    record(destination, JSON.parse(text) as Classified);
  }
  for (let at = 0; at < bulk.length; at += BULK_CHUNK) {
    const chunk = bulk.slice(at, at + BULK_CHUNK);
    const text = execFileSync(pcztBin(), ["classify-address", "--stdin"], { input: chunk.join("\n") + "\n", encoding: "utf8" });
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    requireThat(lines.length === chunk.length, "classify-address output");
    chunk.forEach((destination, j) => record(destination, JSON.parse(lines[j]) as Classified));
  }
  return out as Classified[];
}

function classifyAddress(destination: string): Classified {
  return classifyAddresses([destination])[0];
}

// The UA container's receiver set (ZIP 316 items, in encoded order) — what the address actually names. The signer
// side matches a PCZT output against these, and the reference-vector proof checks them item by item.
export function unifiedReceivers(destination: string): { typecode: number; data_hex: string }[] {
  const c = classifyAddress(destination);
  requireThat(c.kind === "unified", "invalid unified address");
  return c.receivers.map((r) => ({ typecode: r.typecode, data_hex: r.data_hex }));
}

export function classifyDestination(destination: string): Destination {
  const c = classifyAddress(destination);
  // a unified-encoding string whose container fails is refused as loudly as the parser before the swap did
  requireThat(c.kind !== "invalid_unified", "invalid unified address");
  if (c.kind === "sprout") return { kind: "other", shielded: false, network: null }; // never admissible, verdict preserved
  return {
    kind: (c.kind as DestinationKind) ?? "other",
    shielded: c.kind === "sapling" || (c.kind === "unified" && c.receivers.some((r) => r.typecode === 0x02 || r.typecode === 0x03)),
    network: c.network,
  };
}

// (mainnet readiness): a network-aware UA check through the same audited classifier — the address must be
// a unified address on the MANIFEST's network. Used at the Node boundaries (sign build's seller routing,
// auction keys' derived escrow UA); the pure manifest checks keep a network-aware shape matcher (schema.uaShape)
// so the offline verifier never needs the binary.
export function isUnifiedOn(destination: string, network: string): boolean {
  try {
    const c = classifyAddress(destination);
    return c.kind === "unified" && c.network === network && c.receivers.some((r) => r.typecode === 0x02 || r.typecode === 0x03);
  } catch { return false; }
}

// The seller payout check at manifest creation — a unified address on
// the manifest's OWN network with a shielded Orchard/Ironwood receiver (typecode 0x03). isUnifiedOn alone admits a
// Sapling-only UA, which settlement outputs cannot pay, so the receiver check (the same rule requireShieldedDestination
// applies to settlement outputs) is added here, in one place with the classifier.
export function isUnifiedOrchardOn(destination: string, network: string): boolean {
  return isUnifiedOn(destination, network) && unifiedReceivers(destination).some((r) => r.typecode === 0x03);
}

// The envelope validator: only a destination settlement can actually pay is admissible, and only on this auction's
// network — a wrong-network destination would burn the refund (threat #7). The network comes from the signed manifest
// at every call site (never an env default or a literal). settlement builds
// Orchard/Ironwood outputs only (`benzo-pczt create`/`inspect` refuse Sapling), so a Sapling address or a UA without an
// Orchard receiver is refused here — at seal time for the bidder, and at open time on the host, where a refused
// destination becomes an exception row (claimable), never a batch that can never be built.
export function requireShieldedDestination(destination: string, network: string): void {
  const { kind, shielded, network: net } = classifyDestination(destination);
  if (kind === "transparent") requireThat(false, "transparent address (t-addr)");
  if (kind === "tex") requireThat(false, "TEX address");
  if (kind === "unified") requireThat(shielded, "UA without a shielded receiver");
  requireThat(shielded, "not a shielded destination");
  requireThat(net === network, "wrong-network address");
  requireThat(kind === "unified" && unifiedReceivers(destination).some((r) => r.typecode === 0x03), "settlement pays Orchard/Ironwood only: the destination needs a unified address with an Orchard receiver");
}
