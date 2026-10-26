// The home page: one full-screen sky. The field of every auction that ran on Zcash testnet through Benzo (each doodle is one auction,
// drawn with one of its mode's glyphs), the pieces that keep a bid sealed, and ornaments; plus the ticket a click
// opens (bottom-left), and five floating words that are the site's pages. Nothing else is on the page.
import { useCallback, useEffect, useMemo, useState } from "react";
import Field from "./Field";
import Card from "./Card";
import { api, MODE_NAME } from "../../lib/api";
import { LIB, glyphFor, src } from "../../lib/glyphs";
import type { AuctionSummary, FieldDoodle, FieldWord } from "../../lib/types";

const DAY = 24 * 3600, PER_MODE = 8;
const IN_PROGRESS = new Set(["OPEN", "FROZEN", "SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "REFUNDING"]);
// Every finished round, and in-progress ones only while they are really moving (old test runs left mid-way stay out).
// Refunded rounds are listed on /lots; the sky shows what settled and what is running.
const showable = (a: AuctionSummary, now: number) => a.live || a.state === "SETTLED" || (IN_PROGRESS.has(a.state) && now - a.updated < DAY / 4);
const tagOf = (a: AuctionSummary) => (a.live ? "Live" : a.state === "CANCELLED" ? "Refunded" : a.state === "SETTLED" ? "Settled" : "Running");

const glyphs: FieldDoodle[] = LIB.filter((d) => d.group !== "page").map((d) => ({ key: `g:${d.slug}`, src: src(d.slug), name: d.name, slug: d.slug, category: d.category, group: d.group as FieldDoodle["group"], tag: null }));
export const auctionDoodle = (a: AuctionSummary): FieldDoodle => ({
  key: `a:${a.id}`, src: src(glyphFor(a.mode, a.id)), slug: glyphFor(a.mode, a.id), name: a.lot ?? `${MODE_NAME[a.mode]} ${a.id.slice(0, 6)}`,
  category: MODE_NAME[a.mode], group: "auction", tag: tagOf(a), scale: a.live ? 1.35 : 1, auction: a,
});

export default function Sky({ initial, initialSlug }: { initial: AuctionSummary[]; initialSlug?: string }) {
  const [auctions, setAuctions] = useState<AuctionSummary[]>(initial);
  const [selected, setSelected] = useState<FieldDoodle | null>(null);
  const [signer, setSigner] = useState<string | undefined>();

  useEffect(() => {
    let gone = false;
    const load = () => api.auctions().then((a) => { if (!gone) setAuctions(a); }).catch(() => {});
    load();
    const t = window.setInterval(load, 30_000);
    return () => { gone = true; window.clearInterval(t); };
  }, []);

  const doodles = useMemo<FieldDoodle[]>(() => {
    // A phone gets half the sky: the same tile in a narrow window would be packed solid.
    const narrow = typeof window !== "undefined" && window.innerWidth < 640, perMode = narrow ? 3 : PER_MODE;
    const now = Date.now() / 1000, seen: Record<string, number> = {};
    const lots = auctions.filter((a) => showable(a, now)).filter((a) => a.live || (seen[a.mode] = (seen[a.mode] ?? 0) + 1) <= perMode).map(auctionDoodle);
    if (narrow) return [...lots, ...glyphs.filter((d, i) => d.group !== "ornament" || i % 2 === 0)];
    const again = glyphs.filter((d) => d.group === "ornament").map((d) => ({ ...d, key: `${d.key}:2` }));
    return [...lots, ...glyphs, ...again];
  }, [auctions]);

  const route = useCallback((d: FieldDoodle | null) => {
    window.history.replaceState({}, "", !d ? "/" : d.auction ? `/?lot=${d.auction.id}` : `/doodles/${d.slug}`);
  }, []);
  const choose = useCallback((d: FieldDoodle) => { setSelected(d); route(d); }, [route]);
  const close = useCallback(() => { setSelected(null); route(null); }, [route]);
  // Escape closes the ticket. The sky owns the key (always mounted), so it works from the ticket's first frame.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [close]);

  // Deep links: /?lot=<auction id> and /doodles/<slug>.
  useEffect(() => {
    if (selected) return;
    const lot = new URLSearchParams(location.search).get("lot");
    const slug = initialSlug ?? location.pathname.match(/^\/doodles\/([a-z0-9-]+)/)?.[1];
    const pick = (lot && doodles.find((x) => x.auction?.id === lot)) || (slug && glyphs.find((x) => x.slug === slug));
    if (pick) setSelected(pick);
  }, [doodles.length]);

  const live = auctions.find((a) => a.live && a.state === "OPEN");
  const words = useMemo<FieldWord[]>(() => [
    { label: "Benzo", scale: 2.6, href: "/how/", tag: "How it works" },
    { label: "bid live", scale: 1.3, href: live ? `/bid/?id=${live.id}` : "/bid/", tag: live ? "Open now" : "Next round" },
    { label: "verify", scale: 1.3, href: "/verify/", tag: "Anyone can" },
    { label: "every lot", scale: 1.2, href: "/lots/", tag: `${auctions.length} rounds` },
  ], [live?.id, auctions.length]);

  useEffect(() => {
    setSigner(undefined);
    if (selected?.auction) api.auction(selected.auction.id).then((d) => setSigner(d.signer)).catch(() => {});
  }, [selected?.key]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-ground">
      <Field doodles={doodles} words={words} onSelect={choose} onWord={(w) => { location.href = w.href; }} />
      {selected && <div className="absolute bottom-14 left-5 z-20 sm:bottom-16 sm:left-7"><Card doodle={selected} signer={signer} onClose={close} /></div>}
      <nav className="sr-only" aria-label="Every doodle in the field">
        <ul>{doodles.map((d) => <li key={d.key}>{d.auction ? <a href={`/auction/?id=${d.auction.id}`}>{d.name} ({d.category}, {d.tag})</a> : <button type="button" onClick={() => choose(d)}>{d.name} ({d.category})</button>}</li>)}</ul>
      </nav>
    </div>
  );
}
