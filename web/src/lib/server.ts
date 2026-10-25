// Build-time (and dev-time) reads from the gateway, so every page ships real numbers without needing script.
import type { AuctionDetail, AuctionSummary } from "./types";

const GATEWAY = process.env.BNZ_WEB_GATEWAY ?? "http://127.0.0.1:8790";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await fetch(GATEWAY + path, { signal: AbortSignal.timeout(60_000) }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

export const auctions = async () => (await get<AuctionSummary[]>("/api/auctions")) ?? [];
export const auction = (id: string) => get<AuctionDetail & { freeze: any; result_hash: string | null }>(`/api/auctions/${id}`);

// The round the home page tells its story with: the newest settled uniform-price round with at least two sealed bids,
// a clearing price and paid receipts, whose checks all pass.
export async function featured(list: AuctionSummary[]) {
  const candidates = list.filter((a) => a.mode === "uniform" && a.state === "SETTLED" && (a.leaf_count ?? 0) >= 2 && a.clearing_price_zats).sort((a, b) => b.updated - a.updated);
  for (const c of candidates.slice(0, 6)) {
    const d = await auction(c.id);
    if (d && d.valid && d.receipts.length) return d;
  }
  return null;
}
