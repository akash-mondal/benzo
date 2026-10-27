// One round, as a trading terminal (after Hyperliquid, Binance, Kraken Pro, Bybit, OKX and Deribit), mapped one to one:
//   market switcher → round switcher        stats ribbon → round ribbon (price, deposit, units, bids, closing, opening)
//   chart + timeframes → Ladder / Depth / Timeline (sealed bars before opening)
//   order book → sealed book (•••• until opening, then priced, winners above the clearing row) · trades → activity
//   order ticket → the bid ticket (seal, pay, track) while bidding is open; afterwards the result and "find your bid"
//   positions / orders / history → Bids · Payments · Checks · Terms        status bar → testnet, block, drand round
// On a laptop or bigger it is exactly one window; panels scroll inside themselves, the page never does.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, MODE_NAME, short } from "../../lib/api";
import { outcomeLine } from "../../lib/outcome";
import { glyphFor } from "../../lib/glyphs";
import BidLadder, { type LadderRow } from "../dash/BidLadder";
import Depth from "../dash/Depth";
import { WhoSees } from "../app/WhoSees";
import { BidTicket, Terms, roleOf } from "./BidView";
import { currentAttempt } from "../../lib/mine";
import { Btn, Copyable, ErrorLine, Glyph, Pill, StatePill, Tick, Timeline, checkName, cx, fieldCls, rel, when, zats } from "../app/ui";
import { clock, useCountdown } from "./useCountdown";
import type { AuctionDetail, AuctionSummary } from "../../lib/types";

const SELLS = (mode: string) => mode === "buyback" || mode === "rfq"; // the bidders are sellers: asks and proceeds
const OUTCOME: Record<string, { word: string; kind: "good" | "plain" | "bad"; why: string }> = {
  winner: { word: "Won", kind: "good", why: "This bid won." },
  unfilled: { word: "Not filled", kind: "plain", why: "Other bids took the units. The deposit was refunded." },
  below_reserve: { word: "Below reserve", kind: "plain", why: "The price was under the reserve. The deposit was refunded." },
  superseded: { word: "Replaced", kind: "plain", why: "A later bid from the same bidder replaced this one. Its deposit was refunded." },
  no_match: { word: "No trade", kind: "plain", why: "The two limits didn't cross. Both deposits were refunded." },
  not_allowlisted: { word: "Not invited", kind: "bad", why: "This quote came from someone who wasn't invited. It didn't count." },
  not_party: { word: "Not a party", kind: "bad", why: "This bid came from someone outside the trade. It didn't count." },
  invalid: { word: "Invalid", kind: "bad", why: "This bid couldn't be read. The deposit was refunded." },
  above_max: { word: "Over the maximum", kind: "plain", why: "The ask was above the highest price accepted." },
  cancelled: { word: "Cancelled", kind: "plain", why: "The round was cancelled. The deposit was refunded." },
};
const outcome = (o: string, sells: boolean) => { const x = OUTCOME[o] ?? { word: o.replace(/_/g, " "), kind: "plain" as const, why: "" }; return sells && o === "winner" ? { ...x, word: "Accepted", why: "This offer was accepted." } : x; };
const party = (p: string) => /^leaf:(\d+)$/.test(p) ? `Bid ${Number(p.slice(5)) + 1}` : p === "seller" ? "Seller" : p === "treasury" ? "Unspent budget, back to the buyer" : p.startsWith("balance-late:") ? "Late balance, refunded" : p.startsWith("deposit:") ? "Stray deposit, refunded" : p.startsWith("fee") ? "Fee reserve, returned" : "Other";
const zone = () => { try { return new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName")?.value ?? ""; } catch { return ""; } };
const hm = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// "2 of 3": units filled of units offered. A buyback has no unit cap (its budget is the limit, clear/mode-b.ts), so
// it shows the count alone.
const soldOf = (d: AuctionDetail, sold: number, of: number) => d.mode === "buyback" ? String(sold) : `${sold} of ${of}`;
// The round's story in a sentence, by market.
function story(d: AuctionDetail, sold: number): string {
  if (d.state === "CANCELLED") return "The round was cancelled before it cleared. Every deposit was refunded in full.";
  if (!d.result) return "Bids stay sealed until they open together. Nobody, the operator included, can read a price before then.";
  if (sold === 0) return d.mode === "launch" ? "Bids didn't reach the minimum raise, so nothing was sold and every deposit was refunded." : d.mode === "otc" ? "The buyer's highest price was below the seller's lowest, so there was no trade. Both deposits were refunded." : SELLS(d.mode) ? "No offer was accepted. Every deposit was refunded, and the budget went back to the buyer." : "No bid won. Every deposit was refunded.";
  if (d.mode === "drop") return "Each lot went to its highest bid at or above the reserve. Winners paid their bid; everyone else got their deposit back.";
  if (d.mode === "otc") return "The buyer's limit met the seller's, so they traded at the midpoint of the two.";
  if (SELLS(d.mode)) return "The lowest asks were accepted up to the budget, all at the same price. Sellers got their deposit back plus what they were paid.";
  if (d.mode === "launch") return "The minimum raise was met. Every winning bid paid the same clearing price; the rest got their deposit back.";
  return "Every winning bid paid the same clearing price. Everyone else got their deposit back.";
}

// A terminal pane: glass over the sky, a hairline, its own scroll.
const Pane = ({ children, className, testid }: { children: ReactNode; className?: string; testid?: string }) => (
  <section className={cx("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] bg-app-1 ring-1 ring-app-line backdrop-blur-xl", className)} data-testid={testid}>{children}</section>
);
// Exchange tabs: plain labels, the chosen one underlined in gold.
function Tabs({ tabs, value, onChange, right }: { tabs: [string, string][]; value: string; onChange: (k: string) => void; right?: ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-stretch justify-between gap-3 border-b border-app-line px-3" role="tablist">
      <div className="flex items-stretch gap-4">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} data-tab={k}
            className={cx("relative -mb-px whitespace-nowrap border-b-2 px-0.5 text-[13px] transition-colors", value === k ? "border-gold text-app-text" : "border-transparent text-app-faint hover:text-app-muted")}>{l}</button>
        ))}
      </div>
      {right && <div className="flex min-w-0 items-center text-[12px] text-app-faint">{right}</div>}
    </div>
  );
}

export default function AuctionView() {
  const id = typeof location !== "undefined" ? new URLSearchParams(location.search).get("id") ?? "" : "";
  const [d, setD] = useState<(AuctionDetail & { freeze?: any }) | null>(null);
  const [err, setErr] = useState<"" | "missing" | "unavailable" | "bad">("");
  const [stale, setStale] = useState(false);
  const [chain, setChain] = useState<{ tip: number; round: number } | null>(null);
  const load = useRef<() => void>(() => {});
  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(id)) { setErr("bad"); return; }
    let gone = false;
    load.current = () => {
      api.auction(id).then((x) => { if (!gone) { setD(x); setErr(""); setStale(false); } })
        .catch((e) => { if (gone) return; const m = String((e as Error).message); setD((old) => { if (old) setStale(true); else setErr(/: 404 /.test(m) ? "missing" : "unavailable"); return old; }); });
      api.chain().then((c: any) => { if (!gone) setChain(c); }).catch(() => {});
    };
    load.current();
    const t = window.setInterval(() => load.current(), 15_000);
    return () => { gone = true; window.clearInterval(t); };
  }, [id]);
  const toClose = useCountdown(d?.T_submit);
  if (err === "bad" || err === "missing") return <div className="py-16"><h1 data-testid="ticket-title">Round not found</h1><p className="mt-2 text-app-muted">{err === "bad" ? "This link doesn't point to a round." : "There's no round with this id. Check the link or browse all rounds."}</p><div className="mt-6"><Btn href="/lots/" kind="secondary">Browse rounds</Btn></div></div>;
  if (err === "unavailable") return <div className="py-16"><h1 data-testid="ticket-title">We couldn't load this round</h1><p className="mt-2 text-app-muted">The service didn't answer. The round itself is fine; try again in a moment.</p><div className="mt-6"><Btn onClick={() => { setErr(""); load.current(); }}>Try again</Btn></div></div>;
  if (!d) return <div className="py-16"><h1 className="text-app-muted" data-testid="ticket-title">Loading the round…</h1></div>;
  return <Terminal d={d} live={d.live && d.state === "OPEN" && !!toClose} toClose={toClose} stale={stale} retry={() => load.current()} chain={chain} />;
}

function Terminal({ d, live, toClose, stale, retry, chain }: { d: AuctionDetail & { freeze?: any }; live: boolean; toClose: number | null; stale: boolean; retry: () => void; chain: { tip: number; round: number } | null }) {
  const m: any = d.manifest, sells = SELLS(d.mode), opened = Boolean(d.result), done = d.state === "SETTLED" || d.state === "CANCELLED";
  const allocations: any[] = d.result?.allocations ?? [];
  // An OTC trade fills both sides of one unit: count the buyer's side. A buyer's payment there comes out of the deposit
  // (deposit minus refund); payment_zats on the seller's row is what the seller received.
  const counted = d.mode === "otc" ? allocations.filter((a) => a.side === "buyer") : allocations;
  const sold = counted.reduce((s, a) => s + Number(a.fill ?? 0), 0), paid = counted.reduce((s, a) => s + (Number(a.fill ?? 0) ? Number(a.payment_zats ?? 0) : 0), 0);
  const of = m.lots ? m.lots.length : d.supply;
  const lotIdx = (h: string) => (m.lots ?? []).indexOf(h);
  const price = d.clearing_price_zats && d.clearing_price_zats !== "0" ? Number(d.clearing_price_zats) : undefined;
  const priceWord = d.mode === "otc" ? "Trade price" : sells ? "Price paid" : "Clearing price";
  const mine = typeof window !== "undefined" ? currentAttempt(d.id) : null;
  const [chart, setChart] = useState(opened ? "ladder" : "sealed");
  const [bottom, setBottom] = useState("bids");
  const [side, setSide] = useState("book");
  useEffect(() => { setChart(opened ? "ladder" : "sealed"); }, [opened]);

  const ladder: LadderRow[] = useMemo(() => [...allocations]
    .sort((a, b) => d.mode === "otc" ? 0 : d.mode === "drop" ? lotIdx(a.lot) - lotIdx(b.lot) || Number(b.price_zats) - Number(a.price_zats) : sells ? Number(a.price_zats) - Number(b.price_zats) : Number(b.price_zats) - Number(a.price_zats))
    .filter((a) => a.price_zats !== undefined && a.price_zats !== null)
    .map((a) => {
      const o = outcome(a.outcome, sells), n = a.leaf_index + 1;
      const label = d.mode === "otc" ? (a.side === "buyer" ? "Buyer" : "Seller") : d.mode === "drop" ? `L${lotIdx(a.lot) + 1}·${n}` : `#${n}`;
      const name = d.mode === "otc" ? (a.side === "buyer" ? "The buyer's limit" : "The seller's limit") : d.mode === "drop" ? `Bid ${n} · Lot ${lotIdx(a.lot) + 1}` : `${sells ? "Offer" : "Bid"} ${n}`;
      return { key: String(a.leaf_index), label, name, price: Number(a.price_zats), won: Number(a.fill ?? 0) > 0, faint: /below_reserve|not_allowlisted|cancel/.test(a.outcome ?? ""), word: o.word };
    }), [d.id, d.updated]);
  const chartTabs: [string, string][] = opened ? [["ladder", "Ladder"], ...(d.mode !== "drop" && d.mode !== "otc" ? [["depth", "Depth"] as [string, string]] : []), ["timeline", "Timeline"]] : [["sealed", "Sealed bids"], ["timeline", "Timeline"]];

  return (
    <div className="flex flex-col gap-2 fit:min-h-0 fit:flex-1" data-testid="terminal">
      <Ribbon d={d} live={live} toClose={toClose} sold={sold} of={of} paid={paid} price={price} priceWord={priceWord} />
      {stale && <ErrorLine>Updates unavailable right now; showing the last loaded record. <button className="underline" onClick={retry}>Retry</button></ErrorLine>}
      <div className="grid gap-2 fit:min-h-0 fit:flex-1 lg:grid-cols-[minmax(0,1fr)_264px_336px] lg:grid-rows-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* The chart: how the round cleared (or the sealed bids waiting to open). */}
        <Pane className="min-h-[340px] max-lg:order-1 lg:col-start-1 lg:row-start-1 fit:min-h-0" testid="chart">
          <Tabs tabs={chartTabs} value={chart} onChange={setChart} right={opened ? <span className="truncate">{ladder.length} {d.mode === "otc" ? "limits" : sells ? "offers" : "bids"}, opened {hm(d.release)}</span> : <span>opens {when(d.release)}</span>} />
          <div className="min-h-0 flex-1 p-3">
            {chart === "ladder" && opened && <BidLadder bare rows={ladder} line={price !== undefined && d.mode !== "drop" ? { value: price, label: priceWord } : undefined} title={price !== undefined && d.mode !== "drop" ? priceWord : "Highest bid"} sub="hover a bar" />}
            {chart === "depth" && opened && <Depth bids={allocations.filter((a) => a.price_zats).map((a) => ({ price: Number(a.price_zats), qty: Number(a.quantity ?? 1), won: Number(a.fill ?? 0) > 0 }))} units={of} price={price} sells={sells} />}
            {chart === "sealed" && <Sealed d={d} live={live} toClose={toClose} />}
            {chart === "timeline" && <TimelineTab d={d} opened={opened} done={done} />}
          </div>
        </Pane>

        {/* Below the chart, the round's records in tabs. */}
        <Pane className="min-h-[280px] max-lg:order-4 lg:col-start-1 lg:row-start-2 fit:min-h-0" testid="records">
          <Tabs tabs={[["bids", sells ? "Offers" : "Bids"], ["payments", `Payments${d.receipts.length ? ` ${d.receipts.length}` : ""}`], ["checks", `Checks${done ? ` ${d.checks.filter((c) => c.ok).length}/${d.checks.length}` : ""}`], ["terms", "Terms"], ["privacy", "Who sees what"]]} value={bottom} onChange={setBottom}
            right={bottom === "checks" && done ? <a href={`/verify/?id=${d.id}`} className="hover:text-app-text">Verify it yourself</a> : undefined} />
          <div className="min-h-0 flex-1 overflow-auto">
            {bottom === "bids" && <BidsTable d={d} allocations={allocations} sells={sells} opened={opened} />}
            {bottom === "payments" && <Payments d={d} />}
            {bottom === "checks" && <Checks d={d} done={done} />}
            {bottom === "terms" && <div className="p-4 text-[13.5px]"><Terms round={d} role={roleOf(d, null)} /></div>}
            {bottom === "privacy" && <div className="p-4"><WhoSees compact now={opened ? "after" : "before"} /></div>}
          </div>
        </Pane>

        {/* The book: sealed while bidding, priced once opened; and the round's activity. */}
        <Pane className="max-h-[420px] min-h-[200px] max-lg:order-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-none fit:min-h-0" testid="book">
          <Tabs tabs={[["book", "Book"], ["activity", "Activity"]]} value={side} onChange={setSide} />
          <div className="min-h-0 flex-1 overflow-auto">{side === "book" ? <Book d={d} allocations={allocations} sells={sells} price={price} priceWord={priceWord} lotIdx={lotIdx} live={live} /> : <Activity d={d} />}</div>
        </Pane>

        {/* The ticket: bid while the round takes bids (or follow your bid); afterwards, the result and find your bid. */}
        <Pane className="max-lg:order-2 lg:col-start-3 lg:row-span-2 lg:row-start-1 fit:min-h-0" testid="ticket">
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {live || (mine && !d.result) ? (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <div className="text-[15px] font-medium">{sells ? "Make a sealed offer" : d.mode === "otc" ? "Set your sealed limit" : "Place a sealed bid"}</div>
                  {live && toClose ? <div className="text-[13px] tabular-nums text-gold">closes in {clock(toClose)}</div> : null}
                </div>
                <BidTicket round={d} />
              </>
            ) : <Result d={d} sold={sold} of={of} paid={paid} price={price} priceWord={priceWord} sells={sells} done={done} mineHash={mine?.bid?.ciphertext_hash} />}
          </div>
        </Pane>
      </div>
      <StatusBar d={d} chain={chain} />
    </div>
  );
}

// The ribbon: the round switcher, then the figures an exchange puts beside the pair.
function Ribbon({ d, live, toClose, sold, of, paid, price, priceWord }: { d: AuctionDetail; live: boolean; toClose: number | null; sold: number; of: number; paid: number; price?: number; priceWord: string }) {
  const m: any = d.manifest, sells = SELLS(d.mode), opened = Boolean(d.result);
  const cells: [string, ReactNode, boolean?][] = [
    opened ? (d.mode === "drop" ? ["Winning bids", `${zats(paid)} zats`, true] : [priceWord, price !== undefined ? `${zats(price)} zats` : "—", true]) : [d.mode === "buyback" ? "Highest ask" : d.mode === "rfq" ? "Highest quote" : "Price range", sells ? `${zats(m.buyback?.max_price_zats ?? m.rfq?.max_price_zats)} zats` : `${zats(m.reserve_zats)}–${zats(m.B_max_zats)}`],
    d.mode === "buyback" && !opened ? ["Budget", `${zats(m.buyback?.budget_zats)} zats`] :
    [opened ? (m.lots ? "Lots sold" : sells ? "Units bought" : "Units sold") : m.lots ? "Lots" : sells ? "Units wanted" : "Units", opened ? soldOf(d, sold, of) : String(of)],
    ["Deposit", `${zats(d.C_zats)} zats`],
    [sells ? "Sealed offers" : "Sealed bids", d.leaf_count !== null && d.leaf_count !== undefined ? String(d.leaf_count) : "—"],
    ["Bidding", live && toClose ? <span className="text-gold">closes in {clock(toClose)}</span> : `closed ${when(d.T_submit)}`],
    ["Opening", opened ? `opened ${when(d.release)}` : Date.now() / 1000 >= d.release ? `due ${when(d.release)}` : `${rel(d.release)} · ${when(d.release)}`],
  ];
  return (
    <div className="relative z-30 flex min-h-16 flex-col gap-3 rounded-[14px] bg-app-1 px-3 py-2 ring-1 ring-app-line backdrop-blur-xl lg:flex-row lg:items-center lg:gap-6" data-testid="ribbon">
      <Switcher d={d} live={live} />
      <div className="hidden h-9 w-px bg-app-line lg:block" />
      <dl className="grid min-w-0 flex-1 grid-cols-3 gap-x-4 gap-y-2.5 px-2 pb-1 lg:flex lg:items-center lg:gap-x-6 lg:overflow-hidden lg:p-0">
        {cells.map(([k, v, gold]) => (
          <div key={k} className="min-w-0 shrink-0">
            <dt className="text-[11.5px] text-app-faint">{k}</dt>
            <dd className={cx("mt-0.5 truncate whitespace-nowrap text-[14px] tabular-nums", gold ? "chrome serif-figure text-[17px] leading-[1.1]" : "text-app-text")}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex shrink-0 items-center gap-3 max-lg:absolute max-lg:right-3 max-lg:top-3">
        <StatePill state={d.state === "OPEN" && Date.now() / 1000 >= d.T_submit ? "FROZEN" : d.state} live={live} testid="ticket-light" />
      </div>
    </div>
  );
}

// The round switcher (an exchange's pair picker): this round's doodle and name; open it for every round, searchable.
function Switcher({ d, live }: { d: AuctionDetail; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AuctionSummary[] | null>(null);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    if (!list) api.auctions().then((l) => setList([...l].sort((a, b) => Number(b.live) - Number(a.live) || b.updated - a.updated))).catch(() => setList([]));
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  const t = q.trim().toLowerCase();
  const rows = (list ?? []).filter((a) => !t || `${(a.lot ?? "").toLowerCase()} ${MODE_NAME[a.mode].toLowerCase()} ${a.id}`.includes(t)).slice(0, 60);
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="group flex items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-[#ddd6c60d]" data-testid="switcher">
        <Glyph name={glyphFor(d.mode, d.id)} className="page-door size-10" />
        <span className="min-w-0">
          <span className="flex items-center gap-2"><h1 className="max-w-[200px] truncate text-[21px] sm:max-w-[260px] leading-tight" data-testid="ticket-title">{d.lot ?? `${MODE_NAME[d.mode]} round`}</h1>
            <svg className={cx("size-4 shrink-0 text-app-faint transition-transform group-hover:text-app-muted", open && "rotate-180")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span>
          <span className="block text-[12px] text-app-faint" data-testid="auction-caption">{MODE_NAME[d.mode]} · {d.leaf_count ?? 0} sealed bids · {short(d.id, 4)}{live ? " · live" : ""}</span>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-[440px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-[#161c12] shadow-[0_24px_70px_-16px_#000000e6] ring-1 ring-app-line backdrop-blur-xl" data-testid="switcher-list">
          <div className="border-b border-app-line p-2"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rounds by name, market or id" className={cx(fieldCls, "h-9 text-[13.5px]")} /></div>
          <ul className="max-h-[56vh] overflow-auto py-1">
            {!list && <li className="px-4 py-3 text-[13px] text-app-faint">Loading rounds…</li>}
            {list && !rows.length && <li className="px-4 py-3 text-[13px] text-app-faint">No rounds match.</li>}
            {rows.map((a) => (
              <li key={a.id}><a href={`/auction/?id=${a.id}`} className={cx("flex items-center gap-3 px-3 py-2 hover:bg-[#ddd6c60f]", a.id === d.id && "bg-[#ddd6c60a]")}>
                <Glyph name={glyphFor(a.mode, a.id)} className="size-7" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px]">{a.lot ?? MODE_NAME[a.mode]} <span className="text-app-faint">· {a.id.slice(0, 6)}</span></span><span className="block truncate text-[12px] text-app-faint">{MODE_NAME[a.mode]} · {outcomeLine(a)}</span></span>
                {a.live && <Pill kind="live">Live</Pill>}
              </a></li>
            ))}
          </ul>
          <a href="/lots/" className="block border-t border-app-line px-4 py-2.5 text-[13px] text-app-muted hover:text-app-text">All rounds</a>
        </div>
      )}
    </div>
  );
}

// Before opening: the bids are there but their heights aren't: equal sealed bars, and when they open.
function Sealed({ d, live, toClose }: { d: AuctionDetail; live: boolean; toClose: number | null }) {
  const n = d.leaf_count ?? 0;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center" data-testid="sealed">
      <div className="flex h-[45%] min-h-[90px] items-end gap-2">
        {Array.from({ length: Math.max(n, 5) }).map((_, i) => (
          <span key={i} className={cx("w-6 rounded-t-[4px]", i < n ? "bg-[repeating-linear-gradient(135deg,#ddd6c633_0_4px,#ddd6c614_4px_8px)] ring-1 ring-[#ddd6c633]" : "bg-[#ddd6c60a]")} style={{ height: `${60 + ((i * 37) % 30)}%` }} />
        ))}
      </div>
      <div>
        <div className="serif-figure text-[24px] text-[#f3eee2]">{n ? `${n} sealed ${n === 1 ? "bid" : "bids"}` : live ? "Sealed bids land here" : "Waiting for the committed bids"}</div>
        <p className="mt-1 max-w-[440px] text-[13px] text-app-muted">{live && toClose ? `Bidding closes in ${clock(toClose)}. ` : ""}{Date.now() / 1000 < d.release ? `Every price stays sealed until the bids open together ${rel(d.release)}, at ${when(d.release)}. Nobody, the operator included, can read one before then.` : `The bids were due to open at ${when(d.release)}. Prices stay sealed until this round's committed bids are opened.`}</p>
      </div>
    </div>
  );
}

function TimelineTab({ d, opened, done }: { d: AuctionDetail; opened: boolean; done: boolean }) {
  const now = Date.now() / 1000;
  const step = (isDone: boolean, isNow: boolean) => (isDone ? "done" : isNow ? "now" : "next") as "done" | "now" | "next";
  const steps = [
    { label: now < d.T_submit ? "Bidding open" : "Bidding closed", at: when(d.T_submit), state: step(now >= d.T_submit, now < d.T_submit) },
    { label: "Bids committed", at: d.freeze_root ? `${d.leaf_count ?? 0} sealed bids, fixed` : `by ${when(d.T_freeze)}`, state: step(Boolean(d.freeze_root), now >= d.T_submit && !d.freeze_root) },
    { label: "Bids opened", at: when(d.release), state: step(opened, Boolean(d.freeze_root) && !opened) },
    { label: d.state === "CANCELLED" ? "Refunded" : done ? "Paid out" : opened ? "Paying out" : "Paid out", at: done ? `record updated ${when(d.updated)}` : opened ? "in progress" : "after opening", state: step(done, opened && !done) },
  ];
  return <div className="flex h-full flex-col justify-center gap-4 px-2"><Timeline steps={steps} testid="timeline" /><p className="text-[12.5px] text-app-faint">Times in your local time{zone() ? ` (${zone()})` : ""}. Bids open at drand round {d.R.toLocaleString("en-US")}, a public randomness beacon nobody controls.</p></div>;
}

// The book. Sealed: one row per committed bid, its price hidden. Opened: priced, best first, the clearing row between
// the winners and the rest (per lot for a drop; the two limits and the trade between them for OTC).
function Book({ d, allocations, sells, price, priceWord, lotIdx, live }: { d: AuctionDetail & { freeze?: any }; allocations: any[]; sells: boolean; price?: number; priceWord: string; lotIdx: (h: string) => number; live: boolean }) {
  const head = <div className="sticky top-0 z-10 grid grid-cols-[1fr_44px_40px] gap-2 bg-[#1b2216f2] px-3 py-1.5 text-[11.5px] text-app-faint"><span>Price (zats)</span><span className="text-right">Qty</span><span className="text-right">#</span></div>;
  if (!d.result) {
    const leaves: any[] = d.freeze?.leaves ?? [];
    if (!leaves.length) return <p className="p-4 text-[13px] text-app-muted">{live ? "Sealed bids land here as their deposits are counted. Prices stay hidden until the bids open." : "The committed bids appear here once bidding closes."}</p>;
    return <div data-testid="book-sealed">{head}{leaves.map((l) => (
      <div key={l.leaf_index} className="grid grid-cols-[1fr_44px_40px] gap-2 px-3 py-[5px] text-[12.5px] tabular-nums"><span className="tracking-[0.2em] text-app-faint">••••••</span><span className="text-right text-app-faint">•</span><span className="text-right text-app-muted">{l.leaf_index + 1}</span></div>
    ))}<p className="px-3 py-3 text-[12px] text-app-faint">Opens {when(d.release)}</p></div>;
  }
  const total = Math.max(1, allocations.reduce((n, a) => n + Number(a.quantity ?? 1), 0));
  const rowsFor = (list: any[]) => {
    const sorted = [...list].sort((a, b) => (sells ? Number(a.price_zats) - Number(b.price_zats) : Number(b.price_zats) - Number(a.price_zats)));
    let cum = 0, lineDone = false;
    const out: ReactNode[] = [];
    sorted.forEach((a, i) => {
      cum += Number(a.quantity ?? 1);
      const won = Number(a.fill ?? 0) > 0, faint = /below_reserve|not_allowlisted|cancel/.test(a.outcome ?? "");
      out.push(
        <div key={a.leaf_index} title={outcome(a.outcome, sells).word} className="relative grid grid-cols-[1fr_44px_40px] gap-2 px-3 py-[5px] text-[12.5px] tabular-nums">
          <span aria-hidden className={cx("absolute inset-y-[1px] right-0", won ? "bg-[#e9cd841a]" : "bg-[#ddd6c60a]")} style={{ width: `${(cum / total) * 100}%` }} />
          <span className={cx("relative", won ? "text-gold" : faint ? "text-app-faint" : "text-app-muted")}>{a.price_zats ? zats(a.price_zats) : "—"}</span>
          <span className="relative text-right text-app-muted">{a.quantity ?? 1}</span><span className="relative text-right text-app-faint">{a.leaf_index + 1}</span>
        </div>,
      );
      const next = sorted[i + 1];
      if (!lineDone && won && (!next || !(Number(next.fill ?? 0) > 0)) && d.mode !== "drop") {
        lineDone = true;
        out.push(<div key="line" className="my-1 flex items-center justify-between border-y border-app-line bg-[#e9cd840d] px-3 py-1.5 text-[12.5px]" data-testid="book-line"><span className="text-app-muted">{priceWord}</span><span className="serif-figure chrome text-[15px]">{price !== undefined ? zats(price) : "—"}</span></div>);
      }
    });
    return out;
  };
  if (d.mode === "drop") {
    const lots = (d.manifest as any).lots as string[];
    return <div data-testid="book-open">{head}{lots.map((l, i) => (
      <div key={l}><div className="mt-1 px-3 py-1 text-[11.5px] text-app-faint">Lot {i + 1}</div>{rowsFor(allocations.filter((a) => lotIdx(a.lot) === i))}</div>
    ))}</div>;
  }
  if (d.mode === "otc") {
    const s = allocations.find((a) => a.side === "seller"), b = allocations.find((a) => a.side === "buyer");
    const row = (a: any, label: string) => a && <div className="grid grid-cols-[1fr_auto] px-3 py-2 text-[13px] tabular-nums"><span className="text-app-muted">{label}</span><span className={Number(a.fill ?? 0) > 0 ? "text-gold" : "text-app-text"}>{zats(a.price_zats)}</span></div>;
    return <div data-testid="book-open" className="pt-2">{row(s, "Seller's lowest")}<div className="my-1 flex items-center justify-between border-y border-app-line bg-[#e9cd840d] px-3 py-1.5 text-[12.5px]"><span className="text-app-muted">{price !== undefined ? "Trade price" : "No trade"}</span><span className="serif-figure chrome text-[15px]">{price !== undefined ? zats(price) : "—"}</span></div>{row(b, "Buyer's highest")}</div>;
  }
  return <div data-testid="book-open">{head}{rowsFor(allocations)}</div>;
}

// What happened, newest first, from the round's own record.
function Activity({ d }: { d: AuctionDetail & { freeze?: any } }) {
  const ev: { t: number; text: string; gold?: boolean }[] = [];
  if (d.receipts.length) ev.push({ t: d.updated, text: `${new Set(d.receipts.map((r) => r.txid)).size} payment transaction${new Set(d.receipts.map((r) => r.txid)).size > 1 ? "s" : ""} signed by two of three`, gold: d.state === "SETTLED" });
  if (d.state === "CANCELLED") ev.push({ t: d.updated, text: "Round cancelled · every deposit refunded" });
  if (d.result) ev.push({ t: d.release, text: d.clearing_price_zats && d.clearing_price_zats !== "0" ? `Bids opened · cleared at ${zats(d.clearing_price_zats)} zats` : "Bids opened", gold: true });
  if (d.witness_certificates) ev.push({ t: d.T_freeze, text: `Committed bids signed by ${d.witness_certificates} witness${d.witness_certificates > 1 ? "es" : ""}` });
  if (d.freeze_root) ev.push({ t: d.T_freeze, text: `${d.leaf_count ?? 0} sealed bids fixed` });
  if (Date.now() / 1000 >= d.T_submit) ev.push({ t: d.T_submit, text: "Bidding closed" });
  else ev.push({ t: Date.now() / 1000, text: "Taking sealed bids", gold: true });
  return (
    <ul className="py-1" data-testid="activity">{ev.map((e, i) => (
      <li key={i} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 px-3 py-2 text-[12.5px]"><span className="tabular-nums text-app-faint">{hm(e.t)}</span><span className={e.gold ? "text-app-text" : "text-app-muted"}>{e.gold && <span className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-gold" />}{e.text}</span></li>
    ))}</ul>
  );
}

function BidsTable({ d, allocations, sells, opened }: { d: AuctionDetail; allocations: any[]; sells: boolean; opened: boolean }) {
  const m: any = d.manifest;
  if (!opened) return <p className="p-4 text-[13px] text-app-muted">{d.leaf_count ? `${d.leaf_count} sealed bids. ` : ""}Prices stay sealed until the bids open, {rel(d.release)}.</p>;
  const lotName = (h: string) => { const i = (m.lots ?? []).indexOf(h); return i >= 0 ? `Lot ${i + 1}` : "—"; };
  const rowPaid = (a: any) => d.mode === "otc" && a.side === "buyer" && Number(a.fill) ? Number(d.C_zats) - Number(a.refund_zats ?? 0) : Number(a.payment_zats ?? 0);
  return (
    <table className="w-full min-w-[520px] text-[13px] tabular-nums" data-testid="allocations">
      <thead className="sticky top-0 bg-[#1b2216f2] text-left text-[11.5px] text-app-faint"><tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-normal">
        <th>{d.mode === "otc" ? "Side" : sells ? "Offer" : "Bid"}</th>{m.lots && <th>Lot</th>}<th className="text-right">{sells ? "Ask" : d.mode === "otc" ? "Limit" : "Price"}</th><th>Result</th><th className="text-right">{sells ? "Proceeds" : d.mode === "otc" ? "Paid / received" : "Paid"}</th><th className="text-right">{sells ? "Deposit back" : "Refund"}</th>
      </tr></thead>
      <tbody>{allocations.map((a) => { const o = outcome(a.outcome, sells); return (
        <tr key={a.leaf_index} className="border-t border-app-line [&>td]:whitespace-nowrap [&>td]:px-4 [&>td]:py-2">
          <td>{d.mode === "otc" ? (a.side === "buyer" ? "Buyer" : a.side === "seller" ? "Seller" : "—") : a.leaf_index + 1}</td>{m.lots && <td className="text-app-muted">{lotName(a.lot)}</td>}
          <td className="text-right">{a.price_zats ? zats(a.price_zats) : "—"}</td>
          <td><span title={o.why}><Pill kind={o.kind}>{o.word}</Pill></span></td>
          <td className="text-right">{rowPaid(a) ? zats(rowPaid(a)) : "0"}</td>
          <td className="text-right text-app-muted">{zats(sells ? d.C_zats : a.refund_zats ?? 0)}</td>
        </tr>); })}</tbody>
    </table>
  );
}

function Payments({ d }: { d: AuctionDetail }) {
  const byTx = new Map<string, typeof d.receipts>();
  for (const r of d.receipts) { const k = r.txid ?? "pending"; byTx.set(k, [...(byTx.get(k) ?? []), r]); }
  const cons: any = (d.result as any)?.conservation;
  if (!d.receipts.length) return <p className="p-4 text-[13px] text-app-muted">{d.result ? "Payments are being signed. They appear here as they're sent." : "Payments go out after the bids open."}</p>;
  return (
    <div>
      {[...byTx.entries()].map(([tx, rs]) => (
        <div key={tx} className="border-b border-app-line">
          <div className="flex items-center justify-between gap-3 px-4 pt-2.5 text-[11.5px] text-app-faint"><span>Shielded transaction · signed by two of three</span>{tx !== "pending" ? <Copyable value={tx} display={short(tx, 6)} /> : <span>not sent yet</span>}</div>
          <ul data-testid="payments">{rs.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-4 px-4 py-1.5 text-[13px]"><span className="min-w-0 truncate">{party(r.party)}</span><span className="shrink-0 tabular-nums">{zats(r.amount_zats)} zats</span></li>
          ))}</ul>
        </div>
      ))}
      {cons && <p className="px-4 py-2.5 text-[12.5px] text-app-muted tabular-nums">Where the money went: {zats(Number(cons.input_zats) + Number(cons.balances_zats ?? 0))} in{Number(cons.balances_zats ?? 0) ? ` (${zats(cons.input_zats)} deposits + ${zats(cons.balances_zats)} balances)` : ""} = {zats(cons.payout_zats)} paid out + {zats(cons.refund_zats)} refunded + {zats(cons.fees_zats)} fees.</p>}
    </div>
  );
}

function Checks({ d, done }: { d: AuctionDetail; done: boolean }) {
  if (!done) return <p className="p-4 text-[13px] text-app-muted">The checks run on the full record once the round is paid out.</p>;
  const ok = d.checks.filter((c) => c.ok).length, na = d.checks.filter((c) => c.status === "not_applicable").length;
  return (
    <div className="p-4" data-testid="checks">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-[14px] font-medium">{ok} of {d.checks.length} checks pass</div><Pill kind={d.valid ? "good" : "bad"}>{d.valid ? "Record checks out" : "Problem"}</Pill></div>
      <p className="mt-0.5 text-[12.5px] text-app-muted">Checks of the round's public record, reported by this service{na ? `; ${na} don't apply to this round` : ""}.</p>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[13px] xl:grid-cols-2">{d.checks.map((c) => <li key={c.id} className="flex gap-2.5">{c.status === "not_applicable" ? <span className="mt-[3px] size-4 shrink-0 text-center text-app-faint">–</span> : <Tick ok={c.ok} />}<span className={cx("min-w-0 break-words", c.status === "not_applicable" && "text-app-faint")}>{checkName(c.id)}{c.status === "not_applicable" ? " · not applicable" : ""}</span></li>)}</ul>
    </div>
  );
}

// After bidding: the result in a sentence and four figures, then find your bid.
function Result({ d, sold, of, paid, price, priceWord, sells, done, mineHash }: { d: AuctionDetail; sold: number; of: number; paid: number; price?: number; priceWord: string; sells: boolean; done: boolean; mineHash?: string }) {
  const sellerGot = d.mode === "otc" ? (d.result?.allocations ?? []).filter((a: any) => a.side === "seller").reduce((s: number, a: any) => s + Number(a.payment_zats ?? 0), 0) : d.receipts.filter((r) => r.party === "seller").reduce((s, r) => s + Number(r.amount_zats), 0);
  const fig = (k: string, v: string, gold?: boolean) => <div className="min-w-0"><div className="text-[11.5px] text-app-faint">{k}</div><div className={cx("serif-figure mt-0.5 truncate text-[20px] leading-[1.15]", gold ? "chrome" : "text-[#f3eee2]")}>{v}</div></div>;
  return (
    <div className="grid gap-5">
      <div data-testid="story">
        <div className="serif-figure text-[21px] leading-snug text-[#f3eee2]">{outcomeLine(d)}</div>
        <p className="mt-1 text-[13px] text-app-muted">{story(d, sold)}</p>
      </div>
      {d.result && <div className="grid grid-cols-2 gap-4 rounded-xl bg-[#0f140c80] p-3.5 ring-1 ring-app-line">
        {d.mode === "drop" ? fig("Lots sold", `${sold} of ${of}`, true) : fig(priceWord, price !== undefined ? `${zats(price)}` : "—", true)}
        {d.mode === "drop" ? fig("Winning bids", zats(paid)) : fig(sells ? "Units bought" : "Units sold", soldOf(d, sold, of))}
        {fig(sells ? "Offers" : "Bids", String(d.leaf_count ?? 0))}
        {fig(sells ? "Paid to sellers" : done || d.mode === "otc" ? "Seller received" : "Seller so far", zats(sells ? paid : sellerGot))}
      </div>}
      <ReceiptLookup d={d} frozen={Boolean(d.freeze_root)} sells={sells} initial={mineHash} />
      <Details d={d} />
    </div>
  );
}

// The round's specification, as an exchange lists a contract's: what it sells, the price rules, the deposit, the clock.
function Details({ d }: { d: AuctionDetail }) {
  const m: any = d.manifest, sells = SELLS(d.mode);
  const rows: [string, string][] = [
    ["Market", MODE_NAME[d.mode]],
    [sells ? "Highest ask" : "Price range", sells ? `${zats(m.buyback?.max_price_zats ?? m.rfq?.max_price_zats)} zats` : `${zats(m.reserve_zats)}–${zats(m.B_max_zats)} zats`],
    ["Price step", `${zats(m.tick_zats ?? 10)} zats`],
    d.mode === "buyback" ? ["Budget", `${zats(m.buyback?.budget_zats)} zats`] : [m.lots ? "Lots" : "Units", String(m.lots ? m.lots.length : d.supply)],
    ["Deposit per bid", `${zats(d.C_zats)} zats`],
    ["Bidding closed", when(d.T_submit)],
    ["Bids committed by", when(d.T_freeze)],
    ["Bids open", `${when(d.release)} · drand ${d.R.toLocaleString("en-US")}`],
    ["Payments", "signed by 2 of 3 signers"],
  ];
  return (
    <div className="border-t border-app-line pt-4" data-testid="details">
      <div className="text-[14px] font-medium">Round details</div>
      <p className="mt-1 text-[12.5px] text-app-muted">{roleOf(d, null).rule}</p>
      <dl className="mt-3 grid gap-1.5 text-[12.5px]">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-app-faint">{k}</dt><dd className="truncate text-right tabular-nums text-app-muted">{v}</dd></div>)}</dl>
    </div>
  );
}

// Find your bid: paste its hash, or open the recovery file (read here, never uploaded); says what happened to that bid.
function ReceiptLookup({ d, frozen, sells, initial }: { d: AuctionDetail; frozen: boolean; sells: boolean; initial?: string }) {
  // The bid in the link, else the one this browser placed in this round, is looked up straight away.
  const [hash, setHash] = useState(() => new URLSearchParams(location.search).get("bid") ?? initial ?? "");
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const look = async (h = hash) => {
    setErr(""); setOut(null);
    if (!/^[0-9a-f]{64}$/.test(h.trim())) { setErr("Enter the 64-character bid hash, or open your recovery file."); return; }
    setBusy(true);
    try { setOut(await api.receipt(d.id, h.trim())); } catch (x) { setErr(/not in frozen/.test(String((x as Error).message)) ? "That bid isn't in this round's committed bids." : /: 404|: 4\d\d/.test(String((x as Error).message)) ? "That bid isn't in this round." : "We couldn't look that up right now. Try again."); } finally { setBusy(false); }
  };
  const openKey = async (f: File | undefined) => {
    if (!f) return;
    try { const k = JSON.parse(await f.text()); if (k.auction_id && k.auction_id !== d.id) { setErr("That recovery file belongs to a different round."); return; } setHash(k.ciphertext_hash ?? ""); void look(k.ciphertext_hash ?? ""); } catch { setErr("That file isn't a Benzo recovery file."); }
  };
  useEffect(() => { if (hash && frozen) void look(); }, []);
  if (!frozen) return <div className="rounded-xl p-3.5 ring-1 ring-app-line"><div className="text-[14px] font-medium">Bidding closed</div><p className="mt-1 text-[13px] text-app-muted">The bids are being committed. Your bid's receipt appears here after.</p></div>;
  const s = out?.settlement, li = out ? Number(out.inclusion.leaf_index) : -1, al = (d.result?.allocations ?? []).find((a: any) => a.leaf_index === li);
  const mine = al ? outcome(al.outcome, sells) : null;
  const paidHere = (a: any) => d.mode === "otc" && a.side === "buyer" && Number(a.fill) ? Number(d.C_zats) - Number(a.refund_zats ?? 0) : Number(a.payment_zats ?? 0);
  return (
    <div className="border-t border-app-line pt-4">
      <div className="text-[14px] font-medium">Find your bid</div>
      <form onSubmit={(e) => { e.preventDefault(); void look(); }} className="mt-2.5 grid gap-2">
        <label className="sr-only" htmlFor="ct">Bid hash</label>
        <input id="ct" value={hash} onChange={(e) => setHash(e.target.value.trim())} placeholder="Bid hash (in your recovery file)" spellCheck={false} className={cx(fieldCls, "h-10 text-[13px]")} />
        <div className="flex gap-2">
          <Btn type="submit" kind="secondary" disabled={busy} className="flex-1">{busy ? "Looking up…" : "Look up"}</Btn>
          <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full px-3 text-[13px] font-semibold text-app-muted hover:text-app-text">Open recovery file<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void openKey(e.target.files?.[0])} /></label>
        </div>
      </form>
      {err && <div className="mt-3"><ErrorLine>{err}</ErrorLine></div>}
      {out && (
        <div className="mt-3 grid gap-1.5 text-[13px]" data-testid="receipt">
          <div className="text-[15px] font-medium">{mine ? `Bid ${li + 1} · ${mine.word}` : `Bid ${li + 1} is in this round`}</div>
          {mine?.why && <p className="text-[12.5px] text-app-muted">{mine.why}</p>}
          {al && paidHere(al) > 0 && <div className="flex justify-between"><span className="text-app-faint">{sells || (d.mode === "otc" && al.side === "seller") ? "Proceeds" : "Paid"}</span><span className="tabular-nums">{zats(paidHere(al))} zats</span></div>}
          <div className="flex justify-between"><span className="text-app-faint">{sells ? "Sent to you" : "Refund"}</span><span className="tabular-nums">{s ? `${zats(s.amount_zats)} zats` : "Not sent yet"}</span></div>
          <span className="sr-only">{out.inclusion.ciphertext_hash}</span>
        </div>
      )}
    </div>
  );
}

// The status bar: the network this runs on, its height, the public beacon that opens the bids, this round's id.
function StatusBar({ d, chain }: { d: AuctionDetail; chain: { tip: number; round: number } | null }) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-4 px-1 text-[11.5px] text-app-faint tabular-nums" data-testid="statusbar">
      <div className="flex min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap">
        <span className="flex items-center gap-1.5 text-app-muted"><span className={cx("size-1.5 rounded-full", chain ? "bg-[#c4e09a]" : "bg-app-faint")} />Zcash testnet</span>
        {chain && <span>Block {chain.tip.toLocaleString("en-US")}</span>}
        {chain && <span>drand round {chain.round.toLocaleString("en-US")}</span>}
        <span>Bids open at round {d.R.toLocaleString("en-US")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-4"><span>Updated {hm(d.updated)}</span><span className="max-sm:hidden">Round <Copyable value={d.id} display={short(d.id, 4)} /></span></div>
    </div>
  );
}
