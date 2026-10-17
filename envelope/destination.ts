// Settlement-envelope destinations (gate W, R3 item 7): an envelope may carry only a shielded destination.
// Transparent addresses (t-addrs), TEX addresses and unified addresses without a shielded receiver are refused
// at seal and again at open, so no refund/delivery can be directed into the transparent pool (threat #7, #32).
//
// R24 item 3 (i): the classification itself is librustzcash's audited `zcash_address` 0.13.0 (pinned in
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
type Classified = {
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

function classifyAddress(destination: string): Classified {
  requireThat(typeof destination === "string" && destination.length > 0, "destination");
  const out = execFileSync(pcztBin(), ["classify-address", destination], { encoding: "utf8" });
  const c = JSON.parse(out) as Classified;
  requireThat(c && typeof c === "object" && typeof c.kind === "string" && Array.isArray(c.receivers), "classify-address output");
  return c;
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

// G-7 (mainnet readiness): a network-aware UA check through the same audited classifier — the address must be
// a unified address on the MANIFEST's network. Used at the Node boundaries (sign build's seller routing,
// auction keys' derived escrow UA); the pure manifest checks keep a network-aware shape matcher (schema.uaShape)
// so the offline verifier never needs the binary.
export function isUnifiedOn(destination: string, network: string): boolean {
  try {
    const c = classifyAddress(destination);
    return c.kind === "unified" && c.network === network && c.receivers.some((r) => r.typecode === 0x02 || r.typecode === 0x03);
  } catch { return false; }
}

// The envelope validator: only a destination settlement can actually pay is admissible, and only on this auction's
// network — a wrong-network destination would burn the refund (threat #7). The network comes from the signed manifest
// at every call site (G-7/R33 P2-1: never an env default or a literal). R81 (Reviewer R R-2 on R80): settlement builds
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
