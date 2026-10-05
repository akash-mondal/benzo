// Shared validation and refund accounting for the §11 modes; signatures cover the mode's entire block.
import { checkBalanceAddresses, hash, requireThat, validateManifest, verifyRecord, zats, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen } from "./merkle";
import { readOrders } from "./features";
import { LAYOUT_V0, type OrderLayout } from "./layout";
import type { Allocation, ClearInput, ClearResult } from "./core";
export type MarketManifest<T> = Omit<Manifest, "clearing"> & { clearing: Omit<Manifest["clearing"], "mode"> & { mode: string } } & T;
export function marketClient<T>(packet: Signed, signer: string, mode: string, validate: (m: MarketManifest<T>) => void) {
  const m = verifyRecord<MarketManifest<T>>(packet, signer);
  requireThat(m.clearing.mode === mode, `${mode} mode`);
  const base: any = { ...m, clearing: { ...m.clearing, mode: "uniform" } }; delete base[mode];
  validateManifest(base); validate(m);
  // R33 item 1: with the mode block stripped the base rules cannot see the treasury addresses, so the
  // balance-address exclusions run again here on the full manifest.
  if (m.bond !== undefined) checkBalanceAddresses(m);
  return { manifest: m, manifest_hash: hash(Buffer.from(packet.bytes, "base64")) };
}
export function marketOrders(input: ClearInput, m: MarketManifest<unknown>, layout: OrderLayout = LAYOUT_V0) {
  checkFrozen(input.frozen, m.auction_id, input.manifest.sha256);
  return readOrders(input, m, layout).map(o => ({ ...o, fill: 0,
    reason: o.reason || (!o.quantity || o.quantity > m.q_max || o.price > zats(m.B_max_zats, "cap") ||
      o.price % zats(m.tick_zats, "tick") !== 0n || (!m.bond && o.price * BigInt(o.quantity) + zats(m.fee_zats, "fee") > zats(m.C_zats, "C")) ? "over_cap" : "") }));
}
export function marketResult(input: ClearInput, m: MarketManifest<unknown>, allocations: Allocation[], price: bigint, fees: bigint, treasury = 0n): ClearResult {
  const inputZats = zats(m.C_zats, "C") * BigInt(allocations.length) + treasury;
  const payout = allocations.reduce((n, a) => n + BigInt(a.payment_zats), 0n);
  const refunds = allocations.reduce((n, a) => n + BigInt(a.refund_zats), 0n);
  const balances = allocations.reduce((n, a) => n + BigInt(a.balance_due_zats ?? "0"), 0n);
  requireThat(inputZats + balances === payout + refunds + fees, "conservation");
  return { auction_id: m.auction_id, manifest_hash: input.manifest.sha256, freeze_root: input.frozen.root,
    mode: m.clearing.mode, clearing_price_zats: price.toString(), allocations, comparison: null,
    conservation: { input_zats: inputZats.toString(), payout_zats: payout.toString(), refund_zats: refunds.toString(), fees_zats: fees.toString(),
      ...(treasury ? { treasury_zats: treasury.toString() } : {}), ...(m.bond ? { balances_zats: balances.toString() } : {}) } };
}
