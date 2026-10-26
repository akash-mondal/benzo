// Start a round in any of the six markets. The form becomes the round's signed manifest on the operator's side; for
// OTC this browser makes your party key first (only its public half is sent), and RFQ dealers get invite links.
import { useState } from "react";
import { Ticket, Part, Button } from "../page/Ticket";
import { api, MODE_NAME } from "../../lib/api";
import { DOOR, MARKETS, type Market } from "../../lib/glyphs";
import { addParty, addStarted } from "../../lib/mine";

const field = "w-full border border-ink/30 bg-white/50 px-3 py-2.5 font-sans text-[15px] text-ink outline-none focus:border-moss";
const label = "grid gap-1.5 font-sans text-[13px] text-muted";

export default function StartView() {
  const q = new URLSearchParams(location.search);
  const initial = MARKETS.includes(q.get("market") as Market) ? (q.get("market") as Market) : null;
  const [market, setMarket] = useState<Market | null>(initial);
  if (!market) return (
    <Ticket kind="Start" title="Start a round">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="start-markets">
        {MARKETS.map((m) => (
          <li key={m}>
            <button type="button" onClick={() => { setMarket(m); history.replaceState({}, "", `/start/?market=${m}`); }} className="flex w-full items-center gap-3 bg-sand px-3 py-3 text-left font-sans text-[15px] text-ink hover:bg-white/50" data-testid={`start-${m}`}>
              <img src={`/doodles/${DOOR[m]}.svg`} alt="" className="size-8 bg-leaf-deep p-1.5" />{MODE_NAME[m]}
            </button>
          </li>
        ))}
      </ul>
    </Ticket>
  );
  return <Form market={market} />;
}

function Form({ market }: { market: Market }) {
  const [f, setF] = useState<Record<string, string>>({ minutes: "40", supply: market === "launch" ? "3" : market === "buyback" ? "2" : "1", reserve: "100", max_price: market === "buyback" ? "300" : market === "rfq" ? "500" : "3000",
    budget: market === "buyback" ? "600" : "1000", minimum_raise: "900", lots: "Lot A, Lot B, Lot C", side: "seller", dealers: "2" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const input = (k: string, l: string, numeric = true) => (
    <label className={label}>{l}<input value={f[k] ?? ""} onChange={set(k)} required inputMode={numeric ? "numeric" : undefined} spellCheck={false} className={`${field} ${numeric ? "tabular" : k.endsWith("_ua") ? "text-[13px]" : ""}`} data-testid={`start-${k}`} /></label>
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
    } catch (x) { setErr(String((x as Error).message)); setBusy(false); }
  };
  const proceeds = market === "uniform" || market === "launch" || market === "drop";
  return (
    <Ticket kind={MODE_NAME[market]} title={`Start a ${MODE_NAME[market].toLowerCase()} round`} glyph={DOOR[market]}>
      <form onSubmit={go} className="grid gap-5" data-testid="start-form">
        <Part title={market === "rfq" ? "What you want quoted" : market === "buyback" ? "What you buy back" : "What you sell"}>{input("lot", "name", false)}</Part>
        {market === "drop" && <Part title="Lots">{input("lots", "names, separated by commas", false)}</Part>}
        {market === "otc" && (
          <Part title="Your side">
            <select value={f.side} onChange={set("side")} className={field} data-testid="start-side"><option value="seller">I sell</option><option value="buyer">I buy</option></select>
          </Part>
        )}
        <Part title="Terms">
          <div className="grid gap-3 sm:grid-cols-2">
            {(market === "uniform" || market === "launch" || market === "buyback") && input("supply", "units")}
            {(market === "uniform" || market === "drop") && input("reserve", "reserve price, zats")}
            {input("max_price", market === "buyback" ? "highest ask you accept, zats" : market === "rfq" ? "highest quote you accept, zats" : "maximum price, zats")}
            {market === "launch" && input("minimum_raise", "minimum raise, zats")}
            {(market === "buyback" || market === "rfq") && input("budget", "budget, zats")}
            {market === "rfq" && (
              <label className={label}>dealers<select value={f.dealers} onChange={set("dealers")} className={field} data-testid="start-dealers">{[2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
            )}
            <label className={label}>bidding time<select value={f.minutes} onChange={set("minutes")} className={field} data-testid="start-minutes">{[20, 40, 60, 90].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
          </div>
        </Part>
        {proceeds && <Part title="Where the proceeds go">{input("payout_ua", "shielded testnet address · utest1…", false)}</Part>}
        {(market === "buyback" || market === "rfq") && <Part title="Where unspent budget returns">{input("treasury_ua", "shielded testnet address · utest1…", false)}</Part>}
        {err && <p className="font-sans text-[14px] text-[#9b2c2c]" data-testid="start-error">{err}</p>}
        <div><Button type="submit" disabled={busy} testid="start-submit">{busy ? "Starting…" : "Start"}</Button></div>
      </form>
    </Ticket>
  );
}
