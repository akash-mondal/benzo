// Bid in a round, like a checkout (after Stripe Checkout, Coinbase send review and Uniswap's pending/success states): the
// round and its terms on one side, one card on the other walking through Seal → Pay → Track. The price and the refund
// address never leave this page: it seals the price to the round's opening with the shipped sealer, seals the address
// to the three signers, and sends the operator only the sealed record of a deposit you paid from your own wallet.
// Money states say only what is known: sealed is not paid, a transaction id is not a found deposit, found is not counted.
// No attempt is ever deleted; a closed round still shows the bid you made in it.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, MODE_NAME, short, zec } from "../../lib/api";
import { glyphFor } from "../../lib/glyphs";
import { archiveCurrent, attemptsFor, currentAttempt, partyFor, saveAttempt, type Attempt, type PartyKey } from "../../lib/mine";
import { Btn, Glyph, Copyable, ErrorLine, Field, Panel, Pill, cx, fieldCls, rel, when, zats } from "../app/ui";
import { clock, useCountdown } from "./useCountdown";
import type { AuctionDetail } from "../../lib/types";

const SELLS = (mode: string) => mode === "buyback" || mode === "rfq";
const taz = (zatsN: number | string) => `${(Number(zatsN) / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} TAZ`;

// Who you are in this round and what your number means.
export function roleOf(d: AuctionDetail, party: PartyKey | null) {
  const m: any = d.manifest, seller = SELLS(d.mode) || party?.label === "Seller";
  const lo = d.mode === "otc" ? 10 : Number(m.reserve_zats ?? 0) || 10, hi = Number(m.buyback?.max_price_zats ?? m.rfq?.max_price_zats ?? m.B_max_zats);
  const label = d.mode === "buyback" ? "Your ask, per unit" : d.mode === "rfq" ? "Your quote" : d.mode === "otc" ? (seller ? "Lowest price you'll accept" : "Highest price you'll pay") : m.lots ? "Your bid for this lot" : "Your price, per unit";
  const noun = d.mode === "buyback" ? "ask" : d.mode === "rfq" ? "quote" : d.mode === "otc" ? "limit" : "bid";
  // What happens to the deposit, for this side of this market.
  const deposit = seller ? "Your deposit comes back in full. If your offer is accepted, you're also paid." : "If you win, your payment comes out of this deposit and the rest comes back. If you don't, all of it comes back.";
  const rule = d.mode === "drop" ? "Each lot clears on its own: the highest bid at or above the reserve wins that lot and pays its bid." :
    d.mode === "launch" ? "If the bids reach the minimum raise, every winner pays the same clearing price. If not, everyone is refunded." :
    d.mode === "otc" ? "If the buyer's limit is at or above the seller's, you trade at the midpoint of the two. Otherwise there's no trade." :
    d.mode === "buyback" ? "The lowest asks are accepted, up to the budget, and every accepted seller is paid the same price." :
    d.mode === "rfq" ? "The lowest quote from an invited dealer wins and is paid the second-lowest quote, so quoting your true price is safe. It needs at least two quotes." : "Every winner pays the same clearing price.";
  return { seller, lo, hi, tick: Number(m.tick_zats ?? 10), label, noun, deposit, rule };
}

export default function BidView() {
  const q = new URLSearchParams(location.search), wanted = q.get("id");
  const [round, setRound] = useState<AuctionDetail | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      // An explicit round always loads (open, closed or settled), so a saved bid in it is never stranded.
      let d: AuctionDetail | null = null;
      if (wanted && /^[0-9a-f]{64}$/.test(wanted)) d = await api.auction(wanted).catch((e) => { if (!/: 404 /.test(String((e as Error).message))) setFailed(true); return null; });
      else { const list = await api.auctions(); const live = list.find((a) => a.live && a.state === "OPEN"); d = live ? await api.auction(live.id) : null; }
      setRound(d);
    })().catch(() => { setFailed(true); setRound(null); });
  }, []);
  const left = useCountdown(round?.T_submit);

  if (round === undefined) return <h1 className="py-16 text-app-muted" data-testid="ticket-title">Finding the round…</h1>;
  if (!round) return (
    <div className="mx-auto max-w-[540px] py-16 text-center">
      <Glyph name="hourglass" className="mx-auto size-16" />
      <h1 className="mt-6" data-testid="ticket-title">{failed ? "We couldn't load the rounds" : wanted ? "We couldn't find that round" : "No rounds are taking bids right now"}</h1>
      <p className="mt-2 text-app-muted">{failed ? "The service didn't answer. Try again in a moment." : "You can look at how finished rounds turned out, no wallet needed. New rounds open here when they start."}</p>
      <div className="mt-7 flex justify-center gap-3"><Btn href="/lots/?stage=settled" testid="bid-start">Explore finished rounds</Btn><Btn href="/start/" kind="secondary">Start a test round</Btn></div>
    </div>
  );
  const party = round.mode === "otc" || round.mode === "rfq" ? partyFor(round.request) : null;
  const role = roleOf(round, party);
  const open = round.live && round.state === "OPEN" && !!left;
  return (
    // Phone: the round, then the card, then the terms. Desktop: the round and its terms left, the card right.
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-[auto_1fr] lg:gap-x-10">
      <RoundSummary round={round} left={open ? left : 0} role={role} />
      <Panel className="self-start lg:col-start-2 lg:row-span-2 lg:row-start-1"><BidTicket round={round} /></Panel>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2"><Terms round={round} role={role} /><a href={`/auction/?id=${round.id}`} className="mt-6 inline-block text-[14px] text-app-muted underline-offset-4 hover:text-app-text hover:underline">View the round</a></div>
    </div>
  );
}

// The bid card: Seal, then Pay, then Track, for one round. Used by the bid page and by the round's terminal (its order
// ticket). It keeps this browser's attempts for the round; none is ever deleted.
export function BidTicket({ round }: { round: AuctionDetail }) {
  const [saved, setSaved] = useState<(Attempt & { key?: string }) | null>(() => currentAttempt(round.id));
  useEffect(() => { setSaved(currentAttempt(round.id)); }, [round.id]);
  const left = useCountdown(round.T_submit);
  const keep = (a: Attempt | null) => {
    if (!a) { archiveCurrent(round.id); setSaved(null); return; }
    const key = saveAttempt(round.id, a, saved?.key && saved.bid?.ciphertext_hash === a.bid?.ciphertext_hash ? saved.key : undefined);
    setSaved({ ...a, key });
  };
  const party = round.mode === "otc" || round.mode === "rfq" ? partyFor(round.request) : null;
  const role = roleOf(round, party);
  const open = round.live && round.state === "OPEN" && !!left;
  const step = !saved ? 0 : saved.step === "pay" ? 1 : 2;
  const others = attemptsFor(round.id).filter((a) => a.key !== saved?.key);
  return (
    <>
      <Steps step={step} />
      <div className="mt-6">
        {(round.mode === "otc" || round.mode === "rfq") && !party && !saved ? (
          <div data-testid="bid-parties-only"><div className="text-[16px] font-medium">Invited parties only</div><p className="mt-1 text-[14px] text-app-muted">This round takes {role.noun}s only from the people its creator invited. Open your invite link in this browser to take part.</p></div>
        ) : !open && !saved ? (
          <div data-testid="bid-closed"><div className="text-[16px] font-medium">{left ? "This round isn't taking bids here" : "Bidding has closed for this round"}</div><p className="mt-1 text-[14px] text-app-muted">{left ? "It was set up outside this site, so bids go in through its own tools. You can still follow how it turns out." : "You can still see how it turns out."}</p></div>
        ) : (
          <>
            {/* A round with no open deposit slot can't take another bid: say so before the form, not after sealing. */}
            {!saved && round.free_slots === 0 && !party && <div data-testid="bid-full"><div className="text-[16px] font-medium">This round is full</div><p className="mt-1 text-[14px] text-app-muted">Every deposit slot is taken, so it can't take another {role.noun}. <a href="/lots/?stage=open" className="text-app-text underline underline-offset-4">See rounds taking bids</a>.</p></div>}
            {!saved && !(round.free_slots === 0 && !party) && <Form round={round} party={party} role={role} onSealed={(bid) => keep({ step: "pay", bid })} />}
            {saved?.step === "pay" && <Pay round={round} role={role} s={saved} open={open} onKey={() => keep({ ...saved, savedKey: true })} onPaid={(txid) => keep({ ...saved, step: "track", txid, at: Date.now() })} onNew={() => keep(null)} />}
            {saved?.step === "track" && <Track round={round} role={role} s={saved} open={open} onNew={() => keep(null)} />}
          </>
        )}
        {others.length > 0 && <p className="mt-5 text-[13px] text-app-faint">You have {others.length} other {role.noun}{others.length > 1 ? "s" : ""} in this round. They're all in <a className="underline" href="/mine/">My activity</a>.</p>}
      </div>
    </>
  );
}

function RoundSummary({ round, left, role }: { round: AuctionDetail; left: number | null; role: ReturnType<typeof roleOf> }) {
  const m: any = round.manifest;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-4">
        <Glyph name={glyphFor(round.mode, round.id)} className="page-door size-16" />
        <div className="min-w-0">
          <div className="text-[13px] text-app-faint">{MODE_NAME[round.mode]} · Zcash testnet</div>
          <h1 className="truncate" data-testid="ticket-title">{round.lot ?? "Round"}</h1>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
        <div><div className="text-[13px] text-app-faint">Bidding closes</div><div className={cx("serif-figure mt-1 pb-0.5 text-[30px] leading-[1.1]", left ? "text-gold" : "text-app-muted")} data-testid="ticket-light">{left ? `in ${clock(left)}` : Date.now() / 1000 < round.T_submit ? "Not here" : "Closed"}</div><div className="text-[13px] text-app-muted">{when(round.T_submit)}</div></div>
        <div><div className="text-[13px] text-app-faint">Fixed deposit</div><div className="serif-figure mt-1 pb-0.5 text-[30px] leading-[1.1]">{zats(round.C_zats)} zats</div><div className="text-[13px] text-app-muted">{taz(round.C_zats)} · not your {role.noun}</div></div>
        <div><div className="text-[13px] text-app-faint">{m.lots ? "Lots" : round.mode === "buyback" ? "Budget" : role.seller ? "Units wanted" : "Units for sale"}</div><div className="serif-figure mt-1 text-[24px] leading-[1.1]">{m.lots ? `${m.lots.length} lots` : round.mode === "buyback" ? `${zats((m as any).buyback?.budget_zats ?? 0)} zats` : round.supply}</div></div>
        <div><div className="text-[13px] text-app-faint">Bids open</div><div className="serif-figure mt-1 text-[24px] leading-[1.1]">{rel(round.release)}</div><div className="text-[13px] text-app-muted">{when(round.release)}</div></div>
      </div>
    </div>
  );
}

// The terms, in this market's words for this side (shown under the card on a phone).
export function Terms({ round, role }: { round: AuctionDetail; role: ReturnType<typeof roleOf> }) {
  return (
    <div className="min-w-0">
      <dl className="grid gap-4 text-[14px]">
        <div><dt className="font-medium text-app-text">How this round decides</dt><dd className="mt-0.5 text-app-muted">{role.rule}</dd></div>
        <div><dt className="font-medium text-app-text">Your deposit</dt><dd className="mt-0.5 text-app-muted">{role.deposit} Every bidder pays the same deposit, so it gives nothing away.</dd></div>
        <div><dt className="font-medium text-app-text">Sealed until the bids open</dt><dd className="mt-0.5 text-app-muted">Your {role.noun} is sealed in this browser. Nobody, the operator included, can read it before the bids open at {when(round.release)}. After that, prices are published; addresses never are.</dd></div>
        <div><dt className="font-medium text-app-text">What you'll need</dt><dd className="mt-0.5 text-app-muted">A Zcash testnet wallet that keeps payment memos (NU7), with {taz(round.C_zats)} plus the wallet's fee, or none: the site's demo wallet can pay the deposit for you. TAZ is testnet Zcash and has no real value. 1 TAZ = 100,000,000 zats.</dd></div>
      </dl>
    </div>
  );
}

// The demo wallet's state, read once per page: whether it can pay now and the address its refunds come back to.
type Demo = Awaited<ReturnType<typeof api.demo>>;
function useDemo() {
  const [d, setD] = useState<Demo | null>(null);
  useEffect(() => { api.demo().then(setD).catch(() => setD(null)); }, []);
  return d;
}

function Steps({ step }: { step: number }) {
  const names = ["Seal", "Pay", "Track"];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Steps">
      {names.map((n, i) => (
        <li key={n} aria-current={i === step ? "step" : undefined}>
          <span aria-hidden className={cx("block h-[3px] rounded-full", i < step ? "bg-app-muted" : i === step ? "bg-gold" : "bg-app-2")} />
          <span className={cx("mt-2 block text-[13px]", i === step ? "font-medium text-app-text" : "text-app-faint")}>{i + 1}. {n}</span>
        </li>
      ))}
    </ol>
  );
}

function Form({ round, party, role, onSealed }: { round: AuctionDetail; party: PartyKey | null; role: ReturnType<typeof roleOf>; onSealed: (bid: any) => void }) {
  const q = new URLSearchParams(location.search);
  const lots: string[] | undefined = (round.manifest as any).lots;
  const [price, setPrice] = useState(q.get("price") ?? "");
  const [lot, setLot] = useState(lots?.[0] ?? "");
  const [refund, setRefund] = useState("");
  const demo = useDemo();
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ field?: "price" | "refund"; text: string } | null>(null);
  // The amount as typed; checked, never rewritten.
  const priceErr = (): string | null => {
    const v = price.trim();
    if (!v) return "Enter a price.";
    if (!/^\d+$/.test(v)) return `Use whole zats, in steps of ${role.tick}. You entered ${v}.`;
    const n = Number(v);
    if (n < role.lo || n > role.hi) return `Enter between ${zats(role.lo)} and ${zats(role.hi)} zats.`;
    if (n % role.tick) return `Use steps of ${role.tick} zats (for example ${zats(Math.round(n / role.tick) * role.tick)}).`;
    return null;
  };
  const toReview = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const p = priceErr(); if (p) { setErr({ field: "price", text: p }); return; }
    if (!/^utest1[0-9a-z]{40,}$/.test(refund.trim())) { setErr({ field: "refund", text: "Enter a shielded Zcash testnet address from your wallet. It starts with utest1." }); return; }
    setReview(true);
  };
  const seal = async () => {
    setErr(null);
    try {
      setBusy("Reserving your deposit address…");
      const slot = await api.slot(round.id, party?.public_hex);
      setBusy("Checking the round's signature…");
      const packet = await api.packet(round.id);
      setBusy("Sealing…");
      const { prepareSealedBid } = await import("../../lib/bidder");
      const bid = await prepareSealedBid({ packet: packet.manifest, signer: packet.signer, address: slot.address, price_zats: price.trim(), refund_ua: refund.trim(), lot: lots ? lot : undefined, owner_private_hex: party?.private_hex });
      onSealed({ ...bid, lot: lots ? lot : undefined, lot_index: lots ? lots.indexOf(lot) : undefined });
    } catch (x) {
      const msg = String((x as Error).message);
      setReview(false);
      setErr(/unified address|destination|refund/i.test(msg) ? { field: "refund", text: "That isn't a shielded testnet address. It should start with utest1." }
        : /every deposit slot/i.test(msg) ? { text: "This round is full: every deposit slot is taken. Nothing was sent. Pick another round that's taking bids from All rounds." }
        : { text: msg.replace(/^[^:]*: \d+ /, "") });
    } finally { setBusy(""); }
  };
  const lotLabel = (l: string) => `Lot ${(lots ?? []).indexOf(l) + 1}`;
  if (review) return (
    <div className="grid gap-4" data-testid="bid-review">
      <div className="text-[16px] font-medium">Review your sealed {role.noun}</div>
      <dl className="grid gap-2 text-[14px]">
        {party && <div className="flex justify-between gap-3"><dt className="text-app-faint">You are</dt><dd>{party.label}</dd></div>}
        {lots && <div className="flex justify-between gap-3"><dt className="text-app-faint">Lot</dt><dd>{lotLabel(lot)}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-app-faint">{role.label}</dt><dd className="tabular-nums">{zats(price)} zats</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-app-faint">Deposit you'll send</dt><dd className="tabular-nums">{zats(round.C_zats)} zats · {taz(round.C_zats)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-app-faint">{role.seller ? "Paid to" : "Refunds to"}</dt><dd className="min-w-0 truncate">{short(refund, 8)}</dd></div>
      </dl>
      <p className="text-[13px] text-app-muted">{role.deposit} Your wallet adds its own network fee.</p>
      {err && <ErrorLine testid="bid-error">{err.text}</ErrorLine>}
      <Btn onClick={seal} disabled={!!busy} full testid="bid-seal">{busy || `Seal this ${role.noun}`}</Btn>
      <p className="text-center text-[12.5px] text-app-faint">No money is sent by sealing.</p>
      <button type="button" onClick={() => setReview(false)} className="text-[13px] text-app-muted hover:text-app-text">Edit</button>
    </div>
  );
  return (
    <form onSubmit={toReview} className="grid gap-5" data-testid="bid-form" noValidate>
      {party && <div className="flex items-center justify-between text-[14px]" data-testid="bid-party"><span className="text-app-faint">You are</span><Pill kind="wait">{party.label}</Pill></div>}
      {lots && (
        <Field label="Lot">
          <select value={lot} onChange={(e) => setLot(e.target.value)} className={fieldCls} data-testid="bid-lot">{lots.map((l) => <option key={l} value={l}>{lotLabel(l)}</option>)}</select>
        </Field>
      )}
      <Field label={role.label} help={err?.field === "price" ? undefined : `Between ${zats(role.lo)} and ${zats(role.hi)} zats, in steps of ${role.tick}.${price && /^\d+$/.test(price) ? ` That's ${taz(price)}.` : ""}`}>
        <div className="relative">
          <input name="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={err?.field === "price"} className={cx(fieldCls, "pr-14 text-[17px] tabular-nums", err?.field === "price" && "ring-bad")} data-testid="bid-price" autoComplete="off" />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-app-faint">zats</span>
        </div>
      </Field>
      {err?.field === "price" && <p className="-mt-3 text-[13px] text-bad" data-testid="bid-error">{err.text}</p>}
      <Field label={role.seller ? "Where you get paid" : "Where your deposit comes back"} help={err?.field === "refund" ? undefined : "A shielded address from your testnet wallet. It's sealed so only the signers can read it."}>
        <input name="refund" value={refund} onChange={(e) => setRefund(e.target.value.trim())} spellCheck={false} placeholder="utest1…" aria-invalid={err?.field === "refund"} className={cx(fieldCls, "text-[13.5px]", err?.field === "refund" && "ring-bad")} data-testid="bid-refund" />
      </Field>
      {err?.field === "refund" && <p className="-mt-3 text-[13px] text-bad" data-testid="bid-error">{err.text}</p>}
      {demo?.address && refund !== demo.address && (
        <p className="-mt-3 text-[13px] text-app-muted">No testnet wallet? <button type="button" className="font-medium text-gold hover:underline" onClick={() => { setRefund(demo.address!); setErr(null); }} data-testid="bid-demo-refund">Use the demo wallet</button>. It can pay your deposit too, and {role.seller ? "payments" : "refunds"} go back to it.</p>
      )}
      {demo?.address && refund === demo.address && <p className="-mt-3 text-[13px] text-app-muted">Using the demo wallet's address. {role.seller ? "Payments" : "Refunds"} go back to the demo wallet.</p>}
      {err && !err.field && <ErrorLine testid="bid-error">{err.text}</ErrorLine>}
      <Btn type="submit" full testid="bid-next">Review {role.noun}</Btn>
    </form>
  );
}

function Pay({ round, role, s, open, onKey, onPaid, onNew }: { round: AuctionDetail; role: ReturnType<typeof roleOf>; s: Attempt; open: boolean; onKey: () => void; onPaid: (txid: string) => void; onNew: () => void }) {
  const [qr, setQr] = useState("");
  const [big, setBig] = useState(false);
  // The enlarged QR closes on Escape, on its Close button, or a click anywhere.
  useEffect(() => { if (!big) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [big]);
  const [txid, setTxid] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState("");
  const demo = useDemo();
  const [demoBusy, setDemoBusy] = useState("");
  const b = s.bid;
  useEffect(() => { QRCode.toDataURL(b.uri, { margin: 2, width: 640, color: { dark: "#000000", light: "#ffffff" }, errorCorrectionLevel: "L" }).then(setQr).catch(() => setQr("")); }, [b.uri]);
  const keyFile = () => {
    const body = JSON.stringify({ benzo_bid_key: 1, auction_id: b.auction_id, ciphertext_hash: b.ciphertext_hash, deposit_address: b.address, price_zats: b.price_zats, round: b.R,
      owner_private_hex: b.owner_private_hex, owner_public_hex: b.owner_public_hex, nonce_hex: b.nonce_hex, settlement_commitment_hex: b.settlement_commitment_hex }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    a.download = `benzo-bid-${b.ciphertext_hash.slice(0, 8)}.json`; a.click();
    onKey();
  };
  const copy = (what: string, v: string) => navigator.clipboard.writeText(v).then(() => { setCopied(what); setTimeout(() => setCopied(""), 2000); }).catch(() => setCopied("Couldn't copy; select it instead"));
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const t = txid.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(t)) { setErr("A transaction id is 64 letters and digits. Copy it from your wallet's history."); return; }
    setBusy(true);
    try {
      await api.submit(round.id, { address: b.address, txid: t, envelope_hex: b.envelope_hex, envelope_ct_hex: b.envelope_ct_hex, owner_sig_hex: b.owner_sig_hex, ciphertext_hash: b.ciphertext_hash });
      onPaid(t);
    } catch (x) { setErr(`Your wallet payment isn't affected. We couldn't record its transaction id: ${String((x as Error).message).replace(/^[^:]*: \d+ /, "")}. Keep this page and try again; don't pay again.`); } finally { setBusy(false); }
  };
  // The demo wallet pays this exact link (the sealed memo included), then the record is handed in as usual.
  const demoPay = async () => {
    setErr(""); setDemoBusy("Paying from the demo wallet. This takes about a minute…");
    try {
      const { job } = await api.demoPay(round.id, b.uri);
      let t = "";
      for (let i = 0; i < 200 && !t; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const j = await api.demoJob(job).catch(() => null);
        if (j?.state === "failed") throw new Error(j.error ?? "the demo payment failed");
        if (j?.state === "paid" && j.txid) t = j.txid;
      }
      if (!t) throw new Error("the demo payment is taking too long; check My activity later");
      setTxid(t); setDemoBusy("Paid. Recording your deposit…");
      await api.submit(round.id, { address: b.address, txid: t, envelope_hex: b.envelope_hex, envelope_ct_hex: b.envelope_ct_hex, owner_sig_hex: b.owner_sig_hex, ciphertext_hash: b.ciphertext_hash });
      onPaid(t);
    } catch (x) { setErr(`The demo wallet couldn't pay: ${String((x as Error).message)}`); } finally { setDemoBusy(""); }
  };
  if (leaving) return (
    <div className="grid gap-3">
      <div className="text-[16px] font-medium">Have you already sent this deposit?</div>
      <p className="text-[14px] text-app-muted">A sent payment can't be undone here. If you sent it, enter its transaction id so your {role.noun} counts.</p>
      <Btn onClick={() => setLeaving(false)} full>Yes, enter the transaction id</Btn>
      <Btn onClick={onNew} kind="secondary" full>Not yet, change my {role.noun}</Btn>
      <p className="text-[12.5px] text-app-faint">This {role.noun} stays saved in My activity either way.</p>
    </div>
  );
  return (
    <div className="grid gap-6">
      <div className="flex items-baseline justify-between text-[14px]">
        <span className="text-app-faint">Sealed{b.lot_index !== undefined ? ` · Lot ${b.lot_index + 1}` : ""}</span>
        <span className="tabular-nums"><span className="text-[17px] font-semibold">{zats(b.price_zats)}</span> zats</span>
      </div>
      <div className={cx("rounded-2xl p-4", s.savedKey ? "bg-[#ddd6c60a] ring-1 ring-app-line" : "bg-[#e9cd8414] ring-1 ring-[#e9cd8440]")}>
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-[14px] font-medium">{s.savedKey ? "Recovery file downloaded" : "First, download your recovery file"}</div><div className="text-[13px] text-app-muted">It holds your private bid key and price. Keep it private; you may need it to claim a refund.</div></div>
          <Btn kind={s.savedKey ? "text" : "primary"} onClick={keyFile} testid="bid-key">{s.savedKey ? "Again" : "Download"}</Btn>
        </div>
      </div>
      {!open ? (
        <div className="rounded-2xl bg-app-2 p-4 text-[14px]"><div className="font-medium">The payment window has closed</div><p className="mt-1 text-app-muted">Don't send a new deposit. If you already sent one, enter its transaction id below.</p></div>
      ) : (
        <div className={cx(!s.savedKey && "pointer-events-none opacity-50")} aria-disabled={!s.savedKey}>
          <div className="text-[14px] font-medium">Then pay the deposit</div>
          <p className="mt-1 text-[13px] text-app-muted">{s.savedKey ? "" : "Download the file above first. "}Pay with the demo wallet or your own testnet wallet. Your bid counts about 10 to 20 minutes after the payment, once it has 10 confirmations.</p>
          {demo && (
            <div className="mt-3 mb-5 rounded-2xl bg-[#e9cd8414] p-4 ring-1 ring-[#e9cd8440]" data-testid="bid-demo">
              <div className="text-[14px] font-medium">No testnet wallet?</div>
              <p className="mt-1 text-[13px] text-app-muted">The demo wallet can pay this deposit for you. It gets only this payment link, so your {role.noun} stays sealed. It does know that this deposit is the one it paid.</p>
              {demo.available
                ? <div className="mt-3"><Btn kind="secondary" onClick={demoPay} disabled={!!demoBusy || busy} full testid="bid-demo-pay">{demoBusy || "Pay with the demo wallet"}</Btn></div>
                : <p className="mt-2 text-[13px] text-app-faint">{demo.reason ?? "The demo wallet can't pay right now."}</p>}
            </div>
          )}
          <div className="text-[14px] font-medium">{demo?.available ? "Or pay from your own wallet" : "From your wallet"}</div>
          <dl className="mt-3 grid gap-1.5 rounded-xl bg-app-2 p-3 text-[13.5px]">
            <div className="flex justify-between gap-3"><dt className="text-app-faint">Network</dt><dd>Zcash testnet</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-app-faint">Amount</dt><dd className="tabular-nums">{taz(round.C_zats)} · exactly</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-app-faint">To</dt><dd className="min-w-0 truncate">{short(b.address, 8)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-app-faint">Memo</dt><dd>your sealed {role.noun}, included</dd></div>
          </dl>
          <div className="mt-3 grid gap-2 sm:hidden">
            <Btn href={b.uri} full testid="bid-uri-m">Open in wallet</Btn>
            <button type="button" className="text-[13px] text-app-muted hover:text-app-text" onClick={() => copy("Payment link copied, with the amount and sealed memo", b.uri)}>Copy payment link</button>
          </div>
          <div className="mt-4 flex gap-4">
            <button type="button" onClick={() => setBig(true)} className="shrink-0" aria-label="Enlarge the QR code">{qr ? <img src={qr} alt="QR code for the deposit payment" className="size-[180px] rounded-xl bg-white sm:size-[200px]" data-testid="bid-qr" /> : <div className="size-[180px] rounded-xl bg-app-2" />}</button>
            <div className="grid min-w-0 content-start gap-2 text-[14px]">
              <p className="text-app-muted"><span className="sm:hidden">Paying from another device? Scan this. </span>Use the whole payment link; sending to the address alone won't include your sealed {role.noun}.</p>
              <a href={b.uri} className="hidden w-fit rounded-full bg-sand px-4 py-2 font-semibold text-ink hover:bg-[#ebe5d6] sm:inline-block" data-testid="bid-uri">Open in wallet</a>
              <button type="button" className="hidden w-fit text-app-muted hover:text-app-text sm:block" onClick={() => copy("Payment link copied, with the amount and sealed memo", b.uri)}>Copy payment link</button>
              <button type="button" className="w-fit text-app-muted hover:text-app-text" onClick={() => setBig(true)}>Enlarge QR</button>
            </div>
          </div>
          <p className="mt-2 text-[13px] text-app-faint" role="status">{copied}</p>
        </div>
      )}
      <form onSubmit={send} className="grid gap-3">
        <Field label="Transaction id from your wallet" help={err ? undefined : "Your wallet shows it after sending. Submit it before the bids are committed at " + when(round.T_freeze) + "."}>
          <div className="flex gap-2">
            <input value={txid} onChange={(e) => setTxid(e.target.value.trim())} spellCheck={false} placeholder="64 characters" aria-invalid={Boolean(err)} className={cx(fieldCls, "text-[13.5px] tabular-nums")} data-testid="bid-txid" />
            <button type="button" className="shrink-0 rounded-[10px] bg-app-2 px-3 text-[13px] text-app-muted hover:text-app-text" onClick={() => navigator.clipboard.readText().then((t) => setTxid(t.trim())).catch(() => {})}>Paste</button>
          </div>
        </Field>
        {err && <ErrorLine>{err}</ErrorLine>}
        <Btn type="submit" disabled={busy || !s.savedKey} full testid="bid-send">{!s.savedKey ? "Download your recovery file first" : busy ? "Submitting…" : "Track this deposit"}</Btn>
        <button type="button" onClick={() => setLeaving(true)} className="text-[13px] text-app-faint hover:text-app-text">Change my {role.noun}</button>
      </form>
      <span className="sr-only" data-testid="bid-hash">{short(b.ciphertext_hash, 8)}</span>
      {big && qr && (
        <div role="dialog" aria-modal="true" aria-label="Payment QR code" className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6" onClick={() => setBig(false)}>
          <div className="grid w-full max-w-[420px] justify-items-center gap-4">
            <img src={qr} alt="QR code for the deposit payment" className="w-full rounded-2xl bg-white" />
            <button type="button" autoFocus onClick={() => setBig(false)} className="h-10 rounded-full bg-sand px-6 text-[14px] font-semibold text-ink">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// A paid bid the operator left out of the frozen set. The signers scan the vault's addresses themselves, so the deposit
// shows up in their settlement as a stray; after the opening, the bid's own key claims it back.
function LeftOut({ round, role, s, said }: { round: AuctionDetail; role: ReturnType<typeof roleOf>; s: Attempt; said: boolean }) {
  const demo = useDemo();
  const [row, setRow] = useState<{ party: string; amount_zats: string } | null>(null);
  const [paid, setPaid] = useState<{ txid: string; amount_zats: string } | null>(null);
  const [claim, setClaim] = useState<{ state: string; detail: string } | null>(null);
  const [dest, setDest] = useState("");
  const [err, setErr] = useState("");
  const look = async () => {
    if (!s.txid) return;
    const x = await api.stray(round.id, s.txid).catch(() => null);
    const r = x?.rows?.[0] ?? null; setRow(r);
    const p = x?.receipts?.[0]; if (p) setPaid({ txid: p.txid, amount_zats: p.amount_zats });
    if (r) await api.claimStatus(round.id, r.party).then(setClaim).catch(() => {});
  };
  useEffect(() => { void look(); const t = window.setInterval(look, 20_000); return () => window.clearInterval(t); }, []);
  useEffect(() => { if (!dest && demo?.address) setDest(demo.address); }, [demo]);
  const send = async () => {
    setErr("");
    if (!/^utest1[0-9a-z]{40,}$/.test(dest.trim())) { setErr("Enter a shielded testnet address (utest1…)."); return; }
    try {
      const packet = await api.packet(round.id);
      const { buildClaim } = await import("../../lib/bidder");
      const request = await buildClaim({ packet: packet.manifest, signer: packet.signer, party: row!.party, destination: dest.trim(), owner_private_hex: s.bid.owner_private_hex });
      setClaim(await api.claim(round.id, request));
    } catch (x) { setErr(String((x as Error).message)); }
  };
  return (
    <div className="grid gap-5" data-testid="bid-left-out">
      <div>
        <Pill kind="bad">Not in the round</Pill>
        <div className="mt-3 text-[18px] font-medium">The operator left your {role.noun} out</div>
        <p className="mt-1 text-[14px] text-app-muted">{said ? "The operator's status says it counted, but " : ""}your {role.noun} isn't in this round's frozen set, the list of bids two of three witnesses signed before anyone could read a price. So it can't win, and the operator couldn't have known what it bid.</p>
      </div>
      <div className="rounded-2xl bg-app-2 p-4 text-[14px]">
        <div className="font-medium">Your deposit is still yours</div>
        <p className="mt-1 text-app-muted">The signers scan the round's addresses on chain themselves, so they see your deposit even though the operator left it out. After the opening, this {role.noun}'s own key claims it back; the signers check that key before they pay.</p>
      </div>
      {paid ? (
        <div className="grid gap-1.5 text-[14px]" data-testid="claim-paid"><Pill kind="good">Refunded</Pill><div>{zats(paid.amount_zats)} zats sent back</div><Copyable value={paid.txid} display={short(paid.txid, 6)} /></div>
      ) : !row ? (
        <p className="text-[14px] text-app-muted">The claim opens once the round is settled ({round.state === "SETTLED" ? "looking for your deposit in the settlement…" : "waiting for the opening and settlement"}).</p>
      ) : claim && claim.state !== "failed" ? (
        <div className="text-[14px]" data-testid="claim-status"><Pill kind={claim.state === "paid" ? "good" : "wait"}>{claim.state === "paid" ? "Refunded" : "Claim sent"}</Pill><p className="mt-2 text-app-muted">{claim.state === "paid" ? "The signers paid it back." : "The signers are checking your claim. This takes a few minutes."}</p></div>
      ) : (
        <div className="grid gap-3">
          <Field label="Refund to" help={demo?.address && dest === demo.address ? "The demo wallet's address. Use your own if you have one." : "A shielded testnet address."}>
            <input value={dest} onChange={(e) => setDest(e.target.value.trim())} spellCheck={false} placeholder="utest1…" className={cx(fieldCls, "text-[13.5px]")} data-testid="claim-dest" />
          </Field>
          {(err || claim?.state === "failed") && <ErrorLine>{err || claim?.detail}</ErrorLine>}
          <Btn onClick={send} full testid="claim-send">Claim my {zats(row.amount_zats)} zats back</Btn>
        </div>
      )}
    </div>
  );
}

function Track({ round, role, s, open, onNew }: { round: AuctionDetail; role: ReturnType<typeof roleOf>; s: Attempt; open: boolean; onNew: () => void }) {
  const [st, setSt] = useState<{ status: string; detail: string; leaf_index?: number } | null>(null);
  const [down, setDown] = useState(false);
  const [checked, setChecked] = useState<number | null>(null);
  // Not on the operator's word: once the round is frozen, this page looks for the bid in the frozen set itself (the
  // root two of three witnesses signed). A bid that isn't there was left out, whatever the operator's status says.
  const [inSet, setInSet] = useState<boolean | null>(null);
  const [now, setNow] = useState<AuctionDetail>(round);
  const poll = async () => {
    try {
      const [x, d] = await Promise.all([api.bidStatus(round.id, s.bid.ciphertext_hash), api.auction(round.id)]);
      setSt(x); setNow(d); setDown(false); setChecked(Date.now());
      if (d.state !== "OPEN") await api.receipt(round.id, s.bid.ciphertext_hash).then(() => setInSet(true)).catch((e) => { if (/not in frozen/.test(String(e.message))) setInSet(false); });
    } catch { setDown(true); }
  };
  useEffect(() => { void poll(); const t = window.setInterval(poll, 15_000); return () => window.clearInterval(t); }, []);
  const status = st?.status ?? "";
  if (inSet === false) return <LeftOut round={now} role={role} s={s} said={status === "admitted"} />;
  const settled = round.state === "SETTLED" || round.state === "CANCELLED";
  const [pill, head, sub] = down
    ? [<Pill kind="bad">Status unavailable</Pill>, "We can't check your deposit right now", `Last successful check: ${checked ? new Date(checked).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "none yet"}. Your transaction id is saved. Don't send another deposit.`]
    : status === "admitted" ? [<Pill kind="good">Counted</Pill>, `Your ${role.noun} is in`, settled ? "The round has finished. See how it turned out." : `It's ${role.noun} ${Number(st?.leaf_index ?? 0) + 1} of this round, and opens with the others ${rel(round.release)}.`]
    : status === "refused" ? [<Pill kind="bad">Not counted</Pill>, `Your ${role.noun} didn't count`, `${st?.detail ?? ""} Your deposit can be refunded with your recovery file.`]
    : [<Pill kind="live">Looking for your deposit</Pill>, "Waiting for your deposit to confirm", `It counts after 10 confirmations, usually 10 to 20 minutes after you pay${s.at ? ` (yours: ${Math.max(0, Math.round((Date.now() - s.at) / 60000))} min so far)` : ""}. ${checked ? `Last checked ${new Date(checked).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}; we check every 15 seconds.` : "Checking now…"} You can close this page; this ${role.noun} stays in My activity.`];
  return (
    <div className="grid gap-5">
      <div>
        <div className="flex items-center gap-2">{pill}</div>
        <div className="mt-3 text-[18px] font-medium">{head}</div>
        <p className="mt-1 text-[14px] text-app-muted" data-testid="bid-status" data-status={down ? "unavailable" : status}>{sub}</p>
        {down && <button type="button" onClick={() => void poll()} className="mt-2 text-[14px] text-app-text underline underline-offset-4">Check again</button>}
      </div>
      <dl className="grid gap-2 text-[14px]">
        <div className="flex justify-between gap-3"><dt className="text-app-faint">{role.label}</dt><dd className="tabular-nums">{zats(s.bid.price_zats)} zats</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-app-faint">Expected deposit</dt><dd className="tabular-nums">{taz(round.C_zats)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-app-faint">Transaction</dt><dd className="min-w-0">{s.txid ? <Copyable value={s.txid} display={short(s.txid, 6)} /> : <span className="text-app-faint">from your recovery file</span>}</dd></div>
      </dl>
      <div className="grid gap-2">
        <Btn href={`/auction/?id=${round.id}&bid=${s.bid.ciphertext_hash}`} full testid="bid-follow">{settled ? "See how it turned out" : "View the round"}</Btn>
        {open && <button type="button" onClick={onNew} className="text-[13px] text-app-faint hover:text-app-text">Place another {role.noun}</button>}
      </div>
    </div>
  );
}
