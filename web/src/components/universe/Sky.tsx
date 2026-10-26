// One full-screen sky, two kinds of screen. Home: the six markets as doors, the site's pages as doors, and each market's
// newest rounds. A market (/markets/<mode>/): every round of that market,
// each opening its ticket (bottom-left), plus doors home and to the other markets. Every doodle you can point at does
// something; the ornaments are background texture only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Field from "./Field";
import Card from "./Card";
import { api, MODE_NAME } from "../../lib/api";
import { ABOUT, DOOR, LIB, MARKETS, glyphFor, marketOf, src, type Market } from "../../lib/glyphs";
import type { AuctionSummary, FieldDoodle } from "../../lib/types";
import { doodleTexture } from "./shaders";

const DAY = 24 * 3600;
const IN_PROGRESS = new Set(["OPEN", "FROZEN", "SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "REFUNDING"]);
// The home sky shows finished rounds and ones really moving; a market's own sky shows every round, stopped test runs too.
const showable = (a: AuctionSummary, now: number) => a.live || a.state === "SETTLED" || a.state === "CANCELLED" || moving(a, now);
const moving = (a: AuctionSummary, now: number) => IN_PROGRESS.has(a.state) && now - a.updated < DAY / 4;
// A round on hover, as a person would say it.
const tagOf = (a: AuctionSummary, now = Date.now() / 1000) => a.live ? "Taking sealed bids now"
  : a.state === "CANCELLED" ? "Didn't sell. Every deposit was returned."
  : a.state === "SETTLED" ? (a.clearing_price_zats && a.clearing_price_zats !== "0" ? `Sold at ${Number(a.clearing_price_zats).toLocaleString("en-US")} zats` : "Closed without a sale. Deposits returned.")
  : moving(a, now) ? "Bids closed. Opening and paying out." : "Stopped part-way in a test run";

export const auctionDoodle = (a: AuctionSummary): FieldDoodle => ({
  key: `a:${a.id}`, src: src(glyphFor(a.mode, a.id)), slug: glyphFor(a.mode, a.id), name: a.lot ?? `${MODE_NAME[a.mode]} ${a.id.slice(0, 6)}`,
  category: MODE_NAME[a.mode], group: "auction", tag: tagOf(a), scale: a.live ? 1.5 : 1, auction: a,
});
const door = (slug: string, name: string, tag: string | null, href: string, scale: number, group: FieldDoodle["group"] = "page"): FieldDoodle =>
  ({ key: `d:${slug}:${href}`, src: src(slug), slug, name, category: "", group, tag, scale, href });
const ornaments = (narrow: boolean): FieldDoodle[] => LIB.filter((d) => (d.group === "ornament" || d.group === "mechanism") && d.slug !== "quill").filter((_, i) => !narrow || i % 2 === 0)
  .map((d) => ({ key: `o:${d.slug}`, src: src(d.slug), slug: d.slug, name: d.name, category: d.category, group: "ornament", tag: null, ambient: true }));
const marketPath = (m: Market) => `/markets/${m}/`;
// Which sky a link opens: null for home, a market, or undefined for any other page (those load normally).
const skyOf = (href: string): Market | null | undefined => {
  const p = new URL(href, location.origin).pathname;
  if (p === "/") return null;
  const m = p.match(/^\/markets\/([a-z]+)\/?$/)?.[1] as Market | undefined;
  return m && MARKETS.includes(m) ? m : undefined;
};

export default function Sky({ initial, market: initialMarket }: { initial: AuctionSummary[]; market?: Market }) {
  const [auctions, setAuctions] = useState<AuctionSummary[]>(initial);
  // Home and the six markets are one page: moving between them swaps the sky in place (no reload), so the fly-in into a
  // door and the way back out are one motion. The address bar and the browser's Back follow along.
  const [market, setMarket] = useState<Market | undefined>(initialMarket);
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
      const doors = MARKETS.map((m, i) => door(DOOR[m], MODE_NAME[m], ABOUT[m], marketPath(m), [1.35, 1.15, 1.25, 1.4, 1.1, 1.3][i], "market"));
      const pages = [
        door("emblem-bid", "Bid", "Place a sealed bid. Nobody sees your price until the bids open.", live ? `/bid/?id=${live.id}` : "/bid/", 1.2),
        door("quill", "Start a round", "Sell or buy something. Pick a market and set your terms.", "/start/", 1.05),
        door("emblem-receipt", "Mine", "Your bids and the rounds you started.", "/mine/", 0.9),
        door("emblem-verify", "Verify", "Check any round's result for yourself.", "/verify/", 1),
        door("emblem-lots", "Every lot", "Every round so far, and how each one ended.", "/lots/", 0.85),
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
      ...(live && marketOf(live.mode) === market ? [door("emblem-bid", "Bid", "Bid in the round that's open now.", `/bid/?id=${live.id}`, 1.15)] : []),
      door("quill", "Start a round", `Open a new ${MODE_NAME[market] === MODE_NAME[market].toUpperCase() ? MODE_NAME[market] : MODE_NAME[market].toLowerCase()} round with your own terms.`, `/start/?market=${market}`, 1.1),
      door("emblem-lots", "All rounds", `Every ${MODE_NAME[market] === MODE_NAME[market].toUpperCase() ? MODE_NAME[market] : MODE_NAME[market].toLowerCase()} round so far, and how each ended.`, `/lots/?market=${market}`, 0.95),
    ];
    const top = rounds.length ? arc(rounds.map((d) => ({ ...d, scale: d.auction?.live ? 1.15 : 0.95 })), narrow ? 150 : 160, narrow ? 30 : 20, narrow ? 0.33 : 0.36, narrow ? 0.3 : 0.31) : [];
    return [...top, ...arc(actions, narrow ? 210 : 205, narrow ? 330 : 335, narrow ? 0.33 : 0.33, narrow ? 0.3 : 0.31), ...ornaments(narrow)];
  }, [auctions, market, live?.id]);

  const go = useCallback((m: Market | null) => {
    history.pushState({ sky: 1 }, "", m ? marketPath(m) : "/");
    setSelected(null); setMarket(m ?? undefined);
  }, []);
  useEffect(() => {
    const pop = () => { const m = skyOf(location.href); if (m !== undefined) { setSelected(null); setMarket(m ?? undefined); } };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  // The title and the heading follow the sky.
  useEffect(() => {
    const n = market ? auctions.filter((a) => marketOf(a.mode) === market).length : 0;
    document.title = market ? `${MODE_NAME[market]} – Benzo` : "Benzo – sealed-bid markets on Zcash";
    const h = document.querySelector("h1"); if (h) h.textContent = market ? `${MODE_NAME[market]}: ${n} rounds on Zcash testnet` : "Benzo · markets on Zcash testnet";
  }, [market, auctions.length]);
  const back = useCallback(() => { if (history.state?.sky) history.back(); else go(null); }, [go]);
  const navigate = useCallback((href: string) => { const m = skyOf(href); if (m === undefined) { location.href = href; return false; } go(m); return true; }, [go]);
  // A market's door under the pointer: draw that market's doodles now, so the swap after the click is instant.
  const warmed = useRef(new Set<string>());
  const warm = useCallback((d: FieldDoodle) => {
    const m = d.href ? skyOf(d.href) : undefined;
    if (!m || warmed.current.has(m)) return;
    warmed.current.add(m);
    for (const x of LIB.filter((x) => x.mode === m)) void doodleTexture(src(x.slug), 1024);
    for (const slug of ["quill", "emblem-lots", "emblem-bid"]) void doodleTexture(src(slug), 1024);
  }, []);

  const route = useCallback((d: FieldDoodle | null) => {
    window.history.replaceState({}, "", d?.auction ? `${base}?lot=${d.auction.id}` : base);
  }, [base]);
  const choose = useCallback((d: FieldDoodle) => { setSelected(d); route(d); }, [route]);
  const close = useCallback(() => { setSelected(null); route(null); }, [route]);
  useEffect(() => {
    // Escape closes the ticket first; with none open, a market's sky goes back to all markets.
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (selected) close(); else if (market) back(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [close, back, selected, market]);

  // Deep link ?lot=<id>: open its ticket here, or on its market's screen when this sky does not hold it.
  useEffect(() => {
    if (selected) return;
    const lot = new URLSearchParams(location.search).get("lot");
    if (!lot) return;
    const pick = doodles.find((x) => x.auction?.id === lot);
    if (pick) return setSelected(pick);
    const a = auctions.find((x) => x.id === lot);
    if (a && marketOf(a.mode) !== market) { history.replaceState({}, "", `${marketPath(marketOf(a.mode))}?lot=${lot}`); setMarket(marketOf(a.mode)); }
  }, [doodles.length]);

  useEffect(() => {
    setSigner(undefined);
    if (selected?.auction) api.auction(selected.auction.id).then((d) => setSigner(d.signer)).catch(() => {});
  }, [selected?.key]);

  const arrive = typeof document !== "undefined" && document.referrer.startsWith(location.origin);
  const doors = doodles.filter((d) => d.href);
  return (
    <div className="absolute inset-0 overflow-hidden bg-ground">
      <Field doodles={doodles} center={market ? MODE_NAME[market] : "Benzo"} onSelect={choose} onNavigate={navigate} onHover={warm} arrive={arrive} />
      {market && (
        <button type="button" onClick={back} data-testid="back" className="group absolute left-5 top-5 z-10 inline-flex h-11 items-center gap-1.5 font-sans text-[14px] text-sand/80 transition-colors hover:text-sand sm:left-7 sm:top-6">
          <svg className="size-4 transition-transform group-hover:-translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>All markets
        </button>
      )}
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
