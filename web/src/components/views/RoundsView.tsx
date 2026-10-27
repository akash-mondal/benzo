// All rounds (after Fragment's auction table and Stripe's searchable lists): one row per round with what happened and
// when; search by name or id; filter by market and stage; the filters live in the link. The page ships the list as it
// was at build time, then keeps it current from the gateway, so a round that settles reads as settled without a rebuild.
import { useEffect, useMemo, useState } from "react";
import { api, MODE_NAME, utc } from "../../lib/api";
import { DOOR, glyphFor, marketOf, MARKETS } from "../../lib/glyphs";
import { outcomeLine, traded } from "../../lib/outcome";
import Activity from "../dash/Activity";
import { Glyph, Pager, Pill, claimDoor, cx, useFitRows, LotArt } from "../app/ui";
import type { AuctionSummary } from "../../lib/types";

// Stage, from the round's own state (never guessed from its age).
const stageOf = (a: AuctionSummary) => (a.live && a.free_slots === 0 ? "full" : a.live ? "open" : a.state === "SETTLED" || a.finished ? "settled" : a.state === "CANCELLED" ? "cancelled" : a.stopped ? "stopped" : "running");
const STAGE: Record<string, [string, "live" | "wait" | "good" | "plain"]> = { open: ["Taking bids", "live"], full: ["Full", "plain"], running: ["In progress", "wait"], settled: ["Settled", "good"], cancelled: ["Cancelled", "plain"], stopped: ["Stopped", "plain"] };
const TABS: [string, string][] = [["all", "All"], ["open", "Taking bids"], ["running", "In progress"], ["settled", "Settled"], ["cancelled", "Cancelled"], ["stopped", "Stopped"]];
const order = (l: AuctionSummary[]) => [...l].sort((a, b) => Number(b.live) - Number(a.live) || b.updated - a.updated);
const local = (unix: number) => {
  const d = new Date(unix * 1000), hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${hm}`;
};

export default function RoundsView({ initial }: { initial: AuctionSummary[] }) {
  const [list, setList] = useState(() => order(initial));
  const [ready, setReady] = useState(false);
  // Until the first fetch lands, an empty list means "not loaded yet", never "no rounds".
  const [loaded, setLoaded] = useState(initial.length > 0);
  const [market, setMarket] = useState(""), [q, setQ] = useState(""), [tab, setTab] = useState("all"), [page, setPage] = useState(0);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setMarket(p.get("market") ?? ""); setQ(p.get("q") ?? ""); setTab(p.get("stage") ?? "all"); setReady(true);
    const pull = () => api.auctions().then((l) => { setList(order(l)); setLoaded(true); }).catch(() => {});
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
  // The ribbon's figures follow the market filter, so a market's page never shows another market's totals.
  const scope = market ? list.filter((a) => marketOf(a.mode) === market) : list;
  const settled = scope.filter((a) => stageOf(a) === "settled");
  const counts = useMemo(() => list.reduce((m, a) => m.set(a.lot ?? "", (m.get(a.lot ?? "") ?? 0) + 1), new Map<string, number>()), [list]);
  const text = q.trim().toLowerCase();
  const base = list.filter((a) => (!market || marketOf(a.mode) === market) && (!text || `${(a.lot ?? "").toLowerCase()} ${a.id}`.includes(text)));
  const match = base.filter((a) => tab === "all" || stageOf(a) === tab);
  const reset = () => setPage(0);
  const tabName = TABS.find(([k]) => k === tab)?.[1].toLowerCase() ?? "";

  // Rows per page: as many as fit the table on a one-window screen; small screens scroll and get 25.
  const [rowsRef, rows] = useFitRows(56, 25);
  const pages = Math.max(1, Math.ceil(match.length / rows));
  const pg = Math.min(page, pages - 1);
  const shownIds = new Set(match.slice(pg * rows, pg * rows + rows).map((a) => a.id));
  const paidOut = settled.reduce((n, a) => n + (traded(a) ? Number(a.outcome?.paid_zats ?? 0) : 0), 0);
  const liveNow = scope.filter((a) => a.live);
  const ribbon0: [string, string, boolean?][] = [
    ["Rounds settled", `${settled.length.toLocaleString("en-US")}`], ["Traded", `${settled.filter(traded).length}`], ["Paid to winners and sellers", `${paidOut.toLocaleString("en-US")} zats`, true],
    ["Sealed bids", scope.reduce((n, a) => n + (a.leaf_count ?? a.counted ?? 0), 0).toLocaleString("en-US")], ["Taking bids now", liveNow.length ? `${liveNow.length} round${liveNow.length === 1 ? "" : "s"}` : "none"],
  ];
  const ribbon: [string, string, boolean?][] = loaded ? ribbon0 : ribbon0.map(([k, , g]) => [k, "…", g]);
  const byMarket = MARKETS.map((m) => { const r = list.filter((a) => marketOf(a.mode) === m), st = r.filter((a) => a.state === "SETTLED"); return { m, n: r.length, traded: st.filter(traded).length, paid: st.reduce((x, a) => x + (traded(a) ? Number(a.outcome?.paid_zats ?? 0) : 0), 0) }; });

  return (
    <div className="flex flex-col gap-2 fit:min-h-0 fit:flex-1">
      {/* The ribbon: the page's doodle and title, then the figures an exchange's markets page leads with. */}
      <div className="flex flex-col gap-3 rounded-[14px] bg-app-1 px-3 py-2 ring-1 ring-app-line backdrop-blur-xl lg:flex-row lg:items-center lg:gap-6">
        <div className="flex items-center gap-3 px-2 py-1">
          <Glyph name="emblem-lots" className="page-door size-10" />
          <div><h1 className="text-[21px] leading-tight">All rounds</h1><div className="text-[12px] text-app-faint"><span id="count">{loaded ? match.length : "…"}</span> {match.length === 1 ? "round" : "rounds"}{market ? ` of ${MODE_NAME[market]}` : ""} on Zcash testnet · during judging, a fleet of test bidders runs here too, so you can see Benzo under load</div></div>
        </div>
        <div className="hidden h-9 w-px bg-app-line lg:block" />
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2.5 px-2 pb-1 sm:grid-cols-3 lg:flex lg:items-center lg:gap-x-7 lg:p-0">
          {ribbon.map(([k, v, gold]) => (
            <div key={k} className="min-w-0 shrink-0"><dt className="text-[11.5px] text-app-faint">{k}</dt><dd className={cx("mt-0.5 truncate whitespace-nowrap text-[14px] tabular-nums", gold ? "chrome serif-figure text-[17px] leading-[1.1]" : "text-app-text")} data-testid={`stat-${k.split(" ")[0].toLowerCase()}`}>{v}</dd></div>
          ))}
        </dl>
      </div>

      <div className="grid gap-2 fit:min-h-0 fit:flex-1 lg:grid-cols-[minmax(0,1fr)_356px]">
        {/* The rounds table: stage tabs, search, market; pages instead of scrolling. */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] bg-app-1 ring-1 ring-app-line backdrop-blur-xl">
          <div className="flex flex-wrap items-stretch justify-between gap-x-4 gap-y-2 border-b border-app-line px-3 pt-1.5 lg:h-11 lg:flex-nowrap lg:pt-0">
            <div className="flex items-stretch gap-4 overflow-x-auto" role="tablist" aria-label="Stage">
              {TABS.map(([k, label]) => (
                <button key={k} type="button" role="tab" data-tab={k} aria-selected={tab === k} onClick={() => { setTab(k); reset(); }}
                  className={cx("-mb-px whitespace-nowrap border-b-2 px-0.5 py-2 text-[13px] transition-colors", tab === k ? "border-gold text-app-text" : "border-transparent text-app-faint hover:text-app-muted")}>
                  {label} <span className="tabular-nums text-app-faint">{base.filter((a) => k === "all" || stageOf(a) === k).length}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pb-1.5 lg:pb-0">
              <label className="sr-only" htmlFor="q">Search round name or id</label>
              <input id="q" type="search" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search name or id" autoComplete="off" spellCheck={false} className="h-8 w-[180px] rounded-lg bg-[#0f140cb3] px-2.5 text-[13px] text-app-text outline-none ring-1 ring-app-line placeholder:text-app-faint focus:ring-[#ddd6c680]" />
              <label className="sr-only" htmlFor="market">Market</label>
              <select id="market" value={market} onChange={(e) => { setMarket(e.target.value); reset(); }} className="h-8 rounded-lg bg-[#0f140cb3] px-2 text-[13px] text-app-text outline-none ring-1 ring-app-line focus:ring-[#ddd6c680]">
                <option value="">All markets</option>
                {MARKETS.map((m) => <option key={m} value={m}>{MODE_NAME[m]}</option>)}
              </select>
            </div>
          </div>
          <div className="hidden grid-cols-[minmax(0,1.4fr)_120px_110px_minmax(0,1.2fr)_52px_110px] gap-4 px-4 py-2 text-[11.5px] text-app-faint md:grid"><span>Round</span><span>Market</span><span>Stage</span><span>Result</span><span className="text-right">Bids</span><span className="text-right">Updated</span></div>
          <div ref={rowsRef} className="min-h-0 flex-1 fit:overflow-hidden">
            <ul id="rows">
              {list.map((a) => { const st = stageOf(a); return (
                <li key={a.id} hidden={!shownIds.has(a.id)}>
                  <a href={`/auction/?id=${a.id}`} onClick={(e) => claimDoor(e.currentTarget)} data-testid="lot-row" className="grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-app-line px-4 transition-colors hover:bg-[#ddd6c60d] md:grid-cols-[minmax(0,1.4fr)_120px_110px_minmax(0,1.2fr)_52px_110px]">
                    <span className="flex min-w-0 items-center gap-3">
                      <LotArt lot={a.lot} glyph={glyphFor(a.mode, a.id)} className="size-8" />
                      <span className="min-w-0"><span className="block truncate text-[14px] text-app-text">{a.lot ?? MODE_NAME[a.mode]}</span><span className="block truncate text-[12px] text-app-faint md:hidden">{MODE_NAME[a.mode]} · {outcomeLine(a)}</span><span className="hidden text-[12px] text-app-faint md:block">{a.id.slice(0, 8)}</span></span>
                    </span>
                    <span className="hidden truncate text-[13px] text-app-muted md:block">{MODE_NAME[a.mode]}</span>
                    <span><Pill kind={STAGE[st][1]}>{STAGE[st][0]}</Pill></span>
                    <span className="hidden truncate text-[13px] text-app-text tabular-nums md:block">{outcomeLine(a)}{st === "running" && now - a.updated > 6 * 3600 ? " · stalled" : ""}</span>
                    <span className="hidden text-right text-[13px] tabular-nums text-app-muted md:block">{a.leaf_count ?? 0}</span>
                    <time dateTime={new Date(a.updated * 1000).toISOString()} className="hidden text-right text-[12.5px] tabular-nums text-app-muted md:block">{ready ? local(a.updated) : utc(a.updated)}</time>
                  </a>
                </li>); })}
            </ul>
            {match.length === 0 && !loaded && <div className="border-t border-app-line px-4 py-6 text-[14px] text-app-muted" data-testid="rounds-loading">Loading rounds…</div>}
            {match.length === 0 && loaded && (
              <div className="border-t border-app-line px-4 py-6 text-[14px] text-app-muted">
                No {tab === "all" ? "" : tabName + " "}{market ? MODE_NAME[market] + " " : ""}rounds{text ? ` match "${q.trim()}"` : ""}.{" "}
                <button type="button" onClick={() => { setTab("all"); setMarket(""); setQ(""); reset(); }} className="ml-1 text-app-text underline underline-offset-4">Clear filters</button>
              </div>
            )}
          </div>
          <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-app-line px-4">
            <span className="text-[12px] text-app-faint">{liveNow.length ? `${liveNow.length} taking bids now` : "Newest first"}</span>
            <Pager page={pg} size={rows} total={match.length} onPage={setPage} testid="pager" />
          </div>
        </section>

        {/* Beside it: rounds per day, then each market at a glance (click one to filter). */}
        <div className="grid min-h-0 gap-2 fit:grid-rows-[minmax(0,1fr)_auto]">
          <Activity list={list} className="h-[320px] fit:h-full" />
          <section className="rounded-[14px] bg-app-1 ring-1 ring-app-line backdrop-blur-xl" data-testid="by-market">
            <div className="grid grid-cols-[minmax(0,1fr)_52px_60px] gap-2 border-b border-app-line px-4 py-2 text-[11.5px] text-app-faint"><span>Market</span><span className="text-right">Rounds</span><span className="text-right">Traded</span></div>
            {byMarket.map(({ m, n, traded: t }) => (
              <button key={m} type="button" onClick={() => { setMarket(market === m ? "" : m); reset(); }} aria-pressed={market === m}
                className={cx("grid w-full grid-cols-[minmax(0,1fr)_52px_60px] items-center gap-2 px-4 py-1.5 text-left text-[13px] transition-colors hover:bg-[#ddd6c60d]", market === m && "bg-[#e9cd8414]")}>
                <span className="flex min-w-0 items-center gap-2.5"><Glyph name={DOOR[m]} className="size-5" /><span className="truncate">{MODE_NAME[m]}</span></span>
                <span className="text-right tabular-nums text-app-muted">{n}</span><span className="text-right tabular-nums text-app-muted">{n ? `${t}` : "—"}</span>
              </button>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
