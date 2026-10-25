// Client for the site's gateway (web/gateway). Same origin in production; the dev server proxies /api.
import type { AuctionDetail, AuctionSummary, Chain } from "./types";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(text ? (JSON.parse(text).error ?? text) : String(r.status));
  return JSON.parse(text) as T;
}

export const api = {
  auctions: () => get<AuctionSummary[]>("/api/auctions"),
  auction: (id: string) => get<AuctionDetail>(`/api/auctions/${id}`),
  packet: (id: string) => get<{ manifest: any; signer: string }>(`/api/auctions/${id}/packet`),
  chain: () => get<Chain>("/api/chain"),
  receipt: (id: string, ciphertextHash: string) => get<any>(`/api/auctions/${id}/receipt/${ciphertextHash}`),
  slot: (id: string) => post<{ address: string; slot: number; held_until: number }>(`/api/auctions/${id}/slot`, {}),
  submit: (id: string, record: { address: string; txid: string; envelope_hex: string; envelope_ct_hex: string; owner_sig_hex: string; ciphertext_hash: string }) =>
    post<{ status: string }>(`/api/auctions/${id}/bids`, record),
  bidStatus: (id: string, ciphertextHash: string) => get<{ status: "queued" | "waiting" | "admitted" | "refused"; detail: string; leaf_index?: number }>(`/api/auctions/${id}/bids/${ciphertextHash}`),
};

export const zec = (zats: string | number | bigint) => {
  const z = BigInt(zats), whole = z / 100_000_000n, frac = (z % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

export const short = (hex: string, n = 8) => (hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-4)}` : hex);

export const MODE_NAME: Record<string, string> = {
  uniform: "Uniform price", vickrey: "Vickrey", buyback: "Buyback", rfq: "RFQ", otc: "OTC", launch: "Launch", drop: "Drop",
};
// The card's status light: the word it shows and its colour.
export const STATE_LIGHT: Record<string, { word: string; color: string; glow: string }> = {
  OPEN: { word: "Open", color: "bg-emerald-400", glow: "" },
  FROZEN: { word: "Frozen", color: "bg-amber-300", glow: "" },
  "SEALED-WAIT": { word: "Sealed", color: "bg-amber-300", glow: "" },
  OPENED: { word: "Opened", color: "bg-sky-300", glow: "" },
  CLEARED: { word: "Cleared", color: "bg-sky-300", glow: "" },
  SETTLING: { word: "Settling", color: "bg-sky-300", glow: "" },
  SETTLED: { word: "Settled", color: "bg-white/70", glow: "" },
  CANCELLED: { word: "Refunded", color: "bg-rose-400", glow: "" },
  REFUNDING: { word: "Refunding", color: "bg-rose-400", glow: "" },
};

// "Oct 20, 21:39 UTC"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Formatted by hand (not toLocaleString), so the server and the browser print the same string.
export const utc = (unix: number) => { const d = new Date(unix * 1000), p = (n: number) => String(n).padStart(2, "0"); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`; };
export const thousands = (n: number | string) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
