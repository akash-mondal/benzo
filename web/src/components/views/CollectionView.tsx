// Specters: the demo collection the site's rounds sell. The page reads like a collection's home on a marketplace — the
// floor, what has sold, the volume, what is taking bids now, the pieces and the activity — except every figure comes
// from rounds anyone can verify, and every bid in them stayed sealed until its opening.
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { hashOf, isSpecter, specterNo, specterUri, traitsOf } from "../../lib/specter";
import type { AuctionSummary } from "../../lib/types";
import { Btn, Panel, Pill, cx, zats } from "../app/ui";

type Way = { key: string; mode: string; title: string; line: string; real: string; match: RegExp };
const WAYS: Way[] = [
  { key: "mint", mode: "uniform", title: "The mint", line: "A sealed uniform-price auction. The top bids win and every winner pays the same clearing price.", real: "How a 10,000-piece collection sells its first pieces: you can't overpay, you can only miss.", match: /^Specters mint/ },
  { key: "ones", mode: "drop", title: "One-of-ones", line: "One piece to the highest sealed bid, or a set of named pieces, each to its own highest bid.", real: "A weekly 1/1 sale, without a public bid ladder anyone can snipe or shill.", match: /one-of-one/ },
  { key: "buyback", mode: "buyback", title: "Floor buybacks", line: "The treasury buys pieces back at the lowest sealed asks, up to its budget.", real: "Where sale proceeds go: holders ask privately, so nobody front-runs the floor.", match: /floor buyback/ },
  { key: "otc", mode: "otc", title: "Private sales", line: "One buyer, one seller, two sealed limits. A trade only if they cross.", real: "A grail changing hands without either side showing their number first.", match: /private sale/ },
  { key: "rfq", mode: "rfq", title: "Commissions", line: "Ask invited artists for sealed quotes. The lowest wins and is paid the second-lowest.", real: "Hiring an artist or an auditor without a public race to the bottom.", match: /^Commission/ },
];
const wayOf = (a: AuctionSummary) => WAYS.find((w) => w.match.test(a.lot ?? ""));
const done = (a: AuctionSummary) => !a.owed && (a.state === "SETTLED" || Boolean(a.finished));
const ago = (t: number) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
// The pieces a settled mint or one-of-ones round sold: numbers drawn from the round, so a round always shows the same ones.
const piecesOf = (a: AuctionSummary) => /#\s?\d/.test(a.lot ?? "") && Number(a.outcome?.filled ?? 0) > 0 ? [specterNo(a.lot ?? "")] : Array.from({ length: Math.min(6, Number(a.outcome?.filled ?? 0)) }, (_, i) => (hashOf(`${a.id}:${i}`) % 9999) + 1);

function Art({ no, className }: { no: number; className?: string }) {
  return <img src={specterUri(no)} alt={`Specter #${no}`} className={cx("rounded-[18%] ring-1 ring-[#ddd6c62e] [image-rendering:pixelated]", className)} />;
}

export default function CollectionView({ initial }: { initial: AuctionSummary[] }) {
  const [list, setList] = useState(initial);
  const [loaded, setLoaded] = useState(initial.length > 0);
  useEffect(() => {
    const pull = () => api.auctions().then((l) => { setList(l); setLoaded(true); }).catch(() => {});
    void pull(); const t = setInterval(() => { if (!document.hidden) void pull(); }, 20_000); return () => clearInterval(t);
  }, []);
  const mine = useMemo(() => list.filter((a) => isSpecter(a.lot) && wayOf(a)), [list]);
  const settled = mine.filter(done).sort((a, b) => b.updated - a.updated);
  const live = mine.filter((a) => a.live && a.free_slots !== 0 && a.T_submit - Date.now() / 1000 > 480).sort((a, b) => b.T_submit - a.T_submit);
  const mints = settled.filter((a) => wayOf(a)?.key === "mint" && Number(a.clearing_price_zats ?? 0) > 0);
  const floor = mints[0] ? Number(mints[0].clearing_price_zats) : null;
  const sold = settled.filter((a) => ["mint", "ones", "otc"].includes(wayOf(a)!.key)).reduce((n, a) => n + Number(a.outcome?.filled ?? 0), 0);
  const volume = settled.reduce((n, a) => n + Number(a.outcome?.paid_zats ?? 0), 0);
  const bought = settled.filter((a) => wayOf(a)?.key === "buyback").reduce((n, a) => n + Number(a.outcome?.filled ?? 0), 0);
  const pieces = settled.filter((a) => ["mint", "ones"].includes(wayOf(a)!.key)).flatMap((a) => piecesOf(a).map((no) => ({ no, a }))).slice(0, 24);
  const hero = pieces[0]?.no ?? 417;
  const fig = (k: string, v: string, gold?: boolean) => <div className="min-w-0"><div className="text-[12px] text-app-faint">{k}</div><div className={cx("serif-figure mt-0.5 text-[24px] leading-tight", gold ? "chrome" : "text-[#f3eee2]")}>{loaded ? v : "…"}</div></div>;
  const event = (a: AuctionSummary) => {
    const w = wayOf(a)!, f = Number(a.outcome?.filled ?? 0), of = Number(a.outcome?.of ?? 0), p = Number(a.clearing_price_zats ?? 0);
    if (!f) return `${w.title}: no trade, every deposit refunded`;
    if (w.key === "mint") return `Mint cleared ${f} of ${of} at ${zats(p)} zats each`;
    if (w.key === "ones") return `${f} one-of-one${f > 1 ? "s" : ""} sold for ${zats(Number(a.outcome?.paid_zats ?? 0))} zats in all`;
    if (w.key === "buyback") return `Treasury bought back ${f} at ${zats(p)} zats`;
    if (w.key === "otc") return `Private sale traded at ${zats(p)} zats`;
    return `Commission awarded at ${zats(p)} zats`;
  };
  return (
    <div className="grid gap-6" data-testid="collection">
      {/* The collection's head: its picture, what it is, and its figures. */}
      <Panel className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <Art no={hero} className="size-28 sm:size-36" />
        <div className="min-w-0">
          <div className="text-[13px] text-app-faint">Demo collection · Zcash testnet</div>
          <h1 className="serif-figure text-[40px] leading-tight text-[#f3eee2]">Specters</h1>
          <p className="mt-1 max-w-[62ch] text-[15px] text-app-muted">10,000 pixel ghosts, sold every way a collection sells. Every bid is sealed until its round opens, nobody (the site included) can read one early, and every figure on this page comes from rounds anyone can check.</p>
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {fig("Last mint price", floor !== null ? `${zats(floor)} zats` : "—", true)}
            {fig("Pieces sold", String(sold))}
            {fig("Volume", `${zats(volume)} zats`)}
            {fig("Bought back", String(bought))}
          </div>
        </div>
      </Panel>

      {/* Taking bids now, with each round's art and a way in. */}
      <section>
        <div className="mb-3 flex items-baseline justify-between"><h2 className="text-[20px]">Taking sealed bids now</h2><a href="/lots/?stage=open" className="text-[13px] text-app-muted hover:text-app-text">All rounds taking bids →</a></div>
        {!live.length ? <Panel><p className="text-[14px] text-app-muted">{loaded ? "No Specters round is taking bids this minute. A new one starts every few minutes; the latest results are below." : "Loading…"}</p></Panel> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.slice(0, 6).map((a) => { const w = wayOf(a)!; return (
              <li key={a.id}><a href={`/auction/?id=${a.id}`} className="flex items-center gap-4 rounded-[18px] bg-app-1 p-4 ring-1 ring-app-line hover:bg-[#232b1dd0]" data-testid="collection-live">
                <Art no={specterNo(a.lot ?? "")} className="size-16" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{a.lot}</span><span className="block text-[13px] text-app-muted">{w.title} · {a.leaf_count ?? a.counted ?? 0} sealed bids</span><span className="mt-1 inline-block"><Pill kind="live">Bid now</Pill></span></span>
              </a></li>); })}
          </ul>
        )}
      </section>

      {/* The five ways it sells: one market each, each with its rounds and a way to start one. */}
      <section>
        <h2 className="mb-1 text-[20px]">One collection, five ways to sell it</h2>
        <p className="mb-3 text-[14px] text-app-muted">Each is a Benzo market. Same sealed bids, same shielded deposits, same two-of-three signers; only the rule that sets the price changes.</p>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {WAYS.map((w) => { const n = mine.filter((a) => wayOf(a) === w), s = n.filter(done).length; return (
            <li key={w.key} className="flex flex-col rounded-[18px] bg-app-1 p-5 ring-1 ring-app-line" data-testid={`way-${w.key}`}>
              <div className="serif-figure text-[22px] text-[#f3eee2]">{w.title}</div>
              <p className="mt-1 text-[13.5px] text-app-text">{w.line}</p>
              <p className="mt-2 flex-1 text-[13px] text-app-muted">{w.real}</p>
              <div className="mt-3 text-[12.5px] text-app-faint tabular-nums">{n.length} rounds · {s} finished</div>
              <div className="mt-3 flex flex-wrap gap-2"><Btn href={`/lots/?market=${w.mode}&q=${encodeURIComponent(w.key === "rfq" ? "Commission" : "Specter")}`} kind="secondary">See these rounds</Btn></div>
            </li>); })}
        </ul>
      </section>

      {/* The pieces sold so far, and the activity. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section>
          <h2 className="mb-3 text-[20px]">Pieces sold</h2>
          {!pieces.length ? <Panel><p className="text-[14px] text-app-muted">{loaded ? "No piece has sold yet." : "Loading…"}</p></Panel> : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">
              {pieces.map(({ no, a }) => { const t = traitsOf(no); return (
                <li key={`${a.id}:${no}`}><a href={`/auction/?id=${a.id}`} className="block rounded-[14px] bg-app-1 p-2 ring-1 ring-app-line hover:bg-[#232b1dd0]" title={`${t.lineage} · ${t.sheet} · ${t.eyes} · ${t.crown}`}>
                  <Art no={no} className="aspect-square w-full" />
                  <div className="mt-1.5 truncate text-[12.5px] font-medium">Specter #{no}</div>
                  <div className="truncate text-[11.5px] text-app-faint tabular-nums">{wayOf(a)?.key === "mint" ? `minted at ${zats(Number(a.clearing_price_zats ?? 0))}` : "one-of-one"}</div>
                </a></li>); })}
            </ul>
          )}
        </section>
        <section>
          <h2 className="mb-3 text-[20px]">Activity</h2>
          <Panel pad={false}>
            <ul data-testid="collection-activity">
              {settled.slice(0, 14).map((a) => (
                <li key={a.id}><a href={`/auction/?id=${a.id}`} className="flex items-center gap-3 border-t border-app-line px-4 py-3 first:border-t-0 hover:bg-app-2">
                  <Art no={specterNo(a.lot ?? "")} className="size-9" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{event(a)}</span><span className="block truncate text-[12px] text-app-faint">{a.lot}</span></span>
                  <span className="shrink-0 text-[12px] text-app-faint tabular-nums">{ago(a.updated)}</span>
                </a></li>))}
              {!settled.length && <li className="px-4 py-4 text-[14px] text-app-muted">{loaded ? "Nothing has finished yet." : "Loading…"}</li>}
            </ul>
          </Panel>
        </section>
      </div>
    </div>
  );
}
