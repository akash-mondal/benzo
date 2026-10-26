// Shapes shared by the pages and the gateway's JSON.

export type Mode = "uniform" | "vickrey" | "buyback" | "rfq" | "otc" | "launch" | "drop";
export type State = "DRAFT" | "OPEN" | "FROZEN" | "SEALED-WAIT" | "OPENED" | "CLEARED" | "SETTLING" | "SETTLED" | "CANCELLED" | "REFUNDING";

// One auction as the gateway lists it (every field comes from its published, signed auction document).
export type AuctionSummary = {
  id: string;
  mode: Mode;
  state: State;
  lot: string | null;
  lots: number;
  supply: number;
  C_zats: string;
  T_submit: number;
  T_freeze: number;
  R: number;
  release: number; // unix seconds when round R is published
  leaf_count: number | null;
  clearing_price_zats: string | null;
  settled: boolean;
  live: boolean; // run by this site's operator and still taking bids
  updated: number;
};

export type Check = { id: string; ok: boolean; detail: string };

export type AuctionDetail = AuctionSummary & {
  signer: string;
  manifest_hash: string;
  manifest: Record<string, any>;
  freeze_root: string | null;
  result: Record<string, any> | null;
  receipts: { party: string; amount_zats: string; txid: string | null }[];
  witness_certificates: number;
  checks: Check[];
  valid: boolean;
  deposit_addresses: string[];
  free_slots: number | null;
};

export type FieldDoodle = {
  key: string;
  src: string;
  name: string;
  slug: string;
  category: string;
  group: "market" | "mechanism" | "page" | "ornament" | "auction";
  tag: string | null;
  scale?: number;
  auction?: AuctionSummary;
  href?: string; // a door: a click dives into it and goes here
  ambient?: boolean; // background texture: no hover, no click, set deep in the fog
};

export type Chain = { tip: number | null; round: number | null; now: number };
