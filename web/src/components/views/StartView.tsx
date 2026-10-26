// Start a round (after Stripe's product form): pick the market, fill a short form, and see on the right the round as
// bidders will see it. For OTC this browser makes your party key first (only its public half is sent); RFQ dealers
// get invite links on the next screen.
import { useEffect, useState } from "react";
import { api, MODE_NAME } from "../../lib/api";
import { DOOR, MARKETS, type Market } from "../../lib/glyphs";
import { addParty, addStarted } from "../../lib/mine";
import { Btn, ErrorLine, Field, Panel, cx, fieldCls, marketTitle, zats } from "../app/ui";

const FOR: Record<Market, string> = {
  uniform: "Sell several units. Every winner pays the same price.",
  drop: "Sell a few named items. Each goes to its best bid.",
  launch: "Raise money in units. Everyone is refunded if the minimum isn't met.",
  buyback: "Buy units back. Sellers send sealed asks against your budget.",
  otc: "One buyer, one seller. You trade if your limits cross.",
  rfq: "Ask a few dealers for sealed quotes. The best quote wins.",
};

export default function StartView() {
  const q = new URLSearchParams(location.search);
  const initial = MARKETS.includes(q.get("market") as Market) ? (q.get("market") as Market) : null;
  const [market, setMarket] = useState<Market | null>(initial);
  // Picking a market is a step you can go back from: Back (or the browser's) returns to the six markets.
  useEffect(() => {
    const pop = () => { const m = new URLSearchParams(location.search).get("market"); setMarket(MARKETS.includes(m as Market) ? (m as Market) : null); };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  if (!market) return (
    <div>
      <h1 className="text-[28px]">Start a round</h1>
      <p className="mt-1.5 text-app-muted">Choose how you want to sell or buy.</p>
      <ul className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="start-markets">
        {MARKETS.map((m) => (
          <li key={m}>
            <button type="button" onClick={() => { setMarket(m); history.pushState({ benzoStep: 1 }, "", `/start/?market=${m}`); }}
              className="flex h-full w-full flex-col gap-4 rounded-[20px] bg-app-1 p-5 text-left transition-colors hover:bg-app-2" data-testid={`start-${m}`}>
              <img src={`/doodles/${DOOR[m]}.svg`} alt="" className="size-10" />
              <span><span className="block text-[17px] font-semibold">{MODE_NAME[m]}</span><span className="mt-1 block text-[14px] text-app-muted">{FOR[m]}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  return <Form market={market} onChange={() => (history.state?.benzoStep ? history.back() : (setMarket(null), history.replaceState({}, "", "/start/")))} />;
}

function Form({ market, onChange }: { market: Market; onChange: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ lot: "", minutes: "40", supply: market === "launch" ? "3" : market === "buyback" ? "2" : "1", reserve: "100", max_price: market === "buyback" ? "300" : market === "rfq" ? "500" : "3000",
    budget: market === "buyback" ? "600" : "1000", minimum_raise: "900", lots: "Lot A, Lot B, Lot C", side: "seller", dealers: "2", payout_ua: "", treasury_ua: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const num = (k: string, label: string, help?: string, unit = "zats") => (
    <Field label={label} help={help}>
      <div className="relative">
        <input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^0-9]/g, "") })} required inputMode="numeric" className={cx(fieldCls, "tabular-nums", unit && "pr-14")} data-testid={`start-${k}`} />
        {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-app-faint">{unit}</span>}
      </div>
    </Field>
  );
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      let key: { private_hex: string; public_hex: string } | null = null;
      if (market === "otc") { const { newPartyKey } = await import("../../lib/bidder"); key = await newPartyKey(); }
      const r = await api.start({ ...f, mode: market, ...(key ? { creator_key: key.public_hex } : {}) });
      if (key) addParty({ ...key, rid: r.rid, label: f.side === "buyer" ? "Buyer" : "Seller" });
      addStarted({ rid: r.rid, token: r.token, mode: market, lot: f.lot, at: Date.now() });
      location.href = `/round/?r=${r.rid}&t=${r.token}`;
    } catch (x) { const m = String((x as Error).message); setErr(m.charAt(0).toUpperCase() + m.slice(1)); setBusy(false); }
  };
  const proceeds = market === "uniform" || market === "launch" || market === "drop";
  const minutes = Number(f.minutes), closes = new Date(Date.now() + minutes * 60_000), opens = new Date(closes.getTime() + 28 * 60_000);
  const hm = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const lots = f.lots.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="text-[28px]">New {marketTitle(MODE_NAME[market])} round</h1>
        <button type="button" onClick={onChange} className="text-[14px] text-app-muted hover:text-app-text">Change market</button>
      </div>
      <p className="mt-1.5 text-app-muted">{FOR[market]}</p>
      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={go} className="grid content-start gap-4" data-testid="start-form">
          <Panel>
            <div className="grid gap-4">
              <Field label={market === "rfq" ? "What you want quoted" : market === "buyback" ? "What you're buying back" : market === "launch" ? "Project name" : "What you're selling"}>
                <input value={f.lot} onChange={set("lot")} required maxLength={40} placeholder={market === "drop" ? "Autumn prints" : market === "rfq" ? "Wallet audit" : "Night lamp"} className={fieldCls} data-testid="start-lot" />
              </Field>
              {market === "drop" && <Field label="Lots" help="Two to five names, separated by commas."><input value={f.lots} onChange={set("lots")} className={fieldCls} data-testid="start-lots" /></Field>}
              {market === "otc" && (
                <Field label="Your side">
                  <select value={f.side} onChange={set("side")} className={fieldCls} data-testid="start-side"><option value="seller">I'm selling</option><option value="buyer">I'm buying</option></select>
                </Field>
              )}
            </div>
          </Panel>
          <Panel>
            <div className="grid gap-4 sm:grid-cols-2">
              {(market === "uniform" || market === "launch" || market === "buyback") && num("supply", "Units", undefined, "")}
              {(market === "uniform" || market === "drop") && num("reserve", "Reserve price", "The lowest price you'll sell at.")}
              {num("max_price", market === "buyback" ? "Highest ask you'll accept" : market === "rfq" ? "Highest quote you'll accept" : "Highest bid allowed")}
              {market === "launch" && num("minimum_raise", "Minimum raise", "Below this, everyone is refunded.")}
              {(market === "buyback" || market === "rfq") && num("budget", "Budget", "You pay this in; what isn't spent comes back.")}
              {market === "rfq" && <Field label="Dealers"><select value={f.dealers} onChange={set("dealers")} className={fieldCls} data-testid="start-dealers">{[2, 3, 4].map((n) => <option key={n} value={n}>{n} dealers</option>)}</select></Field>}
              <Field label="Bidding time"><select value={f.minutes} onChange={set("minutes")} className={fieldCls} data-testid="start-minutes">{[20, 40, 60, 90].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></Field>
            </div>
          </Panel>
          {(proceeds || market === "buyback" || market === "rfq") && (
            <Panel>
              {proceeds
                ? <Field label="Where the money goes" help="A shielded address from your testnet wallet."><input value={f.payout_ua} onChange={set("payout_ua")} required spellCheck={false} placeholder="utest1…" className={cx(fieldCls, "text-[13.5px]")} data-testid="start-payout_ua" /></Field>
                : <Field label="Where unspent budget comes back" help="A shielded address from your testnet wallet."><input value={f.treasury_ua} onChange={set("treasury_ua")} required spellCheck={false} placeholder="utest1…" className={cx(fieldCls, "text-[13.5px]")} data-testid="start-treasury_ua" /></Field>}
            </Panel>
          )}
          {err && <ErrorLine testid="start-error">{err}</ErrorLine>}
          <div className="flex flex-wrap items-center gap-4"><Btn type="submit" disabled={busy} testid="start-submit">{busy ? "Starting…" : "Start round"}</Btn>{market === "otc" || market === "rfq" ? <span className="text-[13px] text-app-muted">You'll get invite links next.</span> : null}</div>
        </form>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="mb-2 text-[13px] text-app-faint">What bidders will see</div>
          <Panel>
            <div className="flex items-center gap-3">
              <img src={`/doodles/${DOOR[market]}.svg`} alt="" className="size-10 rounded-xl bg-app-2 p-2" />
              <div className="min-w-0"><div className="truncate text-[17px] font-semibold">{f.lot || "Untitled"}</div><div className="text-[13px] text-app-muted">{MODE_NAME[market]}</div></div>
            </div>
            <dl className="mt-5 grid gap-2.5 text-[14px]">
              {market === "drop" && <div className="flex justify-between gap-3"><dt className="text-app-faint">Lots</dt><dd className="truncate">{lots.join(", ") || "—"}</dd></div>}
              {(market === "uniform" || market === "launch" || market === "buyback") && <div className="flex justify-between"><dt className="text-app-faint">Units</dt><dd className="tabular-nums">{f.supply || "—"}</dd></div>}
              <div className="flex justify-between"><dt className="text-app-faint">{market === "buyback" ? "Asks" : market === "rfq" ? "Quotes" : "Bids"}</dt><dd className="tabular-nums">{market === "buyback" || market === "rfq" || market === "otc" ? `up to ${zats(f.max_price)} zats` : `${zats(f.reserve)}–${zats(f.max_price)} zats`}</dd></div>
              {market === "launch" && <div className="flex justify-between"><dt className="text-app-faint">Minimum raise</dt><dd className="tabular-nums">{zats(f.minimum_raise)} zats</dd></div>}
              {(market === "buyback" || market === "rfq") && <div className="flex justify-between"><dt className="text-app-faint">Budget</dt><dd className="tabular-nums">{zats(f.budget)} zats</dd></div>}
              <div className="flex justify-between"><dt className="text-app-faint">Deposit per bid</dt><dd className="tabular-nums">0.002 TAZ</dd></div>
              <div className="flex justify-between"><dt className="text-app-faint">Bids close</dt><dd className="tabular-nums text-gold">about {hm(closes)}</dd></div>
              <div className="flex justify-between"><dt className="text-app-faint">Bids open</dt><dd className="tabular-nums">about {hm(opens)}</dd></div>
            </dl>
          </Panel>
          <p className="mt-3 text-[13px] text-app-muted">Setting a round up takes a few minutes. Testnet only.</p>
        </aside>
      </div>
    </div>
  );
}
