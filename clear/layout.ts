// Versioned order-plaintext layouts. Each clearing mode names the layout its sealed orders use, and the
// mode parsers take their offsets from the declared layout, so a new mode can declare a new layout version without
// touching another mode's parse. LAYOUT_V0 is the 128-byte bid/ask layout.

export type OrderLayout = {
  version: number; // first plaintext byte
  bytes: number; // total plaintext length
  price_at: number; // u64be
  quantity_at: number; // u32be
  auction_at: number; // binding id bytes: the auction_id (single-lot) or the order's lot id (multi-lot)
  auction_len: number;
  owner_at: number; // one-time Ed25519 owner pubkey (orders by the same key supersede)
  pad_at: number; // zero padding from here to the end
};
export const LAYOUT_V0: OrderLayout = { version: 0, bytes: 128, price_at: 33, quantity_at: 41, auction_at: 1, auction_len: 32, owner_at: 61, pad_at: 125 };

// Parses one order plaintext under the given layout. reason "" means a valid order; otherwise "plaintext_length"
// or "plaintext_binding" (the outcome vocabulary of clear/). price, quantity, the bound id and the owner key come
// back either way. The bound id must be one of allowedBindings (the auction_id, or the manifest's lot ids).
export function readOrder(layout: OrderLayout, plaintextHex: string, allowedBindings: string[]): {
  price: bigint; quantity: number; bound_hex: string; owner_hex: string; reason: string;
} {
  const fail = (reason: string, bound_hex = "", owner_hex = "") => ({ price: 0n, quantity: 0, bound_hex, owner_hex, reason });
  if (!/^[0-9a-f]+$/.test(plaintextHex) || plaintextHex.length !== layout.bytes * 2) return fail("plaintext_length");
  const pt = Buffer.from(plaintextHex, "hex");
  const price = pt.readBigUInt64BE(layout.price_at), quantity = pt.readUInt32BE(layout.quantity_at);
  const bound_hex = pt.subarray(layout.auction_at, layout.auction_at + layout.auction_len).toString("hex");
  const owner_hex = pt.subarray(layout.owner_at, layout.owner_at + 32).toString("hex");
  const bound = pt[0] === layout.version &&
    pt.subarray(layout.pad_at).equals(Buffer.alloc(layout.bytes - layout.pad_at)) &&
    allowedBindings.includes(bound_hex);
  return bound ? { price, quantity, bound_hex, owner_hex, reason: "" } : { ...fail("plaintext_binding", bound_hex, owner_hex), price, quantity };
}
