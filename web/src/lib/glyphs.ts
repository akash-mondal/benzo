// The doodle library as data, and which glyph stands for an auction.
import library from "../data/doodles.json";

export type Doodle = { slug: string; name: string; category: string; group: "market" | "mechanism" | "page" | "ornament"; mode?: string };
export const LIB = library as Doodle[];
// ?v= changes when the drawings are redrawn, so a browser never keeps an old one.
export const DOODLES_V = 2;
export const src = (slug: string) => `/doodles/${slug}.svg?v=${DOODLES_V}`;

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


// What each market is for, in a person's words (the hover on its door, and the start page).
export const ABOUT: Record<Market, string> = {
  uniform: "Sell several units. Every winner pays the same price.",
  drop: "Sell a few named items. Each goes to its best bid.",
  launch: "Raise money in units. Everyone is refunded if the minimum isn't met.",
  buyback: "Buy units back. Sellers send sealed asks against your budget.",
  otc: "One buyer, one seller. You trade if your limits cross.",
  rfq: "Ask a few dealers for sealed quotes. The best quote wins.",
};
