// One full-screen sky, two kinds of screen. Home: the six markets as doors, the site's pages as doors, and each market's
// newest rounds. A market (/markets/<mode>/): every round of that market,
// each opening its ticket (bottom-left), plus doors home and to the other markets. Every doodle you can point at does
// something; the ornaments are background texture only.
import { useCallback, useEffect, useMemo, useState } from "react";
import Field from "./Field";
import Card from "./Card";
import { api, MODE_NAME } from "../../lib/api";
import { DOOR, LIB, MARKETS, glyphFor, marketOf, src, type Market } from "../../lib/glyphs";
import type { AuctionSummary, FieldDoodle } from "../../lib/types";

const DAY = 24 * 3600;
const IN_PROGRESS = new Set(["OPEN", "FROZEN", "SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "REFUNDING"]);
// The home sky shows finished rounds and ones really moving; a market's own sky shows every round, stopped test runs too.
const showable = (a: AuctionSummary, now: number) => a.live || a.state === "SETTLED" || a.state === "CANCELLED" || moving(a, now);
const moving = (a: AuctionSummary, now: number) => IN_PROGRESS.has(a.state) && now - a.updated < DAY / 4;
const tagOf = (a: AuctionSummary, now = Date.now() / 1000) => (a.live ? "Live" : a.state === "CANCELLED" ? "Refunded" : a.state === "SETTLED" ? "Settled" : moving(a, now) ? "Running" : "Stopped");

export const auctionDoodle = (a: AuctionSummary): FieldDoodle => ({
  key: `a:${a.id}`, src: src(glyphFor(a.mode, a.id)), slug: glyphFor(a.mode, a.id), name: a.lot ?? `${MODE_NAME[a.mode]} ${a.id.slice(0, 6)}`,
  category: MODE_NAME[a.mode], group: "auction", tag: tagOf(a), scale: a.live ? 1.5 : 1, auction: a,
});
const door = (slug: string, name: string, tag: string | null, href: string, scale: number, group: FieldDoodle["group"] = "page"): FieldDoodle =>
  ({ key: `d:${slug}:${href}`, src: src(slug), slug, name, category: "", group, tag, scale, href });
const ornaments = (narrow: boolean): FieldDoodle[] => LIB.filter((d) => (d.group === "ornament" || d.group === "mechanism") && d.slug !== "quill").filter((_, i) => !narrow || i % 2 === 0)
  .map((d) => ({ key: `o:${d.slug}`, src: src(d.slug), slug: d.slug, name: d.name, category: d.category, group: "ornament", tag: null, ambient: true }));
const marketPath = (m: Market) => `/markets/${m}/`;

export default function Sky({ initial, market }: { initial: AuctionSummary[]; market?: Market }) {
  const [auctions, setAuctions] = useState<AuctionSummary[]>(initial);
  const [selected, setSelected] = useState<FieldDoodle | null>(null);
  const [signer, setSigner] = useState<string | undefined>();
  const base = market ? marketPath(market) : "/";

  useEffect(() => {
    let gone = false;
    const load = () => api.auctions().then((a) => { if (!gone) setAuctions(a); }).catch(() => {});
    load();
    const t = window.setInterval(load, 30_000);
    return () => { gone = true; window.clearInterval(t); };
  }, []);

  const live = auctions.find((a) => a.live && a.state === "OPEN");
  const doodles = useMemo<FieldDoodle[]>(() => {
    const narrow = typeof window !== "undefined" && window.innerWidth < 640, now = Date.now() / 1000;
    const count = (m: Market) => auctions.filter((a) => marketOf(a.mode) === m).length;
    // On an ellipse around the centre word, inside the one screen: angles in degrees, 0 is right, going up.
    const arc = (items: FieldDoodle[], from: number, to: number, rx: number, ry: number, closed = false) => items.map((d, i) => {
      const n = items.length, k = n === 1 ? 0.5 : closed ? i / n : i / (n - 1), t = ((from + (to - from) * k) * Math.PI) / 180;
      return { ...d, place: [Math.cos(t) * rx, Math.sin(t) * ry] as [number, number] };
    });
    if (!market) {
      const doors = MARKETS.map((m, i) => door(DOOR[m], MODE_NAME[m], `${count(m)} rounds`, marketPath(m), [1.35, 1.15, 1.25, 1.4, 1.1, 1.3][i], "market"));
      const pages = [
        door("emblem-bid", "Bid", live ? `Open now · ${live.lot ?? MODE_NAME[live.mode]}` : "Next round soon", live ? `/bid/?id=${live.id}` : "/bid/", 1.2),
        door("quill", "Start a round", "Any market", "/start/", 1.05),
        door("emblem-receipt", "Mine", "Your bids and rounds", "/mine/", 0.9),
        door("emblem-verify", "Verify", null, "/verify/", 1),
        door("emblem-lots", "Every lot", `${auctions.length} rounds`, "/lots/", 0.85),
      ];
      // Markets across the top, actions along the bottom (one ring on a phone).
      const ring = narrow ? arc([...doors, ...pages], 90, 450, 0.33, 0.36, true) : [...arc(doors, 158, 22, 0.34, 0.31), ...arc(pages, 204, 336, 0.34, 0.31)];
      return [...ring, ...ornaments(narrow)];
    }
    // A market's screen: one ring. Across the top its live rounds and its latest finished ones (test runs that stopped
    // part-way stay on the full list); along the bottom what you can do here.
    const rounds = auctions.filter((a) => marketOf(a.mode) === market && showable(a, now))
      .sort((a, b) => Number(b.live) - Number(a.live) || Number(b.state === "SETTLED") - Number(a.state === "SETTLED") || b.updated - a.updated)
      .slice(0, narrow ? 3 : 6).map(auctionDoodle)
      // Short names under the round: the lot, clipped, so labels never run into each other.
      .map((d) => { const max = narrow ? 12 : 18; return { ...d, name: d.name.length > max ? `${d.name.slice(0, max - 1).trimEnd()}…` : d.name }; });
    const n = auctions.filter((a) => marketOf(a.mode) === market).length;
    const actions = [
      ...(live && marketOf(live.mode) === market ? [door("emblem-bid", "Bid", `Open now · ${live.lot ?? MODE_NAME[live.mode]}`, `/bid/?id=${live.id}`, 1.15)] : []),
      door("quill", "Start a round", MODE_NAME[market], `/start/?market=${market}`, 1.1),
      door("emblem-lots", "All rounds", `${n} rounds`, `/lots/?market=${market}`, 0.95),
      door("sealed-envelope", "All markets", null, "/", 0.95),
    ];
    const top = rounds.length ? arc(rounds.map((d) => ({ ...d, scale: d.auction?.live ? 1.15 : 0.95 })), narrow ? 150 : 160, narrow ? 30 : 20, narrow ? 0.33 : 0.36, narrow ? 0.3 : 0.31) : [];
    return [...top, ...arc(actions, narrow ? 210 : 205, narrow ? 330 : 335, narrow ? 0.33 : 0.33, narrow ? 0.3 : 0.31), ...ornaments(narrow)];
  }, [auctions, market, live?.id]);

  const route = useCallback((d: FieldDoodle | null) => {
    window.history.replaceState({}, "", d?.auction ? `${base}?lot=${d.auction.id}` : base);
  }, [base]);
  const choose = useCallback((d: FieldDoodle) => { setSelected(d); route(d); }, [route]);
  const close = useCallback(() => { setSelected(null); route(null); }, [route]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [close]);

  // Deep link ?lot=<id>: open its ticket here, or on its market's screen when this sky does not hold it.
  useEffect(() => {
    if (selected) return;
    const lot = new URLSearchParams(location.search).get("lot");
    if (!lot) return;
    const pick = doodles.find((x) => x.auction?.id === lot);
    if (pick) return setSelected(pick);
    const a = auctions.find((x) => x.id === lot);
    if (a && marketOf(a.mode) !== market) location.replace(`${marketPath(marketOf(a.mode))}?lot=${lot}`);
  }, [doodles.length]);

  useEffect(() => {
    setSigner(undefined);
    if (selected?.auction) api.auction(selected.auction.id).then((d) => setSigner(d.signer)).catch(() => {});
  }, [selected?.key]);

  const arrive = typeof document !== "undefined" && document.referrer.startsWith(location.origin);
  const doors = doodles.filter((d) => d.href);
  return (
    <div className="absolute inset-0 overflow-hidden bg-ground">
      <Field doodles={doodles} center={market ? MODE_NAME[market] : "Benzo"} onSelect={choose} arrive={arrive} />
      {selected && <div className="absolute bottom-14 left-5 z-20 sm:bottom-16 sm:left-7"><Card doodle={selected} signer={signer} onClose={close} /></div>}
      <nav className="sr-only" aria-label="Every doodle in the field">
        <ul>
          {doors.map((d) => <li key={d.key}><a href={d.href}>{d.name}{d.tag ? ` (${d.tag})` : ""}</a></li>)}
          {doodles.filter((d) => d.auction).map((d) => <li key={d.key}><a href={`/auction/?id=${d.auction!.id}`}>{d.name} ({d.category}, {d.tag})</a></li>)}
        </ul>
      </nav>
    </div>
  );
}
