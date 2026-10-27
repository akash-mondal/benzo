// Start a round (after Stripe's product form): pick the market, fill a short form, and see on the right the round as
// bidders will see it. For OTC this browser makes your party key first (only its public half is sent); RFQ dealers
// get invite links on the next screen.
import { useEffect, useState } from "react";
import { api, MODE_NAME } from "../../lib/api";
import { ABOUT, DOOR, MARKETS as ALL_MARKETS, type Market } from "../../lib/glyphs";
// A launch's winners record where their units go with the CLI (benzo launch deliver); the site can't collect that yet,
// so launch rounds aren't started here.
const MARKETS: readonly Market[] = ALL_MARKETS.filter((m) => m !== "launch");
import { addParty, addStarted } from "../../lib/mine";
import { Btn, Glyph, PageHead, ErrorLine, Field, Panel, cx, fieldCls, marketTitle, zats } from "../app/ui";

const FOR = ABOUT;

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
      <PageHead glyph="quill" title="Start a round" sub="Choose how you want to sell or buy." />
      <ul className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="start-markets">
        {MARKETS.map((m) => (
          <li key={m}>
            <button type="button" onClick={() => { setMarket(m); history.pushState({ benzoStep: 1 }, "", `/start/?market=${m}`); }}
              className="group flex h-full w-full flex-col gap-5 rounded-[22px] bg-app-1 p-6 text-left ring-1 ring-app-line backdrop-blur-xl transition-[transform,box-shadow,background-color] duration-300 hover:-translate-y-0.5 hover:bg-[#232b1dd0] hover:shadow-[0_0_0_1px_#ddd6c633]" data-testid={`start-${m}`}>
              <Glyph name={DOOR[m]} className="size-16 transition-transform duration-300 group-hover:scale-110" />
              <span><span className="serif-figure block text-[26px] leading-tight text-[#f3eee2]">{MODE_NAME[m]}</span><span className="mt-1 block text-[14px] text-app-muted">{FOR[m]}</span></span>
            </button>
          </li>
        ))}
        <li id="launch" className="flex h-full flex-col gap-5 rounded-[22px] bg-app-1/60 p-6 ring-1 ring-app-line" data-testid="start-launch-note">
          <Glyph name={DOOR["launch"]} className="size-16 opacity-70" />
          <span><span className="serif-figure block text-[26px] leading-tight text-[#f3eee2]">{MODE_NAME["launch"]}</span><span className="mt-1 block text-[14px] text-app-muted">Started from the command line in this release: a launch's winners record where their units go with <code className="text-app-text">benzo launch deliver</code>, which the site doesn't collect yet. Past launches are in All rounds.</span></span>
        </li>
      </ul>
    </div>
  );
  return <Form market={market} onChange={() => (history.state?.benzoStep ? history.back() : (setMarket(null), history.replaceState({}, "", "/start/")))} />;
}

function Form({ market, onChange }: { market: Market; onChange: () => void }) {
  // The site's demo wallet address, offered for the payout field like the bid form offers it for refunds.
  const [demoUa, setDemoUa] = useState("");
  useEffect(() => { api.demo().then((d: any) => setDemoUa(d?.address ?? "")).catch(() => {}); }, []);
  const [f, setF] = useState<Record<string, string>>({ lot: "", minutes: "40", supply: market === "launch" ? "3" : market === "buyback" ? "2" : "1", reserve: "100", max_price: market === "buyback" ? "300" : market === "rfq" ? "500" : "3000",
    budget: market === "buyback" ? "600" : "1000", minimum_raise: "900", side: "seller", dealers: "2", payout_ua: "", treasury_ua: "" });
  const [lots, setLots] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tried, setTried] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const sells = market === "buyback" || market === "rfq";
  // Field checks, as you type: the amount as typed, never rewritten.
  const whole = (k: string, lo: number, hi = 1e9, step = 1) => { const v = (f[k] ?? "").trim(); if (!/^\d+$/.test(v)) return v ? `Use whole numbers. You entered ${v}.` : "Required."; const n = Number(v); if (n < lo || n > hi) return `Between ${lo.toLocaleString("en-US")} and ${hi.toLocaleString("en-US")}.`; if (step > 1 && n % step) return `Use steps of ${step}.`; return ""; };
  const errs: Record<string, string> = {
    supply: market === "uniform" || market === "launch" || market === "buyback" ? whole("supply", 1, 6) : "",
    reserve: market === "uniform" || market === "drop" ? whole("reserve", 10, 200000, 10) : "",
    max_price: whole("max_price", 20, 200000, 10),
    minimum_raise: market === "launch" ? whole("minimum_raise", 1) : "",
    budget: sells ? whole("budget", 20) : "",
  };
  const n = (k: string) => Number(f[k] || 0);
  // Terms that can't work, said before submitting.
  const cross = market === "launch" && !errs.supply && !errs.max_price && !errs.minimum_raise && n("minimum_raise") > n("supply") * n("max_price") ? `The minimum raise is more than this round can raise: ${n("supply")} × ${n("max_price").toLocaleString("en-US")} = ${(n("supply") * n("max_price")).toLocaleString("en-US")} zats.`
    : (market === "uniform" || market === "drop") && !errs.reserve && !errs.max_price && n("reserve") > n("max_price") ? "The reserve is higher than the highest bid allowed."
    : market === "rfq" && !errs.budget && !errs.max_price && n("budget") < n("max_price") ? "The budget must cover the highest quote you'd accept." : "";
  const lotNames = lots.map((x) => x.trim()).filter(Boolean);
  const lotErr = market === "drop" && (lotNames.length < 2 || new Set(lotNames).size !== lotNames.length) ? "Name 2 to 5 different lots." : "";
  const invalid = Object.values(errs).some(Boolean) || Boolean(cross) || Boolean(lotErr);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setTried(true);
    if (invalid) return;
    setBusy(true);
    try {
      let key: { private_hex: string; public_hex: string } | null = null;
      if (market === "otc") { const { newPartyKey } = await import("../../lib/bidder"); key = await newPartyKey(); }
      const r = await api.start({ ...f, lots: lotNames.join(", "), mode: market, ...(key ? { creator_key: key.public_hex } : {}) });
      if (key) addParty({ ...key, rid: r.rid, label: f.side === "buyer" ? "Buyer" : "Seller" });
      addStarted({ rid: r.rid, token: r.token, mode: market, lot: f.lot, at: Date.now() });
      location.href = `/round/?r=${r.rid}&t=${r.token}`;
    } catch (x) { const m = String((x as Error).message); setErr(m.charAt(0).toUpperCase() + m.slice(1)); setBusy(false); }
  };
  const num = (k: string, label: string, help?: string, unit = "zats") => (
    <Field label={label} help={tried && errs[k] ? undefined : help}>
      <div className="relative">
        <input value={f[k] ?? ""} onChange={set(k)} inputMode="numeric" aria-invalid={Boolean(tried && errs[k])} className={cx(fieldCls, "tabular-nums", unit && "pr-14", tried && errs[k] && "ring-bad")} data-testid={`start-${k}`} />
        {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-app-faint">{unit}</span>}
      </div>
      {tried && errs[k] && <span className="text-[13px] text-bad">{errs[k]}</span>}
    </Field>
  );
  const proceeds = market === "uniform" || market === "launch" || market === "drop";
  const next = market === "otc" ? `Next: send the ${f.side === "buyer" ? "seller" : "buyer"} their invite. Each side submits its own sealed limit.` : market === "rfq" ? "Next: send each dealer their invite, then fund the budget from your wallet." : market === "buyback" ? "Next: fund the budget from your wallet once the round is set up." : "Next: the round is set up on the signers, then it takes bids.";
  const summary = (
    <Panel>
      <div className="flex items-center gap-3">
        <Glyph name={DOOR[market]} className="size-12" />
        <div className="min-w-0"><div className="truncate text-[17px] font-semibold">{f.lot || "Untitled"}</div><div className="text-[13px] text-app-muted">{MODE_NAME[market]}</div></div>
      </div>
      <dl className="mt-5 grid gap-2.5 text-[14px]">
        {market === "drop" && <div className="flex justify-between gap-3"><dt className="text-app-faint">Lots</dt><dd className="min-w-0 text-right">{lotNames.join(", ") || "—"}</dd></div>}
        {market === "otc" && <div className="flex justify-between"><dt className="text-app-faint">You</dt><dd>{f.side === "buyer" ? "Buyer" : "Seller"}</dd></div>}
        {(market === "uniform" || market === "launch") && <div className="flex justify-between"><dt className="text-app-faint">{sells ? "Units wanted" : "Units"}</dt><dd className="tabular-nums">{f.supply || "—"}</dd></div>}
        <div className="flex justify-between"><dt className="text-app-faint">{market === "buyback" ? "Asks" : market === "rfq" ? "Quotes" : "Bids"}</dt><dd className="tabular-nums">{sells || market === "otc" || market === "launch" ? `up to ${zats(f.max_price)} zats` : `${zats(f.reserve)}–${zats(f.max_price)} zats`}</dd></div>
        {market === "launch" && <div className="flex justify-between"><dt className="text-app-faint">Minimum raise</dt><dd className="tabular-nums">{zats(f.minimum_raise)} zats</dd></div>}
        {sells && <div className="flex justify-between"><dt className="text-app-faint">Budget you'll fund</dt><dd className="tabular-nums">{zats(f.budget)} zats</dd></div>}
        <div className="flex justify-between"><dt className="text-app-faint">Deposit per bid</dt><dd className="tabular-nums">200,000 zats</dd></div>
        <div className="flex justify-between"><dt className="text-app-faint">Bidding lasts</dt><dd className="tabular-nums">{f.minutes} minutes after setup</dd></div>
      </dl>
      <p className="mt-4 text-[12.5px] text-app-faint">Exact closing and opening times appear on the round's page once it's set up. Testnet only.</p>
    </Panel>
  );
  return (
    <div className="flex flex-col fit:min-h-0 fit:flex-1">
      <PageHead glyph="quill" title={`New ${marketTitle(MODE_NAME[market])} round`} sub={FOR[market]}
        aside={<button type="button" onClick={onChange} className="text-[14px] text-app-muted hover:text-app-text">Change market</button>} />
      <div className="mt-7 grid gap-6 fit:min-h-0 fit:flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={go} className="grid content-start gap-4 fit:min-h-0 fit:overflow-auto fit:pb-2 fit:pr-2" data-testid="start-form" noValidate>
          <Panel>
            <div className="grid gap-4">
              {market === "otc" && (
                <Field label="Your side">
                  <select value={f.side} onChange={set("side")} className={fieldCls} data-testid="start-side"><option value="seller">I'm the seller</option><option value="buyer">I'm the buyer</option></select>
                </Field>
              )}
              <Field label={market === "rfq" ? "What you want quotes for" : market === "buyback" ? "What you're buying back" : market === "launch" ? "Project or allocation name" : market === "otc" ? "What the two of you are trading" : market === "drop" ? "Name of the drop" : "What you're selling"}>
                <input value={f.lot} onChange={set("lot")} maxLength={40} placeholder={market === "drop" ? "Autumn print series" : market === "rfq" ? "Smart-contract audit" : market === "launch" ? "Seed allocation" : market === "buyback" ? "Membership passes" : market === "otc" ? "50 ZEC block" : "Limited print run"} className={fieldCls} data-testid="start-lot" />
              </Field>
              {market === "drop" && (
                <div className="grid gap-2">
                  <span className="text-[13.5px] font-medium">Lots</span>
                  {lots.map((x, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={x} onChange={(e) => setLots(lots.map((y, j) => (j === i ? e.target.value : y)))} maxLength={40} placeholder={`Lot ${i + 1} name`} className={fieldCls} data-testid={i === 0 ? "start-lots" : undefined} />
                      {lots.length > 2 && <button type="button" onClick={() => setLots(lots.filter((_, j) => j !== i))} className="shrink-0 rounded-[10px] bg-app-2 px-3 text-[13px] text-app-muted hover:text-app-text" aria-label={`Remove lot ${i + 1}`}>Remove</button>}
                    </div>
                  ))}
                  {lots.length < 5 && <button type="button" onClick={() => setLots([...lots, ""])} className="w-fit text-[14px] text-app-muted hover:text-app-text">+ Add a lot</button>}
                  {tried && lotErr && <span className="text-[13px] text-bad">{lotErr}</span>}
                </div>
              )}
            </div>
          </Panel>
          <Panel>
            <div className="grid gap-4 sm:grid-cols-2">
              {(market === "uniform" || market === "launch") && num("supply", sells ? "Units you want to buy" : "Units available", undefined, "")}
              {(market === "uniform" || market === "drop") && num("reserve", market === "drop" ? "Minimum price for each lot" : "Minimum price per unit", "Bids below this don't win.")}
              {num("max_price", market === "buyback" ? "Highest price per unit you'll pay" : market === "rfq" ? "Highest quote you'll accept" : market === "otc" ? "Price ceiling for both sides" : market === "drop" ? "Highest bid allowed for each lot" : "Highest bid allowed per unit", market === "otc" ? "A public rule. Each of you enters a private limit later." : undefined)}
              {market === "launch" && num("minimum_raise", "Minimum total raise", "Below this, nothing sells and everyone is refunded.")}
              {sells && num("budget", "Budget you'll fund", "You pay this in after setup; whatever isn't spent comes back.")}
              {market === "rfq" && <Field label="Dealers to invite"><select value={f.dealers} onChange={set("dealers")} className={fieldCls} data-testid="start-dealers">{[2, 3, 4].map((x) => <option key={x} value={x}>{x} dealers</option>)}</select></Field>}
              <Field label="Bidding time"><select value={f.minutes} onChange={set("minutes")} className={fieldCls} data-testid="start-minutes">{[20, 40, 60, 90].map((x) => <option key={x} value={x}>{x} minutes</option>)}</select></Field>
            </div>
            {cross && <p className="mt-4 text-[13.5px] text-bad" data-testid="start-cross">{cross}</p>}
          </Panel>
          {(proceeds || sells) && (
            <Panel>
              {proceeds
                ? <Field label="Receive what you sell for at" help="A shielded address from your testnet wallet (utest1…)."><input value={f.payout_ua} onChange={set("payout_ua")} spellCheck={false} placeholder="utest1…" className={cx(fieldCls, "text-[13.5px]")} data-testid="start-payout_ua" /></Field>
                : <Field label="Return unspent budget to" help="A shielded address from your testnet wallet (utest1…)."><input value={f.treasury_ua} onChange={set("treasury_ua")} spellCheck={false} placeholder="utest1…" className={cx(fieldCls, "text-[13.5px]")} data-testid="start-treasury_ua" /></Field>}
              {demoUa && <p className="mt-2 text-[13px] text-app-muted">No testnet wallet? <button type="button" className="text-app-text underline underline-offset-4" data-testid="start-use-demo" onClick={() => setF((x) => ({ ...x, [proceeds ? "payout_ua" : "treasury_ua"]: demoUa }))}>Use the demo wallet's address</button>. Anything sent there goes back to the site's demo wallet.</p>}
            </Panel>
          )}
          <div className="lg:hidden"><div className="mb-2 text-[13px] text-app-faint">Review the round</div>{summary}</div>
          {/* The action stays in view at the foot of the form, like an order ticket's button. */}
          <div className="grid gap-2 fit:sticky fit:bottom-0 fit:-mx-1 fit:rounded-2xl fit:bg-[#141a10f2] fit:px-1 fit:pb-1 fit:pt-3 fit:backdrop-blur-xl">
            {err && <ErrorLine testid="start-error">{err}</ErrorLine>}
            {tried && invalid && !err && <ErrorLine testid="start-error">Some terms need fixing; they're marked above.</ErrorLine>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <Btn type="submit" disabled={busy} testid="start-submit">{busy ? "Creating…" : "Create round"}</Btn>
              <p className="text-[13px] text-app-muted">No payment is sent now. {next}</p>
            </div>
          </div>
        </form>
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          <div className="mb-2 text-[13px] text-app-faint">Review the round</div>
          {summary}
        </aside>
      </div>
    </div>
  );
}
