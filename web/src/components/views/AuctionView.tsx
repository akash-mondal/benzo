// One round (after Fragment's lot page): its name and state, the figures that answer "what happened", the round's
// timeline, the bids once opened, who was paid; beside it the one thing to do (bid while open, find your bid after) and
// whether the round checks out.
import { useEffect, useState } from "react";
import { api, MODE_NAME, short, zec } from "../../lib/api";
import { Btn, Copyable, ErrorLine, Figure, H2, Panel, Pill, StatePill, Tick, Timeline, checkName, cx, fieldCls, rel, zats, when } from "../app/ui";
import { clock, useCountdown } from "./useCountdown";
import type { AuctionDetail } from "../../lib/types";

const OUTCOME: Record<string, { word: string; kind: "good" | "plain" | "bad" }> = {
  winner: { word: "Won", kind: "good" }, unfilled: { word: "Not filled", kind: "plain" }, below_reserve: { word: "Below reserve", kind: "plain" },
  superseded: { word: "Replaced", kind: "plain" }, no_match: { word: "No match", kind: "plain" }, not_allowlisted: { word: "Not invited", kind: "bad" },
  not_party: { word: "Not a party", kind: "bad" }, invalid: { word: "Invalid", kind: "bad" }, above_max: { word: "Over the maximum", kind: "plain" },
};
const outcome = (o: string) => OUTCOME[o] ?? { word: o.replace(/_/g, " "), kind: "plain" as const };
const party = (p: string) => p.replace(/^leaf:(\d+)$/, (_, n) => `Bid ${Number(n) + 1}`).replace(/^seller$/, "Seller").replace(/^treasury$/, "Unspent budget").replace(/^fee.*$/, "Fee reserve").replace(/:.*$/, "");

export default function AuctionView() {
  const id = typeof location !== "undefined" ? new URLSearchParams(location.search).get("id") ?? "" : "";
  const [d, setD] = useState<(AuctionDetail & { freeze?: any }) | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(id)) { setErr("This link doesn't point to a round."); return; }
    let gone = false;
    const load = () => api.auction(id).then((x) => { if (!gone) setD(x); }).catch(() => !gone && setErr("We couldn't find this round."));
    load();
    const t = window.setInterval(load, 20_000);
    return () => { gone = true; window.clearInterval(t); };
  }, [id]);
  const toClose = useCountdown(d?.T_submit);
  if (err) return <div className="py-16"><h1 className="text-[26px]" data-testid="ticket-title">Round not found</h1><p className="mt-2 text-app-muted">{err}</p><div className="mt-6"><Btn href="/lots/" kind="secondary">Every lot</Btn></div></div>;
  if (!d) return <div className="py-16"><h1 className="text-[26px] text-app-muted" data-testid="ticket-title">Loading…</h1></div>;

  const m: any = d.manifest, live = d.live && d.state === "OPEN" && !!toClose;
  const allocations: any[] = d.result?.allocations ?? [];
  const sold = allocations.reduce((s, a) => s + Number(a.fill ?? 0), 0);
  const paidOut = d.receipts.reduce((s, r) => s + Number(r.amount_zats), 0);
  const sellerGot = d.mode === "buyback" || d.mode === "rfq" ? allocations.reduce((s, a) => s + Number(a.payment_zats ?? 0), 0) : d.receipts.filter((r) => r.party === "seller").reduce((s, r) => s + Number(r.amount_zats), 0);
  const ok = d.checks.filter((c) => c.ok).length;
  const now = Date.now() / 1000;
  const settledAt = d.state === "SETTLED" || d.state === "CANCELLED" ? d.updated : null;
  const step = (at: number, done: boolean, isNow: boolean) => (done ? "done" : isNow ? "now" : "next") as "done" | "now" | "next";
  const opened = Boolean(d.result);
  const steps = [
    { label: "Bids close", at: when(d.T_submit), state: step(d.T_submit, now >= d.T_submit, now < d.T_submit) },
    { label: "Frozen", at: d.freeze_root ? `${d.leaf_count ?? 0} sealed bids` : when(d.T_freeze), state: step(d.T_freeze, Boolean(d.freeze_root), now >= d.T_submit && !d.freeze_root) },
    { label: "Bids open", at: when(d.release), state: step(d.release, opened, Boolean(d.freeze_root) && !opened) },
    { label: d.state === "CANCELLED" ? "Refunded" : "Paid out", at: settledAt ? when(settledAt) : "after opening", state: step(0, Boolean(settledAt), opened && !settledAt) },
  ];
  const lots: string[] | undefined = m.lots;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px]" data-testid="ticket-title">{d.lot ?? `${MODE_NAME[d.mode]} round`}</h1>
        <StatePill state={d.state} live={live} testid="ticket-light" />
      </div>
      <p className="mt-1.5 text-[14px] text-app-muted" data-testid="auction-caption">{MODE_NAME[d.mode]} · {lots ? `${lots.length} lots` : `${d.supply} unit${d.supply > 1 ? "s" : ""}`} · {d.leaf_count ?? 0} sealed bids · {zec(d.C_zats)} TAZ deposit</p>

      <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4">
          <Panel>
            {d.state === "SETTLED" && opened ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                <Figure label={d.mode === "buyback" || d.mode === "rfq" ? "Clearing ask" : "Clearing price"} value={d.clearing_price_zats && d.clearing_price_zats !== "0" ? `${zats(d.clearing_price_zats)} zats` : "—"} gold />
                <Figure label="Units filled" value={`${sold} of ${lots ? lots.length : d.supply}`} />
                <Figure label="Bids" value={d.leaf_count ?? 0} />
                <Figure label={d.mode === "buyback" || d.mode === "rfq" ? "Sellers received" : "Seller received"} value={`${zats(sellerGot)} zats`} note={`${d.receipts.length} payments`} />
              </div>
            ) : d.state === "CANCELLED" ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                <Figure label="Result" value="Refunded" />
                <Figure label="Bids" value={d.leaf_count ?? 0} />
                <Figure label="Returned" value={`${zec(paidOut)} TAZ`} note={`${d.receipts.length} refunds`} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                <Figure label="Deposit" value={`${zec(d.C_zats)} TAZ`} note="returned unless you win" />
                <Figure label={d.mode === "buyback" ? "Highest ask" : d.mode === "rfq" ? "Highest quote" : "Price range"} value={d.mode === "buyback" || d.mode === "rfq" ? `${zats(m.buyback?.max_price_zats ?? m.rfq?.max_price_zats)} zats` : `${zats(m.reserve_zats)}–${zats(m.B_max_zats)}`} note={d.mode === "buyback" || d.mode === "rfq" ? undefined : "zats per unit"} />
                <Figure label={lots ? "Lots" : "Units"} value={lots ? lots.length : d.supply} />
                <Figure label="Bids open" value={rel(d.release)} note={when(d.release)} />
              </div>
            )}
          </Panel>

          <Panel><Timeline steps={steps} testid="timeline" /></Panel>

          <div>
            <H2 aside={opened ? undefined : "sealed until they open"}>Bids</H2>
            {opened ? (
              <Panel pad={false} className="overflow-x-auto">
                <table className="w-full text-[14px] tabular-nums" data-testid="allocations">
                  <thead className="text-left text-[13px] text-app-faint"><tr className="[&>th]:px-5 [&>th]:pb-2 [&>th]:pt-4 [&>th]:font-normal"><th>Bid</th>{lots && <th>Lot</th>}<th className="text-right">Price</th><th>Result</th><th className="text-right">Pays</th><th className="text-right">Refund</th></tr></thead>
                  <tbody>{allocations.map((a) => (
                    <tr key={a.leaf_index} className="border-t border-app-line [&>td]:px-5 [&>td]:py-3">
                      <td>{a.leaf_index + 1}</td>{lots && <td className="text-app-muted">{a.lot ?? "—"}</td>}
                      <td className="text-right">{a.price_zats ? zats(a.price_zats) : "—"}</td>
                      <td><Pill kind={outcome(a.outcome).kind}>{outcome(a.outcome).word}</Pill></td>
                      <td className="text-right">{Number(a.payment_zats ?? 0) ? zats(a.payment_zats) : "0"}</td>
                      <td className="text-right text-app-muted">{zats(a.refund_zats ?? 0)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </Panel>
            ) : (
              <Panel><p className="text-[14px] text-app-muted">{d.leaf_count ? `${d.leaf_count} sealed bids. ` : ""}Prices stay sealed until the bids open, {rel(d.release)}.</p></Panel>
            )}
          </div>

          {d.receipts.length > 0 && (
            <div>
              <H2 aside="sent in one shielded transaction">Payments</H2>
              <Panel pad={false}>
                <ul data-testid="payments">{d.receipts.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-4 border-t border-app-line px-5 py-3 text-[14px] first:border-t-0">
                    <span>{party(r.party)}</span>
                    <span className="tabular-nums">{zats(r.amount_zats)} zats</span>
                  </li>
                ))}</ul>
              </Panel>
            </div>
          )}
        </div>

        <aside className="grid min-w-0 content-start gap-4">
          {live ? (
            <Panel>
              <div className="text-[13px] text-app-faint">Bids close in</div>
              <div className="mt-1 text-[30px] font-semibold tabular-nums tracking-tight text-gold">{clock(toClose!)}</div>
              <div className="mt-4"><Btn href={`/bid/?id=${d.id}`} full testid="auction-bid">{d.mode === "buyback" || d.mode === "rfq" ? "Make a sealed offer" : "Place a sealed bid"}</Btn></div>
              <p className="mt-3 text-[13px] text-app-muted">Nobody can see your price until the bids open at {when(d.release)}.</p>
            </Panel>
          ) : (
            <ReceiptLookup id={d.id} frozen={Boolean(d.freeze_root)} />
          )}
          {(d.state === "SETTLED" || d.state === "CANCELLED") && <Panel testid="checks-panel">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[15px] font-medium">{ok} of {d.checks.length} checks pass</div>
              <Pill kind={d.valid ? "good" : "bad"}>{d.valid ? "Verified" : "Problem"}</Pill>
            </div>
            <details className="mt-3 text-[14px]" data-testid="checks">
              <summary className="cursor-pointer text-app-muted hover:text-app-text">Show the checks</summary>
              <ul className="mt-3 grid gap-1.5">{d.checks.map((c) => <li key={c.id} className="flex gap-2.5"><Tick ok={c.ok} /><span className="min-w-0 break-words">{checkName(c.id)}</span></li>)}</ul>
            </details>
            <a href={`/verify/?id=${d.id}`} className="mt-2 inline-block text-[14px] text-app-muted hover:text-app-text">Open in Verify</a>
          </Panel>}
        </aside>
      </div>
    </div>
  );
}

function ReceiptLookup({ id, frozen }: { id: string; frozen: boolean }) {
  const [hash, setHash] = useState(() => new URLSearchParams(location.search).get("bid") ?? "");
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState("");
  const look = async (e?: React.FormEvent) => {
    e?.preventDefault(); setErr(""); setOut(null);
    try { setOut(await api.receipt(id, hash.trim())); } catch (x) { setErr(/not in frozen/.test(String((x as Error).message)) ? "That bid isn't in this round." : "Couldn't look that bid up."); }
  };
  useEffect(() => { if (hash && frozen) void look(); }, []);
  if (!frozen) return <Panel><div className="text-[15px] font-medium">Bids closed</div><p className="mt-1 text-[14px] text-app-muted">The round is being frozen; your bid's receipt appears here after.</p></Panel>;
  const s = out?.settlement;
  return (
    <Panel>
      <div className="text-[15px] font-medium">Find your bid</div>
      <form onSubmit={look} className="mt-3 grid gap-2">
        <label className="sr-only" htmlFor="ct">Bid hash</label>
        <input id="ct" value={hash} onChange={(e) => setHash(e.target.value)} placeholder="Bid hash (in your bid key file)" spellCheck={false} className={cx(fieldCls, "text-[13.5px]")} />
        <Btn type="submit" kind="secondary">Look up</Btn>
      </form>
      {err && <div className="mt-3"><ErrorLine>{err}</ErrorLine></div>}
      {out && (
        <div className="mt-4 grid gap-1.5 text-[14px]" data-testid="receipt">
          <div className="flex justify-between"><span className="text-app-faint">In the round</span><span>{out.inclusion.included ? `Yes, bid ${Number(out.inclusion.leaf_index) + 1}` : "No"}</span></div>
          <div className="flex justify-between"><span className="text-app-faint">Paid back</span><span className="tabular-nums">{s ? `${zats(s.amount_zats)} zats` : "Not yet"}</span></div>
          <span className="sr-only">{out.inclusion.ciphertext_hash}</span>
        </div>
      )}
    </Panel>
  );
}
