// One round (after Fragment's lot page, Coinbase's order detail and Etherscan's transaction page): what happened first, in
// words; the figures that answer it; the round's sequence of commitments; every bid as opened, in the market's own terms;
// the recorded payments grouped by their transactions. Beside it: the one thing to do (bid while open, find your bid
// after) and what the public checks establish.
import { useEffect, useRef, useState } from "react";
import { api, MODE_NAME, short, zec } from "../../lib/api";
import { outcomeLine } from "../../lib/outcome";
import { Btn, Copyable, ErrorLine, Figure, H2, Panel, Pill, StatePill, Tick, Timeline, checkName, cx, fieldCls, rel, when, zats } from "../app/ui";
import { clock, useCountdown } from "./useCountdown";
import type { AuctionDetail } from "../../lib/types";

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

// The story of the round in one or two sentences, by market.
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

export default function AuctionView() {
  const id = typeof location !== "undefined" ? new URLSearchParams(location.search).get("id") ?? "" : "";
  const [d, setD] = useState<(AuctionDetail & { freeze?: any }) | null>(null);
  const [err, setErr] = useState<"" | "missing" | "unavailable" | "bad">("");
  const [stale, setStale] = useState(false);
  const load = useRef<() => void>(() => {});
  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(id)) { setErr("bad"); return; }
    let gone = false;
    load.current = () => api.auction(id).then((x) => { if (!gone) { setD(x); setErr(""); setStale(false); } })
      .catch((e) => { if (gone) return; const m = String((e as Error).message); setD((old) => { if (old) setStale(true); else setErr(/: 404 /.test(m) ? "missing" : "unavailable"); return old; }); });
    load.current();
    const t = window.setInterval(() => load.current(), 20_000);
    return () => { gone = true; window.clearInterval(t); };
  }, [id]);
  const toClose = useCountdown(d?.T_submit);
  if (err === "bad" || err === "missing") return <div className="py-16"><h1 className="text-[26px]" data-testid="ticket-title">Round not found</h1><p className="mt-2 text-app-muted">{err === "bad" ? "This link doesn't point to a round." : "There's no round with this id. Check the link or browse all rounds."}</p><div className="mt-6"><Btn href="/lots/" kind="secondary">Browse rounds</Btn></div></div>;
  if (err === "unavailable") return <div className="py-16"><h1 className="text-[26px]" data-testid="ticket-title">We couldn't load this round</h1><p className="mt-2 text-app-muted">The service didn't answer. The round itself is fine; try again in a moment.</p><div className="mt-6"><Btn onClick={() => { setErr(""); load.current(); }}>Try again</Btn></div></div>;
  if (!d) return <div className="py-16"><h1 className="text-[26px] text-app-muted" data-testid="ticket-title">Loading the round…</h1></div>;

  const m: any = d.manifest, live = d.live && d.state === "OPEN" && !!toClose, sells = SELLS(d.mode);
  const allocations: any[] = d.result?.allocations ?? [];
  // An OTC trade fills both sides of one unit: count the buyer's side. A buyer's payment there comes out of the deposit
  // (deposit minus refund); payment_zats on the seller's row is what the seller received.
  const counted = d.mode === "otc" ? allocations.filter((a) => a.side === "buyer") : allocations;
  const sold = counted.reduce((s, a) => s + Number(a.fill ?? 0), 0), paid = counted.reduce((s, a) => s + (Number(a.fill ?? 0) ? Number(a.payment_zats ?? 0) : 0), 0);
  const rowPaid = (a: any) => d.mode === "otc" && a.side === "buyer" && Number(a.fill) ? Number(d.C_zats) - Number(a.refund_zats ?? 0) : Number(a.payment_zats ?? 0);
  const sellerGot = d.mode === "otc" ? allocations.filter((a) => a.side === "seller").reduce((s, a) => s + Number(a.payment_zats ?? 0), 0) : d.receipts.filter((r) => r.party === "seller").reduce((s, r) => s + Number(r.amount_zats), 0);
  const of = m.lots ? m.lots.length : d.supply;
  const lotName = (h: string) => { const i = (m.lots ?? []).indexOf(h); return i >= 0 ? `Lot ${i + 1}` : "—"; };
  const ok = d.checks.filter((c) => c.ok).length, na = d.checks.filter((c) => c.status === "not_applicable").length;
  const now = Date.now() / 1000, opened = Boolean(d.result), done = d.state === "SETTLED" || d.state === "CANCELLED";
  const step = (isDone: boolean, isNow: boolean) => (isDone ? "done" : isNow ? "now" : "next") as "done" | "now" | "next";
  const steps = [
    { label: now < d.T_submit ? "Bidding open" : "Bidding closed", at: when(d.T_submit), state: step(now >= d.T_submit, now < d.T_submit) },
    { label: "Bids committed", at: d.freeze_root ? `${d.leaf_count ?? 0} sealed bids, fixed` : `by ${when(d.T_freeze)}`, state: step(Boolean(d.freeze_root), now >= d.T_submit && !d.freeze_root) },
    { label: "Bids opened", at: when(d.release), state: step(opened, Boolean(d.freeze_root) && !opened) },
    { label: d.state === "CANCELLED" ? "Refunded" : done ? "Paid out" : opened ? "Paying out" : "Paid out", at: done ? `record updated ${when(d.updated)}` : opened ? "in progress" : "after opening", state: step(done, opened && !done) },
  ];
  // Recorded payments, grouped by the transaction that carried them.
  const byTx = new Map<string, typeof d.receipts>();
  for (const r of d.receipts) { const k = r.txid ?? "pending"; byTx.set(k, [...(byTx.get(k) ?? []), r]); }
  const cons: any = (d.result as any)?.conservation;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 break-words text-[28px]" data-testid="ticket-title">{d.lot ?? `${MODE_NAME[d.mode]} round`}</h1>
        <StatePill state={d.state} live={live} testid="ticket-light" />
      </div>
      <p className="mt-1.5 text-[14px] text-app-muted" data-testid="auction-caption">{MODE_NAME[d.mode]} · {m.lots ? `${m.lots.length} lots` : `${d.supply} unit${d.supply > 1 ? "s" : ""}`} · {d.leaf_count ?? 0} sealed bids · {short(d.id, 4)}</p>
      <div className="mt-5 max-w-[720px]" data-testid="story">
        <div className="text-[19px] font-semibold">{outcomeLine(d)}</div>
        <p className="mt-1 text-[15px] text-app-muted">{story(d, sold)}</p>
      </div>
      {stale && <div className="mt-4"><ErrorLine>Updates unavailable right now; showing the last loaded record. <button className="underline" onClick={() => load.current()}>Retry</button></ErrorLine></div>}

      <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4">
          {live && (
            <Panel className="lg:hidden">
              <div className="flex items-center justify-between gap-3"><div><div className="text-[13px] text-app-faint">Bidding closes in</div><div className="text-[24px] font-semibold tabular-nums text-gold">{clock(toClose!)}</div></div><Btn href={`/bid/?id=${d.id}`} testid="auction-bid-m">{sells ? "Make an offer" : "Place a sealed bid"}</Btn></div>
            </Panel>
          )}
          <Panel>
            {opened ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                {d.mode === "drop" ? <Figure label="Lots sold" value={`${sold} of ${of}`} gold /> : <Figure label={sells ? "Price paid per unit" : d.mode === "otc" ? "Trade price" : "Clearing price"} value={d.clearing_price_zats && d.clearing_price_zats !== "0" ? `${zats(d.clearing_price_zats)} zats` : "—"} gold />}
                {d.mode === "drop" ? <Figure label="Winning bids" value={`${zats(paid)} zats`} note="each lot at its own price" /> : <Figure label={sells ? "Units bought" : "Units sold"} value={`${sold} of ${of}`} />}
                <Figure label={sells ? "Offers" : "Bids"} value={d.leaf_count ?? 0} />
                <Figure label={sells ? "Paid to sellers" : "Seller received"} value={`${zats(sells ? paid : sellerGot)} zats`} note={!sells && !done && d.mode !== "otc" ? "so far" : undefined} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                <Figure label="Deposit" value={`${zec(d.C_zats)} TAZ`} note={sells ? "returned, plus any payout" : "returned unless you win"} />
                <Figure label={d.mode === "buyback" ? "Highest ask" : d.mode === "rfq" ? "Highest quote" : "Price range"} value={sells ? `${zats(m.buyback?.max_price_zats ?? m.rfq?.max_price_zats)} zats` : `${zats(m.reserve_zats)}–${zats(m.B_max_zats)}`} note={sells ? undefined : "zats per unit"} />
                <Figure label={m.lots ? "Lots" : "Units"} value={of} />
                <Figure label="Bids open" value={rel(d.release)} note={when(d.release)} />
              </div>
            )}
          </Panel>

          <Panel><Timeline steps={steps} testid="timeline" /><p className="mt-4 text-[12.5px] text-app-faint">Times in your local time{zone() ? ` (${zone()})` : ""}.</p></Panel>

          <div className="min-w-0">
            <H2 aside={opened ? undefined : "sealed until they open"}>{sells ? "Offers" : "Bids"}</H2>
            {opened ? (
              <Panel pad={false}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[14px] tabular-nums" data-testid="allocations">
                    <thead className="text-left text-[13px] text-app-faint"><tr className="[&>th]:px-5 [&>th]:pb-2 [&>th]:pt-4 [&>th]:font-normal">
                      <th>{d.mode === "otc" ? "Side" : sells ? "Offer" : "Bid"}</th>{m.lots && <th>Lot</th>}<th className="text-right">{sells ? "Ask" : d.mode === "otc" ? "Limit" : "Price"}</th><th>Result</th><th className="text-right">{sells ? "Proceeds" : d.mode === "otc" ? "Paid / received" : "Paid"}</th><th className="text-right">{sells ? "Deposit back" : "Refund"}</th>
                    </tr></thead>
                    <tbody>{allocations.map((a) => { const o = outcome(a.outcome, sells); return (
                      <tr key={a.leaf_index} className="border-t border-app-line [&>td]:px-5 [&>td]:py-3">
                        <td>{d.mode === "otc" ? (a.side === "buyer" ? "Buyer" : a.side === "seller" ? "Seller" : "—") : a.leaf_index + 1}</td>{m.lots && <td className="text-app-muted">{lotName(a.lot)}</td>}
                        <td className="text-right">{a.price_zats ? zats(a.price_zats) : "—"}</td>
                        <td><span title={o.why}><Pill kind={o.kind}>{o.word}</Pill></span></td>
                        <td className="text-right">{rowPaid(a) ? zats(rowPaid(a)) : "0"}</td>
                        <td className="text-right text-app-muted">{zats(sells ? d.C_zats : a.refund_zats ?? 0)}</td>
                      </tr>); })}</tbody>
                  </table>
                </div>
              </Panel>
            ) : (
              <Panel><p className="text-[14px] text-app-muted">{d.leaf_count ? `${d.leaf_count} sealed bids. ` : ""}Prices stay sealed until the bids open, {rel(d.release)}.</p></Panel>
            )}
          </div>

          {d.receipts.length > 0 && (
            <div className="min-w-0">
              <H2 aside={`${byTx.size} shielded transaction${byTx.size > 1 ? "s" : ""}, signed by two of three`}>Payments</H2>
              <Panel pad={false}>
                {[...byTx.entries()].map(([tx, rs]) => (
                  <div key={tx} className="border-t border-app-line first:border-t-0">
                    <div className="flex items-center justify-between gap-3 px-5 pt-3 text-[12.5px] text-app-faint"><span>Transaction</span>{tx !== "pending" ? <Copyable value={tx} display={short(tx, 6)} /> : <span>not sent yet</span>}</div>
                    <ul data-testid="payments">{rs.map((r, i) => (
                      <li key={i} className="flex items-center justify-between gap-4 px-5 py-2.5 text-[14px]"><span className="min-w-0 truncate">{party(r.party)}</span><span className="shrink-0 tabular-nums">{zats(r.amount_zats)} zats</span></li>
                    ))}</ul>
                  </div>
                ))}
                {cons && <p className="border-t border-app-line px-5 py-3 text-[13px] text-app-muted tabular-nums">Where the money went: {zats(Number(cons.input_zats) + Number(cons.balances_zats ?? 0))} in{Number(cons.balances_zats ?? 0) ? ` (${zats(cons.input_zats)} deposits + ${zats(cons.balances_zats)} balances)` : ""} = {zats(cons.payout_zats)} paid out + {zats(cons.refund_zats)} refunded + {zats(cons.fees_zats)} fees.</p>}
              </Panel>
            </div>
          )}
        </div>

        <aside className="grid min-w-0 content-start gap-4">
          {live ? (
            <Panel className="hidden lg:block">
              <div className="text-[13px] text-app-faint">Bidding closes in</div>
              <div className="mt-1 text-[30px] font-semibold tabular-nums tracking-tight text-gold">{clock(toClose!)}</div>
              <div className="mt-4"><Btn href={`/bid/?id=${d.id}`} full testid="auction-bid">{sells ? "Make a sealed offer" : "Place a sealed bid"}</Btn></div>
              <p className="mt-3 text-[13px] text-app-muted">Nobody can see your price until the bids open at {when(d.release)}.</p>
            </Panel>
          ) : (
            <ReceiptLookup d={d} frozen={Boolean(d.freeze_root)} sells={sells} />
          )}
          {done && <Panel testid="checks-panel">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[15px] font-medium">{ok} of {d.checks.length} checks pass</div>
              <Pill kind={d.valid ? "good" : "bad"}>{d.valid ? "Record checks out" : "Problem"}</Pill>
            </div>
            <p className="mt-1 text-[13px] text-app-muted">Checks of the round's public record, reported by this service{na ? `; ${na} don't apply to this round` : ""}.</p>
            <details className="mt-3 text-[14px]" data-testid="checks">
              <summary className="cursor-pointer text-app-muted hover:text-app-text">Show the checks</summary>
              <ul className="mt-3 grid gap-1.5">{d.checks.map((c) => <li key={c.id} className="flex gap-2.5">{c.status === "not_applicable" ? <span className="mt-[3px] size-4 shrink-0 text-center text-app-faint">–</span> : <Tick ok={c.ok} />}<span className={cx("min-w-0 break-words", c.status === "not_applicable" && "text-app-faint")}>{checkName(c.id)}{c.status === "not_applicable" ? " · not applicable" : ""}</span></li>)}</ul>
            </details>
            <a href={`/verify/?id=${d.id}`} className="mt-2 inline-block text-[14px] text-app-muted hover:text-app-text">Verify it yourself</a>
          </Panel>}
        </aside>
      </div>
    </div>
  );
}

// Find your bid: paste its hash, or open the bid key file (read here, never uploaded); says what happened to that bid.
function ReceiptLookup({ d, frozen, sells }: { d: AuctionDetail; frozen: boolean; sells: boolean }) {
  const [hash, setHash] = useState(() => new URLSearchParams(location.search).get("bid") ?? "");
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
  if (!frozen) return <Panel><div className="text-[15px] font-medium">Bidding closed</div><p className="mt-1 text-[14px] text-app-muted">The bids are being committed. Your bid's receipt appears here after.</p></Panel>;
  const s = out?.settlement, li = out ? Number(out.inclusion.leaf_index) : -1, al = (d.result?.allocations ?? []).find((a: any) => a.leaf_index === li);
  const mine = al ? outcome(al.outcome, sells) : null;
  const paidHere = (a: any) => d.mode === "otc" && a.side === "buyer" && Number(a.fill) ? Number(d.C_zats) - Number(a.refund_zats ?? 0) : Number(a.payment_zats ?? 0);
  return (
    <Panel>
      <div className="text-[15px] font-medium">Find your bid</div>
      <form onSubmit={(e) => { e.preventDefault(); void look(); }} className="mt-3 grid gap-2">
        <label className="sr-only" htmlFor="ct">Bid hash</label>
        <input id="ct" value={hash} onChange={(e) => setHash(e.target.value.trim())} placeholder="Bid hash (in your recovery file)" spellCheck={false} className={cx(fieldCls, "text-[13.5px]")} />
        <div className="flex gap-2">
          <Btn type="submit" kind="secondary" disabled={busy} className="flex-1">{busy ? "Looking up…" : "Look up"}</Btn>
          <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full px-4 text-[14px] font-semibold text-app-muted hover:text-app-text">Open recovery file<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void openKey(e.target.files?.[0])} /></label>
        </div>
      </form>
      {err && <div className="mt-3"><ErrorLine>{err}</ErrorLine></div>}
      {out && (
        <div className="mt-4 grid gap-1.5 text-[14px]" data-testid="receipt">
          <div className="text-[16px] font-medium">{mine ? `Bid ${li + 1} · ${mine.word}` : `Bid ${li + 1} is in this round`}</div>
          {mine?.why && <p className="text-[13px] text-app-muted">{mine.why}</p>}
          {al && paidHere(al) > 0 && <div className="flex justify-between"><span className="text-app-faint">{sells || (d.mode === "otc" && al.side === "seller") ? "Proceeds" : "Paid"}</span><span className="tabular-nums">{zats(paidHere(al))} zats</span></div>}
          <div className="flex justify-between"><span className="text-app-faint">{sells ? "Sent to you" : "Refund"}</span><span className="tabular-nums">{s ? `${zats(s.amount_zats)} zats` : "Not sent yet"}</span></div>
          <span className="sr-only">{out.inclusion.ciphertext_hash}</span>
        </div>
      )}
    </Panel>
  );
}
