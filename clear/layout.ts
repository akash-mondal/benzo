// Versioned order-plaintext layouts (gate EN). Each clearing mode names the layout its sealed orders use, and the
// mode parsers take their offsets from the declared layout, so a new mode can declare a new layout version without
// touching another mode's parse. LAYOUT_V0 is the 128-byte bid/ask layout (docs/PHASE-1.md section 6).

export type OrderLayout = {
  version: number; // first plaintext byte
  bytes: number; // total plaintext length
  price_at: number; // u64be
  quantity_at: number; // u32be
  auction_at: number; // auction_id bytes
  auction_len: number;
  pad_at: number; // zero padding from here to the end
};
export const LAYOUT_V0: OrderLayout = { version: 0, bytes: 128, price_at: 33, quantity_at: 41, auction_at: 1, auction_len: 32, pad_at: 125 };

// Parses one order plaintext under the given layout. reason "" means a valid order; otherwise "plaintext_length"
// or "plaintext_binding" (the outcome vocabulary of clear/). price and quantity come back either way.
export function readOrder(layout: OrderLayout, plaintextHex: string, auctionId: string): { price: bigint; quantity: number; reason: string } {
  if (!/^[0-9a-f]+$/.test(plaintextHex) || plaintextHex.length !== layout.bytes * 2) return { price: 0n, quantity: 0, reason: "plaintext_length" };
  const pt = Buffer.from(plaintextHex, "hex");
  const price = pt.readBigUInt64BE(layout.price_at), quantity = pt.readUInt32BE(layout.quantity_at);
  const bound = pt[0] === layout.version &&
    pt.subarray(layout.pad_at).equals(Buffer.alloc(layout.bytes - layout.pad_at)) &&
    pt.subarray(layout.auction_at, layout.auction_at + layout.auction_len).toString("hex") === auctionId;
  return { price, quantity, reason: bound ? "" : "plaintext_binding" };
}
