// The doodle library as data, and which glyph stands for an auction.
import library from "../data/doodles.json";

export type Doodle = { slug: string; name: string; category: string; group: "market" | "mechanism" | "page" | "ornament"; mode?: string };
export const LIB = library as Doodle[];
export const src = (slug: string) => `/doodles/${slug}.svg`;

// An auction's doodle: one of its mode's three glyphs, picked by its id, so a field of real rounds is not one shape repeated.
export const glyphFor = (mode: string, id: string) => {
  const set = LIB.filter((d) => d.mode === (mode === "vickrey" ? "uniform" : mode));
  return set.length ? set[parseInt(id.slice(0, 8), 16) % set.length].slug : "gavel";
};

// The six markets, each with its own screen (/markets/<mode>/) and the glyph that is its door on the home sky.
export const MARKETS = ["uniform", "otc", "rfq", "launch", "buyback", "drop"] as const;
export type Market = (typeof MARKETS)[number];
export const DOOR: Record<Market, string> = { uniform: "gavel", otc: "swap-arrows", rfq: "price-tag", launch: "rocket", buyback: "loop-arrows", drop: "crate" };
export const marketOf = (mode: string): Market => (mode === "vickrey" ? "uniform" : (mode as Market));

