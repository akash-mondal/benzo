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
  finished?: boolean; // settled and verified by the runner; a round with nothing to pay keeps the state CLEARED
  stopped?: boolean; // the operator's runner gave up before paying out; deposits refund with each bidder's recovery file
  outcome?: { filled: number; of: number; paid_zats: string } | null; // what sold, once the round has a result
};

export type Check = { id: string; ok: boolean; detail: string; status?: "passed" | "failed" | "warning" | "not_applicable" };

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
  funding: { address: string; amount_zats: string; house: boolean } | null; // the treasury budget a buyback or RFQ needs
  request: string | null; // the site request that started it
};

// A round someone started on the site (gateway/requests.ts).
export type RoundRequest = {
  rid: string; mode: string; lot: string; lots: string[] | null; supply: number; status: "waiting" | "queued" | "open" | "failed";
  auction_id: string | null; error: string | null; minutes: number; max_price_zats: string; reserve_zats: string; side: "buyer" | "seller" | null;
  invites: { label: string; joined: boolean; token?: string }[]; budget_zats: string | null; manage: boolean; queue?: number | null; operator?: boolean;
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
  place?: [number, number]; // where it starts, as fractions of the first screen (x right, y up; 0,0 is the centre); named below
};

export type Chain = { tip: number | null; round: number | null; now: number };
