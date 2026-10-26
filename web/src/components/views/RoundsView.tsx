// All rounds (after Fragment's auction table and Stripe's searchable lists): one row per round with what happened and
// when; search by name or id; filter by market and stage; the filters live in the link. The page ships the list as it
// was at build time, then keeps it current from the gateway, so a round that settles reads as settled without a rebuild.
import { useEffect, useMemo, useState } from "react";
import { api, MODE_NAME, utc } from "../../lib/api";
import { glyphFor, marketOf, MARKETS } from "../../lib/glyphs";
import { outcomeLine, traded } from "../../lib/outcome";
import Stats from "../dash/Stats";
import Activity from "../dash/Activity";
import { Glyph, PageHead, Pill, claimDoor } from "../app/ui";
import type { AuctionSummary } from "../../lib/types";

// Stage, from the round's own state (never guessed from its age).
const stageOf = (a: AuctionSummary) => (a.live ? "open" : a.state === "SETTLED" ? "settled" : a.state === "CANCELLED" ? "cancelled" : "running");
const STAGE: Record<string, [string, "live" | "wait" | "good" | "plain"]> = { open: ["Taking bids", "live"], running: ["In progress", "wait"], settled: ["Settled", "good"], cancelled: ["Cancelled", "plain"] };
const TABS: [string, string][] = [["all", "All"], ["open", "Taking bids"], ["running", "In progress"], ["settled", "Settled"], ["cancelled", "Cancelled"]];
const order = (l: AuctionSummary[]) => [...l].sort((a, b) => Number(b.live) - Number(a.live) || b.updated - a.updated);
const local = (unix: number) => {
  const d = new Date(unix * 1000), hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${hm}`;
};

export default function RoundsView({ initial }: { initial: AuctionSummary[] }) {
  const [list, setList] = useState(() => order(initial));
  const [ready, setReady] = useState(false);
  const [market, setMarket] = useState(""), [q, setQ] = useState(""), [tab, setTab] = useState("all"), [shown, setShown] = useState(25);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setMarket(p.get("market") ?? ""); setQ(p.get("q") ?? ""); setTab(p.get("stage") ?? "all"); setReady(true);
    const pull = () => api.auctions().then((l) => setList(order(l))).catch(() => {});
    void pull();
    const t = setInterval(() => { if (!document.hidden) void pull(); }, 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const u = new URL(location.href);
    for (const [k, v] of [["market", market], ["stage", tab === "all" ? "" : tab], ["q", q.trim()]]) v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
    history.replaceState(history.state, "", u);
  }, [market, tab, q, ready]);

  const now = Date.now() / 1000;
  const settled = list.filter((a) => a.state === "SETTLED");
  const counts = useMemo(() => list.reduce((m, a) => m.set(a.lot ?? "", (m.get(a.lot ?? "") ?? 0) + 1), new Map<string, number>()), [list]);
  const text = q.trim().toLowerCase();
  const base = list.filter((a) => (!market || marketOf(a.mode) === market) && (!text || `${(a.lot ?? "").toLowerCase()} ${a.id}`.includes(text)));
  const match = base.filter((a) => tab === "all" || stageOf(a) === tab);
  const visible = new Set(match.slice(0, shown).map((a) => a.id));
  const reset = () => setShown(25);
  const tabName = TABS.find(([k]) => k === tab)?.[1].toLowerCase() ?? "";

  return (
    <div>
      <PageHead glyph="emblem-lots" title="All rounds" sub={<><span id="count">{match.length}</span> rounds on Zcash testnet</>} />
      {/* The overview: what's been run, what moved, what's open; then rounds per day. Everything from the published rounds. */}
      <Stats className="mt-8" items={[
        { label: "Rounds settled", value: settled.length, note: `${settled.filter(traded).length} traded, the rest refunded`, testid: "stat-settled" },
        { label: "Paid to winners and sellers", value: settled.reduce((n, a) => n + (traded(a) ? Number(a.outcome?.paid_zats ?? 0) : 0), 0), unit: "zats", gold: true, note: "through settled rounds", testid: "stat-paid" },
        { label: "Sealed bids", value: list.reduce((n, a) => n + (a.leaf_count ?? 0), 0), note: "opened after bidding closed", testid: "stat-bids" },
        { label: "Taking bids now", value: list.filter((a) => a.live).length, note: list.some((a) => a.live) ? list.filter((a) => a.live).map((a) => MODE_NAME[a.mode]).join(", ") : "None right now", testid: "stat-live" },
      ]} />
      <div className="mt-3"><Activity list={list} /></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <label className="sr-only" htmlFor="q">Search round name or id</label>
        <input id="q" type="search" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search round name or id" autoComplete="off" spellCheck={false} className="h-10 rounded-[10px] bg-app-1 px-3 text-[15px] text-app-text outline-none ring-1 ring-transparent placeholder:text-app-faint focus:ring-gold/70" />
        <label className="sr-only" htmlFor="market">Market</label>
        <select id="market" value={market} onChange={(e) => { setMarket(e.target.value); reset(); }} className="h-10 rounded-[10px] bg-app-1 px-3 text-[15px] text-app-text outline-none focus:ring-1 focus:ring-gold/70">
          <option value="">All markets</option>
          {MARKETS.map((m) => <option key={m} value={m}>{MODE_NAME[m]}</option>)}
        </select>
      </div>
      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Stage">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" data-tab={k} aria-selected={tab === k} onClick={() => { setTab(k); reset(); }} className="h-8 rounded-full px-3 text-[14px] text-app-muted hover:text-app-text aria-selected:bg-app-2 aria-selected:text-app-text">
            {label} <span className="tabular-nums text-app-faint">{base.filter((a) => k === "all" || stageOf(a) === k).length}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-[22px] bg-app-1 ring-1 ring-app-line backdrop-blur-xl">
        <div className="hidden grid-cols-[minmax(0,1fr)_130px_minmax(0,260px)_150px] gap-4 px-5 pb-2 pt-4 text-[13px] text-app-faint md:grid"><span>Round</span><span>Stage</span><span>Result</span><span className="text-right">Last update</span></div>
        <ul id="rows">
          {list.map((a) => { const st = stageOf(a); return (
            <li key={a.id} hidden={!visible.has(a.id)}>
              <a href={`/auction/?id=${a.id}`} onClick={(e) => claimDoor(e.currentTarget)} data-testid="lot-row" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-app-line px-5 py-3.5 transition-colors hover:bg-app-2 md:grid-cols-[minmax(0,1fr)_130px_minmax(0,260px)_150px]">
                <span className="flex min-w-0 items-center gap-3">
                  <Glyph name={glyphFor(a.mode, a.id)} className="size-9" />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-app-text">{a.lot ?? MODE_NAME[a.mode]}{(counts.get(a.lot ?? "") ?? 0) > 1 && <span className="text-app-faint"> · {a.id.slice(0, 6)}</span>}</span>
                    <span className="block text-[13px] text-app-faint">{MODE_NAME[a.mode]} · {a.leaf_count ?? 0} bids</span>
                  </span>
                </span>
                <span><Pill kind={STAGE[st][1]}>{STAGE[st][0]}</Pill></span>
                <span className="col-span-2 truncate text-[14px] text-app-muted tabular-nums md:col-span-1 md:text-app-text">{outcomeLine(a)}{st === "running" && now - a.updated > 6 * 3600 ? " · no update for a while" : ""}</span>
                <time dateTime={new Date(a.updated * 1000).toISOString()} className="col-span-2 text-[13px] text-app-faint tabular-nums md:col-span-1 md:text-right md:text-app-muted">{ready ? local(a.updated) : utc(a.updated)}</time>
              </a>
            </li>); })}
        </ul>
        {match.length === 0 && (
          <div className="border-t border-app-line px-5 py-6 text-[14px] text-app-muted">
            No {tab === "all" ? "" : tabName + " "}{market ? MODE_NAME[market] + " " : ""}rounds{text ? ` match "${q.trim()}"` : ""}.{" "}
            <button type="button" onClick={() => { setTab("all"); setMarket(""); setQ(""); reset(); }} className="ml-1 text-app-text underline underline-offset-4">Clear filters</button>
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-app-faint">
        <span>{match.length ? `Showing ${Math.min(shown, match.length)} of ${match.length}` : ""}</span>
        {match.length > shown && <button type="button" onClick={() => setShown((n) => n + 25)} className="h-10 rounded-full bg-app-1 px-5 text-[14px] font-semibold text-app-text hover:bg-app-2">Show 25 more</button>}
      </div>
    </div>
  );
}
