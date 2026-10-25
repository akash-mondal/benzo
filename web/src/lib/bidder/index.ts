// The browser bidder: `benzo bid seal`, in the page. It runs the repo's own code unchanged (envelope/bid.ts prepareBid
// and bindSealedBid, manifest/schema.ts verifyRecord, envelope/opening.ts sealedBidShape; see vite-plugin.ts for the
// three browser shims), and seals with the shipped sealer bundle (seal/dist, served at /sealer/) in a hidden frame,
// filling the same fields the CLI fills. Nothing about the bid leaves the page except the sealed record.
import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;

const QUICKNET = { genesis: 1692803367, period: 3 };

export type Prepared = {
  auction_id: string; address: string; price_zats: string; quantity: number; R: number;
  envelope_hex: string; uri: string; ciphertext_hash: string; owner_private_hex: string; owner_public_hex: string;
  owner_sig_hex: string; nonce_hex: string; settlement_commitment_hex: string; envelope_ct_hex: string;
};

const repo = () => Promise.all([import("../../../../envelope/bid"), import("../../../../manifest/schema"), import("../../../../envelope/opening")]);

// Check the operator's signature on the manifest against the signer the round published, and the manifest itself.
export async function verifiedManifest(packet: any, signer: string) {
  const [, schema] = await repo();
  const m: any = schema.verifyRecord(packet, signer);
  schema.validateManifest(m);
  return m;
}

// Drive the sealer bundle exactly as `benzo bid seal` does (cli/product.ts): fill its inputs, press Seal, read the memo.
async function seal(fields: Record<string, string>): Promise<{ envelope: string; uri: string; round: number }> {
  const frame = document.createElement("iframe");
  frame.src = "/sealer/";
  frame.title = "sealer";
  frame.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0"; // taste-skill-ignore: an invisible working frame, not a rule
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => { frame.onload = () => resolve(); frame.onerror = () => reject(new Error("sealer bundle did not load")); });
    const doc = frame.contentDocument!;
    const $ = (id: string) => doc.getElementById(id) as HTMLInputElement | null;
    for (const [k, v] of Object.entries(fields)) { const el = $(k); if (!el) throw new Error(`sealer has no field ${k}`); el.value = v; }
    (doc.getElementById("seal") as HTMLButtonElement).click();
    for (let i = 0; i < 400; i++) {
      const env = $("envelope")?.textContent ?? "", err = $("error")?.textContent ?? "";
      if (err) throw new Error(err);
      if (env) return { envelope: env, uri: $("uri")!.textContent ?? "", round: Number($("round")!.textContent) };
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the sealer did not answer");
  } finally { frame.remove(); }
}

// Memo framing v2, as admission parses it (settle/envelopes.ts memoSealedBid): ff424e5a02 || u16 len || ct || tag(18) || 0s.
function memoParts(hex: string) {
  if (!/^[0-9a-f]{1024}$/.test(hex) || !hex.startsWith("ff424e5a02")) throw new Error("the sealer produced a memo that is not framing v2");
  const len = parseInt(hex.slice(10, 14), 16);
  if (len <= 0 || len > 487 || /[^0]/.test(hex.slice((7 + len + 18) * 2))) throw new Error("memo framing: bad length or padding");
  return { ct: hex.slice(14, 14 + len * 2), tag: hex.slice(14 + len * 2, 14 + (len + 18) * 2) };
}

export async function prepareSealedBid(args: { packet: any; signer: string; address: string; price_zats: string; refund_ua: string }): Promise<Prepared> {
  const [bid, schema, opening] = await repo();
  const m: any = schema.verifyRecord(args.packet, args.signer);
  schema.validateManifest(m);
  if (!m.deposit_addresses.includes(args.address)) throw new Error("that deposit address is not one of this round's");
  if (Date.now() / 1000 >= m.T_submit) throw new Error("bids for this round have closed");
  if (!/^[1-9][0-9]*$/.test(args.price_zats)) throw new Error("price must be a whole number of zats");
  const price = BigInt(args.price_zats);
  if (price < BigInt(m.reserve_zats ?? 0) || price > BigInt(m.B_max_zats)) throw new Error(`price must be between ${m.reserve_zats} and ${m.B_max_zats} zats`);
  if (BigInt(m.tick_zats ?? 1) > 1n && price % BigInt(m.tick_zats) !== 0n) throw new Error(`price must be a multiple of ${m.tick_zats} zats`);
  const prep: any = bid.prepareBid({ auction_id: m.auction_id, price_zats: price, quantity: 1, destination_ua: args.refund_ua, envelope_public_hexs: m.envelope_keys, network: m.network });
  const tag = prep.envelope_ct_hex ? schema.hash(Buffer.from(prep.envelope_ct_hex, "hex")).slice(0, 36) : "00".repeat(18);
  const sealed = await seal({
    opening: new Date((QUICKNET.genesis + (m.drand.R - 1) * QUICKNET.period) * 1000).toISOString(), auction: m.auction_id, price: args.price_zats, quantity: "1",
    collateral: m.C_zats, address: args.address, owner: prep.owner.public_hex, nonce: prep.nonce_hex, commitment: prep.settlement_commitment_hex,
    envelope_tag: tag, layout_version: "0", binding: m.auction_id, holder: "",
  });
  const parts = memoParts(sealed.envelope);
  if (parts.tag !== tag) throw new Error("memo envelope tag mismatch");
  const shape = opening.sealedBidShape(parts.ct, m.drand.R);
  if (!shape.ok) throw new Error(`sealed bid structure: ${(shape as any).reason}`);
  const ciphertext_hash = schema.hash(Buffer.from(parts.ct, "hex"));
  const bound: any = bid.bindSealedBid(prep, m.auction_id, ciphertext_hash);
  return {
    auction_id: m.auction_id, address: args.address, price_zats: args.price_zats, quantity: 1, R: m.drand.R, envelope_hex: sealed.envelope, uri: sealed.uri,
    ciphertext_hash, owner_private_hex: bound.owner.private_hex, owner_public_hex: bound.owner.public_hex, owner_sig_hex: bound.owner_sig_hex,
    nonce_hex: bound.nonce_hex, settlement_commitment_hex: bound.settlement_commitment_hex, envelope_ct_hex: bound.envelope_ct_hex,
  };
}
